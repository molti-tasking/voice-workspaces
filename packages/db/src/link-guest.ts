/**
 * Moving a guest's data onto a real account.
 *
 * Better Auth's anonymous plugin deletes the guest user once they sign in for
 * real. Every domain table references `user` with ON DELETE CASCADE, so unless
 * the data is reassigned *first*, upgrading a guest account silently destroys
 * every recording they made. That is the whole reason this file exists, and why
 * it runs inside a transaction.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./index";
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

export interface GuestMigrationResult {
  sessionsMoved: number;
  capabilitiesMoved: number;
  starterCapabilitiesReplaced: number;
  renamedOnCollision: string[];
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

  if (fromUserId === toUserId) {
    return {
      sessionsMoved: 0,
      capabilitiesMoved: 0,
      starterCapabilitiesReplaced: 0,
      renamedOnCollision: [],
    };
  }

  return db.transaction(async (tx) => {
    // 1. Everything that is a plain ownership reassignment moves wholesale —
    //    nothing in any of them can collide.
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
      .update(outlet)
      .set({ userId: toUserId })
      .where(eq(outlet.userId, fromUserId));

    await tx
      .update(workspaceOp)
      .set({ userId: toUserId })
      .where(eq(workspaceOp.userId, fromUserId));

    await tx
      .update(workspaceCursor)
      .set({ userId: toUserId })
      .where(eq(workspaceCursor.userId, fromUserId));

    await tx
      .update(extraction)
      .set({ userId: toUserId })
      .where(eq(extraction.userId, fromUserId));

    await tx
      .update(macroProposal)
      .set({ userId: toUserId })
      .where(eq(macroProposal.userId, fromUserId));

    await tx
      .update(memoryEntry)
      .set({ userId: toUserId })
      .where(eq(memoryEntry.userId, fromUserId));

    // 2. Find the target's *pristine* starters: seeded, never edited, never
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

    // 3. Move the guest's capabilities across, renaming any that would still
    //    collide with something the target genuinely owns.
    const stillOwned = await tx
      .select({ name: capability.name })
      .from(capability)
      .where(eq(capability.userId, toUserId));

    const taken = new Set(stillOwned.map((c) => c.name));
    const renamed: string[] = [];

    for (const cap of guestCapabilities) {
      let name = cap.name;
      if (taken.has(name)) {
        let suffix = 1;
        do {
          name = suffix === 1 ? `${cap.name} (guest)` : `${cap.name} (guest ${suffix})`;
          suffix += 1;
        } while (taken.has(name));
        renamed.push(`${cap.name} → ${name}`);
      }
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
    };
  });
}
