// sw.js — basic offline cache for the app shell + data.
const CACHE = "hsk6-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/srs.js",
  "./js/audio.js",
  "./js/decks.js",
  "./data/hsk6-starter.json",
  "./manifest.webmanifest",
  "./icons/icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

// Cache-first for app assets; network fallback for everything else.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
