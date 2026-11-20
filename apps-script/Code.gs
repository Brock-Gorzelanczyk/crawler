/**
 * Web crawler sign-ups -> this Google Sheet, in two tabs:
 *   Waitlist : everyone who signs up on the page (free list). Someone who clicked the $50 option shows
 *              "started $50 checkout" in the tier column until Stripe confirms they paid.
 *   Visits   : how many people the page reached, one row per day and source (?src=): visits, saw the tour clip,
 *              saw the crawler clip, reached the form, joined free, started checkout. Counts only: no phone, email,
 *              IP, cookie or device id is ever sent or kept.
 *   Paid     : only payments Stripe confirms, pulled from Stripe every 10 minutes (syncPaid). The page never
 *              writes here, so nobody can add themselves to Paid without paying.
 *
 * Setup: paste into Extensions > Apps Script of the sheet. Project Settings > Script properties: add
 * STRIPE_KEY = a Stripe *restricted* key with read-only access to Checkout Sessions. Run setup() once.
 * Then Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone; the /exec URL is the page's ENDPOINT.
 */
var WAIT = 'Waitlist', PAID = 'Paid';
var WAIT_HEAD = ['first_seen', 'last_seen', 'phone', 'email', 'tier', 'source', 'sms_email_consent', 'consent_text', 'page', 'timezone', 'times_submitted'];
var VISITS = 'Visits', VIS_HEAD = ['day', 'source', 'visits', 'saw_tour', 'saw_crawler', 'reached_form', 'joined_free', 'started_checkout'];
var EVENTS = {visit: 2, tour: 3, crawl: 4, form: 5, join: 6, checkout: 7};   // event -> column (0-based) in Visits
var PAID_HEAD = ['paid_at', 'name', 'email', 'phone', 'amount', 'currency', 'stripe_session', 'payment_link', 'delivered'];

// Spam limits: the web app URL is public, so anyone can post to it. One save per phone or email per minute,
// at most HOURLY_CAP saves an hour in all, and the tab stops taking rows past MAX_ROWS.
var HOURLY_CAP = 300, MAX_ROWS = 50000;

function tab_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}

function clean_(s, n) { return String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').trim().slice(0, n || 200); }
// a cell that starts with = + - @ is read by Sheets as a formula; keep it text
function safe_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function throttled_(phone, email) {
  var c = CacheService.getScriptCache();
  var kp = 'p:' + phone, ke = 'e:' + Utilities.base64EncodeWebSafe(email).slice(0, 200);
  if (c.get(kp) || c.get(ke)) return true;
  var hk = 'h:' + Math.floor(Date.now() / 3600000), n = +(c.get(hk) || 0);
  if (n >= HOURLY_CAP) return true;
  c.put(hk, String(n + 1), 3700); c.put(kp, '1', 60); c.put(ke, '1', 60);
  return false;
}

// ---- a page event: one count added to today's row for its source ----
function countEvent_(p) {
  var col = EVENTS[p.ev]; if (!col) return out_({ok: false});
  var c = CacheService.getScriptCache(), hk = 'v:' + Math.floor(Date.now() / 3600000), n = +(c.get(hk) || 0);
  if (n >= 20000) return out_({ok: true});                       // an hourly cap: the URL is public
  c.put(hk, String(n + 1), 3700);
  var src = clean_(p.source, 40).toLowerCase().replace(/[^a-z0-9._-]/g, '') || 'direct';
  var day = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return out_({ok: false});
  try {
    var sh = tab_(VISITS, VIS_HEAD), last = sh.getLastRow();
    var from = Math.max(2, last - 400), rows = last >= 2 ? sh.getRange(from, 1, last - from + 1, 2).getDisplayValues() : [];
    var at = -1;
    for (var i = rows.length - 1; i >= 0; i--) { if (rows[i][0] === day && rows[i][1] === src) { at = from + i; break; } }
    if (at < 0) { if (last > MAX_ROWS) return out_({ok: false}); sh.appendRow([day, safe_(src), 0, 0, 0, 0, 0, 0]); at = sh.getLastRow(); sh.getRange(at, 1).setNumberFormat('@').setValue(day); }
    var cell = sh.getRange(at, col + 1); cell.setValue((+cell.getValue() || 0) + 1);
    return out_({ok: true});
  } finally { lock.releaseLock(); }
}

// ---- the page posts here ----
function doPost(e) {
  var p = (e && e.parameter) || {};
  if (p.ev) return countEvent_(p);
  if (p.company) return out_({ok: true});                       // hidden bot field filled: drop it quietly
  var phone = clean_(p.phone, 20), email = clean_(p.email, 254).toLowerCase();
  if (!/^\+\d{8,15}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || p.consent !== 'yes') return out_({ok: false});
  if (throttled_(phone, email)) return out_({ok: true});
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return out_({ok: false});
  try {
    var sh = tab_(WAIT, WAIT_HEAD), last = sh.getLastRow();
    if (last > MAX_ROWS) return out_({ok: false});
    var tier = p.tier === 'founding_checkout_started' ? 'started $50 checkout' : 'free';
    var now = new Date();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, WAIT_HEAD.length).getValues() : [];
    var at = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i][2] === phone || String(rows[i][3]).toLowerCase() === email) { at = i; break; } }
    var consent = safe_(clean_(p.consent_text, 600));
    if (at >= 0) {
      var r = rows[at];
      r[1] = now; r[2] = safe_(phone); r[3] = email;
      if (!/checkout|^paid$/.test(r[4])) r[4] = tier;           // a checkout or paid row is never set back to free
      r[6] = 'yes'; r[7] = consent; r[10] = (+r[10] || 1) + 1;
      sh.getRange(at + 2, 1, 1, WAIT_HEAD.length).setValues([r]);
    } else {
      sh.appendRow([now, now, safe_(phone), email, tier, safe_(clean_(p.source, 80)), 'yes', consent,
        safe_(clean_(p.page, 200)), safe_(clean_(p.tz, 60)), 1]);
    }
    return out_({ok: true});
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out_({ok: true}); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---- Paid tab: read completed, paid Checkout Sessions from Stripe ----
function syncPaid() {
  var key = PropertiesService.getScriptProperties().getProperty('STRIPE_KEY');
  if (!key) throw new Error('Add STRIPE_KEY (a restricted, read-only key) in Project Settings > Script properties');
  var sh = tab_(PAID, PAID_HEAD), last = sh.getLastRow();
  var seen = {};
  if (last > 1) sh.getRange(2, 7, last - 1, 1).getValues().forEach(function (r) { seen[r[0]] = 1; });
  var props = PropertiesService.getScriptProperties();
  var since = +(props.getProperty('PAID_SINCE') || 0), newest = since, add = [], after = '';
  for (var page = 0; page < 20; page++) {
    var url = 'https://api.stripe.com/v1/checkout/sessions?limit=100&status=complete' +
      (since ? '&created[gte]=' + since : '') + (after ? '&starting_after=' + after : '');
    var res = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + key}, muteHttpExceptions: true});
    if (res.getResponseCode() !== 200) throw new Error('Stripe ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    var body = JSON.parse(res.getContentText());
    body.data.forEach(function (s) {
      if (s.payment_status !== 'paid' || seen[s.id]) return;
      var d = s.customer_details || {};
      add.push([new Date(s.created * 1000), safe_(clean_(d.name, 120)), clean_(d.email, 254).toLowerCase(), safe_(clean_(d.phone, 20)),
        (s.amount_total || 0) / 100, String(s.currency || '').toUpperCase(), s.id, s.payment_link || '', '']);
      seen[s.id] = 1;
      if (s.created > newest) newest = s.created;
    });
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  if (add.length) {
    add.sort(function (a, b) { return a[0] - b[0]; });
    sh.getRange(sh.getLastRow() + 1, 1, add.length, PAID_HEAD.length).setValues(add);
    markPaidOnWaitlist_(add);
  }
  if (newest > since) props.setProperty('PAID_SINCE', String(newest - 3600));   // an hour of overlap; duplicates are skipped by session id
}

// a buyer who signed up on the page first: their Waitlist row says "paid"
function markPaidOnWaitlist_(add) {
  var sh = tab_(WAIT, WAIT_HEAD), last = sh.getLastRow();
  if (last < 2) return;
  var emails = {};
  add.forEach(function (r) { if (r[2]) emails[r[2]] = 1; });
  var tiers = sh.getRange(2, 4, last - 1, 2).getValues();
  var changed = false;
  tiers.forEach(function (r) { if (emails[String(r[0]).toLowerCase()]) { r[1] = 'paid'; changed = true; } });
  if (changed) sh.getRange(2, 4, last - 1, 2).setValues(tiers);
}

// run once: makes both tabs and checks Stripe every 10 minutes
function setup() {
  tab_(WAIT, WAIT_HEAD); tab_(PAID, PAID_HEAD);
  var ss = SpreadsheetApp.getActiveSpreadsheet(), s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'syncPaid') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncPaid').timeBased().everyMinutes(10).create();
}
