const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = 'conexao-pages:' + SCOPE.pathname + ':';
const CACHE = CACHE_PREFIX + '__BUILD_ID__';
const PATHS = [
  'offline.html', 'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/css/fundos-paginas.css', 'assets/css/ui-feedback.css', 'assets/css/brand-name.css',
  'assets/js/brand-name.js', 'assets/js/ui-feedback.js', 'assets/images/brand/fundo-offline-v2.webp',
].map(path => new URL(path, SCOPE).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PATHS))));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim(),
])));
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  // Build fingerprints are part of script/style filenames. An older worker
  // must never return a previous script for a new document.
  url.search = '';
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match(new URL('offline.html', SCOPE).href)));
  else if (PATHS.includes(url.href)) event.respondWith(caches.open(CACHE).then(cache => cache.match(url.href)).then(saved => saved || fetch(event.request)));
});
