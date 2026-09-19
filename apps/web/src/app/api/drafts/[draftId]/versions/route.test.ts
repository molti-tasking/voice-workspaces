/**
 * Integration tests for the person's half of drafts.
 *
 * The properties worth asserting are the ones a browser can actually produce:
 * an edit becomes the next minor, a stale base is refused WITH the head so the
 * editor can recover, a restore appends rather than rewinds, over-length text
 * is rejected rather than quietly clipped, and somebody else's draft is a 404
 * and not a 403.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "test-draft-route-user";
const OTHER_ID = "test-draft-route-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000d0b01";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-0000000d0b02";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { closeDb, getDb, inArray } = await import("@voicemural/db");
const { captureSession, user } = await import("@voicemural/db/schema");
const { appendDraftVersion, loadSessionDraftHistory, loadSessionDrafts, recordDraft } =
  await import("@voicemural/db/drafts");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { MAX_DRAFT_CHARS } = await import("@/lib/drafts");
const { POST } = await import("./route");

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

  const created = await recordDraft({
    captureSessionId: SESSION_ID,
    seq: 0,
    startOffsetMs: 1_000,
    title: "Email to William",
    text: "Dear William, the pilot starts on Monday.",
    respondingToText: "Draft me an email to William.",
  });
  return created!.draftId;
}

function post(draftId: string, body: unknown) {
  return POST(
    new Request(`http://test/api/drafts/${draftId}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ draftId }) },
  );
}

async function head(sessionId = SESSION_ID) {
  const [draft] = await loadSessionDrafts(sessionId);
  return draft!;
}

describeIfDb("POST /api/drafts/[draftId]/versions", () => {
  let draftId: string;
  beforeEach(async () => {
    draftId = await seed();
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("appends an edit as the next minor version", async () => {
    const base = await head();
    const res = await post(draftId, {
      action: "edit",
      baseVersionId: base.versionId,
      title: "Email to William",
      text: "William — the pilot starts Monday.",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version.version).toBe("v1.1");
    expect(body.version.author).toBe("user");
    expect((await head()).text).toBe("William — the pilot starts Monday.");
  });

  it("answers 409 with the head the draft moved to, keeping nothing", async () => {
    const stale = await head();
    // The agent rewrote it while the editor was open.
    await appendDraftVersion({
      draftId,
      userId: USER_ID,
      author: "agent",
      content: { title: "", text: "Pilot starts Monday." },
      respondingToText: "Make it shorter.",
    });

    const res = await post(draftId, {
      action: "edit",
      baseVersionId: stale.versionId,
      title: "Email to William",
      text: "Something they typed themselves.",
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("conflict");
    // The editor needs both halves to recover: what it moved to, and its id to
    // use as the new base.
    expect(body.head.version).toBe("v2.0");
    expect(body.head.text).toBe("Pilot starts Monday.");
    expect((await head()).version).toBe("v2.0");
  });

  it("answers 200 unchanged when the text is already what is stored", async () => {
    const base = await head();
    const res = await post(draftId, {
      action: "edit",
      baseVersionId: base.versionId,
      title: base.title,
      text: base.text,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "unchanged" });
    expect((await head()).version).toBe("v1.0");
  });

  it("restores an earlier version by appending it, labelled with where it came from", async () => {
    const original = await head();
    await post(draftId, {
      action: "edit",
      baseVersionId: original.versionId,
      title: "Email to William",
      text: "A worse attempt.",
    });

    const res = await post(draftId, {
      action: "restore",
      baseVersionId: (await head()).versionId,
      versionId: original.versionId,
    });

    expect(res.status).toBe(200);
    const now = await head();
    expect(now.version).toBe("v1.2");
    expect(now.text).toBe(original.text);
    expect((await loadSessionDraftHistory(SESSION_ID))[0]!.current.restoredFrom).toBe("v1.0");
  });

  it("rejects text past the cap rather than truncating it", async () => {
    const base = await head();
    const res = await post(draftId, {
      action: "edit",
      baseVersionId: base.versionId,
      title: "Email to William",
      text: "x".repeat(MAX_DRAFT_CHARS + 1),
    });

    expect(res.status).toBe(400);
    // Nothing was written: eating the end of what somebody typed is worse than
    // refusing the save.
    expect((await head()).version).toBe("v1.0");
  });

  it("does not find somebody else's draft, and does not say it exists", async () => {
    const theirs = await recordDraft({
      captureSessionId: OTHER_SESSION_ID,
      seq: 0,
      startOffsetMs: 0,
      title: "Not mine",
      text: "Their text.",
    });

    const res = await post(theirs!.draftId, {
      action: "edit",
      baseVersionId: (await head(OTHER_SESSION_ID)).versionId,
      title: "Mine now",
      text: "Taken.",
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
    expect((await head(OTHER_SESSION_ID)).text).toBe("Their text.");
  });

  it("treats a draft id that is not a uuid as a 404, not a bad body", async () => {
    const res = await post("not-a-uuid", {
      action: "edit",
      baseVersionId: (await head()).versionId,
      title: "x",
      text: "y",
    });
    expect(res.status).toBe(404);
  });

  it("refuses a restore of a version from a different draft", async () => {
    const other = await recordDraft({
      captureSessionId: SESSION_ID,
      seq: 1,
      startOffsetMs: 2_000,
      title: "Notes",
      text: "Unrelated text.",
    });
    const otherVersion = (await loadSessionDrafts(SESSION_ID)).find(
      (d) => d.id === other!.draftId,
    )!;

    const res = await post(draftId, {
      action: "restore",
      baseVersionId: (await head()).versionId,
      versionId: otherVersion.versionId,
    });

    expect(res.status).toBe(404);
    expect((await head()).text).toBe("Dear William, the pilot starts on Monday.");
  });
});
