// Service Worker for iSTB IPTV Player Pro PWA
const CACHE_NAME = 'istb-iptv-v3';
const STATIC_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/manifest.json',
  '/icon-192-v3.png',
  '/icon-512-v3.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch(() => {
        // Ignore static cache failures in dev/proxy
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith('istb-iptv-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass stream, EPG API, XML, and GZ requests straight to network
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/api/') || 
    url.pathname.includes('/play/') || 
    url.pathname.endsWith('.ts') || 
    url.pathname.endsWith('.m3u8') ||
    url.pathname.endsWith('.xml') ||
    url.pathname.endsWith('.gz')
  ) {
    return;
  }

  // Network first with fallback to cache for shell
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
