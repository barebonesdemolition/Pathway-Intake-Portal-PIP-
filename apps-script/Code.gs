/**
 * Intake backend. Bound to the Master Tracking Ledger Google Sheet.
 * Deploy as Web app: Execute as = Me, Who has access = Anyone.
 *
 * Secrets live in Project Settings > Script properties (never in the sheet or GitHub):
 *   ACCESS_CODE    shared code agents type into the form
 *   MINDEE_API_KEY key from platform.mindee.com
 *
 * Config tab (two columns, key in A, value in B):
 *   MAIN_FOLDER_ID | <Drive folder ID that will hold all candidate folders>
 *   TEAM_EMAILS    | review@example.com, accounts@example.com
 *   LEDGER_TAB     | Master Ledger        (optional, this is the default)
 *
 * Run setup() once from the editor to authorize scopes and prepare the ledger.
 */

var STATUSES = ['Lead Collected', 'Payment Verified', 'Documents Complete', 'In RCIC Review',
                'Strategy Issued', 'Needs More Documents', 'Closed'];

// form field name -> [Drive subfolder, human label]
var FILE_GROUPS = {
  receipt:     ['Payment Receipts', 'Receipt'],
  cv:          ['CV and Profile', 'CV'],
  passportDoc: ['Identity', 'Passport'],
  bank:        ['Financial', 'Bank Statement'],
  bizDocs:     ['Business', 'Business Doc'],
  edu:         ['Education and Experience', 'Education-Experience']
};

var COLUMNS = [
  'Ref', 'Submitted At', 'Status', 'Submitted By',
  'Full Name', 'DOB', 'Nationality', 'Passport No', 'Passport Expiry', 'Phone',
  'Category', 'Occupation (NOC title)', 'NOC', 'TEER', 'Actual Job Title', 'Employer',
  'Education', 'Experience', 'English', 'French',
  'Net Worth', 'Investment Capital', 'Ownership %', 'Business Plan',
  'Payment Status', 'Amount', 'Currency', 'Payment Method', 'Payment Recorded At',
  'Folder Link'
];

var THROTTLE_SECONDS = 30;

// ============================================================================
// Entry points
// ============================================================================

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();
    if (!req.token || req.token !== props.getProperty('ACCESS_CODE')) {
      return out({ ok: false, error: 'Wrong access code' });
    }
    if (req.action === 'ocr')    return out(ocrPassport(req.file, props));
    if (req.action === 'submit') {
      var throttle = checkThrottle(req.token);
      if (!throttle.ok) return out(throttle);
      return out(saveSubmission(req.fields, req.files || {}));
    }
    return out({ ok: false, error: 'Unknown action' });
  } catch (err) {
    console.error(err);
    return out({ ok: false, error: 'Server error: ' + err.message });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to authorize scopes and prepare the ledger. */
function setup() {
  var cfg = config();
  var sh = ledger(cfg);
  applyStatusValidation(sh);
  Logger.log('Setup complete. Ledger: ' + sh.getName());
}

// ============================================================================
// Config
// ============================================================================

function config() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sh) throw new Error('Config tab is missing');
  var cfg = {};
  sh.getDataRange().getValues().forEach(function (r) {
    if (r[0]) cfg[String(r[0]).trim()] = String(r[1]).trim();
  });
  if (!cfg.MAIN_FOLDER_ID) throw new Error('MAIN_FOLDER_ID missing in Config');
  return cfg;
}

function ledger(cfg) {
  var ss = SpreadsheetApp.getActive();
  var name = cfg.LEDGER_TAB || 'Master Ledger';
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    return sh;
  }
  // If the header row is missing new columns (e.g. after an upgrade), extend it.
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (header.length < COLUMNS.length) {
    sh.getRange(1, header.length + 1, 1, COLUMNS.length - header.length).setValues([COLUMNS.slice(header.length)]);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sh;
}

function applyStatusValidation(sh) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build();
  var statusCol = COLUMNS.indexOf('Status') + 1;
  sh.getRange(2, statusCol, sh.getMaxRows() - 1, 1).setDataValidation(rule);
}

// ============================================================================
// Throttle (per access code)
// ============================================================================

function checkThrottle(token) {
  var key = 'throttle_' + token;
  var cache = CacheService.getScriptCache();
  var last = cache.get(key);
  var now = Date.now();
  if (last) {
    var elapsed = Math.floor((now - Number(last)) / 1000);
    if (elapsed < THROTTLE_SECONDS) {
      return { ok: false, error: 'Please wait ' + (THROTTLE_SECONDS - elapsed) + ' seconds before submitting again.' };
    }
  }
  cache.put(key, String(now), THROTTLE_SECONDS);
  return { ok: true };
}

// ============================================================================
// Submission
// ============================================================================

function saveSubmission(f, files) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var folder = null;
  try {
    var cfg = config();
    var sh = ledger(cfg);
    var now = new Date();
    var ref = 'CA-' + Utilities.formatDate(now, 'UTC', 'yyMMdd') + '-' + ('000' + sh.getLastRow()).slice(-4);

    // Candidate folder (rolled back if anything below throws)
    var main = DriveApp.getFolderById(cfg.MAIN_FOLDER_ID);
    folder = main.createFolder(ref + ' - ' + clean(f.fullName));

    // Upload files
    var subs = {}, saved = 0;
    Object.keys(files).forEach(function (field) {
      var g = FILE_GROUPS[field];
      if (!g) return;
      subs[g[0]] = subs[g[0]] || folder.createFolder(g[0]);
      files[field].forEach(function (file, i) {
        var bytes = Utilities.base64Decode(file.data);
        var ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [''])[0];
        var blob = Utilities.newBlob(bytes, file.type || 'application/octet-stream',
                                     ref + ' ' + g[1] + ' ' + (i + 1) + ext);
        subs[g[0]].createFile(blob);
        saved++;
      });
    });

    // Build the ledger row in the same order as COLUMNS
    var paid = f.payStatus === 'Deposit Paid' || f.payStatus === 'Paid in Full';
    var row = [
      ref,
      f.submittedAt || now.toISOString(),
      'Lead Collected',
      f.submittedBy,
      f.fullName,
      f.dob,
      f.nationality,
      f.passportNumber,
      f.passportExpiry,
      f.phone,
      f.category,
      f.occupation || '',
      f.noc || '',
      f.teer || '',
      f.jobTitle,
      f.employer || '',
      f.education,
      f.experience,
      f.english,
      f.french,
      f.netWorth || '',
      f.investCapital || '',
      f.ownershipPct || '',
      f.businessPlan || '',
      f.payStatus,
      paid ? f.amount : '',
      paid ? f.currency : '',
      paid ? f.payMethod : '',
      paid ? now.toISOString() : '',
      folder.getUrl()
    ];

    // Force text so phone numbers, passport numbers, NOC codes keep leading zeros
    var r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, row.length).setNumberFormat('@').setValues([row]);

    // Team alert. No passport number or financial detail in the email body.
    if (cfg.TEAM_EMAILS) {
      MailApp.sendEmail({
        to: cfg.TEAM_EMAILS,
        subject: 'New intake ' + ref + ': ' + f.fullName + ' (' + f.category + ')',
        body: 'Ref: ' + ref + '\nCandidate: ' + f.fullName + '\nCategory: ' + f.category +
              (f.jobTitle ? '\nStated job title: ' + f.jobTitle : '') +
              '\nPayment: ' + f.payStatus + (paid ? ' (receipt attached to folder)' : '') +
              '\nFiles uploaded: ' + saved + '\nSubmitted by: ' + f.submittedBy +
              '\n\nFolder: ' + folder.getUrl() + '\nLedger: ' + SpreadsheetApp.getActive().getUrl()
      });
    }

    return { ok: true, ref: ref };
  } catch (err) {
    // Roll back the Drive folder if we created it but failed afterwards
    if (folder) {
      try { folder.setTrashed(true); } catch (cleanupErr) { console.error('Rollback failed', cleanupErr); }
    }
    throw err;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// Passport OCR (Mindee)
// ============================================================================

function ocrPassport(file, props) {
  var key = props.getProperty('MINDEE_API_KEY');
  if (!key) return { ok: false, error: 'OCR key not set' };
  var res = UrlFetchApp.fetch('https://api.mindee.net/v1/products/mindee/passport/v1/predict', {
    method: 'post',
    headers: { Authorization: 'Token ' + key },
    contentType: 'application/json',
    payload: JSON.stringify({ document: file.data }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() > 201) return { ok: false, error: 'Scan service error ' + res.getResponseCode() };
  var p = JSON.parse(res.getContentText()).document.inference.prediction;
  var val = function (x) { return x && x.value ? x.value : ''; };
  var given = (p.given_names || []).map(val).join(' ');
  return {
    ok: true,
    fields: {
      fullName: (given + ' ' + val(p.surname)).trim(),
      dob: val(p.birth_date),
      passportNumber: val(p.id_number),
      passportExpiry: val(p.expiry_date),
      nationality: val(p.country)   // issuing country code; agent should confirm
    }
  };
}

// ============================================================================
// Utilities
// ============================================================================

function clean(s) {
  return String(s || 'Unknown').replace(/[\\\/:*?"<>|]/g, '').trim();
}
