/**
 * The turn gist route: one turn shrunk by the fast model for its owner, and
 * nothing for anyone else's drive or a reply without a gist in it.
 *
 * The model is a stub; the drive's ownership is real. Needs the local
 * Postgres; skipped when it is unreachable.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER_ID = "test-realtime-gist-user";
// This file's own drive id: another test file's would collide when turbo runs them in parallel.
const DRIVE = "00000000-0000-4000-8000-0000000915a1";

const chat = vi.fn();
vi.mock("@voicemural/llm", () => ({ chat: (...args: unknown[]) => chat(...args) }));
let viewer: string | null = USER_ID;
vi.mock("@/lib/session", () => ({ currentUserId: async () => viewer }));

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { captureSession, user } = await import("@voicemural/db/schema");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { POST } = await import("./route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://test/api/realtime/gist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const asked = {
  captureSessionId: DRIVE,
  seq: 4,
  turn: { who: "user", text: "Okay so can you look up a hotel for the four of us near Skagen?" },
  before: { who: "agent", text: "Skagen is lovely in spring." },
};

describeIfDb("POST /api/realtime/gist", () => {
  beforeAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await getDb().insert(user).values({ id: USER_ID, name: "G", email: `${USER_ID}@test.local` });
    await getDb().insert(captureSession).values({ id: DRIVE, userId: USER_ID, startedAt: new Date() });
  });

  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  it("shrinks the turn with the fast model, the line before as context", async () => {
    chat.mockResolvedValueOnce({ content: '{"line": "Hotel for four near Skagen?", "two": "hotel Skagen", "one": "hotel"}' });
    const res = await post(asked);
    expect(await res.json()).toEqual({ gist: { seq: 4, line: "Hotel for four near Skagen?", two: "hotel Skagen", one: "hotel" } });
    const [messages, options] = chat.mock.calls[0]!;
    expect(options).toMatchObject({ role: "fast" });
    expect(messages[1].content).toContain("Assistant: Skagen is lovely in spring.");
    expect(messages[1].content).toContain("Person: Okay so can you look up a hotel");
  });

  it("answers no gist when the model gives none, or fails", async () => {
    chat.mockResolvedValueOnce({ content: "Sorry, I cannot." });
    expect(await (await post(asked)).json()).toEqual({ gist: null });
    chat.mockRejectedValueOnce(new Error("proxy down"));
    expect(await (await post(asked)).json()).toEqual({ gist: null });
  });

  it("is for the drive's owner only", async () => {
    viewer = "somebody-else";
    expect((await post(asked)).status).toBe(403);
    viewer = null;
    expect((await post(asked)).status).toBe(401);
    viewer = USER_ID;
    expect((await post({ ...asked, turn: { who: "user", text: "" } })).status).toBe(400);
  });
});
