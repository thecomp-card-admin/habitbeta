/* sw.js — offline cache for the Habit & Task Tracker.
 * Bump the version in CACHE_VERSION on every release (keep it in step with APP_VERSION in index.html).
 * index.html, game.js and config.js are network-first so updates show up on the next launch with connectivity
 * (config.js skips the HTTP cache, so turning sync on takes effect right away); everything else is cache-first.
 * Requests to other origins (Supabase, the Anthropic API) are never touched.
 * CACHE_PREFIX keeps this app's caches apart from the beta's ('habits-beta-v'): both live on the same
 * github.io origin, so each worker only ever deletes its own old caches.
 */
const CACHE_PREFIX = 'habits-beta-v';
const CACHE_VERSION = CACHE_PREFIX + '1.3.0';
const PRECACHE = ['./', './index.html', './game.js', './config.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-512-maskable.png'];
const NETWORK_FIRST = new Set(['./', './index.html', './game.js', './config.js']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function relativePath(url) {
  const base = new URL('./', self.location.href).pathname;
  const path = new URL(url).pathname;
  if (!path.startsWith(base)) return null;
  const rest = path.slice(base.length);
  return rest === '' ? './' : './' + rest;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API calls and other origins go straight to the network
  const rel = relativePath(req.url);
  if (rel === null) return;
  const isNav = req.mode === 'navigate';
  const networkFirst = isNav || NETWORK_FIRST.has(rel);
  const cacheKey = isNav ? './index.html' : rel;

  if (networkFirst) {
    event.respondWith(
      (rel === './config.js' ? fetch(req, { cache: 'no-cache' }) : fetch(req)).then(resp => {
        if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE_VERSION).then(c => c.put(cacheKey, copy)); }
        return resp;
      }).catch(() => caches.match(cacheKey).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  event.respondWith(
    caches.match(cacheKey).then(hit => hit || fetch(req).then(resp => {
      if (resp && resp.ok) { const copy = resp.clone(); caches.open(CACHE_VERSION).then(c => c.put(cacheKey, copy)); }
      return resp;
    }))
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
