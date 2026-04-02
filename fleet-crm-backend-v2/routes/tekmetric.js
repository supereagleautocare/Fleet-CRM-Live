/**
 * TEKMETRIC PROXY ROUTE — PostgreSQL version
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

// ── Config helpers ────────────────────────────────────────────────────────────
async function getTekConfig() {
  const { rows } = await pool.query(
    "SELECT key, value FROM config_settings WHERE key IN ('tekmetric_token','tekmetric_shop_id','tekmetric_env')"
  );
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    token:  map['tekmetric_token']  || null,
    shopId: map['tekmetric_shop_id'] || null,
    env:    map['tekmetric_env']    || 'production',
  };
}

function baseUrl(env) {
  return env === 'sandbox'
    ? 'https://sandbox.tekmetric.com/api/v1'
    : 'https://shop.tekmetric.com/api/v1';
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── Global rate limiter — hard cap at 500 req/min across ALL Tekmetric calls ─
class RateLimiter {
  constructor(maxPerMinute) {
    this.max = maxPerMinute;
    this.log = []; // timestamps of recent requests
  }
  async throttle() {
    const now = Date.now();
    this.log = this.log.filter(t => now - t < 60000);
    if (this.log.length >= this.max) {
      const wait = 60000 - (now - this.log[0]) + 50;
      console.warn(`[RateLimit] Cap reached — waiting ${wait}ms`);
      await sleep(wait);
      return this.throttle();
    }
    this.log.push(Date.now());
  }
}
const tekLimiter = new RateLimiter(500);

async function tekFetchWithRetry(url, token, attempt = 1) {
  await tekLimiter.throttle();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 429) {
    if (attempt >= 3) throw new Error(`Tekmetric rate limit hit after 3 attempts for ${url}`);
    const waitMs = Math.pow(2, attempt) * 1000;
    console.warn(`[Tekmetric] 429 — waiting ${waitMs}ms before retry ${attempt + 1}`);
    await sleep(waitMs);
    return tekFetchWithRetry(url, token, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tekmetric API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function upsertSetting(key, value, label) {
  await pool.query(
    `INSERT INTO config_settings (key, value, label) VALUES ($1,$2,$3)
     ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`,
    [key, value, label]
  );
}

// ── Save Tekmetric settings ───────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  try {
    const { token, shopId, env, pollInterval, oilInterval, carfaxKey, carfaxEnabled } = req.body;

    if (token        != null) await upsertSetting('tekmetric_token',         token,                       'Tekmetric API Token');
    if (shopId       != null) await upsertSetting('tekmetric_shop_id',       shopId,                      'Tekmetric Shop ID');
    if (env          != null) await upsertSetting('tekmetric_env',           env,                         'Tekmetric Environment');
    if (pollInterval != null) await upsertSetting('tekmetric_poll_interval', String(pollInterval),        'Tekmetric Poll Interval (minutes)');
    if (oilInterval  != null) await upsertSetting('tekmetric_oil_interval',  String(oilInterval),         'Tekmetric Oil Interval (days)');
    if (carfaxKey    != null) await upsertSetting('carfax_api_key',          carfaxKey || '',              'Carfax API Key');
    if (carfaxEnabled != null) await upsertSetting('carfax_enabled',         carfaxEnabled ? '1' : '0',   'Carfax Enabled');
    if (req.body.bizHoursStart    != null) await upsertSetting('biz_hours_start',    String(req.body.bizHoursStart),    'Business Hours Start (24h)');
    if (req.body.bizHoursEnd      != null) await upsertSetting('biz_hours_end',      String(req.body.bizHoursEnd),      'Business Hours End (24h)');
    if (req.body.floorPollSeconds != null) await upsertSetting('floor_poll_seconds', String(req.body.floorPollSeconds), 'Shop Floor Refresh (seconds)');

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get Tekmetric settings ────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  try {
    const cfg = await getTekConfig();
    const keys = ['tekmetric_poll_interval','tekmetric_oil_interval','carfax_api_key','carfax_enabled','biz_hours_start','biz_hours_end','floor_poll_seconds'];
    const { rows } = await pool.query(`SELECT key, value FROM config_settings WHERE key = ANY($1)`, [keys]);
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));

    res.json({
      connected:        !!cfg.token,
      shopId:           cfg.shopId,
      env:              cfg.env,
      pollInterval:     parseInt(map['tekmetric_poll_interval'] || '5'),
      oilInterval:      parseInt(map['tekmetric_oil_interval']  || '90'),
      carfaxKey:        map['carfax_api_key']   || '',
      carfaxEnabled:    (map['carfax_enabled']  || '0') === '1',
      bizHoursStart:    parseInt(map['biz_hours_start']    || '7'),
      bizHoursEnd:      parseInt(map['biz_hours_end']      || '19'),
      floorPollSeconds: parseInt(map['floor_poll_seconds'] || '60'),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Exchange Client ID + Secret for bearer token ──────────────────────────────
router.post('/connect', async (req, res) => {
  try {
    const { clientId, clientSecret, env } = req.body;
    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'Client ID and Client Secret are required.' });
    }

    const baseUrl = env === 'sandbox'
      ? 'https://sandbox.tekmetric.com'
      : 'https://shop.tekmetric.com';

    const credentials = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString('base64');

    const tokenData = await new Promise((resolve, reject) => {
      const https = require('https');
      const postBody = 'grant_type=client_credentials';
      const hostname = env === 'sandbox' ? 'sandbox.tekmetric.com' : 'shop.tekmetric.com';
      const options = {
        hostname,
        path: '/api/v1/oauth/token',
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Content-Length': Buffer.byteLength(postBody),
        },
      };
      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode >= 400) {
            reject(new Error(`Tekmetric rejected your credentials (${response.statusCode}). Double-check your Client ID and Client Secret.`));
          } else {
            try { resolve(JSON.parse(data)); }
            catch(e) { reject(new Error('Invalid response from Tekmetric')); }
          }
        });
      });
      request.on('error', reject);
      request.write(postBody);
      request.end();
    });
    const accessToken = tokenData.access_token;

    // scope comes back as space-separated shop IDs e.g. "1 2"
    const shopIds = (tokenData.scope || '').trim().split(' ').filter(Boolean);
    const shopId  = shopIds[0] || '';

    // Store the token and shop ID — the client secret is NEVER stored
    await pool.query(`INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, ['tekmetric_token',   accessToken,          'Tekmetric API Token']);
    await pool.query(`INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, ['tekmetric_shop_id', shopId,               'Tekmetric Shop ID']);
    await pool.query(`INSERT INTO config_settings (key,value,label) VALUES ($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, ['tekmetric_env',     env || 'production',  'Tekmetric Environment']);

    res.json({ ok: true, shopId, shopIds, message: `Connected! Shop ID: ${shopId}` });
  } catch (err) {
    console.error('[Tekmetric /connect]', err.message);
    res.status(500).json({ error: 'Connection failed: ' + err.message });
  }
});

// ── Main fleet-data endpoint ──────────────────────────────────────────────────
router.get('/fleet-data', async (req, res) => {
  try {
    const { token, shopId, env } = await getTekConfig();

    if (!token || !shopId) {
      return res.status(400).json({
        error: 'Tekmetric not configured. Go to Active Fleet → Settings and add your token.'
      });
    }

    const base = baseUrl(env);

    console.log('[Tekmetric] Fetching shop info...');
    const shopData = await tekFetchWithRetry(`${base}/shops/${shopId}`, token);

    console.log('[Tekmetric] Fetching business customers...');
    let customers = [], page = 0, totalPages = 1;
    while (page < totalPages) {
      const data = await tekFetchWithRetry(
        `${base}/repair-orders?shop=${shopId}&repairOrderStatusId=1,2,3,4,6&customerTypeId=2&size=100&page=${page}`,
        token
      );
      customers = [...customers, ...(data.content || [])];
      totalPages = data.totalPages || 1;
      page++;
      if (page < totalPages) await sleep(100);
    }
    console.log(`[Tekmetric] Found ${customers.length} business customers.`);

    async function batchFetch(items, fn, batchSize = 8) {
      const results = [], failures = [];
      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const settled = await Promise.allSettled(batch.map(fn));
        settled.forEach((r, idx) => {
          if (r.status === 'fulfilled') results.push(...r.value);
          else failures.push({ item: batch[idx], error: r.reason?.message });
        });
        if (i + batchSize < items.length) await sleep(150);
      }
      return { results, failures };
    }

    console.log('[Tekmetric] Fetching repair orders...');
    const roFetch = await batchFetch(customers, async c => {
      const d = await tekFetchWithRetry(`${base}/repair-orders?shop=${shopId}&customerId=${c.id}&size=100`, token);
      return d.content || [];
    });
    const allRos = roFetch.results;
    const roFailures = roFetch.failures.length;
    if (roFailures) console.warn(`[Tekmetric] ${roFailures} RO fetch failures`);

    console.log('[Tekmetric] Fetching vehicles...');
    const vFetch = await batchFetch(customers, async c => {
      const d = await tekFetchWithRetry(`${base}/vehicles?shop=${shopId}&customerId=${c.id}&size=100`, token);
      return d.content || [];
    });
    const allVehicles = vFetch.results;
    const vehicleFailures = vFetch.failures.length;
    if (vehicleFailures) console.warn(`[Tekmetric] ${vehicleFailures} vehicle fetch failures`);

    console.log('[Tekmetric] Fetching employees...');
    const empData = await tekFetchWithRetry(`${base}/employees?shop=${shopId}&size=100`, token);
    const employees = empData.content || [];

    const statusMap = {};
    allRos.forEach(ro => {
      if (ro.repairOrderStatus) {
        const s = ro.repairOrderStatus;
        if (!statusMap[s.id]) statusMap[s.id] = { id: s.id, name: s.name, code: s.code };
      }
    });
    const STATUS_COLORS = ['#6366f1','#d97706','#16a34a','#7c3aed','#1d4ed8','#dc2626','#0891b2','#059669','#7c2d12'];
    const STATUS_BGS    = ['#eef2ff','#fffbeb','#f0fdf4','#faf5ff','#eff6ff','#fef2f2','#ecfeff','#d1fae5','#fff7ed'];
    const statuses = Object.values(statusMap).map((s, i) => ({
      ...s,
      color: STATUS_COLORS[i % STATUS_COLORS.length],
      bg:    STATUS_BGS[i % STATUS_BGS.length],
    }));

    const normalizedCompanies = customers.map(c => ({
      id:      c.id,
      name:    c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName || c.lastName || `Customer ${c.id}`,
      contact: c.contactFirstName ? `${c.contactFirstName} ${c.contactLastName || ''}`.trim() : null,
      phone:   c.phone?.[0]?.number || null,
      email:   Array.isArray(c.email) ? c.email[0] : c.email || null,
    }));

    const normalizedVehicles = allVehicles.map(v => ({
      id: v.id, cid: v.customerId, year: v.year, make: v.make, model: v.model,
      plate: v.licensePlate, vin: v.vin, color: v.color, oilElsewhere: false, sold: false,
    }));

    const normalizedRos = allRos.map(ro => ({
      id: ro.id, rn: ro.repairOrderNumber, cid: ro.customerId, vid: ro.vehicleId,
      sid: ro.repairOrderStatus?.id, techId: ro.technicianId, saId: ro.serviceWriterId,
      labor: ro.laborSales||0, parts: ro.partsSales||0, disc: ro.discountTotal||0,
      total: ro.totalSales||0, paid: ro.amountPaid||0,
      created: ro.createdDate, updated: ro.updatedDate,
      lastContact: null, contactMethod: null,
      jobs: (ro.jobs||[]).map(j => ({ name:j.name, auth:j.authorized, labor:j.laborTotal||0, parts:j.partsTotal||0 })),
    }));

    const normalizedEmployees = employees.map(e => ({
      id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), role: e.employeeRole?.name || 'Employee',
    }));

    console.log(`[Tekmetric] Sync complete. ${customers.length} businesses, ${allRos.length} ROs, ${allVehicles.length} vehicles.`);

    res.json({
      statuses, companies: normalizedCompanies, vehicles: normalizedVehicles,
      ros: normalizedRos, employees: normalizedEmployees, syncedAt: new Date().toISOString(),
      syncedStats: {
        customers: customers.length, ros: allRos.length, vehicles: allVehicles.length,
        employees: employees.length, statuses: statuses.length,
        roFailures, vehicleFailures,
        apiCallsUsed: 1 + page + customers.length * 2 + 1,
      },
    });
  } catch (err) {
    console.error('[Tekmetric] Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Lightweight shop floor poll — active ROs only ─────────────────────────────
router.get('/shop-floor', async (req, res) => {
  try {
    const { token, shopId, env } = await getTekConfig();
    if (!token || !shopId) return res.status(400).json({ error: 'Tekmetric not configured.' });

    const base = baseUrl(env);

    // Single paginated call — only active statuses, skip Posted(5) and Deleted(7)
    let allRos = [], page = 0, totalPages = 1;
    while (page < totalPages) {
      const data = await tekFetchWithRetry(
        `${base}/repair-orders?shop=${shopId}&repairOrderStatusId=1,2,3,4,6&size=100&page=${page}`,
        token
      );
      allRos = [...allRos, ...(data.content || [])];
      totalPages = data.totalPages || 1;
      page++;
      if (page < totalPages) await sleep(200);
    }

    const ros = allRos.map(ro => ({
      id:    ro.id,
      rn:    ro.repairOrderNumber,
      cid:   ro.customerId,
      vid:   ro.vehicleId,
      sid:   ro.repairOrderStatus?.id,
      techId: ro.technicianId,
      saId:  ro.serviceWriterId,
      labor: ro.laborSales  || 0,
      parts: ro.partsSales  || 0,
      total: ro.totalSales  || 0,
      paid:  ro.amountPaid  || 0,
      created:     ro.createdDate,
      updated:     ro.updatedDate,
      promiseTime: ro.customerTimeOut || null,
      milesIn:     ro.milesIn        || null,
      lastContact:   null,
      contactMethod: null,
      jobs: (ro.jobs || []).map(j => ({
        name:  j.name,
        auth:  j.authorized,
        labor: j.laborTotal || 0,
        parts: j.partsTotal || 0,
      })),
      // embed status info directly so frontend doesn't need a separate sync
      status: ro.repairOrderStatus ? {
        id:   ro.repairOrderStatus.id,
        name: ro.repairOrderStatus.name,
        code: ro.repairOrderStatus.code,
      } : null,
    }));

    // ── Fetch companies, vehicles, employees for just these active ROs ────────
    const customerIds = [...new Set(allRos.map(r => r.customerId).filter(Boolean))];
    const vehicleIds  = [...new Set(allRos.map(r => r.vehicleId).filter(Boolean))];
    const techIds     = [...new Set([
      ...allRos.map(r => r.technicianId),
      ...allRos.map(r => r.serviceWriterId),
    ].filter(Boolean))];

    async function fetchMany(ids, urlFn) {
      const results = [];
      for (let i = 0; i < ids.length; i += 8) {
        const batch = ids.slice(i, i + 8);
        const settled = await Promise.allSettled(batch.map(id =>
          tekFetchWithRetry(urlFn(id), token).catch(() => null)
        ));
        settled.forEach(r => { if (r.status === 'fulfilled' && r.value) results.push(r.value); });
        if (i + 8 < ids.length) await sleep(100);
      }
      return results;
    }

    const [rawCustomers, rawVehicles, empData] = await Promise.all([
      fetchMany(customerIds, id => `${base}/customers/${id}`),
      fetchMany(vehicleIds,  id => `${base}/vehicles/${id}`),
      tekFetchWithRetry(`${base}/employees?shop=${shopId}&size=100`, token).catch(() => ({ content: [] })),
    ]);

    const STATUS_COLORS = ['#6366f1','#d97706','#16a34a','#7c3aed','#1d4ed8','#dc2626','#0891b2','#059669','#7c2d12'];
    const STATUS_BGS    = ['#eef2ff','#fffbeb','#f0fdf4','#faf5ff','#eff6ff','#fef2f2','#ecfeff','#d1fae5','#fff7ed'];
    const statusMap = {};
    allRos.forEach(ro => {
      if (ro.repairOrderStatus && !statusMap[ro.repairOrderStatus.id]) {
        statusMap[ro.repairOrderStatus.id] = ro.repairOrderStatus;
      }
    });
    const statuses = Object.values(statusMap).map((s, i) => ({
      id: s.id, name: s.name, code: s.code,
      color: STATUS_COLORS[i % STATUS_COLORS.length],
      bg:    STATUS_BGS[i % STATUS_BGS.length],
    }));

    const companies = rawCustomers.map(c => ({
      id:      c.id,
      name:    c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName || c.lastName || `Customer ${c.id}`,
      phone:   c.phone?.[0]?.number || null,
      email:   Array.isArray(c.email) ? c.email[0] : c.email || null,
    }));

    const vehicles = rawVehicles.map(v => ({
      id: v.id, cid: v.customerId, year: v.year, make: v.make, model: v.model,
      plate: v.licensePlate, vin: v.vin, color: v.color,
    }));

    const employees = (empData.content || []).map(e => ({
      id: e.id, name: `${e.firstName} ${e.lastName}`.trim(),
    }));

    res.json({ ros, statuses, companies, vehicles, employees, syncedAt: new Date().toISOString() });
  // ── Fetch supporting data as paginated lists (not per-customer) ───────────
    // Customers — business type only, paginated
    let allCustomers = [], cPage = 0, cPages = 1;
    while (cPage < cPages) {
      const d = await tekFetchWithRetry(
        `${base}/customers?shop=${shopId}&customerTypeId=2&size=100&page=${cPage}`, token
      );
      allCustomers = [...allCustomers, ...(d.content || [])];
      cPages = d.totalPages || 1;
      cPage++;
    }

    // Vehicles — fetch shop-wide paginated (no per-customer loop needed)
    let allVehicles = [], vPage = 0, vPages = 1;
    while (vPage < vPages) {
      const d = await tekFetchWithRetry(
        `${base}/vehicles?shop=${shopId}&size=100&page=${vPage}`, token
      ).catch(() => ({ content: [], totalPages: 1 }));
      allVehicles = [...allVehicles, ...(d.content || [])];
      vPages = d.totalPages || 1;
      vPage++;
    }

    // Employees — single call
    const empDataFloor = await tekFetchWithRetry(
      `${base}/employees?shop=${shopId}&size=100`, token
    ).catch(() => ({ content: [] }));

    const companies = allCustomers.map(c => ({
      id:      c.id,
      name:    c.firstName && c.lastName
                 ? `${c.firstName} ${c.lastName}`
                 : c.firstName || c.lastName || `Customer ${c.id}`,
      phone:   c.phone?.[0]?.number || null,
      email:   Array.isArray(c.email) ? c.email[0] : c.email || null,
    }));

    const vehicles = allVehicles.map(v => ({
      id: v.id, cid: v.customerId,
      year: v.year, make: v.make, model: v.model,
      plate: v.licensePlate, vin: v.vin, color: v.color,
    }));

    const employees = (empDataFloor.content || []).map(e => ({
      id: e.id, name: `${e.firstName} ${e.lastName}`.trim(),
    }));

    console.log(`[ShopFloor] ${ros.length} ROs · ${companies.length} companies · ${vehicles.length} vehicles`);
    res.json({ ros, statuses, companies, vehicles, employees, syncedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[ShopFloor poll]', err.message);
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
