/* FORMA — Service Worker.
   Кэширует приложение для офлайна, показывает web-push уведомления,
   открывает нужный маршрут по клику. */

const CACHE = "forma-v3";
const TILE_CACHE = "forma-tiles-v1";
// Тайлы карт весим отдельно и режем объём, иначе кэш съест квоту.
const TILE_HOSTS = ["basemaps.cartocdn.com", "a.basemaps.cartocdn.com", "b.basemaps.cartocdn.com", "c.basemaps.cartocdn.com"];
const TILE_LIMIT = 320;

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/css/styles.css",
  "./assets/css/components.css",
  "./assets/css/mobile.css",
  "./assets/css/classic.css",
  "./assets/vendor/leaflet/leaflet.css",
  "./assets/vendor/leaflet/leaflet.js",
  "./assets/js/api.js",
    "./assets/js/data.js",
    "./assets/js/store.js",
    "./assets/js/gps.js",
  "./assets/js/ai.js",
  "./assets/js/push.js",
  "./assets/js/social.js",
  "./assets/js/core.js",
  "./assets/js/mobile.js",
  "./assets/js/views.js",
  "./assets/js/views_gps.js",
  "./assets/js/views_social.js",
  "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable.png"
  ];

// Ограничиваем кэш тайлов: удаляем самые старые записи.
async function trimTileCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= TILE_LIMIT) return;
  for (const k of keys.slice(0, keys.length - TILE_LIMIT)) {
    await cache.delete(k);
  }
}

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => null)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== TILE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Путь внутри сборки без ведущего "./" — для списка ASSETS.
  const rel = url.pathname.replace(/^.*\/(assets\/|icons\/|index\.html|manifest\.webmanifest)/, "$1");

  // Тайлы карт: cache-first с отдельным кэшем, чтобы карта работала офлайн.
  if (TILE_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          // Храним только успешные ответы: иначе кэш забивается заглушками.
          if (res && res.ok && (res.type === "basic" || res.type === "cors" || res.type === "opaque")) {
            await cache.put(req, res.clone());
            trimTileCache(cache);
          }
          return res;
        } catch (err) {
          // Офлайн и тайла нет — отдаём прозрачную заглушку, карта не ломается.
          return new Response(
            "",
            { status: 504, statusText: "offline tile", headers: { "Content-Type": "image/png" } }
          );
        }
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => caches.match("./index.html")));
    return;
  }

    // Свои файлы — сначала сеть, кэш только как запасной путь при офлайне.
    // Стратегия cache-first здесь ломала обновления: правка social.js или
    // classic.css доходила только у тех, кто закрыл вкладку раньше предыдущей
    // загрузки — остальные вечно видели старую версию из кэша.
    if (ASSETS.indexOf(rel) !== -1) {
      e.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
            }
            return res;
          })
          .catch(() => caches.match(req))
      );
      return;
    }

    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => null);
            return res;
          }).catch(() => hit)
      )
    );
  });

self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { body: e.data ? e.data.text() : "" };
  }
  const title = data.title || "FORMA";
  e.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: data.icon || "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.tag || "forma",
      data: { url: data.url || "./" },
      vibrate: [80, 40, 80]
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(target);
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
