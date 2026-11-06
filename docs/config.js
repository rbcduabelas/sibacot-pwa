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
  API_URL: "https://script.google.com/macros/s/AKfycbxNXzbi5bA3-zX5Cc-AoswsB_4HAlXIo3H7-LRKDxZo2ebWV6C5v87ITg3_01rJZJa9/exec"
};
