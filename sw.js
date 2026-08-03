// 改版時記得把版號往上加，舊快取會在 activate 階段被清掉
const CACHE_NAME = 'zip-reader-cache-v3';

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

// 執行階段快取的大小上限。沒有這道關卡的話，任何同源大檔被請求時都會被
// clone 一份、整份緩衝在記憶體裡等著寫進快取，白白吃掉記憶體與儲存空間。
const RUNTIME_CACHE_LIMIT = 5 * 1024 * 1024;

function cacheResponse(request, response) {
  if (!response) return;
  // opaque response 讀不到 header，但那只會是我們自己列的 CDN 套件，放行
  const isOpaque = response.type === 'opaque';
  if (!isOpaque && !response.ok) return;
  if (!isOpaque) {
    const length = Number(response.headers.get('content-length'));
    // 長度不明就不快取：等 clone 完才發現太大就來不及了
    if (!Number.isFinite(length) || length > RUNTIME_CACHE_LIMIT) return;
  }
  const copy = response.clone();
  caches.open(CACHE_NAME)
    .then(cache => cache.put(request, copy))
    .catch(() => { }); // 配額不足之類的狀況不該影響頁面正常運作
}

// 網頁本體走「網路優先」：這樣改完程式碼重新整理就會拿到新版，沒網路時才退回快取
async function networkFirst(request) {
  try {
    // 一定要用 no-cache 強制回源驗證。直接 fetch(request) 會先吃瀏覽器自己的
    // HTTP 快取（GitHub Pages 送的是 max-age=600），拿回一份舊的 index.html，
    // 那「網路優先」就完全失去意義了。這裡用 URL 重建請求，避開 navigate 模式
    // 的 Request 不能直接複製的限制。
    const response = await fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' });
    cacheResponse(request, response);
    return response;
  } catch (err) {
    const cache = await caches.open(CACHE_NAME);
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
  if (request.url.startsWith('http')) cacheResponse(request, response);
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
