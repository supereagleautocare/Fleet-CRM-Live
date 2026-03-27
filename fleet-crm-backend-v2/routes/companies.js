/**
 * FLEET CRM — COMPANY ROUTES
 *
 * Company Profiles  →  GET/POST/PUT   /api/companies
 * Company Contacts  →  GET/POST/PUT   /api/companies/:id/contacts
 * Calling Queue     →  GET/POST       /api/companies/queue
 * Complete Call     →  POST           /api/companies/queue/:id/complete
 * Import (CSV)      →  POST           /api/companies/import
 * History           →  GET            /api/companies/:id/history
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { getNextCompanyId, appendCallLog, cancelOldFollowUps, clearAllCompanyQueues, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

function normalizePhone(val) {
  return String(val || '').replace(/\D/g, '');
}

function normalizeName(val) {
  return String(val || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|llc|l\.l\.c|co|corp|corporation|company|ltd|limited)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanDateOnly(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function contactDisplayName(val) {
  const name = String(val || '').trim();
  return name || 'Unnamed Contact';
}

// ═══════════════════════════════════════════════════════
// COMPANY PROFILES
// ═══════════════════════════════════════════════════════

// GET /api/companies — list all companies
router.get('/', (req, res) => {
  const { search, industry, status = 'active', company_status, pipeline_stage, last_contacted } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (status !== 'all') { where += ' AND c.status = ?'; params.push(status); }
  if (search) {
    where += ' AND (c.name LIKE ? OR c.main_phone LIKE ? OR c.industry LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  if (industry) { where += ' AND c.industry = ?'; params.push(industry); }
  if (company_status) { where += ' AND c.company_status = ?'; params.push(company_status); }
  if (pipeline_stage) { where += ' AND c.pipeline_stage = ?'; params.push(pipeline_stage); }
  if (last_contacted === 'never') {
    where += ' AND cl.logged_at IS NULL';
  } else if (last_contacted === 'this_week') {
    where += " AND cl.logged_at >= date('now', '-7 days')";
  } else if (last_contacted === 'this_month') {
    where += " AND cl.logged_at >= date('now', '-30 days')";
  } else if (last_contacted === 'stale') {
    where += " AND (cl.logged_at IS NULL OR cl.logged_at < date('now', '-30 days'))";
  }

  const sql = `
    SELECT c.*,
      cc.name as preferred_contact_name,
      cc.role_title as preferred_contact_role,
      cl.contact_type as last_contact_type,
      cl.logged_at as last_contacted,
      fu.due_date as followup_due,
      fu.next_action as followup_action
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at FROM call_log
      WHERE log_type='company' AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
    ) cl ON cl.entity_id = c.id
    LEFT JOIN (
      SELECT entity_id, due_date, next_action
      FROM follow_ups
      WHERE source_type='company'
        AND id IN (SELECT MAX(id) FROM follow_ups WHERE source_type='company' GROUP BY entity_id)
    ) fu ON fu.entity_id = c.id
    ${where}
    ORDER BY c.name ASC
  `;
  res.json(db.prepare(sql).all(...params));
});

// GET /api/companies/nearby-data — all companies with last call info for map
router.get('/nearby-data', (req, res) => {
  const companies = db.prepare(`
    SELECT
      c.id, c.company_id, c.name, c.main_phone, c.industry,
      c.address, c.city, c.state, c.zip,
      c.lat, c.lng,
      cl.contact_type   AS last_contact_type,
      cl.logged_at      AS last_contacted,
      cl.notes          AS last_notes,
      cl.contact_name   AS last_contact_name,
      fu.due_date       AS followup_due,
      fu.id             AS followup_id
    FROM companies c
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at, notes, contact_name
      FROM call_log
      WHERE log_type = 'company'
        AND id IN (
          SELECT MAX(id) FROM call_log
          WHERE log_type = 'company'
          GROUP BY entity_id
        )
    ) cl ON cl.entity_id = c.id
    LEFT JOIN (
      SELECT entity_id, due_date, id
      FROM follow_ups
      WHERE source_type = 'company'
        AND id IN (
          SELECT MAX(id) FROM follow_ups
          WHERE source_type = 'company'
          GROUP BY entity_id
        )
    ) fu ON fu.entity_id = c.id
    WHERE c.status = 'active'
    ORDER BY c.name ASC
  `).all();
  res.json(companies);
});
// GET /api/companies/search-name?q=... — find companies with similar name (for duplicate detection)
router.get('/search-name', (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json([]);
  const term = q.trim().toLowerCase();
  const rows = db.prepare(`
    SELECT id, name, main_phone, address, city, is_multi_location, location_name, location_group
    FROM companies
    WHERE lower(name) LIKE ? AND status = 'active'
    ORDER BY name ASC LIMIT 10
  `).all(`%${term}%`);
  res.json(rows);
});
// GET /api/companies/:id — single company with contacts, stats, branches
router.get('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const contacts = db.prepare(
    'SELECT * FROM company_contacts WHERE company_id = ? ORDER BY is_preferred DESC, name ASC'
  ).all(company.company_id);

  const stats = db.prepare(`
    SELECT COUNT(*) as total_calls,
           MAX(logged_at) as last_contacted,
           MIN(logged_at) as first_contacted,
           SUM(CASE WHEN action_type != 'Move' THEN 1 ELSE 0 END) as total_contacts
    FROM call_log
    WHERE entity_id = ? AND log_type = 'company'
  `).get(req.params.id);

  const followup = db.prepare(`
    SELECT due_date, next_action FROM follow_ups
    WHERE entity_id = ? AND source_type = 'company' AND is_locked = 0
    ORDER BY due_date ASC LIMIT 1
  `).get(req.params.id);

  let branches = [];
  if (company.location_group) {
    branches = db.prepare(`
      SELECT c.id, c.name, c.location_name, c.main_phone, c.address, c.city,
             cl.contact_type AS last_contact_type,
             cl.logged_at    AS last_contacted
      FROM companies c
      LEFT JOIN (
        SELECT entity_id, contact_type, logged_at
        FROM call_log WHERE log_type = 'company'
          AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
      ) cl ON cl.entity_id = c.id
      WHERE c.location_group = ? AND c.id != ?
      ORDER BY c.name ASC
    `).all(company.location_group, company.id);
  }

  const queueEntry = db.prepare(
    "SELECT id, added_at FROM calling_queue WHERE queue_type='company' AND entity_id=?"
  ).get(req.params.id);

  const followUp = db.prepare(
    "SELECT due_date, next_action FROM follow_ups WHERE entity_id=? AND source_type='company' AND is_locked=0 ORDER BY id DESC LIMIT 1"
  ).get(req.params.id);

  res.json({ ...company, contacts, stats, branches, in_queue: !!queueEntry, queue_entry: queueEntry||null, follow_up: followUp||null });
});



// POST /api/companies — create new company profile
router.post('/', (req, res) => {
  const { name, main_phone, industry, address, city, state, zip, website, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Company name is required.' });

  if (main_phone) {
    const dupe = db.prepare('SELECT id FROM companies WHERE main_phone = ?').get(main_phone);
    if (dupe) return res.status(409).json({ error: 'A company with that phone number already exists.', existing_id: dupe.id });
  }

  const { is_multi_location, location_name, location_group } = req.body;
  const company_id = getNextCompanyId();
  const result = db.prepare(`
    INSERT INTO companies (company_id, name, main_phone, industry, address, city, state, zip, website, notes, is_multi_location, location_name, location_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(company_id, name.trim(), main_phone || null, industry || null,
         address || null, city || null, state || null, zip || null,
         website || null, notes || null,
         is_multi_location ? 1 : 0, location_name || null, location_group || name.trim());

  res.status(201).json(db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/companies/:id — update company profile
router.put('/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const fields = ['name', 'main_phone', 'industry', 'address', 'city', 'state', 'zip', 'website', 'notes', 'status', 'is_multi_location', 'location_group', 'location_name'];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update.' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id));
});

// ═══════════════════════════════════════════════════════
// COMPANY CONTACTS
// ═══════════════════════════════════════════════════════

router.get('/:id/contacts', (req, res) => {
  const company = db.prepare('SELECT company_id FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });
  res.json(db.prepare(
    'SELECT * FROM company_contacts WHERE company_id = ? ORDER BY is_preferred DESC, name ASC'
  ).all(company.company_id));
});

router.post('/:id/contacts', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const { name, role_title, direct_line, email, is_preferred, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Contact name is required.' });

  if (is_preferred) {
    db.prepare('UPDATE company_contacts SET is_preferred = 0 WHERE company_id = ?').run(company.company_id);
  }

  const result = db.prepare(`
    INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(company.company_id, name.trim(), role_title || null, direct_line || null,
         email || null, is_preferred ? 1 : 0, notes || null);

  res.status(201).json(db.prepare('SELECT * FROM company_contacts WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/contacts/:contactId', (req, res) => {
  const contact = db.prepare('SELECT * FROM company_contacts WHERE id = ?').get(req.params.contactId);
  if (!contact) return res.status(404).json({ error: 'Contact not found.' });

  const { name, role_title, direct_line, email, is_preferred, notes } = req.body;

  if (is_preferred) {
    db.prepare('UPDATE company_contacts SET is_preferred = 0 WHERE company_id = ?').run(contact.company_id);
  }

  db.prepare(`
    UPDATE company_contacts
    SET name = ?, role_title = ?, direct_line = ?, email = ?, is_preferred = ?, notes = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name ?? contact.name,
    role_title ?? contact.role_title,
    direct_line ?? contact.direct_line,
    email ?? contact.email,
    is_preferred !== undefined ? (is_preferred ? 1 : 0) : contact.is_preferred,
    notes ?? contact.notes,
    req.params.contactId
  );

  res.json(db.prepare('SELECT * FROM company_contacts WHERE id = ?').get(req.params.contactId));
});

router.delete('/contacts/:contactId', (req, res) => {
  const result = db.prepare('DELETE FROM company_contacts WHERE id = ?').run(req.params.contactId);
  if (result.changes === 0) return res.status(404).json({ error: 'Contact not found.' });
  res.json({ message: 'Contact deleted.' });
});

// ═══════════════════════════════════════════════════════
// COMPANY CALLING QUEUE (manual first-call queue)
// ═══════════════════════════════════════════════════════

router.get('/queue/list', (req, res) => {
  const rows = db.prepare(`
    SELECT
      q.*,
      c.name            AS company_name,
      c.company_id      AS company_id_str,
      c.main_phone,
      c.industry,
      c.address,
      c.city,
      cc.name           AS preferred_contact_name,
      cc.direct_line    AS preferred_direct_line,
      cc.email          AS preferred_email,
      cc.role_title     AS preferred_role
    FROM calling_queue q
    JOIN companies c      ON c.id = q.entity_id
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    WHERE q.queue_type = 'company'
    ORDER BY q.added_at ASC
  `).all();
  res.json(rows);
});

router.post('/queue', (req, res) => {
  const { company_id } = req.body;
  if (!company_id) return res.status(400).json({ error: 'company_id is required.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(company_id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const existing = db.prepare(
    "SELECT id FROM calling_queue WHERE queue_type = 'company' AND entity_id = ?"
  ).get(company_id);
  if (existing) return res.status(409).json({ error: 'Company is already in the calling queue.' });

  const result = db.prepare(`
    INSERT INTO calling_queue (queue_type, entity_id, added_by) VALUES ('company', ?, ?)
  `).run(company_id, req.user.id);

  res.status(201).json(db.prepare('SELECT * FROM calling_queue WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/queue/:queueId', (req, res) => {
  const result = db.prepare(
    "DELETE FROM calling_queue WHERE id = ? AND queue_type = 'company'"
  ).run(req.params.queueId);
  if (result.changes === 0) return res.status(404).json({ error: 'Queue entry not found.' });
  res.json({ message: 'Removed from queue.' });
});

// ═══════════════════════════════════════════════════════
// COMPLETE A COMPANY CALL  ← THE CORE ACTION
// POST /api/companies/queue/:queueId/complete
// All DB writes are wrapped in a transaction — if anything fails,
// nothing is written (no orphaned logs, no ghost queue entries).
// ═══════════════════════════════════════════════════════
router.post('/queue/:queueId/complete', (req, res) => {
  const queueRow = db.prepare(
    "SELECT * FROM calling_queue WHERE id = ? AND queue_type = 'company'"
  ).get(req.params.queueId);
  if (!queueRow) return res.status(404).json({ error: 'Queue entry not found.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(queueRow.entity_id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const {
    contact_type,
    contact_name,
    direct_line,
    email,
    role_title,
    notes,
    next_action,
    set_as_preferred,
    next_action_date_override,
    number_dialed,
    referral_name,
    referral_role,
    referral_phone,
    referral_email,
    save_referral_as_contact,
  } = req.body;

  if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
  if (!next_action)  return res.status(400).json({ error: 'next_action is required (Call/Visit/Stop).' });

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'company'"
  ).get(company.id).cnt;

  let logEntry;

  db.exec('BEGIN TRANSACTION');
  try {
    logEntry = appendCallLog({
      log_type: 'company',
      entity_id: company.id,
      company_id_str: company.company_id,
      entity_name: company.name,
      phone: company.main_phone,
      direct_line: direct_line || null,
      contact_name: contact_name || null,
      role_title: role_title || null,
      email: email || null,
      industry: company.industry,
      action_type: 'Call',
      contact_type,
      notes: notes || null,
      next_action,
      next_action_date: null,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      number_dialed: number_dialed || null,
      referral_name: referral_name || null,
      referral_role: referral_role || null,
      referral_phone: referral_phone || null,
      referral_email: referral_email || null,
    });

    // Save referral as permanent contact if requested
    if (save_referral_as_contact && referral_name) {
      const existing = db.prepare('SELECT id FROM company_contacts WHERE company_id = ? AND name = ?').get(company.company_id, referral_name);
      if (existing) {
        db.prepare(`UPDATE company_contacts SET direct_line=COALESCE(?,direct_line), email=COALESCE(?,email), role_title=COALESCE(?,role_title), updated_at=datetime('now') WHERE id=?`)
          .run(referral_phone||null, referral_email||null, referral_role||null, existing.id);
      } else {
        db.prepare(`INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred) VALUES (?,?,?,?,?,0)`)
          .run(company.company_id, referral_name, referral_role||null, referral_phone||null, referral_email||null);
      }
    }

    // Save as preferred contact if requested
    if (set_as_preferred && contact_name) {
      db.prepare('UPDATE company_contacts SET is_preferred = 0 WHERE company_id = ?').run(company.company_id);
      const existingContact = db.prepare('SELECT id FROM company_contacts WHERE company_id = ? AND name = ?').get(company.company_id, contact_name);
      if (existingContact) {
        db.prepare(`UPDATE company_contacts SET is_preferred = 1, direct_line = COALESCE(?, direct_line), email = COALESCE(?, email), role_title = COALESCE(?, role_title), updated_at = datetime('now') WHERE id = ?`)
          .run(direct_line || null, email || null, role_title || null, existingContact.id);
      } else {
        db.prepare(`INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred) VALUES (?, ?, ?, ?, ?, 1)`)
          .run(company.company_id, contact_name, role_title || null, direct_line || null, email || null);
      }
    }

    // Schedule next action — single source of truth
    const { next_action_date, nextStage } = scheduleNextAction(db, {
      company, contact_type, next_action, next_action_date_override,
      contact_name: contact_name || null,
      direct_line:  direct_line  || null,
      email:        email        || null,
      log_id:       logEntry.id,
    });

    // Remove from calling queue
    db.prepare('DELETE FROM calling_queue WHERE id = ?').run(req.params.queueId);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log call: ' + e.message });
  }

  res.json({
    message: 'Call logged successfully.',
    log_id: logEntry.id,
    next_action,
    attempt_number: priorAttempts + 1,
  });
});

// ═══════════════════════════════════════════════════════
// CALL HISTORY
// GET /api/companies/:id/history
// ═══════════════════════════════════════════════════════
router.get('/:id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT cl.*,
           u.name AS logged_by_name,
           se.id          AS scorecard_id,
           se.total_score AS scorecard_total,
           se.max_score   AS scorecard_max,
           se.script_ids  AS scorecard_script_ids
    FROM call_log cl
    LEFT JOIN users u ON u.id = cl.logged_by
    LEFT JOIN scorecard_entries se
           ON cl.action_type = 'Call'
          AND se.entity_id = cl.entity_id
          AND (se.call_log_id = cl.id
           OR (se.call_log_id IS NULL
               AND ABS(strftime('%s', se.logged_at) - strftime('%s', cl.logged_at)) < 300))
    WHERE cl.entity_id = ? AND cl.log_type = 'company'
    ORDER BY cl.logged_at DESC
  `).all(req.params.id);
  // Also do a loose match: scorecard entries for this entity that have no call_log_id
  // (logged from manual scorecard button) — attach to most recent call within 10 min
  res.json(rows);
});

// GET /api/companies/:id/followup — current scheduled follow-up
router.get('/:id/followup', (req, res) => {
  const row = db.prepare(
    "SELECT * FROM follow_ups WHERE entity_id = ? AND source_type = 'company' ORDER BY id DESC LIMIT 1"
  ).get(req.params.id);
  res.json(row || null);
});

// PUT /api/companies/:id/followup-date — manually update next follow-up date + move stage
router.put('/:id/followup-date', (req, res) => {
  const { due_date, action } = req.body;
  if (!due_date) return res.status(400).json({ error: 'due_date is required.' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  // Map action to pipeline stage
  const stageMap = { Call:'call', Visit:'visit', Mail:'mail', Email:'email' };
  const newStage = stageMap[action] || 'call';

  // Update pipeline stage
  db.prepare("UPDATE companies SET pipeline_stage = ? WHERE id = ?").run(newStage, company.id);

  // Update or insert follow_up
  const existing = db.prepare("SELECT * FROM follow_ups WHERE entity_id = ? AND source_type = 'company'").get(req.params.id);
  if (existing) {
    db.prepare("UPDATE follow_ups SET due_date = ?, next_action = ? WHERE id = ?").run(due_date, action||'Call', existing.id);
  } else {
    db.prepare("INSERT INTO follow_ups (source_type, entity_id, company_id_str, entity_name, phone, due_date, next_action) VALUES ('company',?,?,?,?,?,?)")
      .run(company.id, company.company_id, company.name, company.main_phone, due_date, action||'Call');
  }

  // If scheduling a Visit, insert into visit_queue
  if (action === 'Visit') {
    const preferred = db.prepare('SELECT * FROM company_contacts WHERE company_id=? AND is_preferred=1').get(company.company_id);
    db.prepare(`INSERT INTO visit_queue (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name, direct_line, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(company.company_id, company.id, company.name, due_date, company.address||'', company.city||'',
           preferred?.name||null, preferred?.direct_line||null, preferred?.email||null);
  }

  // Log to history
  const today = new Date().toISOString().split('T')[0];
  db.prepare(`INSERT INTO call_log (log_type, entity_id, company_id_str, entity_name, action_type, contact_type, notes, next_action, next_action_date, logged_at)
    VALUES ('company', ?, ?, ?, 'Move', 'Rescheduled', ?, ?, ?, ?)`)
    .run(company.id, company.company_id, company.name, `Rescheduled ${action||'Call'} follow-up to ${due_date}`, action||'Call', due_date, today);

  res.json({ message: 'Follow-up updated.', due_date, stage: newStage });
});

// PUT /api/companies/:id/geocode — store geocoded coordinates
router.put('/:id/geocode', (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE companies SET lat=?, lng=? WHERE id=?').run(lat||null, lng||null, req.params.id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// BULK IMPORT FROM CSV
// POST /api/companies/import
// ═══════════════════════════════════════════════════════
router.post('/import', (req, res) => {
  const { companies, add_to_queue = false, mode = 'prospects' } = req.body;
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'Provide an array of companies to import.' });
  }

  const results = { imported: 0, skipped: 0, contacts: 0, history: 0, duplicate_history: 0, matched_existing: 0, errors: [] };

  db.exec('BEGIN TRANSACTION');
  try {
    const existingCompaniesAtStart = [];

    for (const row of companies) {
      const name  = (row.name || '').trim();
      const phone = normalizePhone(row.main_phone);
      const normalizedName = normalizeName(name);
      if (!name) { results.skipped++; continue; }

      // Fast path: if frontend already resolved the CRM id, use it directly
      if (false && row.existing_crm_id) {
        results.matched_existing++;
        const ex = db.prepare('SELECT * FROM companies WHERE id = ?').get(row.existing_crm_id);
        if (ex) {
          // Attach history to existing company
          if (Array.isArray(row.history)) {
            for (const h of row.history) {
              if (!h.notes && !h.contact_type) continue;
              // Skip if exact duplicate already in call_log
              const dup = db.prepare(
                "SELECT id FROM call_log WHERE entity_id=? AND contact_type=? AND date(logged_at)=date(?) AND SUBSTR(notes,1,30)=SUBSTR(?,1,30)"
              ).get(ex.id, h.contact_type||'', h.logged_at||'', h.notes||'');
              if (dup) { results.duplicate_history++; continue; }
              db.prepare(`
                INSERT INTO call_log
                  (log_type,log_category,entity_id,company_id_str,entity_name,phone,industry,
                   contact_type,contact_name,role_title,direct_line,notes,
                   action_type,next_action,next_action_date,attempt_number,logged_at,logged_by_name,counts_as_attempt)
                VALUES ('company','call',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
              `).run(ex.id,ex.company_id,ex.name,ex.main_phone,ex.industry||null,
                h.contact_type||'Call',contactDisplayName(h.contact_name),h.role_title||null,normalizePhone(h.direct_line)||null,h.notes||null,
                h.action_type||'Call','Call',cleanDateOnly(h.next_action_date),
                h.attempt_number||1,h.logged_at||new Date().toISOString(),h.logged_by||'Import');
              results.history++;
            }
          }
          // Set follow-up date from the most recent imported row, or mark dead if latest row is Do Not Call
          if (row.is_dnc) {
            db.prepare("DELETE FROM follow_ups WHERE entity_id=? AND source_type='company'").run(ex.id);
            db.prepare("UPDATE companies SET pipeline_stage='dead' WHERE id=?").run(ex.id);
          } else if (cleanDateOnly(row.next_follow_up)) {
            const dueDate = cleanDateOnly(row.next_follow_up);
            const fuExists = db.prepare("SELECT id FROM follow_ups WHERE entity_id=? AND source_type='company'").get(ex.id);
            if (fuExists) {
              db.prepare("UPDATE follow_ups SET due_date=?, next_action='Call', next_action_date=?, entity_name=?, phone=? WHERE id=?")
                .run(dueDate, dueDate, ex.name, ex.main_phone, fuExists.id);
            } else {
              db.prepare("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action,next_action_date) VALUES ('company',?,?,?,?,?,?,?)")
                .run(ex.id, ex.company_id, ex.name, ex.main_phone, dueDate, 'Call', dueDate);
            }
            db.prepare("UPDATE companies SET pipeline_stage='call' WHERE id=?").run(ex.id);
          }
          results.skipped++;
          continue;
        }
      }

      // Dedup: match by name + phone first, then name, then phone
      let existingId = null;
      const existingCompanies = existingCompaniesAtStart;
      const exactNamePhone = existingCompanies.find(co => normalizedName && phone && normalizeName(co.name) === normalizedName && normalizePhone(co.main_phone) === phone);
      if (exactNamePhone) existingId = exactNamePhone.id;
      if (existingId) results.matched_existing++;
      if (!existingId) {
        const byName = existingCompanies.find(co => normalizedName && normalizeName(co.name) === normalizedName);
        if (byName) existingId = byName.id;
      }
      if (!existingId) {
        const byPhone = existingCompanies.find(co => phone && normalizePhone(co.main_phone) === phone);
        if (byPhone) existingId = byPhone.id;
      }

      let companyDbId, companyIdStr;

      if (existingId) {
        // Update existing company with new info if fields are blank
        const ex = db.prepare('SELECT * FROM companies WHERE id = ?').get(existingId);
        companyDbId = ex.id;
        companyIdStr = ex.company_id;
        db.prepare(`
          UPDATE companies SET
            industry  = COALESCE(NULLIF(industry,''), ?),
            address   = COALESCE(NULLIF(address,''),  ?),
            city      = COALESCE(NULLIF(city,''),     ?),
            state     = COALESCE(NULLIF(state,''),    ?),
            zip       = COALESCE(NULLIF(zip,''),      ?),
            website   = COALESCE(NULLIF(website,''),  ?),
            notes     = COALESCE(NULLIF(notes,''),    ?),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(row.industry||null, row.address||null, row.city||null, row.state||null, row.zip||null, row.website||null, row.notes||null, existingId);
        results.skipped++; // company itself skipped (already exists), but may add contacts/history
      } else {
        // Insert new company
        const company_id = getNextCompanyId(); // always generate fresh CRM id
        const insertResult = db.prepare(`
          INSERT INTO companies (company_id, name, main_phone, industry, address, city, state, zip, website, notes, pipeline_stage)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
        `).run(
          company_id, name, phone || null,
          row.industry || null, row.address || null, row.city || null,
          row.state || null, row.zip || null, row.website || null, row.notes || null
        );
        companyDbId = insertResult.lastInsertRowid;
        companyIdStr = company_id;
        results.imported++;

        if (add_to_queue) {
          const inQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(companyDbId);
          if (!inQ) db.prepare("INSERT INTO calling_queue (queue_type, entity_id, added_by) VALUES ('company', ?, ?)").run(companyDbId, req.user.id);
        }

                // Set follow-up date from the most recent imported row, or mark dead if latest row is Do Not Call
        if (row.is_dnc) {
          db.prepare("DELETE FROM follow_ups WHERE entity_id=? AND source_type='company'").run(companyDbId);
          db.prepare("UPDATE companies SET pipeline_stage='dead' WHERE id=?").run(companyDbId);
        } else if (cleanDateOnly(row.next_follow_up)) {
          const dueDate = cleanDateOnly(row.next_follow_up);
          db.prepare("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action,next_action_date) VALUES ('company',?,?,?,?,?,?,?)")
            .run(companyDbId, companyIdStr, name, phone||null, dueDate, 'Call', dueDate);
          db.prepare("UPDATE companies SET pipeline_stage='call' WHERE id=?").run(companyDbId);
        }
      }

       // Import contacts (including unnamed contacts with unique numbers/emails)
      if (Array.isArray(row.contacts)) {
        let preferredSet = false;
        for (const c of row.contacts) {
          const cname = contactDisplayName(c.name);
          const directLine = normalizePhone(c.direct_line);
          const email = String(c.email || '').trim().toLowerCase() || null;
          const roleTitle = String(c.role_title || '').trim() || null;
          const dup = db.prepare(`
            SELECT id FROM company_contacts
            WHERE company_id = ?
              AND lower(name) = lower(?)
              AND COALESCE(direct_line,'') = COALESCE(?, '')
              AND COALESCE(lower(email),'') = COALESCE(?, '')
              AND COALESCE(lower(role_title),'') = COALESCE(lower(?), '')
          `).get(companyIdStr, cname, directLine || '', email || '', roleTitle || '');
          if (!dup) {
            const shouldPrefer = !preferredSet && c.is_preferred ? 1 : 0;
            db.prepare(`INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred) VALUES (?,?,?,?,?,?)`)
              .run(companyIdStr, cname, roleTitle, directLine || null, email, shouldPrefer);
            if (shouldPrefer) preferredSet = true;
            results.contacts++;
          }
        }
      }

      // Import call history
      if (Array.isArray(row.history)) {
        for (const h of row.history) {
          if (!h.contact_type && !h.notes) continue;
          const loggedAt = h.logged_at || h.contact_date || new Date().toISOString();
          db.prepare(`
            INSERT INTO call_log
              (log_type, log_category, entity_id, company_id_str, entity_name, phone, industry,
               contact_type, contact_name, role_title, direct_line, email, notes,
               action_type, next_action, next_action_date, attempt_number, logged_at,
               logged_by_name, counts_as_attempt)
            VALUES ('company','call',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
          `).run(
            companyDbId, companyIdStr, name, phone||null, row.industry||null,
            h.contact_type||'Spoke To', contactDisplayName(h.contact_name), h.role_title||null,
            normalizePhone(h.direct_line)||null, h.email||null,
            h.notes||null, h.action_type||'Call', 'Call',
            cleanDateOnly(h.next_action_date), h.attempt_number||1,
            loggedAt, h.logged_by||'Import'
          );
          results.history++;
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Import failed: ' + e.message });
  }

  res.status(201).json(results);
});
router.post('/import-new-companies', (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'Provide an array of companies to import.' });
  }

  const results = {
    imported: 0,
    duplicates: 0,
    possible_duplicates: 0,
    chains: 0,
    review: [],
    errors: []
  };

  db.exec('BEGIN TRANSACTION');
  try {
    const existingCompanies = db.prepare(`
      SELECT id, company_id, name, main_phone, address, city, state, zip, location_group
      FROM companies
      WHERE status = 'active'
    `).all();

    for (const row of companies) {
      const name = String(row.name || '').trim();
      const phone = normalizePhone(row.main_phone);
      const normalizedName = normalizeName(name);

      if (!name) {
        results.errors.push({ row, error: 'Missing company name' });
        continue;
      }

      const exactNamePhone = existingCompanies.find(co =>
        normalizedName &&
        phone &&
        normalizeName(co.name) === normalizedName &&
        normalizePhone(co.main_phone) === phone
      );

      if (exactNamePhone) {
        results.duplicates++;
        results.review.push({
          type: 'duplicate',
          action: 'review',
          incoming: row,
          matched_company_id: exactNamePhone.id,
          matched_name: exactNamePhone.name,
          matched_phone: exactNamePhone.main_phone
        });
        continue;
      }

      const sameName = existingCompanies.find(co =>
        normalizedName &&
        normalizeName(co.name) === normalizedName
      );

      if (sameName) {
        results.possible_duplicates++;
        results.review.push({
          type: 'possible_duplicate_or_chain',
          action: 'review',
          incoming: row,
          matched_company_id: sameName.id,
          matched_name: sameName.name,
          matched_phone: sameName.main_phone
        });
        continue;
      }

      const company_id = getNextCompanyId();
      const insertResult = db.prepare(`
        INSERT INTO companies (
          company_id, name, main_phone, industry, address, city, state, zip, website, notes, pipeline_stage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
      `).run(
        company_id,
        name,
        phone || null,
        row.industry || null,
        row.address || null,
        row.city || null,
        row.state || null,
        row.zip || null,
        row.website || null,
        row.notes || null
      );

      existingCompanies.push({
        id: insertResult.lastInsertRowid,
        company_id,
        name,
        main_phone: phone || null,
        address: row.address || null,
        city: row.city || null,
        state: row.state || null,
        zip: row.zip || null,
        location_group: null
      });

      results.imported++;
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'New company import failed: ' + e.message });
  }

  res.status(201).json(results);
});
router.post('/backfill-followups', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const companies = db.prepare(`
    SELECT c.id, c.company_id, c.name, c.main_phone, c.pipeline_stage
    FROM companies c
    WHERE c.status = 'active'
      AND c.pipeline_stage IN ('new','call')
      AND NOT EXISTS (
        SELECT 1 FROM follow_ups WHERE entity_id = c.id AND source_type = 'company'
      )
  `).all();

  let created = 0;
  for (const co of companies) {
    db.prepare(`
      INSERT INTO follow_ups (source_type, entity_id, company_id_str, entity_name, phone, due_date, next_action)
      VALUES ('company', ?, ?, ?, ?, ?, 'Call')
    `).run(co.id, co.company_id, co.name, co.main_phone, today);
    db.prepare("UPDATE companies SET pipeline_stage='call' WHERE id=?").run(co.id);
    created++;
  }
  res.json({ message: `Created ${created} follow-up records.`, created });
});
// ─────────────────────────────────────────────────────────────────────────────
// BACKEND PATCH: fleet-crm-backend-v2/routes/companies.js
//
// TWO THINGS TO FIX:
//
// FIX 1 — Route ordering bug (search-name returns 404)
//   The route  router.get('/search-name', ...)  is currently placed AFTER
//   router.get('/:id', ...), so Express treats "search-name" as a company ID
//   and returns "Company not found."
//
//   SOLUTION: Move the /search-name route to BEFORE /:id.
//   Find this block in companies.js (currently near line 113):
//
//     // GET /api/companies/:id — single company with contacts, stats, branches
//     router.get('/:id', (req, res) => {
//
//   And move router.get('/search-name', ...) to appear BEFORE that block.
//   The /search-name route is already defined — just cut it and paste it above /:id.
//
// ─────────────────────────────────────────────────────────────────────────────
//
// FIX 2 — Add the merge endpoint
//   Add this entire block BEFORE the module.exports line at the bottom of companies.js.
//
// ─────────────────────────────────────────────────────────────────────────────

// ── MERGE TWO COMPANIES ───────────────────────────────────────────────────────
// POST /api/companies/:id/merge/:into_id
//
// Body: { field_choices: { name: 'source'|'target'|'combine', main_phone: 'source'|'target', ... } }
//
// What this does:
//   1. Validates both companies exist
//   2. Applies field choices to build the merged company record
//   3. Transfers: call_log, company_contacts, follow_ups, calling_queue, visit_queue
//   4. Removes source company
//   All inside a transaction — if anything fails, nothing changes.
//
router.post('/:id/merge/:into_id', (req, res) => {
  const sourceId = parseInt(req.params.id);
  const targetId = parseInt(req.params.into_id);
  const { field_choices = {} } = req.body;

  if (sourceId === targetId) {
    return res.status(400).json({ error: 'Cannot merge a company into itself.' });
  }

  const source = db.prepare('SELECT * FROM companies WHERE id = ?').get(sourceId);
  if (!source) return res.status(404).json({ error: 'Source company not found.' });

  const target = db.prepare('SELECT * FROM companies WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Target company not found.' });

  const MERGEABLE_FIELDS = ['name', 'main_phone', 'industry', 'address', 'city', 'state', 'zip', 'website', 'notes'];

  db.exec('BEGIN TRANSACTION');
  try {
    // ── 1. Build merged field values ────────────────────────────────────────
    const updates = [];
    const values = [];

    for (const field of MERGEABLE_FIELDS) {
  const choice = field_choices[field] || 'target';
  const srcVal = source[field];
  const tgtVal = target[field];

  // Special case: keep both phone numbers
  if (field === 'main_phone' && choice === 'both' && srcVal && tgtVal) {
    // Keep target's number as main phone on the company record
    updates.push('main_phone = ?');
    values.push(tgtVal);
    // Save source's number as a contact entry so it isn't lost
    const contactName = source.name + ' (alternate number)';
    const existingAlt = db.prepare(
      'SELECT id FROM company_contacts WHERE company_id = ? AND direct_line = ?'
    ).get(target.company_id, srcVal);
    if (!existingAlt) {
      db.prepare(
        'INSERT INTO company_contacts (company_id, name, role_title, direct_line, is_preferred) VALUES (?, ?, ?, ?, 0)'
      ).run(target.company_id, contactName, 'Alternate Phone', srcVal);
    }
    continue; // skip the normal update logic below
  }

  let merged;
  if (choice === 'source') {
    merged = srcVal || tgtVal;
  } else if (choice === 'combine' && srcVal && tgtVal) {
    merged = tgtVal + '\n\n---\n\n' + srcVal;
  } else {
    merged = tgtVal || srcVal;
  }

  if (merged !== undefined) {
    updates.push(`${field} = ?`);
    values.push(merged);
  }
}

    // Also inherit pipeline_stage and company_status if target is 'new'
    if (target.pipeline_stage === 'new' && source.pipeline_stage !== 'new') {
      updates.push('pipeline_stage = ?');
      values.push(source.pipeline_stage);
    }
    if ((!target.company_status || target.company_status === 'prospect') && source.company_status && source.company_status !== 'prospect') {
      updates.push('company_status = ?');
      values.push(source.company_status);
    }

    updates.push("updated_at = datetime('now')");
    values.push(targetId);

    if (updates.length > 1) { // at least one real field + updated_at
      db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    // ── 2. Transfer call_log ────────────────────────────────────────────────
    db.prepare(`
      UPDATE call_log
      SET entity_id = ?, company_id_str = ?, entity_name = ?
      WHERE entity_id = ? AND log_type = 'company'
    `).run(targetId, target.company_id, target.name, sourceId);

    // ── 3. Transfer contacts (skip duplicates by name) ──────────────────────
    const existingContacts = db.prepare(
      'SELECT name FROM company_contacts WHERE company_id = ?'
    ).all(target.company_id).map(c => c.name.toLowerCase().trim());

    const sourceContacts = db.prepare(
      'SELECT * FROM company_contacts WHERE company_id = ?'
    ).all(source.company_id);

    for (const contact of sourceContacts) {
      const isDupe = existingContacts.includes(contact.name.toLowerCase().trim());
      if (isDupe) {
        // Update the existing contact with any missing info
        db.prepare(`
          UPDATE company_contacts
          SET
            direct_line  = COALESCE(NULLIF(direct_line, ''), ?),
            email        = COALESCE(NULLIF(email, ''),        ?),
            role_title   = COALESCE(NULLIF(role_title, ''),  ?),
            notes        = COALESCE(NULLIF(notes, ''),        ?)
          WHERE company_id = ? AND lower(name) = lower(?)
        `).run(
          contact.direct_line || null,
          contact.email       || null,
          contact.role_title  || null,
          contact.notes       || null,
          target.company_id,
          contact.name
        );
      } else {
        // Insert as new contact (never preferred — target's preferred stays)
        db.prepare(`
          INSERT INTO company_contacts
            (company_id, name, role_title, direct_line, email, notes, is_preferred)
          VALUES (?, ?, ?, ?, ?, ?, 0)
        `).run(
          target.company_id,
          contact.name,
          contact.role_title  || null,
          contact.direct_line || null,
          contact.email       || null,
          contact.notes       || null
        );
        existingContacts.push(contact.name.toLowerCase().trim());
      }
    }

    // ── 4. Transfer follow_ups ──────────────────────────────────────────────
    // Remove target's existing follow-up if source has one with a date
    const sourceFU = db.prepare(
      "SELECT * FROM follow_ups WHERE entity_id = ? AND source_type = 'company' ORDER BY id DESC LIMIT 1"
    ).get(sourceId);
    const targetFU = db.prepare(
      "SELECT * FROM follow_ups WHERE entity_id = ? AND source_type = 'company' ORDER BY id DESC LIMIT 1"
    ).get(targetId);

    if (sourceFU && !targetFU) {
      // Move source follow-up to target
      db.prepare(`
        UPDATE follow_ups
        SET entity_id = ?, company_id_str = ?, entity_name = ?, phone = ?
        WHERE entity_id = ? AND source_type = 'company'
      `).run(targetId, target.company_id, target.name, target.main_phone, sourceId);
    } else if (sourceFU && targetFU) {
      // Keep the one with the sooner due date, delete the other
      if (sourceFU.due_date < targetFU.due_date) {
        db.prepare("UPDATE follow_ups SET due_date = ?, next_action = ? WHERE id = ?").run(sourceFU.due_date, sourceFU.next_action, targetFU.id);
      }
      db.prepare("DELETE FROM follow_ups WHERE entity_id = ? AND source_type = 'company'").run(sourceId);
    } else {
      // No source follow-up, just clean up any orphans
      db.prepare("DELETE FROM follow_ups WHERE entity_id = ? AND source_type = 'company'").run(sourceId);
    }

    // ── 5. Transfer calling_queue entries ───────────────────────────────────
    const targetInQueue = db.prepare(
      "SELECT id FROM calling_queue WHERE queue_type = 'company' AND entity_id = ?"
    ).get(targetId);

    if (!targetInQueue) {
      // Move source queue entry to target
      db.prepare(
        "UPDATE calling_queue SET entity_id = ? WHERE queue_type = 'company' AND entity_id = ?"
      ).run(targetId, sourceId);
    } else {
      // Target already in queue — just remove source duplicate
      db.prepare(
        "DELETE FROM calling_queue WHERE queue_type = 'company' AND entity_id = ?"
      ).run(sourceId);
    }

    // ── 6. Transfer visit_queue entries ─────────────────────────────────────
    db.prepare(`
      UPDATE visit_queue
      SET company_id = ?, entity_id = ?, entity_name = ?
      WHERE entity_id = ?
    `).run(target.company_id, targetId, target.name, sourceId);

    // ── 7. Transfer scorecard_entries ───────────────────────────────────────
    db.prepare(`
      UPDATE scorecard_entries SET entity_id = ?, entity_name = ?
      WHERE entity_id = ?
    `).run(targetId, target.name, sourceId);

    // ── 8. Log the merge in call_log (history audit) ─────────────────────────
    db.prepare(`
      INSERT INTO call_log
        (log_type, log_category, entity_id, company_id_str, entity_name, action_type, contact_type, notes, logged_at)
      VALUES ('company', 'move', ?, ?, ?, 'Move', 'Merged', ?, datetime('now'))
    `).run(
      targetId,
      target.company_id,
      target.name,
      `Merged from: ${source.name} (ID: ${source.company_id})`
    );

    // ── 9. Delete source company ─────────────────────────────────────────────
    db.prepare('DELETE FROM company_contacts WHERE company_id = ?').run(source.company_id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(sourceId);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Merge failed: ' + e.message });
  }

  // Return the updated target company
  const merged = db.prepare('SELECT * FROM companies WHERE id = ?').get(targetId);
  res.json({ ok: true, merged_into: merged });
});
// GET /api/companies/:id/geocode-lookup — server-side geocode + auto-save
router.get('/:id/geocode-lookup', async (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Not found' });

  if (company.lat && company.lng) {
    return res.json({ lat: company.lat, lng: company.lng, cached: true });
  }

  if (!company.address) return res.status(400).json({ error: 'No address' });

  const https = require('https');
  const query = encodeURIComponent(
    `${company.address}, ${company.city || 'Charlotte'}, ${company.state || 'NC'}`
  );
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`;

  const data = await new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'SuperEagleFleetCRM/1.0',
        'Accept-Language': 'en',
      }
    };
    https.get(url, options, (response) => {
      let body = '';
      response.on('data', chunk => body += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Parse failed')); }
      });
    }).on('error', reject);
  });

  if (data.length > 0) {
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    db.prepare('UPDATE companies SET lat = ?, lng = ? WHERE id = ?').run(lat, lng, company.id);
    return res.json({ lat, lng, cached: false });
  }

  return res.status(404).json({ error: 'Address not found' });
});
module.exports = router;
