// DuxPrep service worker: pre-caches the app shell so the app opens with no
// network (emergency use). Strategy: network-first with a short timeout, then
// cache — fresh when online, instant when offline or on a degraded network.
// __BUILD__ is stamped with the commit SHA at deploy; a new build creates a
// new cache and old ones are purged on activate.

const CACHE = "duxprep-__BUILD__";

const SHELL = [
  "./",
  "index.html",
  "css/style.css",
  "js/airtable.js",
  "js/app.js",
  "js/beep.js",
  "js/config.js",
  "js/lookup.js",
  "js/offline.js",
  "js/photo.js",
  "js/scanner.js",
  "vendor/html5-qrcode.min.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NETWORK_TIMEOUT_MS = 3000;

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only handle same-origin GETs; Airtable / product-lookup API calls pass
  // straight through (the app layer does its own data caching).
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetchWithTimeout(e.request);
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    } catch {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      if (cached) return cached;
      if (e.request.mode === "navigate") {
        const shell = await cache.match("./");
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
