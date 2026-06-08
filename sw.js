const CACHE_NAME = 'zip-reader-cache-v1';
const urlsToCache = [
  './index.html',
  './manifest.json',
  // 把我們用到的外部套件也快取起來
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// 安裝時，把上述檔案全部抓到裝置裡
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

// 當網頁沒有網路時，攔截請求並提供快取的檔案
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果快取裡有，就直接給快取的檔案；沒有的話才去網路上抓
        return response || fetch(event.request);
      })
  );
});
