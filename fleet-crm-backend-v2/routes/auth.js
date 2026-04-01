/**
 * FLEET CRM — AUTH ROUTES
 * POST /api/auth/login
 * POST /api/auth/change-password
 * GET  /api/auth/me
 */

const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET  = process.env.JWT_SECRET  || 'fleet-crm-dev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password.' });

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, created_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/change-password ───────────────────────────────────────────
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both current and new password are required.' });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!bcrypt.compareSync(current_password, user.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/users ──────────────────────────────────────────────────────
router.get('/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, role, permissions, created_at FROM users ORDER BY name'
    );
    res.json(rows.map(u => ({ ...u, permissions: JSON.parse(u.permissions || '{}') })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/users ─────────────────────────────────────────────────────
router.post('/users', requireAuth, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [name.trim(), email.toLowerCase().trim(), hash, role === 'admin' ? 'admin' : 'user']
    );

    res.status(201).json({ id: rows[0].id, name, email, role: role || 'user' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/auth/users/:id/permissions ──────────────────────────────────────
router.put('/users/:id/permissions', requireAuth, async (req, res) => {
  try {
    const { permissions } = req.body;
    await pool.query(
      'UPDATE users SET permissions = $1 WHERE id = $2',
      [JSON.stringify(permissions || {}), req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/auth/users/:id ───────────────────────────────────────────────
router.delete('/users/:id', requireAuth, async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: "Can't delete yourself." });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required.' });
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (!rows[0]) {
      return res.json({ message: 'If that email exists in our system you will receive a reset link shortly.' });
    }
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const perms = typeof rows[0].permissions === 'string' ? JSON.parse(rows[0].permissions || '{}') : (rows[0].permissions || {});
    perms.reset_token = token;
    perms.reset_expires = expires;
    await pool.query('UPDATE users SET permissions = $1 WHERE id = $2', [JSON.stringify(perms), rows[0].id]);
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    const { Resend } = require('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: 'nathan@supereagleautocare.com',
      subject: 'Reset your Fleet CRM password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f8fafc;border-radius:12px">
          <div style="text-align:center;margin-bottom:24px">
            <div style="font-size:32px">🦅</div>
            <div style="font-size:18px;font-weight:800;color:#0f2040">Super Eagle Fleet CRM</div>
          </div>
          <div style="background:white;border-radius:10px;padding:24px;border:1px solid #e2e8f0">
            <p style="font-size:15px;color:#334155;margin:0 0 16px">Hi ${rows[0].name},</p>
            <p style="font-size:14px;color:#64748b;margin:0 0 24px;line-height:1.6">
              Someone requested a password reset for your Fleet CRM account. Click the button below to set a new password. This link expires in <strong>2 hours</strong>.
            </p>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${resetUrl}" style="display:inline-block;background:#f59e0b;color:#0f2040;font-weight:800;font-size:15px;padding:12px 32px;border-radius:8px;text-decoration:none">
                Reset My Password →
              </a>
            </div>
            <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6">
              If you didn't request this, ignore this email — your password won't change.<br/>
              Or copy this link: ${resetUrl}
            </p>
          </div>
        </div>
      `,
    });

    res.json({ message: 'If that email exists in our system you will receive a reset link shortly.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE permissions::jsonb->>'reset_token' = $1`, [token]
    );
    const user = rows[0];
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.' });
    const perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '{}') : (user.permissions || {});
    if (perms.reset_expires && new Date(perms.reset_expires) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired.' });
    }
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    delete perms.reset_token;
    delete perms.reset_expires;
    await pool.query(
      'UPDATE users SET password_hash = $1, permissions = $2 WHERE id = $3',
      [hash, JSON.stringify(perms), user.id]
    );
    res.json({ message: 'Password reset successfully. You can now log in.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
