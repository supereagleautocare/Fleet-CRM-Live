/**
 * FLEET CRM — FOLLOWUPS ROUTES (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, rebuildFollowUps, cancelOldFollowUps, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*,
        CASE WHEN f.due_date < current_date THEN 1 ELSE 0 END AS is_overdue
      FROM follow_ups f
      WHERE f.due_date::date <= current_date AND f.source_type = 'company'
      ORDER BY f.is_locked DESC, f.due_date ASC, f.entity_name ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/all', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT f.*,
        CASE WHEN f.due_date < current_date THEN 1 ELSE 0 END AS is_overdue,
        CASE WHEN f.due_date = current_date THEN 1 ELSE 0 END AS is_due_today
      FROM follow_ups f
      WHERE f.source_type = 'company'
      ORDER BY f.due_date ASC, f.entity_name ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/counts', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN due_date < current_date THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN due_date = current_date THEN 1 ELSE 0 END) as due_today
      FROM follow_ups
      WHERE due_date <= current_date AND source_type = 'company'
    `);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM follow_ups WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found.' });

    const { working_notes, is_locked } = req.body;
    const updates = [], values = [];
    let i = 1;
    if (working_notes !== undefined) { updates.push(`working_notes = $${i++}`); values.push(working_notes); }
    if (is_locked     !== undefined) { updates.push(`is_locked = $${i++}`);     values.push(is_locked ? 1 : 0); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    values.push(req.params.id);
    const { rows: updated } = await pool.query(
      `UPDATE follow_ups SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM follow_ups WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found.' });
    if (rows[0].is_locked) return res.status(403).json({ error: 'This row is locked. Unlock it first.' });
    await pool.query('DELETE FROM follow_ups WHERE id = $1', [req.params.id]);
    res.json({ message: 'Follow-up removed.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/refresh', async (req, res) => {
  try {
    const result = await rebuildFollowUps();
    res.json({ message: 'Follow-ups refreshed.', ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/followups/:id/complete ─────────────────────────────────────────
router.post('/:id/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: fuRows } = await client.query('SELECT * FROM follow_ups WHERE id = $1', [req.params.id]);
    const followUp = fuRows[0];
    if (!followUp) return res.status(404).json({ error: 'Follow-up not found.' });
    if (followUp.source_type !== 'company') return res.status(400).json({ error: 'Only company follow-ups are supported.' });

    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id = $1', [followUp.entity_id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const {
      contact_type, notes, next_action, contact_name, direct_line, email, role_title,
      set_as_preferred, next_action_date_override,
      referral_name, referral_role, referral_phone, referral_email, save_referral_as_contact,
    } = req.body;

    if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
    if (!next_action)  return res.status(400).json({ error: 'next_action is required.' });

    const { rows: priorRows } = await client.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = $1 AND log_type = 'company'",
      [company.id]
    );
    const priorAttempts = parseInt(priorRows[0].cnt);

    await client.query('BEGIN');

    const logEntry = await appendCallLog({
      log_type: 'company', entity_id: company.id, company_id_str: company.company_id,
      entity_name: company.name, phone: followUp.phone || company.main_phone,
      direct_line: direct_line || followUp.direct_line || null,
      contact_name: contact_name || followUp.contact_name || null,
      role_title: role_title || null, email: email || null, industry: company.industry,
      action_type: 'Call', contact_type, notes: notes || null,
      next_action, next_action_date: null, attempt_number: priorAttempts + 1,
      logged_by: req.user.id, logged_by_name: req.user.name,
      referral_name: referral_name||null, referral_role: referral_role||null,
      referral_phone: referral_phone||null, referral_email: referral_email||null,
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

    if (set_as_preferred && (contact_name || followUp.contact_name)) {
      const cName = contact_name || followUp.contact_name;
      await client.query('UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1', [company.company_id]);
      const { rows: ex } = await client.query(
        'SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2',
        [company.company_id, cName]
      );
      if (ex[0]) {
        await client.query(
          `UPDATE company_contacts SET is_preferred=1,
            direct_line=COALESCE($1,direct_line),
            email=COALESCE($2,email),
            role_title=COALESCE($3,role_title),
            updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
           WHERE id=$4`,
          [direct_line||null, email||null, role_title||null, ex[0].id]
        );
      } else if (cName) {
        await client.query(
          'INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,1)',
          [company.company_id, cName, role_title||null, direct_line||null, email||null]
        );
      }
    }

    const { next_action_date: nad } = await scheduleNextAction(pool, {
      company, contact_type, next_action, next_action_date_override,
      contact_name: contact_name||followUp.contact_name||null,
      direct_line:  direct_line||followUp.direct_line||null,
      email:        email||null,
      log_id:       logEntry.id,
    });

    await client.query('COMMIT');
    res.json({ message: 'Follow-up completed and logged.', log_id: logEntry.id, next_action, next_action_date: nad });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to log follow-up: ' + e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
