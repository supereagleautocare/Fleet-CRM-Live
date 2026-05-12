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

// ── POST /api/platform/tenants ────────────────────────────────────────────────
// Provision a new shop manually from the admin dashboard
router.post('/tenants', async (req, res) => {
  const { shopName, adminName, adminEmail, adminPassword } = req.body;
  if (!shopName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'shopName, adminEmail, adminPassword required.' });
  }
  const crypto = require('crypto');
  const shopSlug = adminEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20)
    + '_' + Date.now().toString(36);
  try {
    const { provisionTenant } = require('../db/tenant');
    await provisionTenant({
      shopSlug,
      shopName,
      adminName:     adminName || adminEmail.split('@')[0],
      adminEmail:    adminEmail.toLowerCase().trim(),
      adminPassword,
    });
    res.json({ ok: true, shopSlug });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// ── GET /api/platform/tenants/:schema/users ───────────────────────────────────
router.get('/tenants/:schema/users', async (req, res) => {
  try {
    const db = makeDb(req.params.schema);
    const { rows } = await db.query(`SELECT id, name, email, role, created_at FROM users ORDER BY id`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/platform/tenants/:schema/users ──────────────────────────────────
router.post('/tenants/:schema/users', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'name, email, password required' });
  try {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    const db = makeDb(req.params.schema);
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role`,
      [name, email.toLowerCase().trim(), hash, role || 'user']
    );
    await platformQuery(
      `INSERT INTO platform.tenant_users (email, schema) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET schema = $2`,
      [email.toLowerCase().trim(), req.params.schema]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/platform/tenants/:schema/users/:userId ────────────────────────
router.delete('/tenants/:schema/users/:userId', async (req, res) => {
  try {
    const db = makeDb(req.params.schema);
    const { rows } = await db.query(`SELECT email FROM users WHERE id = $1`, [req.params.userId]);
    if (rows[0]) {
      await db.query(`DELETE FROM users WHERE id = $1`, [req.params.userId]);
      await platformQuery(`DELETE FROM platform.tenant_users WHERE email = $1`, [rows[0].email]);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/platform/tenants/:schema/logs ────────────────────────────────────
router.get('/tenants/:schema/logs', async (req, res) => {
  try {
    const db = makeDb(req.params.schema);
    const { rows } = await db.query(
      `SELECT * FROM fleet_finder_cost_log ORDER BY ran_at DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
