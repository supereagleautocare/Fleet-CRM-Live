/**
 * FLEET CRM — DASHBOARD STATS ROUTE (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const today        = new Date().toISOString().split('T')[0];
    const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const [
  followupResult,
  visitResult,
  queueResult,
  callsTodayResult,
  callsWeekResult,
  callsMonthResult,
  contactsMonthResult,
  contactsTodayResult,
  contactsWeekResult,
  byTypeResult,
  byOutcomeResult,
  byRepResult,
  totalsResult,
] = await Promise.all([
  pool.query(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN due_date < $1 THEN 1 ELSE 0 END) as overdue,
    SUM(CASE WHEN due_date = $1 THEN 1 ELSE 0 END) as due_today,
    SUM(CASE WHEN source_type = 'company' THEN 1 ELSE 0 END) as company_followups
  FROM follow_ups WHERE due_date <= $1
`, [today]),
pool.query(`
  SELECT
    COUNT(*) as total,
    SUM(CASE WHEN scheduled_date < $1 THEN 1 ELSE 0 END) as overdue,
    SUM(CASE WHEN scheduled_date = $1 THEN 1 ELSE 0 END) as due_today
  FROM visit_queue WHERE scheduled_date <= $1
`, [today]),
  pool.query(`SELECT COUNT(*) as total_in_queue FROM calling_queue WHERE queue_type = 'company'`),
  // ── Calls = only contact_types where counts_as_attempt = 1 ──
  pool.query(`
    SELECT COUNT(*) as cnt FROM call_log cl
    WHERE substring(cl.logged_at,1,10) = current_date::text
      AND cl.action_type = 'Call'
      AND cl.counts_as_attempt = 1
  `),
  pool.query(`
    SELECT COUNT(*) as cnt FROM call_log cl
    WHERE substring(cl.logged_at,1,10) >= $1
      AND cl.action_type = 'Call'
      AND cl.counts_as_attempt = 1
  `, [sevenDaysAgo]),
  pool.query(`
    SELECT COUNT(*) as cnt FROM call_log cl
    WHERE substring(cl.logged_at,1,10) >= $1
      AND cl.action_type = 'Call'
      AND cl.counts_as_attempt = 1
  `, [thirtyDaysAgo]),
  pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type != 'Move'`, [thirtyDaysAgo]),
  pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = current_date::text AND action_type != 'Move'`),
  pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type != 'Move'`, [sevenDaysAgo]),
  pool.query(`SELECT log_type, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 GROUP BY log_type`, [thirtyDaysAgo]),
  pool.query(`SELECT contact_type, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND counts_as_attempt=1 GROUP BY contact_type ORDER BY cnt DESC LIMIT 10`, [thirtyDaysAgo]),
  pool.query(`SELECT logged_by_name, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND counts_as_attempt=1 GROUP BY logged_by_name ORDER BY cnt DESC`, [thirtyDaysAgo]),
  pool.query(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE status = 'active') as total_companies,
      (SELECT COUNT(*) FROM call_log WHERE log_type = 'company' AND counts_as_attempt=1) as total_company_calls,
      (SELECT COUNT(*) FROM call_log WHERE action_type = 'Visit') as total_visits
  `),
]);
    res.json({
      follow_ups: followupResult.rows[0],
      visits:     visitResult.rows[0],
      queues:     queueResult.rows[0],
      activity: {
        calls_today:         parseInt(callsTodayResult.rows[0].cnt),
        calls_this_week:     parseInt(callsWeekResult.rows[0].cnt),
        calls_this_month:    parseInt(callsMonthResult.rows[0].cnt),
        contacts_today:      parseInt(contactsTodayResult.rows[0].cnt),
        contacts_this_week:  parseInt(contactsWeekResult.rows[0].cnt),
        contacts_this_month: parseInt(contactsMonthResult.rows[0].cnt),
      },
      breakdowns: {
        by_type:    byTypeResult.rows,
        by_outcome: byOutcomeResult.rows,
        by_rep:     byRepResult.rows,
      },
      totals: totalsResult.rows[0],
      generated_at: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/activity-drill
router.get('/activity-drill', async (req, res) => {
  try {
    const { type = 'calls', period = 'today' } = req.query;
    const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const dateFilter = period === 'today'
      ? `cl.logged_at::date = current_date`
      : period === 'week'
      ? `cl.logged_at::date >= '${sevenDaysAgo}'`
      : `cl.logged_at::date >= '${thirtyDaysAgo}'`;

    const actionFilter = type === 'calls' ? `cl.action_type = 'Call'` : `cl.action_type != 'Move'`;

    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.company_id, c.main_phone, c.industry, c.pipeline_stage, c.company_status,
        COUNT(cl.id) as contact_count,
        MAX(cl.logged_at) as last_contact,
        MAX(cl.contact_type) as last_contact_type
      FROM companies c
      JOIN call_log cl ON cl.entity_id = c.id AND cl.log_type = 'company'
      WHERE ${dateFilter} AND ${actionFilter}
      GROUP BY c.id
      ORDER BY MAX(cl.logged_at) DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dashboard/:id (company delete)
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    await client.query('BEGIN');
    await client.query('DELETE FROM call_log WHERE entity_id = $1 AND log_type = $2', [company.id, 'company']);
    await client.query('DELETE FROM follow_ups WHERE entity_id = $1 AND source_type = $2', [company.id, 'company']);
    await client.query('DELETE FROM calling_queue WHERE entity_id = $1', [company.id]);
    await client.query('DELETE FROM visit_queue WHERE entity_id = $1', [company.id]);
    await client.query('DELETE FROM company_contacts WHERE company_id = $1', [company.company_id]);
    await client.query('DELETE FROM companies WHERE id = $1', [company.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Delete failed: ' + e.message });
  } finally {
    client.release();
  }
});

// POST /api/dashboard/:id/merge/:into_id
router.post('/:id/merge/:into_id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: s } = await client.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    const { rows: t } = await client.query('SELECT * FROM companies WHERE id = $1', [req.params.into_id]);
    const source = s[0], target = t[0];
    if (!source || !target) return res.status(404).json({ error: 'Company not found.' });

    await client.query('BEGIN');
    await client.query(
      'UPDATE call_log SET entity_id=$1, company_id_str=$2, entity_name=$3 WHERE entity_id=$4 AND log_type=$5',
      [target.id, target.company_id, target.name, source.id, 'company']
    );
    await client.query(
      'UPDATE follow_ups SET entity_id=$1 WHERE entity_id=$2 AND source_type=$3',
      [target.id, source.id, 'company']
    );
    await client.query(
      'UPDATE company_contacts SET company_id=$1 WHERE company_id=$2',
      [target.company_id, source.company_id]
    );
    await client.query('UPDATE calling_queue SET entity_id=$1 WHERE entity_id=$2', [target.id, source.id]);
    await client.query(
      'UPDATE visit_queue SET entity_id=$1, company_id=$2, entity_name=$3 WHERE entity_id=$4',
      [target.id, target.company_id, target.name, source.id]
    );
    for (const f of ['industry','address','city','website','notes','main_phone']) {
      if (!target[f] && source[f]) {
        await client.query(`UPDATE companies SET ${f}=$1 WHERE id=$2`, [source[f], target.id]);
      }
    }
    await client.query('DELETE FROM companies WHERE id=$1', [source.id]);
    await client.query('COMMIT');
    res.json({ ok: true, kept: target.id });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Merge failed: ' + e.message });
  } finally {
    client.release();
  }
});

module.exports = router;
