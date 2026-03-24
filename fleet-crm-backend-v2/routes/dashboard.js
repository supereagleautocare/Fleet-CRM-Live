/**
 * FLEET CRM — DASHBOARD STATS ROUTE
 * GET /api/dashboard
 *
 * Returns all numbers needed to power the dashboard in one call.
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  // ── Follow-up queue ──────────────────────────────────────────────────────
  const followupCounts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN due_date <  date('now') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN due_date =  date('now') THEN 1 ELSE 0 END) as due_today,
      SUM(CASE WHEN source_type = 'company'  THEN 1 ELSE 0 END) as company_followups
    FROM follow_ups
    WHERE due_date <= date('now')
  `).get();

  // ── Visit queue ───────────────────────────────────────────────────────────
  const visitCounts = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN scheduled_date < date('now') THEN 1 ELSE 0 END) as overdue,
      SUM(CASE WHEN scheduled_date = date('now') THEN 1 ELSE 0 END) as due_today
    FROM visit_queue
    WHERE scheduled_date <= date('now')
  `).get();

  // ── Calling queues ────────────────────────────────────────────────────────
  const queueCounts = db.prepare(`
    SELECT COUNT(*) as total_in_queue
    FROM calling_queue
    WHERE queue_type = 'company'
  `).get();

  // ── Call activity ─────────────────────────────────────────────────────────
  const callsToday = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) = date('now') AND action_type = 'Call'"
  ).get().cnt;

  const callsThisWeek = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) >= ? AND action_type = 'Call'"
  ).get(sevenDaysAgo).cnt;

  const callsThisMonth = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) >= ? AND action_type = 'Call'"
  ).get(thirtyDaysAgo).cnt;

  const contactsThisMonth = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) >= ? AND action_type != 'Move'"
  ).get(thirtyDaysAgo).cnt;

  // ── Calls by type this month ──────────────────────────────────────────────
  const callsByType = db.prepare(`
    SELECT log_type, COUNT(*) as cnt
    FROM call_log
    WHERE date(logged_at) >= ?
    GROUP BY log_type
  `).all(thirtyDaysAgo);

  // ── Calls by outcome this month ───────────────────────────────────────────
  const callsByOutcome = db.prepare(`
    SELECT contact_type, COUNT(*) as cnt
    FROM call_log
    WHERE date(logged_at) >= ?
    GROUP BY contact_type
    ORDER BY cnt DESC
    LIMIT 10
  `).all(thirtyDaysAgo);

  // ── Calls by rep this month ───────────────────────────────────────────────
  const callsByRep = db.prepare(`
    SELECT logged_by_name, COUNT(*) as cnt
    FROM call_log
    WHERE date(logged_at) >= ?
    GROUP BY logged_by_name
    ORDER BY cnt DESC
  `).all(thirtyDaysAgo);

  // ── Totals ────────────────────────────────────────────────────────────────
  const totals = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM companies WHERE status = 'active') as total_companies,
      (SELECT COUNT(*) FROM call_log WHERE log_type = 'company')  as total_company_calls,
      (SELECT COUNT(*) FROM call_log WHERE action_type = 'Visit') as total_visits
  `).get();

 const contactsToday = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) = date('now') AND action_type != 'Move'"
  ).get().cnt;

  const contactsThisWeek = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE date(logged_at) >= ? AND action_type != 'Move'"
  ).get(sevenDaysAgo).cnt;

  res.json({
    follow_ups: followupCounts,
    visits:     visitCounts,
    queues:     queueCounts,
    activity: {
      calls_today:          callsToday,
      calls_this_week:      callsThisWeek,
      calls_this_month:     callsThisMonth,
      contacts_today:       contactsToday,
      contacts_this_week:   contactsThisWeek,
      contacts_this_month:  contactsThisMonth,
    },
    breakdowns: {
      by_type:    callsByType,
      by_outcome: callsByOutcome,
      by_rep:     callsByRep,
    },
    totals,
    generated_at: new Date().toISOString(),
  });
});
// GET /api/dashboard/activity-drill?type=calls|contacts&period=today|week|month
router.get('/activity-drill', (req, res) => {
  const { type = 'calls', period = 'today' } = req.query;
  const sevenDaysAgo  = new Date(Date.now() -  7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const dateFilter = period === 'today' ? `date(cl.logged_at) = date('now')`
    : period === 'week'  ? `date(cl.logged_at) >= '${sevenDaysAgo}'`
    : `date(cl.logged_at) >= '${thirtyDaysAgo}'`;

  const actionFilter = type === 'calls' ? `cl.action_type = 'Call'` : `cl.action_type != 'Move'`;

  const rows = db.prepare(`
    SELECT c.id, c.name, c.company_id, c.main_phone, c.industry, c.pipeline_stage, c.company_status,
      COUNT(cl.id) as contact_count,
      MAX(cl.logged_at) as last_contact,
      MAX(cl.contact_type) as last_contact_type
    FROM companies c
    JOIN call_log cl ON cl.entity_id = c.id AND cl.log_type = 'company'
    WHERE ${dateFilter} AND ${actionFilter}
    GROUP BY c.id
    ORDER BY MAX(cl.logged_at) DESC
  `).all();
  res.json(rows);
});
module.exports = router;
