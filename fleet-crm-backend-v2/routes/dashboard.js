/**
 * FLEET CRM — DASHBOARD STATS ROUTE (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/check-skipped', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT contact_type, counts_as_attempt, COUNT(*) as cnt
      FROM call_log
      WHERE contact_type IN ('Skipped', 'Do Not Call')
      GROUP BY contact_type, counts_as_attempt
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const { period = 'month' } = req.query;

    const now  = new Date();
    const today = now.toISOString().split('T')[0];

    // Calendar week start = Monday of current week
    const dow = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
    const daysToMon = dow === 0 ? 6 : dow - 1;
    const weekStart = new Date(now.getTime() - daysToMon * 86400000).toISOString().split('T')[0];

    // Month start = 1st of current month
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;

    // Year start = Jan 1 of current year
    const yearStart = `${now.getFullYear()}-01-01`;

    // Period start used for byRep/byOutcome charts
    const periodStart = period === 'week' ? weekStart
                      : period === 'year' ? yearStart
                      : monthStart;

    const [
      followupResult,
      visitResult,
      queueResult,
      callsTodayResult,
      callsWeekResult,
      callsMonthResult,
      callsYearResult,
      contactsTodayResult,
      contactsWeekResult,
      contactsMonthResult,
      contactsYearResult,
      byTypeResult,
      byOutcomeResult,
      byRepResult,
      totalsResult,
      mailTodayResult,
      mailWeekResult,
      mailMonthResult,
      emailTodayResult,
      emailWeekResult,
      emailMonthResult,
      visitTodayResult,
      visitWeekResult,
      visitMonthResult,
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
      // Calls today
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = $1 AND action_type='Call' AND counts_as_attempt=1`, [today]),
      // Calls this week (calendar week Mon–today)
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Call' AND counts_as_attempt=1`, [weekStart]),
      // Calls this month
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Call' AND counts_as_attempt=1`, [monthStart]),
      // Calls this year
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Call' AND counts_as_attempt=1`, [yearStart]),
      // Contacts today
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = $1 AND action_type!='Move'`, [today]),
      // Contacts this week
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type!='Move'`, [weekStart]),
      // Contacts this month
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type!='Move'`, [monthStart]),
      // Contacts this year
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type!='Move'`, [yearStart]),
      pool.query(`SELECT log_type, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 GROUP BY log_type`, [periodStart]),
      pool.query(`SELECT contact_type, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND counts_as_attempt=1 GROUP BY contact_type ORDER BY cnt DESC LIMIT 10`, [periodStart]),
      pool.query(`SELECT logged_by_name, COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND counts_as_attempt=1 GROUP BY logged_by_name ORDER BY cnt DESC`, [periodStart]),
      pool.query(`
        SELECT
          (SELECT COUNT(*) FROM companies WHERE status = 'active') as total_companies,
          (SELECT COUNT(*) FROM call_log WHERE log_type = 'company' AND counts_as_attempt=1) as total_company_calls,
          (SELECT COUNT(*) FROM call_log WHERE action_type = 'Visit') as total_visits
      `),
      // Mail counts
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = $1 AND action_type='Mail'`, [today]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Mail'`, [weekStart]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Mail'`, [monthStart]),
      // Email counts
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = $1 AND action_type='Email'`, [today]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Email'`, [weekStart]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Email'`, [monthStart]),
      // Visit counts
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) = $1 AND action_type='Visit'`, [today]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Visit'`, [weekStart]),
      pool.query(`SELECT COUNT(*) as cnt FROM call_log WHERE substring(logged_at,1,10) >= $1 AND action_type='Visit'`, [monthStart]),
    ]);

    res.json({
      follow_ups: followupResult.rows[0],
      visits:     visitResult.rows[0],
      queues:     queueResult.rows[0],
      activity: {
        calls_today:          parseInt(callsTodayResult.rows[0].cnt),
        calls_this_week:      parseInt(callsWeekResult.rows[0].cnt),
        calls_this_month:     parseInt(callsMonthResult.rows[0].cnt),
        calls_this_year:      parseInt(callsYearResult.rows[0].cnt),
        contacts_today:       parseInt(contactsTodayResult.rows[0].cnt),
        contacts_this_week:   parseInt(contactsWeekResult.rows[0].cnt),
        contacts_this_month:  parseInt(contactsMonthResult.rows[0].cnt),
        contacts_this_year:   parseInt(contactsYearResult.rows[0].cnt),
        mail_today:           parseInt(mailTodayResult.rows[0].cnt),
        mail_this_week:       parseInt(mailWeekResult.rows[0].cnt),
        mail_this_month:      parseInt(mailMonthResult.rows[0].cnt),
        email_today:          parseInt(emailTodayResult.rows[0].cnt),
        email_this_week:      parseInt(emailWeekResult.rows[0].cnt),
        email_this_month:     parseInt(emailMonthResult.rows[0].cnt),
        visits_today:         parseInt(visitTodayResult.rows[0].cnt),
        visits_this_week:     parseInt(visitWeekResult.rows[0].cnt),
        visits_this_month:    parseInt(visitMonthResult.rows[0].cnt),
      },
      breakdowns: {
        by_type:    byTypeResult.rows,
        by_outcome: byOutcomeResult.rows,
        by_rep:     byRepResult.rows,
      },
      period,
      week_start:  weekStart,
      month_start: monthStart,
      year_start:  yearStart,
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
    const now = new Date();
    const dow = now.getDay();
    const daysToMon = dow === 0 ? 6 : dow - 1;
    const weekStart  = new Date(now.getTime() - daysToMon * 86400000).toISOString().split('T')[0];
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const yearStart  = `${now.getFullYear()}-01-01`;

    const dateFilter = period === 'today'
      ? `cl.logged_at::date = current_date`
      : period === 'week'
      ? `cl.logged_at::date >= '${weekStart}'`
      : period === 'year'
      ? `cl.logged_at::date >= '${yearStart}'`
      : `cl.logged_at::date >= '${monthStart}'`;

    const actionFilter = type === 'calls'
      ? `cl.action_type = 'Call' AND cl.counts_as_attempt = 1`
      : `cl.action_type != 'Move'`;

    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.company_id, c.main_phone, c.industry, c.pipeline_stage, c.company_status,
        c.is_multi_location, c.location_name,
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
