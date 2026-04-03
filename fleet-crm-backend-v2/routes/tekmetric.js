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

// ── tekFetch — rate-limited, logged, 429-retry ────────────────────────────────
async function tekFetch(url, token, attempt = 1) {
  await tekLimiter.throttle();
  const t0  = Date.now();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const ms  = Date.now() - t0;
  logCall(url, res.status, ms);

  if (res.status === 429) {
    if (attempt >= 3) throw new Error(`429 after 3 attempts: ${url}`);
    const wait = Math.pow(2, attempt) * 1000;
    console.warn(`[Tekmetric] 429 — waiting ${wait}ms (attempt ${attempt})`);
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
    Object.entries({ ...params, size: 100, page }).forEach(([k, v]) => url.searchParams.set(k, v));
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
  lastRoSync:       null,
  lastEmployeeSync: null,
  lastArSync:       null,
};

// ── Response caches ───────────────────────────────────────────────────────────
let shopFloorCache   = null;
let shopFloorCacheAt = 0;
const SHOP_FLOOR_TTL = 30000;      // 30 seconds — all users share this result

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
      labor: j.laborTotal || 0,
      parts: j.partsTotal || 0,
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
  rows.forEach(e => tekCache.employeeMap.set(e.id, normEmployee(e)));
  tekCache.lastEmployeeSync = new Date().toISOString();
  console.log(`[Tekmetric] Employees cached: ${tekCache.employeeMap.size}`);
}

async function syncCustomers(token, base, shopId) {
  const since  = tekCache.lastCustomerSync;
  const params = { shop: shopId, customerTypeId: 2 };
  if (since) params.updatedDateStart = since;
  console.log(`[Tekmetric] Syncing customers (${since ? 'delta' : 'full'})…`);
  const rows = await fetchAllPages(`${base}/customers`, token, params);
  rows.forEach(c => tekCache.customerMap.set(c.id, normCustomer(c)));
  tekCache.lastCustomerSync = new Date().toISOString();
  console.log(`[Tekmetric] Customers cached: ${tekCache.customerMap.size} (+${rows.length} updated)`);
}

async function syncVehicles(token, base, shopId) {
  // Only fetch vehicles for customers that have none cached yet
  const covered = new Set(Array.from(tekCache.vehicleMap.values()).map(v => v.cid));
  const missing = Array.from(tekCache.customerMap.keys()).filter(id => !covered.has(id));
  if (missing.length === 0) return;
  console.log(`[Tekmetric] Fetching vehicles for ${missing.length} new customers…`);
  for (let i = 0; i < missing.length; i += 8) {
    await Promise.allSettled(missing.slice(i, i + 8).map(async cid => {
      const rows = await fetchAllPages(`${base}/vehicles`, token, { shop: shopId, customerId: cid });
      rows.forEach(v => tekCache.vehicleMap.set(v.id, normVehicle(v)));
    }));
    if (i + 8 < missing.length) await sleep(150);
  }
  console.log(`[Tekmetric] Vehicles cached: ${tekCache.vehicleMap.size}`);
}

async function syncRos(token, base, shopId) {
  // 5-year initial limit to avoid pulling ancient history on first run
  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const since  = tekCache.lastRoSync || fiveYearsAgo.toISOString();
  const params = { shop: shopId, updatedDateStart: since };
  console.log(`[Tekmetric] Syncing ROs (delta from ${since.slice(0, 10)})…`);
  const rows = await fetchAllPages(`${base}/repair-orders`, token, params);
  // Store all non-deleted ROs; AR (status 6) lives here too so fleet history is complete
  rows.filter(ro => ro.repairOrderStatus?.id !== 7).forEach(ro => tekCache.roMap.set(ro.id, normRo(ro)));
  tekCache.lastRoSync = new Date().toISOString();
  console.log(`[Tekmetric] ROs cached: ${tekCache.roMap.size} (+${rows.length} updated)`);
}

async function syncAR(token, base, shopId) {
  console.log('[Tekmetric] Syncing AR (status 6)…');
  const params = { shop: shopId, repairOrderStatusId: 6 };
  if (tekCache.lastArSync) params.updatedDateStart = tekCache.lastArSync;
  const rows = await fetchAllPages(`${base}/repair-orders`, token, params);
  const now  = Date.now();
  const normalized = rows.map(ro => {
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
  arCache = null; arCacheAt = 0; // bust AR response cache
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

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /tekmetric/shop-floor ─────────────────────────────────────────────────
// Statuses 1–4 only. 30s server-side cache (all users share one result).
// Returns statusChanges[] so the frontend can fire toast notifications.
router.get('/shop-floor', async (req, res) => {
  try {
    if (shopFloorCache && Date.now() - shopFloorCacheAt < SHOP_FLOOR_TTL) {
      return res.json({ ...shopFloorCache, fromCache: true });
    }

    const { token, shopId, env } = await getTekConfig();
    if (!token)   return res.status(400).json({ error: 'Tekmetric not configured — no token. Go to Active Fleet → Settings and click Connect.' });
    if (!shopId)  return res.status(400).json({ error: 'Tekmetric not configured — Shop ID missing. Go to Active Fleet → Settings, enter your Shop ID, and click Save.' });
    const base = baseUrl(env);

    // Active ROs only — no AR (6), no deleted (7)
    const rawRos = await fetchAllPages(`${base}/repair-orders`, token, {
      shop: shopId,
      repairOrderStatusId: '1,2,3,4',
    });
    const ros = rawRos.map(normRo);

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

    // ── Cache-first lookups — only hit Tekmetric for genuinely new IDs ────────
    const missingCids = [...new Set(ros.map(r => r.cid).filter(id => id && !tekCache.customerMap.has(id)))];
    const missingVids = [...new Set(ros.map(r => r.vid).filter(id => id && !tekCache.vehicleMap.has(id)))];

    if (missingCids.length > 0) {
      await Promise.allSettled(missingCids.map(async id => {
        const data = await tekFetch(`${base}/customers/${id}`, token).catch(() => null);
        if (data) tekCache.customerMap.set(data.id, normCustomer(data));
      }));
    }
    if (missingVids.length > 0) {
      await Promise.allSettled(missingVids.map(async id => {
        const data = await tekFetch(`${base}/vehicles/${id}`, token).catch(() => null);
        if (data) tekCache.vehicleMap.set(data.id, normVehicle(data));
      }));
    }
    if (tekCache.employeeMap.size === 0) {
      await syncEmployees(token, base, shopId).catch(() => {});
    }

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
    const { token, shopId, env } = await getTekConfig();
    if (!token)  return res.status(400).json({ error: 'Tekmetric not configured — no token. Go to Active Fleet → Settings and click Connect.' });
    if (!shopId) return res.status(400).json({ error: 'Tekmetric not configured — Shop ID missing. Go to Active Fleet → Settings, enter your Shop ID, and click Save.' });
    const base         = baseUrl(env);
    const forceRefresh = req.query.full === '1';
    const cacheEmpty   = tekCache.customerMap.size === 0;

    if (cacheEmpty || forceRefresh) {
      await syncCustomers(token, base, shopId);
      await syncVehicles(token, base, shopId);
      await syncRos(token, base, shopId);
      await syncEmployees(token, base, shopId);
    } else {
      // Serve stale immediately, refresh in the background
      setImmediate(async () => {
        try {
          await syncCustomers(token, base, shopId);
          await syncVehicles(token, base, shopId);
          await syncRos(token, base, shopId);
          shopFloorCache = null; shopFloorCacheAt = 0;
        } catch (e) { console.error('[BgSync delta]', e.message); }
      });
    }

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
    const forceRefresh = req.query.refresh === '1';
    if (arCache && !forceRefresh && Date.now() - arCacheAt < AR_TTL) {
      return res.json({ ...arCache, fromCache: true });
    }

    const { token, shopId, env } = await getTekConfig();
    if (!token || !shopId) return res.status(400).json({ error: 'Tekmetric not configured.' });
    const base = baseUrl(env);

    await syncAR(token, base, shopId);

    // Fetch any customers missing from cache
    const missingCids = [...new Set(
      tekCache.arRos.map(r => r.cid).filter(id => id && !tekCache.customerMap.has(id))
    )];
    if (missingCids.length > 0) {
      await Promise.allSettled(missingCids.map(async id => {
        const data = await tekFetch(`${base}/customers/${id}`, token).catch(() => null);
        if (data) tekCache.customerMap.set(data.id, normCustomer(data));
      }));
    }

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
      const request = https.request(options, response => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
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
  const shopsRes = await fetch(`${base2}/shops`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const shopsText = await shopsRes.text();
  console.log(`[Tekmetric /connect] GET /shops → ${shopsRes.status}: ${shopsText.slice(0, 300)}`);

  if (!shopsRes.ok) {
    throw new Error(`/shops failed (${shopsRes.status})`);
  }

  const shopsData = JSON.parse(shopsText);
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
  throw new Error('Connected to Tekmetric, but could not determine a Shop ID from /shops or token scope.');
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

    // Clear stale data and kick off background sync
    tekCache.customerMap.clear();
    tekCache.vehicleMap.clear();
    tekCache.roMap.clear();
    tekCache.employeeMap.clear();
    tekCache.arRos            = [];
    tekCache.lastCustomerSync = null;
    tekCache.lastRoSync       = null;
    tekCache.lastEmployeeSync = null;
    tekCache.lastArSync       = null;
    shopFloorCache = null; shopFloorCacheAt = 0;
    arCache        = null; arCacheAt        = 0;
    prevShopFloorStatuses.clear();

    startBackgroundSync();

    res.json({ ok: true, shopId, message: `Connected! Shop ID: ${shopId}` });
  } catch (err) {
    console.error('[Tekmetric /connect]', err.message);
    res.status(500).json({ error: 'Connection failed: ' + err.message });
  }
});

// ── POST /tekmetric/disconnect ────────────────────────────────────────────────
router.post('/disconnect', async (req, res) => {
  try {
    stopBackgroundSync();

    tekCache.customerMap.clear();
    tekCache.vehicleMap.clear();
    tekCache.roMap.clear();
    tekCache.employeeMap.clear();
    tekCache.arRos            = [];
    tekCache.lastCustomerSync = null;
    tekCache.lastRoSync       = null;
    tekCache.lastEmployeeSync = null;
    tekCache.lastArSync       = null;
    shopFloorCache = null; shopFloorCacheAt = 0;
    arCache        = null; arCacheAt        = 0;
    prevShopFloorStatuses.clear();

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

module.exports = router;
