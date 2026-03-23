/**
 * FLEET CRM — PIPELINE ROUTES
 *
 * GET  /api/pipeline/board          — counts per stage for dashboard
 * GET  /api/pipeline/stage/:stage   — companies in a stage
 * GET  /api/pipeline/calling        — calling queue (new + follow-up combined)
 * GET  /api/pipeline/mail           — mail queue
 * GET  /api/pipeline/email          — email queue
 * POST /api/pipeline/move/:id       — move company to stage (logs to history, no call counted)
 * POST /api/pipeline/star/:id       — toggle star on company
 * POST /api/pipeline/log-mail/:id   — log a physical mail action
 * POST /api/pipeline/log-email/:id  — log an email action
 *
 * Mail pieces / email templates
 * GET/POST/PUT/DELETE /api/pipeline/mail-pieces
 * GET/POST/PUT/DELETE /api/pipeline/email-templates
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const { appendCallLog, cancelOldFollowUps, calcFollowUpDate, clearAllCompanyQueues } = require('./shared');

const router = express.Router();
router.use(requireAuth);

const STAGES = ['new', 'call', 'mail', 'email', 'visit', 'dead'];

// ── Helper: set company stage and log the move ────────────────────────────────
function moveCompany(companyId, newStage, userId, userName, notes) {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
  if (!company) return null;

  const oldStage = company.pipeline_stage || 'new';
  if (oldStage === newStage) return company;

  db.prepare(`
    UPDATE companies SET pipeline_stage = ?, stage_updated_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(newStage, companyId);

  const moveNote = notes || `Moved from ${oldStage} → ${newStage}`;
  appendCallLog({
    log_type: 'company',
    entity_id: companyId,
    company_id_str: company.company_id,
    entity_name: company.name,
    phone: company.main_phone,
    industry: company.industry,
    action_type: 'Move',
    contact_type: 'Moved',
    notes: moveNote,
    next_action: null,
    attempt_number: 0,
    logged_by: userId,
    logged_by_name: userName,
    log_category: 'move',
    counts_as_attempt: 0,
  });

  return db.prepare('SELECT * FROM companies WHERE id = ?').get(companyId);
}

// ── Pipeline board counts ─────────────────────────────────────────────────────
router.get('/board', (req, res) => {
  const counts = {};
  for (const stage of STAGES) {
    const row = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage = ? AND status = 'active'").get(stage);
    counts[stage] = row.cnt;
  }
  const starred = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE is_starred = 1 AND status = 'active'").get();
  counts.starred = starred.cnt;

  const recentCalls = db.prepare(`
    SELECT COUNT(*) as cnt FROM call_log
    WHERE log_type = 'company' AND log_category = 'call' AND counts_as_attempt = 1
    AND logged_at >= datetime('now', '-7 days')
  `).get();
  const recentMails = db.prepare(`
    SELECT COUNT(*) as cnt FROM call_log
    WHERE log_type = 'company' AND log_category IN ('mail','email')
    AND logged_at >= datetime('now', '-7 days')
  `).get();

  res.json({ counts, recentCalls: recentCalls.cnt, recentMails: recentMails.cnt });
});

// ── Sidebar badge counts (single cheap query) ─────────────────────────────────
// Used by App.jsx refreshCounts. Returns just 4 numbers, no row data.
router.get('/counts', (req, res) => {
  const calling = db.prepare(`
    SELECT COUNT(DISTINCT c.id) as cnt
    FROM companies c
    WHERE c.status = 'active'
      AND c.pipeline_stage IN ('new','call')
      AND (
        EXISTS (
          SELECT 1 FROM follow_ups fu
          WHERE fu.entity_id = c.id AND fu.source_type = 'company'
            AND fu.due_date <= date('now')
        )
        OR EXISTS (
          SELECT 1 FROM calling_queue cq
          WHERE cq.entity_id = c.id AND cq.queue_type = 'company'
        )
        OR (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call') = 0
      )
  `).get().cnt;

const mail  = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail'  AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date <= date('now'))").get().cnt;
  const email = db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND is_locked=0 AND due_date <= date('now'))").get().cnt;

  const visits = db.prepare("SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date <= date('now')").get().cnt;   res.json({ calling, mail, email, visits });
});

// ── 7-day forecast — due counts per day per queue type ──────────────────────
router.get('/forecast', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const overdue = {
    label: 'Overdue',
    isOverdue: true,
    calling: db.prepare("SELECT COUNT(*) as cnt FROM follow_ups WHERE source_type='company' AND due_date < ?").get(today).cnt,
    mail:    db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail'  AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND due_date < ?)").get(today).cnt,
    email:   db.prepare("SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND EXISTS (SELECT 1 FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND due_date < ?)").get(today).cnt,
    visits:  db.prepare("SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date < ?").get(today).cnt,
  };
  const days = [overdue];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().split('T')[0];
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});

    const calling = db.prepare(
      "SELECT COUNT(*) as cnt FROM follow_ups WHERE source_type='company' AND due_date=?"
    ).get(ds).cnt;
    const mail  = db.prepare(
      "SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='mail' AND status='active' AND (SELECT COUNT(*) FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND due_date=?) > 0"
    ).get(ds).cnt;
    const email = db.prepare(
      "SELECT COUNT(*) as cnt FROM companies WHERE pipeline_stage='email' AND status='active' AND (SELECT COUNT(*) FROM follow_ups WHERE entity_id=companies.id AND source_type='company' AND due_date=?) > 0"
    ).get(ds).cnt;
    const visits = db.prepare(
      "SELECT COUNT(*) as cnt FROM visit_queue WHERE scheduled_date=?"
    ).get(ds).cnt;

    days.push({ date: ds, label, calling, mail, email, visits, total: calling + mail + email + visits, isToday: i === 0 });
  }
  res.json(days);
});

// ── Companies in a stage ──────────────────────────────────────────────────────
router.get('/stage/:stage', (req, res) => {
  const { stage } = req.params;
  const { starred } = req.query;

  let sql = `
    SELECT c.*,
      cc.name  as preferred_contact_name,
      cc.role_title as preferred_role,
      cc.direct_line as preferred_direct_line,
      cc.email as preferred_email,
      cl.contact_type as last_contact_type,
      cl.logged_at    as last_contacted,
      cl.next_action  as last_next_action
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at, next_action
      FROM call_log WHERE log_type = 'company' AND log_category = 'call'
      AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' AND log_category='call' GROUP BY entity_id)
    ) cl ON cl.entity_id = c.id
    WHERE c.status = 'active'
  `;
  const params = [];

  if (starred === '1') {
    sql += ` AND c.is_starred = 1`;
  } else if (stage !== 'all') {
    sql += ` AND c.pipeline_stage = ?`;
    params.push(stage);
  }

  sql += ` ORDER BY c.is_starred DESC, cl.logged_at ASC, c.name ASC`;

  res.json(db.prepare(sql).all(...params));
});

// ── Calling queue — new + call stage companies due today ──────────────────────
// Returns calling_queue_id (for first-call companies in the manual queue) AND
// followup_id (for follow-up companies). The frontend uses these to route the
// complete call to the correct endpoint.
router.get('/calling', (req, res) => {
  const { filter, industry, search, upcoming } = req.query;

  // JOIN always fetches most recent follow-up (no date filter) so DUE column populates correctly.
  // WHERE clause controls "due today" vs "all" view.
  let sql = `
    SELECT c.*,
      cc.name        as preferred_contact_name,
      cc.role_title  as preferred_role,
      cc.direct_line as preferred_direct_line,
      cc.email       as preferred_email,
      fu.id          as followup_id,
      fu.due_date,
      fu.source_type,
      cq.id          as calling_queue_id,
      cl_last.contact_type as last_contact_type,
      cl_last.logged_at    as last_contacted,
      cl_last.contact_name as last_contact_name,
      cl_last.notes        as last_notes,
      (SELECT COUNT(*) FROM call_log WHERE entity_id = c.id AND log_type='company' AND log_category='call' AND counts_as_attempt=1) as call_count
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN follow_ups fu
           ON fu.entity_id = c.id AND fu.source_type = 'company' AND fu.is_locked = 0
          AND fu.id = (SELECT MAX(id) FROM follow_ups WHERE entity_id = c.id AND source_type = 'company' AND is_locked = 0)
    LEFT JOIN calling_queue cq ON cq.entity_id = c.id AND cq.queue_type = 'company'
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at, contact_name, notes
      FROM call_log WHERE log_type='company' AND log_category='call'
      AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' AND log_category='call' GROUP BY entity_id)
    ) cl_last ON cl_last.entity_id = c.id
    WHERE c.status = 'active'
      AND (c.pipeline_stage IN ('new','call'))
  `;

  const params = [];

  if (upcoming === '1') {
    // "All" toggle — show everything in new/call stage that has any relevance
    sql += ` AND (fu.id IS NOT NULL OR cq.id IS NOT NULL OR c.pipeline_stage = 'new'
              OR (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call') = 0)`;
  } else {
    // Default "All Due" — only companies due today/overdue, in queue, or brand new
    sql += ` AND (
      (fu.id IS NOT NULL AND fu.due_date <= date('now'))
      OR cq.id IS NOT NULL
      OR c.pipeline_stage = 'new'
      OR (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call') = 0
    )`;
  }

  if (filter === 'first')    { sql += ` AND (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call' AND counts_as_attempt=1) = 0`; }
  if (filter === 'followup') { sql += ` AND (SELECT COUNT(*) FROM call_log WHERE entity_id=c.id AND log_type='company' AND log_category='call' AND counts_as_attempt=1) > 0`; }
  if (filter === 'overdue')  { sql += ` AND fu.due_date < date('now')`; }
  if (industry) { sql += ` AND c.industry = ?`; params.push(industry); }
  if (search)   { sql += ` AND (c.name LIKE ? OR c.industry LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

  sql += ` ORDER BY fu.due_date ASC, c.name ASC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

// ── Mail queue ────────────────────────────────────────────────────────────────
router.get('/mail', (req, res) => {
  const { upcoming } = req.query;
  const rows = db.prepare(`
    SELECT c.*,
      cc.name as preferred_contact_name,
      cc.role_title as preferred_role,
      fu.due_date,
      cl.contact_type as last_contact_type,
      cl.logged_at    as last_contacted
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN follow_ups fu ON fu.entity_id = c.id AND fu.source_type = 'company' AND fu.is_locked = 0
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at FROM call_log
      WHERE log_type='company' AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
    ) cl ON cl.entity_id = c.id
    WHERE c.status = 'active' AND c.pipeline_stage = 'mail'
    ORDER BY fu.due_date ASC, c.name ASC
  `).all();
  res.json(rows);
});

// ── Email queue ───────────────────────────────────────────────────────────────
router.get('/email', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*,
      cc.name as preferred_contact_name,
      cc.role_title as preferred_role,
      cc.email as preferred_email,
      fu.due_date,
      cl.contact_type as last_contact_type,
      cl.logged_at    as last_contacted
    FROM companies c
    LEFT JOIN company_contacts cc ON cc.company_id = c.company_id AND cc.is_preferred = 1
    LEFT JOIN follow_ups fu ON fu.entity_id = c.id AND fu.source_type = 'company' AND fu.is_locked = 0
    LEFT JOIN (
      SELECT entity_id, contact_type, logged_at FROM call_log
      WHERE log_type='company' AND id IN (SELECT MAX(id) FROM call_log WHERE log_type='company' GROUP BY entity_id)
    ) cl ON cl.entity_id = c.id
    WHERE c.status = 'active' AND c.pipeline_stage = 'email'
    ORDER BY c.is_starred DESC, fu.due_date ASC, c.name ASC
  `).all();
  res.json(rows);
});

// ── Move company to stage ─────────────────────────────────────────────────────
router.post('/move/:id', (req, res) => {
  const { stage, notes, due_date } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage.' });

const company = moveCompany(req.params.id, stage, req.user.id, req.user.name, notes);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

 clearAllCompanyQueues(company.id);
  try {
    if (['call','mail','email','visit'].includes(stage)) {
      const autoDate = due_date || (() => {
        try { return calcFollowUpDate('company', stage === 'call' ? 'Call Back' : stage === 'mail' ? 'Mail' : stage === 'email' ? 'Email' : 'Visit'); } catch(_) { return null; }
      })() || new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
      db.prepare(`
        INSERT OR REPLACE INTO follow_ups (source_type, entity_id, entity_name, phone, industry, due_date, next_action)
        VALUES ('company', ?, ?, ?, ?, ?, ?)
      `).run(company.id, company.name, company.main_phone, company.industry, autoDate,
        stage === 'call' ? 'Call' : stage === 'mail' ? 'Mail' : stage === 'email' ? 'Email' : 'Visit');

      if (stage === 'visit') {
        const preferred = db.prepare('SELECT * FROM company_contacts WHERE company_id=? AND is_preferred=1').get(company.company_id);
        db.prepare(`INSERT OR IGNORE INTO visit_queue (company_id, entity_id, entity_name, scheduled_date, address, city, contact_name, direct_line, email)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(company.company_id, company.id, company.name, autoDate, company.address||'', company.city||'',
               preferred?.name||null, preferred?.direct_line||null, preferred?.email||null);
      }
    }
  } catch(e) {
    return res.status(500).json({ error: 'Move failed: ' + e.message });
  }

  res.json(company);
});

// ── Update company status ─────────────────────────────────────────────────────
router.put('/status/:id', (req, res) => {
  const { status } = req.body;
  const valid = ['prospect','interested','customer','dead'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  db.prepare("UPDATE companies SET company_status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json({ company_status: status });
});

// ── Toggle star ───────────────────────────────────────────────────────────────
router.post('/star/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const newVal = company.is_starred ? 0 : 1;
  db.prepare("UPDATE companies SET is_starred = ?, updated_at = datetime('now') WHERE id = ?").run(newVal, req.params.id);
  res.json({ is_starred: newVal });
});

// ── Log mail action ───────────────────────────────────────────────────────────
router.post('/log-mail/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const { mail_piece, notes, next_action, next_action_date_override } = req.body;

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'company' AND log_category = 'mail'"
  ).get(company.id).cnt;

  const next_action_date = next_action_date_override || calcFollowUpDate('company', 'Mail');

  db.exec('BEGIN TRANSACTION');
  try {
    appendCallLog({
      log_type: 'company',
      entity_id: company.id,
      company_id_str: company.company_id,
      entity_name: company.name,
      phone: company.main_phone,
      industry: company.industry,
      action_type: 'Mail',
      contact_type: 'Mail Sent',
      notes: notes || null,
      next_action: next_action || 'Call',
      next_action_date,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      log_category: 'mail',
      mail_piece: mail_piece || null,
      counts_as_attempt: 0,
    });

    moveCompany(company.id, 'mail', req.user.id, req.user.name, `Mailed: ${mail_piece || 'piece'}`);
    clearAllCompanyQueues(company.id);

    if (next_action && next_action !== 'Stop') {
      const nextStage = next_action === 'Mail' ? 'mail' : next_action === 'Visit' ? 'visit' : next_action === 'Email' ? 'email' : 'call';
      db.prepare(`
        INSERT INTO follow_ups (source_type, entity_id, entity_name, phone, industry, due_date, next_action)
        VALUES ('company', ?, ?, ?, ?, ?, ?)
      `).run(company.id, company.name, company.main_phone, company.industry, next_action_date, next_action);

      if (next_action !== 'Mail') {
        db.prepare(`UPDATE companies SET pipeline_stage=?, stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(nextStage, company.id);
      }
      // When next action is Visit, insert into visit_queue for Route Planner
      if (next_action === 'Visit' && next_action_date) {
        const preferred = db.prepare('SELECT * FROM company_contacts WHERE company_id=? AND is_preferred=1').get(company.company_id);
        db.prepare('INSERT INTO visit_queue (company_id,entity_id,entity_name,scheduled_date,address,city,contact_name,direct_line,email) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(company.company_id, company.id, company.name, next_action_date, company.address, company.city,
               preferred?.name||null, preferred?.direct_line||null, preferred?.email||null);
      }
      // When next action is Call, also insert into calling_queue for immediate visibility
      if (next_action === 'Call') {
        clearAllCompanyQueues(company.id);
        const preferred = db.prepare(
          "SELECT * FROM company_contacts WHERE company_id = ? AND is_preferred = 1"
        ).get(company.company_id);
        const existingCQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(company.id);
        if (!existingCQ) {
          db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
            VALUES ('company', ?, ?, ?, ?, ?)`).run(
            company.id,
            preferred?.name || null,
            preferred?.direct_line || null,
            null, req.user?.id || null
          );
        }
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log mail: ' + e.message });
  }

  res.json({ ok: true });
});

// ── Log email action ──────────────────────────────────────────────────────────
router.post('/log-email/:id', (req, res) => {
  const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
  if (!company) return res.status(404).json({ error: 'Company not found.' });

  const { email_template, email_to, notes, next_action, next_action_date_override } = req.body;

  const priorAttempts = db.prepare(
    "SELECT COUNT(*) as cnt FROM call_log WHERE entity_id = ? AND log_type = 'company' AND log_category = 'email'"
  ).get(company.id).cnt;

  const next_action_date = next_action_date_override || calcFollowUpDate('company', 'Email');

  db.exec('BEGIN TRANSACTION');
  try {
    appendCallLog({
      log_type: 'company',
      entity_id: company.id,
      company_id_str: company.company_id,
      entity_name: company.name,
      phone: company.main_phone,
      industry: company.industry,
      action_type: 'Email',
      contact_type: 'Email Sent',
      notes: notes || null,
      next_action: next_action || 'Call',
      next_action_date,
      attempt_number: priorAttempts + 1,
      logged_by: req.user.id,
      logged_by_name: req.user.name,
      log_category: 'email',
      email_template: email_template || null,
      email_to: email_to || null,
      counts_as_attempt: 0,
    });

    moveCompany(company.id, 'email', req.user.id, req.user.name, `Emailed: ${email_template || ''}`);
    clearAllCompanyQueues(company.id);

    if (next_action && next_action !== 'Stop') {
      const nextStage = next_action === 'Mail' ? 'mail' : next_action === 'Visit' ? 'visit' : next_action === 'Email' ? 'email' : 'call';
      db.prepare(`
        INSERT INTO follow_ups (source_type, entity_id, entity_name, phone, industry, due_date, next_action)
        VALUES ('company', ?, ?, ?, ?, ?, ?)
      `).run(company.id, company.name, company.main_phone, company.industry, next_action_date, next_action);

      if (next_action !== 'Email') {
        db.prepare(`UPDATE companies SET pipeline_stage=?, stage_updated_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(nextStage, company.id);
      }
      // When next action is Call, also insert into calling_queue for immediate visibility
      if (next_action === 'Call') {
        clearAllCompanyQueues(company.id);
        const preferred = db.prepare(
          "SELECT * FROM company_contacts WHERE company_id = ? AND is_preferred = 1"
        ).get(company.company_id);
        const existingCQ = db.prepare("SELECT id FROM calling_queue WHERE queue_type='company' AND entity_id=?").get(company.id);
        if (!existingCQ) {
          db.prepare(`INSERT INTO calling_queue (queue_type, entity_id, contact_name, direct_line, notes, added_by)
            VALUES ('company', ?, ?, ?, ?, ?)`).run(
            company.id,
            preferred?.name || null,
            preferred?.direct_line || null,
            null, req.user?.id || null
          );
        }
      }
    }

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to log email: ' + e.message });
  }

  res.json({ ok: true });
});

// ── Mail pieces ───────────────────────────────────────────────────────────────
router.get('/mail-pieces', (req, res) => res.json(db.prepare('SELECT * FROM mail_pieces ORDER BY sort_order, name').all()));
router.post('/mail-pieces', (req, res) => {
  const { name, type = 'postcard', notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
  const r = db.prepare("INSERT INTO mail_pieces (name, type, notes) VALUES (?,?,?)").run(name.trim(), type, notes||null);
  res.status(201).json(db.prepare('SELECT * FROM mail_pieces WHERE id = ?').get(r.lastInsertRowid));
});
router.put('/mail-pieces/:id', (req, res) => {
  const { name, type, notes } = req.body;
  db.prepare("UPDATE mail_pieces SET name=COALESCE(?,name), type=COALESCE(?,type), notes=COALESCE(?,notes) WHERE id=?")
    .run(name||null, type||null, notes||null, req.params.id);
  res.json(db.prepare('SELECT * FROM mail_pieces WHERE id = ?').get(req.params.id));
});
router.delete('/mail-pieces/:id', (req, res) => {
  db.prepare('DELETE FROM mail_pieces WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Email templates ───────────────────────────────────────────────────────────
router.get('/email-templates', (req, res) => res.json(db.prepare('SELECT * FROM email_templates ORDER BY sort_order, name').all()));
router.post('/email-templates', (req, res) => {
  const { name, subject, body } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
  const r = db.prepare("INSERT INTO email_templates (name, subject, body) VALUES (?,?,?)").run(name.trim(), subject||null, body||null);
  res.status(201).json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(r.lastInsertRowid));
});
router.put('/email-templates/:id', (req, res) => {
  const { name, subject, body } = req.body;
  db.prepare("UPDATE email_templates SET name=COALESCE(?,name), subject=COALESCE(?,subject), body=COALESCE(?,body), updated_at=datetime('now') WHERE id=?")
    .run(name||null, subject||null, body||null, req.params.id);
  res.json(db.prepare('SELECT * FROM email_templates WHERE id = ?').get(req.params.id));
});
router.delete('/email-templates/:id', (req, res) => {
  db.prepare('DELETE FROM email_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
