/**
 * Moving a guest's data onto a real account.
 *
 * Better Auth's anonymous plugin deletes the guest user once they sign in for
 * real. Every domain table references `user` with ON DELETE CASCADE, so unless
 * the data is reassigned *first*, upgrading a guest account silently destroys
 * every recording they made. That is the whole reason this file exists, and why
 * it runs inside a transaction.
 *
 * The second reason it is this careful: the guest is not always moving onto an
 * *empty* account. Anyone who has signed in before — then cleared a cookie,
 * opened the installed app instead of the browser tab, or picked up a second
 * phone — arrives as a guest with a target that already owns rows. Half the
 * tables here carry a unique key that starts with `user_id`, so a blanket
 * `set user_id = target` collides, the transaction aborts, and Better Auth's
 * after-hook rethrows into a 500 on the OAuth callback. The symptom is a blank
 * screen after choosing a Google account, for that person, forever: the guest
 * cookie survives the failure, so every retry collides in exactly the same way.
 * Every unique key below is therefore resolved explicitly before the move.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  capability,
  capabilityOrigin,
  capabilityVersion,
  captureSession,
  extraction,
  invocation,
  macroProposal,
  memoryEntry,
  outlet,
  workspaceCursor,
  workspaceOp,
} from "./schema";
import { getDb } from "./index";

export interface GuestMigrationResult {
  sessionsMoved: number;
  capabilitiesMoved: number;
  starterCapabilitiesReplaced: number;
  renamedOnCollision: string[];
  /** Outlets the target already had a name for, renamed rather than dropped. */
  outletsRenamedOnCollision: string[];
  /** Both sides held a workspace cursor, and the two watermarks were merged. */
  cursorMerged: boolean;
  /** Rows both sides held under the same unique key, resolved to one. */
  duplicatesResolved: number;
}

function emptyResult(): GuestMigrationResult {
  return {
    sessionsMoved: 0,
    capabilitiesMoved: 0,
    starterCapabilitiesReplaced: 0,
    renamedOnCollision: [],
    outletsRenamedOnCollision: [],
    cursorMerged: false,
    duplicatesResolved: 0,
  };
}

/** The first name in `taken`-free order: `mark`, `mark (guest)`, `mark (guest 2)`. */
function freeName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let suffix = 1;
  let name: string;
  do {
    name = suffix === 1 ? `${base} (guest)` : `${base} (guest ${suffix})`;
    suffix += 1;
  } while (taken.has(name));
  return name;
}

/**
 * Reassign everything owned by `fromUserId` to `toUserId`.
 *
 * Capabilities need care because `(userId, name)` is unique and the new account
 * has just been seeded with its own starter repertoire. The guest's copies are
 * the ones carrying real usage history — which is the paper's dependent
 * variable — so they win over untouched starters. Anything that would still
 * collide is renamed rather than dropped: never lose a capability to a merge.
 */
export async function migrateGuestData(
  fromUserId: string,
  toUserId: string,
): Promise<GuestMigrationResult> {
  const db = getDb();

  if (fromUserId === toUserId) return emptyResult();

  return db.transaction(async (tx) => {
    let duplicatesResolved = 0;

    // 1. Plain ownership reassignment. These carry no key but their own id, so
    //    nothing in them can collide however much the target already owns.
    //
    //    This is EVERY table with a direct `user` FK, checked against the
    //    schema, not just the ones the UI happens to surface: the workspace
    //    ledger, the extraction cache, declined macro proposals and the
    //    memory index are all study data that cascades away with the guest
    //    user otherwise. Manual board gestures (`workspace_op` with
    //    `via = 'user'`) are the acceptance measure's reversals and cannot be
    //    re-derived from the transcript.
    const movedSessions = await tx
      .update(captureSession)
      .set({ userId: toUserId })
      .where(eq(captureSession.userId, fromUserId))
      .returning({ id: captureSession.id });

    await tx
      .update(workspaceOp)
      .set({ userId: toUserId })
      .where(eq(workspaceOp.userId, fromUserId));

    // 2. The workspace cursor: `user_id` IS the primary key, so two rows is
    //    the collision — and the one that actually broke sign-in in
    //    production.
    //
    //    The cursor is a watermark: `loadPendingSegments` and
    //    `usersWithPendingSpeech` project only what occurred *after* it, and
    //    nothing before it is ever looked at again. One scalar cannot express
    //    "projected to here on the guest's drives, to there on the target's",
    //    so the merge has to pick a side, and the two errors are not
    //    symmetrical. Keeping the later watermark silently strands whatever
    //    speech falls between the two — it never reaches the board, and no
    //    later run will notice. Keeping the earlier one re-projects a bounded
    //    span that was already projected, which costs an extraction and can
    //    show a duplicate card the person can move or delete. Visible and
    //    reversible beats silent and total, so the earlier watermark wins.
    //
    //    A NULL `lastOccurredAt` means "nothing projected yet", which is the
    //    earliest watermark there is.
    const [guestCursor] = await tx
      .select()
      .from(workspaceCursor)
      .where(eq(workspaceCursor.userId, fromUserId))
      .limit(1);

    let cursorMerged = false;

    if (guestCursor) {
      const [targetCursor] = await tx
        .select()
        .from(workspaceCursor)
        .where(eq(workspaceCursor.userId, toUserId))
        .limit(1);

      if (!targetCursor) {
        await tx
          .update(workspaceCursor)
          .set({ userId: toUserId })
          .where(eq(workspaceCursor.userId, fromUserId));
      } else {
        const guestIsBehind =
          guestCursor.lastOccurredAt === null ||
          (targetCursor.lastOccurredAt !== null &&
            guestCursor.lastOccurredAt < targetCursor.lastOccurredAt);
        const behind = guestIsBehind ? guestCursor : targetCursor;

        await tx
          .update(workspaceCursor)
          .set({
            lastUtteranceId: behind.lastUtteranceId,
            lastOccurredAt: behind.lastOccurredAt,
            updatedAt: new Date(),
          })
          .where(eq(workspaceCursor.userId, toUserId));

        await tx
          .delete(workspaceCursor)
          .where(eq(workspaceCursor.userId, fromUserId));

        cursorMerged = true;
      }
    }

    // 3. Extractions: unique on `(user_id, input_hash)`.
    //
    //    The hash covers the prompt input alone — prompt version, model,
    //    temperature, the segments and the state digest — and not the user, so
    //    two people colliding means they genuinely sent the same request. The
    //    target's cached row answers it identically, so the guest's ops are
    //    re-pointed at it and the duplicate dropped. Re-pointing has to happen
    //    first: `workspace_op.extraction_id` cascades on delete, and deleting
    //    the extraction first would take the ops — the ledger — with it.
    const targetExtraction = alias(extraction, "target_extraction");
    const collidingExtractions = await tx
      .select({ guestId: extraction.id, targetId: targetExtraction.id })
      .from(extraction)
      .innerJoin(
        targetExtraction,
        and(
          eq(targetExtraction.userId, toUserId),
          eq(targetExtraction.inputHash, extraction.inputHash),
        ),
      )
      .where(eq(extraction.userId, fromUserId));

    for (const row of collidingExtractions) {
      await tx
        .update(workspaceOp)
        .set({ extractionId: row.targetId })
        .where(eq(workspaceOp.extractionId, row.guestId));
    }

    if (collidingExtractions.length > 0) {
      await tx.delete(extraction).where(
        inArray(
          extraction.id,
          collidingExtractions.map((r) => r.guestId),
        ),
      );
      duplicatesResolved += collidingExtractions.length;
    }

    await tx
      .update(extraction)
      .set({ userId: toUserId })
      .where(eq(extraction.userId, fromUserId));

    // 4. Macro proposals: unique on `(user_id, canonical_form)`, which is what
    //    makes re-detection idempotent and stops a declined proposal being
    //    offered twice. One of the two rows has to go, so keep the one that
    //    carries a decision — "what they tried to add and failed" is a stated
    //    field-study measure and only survives if refusals do. Between two
    //    decisions the later one is the person's current answer; between two
    //    undecided rows the one that saw more drives has the better evidence.
    const targetProposal = alias(macroProposal, "target_proposal");
    const collidingProposals = await tx
      .select({
        guestId: macroProposal.id,
        guestDecidedAt: macroProposal.decidedAt,
        guestSessionCount: macroProposal.sessionCount,
        targetId: targetProposal.id,
        targetDecidedAt: targetProposal.decidedAt,
        targetSessionCount: targetProposal.sessionCount,
      })
      .from(macroProposal)
      .innerJoin(
        targetProposal,
        and(
          eq(targetProposal.userId, toUserId),
          eq(targetProposal.canonicalForm, macroProposal.canonicalForm),
        ),
      )
      .where(eq(macroProposal.userId, fromUserId));

    const proposalsToDrop = collidingProposals.map((row) => {
      const guestWins =
        row.guestDecidedAt !== null && row.targetDecidedAt !== null
          ? row.guestDecidedAt > row.targetDecidedAt
          : row.guestDecidedAt !== null
            ? true
            : row.targetDecidedAt !== null
              ? false
              : row.guestSessionCount > row.targetSessionCount;
      // Drop the loser. The winner is either already on the target or is the
      // guest's row, which the blanket update below then moves across.
      return guestWins ? row.targetId : row.guestId;
    });

    if (proposalsToDrop.length > 0) {
      await tx.delete(macroProposal).where(inArray(macroProposal.id, proposalsToDrop));
      duplicatesResolved += proposalsToDrop.length;
    }

    await tx
      .update(macroProposal)
      .set({ userId: toUserId })
      .where(eq(macroProposal.userId, fromUserId));

    // 5. Memory entries: unique on `(user_id, kind, ref_id)`.
    //
    //    The only table here that is purely derived — every row is an
    //    embedding of text that still exists in the transcript or the ledger,
    //    and the indexer upserts it back on the next run. A duplicate is
    //    therefore the one thing in this file that is safe to simply drop.
    const targetMemory = alias(memoryEntry, "target_memory");
    const collidingMemories = await tx
      .select({ guestId: memoryEntry.id })
      .from(memoryEntry)
      .innerJoin(
        targetMemory,
        and(
          eq(targetMemory.userId, toUserId),
          eq(targetMemory.kind, memoryEntry.kind),
          eq(targetMemory.refId, memoryEntry.refId),
        ),
      )
      .where(eq(memoryEntry.userId, fromUserId));

    if (collidingMemories.length > 0) {
      await tx.delete(memoryEntry).where(
        inArray(
          memoryEntry.id,
          collidingMemories.map((r) => r.guestId),
        ),
      );
      duplicatesResolved += collidingMemories.length;
    }

    await tx
      .update(memoryEntry)
      .set({ userId: toUserId })
      .where(eq(memoryEntry.userId, fromUserId));

    // 6. Outlets: unique on `(user_id, name)`. Renamed rather than dropped,
    //    for the same reason capabilities are — an outlet carries a
    //    hand-written `config`, and `export_delivery` cascades from it, so
    //    dropping one loses both the destination and its delivery history.
    const guestOutlets = await tx
      .select({ id: outlet.id, name: outlet.name })
      .from(outlet)
      .where(eq(outlet.userId, fromUserId));

    const takenOutletNames = new Set(
      (
        await tx
          .select({ name: outlet.name })
          .from(outlet)
          .where(eq(outlet.userId, toUserId))
      ).map((o) => o.name),
    );

    const outletsRenamedOnCollision: string[] = [];

    for (const o of guestOutlets) {
      const name = freeName(o.name, takenOutletNames);
      if (name !== o.name) outletsRenamedOnCollision.push(`${o.name} → ${name}`);
      takenOutletNames.add(name);

      await tx
        .update(outlet)
        .set({ userId: toUserId, name })
        .where(eq(outlet.id, o.id));
    }

    // 7. Find the target's *pristine* starters: seeded, never edited, never
    //    fired. Only these may be displaced — a capability with history is real
    //    data and is never thrown away.
    const pristineStarters = await tx
      .select({ id: capability.id, name: capability.name })
      .from(capability)
      .innerJoin(capabilityOrigin, eq(capabilityOrigin.capabilityId, capability.id))
      .where(
        and(
          eq(capability.userId, toUserId),
          eq(capabilityOrigin.createdVia, "starter"),
          sql`not exists (
            select 1 from ${invocation}
            where ${invocation.capabilityId} = ${capability.id}
          )`,
          sql`(
            select count(*) from ${capabilityVersion}
            where ${capabilityVersion.capabilityId} = ${capability.id}
          ) = 1`,
        ),
      );

    const guestCapabilities = await tx
      .select({ id: capability.id, name: capability.name })
      .from(capability)
      .where(eq(capability.userId, fromUserId));

    const guestNames = new Set(guestCapabilities.map((c) => c.name));
    const displaceable = pristineStarters.filter((s) => guestNames.has(s.name));

    if (displaceable.length > 0) {
      await tx.delete(capability).where(
        inArray(
          capability.id,
          displaceable.map((s) => s.id),
        ),
      );
    }

    // 8. Move the guest's capabilities across, renaming any that would still
    //    collide with something the target genuinely owns.
    const stillOwned = await tx
      .select({ name: capability.name })
      .from(capability)
      .where(eq(capability.userId, toUserId));

    const taken = new Set(stillOwned.map((c) => c.name));
    const renamed: string[] = [];

    for (const cap of guestCapabilities) {
      const name = freeName(cap.name, taken);
      if (name !== cap.name) renamed.push(`${cap.name} → ${name}`);
      taken.add(name);

      await tx
        .update(capability)
        .set({ userId: toUserId, name })
        .where(eq(capability.id, cap.id));
    }

    return {
      sessionsMoved: movedSessions.length,
      capabilitiesMoved: guestCapabilities.length,
      starterCapabilitiesReplaced: displaceable.length,
      renamedOnCollision: renamed,
      outletsRenamedOnCollision,
      cursorMerged,
      duplicatesResolved,
    };
  });
}
