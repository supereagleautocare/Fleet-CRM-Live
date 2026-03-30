/**
 * FLEET CRM — COMPANY ROUTES (PostgreSQL)
 */

const express = require('express');
const { pool } = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { getNextCompanyId, appendCallLog, clearAllCompanyQueues, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

// ── Geocode queue ─────────────────────────────────────────────────────────────
const geocodeQueue = [];
let geocodeWorkerRunning = false;

function geocodeWorker() {
  if (geocodeQueue.length === 0) { geocodeWorkerRunning = false; return; }
  geocodeWorkerRunning = true;
  const { companyId, address, city } = geocodeQueue.shift();
  const cleanAddr = address.replace(/\s*(suite|ste\.?|unit|apt\.?|floor|fl\.?|#)\s*\S+/gi, '').trim();
  const full = encodeURIComponent(`${cleanAddr}, ${city || 'Charlotte'}, NC`);
  require('https').get(
    { hostname:'nominatim.openstreetmap.org', path:`/search?q=${full}&format=json&limit=1&countrycodes=us`, headers:{'User-Agent':'SuperEagleFleetCRM/1.0','Accept-Language':'en'} },
    res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const results = JSON.parse(raw);
          if (results.length > 0) {
            pool.query('UPDATE companies SET lat=$1, lng=$2 WHERE id=$3',
              [parseFloat(results[0].lat), parseFloat(results[0].lon), companyId]).catch(()=>{});
          }
        } catch(_) {}
        setTimeout(geocodeWorker, 1100);
      });
    }
  ).on('error', () => setTimeout(geocodeWorker, 1100));
}

function geocodeAndSave(companyId, address, city) {
  if (!address) return;
  geocodeQueue.push({ companyId, address, city });
  if (!geocodeWorkerRunning) geocodeWorker();
}

function normalizePhone(val) {
  return String(val || '').replace(/\D/g, '');
}
function normalizeName(val) {
  return String(val || '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(inc|llc|l\.l\.c|co|corp|corporation|company|ltd|limited)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function cleanDateOnly(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}
function contactDisplayName(val) {
  const name = String(val || '').trim();
  return name || 'Unnamed Contact';
}
// ═══════════════════════════════════════════════════════
// CALLING QUEUE
// ═══════════════════════════════════════════════════════

router.get('/queue/list', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT q.*, c.name AS company_name, c.company_id AS company_id_str, c.main_phone, c.industry, c.address, c.city,
        cc.name AS preferred_contact_name, cc.direct_line AS preferred_direct_line,
        cc.email AS preferred_email, cc.role_title AS preferred_role
      FROM calling_queue q
      JOIN companies c ON c.id=q.entity_id
      LEFT JOIN company_contacts cc ON cc.company_id=c.company_id AND cc.is_preferred=1
      WHERE q.queue_type='company'
      ORDER BY q.added_at ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/queue', async (req, res) => {
  try {
    const { company_id } = req.body;
    if (!company_id) return res.status(400).json({ error: 'company_id is required.' });
    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id=$1', [company_id]);
    if (!coRows[0]) return res.status(404).json({ error: 'Company not found.' });
    const { rows: ex } = await pool.query("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [company_id]);
    if (ex[0]) return res.status(409).json({ error: 'Company is already in the calling queue.' });
    const { rows } = await pool.query("INSERT INTO calling_queue (queue_type,entity_id,added_by) VALUES ('company',$1,$2) RETURNING *", [company_id, req.user.id]);
    // Also set pipeline stage to 'call' so it appears in the calling queue
    await pool.query("UPDATE companies SET pipeline_stage='call' WHERE id=$1 AND pipeline_stage='new'", [company_id]);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/queue/:queueId', async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM calling_queue WHERE id=$1 AND queue_type='company'", [req.params.queueId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Queue entry not found.' });
    res.json({ message: 'Removed from queue.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
// ═══════════════════════════════════════════════════════
// COMPANY PROFILES
// ═══════════════════════════════════════════════════════

// GET /api/companies
router.get('/', async (req, res) => {
  try {
    const { search, industry, status = 'active', company_status, pipeline_stage, last_contacted } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (status !== 'all') { params.push(status); where += ` AND c.status = $${params.length}`; }
    if (search) {
      const s = `%${search}%`;
      params.push(s); where += ` AND (c.name ILIKE $${params.length} OR c.main_phone ILIKE $${params.length} OR c.industry ILIKE $${params.length})`;
    }
    if (industry)        { params.push(industry);        where += ` AND c.industry = $${params.length}`; }
    if (company_status)  { params.push(company_status);  where += ` AND c.company_status = $${params.length}`; }
    if (pipeline_stage)  { params.push(pipeline_stage);  where += ` AND c.pipeline_stage = $${params.length}`; }
    if (last_contacted === 'never')      { where += ` AND cl.logged_at IS NULL`; }
    else if (last_contacted === 'this_week')  { where += ` AND cl.logged_at >= now() - interval '7 days'`; }
    else if (last_contacted === 'this_month') { where += ` AND cl.logged_at >= now() - interval '30 days'`; }
    else if (last_contacted === 'stale')      { where += ` AND (cl.logged_at IS NULL OR cl.logged_at < now() - interval '30 days')`; }

    const { rows } = await pool.query(`
      SELECT c.*,
        cc.name           as preferred_contact_name,
        cc.role_title     as preferred_contact_role,
        cl.contact_type   as last_contact_type,
        cl.logged_at      as last_contacted,
        fu.due_date       as followup_due,
        fu.next_action    as followup_action
      FROM companies c
      LEFT JOIN company_contacts cc ON cc.company_id=c.company_id AND cc.is_preferred=1
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at
        FROM call_log WHERE log_type='company'
        ORDER BY entity_id, id DESC
      ) cl ON cl.entity_id=c.id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, due_date, next_action
        FROM follow_ups WHERE source_type='company'
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id=c.id
      ${where}
      ORDER BY c.name ASC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/companies/nearby-data
router.get('/nearby-data', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.company_id, c.name, c.main_phone, c.industry,
        c.address, c.city, c.state, c.zip, c.lat, c.lng,
        cl.contact_type AS last_contact_type,
        cl.logged_at    AS last_contacted,
        cl.notes        AS last_notes,
        cl.contact_name AS last_contact_name,
        fu.due_date     AS followup_due,
        fu.id           AS followup_id
      FROM companies c
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, notes, contact_name
        FROM call_log WHERE log_type='company'
        ORDER BY entity_id, id DESC
      ) cl ON cl.entity_id=c.id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, due_date, id
        FROM follow_ups WHERE source_type='company'
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id=c.id
      WHERE c.status='active'
      ORDER BY c.name ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/companies/search-name
router.get('/search-name', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json([]);
    const { rows } = await pool.query(`
      SELECT id, name, main_phone, address, city, is_multi_location, location_name, location_group
      FROM companies WHERE name ILIKE $1 AND status='active'
      ORDER BY name ASC LIMIT 10
    `, [`%${q.trim()}%`]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/companies/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const [contactsRes, statsRes, followupRes, branchRes, queueRes, followUpRes] = await Promise.all([
      pool.query('SELECT * FROM company_contacts WHERE company_id=$1 ORDER BY is_preferred DESC, name ASC', [company.company_id]),
      pool.query(`SELECT COUNT(*) as total_calls, MAX(logged_at) as last_contacted, MIN(logged_at) as first_contacted,
        SUM(CASE WHEN action_type!='Move' THEN 1 ELSE 0 END) as total_contacts
        FROM call_log WHERE entity_id=$1 AND log_type='company'`, [req.params.id]),
      pool.query(`SELECT due_date, next_action FROM follow_ups WHERE entity_id=$1 AND source_type='company' AND is_locked=0 ORDER BY due_date ASC LIMIT 1`, [req.params.id]),
      company.location_group
        ? pool.query(`SELECT c.id, c.name, c.location_name, c.main_phone, c.address, c.city,
            cl.contact_type AS last_contact_type, cl.logged_at AS last_contacted
            FROM companies c
            LEFT JOIN (SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at FROM call_log WHERE log_type='company' ORDER BY entity_id, id DESC) cl ON cl.entity_id=c.id
            WHERE c.location_group=$1 AND c.id!=$2 ORDER BY c.name ASC`, [company.location_group, company.id])
        : Promise.resolve({ rows: [] }),
      pool.query("SELECT id, added_at FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [req.params.id]),
      pool.query("SELECT due_date, next_action FROM follow_ups WHERE entity_id=$1 AND source_type='company' AND is_locked=0 ORDER BY id DESC LIMIT 1", [req.params.id]),
    ]);

    res.json({
      ...company,
      contacts: contactsRes.rows,
      stats: statsRes.rows[0],
      branches: branchRes.rows,
      in_queue: !!queueRes.rows[0],
      queue_entry: queueRes.rows[0] || null,
      follow_up: followUpRes.rows[0] || null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/companies
router.post('/', async (req, res) => {
  try {
    const { name, main_phone, industry, address, city, state, zip, website, notes, is_multi_location, location_name, location_group } = req.body;
    if (!name) return res.status(400).json({ error: 'Company name is required.' });

    if (main_phone) {
      const { rows: dupe } = await pool.query('SELECT id FROM companies WHERE main_phone=$1', [main_phone]);
      if (dupe[0]) return res.status(409).json({ error: 'A company with that phone number already exists.', existing_id: dupe[0].id });
    }

    const company_id = await getNextCompanyId();
    const { rows } = await pool.query(`
      INSERT INTO companies (company_id, name, main_phone, industry, address, city, state, zip, website, notes, is_multi_location, location_name, location_group)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [company_id, name.trim(), main_phone||null, industry||null, address||null, city||null,
        state||null, zip||null, website||null, notes||null,
        is_multi_location ? 1 : 0, location_name||null, location_group||name.trim()]);
    geocodeAndSave(rows[0].id, address, city);
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/companies/:id
router.put('/:id', async (req, res) => {
  try {
    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    if (!coRows[0]) return res.status(404).json({ error: 'Company not found.' });

    const fields = ['name','main_phone','industry','address','city','state','zip','website','notes','status','is_multi_location','location_group','location_name'];
    const updates = [], values = [];
    let i = 1;
    for (const f of fields) {
      if (req.body[f] !== undefined) { updates.push(`${f}=$${i++}`); values.push(req.body[f]); }
    }
    if (!updates.length) return res.status(400).json({ error: 'No fields to update.' });
    updates.push(`updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
    values.push(req.params.id);
    const { rows } = await pool.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i} RETURNING *`, values);
    if (req.body.address !== undefined) geocodeAndSave(req.params.id, rows[0].address, rows[0].city);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
// COMPANY CONTACTS
// ═══════════════════════════════════════════════════════

router.get('/:id/contacts', async (req, res) => {
  try {
    const { rows: coRows } = await pool.query('SELECT company_id FROM companies WHERE id=$1', [req.params.id]);
    if (!coRows[0]) return res.status(404).json({ error: 'Company not found.' });
    const { rows } = await pool.query('SELECT * FROM company_contacts WHERE company_id=$1 ORDER BY is_preferred DESC, name ASC', [coRows[0].company_id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/contacts', async (req, res) => {
  try {
    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    const { name, role_title, direct_line, email, is_preferred, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Contact name is required.' });
    if (is_preferred) await pool.query('UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1', [company.company_id]);
    const { rows } = await pool.query(
      'INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred,notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [company.company_id, name.trim(), role_title||null, direct_line||null, email||null, is_preferred?1:0, notes||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/contacts/:contactId', async (req, res) => {
  try {
    const { rows: ctRows } = await pool.query('SELECT * FROM company_contacts WHERE id=$1', [req.params.contactId]);
    const contact = ctRows[0];
    if (!contact) return res.status(404).json({ error: 'Contact not found.' });
    const { name, role_title, direct_line, email, is_preferred, notes } = req.body;
    if (is_preferred) await pool.query('UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1', [contact.company_id]);
    const { rows } = await pool.query(`
      UPDATE company_contacts SET name=$1, role_title=$2, direct_line=$3, email=$4, is_preferred=$5, notes=$6,
        updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id=$7 RETURNING *
    `, [
      name ?? contact.name, role_title ?? contact.role_title,
      direct_line ?? contact.direct_line, email ?? contact.email,
      is_preferred !== undefined ? (is_preferred?1:0) : contact.is_preferred,
      notes ?? contact.notes, req.params.contactId
    ]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/contacts/:contactId', async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM company_contacts WHERE id=$1', [req.params.contactId]);
    if (rowCount === 0) return res.status(404).json({ error: 'Contact not found.' });
    res.json({ message: 'Contact deleted.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// ═══════════════════════════════════════════════════════
// COMPLETE A COMPANY CALL
// ═══════════════════════════════════════════════════════

router.post('/queue/:queueId/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: qRows } = await client.query("SELECT * FROM calling_queue WHERE id=$1 AND queue_type='company'", [req.params.queueId]);
    if (!qRows[0]) return res.status(404).json({ error: 'Queue entry not found.' });
    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id=$1', [qRows[0].entity_id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const {
      contact_type, contact_name, direct_line, email, role_title, notes, next_action,
      set_as_preferred, next_action_date_override, number_dialed,
      referral_name, referral_role, referral_phone, referral_email, save_referral_as_contact,
    } = req.body;

    if (!contact_type) return res.status(400).json({ error: 'contact_type is required.' });
    if (!next_action)  return res.status(400).json({ error: 'next_action is required.' });

    const { rows: priorRows } = await client.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id=$1 AND log_type='company'", [company.id]
    );
    const priorAttempts = parseInt(priorRows[0].cnt);

    await client.query('BEGIN');

    const logEntry = await appendCallLog({
      log_type:'company', entity_id:company.id, company_id_str:company.company_id,
      entity_name:company.name, phone:company.main_phone, direct_line:direct_line||null,
      contact_name:contact_name||null, role_title:role_title||null, email:email||null,
      industry:company.industry, action_type:'Call', contact_type,
      notes:notes||null, next_action, next_action_date:null,
      attempt_number:priorAttempts+1, logged_by:req.user.id, logged_by_name:req.user.name,
      number_dialed:number_dialed||null, referral_name:referral_name||null,
      referral_role:referral_role||null, referral_phone:referral_phone||null,
      referral_email:referral_email||null,
    });

    if (save_referral_as_contact && referral_name) {
      const { rows: ex } = await client.query('SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2', [company.company_id, referral_name]);
      if (ex[0]) {
        await client.query(`UPDATE company_contacts SET direct_line=COALESCE($1,direct_line), email=COALESCE($2,email), role_title=COALESCE($3,role_title), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$4`,
          [referral_phone||null, referral_email||null, referral_role||null, ex[0].id]);
      } else {
        await client.query('INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,0)',
          [company.company_id, referral_name, referral_role||null, referral_phone||null, referral_email||null]);
      }
    }

    if (set_as_preferred && contact_name) {
      await client.query('UPDATE company_contacts SET is_preferred=0 WHERE company_id=$1', [company.company_id]);
      const { rows: ex } = await client.query('SELECT id FROM company_contacts WHERE company_id=$1 AND name=$2', [company.company_id, contact_name]);
      if (ex[0]) {
        await client.query(`UPDATE company_contacts SET is_preferred=1, direct_line=COALESCE($1,direct_line), email=COALESCE($2,email), role_title=COALESCE($3,role_title), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$4`,
          [direct_line||null, email||null, role_title||null, ex[0].id]);
      } else {
        await client.query('INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,1)',
          [company.company_id, contact_name, role_title||null, direct_line||null, email||null]);
      }
    }

    await scheduleNextAction(pool, {
      company, contact_type, next_action, next_action_date_override,
      contact_name:contact_name||null, direct_line:direct_line||null, email:email||null, log_id:logEntry.id,
    });

    await client.query('DELETE FROM calling_queue WHERE id=$1', [req.params.queueId]);
    await client.query('COMMIT');
    res.json({ message:'Call logged successfully.', log_id:logEntry.id, next_action, attempt_number:priorAttempts+1 });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error:'Failed to log call: '+e.message });
  } finally { client.release(); }
});

// ═══════════════════════════════════════════════════════
// HISTORY / FOLLOWUP
// ═══════════════════════════════════════════════════════

router.get('/:id/history', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT cl.*, u.name AS logged_by_name,
        se.id AS scorecard_id, se.total_score AS scorecard_total,
        se.max_score AS scorecard_max, se.script_ids AS scorecard_script_ids
      FROM call_log cl
      LEFT JOIN users u ON u.id=cl.logged_by
      LEFT JOIN scorecard_entries se ON cl.action_type='Call' AND se.entity_id=cl.entity_id
        AND (se.call_log_id=cl.id OR (se.call_log_id IS NULL AND ABS(EXTRACT(EPOCH FROM (se.logged_at::timestamp - cl.logged_at::timestamp))) < 300))
      WHERE cl.entity_id=$1 AND cl.log_type='company'
      ORDER BY cl.logged_at DESC
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/followup', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM follow_ups WHERE entity_id=$1 AND source_type='company' ORDER BY id DESC LIMIT 1", [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/followup-date', async (req, res) => {
  try {
    const { due_date, action } = req.body;
    if (!due_date) return res.status(400).json({ error: 'due_date is required.' });
    const { rows: coRows } = await pool.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const stageMap = { Call:'call', Visit:'visit', Mail:'mail', Email:'email' };
    const newStage = stageMap[action] || 'call';
    await pool.query('UPDATE companies SET pipeline_stage=$1 WHERE id=$2', [newStage, company.id]);

    const { rows: fuRows } = await pool.query("SELECT * FROM follow_ups WHERE entity_id=$1 AND source_type='company'", [req.params.id]);
    if (fuRows[0]) {
      await pool.query('UPDATE follow_ups SET due_date=$1, next_action=$2 WHERE id=$3', [due_date, action||'Call', fuRows[0].id]);
    } else {
      await pool.query("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action) VALUES ('company',$1,$2,$3,$4,$5,$6)",
        [company.id, company.company_id, company.name, company.main_phone, due_date, action||'Call']);
    }

    if (action === 'Visit') {
      const { rows: prefRows } = await pool.query('SELECT * FROM company_contacts WHERE company_id=$1 AND is_preferred=1', [company.company_id]);
      const preferred = prefRows[0];
      await pool.query(`INSERT INTO visit_queue (company_id,entity_id,entity_name,scheduled_date,address,city,contact_name,direct_line,email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [company.company_id, company.id, company.name, due_date, company.address||'', company.city||'',
         preferred?.name||null, preferred?.direct_line||null, preferred?.email||null]);
    }

    const today = new Date().toISOString().split('T')[0];
    await pool.query(`INSERT INTO call_log (log_type,entity_id,company_id_str,entity_name,action_type,contact_type,notes,next_action,next_action_date,logged_at)
      VALUES ('company',$1,$2,$3,'Move','Rescheduled',$4,$5,$6,$7)`,
      [company.id, company.company_id, company.name, `Rescheduled ${action||'Call'} follow-up to ${due_date}`, action||'Call', due_date, today]);

    res.json({ message:'Follow-up updated.', due_date, stage:newStage });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/geocode', async (req, res) => {
  try {
    const { lat, lng } = req.body;
    await pool.query('UPDATE companies SET lat=$1, lng=$2 WHERE id=$3', [lat||null, lng||null, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
// BULK IMPORT
// ═══════════════════════════════════════════════════════

router.post('/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { companies, add_to_queue = false } = req.body;
    if (!Array.isArray(companies) || companies.length === 0)
      return res.status(400).json({ error: 'Provide an array of companies to import.' });

    const results = { imported:0, skipped:0, contacts:0, history:0, duplicate_history:0, matched_existing:0, errors:[] };

    await client.query('BEGIN');

    const { rows: existingCompanies } = await client.query(`SELECT id, company_id, name, main_phone, address, city, state, zip, location_group FROM companies WHERE status='active'`);

    for (const row of companies) {
      const name = (row.name || '').trim();
      const phone = normalizePhone(row.main_phone);
      const normalizedName = normalizeName(name);
      if (!name) { results.skipped++; continue; }

      let existingId = null;
      const exactNamePhone = existingCompanies.find(co => normalizedName && phone && normalizeName(co.name)===normalizedName && normalizePhone(co.main_phone)===phone);
      if (exactNamePhone) { existingId = exactNamePhone.id; results.matched_existing++; }
      if (!existingId) { const byName = existingCompanies.find(co => normalizedName && normalizeName(co.name)===normalizedName); if (byName) existingId = byName.id; }
      if (!existingId) { const byPhone = existingCompanies.find(co => phone && normalizePhone(co.main_phone)===phone); if (byPhone) existingId = byPhone.id; }

      let companyDbId, companyIdStr;

      if (existingId) {
        const { rows: ex } = await client.query('SELECT * FROM companies WHERE id=$1', [existingId]);
        companyDbId = ex[0].id; companyIdStr = ex[0].company_id;
        await client.query(`UPDATE companies SET industry=COALESCE(NULLIF(industry,''),$1), address=COALESCE(NULLIF(address,''),$2), city=COALESCE(NULLIF(city,''),$3), state=COALESCE(NULLIF(state,''),$4), zip=COALESCE(NULLIF(zip,''),$5), website=COALESCE(NULLIF(website,''),$6), notes=COALESCE(NULLIF(notes,''),$7), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$8`,
          [row.industry||null, row.address||null, row.city||null, row.state||null, row.zip||null, row.website||null, row.notes||null, existingId]);
        results.skipped++;
      } else {
        const company_id = await getNextCompanyId();
        const { rows: ins } = await client.query(`INSERT INTO companies (company_id,name,main_phone,industry,address,city,state,zip,website,notes,pipeline_stage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new') RETURNING id, company_id`,
          [company_id, name, phone||null, row.industry||null, row.address||null, row.city||null, row.state||null, row.zip||null, row.website||null, row.notes||null]);
        companyDbId = ins[0].id; companyIdStr = ins[0].company_id;
        results.imported++;
        existingCompanies.push({ id:companyDbId, company_id, name, main_phone:phone||null });
        geocodeAndSave(companyDbId, row.address, row.city);

        if (add_to_queue) {
          const { rows: inQ } = await client.query("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [companyDbId]);
          if (!inQ[0]) await client.query("INSERT INTO calling_queue (queue_type,entity_id,added_by) VALUES ('company',$1,$2)", [companyDbId, req.user.id]);
        }

        if (row.is_dnc) {
          await client.query("DELETE FROM follow_ups WHERE entity_id=$1 AND source_type='company'", [companyDbId]);
          await client.query("UPDATE companies SET pipeline_stage='dead' WHERE id=$1", [companyDbId]);
        } else if (cleanDateOnly(row.next_follow_up)) {
          const dueDate = cleanDateOnly(row.next_follow_up);
          await client.query("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action,next_action_date) VALUES ('company',$1,$2,$3,$4,$5,'Call',$6)",
            [companyDbId, companyIdStr, name, phone||null, dueDate, dueDate]);
          await client.query("UPDATE companies SET pipeline_stage='call' WHERE id=$1", [companyDbId]);
        }
      }

      if (Array.isArray(row.contacts)) {
        let preferredSet = false;
        for (const c of row.contacts) {
          const cname = contactDisplayName(c.name);
          const directLine = normalizePhone(c.direct_line);
          const emailVal = String(c.email||'').trim().toLowerCase()||null;
          const roleTitle = String(c.role_title||'').trim()||null;
          const { rows: dup } = await client.query(`SELECT id FROM company_contacts WHERE company_id=$1 AND lower(name)=lower($2) AND COALESCE(direct_line,'')=COALESCE($3,'') AND COALESCE(lower(email),'')=COALESCE($4,'') AND COALESCE(lower(role_title),'')=COALESCE(lower($5),'')`,
            [companyIdStr, cname, directLine||'', emailVal||'', roleTitle||'']);
          if (!dup[0]) {
            const shouldPrefer = !preferredSet && c.is_preferred ? 1 : 0;
            await client.query('INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,is_preferred) VALUES ($1,$2,$3,$4,$5,$6)',
              [companyIdStr, cname, roleTitle, directLine||null, emailVal, shouldPrefer]);
            if (shouldPrefer) preferredSet = true;
            results.contacts++;
          }
        }
      }

      if (Array.isArray(row.history)) {
        for (const h of row.history) {
          if (!h.contact_type && !h.notes) continue;
          const loggedAt = h.logged_at || h.contact_date || new Date().toISOString();
          await client.query(`INSERT INTO call_log (log_type,log_category,entity_id,company_id_str,entity_name,phone,industry,contact_type,contact_name,role_title,direct_line,email,notes,action_type,next_action,next_action_date,attempt_number,logged_at,logged_by_name,counts_as_attempt)
            VALUES ('company','call',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,1)`,
            [companyDbId, companyIdStr, name, phone||null, row.industry||null,
             h.contact_type||'Spoke To', contactDisplayName(h.contact_name), h.role_title||null,
             normalizePhone(h.direct_line)||null, h.email||null, h.notes||null, h.action_type||'Call',
             'Call', cleanDateOnly(h.next_action_date), h.attempt_number||1, loggedAt, h.logged_by||'Import']);
          results.history++;
        }
      }
    }

    await client.query('COMMIT');
    res.status(201).json(results);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error:'Import failed: '+e.message });
  } finally { client.release(); }
});

router.post('/import-new-companies', async (req, res) => {
  const client = await pool.connect();
  try {
    const { companies } = req.body;
    if (!Array.isArray(companies) || companies.length === 0)
      return res.status(400).json({ error: 'Provide an array of companies to import.' });

    const results = { imported:0, duplicates:0, possible_duplicates:0, chains:0, review:[], errors:[] };
    await client.query('BEGIN');

    const { rows: existingCompanies } = await client.query(`SELECT id, company_id, name, main_phone, address, city, state, zip, location_group FROM companies WHERE status='active'`);

    for (const row of companies) {
      const name = String(row.name||'').trim();
      const phone = normalizePhone(row.main_phone);
      const normalizedName = normalizeName(name);
      if (!name) { results.errors.push({ row, error:'Missing company name' }); continue; }

      const exactNamePhone = existingCompanies.find(co => normalizedName && phone && normalizeName(co.name)===normalizedName && normalizePhone(co.main_phone)===phone);
      if (exactNamePhone) {
        results.duplicates++;
        results.review.push({ type:'duplicate', action:'review', incoming:row, matched_company_id:exactNamePhone.id, matched_name:exactNamePhone.name, matched_phone:exactNamePhone.main_phone });
        continue;
      }
      const sameName = existingCompanies.find(co => normalizedName && normalizeName(co.name)===normalizedName);
      if (sameName) {
        results.possible_duplicates++;
        results.review.push({ type:'possible_duplicate_or_chain', action:'review', incoming:row, matched_company_id:sameName.id, matched_name:sameName.name, matched_phone:sameName.main_phone });
        continue;
      }

      const company_id = await getNextCompanyId();
      const { rows: ins } = await client.query(`INSERT INTO companies (company_id,name,main_phone,industry,address,city,state,zip,website,notes,pipeline_stage) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'new') RETURNING id`,
        [company_id, name, phone||null, row.industry||null, row.address||null, row.city||null, row.state||null, row.zip||null, row.website||null, row.notes||null]);
      existingCompanies.push({ id:ins[0].id, company_id, name, main_phone:phone||null, address:row.address||null, city:row.city||null, state:row.state||null, zip:row.zip||null, location_group:null });
      results.imported++;
      geocodeAndSave(ins[0].id, row.address, row.city);
    }

    await client.query('COMMIT');
    res.status(201).json(results);
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error:'New company import failed: '+e.message });
  } finally { client.release(); }
});

router.post('/backfill-followups', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { rows: companies } = await pool.query(`
      SELECT c.id, c.company_id, c.name, c.main_phone, c.pipeline_stage FROM companies c
      WHERE c.status='active' AND c.pipeline_stage IN ('new','call')
        AND NOT EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=c.id AND source_type='company')
    `);
    let created = 0;
    for (const co of companies) {
      await pool.query("INSERT INTO follow_ups (source_type,entity_id,company_id_str,entity_name,phone,due_date,next_action) VALUES ('company',$1,$2,$3,$4,$5,'Call')",
        [co.id, co.company_id, co.name, co.main_phone, today]);
      await pool.query("UPDATE companies SET pipeline_stage='call' WHERE id=$1", [co.id]);
      created++;
    }
    res.json({ message:`Created ${created} follow-up records.`, created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════
// MERGE TWO COMPANIES
// ═══════════════════════════════════════════════════════

router.post('/:id/merge/:into_id', async (req, res) => {
  const client = await pool.connect();
  try {
    const sourceId = parseInt(req.params.id);
    const targetId = parseInt(req.params.into_id);
    const { field_choices = {} } = req.body;
    if (sourceId === targetId) return res.status(400).json({ error:'Cannot merge a company into itself.' });

    const { rows: sRows } = await client.query('SELECT * FROM companies WHERE id=$1', [sourceId]);
    const source = sRows[0];
    if (!source) return res.status(404).json({ error:'Source company not found.' });
    const { rows: tRows } = await client.query('SELECT * FROM companies WHERE id=$1', [targetId]);
    const target = tRows[0];
    if (!target) return res.status(404).json({ error:'Target company not found.' });

    const MERGEABLE_FIELDS = ['name','main_phone','industry','address','city','state','zip','website','notes'];
    await client.query('BEGIN');

    const updates = [], values = [];
    let i = 1;
    for (const field of MERGEABLE_FIELDS) {
      const choice = field_choices[field] || 'target';
      const srcVal = source[field], tgtVal = target[field];
      if (field==='main_phone' && choice==='both' && srcVal && tgtVal) {
        updates.push(`main_phone=$${i++}`); values.push(tgtVal);
        const { rows: altEx } = await client.query('SELECT id FROM company_contacts WHERE company_id=$1 AND direct_line=$2', [target.company_id, srcVal]);
        if (!altEx[0]) await client.query('INSERT INTO company_contacts (company_id,name,role_title,direct_line,is_preferred) VALUES ($1,$2,$3,$4,0)',
          [target.company_id, source.name+' (alternate number)', 'Alternate Phone', srcVal]);
        continue;
      }
      let merged;
      if (choice==='source') merged = srcVal||tgtVal;
      else if (choice==='combine' && srcVal && tgtVal) merged = tgtVal+'\n\n---\n\n'+srcVal;
      else merged = tgtVal||srcVal;
      if (merged !== undefined) { updates.push(`${field}=$${i++}`); values.push(merged); }
    }

    if (target.pipeline_stage==='new' && source.pipeline_stage!=='new') { updates.push(`pipeline_stage=$${i++}`); values.push(source.pipeline_stage); }
    if ((!target.company_status||target.company_status==='prospect') && source.company_status && source.company_status!=='prospect') { updates.push(`company_status=$${i++}`); values.push(source.company_status); }
    updates.push(`updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);
    values.push(targetId);
    if (updates.length > 1) await client.query(`UPDATE companies SET ${updates.join(',')} WHERE id=$${i}`, values);

    await client.query(`UPDATE call_log SET entity_id=$1, company_id_str=$2, entity_name=$3 WHERE entity_id=$4 AND log_type='company'`, [targetId, target.company_id, target.name, sourceId]);

    const { rows: existingContacts } = await client.query('SELECT name FROM company_contacts WHERE company_id=$1', [target.company_id]);
    const existingNames = existingContacts.map(c => c.name.toLowerCase().trim());
    const { rows: sourceContacts } = await client.query('SELECT * FROM company_contacts WHERE company_id=$1', [source.company_id]);
    for (const contact of sourceContacts) {
      if (existingNames.includes(contact.name.toLowerCase().trim())) {
        await client.query(`UPDATE company_contacts SET direct_line=COALESCE(NULLIF(direct_line,''),$1), email=COALESCE(NULLIF(email,''),$2), role_title=COALESCE(NULLIF(role_title,''),$3), notes=COALESCE(NULLIF(notes,''),$4) WHERE company_id=$5 AND lower(name)=lower($6)`,
          [contact.direct_line||null, contact.email||null, contact.role_title||null, contact.notes||null, target.company_id, contact.name]);
      } else {
        await client.query('INSERT INTO company_contacts (company_id,name,role_title,direct_line,email,notes,is_preferred) VALUES ($1,$2,$3,$4,$5,$6,0)',
          [target.company_id, contact.name, contact.role_title||null, contact.direct_line||null, contact.email||null, contact.notes||null]);
        existingNames.push(contact.name.toLowerCase().trim());
      }
    }

    const { rows: srcFU } = await client.query("SELECT * FROM follow_ups WHERE entity_id=$1 AND source_type='company' ORDER BY id DESC LIMIT 1", [sourceId]);
    const { rows: tgtFU } = await client.query("SELECT * FROM follow_ups WHERE entity_id=$1 AND source_type='company' ORDER BY id DESC LIMIT 1", [targetId]);
    if (srcFU[0] && !tgtFU[0]) {
      await client.query("UPDATE follow_ups SET entity_id=$1, company_id_str=$2, entity_name=$3, phone=$4 WHERE entity_id=$5 AND source_type='company'",
        [targetId, target.company_id, target.name, target.main_phone, sourceId]);
    } else if (srcFU[0] && tgtFU[0]) {
      if (srcFU[0].due_date < tgtFU[0].due_date) await client.query('UPDATE follow_ups SET due_date=$1, next_action=$2 WHERE id=$3', [srcFU[0].due_date, srcFU[0].next_action, tgtFU[0].id]);
      await client.query("DELETE FROM follow_ups WHERE entity_id=$1 AND source_type='company'", [sourceId]);
    } else {
      await client.query("DELETE FROM follow_ups WHERE entity_id=$1 AND source_type='company'", [sourceId]);
    }

    const { rows: tgtInQueue } = await client.query("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [targetId]);
    if (!tgtInQueue[0]) {
      await client.query("UPDATE calling_queue SET entity_id=$1 WHERE queue_type='company' AND entity_id=$2", [targetId, sourceId]);
    } else {
      await client.query("DELETE FROM calling_queue WHERE queue_type='company' AND entity_id=$1", [sourceId]);
    }

    await client.query('UPDATE visit_queue SET company_id=$1, entity_id=$2, entity_name=$3 WHERE entity_id=$4', [target.company_id, targetId, target.name, sourceId]);
    await client.query('UPDATE scorecard_entries SET entity_id=$1, entity_name=$2 WHERE entity_id=$3', [targetId, target.name, sourceId]);
    await client.query(`INSERT INTO call_log (log_type,log_category,entity_id,company_id_str,entity_name,action_type,contact_type,notes,logged_at) VALUES ('company','move',$1,$2,$3,'Move','Merged',$4,to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'))`,
      [targetId, target.company_id, target.name, `Merged from: ${source.name} (ID: ${source.company_id})`]);

    await client.query('DELETE FROM company_contacts WHERE company_id=$1', [source.company_id]);
    await client.query('DELETE FROM companies WHERE id=$1', [sourceId]);
    await client.query('COMMIT');

    const { rows: merged } = await pool.query('SELECT * FROM companies WHERE id=$1', [targetId]);
    res.json({ ok:true, merged_into:merged[0] });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error:'Merge failed: '+e.message });
  } finally { client.release(); }
});

// GET /api/companies/:id/geocode-lookup
router.get('/:id/geocode-lookup', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error:'Not found' });
    if (company.lat && company.lng) return res.json({ lat:company.lat, lng:company.lng, cached:true });
    if (!company.address) return res.status(400).json({ error:'No address' });

    const https = require('https');
    const query = encodeURIComponent(`${company.address}, ${company.city||'Charlotte'}, ${company.state||'NC'}`);
    const data = await new Promise((resolve, reject) => {
      https.get(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=us`,
        { headers:{'User-Agent':'SuperEagleFleetCRM/1.0','Accept-Language':'en'} },
        response => {
          let body = '';
          response.on('data', chunk => body+=chunk);
          response.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('Parse failed')); } });
        }).on('error', reject);
    });

    if (data.length > 0) {
      const lat = parseFloat(data[0].lat), lng = parseFloat(data[0].lon);
      await pool.query('UPDATE companies SET lat=$1, lng=$2 WHERE id=$3', [lat, lng, company.id]);
      return res.json({ lat, lng, cached:false });
    }
    return res.status(404).json({ error:'Address not found' });
  } catch (err) { res.status(500).json({ error:err.message }); }
});
// DELETE /api/companies/:id
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    const company = rows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });
    await client.query('BEGIN');
    await client.query('DELETE FROM call_log WHERE entity_id = $1 AND log_type = $2', [company.id, 'company']);
    await client.query('DELETE FROM follow_ups WHERE entity_id = $1 AND source_type = $2', [company.id, 'company']);
    await client.query('DELETE FROM calling_queue WHERE entity_id = $1', [company.id]);
    await client.query('DELETE FROM visit_queue WHERE entity_id = $1', [company.id]);
    await client.query('DELETE FROM company_contacts WHERE company_id = $1', [company.company_id]);
    await client.query('DELETE FROM companies WHERE id = $1', [company.id]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Delete failed: ' + e.message });
  } finally { client.release(); }
});
module.exports = router;
