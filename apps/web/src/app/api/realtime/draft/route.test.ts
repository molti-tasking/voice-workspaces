/**
 * Integration tests for the container's draft route.
 *
 * The property this exists for is `revises`: a handle the agent sends back must
 * make the write the next VERSION of that draft, and a handle that resolves to
 * nothing must fall open to a NEW draft rather than guessing which of the
 * person's drafts to overwrite. The handles themselves are derived
 * (`draftHandle`), so a test that hard-coded one would be testing the fixture.
 *
 * Needs the local Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, inArray } from "@voicemural/db";
import { loadSessionDraftHistory, loadSessionDrafts, recordDraft } from "@voicemural/db/drafts";
import { captureSession, user } from "@voicemural/db/schema";
import { isDatabaseReachable } from "@voicemural/db/testing";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import { draftHandle } from "@voicemural/talkback";
import { POST } from "./route";

const USER_ID = "test-realtime-draft-user";
const OTHER_ID = "test-realtime-draft-other";
const SESSION_ID = "00000000-0000-4000-8000-0000000d0c01";
const OTHER_SESSION_ID = "00000000-0000-4000-8000-0000000d0c02";

// The route verifies a real HMAC, so the suite needs the same secret the app
// would have. Set before `issueTicket` is ever called.
process.env.BETTER_AUTH_SECRET ??= "test-secret-for-draft-route";

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

async function seed() {
  const db = getDb();
  await db.delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
  await db.insert(user).values({ id: USER_ID, name: "D", email: `${USER_ID}@test.local` });
  await db.insert(user).values({ id: OTHER_ID, name: "O", email: `${OTHER_ID}@test.local` });
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
    text: "Dear William, the pilot starts on Monday. Best, Anna",
    respondingToText: "Draft me an email to William.",
  });
  return created!.draftId;
}

function post(body: Record<string, unknown>, sessionId = SESSION_ID, userId = USER_ID) {
  const { ticket } = issueTicket({ userId, captureSessionId: sessionId });
  return POST(
    new Request("http://test/api/realtime/draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, ...body }),
    }),
  );
}

describeIfDb("POST /api/realtime/draft", () => {
  let draftId: string;
  beforeEach(async () => {
    draftId = await seed();
  });

  afterAll(async () => {
    await getDb().delete(user).where(inArray(user.id, [USER_ID, OTHER_ID]));
    await closeDb();
  });

  it("turns a revise into the next major version of the same draft", async () => {
    const res = await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "Email to William",
      text: "William — pilot starts Monday.",
      respondingToText: "Make it shorter.",
      revises: draftHandle(draftId),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      draftId,
      version: "v2.0",
      revised: true,
    });

    // ONE card, not two. That is the whole point.
    const drafts = await loadSessionDrafts(SESSION_ID);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.text).toBe("William — pilot starts Monday.");
    expect(drafts[0]!.respondingToText).toBe("Make it shorter.");
    expect((await loadSessionDraftHistory(SESSION_ID))[0]!.earlier).toHaveLength(1);
  });

  it("writes a new draft when the handle resolves to nothing", async () => {
    const res = await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "Notes",
      text: "Something else entirely.",
      // A handle the model invented. Fail open: losing the version link costs a
      // number, guessing wrong overwrites text the person spent the drive on.
      revises: "deadbe",
    });

    const body = await res.json();
    expect(body.revised).toBe(false);
    expect(body.version).toBe("v1.0");
    expect(body.draftId).not.toBe(draftId);
    expect(await loadSessionDrafts(SESSION_ID)).toHaveLength(2);
  });

  it("keeps the current title when a revise arrives without one", async () => {
    await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "",
      text: "William — pilot Monday.",
      revises: draftHandle(draftId),
    });

    const [draft] = await loadSessionDrafts(SESSION_ID);
    // "Make it shorter" routinely comes back with no title; blanking the card's
    // heading for that is a regression nobody asked for.
    expect(draft!.title).toBe("Email to William");
    expect(draft!.version).toBe("v2.0");
  });

  it("does not resolve a handle from another drive", async () => {
    const theirs = await recordDraft({
      captureSessionId: OTHER_SESSION_ID,
      seq: 0,
      startOffsetMs: 0,
      title: "Not mine",
      text: "Their text.",
    });

    const res = await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "Taken",
      text: "Overwritten?",
      revises: draftHandle(theirs!.draftId),
    });

    expect((await res.json()).revised).toBe(false);
    // Theirs is untouched, and ours gained a second draft rather than a
    // version.
    const [other] = await loadSessionDrafts(OTHER_SESSION_ID);
    expect(other!.text).toBe("Their text.");
    expect(other!.version).toBe("v1.0");
    expect(await loadSessionDrafts(SESSION_ID)).toHaveLength(2);
  });

  it("normalises a handle the model dressed up", async () => {
    const handle = draftHandle(draftId);
    const res = await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "Email to William",
      text: "William — pilot Monday.",
      revises: `#${handle.slice(0, 3).toUpperCase()}-${handle.slice(3)}`,
    });

    expect((await res.json()).revised).toBe(true);
  });

  it("still writes a plain draft when no handle is sent at all", async () => {
    const res = await post({
      seq: 1,
      startOffsetMs: 2_000,
      title: "Notes",
      text: "A second thing.",
    });

    // The old container never sends `revises`, and must keep working unchanged.
    expect(await res.json()).toMatchObject({ ok: true, version: "v1.0", revised: false });
    expect(await loadSessionDrafts(SESSION_ID)).toHaveLength(2);
  });
});
