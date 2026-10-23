// Minimal service worker (app-store prep, prompt A, 2026-10-23).
// Its ONLY job: when a page navigation fails because there is no network,
// show the branded offline page. It caches nothing else: no app pages
// (signed-in content must never be served from a cache), no API responses,
// no assets. Every request goes to the network as normal. No push here.
const CACHE = "catoco-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return; // everything else: browser default
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
  );
});
