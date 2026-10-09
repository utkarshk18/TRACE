const CACHE = "trace-static-v2";
const ASSETS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache API requests or non-GET requests
  if (
    request.method !== "GET" ||
    url.port === "8000" ||
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/tests") ||
    url.pathname.startsWith("/evidence") ||
    url.pathname.startsWith("/verify") ||
    url.pathname.startsWith("/audit") ||
    url.pathname.startsWith("/profiles") ||
    url.pathname.startsWith("/system") ||
    url.pathname.startsWith("/users")
  ) {
    return;
  }

  // Navigation requests: Network-first, fallback to /index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match("/index.html")) || (await caches.match("/"));
        })
    );
    return;
  }

  // Static assets: Cache-first with background network update
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const copy = networkRes.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return networkRes;
        })
        .catch(() => cached);

      return cached || fetchPromise;
    })
  );
});
