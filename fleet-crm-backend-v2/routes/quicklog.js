/**
 * FLEET CRM — QUICK LOG ROUTE (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ── Search companies ──────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q = '', type = 'all' } = req.query;
    const s = `%${q}%`;
    let results = [];

    if (type === 'all' || type === 'company') {
      const { rows: companies } = await pool.query(`
        SELECT
          c.id, c.company_id, c.name, c.main_phone, c.industry, c.address, c.city,
          c.lat, c.lng, c.is_multi_location, c.location_name, c.location_group,
          'company' AS entity_type,
          cl.contact_type AS last_contact_type,
          cl.logged_at    AS last_contacted,
          cl.contact_name AS last_contact_name,
          fu.due_date     AS followup_due
        FROM companies c
        LEFT JOIN (
          SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, contact_name
          FROM call_log WHERE log_type = 'company'
          ORDER BY entity_id, id DESC
        ) cl ON cl.entity_id = c.id
        LEFT JOIN (
          SELECT DISTINCT ON (entity_id) entity_id, due_date
          FROM follow_ups WHERE source_type = 'company'
          ORDER BY entity_id, id DESC
        ) fu ON fu.entity_id = c.id
        WHERE c.status = 'active'
          AND (
            c.name ILIKE $1 OR c.main_phone ILIKE $1 OR c.industry ILIKE $1
            OR c.id IN (
              SELECT DISTINCT cm.id
              FROM company_contacts cc
              JOIN companies cm ON cm.company_id = cc.company_id
              WHERE cc.name ILIKE $1 OR cc.direct_line ILIKE $1 OR cc.email ILIKE $1
            )
          )
        ORDER BY c.name ASC
        LIMIT 20
      `, [s]);

      // Find matched contact for each result
      for (const c of companies) {
        const { rows: contact } = await pool.query(`
          SELECT name, role_title, direct_line FROM company_contacts
          WHERE company_id = (SELECT company_id FROM companies WHERE id = $1)
            AND (name ILIKE $2 OR direct_line ILIKE $2 OR email ILIKE $2)
          ORDER BY is_preferred DESC LIMIT 1
        `, [c.id, s]);
        if (contact[0]) c.matched_contact = contact[0];
      }

      results = results.concat(companies);
    }

    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Log a call for a company ──────────────────────────────────────────────────
router.post('/company/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    const company = coRows[0];
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

    const { rows: priorRows } = await client.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = $1 AND log_type = 'company'",
      [company.id]
    );
    const priorAttempts = parseInt(priorRows[0].cnt);

    await client.query('BEGIN');

    const logEntry = await appendCallLog({
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
      referral_name:  referral_name  || null,
      referral_role:  referral_role  || null,
      referral_phone: referral_phone || null,
      referral_email: referral_email || null,
    });

    if (save_referral_as_contact && referral_name) {
      const { rows: ex } = await client.query(
        'SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2',
        [company.company_id, referral_name]
      );
      if (ex[0]) {
        await client.query(
          `UPDATE company_contacts SET
            direct_line=COALESCE($1,direct_line),
            email=COALESCE($2,email),
            role_title=COALESCE($3,role_title),
            updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           WHERE id=$4`,
          [referral_phone||null, referral_email||null, referral_role||null, ex[0].id]
        );
      } else {
        await client.query(
          'INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,0)',
          [company.company_id, referral_name, referral_role||null, referral_phone||null, referral_email||null]
        );
      }
    }

    if (set_as_preferred && contact_name) {
      await client.query(
        'UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1',
        [company.company_id]
      );
      const { rows: ex } = await client.query(
        'SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2',
        [company.company_id, contact_name]
      );
      if (ex[0]) {
        await client.query(
          `UPDATE company_contacts SET is_preferred=1,
            direct_line=COALESCE($1,direct_line),
            email=COALESCE($2,email),
            updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           WHERE id=$3`,
          [direct_line||null, email||null, ex[0].id]
        );
      } else {
        await client.query(
          'INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,1)',
          [company.company_id, contact_name, role_title||null, direct_line||null, email||null]
        );
      }
    }

    const { next_action_date: nad } = await scheduleNextAction(pool, {
      company, contact_type, next_action, next_action_date_override,
      contact_name: contact_name||null,
      direct_line:  direct_line||null,
      email:        email||null,
      log_id:       logEntry.id,
    });

    await client.query('COMMIT');
    res.json({ message: 'Logged successfully.', log_id: logEntry.id, next_action, next_action_date: nad });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to log call: ' + e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
