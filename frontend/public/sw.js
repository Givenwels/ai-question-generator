const CACHE_NAME = 'ai-cuoti-v1';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // 不做缓存，动态内容每次从网络请求
});
