/**
 * IndexedDB durable queue for audio chunks.
 *
 * A commute goes through tunnels, cuttings and villages with no signal. Chunks
 * are written here FIRST and only deleted once the server has acknowledged
 * them, so a dead zone that outlasts a retry costs nothing. Without this,
 * losing signal loses the recording.
 *
 * Also holds open-session metadata so a crashed or backgrounded tab can offer
 * to resume rather than stranding a half-recorded drive, and the session
 * registration payload so a drive that STARTED offline can be registered when
 * signal returns — see the REGISTRATION_STORE below.
 */

import { capture } from "@/lib/analytics/client";

const DB_NAME = "voicemural";
const DB_VERSION = 2;
const CHUNK_STORE = "pendingChunks";
const SESSION_STORE = "openSessions";
const REGISTRATION_STORE = "sessionRegistrations";

export interface PendingChunk {
  /** Auto-increment local key; unrelated to the server's chunk id. */
  localId?: number;
  captureSessionId: string;
  seq: number;
  startOffsetMs: number;
  durationMs: number;
  mimeType: string;
  blob: Blob;
  attempts: number;
  createdAt: number;
}

export interface OpenSessionMeta {
  captureSessionId: string;
  startedAt: number;
  nextSeq: number;
  /** Elapsed recorded milliseconds, so a resumed session keeps monotonic offsets. */
  elapsedMs: number;
  mimeType: string;
  serverAcked: boolean;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, {
          keyPath: "localId",
          autoIncrement: true,
        });
        store.createIndex("bySession", "captureSessionId", { unique: false });
        // Drain in capture order so the transcript fills in sensibly.
        store.createIndex("byCreatedAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "captureSessionId" });
      }
      if (!db.objectStoreNames.contains(REGISTRATION_STORE)) {
        db.createObjectStore(REGISTRATION_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => {
      const db = req.result;
      // Mobile Safari force-closes IndexedDB connections when it freezes or
      // backgrounds a tab — routine on a phone in a car. The cached handle then
      // throws InvalidStateError from every later transaction, killing the whole
      // durable queue until a reload. Drop the cache on close so the next call
      // re-opens instead of reusing a dead connection. The guard leaves a
      // fresher connection in place if one has already replaced this one.
      const forget = () => {
        if (dbPromise === opening) dbPromise = undefined;
      };
      db.onclose = forget;
      db.onabort = forget;
      db.onversionchange = () => {
        db.close();
        forget();
      };
      resolve(db);
    };
    req.onerror = () => {
      // A failed open must not linger as a permanently rejected cached promise.
      if (dbPromise === opening) dbPromise = undefined;
      reject(req.error ?? new Error("Failed to open IndexedDB"));
    };
  });

  dbPromise = opening;
  return dbPromise;
}

/** The error mobile Safari throws from `db.transaction()` on a force-closed connection. */
function isConnectionClosing(err: unknown): boolean {
  return err instanceof DOMException && err.name === "InvalidStateError";
}

/**
 * Run a transaction, re-opening once if the connection was force-closed.
 *
 * `db.transaction()` throws InvalidStateError synchronously on a dying
 * connection, and nothing else re-opens it, so without this retry one freeze
 * strands the queue for the rest of the page. The re-open is the recovery this
 * file exists to make possible, so it is reported as its own signal.
 */
async function runOnDb<T>(op: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await op(await openDb());
  } catch (err) {
    if (!isConnectionClosing(err)) throw err;
    dbPromise = undefined;
    const db = await openDb();
    capture("upload_queue_reopened", {});
    return op(db);
  }
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return runOnDb(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = run(transaction.objectStore(storeName));
        transaction.onerror = () =>
          reject(transaction.error ?? new Error("IndexedDB transaction failed"));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      }),
  );
}

export async function enqueueChunk(chunk: Omit<PendingChunk, "localId">): Promise<number> {
  return tx<IDBValidKey>(CHUNK_STORE, "readwrite", (s) => s.add(chunk)).then(Number);
}

/** Oldest-first pending chunks, so uploads follow capture order. */
export async function pendingChunks(limit = 20): Promise<PendingChunk[]> {
  return runOnDb(
    (db) =>
      new Promise<PendingChunk[]>((resolve, reject) => {
        const out: PendingChunk[] = [];
        const transaction = db.transaction(CHUNK_STORE, "readonly");
        const cursorReq = transaction
          .objectStore(CHUNK_STORE)
          .index("byCreatedAt")
          .openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor || out.length >= limit) return resolve(out);
          out.push(cursor.value as PendingChunk);
          cursor.continue();
        };
        cursorReq.onerror = () =>
          reject(cursorReq.error ?? new Error("Failed to read pending chunks"));
      }),
  );
}

export async function deleteChunk(localId: number): Promise<void> {
  await tx(CHUNK_STORE, "readwrite", (s) => s.delete(localId));
}

export async function markAttempt(chunk: PendingChunk): Promise<void> {
  if (chunk.localId === undefined) return;
  await tx(CHUNK_STORE, "readwrite", (s) =>
    s.put({ ...chunk, attempts: chunk.attempts + 1 }),
  );
}

export async function pendingCount(): Promise<number> {
  return tx<number>(CHUNK_STORE, "readonly", (s) => s.count());
}

export async function saveOpenSession(meta: OpenSessionMeta): Promise<void> {
  await tx(SESSION_STORE, "readwrite", (s) => s.put(meta));
}

export async function clearOpenSession(captureSessionId: string): Promise<void> {
  await tx(SESSION_STORE, "readwrite", (s) => s.delete(captureSessionId));
}

/** An unfinished session from a previous page load, if any. */
export async function findOpenSession(): Promise<OpenSessionMeta | null> {
  const all = await tx<OpenSessionMeta[]>(SESSION_STORE, "readonly", (s) => s.getAll());
  if (all.length === 0) return null;
  return all.sort((a, b) => b.startedAt - a.startedAt)[0] ?? null;
}

/**
 * The exact body of the `POST /api/capture-sessions` that registered a drive.
 *
 * A recording that starts in a dead zone never gets its session row created,
 * and the chunk route 404s on an unknown session — which the uploader would
 * otherwise read as a permanent rejection. Storing the payload here (before
 * the first POST attempt, so it survives both offline starts and page reloads)
 * lets the uploader re-register when the server finally says `session_not_found`.
 *
 * Kept until the registration is acknowledged, then deleted. A few hundred
 * bytes per drive; the cost of keeping it is nothing next to a drive lost whole.
 */
export interface StoredSessionRegistration {
  id: string;
  startedAt: string;
  setting?: string;
  voiceId?: string;
  sttLanguage?: string;
  deviceInfo: { userAgent?: string; mimeType?: string; platform?: string };
}

export async function saveRegistration(body: StoredSessionRegistration): Promise<void> {
  await tx(REGISTRATION_STORE, "readwrite", (s) => s.put(body));
}

export async function getRegistration(
  captureSessionId: string,
): Promise<StoredSessionRegistration | null> {
  const row = await tx<StoredSessionRegistration | undefined>(
    REGISTRATION_STORE,
    "readonly",
    (s) => s.get(captureSessionId),
  );
  return row ?? null;
}

/** Called once the server has acknowledged the session row exists. */
export async function deleteRegistration(captureSessionId: string): Promise<void> {
  await tx(REGISTRATION_STORE, "readwrite", (s) => s.delete(captureSessionId));
}
