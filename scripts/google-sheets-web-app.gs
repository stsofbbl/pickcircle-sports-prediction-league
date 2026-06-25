const STATE_SHEET = "state";
const AUDIT_SHEET = "audit_log";
const MEMBERS_SHEET = "members";

function doGet(e) {
  const params = e.parameter || {};
  const callback = params.callback || "";
  try {
    if (params.action === "ping") {
      return jsonResponse(ping_(params), callback);
    }
    if (params.action === "getState") {
      return jsonResponse(getState_(params), callback);
    }
    return jsonResponse({ ok: false, error: "Unknown action" }, callback);
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) }, callback);
  }
}

function doPost(e) {
  const params = e.parameter || {};
  try {
    if (params.action === "saveState") {
      return jsonResponse(saveState_(params), "");
    }
    return jsonResponse({ ok: false, error: "Unknown action" }, "");
  } catch (error) {
    return jsonResponse({ ok: false, error: String(error && error.message ? error.message : error) }, "");
  }
}

function ping_(params) {
  const spreadsheet = openSpreadsheet_(params.spreadsheetId);
  const leagueId = requireParam_(params, "leagueId");
  const stateSheet = ensureSheet_(spreadsheet, STATE_SHEET, ["leagueId", "updatedAt", "clientId", "version", "payload"]);
  const row = findLeagueRow_(stateSheet, leagueId);
  return {
    ok: true,
    spreadsheetId: spreadsheet.getId(),
    spreadsheetName: spreadsheet.getName(),
    leagueId,
    hasState: row > 0,
    updatedAt: row > 0 ? stateSheet.getRange(row, 2).getValue() : "",
  };
}

function getState_(params) {
  const spreadsheet = openSpreadsheet_(params.spreadsheetId);
  const stateSheet = ensureSheet_(spreadsheet, STATE_SHEET, ["leagueId", "updatedAt", "clientId", "version", "payload"]);
  const leagueId = requireParam_(params, "leagueId");
  const values = stateSheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row += 1) {
    if (String(values[row][0]) === leagueId) {
      const payload = values[row][4] ? JSON.parse(values[row][4]) : {};
      return {
        ok: true,
        leagueId,
        updatedAt: values[row][1],
        clientId: values[row][2],
        version: values[row][3],
        state: payload.state || payload,
      };
    }
  }
  return { ok: false, error: "No saved state for this leagueId", leagueId };
}

function saveState_(params) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const spreadsheet = openSpreadsheet_(params.spreadsheetId);
    const stateSheet = ensureSheet_(spreadsheet, STATE_SHEET, ["leagueId", "updatedAt", "clientId", "version", "payload"]);
    const auditSheet = ensureSheet_(spreadsheet, AUDIT_SHEET, ["timestamp", "leagueId", "clientId", "action", "version", "payloadSize"]);
    ensureSheet_(spreadsheet, MEMBERS_SHEET, ["leagueId", "displayName", "role", "updatedAt"]);

    const leagueId = requireParam_(params, "leagueId");
    const clientId = params.clientId || "";
    const payload = requireParam_(params, "payload");
    const parsed = JSON.parse(payload);
    const updatedAt = new Date().toISOString();
    const version = parsed.version || 1;
    const row = findLeagueRow_(stateSheet, leagueId);
    const values = [leagueId, updatedAt, clientId, version, payload];
    if (row > 0) stateSheet.getRange(row, 1, 1, values.length).setValues([values]);
    else stateSheet.appendRow(values);
    auditSheet.appendRow([updatedAt, leagueId, clientId, "saveState", version, payload.length]);
    return { ok: true, leagueId, updatedAt, version };
  } finally {
    lock.releaseLock();
  }
}

function openSpreadsheet_(spreadsheetId) {
  return SpreadsheetApp.openById(requireParam_({ spreadsheetId }, "spreadsheetId"));
}

function ensureSheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function findLeagueRow_(sheet, leagueId) {
  const values = sheet.getDataRange().getValues();
  for (let row = 1; row < values.length; row += 1) {
    if (String(values[row][0]) === leagueId) return row + 1;
  }
  return -1;
}

function requireParam_(params, key) {
  const value = params[key];
  if (value === undefined || value === null || String(value).trim() === "") {
    throw new Error("Missing parameter: " + key);
  }
  return String(value).trim();
}

function jsonResponse(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
