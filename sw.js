/*=================================================================
  Mr. Osama - Service Worker
  - Caches all app shell files on install
  - Caches Supabase vocabulary (cache-first: vocab never changes)
  - Network-first for codes/progress (with offline fallback)
  - Queues offline progress updates and syncs when online
=================================================================*/

const CACHE_NAME   = 'mrosama-v3';
const SUPABASE_URL = 'https://gmqjlpqsbhrlqxcnkiet.supabase.co';

// App shell — all local files (supabase.min.js is now bundled locally)
const SHELL_FILES = [
  './',
  './index.html',
  './student.html',
  './teacher.html',
  './student.js',
  './teacher.js',
  './style.css',
  './manifest.json',
  './sw.js',
  './supabase.min.js',
];

// External resources to cache (only fonts now)
const EXTERNAL_FILES = [
  'https://fonts.googleapis.com/css2?family=Changa:wght@400;700&family=Fredoka+One&display=swap',
];

// ---- INSTALL: cache shell immediately ----
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache shell files
      await cache.addAll(SHELL_FILES).catch(() => {});
      // Cache external files individually (don't fail if one is missing)
      for (const url of EXTERNAL_FILES) {
        try { await cache.add(url); } catch(e) {}
      }
    })
  );
});

// ---- ACTIVATE: remove old caches ----
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ---- FETCH: routing strategy ----
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET requests for caching
  if (req.method !== 'GET') return;

  // Skip non-http
  if (!url.protocol.startsWith('http')) return;

  // ---- STRATEGY 1: Supabase vocabulary → Cache First (vocab is static) ----
  if (url.origin === SUPABASE_URL && url.pathname.includes('/vocabulary')) {
    event.respondWith(cacheFirstWithUpdate(req));
    return;
  }

  // ---- STRATEGY 2: Supabase other (progress, codes) → Network First ----
  if (url.origin === SUPABASE_URL) {
    event.respondWith(networkFirstWithCache(req));
    return;
  }

  // ---- STRATEGY 3: Google Fonts → Cache First ----
  if (url.origin.includes('googleapis.com') || url.origin.includes('gstatic.com')) {
    event.respondWith(cacheFirstWithUpdate(req));
    return;
  }

  // ---- STRATEGY 4: App shell + CDN → Cache First ----
  event.respondWith(cacheFirstWithUpdate(req));
});

// Cache-first, update in background
async function cacheFirstWithUpdate(req) {
  const cache    = await caches.open(CACHE_NAME);
  const cached   = await cache.match(req);
  const fetchPromise = fetch(req).then(resp => {
    if (resp && resp.status === 200 && resp.type !== 'opaque') {
      cache.put(req, resp.clone());
    }
    return resp;
  }).catch(() => null);
  return cached || await fetchPromise;
}

// Network-first, fall back to cache
async function networkFirstWithCache(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const resp = await fetch(req);
    if (resp && resp.status === 200) cache.put(req, resp.clone());
    return resp;
  } catch(e) {
    const cached = await cache.match(req);
    return cached || new Response(JSON.stringify({ data: [], error: { message: 'offline' } }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ---- BACKGROUND SYNC ----
self.addEventListener('sync', event => {
  if (event.tag === 'mr-sync-progress') {
    event.waitUntil(syncQueuedProgress());
  }
});

async function syncQueuedProgress() {
  // Notify all clients to trigger sync
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_NOW' }));
}

// ---- PUSH (future use) ----
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
