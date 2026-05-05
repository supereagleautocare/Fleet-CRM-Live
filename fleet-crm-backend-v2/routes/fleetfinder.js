/**
 * FLEET FINDER — Backend Route
 * AI-powered fleet business discovery for Super Eagle Fleet CRM
 */

const express   = require('express');
const router    = express.Router();
const { pool }  = require('../db/schema');
const { requireAuth: auth } = require('../middleware/auth');
const Anthropic = require('@anthropic-ai/sdk');

// ── Pricing constants (claude-haiku-4-5) ─────────────────────────────────────
const PRICE_INPUT_PER_M  = 0.80;   // $ per million input tokens
const PRICE_OUTPUT_PER_M = 4.00;   // $ per million output tokens


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
      `SELECT key, value FROM config_settings WHERE key LIKE 'ff_%'`
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
    // Estimate: 2 Serper searches ($0.002) + Haiku with 4-5 Claude follow-ups (~$0.35)
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

// ── POST /api/fleetfinder/search ─────────────────────────────────────────────
router.post('/search', auth, async (req, res) => {
  const {
    lat, lng,
    radius_miles  = 25,
    polygon_coords = null,
    industries    = [],
    vehicle_types = [],
    fleet_size    = 'any',
  } = req.body;

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

    const fleetSizeDesc = {
      any:   'any fleet size',
      small: '2-5 vehicles',
      mid:   '6-15 vehicles',
      large: '16+ vehicles',
    }[fleet_size] || 'any fleet size';

    const industryList = industries.length ? industries.join(', ') : 'all industries';

    // ── 5b. Load custom fleet signal keywords ────────────────────────────────
    const locationStr = shopCity ? `${shopCity}, ${stateList}` : stateList;
    const kwRow = await pool.query(`SELECT value FROM config_settings WHERE key = 'ff_search_keywords'`);
    const customKeywords = (kwRow.rows[0]?.value || 'company vehicle')
      .split(',').map(k => k.trim()).filter(Boolean);

    // ── 6. Call Claude with web_search ────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    const systemPrompt = `You are a fleet business discovery agent for an auto repair shop. Find LOCAL businesses that operate vehicle fleets (trucks, vans, cars) and need regular maintenance.

═══ STEP 1 — CLASSIFY EACH INDUSTRY ════════════════════════════════════════════
You will receive a list of industries. Classify each one yourself:

CONSUMER-FACING: companies that market directly to homeowners or businesses and send
technicians to customer sites. Send techs to the customer = dedicated vehicle per tech.
Examples: pest control, HVAC, plumbing, landscaping, pool service, roofing, residential
electrical, cleaning/janitorial, fire protection, alarm/security installation.
Search: Google Maps, Google Business listings, Yelp, BBB, then Indeed for fleet signals.

CONTRACT-DRIVEN: companies with little or no consumer web presence that win government,
utility, or corporate contracts. Workers operate from a yard or warehouse, not an office.
Examples: telecom subcontractors, fiber/cable installers, utility line crews, construction
subcontractors, government service contractors, meter reading services, underground crews.
Search: LinkedIn company search, Google "site:safer.fmcsa.dot.gov [name or industry] [city]",
SAM.gov contracts via Google search, state contractor license registries, Indeed job boards.

BOTH: Apply both strategies.
Examples: commercial HVAC, commercial electrical, commercial plumbing, security companies.

═══ STEP 2 — LEADING SIGNALS (check these first, they carry the most weight) ════
These are the strongest indicators a company has a real local fleet. Prioritize finding them.

1. LOCAL EMPLOYEES ON LINKEDIN OR INDEED
   Search: Google  →  site:linkedin.com/in "[company name]" "[city]"
   Search: Google  →  "[company name]" employees "[city]" site:linkedin.com
   Also check the company's LinkedIn page People tab if accessible.

   For every employee found who lists the target city or nearby city as their location,
   note their job title and classify it:

   FIELD ROLES (each one = a vehicle): technician, installer, splicer, field tech,
   service tech, route tech, foreman, crew lead, driver, operator, field supervisor,
   cable tech, fiber tech, utility worker, groundsman, service rep (field)

   OFFICE ROLES (no vehicle): HR, recruiter, admin, accountant, office manager,
   inside sales, marketing, IT, dispatcher (office-based)

   Count field-role employees found in the target area. That is your minimum local
   vehicle count. Report: "Found X employees on LinkedIn in [city]. Y are field roles
   ([titles listed]). Minimum Y vehicles estimated for this area."

2. PHYSICAL OFFICE OR YARD IN THE TARGET AREA
   Finding a local office, service center, warehouse, or operations yard confirms the
   company is actively operating in the area — not just occasionally sending someone out.
   A local address + local field employees together is strong confirmation of a local fleet.
   Search the company's website "locations" or "service areas" page. Search Google Maps
   for the company name in the target city. Note the exact address if found.

═══ STEP 3 — SUPPORTING SIGNALS ════════════════════════════════════════════════
Use these to raise or lower confidence after checking the leading signals above.

STRONG:
• Job posting says "company vehicle provided", "take-home vehicle", "stocked service van"
• Employee review on Indeed or Glassdoor says "company truck" or "take home truck"
• FMCSA DOT registration found — may show actual reported power unit count
• Job posting for "fleet coordinator", "fleet manager", or "dispatch coordinator"
  (companies hire these only when they have 15+ vehicles)
• Industry where the work STRUCTURALLY requires a vehicle per worker
  (telecom installer, cable tech, utility crew, pest control route tech, meter reader)
• Job posting mentions "routes" or "route technician" (multiple trucks running simultaneously)
• 24/7 emergency service + multiple technicians listed
• Company established 10+ years and still independent (has had time to build a real fleet)
• LinkedIn shows 50+ employees for a field service company

WEAK — note these but do not use as primary evidence:
• Large service area listed (solo operators do this too)
• Multiple job postings for same role (may be one spot posted many times)
• "Valid driver's license required" (universal requirement, not a fleet signal)

═══ STEP 4 — HONESTY RULES ═════════════════════════════════════════════════════
• Never invent an address, phone number, URL, or fleet size. Return null for unknowns.
• research_notes MUST state: what you found, exactly where (source + URL), AND what
  you tried to find but could not — and specifically why (e.g. "LinkedIn search returned
  no Charlotte employees for this company", "FMCSA returned no carrier record",
  "website has no locations page").
• fleet_probability is your confidence 0-100 that this company runs a real vehicle fleet
  in or near the target area, based only on evidence found. Explain your score.
• estimated_fleet_size must always note it is estimated from signals, not confirmed.
• Do not bias toward national chains or local independents — return what the search finds.

Your final response must be ONLY a raw JSON array. No markdown, no code fences, just [ ... ].`;

    const userPrompt = `Find 8-15 businesses with vehicle fleets in ${locationDesc} (states: ${stateList}).

Target city / area: ${locationStr}
Industries to search (you classify each one): ${industryList}
Vehicle types this shop services: ${vehicleDesc}
Fleet size preference: ${fleetSizeDesc}
Fleet signal keywords to watch for in job postings: "${customKeywords.join('", "')}"

Run 5 searches. Cover at least 3 different source types (Google Maps, Yelp, BBB, LinkedIn,
FMCSA via Google, Indeed, SAM.gov via Google). Do not run the same search twice.
Do not search Google for everything — go where the companies actually are.

For each company you find, check for local employees on LinkedIn and a local office address
before moving on. These are your leading signals.

Already in CRM — do not return these: ${existingNames.slice(0, 30).join(', ')}

Return ONLY this JSON array. Use null for any field you could not verify:
[{
  "name": "...",
  "industry": "...",
  "industry_category": "consumer_facing | contract_driven | both",
  "address": "...",
  "city": "...",
  "state": "...",
  "zip": "...",
  "main_phone": "...",
  "website": "...",
  "contact_name": null,
  "contact_title": null,
  "local_office_found": true,
  "local_office_address": "...",
  "local_field_employees_found": 8,
  "local_field_employee_titles": ["Fiber Technician x4", "Cable Splicer x2", "Field Supervisor x2"],
  "fleet_probability": 85,
  "fleet_note": "Strongest single signal found for why this company has a local fleet.",
  "research_notes": "What was found and where. What could NOT be verified and why.",
  "fleet_signals": ["local office confirmed", "8 field employees in Charlotte on LinkedIn", "company vehicle in job posting"],
  "estimated_fleet_size": "8-12 estimated from 8 local field employees — not confirmed",
  "vehicle_types_detected": ["light_duty_gas"],
  "vehicle_type_confidence": "confirmed | likely | unknown",
  "is_local_independent": true,
  "is_national_chain": false,
  "sources": [{"label": "LinkedIn employees search", "url": "https://..."}, {"label": "Google Maps listing", "url": "https://..."}]
}]`;

    let fullText = '';
    let inputTokens  = 0;
    let outputTokens = 0;

    // Handle multi-turn if Claude needs to use web_search tool
    const messages = [{ role: 'user', content: userPrompt }];
    let continueLoop = true;
    let turnCount = 0;

    while (continueLoop && turnCount < 5) {
      turnCount++;
      const response = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system:     systemPrompt,
        tools:      [{ type: 'web_search_20250305', name: 'web_search' }],
        messages,
      });

      inputTokens  += response.usage?.input_tokens  || 0;
      outputTokens += response.usage?.output_tokens || 0;

      if (response.stop_reason === 'end_turn') {
        // Extract text from the final response
        for (const block of response.content) {
          if (block.type === 'text') fullText += block.text;
        }
        continueLoop = false;
      } else if (response.stop_reason === 'tool_use') {
        // Add assistant turn and continue loop (web_search is server-side, API handles it)
        messages.push({ role: 'assistant', content: response.content });
        // Add empty tool results for any tool_use blocks (web_search handles itself)
        const toolResults = response.content
          .filter(b => b.type === 'tool_use')
          .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: '' }));
        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
        } else {
          continueLoop = false;
        }
      } else {
        continueLoop = false;
      }
    }

    // ── 7. Parse JSON from Claude response ────────────────────────────────────
    let companies = [];
    try {
      const jsonMatch = fullText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        companies = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('[fleetfinder] JSON parse error:', e.message);
    }

    // ── 8. Filter dismissed + already seen ────────────────────────────────────
    const now90 = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const filtered = [];
    for (const co of companies) {
      if (!co || !co.name) continue;
      const key = `${normalizeName(co.name)}|${normalizeAddress(co.address || '')}`;
      if (dismissedKeys.has(key)) continue;

      // Check against CRM existing (fuzzy)
      const normN = normalizeName(co.name);
      const isDupe = existingNames.some(en => stringSimilarity(normN, en) >= 0.85);
      if (isDupe) continue;

      // Mark as seen (expires in 90 days)
      await pool.query(
        `INSERT INTO fleet_finder_seen (name, address, city, state, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [co.name, co.address || null, co.city || null, co.state || null, now90]
      ).catch(() => {});

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
      ((inputTokens / 1_000_000) * PRICE_INPUT_PER_M +
       (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_M).toFixed(5)
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
