/**
 * FLEET CRM — CUSTOMER ROUTES (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { calcFollowUpDate, appendCallLog, cancelOldFollowUps } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ── GET /api/customers ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, status = 'active' } = req.query;
    let sql = 'SELECT * FROM customers WHERE 1=1';
    const params = [];
    let i = 1;

    if (status !== 'all') {
      sql += ` AND status = $${i++}`;
      params.push(status);
    }
    if (search) {
      sql += ` AND (first_name ILIKE $${i} OR last_name ILIKE $${i} OR phone ILIKE $${i} OR email ILIKE $${i})`;
      params.push(`%${search}%`);
      i++;
    }
    sql += ' ORDER BY last_name ASC, first_name ASC';

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/customers/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    const customer = rows[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const { rows: statsRows } = await pool.query(
      "SELECT COUNT(*) as total_calls, MAX(logged_at) as last_contacted FROM call_log WHERE entity_id = $1 AND log_type = 'customer'",
      [req.params.id]
    );
    res.json({ ...customer, call_stats: statsRows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/customers ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      first_name, last_name, phone, email,
      lifetime_visits, lifetime_spend, lifetime_gp_per_hr,
      last_visit_date, last_visit_ro_total, marketing_source, notes
    } = req.body;

    if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required.' });
    if (!phone) return res.status(400).json({ error: 'Phone number is required.' });

    const normalized = phone.replace(/\D/g, '');
    const existing = await pool.query('SELECT id FROM customers WHERE phone = $1', [normalized]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'A customer with that phone number already exists.', existing_id: existing.rows[0].id });
    }

    const { rows } = await pool.query(`
      INSERT INTO customers
        (first_name, last_name, phone, email, lifetime_visits, lifetime_spend,
         lifetime_gp_per_hr, last_visit_date, last_visit_ro_total, marketing_source, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *
    `, [
      first_name.trim(), last_name.trim(), normalized,
      email || null,
      lifetime_visits    || 0,
      lifetime_spend     || 0,
      lifetime_gp_per_hr || 0,
      last_visit_date    || null,
      last_visit_ro_total || 0,
      marketing_source   || null,
      notes              || null,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PUT /api/customers/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found.' });

    const fields = [
      'first_name', 'last_name', 'phone', 'email', 'lifetime_visits',
      'lifetime_spend', 'lifetime_gp_per_hr', 'last_visit_date',
      'last_visit_ro_total', 'marketing_source', 'notes', 'status'
    ];
    const updates = [], values = [];
    let i = 1;

    for (const f of fields) {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(f === 'phone' ? req.body[f].replace(/\D/g, '') : req.body[f]);
      }
    }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push(`updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
    values.push(req.params.id);

    const { rows: updated } = await pool.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/customers/:id/history ───────────────────────────────────────────
router.get('/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cl.*, u.name AS logged_by_display
      FROM call_log cl
      LEFT JOIN users u ON u.id = cl.logged_by
      WHERE cl.entity_id = $1 AND cl.log_type = 'customer'
      ORDER BY cl.logged_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/customers/queue/list ────────────────────────────────────────────
router.get('/queue/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        q.*,
        c.first_name,
        c.last_name,
        c.first_name || ' ' || c.last_name AS full_name,
        c.phone, c.email,
        c.lifetime_visits, c.lifetime_spend, c.lifetime_gp_per_hr,
        c.last_visit_date, c.last_visit_ro_total, c.marketing_source
      FROM calling_queue q
      JOIN customers c ON c.id = q.entity_id
      WHERE q.queue_type = 'customer'
      ORDER BY q.added_at ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/customers/queue ─────────────────────────────────────────────────
router.post('/queue', async (req, res) => {
  try {
    const { customer_id } = req.body;
    if (!customer_id) return res.status(400).json({ error: 'customer_id is required.' });

    const { rows } = await pool.query('SELECT * FROM customers WHERE id = $1', [customer_id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found.' });

    const existing = await pool.query(
      "SELECT id FROM calling_queue WHERE queue_type = 'customer' AND entity_id = $1", [customer_id]
    );
    if (existing.rows[0]) return res.status(409).json({ error: 'Customer is already in the calling queue.' });

    const { rows: inserted } = await pool.query(
      "INSERT INTO calling_queue (queue_type, entity_id, added_by) VALUES ('customer', $1, $2) RETURNING *",
      [customer_id, req.user.id]
    );
    res.status(201).json(inserted[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /api/customers/queue/:queueId ─────────────────────────────────────
router.delete('/queue/:queueId', async (req, res) => {
  try {
    const result = await pool.query(
      "DELETE FROM calling_queue WHERE id = $1 AND queue_type = 'customer'", [req.params.queueId]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Queue entry not found.' });
    res.json({ message: 'Removed from queue.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/customers/queue/:queueId/complete ───────────────────────────────
router.post('/queue/:queueId/complete', async (req, res) => {
  try {
    const { rows: qRows } = await pool.query(
      "SELECT * FROM calling_queue WHERE id = $1 AND queue_type = 'customer'", [req.params.queueId]
    );
    if (!qRows[0]) return res.status(404).json({ error: 'Queue entry not found.' });

    const { rows: cRows } = await pool.query('SELECT * FROM customers WHERE id = $1', [qRows[0].entity_id]);
    const customer = cRows[0];
    if (!customer) return res.status(404).json({ error: 'Customer not found.' });

    const { contact_type, notes, next_action } = req.body;
    if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
    if (!next_action)  return res.status(400).json({ error: 'next_action is required (Call/Stop).' });
    if (next_action === 'Visit') return res.status(400).json({ error: 'Customers cannot be visited.' });

    const { rows: priorRows } = await pool.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = $1 AND log_type = 'customer'", [customer.id]
    );
    const priorAttempts = parseInt(priorRows[0].cnt);

    let next_action_date = null;
    if (next_action === 'Call') {
      next_action_date = await calcFollowUpDate('customer', contact_type);
    }

    const logEntry = await appendCallLog({
      log_type: 'customer',
      entity_id: customer.id,
      entity_name: `${customer.first_name} ${customer.last_name}`,
      phone: customer.phone,
      action_type: 'Call',
      contact_type,
      notes: notes || null,
      next_action,
      next_action_date,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      lifetime_visits:     customer.lifetime_visits,
      lifetime_spend:      customer.lifetime_spend,
      lifetime_gp_per_hr:  customer.lifetime_gp_per_hr,
      last_visit_date:     customer.last_visit_date,
      last_visit_ro_total: customer.last_visit_ro_total,
      marketing_source:    customer.marketing_source,
    });

    if (next_action === 'Call' && next_action_date) {
      await cancelOldFollowUps('customer', customer.id);
      await pool.query(`
        INSERT INTO follow_ups
          (source_type, entity_id, entity_name, phone, contact_name, due_date, source_log_id)
        VALUES ('customer', $1, $2, $3, $4, $5, $6)
        ON CONFLICT (source_type, entity_id) DO UPDATE
          SET due_date=$5, source_log_id=$6
      `, [
        customer.id,
        `${customer.first_name} ${customer.last_name}`,
        customer.phone,
        `${customer.first_name} ${customer.last_name}`,
        next_action_date,
        logEntry.id,
      ]);
    }

    await pool.query('DELETE FROM calling_queue WHERE id = $1', [req.params.queueId]);

    res.json({
      message: 'Call logged successfully.',
      log_id: logEntry.id,
      next_action,
      next_action_date,
      attempt_number: priorAttempts + 1,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/customers/import ────────────────────────────────────────────────
router.post('/import', async (req, res) => {
  const { customers, add_to_queue = true } = req.body;
  if (!Array.isArray(customers) || customers.length === 0) {
    return res.status(400).json({ error: 'Provide an array of customers to import.' });
  }

  const results = { imported: 0, skipped: 0, already_called: 0, errors: [] };
  const client = await pool.connect();

  try {
    const { rows: calledRows } = await client.query(
      "SELECT DISTINCT phone FROM call_log WHERE log_type = 'customer'"
    );
    const calledPhones = new Set(calledRows.map(r => r.phone));

    await client.query('BEGIN');

    for (const row of customers) {
      const first = (row.first_name || row['First Name'] || row['First'] || '').trim();
      const last  = (row.last_name  || row['Last Name']  || row['Last']  || '').trim();
      const phone = (row.phone      || row['Phone']      || '').replace(/\D/g, '');
      const marketing = (row.marketing_source || row['Marketing'] || '').trim().toLowerCase();

      if (!phone)             { results.skipped++;       continue; }
      if (marketing === 'no') { results.skipped++;       continue; }
      if (calledPhones.has(phone)) { results.already_called++; continue; }

      const existing = await client.query('SELECT id FROM customers WHERE phone = $1', [phone]);
      let customerId;

      if (existing.rows[0]) {
        customerId = existing.rows[0].id;
        await client.query(`
          UPDATE customers SET
            lifetime_visits=$1, lifetime_spend=$2, lifetime_gp_per_hr=$3,
            last_visit_date=$4, last_visit_ro_total=$5, marketing_source=$6,
            updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
          WHERE id=$7
        `, [
          Number(row.lifetime_visits  || row['Lifetime Visits'] || 0),
          Number(row.lifetime_spend   || row['Lifetime Spend']  || 0),
          Number(row.lifetime_gp_per_hr || row['Lifetime GP/hr'] || 0),
          row.last_visit_date || row['Last Visit Date'] || null,
          Number(row.last_visit_ro_total || row['Last RO Total'] || 0),
          row.marketing_source || row['Marketing'] || null,
          customerId,
        ]);
      } else {
        try {
          const { rows: inserted } = await client.query(`
            INSERT INTO customers
              (first_name, last_name, phone, email, lifetime_visits, lifetime_spend,
               lifetime_gp_per_hr, last_visit_date, last_visit_ro_total, marketing_source)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
          `, [
            first || 'Unknown', last || 'Unknown', phone,
            row.email || row['Email'] || null,
            Number(row.lifetime_visits    || row['Lifetime Visits'] || 0),
            Number(row.lifetime_spend     || row['Lifetime Spend']  || 0),
            Number(row.lifetime_gp_per_hr || row['Lifetime GP/hr']  || 0),
            row.last_visit_date || row['Last Visit Date'] || null,
            Number(row.last_visit_ro_total || row['Last RO Total']  || 0),
            row.marketing_source || row['Marketing'] || null,
          ]);
          customerId = inserted[0].id;
          results.imported++;
        } catch (err) {
          results.errors.push({ phone, error: err.message });
          continue;
        }
      }

      if (add_to_queue && customerId) {
        const inQueue = await client.query(
          "SELECT id FROM calling_queue WHERE queue_type='customer' AND entity_id=$1", [customerId]
        );
        if (!inQueue.rows[0]) {
          await client.query(
            "INSERT INTO calling_queue (queue_type, entity_id, added_by) VALUES ('customer',$1,$2)",
            [customerId, req.user.id]
          );
        }
      }
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Import failed: ' + e.message });
  } finally {
    client.release();
  }

  res.status(201).json(results);
});

module.exports = router;
