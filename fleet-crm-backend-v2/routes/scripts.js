/**
 * FLEET CRM — SCRIPTS ROUTES (PostgreSQL)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

function parseScript(s) {
  if (!s) return null;
  try { s.blocks = JSON.parse(s.blocks); } catch { s.blocks = []; }
  return s;
}

// ── Public routes (no auth) ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT id,name,sort_order,updated_at FROM scripts ORDER BY sort_order,id');
    const withCounts = await Promise.all(rows.map(async s => {
      const { rows: c } = await req.db.query(
        'SELECT COUNT(*) as c FROM section_questions WHERE script_id=$1 AND enabled=1', [s.id]
      );
      return { ...s, _qCount: parseInt(c[0].c) || 0 };
    }));
    res.json(withCounts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/voicemail-log/:entityId', requireAuth, async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM voicemail_log WHERE entity_id=$1 ORDER BY logged_at DESC LIMIT 1',
      [req.params.entityId]
    );
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM scripts WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found.' });
    res.json(parseScript(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Auth required ─────────────────────────────────────────────────────────────
router.use(requireAuth);

router.post('/voicemail-log', async (req, res) => {
  try {
    const { entity_id, entity_name, vm_index, vm_label } = req.body;
    const { rows } = await req.db.query(
      'INSERT INTO voicemail_log (entity_id,entity_name,vm_index,vm_label) VALUES ($1,$2,$3,$4) RETURNING *',
      [entity_id||null, entity_name||null, vm_index, vm_label||null]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, blocks = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required.' });
    const { rows: m } = await req.db.query('SELECT MAX(sort_order) as m FROM scripts');
    const maxOrder = m[0].m || 0;
    const { rows } = await req.db.query(
      'INSERT INTO scripts (name,blocks,sort_order) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), JSON.stringify(blocks), maxOrder + 1]
    );
    res.status(201).json(parseScript(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { rows: existing } = await req.db.query('SELECT * FROM scripts WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found.' });
    const { name, blocks, sort_order } = req.body;
    const { rows } = await req.db.query(`
      UPDATE scripts SET
        name       = COALESCE($1, name),
        blocks     = COALESCE($2, blocks),
        sort_order = COALESCE($3, sort_order),
        updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id=$4 RETURNING *
    `, [name?.trim()||null, blocks !== undefined ? JSON.stringify(blocks) : null, sort_order ?? null, req.params.id]);
    res.json(parseScript(rows[0]));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await req.db.query('DELETE FROM scripts WHERE id=$1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Not found.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Section questions ─────────────────────────────────────────────────────────
router.get('/:id/section-questions', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM section_questions WHERE script_id=$1 ORDER BY phase_id,section_id,sort_order,id',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/section-questions', async (req, res) => {
  try {
    const { phase_id, section_id, question, yes_points=1, no_points=0 } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'Question text required.' });
    const { rows: m } = await req.db.query(
      'SELECT MAX(sort_order) as m FROM section_questions WHERE script_id=$1 AND phase_id=$2 AND section_id=$3',
      [req.params.id, phase_id, section_id]
    );
    const maxOrder = m[0].m ?? -1;
    const { rows } = await req.db.query(
      'INSERT INTO section_questions (script_id,phase_id,section_id,question,yes_points,no_points,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.id, phase_id, section_id, question.trim(), yes_points, no_points, maxOrder + 1]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/section-questions/:qid', async (req, res) => {
  try {
    const { rows: existing } = await req.db.query(
      'SELECT * FROM section_questions WHERE id=$1 AND script_id=$2',
      [req.params.qid, req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Not found.' });
    const { question, yes_points, no_points, enabled } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (question    !== undefined) { sets.push(`question=$${i++}`);    vals.push(question.trim()); }
    if (yes_points  !== undefined) { sets.push(`yes_points=$${i++}`);  vals.push(yes_points); }
    if (no_points   !== undefined) { sets.push(`no_points=$${i++}`);   vals.push(no_points); }
    if (enabled     !== undefined) { sets.push(`enabled=$${i++}`);     vals.push(enabled ? 1 : 0); }
    if (sets.length) {
      await req.db.query(`UPDATE section_questions SET ${sets.join(',')} WHERE id=$${i}`, [...vals, req.params.qid]);
    }
    const { rows } = await req.db.query('SELECT * FROM section_questions WHERE id=$1', [req.params.qid]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/section-questions/:qid', async (req, res) => {
  try {
    await req.db.query('DELETE FROM section_questions WHERE id=$1 AND script_id=$2', [req.params.qid, req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/section-questions/reorder', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required.' });
    await Promise.all(ids.map((id, i) =>
      req.db.query('UPDATE section_questions SET sort_order=$1 WHERE id=$2 AND script_id=$3', [i, id, req.params.id])
    ));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
