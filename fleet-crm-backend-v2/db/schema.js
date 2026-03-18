/**
 * FLEET CRM — DATABASE SCHEMA
 * Uses Node.js built-in sqlite (node:sqlite) — no installation needed!
 * Available in Node 22+ with the --experimental-sqlite flag.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'fleet_crm.db');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Open database
const db = new DatabaseSync(DB_PATH);

// Performance & integrity settings (use SQL PRAGMA instead of db.pragma)
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// ─── Schema ──────────────────────────────────────────────────────────────────
db.exec(`

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS companies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id    TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    main_phone    TEXT,
    industry      TEXT,
    address       TEXT,
    city          TEXT,
    state         TEXT,
    zip           TEXT,
    website       TEXT,
    notes         TEXT,
    status        TEXT    NOT NULL DEFAULT 'active',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS company_contacts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id   TEXT    NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    role_title   TEXT,
    direct_line  TEXT,
    email        TEXT,
    is_preferred INTEGER NOT NULL DEFAULT 0,
    notes        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS customers (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name           TEXT    NOT NULL,
    last_name            TEXT    NOT NULL,
    phone                TEXT    NOT NULL UNIQUE,
    email                TEXT,
    lifetime_visits      INTEGER DEFAULT 0,
    lifetime_spend       REAL    DEFAULT 0,
    lifetime_gp_per_hr   REAL    DEFAULT 0,
    last_visit_date      TEXT,
    last_visit_ro_total  REAL    DEFAULT 0,
    marketing_source     TEXT,
    notes                TEXT,
    status               TEXT    NOT NULL DEFAULT 'active',
    created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calling_queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_type     TEXT    NOT NULL,
    entity_id      INTEGER NOT NULL,
    contact_type   TEXT,
    contact_date   TEXT,
    next_action    TEXT,
    next_action_date TEXT,
    contact_name   TEXT,
    direct_line    TEXT,
    email          TEXT,
    role_title     TEXT,
    notes          TEXT,
    attempt_count  INTEGER NOT NULL DEFAULT 0,
    added_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    added_by       INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS call_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    log_type        TEXT    NOT NULL,
    entity_id       INTEGER NOT NULL,
    company_id_str  TEXT,
    entity_name     TEXT    NOT NULL,
    phone           TEXT,
    direct_line     TEXT,
    contact_name    TEXT,
    role_title      TEXT,
    email           TEXT,
    industry        TEXT,
    action_type     TEXT    NOT NULL,
    contact_type    TEXT    NOT NULL,
    notes           TEXT,
    next_action     TEXT,
    next_action_date TEXT,
    attempt_number  INTEGER NOT NULL DEFAULT 1,
    logged_by       INTEGER REFERENCES users(id),
    logged_by_name  TEXT,
    logged_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    lifetime_visits      INTEGER,
    lifetime_spend       REAL,
    lifetime_gp_per_hr   REAL,
    last_visit_date      TEXT,
    last_visit_ro_total  REAL,
    marketing_source     TEXT
  );

  CREATE TABLE IF NOT EXISTS follow_ups (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type      TEXT    NOT NULL,
    entity_id        INTEGER NOT NULL,
    company_id_str   TEXT,
    entity_name      TEXT    NOT NULL,
    phone            TEXT,
    direct_line      TEXT,
    industry         TEXT,
    contact_name     TEXT,
    due_date         TEXT    NOT NULL,
    source_log_id    INTEGER REFERENCES call_log(id),
    working_notes    TEXT,
    is_locked        INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS visit_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id      TEXT    NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
    entity_id       INTEGER NOT NULL REFERENCES companies(id),
    entity_name     TEXT    NOT NULL,
    scheduled_date  TEXT    NOT NULL,
    address         TEXT,
    city            TEXT,
    contact_name    TEXT,
    direct_line     TEXT,
    email           TEXT,
    notes           TEXT,
    working_notes   TEXT,
    is_locked       INTEGER NOT NULL DEFAULT 0,
    source_log_id   INTEGER REFERENCES call_log(id),
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config_rules (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT    NOT NULL DEFAULT 'both',
    contact_type TEXT    NOT NULL,
    days         INTEGER NOT NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    UNIQUE(source, contact_type)
  );

  CREATE TABLE IF NOT EXISTS config_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    label      TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS google_sync_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type  TEXT NOT NULL,
    entity_id    INTEGER NOT NULL,
    google_id    TEXT,
    last_synced  TEXT NOT NULL DEFAULT (datetime('now')),
    last_notes   TEXT,
    UNIQUE(source_type, entity_id)
  );

`);

// ─── Seed default follow-up rules ────────────────────────────────────────────
const ruleCount = db.prepare('SELECT COUNT(*) as cnt FROM config_rules').get().cnt;
if (ruleCount === 0) {
  const insertRule = db.prepare(
    'INSERT OR IGNORE INTO config_rules (source, contact_type, days, enabled) VALUES (?, ?, ?, 1)'
  );
  const defaultRules = [
    ['both',     'Voicemail',      3],
    ['both',     'No Answer',      1],
    ['both',     'Spoke To',       7],
    ['both',     'Gatekeeper',     3],
    ['both',     'Not Interested', 30],
    ['both',     'Call Back',      2],
    ['company',  'Left Message',   3],
    ['customer', 'Referral Given', 14],
  ];
  db.exec('BEGIN TRANSACTION');
  try {
    for (const [source, contact_type, days] of defaultRules) {
      insertRule.run(source, contact_type, days);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── Seed default settings ────────────────────────────────────────────────────
const settingsCount = db.prepare('SELECT COUNT(*) as cnt FROM config_settings').get().cnt;
if (settingsCount === 0) {
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO config_settings (key, value, label) VALUES (?, ?, ?)'
  );
  const defaults = [
    ['company_id_prefix',   'CO-',   'Company ID Prefix'],
    ['next_company_id',     '1',     'Next Company ID Number'],
    ['visit_delay_days',    '3',     'Days to delay visit after scheduling'],
    ['mail_followup_days',  '30',    'Default days until follow-up after mailing'],
    ['email_followup_days', '14',    'Default days until follow-up after emailing'],
    ['max_followups',       '200',   'Max rows in Follow-ups queue'],
    ['auto_populate_hour',  '6',     'Hour to auto-refresh follow-ups (24h)'],
    ['google_sync_enabled', 'false', 'Google Contacts sync enabled'],
    ['shop_address',        '3816 Monroe Rd, Charlotte, NC 28205', 'Shop / Home Base Address'],
    ['shop_lat',            '35.1965', 'Shop latitude (auto-set)'],
    ['shop_lng',            '-80.7812', 'Shop longitude (auto-set)'],
    ['fuel_price',          '3.50',  'Fuel price per gallon (for route cost estimate)'],
    ['mpg',                 '22',    'Vehicle MPG (for route cost estimate)'],
  ];
  db.exec('BEGIN TRANSACTION');
  try {
    for (const [key, value, label] of defaults) {
      insertSetting.run(key, value, label);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ─── Seed default admin user ─────────────────────────────────────────────────
const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
if (userCount === 0) {
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync('6521', 10);
  db.prepare(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Nathan', 'nathan@supereagleautocare.com', ?, 'admin')"
  ).run(hash);
  console.log('\n  ✅ Default admin user created:');
  console.log('     Email:    nathan@supereagleautocare.com');
  console.log('     Password: 6521');
  console.log('     ⚠️  Change this password after first login!\n');
}

console.log('✅ Database ready:', DB_PATH);

// ─── Migrations (safe — only adds if column doesn't exist) ───────────────────
const migrations = [
  // Multi-location support on companies
  "ALTER TABLE companies ADD COLUMN is_multi_location INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE companies ADD COLUMN location_group TEXT",
  "ALTER TABLE companies ADD COLUMN location_name TEXT",
  // Referral contact on call log
  "ALTER TABLE call_log ADD COLUMN referral_name TEXT",
  "ALTER TABLE call_log ADD COLUMN referral_role TEXT",
  "ALTER TABLE call_log ADD COLUMN referral_phone TEXT",
  "ALTER TABLE call_log ADD COLUMN referral_email TEXT",
  "ALTER TABLE call_log ADD COLUMN number_dialed TEXT",
  // Pipeline stage + warm lead star
  "ALTER TABLE companies ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new'",
  "ALTER TABLE companies ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE companies ADD COLUMN stage_updated_at TEXT",
  // Log category (call / mail / email / move)
  "ALTER TABLE call_log ADD COLUMN log_category TEXT NOT NULL DEFAULT 'call'",
  "ALTER TABLE call_log ADD COLUMN mail_piece TEXT",
  "ALTER TABLE call_log ADD COLUMN email_template TEXT",
  "ALTER TABLE call_log ADD COLUMN email_to TEXT",
  "ALTER TABLE call_log ADD COLUMN counts_as_attempt INTEGER NOT NULL DEFAULT 1",
  // Shop address settings
  "INSERT OR IGNORE INTO config_settings (key, value, label) VALUES ('shop_address', '3816 Monroe Rd, Charlotte, NC 28205', 'Shop / Home Base Address')",
  "INSERT OR IGNORE INTO config_settings (key, value, label) VALUES ('shop_lat', '35.1965', 'Shop latitude (auto-set)')",
  "INSERT OR IGNORE INTO config_settings (key, value, label) VALUES ('shop_lng', '-80.7812', 'Shop longitude (auto-set)')",
  "INSERT OR IGNORE INTO config_settings (key, value, label) VALUES ('fuel_price', '3.50', 'Fuel price per gallon')",
  "INSERT OR IGNORE INTO config_settings (key, value, label) VALUES ('mpg', '22', 'Vehicle MPG')",
  // Contact type per action (call/mail/email/visit)
  "ALTER TABLE config_rules ADD COLUMN action_type TEXT NOT NULL DEFAULT 'call'",
  // Geocoded coordinates for distance calculation
  "ALTER TABLE companies ADD COLUMN lat REAL",
  "ALTER TABLE companies ADD COLUMN lng REAL",
  // Rule enhancements
  "ALTER TABLE config_rules ADD COLUMN counts_as_attempt INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE config_rules ADD COLUMN dead_action TEXT NOT NULL DEFAULT 'none'",
  "ALTER TABLE config_rules ADD COLUMN snooze_days INTEGER NOT NULL DEFAULT 90",
];
for (const sql of migrations) {
  try { db.exec(sql); } catch(e) { /* column already exists — skip */ }
}

// ─── Seed default contact types per action if none exist ─────────────────────
const callTypeCount = db.prepare("SELECT COUNT(*) as cnt FROM config_rules WHERE action_type='call'").get().cnt;
if (callTypeCount === 0) {
  const callTypes = [
    ['Spoke To', 0], ['Voicemail', 3], ['No Answer', 2], ['Gatekeeper', 3],
    ['Not Interested', 90], ['Call Back', 5], ['Left Message', 5], ['Drop In', 0], ['Referral Given', 0],
  ];
  const mailTypes = [
    ['Postcard', 30], ['Handwritten Letter', 30], ['Intro Letter', 30], ['Follow-Up Letter', 21], ['Flyer', 30],
  ];
  const emailTypes = [
    ['Intro Email', 14], ['Follow-Up Email', 7], ['Proposal', 14], ['Newsletter', 30],
  ];
  const visitTypes = [
    ['Spoke To Decision Maker', 14], ['Spoke To Receptionist', 7], ['Left Materials', 7],
    ['Spoke To Fleet Manager', 14], ['No One Available', 3], ['Drop Off Flyer', 7],
  ];
  const stmt = db.prepare("INSERT OR IGNORE INTO config_rules (source, action_type, contact_type, days, enabled) VALUES ('company', ?, ?, ?, 1)");
  for (const [ct, days] of callTypes)  stmt.run('call',  ct, days);
  for (const [ct, days] of mailTypes)  stmt.run('mail',  ct, days);
  for (const [ct, days] of emailTypes) stmt.run('email', ct, days);
  for (const [ct, days] of visitTypes) stmt.run('visit', ct, days);
}

// ─── Add next_action column to follow_ups if missing ─────────────────────────
try { db.exec("ALTER TABLE follow_ups ADD COLUMN next_action TEXT"); } catch(_) {}
try { db.exec("ALTER TABLE follow_ups ADD COLUMN next_action_date TEXT"); } catch(_) {}

// ─── Deduplicate follow_ups + enforce unique constraint ───────────────────────
// Runs on every startup. Wipes any duplicate rows (keeps newest per entity),
// then creates a UNIQUE INDEX so duplicates can never accumulate again.
try {
  db.exec(`
    DELETE FROM follow_ups
    WHERE id NOT IN (
      SELECT MAX(id) FROM follow_ups GROUP BY source_type, entity_id
    )
  `);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_entity ON follow_ups(source_type, entity_id)`);
} catch(e) { /* already clean — safe to ignore */ }

// Scripts table
db.exec(`
  CREATE TABLE IF NOT EXISTS scripts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    blocks     TEXT    NOT NULL DEFAULT '[]',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Mail pieces table (defined in Settings)
db.exec(`
  CREATE TABLE IF NOT EXISTS mail_pieces (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    type       TEXT    NOT NULL DEFAULT 'postcard',
    notes      TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Email templates table (Campaign A)
db.exec(`
  CREATE TABLE IF NOT EXISTS email_templates (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    subject    TEXT,
    body       TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Scorecard tables ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS scorecard_questions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id   INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
    question    TEXT    NOT NULL,
    yes_points  REAL    NOT NULL DEFAULT 1,
    no_points   REAL    NOT NULL DEFAULT 0,
    partial_points REAL NOT NULL DEFAULT 0.5,
    enabled     INTEGER NOT NULL DEFAULT 1,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scorecard_entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    call_log_id  INTEGER REFERENCES call_log(id),
    entity_id    INTEGER,
    entity_name  TEXT,
    script_ids   TEXT NOT NULL DEFAULT '[]',
    answers      TEXT NOT NULL DEFAULT '{}',
    total_score  REAL NOT NULL DEFAULT 0,
    max_score    REAL NOT NULL DEFAULT 0,
    notes        TEXT,
    rep_name     TEXT,
    logged_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Scorecard migrations ──────────────────────────────────────────────────────
try { db.prepare("ALTER TABLE scorecard_entries ADD COLUMN reviewer_notes TEXT").run(); } catch(_) {}
try { db.prepare("ALTER TABLE scorecard_entries ADD COLUMN reviewed_by TEXT").run(); } catch(_) {}
try { db.prepare("ALTER TABLE scorecard_entries ADD COLUMN reviewed_at TEXT").run(); } catch(_) {}

// ─── Scorecard global enabled setting ─────────────────────────────────────────
try {
  db.prepare("INSERT OR IGNORE INTO config_settings (key, value, label) VALUES (?, ?, ?)").run(
    'scorecard_enabled', '0', 'Scorecard — pop up after every call'
  );
} catch(_) {}

module.exports = db;

// ─── Phase-based script extensions ───────────────────────────────────────────
// Scripts now store phases + sections in JSON blocks field.
// section_questions stores per-section scorecard questions (separate from
// the old flat scorecard_questions which was per-script).
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS section_questions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id    INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
      phase_id     TEXT    NOT NULL,
      section_id   TEXT    NOT NULL,
      question     TEXT    NOT NULL,
      yes_points   REAL    NOT NULL DEFAULT 1,
      no_points    REAL    NOT NULL DEFAULT 0,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch(_) {}

// Voicemail tracker — remembers last VM left per company
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voicemail_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id   INTEGER,
      entity_name TEXT,
      vm_index    INTEGER NOT NULL,
      vm_label    TEXT,
      logged_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
} catch(_) {}

// ─── Seed test companies (idempotent — safe across restarts) ──────────────────
try {
  const seedCos = [
    { company_id:'seed_001', name:'Apex Logistics Group',    main_phone:'(704) 555-0142', industry:'Logistics',      address:'1823 Industrial Blvd',      city:'Charlotte', state:'NC', zip:'28206', pipeline_stage:'new', notes:'Test company — 12 vehicle fleet, currently uses Jiffy Lube' },
    { company_id:'seed_002', name:'Piedmont Landscaping Co', main_phone:'(704) 555-0287', industry:'Landscaping',    address:'4501 South Blvd',           city:'Charlotte', state:'NC', zip:'28209', pipeline_stage:'new', notes:'Test company — spoke with owner Mike, good prospect' },
    { company_id:'seed_003', name:'Carolina HVAC Solutions', main_phone:'(980) 555-0364', industry:'HVAC',           address:'7200 University City Blvd', city:'Charlotte', state:'NC', zip:'28213', pipeline_stage:'new', notes:'Test company — fleet of 8 vans, wants pricing info' },
    { company_id:'seed_004', name:'Tryon Street Catering',   main_phone:'(704) 555-0419', industry:'Food & Beverage',address:'312 S Tryon St',             city:'Charlotte', state:'NC', zip:'28202', pipeline_stage:'new', notes:'Test company — 5 delivery vehicles, open to meeting' },
  ];
  const seedContacts = {
    seed_001: { name:'James Harmon',  role:'Fleet Manager' },
    seed_002: { name:'Mike Tanner',   role:'Owner' },
    seed_003: { name:'Sandra Reeves', role:'Operations Manager' },
    seed_004: { name:'David Chen',    role:'Owner' },
  };

  const stmtCo = db.prepare(`INSERT OR IGNORE INTO companies (company_id,name,main_phone,industry,address,city,state,zip,pipeline_stage,notes) VALUES (@company_id,@name,@main_phone,@industry,@address,@city,@state,@zip,@pipeline_stage,@notes)`);
  for (const co of seedCos) {
    stmtCo.run(co);
    const ct = seedContacts[co.company_id];
    if (ct) {
      const dup = db.prepare("SELECT COUNT(*) as n FROM company_contacts WHERE company_id=? AND name=?").get(co.company_id, ct.name);
      if (!dup || dup.n === 0) {
        db.prepare("INSERT INTO company_contacts (company_id,name,role_title,is_preferred) VALUES (?,?,?,1)").run(co.company_id, ct.name, ct.role);
      }
    }
  }
  // Clean up any duplicates left from previous runs
  db.exec(`DELETE FROM company_contacts WHERE id NOT IN (SELECT MIN(id) FROM company_contacts GROUP BY company_id,name) AND company_id IN ('seed_001','seed_002','seed_003','seed_004')`);
} catch(e) { /* non-fatal */ }

// ─── Ensure seed companies are in calling_queue so they always appear ─────────
try {
  const seedIds = ['seed_001','seed_002','seed_003','seed_004'];
  for (const cid of seedIds) {
    const co = db.prepare("SELECT id FROM companies WHERE company_id=?").get(cid);
    if (co) {
      const inQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(co.id);
      if (!inQ) {
        db.prepare("INSERT INTO calling_queue (queue_type,entity_id) VALUES ('company',?)").run(co.id);
      }
    }
  }
} catch(e) { /* non-fatal */ }

// ─── User permissions column ──────────────────────────────────────────────────
try { db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'"); } catch(_) {}
