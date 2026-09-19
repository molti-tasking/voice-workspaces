/**
 * Integration tests for draft versioning.
 *
 * The properties worth asserting are SQL guarantees and numbering rules, not
 * the shape of the objects: that the agent owns the major and the person the
 * minor, that a restore APPENDS rather than rewinds, that a double-submit costs
 * nothing, that a stale base is refused without losing the writer's text, and
 * that neither a stranger nor a version id borrowed from another draft can
 * reach a lineage.
 *
 * Skipped when Postgres is unreachable — so check the counts, not the colour.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { cueVersion } from "./display";
import {
  appendDraftVersion,
  draftVersionLabel,
  loadSessionDraftHistory,
  loadSessionDrafts,
  nextDraftSeq,
  recordDraft,
} from "./drafts";
import { agentDraft, agentDraftVersion, captureSession, user } from "./schema";
import { isDatabaseReachable } from "./testing";
import { closeDb, eq, getDb, inArray, sql } from "./index";

const USER_ID = "test-drafts-user";
const OTHER_ID = "test-drafts-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000d0a01";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-0000000d0a02";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  for (const id of [USER_ID, OTHER_ID]) {
    await db.insert(user).values({ id, name: "D", email: `${id}@test.local` });
  }
  await db
    .insert(captureSession)
    .values({ id: SESSION_ID, userId: USER_ID, startedAt: new Date() });
  await db
    .insert(captureSession)
    .values({ id: OTHER_SESSION_ID, userId: OTHER_ID, startedAt: new Date() });
}

/** One agent draft at v1.0, the way the container writes it. */
async function makeDraft(
  opts: { session?: string; seq?: number; title?: string; text?: string } = {},
) {
  const created = await recordDraft({
    captureSessionId: opts.session ?? SESSION_ID,
    seq: opts.seq ?? 0,
    startOffsetMs: 1_000,
    title: opts.title ?? "Email to William",
    text: opts.text ?? "Dear William, the pilot starts on Monday.",
    respondingToText: "Draft me an email to William.",
  });
  return created!.draftId;
}

/** The current version of the one draft in a session. */
async function head(sessionId = SESSION_ID) {
  const [draft] = await loadSessionDrafts(sessionId);
  return draft!;
}

describeIfDb("draft versions", () => {
  beforeEach(seed);

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("labels a version the way the card shows it", () => {
    expect(draftVersionLabel(1, 0)).toBe("v1.0");
    expect(draftVersionLabel(2, 11)).toBe("v2.11");
  });

  it("numbers the person's edits as minors and the agent's rewrites as majors", async () => {
    const draftId = await makeDraft();
    expect((await head()).version).toBe("v1.0");

    // The person tightens it twice.
    const first = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: "Email to William", text: "William — the pilot starts Monday." },
      baseVersionId: (await head()).versionId,
    });
    expect(first.status).toBe("created");
    expect((await head()).version).toBe("v1.1");

    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: "Email to William", text: "William — pilot Monday." },
      baseVersionId: (await head()).versionId,
    });
    expect((await head()).version).toBe("v1.2");

    // "Make it shorter" — the agent rewrites, so the minor resets: the hand
    // edits belonged to the text that was just replaced.
    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "agent",
      content: { title: "", text: "Pilot starts Monday." },
      respondingToText: "Make it shorter.",
    });
    const rewritten = await head();
    expect(rewritten.version).toBe("v2.0");
    expect(rewritten.author).toBe("agent");
    // An agent rewrite with no title keeps the heading it had.
    expect(rewritten.title).toBe("Email to William");
    expect(rewritten.respondingToText).toBe("Make it shorter.");

    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: "Email to William", text: "Pilot starts on Monday." },
      baseVersionId: rewritten.versionId,
    });
    expect((await head()).version).toBe("v2.1");
  });

  it("appends a restore as the next version rather than rewinding", async () => {
    const draftId = await makeDraft();
    const original = await head();

    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: "Email to William", text: "Something worse." },
      baseVersionId: original.versionId,
    });
    expect((await head()).version).toBe("v1.1");

    const restored = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { restoreVersionId: original.versionId },
      baseVersionId: (await head()).versionId,
    });

    expect(restored.status).toBe("created");
    const now = await head();
    // The newest version is always the current one — v1.2, not v1.0 again.
    expect(now.version).toBe("v1.2");
    expect(now.text).toBe(original.text);

    const [history] = await loadSessionDraftHistory(SESSION_ID);
    expect(history!.current.restoredFrom).toBe("v1.0");
    expect(history!.earlier.map((v) => v.version)).toEqual(["v1.1", "v1.0"]);
  });

  it("appends nothing when the text is identical to the current version", async () => {
    const draftId = await makeDraft();
    const current = await head();

    const result = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: current.title, text: current.text },
      baseVersionId: current.versionId,
    });

    expect(result.status).toBe("unchanged");
    expect(await countVersions(draftId)).toBe(1);
  });

  it("refuses a stale base, and hands back the version that overtook it", async () => {
    const draftId = await makeDraft();
    const stale = await head();

    // A second tab — or the agent — moved it on while they were typing.
    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "agent",
      content: { title: "", text: "Pilot starts Monday." },
    });

    const result = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: { title: "Email to William", text: "Their own typing." },
      baseVersionId: stale.versionId,
    });

    expect(result.status).toBe("conflict");
    expect(result.status === "conflict" && result.head.version).toBe("v2.0");
    // Nothing was written, so the caller still owns the text it was handed.
    expect(await countVersions(draftId)).toBe(2);
  });

  it("treats a double-submit as unchanged rather than as a conflict", async () => {
    const draftId = await makeDraft();
    const base = await head();
    const edit = { title: "Email to William", text: "William — pilot Monday." };

    const first = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: edit,
      baseVersionId: base.versionId,
    });
    // The same POST again: its base is stale BY CONSTRUCTION, and reporting a
    // conflict would ask the person to resolve a difference that does not exist.
    const second = await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "user",
      content: edit,
      baseVersionId: base.versionId,
    });

    expect(first.status).toBe("created");
    expect(second.status).toBe("unchanged");
    expect(await countVersions(draftId)).toBe(2);
  });

  it("does not let another person append to a draft", async () => {
    const draftId = await makeDraft();

    const result = await appendDraftVersion({
      draftId,
      userId: OTHER_ID,
      author: "user",
      content: { title: "x", text: "Mine now." },
    });

    expect(result.status).toBe("not_found");
    expect(await countVersions(draftId)).toBe(1);
  });

  it("does not restore a version that belongs to a different draft", async () => {
    const mine = await makeDraft({ seq: 0 });
    const other = await makeDraft({ seq: 1, title: "Notes", text: "Unrelated text." });
    const otherVersion = (await loadSessionDrafts(SESSION_ID)).find((d) => d.id === other)!;

    const result = await appendDraftVersion({
      draftId: mine,
      userId: USER_ID,
      author: "user",
      content: { restoreVersionId: otherVersion.versionId },
    });

    expect(result.status).toBe("not_found");
    expect(await countVersions(mine)).toBe(1);
  });

  it("writes one lineage and one v1.0 however many times the same seq is posted", async () => {
    const first = await recordDraft({
      captureSessionId: SESSION_ID,
      seq: 7,
      startOffsetMs: 0,
      title: "A",
      text: "one",
    });
    const retry = await recordDraft({
      captureSessionId: SESSION_ID,
      seq: 7,
      startOffsetMs: 0,
      title: "A",
      text: "one",
    });

    expect(first).not.toBeNull();
    expect(retry).toBeNull();

    const [row] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(agentDraft)
      .where(eq(agentDraft.captureSessionId, SESSION_ID));
    expect(row?.count).toBe(1);
    expect(await countVersions(first!.draftId)).toBe(1);

    // And the seed a reconnecting container would take.
    expect(await nextDraftSeq(SESSION_ID)).toBe(8);
    expect(await nextDraftSeq(OTHER_SESSION_ID)).toBe(0);
  });

  it("moves the cue version when a draft gains a version, not only a lineage", async () => {
    const draftId = await makeDraft();
    const before = await cueVersion(USER_ID, SESSION_ID);

    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "agent",
      content: { title: "", text: "Pilot starts Monday." },
      respondingToText: "Make it shorter.",
    });

    // Without this the panel would sit showing the text they just asked to
    // have replaced: the lineage count never moves on a rewrite.
    expect(await cueVersion(USER_ID, SESSION_ID)).not.toBe(before);
  });

  it("reads back drafts in the order they were asked for, at their current version", async () => {
    const first = await makeDraft({ seq: 0, title: "First", text: "one" });
    await makeDraft({ seq: 1, title: "Second", text: "two" });

    await appendDraftVersion({
      draftId: first,
      userId: USER_ID,
      author: "user",
      content: { title: "First", text: "one, revised" },
    });

    const drafts = await loadSessionDrafts(SESSION_ID);
    expect(drafts.map((d) => [d.title, d.version, d.text])).toEqual([
      ["First", "v1.1", "one, revised"],
      ["Second", "v1.0", "two"],
    ]);
    // The card is keyed on the LINEAGE, so an open editor survives a refresh.
    expect(drafts[0]!.id).toBe(first);
  });
});

async function countVersions(draftId: string): Promise<number> {
  const [row] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(agentDraftVersion)
    .where(eq(agentDraftVersion.draftId, draftId));
  return row?.count ?? 0;
}
