/**
 * FLEET CRM — PIPELINE ROUTES (PostgreSQL)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, calcFollowUpDate, clearAllCompanyQueues, scheduleNextAction } = require('./shared');

const router = express.Router();
router.use(requireAuth);

const STAGES = ['new', 'call', 'mail', 'email', 'visit', 'dead'];

// ── Helper: set company stage and log the move ────────────────────────────────
async function moveCompany(db, companyId, newStage, userId, userName, notes) {
  const { rows } = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
  const company = rows[0];
  if (!company) return null;

  const oldStage = company.pipeline_stage || 'new';
  if (oldStage === newStage) return company;

  await db.query(
    `UPDATE companies SET pipeline_stage=$1, stage_updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$2`,
    [newStage, companyId]
  );

  await appendCallLog(db, {
    log_type: 'company',
    entity_id: company.id,
    company_id_str: company.company_id,
    entity_name: company.name,
    phone: company.main_phone,
    industry: company.industry,
    action_type: 'Move',
    contact_type: 'Moved',
    notes: notes || `Moved from ${oldStage} → ${newStage}`,
    next_action: null,
    attempt_number: 0,
    logged_by: userId,
    logged_by_name: userName,
    log_category: 'move',
    counts_as_attempt: 0,
  });

  const { rows: updated } = await db.query('SELECT * FROM companies WHERE id = $1', [companyId]);
  return updated[0];
}

// ── Pipeline board counts ─────────────────────────────────────────────────────
router.get('/board', async (req, res) => {
  try {
    const counts = {};
    await Promise.all(STAGES.map(async stage => {
      const { rows } = await req.db.query(
        stage === 'new'
          ? "SELECT COUNT(*) as cnt FROM companies WHERE (pipeline_stage='new' OR pipeline_stage IS NULL) AND status='active'"
          : "SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage=$1 AND status='active'",
        stage === 'new' ? [] : [stage]
      );
      counts[stage] = parseInt(rows[0].cnt);
    }));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const [starredRes, recentCallsRes, recentContactsRes, totalContactsRes] = await Promise.all([
      req.db.query("SELECT COUNT(*) as cnt FROM companies WHERE is_starred=1 AND status='active'"),
      req.db.query("SELECT COUNT(*) as cnt FROM call_log WHERE log_type='company' AND action_type='Call' AND counts_as_attempt=1 AND substring(logged_at,1,10) >= $1", [sevenDaysAgo]),
      req.db.query("SELECT COUNT(*) as cnt FROM call_log WHERE log_type='company' AND action_type!='Move' AND substring(logged_at,1,10) >= $1", [sevenDaysAgo]),
      req.db.query("SELECT COUNT(*) as cnt FROM call_log WHERE log_type='company' AND action_type!='Move'"),
    ]);

    counts.starred = parseInt(starredRes.rows[0].cnt);
    res.json({
      counts,
      recentCalls:    parseInt(recentCallsRes.rows[0].cnt),
      recentContacts: parseInt(recentContactsRes.rows[0].cnt),
      totalContacts:  parseInt(totalContactsRes.rows[0].cnt),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Sidebar badge counts ──────────────────────────────────────────────────────
router.get('/counts', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const [callingRes, mailRes, emailRes, visitsRes] = await Promise.all([
      req.db.query(`
        SELECT COUNT(DISTINCT c.id) as cnt
        FROM companies c
        LEFT JOIN (
          SELECT DISTINCT ON (entity_id) id, entity_id, due_date
          FROM follow_ups WHERE source_type='company' AND is_locked=0
          ORDER BY entity_id, id DESC
        ) fu ON fu.entity_id = c.id
        LEFT JOIN calling_queue cq ON cq.entity_id = c.id AND cq.queue_type = 'company'
        WHERE c.status='active'
          AND (c.pipeline_stage IN ('new','call') OR c.pipeline_stage IS NULL)
          AND (cq.id IS NOT NULL OR fu.id IS NULL OR fu.due_date <= $1)
      `, [today]),
      req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date <= $1)`, [today]),
      req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date <= $1)`, [today]),
      req.db.query(`SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date <= $1`, [today]),
    ]);
    res.json({
      calling: parseInt(callingRes.rows[0].cnt),
      mail:    parseInt(mailRes.rows[0].cnt),
      email:   parseInt(emailRes.rows[0].cnt),
      visits:  parseInt(visitsRes.rows[0].cnt),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 7-day forecast ────────────────────────────────────────────────────────────
router.get('/forecast', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA');

    const callingBase = `
      FROM companies c
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) id, entity_id, due_date
        FROM follow_ups WHERE source_type='company' AND is_locked=0
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id = c.id
      LEFT JOIN calling_queue cq ON cq.entity_id = c.id AND cq.queue_type = 'company'
      WHERE c.status='active'
        AND (c.pipeline_stage IN ('new','call') OR c.pipeline_stage IS NULL)
    `;

    const [oc, om, oe, ov] = await Promise.all([
      req.db.query(`SELECT COUNT(DISTINCT c.id) as cnt ${callingBase} AND fu.due_date < $1`, [today]),
      req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date < $1)`, [today]),
      req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date < $1)`, [today]),
      req.db.query("SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date < $1", [today]),
    ]);

    const days = [{
      label: 'Overdue', isOverdue: true,
      calling: parseInt(oc.rows[0].cnt), mail: parseInt(om.rows[0].cnt),
      email:   parseInt(oe.rows[0].cnt), visits: parseInt(ov.rows[0].cnt),
    }];

    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
        : d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });

      const [dc, dm, de, dv] = await Promise.all([
        req.db.query(`SELECT COUNT(DISTINCT c.id) as cnt ${callingBase} AND fu.due_date = $1`, [ds]),
        req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date=$1)`, [ds]),
        req.db.query(`SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date=$1)`, [ds]),
        req.db.query("SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date=$1", [ds]),
      ]);

      const calling = parseInt(dc.rows[0].cnt), mail = parseInt(dm.rows[0].cnt),
            email   = parseInt(de.rows[0].cnt), visits = parseInt(dv.rows[0].cnt);
      days.push({ date: ds, label, calling, mail, email, visits, total: calling+mail+email+visits, isToday: i===0 });
    }
    res.json(days);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Companies in a stage ──────────────────────────────────────────────────────
router.get('/stage/:stage', async (req, res) => {
  try {
    const { stage } = req.params;
    const { starred } = req.query;
    const params = [];
    let where = `WHERE c.status = 'active'`;

    if (starred === '1') {
      where += ` AND c.is_starred = 1`;
    } else if (stage === 'new') {
      where += ` AND (c.pipeline_stage = 'new' OR c.pipeline_stage IS NULL)`;
    } else if (stage !== 'all') {
      params.push(stage);
      where += ` AND c.pipeline_stage = $${params.length}`;
    }

    const { rows } = await req.db.query(`
      SELECT c.*,
        cc.name           as preferred_contact_name,
        cc.role_title     as preferred_role,
        cc.direct_line    as preferred_direct_line,
        cc.email          as preferred_email,
        cl.contact_type   as last_contact_type,
        cl.logged_at      as last_contacted,
        cl.next_action    as last_next_action,
        (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND action_type!='Move') as total_contacts
      FROM companies c
      LEFT JOIN (SELECT DISTINCT ON (company_id) company_id, name, role_title, direct_line, email FROM company_contacts WHERE is_preferred=1 ORDER BY company_id, id ASC) cc ON cc.company_id=c.company_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, next_action
        FROM call_log WHERE log_type='company' AND log_category='call'
        ORDER BY entity_id, id DESC
      ) cl ON cl.entity_id=c.id
      ${where}
      ORDER BY c.is_starred DESC, cl.logged_at ASC, c.name ASC
    `, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Calling queue ─────────────────────────────────────────────────────────────
router.get('/calling', async (req, res) => {
  try {
    const today = new Date().toLocaleDateString('en-CA');
    const { filter, industry, search, upcoming } = req.query;
    const params = [];
    let sql = `
      SELECT c.*,
        cc.name        as preferred_contact_name,
        cc.role_title  as preferred_role,
        cc.direct_line as preferred_direct_line,
        cc.email       as preferred_email,
        fu.id          as followup_id,
        COALESCE(fu.due_date, to_char(current_date, 'YYYY-MM-DD')) AS due_date,
        fu.source_type,
        cq.id          as calling_queue_id,
        cl_last.contact_type as last_contact_type,
        cl_last.logged_at    as last_contacted,
        cl_last.contact_name as last_contact_name,
        cl_last.notes        as last_notes,
        (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND action_type!='Move') as call_count
      FROM companies c
      LEFT JOIN (SELECT DISTINCT ON (company_id) company_id, name, role_title, direct_line, email FROM company_contacts WHERE is_preferred=1 ORDER BY company_id, id ASC) cc ON cc.company_id=c.company_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) id, entity_id, due_date, source_type
        FROM follow_ups WHERE source_type='company' AND is_locked=0
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id=c.id
      LEFT JOIN calling_queue cq ON cq.entity_id=c.id AND cq.queue_type='company'
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at, contact_name, notes
        FROM call_log WHERE log_type='company' AND log_category='call'
        ORDER BY entity_id, id DESC
      ) cl_last ON cl_last.entity_id=c.id
      WHERE c.status='active' AND (c.pipeline_stage IN ('new','call') OR c.pipeline_stage IS NULL)
    `;

    if (upcoming === '1') {
      sql += ` AND (fu.id IS NOT NULL OR cq.id IS NOT NULL OR c.pipeline_stage='new'
                OR (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call')=0)`;
    } else {
      sql += ` AND (
        cq.id IS NOT NULL
        OR fu.id IS NULL
        OR fu.due_date <= '${today}'
      )`;
    }

    if (filter === 'first')    { sql += ` AND (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call' AND counts_as_attempt=1)=0`; }
    if (filter === 'followup') { sql += ` AND (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call' AND counts_as_attempt=1)>0`; }
    if (filter === 'overdue')  { sql += ` AND fu.due_date < '${today}'`; }
    if (industry) { params.push(industry); sql += ` AND c.industry=$${params.length}`; }
    if (search)   { params.push(`%${search}%`); sql += ` AND (c.name ILIKE $${params.length} OR c.industry ILIKE $${params.length})`; }

    sql += ` ORDER BY due_date ASC, c.name ASC`;
    const { rows } = await req.db.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mail queue ────────────────────────────────────────────────────────────────
router.get('/mail', async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT c.*,
        cc.name           as preferred_contact_name,
        cc.role_title     as preferred_role,
        fu.due_date,
        cl.contact_type   as last_contact_type,
        cl.logged_at      as last_contacted,
        (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND action_type!='Move') as call_count
      FROM companies c
      LEFT JOIN (SELECT DISTINCT ON (company_id) company_id, name, role_title, direct_line, email FROM company_contacts WHERE is_preferred=1 ORDER BY company_id, id ASC) cc ON cc.company_id=c.company_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, due_date
        FROM follow_ups WHERE source_type='company' AND is_locked=0
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id=c.id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at
        FROM call_log WHERE log_type='company'
        ORDER BY entity_id, id DESC
      ) cl ON cl.entity_id=c.id
      WHERE c.status='active' AND c.pipeline_stage='mail'
      ORDER BY fu.due_date ASC, c.name ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Email queue ───────────────────────────────────────────────────────────────
router.get('/email', async (req, res) => {
  try {
    const { rows } = await req.db.query(`
      SELECT c.*,
        cc.name           as preferred_contact_name,
        cc.role_title     as preferred_role,
        cc.email          as preferred_email,
        fu.due_date,
        cl.contact_type   as last_contact_type,
        cl.logged_at      as last_contacted,
        (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND action_type!='Move') as call_count
      FROM companies c
      LEFT JOIN (SELECT DISTINCT ON (company_id) company_id, name, role_title, direct_line, email FROM company_contacts WHERE is_preferred=1 ORDER BY company_id, id ASC) cc ON cc.company_id=c.company_id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, due_date
        FROM follow_ups WHERE source_type='company' AND is_locked=0
        ORDER BY entity_id, id DESC
      ) fu ON fu.entity_id=c.id
      LEFT JOIN (
        SELECT DISTINCT ON (entity_id) entity_id, contact_type, logged_at
        FROM call_log WHERE log_type='company'
        ORDER BY entity_id, id DESC
      ) cl ON cl.entity_id=c.id
      WHERE c.status='active' AND c.pipeline_stage='email'
      ORDER BY fu.due_date ASC, c.name ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Move company to stage ─────────────────────────────────────────────────────
router.post('/move/:id', async (req, res) => {
  try {
    const { stage, notes, due_date } = req.body;
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage.' });

    const company = await moveCompany(req.db, req.params.id, stage, req.user.id, req.user.name, notes);
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    await clearAllCompanyQueues(req.db, company.id);

    if (['call','mail','email','visit'].includes(stage)) {
      let autoDate = due_date;
      if (!autoDate) {
        try {
          autoDate = await calcFollowUpDate(req.db, 'company',
            stage==='call' ? 'Call Back' : stage==='mail' ? 'Mail' : stage==='email' ? 'Email' : 'Visit');
        } catch(_) {}
      }
      if (!autoDate) autoDate = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];

      const nextAction = stage==='call' ? 'Call' : stage==='mail' ? 'Mail' : stage==='email' ? 'Email' : 'Visit';
      await req.db.query(`
        INSERT INTO follow_ups (source_type, entity_id, entity_name, phone, industry, due_date, next_action)
        VALUES ('company',$1,$2,$3,$4,$5,$6)
        ON CONFLICT DO NOTHING
      `, [company.id, company.name, company.main_phone, company.industry, autoDate, nextAction]);

      if (stage === 'visit') {
        const { rows: prefRows } = await req.db.query(
          'SELECT * FROM company_contacts WHERE company_id=$1 AND is_preferred=1', [company.company_id]
        );
        const preferred = prefRows[0];
        await req.db.query(`
          INSERT INTO visit_queue (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name, direct_line, email)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT DO NOTHING
        `, [company.company_id, company.id, company.name, autoDate,
            company.address||'', company.city||'',
            preferred?.name||null, preferred?.direct_line||null, preferred?.email||null]);
      }
    }

    res.json(company);
  } catch (err) { res.status(500).json({ error: 'Move failed: ' + err.message }); }
});

// ── Update company status ─────────────────────────────────────────────────────
router.put('/status/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['prospect','interested','customer','dead'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    if (status === 'dead') {
      await req.db.query(
        `UPDATE companies SET company_status=$1, pipeline_stage='dead', stage_updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"'), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$2`,
        [status, req.params.id]
      );
    } else {
      await req.db.query(
        `UPDATE companies SET company_status=$1, updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$2`,
        [status, req.params.id]
      );
    }
    res.json({ company_status: status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Toggle star ───────────────────────────────────────────────────────────────
router.post('/star/:id', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT is_starred FROM companies WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Company not found.' });
    const newVal = rows[0].is_starred ? 0 : 1;
    await req.db.query(
      `UPDATE companies SET is_starred=$1, updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$2`,
      [newVal, req.params.id]
    );
    res.json({ is_starred: newVal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Log mail action ───────────────────────────────────────────────────────────
router.post('/log-mail/:id', async (req, res) => {
  const client = await req.db.connect();
  try {
    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const { mail_piece, contact_type, notes, next_action, next_action_date_override } = req.body;
    const { rows: priorRows } = await client.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id=$1 AND log_type='company' AND log_category='mail'",
      [company.id]
    );

    await client.query('BEGIN');
    const logEntry = await appendCallLog(req.db, {
      log_type: 'company', entity_id: company.id, company_id_str: company.company_id,
      entity_name: company.name, phone: company.main_phone, industry: company.industry,
      action_type: 'Mail', contact_type: contact_type || 'Mail Sent',
      notes: notes || null, next_action: next_action || 'Call', next_action_date: null,
      attempt_number: parseInt(priorRows[0].cnt) + 1,
      logged_by: req.user.id, logged_by_name: req.user.name,
      log_category: 'mail', mail_piece: mail_piece || null, counts_as_attempt: 0,
    });

    await scheduleNextAction(req.db, {
      company, contact_type: contact_type||'Mail Sent', next_action: next_action||'Call',
      next_action_date_override, contact_name: null, direct_line: null, email: null, log_id: logEntry.id,
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to log mail: ' + e.message });
  } finally { client.release(); }
});

// ── Log email action ──────────────────────────────────────────────────────────
router.post('/log-email/:id', async (req, res) => {
  const client = await req.db.connect();
  try {
    const { rows: coRows } = await client.query('SELECT * FROM companies WHERE id=$1', [req.params.id]);
    const company = coRows[0];
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const { email_template, email_to, contact_type, notes, next_action, next_action_date_override } = req.body;
    const { rows: priorRows } = await client.query(
      "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id=$1 AND log_type='company' AND log_category='email'",
      [company.id]
    );

    await client.query('BEGIN');
    const logEntry = await appendCallLog(req.db, {
      log_type: 'company', entity_id: company.id, company_id_str: company.company_id,
      entity_name: company.name, phone: company.main_phone, industry: company.industry,
      action_type: 'Email', contact_type: contact_type || 'Email Sent',
      notes: notes || null, next_action: next_action || 'Call', next_action_date: null,
      attempt_number: parseInt(priorRows[0].cnt) + 1,
      logged_by: req.user.id, logged_by_name: req.user.name,
      log_category: 'email', email_template: email_template || null,
      email_to: email_to || null, counts_as_attempt: 0,
    });

    await scheduleNextAction(req.db, {
      company, contact_type: contact_type||'Email Sent', next_action: next_action||'Call',
      next_action_date_override, contact_name: null, direct_line: null, email: null, log_id: logEntry.id,
    });

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to log email: ' + e.message });
  } finally { client.release(); }
});

// ── Mail pieces ───────────────────────────────────────────────────────────────
router.get('/mail-pieces', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM mail_pieces ORDER BY sort_order, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/mail-pieces', async (req, res) => {
  try {
    const { name, type = 'postcard', notes } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
    const { rows } = await req.db.query(
      'INSERT INTO mail_pieces (name, type, notes) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), type, notes||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/mail-pieces/:id', async (req, res) => {
  try {
    const { name, type, notes } = req.body;
    const { rows } = await req.db.query(
      'UPDATE mail_pieces SET name=COALESCE($1,name), type=COALESCE($2,type), notes=COALESCE($3,notes) WHERE id=$4 RETURNING *',
      [name||null, type||null, notes||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/mail-pieces/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM mail_pieces WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Email templates ───────────────────────────────────────────────────────────
router.get('/email-templates', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM email_templates ORDER BY sort_order, name');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/email-templates', async (req, res) => {
  try {
    const { name, subject, body } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
    const { rows } = await req.db.query(
      'INSERT INTO email_templates (name, subject, body) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), subject||null, body||null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.put('/email-templates/:id', async (req, res) => {
  try {
    const { name, subject, body } = req.body;
    const { rows } = await req.db.query(
      `UPDATE email_templates SET name=COALESCE($1,name), subject=COALESCE($2,subject), body=COALESCE($3,body), updated_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"') WHERE id=$4 RETURNING *`,
      [name||null, subject||null, body||null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/email-templates/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM email_templates WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
