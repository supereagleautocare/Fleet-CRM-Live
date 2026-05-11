/**
 * FLEET CRM — SHARED UTILITIES (PostgreSQL, multi-tenant)
 *
 * Every function takes `db` as its first argument.
 * Pass `req.db` from route handlers so queries run in the right shop's schema.
 */

const { pool } = require('../db/schema');

// ─── Raw query helpers ────────────────────────────────────────────────────────
async function query(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows;
}

async function queryOne(db, sql, params = []) {
  const result = await db.query(sql, params);
  return result.rows[0] || null;
}

async function execute(db, sql, params = []) {
  const result = await db.query(sql, params);
  const id = result.rows[0]?.id || null;
  return { lastInsertRowid: id, changes: result.rowCount };
}

// ─── Generate next Company ID (e.g. "CO-000171") ─────────────────────────────
async function getNextCompanyId(db) {
  const prefix  = await getSetting(db, 'company_id_prefix', 'CO-');
  const nextNum = parseInt(await getSetting(db, 'next_company_id', '1'), 10);
  await db.query(
    "UPDATE config_settings SET value = $1, updated_at = to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE key = 'next_company_id'",
    [String(nextNum + 1)]
  );
  return `${prefix}${String(nextNum).padStart(6, '0')}`;
}

// ─── Get a config setting value ───────────────────────────────────────────────
async function getSetting(db, key, fallback = null) {
  const row = await queryOne(db, 'SELECT value FROM config_settings WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

// ─── Calculate follow-up date ─────────────────────────────────────────────────
async function calcFollowUpDate(db, source, contact_type, action_type) {
  if (contact_type) {
    const rule = await queryOne(
      db,
      'SELECT days FROM config_rules WHERE contact_type = $1 AND enabled = 1 LIMIT 1',
      [contact_type]
    );
    if (rule) return addDays(rule.days);
  }
  if (action_type === 'mail')  return addDays(parseInt(await getSetting(db, 'mail_followup_days',  '30'), 10));
  if (action_type === 'email') return addDays(parseInt(await getSetting(db, 'email_followup_days', '14'), 10));
  if (action_type === 'visit') return addDays(parseInt(await getSetting(db, 'visit_delay_days',    '3'),  10));
  return addDays(parseInt(await getSetting(db, 'call_followup_days', '3'), 10));
}

// ─── Calculate visit date ─────────────────────────────────────────────────────
async function calcVisitDate(db) {
  const days = parseInt(await getSetting(db, 'visit_delay_days', '3'), 10);
  return addDays(days);
}

// ─── Add N calendar days ──────────────────────────────────────────────────────
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const dow = d.getDay();
  if (dow === 6) d.setDate(d.getDate() - 1);
  if (dow === 0) d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

// ─── Today as "YYYY-MM-DD" ───────────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}

// ─── Append a row to call_log ─────────────────────────────────────────────────
async function appendCallLog(db, data) {
  let countsAsAttempt = data.counts_as_attempt !== undefined ? data.counts_as_attempt : 1;
  if (data.counts_as_attempt === undefined && data.contact_type && data.action_type === 'Call') {
    const rule = await queryOne(
      db,
      'SELECT counts_as_attempt FROM config_rules WHERE contact_type = $1 AND action_type = $2 AND enabled = 1 LIMIT 1',
      [data.contact_type, 'call']
    );
    if (rule !== null) countsAsAttempt = rule.counts_as_attempt;
  }

  const result = await db.query(`
    INSERT INTO call_log (
      log_type, entity_id, company_id_str, entity_name, phone,
      direct_line, contact_name, role_title, email, industry,
      action_type, contact_type, notes,
      next_action, next_action_date, attempt_number,
      logged_by, logged_by_name,
      lifetime_visits, lifetime_spend, lifetime_gp_per_hr,
      last_visit_date, last_visit_ro_total, marketing_source,
      number_dialed, referral_name, referral_role, referral_phone, referral_email,
      log_category, counts_as_attempt
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31
    ) RETURNING *
  `, [
    data.log_type,
    data.entity_id,
    data.company_id_str    || null,
    data.entity_name,
    data.phone             || null,
    data.direct_line       || null,
    data.contact_name      || null,
    data.role_title        || null,
    data.email             || null,
    data.industry          || null,
    data.action_type,
    data.contact_type,
    data.notes             || null,
    data.next_action       || null,
    data.next_action_date  || null,
    data.attempt_number    || 1,
    data.logged_by         || null,
    data.logged_by_name    || null,
    data.lifetime_visits   || null,
    data.lifetime_spend    || null,
    data.lifetime_gp_per_hr || null,
    data.last_visit_date   || null,
    data.last_visit_ro_total || null,
    data.marketing_source  || null,
    data.number_dialed     || null,
    data.referral_name     || null,
    data.referral_role     || null,
    data.referral_phone    || null,
    data.referral_email    || null,
    data.log_category      || 'call',
    countsAsAttempt,
  ]);
  return result.rows[0];
}

// ─── Cancel old follow-ups ────────────────────────────────────────────────────
async function cancelOldFollowUps(db, source_type, entity_id) {
  await db.query(
    'DELETE FROM follow_ups WHERE source_type = $1 AND entity_id = $2 AND is_locked = 0',
    [source_type, entity_id]
  );
}

// ─── Clear ALL queue entries for a company ────────────────────────────────────
async function clearAllCompanyQueues(db, entity_id) {
  await db.query('DELETE FROM follow_ups    WHERE entity_id = $1 AND is_locked = 0', [entity_id]);
  await db.query('DELETE FROM calling_queue WHERE entity_id = $1', [entity_id]);
  await db.query('DELETE FROM visit_queue   WHERE entity_id = $1', [entity_id]);
}

// ─── Schedule next action ─────────────────────────────────────────────────────
async function scheduleNextAction(db, { company, contact_type, next_action, next_action_date_override, contact_name, direct_line, email, log_id }) {
  await clearAllCompanyQueues(db, company.id);

  if (!next_action || next_action === 'Stop') {
    await db.query(
      "UPDATE companies SET pipeline_stage='dead', company_status='dead', stage_updated_at=to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), updated_at=to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE id=$1",
      [company.id]
    );
    return { next_action_date: null, nextStage: 'dead' };
  }

  const stageMap = { Call:'call', Mail:'mail', Email:'email', Visit:'visit' };
  const nextStage = stageMap[next_action] || 'call';
  const next_action_date = next_action_date_override || await calcFollowUpDate(db, null, contact_type, nextStage);

  if (next_action === 'Visit') {
    const preferred = await queryOne(
      db,
      'SELECT * FROM company_contacts WHERE company_id=$1 AND is_preferred=1',
      [company.company_id]
    );
    await db.query(
      `INSERT INTO visit_queue (company_id,entity_id,entity_name,scheduled_date,address,city,contact_name,direct_line,email,source_log_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [company.company_id, company.id, company.name, next_action_date,
       company.address, company.city, contact_name||preferred?.name||null,
       direct_line||preferred?.direct_line||null, email||preferred?.email||null, log_id||null]
    );
  } else {
    await db.query(
      `INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,direct_line,industry,contact_name,due_date,source_log_id,next_action)
       VALUES ('company',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (source_type, entity_id) DO UPDATE
         SET due_date=$8, next_action=$10, source_log_id=$9`,
      [company.id, company.company_id, company.name, company.main_phone,
       direct_line||null, company.industry, contact_name||null,
       next_action_date, log_id||null, next_action]
    );
  }

  await db.query(
    "UPDATE companies SET pipeline_stage=$1, stage_updated_at=to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'), updated_at=to_char(now(),'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE id=$2",
    [nextStage, company.id]
  );

  if (log_id && next_action_date) {
    await db.query('UPDATE call_log SET next_action_date=$1 WHERE id=$2', [next_action_date, log_id]);
  }

  return { next_action_date, nextStage };
}

// ─── Rebuild follow-ups ───────────────────────────────────────────────────────
async function rebuildFollowUps(db) {
  const { rows: dueCalls } = await db.query(`
    SELECT DISTINCT ON (log_type, entity_id) *
    FROM call_log
    WHERE next_action = 'Call' AND next_action_date <= current_date
    ORDER BY log_type, entity_id, logged_at DESC
  `);

  const { rows: existing } = await db.query('SELECT * FROM follow_ups');
  const existingKeys = new Set(existing.map(r => `${r.source_type}:${r.entity_id}`));
  const shouldBeIn = new Set();
  let added = 0;

  for (const call of dueCalls) {
    const key = `${call.log_type}:${call.entity_id}`;
    shouldBeIn.add(key);
    if (!existingKeys.has(key)) {
      await db.query(
        `INSERT INTO follow_ups
          (source_type,entity_id,company_id_str,entity_name,phone,direct_line,industry,contact_name,due_date,source_log_id,working_notes,is_locked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,null,0)
         ON CONFLICT (source_type, entity_id) DO NOTHING`,
        [call.log_type, call.entity_id, call.company_id_str||null, call.entity_name,
         call.phone||null, call.direct_line||null, call.industry||null,
         call.contact_name||null, call.next_action_date, call.id]
      );
      added++;
    }
  }

  const toRemove = existing.filter(r => !shouldBeIn.has(`${r.source_type}:${r.entity_id}`) && !r.is_locked);
  for (const row of toRemove) {
    await db.query('DELETE FROM follow_ups WHERE id=$1', [row.id]);
  }

  const { rows: [{ cnt }] } = await db.query('SELECT COUNT(*) as cnt FROM follow_ups');
  return { added, removed: toRemove.length, total: parseInt(cnt) };
}

module.exports = {
  pool,
  query,
  queryOne,
  execute,
  getNextCompanyId,
  getSetting,
  calcFollowUpDate,
  calcVisitDate,
  addDays,
  today,
  appendCallLog,
  rebuildFollowUps,
  cancelOldFollowUps,
  clearAllCompanyQueues,
  scheduleNextAction,
};
