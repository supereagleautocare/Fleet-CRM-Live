/**
 * FLEET CRM — SHARED UTILITIES
 * Used by companies, customers, and followups routes.
 */

const db = require('../db/schema');

// ─── Generate next Company ID (e.g. "CO-000171") ─────────────────────────────
function getNextCompanyId() {
  const prefix = getSetting('company_id_prefix', 'CO-');
  const nextNum = parseInt(getSetting('next_company_id', '1'), 10);

  // Increment in settings
  db.prepare("UPDATE config_settings SET value = ?, updated_at = datetime('now') WHERE key = 'next_company_id'")
    .run(String(nextNum + 1));

  return `${prefix}${String(nextNum).padStart(6, '0')}`;
}

// ─── Get a config setting value ───────────────────────────────────────────────
function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM config_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

// ─── Calculate follow-up date based on contact_type rules ─────────────────────
// Returns a date string "YYYY-MM-DD" or null
function calcFollowUpDate(source, contact_type, action_type) {
  // What Happened always wins — look up contact_type rule regardless of queue
  if (contact_type) {
    const rule = db.prepare(`
      SELECT days FROM config_rules
      WHERE contact_type = ?
        AND enabled = 1
      LIMIT 1
    `).get(contact_type);

    if (rule) return addDays(rule.days);
  }

  // No rule found — fall back to the default for that queue
  if (action_type === 'mail')  return addDays(parseInt(getSetting('mail_followup_days',  '30'), 10));
  if (action_type === 'email') return addDays(parseInt(getSetting('email_followup_days', '14'), 10));
  if (action_type === 'visit') return addDays(parseInt(getSetting('visit_delay_days',    '3'),  10));
  return addDays(parseInt(getSetting('call_followup_days', '3'), 10));
}

// ─── Calculate visit date ─────────────────────────────────────────────────────
function calcVisitDate() {
  const days = parseInt(getSetting('visit_delay_days', '3'), 10);
  return addDays(days);
}

// ─── Add N calendar days to today → "YYYY-MM-DD", skipping weekends ──────────
// Saturday → Friday (back one day)
// Sunday   → Monday (forward one day)
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const dow = d.getDay(); // 0=Sun, 6=Sat
  if (dow === 6) d.setDate(d.getDate() - 1); // Sat → Fri
  if (dow === 0) d.setDate(d.getDate() + 1); // Sun → Mon
  return d.toISOString().split('T')[0];
}

// ─── Today as "YYYY-MM-DD" ───────────────────────────────────────────────────
function today() {
  return new Date().toISOString().split('T')[0];
}

// ─── Append a row to call_log (NEVER update this table) ──────────────────────
function appendCallLog(data) {
  const result = db.prepare(`
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.log_type,
    data.entity_id,
    data.company_id_str    || null,
    data.entity_name,
    data.phone              || null,
    data.direct_line        || null,
    data.contact_name       || null,
    data.role_title         || null,
    data.email              || null,
    data.industry           || null,
    data.action_type,
    data.contact_type,
    data.notes              || null,
    data.next_action        || null,
    data.next_action_date   || null,
    data.attempt_number     || 1,
    data.logged_by          || null,
    data.logged_by_name     || null,
    data.lifetime_visits    || null,
    data.lifetime_spend     || null,
    data.lifetime_gp_per_hr || null,
    data.last_visit_date    || null,
    data.last_visit_ro_total || null,
    data.marketing_source   || null,
    data.number_dialed      || null,
    data.referral_name      || null,
    data.referral_role      || null,
    data.referral_phone     || null,
    data.referral_email     || null,
    data.log_category       || 'call',
    data.counts_as_attempt  !== undefined ? data.counts_as_attempt : 1,
  );
  return db.prepare('SELECT * FROM call_log WHERE id = ?').get(result.lastInsertRowid);
}

// ─── Rebuild follow-ups from call_log ─────────────────────────────────────────
// Called nightly or on manual refresh.
// Takes the NEWEST call per entity that has next_action='Call' and next_action_date <= today.
// Preserves working_notes and locked rows.
function rebuildFollowUps() {
  // Get all log entries where next_action = 'Call', per entity, newest only
  const dueCalls = db.prepare(`
    SELECT cl.*,
           ROW_NUMBER() OVER (PARTITION BY cl.log_type, cl.entity_id ORDER BY cl.logged_at DESC) as rn
    FROM call_log cl
    WHERE cl.next_action = 'Call'
      AND cl.next_action_date <= date('now')
  `).all().filter(r => r.rn === 1);

  // What's already in follow_ups (for working_notes + locked preservation)
  const existing = db.prepare('SELECT * FROM follow_ups').all();
  const existingMap = {};
  for (const row of existing) {
    existingMap[`${row.source_type}:${row.entity_id}`] = row;
  }

  // What entities already have a follow_up
  const existingKeys = new Set(existing.map(r => `${r.source_type}:${r.entity_id}`));

  // Build a set of keys that SHOULD be in follow_ups
  const shouldBeIn = new Set();

  const insertFollowUp = db.prepare(`
    INSERT OR IGNORE INTO follow_ups
      (source_type, entity_id, company_id_str, entity_name, phone, direct_line,
       industry, contact_name, due_date, source_log_id, working_notes, is_locked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const call of dueCalls) {
    const key = `${call.log_type}:${call.entity_id}`;
    shouldBeIn.add(key);

    if (!existingKeys.has(key)) {
      // New entry
      insertFollowUp.run(
        call.log_type,
        call.entity_id,
        call.company_id_str || null,
        call.entity_name,
        call.phone || null,
        call.direct_line || null,
        call.industry || null,
        call.contact_name || null,
        call.next_action_date,
        call.id,
        null,   // working_notes starts blank
        0       // not locked
      );
    }
    // If already exists, don't touch it — preserve working_notes + locked
  }

  // Remove rows that are no longer due (and not locked)
  const toRemove = existing.filter(r => {
    const key = `${r.source_type}:${r.entity_id}`;
    return !shouldBeIn.has(key) && !r.is_locked;
  });

  for (const row of toRemove) {
    db.prepare('DELETE FROM follow_ups WHERE id = ?').run(row.id);
  }

  return {
    added: dueCalls.filter(c => !existingKeys.has(`${c.log_type}:${c.entity_id}`)).length,
    removed: toRemove.length,
    total: db.prepare('SELECT COUNT(*) as cnt FROM follow_ups').get().cnt
  };
}

module.exports = { getNextCompanyId, getSetting, calcFollowUpDate, calcVisitDate, addDays, today, appendCallLog, rebuildFollowUps, cancelOldFollowUps, clearAllCompanyQueues };

// ─── Cancel any open follow-ups for an entity before creating a new one ────────
// This ensures the most recent call always wins — no stale follow-ups
function cancelOldFollowUps(source_type, entity_id) {
  db.prepare(`
    DELETE FROM follow_ups
    WHERE source_type = ? AND entity_id = ? AND is_locked = 0
  `).run(source_type, entity_id);
}

// ─── Clear ALL queue entries for a company across every queue ─────────────────
// Call this before creating any new next-action so nothing stacks up
function clearAllCompanyQueues(entity_id) {
  db.prepare("DELETE FROM follow_ups    WHERE entity_id = ? AND is_locked = 0").run(entity_id);
  db.prepare("DELETE FROM calling_queue WHERE entity_id = ?").run(entity_id);
  db.prepare("DELETE FROM visit_queue   WHERE entity_id = ?").run(entity_id);
}
