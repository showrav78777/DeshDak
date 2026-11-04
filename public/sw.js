const STATIC_CACHE = "crossly-static-v1";
const ICONS = ["/icons/crossly-192.png", "/icons/crossly-512.png", "/icons/crossly-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(ICONS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("crossly-static-") && key !== STATIC_CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith("/icons/")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
