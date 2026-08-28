import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived signed tickets authorising a realtime WebSocket connection.
 *
 * A separate entry point (`@voicemural/shared/realtime-ticket`) rather than part
 * of the barrel, for the same reason `./storage` is: it imports `node:crypto`,
 * and the barrel is pulled into the browser bundle by the recorder.
 *
 * WHY NOT THE SESSION COOKIE. Better Auth's cookie is host-only, so it would in
 * fact ride a same-origin upgrade in production. Two problems: in development
 * the realtime service listens on a different port, so there is no cookie at
 * all and you end up maintaining two auth paths; and verifying it inside
 * apps/realtime means importing Better Auth and its database adapter into a
 * service that otherwise needs almost nothing. An HMAC over the shared
 * BETTER_AUTH_SECRET — which both containers already have — is verified with no
 * database round trip and behaves identically in dev, tunnel and production.
 *
 * The ticket authorises *opening* a socket. It is not a session: it expires in
 * a minute, is single-use, and the server re-resolves ownership from the
 * database before doing anything with it.
 */

/**
 * Deliberately short. The ticket is fetched immediately before connecting, so a
 * minute is generous, and it bounds the damage if one leaks into a log or a
 * proxy's access records — a URL query parameter is not a secret store.
 */
const TICKET_TTL_MS = 60_000;

export interface TicketPayload {
  userId: string;
  /**
   * The drive this ticket is for.
   *
   * Bound into the ticket so a socket cannot be reused across drives, and so
   * the server has something stable to re-resolve ownership against: Better
   * Auth's `onLinkAccount` deletes the guest user row when a guest signs in,
   * which leaves a live socket holding a `userId` that no longer exists.
   */
  captureSessionId: string;
  /** Nonce, so a captured ticket cannot be replayed. */
  jti: string;
  /** Expiry, epoch ms. */
  exp: number;
}

export class TicketError extends Error {
  constructor(
    readonly reason:
      | "malformed"
      | "bad_signature"
      | "expired"
      | "replayed"
      | "not_configured",
  ) {
    super(`realtime ticket rejected: ${reason}`);
    this.name = "TicketError";
  }
}

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new TicketError("not_configured");
  return value;
}

const b64url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

/** Issue a ticket. Called by the web app, which is the only side that has a session. */
export function issueTicket(
  input: Omit<TicketPayload, "jti" | "exp">,
  options: { now?: number; jti?: string; ttlMs?: number } = {},
): { ticket: string; expiresAt: number } {
  const now = options.now ?? Date.now();
  const payload: TicketPayload = {
    ...input,
    jti: options.jti ?? crypto.randomUUID(),
    /* `ttlMs` exists for ONE caller: the per-turn context endpoint, which needs
     * a credential that outlives a drive rather than a handshake.
     *
     * The minute above is short because a handshake ticket travels in a URL
     * query parameter, where proxies and access logs keep it. The context
     * ticket never does — it is sent in a POST body — and it authorises reading
     * back one drive's own transcript to a holder who has already proved
     * ownership of that drive. Lengthening it there does not weaken the reason
     * the default is short, which is why this is an argument rather than a
     * larger constant. */
    exp: now + (options.ttlMs ?? TICKET_TTL_MS),
  };

  const encoded = b64url(JSON.stringify(payload));
  return { ticket: `${encoded}.${sign(encoded)}`, expiresAt: payload.exp };
}

/**
 * Verify a ticket's signature and expiry. Does NOT check replay — see
 * `TicketReplayGuard`, which the connection handler owns.
 */
export function verifyTicket(ticket: string, options: { now?: number } = {}): TicketPayload {
  const dot = ticket.indexOf(".");
  if (dot <= 0) throw new TicketError("malformed");

  const encoded = ticket.slice(0, dot);
  const provided = Buffer.from(ticket.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(encoded), "base64url");

  // Constant time, and length-checked first: timingSafeEqual throws outright on
  // a length mismatch, which would turn a malformed ticket into a 500.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new TicketError("bad_signature");
  }

  let payload: TicketPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TicketPayload;
  } catch {
    throw new TicketError("malformed");
  }

  if (
    typeof payload.userId !== "string" ||
    typeof payload.captureSessionId !== "string" ||
    typeof payload.jti !== "string" ||
    typeof payload.exp !== "number"
  ) {
    throw new TicketError("malformed");
  }

  // Checked only after the signature, so an attacker learns nothing about
  // payload validity from an unsigned guess.
  if ((options.now ?? Date.now()) > payload.exp) throw new TicketError("expired");

  return payload;
}

/**
 * Single-use enforcement, in memory.
 *
 * In memory is sufficient and is not a shortcut: tickets live 60 seconds, and a
 * replay has to land on the same process to be useful — a different instance
 * would be a different socket with no shared state to hijack. Entries are
 * dropped once they can no longer be valid, so this cannot grow unbounded.
 */
export class TicketReplayGuard {
  private readonly seen = new Map<string, number>();

  /** Records the ticket and throws if it has already been used. */
  consume(payload: TicketPayload, now = Date.now()): void {
    this.sweep(now);
    if (this.seen.has(payload.jti)) throw new TicketError("replayed");
    this.seen.set(payload.jti, payload.exp);
  }

  private sweep(now: number): void {
    for (const [jti, exp] of this.seen) {
      if (exp < now) this.seen.delete(jti);
    }
  }

  get size(): number {
    return this.seen.size;
  }
}
