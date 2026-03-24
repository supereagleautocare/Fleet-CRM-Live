/**
 * TEKMETRIC PROXY ROUTE
 * Drop this file into: fleet-crm-backend-v2/routes/tekmetric.js
 *
 * This proxies all Tekmetric API calls through your server so your
 * token stays safe and CORS is never an issue.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

router.use(requireAuth);

// ── Read config from your existing config table ───────────────────────────────
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

async function tekFetch(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Tekmetric API error: ${res.status}`);
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

  if (token)        upsert.run('tekmetric_token',        token,               'Tekmetric API Token');
  if (shopId)       upsert.run('tekmetric_shop_id',      shopId,              'Tekmetric Shop ID');
  if (env)          upsert.run('tekmetric_env',          env,                 'Tekmetric Environment');
  if (pollInterval) upsert.run('tekmetric_poll_interval',String(pollInterval),'Tekmetric Poll Interval');
  if (oilInterval)  upsert.run('tekmetric_oil_interval', String(oilInterval), 'Tekmetric Oil Interval');
  if (carfaxKey !== undefined)     upsert.run('carfax_api_key', carfaxKey || '',          'Carfax API Key');
  if (carfaxEnabled !== undefined) upsert.run('carfax_enabled', carfaxEnabled ? '1' : '0','Carfax Enabled');

  res.json({ ok: true });
});

// ── Get Tekmetric settings ────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const db = require('../db/schema');
  const cfg = getTekConfig(db);
  const poll = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_poll_interval'").get()?.value || '5';
  const oil  = db.prepare("SELECT value FROM config_settings WHERE key = 'tekmetric_oil_interval'").get()?.value  || '90';
  const cfxKey     = db.prepare("SELECT value FROM config_settings WHERE key = 'carfax_api_key'").get()?.value  || '';
  const cfxEnabled = db.prepare("SELECT value FROM config_settings WHERE key = 'carfax_enabled'").get()?.value   || '0';
  res.json({
    connected:    !!cfg.token,
    shopId:       cfg.shopId,
    env:          cfg.env,
    pollInterval: parseInt(poll),
    oilInterval:  parseInt(oil),
    carfaxKey:    cfxKey,
    carfaxEnabled: cfxEnabled === '1',
  });
});

// ── Main fleet data endpoint — pulls everything in one shot ───────────────────
// Called by the frontend every N minutes. Filters to Business customers only.
router.get('/fleet-data', async (req, res) => {
  const db = require('../db/schema');
  const { token, shopId, env } = getTekConfig(db);

  if (!token || !shopId) {
    return res.status(400).json({ error: 'Tekmetric not configured. Add your token in Fleet Settings.' });
  }

  const base = baseUrl(env);

  try {
    // 1. Pull statuses (auto-detects custom ones)
    const shopData  = await tekFetch(`${base}/shops/${shopId}`, token);

    // 2. Pull business customers only (customerTypeId=2)
    let customers = [], page = 0, totalPages = 1;
    while (page < totalPages) {
      const data = await tekFetch(`${base}/customers?shop=${shopId}&customerTypeId=2&size=100&page=${page}`, token);
      customers = [...customers, ...(data.content || [])];
      totalPages = data.totalPages || 1;
      page++;
      if (page >= totalPages) break;
    }

    // 3. Pull repair orders for those customers
    const customerIds = customers.map(c=>c.id);
    let allRos = [];
    for (const cid of customerIds.slice(0, 50)) { // safety limit
      try {
        const roData = await tekFetch(`${base}/repair-orders?shop=${shopId}&customerId=${cid}&size=100`, token);
        allRos = [...allRos, ...(roData.content || [])];
      } catch { /* skip if one customer fails */ }
    }

    // 4. Pull vehicles for those customers
    let allVehicles = [];
    for (const cid of customerIds.slice(0, 50)) {
      try {
        const vData = await tekFetch(`${base}/vehicles?shop=${shopId}&customerId=${cid}&size=100`, token);
        allVehicles = [...allVehicles, ...(vData.content || [])];
      } catch { /* skip */ }
    }

    // 5. Pull employees
    const empData = await tekFetch(`${base}/employees?shop=${shopId}&size=100`, token);
    const employees = empData.content || [];

    // 6. Build statuses from RO data (auto-detects all including custom)
    const statusMap = {};
    allRos.forEach(ro => {
      if (ro.repairOrderStatus) {
        const s = ro.repairOrderStatus;
        if (!statusMap[s.id]) {
          statusMap[s.id] = { id:s.id, name:s.name, code:s.code };
        }
      }
    });
    const STATUS_COLORS = ['#6366f1','#d97706','#16a34a','#7c3aed','#1d4ed8','#dc2626','#0891b2','#059669','#7c2d12'];
    const STATUS_BGS    = ['#eef2ff','#fffbeb','#f0fdf4','#faf5ff','#eff6ff','#fef2f2','#ecfeff','#d1fae5','#fff7ed'];
    const statuses = Object.values(statusMap).map((s,i)=>({
      ...s,
      color: STATUS_COLORS[i % STATUS_COLORS.length],
      bg:    STATUS_BGS[i % STATUS_BGS.length],
    }));

    // 7. Normalize data shape to match what the frontend expects
    const normalizedCompanies = customers.map(c=>({
      id:       c.id,
      name:     c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName || c.lastName || `Customer ${c.id}`,
      contact:  c.contactFirstName ? `${c.contactFirstName} ${c.contactLastName||''}`.trim() : null,
      phone:    c.phone?.[0]?.number || null,
      email:    Array.isArray(c.email) ? c.email[0] : c.email || null,
    }));

    const normalizedVehicles = allVehicles.map(v=>({
      id:    v.id,
      cid:   v.customerId,
      year:  v.year,
      make:  v.make,
      model: v.model,
      plate: v.licensePlate,
      vin:   v.vin,
      color: v.color,
      oilElsewhere: false,
      sold:  false,
    }));

    const normalizedRos = allRos.map(ro=>({
      id:            ro.id,
      rn:            ro.repairOrderNumber,
      cid:           ro.customerId,
      vid:           ro.vehicleId,
      sid:           ro.repairOrderStatus?.id,
      techId:        ro.technicianId,
      saId:          ro.serviceWriterId,
      labor:         ro.laborSales || 0,
      parts:         ro.partsSales || 0,
      disc:          ro.discountTotal || 0,
      total:         ro.totalSales || 0,
      paid:          ro.amountPaid || 0,
      created:       ro.createdDate,
      updated:       ro.updatedDate,
      lastContact:   null, // Tekmetric doesn't have this — tracked in your CRM
      contactMethod: null,
      jobs: (ro.jobs||[]).map(j=>({
        name:   j.name,
        auth:   j.authorized,
        labor:  j.laborTotal || 0,
        parts:  j.partsTotal || 0,
      })),
    }));

    const normalizedEmployees = employees.map(e=>({
      id:   e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      role: e.employeeRole?.name || 'Employee',
    }));

    res.json({
      statuses,
      companies: normalizedCompanies,
      vehicles:  normalizedVehicles,
      ros:       normalizedRos,
      employees: normalizedEmployees,
      syncedAt:  new Date().toISOString(),
    });

  } catch (err) {
    console.error('[Tekmetric] Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
