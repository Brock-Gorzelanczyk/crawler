/**
 * Waitlist sign-ups -> this Google Sheet.
 * Paste into Extensions > Apps Script of the sheet, then Deploy > New deployment > Web app,
 * "Execute as: Me", "Who has access: Anyone". Put the /exec URL in index.html as ENDPOINT.
 *
 * One row per person (matched on phone, then email). A repeat sign-up updates the row instead of adding a copy,
 * and a "founding_checkout_started" tier is never downgraded back to "waitlist".
 */
var SHEET = 'Signups';
var HEAD = ['first_seen', 'last_seen', 'phone', 'email', 'tier', 'paid', 'source', 'sms_email_consent', 'consent_text', 'page', 'timezone', 'times_submitted'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  if (sh.getLastRow() === 0) { sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}

function clean_(s, n) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n || 200); }
// a cell that starts with = + - @ is read by Sheets as a formula; keep it text
function safe_(s) { return /^[=+\-@]/.test(s) ? "'" + s : s; }

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var p = (e && e.parameter) || {};
    var phone = clean_(p.phone, 20), email = clean_(p.email, 254).toLowerCase();
    if (!/^\+\d{8,15}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || p.consent !== 'yes') {
      return out_({ok: false, error: 'bad input'});
    }
    var tier = p.tier === 'founding_checkout_started' ? 'founding_checkout_started' : 'waitlist';
    var now = new Date(), sh = sheet_(), last = sh.getLastRow();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, HEAD.length).getValues() : [];
    var at = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i][2] === phone || String(rows[i][3]).toLowerCase() === email) { at = i; break; } }
    if (at >= 0) {
      var r = rows[at];
      r[1] = now; r[2] = phone; r[3] = email;
      if (r[4] !== 'founding_checkout_started') r[4] = tier;
      r[7] = 'yes'; r[8] = safe_(clean_(p.consent_text, 600));
      r[11] = (+r[11] || 1) + 1;
      sh.getRange(at + 2, 1, 1, HEAD.length).setValues([r]);
    } else {
      sh.appendRow([now, now, phone, email, tier, '', safe_(clean_(p.source, 80)), 'yes', safe_(clean_(p.consent_text, 600)),
        safe_(clean_(p.page, 200)), safe_(clean_(p.tz, 60)), 1]);
    }
    return out_({ok: true});
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out_({ok: true, service: 'crawler waitlist'}); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
