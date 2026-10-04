// オフライン対応用 Service Worker
// 方式: ネットワーク優先（通信できるときは常に最新版を取得してキャッシュを更新し、
//       オフラインや通信が遅いときはキャッシュを使う）
// ※ キャッシュはアプリのファイルだけ。学習履歴（localStorage）には一切触れない。
const CACHE = 'git-study-v3';
const NETWORK_TIMEOUT_MS = 4000;
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/storage.js',
  'js/md.js',
  'data/exams.json',
  'data/questions/gh900.json',
  'data/questions/gh300.json',
  'content/exam-info.md',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(networkFirst(e.request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
  } catch (e) { /* オフライン */ }
  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || network;
}
