/**
 * FLEET CRM — MULTI-TENANT SCHEMA MANAGEMENT
 *
 * Each shop gets its own Postgres schema (folder of tables).
 * A shared `platform` schema holds the master tenant registry.
 *
 * Schema layout:
 *   platform.tenants       — master list of all shops
 *   platform.tenant_users  — maps user email → their shop's schema
 *   public                 — default schema for the first (Super Eagle) shop
 *   shop_<slug>            — schema for every subsequent shop
 */

const { pool } = require('./schema');
const bcrypt = require('bcryptjs');

// ─── Schema-scoped database interface ────────────────────────────────────────
// Returns a db object whose .query() and .connect() always run inside
// the given schema. Pass this as `req.db` so all route queries are isolated.
function makeDb(schema) {
  return {
    async query(sql, params = []) {
      const client = await pool.connect();
      try {
        await client.query(`SET search_path TO "${schema}", platform, public`);
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    },
    // Returns a client with search_path already set — caller is responsible
    // for calling client.release() when done (including after transactions).
    async connect() {
      const client = await pool.connect();
      await client.query(`SET search_path TO "${schema}", platform, public`);
      return client;
    },
    schema,
  };
}

// ─── Platform schema (runs once on startup) ───────────────────────────────────
async function initPlatformSchema(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS platform`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.tenants (
      id         SERIAL PRIMARY KEY,
      slug       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      schema     TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS platform.tenant_users (
      id         SERIAL PRIMARY KEY,
      email      TEXT NOT NULL UNIQUE,
      schema     TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    )
  `);
}

// ─── Shop schema (creates all CRM tables inside a named schema) ───────────────
async function initShopSchema(client, schemaName) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      name          TEXT    NOT NULL,
      email         TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL,
      role          TEXT    NOT NULL DEFAULT 'user',
      permissions   TEXT    NOT NULL DEFAULT '{}',
      created_at    TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS companies (
      id                 SERIAL PRIMARY KEY,
      company_id         TEXT    NOT NULL UNIQUE,
      name               TEXT    NOT NULL,
      main_phone         TEXT,
      industry           TEXT,
      address            TEXT,
      city               TEXT,
      state              TEXT,
      zip                TEXT,
      website            TEXT,
      notes              TEXT,
      status             TEXT    NOT NULL DEFAULT 'active',
      pipeline_stage     TEXT    NOT NULL DEFAULT 'new',
      is_starred         INTEGER NOT NULL DEFAULT 0,
      company_status     TEXT    NOT NULL DEFAULT 'prospect',
      stage_updated_at   TEXT,
      is_multi_location  INTEGER NOT NULL DEFAULT 0,
      location_group     TEXT,
      location_name      TEXT,
      lat                REAL,
      lng                REAL,
      fleet_research     TEXT,
      created_at         TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at         TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS company_contacts (
      id           SERIAL PRIMARY KEY,
      company_id   TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      role_title   TEXT,
      direct_line  TEXT,
      email        TEXT,
      is_preferred INTEGER NOT NULL DEFAULT 0,
      notes        TEXT,
      created_at   TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at   TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id                   SERIAL PRIMARY KEY,
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
      created_at           TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at           TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS calling_queue (
      id               SERIAL PRIMARY KEY,
      queue_type       TEXT    NOT NULL,
      entity_id        INTEGER NOT NULL,
      contact_type     TEXT,
      contact_date     TEXT,
      next_action      TEXT,
      next_action_date TEXT,
      contact_name     TEXT,
      direct_line      TEXT,
      email            TEXT,
      role_title       TEXT,
      notes            TEXT,
      attempt_count    INTEGER NOT NULL DEFAULT 0,
      added_at         TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      added_by         INTEGER
    );

    CREATE TABLE IF NOT EXISTS call_log (
      id               SERIAL PRIMARY KEY,
      log_type         TEXT    NOT NULL,
      entity_id        INTEGER NOT NULL,
      company_id_str   TEXT,
      entity_name      TEXT    NOT NULL,
      phone            TEXT,
      direct_line      TEXT,
      contact_name     TEXT,
      role_title       TEXT,
      email            TEXT,
      industry         TEXT,
      action_type      TEXT    NOT NULL,
      contact_type     TEXT    NOT NULL,
      notes            TEXT,
      next_action      TEXT,
      next_action_date TEXT,
      attempt_number   INTEGER NOT NULL DEFAULT 1,
      logged_by        INTEGER,
      logged_by_name   TEXT,
      logged_at        TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      lifetime_visits      INTEGER,
      lifetime_spend       REAL,
      lifetime_gp_per_hr   REAL,
      last_visit_date      TEXT,
      last_visit_ro_total  REAL,
      marketing_source     TEXT,
      referral_name    TEXT,
      referral_role    TEXT,
      referral_phone   TEXT,
      referral_email   TEXT,
      number_dialed    TEXT,
      log_category     TEXT    NOT NULL DEFAULT 'call',
      mail_piece       TEXT,
      email_template   TEXT,
      email_to         TEXT,
      counts_as_attempt INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id               SERIAL PRIMARY KEY,
      source_type      TEXT    NOT NULL,
      entity_id        INTEGER NOT NULL,
      company_id_str   TEXT,
      entity_name      TEXT    NOT NULL,
      phone            TEXT,
      direct_line      TEXT,
      industry         TEXT,
      contact_name     TEXT,
      due_date         TEXT    NOT NULL,
      next_action      TEXT,
      next_action_date TEXT,
      source_log_id    INTEGER,
      working_notes    TEXT,
      is_locked        INTEGER NOT NULL DEFAULT 0,
      created_at       TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_followups_entity
      ON follow_ups(source_type, entity_id);

    CREATE TABLE IF NOT EXISTS visit_queue (
      id              SERIAL PRIMARY KEY,
      company_id      TEXT    NOT NULL,
      entity_id       INTEGER NOT NULL,
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
      source_log_id   INTEGER,
      created_at      TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS config_rules (
      id           SERIAL PRIMARY KEY,
      source       TEXT    NOT NULL DEFAULT 'both',
      action_type  TEXT    NOT NULL DEFAULT 'call',
      contact_type TEXT    NOT NULL,
      days         INTEGER NOT NULL,
      enabled      INTEGER NOT NULL DEFAULT 1,
      counts_as_attempt INTEGER NOT NULL DEFAULT 1,
      dead_action  TEXT    NOT NULL DEFAULT 'none',
      snooze_days  INTEGER NOT NULL DEFAULT 90,
      UNIQUE(source, action_type, contact_type)
    );

    CREATE TABLE IF NOT EXISTS config_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      label      TEXT,
      updated_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS scripts (
      id         SERIAL PRIMARY KEY,
      name       TEXT    NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      blocks     TEXT    NOT NULL DEFAULT '[]',
      created_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS mail_pieces (
      id         SERIAL PRIMARY KEY,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'postcard',
      notes      TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id         SERIAL PRIMARY KEY,
      name       TEXT    NOT NULL,
      subject    TEXT,
      body       TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      updated_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS scorecard_questions (
      id             SERIAL PRIMARY KEY,
      script_id      INTEGER NOT NULL,
      question       TEXT    NOT NULL,
      yes_points     REAL    NOT NULL DEFAULT 1,
      no_points      REAL    NOT NULL DEFAULT 0,
      partial_points REAL    NOT NULL DEFAULT 0.5,
      enabled        INTEGER NOT NULL DEFAULT 1,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS scorecard_entries (
      id             SERIAL PRIMARY KEY,
      call_log_id    INTEGER,
      entity_id      INTEGER,
      entity_name    TEXT,
      script_ids     TEXT NOT NULL DEFAULT '[]',
      answers        TEXT NOT NULL DEFAULT '{}',
      total_score    REAL NOT NULL DEFAULT 0,
      max_score      REAL NOT NULL DEFAULT 0,
      notes          TEXT,
      rep_name       TEXT,
      reviewer_notes TEXT,
      reviewed_by    TEXT,
      reviewed_at    TEXT,
      logged_at      TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS section_questions (
      id         SERIAL PRIMARY KEY,
      script_id  INTEGER NOT NULL,
      phase_id   TEXT    NOT NULL,
      section_id TEXT    NOT NULL,
      question   TEXT    NOT NULL,
      yes_points REAL    NOT NULL DEFAULT 1,
      no_points  REAL    NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT    NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS voicemail_log (
      id          SERIAL PRIMARY KEY,
      entity_id   INTEGER,
      entity_name TEXT,
      vm_index    INTEGER NOT NULL,
      vm_label    TEXT,
      logged_at   TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS google_sync_log (
      id           SERIAL PRIMARY KEY,
      source_type  TEXT NOT NULL,
      entity_id    INTEGER NOT NULL,
      google_id    TEXT,
      last_synced  TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
      last_notes   TEXT,
      UNIQUE(source_type, entity_id)
    );

    CREATE TABLE IF NOT EXISTS fleet_finder_dismissed (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      address      TEXT,
      phone        TEXT,
      city         TEXT,
      state        TEXT,
      dismissed_at TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );

    CREATE TABLE IF NOT EXISTS fleet_finder_seen (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      address    TEXT,
      city       TEXT,
      state      TEXT,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fleet_finder_cost_log (
      id            SERIAL PRIMARY KEY,
      search_label  TEXT,
      industries    TEXT,
      radius_miles  REAL,
      result_count  INTEGER,
      input_tokens  INTEGER,
      output_tokens INTEGER,
      cost_usd      REAL,
      ran_at        TEXT NOT NULL DEFAULT (to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    );
  `);

  // Seed default config_settings
  await client.query(`
    INSERT INTO config_settings (key, value, label) VALUES
      ('company_id_prefix',   'CO-',   'Company ID Prefix'),
      ('next_company_id',     '1',     'Next Company ID Number'),
      ('visit_delay_days',    '3',     'Days to delay visit after scheduling'),
      ('mail_followup_days',  '30',    'Default days until follow-up after mailing'),
      ('email_followup_days', '14',    'Default days until follow-up after emailing'),
      ('call_followup_days',  '3',     'Default Call Follow-up Days'),
      ('max_followups',       '200',   'Max rows in Follow-ups queue'),
      ('auto_populate_hour',  '6',     'Hour to auto-refresh follow-ups (24h)'),
      ('shop_address',        '', 'Shop / Home Base Address'),
      ('shop_lat',            '', 'Shop latitude (auto-set)'),
      ('shop_lng',            '', 'Shop longitude (auto-set)'),
      ('fuel_price',          '3.50',  'Fuel price per gallon'),
      ('mpg',                 '22',    'Vehicle MPG'),
      ('scorecard_enabled',   '0',     'Scorecard — pop up after every call'),
      ('twilio_to_phone',     '',      'SMS Alert Phone Number'),
      ('biz_hours_start',     '7',     'Business Hours Start'),
      ('biz_hours_end',       '19',    'Business Hours End'),
      ('floor_poll_seconds',  '60',    'Shop Floor Refresh Seconds'),
      ('ff_monthly_budget',   '50',    'Fleet Finder Monthly Budget ($)'),
      ('ff_default_radius',   '25',    'Fleet Finder Default Search Radius (miles)'),
      ('ff_industries',       '["Pest Control","Telecom & Cable","HVAC","Plumbing","Electrical Contractors","Landscaping & Lawn Care","Delivery & Courier","Construction","Utilities","Security & Alarm","Medical & Home Health","Government & Municipal","Vending & Distribution","Cleaning & Janitorial","Fire Protection"]', 'Fleet Finder Enabled Industries'),
      ('ff_custom_industries','[]',    'Fleet Finder Custom Industries'),
      ('ff_vehicle_types',    '["passenger","light_duty","cargo_van","medium_duty","heavy_duty","diesel"]', 'Fleet Finder Vehicle Types'),
      ('ff_anthropic_key',    '',      'Fleet Finder Anthropic API Key')
    ON CONFLICT (key) DO NOTHING;
  `);

  // Seed default contact type rules
  await client.query(`
    INSERT INTO config_rules (source, action_type, contact_type, days, enabled) VALUES
      ('company', 'call',  'Spoke To',                0,  1),
      ('company', 'call',  'Voicemail',               3,  1),
      ('company', 'call',  'No Answer',               2,  1),
      ('company', 'call',  'Gatekeeper',              3,  1),
      ('company', 'call',  'Not Interested',          90, 1),
      ('company', 'call',  'Call Back',               5,  1),
      ('company', 'call',  'Left Message',            5,  1),
      ('company', 'call',  'Drop In',                 0,  1),
      ('company', 'call',  'Referral Given',          0,  1),
      ('company', 'mail',  'Postcard',                30, 1),
      ('company', 'mail',  'Handwritten Letter',      30, 1),
      ('company', 'mail',  'Intro Letter',            30, 1),
      ('company', 'mail',  'Follow-Up Letter',        21, 1),
      ('company', 'mail',  'Flyer',                   30, 1),
      ('company', 'email', 'Intro Email',             14, 1),
      ('company', 'email', 'Follow-Up Email',         7,  1),
      ('company', 'email', 'Proposal',                14, 1),
      ('company', 'email', 'Newsletter',              30, 1),
      ('company', 'visit', 'Spoke To Decision Maker', 14, 1),
      ('company', 'visit', 'Spoke To Receptionist',   7,  1),
      ('company', 'visit', 'Left Materials',          7,  1),
      ('company', 'visit', 'Spoke To Fleet Manager',  14, 1),
      ('company', 'visit', 'No One Available',        3,  1),
      ('company', 'visit', 'Drop Off Flyer',          7,  1)
    ON CONFLICT (source, action_type, contact_type) DO NOTHING;
  `);
}

// ─── Provision a brand-new tenant ─────────────────────────────────────────────
// Creates the schema, seeds it with all tables + defaults, registers in platform,
// and creates the admin user. Call this when a shop signs up.
async function provisionTenant({ shopSlug, shopName, adminName, adminEmail, adminPassword }) {
  const schemaName = `shop_${shopSlug.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create tables in the new schema
    await initShopSchema(client, schemaName);

    // 2. Reset search path so we can query platform tables
    await client.query(`SET search_path TO platform, public`);

    // 3. Register in platform
    await client.query(
      `INSERT INTO platform.tenants (slug, name, schema) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
      [shopSlug, shopName, schemaName]
    );

    // 4. Create admin user inside new schema
    await client.query(`SET search_path TO "${schemaName}"`);
    const hash = bcrypt.hashSync(adminPassword, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO NOTHING`,
      [adminName, adminEmail.toLowerCase().trim(), hash]
    );

    // 5. Map email → schema in platform
    await client.query(`SET search_path TO platform, public`);
    await client.query(
      `INSERT INTO platform.tenant_users (email, schema) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET schema = $2`,
      [adminEmail.toLowerCase().trim(), schemaName]
    );

    await client.query('COMMIT');
    return { schemaName };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Look up which schema a user belongs to ───────────────────────────────────
async function getSchemaForEmail(email) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO platform, public`);
    const { rows } = await client.query(
      `SELECT schema FROM platform.tenant_users WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    return rows[0]?.schema || null;
  } finally {
    client.release();
  }
}

// ─── Run a query directly against the platform schema ────────────────────────
async function platformQuery(sql, params = []) {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO platform, public`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ─── Get all tenant schemas (used by background jobs) ────────────────────────
async function getAllSchemas() {
  const client = await pool.connect();
  try {
    await client.query(`SET search_path TO platform, public`);
    const { rows } = await client.query(`SELECT schema FROM platform.tenants ORDER BY id`);
    return rows.map(r => r.schema);
  } finally {
    client.release();
  }
}

module.exports = {
  makeDb,
  initPlatformSchema,
  initShopSchema,
  provisionTenant,
  getSchemaForEmail,
  platformQuery,
  getAllSchemas,
};
