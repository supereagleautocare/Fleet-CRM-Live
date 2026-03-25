/**
 * FLEET CRM — FOLLOWUPS ROUTES
 *
 * Company follow-ups only.
 *
 * GET    /api/followups           — due today + overdue
 * GET    /api/followups/all       — everything including future
 * GET    /api/followups/counts    — dashboard counts
 * PUT    /api/followups/:id       — update working_notes or locked status
 * POST   /api/followups/:id/complete  — log the call, create next action
 * DELETE /api/followups/:id       — manually remove (if not locked)
 * POST   /api/followups/refresh   — rebuild from call_log
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { calcFollowUpDate, appendCallLog, rebuildFollowUps, cancelOldFollowUps } = require('./shared');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, CASE WHEN f.due_date < date('now') THEN 1 ELSE 0 END AS is_overdue
    FROM follow_ups f
    WHERE f.due_date <= date('now') AND f.source_type = 'company'
    ORDER BY f.is_locked DESC, f.due_date ASC, f.entity_name ASC
  `).all();
  res.json(rows);
});

router.get('/all', (req, res) => {
  const rows = db.prepare(`
    SELECT f.*,
           CASE WHEN f.due_date < date('now') THEN 1 ELSE 0 END AS is_overdue,
           CASE WHEN f.due_date = date('now')  THEN 1 ELSE 0 END AS is_due_today
    FROM follow_ups f
    WHERE f.source_type = 'company'
    ORDER BY f.due_date ASC, f.entity_name ASC
  `).all();
  res.json(rows);
});

router.get('/counts', (req, res) => {
  const counts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN due_date < date('now') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN due_date = date('now') THEN 1 ELSE 0 END) as due_today
    FROM follow_ups
    WHERE due_date <= date('now') AND source_type = 'company'
  `).get();
  res.json(counts);
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Follow-up not found.' });
  const { working_notes, is_locked } = req.body;
  const updates = []; const values = [];
  if (working_notes !== undefined) { updates.push('working_notes = ?'); values.push(working_notes); }
  if (is_locked     !== undefined) { updates.push('is_locked = ?');     values.push(is_locked ? 1 : 0); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  values.push(req.params.id);
  db.prepare(`UPDATE follow_ups SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Follow-up not found.' });
  if (row.is_locked) return res.status(403).json({ error: 'This row is locked. Unlock it first.' });
  db.prepare('DELETE FROM follow_ups WHERE id = ?').run(req.params.id);
  res.json({ message: 'Follow-up removed.' });
});

router.post('/refresh', (req, res) => {
  const result = rebuildFollowUps();
  res.json({ message: 'Follow-ups refreshed.', ...result });
});

// ─── POST /api/followups/:id/complete ────────────────────────────────────────
router.post('/:id/complete', (req, res) => {
  const followUp = db.prepare('SELECT * FROM follow_ups WHERE id = ?').get(req.params.id);
  if (!followUp) return res.status(404).json({ error: 'Follow-up not found.' });
  if (followUp.source_type !== 'company') return res.status(400).json({ error: 'Only company follow-ups are supported.' });

  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(followUp.entity_id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const {
    contact_type, notes, next_action, contact_name, direct_line, email, role_title,
    set_as_preferred, next_action_date_override,
    referral_name, referral_role, referral_phone, referral_email, save_referral_as_contact,
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

  const nextStage = next_action === 'Stop' ? 'dead'
    : next_action === 'Visit' ? 'visit'
    : next_action === 'Mail'  ? 'mail'
    : next_action === 'Email' ? 'email'
    : 'call';

  let logEntry;
  db.exec('BEGIN TRANSACTION');
  try {
    logEntry = appendCallLog({
      log_type: 'company', entity_id: company.id, company_id_str: company.company_id,
      entity_name: company.name, phone: followUp.phone || company.main_phone,
      direct_line: direct_line || followUp.direct_line || null,
      contact_name: contact_name || followUp.contact_name || null,
      role_title: role_title || null, email: email || null, industry: company.industry,
      action_type: 'Call', contact_type, notes: notes || null,
      next_action, next_action_date, attempt_number: priorAttempts + 1,
      logged_by: req.user.id, logged_by_name: req.user.name,
      referral_name: referral_name||null, referral_role: referral_role||null,
      referral_phone: referral_phone||null, referral_email: referral_email||null,
    });

    if (save_referral_as_contact && referral_name) {
      const ex = db.prepare('SELECT id FROM company_contacts WHERE company_id=? AND name=?').get(company.company_id, referral_name);
      if (ex) db.prepare(`UPDATE company_contacts SET direct_line=COALESCE(?,direct_line),email=COALESCE(?,email),role_title=COALESCE(?,role_title),updated_at=datetime('now') WHERE id=?`).run(referral_phone||null,referral_email||null,referral_role||null,ex.id);
      else db.prepare(`INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES (?,?,?,?,?,0)`).run(company.company_id,referral_name,referral_role||null,referral_phone||null,referral_email||null);
    }

    if (set_as_preferred && (contact_name || followUp.contact_name)) {
      const cName = contact_name || followUp.contact_name;
      db.prepare('UPDATE company_contacts SET is_preferred=0 WHERE company_id=?').run(company.company_id);
      const ex = db.prepare('SELECT id FROM company_contacts WHERE company_id=? AND name=?').get(company.company_id, cName);
      if (ex) db.prepare(`UPDATE company_contacts SET is_preferred=1,direct_line=COALESCE(?,direct_line),email=COALESCE(?,email),role_title=COALESCE(?,role_title),updated_at=datetime('now') WHERE id=?`).run(direct_line||null,email||null,role_title||null,ex.id);
      else if (cName) db.prepare(`INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES (?,?,?,?,?,1)`).run(company.company_id,cName,role_title||null,direct_line||null,email||null);
    }

    cancelOldFollowUps('company', company.id);
    // Remove company from calling_queue — it will re-enter when the new follow-up is due
    db.prepare("DELETE FROM calling_queue WHERE queue_type='company' AND entity_id=?").run(company.id);

    if (next_action === 'Call' && next_action_date) {
      db.prepare(`INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,direct_line,industry,contact_name,due_date,source_log_id) VALUES ('company',?,?,?,?,?,?,?,?,?)`)
        .run(company.id,company.company_id,company.name,followUp.phone||company.main_phone,direct_line||followUp.direct_line||null,company.industry,contact_name||followUp.contact_name||null,next_action_date,logEntry.id);
      const existingCQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(company.id);
      if (!existingCQ) {
        db.prepare(`INSERT INTO calling_queue (queue_type,entity_id,contact_name,direct_line,notes,added_by) VALUES ('company',?,?,?,?,?)`)
          .run(company.id,contact_name||followUp.contact_name||null,direct_line||followUp.direct_line||null,notes||null,req.user?.id||null);
      }
    } else if (next_action === 'Visit' && next_action_date) {
      const pref = db.prepare('SELECT * FROM company_contacts WHERE company_id=? AND is_preferred=1').get(company.company_id);
      db.prepare(`INSERT INTO visit_queue (company_id,entity_id,entity_name,scheduled_date,address,city,contact_name,direct_line,email,source_log_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(company.company_id,company.id,company.name,next_action_date,company.address,company.city,contact_name||followUp.contact_name||pref?.name||null,direct_line||followUp.direct_line||pref?.direct_line||null,email||pref?.email||null,logEntry.id);
    } else if (next_action === 'Mail' && next_action_date) {
      db.prepare(`INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,direct_line,industry,contact_name,due_date,source_log_id,next_action) VALUES ('company',?,?,?,?,?,?,?,?,?,'Mail')`)
        .run(company.id,company.company_id,company.name,followUp.phone||company.main_phone,direct_line||followUp.direct_line||null,company.industry,contact_name||followUp.contact_name||null,next_action_date,logEntry.id);
    } else if (next_action === 'Email' && next_action_date) {
      db.prepare(`INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,direct_line,industry,contact_name,due_date,source_log_id,next_action) VALUES ('company',?,?,?,?,?,?,?,?,?,'Email')`)
        .run(company.id,company.company_id,company.name,followUp.phone||company.main_phone,direct_line||followUp.direct_line||null,company.industry,contact_name||followUp.contact_name||null,next_action_date,logEntry.id);
    }

    db.prepare(`UPDATE companies SET pipeline_stage=?,stage_updated_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).run(nextStage, company.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log follow-up: ' + e.message });
  }

  return res.json({ message: 'Follow-up completed and logged.', log_id: logEntry.id, next_action, next_action_date });
});

module.exports = router;
