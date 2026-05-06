/**
 * FLEET FINDER — Backend Route
 * AI-powered fleet business discovery for Super Eagle Fleet CRM
 */

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../db/schema');
const { requireAuth: auth } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');

// ── Pricing constants (claude-haiku-4-5-20251001) ────────────────────────────
const PRICE_INPUT_PER_M        = 1.00;   // $ per million input tokens
const PRICE_OUTPUT_PER_M       = 5.00;   // $ per million output tokens
const PRICE_CACHE_WRITE_PER_M  = 1.25;   // $ per million cache write tokens (5m TTL)
const PRICE_CACHE_READ_PER_M   = 0.10;   // $ per million cache read tokens
const PRICE_WEB_SEARCH_PER_USE = 0.011;  // $ per web search query


// ── Address normalization for fuzzy duplicate detection ──────────────────────
function normalizeAddress(addr) {
  if (!addr) return '';
  return addr
    .toLowerCase()
    .replace(/\bstreet\b/g,    'st')
    .replace(/\bavenue\b/g,    'ave')
    .replace(/\bboulevard\b/g, 'blvd')
    .replace(/\broad\b/g,      'rd')
    .replace(/\bdrive\b/g,     'dr')
    .replace(/\bcourt\b/g,     'ct')
    .replace(/\blane\b/g,      'ln')
    .replace(/\bplace\b/g,     'pl')
    .replace(/\bsuite\b/g,     'ste')
    .replace(/\bnorth\b/g,     'n')
    .replace(/\bsouth\b/g,     's')
    .replace(/\beast\b/g,      'e')
    .replace(/\bwest\b/g,      'w')
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|services|solutions|group)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '').slice(-10);
}

// Returns 0-1 similarity score between two strings
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const editDist = levenshtein(longer, shorter);
  return (longer.length - editDist) / longer.length;
}

function levenshtein(a, b) {
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i-1) === a.charAt(j-1)) {
        matrix[i][j] = matrix[i-1][j-1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i-1][j-1] + 1,
          matrix[i][j-1]   + 1,
          matrix[i-1][j]   + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

// Reverse geocode lat/lng → city name via Nominatim (free, no key needed)
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'FleetCRM/1.0' } });
    const data = await resp.json();
    return data.address?.city || data.address?.town || data.address?.village || data.address?.county || '';
  } catch (_) {
    return '';
  }
}

// Determine which US states a lat/lng + radius circle touches
function getStatesInRadius(lat, lng, radiusMiles) {
  // State bounding boxes (approximate) — covers CONUS + common areas
  const STATE_BOUNDS = {
    AL: [30.14,84.89,35.00,88.47], AZ: [31.33,109.05,37.00,114.81],
    AR: [33.00,89.64,36.50,94.62], CA: [32.53,114.13,42.01,124.41],
    CO: [36.99,102.05,41.00,109.05], CT: [40.98,71.79,42.05,73.73],
    DE: [38.45,75.05,39.84,75.79], FL: [24.52,80.03,31.00,87.63],
    GA: [30.36,81.00,35.00,85.61], ID: [41.99,111.04,49.00,117.24],
    IL: [36.97,87.49,42.51,91.51], IN: [37.77,84.78,41.77,88.10],
    IA: [40.38,90.14,43.50,96.64], KS: [36.99,94.59,40.00,102.05],
    KY: [36.49,81.96,39.15,89.57], LA: [28.93,88.82,33.02,94.04],
    ME: [43.06,66.95,47.46,71.08], MD: [37.91,74.98,39.72,79.49],
    MA: [41.24,69.93,42.89,73.53], MI: [41.70,82.41,48.31,90.42],
    MN: [43.50,89.49,49.38,97.24], MS: [30.17,88.10,35.00,91.65],
    MO: [35.99,89.10,40.61,95.77], MT: [44.36,104.04,49.00,116.05],
    NE: [39.99,95.31,43.00,104.05], NV: [35.00,114.04,42.00,120.01],
    NH: [42.70,70.74,45.31,72.56], NJ: [38.92,73.89,41.36,75.56],
    NM: [31.33,103.00,37.00,109.05], NY: [40.49,71.86,45.02,79.76],
    NC: [33.84,75.46,36.59,84.32], ND: [45.94,96.55,49.00,104.05],
    OH: [38.40,80.52,42.33,84.82], OK: [33.62,94.43,37.00,103.00],
    OR: [41.99,116.46,46.24,124.57], PA: [39.72,74.69,42.27,80.52],
    RI: [41.15,71.12,42.02,71.86], SC: [32.05,78.54,35.22,83.35],
    SD: [42.48,96.44,45.94,104.06], TN: [34.98,81.65,36.68,90.31],
    TX: [25.84,93.51,36.50,106.65], UT: [36.99,109.05,42.00,114.05],
    VT: [42.73,71.46,45.02,73.44], VA: [36.54,75.24,39.46,83.68],
    WA: [45.54,116.92,49.00,124.73], WV: [37.20,77.72,40.64,82.65],
    WI: [42.49,86.25,47.08,92.89], WY: [40.99,104.05,45.01,111.05],
  };

  // Approximate degrees per mile
  const latDeg = radiusMiles / 69.0;
  const lngDeg = radiusMiles / (69.0 * Math.cos(lat * Math.PI / 180));

  const touched = [];
  for (const [abbr, [minLat, minLng, maxLat, maxLng]] of Object.entries(STATE_BOUNDS)) {
    if (
      lat + latDeg >= minLat && lat - latDeg <= maxLat &&
      Math.abs(lng) - lngDeg <= maxLng && Math.abs(lng) + lngDeg >= minLng
    ) {
      touched.push(abbr);
    }
  }
  return touched.length > 0 ? touched : ['NC'];
}

// ── GET /api/fleetfinder/settings ────────────────────────────────────────────
router.get('/settings', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT key, value FROM config_settings WHERE key LIKE 'ff_%' OR key IN ('shop_lat','shop_lng')`
    );
    const settings = {};
    for (const row of result.rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/fleetfinder/settings ────────────────────────────────────────────
router.put('/settings', auth, async (req, res) => {
  try {
    const updates = req.body;
    for (const [key, value] of Object.entries(updates)) {
      if (!key.startsWith('ff_')) continue;
      const val = typeof value === 'string' ? value : JSON.stringify(value);
      await pool.query(
        `INSERT INTO config_settings (key, value, label) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()::text`,
        [key, val, key]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/fleetfinder/budget ──────────────────────────────────────────────
router.get('/budget', auth, async (req, res) => {
  try {
    const [budgetRow, spentRow] = await Promise.all([
      pool.query(`SELECT value FROM config_settings WHERE key = 'ff_monthly_budget'`),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) as spent
         FROM fleet_finder_cost_log
         WHERE ran_at >= date_trunc('month', now())::text`
      ),
    ]);
    const budget = parseFloat(budgetRow.rows[0]?.value || 50);
    const spent  = parseFloat(spentRow.rows[0]?.spent || 0);
    res.json({ budget, spent, remaining: Math.max(0, budget - spent) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/fleetfinder/cost-log ────────────────────────────────────────────
router.get('/cost-log', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM fleet_finder_cost_log ORDER BY ran_at DESC LIMIT 50`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/fleetfinder/test-search ─────────────────────────────────────────
// Runs a test search for Prince Telecom to verify Claude web search is working
router.get('/test-search', auth, async (req, res) => {
  const log = [];

  let anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    const keyRow = await pool.query(`SELECT value FROM config_settings WHERE key = 'ff_anthropic_key'`);
    anthropicKey = keyRow.rows[0]?.value?.trim() || '';
  }
  if (!anthropicKey) {
    return res.status(400).json({ error: 'No Anthropic API key configured.' });
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  log.push({ type: 'start', message: 'Starting test search for Prince Telecom in Charlotte NC' });
  log.push({ type: 'info',  message: 'Model: claude-haiku-4-5-20251001 | Testing web_search tool without betas flag' });

  const messages = [{ role: 'user', content: 'Find Prince Telecom\'s Charlotte NC operation. Search Google, FMCSA (site:safer.fmcsa.dot.gov), LinkedIn, and Indeed. They are a telecom subcontractor with ~100 trucks believed to operate in Charlotte but have limited consumer web presence. Tell me exactly what you find and where you found it.' }];

  let inputTokens = 0;
  let outputTokens = 0;
  let finalText = '';
  let turnCount = 0;
  let continueLoop = true;

  try {
    while (continueLoop && turnCount < 6) {
      turnCount++;
      const response = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system:     'You are a fleet business discovery agent. Find businesses that operate vehicle fleets. Search multiple sources and report exactly what you find and where.',
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });

      inputTokens  += response.usage?.input_tokens  || 0;
      outputTokens += response.usage?.output_tokens || 0;

      const turnEntry = {
        type:        'turn',
        turn:        turnCount,
        stop_reason: response.stop_reason,
        input_tokens:  response.usage?.input_tokens  || 0,
        output_tokens: response.usage?.output_tokens || 0,
        searches: [],
      };

      if (response.stop_reason === 'end_turn') {
        for (const block of response.content) {
          if (block.type === 'text') finalText += block.text;
        }
        log.push(turnEntry);
        continueLoop = false;
      } else if (response.stop_reason === 'tool_use') {
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            turnEntry.searches.push(block.input?.query || JSON.stringify(block.input));
          }
        }
        log.push(turnEntry);
        messages.push({ role: 'assistant', content: response.content });
        const toolResults = response.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
        if (toolResults.length) {
          messages.push({ role: 'user', content: toolResults });
        } else {
          continueLoop = false;
        }
      } else {
        log.push(turnEntry);
        continueLoop = false;
      }
    }

    const costUsd = parseFloat(
      ((inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
       (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M).toFixed(5)
    );

    log.push({
      type:          'result',
      total_input_tokens:  inputTokens,
      total_output_tokens: outputTokens,
      cost_usd:      costUsd,
      turns_used:    turnCount,
    });

    res.json({ log, final_output: finalText, error: null });
  } catch (e) {
    log.push({ type: 'error', message: e.message, detail: e.error || null });
    res.json({ log, final_output: '', error: e.message });
  }
});

// ── GET /api/fleetfinder/dismissed ──────────────────────────────────────────
router.get('/dismissed', auth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM fleet_finder_dismissed ORDER BY dismissed_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fleetfinder/dismiss ────────────────────────────────────────────
router.post('/dismiss', auth, async (req, res) => {
  try {
    const { name, address, phone, city, state } = req.body;
    const result = await pool.query(
      `INSERT INTO fleet_finder_dismissed (name, address, phone, city, state)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, address || null, phone || null, city || null, state || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/fleetfinder/dismiss/:id ──────────────────────────────────────
router.delete('/dismiss/:id', auth, async (req, res) => {
  try {
    await pool.query(`DELETE FROM fleet_finder_dismissed WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fleetfinder/estimate ───────────────────────────────────────────
router.post('/estimate', auth, async (req, res) => {
  try {
    const { industries = [], radius_miles = 25 } = req.body;
    // Estimate: Haiku with web_search, ~5 turns, varies by industry count + radius
    const base        = 0.35;
    const industryAdd = Math.min(industries.length, 15) * 0.002;
    const radiusAdd   = Math.max(0, radius_miles - 15) / 10 * 0.003;
    const estimate    = parseFloat((base + industryAdd + radiusAdd).toFixed(3));
    res.json({ estimate_usd: estimate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fleetfinder/check-duplicate ────────────────────────────────────
// Called before import — checks existing CRM companies for fuzzy matches
router.post('/check-duplicate', auth, async (req, res) => {
  try {
    const { name, address, phone, city } = req.body;
    const normName    = normalizeName(name || '');
    const normAddr    = normalizeAddress(address || '');
    const normPhone   = normalizePhone(phone || '');

    const companies = await pool.query(
      `SELECT id, company_id, name, address, city, state, main_phone,
              is_multi_location, location_name, location_group
       FROM companies WHERE status = 'active'`
    );

    const matches = [];
    for (const co of companies.rows) {
      const coNormName  = normalizeName(co.name || '');
      const coNormAddr  = normalizeAddress(co.address || '');
      const coNormPhone = normalizePhone(co.main_phone || '');

      const nameSim  = stringSimilarity(normName, coNormName);
      const addrSim  = normAddr && coNormAddr ? stringSimilarity(normAddr, coNormAddr) : 0;
      const phoneMatch = normPhone && coNormPhone && normPhone === coNormPhone;

      // Match if: phone matches, OR name is very similar (>=0.82), OR name+address both similar
      const isMatch = phoneMatch
        || nameSim >= 0.82
        || (nameSim >= 0.65 && addrSim >= 0.65);

      if (isMatch) {
        matches.push({
          ...co,
          match_score: Math.round(Math.max(nameSim, addrSim, phoneMatch ? 1 : 0) * 100),
          phone_match: phoneMatch,
          name_sim:    Math.round(nameSim * 100),
          addr_sim:    Math.round(addrSim * 100),
        });
      }
    }

    // Sort by match score desc, take top 3
    matches.sort((a, b) => b.match_score - a.match_score);
    res.json({ matches: matches.slice(0, 3) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fleetfinder/check-chain ────────────────────────────────────────
// Check if a national chain already exists in CRM as a location group
router.post('/check-chain', auth, async (req, res) => {
  try {
    const { chain_name } = req.body;
    if (!chain_name) return res.json({ found: false });

    const normChain = chain_name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const result = await pool.query(
      `SELECT name, city, state, location_group
       FROM companies
       WHERE status = 'active'
         AND (
           LOWER(REGEXP_REPLACE(location_group, '[^a-zA-Z0-9 ]', '', 'g')) ILIKE $1
           OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9 ]', '', 'g')) ILIKE $1
         )
       ORDER BY name`,
      [`%${normChain}%`]
    );

    const locations = result.rows.map(r => ({ name: r.name, city: r.city, state: r.state }));
    const locationGroup = result.rows.find(r => r.location_group)?.location_group || chain_name;

    res.json({
      found:            result.rows.length > 0,
      location_group:   locationGroup,
      location_count:   result.rows.length,
      existing_locations: locations,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/fleetfinder/search ─────────────────────────────────────────────
router.post('/search', auth, async (req, res) => {
  const {
    lat, lng,
    radius_miles   = 25,
    polygon_coords = null,
    industries     = [],
    vehicle_types  = [],
    fleet_size: fleetSizeRaw = 'any',
  } = req.body;
  // fleet_size may now be an array (multi-select) or legacy string
  const fleetSizeArr = Array.isArray(fleetSizeRaw) ? fleetSizeRaw : [fleetSizeRaw];

    // Resolve API key — env var takes priority, then CRM settings
    let anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      const keyRow = await pool.query(`SELECT value FROM config_settings WHERE key = 'ff_anthropic_key'`);
      anthropicKey = keyRow.rows[0]?.value?.trim() || '';
    }
    if (!anthropicKey) {
      return res.status(400).json({ error: 'Anthropic API key not configured. Add it in Settings → Fleet Finder.' });
    }

  try {
    // ── 1. Budget check ───────────────────────────────────────────────────────
    const [budgetRow, spentRow] = await Promise.all([
      pool.query(`SELECT value FROM config_settings WHERE key = 'ff_monthly_budget'`),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) as spent
         FROM fleet_finder_cost_log
         WHERE ran_at >= date_trunc('month', now())::text`
      ),
    ]);
    const budget  = parseFloat(budgetRow.rows[0]?.value || 50);
    const spent   = parseFloat(spentRow.rows[0]?.spent || 0);
    if (spent >= budget) {
      return res.status(402).json({ error: `Monthly budget of $${budget} reached. Update your limit in Fleet Finder settings.` });
    }

    // ── 2. Determine search states ─────────────────────────────────────────────
    const searchStates = getStatesInRadius(lat, lng, radius_miles);

    // ── 2b. Reverse geocode shop location → nearest city name ────────────────
    const shopCity = await reverseGeocode(lat, lng);

    // ── 3. Pull existing companies for dedup ──────────────────────────────────
    const existing = await pool.query(
      `SELECT name, address, city, main_phone FROM companies WHERE status = 'active'`
    );
    const existingNames = existing.rows.map(r => normalizeName(r.name)).filter(Boolean);

    // ── 4. Pull dismissed companies ────────────────────────────────────────────
    await pool.query(`DELETE FROM fleet_finder_seen WHERE expires_at < now()::text`);
    const dismissed = await pool.query(`SELECT name, address, city FROM fleet_finder_dismissed`);
    const dismissedKeys = new Set(
      dismissed.rows.map(r => `${normalizeName(r.name)}|${normalizeAddress(r.address || '')}`)
    );

    // ── 5. Build location description ─────────────────────────────────────────
    const locationDesc = polygon_coords
      ? `a custom polygon area near coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}`
      : `within ${radius_miles} miles of coordinates ${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const stateList = searchStates.join(', ');
    const vehicleDesc = vehicle_types.length
      ? vehicle_types.map(v => ({
          passenger:          'Passenger cars/sedans (gas)',
          light_duty_gas:     'Light duty gas trucks (F-150 through F-350 gas, RAM 1500-3500 gas)',
          light_duty_diesel:  'Light duty diesel trucks (F-250/F-350 diesel, RAM 2500/3500 diesel, Sprinter diesel)',
          cargo_van:          'Cargo/Sprinter vans',
          medium_duty:        'Medium duty gas trucks (F-450, F-550, F-650, box trucks, step vans — gas)',
          medium_duty_diesel: 'Medium duty diesel trucks (F-450/F-550/F-650 diesel, medium box trucks)',
          heavy_duty_diesel:  'Heavy duty diesel trucks (F-750+, Class 7-8 semis, dump trucks, large construction equipment)',
        }[v] || v)).join('; ')
      : 'any vehicle type';

    const SIZE_LABELS = { any: 'any fleet size', xs: '1-5 vehicles', small: '6-20 vehicles', mid: '21-100 vehicles', large: '100+ vehicles' };
    const fleetSizeDesc = fleetSizeArr.includes('any') || fleetSizeArr.length === 0
      ? 'any fleet size'
      : fleetSizeArr.map(s => SIZE_LABELS[s] || s).join(' or ');

    const industryList = industries.length ? industries.join(', ') : 'all industries';

    // ── 5b. Load custom fleet signal keywords ────────────────────────────────
    const locationStr = shopCity ? `${shopCity}, ${stateList}` : stateList;
    const kwRow = await pool.query(`SELECT value FROM config_settings WHERE key = 'ff_search_keywords'`);
    const customKeywords = (kwRow.rows[0]?.value || 'company vehicle')
      .split(',').map(k => k.trim()).filter(Boolean);

    // ── 6. Two-phase Claude search ────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    let inputTokens       = 0;
    let outputTokens      = 0;
    let cacheReadTokens   = 0;
    let cacheWriteTokens  = 0;
    let webSearchCount    = 0;
    let turnCount         = 0;

    // ── Phase 1: Research (web searches, no JSON pressure) ────────────────────
    const researchSystem = `You are a fleet vehicle research agent for an auto repair shop in ${locationStr}.
Your job right now: SEARCH and GATHER information. Do not output JSON yet.

══ WHERE TO SEARCH — starting points that have worked well ═════════════════
You have full freedom to search wherever makes sense. These are starting points that tend to produce good results — use your own judgment if you think a different source will work better for a specific company or industry.

GOOGLE MAPS / GOOGLE BUSINESS — usually a great first move
  We've had good luck starting here to quickly find 5-8 local companies per industry. Business descriptions sometimes mention fleet size or team size, and review counts give a sense of how established the operation is.
  Try: "[industry] ${shopCity}"

COMPANY WEBSITE — follow up once you have a name
  Worth checking if a company looks promising. Fleet pages, service area maps, and team/technician pages often reveal headcount. A company listing 12 named technicians has at least 12 vehicles. "About Us" pages sometimes mention how many trucks they run.
  Try: "[company name] fleet" or "[company name] our team" or go directly to their site.

INDEED / GLASSDOOR — great for confirming fleet operation
  Job postings that say "company vehicle provided", "take-home truck", "stocked service van", or "route technician" are strong fleet signals. Employee reviews sometimes mention "company truck" or "take-home vehicle" too.
  Try: "[industry] ${shopCity} company vehicle" or "[company name] technician job"

LINKEDIN PEOPLE SEARCH — our best signal for local fleet size
  Searching for employees by company + city is the most reliable way to count local field workers. Each field employee = one vehicle minimum.
  Try searching Google: site:linkedin.com/in "[company name]" "${shopCity}"
  This finds individual profiles rather than just the company page.

YELP / BBB — good for smaller independents
  Smaller local companies that don't rank well on Google often show up here. Reviews sometimes mention "their fleet of vans" or "the technician arrived in a company truck."

FMCSA (site:safer.fmcsa.dot.gov) — situational, use your judgment
  We've had mixed results here. It works well for companies that likely cross state lines (freight, waste haulers, large utility crews). For purely local service companies like pest control or HVAC, they usually don't have a DOT number, so it's probably not worth a search credit — but if you think it might apply, go for it.

SAM.GOV / STATE CONTRACTOR REGISTRIES — for contract-driven industries
  Good for telecom subs, utility contractors, government service companies that win public contracts.

FOLLOW THE EVIDENCE — each search should build on what you already found. If Google Maps surfaces a company, go to their website next. If a job posting mentions "company van provided", search LinkedIn for that company's local employees next. Don't follow a rigid plan if the evidence is pointing somewhere more useful.

NATIONAL CHAINS — fully valid leads:
  1. Confirm local branch: search "[chain name] ${shopCity}" on Google Maps or their website's locations page.
  2. Find local employees: site:linkedin.com/in "[chain name]" "${shopCity}"
  3. Estimate LOCAL fleet for ${shopCity} only — ignore their national total entirely.
  A chain with 3,000 trucks nationally but 15 in ${shopCity} is a 15-truck lead for this shop.

LINKEDIN FIELD EMPLOYEE CLASSIFICATION:
  FIELD (= 1 vehicle each): technician, installer, driver, route tech, service tech, crew lead, foreman, field supervisor, cable tech, fiber tech, pest control tech, HVAC tech, plumber, electrician, groundsman
  OFFICE (no vehicle): HR, recruiter, admin, accountant, dispatcher, inside sales, marketing

WHAT TO INCLUDE:
  • Any company with confirmed or likely local vehicles — even 2 trucks counts.
  • Companies where any source mentions "company vehicle", "take-home truck", "route technician", "our fleet", "service van".
  • Do NOT drop a company just because you couldn't confirm exact fleet size — note uncertainty.`;

    const researchPrompt = `Find fleet businesses in ${locationDesc} (states: ${stateList}).

Target area: ${locationStr}
Industries: ${industryList}
Vehicle types this shop services: ${vehicleDesc}
Fleet size preference (soft preference only — include companies close to this range): ${fleetSizeDesc}
Fleet signal keywords to watch for: "${customKeywords.join('", "')}"

Run 8–10 searches and aim to find at least 12 distinct companies. Choose your sources freely — use the source menu in your instructions to decide what makes sense for each industry. Follow the evidence: if a Google Maps result looks promising, go to their website next. If a company has a job posting mentioning "company vehicle", search LinkedIn for their local employees next. If one industry search returns few results, try a second industry from the list.

For each company found, report:
• Name, industry, local address (or "not found")
• LinkedIn field employees in ${shopCity} and their titles (if searched)
• Website or job posting signals (fleet page, vehicle mentions, technician count)
• National chain or local independent; if chain, confirm local branch exists
• Your confidence they run local vehicles here and why

Already in CRM (research anyway — just note "already in CRM"):
${existingNames.slice(0, 40).join(', ')}

After your searches, end your response with a short COVERAGE NOTE section (label it exactly "COVERAGE NOTE:") that answers in 2-3 sentences:
1. Which sources you searched (Google Maps, LinkedIn, Indeed, FMCSA, etc.)
2. How many distinct companies you found total
3. What would likely yield more results if the user expanded (e.g., "Searching FMCSA for freight companies or LinkedIn for a second industry would likely surface more leads")

Begin searching now.`;

    const researchMessages = [{ role: 'user', content: researchPrompt }];
    let continueLoop = true;

    while (continueLoop && turnCount < 10) {
      turnCount++;
      const response = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 3500,
        system:     [{ type: 'text', text: researchSystem, cache_control: { type: 'ephemeral' } }],
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages:   researchMessages,
      });

      inputTokens      += response.usage?.input_tokens             || 0;
      outputTokens     += response.usage?.output_tokens            || 0;
      cacheReadTokens  += response.usage?.cache_read_input_tokens  || 0;
      cacheWriteTokens += response.usage?.cache_creation_input_tokens || 0;

      if (response.stop_reason === 'end_turn') {
        researchMessages.push({ role: 'assistant', content: response.content });
        continueLoop = false;
      } else if (response.stop_reason === 'tool_use') {
        researchMessages.push({ role: 'assistant', content: response.content });
        const toolResults = response.content
          .filter(b => b.type === 'tool_use')
          .map(b => { if (b.name === 'web_search') webSearchCount++; return { type: 'tool_result', tool_use_id: b.id, content: '' }; });
        if (toolResults.length > 0) {
          researchMessages.push({ role: 'user', content: toolResults });
        } else {
          continueLoop = false;
        }
      } else {
        continueLoop = false;
      }
    }

    // Extract coverage note from Phase 1 final text
    const phase1FinalText = researchMessages
      .filter(m => m.role === 'assistant')
      .flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ');
    const coverageMatch = phase1FinalText.match(/COVERAGE NOTE:\s*([\s\S]*?)(?:\n\n|$)/i);
    const searchSummary = coverageMatch ? coverageMatch[1].trim() : null;

    // ── Phase 2: JSON extraction with assistant prefill ───────────────────────
    // Prefilling the assistant turn with "[" forces the model to continue the
    // JSON array — it physically cannot write explanatory text before the data.
    const extractSystem = `You are a JSON formatter. Convert research findings into a structured JSON array.
Output ONLY valid JSON. No explanation, no markdown, no text of any kind outside the array.`;

    const extractMessages = [
      ...researchMessages,
      {
        role: 'user',
        content: `Convert the TOP 20 companies from your research into this JSON array, ranked by fleet probability (highest first).
If you found more than 20, pick the 20 most promising — prioritize confirmed local offices, named field employees, and explicit vehicle mentions over uncertain leads.
Use null for any field you could not verify.

IMPORTANT — keep all string fields SHORT to avoid truncation:
- fleet_note: max 120 characters (one tight sentence)
- research_notes: max 150 characters (key finding + one gap)
- score_factors: max 4 factors, factor text max 60 characters each
- fleet_signals: max 4 signals, each max 40 characters
- local_field_employee_titles: list job titles only, no extra text

For companies already in CRM set "already_in_crm": true so they can be shown differently in the UI.
Already in CRM: ${existingNames.slice(0, 40).join(', ')}

Required format per company:
{
  "name": string,
  "industry": string,
  "industry_category": "consumer_facing"|"contract_driven"|"both",
  "address": string|null,
  "city": string|null,
  "state": string|null,
  "zip": string|null,
  "main_phone": string|null,
  "website": string|null,
  "contact_name": null,
  "contact_title": null,
  "local_office_found": boolean,
  "local_office_address": string|null,
  "local_field_employees_found": number|null,
  "local_field_employee_titles": string[],
  "fleet_probability": number (0-100),
  "fleet_note": string (max 120 chars),
  "research_notes": string (max 150 chars),
  "fleet_signals": string[],
  "score_factors": [{"factor": string, "impact": "+"|"-", "points": number}],
  "estimated_fleet_size": string|null,
  "vehicle_types_detected": string[],
  "vehicle_type_confidence": "confirmed"|"likely"|"unknown",
  "is_local_independent": boolean|null,
  "is_national_chain": boolean,
  "chain_name": string|null,
  "already_in_crm": boolean,
  "sources": [{"label": string, "url": string}]
}`,
      },
      { role: 'assistant', content: '[' }, // ← prefill forces JSON array start
    ];

    const extractResponse = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8000,
      system:     [{ type: 'text', text: extractSystem, cache_control: { type: 'ephemeral' } }],
      messages:   extractMessages,
    });

    inputTokens  += extractResponse.usage?.input_tokens  || 0;
    outputTokens += extractResponse.usage?.output_tokens || 0;
    turnCount++;

    // Prepend the prefill "[" back since the response starts after it
    const extractedText = '[' + (extractResponse.content.find(b => b.type === 'text')?.text || '');
    const fullText = extractedText;

    // ── 7. Parse JSON from Claude response ────────────────────────────────────
    let companies = [];
    let parseError = null;
    let rawAiOutput = fullText;
    try {
      // Try full array first
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        companies = JSON.parse(jsonMatch[0]);
      } else {
        parseError = 'Response truncated — attempting partial recovery';
      }
    } catch (_) {
      parseError = 'Response truncated — attempting partial recovery';
    }

    // Fallback: walk backwards through every "}" position until we get valid JSON
    if (!companies.length && fullText.includes('[')) {
      const partial = fullText.slice(fullText.indexOf('['));
      let pos = partial.length - 1;
      let recovered = false;
      while (pos >= 0 && !recovered) {
        pos = partial.lastIndexOf('}', pos);
        if (pos === -1) break;
        try {
          const attempt = partial.slice(0, pos + 1) + ']';
          companies = JSON.parse(attempt);
          parseError = `Response truncated — recovered ${companies.length} of ~${Math.round(partial.length / 500)} companies`;
          recovered = true;
        } catch (_) {
          pos--;
        }
      }
      if (!recovered) {
        parseError = 'JSON truncated beyond recovery — try a smaller search area';
      }
    }

    // ── 8. Filter dismissed; flag CRM matches instead of dropping them ────────
    const now90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const filtered = [];
    for (const co of companies) {
      if (!co || !co.name) continue;
      const key = `${normalizeName(co.name)}|${normalizeAddress(co.address || '')}`;

      // Hard skip dismissed companies
      if (dismissedKeys.has(key)) continue;

      // Fuzzy-match against CRM — mark but still include
      const normN = normalizeName(co.name);
      const crmMatch = existing.rows.find(r => stringSimilarity(normN, normalizeName(r.name)) >= 0.85);
      if (crmMatch) {
        co.already_in_crm  = true;
        co.crm_match_name  = crmMatch.name;
        co.crm_match_city  = crmMatch.city;
      } else {
        co.already_in_crm  = co.already_in_crm || false;
        // Only log as "seen" for new companies (not CRM dupes)
        await pool.query(
          `INSERT INTO fleet_finder_seen (name, address, city, state, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [co.name, co.address || null, co.city || null, co.state || null, now90]
        ).catch(() => {});
      }

      filtered.push(co);
    }

    // ── 9. Calculate distance from shop ───────────────────────────────────────
    for (const co of filtered) {
      if (co.lat && co.lng) {
        co.distance_miles = distMiles(lat, lng, co.lat, co.lng);
      }
    }

    // ── 10. Sort by fleet probability desc ────────────────────────────────────
    filtered.sort((a, b) => (b.fleet_probability || 0) - (a.fleet_probability || 0));

    // ── 11. Log cost ──────────────────────────────────────────────────────────
    const costUsd = parseFloat(
      ((inputTokens      / 1_000_000) * PRICE_INPUT_PER_M       +
       (outputTokens     / 1_000_000) * PRICE_OUTPUT_PER_M      +
       (cacheWriteTokens / 1_000_000) * PRICE_CACHE_WRITE_PER_M +
       (cacheReadTokens  / 1_000_000) * PRICE_CACHE_READ_PER_M  +
       webSearchCount                 * PRICE_WEB_SEARCH_PER_USE
      ).toFixed(5)
    );
    await pool.query(
      `INSERT INTO fleet_finder_cost_log
         (search_label, industries, radius_miles, result_count, input_tokens, output_tokens, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `${industries.slice(0,3).join(', ')}${industries.length > 3 ? '...' : ''}`,
        JSON.stringify(industries),
        radius_miles,
        filtered.length,
        inputTokens,
        outputTokens,
        costUsd,
      ]
    );

    res.json({
      results:         filtered,
      result_count:    filtered.length,
      cost_usd:        costUsd,
      input_tokens:    inputTokens,
      output_tokens:   outputTokens,
      states_searched: searchStates,
      search_summary:  searchSummary,
      debug: {
        turns:         turnCount,
        parse_error:   parseError,
        raw_companies: companies.length,
        filtered_out:  companies.length - filtered.length,
        raw_preview:   rawAiOutput.slice(0, 2000),
      },
    });

  } catch (e) {
    console.error('[fleetfinder] search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function distMiles(shopLat, shopLng, coLat, coLng) {
  const R = 3958.8;
  const dLat = (coLat - shopLat) * Math.PI / 180;
  const dLng = (coLng - shopLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(shopLat * Math.PI/180) * Math.cos(coLat * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

module.exports = router;
