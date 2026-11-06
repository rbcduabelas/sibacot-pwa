// RONDE 2: CACHE_NAME naik ke v11-v66 agar cache lama (v10-security,
// yang berisi config.js lama -> backend v65) dihapus saat activate.
const CACHE_NAME = 'sibacot-pwa-v11-v66';
const APP_SHELL = ['./','./index.html','./config.js','./manifest.webmanifest','./offline.html','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.map(key => key !== CACHE_NAME ? caches.delete(key) : null)))); self.clients.claim(); });
self.addEventListener('fetch', event => {
 const req = event.request; const url = new URL(req.url);
 if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) { event.respondWith(fetch(req)); return; }
 if (req.mode === 'navigate') { event.respondWith(fetch(req).catch(() => caches.match('./offline.html'))); return; }
 // RONDE 2: config.js SELALU network-first — config lama dari cache
 // adalah akar gagal daftar sidik jari 7 Nov 2026 (frontend baru
 // memanggil backend v65 -> "Aksi tidak dikenali server."). Bila
 // offline, pakai cache (abaikan query ?v=66 saat mencocokkan).
 if (url.pathname.endsWith('/config.js')) {
   event.respondWith(fetch(req).then(response => { const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(req, copy)); return response; }).catch(() => caches.match(req, { ignoreSearch: true })));
   return;
 }
 event.respondWith(caches.match(req).then(cached => cached || fetch(req).then(response => { const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(req, copy)); return response; }).catch(() => cached)));
});
