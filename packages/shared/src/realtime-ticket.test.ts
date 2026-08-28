import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TicketError,
  TicketReplayGuard,
  issueTicket,
  verifyTicket,
} from "./realtime-ticket";

/**
 * Auth that fails open is worse than no auth, because it looks like it works.
 * Every case here is one where a plausible implementation quietly accepts
 * something it should not.
 */

const SUBJECT = {
  userId: "user_123",
  captureSessionId: "3f1b6b6a-0000-4000-8000-000000000001",
};

beforeEach(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-aaaaaaaaaaaaaaaaaaaaaaaa";
});

afterEach(() => {
  delete process.env.BETTER_AUTH_SECRET;
});

describe("issue and verify", () => {
  it("round-trips the payload", () => {
    const { ticket } = issueTicket(SUBJECT);
    const payload = verifyTicket(ticket);

    expect(payload.userId).toBe(SUBJECT.userId);
    expect(payload.captureSessionId).toBe(SUBJECT.captureSessionId);
    expect(payload.jti).toBeTruthy();
  });

  it("expires", () => {
    const now = 1_000_000;
    const { ticket, expiresAt } = issueTicket(SUBJECT, { now });

    expect(() => verifyTicket(ticket, { now: expiresAt - 1 })).not.toThrow();
    expect(() => verifyTicket(ticket, { now: expiresAt + 1 })).toThrow(TicketError);
  });

  it("expires within a minute", () => {
    // A ticket rides in a URL query parameter, so it lands in proxy access logs.
    // A long TTL turns that from a non-event into a real credential leak.
    const now = 1_000_000;
    const { expiresAt } = issueTicket(SUBJECT, { now });
    expect(expiresAt - now).toBeLessThanOrEqual(60_000);
  });

  it("issues a distinct nonce each time", () => {
    const a = verifyTicket(issueTicket(SUBJECT).ticket);
    const b = verifyTicket(issueTicket(SUBJECT).ticket);
    expect(a.jti).not.toBe(b.jti);
  });
});

describe("tampering", () => {
  it("rejects an altered payload", () => {
    // The attack that matters: swap in someone else's user id and keep the
    // signature. Without a real HMAC check this is how you read another
    // participant's drive.
    const { ticket } = issueTicket(SUBJECT);
    const [, signature] = ticket.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...SUBJECT, userId: "user_evil", jti: "x", exp: Date.now() + 10_000 }),
    ).toString("base64url");

    expect(() => verifyTicket(`${forged}.${signature}`)).toThrow(TicketError);
  });

  it("rejects an altered signature", () => {
    const { ticket } = issueTicket(SUBJECT);
    const [payload] = ticket.split(".");
    expect(() => verifyTicket(`${payload}.notasignature`)).toThrow(TicketError);
  });

  it("rejects a ticket signed with a different secret", () => {
    const { ticket } = issueTicket(SUBJECT);
    process.env.BETTER_AUTH_SECRET = "a-completely-different-secret-value";
    expect(() => verifyTicket(ticket)).toThrow(TicketError);
  });

  it("rejects malformed input without throwing something unexpected", () => {
    // A signature of the wrong LENGTH makes timingSafeEqual throw outright,
    // which would surface as a 500 rather than a rejection.
    for (const bad of ["", ".", "nodot", "a.b", `${"x".repeat(40)}.${"y".repeat(43)}`]) {
      expect(() => verifyTicket(bad), bad).toThrow(TicketError);
    }
  });

  it("reports a missing secret rather than signing with undefined", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(() => issueTicket(SUBJECT)).toThrow(TicketError);
  });
});

describe("replay", () => {
  it("accepts a ticket once and refuses it afterwards", () => {
    const guard = new TicketReplayGuard();
    const payload = verifyTicket(issueTicket(SUBJECT).ticket);

    expect(() => guard.consume(payload)).not.toThrow();
    expect(() => guard.consume(payload)).toThrow(TicketError);
  });

  it("forgets tickets once they can no longer be valid", () => {
    // Otherwise the guard is an unbounded map keyed by attacker-supplied input.
    const guard = new TicketReplayGuard();
    const now = 1_000_000;
    guard.consume(verifyTicket(issueTicket(SUBJECT, { now }).ticket, { now }), now);
    expect(guard.size).toBe(1);

    guard.consume(
      verifyTicket(issueTicket(SUBJECT, { now: now + 120_000 }).ticket, { now: now + 120_000 }),
      now + 120_000,
    );
    expect(guard.size).toBe(1);
  });
});

describe("ttlMs", () => {
  it("still defaults to one minute when not asked for anything else", () => {
    const now = 1_000_000;
    expect(issueTicket(SUBJECT, { now }).expiresAt).toBe(now + 60_000);
  });

  it("honours a longer life for the per-turn context ticket", () => {
    const now = 1_000_000;
    const ttlMs = 3 * 60 * 60 * 1000;
    const { ticket, expiresAt } = issueTicket(SUBJECT, { now, ttlMs });
    expect(expiresAt).toBe(now + ttlMs);
    // Still a real signature over the longer expiry, not merely a bigger number.
    expect(verifyTicket(ticket, { now: now + ttlMs - 1 }).captureSessionId).toBe(
      SUBJECT.captureSessionId,
    );
  });

  it("expires a long-lived ticket too", () => {
    const now = 1_000_000;
    const ttlMs = 3 * 60 * 60 * 1000;
    const { ticket } = issueTicket(SUBJECT, { now, ttlMs });
    expect(() => verifyTicket(ticket, { now: now + ttlMs + 1 })).toThrow();
  });
});
