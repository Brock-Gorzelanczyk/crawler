/**
 * Web crawler sign-ups -> this Google Sheet, in two tabs:
 *   Waitlist : everyone who signs up on the page (free list). Someone who clicked a paid option shows
 *              "started $50 checkout" or "started $249 checkout" in the tier column until Stripe confirms they paid.
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
var WAIT_HEAD = ['first_seen', 'last_seen', 'phone', 'email', 'tier', 'source', 'sms_email_consent', 'consent_text', 'timezone', 'times_submitted'];
var VISITS = 'Visits', VIS_HEAD = ['day', 'source', 'visits', 'saw_tour', 'saw_crawler', 'reached_form', 'joined_free', 'started_checkout'];
var EVENTS = {visit: 2, tour: 3, crawl: 4, form: 5, join: 6, checkout: 7};   // event -> column (0-based) in Visits
var PAID_HEAD = ['paid_at', 'name', 'email', 'phone', 'amount', 'currency', 'stripe_session', 'payment_link', 'delivered', 'product', 'github'];

// Spam limits: the web app URL is public, so anyone can post to it. One save per phone or email per minute,
// at most HOURLY_CAP saves an hour in all, and the tab stops taking rows past MAX_ROWS.
var HOURLY_CAP = 300, MAX_ROWS = 50000;

function tab_(name, head) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold'); }
  return sh;
}

// The last row with data in column A. The tabs carry totals boxes to the right of the table, and
// getLastRow()/appendRow count those too, so new rows would land below the box instead of under the table.
function lastRow_(sh) {
  var n = sh.getMaxRows(), c = sh.getRange(n, 1);
  if (c.getValue() !== '') return n;
  var r = c.getNextDataCell(SpreadsheetApp.Direction.UP).getRow();
  return r === 1 && sh.getRange(1, 1).getValue() === '' ? 0 : r;
}
// write rows starting at row `at` (adds sheet rows when needed, as appendRow would)
function putRows_(sh, at, vals) {
  var need = at + vals.length - 1 - sh.getMaxRows();
  if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), Math.max(need, 100));
  sh.getRange(at, 1, vals.length, vals[0].length).setValues(vals);
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
    var sh = tab_(VISITS, VIS_HEAD), last = lastRow_(sh);
    var from = Math.max(2, last - 400), rows = last >= 2 ? sh.getRange(from, 1, last - from + 1, 2).getDisplayValues() : [];
    var at = -1;
    for (var i = rows.length - 1; i >= 0; i--) { if (rows[i][0] === day && rows[i][1] === src) { at = from + i; break; } }
    if (at < 0) { if (last > MAX_ROWS) return out_({ok: false}); at = last + 1; putRows_(sh, at, [[day, safe_(src), 0, 0, 0, 0, 0, 0]]); sh.getRange(at, 1).setNumberFormat('@').setValue(day); }
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
    var sh = tab_(WAIT, WAIT_HEAD), last = lastRow_(sh);
    if (last > MAX_ROWS) return out_({ok: false});
    var tier = {founding_checkout_started: 'started $50 checkout', investor_checkout_started: 'started $249 checkout'}[p.tier] || 'free';
    var now = new Date();
    var rows = last > 1 ? sh.getRange(2, 1, last - 1, WAIT_HEAD.length).getValues() : [];
    var at = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i][2] === phone || String(rows[i][3]).toLowerCase() === email) { at = i; break; } }
    var consent = safe_(clean_(p.consent_text, 600));
    if (at >= 0) {
      var r = rows[at];
      r[1] = now; r[2] = safe_(phone); r[3] = email;
      if (r[4] !== 'paid' && (tier !== 'free' || !/checkout/.test(r[4]))) r[4] = tier;   // a newer checkout replaces an older one; paid and checkout rows never go back to free
      r[6] = 'yes'; r[7] = consent; r[9] = (+r[9] || 1) + 1;
      sh.getRange(at + 2, 1, 1, WAIT_HEAD.length).setValues([r]);
    } else {
      putRows_(sh, last + 1, [[now, now, safe_(phone), email, tier, safe_(clean_(p.source, 80)), 'yes', consent,
        safe_(clean_(p.tz, 60)), 1]]);
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
  var sh = tab_(PAID, PAID_HEAD), last = lastRow_(sh);
  if (sh.getRange(1, 10).getValue() !== 'product') sh.getRange(1, 1, 1, PAID_HEAD.length).setValues([PAID_HEAD]).setFontWeight('bold');   // older tab: add the new columns
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
        (s.amount_total || 0) / 100, String(s.currency || '').toUpperCase(), s.id, s.payment_link || '', '',
        (s.amount_total || 0) >= 20000 ? 'Investor Edition' : 'Crawler Kit', safe_(githubField_(s))]);
      seen[s.id] = 1;
      if (s.created > newest) newest = s.created;
    });
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  if (add.length) {
    add.sort(function (a, b) { return a[0] - b[0]; });
    putRows_(sh, last + 1, add);
    markPaidOnWaitlist_(add);
  }
  if (newest > since) props.setProperty('PAID_SINCE', String(newest - 3600));   // an hour of overlap; duplicates are skipped by session id
  deliverPending_();
}

// a buyer who signed up on the page first: their Waitlist row says "paid"
function markPaidOnWaitlist_(add) {
  var sh = tab_(WAIT, WAIT_HEAD), last = lastRow_(sh);
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

// ======================================================================================================
// ---- Delivery: every new sale gets its download by email, plus a GitHub invite if they gave a username ----
// Runs inside syncPaid (every 10 minutes). Buyers without GitHub still get everything: the download link
// always works, and they can reply with a username later.
//
// Script properties (Project Settings > Script properties). Brock sets these; nothing is emailed until he does:
//   KIT_DOWNLOAD, INVESTOR_DOWNLOAD : link to each product's download (e.g. a Google Drive zip shared "anyone with
//                                     the link"; upload a new version of the same file to ship an update, the link stays)
//   KIT_GUIDE, INVESTOR_GUIDE       : (optional) link to each install guide
//   KIT_REPO, INVESTOR_REPO         : (optional) owner/name of each private GitHub repo
//   GITHUB_TOKEN                    : (optional) fine-grained token with Administration read & write on those two repos only
//   DELIVER_SINCE                   : set by setupDelivery(); sales before it are never emailed
// The 'delivered' column says what happened. Anything that needs Brock's hand starts with NEEDS YOU, and he gets an email.
// ======================================================================================================
var PRODUCTS = {
  'Crawler Kit':      {key: 'KIT',      extra: ''},
  'Investor Edition': {key: 'INVESTOR', extra: 'Your 12 months of data updates start today.\n\n'}
};

// the GitHub username from the checkout's optional custom field, cleaned ("@name", "github.com/name" -> "name")
function githubField_(s) {
  var f = (s.custom_fields || []).filter(function (c) { return /github/i.test((c.key || '') + ' ' + ((c.label || {}).custom || '')); })[0];
  return f && f.text ? clean_(f.text.value, 100) : '';
}
function githubUser_(raw) {
  var u = String(raw || '').trim().replace(/^'/, '').replace(/^@/, '').replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').split(/[\/?#]/)[0];
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(u) ? u : '';
}

// invite a username to a repo (read-only). Returns 'invited', 'already has access', or an error starting with 'failed'
function inviteGithub_(repo, user) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token || !repo) return 'failed: GitHub token or repo not set';
  var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo + '/collaborators/' + encodeURIComponent(user), {
    method: 'put', contentType: 'application/json', payload: JSON.stringify({permission: 'pull'}), muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}});
  var code = res.getResponseCode();
  if (code === 201) return 'invited';
  if (code === 204) return 'already has access';
  return 'failed: GitHub ' + code + (code === 404 ? ' (no such user, or the token cannot see the repo)' : '') + ' ' + res.getContentText().slice(0, 120);
}

function deliveryEmail_(product, name, links, gh) {
  var first = String(name || '').split(' ')[0] || 'there';
  var body = 'Hi ' + first + ',\n\nThanks for buying the ' + product + '. Here is everything:\n\n' +
    'Download: ' + links.download + '\n' +
    (links.guide ? 'Install guide: ' + links.guide + '\n' : '') + '\n';
  if (gh.status === 'invited' || gh.status === 'already has access') {
    body += 'GitHub: I invited @' + gh.user + ' to the private repo. Accept it here: https://github.com/' + links.repo + '/invitations\n' +
      'Updates land there first; a "git pull" gets you the newest version.\n\n';
  } else if (gh.user || gh.raw) {
    body += 'GitHub: I could not add "' + (gh.user || gh.raw) + '" automatically. Reply with your exact GitHub username and I will add you by hand. ' +
      'You do not need GitHub: the download link above always has the latest version.\n\n';
  } else {
    body += 'Updates: the download link above always has the latest version. Want updates through GitHub too? Reply with your GitHub username and I will add you.\n\n';
  }
  return body + PRODUCTS[product].extra + 'Stuck on install or have a question? Just reply to this email.\n\nBrock\nBMG Capital';
}

function deliverPending_() {
  var props = PropertiesService.getScriptProperties(), since = +(props.getProperty('DELIVER_SINCE') || 0);
  if (!since) return;                                               // automation is off until setupDelivery() runs
  var sh = tab_(PAID, PAID_HEAD), last = lastRow_(sh); if (last < 2) return;
  var rows = sh.getRange(2, 1, last - 1, PAID_HEAD.length).getValues(), owner = Session.getEffectiveUser().getEmail(), sent = 0;
  for (var i = 0; i < rows.length && sent < 20; i++) {
    var r = rows[i];
    if (r[8] !== '' || !(r[0] instanceof Date) || r[0].getTime() / 1000 < since || !r[2]) continue;
    var product = PRODUCTS[r[9]] ? r[9] : (+r[4] >= 200 ? 'Investor Edition' : 'Crawler Kit'), k = PRODUCTS[product].key;
    var links = {download: props.getProperty(k + '_DOWNLOAD'), guide: props.getProperty(k + '_GUIDE'), repo: props.getProperty(k + '_REPO')};
    var cell = sh.getRange(i + 2, 9), stamp = Utilities.formatDate(new Date(), 'America/New_York', 'yyyy-MM-dd HH:mm');
    if (!links.download) {
      cell.setValue('NEEDS YOU: no ' + k + '_DOWNLOAD link set, nothing sent (' + stamp + ')');
      MailApp.sendEmail(owner, 'Crawler sale needs you: ' + product + ' for ' + r[2], 'A ' + product + ' sale came in from ' + r[2] + ' but ' + k + '_DOWNLOAD is not set in the Apps Script properties, so nothing was sent. Send it by hand, or set the link and clear the delivered cell to resend.');
      continue;
    }
    var raw = String(r[10] || '').replace(/^'/, ''), user = githubUser_(raw), gh = {raw: raw, user: user, status: ''};
    if (user) gh.status = inviteGithub_(links.repo, user);
    MailApp.sendEmail({to: r[2], subject: 'Your ' + product + ' is here', body: deliveryEmail_(product, r[1], links, gh), name: 'Brock · BMG Capital', replyTo: owner});
    sent++;
    var note = 'emailed ' + stamp + (user ? '; GitHub @' + user + ': ' + gh.status : raw ? '; GitHub "' + raw + '" not a valid username' : '; no GitHub');
    var trouble = (user && /^failed/.test(gh.status)) || (raw && !user);
    cell.setValue((trouble ? 'NEEDS YOU: ' : '') + note);
    if (trouble) MailApp.sendEmail(owner, 'Crawler sale: add GitHub by hand for ' + r[2], product + ' buyer ' + r[2] + ' got the download email, but the GitHub invite did not go through: ' + note + '. They were asked to reply with their exact username.');
  }
}

// run once to turn delivery on: only sales from now on are emailed (older ones are left for Brock)
function setupDelivery() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('DELIVER_SINCE')) props.setProperty('DELIVER_SINCE', String(Math.floor(Date.now() / 1000)));
  return 'delivery on for sales after ' + new Date(+props.getProperty('DELIVER_SINCE') * 1000);
}

// sends both delivery emails to Brock himself, as a buyer would see them (no GitHub invite, nothing written to the Sheet)
function deliveryTest() {
  var props = PropertiesService.getScriptProperties(), owner = Session.getEffectiveUser().getEmail();
  Object.keys(PRODUCTS).forEach(function (product) {
    var k = PRODUCTS[product].key;
    var links = {download: props.getProperty(k + '_DOWNLOAD') || '(' + k + '_DOWNLOAD not set yet)', guide: props.getProperty(k + '_GUIDE'), repo: props.getProperty(k + '_REPO') || 'owner/repo'};
    MailApp.sendEmail({to: owner, subject: '[TEST] Your ' + product + ' is here', body: deliveryEmail_(product, 'Brock Test', links, {raw: '', user: '', status: ''}), name: 'Brock · BMG Capital', replyTo: owner});
  });
  return 'sent 2 test emails to ' + owner;
}

// checks GITHUB_TOKEN can manage both product repos (needed to invite buyers). Changes nothing.
function githubTokenTest() {
  var props = PropertiesService.getScriptProperties(), token = props.getProperty('GITHUB_TOKEN'), out = [];
  ['KIT_REPO', 'INVESTOR_REPO'].forEach(function (k) {
    var repo = props.getProperty(k);
    var res = UrlFetchApp.fetch('https://api.github.com/repos/' + repo, {muteHttpExceptions: true,
      headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}});
    var body = {}; try { body = JSON.parse(res.getContentText()); } catch (e) {}
    out.push(k + ' ' + repo + ': HTTP ' + res.getResponseCode() + (body.permissions ? ', admin=' + body.permissions.admin + ', private=' + body.private : ' ' + (body.message || '')));
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}
