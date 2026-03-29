/**
 * FLEET CRM — MAIN SERVER
 * Super Eagle Fleet CRM — Node.js + Express + SQLite
 *
 * Start:  node server.js
 * Dev:    npm run dev   (uses nodemon for auto-restart)
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

// ─── Initialize database (runs schema + seeds) ────────────────────────────────
require('./db/schema');

const app  = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ─── Request logger (development) ────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${req.path}`);
    }
    next();
  });
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/companies',  require('./routes/companies'));

app.use('/api/followups',  require('./routes/followups'));
app.use('/api/visits',     require('./routes/visits'));
app.use('/api/config',     require('./routes/config'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/quicklog',   require('./routes/quicklog'));
app.use('/api/scripts',    require('./routes/scripts'));
app.use('/api/scorecard',  require('./routes/scorecard'));
app.use('/api/pipeline',   require('./routes/pipeline'));
app.use('/api/tekmetric',  require('./routes/tekmetric'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Fleet CRM API', version: '1.0.0' });
});

// ─── Serve React frontend ─────────────────────────────────────────────────────
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));

// ─── API 404 handler ──────────────────────────────────────────────────────────
app.use('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found.' });
});

// ─── SPA fallback (React Router) ──────────────────────────────────────────────
app.get('*', (req, res) => {
  const index = path.join(PUBLIC, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.send(`
      <h2>🦅 Super Eagle Fleet CRM — Server is running!</h2>
      <p>Frontend not built yet. Open a second terminal and run:</p>
      <pre>cd fleet-crm-frontend\nnpm install\nnpm run build</pre>
      <p>Then refresh this page.</p>
    `);
  }
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     🦅 Super Eagle Fleet CRM             ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\n  ✅ Running at: http://localhost:${PORT}`);
  console.log(`  📋 API health: http://localhost:${PORT}/api/health`);
  if (!fs.existsSync(path.join(PUBLIC, 'index.html'))) {
    console.log('\n  ⚠️  Frontend not built yet!');
    console.log('  Run: cd ../fleet-crm-frontend && npm install && npm run build');
  }
  console.log('');
});
// ─── Background geocode job ───────────────────────────────────────────────────
const https = require('https');
const db    = require('./db/schema');

function geocodeMissing() {
  const companies = db.prepare(`
    SELECT id, address, city, state FROM companies
    WHERE status = 'active'
      AND address IS NOT NULL AND address != ''
      AND (lat IS NULL OR lng IS NULL)
  `).all();

  if (companies.length === 0) return;
  console.log(`[geocode] ${companies.length} companies missing coordinates — starting background job`);

  let i = 0;
  const interval = setInterval(() => {
    if (i >= companies.length) {
      clearInterval(interval);
      console.log('[geocode] all done');
      return;
    }
    const co = companies[i++];
    const cleanAddr = co.address.replace(/\s*(suite|ste\.?|unit|apt\.?|floor|fl\.?|#)\s*\S+/gi, '').trim();
        const q = encodeURIComponent(`${cleanAddr}, ${co.city || 'Charlotte'}, ${co.state || 'NC'}`);
    https.get(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=us`,
      { headers: { 'User-Agent': 'SuperEagleFleetCRM/1.0', 'Accept-Language': 'en' } },
      res => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            const results = JSON.parse(raw);
            if (results.length > 0) {
              db.prepare('UPDATE companies SET lat = ?, lng = ? WHERE id = ?')
                .run(parseFloat(results[0].lat), parseFloat(results[0].lon), co.id);
              console.log(`[geocode] ✓ ${co.id}`);
            }
          } catch(_) {}
        });
      }
    ).on('error', () => {});
  }, 1100);
}

setTimeout(geocodeMissing, 5000);
setInterval(geocodeMissing, 24*60*60*1000);// wait 5s for server to fully boot first
module.exports = app;
