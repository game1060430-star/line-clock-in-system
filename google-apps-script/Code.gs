const SPREADSHEET_ID = '';
const TZ = 'Asia/Taipei';

const SHEETS = {
  EMPLOYEES: 'Employees',
  LOGS: 'Attendance_Logs',
  REQUESTS: 'Correction_Requests'
};

const HEADERS = {
  [SHEETS.EMPLOYEES]: ['LINE ID', '員工姓名', '狀態(啟用/停用)'],
  [SHEETS.LOGS]: ['LINE ID', '員工姓名', '日期', '實際打卡時間', '系統修正時間(30分單位)', '打卡類型(上班/下班)', '備註/來源(正常打卡/管理者補卡)', '紀錄ID', '狀態(納入/取消)'],
  [SHEETS.REQUESTS]: ['申請ID', 'LINE ID', '員工姓名', '日期', '類型(上班/下班)', '員工自述時間', '原因備註', '狀態(待審核/已核准/已拒絕)']
};

const DEFAULT_SETTINGS = {
  siteName: '店面',
  latitude: '25.033964',
  longitude: '121.564468',
  radiusMeters: '100',
  adminPin: '1234'
};

function doGet() {
  setup();
  return jsonOutput({ ok: true, message: 'LINE GPS clock API is ready.' });
}

function doPost(e) {
  setup();
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'getBootstrap') return jsonOutput({ ok: true, payload: getBootstrap() });
    if (action === 'clock') return jsonOutput({ ok: true, payload: saveClock(payload) });
    if (action === 'getMonthlySummary') return jsonOutput({ ok: true, payload: getMonthlySummary(payload.lineUserId, payload.month) });
    if (action === 'saveSettings') return jsonOutput({ ok: true, payload: saveSettings(payload) });
    if (action === 'saveEmployee') return jsonOutput({ ok: true, payload: saveEmployee(payload) });
    if (action === 'deleteEmployee') return jsonOutput({ ok: true, payload: setEmployeeStatus(payload.lineUserId, '停用') });
    if (action === 'saveCorrectionRequest') return jsonOutput({ ok: true, payload: saveCorrectionRequest(payload) });
    if (action === 'reviewCorrectionRequest') return jsonOutput({ ok: true, payload: reviewCorrectionRequest(payload) });
    if (action === 'updateClockLogStatus') return jsonOutput({ ok: true, payload: updateClockLogStatus(payload) });
    return jsonOutput({ ok: false, error: 'Unknown action: ' + action });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function setup() {
  Object.keys(HEADERS).forEach(name => ensureSheet(name, HEADERS[name]));
  const employees = rowsAsObjects(SHEETS.EMPLOYEES);
  if (employees.length === 0) {
    appendObject(SHEETS.EMPLOYEES, { 'LINE ID': '', '員工姓名': '測試員工', '狀態(啟用/停用)': '啟用' });
  }
  seedSettings();
}

function getBootstrap() {
  const logs = rowsAsObjects(SHEETS.LOGS);
  return {
    settings: readSettings(),
    employees: rowsAsObjects(SHEETS.EMPLOYEES).filter(row => row['狀態(啟用/停用)'] !== '停用'),
    requests: rowsAsObjects(SHEETS.REQUESTS),
    logs: logs,
    summaries: monthlySummaries(logs)
  };
}

function saveClock(payload) {
  const now = new Date();
  const actualTime = normalizeTime(payload.actualTime) || formatTime(now);
  const date = normalizeDate(payload.date) || formatDate(now);
  const type = normalizeType(payload.type);
  const lineUserId = payload.lineUserId || '';
  const employee = findEmployee(lineUserId) || {};
  const employeeName = payload.employeeName || employee['員工姓名'] || payload.displayName || '';
  const roundedTime = roundToNearestHalfHour(actualTime);
  const source = payload.source || '正常打卡';
  const noteParts = [source, payload.locationStatus, payload.distance !== undefined && payload.distance !== '' ? ('距離 ' + payload.distance + ' 公尺') : '', payload.note || ''].filter(Boolean);
  const row = {
    'LINE ID': lineUserId,
    '員工姓名': employeeName,
    '日期': date,
    '實際打卡時間': actualTime,
    '系統修正時間(30分單位)': roundedTime,
    '打卡類型(上班/下班)': type,
    '備註/來源(正常打卡/管理者補卡)': noteParts.join('；'),
    '紀錄ID': payload.logId || Utilities.getUuid(),
    '狀態(納入/取消)': payload.status || '納入'
  };
  appendObject(SHEETS.LOGS, row);
  return Object.assign({}, row, { monthlySummary: getMonthlySummary(lineUserId, date.slice(0, 7)) });
}

function saveCorrectionRequest(payload) {
  const lineUserId = payload.lineUserId || '';
  const employee = findEmployee(lineUserId) || {};
  const row = {
    '申請ID': payload.requestId || Utilities.getUuid(),
    'LINE ID': lineUserId,
    '員工姓名': payload.employeeName || employee['員工姓名'] || '',
    '日期': normalizeDate(payload.date),
    '類型(上班/下班)': normalizeType(payload.type),
    '員工自述時間': normalizeTime(payload.claimedTime),
    '原因備註': payload.reason || '',
    '狀態(待審核/已核准/已拒絕)': '待審核'
  };
  appendObject(SHEETS.REQUESTS, row);
  return row;
}

function reviewCorrectionRequest(payload) {
  const requestId = payload.requestId;
  const status = payload.status === 'approved' ? '已核准' : '已拒絕';
  const sheet = getSpreadsheet().getSheetByName(SHEETS.REQUESTS);
  const rows = sheet.getDataRange().getValues();
  const headers = HEADERS[SHEETS.REQUESTS];
  const idIndex = headers.indexOf('申請ID');
  const statusIndex = headers.indexOf('狀態(待審核/已核准/已拒絕)');
  let request = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === requestId) {
      request = rowToObject(headers, rows[i]);
      sheet.getRange(i + 1, statusIndex + 1).setValue(status);
      break;
    }
  }
  if (!request) throw new Error('Request not found');
  if (status === '已核准') {
    saveClock({
      lineUserId: request['LINE ID'],
      employeeName: request['員工姓名'],
      date: request['日期'],
      type: request['類型(上班/下班)'],
      actualTime: payload.finalTime || request['員工自述時間'],
      source: '管理者補卡',
      note: request['原因備註']
    });
  }
  return Object.assign({}, request, { '狀態(待審核/已核准/已拒絕)': status });
}

function getMonthlySummary(lineUserId, month) {
  const targetMonth = month || formatDate(new Date()).slice(0, 7);
  const logs = rowsAsObjects(SHEETS.LOGS).filter(row =>
    row['LINE ID'] === lineUserId &&
    normalizeDate(row['日期']).slice(0, 7) === targetMonth &&
    normalizeLogStatus(row) !== '取消'
  );
  return calculateSummary(logs, targetMonth);
}

function monthlySummaries(logs) {
  const byKey = {};
  logs.forEach(log => {
    const date = normalizeDate(log['日期']);
    const key = [log['LINE ID'], date.slice(0, 7)].join('|');
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(log);
  });
  return Object.keys(byKey).map(key => {
    const parts = key.split('|');
    const summary = calculateSummary(byKey[key], parts[1]);
    return Object.assign({ lineUserId: parts[0], month: parts[1] }, summary);
  });
}

function calculateSummary(logs, month) {
  const byDate = {};
  logs.forEach(log => {
    const date = normalizeDate(log['日期']);
    if (normalizeLogStatus(log) === '取消') return;
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(log);
  });
  let totalHours = 0;
  const days = [];
  Object.keys(byDate).sort().forEach(date => {
    const records = byDate[date];
    const ins = records.filter(row => normalizeType(row['打卡類型(上班/下班)']) === '上班').map(row => minutesOfDay(row['系統修正時間(30分單位)']));
    const outs = records.filter(row => normalizeType(row['打卡類型(上班/下班)']) === '下班').map(row => minutesOfDay(row['系統修正時間(30分單位)']));
    if (ins.length === 0 || outs.length === 0) {
      days.push({ date: date, hours: 0, status: '缺卡' });
      return;
    }
    const start = Math.min.apply(null, ins);
    let end = Math.max.apply(null, outs);
    if (end < start) end += 1440;
    const hours = Math.round(((end - start) / 60) * 10) / 10;
    totalHours += hours;
    days.push({ date: date, hours: hours, status: '完成' });
  });
  return { month: month, totalHours: Math.round(totalHours * 10) / 10, workDays: days.filter(day => day.hours > 0).length };
}

function roundToNearestHalfHour(timeText) {
  const minutes = minutesOfDay(timeText);
  const rounded = Math.floor((minutes + 14) / 30) * 30;
  return timeFromMinutes(rounded);
}

function normalizeType(type) {
  const text = String(type || '').toLowerCase();
  if (text === 'on' || text === 'in' || text === '上班') return '上班';
  if (text === 'off' || text === 'out' || text === '下班') return '下班';
  return type || '上班';
}

function normalizeLogStatus(log) {
  return log['狀態(納入/取消)'] || '納入';
}

function updateClockLogStatus(payload) {
  const logId = payload.logId;
  const status = payload.status === 'cancelled' || payload.status === '取消' ? '取消' : '納入';
  const sheet = getSpreadsheet().getSheetByName(SHEETS.LOGS);
  const rows = sheet.getDataRange().getValues();
  const headers = HEADERS[SHEETS.LOGS];
  const idIndex = headers.indexOf('紀錄ID');
  const statusIndex = headers.indexOf('狀態(納入/取消)');
  if (idIndex < 0 || statusIndex < 0) throw new Error('Log status columns are missing');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === logId) {
      sheet.getRange(i + 1, statusIndex + 1).setValue(status);
      return { logId: logId, status: status };
    }
  }
  throw new Error('Clock log not found');
}

function normalizeDate(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate(value);
  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return match[1] + '-' + match[2] + '-' + match[3];
  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) return formatDate(parsed);
  return text;
}

function normalizeTime(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatTime(value);
  const text = String(value);
  const plain = text.match(/^(\d{1,2}):(\d{2})/);
  if (plain) return String(Number(plain[1])).padStart(2, '0') + ':' + plain[2];
  const iso = text.match(/T(\d{2}):(\d{2})/);
  if (iso) return iso[1] + ':' + iso[2];
  return text;
}

function minutesOfDay(timeText) {
  const parts = normalizeTime(timeText).split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function timeFromMinutes(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = String(Math.floor(normalized / 60)).padStart(2, '0');
  const m = String(normalized % 60).padStart(2, '0');
  return h + ':' + m;
}

function formatDate(date) {
  return Utilities.formatDate(date, TZ, 'yyyy-MM-dd');
}

function formatTime(date) {
  return Utilities.formatDate(date, TZ, 'HH:mm');
}

function saveEmployee(payload) {
  const row = {
    'LINE ID': payload.lineUserId || payload['LINE ID'] || '',
    '員工姓名': payload.name || payload.employeeName || payload['員工姓名'] || '',
    '狀態(啟用/停用)': payload.status || payload['狀態(啟用/停用)'] || '啟用'
  };
  if (!row['員工姓名']) throw new Error('Employee name is required');
  upsertEmployee(row);
  return row;
}

function setEmployeeStatus(lineUserId, status) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPLOYEES);
  const rows = sheet.getDataRange().getValues();
  const headers = HEADERS[SHEETS.EMPLOYEES];
  const lineIndex = headers.indexOf('LINE ID');
  const statusIndex = headers.indexOf('狀態(啟用/停用)');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][lineIndex] === lineUserId) {
      sheet.getRange(i + 1, statusIndex + 1).setValue(status);
      return { lineUserId: lineUserId, status: status };
    }
  }
  return { lineUserId: lineUserId, status: status };
}

function findEmployee(lineUserId) {
  return rowsAsObjects(SHEETS.EMPLOYEES).find(row => row['LINE ID'] === lineUserId && row['狀態(啟用/停用)'] !== '停用');
}

function upsertEmployee(row) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.EMPLOYEES);
  const headers = HEADERS[SHEETS.EMPLOYEES];
  const rows = sheet.getDataRange().getValues();
  const lineIndex = headers.indexOf('LINE ID');
  const nameIndex = headers.indexOf('員工姓名');
  for (let i = 1; i < rows.length; i++) {
    if ((row['LINE ID'] && rows[i][lineIndex] === row['LINE ID']) || (!row['LINE ID'] && rows[i][nameIndex] === row['員工姓名'])) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([headers.map(header => row[header] || '')]);
      return row;
    }
  }
  appendObject(SHEETS.EMPLOYEES, row);
  return row;
}

function saveSettings(settings) {
  const props = PropertiesService.getScriptProperties();
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (settings[key] !== undefined) props.setProperty(key, String(settings[key]));
  });
  return readSettings();
}

function readSettings() {
  const props = PropertiesService.getScriptProperties();
  const result = {};
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    result[key] = props.getProperty(key) || DEFAULT_SETTINGS[key];
  });
  return result;
}

function seedSettings() {
  const props = PropertiesService.getScriptProperties();
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (!props.getProperty(key)) props.setProperty(key, DEFAULT_SETTINGS[key]);
  });
}

function ensureSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const range = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length));
  const existing = range.getValues()[0].slice(0, headers.length);
  const empty = existing.every(cell => cell === '');
  const mismatch = headers.some((header, index) => existing[index] !== header);
  if (empty || mismatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rowsAsObjects(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = HEADERS[sheetName];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.filter(row => row.some(cell => cell !== '')).map(row => rowToObject(headers, row));
}

function rowToObject(headers, row) {
  return headers.reduce((object, header, index) => {
    object[header] = row[index];
    return object;
  }, {});
}

function appendObject(sheetName, object) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(headers.map(header => object[header] === undefined ? '' : object[header]));
}

function getSpreadsheet() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
