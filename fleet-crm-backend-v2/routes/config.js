/**
 * FLEET CRM — CONFIG ROUTES
 *
 * GET    /api/config/rules           — all follow-up rules
 * POST   /api/config/rules           — add a rule
 * PUT    /api/config/rules/:id       — update a rule
 * DELETE /api/config/rules/:id       — remove a rule
 *
 * GET    /api/config/settings        — all settings
 * PUT    /api/config/settings/:key   — update a setting
 *
 * GET    /api/config/contact-types   — all contact types in use
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── FOLLOW-UP RULES ──────────────────────────────────────────────────────────

router.get('/rules', (req, res) => {
  res.json(db.prepare('SELECT * FROM config_rules ORDER BY source, contact_type').all());
});

router.post('/rules', (req, res) => {
  const { source = 'company', action_type = 'call', contact_type, days, enabled = true } = req.body;
  if (!contact_type)               return res.status(400).json({ error: 'contact_type is required.' });
  if (days === undefined || days < 0) return res.status(400).json({ error: 'days must be a non-negative number.' });

  const existing = db.prepare('SELECT id FROM config_rules WHERE source = ? AND action_type = ? AND contact_type = ?').get(source, action_type, contact_type);
  if (existing) return res.status(409).json({ error: 'A rule for that action_type + contact_type already exists. Use PUT to update.' });

  const result = db.prepare(
    'INSERT INTO config_rules (source, action_type, contact_type, days, enabled) VALUES (?, ?, ?, ?, ?)'
  ).run(source, action_type, contact_type, days, enabled ? 1 : 0);

  res.status(201).json(db.prepare('SELECT * FROM config_rules WHERE id = ?').get(result.lastInsertRowid));
});

router.put('/rules/:id', (req, res) => {
  const rule = db.prepare('SELECT * FROM config_rules WHERE id = ?').get(req.params.id);
  if (!rule) return res.status(404).json({ error: 'Rule not found.' });

  const { source, contact_type, days, enabled, counts_as_attempt, dead_action, snooze_days } = req.body;
  db.prepare(`
    UPDATE config_rules
    SET source = ?, contact_type = ?, days = ?, enabled = ?,
        counts_as_attempt = ?, dead_action = ?, snooze_days = ?
    WHERE id = ?
  `).run(
    source       ?? rule.source,
    contact_type ?? rule.contact_type,
    days         ?? rule.days,
    enabled !== undefined ? (enabled ? 1 : 0) : rule.enabled,
    counts_as_attempt !== undefined ? (counts_as_attempt ? 1 : 0) : (rule.counts_as_attempt ?? 1),
    dead_action  ?? rule.dead_action  ?? 'none',
    snooze_days  ?? rule.snooze_days  ?? 90,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM config_rules WHERE id = ?').get(req.params.id));
});

router.delete('/rules/:id', (req, res) => {
  const result = db.prepare('DELETE FROM config_rules WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Rule not found.' });
  res.json({ message: 'Rule deleted.' });
});

// ── GENERAL SETTINGS ─────────────────────────────────────────────────────────

router.get('/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM config_settings ORDER BY key').all());
});

router.put('/settings/:key', (req, res) => {
  const setting = db.prepare('SELECT * FROM config_settings WHERE key = ?').get(req.params.key);
  if (!setting) return res.status(404).json({ error: 'Setting not found.' });
  if (req.body.value === undefined) return res.status(400).json({ error: 'value is required.' });

  db.prepare("UPDATE config_settings SET value = ?, updated_at = datetime('now') WHERE key = ?")
    .run(String(req.body.value), req.params.key);
  res.json(db.prepare('SELECT * FROM config_settings WHERE key = ?').get(req.params.key));
});

// ── CONTACT TYPES (for dropdowns) ────────────────────────────────────────────
// Returns all contact_types that exist in the config rules — used to power
// dropdowns in the UI. Frontend can also use these to show valid options.

router.get('/contact-types', (req, res) => {
  const types = db.prepare(`
    SELECT DISTINCT contact_type, source, action_type FROM config_rules WHERE enabled = 1 ORDER BY action_type, contact_type
  `).all();

  // Also include any that appear in call_log but aren't in config (historical)
  const historical = db.prepare(`
    SELECT DISTINCT contact_type FROM call_log
    WHERE contact_type NOT IN (SELECT contact_type FROM config_rules)
    ORDER BY contact_type
  `).all();

  // Group by action_type for queue-specific dropdowns
  const byAction = {};
  for (const t of types) {
    const key = t.action_type || 'call';
    if (!byAction[key]) byAction[key] = [];
    byAction[key].push(t.contact_type);
  }

  res.json({
    configured: types,
    historical: historical.map(r => r.contact_type),
    byAction,   // { call: [...], mail: [...], email: [...], visit: [...] }
    // Flat list for simple dropdowns (call types only + historical)
    all: [...new Set([...types.filter(t=>(t.action_type||'call')==='call').map(t => t.contact_type), ...historical.map(r => r.contact_type)])].sort()
  });
});

// ── SHOP ADDRESS GEOCODE ─────────────────────────────────────────────────────
// When shop_address is updated, also update shop_lat/shop_lng
router.put('/settings/shop_address', (req, res) => {
  if (req.body.value === undefined) return res.status(400).json({ error: 'value is required.' });
  db.prepare("UPDATE config_settings SET value = ?, updated_at = datetime('now') WHERE key = 'shop_address'").run(String(req.body.value));
  // Lat/lng will be updated separately from frontend after geocoding
  res.json(db.prepare("SELECT * FROM config_settings WHERE key = 'shop_address'").get());
});

module.exports = router;
