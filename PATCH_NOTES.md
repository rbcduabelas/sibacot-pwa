# PATCH_NOTES — Paket Keamanan SIBACOT

> **Status:** patch lokal saja, di folder `patched/`. **BELUM di-push, BELUM di-deploy, BELUM menyentuh data produksi.**
> Repo asli di `../sibacot-pwa/` tidak diubah. Untuk membandingkan: jalankan `diff` antara
> folder asli dan folder ini (lihat daftar file yang berubah di bawah).
>
> **Dokumen ini tidak berisi nilai rahasia apa pun** — tidak ada URL backend lama/baru,
> ID spreadsheet, token gateway, password, nomor, atau email user. Semua nilai itu
> diisi pemilik di tempatnya masing-masing (lihat `ROTASI_LIVE.md`).

## Ringkasnya, apa yang diperbaiki?

Sebelumnya, login hanya gerbang tampilan: backend mempercayai username yang dikirim
dari browser, sehingga siapa pun yang menemukan alamat backend publik bisa menyamar
jadi user mana pun termasuk admin, dan endpoint data mengembalikan semua tugas,
direktori user, dan token gateway. Patch ini menutup celah itu dengan token sesi
server, membatasi data yang dikembalikan, menghapus akun admin default, dan memakai
password bersalt. Keamanan datang dari token sesi — **bukan** dari menyembunyikan
alamat backend (alamat itu memang harus terlihat di frontend publik agar frontend
bisa memanggil backend).

## Perubahan per file

### `gas/Code.gs` — perubahan terbesar
- **ID spreadsheet dipindah ke Script Properties.** Konstanta hardcoded dihapus.
  Backend membaca kunci `SIBACOT_SHEET_ID` lewat `openSpreadsheet_()`. Bila belum
  diset, backend gagal tertutup dengan pesan jelas (bukan membuka data).
- **Sesi login sungguhan (server-side).** Saat login berhasil, backend membuat token
  opaque acak (UUID ganda) dan menyimpannya di sheet baru `Sessions` bersama username,
  peran, dan masa berlaku 12 jam. Semua aksi selain `login` dan `getPublicIdentity`
  wajib membawa `sessionToken` valid; bila token hilang/kedaluwarsa, backend
  mengembalikan error berkode `SESSION_EXPIRED` dan frontend mengarahkan ke login.
  Username dan peran **selalu** diturunkan dari token di server, tidak pernah dari
  payload client. Fungsi lama yang mengambil user dari username kiriman client tidak
  lagi dipakai untuk otorisasi (dipertahankan hanya sebagai catatan legacy).
- **Login tanpa password plaintext.** Penerimaan password plaintext dan migrasi
  otomatis dari plaintext saat login **dihapus total**. Hanya hash bersalt yang
  diterima, dan pesan gagal login dibuat generik (tidak membocorkan username mana
  yang ada).
- **Password bersalt per user.** Kolom baru `Password_Salt` (kolom H) di sheet Users.
  Hash = SHA-256(salt + ":" + password). Salt dibuat acak per user saat password
  dibuat/diubah. Ini perbaikan interim yang disengaja — bukan pengganti backend
  auth proper di masa depan (lihat "Yang TIDAK diubah").
- **Akun admin default dihapus.** `setupTemplate()` tidak lagi membuat akun admin
  otomatis dan tidak lagi memigrasikan password plaintext. Bila tidak ada admin,
  pemilik membuat admin pertama lewat fungsi editor-only
  `buatAdminPertamaDariProperties()` (bukan lewat API, dan menolak berjalan bila
  sudah ada admin mana pun). Untuk deployment lama, tersedia fungsi editor-only
  kedua `setelUlangPasswordAdminDariProperties()` untuk menyetel ulang password
  satu akun yang sudah ada — karena password lama tanpa salt tidak lagi diterima.
- **`getData` dibatasi.**
  - Wajib sesi valid.
  - **Tidak pernah** mengembalikan token gateway, password, atau hash password.
  - Setelan yang dikembalikan hanya yang non-sensitif dan dipakai UI. Admin mendapat
    tambahan kontak admin dan jadwal notifikasi; token gateway tidak pernah
    dikembalikan ke siapa pun.
  - Direktori user dibatasi: admin mendapat daftar PIC (username + nama) dan daftar
    user untuk kelola user; **user biasa hanya mendapat dirinya sendiri**
    (username, peran, nama) — nomor WA dan email user lain tidak lagi dikirim ke
    user biasa. Rekapan tetap hanya untuk admin.
  - Nama PIC untuk label tugas tetap dipetakan dari username (bukan dari kontak).
- **Aksi admin dibatasi ke sesi admin** (`saveIdentity`, `saveSettings`,
  `saveHolidays`, `setupTriggers`, `testNotif`, `deleteTask`, `saveUser`,
  `deleteUser`). `saveSettings` memakai allowlist dan **mengabaikan** kunci token
  gateway bila dikirim (token tidak pernah diubah lewat aksi ini).
- **`saveUser` tanpa paksa ganti password.** Saat edit, password kosong berarti
  pertahankan hash dan salt lama. Saat buat baru, password wajib minimal 6 karakter.
  Nomor WA disimpan sebagai string agar nol depan tidak hilang.
- **`deleteUser` selalu mengembalikan JSON** (sebelumnya jatuh tanpa respons bila
  user tidak ditemukan), membatalkan semua sesi user yang dihapus, dan admin tidak
  boleh menghapus akunnya sendiri (aturan lama "akun admin utama tidak boleh
  dihapus" dipertahankan).
- **Null-guard akses sheet** di `addTask`, `updateStatus`, `deleteTask`,
  `saveUser`, `deleteUser`, `saveSettings`, `saveHolidays`, dan `getData`, agar sheet
  yang hilang menghasilkan error jelas, bukan crash.
- **ID tugas** ditambah angka acak kecil di belakang timestamp untuk mengurangi
  risiko tabrakan bila dua tugas dibuat dalam milidetik yang sama.
- **`saveIdentity` divalidasi:** nama maksimal 100 karakter, deskripsi maksimal
  200 karakter, logo hanya PNG/JPEG dan maksimal 2 MB setelah decode.
- **`doGet`:** judul diselaraskan ke SIBACOT, viewport mengizinkan pinch zoom, dan
  `XFrameOptions ALLOWALL` **dihapus** (kembali ke default yang lebih aman). Jalur
  HtmlService ini sendiri vestigial — frontend nyata ada di GitHub Pages.
- **Trigger pengingat:** `setupTriggers()` diubah dari tiap 1 menit menjadi
  **tiap 10 menit** (hemat kuota Apps Script). Pesan suksesnya diperbarui.
- **Pengingat tidak lagi gagal diam-diam:**
  - Fungsi dedupe dipecah jadi cek dan tandai. Kunci dedupe hanya ditandai
    **setelah** upaya kirim, sehingga gagal kirim bisa dicoba lagi pada run
    berikutnya di jam yang sama.
  - `kirimFonnte()` mengembalikan sukses/gagal dan mencatat kegagalan ke log
    Apps Script (tanpa pernah menulis token ke log).
  - `prosesReminder()` membersihkan kunci dedupe lama (tanggal sudah lewat) di
    awal setiap run, dan mencatat kegagalan kirim WA/email ke log.
- **Fungsi editor-only (bukan API):** `buatAdminPertamaDariProperties()` dan
  `setelUlangPasswordAdminDariProperties()` — lihat `ROTASI_LIVE.md` langkah 3.

### `docs/config.js`
- URL backend lama dihapus, diganti placeholder yang jelas:
  `ISI_URL_WEB_APP_BARU_SETELAH_REDEPLOY`.
- Ditambah komentar yang menjelaskan: URL backend di frontend publik **bukan**
  rahasia; keamanan berasal dari token sesi, bukan dari menyembunyikan URL.

### `docs/index.html`
- **Token sesi:** login menyimpan token dari server di `localStorage` terpisah
  (`sibacot_session_token`) dan info user di kunci baru (`sibacot_user`).
  `callAPI()` mengirim `sessionToken` untuk semua aksi non-login dan tidak lagi
  mengirim username dari client sebagai bukti otorisasi. Bila server mengembalikan
  `SESSION_EXPIRED`, frontend membersihkan sesi dan kembali ke layar login.
- **Layar login tidak lagi memanggil `getData` sebagai "guest".** Diganti aksi
  publik baru `getPublicIdentity` yang hanya mengembalikan nama, deskripsi, dan
  logo — tanpa tugas, user, setelan, atau token.
- **Password field** di form user diubah dari teks terlihat menjadi
  `type="password"`, dan atribut wajib dihapus agar edit user bisa dilakukan
  tanpa memaksa ganti password. Placeholder diperjelas.
- **Nomor WA** di form user dan kontak admin diubah dari `type="number"` menjadi
  `type="tel"` dengan pola 8–15 digit, agar nol depan (08...) tidak hilang.
- **Tombol logout terlihat** di header ("Keluar"). Ketuk-dua-kali logo tetap
  berfungsi sebagai alternatif.
- **Aksesibilitas:** viewport diubah — `maximum-scale=1` dan `user-scalable=no`
  dihapus, sehingga pinch zoom diizinkan.
- **Banner notifikasi dibuat jujur:** klaim "real-time" diganti penjelasan bahwa
  pengingat tampil sebagai badge di dalam aplikasi dan diperbarui saat aplikasi
  dibuka, bukan notifikasi push real-time. Pesan sukses izin notifikasi disesuaikan.
- **Cek "besok" bulanan diperbaiki di batas bulan:** besok dihitung dari tanggal
  kalender besok (bukan hari-ini + 1), sehingga deadline tanggal 1 tetap terdeteksi
  saat hari ini tanggal terakhir bulan itu.
- **`fillSettings`:** field token selalu kosong (server tidak pernah mengirimnya);
  komentar kode menjelaskan bahwa mengosongkannya saat simpan tidak mengubah token
  lama. **`saveSettings` frontend tidak lagi mengirim kunci token sama sekali.**
- **`loadData`:** tidak lagi mengirim peran/username dari client; backend
  menentukannya dari token.

### `docs/manifest.webmanifest`
- Nama aplikasi diselaraskan dari nama lama sisa rebrand menjadi `SIBACOT`.

### `docs/sw.js`
- Nama cache dirapikan menjadi `sibacot-pwa-v10-security` (sebelumnya nama informal
  per-deploy). Cache lama dibersihkan otomatis oleh handler `activate` yang sudah ada.

## Perubahan perilaku yang BREAKING (wajib diketahui pemilik)

1. **Semua user harus login ulang.** Sesi lokal lama tidak berlaku karena kunci
   penyimpanan diganti dan sesi lama tidak memakai token server. Ini disengaja.
2. **Password lama tanpa salt tidak lagi diterima.** Semua user yang passwordnya
   belum bersalt (termasuk admin lama) tidak bisa login sampai admin menyetel
   ulang password mereka — lewat fungsi editor-only untuk satu admin pertama,
   lalu lewat UI kelola user untuk user lainnya. Lihat `ROTASI_LIVE.md` langkah 3–4.
3. **Tidak ada lagi akun admin default.** Bila deployment masih kosong, admin
   pertama harus dibuat manual lewat editor (bukan otomatis, bukan lewat API).
4. **User biasa tidak lagi menerima direktori kontak user lain** dari `getData`.
   UI user biasa memang dikunci ke dirinya sendiri, jadi ini seharusnya tidak
   merusak alur normal — tetapi bila ada alur yang diam-diam mengandalkan daftar
   kontak lengkap di sisi user biasa, alur itu akan berubah (lihat TEST_CHECKLIST).
5. **Token gateway tidak lagi bisa dilihat/diubah lewat UI.** Field token di
   Pengaturan Sistem selalu kosong. Mengosongkannya saat simpan tidak mengubah
   token lama. Rotasi token dilakukan pemilik langsung di Sheet Settings
   (lihat ROTASI_LIVE.md langkah 2).
6. **URL backend baru wajib diisi setelah redeploy.** Frontend hasil patch tidak
   akan berfungsi sampai `docs/config.js` diisi URL Web App baru hasil redeploy.
7. **Pengingat kini dicek tiap 10 menit, bukan tiap menit.** Pengingat yang dijadwal
   pada jam tertentu bisa datang hingga ~10 menit setelah jam itu. Ini trade-off
   yang disengaja demi kuota Apps Script.
8. **Kunci penyimpanan lokal berubah** dari kunci lama ke `sibacot_user` dan
   `sibacot_session_token`. Sesi dari versi lama tidak dimigrasikan.

## Yang TIDAK diubah, dan alasannya

- **"Semua PIC bisa melihat semua tugas" TIDAK diubah.** Ini keputusan produk yang
  masih menunggu persetujuan pemilik. Catat sebagai keputusan tertunda: bila nanti
  diputuskan membatasi, `getData` perlu difilter per PIC (admin tetap melihat semua).
- **Struktur data Sheets tidak diubah** (nama sheet dan kolom tugas sama), kecuali
  penambahan kolom `Password_Salt` dan sheet `Sessions`. Ini menjaga kompatibilitas
  data lama dan membuat patch bisa diuji tanpa migrasi data.
- **Offline-first TIDAK dibangun** (tidak ada cache data IndexedDB / antrean tulis).
  Itu perombakan besar di luar paket keamanan ini; offline saat ini tetap hanya
  cangkang. Jangan klaim aplikasi sudah bisa kerja offline.
- **Tidak ada migrasi ke backend database proper** (mis. Firebase/Supabase) dan
  tidak ada penggantian gateway WA. Hash bersalt di sini adalah perbaikan interim.
- **Sisa rebrand yang berisiko TIDAK dipaksakan.** Yang diselaraskan hanya yang
  aman: nama manifest, judul `doGet`, kunci penyimpanan lokal (aman karena semua
  user memang wajib login ulang), dan nama cache service worker. Nama sheet,
  ID tugas, dan struktur data tidak diubah.
- **Splash screen yang tidak terpakai dan ikon sentuh Apple tidak diubah** dalam
  patch ini (di luar paket keamanan; bisa dibersihkan di paket PWA berikutnya).
- **Logo default hotlink tidak diganti** — di `getData` fallback logo lama yang
  mengarah ke hotlink tidak lagi dikirim sebagai setelan, tetapi `applyIdentity`
  di frontend masih punya fallback yang sama bila tidak ada logo tersimpan.
  Mengganti aset brand sebaiknya diputuskan pemilik bersama identitas aplikasi.
- **Tidak ada perubahan pada isi README deploy lama** (`README_DEPLOY.md`,
  `README_BUKTI_CODEGS_BERUBAH.md`). Dokumen baru yang benar adalah
  `ROTASI_LIVE.md` dan `TEST_CHECKLIST.md` di folder ini; README lama sebaiknya
  diganti/diarsipkan saat patch ini resmi dipakai, agar tidak ada dua "prosedur"
  yang bertentangan.

## Perbaikan pasca-TEST_CHECKLIST 27 Okt 2026

Dilakukan hanya di salinan patch lokal ini, setelah TEST_CHECKLIST di artefak
uji (24/24 kasus backend lulus, tidak ada kasus keamanan gagal). Keempat temuan
di bawah ini **bukan** keamanan, tetapi pemilik meminta semuanya diperbaiki dulu
sebelum rilis. Perbaikan ini baru terverifikasi lokal — uji ulang live di
artefak uji masih diperlukan sebelum push/merge/deploy (lihat bagian akhir).

1. **WA 08 kehilangan nol depan — akar masalah: format sel, bukan hanya tipe
   input.** Input frontend memang sudah `type="tel"`, dan `setupTemplate()`
   memang sudah memformat kolom WA Users ke "@", tetapi penulisan lewat
   `setValues`/`appendRow` pada sel berformat General tetap dipaksa Sheets
   menjadi numerik. Perbaikannya: helper baru `normalizeWa_()` +
   `writeWaCell_()` di `gas/Code.gs` — setiap penulisan WA (saveUser saat edit
   maupun buat baru, saveSettings untuk kontak admin, admin pertama lewat
   editor, dan format di `setupTemplate()`) kini memformat sel ke "@" dulu
   lalu menulis ulang nilai string-nya; frontend (`submitUser`,
   `saveSettings`) juga mengirim WA selalu sebagai string yang di-trim.
   `getData`, `getUserByUsername_`, dan `prosesReminder` menormalisasi WA ke
   string saat dibaca. Catatan jujur: baris yang **sudah** terlanjur terpotong
   sebelum perbaikan ini tidak bisa dipulihkan otomatis dari nilai yang
   tersisa — admin harus mengisi ulang nomor WA user yang terdampak.
2. **Sesi kedaluwarsa di UI tidak kembali ke login — akar masalah: kode error
   terbuang di backend.** `requireSession_()` memang melempar
   `SESSION_EXPIRED`, tetapi `catch` di akhir `prosesAPI()` mengembalikan
   error generik tanpa `code`, sehingga frontend tidak bisa membedakannya
   dari error biasa dan hanya menampilkan toast. Perbaikannya dua lapis:
   `catch` prosesAPI kini mempertahankan `error.code` bila ada (sama seperti
   `catch` di `doPost`), dan `callAPI()` di frontend kini juga mengenali
   pesan "sesi tidak valid atau kedaluwarsa" sebagai cadangan — dalam kedua
   kasus, cache tugas/user/libur dibersihkan, timer auto-logout dihentikan,
   dan UI dipaksa ke layar login (bukan hanya toast di atas dashboard lama).
3. **Simpan tugas harian overdue tanpa ubah menghapus Deadline jadi "-" —
   akar masalah di backend, bukan hanya di form.** Form edit overdue memang
   menyembunyikan input deadline, tetapi penyebab hilangnya tanggal adalah
   `editTask`: tipe Harian selalu dipaksa jadi "-" saat menulis, padahal
   kolom Deadline baris Overdue menyimpan tanggal jatuh tempo asli.
   Perbaikannya dua lapis: di `editTask`, untuk baris overdue, nilai "-"
   atau kosong **tidak pernah** menimpa deadline yang ada — nilai lama
   dipertahankan; di frontend, `submitTask()` untuk tugas overdue yang
   deadline-nya "-" / kosong mengirim deadline asli dari data yang sedang
   diedit. Untuk tugas Harian yang **bukan** overdue, "-" tetap perilaku
   yang benar (tugas harian memang tidak punya tanggal deadline).
4. **Gagal kirim WA tidak terdeteksi — akar masalah: hanya kode HTTP yang
   dicek.** Fonnte membalas HTTP 200 dengan body JSON `{"status": false,
   "reason": "token invalid"}` untuk token tidak valid (sesuai dokumentasi
   Fonnte: token salah -> status false), tetapi `kirimFonnte()` lama hanya
   mengecek kode HTTP 2xx sehingga melaporkan sukses dan `prosesReminder()`
   menandai dedupe terkirim. Perbaikannya: `kirimFonnte()` kini mem-parse
   body JSON dan menganggap gagal bila field `status` ada dan bernilai
   false (boolean, string "false", atau 0); hanya `reason`/`detail` yang
   dicatat ke log, bukan seluruh body dan bukan token. Bila body tidak
   ter-parse atau tidak punya field `status`, perilaku lama dipertahankan
   (2xx = sukses) agar bentuk sukses lain gateway tidak tiba-tiba dianggap
   gagal. Karena `prosesReminder()` dan `testNotif` sudah memakai nilai
   balik `kirimFonnte()`, gagal kirim kini tidak lagi menandai dedupe
   terkirim dan akan dicoba lagi pada run berikutnya di jam yang sama.
   Catatan terpisah: gateway yang membalas 2xx/status true untuk nomor
   yang tidak ada adalah perilaku gateway, bukan sesuatu yang bisa
   diperbaiki dari patch ini — kasus itu tetap dilaporkan sukses oleh
   gateway tanpa pengiriman nyata.

File yang berubah pada putaran perbaikan ini: `gas/Code.gs`,
`docs/index.html`, dan dokumen ini (`PATCH_NOTES.md`). `docs/config.js`,
`docs/manifest.webmanifest`, dan `docs/sw.js` tidak diubah pada putaran ini.

## Verifikasi yang sudah dilakukan di patch ini (lokal, tanpa data live)

- `diff` folder asli vs hasil patch: hanya 5 file yang berubah —
  `gas/Code.gs`, `docs/index.html`, `docs/config.js`, `docs/manifest.webmanifest`,
  `docs/sw.js` — ditambah 3 dokumen baru ini. File lain (ikon, splash, README lama,
  `docs/offline.html`) identik dengan aslinya.
- Pemindaian hasil patch (hitung kecocokan, tanpa menampilkan nilainya):
  tidak ada URL backend lama, tidak ada ID spreadsheet hardcoded, tidak ada
  kredensial default lama di kode baru. Konstanta ID spreadsheet lama: 0.
  Placeholder URL baru di `config.js`: ada.
- Sintaks: `Code.gs`, `config.js`, `sw.js`, dan skrip inline `index.html` lolos
  pemeriksaan sintaks (Code.gs diperiksa lewat salinan berekstensi `.js` karena
  pemeriksa tidak mengenal ekstensi `.gs`). Kurung kurawal `Code.gs` seimbang.
  Tag `div`/`form`/`button` di `index.html` seimbang; ketidakseimbangan `table`
  (5 buka / 4 tutup) sudah ada di kode asli dan tidak berubah oleh patch ini —
  tabel-tabel utama dirender lewat JavaScript, jadi ini dicatat, bukan diperbaiki
  diam-diam di paket keamanan.
- **Belum diuji terhadap backend live.** Semua perilaku di atas adalah hasil baca
  kode, bukan hasil uji live — lihat `TEST_CHECKLIST.md` untuk uji yang harus
  dijalankan pemilik di salinan uji sebelum menyentuh produksi.
