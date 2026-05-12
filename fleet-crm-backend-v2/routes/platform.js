/**
 * FLEET CRM — PLATFORM ADMIN ROUTES
 * Manage per-shop Fleet Finder budgets and extra credits.
 * Protected by PLATFORM_ADMIN_SECRET env var (x-platform-key header).
 */

const express = require('express');
const router  = express.Router();
const { makeDb, platformQuery } = require('../db/tenant');

function requirePlatformAdmin(req, res, next) {
  const secret = process.env.PLATFORM_ADMIN_SECRET;
  if (!secret) return res.status(500).json({ error: 'PLATFORM_ADMIN_SECRET not configured on server.' });
  if (req.headers['x-platform-key'] !== secret) {
    return res.status(401).json({ error: 'Invalid platform admin key.' });
  }
  next();
}

router.use(requirePlatformAdmin);

// ── GET /api/platform/tenants ─────────────────────────────────────────────────
// List all shops with their current budget and spend
router.get('/tenants', async (req, res) => {
  try {
    const { rows: tenants } = await platformQuery(
      `SELECT id, slug, name, schema, created_at FROM platform.tenants ORDER BY id`
    );

    const result = await Promise.all(tenants.map(async (tenant) => {
      const db = makeDb(tenant.schema);
      const [budgetRow, extraRow, spentRow] = await Promise.all([
        db.query(`SELECT value FROM config_settings WHERE key = 'ff_monthly_budget'`),
        db.query(`SELECT value FROM config_settings WHERE key = 'ff_extra_credits'`),
        db.query(
          `SELECT COALESCE(SUM(cost_usd), 0) as spent
           FROM fleet_finder_cost_log
           WHERE ran_at >= date_trunc('month', now())::text`
        ),
      ]);
      const budget       = parseFloat(budgetRow.rows[0]?.value || 50);
      const extraCredits = parseFloat(extraRow.rows[0]?.value  || 0);
      const spent        = parseFloat(spentRow.rows[0]?.spent  || 0);
      return {
        ...tenant,
        ff_monthly_budget:   budget,
        ff_extra_credits:    extraCredits,
        ff_spent_this_month: spent,
        ff_remaining:        Math.max(0, budget + extraCredits - spent),
      };
    }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/platform/tenants/:schema/budget ──────────────────────────────────
// Set the monthly base budget for a shop
router.put('/tenants/:schema/budget', async (req, res) => {
  const amount = parseFloat(req.body.budget);
  if (isNaN(amount) || amount < 0) {
    return res.status(400).json({ error: 'budget must be a non-negative number.' });
  }
  try {
    const db = makeDb(req.params.schema);
    await db.query(
      `UPDATE config_settings SET value = $1 WHERE key = 'ff_monthly_budget'`,
      [amount.toFixed(2)]
    );
    res.json({ ok: true, schema: req.params.schema, ff_monthly_budget: amount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/platform/tenants/:schema/credits ────────────────────────────────
// Add extra (purchased) credits to a shop — these persist across months
router.post('/tenants/:schema/credits', async (req, res) => {
  const amount = parseFloat(req.body.amount);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number.' });
  }
  try {
    const db = makeDb(req.params.schema);
    const { rows } = await db.query(
      `SELECT value FROM config_settings WHERE key = 'ff_extra_credits'`
    );
    const current   = parseFloat(rows[0]?.value || 0);
    const newAmount = current + amount;
    await db.query(
      `UPDATE config_settings SET value = $1 WHERE key = 'ff_extra_credits'`,
      [newAmount.toFixed(5)]
    );
    res.json({ ok: true, schema: req.params.schema, ff_extra_credits: newAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
