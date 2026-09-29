/**
 * Showcase Scanner destination — Google Apps Script bound to a Google Sheet (protocol showcase-scanner/1)
 *
 * Setup:
 *  1. Create a Google Sheet, then Extensions > Apps Script, paste this file.
 *  2. Project Settings > Script properties > add TOKEN = a random string (>= 32 chars, e.g. 64 hex chars).
 *  3. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone > Deploy.
 *  4. Destination link to paste into the extension:  <Web app URL ending in /exec>?token=<TOKEN>
 *  5. After editing this code you must create a NEW deployment version for changes to go live.
 *
 * Apps Script cannot set HTTP status codes (always 200) or read request headers, so a wrong/missing
 * token is reported with the body {"error":"unauthorized"} (the extension treats that like a 401).
 * The extension sends a text/plain POST, which Apps Script exposes as e.postData.contents.
 */
var PROTOCOL = 'showcase-scanner/1';
var SHEET_NAME = 'Products';
var HEADERS = ['productId', 'title', 'priceDisplay', 'commissionRate', 'shopName', 'categoryLabel', 'imageUrl', 'receivedAt'];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function authorized_(e) {
  var expected = PropertiesService.getScriptProperties().getProperty('TOKEN');
  var given = e && e.parameter ? e.parameter.token : null;
  return !!expected && expected.length >= 32 && given === expected;
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  // productId is a long digit string: force plain-text format so Sheets never turns it into a rounded number.
  sheet.getRange('A:A').setNumberFormat('@');
  return sheet;
}

function doGet(e) {
  if (!authorized_(e)) return json_({ error: 'unauthorized' });
  var sheet = sheet_();
  var last = sheet.getLastRow();
  var ids = [];
  var lastReceivedAt = null;
  if (last > 1) {
    var rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      ids.push(String(rows[i][0]));
      var at = String(rows[i][7]);
      if (at && (lastReceivedAt === null || at > lastReceivedAt)) lastReceivedAt = at;
    }
  }
  return json_({ protocol: PROTOCOL, productIds: ids, lastReceivedAt: lastReceivedAt });
}

function doPost(e) {
  if (!authorized_(e)) return json_({ error: 'unauthorized' });
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (err) {
      return json_({ error: 'invalid JSON body' });
    }
    if (!body || !Array.isArray(body.products)) return json_({ error: 'products must be an array' });

    var sheet = sheet_();
    var last = sheet.getLastRow();
    var rowById = {}; // productId -> 1-based row number
    if (last > 1) {
      var existing = sheet.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < existing.length; i++) rowById[String(existing[i][0])] = i + 2;
    }

    var now = new Date().toISOString();
    var saved = 0;
    var skipped = 0;
    for (var j = 0; j < body.products.length; j++) {
      var p = body.products[j];
      if (!p || typeof p.productId !== 'string' || p.productId === '' || p.hasStatusPopup === true) {
        skipped++;
        continue;
      }
      var row = [
        p.productId,
        p.title || '',
        p.priceDisplay || '',
        typeof p.commissionRate === 'number' ? p.commissionRate / 100 : '', // 1200 -> 12 (percent)
        p.shopName || '',
        p.categoryLabel || '',
        (p.imageUrls && p.imageUrls[0]) || '',
        now,
      ];
      var target = rowById[p.productId];
      if (target) {
        sheet.getRange(target, 1, 1, HEADERS.length).setValues([row]); // upsert
      } else {
        sheet.appendRow(row);
        rowById[p.productId] = sheet.getLastRow();
      }
      saved++;
    }
    return json_({ ok: true, saved: saved, skipped: skipped });
  } finally {
    lock.releaseLock();
  }
}
