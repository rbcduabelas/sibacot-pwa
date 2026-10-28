# ROTASI_LIVE — Checklist Pemilik (di luar kode)

> Jalankan langkah-langkah ini **sesuai urutan**, dan **jangan** menyebarkan patch
> ke pengguna sebelum langkah 1–6 selesai. Dokumen ini tidak berisi nilai rahasia
> apa pun — semua nilai diisi pemilik di tempatnya (Apps Script, Sheet, gateway),
> bukan ditulis di sini.
>
> Prinsip urutan: cadangkan dulu, putuskan akses lama dulu (redeploy = URL baru),
> ganti kredensial, baru buka akses baru. Jangan membalik urutan 1 dan 2: bila
> token baru dibuat tetapi deployment lama masih aktif, token baru bisa bocor
> lewat endpoint lama yang masih mengembalikan setelan.

## 0. Cadangkan (sebelum apa pun)

- [ ] Buat salinan spreadsheet produksi (File > Make a copy) dan simpan salinannya
      di Drive pemilik dengan akses terbatas. Jangan bagikan salinan ini ke publik.
- [ ] Simpan salinan `Code.gs` lama (unduh dari editor Apps Script) sebagai arsip
      lokal pemilik, untuk jaga-jaga rollback.
- [ ] Catat siapa saja yang saat ini dibagikan spreadsheet-nya (Share > siapa saja
      yang punya akses). Bila ada akun yang tidak dikenal/tidak lagi bertugas,
      hapus aksesnya sekarang.
- Verifikasi: salinan Sheet bisa dibuka pemilik dan isinya sama dengan aslinya.

## 1. Redeploy Apps Script dengan kode hasil patch

- [ ] Buka proyek Apps Script produksi (yang selama ini melayani aplikasi).
- [ ] Ganti seluruh isi `Code.gs` dengan `gas/Code.gs` dari folder patch ini.
      Pastikan tidak ada sisa kode lama yang tertinggal (cari nama fungsi lama
      yang sudah dihapus, mis. fungsi migrasi plaintext — harus tidak ada).
- [ ] Di Script Properties proyek, set kunci `SIBACOT_SHEET_ID` dengan ID
      spreadsheet produksi (ID yang terlihat di URL Sheet saat dibuka pemilik).
      Jangan menulis ID ini ke chat, README, atau repo.
- [ ] Deploy sebagai Web App baru (New deployment). Periksa setelan deployment:
      "Execute as" = pemilik script, dan "Who has access" sesuai kebijakan pemilik
      (bila sebelumnya anonim, pertimbangkan kembali — token sesi kini melindungi
      data, tetapi setelan akses deployment tetap harus ditinjau pemilik).
- [ ] Catat URL Web App **baru** hasil deploy ini. URL lama tidak lagi dipakai.
- [ ] Isi URL baru itu ke `docs/config.js` di salinan patch (ganti placeholder),
      lalu deploy frontend statis (GitHub Pages) dari folder `docs/` hasil patch.
- Verifikasi: buka aplikasi, layar login tampil dengan nama/deskripsi/logo yang
  benar (identitas publik). Coba login dengan akun lama — **harus gagal** pada
  tahap ini (password lama tanpa salt memang ditolak). Itu tanda patch aktif,
  bukan tanda rusak. Lanjut ke langkah 3.

## 2. Rotasi token gateway WA

- [ ] Di dashboard penyedia gateway WA pemilik, cabut/buat ulang token gateway
      (revoke token lama, terbitkan token baru).
- [ ] Masukkan token baru **langsung ke sel token gateway di sheet Settings**
      spreadsheet produksi (sebagai pemilik Sheet). Token ini tidak lagi bisa
      dilihat/diubah lewat UI aplikasi — itu disengaja.
- [ ] Jangan pernah menempel token baru di chat, README, repo, atau screenshot.
- Verifikasi: dari UI admin (setelah langkah 3–4), kirim "Test WA" ke nomor admin
  sendiri. Bila gagal, periksa log eksekusi Apps Script (bukan dengan
  menampilkan token di mana pun).

## 3. Bootstrap admin (pilih SATU sesuai kondisi)

### 3A. Bila deployment sudah punya akun admin (kasus umum)

- [ ] Di Script Properties, set sementara dua properti:
      `SIBACOT_RESET_USERNAME` (username admin yang akan dipakai pemilik) dan
      `SIBACOT_RESET_PASSWORD` (password baru, minimal 6 karakter).
- [ ] Jalankan fungsi `setelUlangPasswordAdminDariProperties()` **dari editor**
      Apps Script (bukan lewat API, bukan lewat aplikasi).
- [ ] **Segera hapus kedua properti reset itu** dari Script Properties.
- [ ] Login ke aplikasi dengan akun admin tersebut dan password baru.
- Verifikasi: login admin berhasil, dasbor admin tampil, dan semua sesi lama
  akun itu sudah batal (login ulang diperlukan di perangkat lain).

### 3B. Bila deployment masih kosong / tidak ada admin sama sekali

- [ ] Di Script Properties, set `SIBACOT_SHEET_ID` (dari langkah 1) plus lima
      properti setup: username, nama lengkap, nomor WA, email, dan password admin
      pertama (minimal 6 karakter).
- [ ] Jalankan fungsi `buatAdminPertamaDariProperties()` **dari editor**.
      Fungsi ini menolak berjalan bila sudah ada admin mana pun.
- [ ] **Segera hapus kelima properti setup itu.**
- [ ] Login dengan akun admin pertama tersebut.
- Verifikasi: sama seperti 3A.

> Jangan menjalankan 3A dan 3B dua-duanya untuk akun yang sama. Bila 3A sudah
> berhasil, 3B akan ditolak — itu perilaku yang benar.

## 4. Reset password semua user lain

- [ ] Sebagai admin, buka Kelola User. Untuk setiap user, edit dan isi password
      baru, lalu simpan. Password baru akan tersimpan sebagai hash bersalt.
- [ ] Sampaikan password baru ke masing-masing user lewat jalur aman yang biasa
      dipakai (bukan lewat grup publik). Minta setiap user login ulang dan,
      bila memungkinkan, mengganti passwordnya lewat admin bila perlu.
- [ ] Untuk user yang tidak lagi bertugas, hapus akunnya (bukan hanya dinonaktifkan).
      Menghapus user juga membatalkan semua sesinya.
- Verifikasi: setiap user aktif bisa login dengan password barunya; user yang
  dihapus tidak bisa login; user biasa yang login tidak melihat nomor WA/email
  user lain di aplikasi (periksa di Kelola User — menu itu hanya untuk admin).

## 5. Samakan deployment dengan repo & rapikan Sheet

- [ ] Pastikan `Code.gs` yang ter-deploy **persis** sama dengan `gas/Code.gs`
      di folder patch ini (bandingkan isi file, jangan hanya mengandalkan ingatan).
      Bila ada perbedaan, deploy ulang dari file patch, bukan dari hasil edit
      manual di editor.
- [ ] Periksa sheet Users: kolom password lama (kolom plaintext) harus sudah
      kosong untuk semua user yang sudah direset. Bila masih ada nilai plaintext
      tersisa untuk user yang belum direset, selesaikan resetnya atau hapus
      nilainya — jangan biarkan password plaintext tersimpan.
- [ ] Periksa sheet `Sessions` yang terbentuk otomatis saat login pertama:
      isinya hanya token acak, username, peran, dan angka masa berlaku — tidak
      ada password di sana.
- [ ] Periksa sharing Sheet sekali lagi (lihat langkah 0). Hanya pemilik dan
      akun yang benar-benar perlu yang punya akses.
- [ ] Arsipkan/ganti README deploy lama di repo agar tidak ada dua prosedur yang
      bertentangan. Prosedur yang benar mulai sekarang adalah dokumen ini dan
      `PATCH_NOTES.md`.
- Verifikasi: tidak ada akun asing di sharing Sheet; tidak ada nilai plaintext
  di kolom password lama; deployment sama dengan file patch.

## 6. Trigger pengingat (10 menit) & uji notifikasi

- [ ] Sebagai admin, klik "Aktifkan Trigger Otomatis" di Pengaturan Sistem.
      Ini sekarang memasang trigger tiap 10 menit (bukan tiap menit) plus
      trigger reset harian pukul 01.00.
- [ ] Periksa di editor Apps Script (Triggers) bahwa hanya ada trigger yang
      diharapkan dan tidak ada trigger lama tiap menit yang tertinggal.
- [ ] Kirim "Test WA" dan "Test Email" ke admin sendiri.
- [ ] Tunggu satu jam notifikasi yang dijadwalkan dan periksa apakah pengingat
      masuk (ingat: bisa datang hingga ~10 menit setelah jam yang diatur).
- [ ] Bila ada pengingat yang gagal, periksa log eksekusi Apps Script — patch ini
      mencatat kegagalan kirim (tanpa token) di sana.
- Verifikasi: trigger 10-menit aktif, test notifikasi terkirim, dan tidak ada
  trigger per-menit lama yang masih berjalan.

## 7. Beri tahu pengguna & pantau 1 minggu pertama

- [ ] Beri tahu semua user: semua orang wajib login ulang, password lama tidak
      berlaku, dan pengingat kini bisa datang hingga ~10 menit setelah jamnya.
- [ ] Selama seminggu pertama, pantau log Apps Script untuk error sesi
      (`SESSION_EXPIRED` yang berlebihan bisa menandakan token tidak tersimpan
      dengan benar di perangkat tertentu) dan kegagalan kirim notifikasi.
- [ ] Bila ada user yang mengeluh tidak bisa login setelah reset, jangan
      mengembalikan jalur password lama — setel ulang passwordnya lewat UI admin
      atau fungsi editor-only, lalu minta login ulang.
- Verifikasi akhir: semua user aktif bisa login, tugas dan rekap tampil normal,
  pengingat berjalan, dan tidak ada laporan data user lain yang terlihat oleh
  user biasa.

## Rollback (bila patch bermasalah di produksi)

1. Deploy ulang `Code.gs` lama dari arsip langkah 0 dan frontend lama.
2. Ingat: rollback mengembalikan celah lama (termasuk token gateway lama yang
   sudah dirotasi — jadi token lama tidak akan berfungsi lagi, dan itu bagus).
   Karena itu rollback hanya untuk keadaan darurat, dan segera setelah itu
   perbaiki patch di salinan uji, bukan dengan membiarkan versi lama berjalan.
