// Bump this on every deploy that changes precached assets — it both names
// the cache and is what makes activate() drop the previous version below.
const CACHE_NAME = "smartfarm-static-v2";

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

function isAppShellRequest(request, url) {
  // Top-level page loads (index.html, "./") and any JS file — these change
  // on every deploy, so serving a stale cached copy would hide updates.
  return request.mode === "navigate" || url.pathname.endsWith(".js");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isApiCall = url.hostname.endsWith("supabase.co");

  // Network-only for the Supabase backend and any other cross-origin call
  // (weather APIs, Google Fonts, CDN scripts) — never cache API responses.
  if (!isSameOrigin || isApiCall) return;

  if (isAppShellRequest(request, url)) {
    // Network-first: always fetch the latest HTML/JS; only fall back to
    // the cache when the network is unavailable (offline). "no-cache" forces
    // revalidation with the server so the browser's own HTTP cache can't
    // mask an update the same way the old cache-first strategy did.
    event.respondWith(
      fetch(request, { cache: "no-cache" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for same-origin static assets (icons, fonts, CSS, manifest).
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
