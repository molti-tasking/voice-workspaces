/**
 * IndexedDB durable queue for audio chunks.
 *
 * A commute goes through tunnels, cuttings and villages with no signal. Chunks
 * are written here FIRST and only deleted once the server has acknowledged
 * them, so a dead zone that outlasts a retry costs nothing. Without this,
 * losing signal loses the recording.
 *
 * Also holds open-session metadata so a crashed or backgrounded tab can offer
 * to resume rather than stranding a half-recorded drive.
 */

const DB_NAME = "voicemural";
const DB_VERSION = 1;
const CHUNK_STORE = "pendingChunks";
const SESSION_STORE = "openSessions";

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

  dbPromise = new Promise((resolve, reject) => {
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
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
  });

  return dbPromise;
}

function tx<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
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
  const db = await openDb();
  return new Promise((resolve, reject) => {
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
  });
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
