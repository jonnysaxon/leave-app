const CACHE_NAME = "leave-tracker-v0.1.3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/styles.css",
  "./assets/app.js",
  "./assets/storage.js",
  "./assets/accrual.js",
  "./assets/github.js",
  "./assets/excel.js",
  "./assets/vendor/xlsx.full.min.js",
  "./assets/icons/icon-192.svg",
  "./assets/icons/icon-512.svg",
  "./assets/icons/apple-touch-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/version.txt") || url.hostname === "api.github.com") return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CHECK_VERSION") {
    event.waitUntil(checkVersion(event.source, event.data.currentVersion));
  }
});

async function checkVersion(client, currentVersion) {
  try {
    const response = await fetch("./version.txt", { cache: "no-store" });
    const version = (await response.text()).trim();
    if (version && version !== currentVersion) {
      client.postMessage({ type: "VERSION_AVAILABLE", version });
    }
  } catch {
    client.postMessage({ type: "VERSION_CHECK_FAILED" });
  }
}
