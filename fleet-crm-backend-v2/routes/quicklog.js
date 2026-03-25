/**
 * FLEET CRM — QUICK LOG ROUTE
 * Log a call or note for any company or customer without a queue workflow.
 * Useful for drop-ins, inbound calls, or anything outside the normal queue.
 *
 * GET  /api/quicklog/search?q=...&type=company|customer|all
 * POST /api/quicklog/company/:id
 * POST /api/quicklog/customer/:id
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ── Search companies + customers ──────────────────────────────────────────────
router.get('/search', (req, res) => {
  const { q = '', type = 'all' } = req.query;
  const s = `%${q}%`;
  let results = [];

  if (type === 'all' || type === 'company') {
    const companies = db.prepare(`
      SELECT
        c.id, c.company_id, c.name, c.main_phone, c.industry, c.address, c.city,
        'company' AS entity_type,
        cl.contact_type AS last_contact_type,
        cl.logged_at    AS last_contacted,
        cl.contact_name AS last_contact_name,
        fu.due_date     AS followup_due
      FROM companies c
      LEFT JOIN (
        SELECT entity_id, contact_type, logged_at, contact_name
        FROM call_log
        WHERE log_type = 'company'
          AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
      ) cl ON cl.entity_id = c.id
      LEFT JOIN (
        SELECT entity_id, due_date
        FROM follow_ups
        WHERE source_type = 'company'
          AND id IN (SELECT MAX(id) FROM follow_ups WHERE source_type='company' GROUP BY entity_id)
      ) fu ON fu.entity_id = c.id
      WHERE c.status = 'active'
        AND (
          c.name LIKE ? OR c.main_phone LIKE ? OR c.industry LIKE ?
          OR c.id IN (
            SELECT DISTINCT cc.company_id
            FROM company_contacts cc
            JOIN companies cm ON cm.company_id = cc.company_id
            WHERE cc.name LIKE ? OR cc.direct_line LIKE ? OR cc.email LIKE ?
          )
        )
      ORDER BY c.name ASC
      LIMIT 20
    `).all(s, s, s, s, s, s);

    // For each company result, find which contact matched (if search was by contact name)
    companies.forEach(c => {
      const matchedContact = db.prepare(`
        SELECT name, role_title, direct_line FROM company_contacts
        WHERE company_id = (SELECT company_id FROM companies WHERE id = ?)
          AND (name LIKE ? OR direct_line LIKE ? OR email LIKE ?)
        ORDER BY is_preferred DESC LIMIT 1
      `).get(c.id, s, s, s);
      if (matchedContact) c.matched_contact = matchedContact;
    });

    results = results.concat(companies);
  }

  res.json(results);
});

// ── Log a call for a company ──────────────────────────────────────────────────
// All DB writes wrapped in a transaction. Updates pipeline_stage to match next action.
router.post('/company/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const {
    contact_type,
    notes,
    next_action = 'Call',
    contact_name,
    direct_line,
    email,
    role_title,
    set_as_preferred,
    next_action_date_override,
    referral_name,
    referral_role,
    referral_phone,
    referral_email,
    save_referral_as_contact,
  } = req.body;

  if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'company'"
  ).get(company.id).cnt;

  // next_action_date and nextStage handled inside scheduleNextAction
  let logEntry;
  let nad;

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
      referral_name:  referral_name  || null,
      referral_role:  referral_role  || null,
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
      const existing = db.prepare('SELECT id FROM company_contacts WHERE company_id = ? AND name = ?').get(company.company_id, contact_name);
      if (existing) {
        db.prepare(`UPDATE company_contacts SET is_preferred=1, direct_line=COALESCE(?,direct_line), email=COALESCE(?,email), updated_at=datetime('now') WHERE id=?`)
          .run(direct_line || null, email || null, existing.id);
      } else {
        db.prepare(`INSERT INTO company_contacts (company_id, name, role_title, direct_line, email, is_preferred) VALUES (?,?,?,?,?,1)`)
          .run(company.company_id, contact_name, role_title || null, direct_line || null, email || null);
      }
    }

    // Schedule next action — single source of truth
    ({ next_action_date: nad } = scheduleNextAction(db, {
      company, contact_type, next_action, next_action_date_override,
      contact_name: contact_name||null,
      direct_line:  direct_line||null,
      email:        email||null,
      log_id:       logEntry.id,
    }));

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log call: ' + e.message });
  }

  res.json({ message: 'Logged successfully.', log_id: logEntry.id, next_action, next_action_date: nad });
});


module.exports = router;
