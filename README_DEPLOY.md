# SIBACOT GitHub PWA - Upgrade Trial Day 1

Perbaikan:
- loading awal dibuat lebih halus agar tidak kedap-kedip;
- PIC dapat menambahkan tugas;
- PIC dapat edit tugas miliknya;
- tugas tambahan selesai baru dibersihkan oleh reset harian hari berikutnya;
- overdue dibuat pada sheet `Overdue` saat reset harian jika tugas berulang belum selesai;
- manifest PWA diperkuat dengan `id`, `display_override`, dan `prefer_related_applications:false`.

Catatan Huawei/tablet: jika tetap menjadi shortcut Chrome, biasanya disebabkan WebAPK tidak berhasil dibuat oleh browser/perangkat. Kode manifest sudah diperkuat, tetapi perilaku akhir tetap tergantung dukungan browser/perangkat.

Setelah upload ke GitHub, clear cache/service worker lama atau buka incognito karena cache PWA bisa menahan versi lama.
