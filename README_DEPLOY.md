# SIBACOT GitHub Pages + PWA + Google Apps Script

Paket ini membuat aplikasi bisa dibuka dari dua alamat:

1. Alamat Google Apps Script Web App, memakai `google.script.run`.
2. Alamat GitHub Pages, sebagai frontend/PWA yang memanggil GAS melalui `fetch()`.

## Struktur

```text
sibacot-github-pwa/
├─ gas/Code.gs
└─ docs/
   ├─ index.html
   ├─ config.js
   ├─ manifest.webmanifest
   ├─ sw.js
   ├─ offline.html
   └─ icons/
```

## Setup GAS

1. Paste `gas/Code.gs` ke Apps Script.
2. Jalankan `setupTemplate()`.
3. Deploy sebagai Web App.
4. Copy URL `/exec`.

## Setup GitHub Pages

1. Buka `docs/config.js`.
2. Ganti `PASTE_URL_WEB_APP_GAS_DI_SINI` dengan URL Web App GAS.
3. Upload repo ke GitHub.
4. Settings > Pages > Source: branch `main`, folder `/docs`.
5. Buka URL GitHub Pages.

## PWA

Jika browser mendukung, tombol **Install** muncul di header. Jika tidak muncul, gunakan menu browser: Install App/Add to Home Screen.

## Catatan CORS

Request GitHub ke GAS memakai `Content-Type: text/plain;charset=utf-8` dan `redirect: follow` agar menghindari preflight CORS.
