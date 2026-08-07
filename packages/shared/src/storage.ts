import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

/**
 * Audio storage.
 *
 * Node-only — do not import from browser code (use the package root instead).
 *
 * At roughly an hour of Opus per day this is ~15 MB/day, so a filesystem
 * directory on a persistent volume is the right call and object storage would
 * be unjustified overhead. The interface exists so swapping in S3/MinIO later
 * touches exactly one file.
 */
export interface AudioStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Deterministic key for a chunk, sharded by session so directories stay small. */
export function chunkKey(
  captureSessionId: string,
  seq: number,
  extension: string,
): string {
  const padded = String(seq).padStart(6, "0");
  return `sessions/${captureSessionId}/${padded}.${extension}`;
}

export function fingerprint(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export class FilesystemAudioStorage implements AudioStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  /**
   * Resolve a key beneath the storage root, refusing anything that escapes it.
   * Keys are server-generated today, but this is the boundary where a
   * client-supplied key would become path traversal.
   */
  private resolveKey(key: string): string {
    const target = resolve(join(this.root, key));
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return target;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    // Write to a temp file then rename, so a crash mid-write cannot leave a
    // truncated chunk that would transcribe into plausible-but-wrong text.
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    const { rename } = await import("node:fs/promises");
    await rename(tmp, target);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}

let cached: AudioStorage | undefined;

/**
 * Process-wide storage instance, configured by STORAGE_DIR.
 *
 * STORAGE_DIR must be ABSOLUTE. Web runs with cwd `apps/web`, the worker with
 * `apps/worker`, and the seed scripts with `packages/db` — so a relative path
 * silently resolves to three different directories, scattering a session's
 * audio across them. The web app would write a chunk the worker could not find,
 * and nothing would report an error. Failing loudly here is much cheaper than
 * discovering a fragmented corpus weeks into a deployment.
 */
export function getStorage(): AudioStorage {
  if (cached) return cached;

  const dir = process.env.STORAGE_DIR;
  if (!dir) {
    throw new Error("STORAGE_DIR is not set. See .env.example.");
  }
  if (!isAbsolute(dir)) {
    throw new Error(
      `STORAGE_DIR must be an absolute path, got "${dir}". ` +
        "Each app runs from its own working directory, so a relative path would " +
        "scatter audio across several folders.",
    );
  }

  cached = new FilesystemAudioStorage(dir);
  return cached;
}
