/**
 * FLEET CRM — AUTH ROUTES
 * POST /api/auth/login
 * POST /api/auth/change-password
 * GET  /api/auth/me
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET  || 'fleet-crm-dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  res.json(user);
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Both current and new password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ message: 'Password changed successfully.' });
});

// ── GET /api/auth/users ──────────────────────────────────────────────────────
router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, permissions, created_at FROM users ORDER BY name').all();
  res.json(users.map(u => ({ ...u, permissions: JSON.parse(u.permissions || '{}') })));
});

// ── POST /api/auth/users ─────────────────────────────────────────────────────
router.post('/users', requireAuth, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
    return res.status(409).json({ error: 'A user with that email already exists.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), email.toLowerCase().trim(), hash, role === 'admin' ? 'admin' : 'user');

  res.status(201).json({ id: result.lastInsertRowid, name, email, role: role || 'user' });
});

// ── PUT /api/auth/users/:id/permissions ──────────────────────────────────────
router.put('/users/:id/permissions', requireAuth, (req, res) => {
  const { permissions } = req.body;
  db.prepare('UPDATE users SET permissions = ? WHERE id = ?')
    .run(JSON.stringify(permissions || {}), req.params.id);
  res.json({ ok: true });
});

// ── DELETE /api/auth/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', requireAuth, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: "Can't delete yourself." });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
