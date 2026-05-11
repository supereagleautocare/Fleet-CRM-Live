/**
 * FLEET CRM — AUTH MIDDLEWARE
 * Verifies JWT and attaches req.db — a schema-scoped database interface
 * so every route only ever touches the current shop's data.
 */

const jwt = require('jsonwebtoken');
const { makeDb } = require('../db/tenant');

const JWT_SECRET = process.env.JWT_SECRET || 'fleet-crm-dev-secret-change-in-production';

function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;   // { id, name, email, role, schema }
    req.db   = makeDb(decoded.schema || 'public');
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
