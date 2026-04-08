/**
 * TEKMETRIC PROXY ROUTE — Rewritten 2026-04-03
 *
 * Architecture:
 *  - Single global RateLimiter capped at 300 req/min (configurable via Settings UI)
 *  - All data stored in Maps for O(1) lookup (customerMap, vehicleMap, roMap, employeeMap)
 *  - Shop floor: 30s server-side response cache, status 1–4 only, status-change detection
 *  - Fleet data: delta sync via updatedDateStart, 5-year initial limit
 *  - AR: separate endpoint, 1-hour cache, status 6 only, balance + aging buckets
 *  - Background scheduler: staggered offsets (+2 min fleet, +4 min AR, +6 min employees)
 *  - Call logger: circular buffer (5000) + per-minute rollup Map (120 min)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function baseUrl(env) {
  return env === 'sandbox'
    ? 'https://sandbox.tekmetric.com/api/v1'
    : 'https://shop.tekmetric.com/api/v1';
}

// ── Call Logger ───────────────────────────────────────────────────────────────
const CALL_LOG_MAX = 5000;
const callLog = [];                // { ts, url, status, ms }
const callLogByMinute = new Map(); // "YYYY-MM-DDTHH:MM" → count

function logCall(url, status, ms) {
  const ts = Date.now();
  if (callLog.length >= CALL_LOG_MAX) callLog.shift();
  callLog.push({ ts, url, status, ms });

  const key = new Date(ts).toISOString().slice(0, 16);
  callLogByMinute.set(key, (callLogByMinute.get(key) || 0) + 1);

  // Keep only last 120 minutes
  const cutoff = new Date(ts - 120 * 60 * 1000).toISOString().slice(0, 16);
  for (const k of callLogByMinute.keys()) {
    if (k < cutoff) callLogByMinute.delete(k);
  }
}

// ── Global Rate Limiter ───────────────────────────────────────────────────────
// Rolling 60-second window. Default 300/min; updated live from DB setting.
let configuredRateLimit = 300;

class RateLimiter {
  constructor() { this.log = []; }

  async throttle() {
    if (syncAborted) throw new Error('Sync aborted — Tekmetric disconnected');
    const max = configuredRateLimit;
    const now = Date.now();
    this.log = this.log.filter(t => now - t < 60000);
    if (this.log.length >= max) {
      const wait = 60000 - (now - this.log[0]) + 50;
      console.warn(`[RateLimit] Cap reached (${this.log.length}/${max}) — waiting ${wait}ms`);
      await sleep(wait);
      return this.throttle();
    }
    const pct = Math.round((this.log.length / max) * 100);
    if (pct >= 80) console.warn(`[RateLimit] ⚠ ${this.log.length}/${max} req/min (${pct}%)`);
    this.log.push(Date.now());
  }

  usage() {
    const now = Date.now();
    this.log = this.log.filter(t => now - t < 60000);
    return {
      thisMinute: this.log.length,
      max: configuredRateLimit,
      pct: Math.round((this.log.length / configuredRateLimit) * 100),
    };
  }
}
const tekLimiter = new RateLimiter();

// ── Abort flag — set on disconnect, cleared on connect ───────────────────────
let syncAborted = false;

// ── tekFetch — rate-limited, logged, 429-retry ────────────────────────────────
async function tekFetch(url, token, attempt = 1) {
  if (syncAborted) throw new Error('Sync aborted — Tekmetric disconnected');
  await tekLimiter.throttle();
  if (syncAborted) throw new Error('Sync aborted — Tekmetric disconnected');
  const t0  = Date.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const ms  = Date.now() - t0;
  logCall(url, res.status, ms);

  if (res.status === 429) {
    const MAX_ATTEMPTS = 8;
    if (attempt >= MAX_ATTEMPTS) throw new Error(`429 after ${MAX_ATTEMPTS} attempts: ${url}`);
    const jitter = Math.floor(Math.random() * 1000);
    const wait   = Math.min(Math.pow(2, attempt) * 1000, 60000) + jitter;
    console.warn(`[Tekmetric] 429 — waiting ${wait}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
    await sleep(wait);
    return tekFetch(url, token, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tekmetric ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// ── fetchAllPages — paginate any Tekmetric list endpoint ──────────────────────
async function fetchAllPages(endpoint, token, params = {}) {
  const results = [];
  let page = 0, totalPages = 1;
  while (page < totalPages) {
    const url = new URL(endpoint);
    Object.entries({ ...params, size: 100, page }).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach(item => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    });
    const data = await tekFetch(url.toString(), token);
    results.push(...(data.content || []));
    totalPages = data.totalPages || 1;
    page++;
    if (page < totalPages) await sleep(100);
  }
  return results;
}

// ── Config cache (60s TTL) ────────────────────────────────────────────────────
let configCache   = null;
let configCacheAt = 0;
const CONFIG_TTL  = 60000;

async function getTekConfig() {
  if (configCache && Date.now() - configCacheAt < CONFIG_TTL) return configCache;
  const keys = ['tekmetric_token', 'tekmetric_shop_id', 'tekmetric_env', 'tekmetric_api_rate_limit'];
  const { rows } = await pool.query('SELECT key, value FROM config_settings WHERE key = ANY($1)', [keys]);
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

  const rl = parseInt(map['tekmetric_api_rate_limit'] || '300');
  if (rl >= 1 && rl <= 600) configuredRateLimit = rl;

  configCache = {
    token:     map['tekmetric_token']   || null,
    shopId:    map['tekmetric_shop_id'] || null,
    env:       map['tekmetric_env']     || 'production',
    rateLimit: configuredRateLimit,
  };
  configCacheAt = Date.now();
  return configCache;
}

function invalidateConfigCache() { configCache = null; configCacheAt = 0; }

// ── In-memory data cache (Maps for O(1) lookup) ───────────────────────────────
const tekCache = {
  customerMap:      new Map(), // id → normalized customer
  vehicleMap:       new Map(), // id → normalized vehicle
  roMap:            new Map(), // id → normalized RO (all non-deleted)
  employeeMap:      new Map(), // id → normalized employee
  arRos:            [],        // normalized AR ROs (status 6)
  lastCustomerSync: null,
  lastVehicleSync:  null,
  lastRoSync:       null,
  lastEmployeeSync: null,
  lastArSync:       null,
};

let syncInProgress = false;

// ── DB load gate — resolves once loadCacheFromDB() finishes on startup ────────
// Routes that need cache data await this before responding.
let _dbLoadResolve;
const dbReady = new Promise(res => { _dbLoadResolve = res; });

// ── Response caches ───────────────────────────────────────────────────────────
let shopFloorCache   = null;
let shopFloorCacheAt = 0;
const SHOP_FLOOR_TTL = 60000;      // 60 seconds — all users share this result

let arCache   = null;
let arCacheAt = 0;
const AR_TTL  = 60 * 60 * 1000;   // 1 hour

// ── Status change tracking ────────────────────────────────────────────────────
let prevShopFloorStatuses = new Map(); // roId → statusId

// ── Status color palette (cycles for unlimited custom statuses) ───────────────
const STATUS_COLORS = ['#6366f1','#d97706','#16a34a','#7c3aed','#1d4ed8','#dc2626','#0891b2','#059669','#7c2d12'];
const STATUS_BGS    = ['#eef2ff','#fffbeb','#f0fdf4','#faf5ff','#eff6ff','#fef2f2','#ecfeff','#d1fae5','#fff7ed'];

function buildStatuses(ros) {
  const seen = new Map();
  ros.forEach(ro => {
    if (ro.sid && !seen.has(ro.sid))
      seen.set(ro.sid, { id: ro.sid, name: ro.statusName, code: ro.statusCode });
  });
  return Array.from(seen.values()).map((s, i) => ({
    ...s,
    color: STATUS_COLORS[i % STATUS_COLORS.length],
    bg:    STATUS_BGS[i % STATUS_BGS.length],
  }));
}

// ── Normalizers ───────────────────────────────────────────────────────────────
function normCustomer(c) {
  return {
    id:      c.id,
    name:    [c.firstName, c.lastName].filter(Boolean).join(' ') || `Customer ${c.id}`,
    contact: c.contactFirstName
      ? [c.contactFirstName, c.contactLastName].filter(Boolean).join(' ')
      : null,
    phone: c.phone?.[0]?.number || null,
    email: Array.isArray(c.email) ? c.email[0] : c.email || null,
  };
}

function normVehicle(v) {
  return {
    id: v.id, cid: v.customerId,
    year: v.year, make: v.make, model: v.model,
    plate: v.licensePlate, vin: v.vin, color: v.color,
  };
}

function normRo(ro) {
  return {
    id:         ro.id,
    rn:         ro.repairOrderNumber,
    cid:        ro.customerId,
    vid:        ro.vehicleId,
    sid:        ro.repairOrderStatus?.id,
    statusName: ro.repairOrderStatus?.name,
    statusCode: ro.repairOrderStatus?.code,
    techId:     ro.technicianId,
    saId:       ro.serviceWriterId,
    labor:      ro.laborSales    || 0,
    parts:      ro.partsSales    || 0,
    sublets:    ro.subletSales   || 0,
    tires:      ro.tireSales     || 0,
    batteries:  ro.batterySales  || 0,
    tax:        ro.taxTotal      || 0,
    fees:       ro.feesTotal     || ro.fees || 0,
    disc:       ro.discountTotal || 0,
    total:      ro.totalSales    || 0,
    paid:       ro.amountPaid    || 0,
    created:     ro.createdDate,
    updated:     ro.updatedDate,
    promiseTime: ro.customerTimeOut || null,
    milesIn:     ro.milesIn        || null,
    jobs: (ro.jobs || []).map(j => ({
      name:  j.name,
      auth:  j.authorized,
      labor: j.laborTotal  || 0,
      parts: j.partsTotal  || 0,
      hours: j.laborHours  || 0,
    })),
  };
}

function normEmployee(e) {
  return {
    id:   e.id,
    name: [e.firstName, e.lastName].filter(Boolean).join(' '),
    role: e.employeeRole?.name || 'Employee',
  };
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

async function syncEmployees(token, base, shopId) {
  console.log('[Tekmetric] Syncing employees…');
  const rows = await fetchAllPages(`${base}/employees`, token, { shop: shopId });
  const normalized = rows.map(e => normEmployee(e));
  normalized.forEach(e => tekCache.employeeMap.set(e.id, e));
  tekCache.lastEmployeeSync = new Date().toISOString();
  await persistRows('tekmetric_employees', normalized);
  await persistSyncState({ lastEmployeeSync: tekCache.lastEmployeeSync });
  console.log(`[Tekmetric] Employees cached: ${tekCache.employeeMap.size}`);
}

async function syncCustomers(token, base, shopId) {
  const since  = tekCache.lastCustomerSync;
  const params = { shop: shopId, customerTypeId: 2 };
  if (since) params.updatedDateStart = since;
  console.log(`[Tekmetric] Syncing customers (${since ? 'delta' : 'full'})…`);
  const rows = await fetchAllPages(`${base}/customers`, token, params);
  const normalized = rows.map(c => normCustomer(c));
  normalized.forEach(c => tekCache.customerMap.set(c.id, c));
  tekCache.lastCustomerSync = new Date().toISOString();
  await persistRows('tekmetric_customers', normalized);
  await persistSyncState({ lastCustomerSync: tekCache.lastCustomerSync });
  console.log(`[Tekmetric] Customers cached: ${tekCache.customerMap.size} (+${rows.length} updated)`);
}

async function syncVehicles(token, base, shopId) {
  const since  = tekCache.lastVehicleSync;
  const params = { shop: shopId };
  if (since) params.updatedDateStart = since;
  console.log(`[Tekmetric] Syncing vehicles (${since ? 'delta' : 'full'})…`);
  const rows = await fetchAllPages(`${base}/vehicles`, token, params);
  const toUpsert = [], toDelete = [];
  rows.forEach(v => {
    if (v.deletedDate) {
      tekCache.vehicleMap.delete(v.id);
      toDelete.push(v.id);
    } else if (tekCache.customerMap.has(v.customerId)) {
      const n = normVehicle(v);
      tekCache.vehicleMap.set(v.id, n);
      toUpsert.push(n);
    }
  });
  tekCache.lastVehicleSync = new Date().toISOString();
  await persistRows('tekmetric_vehicles', toUpsert);
  for (const id of toDelete) await deleteFromDB('tekmetric_vehicles', id);
  await persistSyncState({ lastVehicleSync: tekCache.lastVehicleSync });
  console.log(`[Tekmetric] Vehicles cached: ${tekCache.vehicleMap.size} (+${toUpsert.length} upserted, ${toDelete.length} deleted)`);
}

async function syncRos(token, base, shopId) {
  // 5-year initial limit to avoid pulling ancient history on first run
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const since  = tekCache.lastRoSync || fiveYearsAgo.toISOString();
  const params = { shop: shopId, updatedDateStart: since };
  console.log(`[Tekmetric] Syncing ROs (delta from ${since.slice(0, 10)})…`);
  const rows = await fetchAllPages(`${base}/repair-orders`, token, params);
  const normalized = rows
    .filter(ro => ro.repairOrderStatus?.id !== 7 && tekCache.customerMap.has(ro.customerId))
    .map(ro => normRo(ro));
  normalized.forEach(ro => tekCache.roMap.set(ro.id, ro));
  tekCache.lastRoSync = new Date().toISOString();
  await persistRows('tekmetric_ros', normalized);
  await persistSyncState({ lastRoSync: tekCache.lastRoSync });
  console.log(`[Tekmetric] ROs cached: ${tekCache.roMap.size} (+${normalized.length} updated)`);
}

async function syncAR(token, base, shopId) {
  console.log('[Tekmetric] Syncing AR (status 6)…');
  const params = { shop: shopId, repairOrderStatusId: 6 };
  if (tekCache.lastArSync) params.updatedDateStart = tekCache.lastArSync;
  const rows = await fetchAllPages(`${base}/repair-orders`, token, params);
  const now  = Date.now();
  const normalized = rows
    .filter(ro => tekCache.customerMap.has(ro.customerId))
    .map(ro => {
      const n = normRo(ro);
      return {
        ...n,
        balance:         n.total - n.paid,
        daysOutstanding: n.created ? Math.floor((now - new Date(n.created)) / 86400000) : null,
      };
    });
  const updatedIds = new Set(normalized.map(r => r.id));
  tekCache.arRos = [
    ...tekCache.arRos.filter(r => !updatedIds.has(r.id)),
    ...normalized,
  ];
  tekCache.lastArSync = new Date().toISOString();
  arCache = null; arCacheAt = 0;
  await persistRows('tekmetric_ar_ros', normalized);
  await persistSyncState({ lastArSync: tekCache.lastArSync });
  console.log(`[Tekmetric] AR ROs cached: ${tekCache.arRos.length}`);
}

// ── Background scheduler ──────────────────────────────────────────────────────
let bgTimers = [];

function stopBackgroundSync() {
  bgTimers.forEach(clearTimeout);
  bgTimers = [];
  console.log('[Tekmetric] Background sync stopped');
}

function scheduleRepeating(fn, delayMs, intervalMs) {
  const tick = async () => {
    try {
      const { token, shopId, env } = await getTekConfig();
      if (token && shopId) await fn(token, baseUrl(env), shopId);
    } catch (e) {
      console.error('[BgSync]', e.message);
    }
    bgTimers.push(setTimeout(tick, intervalMs));
  };
  bgTimers.push(setTimeout(tick, delayMs));
}

function startBackgroundSync() {
  stopBackgroundSync();

  // Fleet: customers + vehicles + ROs every 5 min, first fire at +2 min
  scheduleRepeating(async (token, base, shopId) => {
    await syncCustomers(token, base, shopId);
    await syncVehicles(token, base, shopId);
    await syncRos(token, base, shopId);
    shopFloorCache = null; shopFloorCacheAt = 0; // next shop-floor poll gets fresh data
  }, 2 * 60 * 1000, 5 * 60 * 1000);

  // AR: every 1 hour, first fire at +4 min
  scheduleRepeating(syncAR, 4 * 60 * 1000, 60 * 60 * 1000);

  // Employees: every 30 min, first fire at +6 min
  scheduleRepeating(syncEmployees, 6 * 60 * 1000, 30 * 60 * 1000);

  console.log('[Tekmetric] Background sync scheduled (fleet +2m/5m · AR +4m/1h · employees +6m/30m)');
}

// ── upsertSetting ─────────────────────────────────────────────────────────────
async function upsertSetting(key, value, label) {
  await pool.query(
    `INSERT INTO config_settings (key, value, label) VALUES ($1,$2,$3)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value, label]
  );
}

// ── DB persistence — Tekmetric cache survives server restarts ─────────────────

async function initTekDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tekmetric_customers (
      id BIGINT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tekmetric_vehicles (
      id BIGINT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tekmetric_ros (
      id BIGINT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tekmetric_ar_ros (
      id BIGINT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tekmetric_employees (
      id BIGINT PRIMARY KEY, data JSONB NOT NULL, synced_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tekmetric_sync_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
  `);
  console.log('[Tekmetric] DB tables ready');
}

async function loadCacheFromDB() {
  const [custs, vehs, ros, arRos, emps, state] = await Promise.all([
    pool.query('SELECT id, data FROM tekmetric_customers'),
    pool.query('SELECT id, data FROM tekmetric_vehicles'),
    pool.query('SELECT id, data FROM tekmetric_ros'),
    pool.query('SELECT id, data FROM tekmetric_ar_ros'),
    pool.query('SELECT id, data FROM tekmetric_employees'),
    pool.query('SELECT key, value FROM tekmetric_sync_state'),
  ]);
  custs.rows.forEach(r => tekCache.customerMap.set(Number(r.id), r.data));
  vehs.rows.forEach(r  => tekCache.vehicleMap.set(Number(r.id),  r.data));
  ros.rows.forEach(r   => tekCache.roMap.set(Number(r.id),       r.data));
  emps.rows.forEach(r  => tekCache.employeeMap.set(Number(r.id), r.data));
  const now = Date.now();
  tekCache.arRos = arRos.rows.map(r => ({
    ...r.data,
    balance:         (r.data.total || 0) - (r.data.paid || 0),
    daysOutstanding: r.data.created ? Math.floor((now - new Date(r.data.created)) / 86400000) : null,
  }));
  const stateMap = Object.fromEntries(state.rows.map(r => [r.key, r.value]));
  tekCache.lastCustomerSync = stateMap['lastCustomerSync'] || null;
  tekCache.lastVehicleSync  = stateMap['lastVehicleSync']  || null;
  tekCache.lastRoSync       = stateMap['lastRoSync']       || null;
  tekCache.lastEmployeeSync = stateMap['lastEmployeeSync'] || null;
  tekCache.lastArSync       = stateMap['lastArSync']       || null;
  console.log(`[Tekmetric] Loaded from DB: ${tekCache.customerMap.size} customers, ${tekCache.vehicleMap.size} vehicles, ${tekCache.roMap.size} ROs, ${tekCache.arRos.length} AR, ${tekCache.employeeMap.size} employees`);
}

// Batch upsert rows into a tekmetric_* table. Each item must have an .id field.
async function persistRows(table, rows) {
  if (!rows.length) return;
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const vals  = chunk.map((_, j) => `($${j * 2 + 1}, $${j * 2 + 2}::jsonb)`).join(',');
    const params = chunk.flatMap(r => [r.id, JSON.stringify(r)]);
    await pool.query(
      `INSERT INTO ${table} (id, data) VALUES ${vals}
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, synced_at = NOW()`,
      params
    );
  }
}

async function deleteFromDB(table, id) {
  await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

async function persistSyncState(updates) {
  for (const [key, value] of Object.entries(updates)) {
    await pool.query(
      `INSERT INTO tekmetric_sync_state (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /tekmetric/shop-floor ─────────────────────────────────────────────────
// Statuses 1–4 only. 30s server-side cache (all users share one result).
// Returns statusChanges[] so the frontend can fire toast notifications.
router.get('/shop-floor', async (req, res) => {
  try {
    await dbReady; // wait for DB cache load on startup before serving
    if (shopFloorCache && Date.now() - shopFloorCacheAt < SHOP_FLOOR_TTL) {
      return res.json({ ...shopFloorCache, fromCache: true });
    }

    const { token, shopId, env } = await getTekConfig();
    if (!token)   return res.status(400).json({ error: 'Tekmetric not configured — no token. Go to Active Fleet → Settings and click Connect.' });
    if (!shopId)  return res.status(400).json({ error: 'Tekmetric not configured — Shop ID missing. Go to Active Fleet → Settings, enter your Shop ID, and click Save.' });
    const base = baseUrl(env);

    // Fetch ROs updated in the last 90 days — no status filter so all custom
    // statuses (Waiting on Customer, etc.) come through. Filter out Paid (5),
    // AR (6), Deleted (7) server-side after fetching.
    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const rawRos = await fetchAllPages(`${base}/repair-orders`, token, {
      shop: shopId,
      updatedDateStart: since90,
    });
    // Exclude Paid (5), AR (6), Deleted (7) — keep all other statuses including custom ones
    // Only keep ROs belonging to business customers
    const ros = rawRos.map(normRo).filter(ro =>
      ![5, 6, 7].includes(ro.sid) && tekCache.customerMap.has(ro.cid)
    );

    // ── Status change detection ───────────────────────────────────────────────
    const statusChanges = [];
    const currentIds = new Set(ros.map(r => r.id));

    for (const ro of ros) {
      const prev = prevShopFloorStatuses.get(ro.id);
      if (prev === undefined) {
        statusChanges.push({ type: 'new', ro });
      } else if (prev !== ro.sid) {
        statusChanges.push({ type: 'changed', ro, prevSid: prev });
      }
    }
    for (const [roId] of prevShopFloorStatuses) {
      if (!currentIds.has(roId)) statusChanges.push({ type: 'removed', roId });
    }
    prevShopFloorStatuses = new Map(ros.map(r => [r.id, r.sid]));

    const companies = [...new Set(ros.map(r => r.cid))].map(id => tekCache.customerMap.get(id)).filter(Boolean);
    const vehicles  = [...new Set(ros.map(r => r.vid))].map(id => tekCache.vehicleMap.get(id)).filter(Boolean);
    const employees = Array.from(tekCache.employeeMap.values());
    const statuses  = buildStatuses(ros);

    shopFloorCache   = { ros, statuses, companies, vehicles, employees, statusChanges, syncedAt: new Date().toISOString() };
    shopFloorCacheAt = Date.now();
    res.json(shopFloorCache);

  } catch (err) {
    console.error('[Tekmetric] /shop-floor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tekmetric/fleet-data ─────────────────────────────────────────────────
// Returns full Maps contents (businesses, vehicles, ROs, employees).
// Blocks on first load; returns current cache + fires background delta on subsequent calls.
router.get('/fleet-data', async (req, res) => {
  try {
    await dbReady; // wait for DB cache load on startup before serving
    const { token, shopId, env } = await getTekConfig();
    if (!token)  return res.status(400).json({ error: 'Tekmetric not configured — no token. Go to Active Fleet → Settings and click Connect.' });
    if (!shopId) return res.status(400).json({ error: 'Tekmetric not configured — Shop ID missing. Go to Active Fleet → Settings, enter your Shop ID, and click Save.' });
    const base         = baseUrl(env);
    const forceRefresh = req.query.full === '1';
    const cacheEmpty   = tekCache.customerMap.size === 0;

    if ((cacheEmpty || forceRefresh) && !syncInProgress) {
      // cacheEmpty = first ever run; forceRefresh = user clicked Sync Now
      // Both kick off a delta sync in background and return current cache immediately.
      syncInProgress = true;
      setImmediate(async () => {
        try {
          await syncCustomers(token, base, shopId);
          await syncVehicles(token, base, shopId);
          await syncRos(token, base, shopId);
          await syncEmployees(token, base, shopId);
          shopFloorCache = null; shopFloorCacheAt = 0;
        } catch (e) { console.error('[InitialSync]', e.message); }
        finally { syncInProgress = false; }
      });
    }
    // Returns current cache immediately — frontend gets data right away,
    // updated data appears on the next poll after the background sync finishes.

    const companies = Array.from(tekCache.customerMap.values());
    const vehicles  = Array.from(tekCache.vehicleMap.values());
    // Exclude AR (6) and Deleted (7) from fleet-data — AR has its own tab
    const ros       = Array.from(tekCache.roMap.values()).filter(r => r.sid !== 6 && r.sid !== 7);
    const employees = Array.from(tekCache.employeeMap.values());
    const statuses  = buildStatuses(ros);

    res.json({
      statuses, companies, vehicles, ros, employees,
      syncedAt: new Date().toISOString(),
      syncedStats: {
        syncType:         cacheEmpty || forceRefresh ? 'full' : 'returning-cache',
        customers:        companies.length,
        ros:              ros.length,
        vehicles:         vehicles.length,
        employees:        employees.length,
        statuses:         statuses.length,
        lastCustomerSync: tekCache.lastCustomerSync,
        lastRoSync:       tekCache.lastRoSync,
        rateLimiter:      tekLimiter.usage(),
      },
    });
  } catch (err) {
    console.error('[Tekmetric] /fleet-data error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tekmetric/ar ─────────────────────────────────────────────────────────
// Accounts Receivable — status 6 only, 1-hour server-side cache.
// Add ?refresh=1 to force an immediate re-sync.
router.get('/ar', async (req, res) => {
  try {
    await dbReady; // wait for DB cache load on startup before serving
    const forceRefresh = req.query.refresh === '1';
    if (arCache && !forceRefresh && Date.now() - arCacheAt < AR_TTL) {
      return res.json({ ...arCache, fromCache: true });
    }

    const { token, shopId, env } = await getTekConfig();
    if (!token || !shopId) return res.status(400).json({ error: 'Tekmetric not configured.' });
    const base = baseUrl(env);

    await syncAR(token, base, shopId);

    // Group by customer with totals + aging buckets
    const byCustomer = new Map();
    for (const ro of tekCache.arRos) {
      if (!byCustomer.has(ro.cid)) {
        byCustomer.set(ro.cid, {
          customer:     tekCache.customerMap.get(ro.cid) || { id: ro.cid, name: `Customer ${ro.cid}` },
          ros:          [],
          totalBalance: 0,
          oldestDays:   0,
        });
      }
      const entry = byCustomer.get(ro.cid);
      entry.ros.push(ro);
      entry.totalBalance += ro.balance || 0;
      if ((ro.daysOutstanding || 0) > entry.oldestDays) entry.oldestDays = ro.daysOutstanding;
    }

    const summary = Array.from(byCustomer.values())
      .map(s => ({
        ...s,
        flag: s.oldestDays > 90 ? '90+' : s.oldestDays > 60 ? '60+' : s.oldestDays > 30 ? '30+' : 'current',
      }))
      .sort((a, b) => b.totalBalance - a.totalBalance);

    const companies = [...new Set(tekCache.arRos.map(r => r.cid))]
      .map(id => tekCache.customerMap.get(id)).filter(Boolean);

    arCache   = { ros: tekCache.arRos, companies, summary, syncedAt: new Date().toISOString() };
    arCacheAt = Date.now();
    res.json(arCache);

  } catch (err) {
    console.error('[Tekmetric] /ar error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tekmetric/call-log ───────────────────────────────────────────────────
router.get('/call-log', async (req, res) => {
  try {
    const todayPrefix = new Date().toISOString().slice(0, 10);
    let todayTotal = 0;
    const perMinute = [];
    for (const [minute, count] of callLogByMinute.entries()) {
      if (minute.startsWith(todayPrefix)) todayTotal += count;
      perMinute.push({ minute, count });
    }
    perMinute.sort((a, b) => a.minute.localeCompare(b.minute));

    res.json({
      perMinute,
      recent:      callLog.slice(-100).reverse(),
      todayTotal,
      rateLimiter: tekLimiter.usage(),
      cap:         configuredRateLimit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tekmetric/notification-settings ─────────────────────────────────────
router.get('/notification-settings', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM config_settings WHERE key = 'tekmetric_notification_settings'"
    );
    const raw = rows[0]?.value;
    res.json(raw ? JSON.parse(raw) : {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /tekmetric/notification-settings ────────────────────────────────────
router.post('/notification-settings', async (req, res) => {
  try {
    await upsertSetting(
      'tekmetric_notification_settings',
      JSON.stringify(req.body),
      'Tekmetric Notification Settings'
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /tekmetric/settings ───────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const cfg  = await getTekConfig();
    const keys = [
      'tekmetric_poll_interval', 'tekmetric_oil_interval',
      'carfax_api_key', 'carfax_enabled',
      'biz_hours_start', 'biz_hours_end',
      'floor_poll_seconds', 'tekmetric_api_rate_limit',
    ];
    const { rows } = await pool.query('SELECT key, value FROM config_settings WHERE key = ANY($1)', [keys]);
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    res.json({
      connected:        !!cfg.token,
      shopId:           cfg.shopId,
      env:              cfg.env,
      pollInterval:     parseInt(map['tekmetric_poll_interval'] || '5'),
      oilInterval:      parseInt(map['tekmetric_oil_interval']  || '90'),
      carfaxKey:        map['carfax_api_key']  || '',
      carfaxEnabled:    (map['carfax_enabled'] || '0') === '1',
      bizHoursStart:    parseInt(map['biz_hours_start']     || '7'),
      bizHoursEnd:      parseInt(map['biz_hours_end']       || '19'),
      floorPollSeconds: parseInt(map['floor_poll_seconds']  || '30'),
      apiRateLimit:     parseInt(map['tekmetric_api_rate_limit'] || '300'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /tekmetric/settings ──────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  try {
    const {
      token, shopId, env, pollInterval, oilInterval,
      carfaxKey, carfaxEnabled, apiRateLimit,
    } = req.body;

    if (token         != null) await upsertSetting('tekmetric_token',         token,                      'Tekmetric API Token');
    if (shopId        != null) await upsertSetting('tekmetric_shop_id',       shopId,                     'Tekmetric Shop ID');
    if (env           != null) await upsertSetting('tekmetric_env',           env,                        'Tekmetric Environment');
    if (pollInterval  != null) await upsertSetting('tekmetric_poll_interval', String(pollInterval),       'Tekmetric Poll Interval (minutes)');
    if (oilInterval   != null) await upsertSetting('tekmetric_oil_interval',  String(oilInterval),        'Tekmetric Oil Interval (days)');
    if (carfaxKey     != null) await upsertSetting('carfax_api_key',          carfaxKey || '',            'Carfax API Key');
    if (carfaxEnabled != null) await upsertSetting('carfax_enabled',          carfaxEnabled ? '1' : '0', 'Carfax Enabled');

    if (req.body.bizHoursStart    != null) await upsertSetting('biz_hours_start',    String(req.body.bizHoursStart),    'Business Hours Start');
    if (req.body.bizHoursEnd      != null) await upsertSetting('biz_hours_end',      String(req.body.bizHoursEnd),      'Business Hours End');
    if (req.body.floorPollSeconds != null) await upsertSetting('floor_poll_seconds', String(req.body.floorPollSeconds), 'Shop Floor Refresh (seconds)');

    if (apiRateLimit != null) {
      const rl = Math.min(600, Math.max(1, parseInt(apiRateLimit) || 300));
      await upsertSetting('tekmetric_api_rate_limit', String(rl), 'Tekmetric API Rate Limit (req/min)');
      configuredRateLimit = rl; // Apply immediately, no restart needed
    }

    invalidateConfigCache();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /tekmetric/connect ───────────────────────────────────────────────────
router.post('/connect', async (req, res) => {
  try {
    const { clientId, clientSecret, env } = req.body;
    if (!clientId || !clientSecret)
      return res.status(400).json({ error: 'Client ID and Client Secret are required.' });

    const hostname    = env === 'sandbox' ? 'sandbox.tekmetric.com' : 'shop.tekmetric.com';
    const credentials = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');

    const tokenData = await new Promise((resolve, reject) => {
      const https    = require('https');
      const postBody = 'grant_type=client_credentials';
      const options  = {
        hostname,
        path:   '/api/v1/oauth/token',
        method: 'POST',
        headers: {
          'Authorization':  `Basic ${credentials}`,
          'Content-Type':   'application/x-www-form-urlencoded;charset=UTF-8',
          'Content-Length': Buffer.byteLength(postBody),
        },
      };
      const t0 = Date.now();
      const request = https.request(options, response => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          logCall(`https://${hostname}/api/v1/oauth/token`, response.statusCode, Date.now() - t0);
          if (response.statusCode >= 400) {
            reject(new Error(`Tekmetric rejected credentials (${response.statusCode})`));
          } else {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error('Invalid response from Tekmetric')); }
          }
        });
      });
      request.on('error', reject);
      request.write(postBody);
      request.end();
    });

    const accessToken = tokenData.access_token;
if (!accessToken) {
  throw new Error('Tekmetric did not return an access token.');
}

// Do NOT trust scope alone. Prefer /shops.
let shopId = '';
const base2 = env === 'sandbox'
  ? 'https://sandbox.tekmetric.com/api/v1'
  : 'https://shop.tekmetric.com/api/v1';

try {
  const shopsData = await tekFetch(`${base2}/shops`, accessToken);
  console.log(`[Tekmetric /connect] GET /shops response received`);
  const shops = Array.isArray(shopsData) ? shopsData : (shopsData.content || []);

  if (!shops.length || !shops[0]?.id) {
    throw new Error('No shops were returned for this token.');
  }

  shopId = String(shops[0].id);
  console.log(`[Tekmetric /connect] Discovered shop ID from /shops: ${shopId}`);
} catch (e) {
  console.warn('[Tekmetric /connect] /shops error:', e.message);

  const scopeIds = String(tokenData.scope || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (scopeIds.length) {
    shopId = String(scopeIds[0]);
    console.log(`[Tekmetric /connect] Falling back to scope shop ID: ${shopId}`);
  }
}

if (!shopId) {
  console.warn('[Tekmetric /connect] No Shop ID found from /shops or token scope. User must enter it manually in Settings.');
}

    await pool.query(
      `INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      ['tekmetric_token', accessToken, 'Tekmetric API Token']
    );
    // Only overwrite shop_id if we found one — never wipe a manually-saved ID with blank
    if (shopId) {
      await pool.query(
        `INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
        ['tekmetric_shop_id', shopId, 'Tekmetric Shop ID']
      );
    }
    await pool.query(
      `INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
      ['tekmetric_env', env || 'production', 'Tekmetric Environment']
    );

    invalidateConfigCache();

    // Resume sync from where it left off — existing cache + timestamps are
    // preserved so the background sync does a fast delta (only what changed).
    shopFloorCache = null; shopFloorCacheAt = 0;
    arCache        = null; arCacheAt        = 0;
    syncInProgress = false;

    syncAborted = false;
    startBackgroundSync();

    res.json({
     ok: true,
     shopId,
     needsManualShopId: !shopId,
     message: shopId
      ? `Connected! Shop ID: ${shopId}`
      : 'Connected, but Shop ID could not be auto-detected. Enter it manually in Settings and click Save.',
   });
  } catch (err) {
    console.error('[Tekmetric /connect]', err.message);
    res.status(500).json({ error: 'Connection failed: ' + err.message });
  }
});

// ── POST /tekmetric/disconnect ────────────────────────────────────────────────
router.post('/disconnect', async (req, res) => {
  try {
    syncAborted = true;
    stopBackgroundSync();
    syncInProgress = false;

    // Preserve all cached data and sync timestamps so the UI stays populated
    // while disconnected. On reconnect, background sync picks up from the last
    // timestamp and only fetches what changed since then.
    await pool.query(
      `UPDATE config_settings SET value = '' WHERE key IN ('tekmetric_token', 'tekmetric_shop_id')`
    );

    invalidateConfigCache();
    
    res.json({ ok: true });
  } catch (err) {
    console.error('[Tekmetric /disconnect]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Startup: create tables, load cache from DB, resume background sync ────────
(async () => {
  try {
    await initTekDB();
    await loadCacheFromDB();
    _dbLoadResolve(); // ungate all routes — cache is ready
    const { token, shopId } = await getTekConfig();
    if (token && shopId) {
      console.log('[Tekmetric] Credentials found on startup — resuming background sync');
      syncAborted = false;
      startBackgroundSync();
    }
  } catch (e) {
    _dbLoadResolve(); // ungate even on error so routes don't hang forever
    console.error('[Tekmetric] Startup init failed:', e.message);
  }
})();

module.exports = router;
