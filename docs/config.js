// SIBACOT — konfigurasi frontend.
//
// PENTING — JANGAN SALAH PAHAM:
// URL ini memang terlihat oleh siapa pun yang membuka kode frontend publik,
// dan itu BUKAN masalah yang harus "disembunyikan". Frontend publik tetap
// butuh alamat backend untuk memanggilnya. Keamanan SIBACOT sekarang datang
// dari TOKEN SESI yang diterbitkan server saat login dan wajib dibawa di
// setiap aksi — bukan dari kerahasiaan URL ini. Tanpa token valid, backend
// menolak semua aksi (kecuali login dan identitas publik).
window.SIBACOT_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbzMbVU3EwFuCEfTVxNuRpH3o4BEYb21sPzsdZfktWfZrSDzZxFtqcw9eUF4CJ2PGb8K/exec"
};
