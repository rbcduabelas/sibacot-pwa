// HOTFIX 2026-07-02 OVERDUE CLEANUP + ADMIN EDIT OVERDUE
const APP_TZ = "Asia/Jayapura";
// PATCH KEAMANAN 2026-10-27:
// - ID spreadsheet TIDAK LAGI ditulis di kode. Isi di Script Properties dengan kunci
//   SIBACOT_SHEET_ID (lihat ROTASI_LIVE.md). Jika belum diset, backend gagal tertutup
//   dengan pesan jelas, bukan membuka data.
// - Sesi login memakai sheet "Sessions" (token opaque + masa berlaku). Username dan
//   peran SELALU diturunkan dari token di server, tidak pernah dari payload client.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 jam
const SESSION_SHEET = "Sessions";

function openSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SIBACOT_SHEET_ID");
  if (!id) throw new Error("Konfigurasi backend belum lengkap: SIBACOT_SHEET_ID belum diset di Script Properties. Lihat ROTASI_LIVE.md.");
  return SpreadsheetApp.openById(id);
}

function getSheetOrNull_(ss, name) {
  try { return ss.getSheetByName(name); } catch (e) { return null; }
}

// --- Sesi (server-side) ---
function ensureSessionsSheet_(ss) {
  let sh = ss.getSheetByName(SESSION_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SESSION_SHEET);
    sh.getRange("A1:E1").setValues([["Token", "Username", "Role", "Expires_Millis", "Created_Millis"]]);
  } else if (sh.getLastRow() === 0) {
    sh.getRange("A1:E1").setValues([["Token", "Username", "Role", "Expires_Millis", "Created_Millis"]]);
  }
  return sh;
}

function createSession_(ss, username, role) {
  const sh = ensureSessionsSheet_(ss);
  const now = new Date().getTime();
  const token = Utilities.getUuid() + "-" + Utilities.getUuid();
  sh.appendRow([token, username, role, now + SESSION_TTL_MS, now]);
  SpreadsheetApp.flush();
  return token;
}

function getSessionUser_(ss, payload) {
  const token = payload && payload.sessionToken ? String(payload.sessionToken).trim() : "";
  if (!token) return null;
  const sh = ss.getSheetByName(SESSION_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const data = sh.getDataRange().getValues();
  const now = new Date().getTime();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === token) {
      const expires = Number(data[i][3]);
      if (!expires || expires <= now) {
        try { sh.deleteRow(i + 1); } catch (e) {}
        return null;
      }
      return { username: String(data[i][1]), role: String(data[i][2]) };
    }
  }
  return null;
}

function requireSession_(ss, payload) {
  const user = getSessionUser_(ss, payload);
  if (!user) {
    const err = new Error("Sesi tidak valid atau kedaluwarsa. Silakan login ulang.");
    err.code = "SESSION_EXPIRED";
    throw err;
  }
  return user;
}

function requireAdminSession_(ss, payload) {
  const user = requireSession_(ss, payload);
  if (user.role !== "Admin") throw new Error("Akses ditolak. Fitur ini hanya untuk Admin.");
  return user;
}

function invalidateSessionsForUser_(ss, username) {
  const sh = ss.getSheetByName(SESSION_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]) === String(username)) sh.deleteRow(i + 1);
  }
}

// --- Password bersalt (perbaikan interim, bukan pengganti auth backend proper) ---
function hashPasswordWithSalt_(password, salt) {
  return hashPassword_(String(salt || "") + ":" + String(password || ""));
}

function newSalt_() { return Utilities.getUuid(); }

// ============================================================================
// PASSKEY / WebAuthn v1 — HANYA SALINAN UJI (test-5hal), TIDAK DI PRODUKSI.
// Model: login pertama tetap password; setelah login, user mendaftarkan
// perangkat ini (sidik jari/face unlock); login berikutnya di perangkat +
// browser yang sama bisa pakai sidik jari tanpa password; password tetap
// berfungsi sebagai fallback; satu passkey hanya berlaku di perangkat/
// browser tempat ia didaftarkan (non-discoverable, allowCredentials).
//
// Yang DIVERIFIKASI server secara kriptografi (diuji di Node, lihat
// PASSKEY-TEST.md):
//  - challenge acak sekali pakai (5 menit, terikat username + jenis aksi),
//    clientDataJSON (type + challenge + origin yang diizinkan),
//    rpIdHash di authenticatorData, flag User Presence,
//    counter anti-replay, dan TANDA TANGAN ES256 assertion memakai
//    verifikasi ECDSA P-256 penuh (BigInt, runtime V8 Apps Script).
// Yang TIDAK diverifikasi penuh (batasan jujur v1):
//  - Attestation saat pendaftaran: fmt "none" diterima apa adanya dan
//    fmt "packed" hanya diverifikasi bila self-attestation (tanpa x5c).
//    Artinya pendaftaran mempercayai upacara WebAuthn di browser +
//    sesi password yang sudah login — penyerang yang sudah memegang sesi
//    password korban tetap bisa mendaftarkan kuncinya sendiri. Itu
//    sebabnya v1 ini HANYA untuk uji, bukan klaim aman penuh.
//  - Kunci publik disimpan sebagai X/Y mentah di sheet Passkeys (bukan
//    di HSM/enkripsi khusus); hapus barisnya = cabut passkey itu.
//  - Tidak ada rate limiting untuk passkeyLoginStart (username yang
//    belum punya passkey akan dijawab begitu — enumerasi ringan).
// Konfigurasi (Script Properties, opsional): PK_RP_ID (default
// rbcduabelas.github.io), PK_ALLOWED_ORIGINS (default
// https://rbcduabelas.github.io, pisahkan koma bila lebih dari satu).
// ============================================================================
const PASSKEY_SHEET = "Passkeys";
const PK_CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 menit
const PK_P = BigInt("0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF");
const PK_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
const PK_GX = BigInt("0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296");
const PK_GY = BigInt("0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5");

function pkRpId_() {
  return String(PropertiesService.getScriptProperties().getProperty("PK_RP_ID") || "rbcduabelas.github.io").trim();
}
function pkAllowedOrigins_() {
  const raw = String(PropertiesService.getScriptProperties().getProperty("PK_ALLOWED_ORIGINS") || "https://rbcduabelas.github.io");
  return raw.split(",").map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
}
function pkBytesToHex_(bytes) {
  return bytes.map(function (b) { return (b < 0 ? b + 256 : b).toString(16).padStart(2, "0"); }).join("");
}
function pkHexToBytes_(hex) {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substring(i, i + 2), 16));
  return out;
}
function pkBytesToBigInt_(bytes) {
  const hex = pkBytesToHex_(bytes);
  return hex ? BigInt("0x" + hex) : BigInt(0);
}
function pkB64urlEncode_(bytes) {
  const arr = bytes.map(function (b) { return b < 0 ? b + 256 : b; });
  return Utilities.base64EncodeWebSafe(arr).replace(/=+$/, "");
}
function pkB64urlDecode_(s) {
  let t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Utilities.base64Decode(t).map(function (b) { return b < 0 ? b + 256 : b; });
}
function pkStringToBytes_(str) {
  return Utilities.newBlob(String(str || ""), "text/plain").getBytes().map(function (b) { return b < 0 ? b + 256 : b; });
}
function pkBytesToString_(bytes) {
  return Utilities.newBlob(bytes, "application/json").getDataAsString();
}
function pkSha256_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes, Utilities.Charset.UTF_8).map(function (b) { return b < 0 ? b + 256 : b; });
}

// --- Challenge sekali pakai (disimpan di Script Properties, 5 menit) ---
function pkStoreChallenge_(username, kind) {
  const challenge = [];
  for (let i = 0; i < 32; i++) challenge.push(Math.floor(Math.random() * 256));
  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("PKCH_" + token, JSON.stringify({
    username: username, kind: kind,
    challenge: pkB64urlEncode_(challenge),
    expires: new Date().getTime() + PK_CHALLENGE_TTL_MS
  }));
  return { token: token, challenge: pkB64urlEncode_(challenge) };
}
function pkConsumeChallenge_(token, username, kind) {
  const key = "PKCH_" + String(token || "");
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) throw new Error("Passkey: challenge tidak ditemukan atau sudah dipakai. Ulangi dari awal.");
  PropertiesService.getScriptProperties().deleteProperty(key);
  const rec = JSON.parse(raw);
  if (rec.username !== username || rec.kind !== kind) throw new Error("Passkey: challenge tidak cocok dengan aksi ini.");
  if (new Date().getTime() > Number(rec.expires || 0)) throw new Error("Passkey: challenge kedaluwarsa (lebih dari 5 menit). Ulangi dari awal.");
  return rec.challenge;
}

// --- Sheet Passkeys ---
function ensurePasskeysSheet_(ss) {
  let sh = ss.getSheetByName(PASSKEY_SHEET);
  const header = [["Username", "CredentialId", "PubKeyX", "PubKeyY", "Counter", "Created_Millis", "AAGUID"]];
  if (!sh) {
    sh = ss.insertSheet(PASSKEY_SHEET);
    sh.getRange("A1:G1").setValues(header);
  } else if (sh.getLastRow() === 0) {
    sh.getRange("A1:G1").setValues(header);
  }
  return sh;
}
function pkFindCredential_(ss, credentialId) {
  const sh = ss.getSheetByName(PASSKEY_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]) === String(credentialId)) {
      return { row: i + 1, username: String(data[i][0]), credentialId: String(data[i][1]),
        x: String(data[i][2]), y: String(data[i][3]), counter: Number(data[i][4]) || 0,
        created: Number(data[i][5]) || 0, aaguid: String(data[i][6] || "") };
    }
  }
  return null;
}
function pkListForUser_(ss, username) {
  const sh = ss.getSheetByName(PASSKEY_SHEET);
  const out = [];
  if (!sh || sh.getLastRow() < 2) return out;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(username)) {
      out.push({ credentialId: String(data[i][1]), counter: Number(data[i][4]) || 0,
        created: Number(data[i][5]) || 0, aaguid: String(data[i][6] || "") });
    }
  }
  return out;
}

// --- CBOR minimal (decoder saja; cukup untuk attestationObject) ---
// Mendukung major type 0/1 (int), 2 (bytes), 3 (teks ASCII), 4 (array),
// 5 (map), 7 (false/true/null). Float dan tag tidak didukung — sengaja,
// attestationObject WebAuthn tidak memakainya.
function pkCborDecode_(bytes, pos) {
  const initial = bytes[pos];
  const mt = initial >> 5, ai = initial & 31;
  let p = pos + 1, n;
  if (ai < 24) n = ai;
  else if (ai === 24) { n = bytes[p]; p += 1; }
  else if (ai === 25) { n = (bytes[p] << 8) | bytes[p + 1]; p += 2; }
  else if (ai === 26) { n = ((bytes[p] * 256 + bytes[p + 1]) * 256 + bytes[p + 2]) * 256 + bytes[p + 3]; p += 4; }
  else if (ai === 27) {
    const hi = ((bytes[p] * 256 + bytes[p + 1]) * 256 + bytes[p + 2]) * 256 + bytes[p + 3];
    const lo = ((bytes[p + 4] * 256 + bytes[p + 5]) * 256 + bytes[p + 6]) * 256 + bytes[p + 7];
    n = hi * 4294967296 + lo; p += 8;
  } else throw new Error("CBOR: additional info " + ai + " tidak didukung (v1).");
  if (mt === 0) return [n, p];
  if (mt === 1) return [-1 - n, p];
  if (mt === 2) return [bytes.slice(p, p + n), p + n];
  if (mt === 3) {
    let str = "";
    for (let i = 0; i < n; i++) str += String.fromCharCode(bytes[p + i]);
    return [str, p + n];
  }
  if (mt === 4) {
    const arr = [];
    for (let i = 0; i < n; i++) { const r = pkCborDecode_(bytes, p); arr.push(r[0]); p = r[1]; }
    return [arr, p];
  }
  if (mt === 5) {
    const obj = {};
    for (let i = 0; i < n; i++) {
      const kr = pkCborDecode_(bytes, p); p = kr[1];
      const vr = pkCborDecode_(bytes, p); p = vr[1];
      obj[String(kr[0])] = vr[0];
    }
    return [obj, p];
  }
  if (mt === 7) {
    if (n === 20) return [false, p];
    if (n === 21) return [true, p];
    if (n === 22) return [null, p];
    if (n === 23) return [undefined, p];
    throw new Error("CBOR: nilai simple/float tidak didukung (v1).");
  }
  throw new Error("CBOR: major type " + mt + " tidak didukung (v1).");
}

// --- Authenticator data + COSE key ---
function pkParseAuthData_(authData, expectRpIdHash) {
  if (!authData || authData.length < 37) throw new Error("Passkey: authenticatorData terlalu pendek.");
  const rpIdHash = authData.slice(0, 32);
  if (pkBytesToHex_(rpIdHash) !== pkBytesToHex_(expectRpIdHash)) throw new Error("Passkey: rpIdHash tidak cocok.");
  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error("Passkey: authenticator tidak mengonfirmasi kehadiran user (UP).");
  const counter = ((authData[33] * 256 + authData[34]) * 256 + authData[35]) * 256 + authData[36];
  let credential = null;
  if (flags & 0x40) { // AT: ada attested credential data
    let p = 37;
    const aaguid = authData.slice(p, p + 16); p += 16;
    const credLen = (authData[p] << 8) | authData[p + 1]; p += 2;
    if (credLen <= 0 || p + credLen > authData.length) throw new Error("Passkey: panjang credentialId tidak valid.");
    const credId = authData.slice(p, p + credLen); p += credLen;
    const cose = pkCborDecode_(authData, p)[0];
    // COSE key: 1=kty (2=EC2), 3=alg (-7=ES256), -1=crv (1=P-256), -2=x, -3=y
    if (cose["1"] !== 2 || cose["3"] !== -7 || cose["-1"] !== 1) {
      throw new Error("Passkey v1: hanya kunci EC P-256 ES256 yang didukung.");
    }
    const x = cose["-2"], y = cose["-3"];
    if (!x || !y || x.length !== 32 || y.length !== 32) throw new Error("Passkey: kunci publik tidak lengkap.");
    credential = { credentialId: pkB64urlEncode_(credId), x: pkB64urlEncode_(x), y: pkB64urlEncode_(y), aaguid: pkBytesToHex_(aaguid) };
  }
  return { flags: flags, counter: counter, credential: credential };
}

function pkVerifyClientData_(clientDataB64, expectedType, expectedChallengeB64) {
  const bytes = pkB64urlDecode_(clientDataB64);
  let cd;
  try { cd = JSON.parse(pkBytesToString_(bytes)); } catch (e) { throw new Error("Passkey: clientDataJSON tidak bisa dibaca."); }
  if (cd.type !== expectedType) throw new Error("Passkey: tipe clientData salah (" + cd.type + ").");
  if (cd.challenge !== expectedChallengeB64) throw new Error("Passkey: challenge tidak cocok.");
  if (pkAllowedOrigins_().indexOf(cd.origin) === -1) throw new Error("Passkey: origin tidak diizinkan: " + cd.origin);
  return cd;
}

// --- ECDSA P-256 / ES256 (verifikasi tanda tangan, BigInt) ---
function pkMod_(a, m) { const r = a % m; return r >= BigInt(0) ? r : r + m; }
function pkModInv_(a, m) {
  let oldR = pkMod_(a, m), r = m, oldS = BigInt(1), s = BigInt(0);
  while (r !== BigInt(0)) {
    const q = oldR / r;
    const tR = oldR; oldR = r; r = tR - q * r;
    const tS = oldS; oldS = s; s = tS - q * s;
  }
  if (oldR !== BigInt(1)) throw new Error("Passkey: invers modular tidak ada.");
  return pkMod_(oldS, m);
}
function pkPointAdd_(P, Q) {
  if (!P) return Q;
  if (!Q) return P;
  const x1 = P[0], y1 = P[1], x2 = Q[0], y2 = Q[1];
  let lam;
  if (x1 === x2) {
    if (pkMod_(y1 + y2, PK_P) === BigInt(0)) return null;
    lam = pkMod_((BigInt(3) * x1 * x1 - BigInt(3)) * pkModInv_(BigInt(2) * y1, PK_P), PK_P); // a = -3
  } else {
    lam = pkMod_((y2 - y1) * pkModInv_(x2 - x1, PK_P), PK_P);
  }
  const x3 = pkMod_(lam * lam - x1 - x2, PK_P);
  const y3 = pkMod_(lam * (x1 - x3) - y1, PK_P);
  return [x3, y3];
}
function pkPointMul_(k, P) {
  let R = null, A = P;
  while (k > BigInt(0)) {
    if (k & BigInt(1)) R = pkPointAdd_(R, A);
    A = pkPointAdd_(A, A);
    k >>= BigInt(1);
  }
  return R;
}
function pkVerifyEs256_(xB64, yB64, msgBytes, sigBytes) {
  try {
    if (!sigBytes || sigBytes.length !== 64) return false;
    const r = pkBytesToBigInt_(sigBytes.slice(0, 32));
    const s = pkBytesToBigInt_(sigBytes.slice(32, 64));
    if (r <= BigInt(0) || r >= PK_N || s <= BigInt(0) || s >= PK_N) return false;
    const e = pkBytesToBigInt_(pkSha256_(msgBytes)) % PK_N;
    const w = pkModInv_(s, PK_N);
    const u1 = pkMod_(e * w, PK_N);
    const u2 = pkMod_(r * w, PK_N);
    const Q = [pkBytesToBigInt_(pkB64urlDecode_(xB64)), pkBytesToBigInt_(pkB64urlDecode_(yB64))];
    const point = pkPointAdd_(pkPointMul_(u1, [PK_GX, PK_GY]), pkPointMul_(u2, Q));
    if (!point) return false;
    return pkMod_(point[0], PK_N) === r;
  } catch (e) { return false; }
}

const ROLES = { ADMIN: "Admin", PIC: "PIC" };
const TASK_TYPES = ["Harian", "Mingguan", "Bulanan", "Tambahan"];
const DATA_SHEETS = ["Harian", "Mingguan", "Bulanan", "Tambahan", "Overdue"];
const WEEK_DAYS = { "Minggu": 0, "Senin": 1, "Selasa": 2, "Rabu": 3, "Kamis": 4, "Jumat": 5, "Sabtu": 6 };

function setupTemplate() {
  const ss = openSpreadsheet_();
  const kategori = DATA_SHEETS;

  kategori.forEach(kat => {
    let sh = ss.getSheetByName(kat);
    if (!sh) sh = ss.insertSheet(kat);
    if (sh.getLastRow() === 0) {
      sh.getRange("A1:J1").setValues([["ID_Task", "Deskripsi", "Tipe", "Deadline", "Username_PIC", "Status", "Tanggal_Mulai", "Progress", "Original_ID", "Periode_Key"]]);
    }
    if (sh.getLastColumn() < 10) sh.getRange(1, 9, 1, 2).setValues([["Original_ID", "Periode_Key"]]);
  });

  let shRekap = ss.getSheetByName("Rekapan");
  if (!shRekap) {
    shRekap = ss.insertSheet("Rekapan");
    shRekap.getRange("A1:G1").setValues([["Waktu_Selesai", "ID_Task", "Deskripsi", "Tipe", "PIC", "Status", "Rekap_Key"]]);
  } else if (shRekap.getLastColumn() < 7 || shRekap.getRange(1, 7).getValue() !== "Rekap_Key") {
    shRekap.getRange(1, 7).setValue("Rekap_Key");
  }

  let shLibur = ss.getSheetByName("Holidays");
  if (!shLibur) {
    shLibur = ss.insertSheet("Holidays");
    shLibur.getRange("A1").setValue("Tanggal_Libur");
  }
  shLibur.getRange("A:A").setNumberFormat("@");

  let shUsers = ss.getSheetByName("Users");
  if (!shUsers) {
    shUsers = ss.insertSheet("Users");
    shUsers.getRange("A1:G1").setValues([["Username", "Password", "Role", "Nama_Lengkap", "No_WA", "Email", "Password_Hash"]]);
  } else if (shUsers.getLastColumn() < 7 || shUsers.getRange(1, 7).getValue() !== "Password_Hash") {
    shUsers.getRange(1, 7).setValue("Password_Hash");
  }

  // PATCH KEAMANAN: TIDAK ADA akun admin default yang di-seed di sini (fail closed).
  // Admin pertama dibuat manual oleh pemilik lewat fungsi editor-only
  // buatAdminPertamaDariProperties() di bawah (bukan lewat API), setelah itu
  // hapus properti setup-nya. Akun lama yang belum punya hash bersalt TIDAK bisa
  // login sampai admin mereset password-nya — itu disengaja, bukan bug.
  // Header kolom salt (kolom H) ditambahkan untuk password bersalt.
  if (shUsers.getLastColumn() < 8 || shUsers.getRange(1, 8).getValue() !== "Password_Salt") {
    shUsers.getRange(1, 8).setValue("Password_Salt");
  }

  let shSet = ss.getSheetByName("Settings");
  if (!shSet) {
    shSet = ss.insertSheet("Settings");
    shSet.getRange("A1:B1").setValues([["Pengaturan", "Nilai"]]);
    const defaultSettings = [
      ["App_Name", "SIBACOT"],
      ["App_Desc", "Sistem Manajemen & Checklist Tugas Terpadu"],
      ["Token_Fonnte", ""],
      ["No_WA_Admin", ""],
      ["Gunakan_WA", "Ya"],
      ["Gunakan_Email", "Tidak"],
      ["Jam_Notif_Harian", "8, 13, 16"],
      ["Jam_Notif_Mingguan", "8, 13"],
      ["Jam_Notif_Bulanan", "8, 13"],
      ["Jam_Notif_Tambahan", "8"],
      ["H_Min_Mingguan", "2"],
      ["H_Min_Bulanan", "2"],
      ["H_Min_Tambahan", "2"]
    ];
    shSet.getRange(2, 1, defaultSettings.length, 2).setValues(defaultSettings);
  }

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("App_Name")) props.setProperty("App_Name", "SIBACOT");
  if (!props.getProperty("App_Desc")) props.setProperty("App_Desc", "Sistem Manajemen & Checklist Tugas Terpadu");

  ss.getSheets().forEach(sh => {
    const lastCol = sh.getLastColumn();
    if (lastCol > 0) {
      sh.getRange(1, 1, 1, lastCol).setFontWeight("bold").setBackground("#011F7B").setFontColor("white");
      sh.setFrozenRows(1);
    }
  });
  shUsers.getRange(2, 5, 1000, 1).setNumberFormat("@");
  // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 1): sel kontak admin di Settings
  // juga berformat teks, agar nomor 08... tidak dipaksa numerik.
  if (shSet && shSet.getLastRow() > 1) {
    const setRows = shSet.getDataRange().getValues();
    for (let i = 1; i < setRows.length; i++) {
      if (setRows[i][0] === "No_WA_Admin") shSet.getRange(i + 1, 2).setNumberFormat("@");
    }
  }
  // PASSKEY v1 (TEST ONLY): siapkan sheet Passkeys bila belum ada.
  ensurePasskeysSheet_(ss);
  SpreadsheetApp.flush();
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("prosesReminder").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("resetTugasBerulang").timeBased().atHour(1).everyDays(1).create();
}

function doGet(e) {
  // PATCH: jalur HtmlService ini vestigial (frontend nyata ada di GitHub Pages).
  // Judul diselaraskan ke SIBACOT, viewport mengizinkan pinch zoom, dan
  // XFrameOptions ALLOWALL DIHAPUS (kembali ke default yang lebih aman).
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("SIBACOT")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}



function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const result = prosesAPI(payload);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    const body = { status: "error", message: error.toString() };
    if (error && error.code) body.code = error.code;
    return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
  }
}

function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password || ""), Utilities.Charset.UTF_8);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

// LEGACY: fungsi ini dipertahankan untuk kompatibilitas baca, tetapi TIDAK LAGI dipakai untuk otorisasi.
// Otorisasi selalu lewat requireSession_/requireAdminSession_ (token sesi).
function getUserByUsername_(ss, username) {
  if (!username) return null;
  const sh = ss.getSheetByName("Users");
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(username).trim()) {
      return { username: data[i][0], role: data[i][2], nama: data[i][3], wa: normalizeWa_(data[i][4]), email: data[i][5] };
    }
  }
  return null;
}

function requireAdmin_(ss, payload) {
  // PATCH: otorisasi dari token sesi, bukan dari username kiriman client.
  return requireAdminSession_(ss, payload);
}

function canAccessTask_(user, pic) {
  return user && (user.role === "Admin" || String(user.username) === String(pic));
}

function isValidYmd_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const p = String(s).split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

function validateTaskPayload_(payload) {
  if (!payload) return "Payload kosong.";
  const tipe = String(payload.Tipe || "").trim();
  if (!TASK_TYPES.includes(tipe)) return "Tipe tugas tidak valid.";
  if (!String(payload.Deskripsi || "").trim()) return "Deskripsi tugas wajib diisi.";
  if (!String(payload.PIC || "").trim()) return "PIC wajib dipilih.";
  const deadline = String(payload.Deadline || "").trim();
  if (tipe === "Harian") return null;
  if (tipe === "Mingguan" && !Object.prototype.hasOwnProperty.call(WEEK_DAYS, deadline)) return "Deadline mingguan harus berupa nama hari yang valid.";
  if (tipe === "Bulanan") {
    const n = parseInt(deadline, 10);
    if (isNaN(n) || n < 1 || n > 31) return "Deadline bulanan harus angka 1 sampai 31.";
  }
  if (tipe === "Tambahan") {
    if (!isValidYmd_(deadline)) return "Deadline tambahan harus tanggal valid format yyyy-MM-dd.";
    if (payload.Tgl_Mulai && !isValidYmd_(String(payload.Tgl_Mulai))) return "Tanggal mulai harus format yyyy-MM-dd.";
    // Progress bersifat narasi bebas, bukan angka/persentase.
  }
  return null;
}

function validateUserPayload_(user, isEdit) {
  if (!user) return "Data user kosong.";
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(String(user.username || ""))) return "Username minimal 3 karakter dan hanya boleh huruf, angka, titik, underscore, atau strip.";
  if (!String(user.nama || "").trim()) return "Nama lengkap wajib diisi.";
  if (!["Admin", "PIC"].includes(String(user.role))) return "Role tidak valid.";
  // PATCH: saat edit, password boleh kosong = tidak mengubah password lama.
  // Saat buat baru, password wajib dan minimal 6 karakter.
  if (!isEdit && !String(user.password || "").trim()) return "Kata sandi wajib diisi.";
  if (String(user.password || "").trim() && String(user.password).length < 6) return "Kata sandi minimal 6 karakter.";
  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email))) return "Format email tidak valid.";
  // Nomor WA disimpan sebagai string agar nol depan (08...) tidak hilang.
  if (user.wa && !/^\d{8,15}$/.test(String(user.wa).trim())) return "Nomor WA harus angka 8 sampai 15 digit.";
  return null;
}

// PERBAIKAN PASCA-TEST_CHECKLIST 27 Okt 2026 (temuan 1: WA 08 kehilangan nol
// depan). Format "@" di setupTemplate saja TIDAK cukup: sel yang ditulis lewat
// setValues/appendRow pada Sheet yang berformat General tetap dipaksa jadi
// numerik oleh Sheets, sehingga "0812..." tersimpan sebagai 812... dan tidak
// bisa dipulihkan dari nilai itu. Karena itu setiap penulisan WA WAJIB
// memformat sel ke "@" dulu, lalu menulis ulang nilai string-nya. Baris yang
// SUDAH terlanjur terpotong sebelum perbaikan ini tidak bisa dipulihkan
// otomatis — admin harus mengisi ulang nomor WA user tersebut.
// normalizeWa_ hanya menormalisasi representasi, bukan menebak nol yang hilang.
function normalizeWa_(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function writeWaCell_(sh, row, col, wa) {
  const cell = sh.getRange(row, col);
  cell.setNumberFormat("@");
  cell.setValue(normalizeWa_(wa));
}

function getRekapKey_(idTask, ymd) {
  return `${ymd}_${idTask}`;
}


function parseRekapDateYmd_(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, APP_TZ, "yyyy-MM-dd");
  const s = String(val).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}
function getLatestCompletionYmdMap_(ss) {
  const map = {};
  const shRekap = ss.getSheetByName("Rekapan");
  if (!shRekap) return map;
  const data = shRekap.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const idTask = String(data[i][1] || "");
    if (!idTask) continue;
    const ymd = parseRekapDateYmd_(data[i][0]);
    if (!ymd) continue;
    if (!map[idTask] || ymd > map[idTask]) map[idTask] = ymd;
  }
  return map;
}
function cleanupCompletedTambahan_(ss, todayYmd) {
  const sh = ss.getSheetByName("Tambahan");
  if (!sh || sh.getLastRow() < 2) return;
  const completionMap = getLatestCompletionYmdMap_(ss);
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const idTask = String(data[i][0] || "");
    const status = data[i][5];
    const completedYmd = completionMap[idTask] || "";
    if (status === "Selesai" && completedYmd && completedYmd < todayYmd) sh.deleteRow(i + 1);
  }
}

function addDays_(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function ensureOverdueSheet_(ss) {
  let sh = ss.getSheetByName("Overdue");
  if (!sh) sh = ss.insertSheet("Overdue");
  if (sh.getLastRow() === 0) {
    sh.getRange("A1:J1").setValues([["ID_Task", "Deskripsi", "Tipe", "Deadline", "Username_PIC", "Status", "Tanggal_Mulai", "Progress", "Original_ID", "Periode_Key"]]);
  }
  if (sh.getLastColumn() < 10) sh.getRange(1, 9, 1, 2).setValues([["Original_ID", "Periode_Key"]]);
  return sh;
}

function overdueExists_(shOverdue, periodeKey) {
  if (!shOverdue || shOverdue.getLastRow() < 2) return false;
  return shOverdue.getRange(2, 10, shOverdue.getLastRow() - 1, 1).getValues().flat().map(String).includes(String(periodeKey));
}

function createOverdueTask_(ss, sourceRow, dueYmd, label) {
  const shOverdue = ensureOverdueSheet_(ss);
  const originalId = String(sourceRow[0] || "");
  if (!originalId) return;
  const periodeKey = `${originalId}_${dueYmd}`;
  if (overdueExists_(shOverdue, periodeKey)) return;
  shOverdue.appendRow([`OVD-${originalId}-${dueYmd}`, sourceRow[1], sourceRow[2], dueYmd, sourceRow[4], "Belum", dueYmd, `OVERDUE ${label || dueYmd}`, originalId, periodeKey]);
}

// === HOTFIX FINAL 08JUN: ATURAN PERIODE, HARI LIBUR, DAN OVERDUE ===
function toYmd_(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, APP_TZ, "yyyy-MM-dd");
  const s = String(val).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return "";
}
function ymdToDate_(ymd) {
  const p = String(ymd || "").split("-").map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  return new Date(p[0], p[1] - 1, p[2]);
}
function getIsoDayFromDate_(d) {
  const n = parseInt(Utilities.formatDate(d, APP_TZ, "u"), 10);
  return n === 7 ? 7 : n;
}
function getIsoDayFromName_(namaHari) {
  const map = { "Senin": 1, "Selasa": 2, "Rabu": 3, "Kamis": 4, "Jumat": 5, "Sabtu": 6, "Minggu": 7 };
  return map[String(namaHari || "")] || 0;
}
function daysInMonth_(year, month1Based) {
  return new Date(year, month1Based, 0).getDate();
}
function isHolidayYmd_(ss, ymd) {
  const sh = ss.getSheetByName("Holidays");
  if (!sh || sh.getLastRow() < 2) return false;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (bacaTanggalLibur(vals[i][0]) === ymd) return true;
  }
  return false;
}
function endOfMonthYmd_(ymd) {
  const d = ymdToDate_(ymd);
  if (!d) return "";
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return Utilities.formatDate(end, APP_TZ, "yyyy-MM-dd");
}
function shouldShowTaskForPeriod_(row, today, todayYmd, isTodayHoliday) {
  const id = String(row[0] || "");
  const tipe = row[2];
  const deadline = row[3];
  const status = row[5];
  const isOverdue = id.indexOf("OVD-") === 0 || !!row[8];
  if (isOverdue) return true;

  if (tipe === "Harian") {
    // Tugas harian tidak tampil di hari libur dan tidak dibuat overdue untuk hari libur.
    return !isTodayHoliday;
  }
  if (tipe === "Mingguan") {
    const todayIso = getIsoDayFromDate_(today);
    const targetIso = getIsoDayFromName_(deadline);
    if (!targetIso) return true;
    // Jika sudah lewat tenggat minggu ini dan belum selesai, tugas aktif disembunyikan sampai minggu berikutnya.
    if (status !== "Selesai" && todayIso > targetIso) return false;
    // Jika sudah selesai, tetap tampil terceklis sampai minggu baru.
    return true;
  }
  if (tipe === "Bulanan") {
    const dayNow = parseInt(Utilities.formatDate(today, APP_TZ, "d"), 10);
    const monthNow = parseInt(Utilities.formatDate(today, APP_TZ, "M"), 10);
    const yearNow = parseInt(Utilities.formatDate(today, APP_TZ, "yyyy"), 10);
    const targetDate = Math.min(parseInt(deadline, 10) || 1, daysInMonth_(yearNow, monthNow));
    // Jika sudah lewat tenggat bulan ini dan belum selesai, tugas aktif disembunyikan sampai bulan berikutnya.
    if (status !== "Selesai" && dayNow > targetDate) return false;
    // Jika sudah selesai, tetap tampil terceklis sampai bulan baru.
    return true;
  }
  if (tipe === "Tambahan") {
    const deadlineYmd = toYmd_(deadline);
    if (!deadlineYmd) return true;
    if (status === "Selesai") {
      // Tugas tambahan selesai tetap tampil sampai akhir bulan dari tanggal tenggat.
      const endYmd = endOfMonthYmd_(deadlineYmd);
      return !endYmd || todayYmd <= endYmd;
    }
    return true;
  }
  return true;
}
function cleanupAndMoveTambahan_(ss, todayYmd) {
  const sh = ss.getSheetByName("Tambahan");
  if (!sh || sh.getLastRow() < 2) return;
  const data = sh.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    const status = data[i][5];
    const deadlineYmd = toYmd_(data[i][3]);
    if (!deadlineYmd) continue;
    if (status === "Selesai") {
      const endYmd = endOfMonthYmd_(deadlineYmd);
      if (endYmd && todayYmd > endYmd) sh.deleteRow(i + 1);
    } else if (deadlineYmd < todayYmd) {
      createOverdueTask_(ss, data[i], deadlineYmd, formatTanggal(data[i][3]).tampil);
      sh.deleteRow(i + 1);
    }
  }
}

// === HOTFIX OVERDUE SELESAI: HAPUS SESUAI PERIODE ===
function startOfWeekYmd_(ymd) {
  const d = ymdToDate_(ymd);
  if (!d) return "";
  const iso = getIsoDayFromDate_(d); // Senin=1 ... Minggu=7
  d.setDate(d.getDate() - (iso - 1));
  return Utilities.formatDate(d, APP_TZ, "yyyy-MM-dd");
}
function monthKeyYmd_(ymd) {
  return String(ymd || "").substring(0, 7);
}
function shouldDeleteCompletedOverdue_(tipe, completedYmd, todayYmd) {
  if (!completedYmd || !todayYmd) return false;
  if (tipe === "Harian") return completedYmd < todayYmd;
  if (tipe === "Mingguan") return startOfWeekYmd_(completedYmd) < startOfWeekYmd_(todayYmd);
  if (tipe === "Bulanan") return monthKeyYmd_(completedYmd) < monthKeyYmd_(todayYmd);
  if (tipe === "Tambahan") return monthKeyYmd_(completedYmd) < monthKeyYmd_(todayYmd);
  return completedYmd < todayYmd;
}
function cleanupCompletedOverdue_(ss, todayYmd) {
  // KOREKSI 29 Okt 2026 (membalikkan penahanan 5HAL-TEST sebelumnya):
  // arah yang benar dari om: overdue yang sudah diceklis HARUS HILANG di
  // periode berikutnya (Harian: hari berikutnya, Mingguan: minggu
  // berikutnya, Bulanan/Tambahan: bulan berikutnya). Fungsi ini
  // dikembalikan ke logika penghapusan semula, ditambah dua jaring
  // pengaman yang TIDAK mengubah aturan periode di atas:
  // (1) bila Rekapan tidak punya entri untuk ID Overdue (OVD-...),
  //     coba entri untuk Original_ID-nya (kolom I) — ini menutup kasus
  //     Rekapan tercatat atas ID asli, bukan ID Overdue;
  // (2) khusus Harian tanpa entri Rekapan sama sekali: baris Selesai
  //     tetap dihapus di reset 01.00, karena reset 01.00 berarti ceklis
  //     itu sudah terjadi sebelum hari ini (kecuali ceklis 00.00-01.00,
  //     yang praktis tidak terjadi) — jadi "hari berikutnya" terpenuhi.
  // Untuk Mingguan/Bulanan/Tambahan tanpa entri Rekapan, baris TIDAK
  // dihapus (menghindari hapus terlalu dini) dan dicatat di log.
  const sh = ss.getSheetByName("Overdue");
  if (!sh || sh.getLastRow() < 2) return;
  const completionMap = getLatestCompletionYmdMap_(ss);
  const data = sh.getDataRange().getValues();
  let examined = 0, deleted = 0, skippedNoRekapan = 0;
  for (let i = data.length - 1; i >= 1; i--) {
    const idTask = String(data[i][0] || "");
    const tipe = String(data[i][2] || "");
    const status = String(data[i][5] || "");
    if (status !== "Selesai") continue;
    examined++;
    const originalId = String(data[i][8] || "");
    let completedYmd = completionMap[idTask] || (originalId ? completionMap[originalId] : "") || "";
    if (!completedYmd && tipe === "Harian") {
      // Jaring pengaman Harian (lihat komentar di atas).
      sh.deleteRow(i + 1);
      deleted++;
      continue;
    }
    if (!completedYmd) {
      skippedNoRekapan++;
      Logger.log("SIBACOT cleanup overdue: lewati (tanpa Rekapan) id=" + idTask + " tipe=" + tipe);
      continue;
    }
    if (shouldDeleteCompletedOverdue_(tipe, completedYmd, todayYmd)) {
      sh.deleteRow(i + 1);
      deleted++;
    }
  }
  Logger.log("SIBACOT cleanup overdue: diperiksa=" + examined + " dihapus=" + deleted + " dilewatiTanpaRekapan=" + skippedNoRekapan + " tanggal=" + todayYmd);
}
// === END HOTFIX OVERDUE SELESAI ===

// === END HOTFIX FINAL 08JUN ===



function formatTanggal(val) {
  if (!val) return { form: "-", tampil: "-" };
  let formStr = val.toString();
  let tampilStr = val.toString();
  if (val instanceof Date) {
    formStr = Utilities.formatDate(val, APP_TZ, "yyyy-MM-dd");
    tampilStr = Utilities.formatDate(val, APP_TZ, "dd/MM/yyyy");
  } else if (typeof val === "string" && val.match(/^\d{4}-\d{2}-\d{2}/)) {
    formStr = val.substring(0, 10);
    const parts = formStr.split("-");
    tampilStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return { form: formStr, tampil: tampilStr };
}

function bacaTanggalLibur(val) {
  if (!val) return "";
  if (val instanceof Date) return Utilities.formatDate(val, APP_TZ, "yyyy-MM-dd");
  return val.toString().trim().substring(0, 10);
}

function reminderKey_(idTask, tipe, jam) {
  const today = Utilities.formatDate(new Date(), APP_TZ, "yyyy-MM-dd");
  return `REMINDER_${today}_${tipe}_${jam}_${idTask}`;
}
function sudahPernahKirimReminder(idTask, tipe, jam) {
  // PATCH: fungsi ini sekarang HANYA mengecek, tidak menandai. Penandaan dilakukan
  // setelah upaya kirim (lihat prosesReminder), agar gagal kirim bisa dicoba lagi
  // pada run berikutnya di jam yang sama, bukan hilang diam-diam.
  return !!PropertiesService.getScriptProperties().getProperty(reminderKey_(idTask, tipe, jam));
}
function tandaiReminderTerkirim_(idTask, tipe, jam) {
  PropertiesService.getScriptProperties().setProperty(reminderKey_(idTask, tipe, jam), "1");
}
function bersihkanKunciReminderLama_() {
  // PATCH: hapus kunci dedupe yang tanggalnya sudah lewat (sebelum hari ini),
  // agar Script Properties tidak membengkak selamanya.
  try {
    const props = PropertiesService.getScriptProperties();
    const today = Utilities.formatDate(new Date(), APP_TZ, "yyyy-MM-dd");
    const all = props.getProperties();
    Object.keys(all).forEach(k => {
      if (k.indexOf("REMINDER_") !== 0) return;
      const datePart = k.split("_")[1] || "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < today) props.deleteProperty(k);
    });
  } catch (e) {
    Logger.log("SIBACOT: gagal membersihkan kunci reminder lama: " + e.toString());
  }
}

function prosesAPI(payload) {
  try {
    const action = payload.action;
    const ss = openSpreadsheet_();
    // PATCH KEAMANAN: semua aksi kecuali login, identitas publik, dan
    // dua langkah login passkey WAJIB membawa sessionToken valid.
    // Username/peran diambil dari token di server.
    let sessionUser = null;
    if (action !== "login" && action !== "getPublicIdentity" && action !== "passkeyLoginStart" && action !== "passkeyLoginFinish") {
      sessionUser = requireSession_(ss, payload);
    }

    // --- PASSKEY v1 (TEST ONLY) ---
    if (action === "passkeyRegisterStart") {
      const c = pkStoreChallenge_(sessionUser.username, "register");
      return { status: "success", challenge: c.challenge, challengeToken: c.token,
        rpId: pkRpId_(), username: sessionUser.username,
        userId: pkB64urlEncode_(pkStringToBytes_(sessionUser.username)) };
    }

    if (action === "passkeyRegisterFinish") {
      const challengeB64 = pkConsumeChallenge_(payload.challengeToken || "", sessionUser.username, "register");
      pkVerifyClientData_(payload.clientDataJSON || "", "webauthn.create", challengeB64);
      const attObj = pkB64urlDecode_(payload.attestationObject || "");
      const att = pkCborDecode_(attObj, 0)[0];
      if (!att || !att.authData) throw new Error("Passkey: attestationObject tidak bisa dibaca.");
      const rpHash = pkSha256_(pkStringToBytes_(pkRpId_()));
      const parsed = pkParseAuthData_(att.authData, rpHash);
      if (!parsed.credential) throw new Error("Passkey: attestation tidak membawa kredensial.");
      const fmt = att.fmt;
      if (fmt === "none") {
        if (att.attStmt && Object.keys(att.attStmt).length) throw new Error("Passkey: fmt none tapi attStmt tidak kosong.");
        // BATASAN v1 (jujur): fmt none tidak membawa tanda tangan
        // attestation — pendaftaran mempercayai upacara WebAuthn di
        // browser + sesi password yang sudah login (lihat header PASSKEY).
      } else if (fmt === "packed") {
        const stmt = att.attStmt || {};
        if (stmt.x5c) throw new Error("Passkey v1: attestation packed dengan sertifikat (x5c) tidak didukung.");
        if (stmt.alg !== -7 || !stmt.sig) throw new Error("Passkey: attestation packed tidak lengkap.");
        const msg = att.authData.concat(pkSha256_(pkB64urlDecode_(payload.clientDataJSON)));
        if (!pkVerifyEs256_(parsed.credential.x, parsed.credential.y, msg, stmt.sig)) {
          throw new Error("Passkey: verifikasi tanda tangan attestation packed gagal.");
        }
      } else {
        throw new Error("Passkey v1: format attestation '" + fmt + "' tidak didukung (hanya none/packed).");
      }
      if (pkFindCredential_(ss, parsed.credential.credentialId)) {
        return { status: "error", message: "Sidik jari ini sudah terdaftar di akun ini." };
      }
      const shPk = ensurePasskeysSheet_(ss);
      shPk.appendRow([sessionUser.username, parsed.credential.credentialId, parsed.credential.x,
        parsed.credential.y, parsed.counter, new Date().getTime(), parsed.credential.aaguid]);
      SpreadsheetApp.flush();
      return { status: "success", message: "Sidik jari perangkat ini berhasil didaftarkan.", credentialId: parsed.credential.credentialId };
    }

    if (action === "passkeyLoginStart") {
      const username = String(payload.username || "").trim();
      if (!username) return { status: "error", message: "Isi NIP / ID Pengguna dulu." };
      const creds = pkListForUser_(ss, username);
      if (!creds.length) return { status: "error", message: "Belum ada sidik jari terdaftar untuk NIP ini. Login dengan password dulu, lalu daftarkan perangkat ini." };
      const c = pkStoreChallenge_(username, "login");
      return { status: "success", challenge: c.challenge, challengeToken: c.token, rpId: pkRpId_(),
        allowCredentials: creds.map(function (cr) { return { id: cr.credentialId, type: "public-key" }; }) };
    }

    if (action === "passkeyLoginFinish") {
      const username = String(payload.username || "").trim();
      const credentialId = String(payload.credentialId || "");
      const cred = pkFindCredential_(ss, credentialId);
      if (!cred || cred.username !== username) return { status: "error", message: "Kredensial sidik jari tidak dikenali." };
      const challengeB64 = pkConsumeChallenge_(payload.challengeToken || "", username, "login");
      pkVerifyClientData_(payload.clientDataJSON || "", "webauthn.get", challengeB64);
      const authData = pkB64urlDecode_(payload.authenticatorData || "");
      const rpHash = pkSha256_(pkStringToBytes_(pkRpId_()));
      const parsed = pkParseAuthData_(authData, rpHash);
      const msg = authData.concat(pkSha256_(pkB64urlDecode_(payload.clientDataJSON)));
      const sig = pkB64urlDecode_(payload.signature || "");
      if (!pkVerifyEs256_(cred.x, cred.y, msg, sig)) {
        return { status: "error", message: "Passkey: verifikasi tanda tangan gagal." };
      }
      // Anti-replay via counter: naik hanya bila authenticator
      // menghitung (counter 0 = authenticator tanpa counter, dilewati).
      if (parsed.counter > 0) {
        if (parsed.counter <= cred.counter) {
          return { status: "error", message: "Passkey: counter tidak bertambah (kemungkinan replay). Login ditolak." };
        }
        const shPk = ss.getSheetByName(PASSKEY_SHEET);
        if (shPk) shPk.getRange(cred.row, 5).setValue(parsed.counter);
      }
      const shUsersPk = ss.getSheetByName("Users");
      if (!shUsersPk) return { status: "error", message: "Data user tidak ditemukan." };
      const usersPk = shUsersPk.getDataRange().getValues();
      for (let i = 1; i < usersPk.length; i++) {
        if (String(usersPk[i][0] || "").trim() === username) {
          const sessionToken = createSession_(ss, usersPk[i][0], usersPk[i][2]);
          return { status: "success", role: usersPk[i][2], nama: usersPk[i][3], username: usersPk[i][0],
            sessionToken: sessionToken, userVerified: !!(parsed.flags & 0x04) };
        }
      }
      return { status: "error", message: "NIP atau Kata Sandi salah!" };
    }

    if (action === "passkeyList") {
      return { status: "success", passkeys: pkListForUser_(ss, sessionUser.username) };
    }

    if (action === "passkeyDelete") {
      const credentialId = String(payload.credentialId || "");
      const cred = pkFindCredential_(ss, credentialId);
      if (!cred || cred.username !== sessionUser.username) return { status: "error", message: "Sidik jari tidak ditemukan di akun Anda." };
      const shPk = ss.getSheetByName(PASSKEY_SHEET);
      if (shPk) shPk.deleteRow(cred.row);
      return { status: "success", message: "Sidik jari dihapus dari akun Anda." };
    }

    if (action === "login") {
      // PATCH: TIDAK ADA lagi penerimaan password plaintext dan TIDAK ADA
      // migrasi-dari-plaintext saat login. Hanya hash bersalt yang diterima.
      // Pesan error dibuat generik agar tidak membocorkan username mana yang ada.
      const shUsers = ss.getSheetByName("Users");
      if (!shUsers) return { status: "error", message: "NIP atau Kata Sandi salah!" };
      const users = shUsers.getDataRange().getValues();
      const inputUser = String(payload.username || "").trim();
      const inputPass = String(payload.password || "");
      for (let i = 1; i < users.length; i++) {
        const username = String(users[i][0] || "").trim();
        if (username !== inputUser) continue;
        const hash = String(users[i][6] || "");
        const salt = String(users[i][7] || "");
        if (hash && salt && hashPasswordWithSalt_(inputPass, salt) === hash) {
          const role = users[i][2];
          const sessionToken = createSession_(ss, users[i][0], role);
          return { status: "success", role: role, nama: users[i][3], username: users[i][0], sessionToken: sessionToken };
        }
        break;
      }
      return { status: "error", message: "NIP atau Kata Sandi salah!" };
    }

    if (action === "getPublicIdentity") {
      // PATCH: satu-satunya aksi tanpa sesi. Hanya mengembalikan branding
      // non-sensitif untuk layar login. TIDAK ADA tugas, user, setelan, atau token.
      const props = PropertiesService.getScriptProperties();
      return { status: "success", settings: {
        App_Name: props.getProperty("App_Name") || "SIBACOT",
        App_Desc: props.getProperty("App_Desc") || "Sistem Manajemen & Checklist Tugas Terpadu",
        App_Logo_Login: props.getProperty("App_Logo_Login") || "",
        App_Logo_Header: props.getProperty("App_Logo_Header") || "",
        App_Logo_Login_Id: props.getProperty("App_Logo_Login_Id") || "",
        App_Logo_Header_Id: props.getProperty("App_Logo_Header_Id") || ""
      }};
    }

    if (action === "getData") {
      const nowGetData = new Date();
      const todayDateStr = Utilities.formatDate(nowGetData, APP_TZ, "dd/MM/yyyy");
      const todayYmd = Utilities.formatDate(nowGetData, APP_TZ, "yyyy-MM-dd");
      const isTodayHoliday = isHolidayYmd_(ss, todayYmd);
      // Jangan cleanup tugas tambahan saat getData, agar setelah diceklis tetap terlihat sampai periode tampilnya selesai.
      const shRekap = ss.getSheetByName("Rekapan");
      let completedTodayIds = [];
      const rekapDataReturn = [];

      if (shRekap) {
        const rData = shRekap.getDataRange().getValues();
        for (let i = 1; i < rData.length; i++) {
          let waktuRekap = rData[i][0];
          let dateOnly = "";
          if (waktuRekap instanceof Date) {
            dateOnly = Utilities.formatDate(waktuRekap, APP_TZ, "dd/MM/yyyy");
            waktuRekap = Utilities.formatDate(waktuRekap, APP_TZ, "dd/MM/yyyy HH:mm:ss");
          } else if (typeof waktuRekap === "string") {
            dateOnly = waktuRekap.substring(0, 10);
          }
          if (dateOnly === todayDateStr) completedTodayIds.push(rData[i][1]);
          if (sessionUser.role === "Admin") {
            rekapDataReturn.push({ waktu: waktuRekap, id: rData[i][1], deskripsi: rData[i][2], tipe: rData[i][3], pic: rData[i][4] });
          }
        }
      }

      const kategori = DATA_SHEETS;
      let tasksRaw = [];
      kategori.forEach(kat => {
        const sh = ss.getSheetByName(kat);
        if (!sh) return;
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          let taskId = data[i][0];
          let tipe = data[i][2];
          let status = data[i][5];
          // Jangan reset status di getData. Reset hanya oleh trigger resetTugasBerulang saat periode berganti.
          // Semua user PIC dapat melihat seluruh tugas. Hak update tetap dibatasi pada action updateStatus.
          if (!shouldShowTaskForPeriod_(data[i], nowGetData, todayYmd, isTodayHoliday)) continue;
          tasksRaw.push(data[i]);
        }
      });

      // PATCH: direktori user DIBATASI.
      // - Admin: daftar PIC (username+nama saja) + daftar user lengkap untuk kelola user.
      // - Bukan admin: HANYA dirinya sendiri (username, role, nama). Kontak user lain
      //   (nomor WA/email) TIDAK PERNAH dikirim ke user biasa. Ini perubahan perilaku
      //   yang disengaja; UI user biasa memang dikunci ke dirinya sendiri.
      // - Nama PIC untuk label tugas tetap dipetakan dari username (bukan kontak).
      const shUsersGD = ss.getSheetByName("Users");
      if (!shUsersGD) return { status: "error", message: "Data user tidak ditemukan." };
      const usersRaw = shUsersGD.getDataRange().getDisplayValues();
      const shSetGD = ss.getSheetByName("Settings");
      const settingsRaw = shSetGD ? shSetGD.getDataRange().getDisplayValues() : [];
      const pics = [];
      const allUsers = [];
      const userNamesMap = {};
      const isAdminGD = sessionUser.role === "Admin";
      for (let i = 1; i < usersRaw.length; i++) {
        userNamesMap[usersRaw[i][0]] = usersRaw[i][3];
        if (isAdminGD) {
          allUsers.push({ username: usersRaw[i][0], role: usersRaw[i][2], nama: usersRaw[i][3], wa: normalizeWa_(usersRaw[i][4]), email: usersRaw[i][5] });
          if (usersRaw[i][2] === "PIC") pics.push({ username: usersRaw[i][0], nama: usersRaw[i][3] });
        } else if (String(usersRaw[i][0]) === sessionUser.username) {
          allUsers.push({ username: usersRaw[i][0], role: usersRaw[i][2], nama: usersRaw[i][3] });
          if (usersRaw[i][2] === "PIC") pics.push({ username: usersRaw[i][0], nama: usersRaw[i][3] });
        }
      }

      const tasks = tasksRaw.map(d => {
        const tglDeadline = formatTanggal(d[3]);
        const tglMulai = formatTanggal(d[6]);
        return {
          ID_Task: d[0],
          Deskripsi: d[1],
          Tipe: d[2],
          Deadline: tglDeadline.form,
          PIC: d[4],
          Nama_PIC: userNamesMap[d[4]],
          Status: d[5],
          Tgl_Mulai: tglMulai.form,
          Progress: d[7] || "",
          Is_Overdue: String(d[0] || "").indexOf("OVD-") === 0 || !!d[8] || (d[2] === "Tambahan" && d[5] !== "Selesai" && toYmd_(d[3]) && toYmd_(d[3]) < todayYmd),
          Original_ID: d[8] || "",
          Periode_Key: d[9] || ""
        };
      });

      if (sessionUser.role === "Admin") {
        rekapDataReturn.forEach(r => r.nama_pic = userNamesMap[r.pic] || r.pic);
      }

      // PATCH: getData TIDAK PERNAH mengembalikan token gateway, password/hash,
      // atau seluruh Settings. Hanya setelan non-sensitif yang dipakai UI.
      // Admin mendapat tambahan No_WA_Admin + jadwal notifikasi; token gateway
      // tetap TIDAK PERNAH dikembalikan ke client mana pun.
      const NON_SENSITIVE_SETTINGS = ["No_WA_Admin", "Gunakan_WA", "Gunakan_Email",
        "Jam_Notif_Harian", "Jam_Notif_Mingguan", "Jam_Notif_Bulanan", "Jam_Notif_Tambahan",
        "H_Min_Mingguan", "H_Min_Bulanan", "H_Min_Tambahan"];
      let settingsObj = {};
      for (let i = 1; i < settingsRaw.length; i++) {
        if (sessionUser.role === "Admin" && NON_SENSITIVE_SETTINGS.includes(settingsRaw[i][0])) {
          settingsObj[settingsRaw[i][0]] = settingsRaw[i][1];
        }
      }
      const props = PropertiesService.getScriptProperties();
      settingsObj.App_Name = props.getProperty("App_Name") || "SIBACOT";
      settingsObj.App_Desc = props.getProperty("App_Desc") || "Sistem Manajemen & Checklist Tugas Terpadu";
      settingsObj.App_Logo_Login = props.getProperty("App_Logo_Login") || "";
      settingsObj.App_Logo_Header = props.getProperty("App_Logo_Header") || "";
      settingsObj.App_Logo_Login_Id = props.getProperty("App_Logo_Login_Id") || "";
      settingsObj.App_Logo_Header_Id = props.getProperty("App_Logo_Header_Id") || "";

      const holidays = [];
      const shLibur = ss.getSheetByName("Holidays");
      if (shLibur) {
        const hData = shLibur.getDataRange().getValues();
        for (let i = 1; i < hData.length; i++) {
          const tgl = bacaTanggalLibur(hData[i][0]);
          if (tgl) holidays.push(tgl);
        }
      }

      return { status: "success", tasks, pics, allUsers, settings: settingsObj, rekapan: rekapDataReturn, holidays };
    }

    if (action === "addTask") {
      const currentUser = sessionUser;
      if (currentUser.role !== "Admin") payload.PIC = currentUser.username;
      const err = validateTaskPayload_(payload);
      if (err) return { status: "error", message: err };
      const deadline = payload.Tipe === "Harian" ? "-" : payload.Deadline;
      const shTarget = ss.getSheetByName(payload.Tipe);
      if (!shTarget) return { status: "error", message: "Sheet tipe tugas tidak ditemukan." };
      // ID memakai timestamp + angka acak kecil untuk mengurangi risiko tabrakan ms yang sama.
      shTarget.appendRow(["TSK-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000), String(payload.Deskripsi).trim(), payload.Tipe, deadline, payload.PIC, "Belum", payload.Tgl_Mulai || "", payload.Progress || "", "", ""]);
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "updateStatus") {
      const currentUser = sessionUser;
      if (!["Selesai", "Belum"].includes(String(payload.Status))) return { status: "error", message: "Status tidak valid." };
      const kategori = DATA_SHEETS;
      for (let k = 0; k < kategori.length; k++) {
        const sh = ss.getSheetByName(kategori[k]);
        if (!sh) continue;
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) {
            if (!canAccessTask_(currentUser, data[i][4])) return { status: "error", message: "Anda tidak berwenang mengubah status tugas ini." };
            sh.getRange(i + 1, 6).setValue(payload.Status);
            const shRekap = ss.getSheetByName("Rekapan");
            if (!shRekap) return { status: "error", message: "Sheet Rekapan tidak ditemukan." };
            if (shRekap.getLastColumn() < 7 || shRekap.getRange(1, 7).getValue() !== "Rekap_Key") shRekap.getRange(1, 7).setValue("Rekap_Key");
            const rekapData = shRekap.getDataRange().getValues();
            const todayStr = Utilities.formatDate(new Date(), APP_TZ, "dd/MM/yyyy");
            const todayYmd = Utilities.formatDate(new Date(), APP_TZ, "yyyy-MM-dd");
            const rekapKey = getRekapKey_(payload.ID_Task, todayYmd);
            let foundRowIndex = -1;
            for (let r = 1; r < rekapData.length; r++) {
              let rowDate = "";
              if (rekapData[r][0] instanceof Date) rowDate = Utilities.formatDate(rekapData[r][0], APP_TZ, "dd/MM/yyyy");
              else if (typeof rekapData[r][0] === "string") rowDate = rekapData[r][0].substring(0, 10);
              const rowKey = rekapData[r][6];
              if (rowKey === rekapKey || (rekapData[r][1] == payload.ID_Task && rowDate === todayStr)) { foundRowIndex = r + 1; break; }
            }
            if (payload.Status === "Selesai") {
              const waktuBaru = Utilities.formatDate(new Date(), APP_TZ, "dd/MM/yyyy HH:mm:ss");
              const row = [waktuBaru, payload.ID_Task, data[i][1], data[i][2], data[i][4], "Selesai", rekapKey];
              if (foundRowIndex > -1) shRekap.getRange(foundRowIndex, 1, 1, 7).setValues([row]);
              else shRekap.appendRow(row);
            } else if (payload.Status === "Belum" && foundRowIndex > -1) {
              shRekap.deleteRow(foundRowIndex);
            }
            SpreadsheetApp.flush();
            return { status: "success" };
          }
        }
      }
      return { status: "error", message: "Tugas tidak ditemukan." };
    }

    if (action === "editTask") {
      const currentUser = sessionUser;
      const isOverduePayload = String(payload.ID_Task || "").indexOf("OVD-") === 0;
      if (isOverduePayload && currentUser.role !== "Admin") return { status: "error", message: "Tugas overdue hanya dapat diedit oleh Admin." };
      if (currentUser.role !== "Admin") payload.PIC = currentUser.username;
      const err = validateTaskPayload_(payload);
      if (err) return { status: "error", message: err };
      const kategori = DATA_SHEETS;
      for (let k = 0; k < kategori.length; k++) {
        const sh = ss.getSheetByName(kategori[k]);
        if (!sh) continue;
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) {
            const rowIsOverdue = kategori[k] === "Overdue" || String(data[i][0] || "").indexOf("OVD-") === 0 || !!data[i][8];
            if (rowIsOverdue && currentUser.role !== "Admin") return { status: "error", message: "Tugas overdue hanya dapat diedit oleh Admin." };
            if (!rowIsOverdue && !canAccessTask_(currentUser, data[i][4])) return { status: "error", message: "Anda tidak berwenang mengedit tugas ini." };
            let deadline = payload.Tipe === "Harian" ? "-" : payload.Deadline;
            if (rowIsOverdue) {
              // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 3): baris Overdue menyimpan
              // tanggal jatuh tempo ASLI di kolom Deadline (mis. tanggal saat
              // tugas harian itu lewat tenggat). Tipe Harian di backend selalu
              // dipaksa jadi "-", dan form edit overdue menyembunyikan input
              // deadline, sehingga simpan tanpa ubah menimpa tanggal asli itu
              // dengan "-" — kehilangan data diam-diam. Untuk baris overdue,
              // "-" / kosong TIDAK PERNAH boleh menimpa deadline yang ada:
              // pertahankan nilai lama.
              if (!deadline || String(deadline).trim() === "-") deadline = String(data[i][3] || "");
              // Overdue tetap berada di sheet Overdue. Admin boleh mengubah uraian, tipe, deadline, PIC, mulai, dan progress.
              sh.getRange(i + 1, 2, 1, 4).setValues([[String(payload.Deskripsi).trim(), payload.Tipe, deadline, payload.PIC]]);
              sh.getRange(i + 1, 7, 1, 2).setValues([[payload.Tgl_Mulai || "", payload.Progress || ""]]);
            } else if (data[i][2] !== payload.Tipe) {
              sh.deleteRow(i + 1);
              ss.getSheetByName(payload.Tipe).appendRow([payload.ID_Task, String(payload.Deskripsi).trim(), payload.Tipe, deadline, payload.PIC, data[i][5], payload.Tgl_Mulai || "", payload.Progress || "", data[i][8] || "", data[i][9] || ""]);
            } else {
              sh.getRange(i + 1, 2, 1, 4).setValues([[String(payload.Deskripsi).trim(), payload.Tipe, deadline, payload.PIC]]);
              sh.getRange(i + 1, 7, 1, 2).setValues([[payload.Tgl_Mulai || "", payload.Progress || ""]]);
            }
            SpreadsheetApp.flush();
            return { status: "success" };
          }
        }
      }
      return { status: "error", message: "Tugas tidak ditemukan." };
    }
    if (action === "deleteTask") {
      requireAdmin_(ss, payload);
      const kategori = DATA_SHEETS;
      for (let k = 0; k < kategori.length; k++) {
        const sh = ss.getSheetByName(kategori[k]);
        if (!sh) continue;
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) { sh.deleteRow(i + 1); SpreadsheetApp.flush(); return { status: "success" }; }
        }
      }
      return { status: "error", message: "Tugas tidak ditemukan." };
    }

    if (action === "saveUser") {
      requireAdmin_(ss, payload);
      const sh = ss.getSheetByName("Users");
      if (!sh) return { status: "error", message: "Sheet Users tidak ditemukan." };
      if (sh.getLastColumn() < 7 || sh.getRange(1, 7).getValue() !== "Password_Hash") sh.getRange(1, 7).setValue("Password_Hash");
      if (sh.getLastColumn() < 8 || sh.getRange(1, 8).getValue() !== "Password_Salt") sh.getRange(1, 8).setValue("Password_Salt");
      const data = sh.getDataRange().getValues();
      let isEdit = false;
      for (let i = 1; i < data.length; i++) if (data[i][0] === payload.user.username) { isEdit = true; break; }
      const err = validateUserPayload_(payload.user, isEdit);
      if (err) return { status: "error", message: err };
      const waStr = normalizeWa_(payload.user.wa);
      let passHash = "";
      let passSalt = "";
      if (String(payload.user.password || "").trim()) {
        passSalt = newSalt_();
        passHash = hashPasswordWithSalt_(payload.user.password, passSalt);
      }
      let found = false;
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === payload.user.username) {
          // PATCH: password kosong saat edit = pertahankan hash & salt lama.
          if (!passHash) { passHash = String(data[i][6] || ""); passSalt = String(data[i][7] || ""); }
          if (!passHash) return { status: "error", message: "User lama belum punya password bersalt. Isi password baru untuk user ini." };
          sh.getRange(i + 1, 5).setNumberFormat("@");
          sh.getRange(i + 1, 1, 1, 8).setValues([[payload.user.username, "", payload.user.role, payload.user.nama, waStr, payload.user.email, passHash, passSalt]]);
          // Tegaskan lagi sebagai teks setelah tulis, agar Sheets tidak memaksa numerik.
          writeWaCell_(sh, i + 1, 5, waStr);
          found = true; break;
        }
      }
      if (!found) {
        sh.appendRow([payload.user.username, "", payload.user.role, payload.user.nama, waStr, payload.user.email, passHash, passSalt]);
        writeWaCell_(sh, sh.getLastRow(), 5, waStr);
      }
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "deleteUser") {
      const adminUser = requireAdmin_(ss, payload);
      if (payload.username === "admin") return { status: "error", message: "Admin utama tidak boleh dihapus." };
      if (payload.username === adminUser.username) return { status: "error", message: "Admin tidak boleh menghapus akunnya sendiri." };
      const sh = ss.getSheetByName("Users");
      if (!sh) return { status: "error", message: "Sheet Users tidak ditemukan." };
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == payload.username) {
          sh.deleteRow(i + 1);
          invalidateSessionsForUser_(ss, payload.username);
          SpreadsheetApp.flush();
          return { status: "success" };
        }
      }
      // PATCH: sebelumnya aksi ini jatuh tanpa JSON bila user tidak ditemukan.
      return { status: "error", message: "User tidak ditemukan." };
    }

    if (action === "saveSettings") {
      requireAdmin_(ss, payload);
      const sheet = ss.getSheetByName("Settings");
      if (!sheet) return { status: "error", message: "Sheet Settings tidak ditemukan." };
      // PATCH: allowlist. Token gateway TIDAK PERNAH diubah lewat aksi ini
      // (dan tidak pernah dikirim kembali oleh getData). Rotasi token dilakukan
      // pemilik langsung di Sheet Settings — lihat ROTASI_LIVE.md.
      const ALLOWED_SETTINGS = ["No_WA_Admin", "Gunakan_WA", "Gunakan_Email",
        "Jam_Notif_Harian", "Jam_Notif_Mingguan", "Jam_Notif_Bulanan", "Jam_Notif_Tambahan",
        "H_Min_Mingguan", "H_Min_Bulanan", "H_Min_Tambahan"];
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const key = data[i][0];
        if (ALLOWED_SETTINGS.includes(key) && payload.settings && payload.settings.hasOwnProperty(key)) {
          // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 1): kontak admin juga WA,
          // jadi selnya wajib berformat teks "@" sebelum ditulis.
          if (key === "No_WA_Admin") writeWaCell_(sheet, i + 1, 2, payload.settings[key]);
          else sheet.getRange(i + 1, 2).setValue(payload.settings[key]);
        }
      }
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "saveHolidays") {
      requireAdmin_(ss, payload);
      const shLibur = ss.getSheetByName("Holidays");
      if (!shLibur) return { status: "error", message: "Sheet Holidays tidak ditemukan." };
      shLibur.clear();
      shLibur.getRange("A1").setValue("Tanggal_Libur");
      shLibur.getRange("A:A").setNumberFormat("@");
      if (payload.holidays && payload.holidays.length > 0) {
        const cleanHolidays = [...new Set(payload.holidays.map(h => String(h).trim().substring(0, 10)).filter(isValidYmd_))].sort();
        shLibur.getRange(2, 1, cleanHolidays.length, 1).setValues(cleanHolidays.map(h => [h]));
      }
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "setupTriggers") {
      requireAdmin_(ss, payload);
      try {
        setupTriggers();
        return { status: "success", message: "Trigger otomatis berhasil diaktifkan! Notifikasi WA/Email akan dicek setiap ±10 menit (hemat kuota Apps Script)." };
      } catch (e) {
        return { status: "error", message: "Gagal: " + e.toString() + ". Pastikan Anda sudah otorisasi script." };
      }
    }

    if (action === "testNotif") {
      requireAdmin_(ss, payload);
      const dataSettings = ss.getSheetByName("Settings").getDataRange().getValues();
      const set = {};
      for (let i = 1; i < dataSettings.length; i++) set[dataSettings[i][0]] = dataSettings[i][1];
      const props = PropertiesService.getScriptProperties();
      const appName = props.getProperty("App_Name") || "SIBACOT";
      const waktu = Utilities.formatDate(new Date(), APP_TZ, "dd/MM/yyyy HH:mm:ss");
      const pesan = `🔔 *TEST NOTIFIKASI ${appName}*\n\nIni pesan uji coba dari sistem.\nJika Anda menerima pesan ini, notifikasi berfungsi dengan baik!\n\n_Dikirim: ${waktu}_`;
      if (payload.channel === "wa") {
        if (!set.Token_Fonnte) return { status: "error", message: "Token Fonnte belum diisi di Pengaturan Sistem." };
        if (!payload.target) return { status: "error", message: "Nomor WA tidak ditemukan. Pastikan No WA Anda sudah diisi di data User." };
        const sent = kirimFonnte(payload.target, pesan, set.Token_Fonnte);
        if (!sent) return { status: "error", message: "Gagal mengirim WA uji coba. Periksa token gateway dan coba lagi (lihat log Apps Script)." };
        return { status: "success", message: "Pesan WA uji coba dikirim ke " + payload.target };
      }
      if (payload.channel === "email") {
        if (!payload.target) return { status: "error", message: "Alamat email tidak ditemukan. Pastikan email Anda sudah diisi di data User." };
        MailApp.sendEmail({ to: payload.target, subject: "[TEST] Notifikasi " + appName, body: pesan });
        return { status: "success", message: "Email uji coba dikirim ke " + payload.target };
      }
      return { status: "error", message: "Channel tidak dikenali." };
    }

    if (action === "saveIdentity") {
      // PATCH: sudah dibatasi ke sesi admin oleh requireAdmin_ di bawah, ditambah
      // validasi: nama/deskripsi dibatasi panjangnya, logo hanya PNG/JPEG dan
      // maksimal 2 MB setelah decode. Token/sesi tidak pernah ditulis ke Drive.
      requireAdmin_(ss, payload);
      try {
        const props = PropertiesService.getScriptProperties();
        const appNameIn = String((payload.settings && payload.settings.App_Name) || "").trim();
        const appDescIn = String((payload.settings && payload.settings.App_Desc) || "").trim();
        if (!appNameIn || appNameIn.length > 100) return { status: "error", message: "Nama aplikasi wajib diisi (maksimal 100 karakter)." };
        if (appDescIn.length > 200) return { status: "error", message: "Deskripsi aplikasi maksimal 200 karakter." };
        props.setProperty("App_Name", appNameIn);
        props.setProperty("App_Desc", appDescIn);
        let result = { status: "success" };
        if (payload.settings.App_Logo_Login_Base64) {
          try {
            const oldId = props.getProperty("App_Logo_Login_Id");
            if (oldId) DriveApp.getFileById(oldId).setTrashed(true);
          } catch (e) {}
          try {
            let parts = payload.settings.App_Logo_Login_Base64.split(",");
            let mimeType = parts[0].match(/:(.*?);/)[1];
            if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new Error("Logo login harus PNG atau JPEG.");
            let decoded = Utilities.base64Decode(parts[1]);
            if (decoded.length > 2 * 1024 * 1024) throw new Error("Logo login maksimal 2 MB.");
            let blob = Utilities.newBlob(decoded, mimeType, "logo_login_" + new Date().getTime());
            let file = DriveApp.getRootFolder().createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            props.setProperty("App_Logo_Login_Id", file.getId());
            result.loginId = file.getId();
          } catch (e) {
            result.loginError = e.toString();
          }
        }
        if (payload.settings.App_Logo_Header_Base64) {
          try {
            const oldId = props.getProperty("App_Logo_Header_Id");
            if (oldId) DriveApp.getFileById(oldId).setTrashed(true);
          } catch (e) {}
          try {
            let parts = payload.settings.App_Logo_Header_Base64.split(",");
            let mimeType = parts[0].match(/:(.*?);/)[1];
            if (mimeType !== "image/png" && mimeType !== "image/jpeg") throw new Error("Logo header harus PNG atau JPEG.");
            let decoded = Utilities.base64Decode(parts[1]);
            if (decoded.length > 2 * 1024 * 1024) throw new Error("Logo header maksimal 2 MB.");
            let blob = Utilities.newBlob(decoded, mimeType, "logo_header_" + new Date().getTime());
            let file = DriveApp.getRootFolder().createFile(blob);
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            props.setProperty("App_Logo_Header_Id", file.getId());
            result.headerId = file.getId();
          } catch (e) {
            result.headerError = e.toString();
          }
        }
        return result;
      } catch (error) {
        return { status: "error", message: error.toString() };
      }
    }

    return { status: "error", message: "Aksi tidak dikenali server." };
  } catch (error) {
    // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 2, akar masalah): catch ini
    // sebelumnya MEMBUANG error.code, sehingga SESSION_EXPIRED dari
    // requireSession_ sampai ke frontend hanya sebagai error generik tanpa
    // kode — frontend tidak bisa membedakannya dari error biasa dan hanya
    // menampilkan toast, dashboard lama tetap terlihat. Pertahankan kodenya.
    const body = { status: "error", message: error.toString() };
    if (error && error.code) body.code = error.code;
    return body;
  }
}


// ============================================================================
// ADMIN PERTAMA — HANYA DIJALANKAN MANUAL DARI EDITOR APPS SCRIPT, BUKAN API.
// Cara pakai (lihat ROTASI_LIVE.md langkah 3):
//  1. Di Script Properties, isi SIBACOT_SHEET_ID (ID spreadsheet) + lima properti
//     setup: SIBACOT_FIRST_ADMIN_USERNAME, SIBACOT_FIRST_ADMIN_NAMA,
//     SIBACOT_FIRST_ADMIN_WA, SIBACOT_FIRST_ADMIN_EMAIL, SIBACOT_FIRST_ADMIN_PASSWORD.
//  2. Jalankan fungsi ini sekali dari editor. 3. Hapus kelima properti setup itu.
// Fungsi ini MENOLAK berjalan bila sudah ada akun Admin mana pun (fail closed),
// dan tidak pernah mengembalikan password ke mana pun (hanya dicatat di log
// editor bahwa akun dibuat, tanpa nilainya).
// ============================================================================
function buatAdminPertamaDariProperties() {
  const props = PropertiesService.getScriptProperties();
  const ss = openSpreadsheet_();
  const sh = ss.getSheetByName("Users");
  if (!sh) throw new Error("Sheet Users tidak ditemukan. Jalankan setupTemplate dulu.");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === "Admin") throw new Error("Sudah ada akun Admin. Fungsi ini menolak berjalan (fail closed).");
  }
  const username = String(props.getProperty("SIBACOT_FIRST_ADMIN_USERNAME") || "").trim();
  const nama = String(props.getProperty("SIBACOT_FIRST_ADMIN_NAMA") || "").trim();
  const wa = String(props.getProperty("SIBACOT_FIRST_ADMIN_WA") || "").trim();
  const email = String(props.getProperty("SIBACOT_FIRST_ADMIN_EMAIL") || "").trim();
  const password = String(props.getProperty("SIBACOT_FIRST_ADMIN_PASSWORD") || "");
  if (!username || !nama || password.length < 6) throw new Error("Properti setup admin pertama belum lengkap / password kurang dari 6 karakter.");
  if (!/^\d{8,15}$/.test(wa)) throw new Error("Nomor WA setup harus 8-15 digit.");
  if (sh.getLastColumn() < 8 || sh.getRange(1, 8).getValue() !== "Password_Salt") sh.getRange(1, 8).setValue("Password_Salt");
  const salt = newSalt_();
  sh.appendRow([username, "", "Admin", nama, wa, email, hashPasswordWithSalt_(password, salt), salt]);
  // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 1): tegaskan WA admin pertama sebagai teks.
  writeWaCell_(sh, sh.getLastRow(), 5, wa);
  SpreadsheetApp.flush();
  Logger.log("SIBACOT: admin pertama berhasil dibuat untuk username yang diset di properti. HAPUS kelima properti setup sekarang.");
}


// Editor-only kedua: setel ulang password SATU akun yang sudah ada (untuk
// bootstrap setelah patch, karena password lama tanpa salt tidak lagi diterima).
// Properti: SIBACOT_RESET_USERNAME, SIBACOT_RESET_PASSWORD (minimal 6 karakter).
// Setelah berhasil, HAPUS kedua properti itu dan sesi lama akun tersebut dibatalkan.
// Fungsi ini TIDAK terekspos lewat API.
function setelUlangPasswordAdminDariProperties() {
  const props = PropertiesService.getScriptProperties();
  const ss = openSpreadsheet_();
  const sh = ss.getSheetByName("Users");
  if (!sh) throw new Error("Sheet Users tidak ditemukan.");
  const username = String(props.getProperty("SIBACOT_RESET_USERNAME") || "").trim();
  const password = String(props.getProperty("SIBACOT_RESET_PASSWORD") || "");
  if (!username || password.length < 6) throw new Error("Properti reset belum lengkap / password kurang dari 6 karakter.");
  if (sh.getLastColumn() < 8 || sh.getRange(1, 8).getValue() !== "Password_Salt") sh.getRange(1, 8).setValue("Password_Salt");
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === username) {
      const salt = newSalt_();
      sh.getRange(i + 1, 2).setValue("");
      sh.getRange(i + 1, 7).setValue(hashPasswordWithSalt_(password, salt));
      sh.getRange(i + 1, 8).setValue(salt);
      invalidateSessionsForUser_(ss, username);
      SpreadsheetApp.flush();
      Logger.log("SIBACOT: password berhasil disetel ulang untuk username yang diset di properti. HAPUS properti reset sekarang.");
      return;
    }
  }
  throw new Error("Username reset tidak ditemukan di sheet Users.");
}

function resetTugasBerulang() {
  const ss = openSpreadsheet_();
  ensureOverdueSheet_(ss);
  const now = new Date();
  const todayYmd = Utilities.formatDate(now, APP_TZ, "yyyy-MM-dd");
  const yesterday = addDays_(now, -1);
  const yesterdayYmd = Utilities.formatDate(yesterday, APP_TZ, "yyyy-MM-dd");
  const todayIso = getIsoDayFromDate_(now);
  const yestIso = getIsoDayFromDate_(yesterday);
  const todayDate = parseInt(Utilities.formatDate(now, APP_TZ, "d"), 10);
  const yestDate = parseInt(Utilities.formatDate(yesterday, APP_TZ, "d"), 10);
  const yestMonth = parseInt(Utilities.formatDate(yesterday, APP_TZ, "M"), 10);
  const yestYear = parseInt(Utilities.formatDate(yesterday, APP_TZ, "yyyy"), 10);
  const todayHoliday = isHolidayYmd_(ss, todayYmd);
  const yesterdayHoliday = isHolidayYmd_(ss, yesterdayYmd);

  // Harian: hari libur tidak dibuat overdue.
  const shHarian = ss.getSheetByName("Harian");
  if (shHarian && shHarian.getLastRow() >= 2) {
    const data = shHarian.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const status = data[i][5];
      if (!yesterdayHoliday) {
        if (status !== "Selesai") createOverdueTask_(ss, data[i], yesterdayYmd, Utilities.formatDate(yesterday, APP_TZ, "dd/MM/yyyy"));
        if (status === "Selesai") shHarian.getRange(i + 1, 6).setValue("Belum");
      } else if (!todayHoliday && status === "Selesai") {
        shHarian.getRange(i + 1, 6).setValue("Belum");
      }
    }
  }

  // Mingguan: lewat tenggat menjadi overdue; selesai tetap terceklis sampai minggu baru.
  const shMingguan = ss.getSheetByName("Mingguan");
  if (shMingguan && shMingguan.getLastRow() >= 2) {
    const data = shMingguan.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const deadlineIso = getIsoDayFromName_(data[i][3]);
      const status = data[i][5];
      if (deadlineIso && deadlineIso === yestIso && status !== "Selesai") createOverdueTask_(ss, data[i], yesterdayYmd, Utilities.formatDate(yesterday, APP_TZ, "dd/MM/yyyy"));
      if (todayIso === 1 && status === "Selesai") shMingguan.getRange(i + 1, 6).setValue("Belum");
    }
  }

  // Bulanan: lewat tenggat menjadi overdue; selesai tetap terceklis sampai bulan baru.
  const shBulanan = ss.getSheetByName("Bulanan");
  if (shBulanan && shBulanan.getLastRow() >= 2) {
    const data = shBulanan.getDataRange().getValues();
    const lastDayYestMonth = daysInMonth_(yestYear, yestMonth);
    for (let i = 1; i < data.length; i++) {
      const rawTarget = parseInt(data[i][3], 10);
      const targetDate = Math.min(isNaN(rawTarget) ? 1 : rawTarget, lastDayYestMonth);
      const status = data[i][5];
      if (targetDate === yestDate && status !== "Selesai") createOverdueTask_(ss, data[i], yesterdayYmd, Utilities.formatDate(yesterday, APP_TZ, "dd/MM/yyyy"));
      if (todayDate === 1 && status === "Selesai") shBulanan.getRange(i + 1, 6).setValue("Belum");
    }
  }

  // Tambahan: lewat tenggat pindah ke Overdue; selesai tampil sampai akhir bulan tenggat.
  cleanupAndMoveTambahan_(ss, todayYmd);
  // KOREKSI 29 Okt 2026: overdue yang sudah diceklis HARUS HILANG di
  // periode berikutnya (Harian: hari berikutnya, Mingguan: minggu
  // berikutnya, Bulanan/Tambahan: bulan berikutnya). Pemanggilan ini
  // dikembalikan setelah sempat dinonaktifkan atas penafsiran yang
  // keliru pada 5HAL-TEST sebelumnya.
  cleanupCompletedOverdue_(ss, todayYmd);
  Logger.log("SIBACOT resetTugasBerulang selesai tanggal=" + todayYmd);
  SpreadsheetApp.flush();
}

function prosesReminder() {
  bersihkanKunciReminderLama_();
  const now = new Date();
  const jamSekarang = parseInt(Utilities.formatDate(now, APP_TZ, "HH"));
  const ss = openSpreadsheet_();
  const hariIniStr = Utilities.formatDate(now, APP_TZ, "yyyy-MM-dd");
  const shLibur = ss.getSheetByName("Holidays");
  if (shLibur) {
    const dataLibur = shLibur.getDataRange().getValues();
    for (let i = 1; i < dataLibur.length; i++) {
      if (bacaTanggalLibur(dataLibur[i][0]) === hariIniStr) return;
    }
  }

  const dataUsers = ss.getSheetByName("Users").getDataRange().getValues();
  const dataSettings = ss.getSheetByName("Settings").getDataRange().getValues();
  const set = {};
  for (let i = 1; i < dataSettings.length; i++) set[dataSettings[i][0]] = dataSettings[i][1];
  const userMap = {};
  for (let i = 1; i < dataUsers.length; i++) userMap[dataUsers[i][0]] = { nama: dataUsers[i][3], wa: normalizeWa_(dataUsers[i][4]), email: dataUsers[i][5] };
  const currentAppName = PropertiesService.getScriptProperties().getProperty("App_Name") || "SIBACOT";
  const currDay = parseInt(Utilities.formatDate(now, APP_TZ, "u")) % 7;
  const currDate = parseInt(Utilities.formatDate(now, APP_TZ, "d"));
  const currYear = parseInt(Utilities.formatDate(now, APP_TZ, "yyyy"));
  const currMonth = parseInt(Utilities.formatDate(now, APP_TZ, "M"));
  const hariIniLocal = new Date(Utilities.formatDate(now, APP_TZ, "yyyy-MM-dd") + "T00:00:00");
  const mapHari = { "Minggu": 0, "Senin": 1, "Selasa": 2, "Rabu": 3, "Kamis": 4, "Jumat": 5, "Sabtu": 6 };

  DATA_SHEETS.forEach(kat => {
    const sh = ss.getSheetByName(kat);
    if (!sh) return;
    const dataTasks = sh.getDataRange().getValues();
    for (let i = 1; i < dataTasks.length; i++) {
      const [id, deskripsi, tipe, deadline, pic, status] = dataTasks[i];
      const isOverdueTask = kat === "Overdue" || String(id || "").indexOf("OVD-") === 0;
      if (status === "Selesai" || !userMap[pic]) continue;
      const jamNotifValid = (set[`Jam_Notif_${tipe}`] || "8").toString().split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (!jamNotifValid.includes(jamSekarang)) continue;

      let selisihHari = -1;
      let isHariH = false;
      let tglStr = deadline;
      if (tipe === "Harian") {
        selisihHari = 0;
        isHariH = true;
        tglStr = isOverdueTask ? `Overdue sejak ${formatTanggal(deadline).tampil}` : "Hari ini";
      } else if (tipe === "Mingguan") {
        const targetDay = mapHari[deadline];
        if (targetDay === undefined) continue;
        selisihHari = targetDay >= currDay ? targetDay - currDay : 7 - currDay + targetDay;
        isHariH = selisihHari === 0;
        tglStr = isOverdueTask ? `Overdue sejak ${formatTanggal(deadline).tampil}` : `Setiap ${deadline}`;
      } else if (tipe === "Bulanan") {
        const targetDate = parseInt(deadline);
        if (isNaN(targetDate)) continue;
        const daysInMonth = new Date(currYear, currMonth, 0).getDate();
        selisihHari = targetDate >= currDate ? targetDate - currDate : daysInMonth - currDate + targetDate;
        isHariH = selisihHari === 0;
        tglStr = isOverdueTask ? `Overdue sejak ${formatTanggal(deadline).tampil}` : `Tanggal ${deadline} setiap bulan`;
      } else if (tipe === "Tambahan") {
        if (!deadline) continue;
        const deadlineObj = deadline instanceof Date ? deadline : new Date(String(deadline).substring(0, 10) + "T00:00:00");
        deadlineObj.setHours(0, 0, 0, 0);
        selisihHari = Math.round((deadlineObj - hariIniLocal) / 86400000);
        isHariH = selisihHari === 0;
        tglStr = Utilities.formatDate(deadlineObj, APP_TZ, "dd/MM/yyyy");
      }

      let harusKirim = isOverdueTask || tipe === "Harian";
      if (tipe !== "Harian") {
        const hMin = parseInt(set[`H_Min_${tipe}`]) || 2;
        if ((selisihHari > 0 && selisihHari <= hMin) || isHariH || selisihHari < 0) harusKirim = true;
      }
      if (!harusKirim) continue;
      if (sudahPernahKirimReminder(id, tipe, jamSekarang)) continue;

      const pesan = `🚨 *PEMBERITAHUAN TUGAS*\n\nHalo ${userMap[pic].nama},\nMohon selesaikan tugas berikut:\n*${deskripsi}*\n\nTipe: ${tipe}\nBatas: ${tglStr}\n\n_Sistem Otomatis ${currentAppName}_`;
      // PATCH: kegagalan kirim DICATAT, bukan ditelan diam-diam. Kunci dedupe
      // hanya ditandai setelah upaya kirim, agar gagal kirim bisa dicoba lagi
      // pada run berikutnya di jam yang sama.
      let attempted = false;
      let failed = false;
      try {
        if (set.Gunakan_WA === "Ya" && set.Token_Fonnte && userMap[pic].wa) {
          attempted = true;
          if (!kirimFonnte(userMap[pic].wa, pesan, set.Token_Fonnte)) failed = true;
        }
      } catch (e) { failed = true; Logger.log("SIBACOT: gagal kirim WA reminder untuk tugas " + id + ": " + e.toString()); }
      try {
        if (set.Gunakan_Email === "Ya" && userMap[pic].email) {
          attempted = true;
          MailApp.sendEmail({ to: userMap[pic].email, subject: "Tugas: " + deskripsi, body: pesan });
        }
      } catch (e) { failed = true; Logger.log("SIBACOT: gagal kirim email reminder untuk tugas " + id + ": " + e.toString()); }
      if (attempted && !failed) tandaiReminderTerkirim_(id, tipe, jamSekarang);
      else if (attempted && failed) Logger.log("SIBACOT: reminder tugas " + id + " GAGAL dikirim; akan dicoba lagi pada run berikutnya di jam yang sama.");
    }
  });
}

function kirimFonnte(noWA, pesan, token) {
  // PATCH: mengembalikan true/false dan mencatat kegagalan, bukan menelan error.
  // Token TIDAK PERNAH ditulis ke log.
  // PERBAIKAN PASCA-TEST_CHECKLIST (temuan 4): Fonnte membalas HTTP 200
  // dengan body JSON {"status": false, "reason": "token invalid"} untuk token
  // tidak valid (didokumentasikan di docs Fonnte: token salah -> status false).
  // Versi lama hanya mengecek kode HTTP, sehingga gagal kirim itu dilaporkan
  // sukses dan prosesReminder() menandai dedupe terkirim. Sekarang body JSON
  // di-parse: bila field "status" ada dan bernilai false (boolean, string
  // "false", atau 0), kirim dianggap GAGAL. Bila body tidak ter-parse atau
  // tidak punya field status, perilaku lama dipertahankan (2xx = sukses),
  // agar bentuk sukses lain dari gateway (mis. berisi id/process) tidak
  // tiba-tiba dianggap gagal. Hanya reason/detail yang dicatat ke log,
  // BUKAN seluruh body dan BUKAN token.
  try {
    const resp = UrlFetchApp.fetch("https://api.fonnte.com/send", {
      method: "post",
      headers: { Authorization: token },
      payload: { target: String(noWA), message: pesan },
      muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log("SIBACOT: kirim WA gagal, HTTP " + code + " (isi respons tidak dicatat).");
      return false;
    }
    let parsed = null;
    try { parsed = JSON.parse(resp.getContentText()); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === "object" && "status" in parsed) {
      const st = parsed.status;
      if (st === false || st === "false" || st === 0 || st === "0") {
        const reason = parsed.reason || parsed.detail || "";
        Logger.log("SIBACOT: kirim WA gagal menurut body gateway (status=false)" + (reason ? ": " + String(reason) : "") + ".");
        return false;
      }
    }
    return true;
  } catch (e) {
    Logger.log("SIBACOT: kirim WA gagal (exception): " + e.toString());
    return false;
  }
}
