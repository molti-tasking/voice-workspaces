/**
 * The turn ledger's two rules, against a real database.
 *
 * NOTHING IS SPOKEN INTO A CLOSED DRIVE. On Pilot 01 the container spoke a
 * turn 52.6 seconds after Stop and this side wrote it down, so the closed
 * session's transcript contains a reply that had no listener, stamped after
 * `ended_at`. The container is fixed too, but the two are not alternatives: it
 * is a separate process on the other side of a network, and the ledger is what
 * has to be right in six months.
 *
 * A TURN'S END IS MEASURED, NOT ESTIMATED. Every uninterrupted turn used to
 * carry `len(text) / 14` characters a second with nothing marking it as a
 * guess. The row still goes in immediately — the echo filter cannot wait for
 * playback — and the PATCH corrects it when the audio actually drains.
 *
 * Needs the local Postgres; skipped when it is unreachable — check the counts.
 */
import { config } from "dotenv";
config({ path: new URL("../../../../../../../.env", import.meta.url).pathname, quiet: true });

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const { closeDb, eq, getDb } = await import("@voicemural/db");
const { agentDecision, agentTurn, captureSession, user } = await import("@voicemural/db/schema");
const { issueTicket } = await import("@voicemural/shared/realtime-ticket");
const { isDatabaseReachable } = await import("@voicemural/db/testing");
const { PATCH, POST } = await import("./route");
const { POST: DECIDE } = await import("../decision/route");

const describeIfDb = (await isDatabaseReachable()) ? describe : describe.skip;

const USER_ID = "test-realtime-turn-user";
const SESSION = "00000000-0000-4000-8000-00000000c101";

function ticket(): string {
  // Long-lived, like the context ticket the container actually carries: a
  // handshake ticket lives a minute and these tests outlive one.
  return issueTicket({ userId: USER_ID, captureSessionId: SESSION }, { ttlMs: 60_000 }).ticket;
}

async function seed(opts: { ended?: boolean; debriefing?: boolean } = {}) {
  const db = getDb();
  await db.delete(user).where(eq(user.id, USER_ID));
  await db.insert(user).values({ id: USER_ID, name: "T", email: `${USER_ID}@test.local` });
  await db.insert(captureSession).values({
    id: SESSION,
    userId: USER_ID,
    startedAt: new Date("2026-09-19T09:00:00Z"),
    endedAt: opts.ended ? new Date("2026-09-19T09:20:00Z") : null,
    debriefStartedOffsetMs: opts.debriefing ? 900_000 : null,
  });
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/realtime/agent-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: ticket(), ...body }),
    }),
  );
}

const TURN = {
  seq: 0,
  startOffsetMs: 4_000,
  endOffsetMs: 6_000,
  text: "Halfway through the method.",
  generatedText: "Halfway through the method.",
};

describeIfDb("POST /api/realtime/agent-turn", () => {
  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  beforeEach(async () => {
    await seed();
  });

  it("writes a turn while the drive is running", async () => {
    const res = await post(TURN);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string | null };
    expect(id).toBeTruthy();

    const rows = await getDb()
      .select({ kind: agentTurn.kind, endMeasured: agentTurn.endMeasured })
      .from(agentTurn)
      .where(eq(agentTurn.captureSessionId, SESSION));
    expect(rows).toHaveLength(1);
    // The estimate does not claim to be a measurement.
    expect(rows[0]?.endMeasured).toBe(false);
  });

  it("refuses a turn once the drive has ended, and says why", async () => {
    await seed({ ended: true });
    const res = await post(TURN);
    // 409, not 403: the container reads this as "the drive is over, stop
    // writing", where a 403 would read as a bad ticket and be retried.
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("session_ended");

    const rows = await getDb().select().from(agentTurn).where(eq(agentTurn.captureSessionId, SESSION));
    expect(rows).toHaveLength(0);
  });

  it("refuses a turn during the debrief, which the agent is not part of", async () => {
    await seed({ debriefing: true });
    const res = await post(TURN);
    expect(res.status).toBe(409);
  });

  it("takes the filler kind, so a placeholder is never counted as a reply", async () => {
    await post({ ...TURN, kind: "filler", text: "Moment, ich schaue nach." });
    const rows = await getDb()
      .select({ kind: agentTurn.kind })
      .from(agentTurn)
      .where(eq(agentTurn.captureSessionId, SESSION));
    expect(rows[0]?.kind).toBe("filler");
  });
});

describeIfDb("PATCH /api/realtime/agent-turn", () => {
  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  async function patch(id: string, body: Record<string, unknown>) {
    return PATCH(
      new Request("http://localhost/api/realtime/agent-turn", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticket(), id, ...body }),
      }),
    );
  }

  it("replaces the estimate with the measured end and marks it as measured", async () => {
    await seed();
    const { id } = (await (await post(TURN)).json()) as { id: string };

    const res = await patch(id, { endOffsetMs: 9_400, speakTtfbMs: 210 });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(true);

    const [row] = await getDb()
      .select({
        endOffsetMs: agentTurn.endOffsetMs,
        endMeasured: agentTurn.endMeasured,
        speakTtfbMs: agentTurn.speakTtfbMs,
      })
      .from(agentTurn)
      .where(eq(agentTurn.id, id));
    expect(row).toMatchObject({ endOffsetMs: 9_400, endMeasured: true, speakTtfbMs: 210 });
  });

  it("still lands after the drive has ended", async () => {
    // A turn still playing when Stop is tapped has its end measured a second
    // later. Refusing that would leave the last turn of every drive carrying
    // the estimate — and it corrects a row rather than adding one.
    await seed();
    const { id } = (await (await post(TURN)).json()) as { id: string };
    await getDb()
      .update(captureSession)
      .set({ endedAt: new Date() })
      .where(eq(captureSession.id, SESSION));

    const res = await patch(id, { endOffsetMs: 9_400 });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(true);
  });

  it("never moves an interrupted turn's end, which was already measured", async () => {
    await seed();
    const { id } = (await (await post({ ...TURN, bargedIn: true, truncatedAtMs: 800 })).json()) as {
      id: string;
    };
    const res = await patch(id, { endOffsetMs: 99_000 });
    expect((await res.json()).updated).toBe(false);

    const [row] = await getDb()
      .select({ endOffsetMs: agentTurn.endOffsetMs })
      .from(agentTurn)
      .where(eq(agentTurn.id, id));
    expect(row?.endOffsetMs).toBe(6_000);
  });
});

describeIfDb("POST /api/realtime/decision", () => {
  afterAll(async () => {
    await getDb().delete(user).where(eq(user.id, USER_ID));
    await closeDb();
  });

  function decide(body: Record<string, unknown>) {
    return DECIDE(
      new Request("http://localhost/api/realtime/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: ticket(), ...body }),
      }),
    );
  }

  async function decisions() {
    return getDb()
      .select({
        seq: agentDecision.seq,
        outcome: agentDecision.outcome,
        authoritative: agentDecision.authoritative,
      })
      .from(agentDecision)
      .where(eq(agentDecision.captureSessionId, SESSION))
      .orderBy(agentDecision.seq);
  }

  it("keeps exactly one row authoritative when a moment runs twice", async () => {
    await seed();
    await decide({ seq: 0, offsetMs: 3_000, trigger: "user_turn", outcome: "declined", cueId: "m1" });
    await decide({ seq: 1, offsetMs: 3_000, trigger: "user_turn", outcome: "spoke", cueId: "m1" });

    // What the person HEARD is what the moment became, so the spoken one wins
    // and the decline it superseded is kept but no longer counted.
    expect(await decisions()).toEqual([
      { seq: 0, outcome: "declined", authoritative: false },
      { seq: 1, outcome: "spoke", authoritative: true },
    ]);
  });

  it("does not let a later decline outrank the turn that spoke", async () => {
    await seed();
    await decide({ seq: 0, offsetMs: 3_000, trigger: "user_turn", outcome: "spoke", cueId: "m2" });
    await decide({ seq: 1, offsetMs: 3_000, trigger: "user_turn", outcome: "declined", cueId: "m2" });

    expect(await decisions()).toEqual([
      { seq: 0, outcome: "spoke", authoritative: true },
      { seq: 1, outcome: "declined", authoritative: false },
    ]);
  });

  it("treats separate moments separately", async () => {
    await seed();
    await decide({ seq: 0, offsetMs: 3_000, trigger: "user_turn", outcome: "declined", cueId: "m3" });
    await decide({ seq: 1, offsetMs: 9_000, trigger: "answer", outcome: "declined", cueId: "m4" });

    expect((await decisions()).every((d) => d.authoritative)).toBe(true);
  });

  it("refuses a decision for a drive that has ended", async () => {
    await seed({ ended: true });
    const res = await decide({ seq: 0, offsetMs: 3_000, trigger: "user_turn", outcome: "declined" });
    expect(res.status).toBe(409);
    expect(await decisions()).toHaveLength(0);
  });
});
