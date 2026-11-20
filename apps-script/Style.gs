/**
 * Looks for the Crawler waitlist Sheet: colored headers, banded rows, fitted columns, and a totals box to the
 * right of each table. Run styleSheets() by hand from the editor; nothing calls it. Safe to run again: it only
 * formats, and it writes a box only into cells it finds empty (or that already hold its own box).
 *
 * The boxes sit in columns the script never writes:
 *   Waitlist A:J -> box L1:P (signups by tier and by source)
 *   Visits   A:H -> box J1:P (funnel totals, % of visits, totals by source)
 *   Paid     A:K -> box M1:O (revenue, sales, by product, deliveries that need Brock)
 * Code.gs finds its next row from column A only (lastRow_), so the boxes never push new rows down.
 * It also drops a leftover 'page' column from Waitlist (Code.gs stopped writing it).
 */
var STYLE = {
  Waitlist: {accent: '#0b8043', band: '#e6f4ea', dark: '#0d652d', cols: 10, key: [4, 5],
             wrap: {8: 460}, max: 280, center: [5, 7, 10],
             fmt: {1: 'yyyy-mm-dd h:mm am/pm', 2: 'yyyy-mm-dd h:mm am/pm'}},
  Visits:   {accent: '#1a73e8', band: '#e8f0fe', dark: '#174ea6', cols: 8, key: [2, 3],
             wrap: {}, max: 200, center: [3, 4, 5, 6, 7, 8], fmt: {3: '#,##0', 4: '#,##0', 5: '#,##0', 6: '#,##0', 7: '#,##0', 8: '#,##0'}},
  Paid:     {accent: '#8430ce', band: '#f3e8fd', dark: '#681da8', cols: 11, key: [3, 5, 10],
             wrap: {9: 300}, max: 300, center: [6],
             fmt: {1: 'yyyy-mm-dd h:mm am/pm', 5: '$#,##0.00'}}
};

function styleSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), log = [];
  dropPageColumn_(ss.getSheetByName('Waitlist'), log);
  Object.keys(STYLE).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { log.push(name + ': no such tab'); return; }
    styleTable_(sh, STYLE[name]);
    log.push(name + ': table styled');
  });
  log.push(waitlistBox_(ss.getSheetByName('Waitlist')));
  log.push(visitsBox_(ss.getSheetByName('Visits')));
  log.push(paidBox_(ss.getSheetByName('Paid')));
  Logger.log(log.join('\n'));
  return log.join('\n');
}

function dropPageColumn_(sh, log) {
  if (!sh) return;
  if (sh.getRange(1, 9).getValue() === 'page' && WAIT_HEAD.indexOf('page') < 0) { sh.deleteColumn(9); log.push('Waitlist: page column (I) deleted'); }
  else log.push('Waitlist: no page column at I, nothing deleted');
}

function styleTable_(sh, st) {
  var rows = sh.getMaxRows(), n = st.cols;
  sh.setFrozenRows(1);
  sh.getBandings().forEach(function (b) { if (b.getRange().getColumn() <= n) b.remove(); });
  sh.getRange(1, 1, rows, n).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(st.accent).setFirstRowColor('#ffffff').setSecondRowColor(st.band);
  sh.getRange(1, 1, 1, n).setFontColor('#ffffff').setFontWeight('bold').setVerticalAlignment('middle').setHorizontalAlignment('left').setWrap(false);
  sh.setRowHeight(1, 30);
  sh.getRange(2, 1, rows - 1, n).setVerticalAlignment('top');
  st.key.forEach(function (c) { sh.getRange(2, c, rows - 1, 1).setFontWeight('bold'); });
  st.center.forEach(function (c) { sh.getRange(1, c, rows, 1).setHorizontalAlignment('center'); });
  Object.keys(st.fmt).forEach(function (c) { sh.getRange(2, +c, rows - 1, 1).setNumberFormat(st.fmt[c]); });
  sh.autoResizeColumns(1, n);
  for (var c = 1; c <= n; c++) {
    if (st.wrap[c]) { sh.setColumnWidth(c, st.wrap[c]); sh.getRange(2, c, rows - 1, 1).setWrap(true); continue; }
    sh.setColumnWidth(c, Math.min(st.max, Math.max(sh.getColumnWidth(c) + 18, 70)));
    sh.getRange(2, c, rows - 1, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }
  sh.setColumnWidth(n + 1, 24);                                     // a thin gap before the box
}

// writes a box only if every target cell is empty or already holds this box (same title)
function boxFree_(sh, a1, title) {
  var r = sh.getRange(a1), v = r.getValues(), f = r.getFormulas();
  if (v[0][0] === title) return true;
  for (var i = 0; i < v.length; i++) for (var j = 0; j < v[i].length; j++) if (v[i][j] !== '' || f[i][j] !== '') return false;
  return true;
}

function boxStyle_(sh, st, titleA1, headA1s, boxA1, widths, firstCol) {
  sh.getRange(titleA1).merge().setBackground(st.dark).setFontColor('#ffffff').setFontWeight('bold').setFontSize(11)
    .setHorizontalAlignment('left').setVerticalAlignment('middle');
  headA1s.forEach(function (a) { sh.getRange(a).setBackground(st.band).setFontWeight('bold').setFontColor(st.dark).setWrap(false); });
  sh.getRange(boxA1).setVerticalAlignment('middle');
  sh.getRange(boxA1).setBorder(true, true, true, true, null, null, st.dark, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  widths.forEach(function (w, i) { sh.setColumnWidth(firstCol + i, w); });
}

function waitlistBox_(sh) {
  var st = STYLE.Waitlist, title = 'Signups';
  if (!sh) return 'Waitlist: no tab';
  if (!boxFree_(sh, 'L1:P40', title)) return 'Waitlist: L1:P40 not empty, box NOT written';
  sh.getRange('L1').setValue(title);
  sh.getRange('L2:M2').setValues([['All signups', '=COUNTA(A2:A)']]);
  sh.getRange('L3:M3').setValues([['Paid', '=COUNTIF(E2:E,"paid")']]);
  sh.getRange('L5:M5').setValues([['tier', 'signups']]);
  sh.getRange('L6').setFormula('=IFERROR(QUERY(A2:J,"select E, count(A) where A is not null group by E order by count(A) desc label count(A) \'\'",0),"none yet")');
  sh.getRange('O5:P5').setValues([['source', 'signups']]);
  sh.getRange('O6').setFormula('=IFERROR(QUERY(A2:J,"select F, count(A) where A is not null group by F order by count(A) desc label count(A) \'\'",0),"none yet")');
  sh.getRange('L2:L3').setFontWeight('bold'); sh.getRange('M2:M3').setFontWeight('bold').setHorizontalAlignment('center');
  sh.getRange('M6:M40').setHorizontalAlignment('center'); sh.getRange('P6:P40').setHorizontalAlignment('center');
  boxStyle_(sh, st, 'L1:P1', ['L5:M5', 'O5:P5'], 'L1:P16', [150, 70, 20, 120, 70], 12);
  return 'Waitlist: box L1:P16 written';
}

function visitsBox_(sh) {
  var st = STYLE.Visits, title = 'Funnel totals (every day)';
  if (!sh) return 'Visits: no tab';
  if (!boxFree_(sh, 'J1:P40', title)) return 'Visits: J1:P40 not empty, box NOT written';
  var head = ['', 'visits', 'saw_tour', 'saw_crawler', 'reached_form', 'joined_free', 'started_checkout'];
  sh.getRange('J1').setValue(title);
  sh.getRange('J2:P2').setValues([head]);
  sh.getRange('J3:P3').setValues([['All sources', '=SUM(C2:C)', '=SUM(D2:D)', '=SUM(E2:E)', '=SUM(F2:F)', '=SUM(G2:G)', '=SUM(H2:H)']]);
  sh.getRange('J4:P4').setValues([['% of visits', '=IFERROR(K3/$K$3,0)', '=IFERROR(L3/$K$3,0)', '=IFERROR(M3/$K$3,0)', '=IFERROR(N3/$K$3,0)', '=IFERROR(O3/$K$3,0)', '=IFERROR(P3/$K$3,0)']]);
  sh.getRange('J6').setValue('By source');
  head[0] = 'source';
  sh.getRange('J7:P7').setValues([head]);
  sh.getRange('J8').setFormula('=IFERROR(QUERY(A2:H,"select B, sum(C), sum(D), sum(E), sum(F), sum(G), sum(H) where B <> \'\' group by B order by sum(C) desc label sum(C) \'\', sum(D) \'\', sum(E) \'\', sum(F) \'\', sum(G) \'\', sum(H) \'\'",0),"none yet")');
  sh.getRange('J3:P3').setFontWeight('bold');
  sh.getRange('K3:P3').setNumberFormat('#,##0'); sh.getRange('K4:P4').setNumberFormat('0%').setFontColor('#5f6368');
  sh.getRange('K8:P40').setNumberFormat('#,##0');
  sh.getRange('J8:J40').setFontWeight('bold');
  sh.getRange('K2:P40').setHorizontalAlignment('center');
  sh.getRange('J6:P6').merge().setFontWeight('bold').setFontColor(st.dark);
  boxStyle_(sh, st, 'J1:P1', ['J2:P2', 'J7:P7'], 'J1:P18', [190, 70, 80, 95, 105, 95, 125], 10);
  return 'Visits: box J1:P18 written';
}

function paidBox_(sh) {
  var st = STYLE.Paid, title = 'Sales';
  if (!sh) return 'Paid: no tab';
  if (!boxFree_(sh, 'M1:O20', title)) return 'Paid: M1:O20 not empty, box NOT written';
  sh.getRange('M1').setValue(title);
  sh.getRange('M2:N5').setValues([
    ['Total revenue', '=SUM(E2:E)'],
    ['Number of sales', '=COUNTA(G2:G)'],
    ['Average sale', '=IFERROR(N2/N3,0)'],
    ['Deliveries that need you', '=COUNTIF(I2:I,"NEEDS YOU*")']]);
  sh.getRange('M7:O7').setValues([['product', 'sales', 'revenue']]);
  sh.getRange('M8:O9').setValues([
    ['Crawler Kit', '=COUNTIF(J2:J,M8)', '=SUMIF(J2:J,M8,E2:E)'],
    ['Investor Edition', '=COUNTIF(J2:J,M9)', '=SUMIF(J2:J,M9,E2:E)']]);
  sh.getRange('M10:O10').setValues([['Other / blank', '=N3-N8-N9', '=N2-O8-O9']]);
  sh.getRange('N2').setNumberFormat('$#,##0.00'); sh.getRange('N4').setNumberFormat('$#,##0.00');
  sh.getRange('O8:O10').setNumberFormat('$#,##0.00');
  sh.getRange('M2:N2').setFontWeight('bold').setFontSize(12);
  sh.getRange('M2:M10').setFontWeight('bold');
  sh.getRange('N2:O10').setHorizontalAlignment('center');
  sh.getRange('N5').setFontColor('#c5221f').setFontWeight('bold');
  boxStyle_(sh, st, 'M1:O1', ['M7:O7'], 'M1:O10', [180, 90, 100], 13);
  return 'Paid: box M1:O10 written';
}

// read-only: where Code.gs will write the next row on each tab (lastRow_ + 1), next to what getLastRow() would say
function checkRows() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), out = [];
  ['Waitlist', 'Visits', 'Paid'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    out.push(n + ': next row ' + (lastRow_(sh) + 1) + ' (getLastRow() would give ' + (sh.getLastRow() + 1) + ')');
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}
