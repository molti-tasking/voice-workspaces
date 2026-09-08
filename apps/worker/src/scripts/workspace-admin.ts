/**
 * Workspace maintenance commands.
 *
 *   pnpm workspace:reparse            re-derive ops from stored responses
 *   pnpm workspace:rebuild            replay the transcript (cache hits, no calls)
 *   pnpm workspace:rebuild --force    bypass the cache after a PROMPT_VERSION bump
 *   pnpm workspace:show               print the current workspace
 *
 * All accept `--user <id>`; without it they operate on every user.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../.env", import.meta.url).pathname, quiet: true });

import { closeDb, eq, getDb } from "@voicemural/db";
import { user } from "@voicemural/db/schema";
import {
  appendOps,
  appendUserOp,
  clearExtractions,
  clearOps,
  loadExtractions,
  loadOps,
  loadUserOps,
  resetCursor,
  sessionIdsForUtterances,
} from "@voicemural/db/workspace";
import type { StoredOp } from "@voicemural/workspace";
import { foldWorkspace, parseExtractionResponse } from "@voicemural/workspace";
import { extractWorkspaceFully } from "../jobs/extract-workspace";
import { log } from "@voicemural/telemetry";

/**
 * The manual board gestures, which `clearOps` would otherwise delete.
 *
 * They are the measurement — whether a person kept or reversed what speech did
 * to their board — so both rebuild and reparse save them before clearing and
 * re-append them afterwards. Ids are the client's own, so a same-prompt
 * rebuild restores every gesture exactly: the block ids they reference are
 * deterministic and come back identical.
 *
 * After a PROMPT_VERSION bump every topic and block id changes (`inputHash`
 * includes the version), so the restored ops reference ids that no longer
 * exist. The fold already handles that: a revise whose topic and target are
 * both unknown has nowhere to land and is skipped, and so is a retire of an
 * unknown block. The gestures stay in the ledger — the pre-bump measurement is
 * still readable from `loadUserOps` — and nothing new is needed in the fold.
 */
async function restoreUserOps(userId: string, manual: StoredOp[]): Promise<number> {
  let restored = 0;
  for (const stored of manual) {
    const result = await appendUserOp({
      userId,
      id: stored.id,
      op: stored.op,
      occurredAt: stored.occurredAt,
    });
    if (result === "inserted") restored += 1;
  }
  return restored;
}

async function targetUsers(explicit?: string): Promise<string[]> {
  if (explicit) return [explicit];
  const rows = await getDb().select({ id: user.id }).from(user);
  return rows.map((r) => r.id);
}

/**
 * Re-derive ops from stored model responses. Makes no network calls.
 *
 * This is why raw responses are persisted: the parser is versioned logic that
 * will improve, and fixing it must not mean re-paying for the model output —
 * or re-rolling it, which would silently change the workspace.
 */
async function reparse(userId: string): Promise<void> {
  const extractions = await loadExtractions(userId);
  if (extractions.length === 0) {
    console.log(`  ${userId}: no stored extractions`);
    return;
  }

  const manual = await loadUserOps(userId);
  await clearOps(userId);

  let opsTotal = 0;
  let failed = 0;

  for (const e of extractions) {
    const parsed = parseExtractionResponse(e.rawResponse, { idSeed: e.inputHash });
    if (parsed.error) {
      failed += 1;
      continue;
    }

    const sourceIds = e.inputSegmentIds;
    const last = sourceIds[sourceIds.length - 1];
    const sessions = last ? await sessionIdsForUtterances([last]) : new Map();

    opsTotal += await appendOps({
      userId,
      extractionId: e.id,
      ops: parsed.ops,
      // The extraction's own timestamp is the only ordering available here; the
      // utterances it came from may since have been deleted.
      occurredAt: e.createdAt,
      captureSessionId: last ? sessions.get(last) : undefined,
      sourceUtteranceIds: sourceIds,
    });
  }

  const restored = await restoreUserOps(userId, manual);

  console.log(
    `  ${userId}: ${extractions.length} extractions → ${opsTotal} ops` +
      (failed > 0 ? ` (${failed} unparseable)` : "") +
      (restored > 0 ? `, ${restored} board gesture(s) restored` : ""),
  );
}

/**
 * Replay the whole transcript.
 *
 * Every step is a cache hit when the prompt is unchanged, so this normally
 * costs nothing and reproduces the same workspace. `--force` drops the cache
 * and pays for fresh calls — only correct after a deliberate PROMPT_VERSION bump.
 */
async function rebuild(userId: string, force: boolean): Promise<void> {
  const manual = await loadUserOps(userId);
  await clearOps(userId);
  await resetCursor(userId);
  if (force) await clearExtractions(userId);

  const outcomes = await extractWorkspaceFully(userId);
  const calls = outcomes.filter((o) => !o.cacheHit).length;
  const ops = outcomes.reduce((n, o) => n + o.opsAppended, 0);
  const tokens = outcomes.reduce((n, o) => n + o.totalTokens, 0);

  const restored = await restoreUserOps(userId, manual);

  console.log(
    `  ${userId}: ${outcomes.length} batches → ${ops} ops, ` +
      `${calls} model call(s)${tokens > 0 ? `, ${tokens} tokens` : ""}` +
      (restored > 0 ? `, ${restored} board gesture(s) restored` : ""),
  );
}

async function show(userId: string): Promise<void> {
  const state = foldWorkspace(await loadOps(userId));

  console.log(`\n  ${userId} — ${state.topics.length} topic(s), ${state.opCount} ops`);
  for (const topic of state.topics) {
    console.log(`\n  ## ${topic.title}`);
    for (const block of state.blocksByTopic.get(topic.id) ?? []) {
      const kind = block.kind === "task" ? `task/${block.state ?? "open"}` : block.kind;
      console.log(`    (${kind}) ${block.text}`);
    }
  }
  console.log("");
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const force = argv.includes("--force");
  const userFlag = argv.indexOf("--user");
  const explicitUser = userFlag !== -1 ? argv[userFlag + 1] : undefined;

  if (!command || !["reparse", "rebuild", "show"].includes(command)) {
    console.error("Usage: workspace-admin <reparse|rebuild|show> [--user <id>] [--force]");
    process.exit(1);
  }

  const users = await targetUsers(explicitUser);
  if (users.length === 0) {
    console.log("No users.");
    return;
  }

  console.log(`${command} for ${users.length} user(s)${force ? " (forced)" : ""}`);

  for (const userId of users) {
    if (command === "reparse") await reparse(userId);
    else if (command === "rebuild") await rebuild(userId, force);
    else await show(userId);
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    log.error("workspace-admin failed", {
      err: err instanceof Error ? err.stack : String(err),
    });
    await closeDb();
    process.exit(1);
  });
