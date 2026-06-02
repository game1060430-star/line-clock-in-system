const SPREADSHEET_ID = '';

const SHEETS = {
  SETTINGS: '設定',
  EMPLOYEES: '員工',
  WEEKLY_SCHEDULES: '每週固定班',
  SCHEDULES: '每日排班',
  SHIFTS: '班別',
  RAW: '打卡明細',
  DAILY: '每日出勤'
};

const HEADERS = {
  [SHEETS.SETTINGS]: ['key', 'value'],
  [SHEETS.EMPLOYEES]: ['id', 'name', 'hourlyRate', 'workStart', 'workEnd', 'inGrace', 'outGrace', 'breakMinutes', 'lineUserId', 'active'],
  [SHEETS.WEEKLY_SCHEDULES]: ['id', 'employeeId', 'weekday', 'start', 'end', 'inGrace', 'outGrace', 'breakMinutes', 'note', 'active'],
  [SHEETS.SCHEDULES]: ['id', 'date', 'employeeId', 'start', 'end', 'inGrace', 'outGrace', 'breakMinutes', 'note', 'active'],
  [SHEETS.SHIFTS]: ['id', 'name', 'start', 'end', 'inGrace', 'outGrace', 'breakMinutes', 'active'],
  [SHEETS.RAW]: ['id', 'date', 'employeeId', 'employeeName', 'lineUserId', 'type', 'actualTime', 'countedTime', 'shiftId', 'shiftName', 'clockStatus', 'locationStatus', 'distance', 'locationText', 'note', 'createdAt'],
  [SHEETS.DAILY]: ['dailyKey', 'date', 'employeeId', 'employeeName', 'lineUserId', 'shiftId', 'shiftName', 'inActual', 'inCounted', 'inStatus', 'outActual', 'outCounted', 'outStatus', 'locationStatus', 'distance', 'note', 'hours', 'pay', 'updatedAt']
};

const DEFAULT_SETTINGS = {
  siteName: '總店',
  latitude: '25.033964',
  longitude: '121.564468',
  radiusMeters: '200',
  adminPin: '1234'
};

function doGet() {
  setup();
  return jsonOutput({ ok: true, message: 'LINE clock-in API is ready.' });
}

function doPost(e) {
  setup();
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    const payload = body.payload || {};
    if (action === 'getBootstrap') return jsonOutput({ ok: true, payload: getBootstrap() });
    if (action === 'clock') return jsonOutput({ ok: true, payload: saveClock(payload) });
    if (action === 'saveSettings') return jsonOutput({ ok: true, payload: saveSettings(payload) });
    if (action === 'saveEmployee') return jsonOutput({ ok: true, payload: saveEmployee(payload) });
    if (action === 'deleteEmployee') return jsonOutput({ ok: true, payload: setActive(SHEETS.EMPLOYEES, payload.id, false) });
    if (action === 'saveWeeklySchedule') return jsonOutput({ ok: true, payload: saveWeeklySchedule(payload) });
    if (action === 'deleteWeeklySchedule') return jsonOutput({ ok: true, payload: setActive(SHEETS.WEEKLY_SCHEDULES, payload.id, false) });
    if (action === 'saveSchedule') return jsonOutput({ ok: true, payload: saveSchedule(payload) });
    if (action === 'deleteSchedule') return jsonOutput({ ok: true, payload: setActive(SHEETS.SCHEDULES, payload.id, false) });
    if (action === 'saveShift') return jsonOutput({ ok: true, payload: saveShift(payload) });
    if (action === 'deleteShift') return jsonOutput({ ok: true, payload: setActive(SHEETS.SHIFTS, payload.id, false) });
    return jsonOutput({ ok: false, error: 'Unknown action: ' + action });
  } catch (error) {
    return jsonOutput({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function setup() {
  Object.keys(HEADERS).forEach(name => ensureSheet(name, HEADERS[name]));
  seedDefaults();
}

function ensureSheet(name, headers) {
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const firstRow = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(String);
  if (firstRow.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }
  const needsRewrite = headers.some((header, index) => firstRow[index] !== header) || firstRow.length !== headers.length;
  if (needsRewrite) {
    const values = sheet.getDataRange().getValues();
    const oldHeaders = values[0].filter(String);
    const data = values.slice(1).map(row => {
      const object = rowToObject(oldHeaders, row);
      return headers.map(header => object[header] === undefined ? '' : object[header]);
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    if (data.length > 0) sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    if (sheet.getLastColumn() > headers.length) {
      sheet.deleteColumns(headers.length + 1, sheet.getLastColumn() - headers.length);
    }
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function seedDefaults() {
  const settings = readSettings();
  Object.keys(DEFAULT_SETTINGS).forEach(key => {
    if (settings[key] === undefined || settings[key] === '') writeSetting(key, DEFAULT_SETTINGS[key]);
  });
  if (rowsAsObjects(SHEETS.EMPLOYEES).length === 0) {
    appendObject(SHEETS.EMPLOYEES, { id: 'emp-1', name: '測試員工', hourlyRate: 190, workStart: '06:30', workEnd: '14:30', inGrace: 15, outGrace: 15, breakMinutes: 0, lineUserId: '', active: true });
    appendObject(SHEETS.EMPLOYEES, { id: 'emp-2', name: '店長', hourlyRate: 220, workStart: '06:30', workEnd: '14:30', inGrace: 15, outGrace: 15, breakMinutes: 0, lineUserId: '', active: true });
  }
  if (rowsAsObjects(SHEETS.SHIFTS).length === 0) {
    appendObject(SHEETS.SHIFTS, { id: 'shift-morning', name: '早班', start: '06:30', end: '14:30', inGrace: 15, outGrace: 15, breakMinutes: 0, active: true });
    appendObject(SHEETS.SHIFTS, { id: 'shift-evening', name: '晚班', start: '14:30', end: '22:30', inGrace: 15, outGrace: 15, breakMinutes: 0, active: true });
  }
}

function getBootstrap() {
  return {
    settings: readSettings(),
    employees: rowsAsObjects(SHEETS.EMPLOYEES).filter(row => String(row.active) !== 'false'),
    weeklySchedules: rowsAsObjects(SHEETS.WEEKLY_SCHEDULES).filter(row => String(row.active) !== 'false'),
    schedules: rowsAsObjects(SHEETS.SCHEDULES).filter(row => String(row.active) !== 'false'),
    shifts: rowsAsObjects(SHEETS.SHIFTS).filter(row => String(row.active) !== 'false'),
    records: rowsAsObjects(SHEETS.DAILY)
  };
}

function saveClock(record) {
  const now = new Date();
  const id = record.id || Utilities.getUuid();
  const raw = Object.assign({}, record, { id: id, createdAt: now.toISOString() });
  appendObject(SHEETS.RAW, raw);

  const employees = rowsAsObjects(SHEETS.EMPLOYEES);
  const employee = employees.find(item => item.id === record.employeeId) || {};
  const shift = employeeSchedule(employee, record);
  const daily = upsertDaily(record, employee, shift, now);
  return daily;
}

function upsertDaily(record, employee, shift, now) {
  const dailyKey = [record.date, record.employeeId, record.shiftId].join('|');
  const sheet = getSpreadsheet().getSheetByName(SHEETS.DAILY);
  const headers = HEADERS[SHEETS.DAILY];
  const rows = sheet.getDataRange().getValues();
  let rowNumber = -1;
  let daily = {
    dailyKey: dailyKey,
    date: record.date,
    employeeId: record.employeeId,
    employeeName: record.employeeName,
    lineUserId: record.lineUserId,
    shiftId: record.shiftId,
    shiftName: record.shiftName,
    inActual: '',
    inCounted: '',
    inStatus: '',
    outActual: '',
    outCounted: '',
    outStatus: '',
    locationStatus: record.locationStatus,
    distance: record.distance,
    note: record.note,
    hours: 0,
    pay: 0,
    updatedAt: now.toISOString()
  };

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === dailyKey) {
      rowNumber = i + 1;
      daily = rowToObject(headers, rows[i]);
      break;
    }
  }

  daily.employeeName = record.employeeName || daily.employeeName;
  daily.lineUserId = record.lineUserId || daily.lineUserId;
  daily.shiftName = record.shiftName || daily.shiftName;
  if (record.type === 'in') {
    daily.inActual = record.actualTime;
    daily.inCounted = record.countedTime;
    daily.inStatus = record.clockStatus;
  } else {
    daily.outActual = record.actualTime;
    daily.outCounted = record.countedTime;
    daily.outStatus = record.clockStatus;
  }
  daily.locationStatus = record.locationStatus || daily.locationStatus;
  daily.distance = record.distance === null || record.distance === undefined ? daily.distance : record.distance;
  daily.note = record.note || daily.note;
  daily.updatedAt = now.toISOString();

  const result = calculateHoursAndPay(daily, employee, shift);
  daily.hours = result.hours;
  daily.pay = result.pay;

  const values = [headers.map(header => daily[header] === undefined ? '' : daily[header])];
  if (rowNumber > 0) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
  return daily;
}

function calculateHoursAndPay(daily, employee, shift) {
  if (!daily.inCounted || !daily.outCounted) return { hours: 0, pay: 0 };
  let start = minutesOfDay(daily.inCounted);
  let end = minutesOfDay(daily.outCounted);
  if (end < start) end += 1440;
  const breakMinutes = Number(shift.breakMinutes || 0);
  const minutes = Math.max(0, end - start - breakMinutes);
  const hours = Math.round((minutes / 60) * 100) / 100;
  const pay = Math.round(hours * Number(employee.hourlyRate || 0));
  return { hours: hours, pay: pay };
}

function employeeSchedule(employee, record) {
  const schedules = rowsAsObjects(SHEETS.SCHEDULES);
  const daily = schedules.find(schedule =>
    String(schedule.active) !== 'false' &&
    schedule.employeeId === employee.id &&
    schedule.date === record.date
  );
  const weeklySchedules = rowsAsObjects(SHEETS.WEEKLY_SCHEDULES);
  const weekly = daily ? null : weeklySchedules.find(schedule =>
    String(schedule.active) !== 'false' &&
    schedule.employeeId === employee.id &&
    Number(schedule.weekday) === weekdayOf(record.date)
  );
  const schedule = daily || weekly;
  return {
    id: schedule ? ('schedule-' + schedule.id) : (record.shiftId || ('employee-' + (employee.id || 'unknown'))),
    name: daily ? '每日排班' : (weekly ? '每週固定班' : (record.shiftName || ((employee.name || '員工') + ' 個人時段'))),
    start: schedule ? (schedule.start || '06:30') : (employee.workStart || '06:30'),
    end: schedule ? (schedule.end || '14:30') : (employee.workEnd || '14:30'),
    inGrace: Number(schedule ? (schedule.inGrace || 15) : (employee.inGrace || 15)),
    outGrace: Number(schedule ? (schedule.outGrace || 15) : (employee.outGrace || 15)),
    breakMinutes: Number(schedule ? (schedule.breakMinutes || 0) : (employee.breakMinutes || 0))
  };
}

function weekdayOf(dateText) {
  return new Date(dateText + 'T00:00:00').getDay();
}

function minutesOfDay(timeText) {
  const parts = String(timeText || '00:00').split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

function saveSettings(settings) {
  ['siteName', 'latitude', 'longitude', 'radiusMeters', 'adminPin'].forEach(key => {
    if (settings[key] !== undefined) writeSetting(key, settings[key]);
  });
  return readSettings();
}

function saveEmployee(employee) {
  const row = {
    id: employee.id || Utilities.getUuid(),
    name: employee.name || '',
    hourlyRate: Number(employee.hourlyRate || 0),
    workStart: employee.workStart || '06:30',
    workEnd: employee.workEnd || '14:30',
    inGrace: Number(employee.inGrace || 15),
    outGrace: Number(employee.outGrace || 15),
    breakMinutes: Number(employee.breakMinutes || 0),
    lineUserId: employee.lineUserId || '',
    active: true
  };
  upsertById(SHEETS.EMPLOYEES, row);
  return row;
}

function saveSchedule(schedule) {
  const row = {
    id: schedule.id || Utilities.getUuid(),
    date: schedule.date || '',
    employeeId: schedule.employeeId || '',
    start: schedule.start || '06:30',
    end: schedule.end || '14:30',
    inGrace: Number(schedule.inGrace || 15),
    outGrace: Number(schedule.outGrace || 15),
    breakMinutes: Number(schedule.breakMinutes || 0),
    note: schedule.note || '',
    active: true
  };
  const existing = rowsAsObjects(SHEETS.SCHEDULES).find(item =>
    String(item.active) !== 'false' &&
    item.employeeId === row.employeeId &&
    item.date === row.date
  );
  if (existing && existing.id) row.id = existing.id;
  upsertById(SHEETS.SCHEDULES, row);
  return row;
}

function saveWeeklySchedule(schedule) {
  const row = {
    id: schedule.id || Utilities.getUuid(),
    employeeId: schedule.employeeId || '',
    weekday: Number(schedule.weekday || 0),
    start: schedule.start || '06:30',
    end: schedule.end || '13:30',
    inGrace: Number(schedule.inGrace || 15),
    outGrace: Number(schedule.outGrace || 15),
    breakMinutes: Number(schedule.breakMinutes || 0),
    note: schedule.note || '',
    active: true
  };
  const existing = rowsAsObjects(SHEETS.WEEKLY_SCHEDULES).find(item =>
    String(item.active) !== 'false' &&
    item.employeeId === row.employeeId &&
    Number(item.weekday) === row.weekday
  );
  if (existing && existing.id) row.id = existing.id;
  upsertById(SHEETS.WEEKLY_SCHEDULES, row);
  return row;
}

function saveShift(shift) {
  const row = {
    id: shift.id || Utilities.getUuid(),
    name: shift.name || '',
    start: shift.start || '06:30',
    end: shift.end || '14:30',
    inGrace: Number(shift.inGrace || 0),
    outGrace: Number(shift.outGrace || 0),
    breakMinutes: Number(shift.breakMinutes || 0),
    active: true
  };
  upsertById(SHEETS.SHIFTS, row);
  return row;
}

function setActive(sheetName, id, active) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const rows = sheet.getDataRange().getValues();
  const idIndex = headers.indexOf('id');
  const activeIndex = headers.indexOf('active');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === id) {
      sheet.getRange(i + 1, activeIndex + 1).setValue(active);
      return { id: id, active: active };
    }
  }
  return { id: id, active: active };
}

function upsertById(sheetName, object) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  const rows = sheet.getDataRange().getValues();
  const idIndex = headers.indexOf('id');
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][idIndex] === object.id) {
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([headers.map(header => object[header] === undefined ? '' : object[header])]);
      return object;
    }
  }
  appendObject(sheetName, object);
  return object;
}

function readSettings() {
  const rows = rowsAsObjects(SHEETS.SETTINGS);
  return rows.reduce((settings, row) => {
    settings[row.key] = row.value;
    return settings;
  }, {});
}

function writeSetting(key, value) {
  const sheet = getSpreadsheet().getSheetByName(SHEETS.SETTINGS);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sheet.appendRow([key, value]);
}

function appendObject(sheetName, object) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  const headers = HEADERS[sheetName];
  sheet.appendRow(headers.map(header => object[header] === undefined ? '' : object[header]));
}

function rowsAsObjects(sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = HEADERS[sheetName];
  return values.slice(1).filter(row => row.some(cell => cell !== '')).map(row => rowToObject(headers, row));
}

function rowToObject(headers, row) {
  return headers.reduce((object, header, index) => {
    object[header] = row[index];
    return object;
  }, {});
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
