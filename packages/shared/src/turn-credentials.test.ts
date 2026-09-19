import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_TTL_SECONDS,
  buildIceServers,
  mintTurnCredentials,
  parseIceUrls,
} from "./turn-credentials";

/**
 * The credential has to be byte-identical to what coturn computes, and to what
 * apps/pipecat/bot.py computes for the bot's own half of the same call. A
 * mismatch does not fail loudly anywhere — coturn answers 401 to the allocation,
 * the browser silently gathers no relay candidate, and the symptom is the exact
 * silent timeout TURN was added to fix. So the wire format is pinned here.
 */

const SECRET = "test-turn-secret";
const NOW = 1_700_000_000_000;

describe("mintTurnCredentials", () => {
  it("uses coturn's expiry-stamped username and base64 HMAC-SHA1 password", () => {
    const { username, credential, expiresAt } = mintTurnCredentials({
      secret: SECRET,
      ttlSeconds: 600,
      now: NOW,
    });

    expect(expiresAt).toBe(NOW / 1000 + 600);
    expect(username.startsWith(`${expiresAt}:`)).toBe(true);
    expect(credential).toBe(
      createHmac("sha1", SECRET).update(username).digest("base64"),
    );
  });

  it("defaults to a TTL that outlives any drive", () => {
    const { expiresAt } = mintTurnCredentials({ secret: SECRET, now: NOW });
    expect(expiresAt).toBe(NOW / 1000 + DEFAULT_TURN_TTL_SECONDS);
  });

  it("never reuses a label, so two drives never share a credential", () => {
    const a = mintTurnCredentials({ secret: SECRET, now: NOW });
    const b = mintTurnCredentials({ secret: SECRET, now: NOW });
    expect(a.username).not.toBe(b.username);
  });

  it("keeps the participant out of the username", () => {
    // The username is written to coturn's log for every allocation and travels
    // in the SDP. Only the expiry is meaningful to coturn; the rest is noise on
    // purpose.
    const { username } = mintTurnCredentials({ secret: SECRET, now: NOW });
    expect(username.split(":")[1]).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("parseIceUrls", () => {
  it("splits, trims and drops empties", () => {
    expect(parseIceUrls(" stun:a:3478 , turn:b:3478 ,, ")).toEqual([
      "stun:a:3478",
      "turn:b:3478",
    ]);
  });

  it("treats unset and empty alike", () => {
    // docker-compose renders an unset variable as an EMPTY STRING rather than
    // dropping it, so both have to mean "none configured".
    expect(parseIceUrls(undefined)).toEqual([]);
    expect(parseIceUrls("")).toEqual([]);
  });
});

describe("buildIceServers", () => {
  const stunUrls = ["stun:stun.example.org:3478"];
  const turnUrls = ["turn:turn.example.org:3478"];

  it("offers STUN alongside TURN rather than instead of it", () => {
    // A direct path costs no relay bandwidth. Offering only TURN would relay
    // every drive, including the ones that never needed a relay.
    const { iceServers, turnExpiresAt } = buildIceServers({
      stunUrls,
      turnUrls,
      turnSecret: SECRET,
      now: NOW,
    });

    expect(iceServers).toHaveLength(2);
    expect(iceServers[0]).toEqual({ urls: stunUrls });
    expect(iceServers[1]?.urls).toEqual(turnUrls);
    expect(iceServers[1]?.username).toBeTruthy();
    expect(iceServers[1]?.credential).toBeTruthy();
    expect(turnExpiresAt).toBe(NOW / 1000 + DEFAULT_TURN_TTL_SECONDS);
  });

  it("omits TURN when no secret is configured", () => {
    const { iceServers, turnExpiresAt } = buildIceServers({
      stunUrls,
      turnUrls,
      turnSecret: null,
      now: NOW,
    });

    expect(iceServers).toEqual([{ urls: stunUrls }]);
    expect(turnExpiresAt).toBeNull();
  });

  it("omits TURN when a secret is set but no URLs are", () => {
    // Half-configured is the likelier deployment mistake of the two, and an
    // unauthenticated TURN entry would gather nothing while looking configured.
    const { iceServers } = buildIceServers({
      stunUrls,
      turnUrls: [],
      turnSecret: SECRET,
      now: NOW,
    });

    expect(iceServers).toEqual([{ urls: stunUrls }]);
  });

  it("returns an empty list when nothing is configured, which is right on a LAN", () => {
    const { iceServers } = buildIceServers({
      stunUrls: [],
      turnUrls: [],
      turnSecret: null,
      now: NOW,
    });

    expect(iceServers).toEqual([]);
  });
});
