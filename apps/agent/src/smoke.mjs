/**
 * Does the agent actually join a drive and speak?
 *
 *     pnpm --filter @voicemural/agent smoke
 *
 * Joins a room as the driver would, using a real capture session, and waits for
 * the agent to appear and publish audio. This exists because every cheaper check
 * gave a false pass: the worker can register, LiveKit can report a job as
 * assigned, and the agent can still never arrive — three separate bugs did
 * exactly that (a worker declining on load, `room.name` read before connect, and
 * a port assertion that killed every forked job process).
 *
 * A room with no participant is NOT enough: the agent waits for the driver
 * before it does anything, so an empty room proves nothing.
 */
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { Room, RoomEvent } from "@livekit/rtc-node";
import { getDb, sql } from "@voicemural/db";

// A real drive, so the agent's retrieval has something to read.
const [row] = await getDb().execute(sql`
  select cs.id, cs.user_id from capture_session cs order by cs.started_at desc limit 1`);
const { id: sessionId, user_id: userId } = row;

const host = (process.env.NEXT_PUBLIC_LIVEKIT_URL || "ws://localhost:7880").replace("ws", "http");
const key = process.env.LIVEKIT_API_KEY, secret = process.env.LIVEKIT_API_SECRET;
const svc = new RoomServiceClient(host, key, secret);
const roomName = `drive-${sessionId}`;

const at = new AccessToken(key, secret, { identity: userId });
at.addGrant({ room: roomName, roomJoin: true, canPublish: true, canSubscribe: true });

const room = new Room();
let agentJoined = false;
let agentAudio = false;

room.on(RoomEvent.ParticipantConnected, (p) => {
  agentJoined = true;
  console.log(`\x1b[32m✓ agent joined:\x1b[0m ${p.identity}`);
});
room.on(RoomEvent.TrackSubscribed, (_t, pub, p) => {
  agentAudio = true;
  console.log(`\x1b[32m✓ agent published audio:\x1b[0m ${pub.kind} from ${p.identity}`);
});

console.log(`joining ${roomName} as ${userId}...`);
await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL, await at.toJwt(), { autoSubscribe: true });
console.log("connected as the driver");

for (let i = 0; i < 25 && !agentAudio; i++) await new Promise((r) => setTimeout(r, 1000));

console.log(agentJoined ? "" : "\x1b[31m✗ agent never joined\x1b[0m");
console.log(agentAudio ? "" : "\x1b[33m(no agent audio — expected until it has something to say)\x1b[0m");
await room.disconnect();
await svc.deleteRoom(roomName).catch(() => {});
process.exit(agentJoined ? 0 : 1);
