const SHEET_ID = "1qES2JP7cE0g0gNWD1mb6-T0r2frgtYrR2th9fI4FU1s";
const APP_TZ = "Asia/Jayapura";
const ROLES = { ADMIN: "Admin", PIC: "PIC" };
const TASK_TYPES = ["Harian", "Mingguan", "Bulanan", "Tambahan"];
const DATA_SHEETS = ["Harian", "Mingguan", "Bulanan", "Tambahan", "Overdue"];
const WEEK_DAYS = { "Minggu": 0, "Senin": 1, "Selasa": 2, "Rabu": 3, "Kamis": 4, "Jumat": 5, "Sabtu": 6 };

function setupTemplate() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
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

  const dataUsers = shUsers.getDataRange().getValues();
  let adminExists = false;
  for (let i = 1; i < dataUsers.length; i++) {
    if (dataUsers[i][0] === "admin") {
      adminExists = true;
      // Jangan timpa password admin lama. Jika masih plain text, migrasikan ke hash.
      if (!dataUsers[i][6] && dataUsers[i][1]) {
        shUsers.getRange(i + 1, 7).setValue(hashPassword_(dataUsers[i][1]));
        shUsers.getRange(i + 1, 2).setValue("");
      } else if (!dataUsers[i][6] && !dataUsers[i][1]) {
        shUsers.getRange(i + 1, 7).setValue(hashPassword_("admin123"));
      }
      break;
    }
  }
  if (!adminExists) {
    shUsers.appendRow(["admin", "", "Admin", "Administrator", "081234567890", "admin@email.com", hashPassword_("admin123")]);
  }
  migratePlainPasswords_();

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
  SpreadsheetApp.flush();
}

function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("prosesReminder").timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger("resetTugasBerulang").timeBased().atHour(1).everyDays(1).create();
}

function doGet(e) {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Ko Seklis Dolo")
    .addMetaTag("viewport", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}



function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const payload = JSON.parse(raw);
    const result = prosesAPI(payload);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}

function hashPassword_(password) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(password || ""), Utilities.Charset.UTF_8);
  return digest.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, "0")).join("");
}

function migratePlainPasswords_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName("Users");
  if (!sh || sh.getLastRow() < 2) return;
  if (sh.getLastColumn() < 7 || sh.getRange(1, 7).getValue() !== "Password_Hash") sh.getRange(1, 7).setValue("Password_Hash");
  const data = sh.getRange(2, 1, sh.getLastRow() - 1, Math.max(7, sh.getLastColumn())).getValues();
  for (let i = 0; i < data.length; i++) {
    const plain = data[i][1];
    const hash = data[i][6];
    if (plain && !hash) {
      sh.getRange(i + 2, 7).setValue(hashPassword_(plain));
      sh.getRange(i + 2, 2).setValue("");
    }
  }
}

function getUserByUsername_(ss, username) {
  if (!username) return null;
  const sh = ss.getSheetByName("Users");
  if (!sh) return null;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(username).trim()) {
      return { username: data[i][0], role: data[i][2], nama: data[i][3], wa: data[i][4], email: data[i][5] };
    }
  }
  return null;
}

function requireAdmin_(ss, payload) {
  const user = getUserByUsername_(ss, payload.sessionUsername || payload.username);
  if (!user || user.role !== "Admin") throw new Error("Akses ditolak. Fitur ini hanya untuk Admin.");
  return user;
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

function validateUserPayload_(user) {
  if (!user) return "Data user kosong.";
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(String(user.username || ""))) return "Username minimal 3 karakter dan hanya boleh huruf, angka, titik, underscore, atau strip.";
  if (!String(user.nama || "").trim()) return "Nama lengkap wajib diisi.";
  if (!["Admin", "PIC"].includes(String(user.role))) return "Role tidak valid.";
  if (!String(user.password || "").trim()) return "Kata sandi wajib diisi.";
  if (String(user.password).length < 6) return "Kata sandi minimal 6 karakter.";
  if (user.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(user.email))) return "Format email tidak valid.";
  if (user.wa && !/^\d{8,15}$/.test(String(user.wa))) return "Nomor WA harus angka 8 sampai 15 digit.";
  return null;
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

function sudahPernahKirimReminder(idTask, tipe, jam) {
  const today = Utilities.formatDate(new Date(), APP_TZ, "yyyy-MM-dd");
  const key = `REMINDER_${today}_${tipe}_${jam}_${idTask}`;
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) return true;
  props.setProperty(key, "1");
  return false;
}

function prosesAPI(payload) {
  try {
    const action = payload.action;
    const ss = SpreadsheetApp.openById(SHEET_ID);

    if (action === "login") {
      migratePlainPasswords_();
      const shUsers = ss.getSheetByName("Users");
      const users = shUsers.getDataRange().getValues();
      const inputUser = String(payload.username || "").trim();
      const inputPass = String(payload.password || "");
      const inputHash = hashPassword_(inputPass);
      for (let i = 1; i < users.length; i++) {
        const username = String(users[i][0] || "").trim();
        const plain = String(users[i][1] || "");
        const hash = String(users[i][6] || "");
        if (username === inputUser && ((hash && hash === inputHash) || (plain && plain === inputPass))) {
          if (plain) {
            shUsers.getRange(i + 1, 7).setValue(inputHash);
            shUsers.getRange(i + 1, 2).setValue("");
          }
          return { status: "success", role: users[i][2], nama: users[i][3], username: users[i][0] };
        }
      }
      return { status: "error", message: "NIP atau Kata Sandi salah!" };
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
          if (payload.role === "Admin") {
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

      const usersRaw = ss.getSheetByName("Users").getDataRange().getDisplayValues();
      const settingsRaw = ss.getSheetByName("Settings").getDataRange().getDisplayValues();
      const pics = [];
      const allUsers = [];
      const userNamesMap = {};
      for (let i = 1; i < usersRaw.length; i++) {
        userNamesMap[usersRaw[i][0]] = usersRaw[i][3];
        allUsers.push({ username: usersRaw[i][0], role: usersRaw[i][2], nama: usersRaw[i][3], wa: usersRaw[i][4], email: usersRaw[i][5] });
        if (usersRaw[i][2] === "PIC") pics.push({ username: usersRaw[i][0], nama: usersRaw[i][3] });
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

      if (payload.role === "Admin") {
        rekapDataReturn.forEach(r => r.nama_pic = userNamesMap[r.pic] || r.pic);
      }

      let settingsObj = {};
      for (let i = 1; i < settingsRaw.length; i++) settingsObj[settingsRaw[i][0]] = settingsRaw[i][1];
      const props = PropertiesService.getScriptProperties();
      settingsObj.App_Name = props.getProperty("App_Name") || "SIBACOT";
      settingsObj.App_Desc = props.getProperty("App_Desc") || "Sistem Manajemen & Checklist Tugas Terpadu";
      settingsObj.App_Logo_Login = props.getProperty("App_Logo_Login") || "https://upload.wikimedia.org/wikipedia/commons/a/a2/Logo_of_Bank_Mandiri.svg";
      settingsObj.App_Logo_Header = props.getProperty("App_Logo_Header") || "https://upload.wikimedia.org/wikipedia/commons/a/a2/Logo_of_Bank_Mandiri.svg";
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
      const currentUser = getUserByUsername_(ss, payload.sessionUsername || payload.username);
      if (!currentUser) return { status: "error", message: "Sesi user tidak valid." };
      if (currentUser.role !== "Admin") payload.PIC = currentUser.username;
      const err = validateTaskPayload_(payload);
      if (err) return { status: "error", message: err };
      const deadline = payload.Tipe === "Harian" ? "-" : payload.Deadline;
      ss.getSheetByName(payload.Tipe).appendRow(["TSK-" + new Date().getTime(), String(payload.Deskripsi).trim(), payload.Tipe, deadline, payload.PIC, "Belum", payload.Tgl_Mulai || "", payload.Progress || "", "", ""]);
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "updateStatus") {
      const currentUser = getUserByUsername_(ss, payload.sessionUsername || payload.username);
      if (!["Selesai", "Belum"].includes(String(payload.Status))) return { status: "error", message: "Status tidak valid." };
      const kategori = DATA_SHEETS;
      for (let k = 0; k < kategori.length; k++) {
        const sh = ss.getSheetByName(kategori[k]);
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) {
            if (!canAccessTask_(currentUser, data[i][4])) return { status: "error", message: "Anda tidak berwenang mengubah status tugas ini." };
            sh.getRange(i + 1, 6).setValue(payload.Status);
            const shRekap = ss.getSheetByName("Rekapan");
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
      const currentUser = getUserByUsername_(ss, payload.sessionUsername || payload.username);
      if (!currentUser) return { status: "error", message: "Sesi user tidak valid." };
      if (String(payload.ID_Task || "").indexOf("OVD-") === 0) return { status: "error", message: "Tugas overdue tidak dapat diedit. Selesaikan atau edit tugas asalnya." };
      if (currentUser.role !== "Admin") payload.PIC = currentUser.username;
      const err = validateTaskPayload_(payload);
      if (err) return { status: "error", message: err };
      const kategori = DATA_SHEETS;
      for (let k = 0; k < kategori.length; k++) {
        const sh = ss.getSheetByName(kategori[k]);
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) {
            if (!canAccessTask_(currentUser, data[i][4])) return { status: "error", message: "Anda tidak berwenang mengedit tugas ini." };
            const deadline = payload.Tipe === "Harian" ? "-" : payload.Deadline;
            if (data[i][2] !== payload.Tipe) {
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
        const data = sh.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] == payload.ID_Task) { sh.deleteRow(i + 1); SpreadsheetApp.flush(); return { status: "success" }; }
        }
      }
      return { status: "error", message: "Tugas tidak ditemukan." };
    }

    if (action === "saveUser") {
      requireAdmin_(ss, payload);
      const err = validateUserPayload_(payload.user);
      if (err) return { status: "error", message: err };
      const sh = ss.getSheetByName("Users");
      if (sh.getLastColumn() < 7 || sh.getRange(1, 7).getValue() !== "Password_Hash") sh.getRange(1, 7).setValue("Password_Hash");
      const data = sh.getDataRange().getValues();
      let isEdit = false;
      const passHash = hashPassword_(payload.user.password);
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === payload.user.username) {
          sh.getRange(i + 1, 1, 1, 7).setValues([[payload.user.username, "", payload.user.role, payload.user.nama, payload.user.wa, payload.user.email, passHash]]);
          isEdit = true; break;
        }
      }
      if (!isEdit) sh.appendRow([payload.user.username, "", payload.user.role, payload.user.nama, payload.user.wa, payload.user.email, passHash]);
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "deleteUser") {
      requireAdmin_(ss, payload);
      if (payload.username === "admin") return { status: "error", message: "Admin utama tidak boleh dihapus." };
      const sh = ss.getSheetByName("Users");
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == payload.username) {
          sh.deleteRow(i + 1);
          SpreadsheetApp.flush();
          return { status: "success" };
        }
      }
    }

    if (action === "saveSettings") {
      requireAdmin_(ss, payload);
      const sheet = ss.getSheetByName("Settings");
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const key = data[i][0];
        if (payload.settings.hasOwnProperty(key)) sheet.getRange(i + 1, 2).setValue(payload.settings[key]);
      }
      SpreadsheetApp.flush();
      return { status: "success" };
    }

    if (action === "saveHolidays") {
      requireAdmin_(ss, payload);
      const shLibur = ss.getSheetByName("Holidays");
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
        return { status: "success", message: "Trigger otomatis berhasil diaktifkan! Notifikasi WA/Email akan dicek setiap ±1 menit agar lebih mendekati jam yang diatur." };
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
        kirimFonnte(payload.target, pesan, set.Token_Fonnte);
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
      requireAdmin_(ss, payload);
      try {
        const props = PropertiesService.getScriptProperties();
        props.setProperty("App_Name", payload.settings.App_Name);
        props.setProperty("App_Desc", payload.settings.App_Desc);
        let result = { status: "success" };
        if (payload.settings.App_Logo_Login_Base64) {
          try {
            const oldId = props.getProperty("App_Logo_Login_Id");
            if (oldId) DriveApp.getFileById(oldId).setTrashed(true);
          } catch (e) {}
          try {
            let parts = payload.settings.App_Logo_Login_Base64.split(",");
            let mimeType = parts[0].match(/:(.*?);/)[1];
            let decoded = Utilities.base64Decode(parts[1]);
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
            let decoded = Utilities.base64Decode(parts[1]);
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
    return { status: "error", message: error.toString() };
  }
}

function resetTugasBerulang() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
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
  SpreadsheetApp.flush();
}

function prosesReminder() {
  const now = new Date();
  const jamSekarang = parseInt(Utilities.formatDate(now, APP_TZ, "HH"));
  const ss = SpreadsheetApp.openById(SHEET_ID);
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
  for (let i = 1; i < dataUsers.length; i++) userMap[dataUsers[i][0]] = { nama: dataUsers[i][3], wa: dataUsers[i][4], email: dataUsers[i][5] };
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
      if (set.Gunakan_WA === "Ya" && set.Token_Fonnte && userMap[pic].wa) kirimFonnte(userMap[pic].wa, pesan, set.Token_Fonnte);
      if (set.Gunakan_Email === "Ya" && userMap[pic].email) MailApp.sendEmail({ to: userMap[pic].email, subject: "Tugas: " + deskripsi, body: pesan });
    }
  });
}

function kirimFonnte(noWA, pesan, token) {
  UrlFetchApp.fetch("https://api.fonnte.com/send", {
    method: "post",
    headers: { Authorization: token },
    payload: { target: noWA, message: pesan },
    muteHttpExceptions: true
  });
}
