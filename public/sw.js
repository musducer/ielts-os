// IELTS OS service worker — app-shell offline + runtime caching
const CACHE = "ielts-os-v3";
const APP_SHELL = ["/", "/index.html", "/favicon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  // MEDIA/RANGE: audio-video stream bằng Range request — SW cache-first trả sai đoạn
  // làm audio ĐỨT sau vài giây. Tuyệt đối không đụng vào, để trình duyệt tự xử lý.
  if (req.headers.get("range") || req.destination === "audio" || req.destination === "video" || /^audio\//i.test(req.headers.get("accept") || "")) return;
  const url = new URL(req.url);
  // File audio/video theo đuôi (kể cả không có destination) -> bỏ qua luôn
  if (/\.(mp3|m4a|aac|ogg|wav|mp4|webm)(\?|$)/i.test(url.pathname)) return;

  // Không cache API & realtime (Firebase, backend) — luôn lấy mạng
  if (url.pathname.startsWith("/api/") || url.hostname.includes("firebase") || url.hostname.includes("googleapis") || url.hostname.includes("firestore")) {
    return; // để trình duyệt xử lý bình thường
  }

  // Điều hướng trang -> network-first, fallback app shell (vào được app khi offline)
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put("/index.html", copy));
        return res;
      }).catch(() => caches.match("/index.html"))
    );
    return;
  }

  // Tài nguyên tĩnh (JS/CSS/ảnh/font) -> cache-first, cập nhật nền
  e.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && (res.type === "basic" || res.type === "cors")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
