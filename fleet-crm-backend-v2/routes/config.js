/**
 * FLEET CRM — CONFIG ROUTES (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── FOLLOW-UP RULES ──────────────────────────────────────────────────────────

router.get('/rules', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM config_rules ORDER BY source, contact_type');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/rules', async (req, res) => {
  try {
    const { source = 'company', action_type = 'call', contact_type, days, enabled = true } = req.body;
    if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
    if (days === undefined || days < 0) return res.status(400).json({ error: 'days must be a non-negative number.' });

    const existing = await pool.query(
      'SELECT id FROM config_rules WHERE source = $1 AND action_type = $2 AND contact_type = $3',
      [source, action_type, contact_type]
    );
    if (existing.rows[0]) return res.status(409).json({ error: 'A rule for that action_type + contact_type already exists. Use PUT to update.' });

    const { rows } = await pool.query(
      'INSERT INTO config_rules (source, action_type, contact_type, days, enabled) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [source, action_type, contact_type, days, enabled ? 1 : 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/rules/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM config_rules WHERE id = $1', [req.params.id]);
    const rule = rows[0];
    if (!rule) return res.status(404).json({ error: 'Rule not found.' });

    const { source, contact_type, days, enabled, counts_as_attempt, dead_action, snooze_days } = req.body;
    const { rows: updated } = await pool.query(`
      UPDATE config_rules
      SET source = $1, contact_type = $2, days = $3, enabled = $4,
          counts_as_attempt = $5, dead_action = $6, snooze_days = $7
      WHERE id = $8 RETURNING *
    `, [
      source       ?? rule.source,
      contact_type ?? rule.contact_type,
      days         ?? rule.days,
      enabled !== undefined ? (enabled ? 1 : 0) : rule.enabled,
      counts_as_attempt !== undefined ? (counts_as_attempt ? 1 : 0) : (rule.counts_as_attempt ?? 1),
      dead_action  ?? rule.dead_action  ?? 'none',
      snooze_days  ?? rule.snooze_days  ?? 90,
      req.params.id,
    ]);
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/rules/:id', async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM config_rules WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Rule not found.' });
    res.json({ message: 'Rule deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GENERAL SETTINGS ─────────────────────────────────────────────────────────

router.get('/settings', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM config_settings ORDER BY key');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings/:key', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM config_settings WHERE key = $1', [req.params.key]);
    if (!rows[0]) return res.status(404).json({ error: 'Setting not found.' });
    if (req.body.value === undefined) return res.status(400).json({ error: 'value is required.' });

    const { rows: updated } = await pool.query(
      "UPDATE config_settings SET value = $1, updated_at = to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE key = $2 RETURNING *",
      [String(req.body.value), req.params.key]
    );
    res.json(updated[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── CONTACT TYPES ─────────────────────────────────────────────────────────────

router.get('/contact-types', async (req, res) => {
  try {
    const { rows: types } = await pool.query(
      'SELECT DISTINCT contact_type, source, action_type FROM config_rules WHERE enabled = 1 ORDER BY action_type, contact_type'
    );

    const { rows: historical } = await pool.query(
      'SELECT DISTINCT contact_type FROM call_log WHERE contact_type NOT IN (SELECT contact_type FROM config_rules) ORDER BY contact_type'
    );

    const byAction = {};
    for (const t of types) {
      const key = t.action_type || 'call';
      if (!byAction[key]) byAction[key] = [];
      byAction[key].push(t.contact_type);
    }

    res.json({
      configured: types,
      historical: historical.map(r => r.contact_type),
      byAction,
      all: [...new Set([
        ...types.filter(t => (t.action_type || 'call') === 'call').map(t => t.contact_type),
        ...historical.map(r => r.contact_type)
      ])].sort()
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── SHOP ADDRESS ──────────────────────────────────────────────────────────────

router.put('/settings/shop_address', async (req, res) => {
  try {
    if (req.body.value === undefined) return res.status(400).json({ error: 'value is required.' });
    const { rows } = await pool.query(
      "UPDATE config_settings SET value = $1, updated_at = to_char(now(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') WHERE key = 'shop_address' RETURNING *",
      [String(req.body.value)]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
