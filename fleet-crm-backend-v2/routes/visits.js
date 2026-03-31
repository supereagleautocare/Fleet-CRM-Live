/**
 * FLEET CRM — VISIT QUEUE ROUTES (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, clearAllCompanyQueues, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// GET /api/visits
router.get('/all', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const { rows } = await pool.query(`
      SELECT v.*,
        c.company_status,
        c.is_starred,
        CASE WHEN v.scheduled_date < $1 THEN 1 ELSE 0 END AS is_overdue,
        CASE WHEN v.scheduled_date = $1 THEN 1 ELSE 0 END AS is_due_today,
        cl.contact_type  AS last_contact_type,
        cl.logged_at     AS last_contacted,
        cl.notes         AS last_contact_notes,
        cl.contact_name  AS last_contact_person,
        (SELECT COUNT(*) FROM call_log
         WHERE entity_id = v.entity_id AND log_type='company' AND action_type != 'Move') as call_count
      FROM visit_queue v
      LEFT JOIN companies c ON c.id = v.entity_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, notes, contact_name
        FROM call_log WHERE log_type = 'company'
        ORDER BY entity_id, logged_at DESC
      ) cl ON cl.entity_id = v.entity_id
      ORDER BY v.scheduled_date ASC
    `, [today]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/visits/all
router.get('/all', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT v.*,
        c.company_status,
        c.is_starred,
        CASE WHEN v.scheduled_date < current_date THEN 1 ELSE 0 END AS is_overdue,
        CASE WHEN v.scheduled_date = current_date THEN 1 ELSE 0 END AS is_due_today,
        cl.contact_type  AS last_contact_type,
        cl.logged_at     AS last_contacted,
        cl.notes         AS last_contact_notes,
        cl.contact_name  AS last_contact_person,
        (SELECT COUNT(*) FROM call_log
         WHERE entity_id = v.entity_id AND log_type='company' AND action_type != 'Move') as call_count
      FROM visit_queue v
      LEFT JOIN companies c ON c.id = v.entity_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, notes, contact_name
        FROM call_log WHERE log_type = 'company'
        ORDER BY entity_id, logged_at DESC
      ) cl ON cl.entity_id = v.entity_id
      ORDER BY v.scheduled_date ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/visits/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM visit_queue WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Visit not found.' });

    const { working_notes, is_locked, notes, scheduled_date } = req.body;
    const updates = [], values = [];
    let i = 1;
    if (working_notes  !== undefined) { updates.push(`working_notes = $${i++}`);  values.push(working_notes); }
    if (is_locked      !== undefined) { updates.push(`is_locked = $${i++}`);      values.push(is_locked ? 1 : 0); }
    if (notes          !== undefined) { updates.push(`notes = $${i++}`);          values.push(notes); }
    if (scheduled_date !== undefined) { updates.push(`scheduled_date = $${i++}`); values.push(scheduled_date); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
    values.push(req.params.id);
    const { rows: updated } = await pool.query(
      `UPDATE visit_queue SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/visits/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM visit_queue WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Visit not found.' });
    if (rows[0].is_locked) return res.status(403).json({ error: 'This visit is locked. Unlock it first.' });
    await pool.query('DELETE FROM visit_queue WHERE id = $1', [req.params.id]);
    res.json({ message: 'Visit cancelled.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/visits/:id/complete
router.post('/:id/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: vRows } = await client.query('SELECT * FROM visit_queue WHERE id = $1', [req.params.id]);
    const visit = vRows[0];
    if (!visit) return res.status(404).json({ error: 'Visit not found.' });

    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id = $1', [visit.entity_id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const {
      contact_type, notes, next_action, contact_name,
      direct_line, email, role_title, set_as_preferred, next_action_date_override,
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
      next_action_date: null,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      log_category: 'visit',
    });

    if (set_as_preferred && (contact_name || visit.contact_name)) {
      const cName = contact_name || visit.contact_name;
      await client.query(
        'UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1',
        [company.company_id]
      );
      const { rows: ex } = await client.query(
        'SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2',
        [company.company_id, cName]
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
          [company.company_id, cName, role_title||null, direct_line||null, email||null]
        );
      }
    }

    await client.query('DELETE FROM visit_queue WHERE id = $1', [visit.id]);

    const { next_action_date: nad } = await scheduleNextAction(pool, {
      company, contact_type, next_action, next_action_date_override,
      contact_name: contact_name||visit.contact_name||null,
      direct_line:  direct_line||visit.direct_line||null,
      email:        email||visit.email||null,
      log_id:       logEntry.id,
    });

    await client.query('COMMIT');
    res.json({ message: 'Visit logged successfully.', log_id: logEntry.id, next_action, next_action_date: nad });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to log visit: ' + e.message });
  } finally {
    client.release();
  }
});

// POST /api/visits/schedule
router.post('/schedule', async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id required' });

    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id = $1', [company_id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found' });

    await pool.query('DELETE FROM visit_queue WHERE entity_id = $1', [company_id]);

    const today = new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(`
      INSERT INTO visit_queue (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name)
      VALUES ($1,$2,$3,$4,$5,$6,null) RETURNING *
    `, [company.company_id, company.id, company.name, today, company.address, company.city]);

    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/visits/queue-status/:company_id
router.get('/queue-status/:company_id', async (req, res) => {
  try {
    const id = req.params.company_id;
    const [coRes, callingRes, visitRes, fuRes] = await Promise.all([
      pool.query('SELECT pipeline_stage FROM companies WHERE id = $1', [id]),
      pool.query("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [id]),
      pool.query('SELECT id FROM visit_queue WHERE entity_id=$1', [id]),
      pool.query("SELECT due_date FROM follow_ups WHERE entity_id=$1 AND source_type='company' AND is_locked=0 ORDER BY due_date ASC LIMIT 1", [id]),
    ]);
    res.json({
      stage:        coRes.rows[0]?.pipeline_stage || null,
      inCalling:    !!callingRes.rows[0],
      inMail:       false,
      inEmail:      false,
      inVisit:      !!visitRes.rows[0],
      followupDate: fuRes.rows[0]?.due_date || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
