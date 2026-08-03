// 改版時記得把版號往上加，舊快取會在 activate 階段被清掉
const CACHE_NAME = 'zip-reader-cache-v2';

// 本地檔案：一定要成功，缺一個就代表這次安裝有問題
const LOCAL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 外部套件：cdn.tailwindcss.com 沒有 CORS 標頭，cache.add() 會直接失敗，
// 所以改用 no-cors 拿 opaque response 再自己 put 進快取（<script src> 讀得到）。
// 另外抓失敗也不該讓整個 Service Worker 裝不起來，所以個別 catch。
const VENDOR_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

async function cacheVendor(cache, url) {
  try {
    const response = await fetch(url, { mode: 'no-cors', cache: 'reload' });
    // opaque response 的 status 是 0，不能用 response.ok 判斷
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(url, response);
    }
  } catch (err) { }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    await Promise.all(VENDOR_ASSETS.map(url => cacheVendor(cache, url)));
    // 不必等使用者關掉所有分頁，新版本立刻接手
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// 網頁本體走「網路優先」：這樣改完程式碼重新整理就會拿到新版，沒網路時才退回快取
async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request) || await cache.match('./index.html');
    if (cached) return cached;
    throw err;
  }
}

// 圖示、第三方套件這類不太會變的資源走「快取優先」，省流量也快
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque') && request.url.startsWith('http')) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isAppShell = request.mode === 'navigate' ||
    (url.origin === self.location.origin &&
      (url.pathname.endsWith('/') || url.pathname.endsWith('.html') || url.pathname.endsWith('.json')));

  event.respondWith(isAppShell ? networkFirst(request) : cacheFirst(request));
});
