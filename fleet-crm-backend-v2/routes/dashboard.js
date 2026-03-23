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

  res.json({
    follow_ups: followupCounts,
    visits:     visitCounts,
    queues:     queueCounts,
    activity: {
      calls_today:          callsToday,
      calls_this_week:      callsThisWeek,
      calls_this_month:     callsThisMonth,
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

module.exports = router;
