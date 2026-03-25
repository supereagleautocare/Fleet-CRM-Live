/**
 * FLEET CRM — VISIT QUEUE ROUTES
 * Companies only. Separate from follow-ups (calls).
 *
 * GET    /api/visits           — due visits (today + overdue)
 * GET    /api/visits/all       — all scheduled visits
 * PUT    /api/visits/:id       — update notes / lock / reschedule
 * POST   /api/visits/:id/complete  — log the visit, create next action
 * DELETE /api/visits/:id       — cancel visit
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { calcFollowUpDate, calcVisitDate, appendCallLog, cancelOldFollowUps, clearAllCompanyQueues } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// GET /api/visits — due today + overdue
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*,
           CASE WHEN v.scheduled_date < date('now') THEN 1 ELSE 0 END AS is_overdue
    FROM visit_queue v
    WHERE v.scheduled_date <= date('now')
    ORDER BY v.is_locked DESC, v.scheduled_date ASC, v.entity_name ASC
  `).all();
  res.json(rows);
});

// GET /api/visits/all — all visits including future (with last contact info for print sheet)
router.get('/all', (req, res) => {
  const rows = db.prepare(`
    SELECT v.*,
           CASE WHEN v.scheduled_date < date('now') THEN 1 ELSE 0 END AS is_overdue,
           CASE WHEN v.scheduled_date = date('now') THEN 1 ELSE 0 END AS is_due_today,
           cl.contact_type  AS last_contact_type,
           cl.logged_at     AS last_contacted,
           cl.notes         AS last_contact_notes,
           cl.contact_name  AS last_contact_person,
           (SELECT COUNT(*) FROM call_log WHERE entity_id = v.entity_id AND log_type='company' AND action_type != 'Move') as call_count
    FROM visit_queue v
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at, notes, contact_name
      FROM call_log
      WHERE log_type = 'company'
        AND logged_at = (SELECT MAX(cl2.logged_at) FROM call_log cl2
                         WHERE cl2.entity_id = call_log.entity_id AND cl2.log_type = 'company')
    ) cl ON cl.entity_id = v.entity_id
    ORDER BY v.scheduled_date ASC
  `).all();
  res.json(rows);
});

// GET /api/visits/counts
router.get('/counts', (req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN scheduled_date < date('now') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN scheduled_date = date('now') THEN 1 ELSE 0 END) as due_today
    FROM visit_queue
  `).get();
  res.json(counts);
});

// PUT /api/visits/:id — update working notes, lock, reschedule
router.put('/:id', (req, res) => {
  const visit = db.prepare('SELECT * FROM visit_queue WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });

  const { working_notes, is_locked, notes, scheduled_date } = req.body;
  const updates = [];
  const values  = [];

  if (working_notes  !== undefined) { updates.push('working_notes = ?');  values.push(working_notes); }
  if (is_locked      !== undefined) { updates.push('is_locked = ?');      values.push(is_locked ? 1 : 0); }
  if (notes          !== undefined) { updates.push('notes = ?');          values.push(notes); }
  if (scheduled_date !== undefined) { updates.push('scheduled_date = ?'); values.push(scheduled_date); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.params.id);

  db.prepare(`UPDATE visit_queue SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM visit_queue WHERE id = ?').get(req.params.id));
});

// DELETE /api/visits/:id — cancel visit
router.delete('/:id', (req, res) => {
  const visit = db.prepare('SELECT * FROM visit_queue WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });
  if (visit.is_locked) return res.status(403).json({ error: 'This visit is locked. Unlock it first.' });

  db.prepare('DELETE FROM visit_queue WHERE id = ?').run(req.params.id);
  res.json({ message: 'Visit cancelled.' });
});

// POST /api/visits/:id/complete — log the visit, decide next action
// All DB writes wrapped in a transaction. Also updates pipeline_stage.
router.post('/:id/complete', (req, res) => {
  const visit = db.prepare('SELECT * FROM visit_queue WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Visit not found.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(visit.entity_id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const {
    contact_type,
    notes,
    next_action,
    contact_name,
    direct_line,
    email,
    role_title,
    set_as_preferred,
    next_action_date_override,
  } = req.body;

  if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
  if (!next_action)  return res.status(400).json({ error: 'next_action is required.' });

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'company'"
  ).get(company.id).cnt;

  let next_action_date = null;
  if (next_action === 'Call')  next_action_date = next_action_date_override || calcFollowUpDate('company', contact_type, 'call');
  if (next_action === 'Visit') next_action_date = next_action_date_override || calcFollowUpDate('company', contact_type, 'visit');
  if (next_action === 'Mail')  next_action_date = next_action_date_override || calcFollowUpDate('company', contact_type, 'mail');
  if (next_action === 'Email') next_action_date = next_action_date_override || calcFollowUpDate('company', contact_type, 'email');

  const nextStage = next_action === 'Stop'  ? 'dead'
    : next_action === 'Visit' ? 'visit'
    : next_action === 'Call'  ? 'call'
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
      phone: visit.direct_line || company.main_phone,
      direct_line: direct_line || visit.direct_line || null,
      contact_name: contact_name || visit.contact_name || null,
      role_title: role_title || null,
      email: email || visit.email || null,
      industry: company.industry,
      action_type: 'Visit',
      contact_type,
      notes: notes || null,
      next_action,
      next_action_date,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      log_category: 'visit',
    });

    // Save preferred contact
    if (set_as_preferred && (contact_name || visit.contact_name)) {
      const cName = contact_name || visit.contact_name;
      db.prepare('UPDATE company_contacts SET is_preferred = 0 WHERE company_id = ?').run(company.company_id);
      const existingContact = db.prepare(
        'SELECT id FROM company_contacts WHERE company_id = ? AND name = ?'
      ).get(company.company_id, cName);

      if (existingContact) {
        db.prepare(`
          UPDATE company_contacts SET is_preferred = 1,
            direct_line = COALESCE(?, direct_line),
            email = COALESCE(?, email),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(direct_line || null, email || null, existingContact.id);
      } else {
        db.prepare(`
          INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(company.company_id, cName, role_title || null, direct_line || null, email || null);
      }
    }

    // Remove from visit queue
    db.prepare('DELETE FROM visit_queue WHERE id = ?').run(visit.id);

    // Create next action
    if (next_action === 'Call' && next_action_date) {
      clearAllCompanyQueues(company.id);
      const preferred = db.prepare(
        'SELECT * FROM company_contacts WHERE company_id = ? AND is_preferred = 1'
      ).get(company.company_id);

      // Insert into follow_ups for due-date tracking
      db.prepare(`
        INSERT INTO follow_ups
          (source_type, entity_id, company_id_str, entity_name, phone, direct_line,
           industry, contact_name, due_date, source_log_id)
        VALUES ('company', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        company.id, company.company_id, company.name, company.main_phone,
        direct_line || visit.direct_line || preferred?.direct_line || null,
        company.industry,
        contact_name || visit.contact_name || preferred?.name || null,
        next_action_date, logEntry.id
      );

      // ALSO insert into calling_queue so company is visible immediately
      // The calling queue JOIN only surfaces follow_ups due today; calling_queue has no date filter
      const existingCQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(company.id);
      if (!existingCQ) {
        db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
          VALUES ('company', ?, ?, ?, ?, ?)`).run(
          company.id,
          contact_name || visit.contact_name || preferred?.name || null,
          direct_line  || visit.direct_line  || preferred?.direct_line || null,
          notes || null, req.user?.id || null
        );
      }
    } else if (next_action === 'Visit' && next_action_date) {
      db.prepare(`
        INSERT INTO visit_queue
          (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name, direct_line, email, source_log_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        company.company_id, company.id, company.name, next_action_date,
        company.address, company.city,
        contact_name || visit.contact_name || null,
        direct_line  || visit.direct_line  || null,
        email        || visit.email        || null,
        logEntry.id
      );
    } else if (next_action === 'Mail') {
      clearAllCompanyQueues(company.id);
      // Add to calling_queue as a mail entry
      const existingMail = db.prepare("SELECT id FROM calling_queue WHERE queue_type='mail' AND entity_id=?").get(company.id);
      if (!existingMail) {
        db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
          VALUES ('mail', ?, ?, ?, ?, ?)`).run(company.id,
          contact_name || visit.contact_name || null,
          direct_line  || visit.direct_line  || null,
          notes || null, req.user?.id || null);
      }
      // Move pipeline stage
      db.prepare("UPDATE companies SET pipeline_stage='mail', stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(company.id);
    } else if (next_action === 'Email') {
      clearAllCompanyQueues(company.id);
      const existingEmail = db.prepare("SELECT id FROM calling_queue WHERE queue_type='email' AND entity_id=?").get(company.id);
      if (!existingEmail) {
        db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
          VALUES ('email', ?, ?, ?, ?, ?)`).run(company.id,
          contact_name || visit.contact_name || null,
          direct_line  || visit.direct_line  || null,
          notes || null, req.user?.id || null);
      }
      db.prepare("UPDATE companies SET pipeline_stage='email', stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(company.id);
    } else if (next_action === 'Stop') {
      clearAllCompanyQueues(company.id);
    }

    // Update pipeline stage
    db.prepare(`UPDATE companies SET pipeline_stage=?, stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(nextStage, company.id);

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log visit: ' + e.message });
  }

  res.json({
    message: 'Visit logged successfully.',
    log_id: logEntry.id,
    next_action,
    next_action_date,
  });
});

module.exports = router;

// POST /api/visits/schedule — add a company directly to visit queue (used by route planner)
// Does NOT check calling_queue — always works, deduplicates by entity_id
router.post('/schedule', (req, res) => {
  const { company_id } = req.body;
  if (!company_id) return res.status(400).json({ error: 'company_id required' });
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(company_id);
  if (!company) return res.status(404).json({ error: 'Company not found' });

  // Remove any existing visit for this company so we get a fresh one
  db.prepare("DELETE FROM visit_queue WHERE entity_id = ?").run(company_id);

  const today = new Date().toISOString().split('T')[0];
  const id = db.prepare(`
    INSERT INTO visit_queue (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(company.company_id, company.id, company.name, today, company.address, company.city, null).lastInsertRowid;

  res.json(db.prepare('SELECT * FROM visit_queue WHERE id = ?').get(id));
});

// GET /api/visits/queue-status/:company_id — check which queues a company is in
router.get('/queue-status/:company_id', (req, res) => {
  const id = req.params.company_id;
  const company = db.prepare('SELECT pipeline_stage FROM companies WHERE id = ?').get(id);
  const inCalling = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(id);
  const inMail    = db.prepare("SELECT id FROM calling_queue WHERE queue_type='mail' AND entity_id=?").get(id);
  const inEmail   = db.prepare("SELECT id FROM calling_queue WHERE queue_type='email' AND entity_id=?").get(id);
  const inVisit   = db.prepare("SELECT id FROM visit_queue WHERE entity_id=?").get(id);
  const fu        = db.prepare("SELECT due_date FROM follow_ups WHERE entity_id=? AND source_type='company' AND is_locked=0 ORDER BY due_date ASC LIMIT 1").get(id);
  res.json({
    stage: company?.pipeline_stage || null,
    inCalling: !!inCalling,
    inMail: !!inMail,
    inEmail: !!inEmail,
    inVisit: !!inVisit,
    followupDate: fu?.due_date || null,
  });
});
