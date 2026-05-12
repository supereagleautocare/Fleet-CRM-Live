/**
 * FLEET CRM — MAIN SERVER
 * Super Eagle Fleet CRM — Node.js + Express + SQLite
 *
 * Start:  node server.js
 * Dev:    npm run dev   (uses nodemon for auto-restart)
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const rateLimit = require('express-rate-limit');

// ─── Initialize database (runs schema + seeds) ────────────────────────────────
const schema = require('./db/schema');
schema.initDb().then(() => {
  console.log('✅ Database initialized');
}).catch(err => {
  console.error('❌ Failed to initialize database:', err.message);
  process.exit(1);
});

const app  = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// ─── Stripe webhook (raw body — must be before express.json) ─────────────────
app.use('/api/webhooks/stripe', require('./routes/webhook'));

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300,                 // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
  skip: (req) => req.path === '/api/health', // never limit health checks
});
app.use('/api', limiter);

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
app.use('/api/platform',    require('./routes/platform'));
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/fleetfinder', require('./routes/fleetfinder'));
app.use('/api/companies',   require('./routes/companies'));

app.use('/api/followups',  require('./routes/followups'));
app.use('/api/visits',     require('./routes/visits'));
app.use('/api/config',     require('./routes/config'));
app.use('/api/dashboard',  require('./routes/dashboard'));
app.use('/api/quicklog',   require('./routes/quicklog'));
app.use('/api/scripts',    require('./routes/scripts'));
app.use('/api/scorecard',  require('./routes/scorecard'));
app.use('/api/pipeline',   require('./routes/pipeline'));
app.use('/api/companies',  require('./routes/companies'));
app.use('/api/customers',  require('./routes/customers'));  // ← this line is missing entirely
app.use('/api/followups',  require('./routes/followups'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Fleet CRM API', version: '1.0.0' });
});

// ─── Platform admin dashboard ─────────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
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
// ─── Background geocode job (runs for every tenant schema) ───────────────────
const https = require('https');
const { getAllSchemas, makeDb } = require('./db/tenant');

async function geocodeMissing() {
  let schemas;
  try { schemas = await getAllSchemas(); } catch(e) { return; }

  for (const schema of schemas) {
    const db = makeDb(schema);
    let companies = [];
    try {
      const result = await db.query(`
        SELECT id, address, city, state FROM companies
        WHERE status = 'active'
          AND address IS NOT NULL AND address != ''
          AND (lat IS NULL OR lng IS NULL)
      `);
      companies = result.rows;
    } catch(e) { continue; }

    if (companies.length === 0) continue;
    console.log(`[geocode:${schema}] ${companies.length} companies missing coordinates`);

    let i = 0;
    const interval = setInterval(() => {
      if (i >= companies.length) {
        clearInterval(interval);
        console.log(`[geocode:${schema}] done`);
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
                db.query('UPDATE companies SET lat = $1, lng = $2 WHERE id = $3',
                  [parseFloat(results[0].lat), parseFloat(results[0].lon), co.id]);
                console.log(`[geocode:${schema}] ✓ ${co.id}`);
              }
            } catch(_) {}
          });
        }
      ).on('error', () => {});
    }, 1100);
  }
}

setTimeout(geocodeMissing, 5000);
setInterval(geocodeMissing, 24*60*60*1000);

// ─── One-time backfill: create follow-up records for companies that have none ──
async function backfillFollowupDates() {
  let schemas;
  try { schemas = await getAllSchemas(); } catch(e) { return; }

  for (const schema of schemas) {
    const db = makeDb(schema);
    try {
      const { rowCount } = await db.query(`
        INSERT INTO follow_ups (source_type, entity_id, company_id_str, entity_name, phone, due_date, next_action)
        SELECT 'company', c.id, c.company_id, c.name, c.main_phone, LEFT(c.created_at, 10), 'Call'
        FROM companies c
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM follow_ups fu WHERE fu.source_type='company' AND fu.entity_id=c.id)
        ON CONFLICT (source_type, entity_id) DO NOTHING
      `);
      if (rowCount > 0) console.log(`[backfill:${schema}] created ${rowCount} follow-up records`);
    } catch (e) { console.error(`[backfill:${schema}] error:`, e.message); }
  }
}
setTimeout(backfillFollowupDates, 4000);
module.exports = app;
