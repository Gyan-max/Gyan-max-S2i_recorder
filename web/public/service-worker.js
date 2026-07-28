/**
 * Offline app shell for the Hinglish S2I recorder.
 *
 * Scope is deliberately narrow: this caches only the static shell (HTML and
 * Vite's hashed JS/CSS assets) so a volunteer with no signal can still open the
 * app and reach their locally stored recordings.
 *
 * It never touches /api/. Task issue, upload, confirm and discard are all
 * server-authoritative, and serving any of them from a cache would show stale
 * tasks or fake a successful upload. Recording durability is IndexedDB's job,
 * not this file's.
 */

const CACHE = 's2i-shell-v1';
const SHELL = '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SHELL))
      // A failed precache must not block activation - the fetch handler below
      // fills the cache on first successful navigation anyway.
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only same-origin assets. Cross-origin (fonts, CDNs) keeps default behavior.
  if (url.origin !== self.location.origin) return;

  // Never serve API traffic from cache - see the note at the top of this file.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network-first so a new deploy is picked up immediately, with
  // the cached shell as the offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(SHELL, copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match(SHELL).then((cached) => cached || Response.error()))
    );
    return;
  }

  // Static assets: serve from cache when present, otherwise fetch and store.
  // Vite fingerprints these filenames, so a cached entry is never stale.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      });
    })
  );
});
