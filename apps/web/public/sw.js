/**
 * The service worker. Deliberately small, and deliberately timid.
 *
 * Two jobs, and no others:
 *
 *   1. Make the app installable. Chrome will not offer "Add to home screen"
 *      without a worker that handles fetches, and an icon on the home screen is
 *      the difference between starting a recording before pulling away and
 *      hunting for a tab.
 *   2. Make a dead connection legible. A phone in a cradle loses signal
 *      constantly; the recorder already buffers chunks in IndexedDB and drains
 *      them on `online`, so an offline load should say "your recordings are
 *      safe" rather than showing the browser's dinosaur.
 *
 * What it explicitly does NOT do is cache HTML. Every page here is rendered per
 * request against a session cookie, so a cached document is somebody's private
 * transcript sitting in a shared cache waiting to be served to the wrong
 * person. Navigations always go to the network; the only fallback is a static
 * page that contains nothing.
 */

/**
 * This deploy's identifier, passed on the registration URL.
 *
 * It has to arrive from outside: this file is served verbatim from `public/`,
 * so nothing in it changes between deploys, and a browser only reinstalls a
 * worker whose script differs. A hardcoded version meant the cache below was
 * never rotated and `/offline` was precached exactly once, on a visitor's
 * first ever load — after the next deploy that document referenced script
 * chunks that no longer existed, and it stayed that way forever.
 *
 * Registering `/sw.js?v=<build>` changes the script URL each deploy, which
 * both triggers the reinstall and names the cache the `activate` handler
 * below then purges.
 */
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE_PREFIX = "voicemural-static-";
const CACHE = `${CACHE_PREFIX}${VERSION}`;

/**
 * How many builds' caches to keep: this one and the one before it.
 *
 * A deploy renames every fingerprinted chunk, so a tab still running the
 * previous build asks for chunks only that build's cache holds. Keeping that
 * cache lets those requests resolve instead of hitting the deleted files on the
 * server, which is a guaranteed `ChunkLoadError`. Two is enough — one deploy of
 * overlap — and the caches only hold what clients actually fetched, so the
 * extra copy is small.
 */
const CACHES_TO_KEEP = 2;

/** The offline fallback and the assets it needs to render without a network. */
const PRECACHE = ["/offline", "/icons/icon-192.png"];

/** Fingerprinted or effectively immutable — safe to serve from cache first. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.ico" ||
    url.pathname === "/icon.svg" ||
    url.pathname === "/apple-icon.png" ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      cache.addAll(
        // `reload` bypasses the HTTP cache: the offline page's markup
        // references this deploy's script chunks, and a copy from the previous
        // deploy would point at files that no longer exist.
        PRECACHE.map((path) => new Request(path, { cache: "reload" })),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        // `caches.keys()` returns names in creation order, so the newest —
        // including this build's, just opened on install — are last. Keep the
        // final `CACHES_TO_KEEP` and delete the rest. The previous purge
        // deleted every cache but the current one, which wiped the previous
        // build's chunks out from under tabs still running it.
        const ours = keys.filter((k) => k.startsWith(CACHE_PREFIX));
        const stale = ours.slice(0, Math.max(0, ours.length - CACHES_TO_KEEP));
        return Promise.all(stale.map((k) => caches.delete(k)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Chunk uploads, sign-in, sign-out: never our business. Leaving these
  // untouched means the worker cannot be the reason a recording fails to
  // upload, which is the one failure this app cannot recover from.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.match("/offline")) ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
      ),
    );
    return;
  }

  if (!isStaticAsset(url)) return;

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          // Opaque and error responses would poison the cache for the life of
          // the version; only a real 200 from us is worth keeping.
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
