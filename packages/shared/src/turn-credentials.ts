import { createHmac, randomBytes } from "node:crypto";

/**
 * Time-limited TURN credentials, minted from a secret coturn also holds.
 *
 * A separate entry point rather than part of the barrel, for the same reason
 * `./realtime-ticket` is: it imports `node:crypto`, and the barrel is pulled
 * into the browser bundle by the recorder.
 *
 * WHY TURN EXISTS AT ALL. Only signalling goes through Traefik; the media is
 * peer-to-peer. STUN is enough to get a path when at least one side can be
 * hole-punched — which is why this worked from a desk on Wi-Fi for weeks. It is
 * NOT enough from a mobile carrier: carrier-grade NAT is typically symmetric,
 * so the mapping the phone learns from STUN is not the mapping the container
 * sends to, ICE finds no candidate pair, and the call sits in `checking` until
 * it times out about a minute later. Nothing in the logs says "NAT" — the bot
 * cheerfully generates its opening line and speaks it into a transport that has
 * no path, the browser shows a connecting pill, and the drive is silent. A
 * relay is the only fix; there is no configuration of STUN that gets there.
 *
 * WHY MINTED RATHER THAN CONFIGURED. coturn's `static-auth-secret` mode (the
 * "TURN REST API") takes an expiry-stamped username and an HMAC of it as the
 * password, so the browser can be handed a credential that is useless tomorrow
 * without the secret ever leaving the server. A fixed username and password
 * would have to be inlined into the client bundle at build time — public,
 * permanent, and an open relay for anyone who reads the JavaScript.
 */

/**
 * Long enough for a drive, and no longer.
 *
 * coturn checks expiry when an allocation is created AND when it is refreshed,
 * so a credential that dies mid-drive drops the audio rather than merely
 * refusing a new call. Twelve hours is far beyond any drive and still bounds
 * what a leaked credential is worth.
 */
export const DEFAULT_TURN_TTL_SECONDS = 12 * 60 * 60;

export interface TurnCredentials {
  /** `<unix-expiry>:<label>`, the form coturn parses the expiry back out of. */
  username: string;
  /** base64 of HMAC-SHA1(secret, username). coturn's scheme, not a choice. */
  credential: string;
  /** Epoch SECONDS, matching the username. */
  expiresAt: number;
}

/**
 * An ICE server as both `RTCIceServer` (browser) and aiortc understand it.
 *
 * Deliberately not typed as the DOM's `RTCIceServer`: this module is imported
 * by route handlers running in Node, where that type does not exist.
 */
export interface IceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

/**
 * The label half of the username.
 *
 * Random, NOT the user id. The username travels in the SDP and is written to
 * coturn's log for every allocation, and neither is somewhere a participant
 * identifier belongs — coturn itself only ever reads the expiry, so the label
 * carries no meaning to anyone.
 */
function label(): string {
  return randomBytes(6).toString("hex");
}

export function mintTurnCredentials(options: {
  secret: string;
  ttlSeconds?: number;
  /** Epoch MILLISECONDS, like `Date.now()`. */
  now?: number;
}): TurnCredentials {
  const nowMs = options.now ?? Date.now();
  const ttl = options.ttlSeconds ?? DEFAULT_TURN_TTL_SECONDS;
  const expiresAt = Math.floor(nowMs / 1000) + ttl;
  const username = `${expiresAt}:${label()}`;

  return {
    username,
    // SHA-1 and standard base64 are coturn's wire format, not a security
    // choice: the secret never travels, and the digest is a bearer token with
    // a deadline rather than a signature anyone relies on for integrity.
    credential: createHmac("sha1", options.secret).update(username).digest("base64"),
    expiresAt,
  };
}

/** Split the comma-separated form the environment uses. Empty means none. */
export function parseIceUrls(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
}

/**
 * The complete ICE configuration to hand a peer: STUN as-is, TURN with a
 * freshly minted credential attached.
 *
 * Both halves matter and they are not interchangeable. STUN alone gets a direct
 * path when one is available, which is faster and costs no relay bandwidth;
 * TURN is the fallback that always works. Offering only TURN would relay every
 * drive including the ones that never needed it.
 */
export function buildIceServers(options: {
  stunUrls: string[];
  turnUrls: string[];
  turnSecret?: string | null;
  ttlSeconds?: number;
  now?: number;
}): { iceServers: IceServerConfig[]; turnExpiresAt: number | null } {
  const servers: IceServerConfig[] = [];

  if (options.stunUrls.length > 0) servers.push({ urls: options.stunUrls });

  // No secret and no URLs is the local-development case, and it is correct
  // there: on a LAN host candidates are directly reachable. It is wrong
  // anywhere else, which is what the deployment notes are for — this function
  // has no way to tell the two apart and must not guess.
  if (options.turnUrls.length === 0 || !options.turnSecret) {
    return { iceServers: servers, turnExpiresAt: null };
  }

  const { username, credential, expiresAt } = mintTurnCredentials({
    secret: options.turnSecret,
    ttlSeconds: options.ttlSeconds,
    now: options.now,
  });

  servers.push({ urls: options.turnUrls, username, credential });
  return { iceServers: servers, turnExpiresAt: expiresAt };
}
