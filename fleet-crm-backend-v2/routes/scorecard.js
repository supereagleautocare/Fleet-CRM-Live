/**
 * FLEET CRM — SCORECARD ROUTES
 *
 * GET    /api/scorecard/questions/:scriptId   — questions for a script
 * POST   /api/scorecard/questions/:scriptId   — add question
 * PUT    /api/scorecard/questions/:id         — update question (points, text, enabled)
 * DELETE /api/scorecard/questions/:id         — delete question
 * POST   /api/scorecard/reorder/:scriptId     — reorder questions
 *
 * GET    /api/scorecard/entries               — list entries (with ?days=30 filter)
 * GET    /api/scorecard/entries/daily         — daily totals for dashboard
 * POST   /api/scorecard/entries               — save a completed scorecard
 * DELETE /api/scorecard/entries/:id           — delete entry
 *
 * GET    /api/scorecard/enabled               — is scorecard on?
 * PUT    /api/scorecard/enabled               — toggle on/off
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Questions ─────────────────────────────────────────────────────────────────

router.get('/questions/:scriptId', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM scorecard_questions WHERE script_id = ? ORDER BY sort_order, id'
  ).all(req.params.scriptId);
  res.json(rows);
});

router.post('/questions/:scriptId', (req, res) => {
  const { question, yes_points = 1, no_points = 0, partial_points = 0.5 } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Question text required.' });
  const maxOrder = db.prepare(
    'SELECT MAX(sort_order) as m FROM scorecard_questions WHERE script_id = ?'
  ).get(req.params.scriptId);
  const r = db.prepare(`
    INSERT INTO scorecard_questions (script_id, question, yes_points, no_points, partial_points, sort_order)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.scriptId, question.trim(), yes_points, no_points, partial_points, (maxOrder?.m ?? -1) + 1);
  res.json(db.prepare('SELECT * FROM scorecard_questions WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/questions/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM scorecard_questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found.' });
  const { question, yes_points, no_points, partial_points, enabled } = req.body;
  const updates = [];
  const vals = [];
  if (question    !== undefined) { updates.push('question = ?');       vals.push(question.trim()); }
  if (yes_points  !== undefined) { updates.push('yes_points = ?');     vals.push(yes_points); }
  if (no_points   !== undefined) { updates.push('no_points = ?');      vals.push(no_points); }
  if (partial_points !== undefined) { updates.push('partial_points = ?'); vals.push(partial_points); }
  if (enabled     !== undefined) { updates.push('enabled = ?');        vals.push(enabled ? 1 : 0); }
  if (updates.length === 0) return res.json(q);
  db.prepare(`UPDATE scorecard_questions SET ${updates.join(', ')} WHERE id = ?`).run(...vals, req.params.id);
  res.json(db.prepare('SELECT * FROM scorecard_questions WHERE id = ?').get(req.params.id));
});

router.delete('/questions/:id', (req, res) => {
  db.prepare('DELETE FROM scorecard_questions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/reorder/:scriptId', (req, res) => {
  const { ids } = req.body; // array of ids in new order
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required.' });
  const stmt = db.prepare('UPDATE scorecard_questions SET sort_order = ? WHERE id = ?');
  const run  = db.transaction(() => ids.forEach((id, i) => stmt.run(i, id)));
  run();
  res.json({ ok: true });
});

// ── Entries ───────────────────────────────────────────────────────────────────

router.get('/entries', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const rows = db.prepare(`
    SELECT * FROM scorecard_entries
    WHERE logged_at >= datetime('now', '-${days} days')
    ORDER BY logged_at DESC
  `).all();
  res.json(rows.map(r => ({ ...r, answers: JSON.parse(r.answers), script_ids: JSON.parse(r.script_ids) })));
});

router.get('/entries/daily', (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const rows = db.prepare(`
    SELECT
      date(logged_at) AS day,
      COUNT(*)        AS calls,
      ROUND(AVG(CASE WHEN max_score > 0 THEN total_score * 100.0 / max_score ELSE NULL END), 1) AS avg_pct,
      SUM(total_score)  AS total_pts,
      SUM(max_score)    AS max_pts
    FROM scorecard_entries
    WHERE logged_at >= datetime('now', '-${days} days')
    GROUP BY day
    ORDER BY day DESC
  `).all();
  res.json(rows);
});

router.post('/entries', (req, res) => {
  const { call_log_id, entity_id, entity_name, script_ids = [], answers = {}, notes, rep_name } = req.body;

  // Use frontend-calculated score if provided (new section_questions system),
  // otherwise fall back to calculating from old scorecard_questions table
  const scriptArr = Array.isArray(script_ids) ? script_ids : [script_ids];
  let totalScore = 0, maxScore = 0;
  if (typeof req.body.total_score === 'number' && typeof req.body.max_score === 'number') {
    totalScore = req.body.total_score;
    maxScore   = req.body.max_score;
  } else {
    if (scriptArr.length > 0) {
      const placeholders = scriptArr.map(() => '?').join(',');
      const questions = db.prepare(
        `SELECT * FROM scorecard_questions WHERE script_id IN (${placeholders}) AND enabled = 1`
      ).all(...scriptArr);
      for (const q of questions) {
        const ans = answers[q.id];
        if (ans === 'yes')      { totalScore += q.yes_points;     maxScore += q.yes_points; }
        else if (ans === 'partial') { totalScore += q.partial_points; maxScore += q.yes_points; }
        else if (ans === 'no')  { totalScore += q.no_points;      maxScore += q.yes_points; }
        else                    { maxScore += q.yes_points; }
      }
    }
  }

  const r = db.prepare(`
    INSERT INTO scorecard_entries (call_log_id, entity_id, entity_name, script_ids, answers, total_score, max_score, notes, rep_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    call_log_id || null, entity_id || null, entity_name || null,
    JSON.stringify(scriptArr), JSON.stringify(answers),
    totalScore, maxScore, notes || null, rep_name || null
  );
  const entry = db.prepare('SELECT * FROM scorecard_entries WHERE id = ?').get(r.lastInsertRowid);
  res.json({ ...entry, answers: JSON.parse(entry.answers), script_ids: JSON.parse(entry.script_ids) });
});

router.put('/entries/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM scorecard_entries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found.' });
  const { reviewer_notes, reviewed_by } = req.body;
  db.prepare(`
    UPDATE scorecard_entries
    SET reviewer_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(reviewer_notes ?? row.reviewer_notes, reviewed_by ?? row.reviewed_by, req.params.id);
  const updated = db.prepare('SELECT * FROM scorecard_entries WHERE id = ?').get(req.params.id);
  res.json({ ...updated, answers: JSON.parse(updated.answers), script_ids: JSON.parse(updated.script_ids) });
});

router.delete('/entries/:id', (req, res) => {
  db.prepare('DELETE FROM scorecard_entries WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ── Enabled toggle ────────────────────────────────────────────────────────────

router.get('/enabled', (req, res) => {
  const row = db.prepare("SELECT value FROM config_settings WHERE key = 'scorecard_enabled'").get();
  res.json({ enabled: row?.value === '1' });
});

router.put('/enabled', (req, res) => {
  const { enabled } = req.body;
  db.prepare("INSERT OR REPLACE INTO config_settings (key, value, label, updated_at) VALUES ('scorecard_enabled', ?, 'Scorecard — pop up after every call', datetime('now'))")
    .run(enabled ? '1' : '0');
  res.json({ enabled: !!enabled });
});

module.exports = router;
