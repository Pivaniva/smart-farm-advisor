// Bump this on every deploy that changes precached assets — it both names
// the cache and is what makes activate() drop the previous version below.
const CACHE_NAME = "smartfarm-static-v1";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./smart-farm.js",
  "./smart-farm.css",
  "./app-config.js",
  "./manifest.json",
  "./favicon.svg",
  "./apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isApiCall = url.hostname.endsWith("supabase.co");

  // Network-only for the Supabase backend and any other cross-origin call
  // (weather APIs, Google Fonts, CDN scripts) — never cache API responses.
  if (!isSameOrigin || isApiCall) return;

  // Cache-first for same-origin static assets.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow("./");
    })
  );
});
