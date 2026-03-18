/**
 * FLEET CRM — CUSTOMER ROUTES
 *
 * Existing shop customers — called for referrals.
 *
 * GET/POST         /api/customers
 * GET/PUT          /api/customers/:id
 * GET              /api/customers/:id/history
 * GET              /api/customers/queue/list
 * POST             /api/customers/queue
 * DELETE           /api/customers/queue/:queueId
 * POST             /api/customers/queue/:queueId/complete
 * POST             /api/customers/import   (CSV rows)
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { calcFollowUpDate, appendCallLog, cancelOldFollowUps } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ═══════════════════════════════════════════════════════
// CUSTOMER PROFILES
// ═══════════════════════════════════════════════════════

// GET /api/customers
router.get('/', (req, res) => {
  const { search, status = 'active' } = req.query;
  let sql = 'SELECT * FROM customers WHERE 1=1';
  const params = [];

  if (status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    sql += ' AND (first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  sql += ' ORDER BY last_name ASC, first_name ASC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/customers/:id
router.get('/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const stats = db.prepare(`
    SELECT COUNT(*) as total_calls, MAX(logged_at) as last_contacted
    FROM call_log WHERE entity_id = ? AND log_type = 'customer'
  `).get(req.params.id);

  res.json({ ...customer, call_stats: stats });
});

// POST /api/customers
router.post('/', (req, res) => {
  const {
    first_name, last_name, phone, email,
    lifetime_visits, lifetime_spend, lifetime_gp_per_hr,
    last_visit_date, last_visit_ro_total, marketing_source, notes
  } = req.body;

  if (!first_name || !last_name) return res.status(400).json({ error: 'First and last name are required.' });
  if (!phone)                    return res.status(400).json({ error: 'Phone number is required.' });

  const normalized = phone.replace(/\D/g, '');
  const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(normalized);
  if (existing) return res.status(409).json({ error: 'A customer with that phone number already exists.', existing_id: existing.id });

  const result = db.prepare(`
    INSERT INTO customers
      (first_name, last_name, phone, email, lifetime_visits, lifetime_spend,
       lifetime_gp_per_hr, last_visit_date, last_visit_ro_total, marketing_source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    first_name.trim(), last_name.trim(), normalized,
    email || null,
    lifetime_visits   || 0,
    lifetime_spend    || 0,
    lifetime_gp_per_hr || 0,
    last_visit_date   || null,
    last_visit_ro_total || 0,
    marketing_source  || null,
    notes             || null
  );

  res.status(201).json(db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/customers/:id
router.put('/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const fields = [
    'first_name', 'last_name', 'phone', 'email', 'lifetime_visits',
    'lifetime_spend', 'lifetime_gp_per_hr', 'last_visit_date',
    'last_visit_ro_total', 'marketing_source', 'notes', 'status'
  ];
  const updates = [];
  const values = [];

  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(f === 'phone' ? req.body[f].replace(/\D/g, '') : req.body[f]);
    }
  }

  if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);

  db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id));
});

// GET /api/customers/:id/history
router.get('/:id/history', (req, res) => {
  const rows = db.prepare(`
    SELECT cl.*, u.name AS logged_by_display
    FROM call_log cl
    LEFT JOIN users u ON u.id = cl.logged_by
    WHERE cl.entity_id = ? AND cl.log_type = 'customer'
    ORDER BY cl.logged_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// ═══════════════════════════════════════════════════════
// CUSTOMER CALLING QUEUE
// ═══════════════════════════════════════════════════════

// GET /api/customers/queue/list
router.get('/queue/list', (req, res) => {
  const rows = db.prepare(`
    SELECT
      q.*,
      c.first_name,
      c.last_name,
      c.first_name || ' ' || c.last_name AS full_name,
      c.phone,
      c.email,
      c.lifetime_visits,
      c.lifetime_spend,
      c.lifetime_gp_per_hr,
      c.last_visit_date,
      c.last_visit_ro_total,
      c.marketing_source
    FROM calling_queue q
    JOIN customers c ON c.id = q.entity_id
    WHERE q.queue_type = 'customer'
    ORDER BY q.added_at ASC
  `).all();
  res.json(rows);
});

// POST /api/customers/queue — add customer to queue
router.post('/queue', (req, res) => {
  const { customer_id } = req.body;
  if (!customer_id) return res.status(400).json({ error: 'customer_id is required.' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const existing = db.prepare(
    "SELECT id FROM calling_queue WHERE queue_type = 'customer' AND entity_id = ?"
  ).get(customer_id);
  if (existing) return res.status(409).json({ error: 'Customer is already in the calling queue.' });

  const result = db.prepare(`
    INSERT INTO calling_queue (queue_type, entity_id, added_by)
    VALUES ('customer', ?, ?)
  `).run(customer_id, req.user.id);

  res.status(201).json(db.prepare('SELECT * FROM calling_queue WHERE id = ?').get(result.lastInsertRowid));
});

// DELETE /api/customers/queue/:queueId
router.delete('/queue/:queueId', (req, res) => {
  const result = db.prepare(
    "DELETE FROM calling_queue WHERE id = ? AND queue_type = 'customer'"
  ).run(req.params.queueId);
  if (result.changes === 0) return res.status(404).json({ error: 'Queue entry not found.' });
  res.json({ message: 'Removed from queue.' });
});

// ═══════════════════════════════════════════════════════
// COMPLETE A CUSTOMER CALL  ← CORE ACTION
// POST /api/customers/queue/:queueId/complete
// ═══════════════════════════════════════════════════════
router.post('/queue/:queueId/complete', (req, res) => {
  const queueRow = db.prepare(
    "SELECT * FROM calling_queue WHERE id = ? AND queue_type = 'customer'"
  ).get(req.params.queueId);
  if (!queueRow) return res.status(404).json({ error: 'Queue entry not found.' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(queueRow.entity_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const {
    contact_type,    // Required
    notes,
    next_action,     // 'Call' | 'Stop'  (customers can't have visits)
  } = req.body;

  if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
  if (!next_action)  return res.status(400).json({ error: 'next_action is required (Call/Stop).' });
  if (next_action === 'Visit') return res.status(400).json({ error: 'Customers cannot be visited. Use Call or Stop.' });

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'customer'"
  ).get(customer.id).cnt;

  let next_action_date = null;
  if (next_action === 'Call') {
    next_action_date = calcFollowUpDate('customer', contact_type);
  }

  // Log the call — including customer stats snapshot (never blank out existing data)
  const logEntry = appendCallLog({
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
    // Customer-specific stats (snapshot at time of logging)
    lifetime_visits: customer.lifetime_visits,
    lifetime_spend: customer.lifetime_spend,
    lifetime_gp_per_hr: customer.lifetime_gp_per_hr,
    last_visit_date: customer.last_visit_date,
    last_visit_ro_total: customer.last_visit_ro_total,
    marketing_source: customer.marketing_source,
  });

  // Create follow-up if needed
  if (next_action === 'Call' && next_action_date) {
    // Cancel any existing open follow-ups for this customer first
    cancelOldFollowUps('customer', customer.id);

    db.prepare(`
      INSERT INTO follow_ups
        (source_type, entity_id, entity_name, phone, contact_name, due_date, source_log_id)
      VALUES ('customer', ?, ?, ?, ?, ?, ?)
    `).run(
      customer.id,
      `${customer.first_name} ${customer.last_name}`,
      customer.phone,
      `${customer.first_name} ${customer.last_name}`,
      next_action_date,
      logEntry.id
    );
  }

  // Remove from calling queue
  db.prepare('DELETE FROM calling_queue WHERE id = ?').run(req.params.queueId);

  res.json({
    message: 'Call logged successfully.',
    log_id: logEntry.id,
    next_action,
    next_action_date,
    attempt_number: priorAttempts + 1
  });
});

// ═══════════════════════════════════════════════════════
// BULK CSV IMPORT
// POST /api/customers/import
// Body: { customers: [ { first_name, last_name, phone, ... }, ... ], add_to_queue: bool }
// ═══════════════════════════════════════════════════════
router.post('/import', (req, res) => {
  const { customers, add_to_queue = true } = req.body;
  if (!Array.isArray(customers) || customers.length === 0) {
    return res.status(400).json({ error: 'Provide an array of customers to import.' });
  }

  const results = { imported: 0, skipped: 0, already_called: 0, errors: [] };

  // Phones already in call log (don't re-add to queue)
  const calledPhones = new Set(
    db.prepare("SELECT DISTINCT phone FROM call_log WHERE log_type = 'customer'")
      .all().map(r => r.phone)
  );

  db.exec('BEGIN TRANSACTION');
  try {
    for (const row of customers) {
      // Support both camelCase and "Column Name" style headers from CSV
      const first = (row.first_name || row['First Name'] || row['First'] || '').trim();
      const last  = (row.last_name  || row['Last Name']  || row['Last']  || '').trim();
      const phone = (row.phone      || row['Phone']       || '').replace(/\D/g, '');
      const marketing = (row.marketing_source || row['Marketing'] || '').trim().toLowerCase();

      // Skip if no phone or marketing = 'no'
      if (!phone)             { results.skipped++;  continue; }
      if (marketing === 'no') { results.skipped++;  continue; }

      // Skip if already in call log
      if (calledPhones.has(phone)) { results.already_called++; continue; }

      // Skip if already in customers table
      const existingCustomer = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone);

      let customerId;
      if (existingCustomer) {
        customerId = existingCustomer.id;
        // Update stats from fresh import
        db.prepare(`
          UPDATE customers SET
            lifetime_visits = ?, lifetime_spend = ?, lifetime_gp_per_hr = ?,
            last_visit_date = ?, last_visit_ro_total = ?, marketing_source = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          Number(row.lifetime_visits || row['Lifetime Visits'] || 0),
          Number(row.lifetime_spend || row['Lifetime Spend'] || 0),
          Number(row.lifetime_gp_per_hr || row['Lifetime GP/hr'] || 0),
          row.last_visit_date || row['Last Visit Date'] || null,
          Number(row.last_visit_ro_total || row['Last RO Total'] || 0),
          row.marketing_source || row['Marketing'] || null,
          existingCustomer.id
        );
      } else {
        try {
          const insertResult = db.prepare(`
            INSERT INTO customers
              (first_name, last_name, phone, email, lifetime_visits, lifetime_spend,
               lifetime_gp_per_hr, last_visit_date, last_visit_ro_total, marketing_source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            first || 'Unknown',
            last  || 'Unknown',
            phone,
            row.email || row['Email'] || null,
            Number(row.lifetime_visits  || row['Lifetime Visits'] || 0),
            Number(row.lifetime_spend   || row['Lifetime Spend'] || 0),
            Number(row.lifetime_gp_per_hr || row['Lifetime GP/hr'] || 0),
            row.last_visit_date || row['Last Visit Date'] || null,
            Number(row.last_visit_ro_total || row['Last RO Total'] || 0),
            row.marketing_source || row['Marketing'] || null,
          );
          customerId = insertResult.lastInsertRowid;
          results.imported++;
        } catch (err) {
          results.errors.push({ phone, error: err.message });
          continue;
        }
      }

      // Add to calling queue if requested and not already there
      if (add_to_queue && customerId) {
        const inQueue = db.prepare(
          "SELECT id FROM calling_queue WHERE queue_type = 'customer' AND entity_id = ?"
        ).get(customerId);
        if (!inQueue) {
          db.prepare("INSERT INTO calling_queue (queue_type, entity_id, added_by) VALUES ('customer', ?, ?)")
            .run(customerId, req.user.id);
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
