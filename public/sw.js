const CACHE_NAME = "istb-iptv-player-cache-v2";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192-v2.png",
  "./icon-512-v2.png",
  "./icon-maskable-512-v2.png",
  "./apple-touch-icon-v2.png"
];

// Install Event: pre-cache critical assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("[Service Worker] Pre-caching offline assets");
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: clear old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("[Service Worker] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: network-first or cache-fallback for static assets, network-only for media/APIs
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Exclude video streams, segment chunks, and dynamic IPTV API endpoints from caching
  const isVideoOrApi =
    url.pathname.endsWith(".ts") ||
    url.pathname.endsWith(".m3u8") ||
    url.pathname.includes("/api/") ||
    url.pathname.includes("/ch/") ||
    event.request.method !== "GET";

  if (isVideoOrApi) {
    // Network-only for live feeds, VOD streams, and session APIs
    return;
  }

  // For static assets, try network first, then fall back to cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If valid response, clone and cache it
        if (response && response.status === 200 && response.type === "basic") {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network is down
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If HTML is requested and we are offline, return pre-cached root
          if (event.request.headers.get("accept")?.includes("text/html")) {
            return caches.match("./");
          }
        });
      })
  );
});
