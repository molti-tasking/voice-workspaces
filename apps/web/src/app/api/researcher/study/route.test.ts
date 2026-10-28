/**
 * The researchers' page's routes: hidden from everyone else, then a setup
 * made, invites and tests in it, closed, and its data downloaded with the
 * tests left out.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-researcher-study";
// Setups this file makes: never the active one, which other test files make sessions in.
const DESIGN = "tst-rs-a";

vi.mock("@/lib/session", () => ({
  currentUserId: async () => USER_ID,
  currentUser: async () => ({ id: USER_ID }),
}));

const { like } = await import("drizzle-orm");
const { closeDb, eq, getDb } = await import("@voicemural/db");
const { studyDesign, studySession } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");
const { GET } = await import("./export/route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function act(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/researcher/study", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const download = (file: string, design = DESIGN) =>
  GET(new Request(`http://localhost/api/researcher/study/export?design=${design}&file=${file}`));

describeIfDb("the researchers' study routes", () => {
  const before = process.env.RESEARCHER_USER_IDS;

  async function clean() {
    await getDb().delete(studySession).where(like(studySession.design, "tst-rs-%"));
    await getDb().delete(studyDesign).where(like(studyDesign.name, "tst-rs-%"));
  }

  beforeAll(clean);
  afterEach(() => {
    process.env.RESEARCHER_USER_IDS = USER_ID;
  });
  afterAll(async () => {
    process.env.RESEARCHER_USER_IDS = before;
    await clean();
    await closeDb();
  });

  it("is a 404 for anyone who is not a researcher", async () => {
    process.env.RESEARCHER_USER_IDS = "somebody-else";
    expect((await act({ action: "delete_tests", name: DESIGN })).status).toBe(404);
    expect((await download("sessions")).status).toBe(404);
  });

  it("makes a setup once, as a draft, and refuses one that is not well formed", async () => {
    process.env.RESEARCHER_USER_IDS = USER_ID;
    const design = { name: DESIGN, views: ["stack", "chat"], tasks: ["trip"], completionCode: "C0DE42", note: "pilot" };
    expect((await act({ action: "create_design", design: { ...design, views: [] } })).status).toBe(400);
    const made = await act({ action: "create_design", design });
    expect(await made.json()).toEqual({ ok: true, name: DESIGN });
    expect(await (await act({ action: "create_design", design })).json()).toEqual({ error: "taken" });

    const [row] = await getDb().select().from(studyDesign).where(eq(studyDesign.name, DESIGN));
    expect(row).toMatchObject({ status: "draft", views: ["stack", "chat"], tasks: ["trip"], completionCode: "C0DE42", note: "pilot" });
  });

  it("makes invites and tests in it, and only tests once it is closed", async () => {
    const test = (await (await act({ action: "invite", name: DESIGN, orderIndex: null, test: true })).json()) as Record<string, unknown>;
    expect(test).toMatchObject({ ok: true, test: true, cell: 0, view: "stack", task: "trip" });
    expect(test.link).toMatch(/\/study\/session\?code=[A-Za-z0-9_-]{24}$/);

    const real = (await (await act({ action: "invite", name: DESIGN, orderIndex: 1, test: false })).json()) as Record<string, unknown>;
    expect(real).toMatchObject({ ok: true, test: false, cell: 1, view: "chat" });
    expect((await act({ action: "invite", name: DESIGN, orderIndex: 2, test: false })).status).toBe(409);

    expect((await act({ action: "set_status", name: DESIGN, status: "closed" })).status).toBe(200);
    expect(await (await act({ action: "invite", name: DESIGN, orderIndex: null, test: false })).json()).toMatchObject({
      error: expect.stringMatching(/closed/),
    });
    expect((await act({ action: "invite", name: DESIGN, orderIndex: null, test: true })).status).toBe(200);
    expect((await act({ action: "update_details", name: DESIGN, completionCode: null, note: null })).status).toBe(200);
  });

  it("downloads its data with the tests left out, and the Prolific key apart", async () => {
    const res = await download("sessions");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${DESIGN}-sessions.csv"`);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const csv = await res.text();
    const [header, ...rows] = csv.trim().split("\n");
    expect(header).toMatch(/^ref,source,design,/);
    expect(header).not.toContain("prolific_pid");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^F\d+,invite,tst-rs-a,1,/);

    expect((await download("transcripts")).headers.get("Content-Type")).toContain("ndjson");
    expect((await download("nonsense")).status).toBe(400);
    expect((await download("sessions", "tst-rs-none")).status).toBe(404);
  });

  it("deletes its tests, and the setup only once nobody took part", async () => {
    expect(await (await act({ action: "delete_tests", name: DESIGN })).json()).toEqual({ ok: true, deleted: 2 });
    expect(await (await act({ action: "delete_design", name: DESIGN })).json()).toEqual({ error: "has_sessions" });
  });
});
