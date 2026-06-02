# SIBACOT GitHub Pages + PWA

Hotfix ini memperbaiki tampilan GitHub Pages yang terbaca desktop mode dengan menambahkan viewport langsung di `docs/index.html`, serta memperbaiki logout logo kanan atas dengan `onclick="handleLogoTap()"` langsung pada elemen logo.

## Cara update
1. Upload/replace isi folder `docs` ke repo GitHub Bapak.
2. Paste `gas/Code.gs` ke Apps Script jika ingin sinkron dengan versi backend terbaru.
3. Pastikan `docs/config.js` berisi URL Web App GAS.
4. Jika tampilan masih lama, buka browser incognito atau clear site data/service worker, karena PWA bisa menyimpan cache lama.
