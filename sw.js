// Offline-Fähigkeit: Die App-Dateien (nicht deine Einträge!) werden zwischengespeichert,
// damit die App auch ohne Internet startet. Anfragen an api.anthropic.com werden nie zwischengespeichert.
// Bei jeder Änderung an der App VERSION erhöhen, damit Handys die neue Fassung laden.

const VERSION = 'v1.0.0';
const CACHE = `notizbuch-${VERSION}`;
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './js/main.js',
  './js/core/backup.js',
  './js/core/constants.js',
  './js/core/crypto.js',
  './js/core/dates.js',
  './js/core/db.js',
  './js/core/dom.js',
  './js/core/prefs.js',
  './js/core/router.js',
  './js/core/session.js',
  './js/core/store.js',
  './js/core/text.js',
  './js/ai/api.js',
  './js/ai/context.js',
  './js/ai/prompts.js',
  './js/ai/schemas.js',
  './js/ai/tasks.js',
  './js/ui/analysis.js',
  './js/ui/components.js',
  './js/ui/composer.js',
  './js/ui/patterns.js',
  './js/views/entry.js',
  './js/views/insights.js',
  './js/views/journal.js',
  './js/views/lock.js',
  './js/views/person.js',
  './js/views/search.js',
  './js/views/settings.js',
  './js/views/today.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('notizbuch-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // z. B. api.anthropic.com – nie anfassen

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return new Response('Offline', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
