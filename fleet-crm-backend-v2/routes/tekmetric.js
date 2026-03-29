/**
 * TEKMETRIC PROXY ROUTE  —  fleet-crm-backend-v2/routes/tekmetric.js
 *
 * What changed from the original:
 *  1. tekFetchWithRetry  — retries on 429 (rate-limit) with exponential backoff
 *  2. sleep helper       — 100ms pause between every per-customer loop to be polite
 *  3. Removed .slice(0, 50) cap so all 35-40 businesses are fetched
 *  4. syncedStats added to the response so the frontend can show counts
 *  5. Partial failures   — if one customer's RO/vehicle fetch fails we skip and keep going
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

// ── Config helpers ────────────────────────────────────────────────────────────
function getTekConfig(db) {
  try {
    const token  = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_token'").get()?.value;
    const shopId = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_shop_id'").get()?.value;
    const env    = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_env'").get()?.value || 'production';
    return { token, shopId, env };
  } catch {
    return { token: null, shopId: null, env: 'production' };
  }
}

function baseUrl(env) {
  return env === 'sandbox'
    ? 'https://sandbox.tekmetric.com/api/v1'
    : 'https://shop.tekmetric.com/api/v1';
}

// ── Small delay — keeps us polite between loop iterations ─────────────────────
// 100ms means 35 customers × 2 loops = 70 calls spread over 7 seconds.
// The rate limit is 600 calls/minute, so we have massive headroom.
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Fetch with automatic retry on 429 (rate-limited) responses ───────────────
// Tekmetric says to use exponential backoff, so we do:
//   attempt 1 fail → wait 2s, attempt 2 fail → wait 4s, attempt 3 fail → give up
async function tekFetchWithRetry(url, token, attempt = 1) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });

  // 429 = too many requests — wait and retry
  if (res.status === 429) {
    if (attempt >= 3) {
      throw new Error(`Tekmetric rate limit hit after 3 attempts for ${url}`);
    }
    const waitMs = Math.pow(2, attempt) * 1000; // 2s, then 4s
    console.warn(`[Tekmetric] 429 rate limit — waiting ${waitMs}ms before retry ${attempt + 1}`);
    await sleep(waitMs);
    return tekFetchWithRetry(url, token, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Tekmetric API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ── Save Tekmetric settings ───────────────────────────────────────────────────
router.post('/settings', (req, res) => {
  const db = require('../db/schema');
  const { token, shopId, env, pollInterval, oilInterval, carfaxKey, carfaxEnabled } = req.body;

  const upsert = db.prepare(`
    INSERT INTO config_settings (key, value, label) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  if (token        != null) upsert.run('tekmetric_token',         token,                'Tekmetric API Token');
  if (shopId       != null) upsert.run('tekmetric_shop_id',       shopId,               'Tekmetric Shop ID');
  if (env          != null) upsert.run('tekmetric_env',           env,                  'Tekmetric Environment');
  if (pollInterval != null) upsert.run('tekmetric_poll_interval', String(pollInterval),  'Tekmetric Poll Interval (minutes)');
  if (oilInterval  != null) upsert.run('tekmetric_oil_interval',  String(oilInterval),   'Tekmetric Oil Interval (days)');
  if (carfaxKey    != null) upsert.run('carfax_api_key',          carfaxKey || '',       'Carfax API Key');
  if (carfaxEnabled != null) upsert.run('carfax_enabled',         carfaxEnabled ? '1' : '0', 'Carfax Enabled');

  res.json({ ok: true });
});

// ── Get Tekmetric settings ────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const db  = require('../db/schema');
  const cfg = getTekConfig(db);
  const poll       = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_poll_interval'").get()?.value || '5';
  const oil        = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_oil_interval'").get()?.value  || '90';
  const cfxKey     = db.prepare("SELECT value FROM config_settings WHERE key = 'carfax_api_key'").get()?.value           || '';
  const cfxEnabled = db.prepare("SELECT value FROM config_settings WHERE key = 'carfax_enabled'").get()?.value           || '0';

  res.json({
    connected:     !!cfg.token,
    shopId:        cfg.shopId,
    env:           cfg.env,
    pollInterval:  parseInt(poll),
    oilInterval:   parseInt(oil),
    carfaxKey:     cfxKey,
    carfaxEnabled: cfxEnabled === '1',
  });
});

// ── Main fleet-data endpoint ──────────────────────────────────────────────────
// Called by the frontend on manual sync and every N minutes (business hours only).
// Returns all data PLUS a syncedStats object so the UI can show "35 businesses · 680 ROs".
router.get('/fleet-data', async (req, res) => {
  const db = require('../db/schema');
  const { token, shopId, env } = getTekConfig(db);

  if (!token || !shopId) {
    return res.status(400).json({
      error: 'Tekmetric not configured. Go to Active Fleet → Settings and add your token.'
    });
  }

  const base = baseUrl(env);

  try {
    // ── Step 1: shop info ─────────────────────────────────────────────────────
    console.log('[Tekmetric] Fetching shop info...');
    const shopData = await tekFetchWithRetry(`${base}/shops/${shopId}`, token);

    // ── Step 2: business customers (customerTypeId=2 = Business only) ─────────
    // Regular customers (type 1) are never fetched here.
    console.log('[Tekmetric] Fetching business customers...');
    let customers = [];
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
      const data = await tekFetchWithRetry(
        `${base}/customers?shop=${shopId}&customerTypeId=2&size=100&page=${page}`,
        token
      );
      customers = [...customers, ...(data.content || [])];
      totalPages = data.totalPages || 1;
      page++;
      if (page < totalPages) await sleep(100); // polite pause between pages
    }

    console.log(`[Tekmetric] Found ${customers.length} business customers.`);

    // ── Step 3: repair orders for each business customer ──────────────────────
    // No artificial cap — fetches all of your businesses.
    // Each call is separated by 100ms to stay polite.
    console.log('[Tekmetric] Fetching repair orders...');
    let allRos = [];
    let roFailures = 0;

    for (const customer of customers) {
      try {
        const roData = await tekFetchWithRetry(
          `${base}/repair-orders?shop=${shopId}&customerId=${customer.id}&size=100`,
          token
        );
        allRos = [...allRos, ...(roData.content || [])];
      } catch (err) {
        roFailures++;
        console.warn(`[Tekmetric] RO fetch failed for customer ${customer.id}: ${err.message}`);
        // We keep going — one customer failing doesn't break the whole sync.
      }
      await sleep(100);
    }

    // ── Step 4: vehicles for each business customer ───────────────────────────
    console.log('[Tekmetric] Fetching vehicles...');
    let allVehicles = [];
    let vehicleFailures = 0;

    for (const customer of customers) {
      try {
        const vData = await tekFetchWithRetry(
          `${base}/vehicles?shop=${shopId}&customerId=${customer.id}&size=100`,
          token
        );
        allVehicles = [...allVehicles, ...(vData.content || [])];
      } catch (err) {
        vehicleFailures++;
        console.warn(`[Tekmetric] Vehicle fetch failed for customer ${customer.id}: ${err.message}`);
      }
      await sleep(100);
    }

    // ── Step 5: employees ─────────────────────────────────────────────────────
    console.log('[Tekmetric] Fetching employees...');
    const empData = await tekFetchWithRetry(`${base}/employees?shop=${shopId}&size=100`, token);
    const employees = empData.content || [];

    // ── Step 6: build status map from RO data ─────────────────────────────────
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

    // ── Step 7: normalize for frontend ────────────────────────────────────────
    const normalizedCompanies = customers.map(c => ({
      id:      c.id,
      name:    c.firstName && c.lastName
                 ? `${c.firstName} ${c.lastName}`
                 : c.firstName || c.lastName || `Customer ${c.id}`,
      contact: c.contactFirstName
                 ? `${c.contactFirstName} ${c.contactLastName || ''}`.trim()
                 : null,
      phone:   c.phone?.[0]?.number || null,
      email:   Array.isArray(c.email) ? c.email[0] : c.email || null,
    }));

    const normalizedVehicles = allVehicles.map(v => ({
      id:           v.id,
      cid:          v.customerId,
      year:         v.year,
      make:         v.make,
      model:        v.model,
      plate:        v.licensePlate,
      vin:          v.vin,
      color:        v.color,
      oilElsewhere: false,
      sold:         false,
    }));

    const normalizedRos = allRos.map(ro => ({
      id:          ro.id,
      rn:          ro.repairOrderNumber,
      cid:         ro.customerId,
      vid:         ro.vehicleId,
      sid:         ro.repairOrderStatus?.id,
      techId:      ro.technicianId,
      saId:        ro.serviceWriterId,
      labor:       ro.laborSales   || 0,
      parts:       ro.partsSales   || 0,
      disc:        ro.discountTotal || 0,
      total:       ro.totalSales   || 0,
      paid:        ro.amountPaid   || 0,
      created:     ro.createdDate,
      updated:     ro.updatedDate,
      lastContact: null,
      contactMethod: null,
      jobs: (ro.jobs || []).map(j => ({
        name:  j.name,
        auth:  j.authorized,
        labor: j.laborTotal || 0,
        parts: j.partsTotal || 0,
      })),
    }));

    const normalizedEmployees = employees.map(e => ({
      id:   e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      role: e.employeeRole?.name || 'Employee',
    }));

    console.log(`[Tekmetric] Sync complete. ${customers.length} businesses, ${allRos.length} ROs, ${allVehicles.length} vehicles.`);

    res.json({
      statuses,
      companies:  normalizedCompanies,
      vehicles:   normalizedVehicles,
      ros:        normalizedRos,
      employees:  normalizedEmployees,
      syncedAt:   new Date().toISOString(),

      // NEW: stats so the UI can show counts and any failures
      syncedStats: {
        customers:       customers.length,
        ros:             allRos.length,
        vehicles:        allVehicles.length,
        employees:       employees.length,
        statuses:        statuses.length,
        roFailures:      roFailures,
        vehicleFailures: vehicleFailures,
        apiCallsUsed:    1 + page + customers.length * 2 + 1, // rough count
      },
    });

  } catch (err) {
    console.error('[Tekmetric] Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
