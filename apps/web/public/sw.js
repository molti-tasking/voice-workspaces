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

const VERSION = "v1";
const CACHE = `voicemural-static-${VERSION}`;

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
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
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
