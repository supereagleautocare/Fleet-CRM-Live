/**
 * FLEET CRM — SCORECARD ROUTES (PostgreSQL)
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ── Questions ─────────────────────────────────────────────────────────────────
router.get('/questions/:scriptId', async (req, res) => {
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM scorecard_questions WHERE script_id=$1 ORDER BY sort_order,id',
      [req.params.scriptId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/questions/:scriptId', async (req, res) => {
  try {
    const { question, yes_points=1, no_points=0, partial_points=0.5 } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'Question text required.' });
    const { rows: m } = await req.db.query(
      'SELECT MAX(sort_order) as m FROM scorecard_questions WHERE script_id=$1', [req.params.scriptId]
    );
    const { rows } = await req.db.query(`
      INSERT INTO scorecard_questions (script_id,question,yes_points,no_points,partial_points,sort_order)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [req.params.scriptId, question.trim(), yes_points, no_points, partial_points, (m[0].m ?? -1) + 1]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/questions/:id', async (req, res) => {
  try {
    const { rows: existing } = await req.db.query('SELECT * FROM scorecard_questions WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found.' });
    const { question, yes_points, no_points, partial_points, enabled } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (question       !== undefined) { sets.push(`question=$${i++}`);       vals.push(question.trim()); }
    if (yes_points     !== undefined) { sets.push(`yes_points=$${i++}`);     vals.push(yes_points); }
    if (no_points      !== undefined) { sets.push(`no_points=$${i++}`);      vals.push(no_points); }
    if (partial_points !== undefined) { sets.push(`partial_points=$${i++}`); vals.push(partial_points); }
    if (enabled        !== undefined) { sets.push(`enabled=$${i++}`);        vals.push(enabled ? 1 : 0); }
    if (!sets.length) return res.json(existing[0]);
    const { rows } = await req.db.query(
      `UPDATE scorecard_questions SET ${sets.join(',')} WHERE id=$${i} RETURNING *`,
      [...vals, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/questions/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM scorecard_questions WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reorder/:scriptId', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required.' });
    await Promise.all(ids.map((id, i) =>
      req.db.query('UPDATE scorecard_questions SET sort_order=$1 WHERE id=$2', [i, id])
    ));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Entries ───────────────────────────────────────────────────────────────────
router.get('/entries', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    const { rows } = await req.db.query(
      `SELECT * FROM scorecard_entries WHERE logged_at >= $1 ORDER BY logged_at DESC`,
      [cutoff]
    );
    res.json(rows.map(r => ({ ...r, answers: JSON.parse(r.answers), script_ids: JSON.parse(r.script_ids) })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/entries/daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
    const { rows } = await req.db.query(`
      SELECT
        substring(logged_at, 1, 10) AS day,
        COUNT(*) AS calls,
        ROUND(AVG(CASE WHEN max_score > 0 THEN total_score * 100.0 / max_score ELSE NULL END)::numeric, 1) AS avg_pct,
        SUM(total_score) AS total_pts,
        SUM(max_score) AS max_pts
      FROM scorecard_entries
      WHERE logged_at >= $1
      GROUP BY day ORDER BY day DESC
    `, [cutoff]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/entries', async (req, res) => {
  try {
    const { call_log_id, entity_id, entity_name, script_ids=[], answers={}, notes, rep_name } = req.body;
    const scriptArr = Array.isArray(script_ids) ? script_ids : [script_ids];
    let totalScore = 0, maxScore = 0;

    if (typeof req.body.total_score === 'number' && typeof req.body.max_score === 'number') {
      totalScore = req.body.total_score;
      maxScore   = req.body.max_score;
    } else if (scriptArr.length > 0) {
      const placeholders = scriptArr.map((_, i) => `$${i+1}`).join(',');
      const { rows: questions } = await req.db.query(
        `SELECT * FROM scorecard_questions WHERE script_id IN (${placeholders}) AND enabled=1`,
        scriptArr
      );
      for (const q of questions) {
        const ans = answers[q.id];
        if (ans === 'yes')          { totalScore += q.yes_points;     maxScore += q.yes_points; }
        else if (ans === 'partial') { totalScore += q.partial_points; maxScore += q.yes_points; }
        else if (ans === 'no')      { totalScore += q.no_points;      maxScore += q.yes_points; }
        else                        { maxScore += q.yes_points; }
      }
    }

    const { rows } = await req.db.query(`
      INSERT INTO scorecard_entries (call_log_id,entity_id,entity_name,script_ids,answers,total_score,max_score,notes,rep_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [call_log_id||null, entity_id||null, entity_name||null,
        JSON.stringify(scriptArr), JSON.stringify(answers),
        totalScore, maxScore, notes||null, rep_name||null]);
    const entry = rows[0];
    res.json({ ...entry, answers: JSON.parse(entry.answers), script_ids: JSON.parse(entry.script_ids) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/entries/:id', async (req, res) => {
  try {
    const { rows: existing } = await req.db.query('SELECT * FROM scorecard_entries WHERE id=$1', [req.params.id]);
    if (!existing[0]) return res.status(404).json({ error: 'Not found.' });
    const { reviewer_notes, reviewed_by } = req.body;
    const { rows } = await req.db.query(`
      UPDATE scorecard_entries
      SET reviewer_notes=$1, reviewed_by=$2, reviewed_at=to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      WHERE id=$3 RETURNING *
    `, [reviewer_notes ?? existing[0].reviewer_notes, reviewed_by ?? existing[0].reviewed_by, req.params.id]);
    const updated = rows[0];
    res.json({ ...updated, answers: JSON.parse(updated.answers), script_ids: JSON.parse(updated.script_ids) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/entries/:id', async (req, res) => {
  try {
    await req.db.query('DELETE FROM scorecard_entries WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Enabled toggle ────────────────────────────────────────────────────────────
router.get('/enabled', async (req, res) => {
  try {
    const { rows } = await req.db.query("SELECT value FROM config_settings WHERE key='scorecard_enabled'");
    res.json({ enabled: rows[0]?.value === '1' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    await req.db.query(`
      INSERT INTO config_settings (key, value, label)
      VALUES ('scorecard_enabled', $1, 'Scorecard — pop up after every call')
      ON CONFLICT (key) DO UPDATE SET value=$1
    `, [enabled ? '1' : '0']);
    res.json({ enabled: !!enabled });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
