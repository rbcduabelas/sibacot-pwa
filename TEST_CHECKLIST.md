# TEST_CHECKLIST — Cara Uji Patch Tanpa Menyentuh Data Produksi

> **Prinsip:** jangan uji patch ini langsung di spreadsheet produksi. Buat salinan
> uji dulu, uji di sana, dan hanya setelah semua kasus di bawah lolos, jalankan
> `ROTASI_LIVE.md` untuk produksi.
>
> Dokumen ini tidak berisi nilai rahasia apa pun. Semua nilai uji dibuat sendiri
> oleh penguji di salinan uji (username/password/token uji), bukan nilai produksi.

## Menyiapkan lingkungan uji (sekali saja)

1. Buat salinan spreadsheet produksi (atau spreadsheet kosong dengan struktur yang
   sama) khusus untuk uji. Beri nama yang jelas, mis. "SIBACOT-UJI".
2. Buat proyek Apps Script uji terpisah (bisa dari salinan Sheet uji > Extensions >
   Apps Script), tempel `gas/Code.gs` hasil patch, dan set Script Properties
   `SIBACOT_SHEET_ID` ke ID spreadsheet uji.
3. Buat admin uji dengan fungsi editor-only `buatAdminPertamaDariProperties()`
   (isi lima properti setup, jalankan dari editor, lalu hapus propertinya).
4. Deploy Web App uji, isi URL-nya ke `docs/config.js` salinan uji, dan sajikan
   folder `docs/` hasil patch lewat server statis lokal atau Pages uji.
   Jangan arahkan frontend uji ke backend produksi, dan sebaliknya.
5. Buat 2–3 user uji lewat UI admin (satu admin kedua, dua PIC dengan nomor WA
   dan email uji yang berbeda).

## Kasus uji — backend (panggil API uji langsung bila perlu)

Gunakan alat panggil HTTP (mis. curl / Postman) ke URL Web App uji dengan body
JSON `{"action": ..., ...}` dan header `Content-Type: text/plain`, atau cukup
lewat UI bila kasusnya tercakup UI. Catat hasil tiap kasus: lolos / gagal.

- [ ] **Login benar:** username + password benar menghasilkan `status: success`
      beserta `sessionToken` (token acak, bukan username). Simpan token ini untuk
      kasus berikut.
- [ ] **Login salah:** password salah menghasilkan pesan generik yang sama
      seperti username tidak ada (tidak membocorkan mana yang salah).
- [ ] **Login password lama tanpa salt ditolak:** buat user uji dengan hash lama
      tanpa salt (atau user yang passwordnya belum disetel ulang) — loginnya
      harus gagal. Ini perilaku yang disengaja.
- [ ] **getData tanpa token ditolak:** panggil `getData` tanpa `sessionToken`
      menghasilkan error sesi (bukan data). UI harus kembali ke login.
- [ ] **getData dengan token palsu ditolak:** token acak yang dikarang sendiri
      menghasilkan error sesi, bukan data.
- [ ] **getData dengan token valid tidak mengandung token gateway:** periksa
      seluruh respons JSON — tidak ada kunci token gateway di dalamnya, baik
      untuk admin maupun user biasa. (Periksa dengan mencari nama kunci token
      di respons, bukan dengan menulis nilainya di mana pun.)
- [ ] **getData user biasa tidak mengandung kontak user lain:** login sebagai
      PIC, periksa respons `getData` — daftar user hanya berisi dirinya sendiri,
      tanpa nomor WA/email user lain. Daftar tugas tetap tampil (perilaku
      "semua PIC bisa lihat semua tugas" sengaja belum diubah).
- [ ] **getData admin mengandung daftar kelola user, tetapi tetap tanpa token:**
      login sebagai admin, periksa daftar user tampil di UI, dan respons tetap
      tidak mengandung token gateway.
- [ ] **Aksi admin dengan token PIC ditolak:** dengan token PIC, panggil
      `deleteTask`, `saveUser`, `saveSettings`, atau `saveIdentity` — semuanya
      harus ditolak (bukan berhasil).
- [ ] **Aksi dengan username client palsu ditolak:** kirim aksi dengan token
      PIC yang valid tetapi tambahkan field username/peran admin di body —
      backend harus tetap memperlakukan pemanggil sebagai PIC (peran dari token),
      bukan dari body.
- [ ] **Identitas publik tanpa sesi:** panggil `getPublicIdentity` tanpa token —
      harus berhasil dan hanya mengembalikan nama, deskripsi, dan logo. Tidak
      ada tugas, user, atau setelan di responsnya.
- [ ] **Layar login tidak memanggil data:** buka aplikasi tanpa login dan
      periksa (lewat network tab browser) bahwa tidak ada panggilan `getData`
      yang terjadi — hanya `getPublicIdentity`.
- [ ] **Token kedaluwarsa:** bila memungkinkan, ubah masa berlaku satu sesi uji
      di sheet `Sessions` menjadi waktu lampau, lalu panggil `getData` dengan
      token itu — harus ditolak dan UI kembali ke login.
- [ ] **Simpan user tanpa ganti password:** sebagai admin, edit user uji tanpa
      mengisi password, simpan, lalu login dengan password lama user itu —
      harus tetap berhasil.
- [ ] **Simpan user dengan password baru:** edit user uji dengan password baru,
      simpan, lalu login dengan password baru berhasil dan password lama gagal.
- [ ] **Buat user tanpa password ditolak:** buat user baru dengan password kosong
      — harus ditolak (password wajib untuk user baru).
- [ ] **Hapus user yang tidak ada mengembalikan JSON error:** panggil
      `deleteUser` untuk username yang tidak ada — respons harus JSON error
      yang jelas, bukan respons kosong.
- [ ] **Hapus user membatalkan sesinya:** login sebagai user uji, lalu sebagai
      admin hapus user itu, lalu pakai token lama user yang dihapus untuk
      `getData` — harus ditolak.
- [ ] **Simpan setelan tidak mengubah token:** sebagai admin, simpan Pengaturan
      Sistem dengan field token dikosongkan, lalu periksa di Sheet Settings
      bahwa nilai token gateway tidak berubah (tetap nilai uji).
- [ ] **Sheet ID belum diset gagal tertutup:** di proyek uji kedua tanpa properti
      `SIBACOT_SHEET_ID`, panggil aksi apa pun — harus menghasilkan pesan error
      konfigurasi yang jelas, bukan data.
- [ ] **Admin pertama menolak bila admin sudah ada:** jalankan fungsi
      `buatAdminPertamaDariProperties()` di proyek uji yang sudah punya admin —
      harus gagal dengan pesan penolakan (fail closed).

## Kasus uji — frontend / UI

- [ ] **Nomor WA 08 utuh:** buat/edit user dengan nomor WA berawalan 08, simpan,
      muat ulang, buka lagi form editnya — nomor tampil utuh dengan nol depannya,
      bukan terpotong.
- [ ] **Field password tidak terlihat:** di form user, field password bertipe
      password (karakter tersembunyi), bukan teks biasa.
- [ ] **Tombol logout terlihat:** di header aplikasi ada tombol "Keluar" yang
      bisa diklik (bukan hanya ketuk-dua-kali logo). Setelah klik, kembali ke
      layar login dan token tersimpan terhapus.
- [ ] **Pinch zoom diizinkan:** di HP, cubit-zoom halaman aplikasi bisa
      memperbesar tampilan (tidak lagi terkunci).
- [ ] **Banner notifikasi jujur:** banner di atas aplikasi menjelaskan badge di
      dalam aplikasi, dan tidak lagi mengklaim pengingat real-time.
- [ ] **Deadline bulanan di batas bulan:** buat tugas Bulanan dengan tenggat
      tanggal 1, lalu atur tanggal sistem/perangkat ke tanggal terakhir bulan
      sebelumnya (atau uji logika panel pengingat pada tanggal itu) — tugas
      harus muncul sebagai "besok", bukan hilang.
- [ ] **Edit tugas overdue harian tidak merusak tenggat:** sebagai admin, edit
      tugas overdue dan simpan — periksa tenggatnya tidak berubah menjadi "-"
      secara diam-diam (kasus ini dicatat dari kode lama; bila masih terjadi di
      uji, laporkan sebagai bug lanjutan, bukan bagian dari paket ini).
- [ ] **Sesi kedaluwarsa di UI:** setelah token kedaluwarsa (lihat kasus backend),
      membuka/menyegarkan aplikasi mengarahkan ke login, bukan menampilkan data
      lama.
- [ ] **PWA terpasang dan cache baru:** instal aplikasi (bila perangkat
      mendukung) dan periksa tidak ada cache lama yang menahan versi lama —
      nama cache baru dipakai setelah service worker diperbarui.

## Kasus uji — trigger (di proyek uji, dengan data uji)

- [ ] **Trigger 10 menit:** aktifkan trigger dari UI admin, periksa di editor
      (Triggers) bahwa trigger pengingat terpasang tiap 10 menit, bukan tiap
      menit, dan tidak ada trigger per-menit lama yang tersisa.
- [ ] **Test WA/Email:** kirim test notifikasi ke admin uji; bila gateway uji
      tidak tersedia, cukup periksa pesan errornya jelas dan tidak membocorkan
      token.
- [ ] **Gagal kirim tercatat:** bila pengiriman sengaja dibuat gagal (mis.
      token uji sengaja dikosongkan), periksa log eksekusi Apps Script mencatat
      kegagalan — dan pengingat tidak ditandai terkirim sehingga bisa dicoba
      lagi pada run berikutnya.

## Kriteria lolos

Semua kasus backend bertanda di atas harus lolos sebelum patch dipakai di
produksi. Bila satu kasus keamanan gagal (token palsu diterima, token gateway
muncul di respons, atau kontak user lain bocor ke user biasa), **hentikan** dan
perbaiki patch di salinan uji — jangan lanjut ke `ROTASI_LIVE.md`.
Kasus UI yang gagal dicatat sebagai bug lanjutan dan diputuskan pemilik apakah
menghambat rilis atau tidak.
