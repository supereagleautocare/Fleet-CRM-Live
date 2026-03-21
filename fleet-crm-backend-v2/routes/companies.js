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
const { getNextCompanyId, calcFollowUpDate, calcVisitDate, appendCallLog, cancelOldFollowUps, clearAllCompanyQueues } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// COMPANY PROFILES
// ═══════════════════════════════════════════════════════

// GET /api/companies — list all companies
router.get('/', (req, res) => {
  const { search, industry, status = 'active' } = req.query;
  let where = 'WHERE 1=1';
  const params = [];

  if (status !== 'all') { where += ' AND c.status = ?'; params.push(status); }
  if (search) {
    where += ' AND (c.name LIKE ? OR c.main_phone LIKE ? OR c.industry LIKE ?)';
    const s = `%${search}%`; params.push(s, s, s);
  }
  if (industry) { where += ' AND c.industry = ?'; params.push(industry); }

  const sql = `
    SELECT c.*,
      cc.name as preferred_contact_name,
      cc.role_title as preferred_contact_role,
      cl.contact_type as last_contact_type,
      cl.logged_at as last_contacted
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at FROM call_log
      WHERE log_type='company' AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
    ) cl ON cl.entity_id = c.id
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
           MIN(logged_at) as first_contacted
    FROM call_log
    WHERE entity_id = ? AND log_type = 'company'
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

  let next_action_date = null;
  if (next_action === 'Call')  next_action_date = next_action_date_override || calcFollowUpDate('company', contact_type);
  if (next_action === 'Visit') next_action_date = next_action_date_override || calcVisitDate();

  const nextStage = next_action === 'Stop'  ? 'dead'
    : next_action === 'Visit' ? 'visit'
    : next_action === 'Mail'  ? 'mail'
    : next_action === 'Email' ? 'email'
    : 'call';

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
      next_action_date,
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
      const existingContact = db.prepare(
        'SELECT id FROM company_contacts WHERE company_id = ? AND name = ?'
      ).get(company.company_id, contact_name);

      if (existingContact) {
        db.prepare(`
          UPDATE company_contacts SET is_preferred = 1,
            direct_line = COALESCE(?, direct_line),
            email = COALESCE(?, email),
            role_title = COALESCE(?, role_title),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(direct_line || null, email || null, role_title || null, existingContact.id);
      } else {
        db.prepare(`
          INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(company.company_id, contact_name, role_title || null, direct_line || null, email || null);
      }
    }

    // Create next action
    if (next_action === 'Call' && next_action_date) {
      cancelOldFollowUps('company', company.id);
      db.prepare(`
        INSERT INTO follow_ups
          (source_type, entity_id, company_id_str, entity_name, phone, direct_line, industry, contact_name, due_date, source_log_id)
        VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(company.id, company.company_id, company.name, company.main_phone,
             direct_line || null, company.industry, contact_name || null,
             next_action_date, logEntry.id);
      // Also add to calling_queue so company surfaces immediately regardless of due date
      const existingCQ2 = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(company.id);
      if (!existingCQ2) {
        db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
          VALUES ('company', ?, ?, ?, ?, ?)`).run(company.id, contact_name||null, direct_line||null, notes||null, req.user?.id||null);
      }

    } else if (next_action === 'Visit' && next_action_date) {
      const preferred = db.prepare(
        'SELECT * FROM company_contacts WHERE company_id = ? AND is_preferred = 1'
      ).get(company.company_id);

      db.prepare(`
        INSERT INTO visit_queue
          (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name, direct_line, email, source_log_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        company.company_id, company.id, company.name, next_action_date,
        company.address, company.city,
        contact_name || preferred?.name || null,
        direct_line  || preferred?.direct_line || null,
        email        || preferred?.email || null,
        logEntry.id
      );
   } else if (next_action === 'Mail') {
      cancelOldFollowUps('company', company.id);
      const mailDate = next_action_date_override || calcFollowUpDate('company', 'Mail');
      db.prepare(`
        INSERT INTO follow_ups
          (source_type, entity_id, company_id_str, entity_name, phone, direct_line, industry, contact_name, due_date, source_log_id, next_action)
        VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Mail')
      `).run(company.id, company.company_id, company.name, company.main_phone,
             direct_line || null, company.industry, contact_name || null, mailDate, logEntry.id);

    } else if (next_action === 'Email') {
      cancelOldFollowUps('company', company.id);
      const emailDate = next_action_date_override || calcFollowUpDate('company', 'Email');
      db.prepare(`
        INSERT INTO follow_ups
          (source_type, entity_id, company_id_str, entity_name, phone, direct_line, industry, contact_name, due_date, source_log_id, next_action)
        VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Email')
      `).run(company.id, company.company_id, company.name, company.main_phone,
             direct_line || null, company.industry, contact_name || null, emailDate, logEntry.id);

    } else if (next_action === 'Stop') {
      cancelOldFollowUps('company', company.id);
    }

    // Remove from calling queue
    db.prepare('DELETE FROM calling_queue WHERE id = ?').run(req.params.queueId);

    // Update pipeline stage
    db.prepare(`UPDATE companies SET pipeline_stage=?, stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(nextStage, company.id);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log call: ' + e.message });
  }

  res.json({
    message: 'Call logged successfully.',
    log_id: logEntry.id,
    next_action,
    next_action_date,
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

// PUT /api/companies/:id/followup-date — manually update next follow-up date
router.put('/:id/followup-date', (req, res) => {
  const { due_date } = req.body;
  if (!due_date) return res.status(400).json({ error: 'due_date is required.' });
  const existing = db.prepare(
    "SELECT * FROM follow_ups WHERE entity_id = ? AND source_type = 'company'"
  ).get(req.params.id);
  if (existing) {
    db.prepare("UPDATE follow_ups SET due_date = ? WHERE id = ?").run(due_date, existing.id);
  } else {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    db.prepare("INSERT INTO follow_ups (source_type, entity_id, company_id_str, entity_name, phone, due_date) VALUES ('company',?,?,?,?,?)")
      .run(company.id, company.company_id, company.name, company.main_phone, due_date);
  }
  res.json({ message: 'Follow-up date updated.', due_date });
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

  const results = { imported: 0, skipped: 0, contacts: 0, history: 0, errors: [] };

  db.exec('BEGIN TRANSACTION');
  try {
    for (const row of companies) {
      const name  = (row.name || '').trim();
      const phone = (row.main_phone || '').replace(/\D/g, '');
      if (!name) { results.skipped++; continue; }

      // Fast path: if frontend already resolved the CRM id, use it directly
      if (row.existing_crm_id) {
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
              if (dup) continue;
              db.prepare(`
                INSERT INTO call_log
                  (log_type,log_category,entity_id,company_id_str,entity_name,phone,industry,
                   contact_type,contact_name,role_title,direct_line,notes,
                   action_type,next_action,next_action_date,attempt_number,logged_at,logged_by_name,counts_as_attempt)
                VALUES ('company','call',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
              `).run(ex.id,ex.company_id,ex.name,ex.main_phone,ex.industry||null,
                h.contact_type||'Call',h.contact_name||null,h.role_title||null,h.direct_line||null,h.notes||null,
                h.action_type||'Call',h.next_action||'Call',h.next_action_date||null,
                h.attempt_number||1,h.logged_at||new Date().toISOString(),h.logged_by||'Import');
              results.history++;
            }
          }
          // Set follow-up date if provided and future
          if (row.next_follow_up && new Date(row.next_follow_up) > new Date()) {
            const fu = db.prepare("SELECT id FROM follow_ups WHERE entity_id=? AND source_type='company' AND is_locked=0").get(ex.id);
            if (!fu) {
              db.prepare("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action) VALUES ('company',?,?,?,?,?,?)")
                .run(ex.id,ex.company_id,ex.name,ex.main_phone,row.next_follow_up,row.last_next_action||'Call');
            }
          }
          results.skipped++;
          continue;
        }
      }

      // Dedup: check by phone first, then by name
      let existingId = null;
      if (phone) {
        const byPhone = db.prepare('SELECT id, company_id FROM companies WHERE main_phone = ?').get(phone);
        if (byPhone) existingId = byPhone.id;
      }
      if (!existingId && name) {
        const byName = db.prepare('SELECT id, company_id FROM companies WHERE lower(name) = lower(?) AND status = ?').get(name, 'active');
        if (byName) existingId = byName.id;
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

        // Set follow-up date if provided and in the future
        if (row.next_follow_up && new Date(row.next_follow_up) > new Date()) {
          db.prepare("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action) VALUES ('company',?,?,?,?,?,?)")
            .run(companyDbId, companyIdStr, name, phone||null, row.next_follow_up, row.last_next_action||'Call');
          // Also set pipeline stage to 'call' since they have history
          db.prepare("UPDATE companies SET pipeline_stage='call' WHERE id=?").run(companyDbId);
        }
      }

      // Import contacts
      if (Array.isArray(row.contacts)) {
        for (const c of row.contacts) {
          const cname = (c.name || '').trim();
          if (!cname) continue;
          const dup = db.prepare('SELECT id FROM company_contacts WHERE company_id = ? AND lower(name) = lower(?)').get(companyIdStr, cname);
          if (!dup) {
            db.prepare(`INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred) VALUES (?,?,?,?,?,?)`)
              .run(companyIdStr, cname, c.role_title||null, (c.direct_line||'').replace(/\D/g,'')||null, c.email||null, c.is_preferred?1:0);
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
            h.contact_type||'Spoke To', h.contact_name||null, h.role_title||null,
            (h.direct_line||'').replace(/\D/g,'')||null, h.email||null,
            h.notes||null, h.action_type||'Call', h.next_action||'Call',
            h.next_action_date||null, h.attempt_number||1,
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

module.exports = router;
