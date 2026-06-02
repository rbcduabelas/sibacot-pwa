const CACHE_NAME = 'sibacot-pwa-v1';
const APP_SHELL = ['./','./index.html','./config.js','./manifest.webmanifest','./offline.html','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) { event.respondWith(fetch(req)); return; }
  if (req.mode === 'navigate') { event.respondWith(fetch(req).catch(() => caches.match('./offline.html'))); return; }
  event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => { const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(req, copy)); return response; }).catch(() => cached)));
});
