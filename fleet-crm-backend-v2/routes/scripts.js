/**
 * FLEET CRM — SCRIPTS ROUTES (v2 — phase-based)
 *
 * Scripts store a phase array in the `blocks` JSON field.
 * Each phase has sections; each section has content + scorecard config.
 * Section-level custom questions live in section_questions table.
 *
 * GET    /api/scripts                          — list all
 * GET    /api/scripts/:id                      — single with phases
 * POST   /api/scripts                          — create
 * PUT    /api/scripts/:id                      — update name/phases
 * DELETE /api/scripts/:id                      — delete
 *
 * GET    /api/scripts/:id/section-questions             — all section questions
 * POST   /api/scripts/:id/section-questions             — add question
 * PUT    /api/scripts/:id/section-questions/:qid        — update question
 * DELETE /api/scripts/:id/section-questions/:qid        — delete question
 * POST   /api/scripts/:id/section-questions/reorder     — reorder
 *
 * POST   /api/scripts/voicemail-log            — log a VM left
 * GET    /api/scripts/voicemail-log/:entityId  — last VM for a company
 */

const express = require('express');
const db      = require('../db/schema');
const { requireAuth } = require('../middleware/auth');
const router  = express.Router();

function parseScript(s) {
  if (!s) return null;
  try { s.blocks = JSON.parse(s.blocks); } catch { s.blocks = []; }
  return s;
}

function qCount(scriptId) {
  const r = db.prepare('SELECT COUNT(*) as c FROM section_questions WHERE script_id=? AND enabled=1').get(scriptId);
  return r?.c || 0;
}

// ── Public (popup window) ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT id,name,sort_order,updated_at FROM scripts ORDER BY sort_order,id').all();
  res.json(rows.map(s => ({ ...s, _qCount: qCount(s.id) })));
});

router.get('/voicemail-log/:entityId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM voicemail_log WHERE entity_id=? ORDER BY logged_at DESC LIMIT 1').get(req.params.entityId);
  res.json(row || null);
});

router.get('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found.' });
  res.json(parseScript(s));
});

// ── Auth required ─────────────────────────────────────────────────────────────
router.use(requireAuth);

router.post('/voicemail-log', (req, res) => {
  const { entity_id, entity_name, vm_index, vm_label } = req.body;
  const r = db.prepare('INSERT INTO voicemail_log (entity_id,entity_name,vm_index,vm_label) VALUES (?,?,?,?)')
    .run(entity_id||null, entity_name||null, vm_index, vm_label||null);
  res.json(db.prepare('SELECT * FROM voicemail_log WHERE id=?').get(r.lastInsertRowid));
});

router.post('/', (req, res) => {
  const { name, blocks = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM scripts').get().m || 0;
  const r = db.prepare("INSERT INTO scripts (name,blocks,sort_order) VALUES (?,?,?)").run(name.trim(), JSON.stringify(blocks), maxOrder+1);
  res.status(201).json(parseScript(db.prepare('SELECT * FROM scripts WHERE id=?').get(r.lastInsertRowid)));
});

router.put('/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM scripts WHERE id=?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found.' });
  const { name, blocks, sort_order } = req.body;
  db.prepare(`UPDATE scripts SET name=COALESCE(?,name), blocks=COALESCE(?,blocks), sort_order=COALESCE(?,sort_order), updated_at=datetime('now') WHERE id=?`)
    .run(name?.trim()||null, blocks!==undefined?JSON.stringify(blocks):null, sort_order??null, req.params.id);
  res.json(parseScript(db.prepare('SELECT * FROM scripts WHERE id=?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  const r = db.prepare('DELETE FROM scripts WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
});

// ── Section questions ─────────────────────────────────────────────────────────
router.get('/:id/section-questions', (req, res) => {
  const rows = db.prepare('SELECT * FROM section_questions WHERE script_id=? ORDER BY phase_id,section_id,sort_order,id').all(req.params.id);
  res.json(rows);
});

router.post('/:id/section-questions', (req, res) => {
  const { phase_id, section_id, question, yes_points=1, no_points=0 } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Question text required.' });
  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM section_questions WHERE script_id=? AND phase_id=? AND section_id=?').get(req.params.id, phase_id, section_id);
  const r = db.prepare('INSERT INTO section_questions (script_id,phase_id,section_id,question,yes_points,no_points,sort_order) VALUES (?,?,?,?,?,?,?)')
    .run(req.params.id, phase_id, section_id, question.trim(), yes_points, no_points, (maxOrder?.m??-1)+1);
  res.json(db.prepare('SELECT * FROM section_questions WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id/section-questions/:qid', (req, res) => {
  const q = db.prepare('SELECT * FROM section_questions WHERE id=? AND script_id=?').get(req.params.qid, req.params.id);
  if (!q) return res.status(404).json({ error: 'Not found.' });
  const { question, yes_points, no_points, enabled } = req.body;
  const sets=[]; const vals=[];
  if (question!==undefined)   { sets.push('question=?');    vals.push(question.trim()); }
  if (yes_points!==undefined) { sets.push('yes_points=?');  vals.push(yes_points); }
  if (no_points!==undefined)  { sets.push('no_points=?');   vals.push(no_points); }
  if (enabled!==undefined)    { sets.push('enabled=?');     vals.push(enabled?1:0); }
  if (sets.length) db.prepare(`UPDATE section_questions SET ${sets.join(',')} WHERE id=?`).run(...vals, req.params.qid);
  res.json(db.prepare('SELECT * FROM section_questions WHERE id=?').get(req.params.qid));
});

router.delete('/:id/section-questions/:qid', (req, res) => {
  db.prepare('DELETE FROM section_questions WHERE id=? AND script_id=?').run(req.params.qid, req.params.id);
  res.json({ ok: true });
});

router.post('/:id/section-questions/reorder', (req, res) => {
  const { phase_id, section_id, ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required.' });
  const stmt = db.prepare('UPDATE section_questions SET sort_order=? WHERE id=? AND script_id=?');
  db.transaction(() => ids.forEach((id,i) => stmt.run(i, id, req.params.id)))();
  res.json({ ok: true });
});

module.exports = router;
