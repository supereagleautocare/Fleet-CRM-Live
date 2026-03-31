/**
 * ScoreCardModal v5 — Clean redesign
 *
 * Step 1: Pick script(s) + check which PHASES happened
 *   - Only phases shown, no individual sections
 *   - Objections are separate: "Did an objection come up?"
 *   - Checking a phase = all its questions are eligible to score
 *
 * Step 2: Answer the questions from the Question Builder
 *   - NO auto +1 for sections
 *   - Only questions you built in ScoreCardSettings count
 *   - Situational questions at bottom with N/A skip
 */
import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

const SITUATIONAL_PHASE = '__situational__';

function pctColor(pct) {
  if (pct === null) return '#94a3b8';
  if (pct >= 80) return '#15803d';
  if (pct >= 60) return '#d97706';
  return '#dc2626';
}

function YesNo({ qid, question, hint, yesPts, noPts, value, onChange, allowSkip }) {
  const opts = [
    { val:'yes', label:'Yes', pts:yesPts, bg:'#dcfce7', text:'#15803d' },
    { val:'no',  label:'No',  pts:noPts,  bg:'#fee2e2', text:'#dc2626' },
    ...(allowSkip ? [{ val:'na', label:'N/A — Skip', pts:0, bg:'#f1f5f9', text:'#94a3b8' }] : []),
  ];
  return (
    <div style={{ border:'1px solid var(--gray-100)', borderRadius:0, overflow:'hidden' }}>
      <div style={{ padding:'9px 14px', background:value==='yes'?'#f0fdf4':value==='no'?'#fef2f2':value==='na'?'#f8fafc':'white', borderBottom:'1px solid var(--gray-100)', transition:'background .15s' }}>
        <div style={{ fontSize:12, fontWeight:600, color:'var(--navy-800)' }}>{question}</div>
        {hint && <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:2 }}>{hint}</div>}
      </div>
      <div style={{ display:'flex', background:'var(--gray-50)' }}>
        {opts.map(opt => {
          const active = value === opt.val;
          return (
            <button key={opt.val} onClick={() => onChange(qid, active ? undefined : opt.val)}
              style={{ flex:1, padding:'8px 4px', border:'none', borderRight:'1px solid var(--gray-200)', background:active?opt.bg:'transparent', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:1, transition:'background .15s' }}>
              <span style={{ fontSize:12, fontWeight:700, color:active?opt.text:'var(--gray-500)' }}>{opt.label}</span>
              {opt.pts !== undefined && <span style={{ fontSize:10, color:active?opt.text:'var(--gray-300)' }}>{opt.pts > 0 ? `+${opt.pts}` : opt.pts !== 0 ? opt.pts : '±0'} pts</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ScoreCardModal({ entityName, entityId, callLogId, onClose, onSaved }) {
  const [scripts, setScripts]               = useState([]);
  const [loadedScripts, setLoadedScripts]   = useState({});
  const [selectedIds, setSelectedIds]       = useState([]);
  const [loadingScript, setLoadingScript]   = useState(null);
  const [usedPhaseIds, setUsedPhaseIds]     = useState({});   // `${sid}_${phaseId}` → bool
  const [objCameUp, setObjCameUp]           = useState({});   // `${sid}_${phaseId}` → bool
  const [answers, setAnswers]               = useState({});
  const [notes, setNotes]                   = useState('');
  const [step, setStep]                     = useState('setup');
  const [loading, setLoading]               = useState(true);
  const [saving, setSaving]                 = useState(false);
  const [dirty, setDirty]                   = useState(false);
  const { showToast }                       = useApp();

  useEffect(() => {
    api.scripts().then(s => { setScripts(s); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  async function toggleScript(s) {
    const id = s.id;
    if (selectedIds.includes(id)) {
      setSelectedIds(p => p.filter(x => x !== id));
      return;
    }
    if (!loadedScripts[id]) {
      setLoadingScript(id);
      try {
        const full = await api.script(id);
        const data = full.blocks;
        let phases = [];
        if (Array.isArray(data) && data.length > 0 && data[0]?.sections) {
          phases = data;
        } else {
          phases = [{ id:'main', name:'Phase 1', sections:(Array.isArray(data)?data:[]).map(b=>({...b,id:b.id||Math.random().toString(36).slice(2)})) }];
        }
        const questions = await api.sectionQuestions(id);
        // Init all phases unchecked
        const initPhases = {}, initObj = {};
        phases.forEach(ph => {
          initPhases[`${id}_${ph.id}`] = false;
          initObj[`${id}_${ph.id}`] = false;
        });
        setUsedPhaseIds(p => ({...p, ...initPhases}));
        setObjCameUp(p => ({...p, ...initObj}));
        setLoadedScripts(p => ({...p, [id]:{ script:s, phases, questions }}));
      } finally { setLoadingScript(null); }
    }
    setSelectedIds(p => [...p, id]);
    setDirty(true);
  }

  function togglePhase(sid, phaseId) {
    const key = `${sid}_${phaseId}`;
    setUsedPhaseIds(p => ({...p, [key]:!p[key]}));
    if (usedPhaseIds[key]) setObjCameUp(p => ({...p, [key]:false})); // uncheck objection when phase unchecked
  }

  function setAnswer(key, val) { setAnswers(p => ({...p, [key]:val})); }

  // Score: only custom questions count, no auto-points for sections
  const { score, max } = (() => {
    let s = 0, m = 0;
    selectedIds.forEach(sid => {
      const { phases=[], questions=[] } = loadedScripts[sid] || {};
      phases.forEach(ph => {
        if (!usedPhaseIds[`${sid}_${ph.id}`]) return;
        const objSectionIdsForCalc = new Set(ph.sections.filter(s => s.type === 'objection').map(s => s.id));
        const phaseQs = questions.filter(q =>
          q.phase_id === ph.id && q.phase_id !== SITUATIONAL_PHASE && q.enabled
          && !objSectionIdsForCalc.has(q.section_id)
        );
        phaseQs.forEach(q => {
          const ans = answers[`${sid}_${q.id}`];
          if (ans === 'yes')  { s += q.yes_points; m += q.yes_points; }
          else if (ans === 'no')  { s += q.no_points; m += q.yes_points; }
          else if (ans === 'na')  { /* skip — no penalty */ }
          else { m += q.yes_points; }
        });
        // Objection questions only if objection came up
        if (objCameUp[`${sid}_${ph.id}`]) {
          const objSections = ph.sections.filter(s => s.type === 'objection');
          objSections.forEach(sec => {
            questions.filter(q => q.section_id === sec.id && q.enabled).forEach(q => {
              const ans = answers[`obj_${sid}_${q.id}`];
              if (ans === 'yes')  { s += q.yes_points; m += q.yes_points; }
              else if (ans === 'no')  { s += q.no_points; m += q.yes_points; }
              else { m += q.yes_points; }
            });
          });
        }
      });
      // Situational
      questions.filter(q => q.phase_id === SITUATIONAL_PHASE && q.enabled).forEach(q => {
        const ans = answers[`sit_${sid}_${q.id}`];
        if (ans === 'na') return;
        m += q.yes_points;
        if (ans === 'yes') s += q.yes_points;
        else if (ans === 'no') s += q.no_points;
      });
    });
    return { score:s, max:m };
  })();

  const pct = max > 0 ? Math.round((score / max) * 100) : null;

  async function handleSave() {
    setSaving(true);
    try {
      const scriptArr = Array.isArray(selectedIds) ? selectedIds : [selectedIds];
      await api.saveScorecardEntry({
        call_log_id: callLogId || null,
        entity_id:   entityId  || null,
        entity_name: entityName || null,
        script_ids:  scriptArr,
        total_score: score,
        max_score:   max,
        answers: {
          ...answers,
          _usedPhases: Object.keys(usedPhaseIds).filter(k => usedPhaseIds[k]),
        },
        notes,
        rep_name: null,
      });
      showToast(`✅ Scorecard saved${pct !== null ? ` — ${pct}%` : ''}`);
      setDirty(false);
      onSaved?.();
    } catch(e) {
      console.error(e);
      showToast('❌ Failed to save — ' + (e.message || 'unknown error'), 'error');
    } finally { setSaving(false); }
  }

  function handleBackdropClick(e) {
    if (e.target !== e.currentTarget) return;
    if (!dirty && selectedIds.length === 0) { onClose(); return; }
    if (window.confirm('Exit scorecard? Your selections will be lost.')) onClose();
  }

  async function handleSkip() {
    try {
      await api.saveScorecardEntry({
        call_log_id: callLogId || null,
        entity_id:   entityId  || null,
        entity_name: entityName || null,
        script_ids:  [],
        total_score: 0,
        max_score:   0,
        notes: '__skipped__',
      });
      onSaved?.();
    } catch(_) {
      onClose();
    }
  }

  function confirmClose() {
    if (!dirty && selectedIds.length === 0) { onClose(); return; }
    if (window.confirm('Exit scorecard? Your selections will be lost.')) onClose();
  }

  const canScore = selectedIds.length > 0;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:3000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={handleBackdropClick}>
      <div style={{ background:'white', borderRadius:16, overflow:'hidden', boxShadow:'0 12px 50px rgba(0,0,0,.3)', maxWidth:600, width:'100%', maxHeight:'92vh', display:'flex', flexDirection:'column' }}>

        {/* Header */}
        <div style={{ background:'var(--navy-950)', padding:'14px 20px', flexShrink:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,.4)', textTransform:'uppercase', letterSpacing:'.08em', marginBottom:2 }}>📋 Call Scorecard</div>
              <div style={{ fontWeight:800, fontSize:15, color:'white' }}>{entityName || 'Manual Entry'}</div>
            </div>
            {pct !== null && step === 'score' && (
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:26, fontWeight:900, color:pctColor(pct) }}>{pct}%</div>
                <div style={{ fontSize:10, color:'rgba(255,255,255,.4)' }}>{score.toFixed(1)} / {max.toFixed(1)} pts</div>
              </div>
            )}
          </div>
          {pct !== null && step === 'score' && (
            <div style={{ marginTop:8, height:4, background:'rgba(255,255,255,.1)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${pct}%`, background:pctColor(pct), borderRadius:4, transition:'width .3s' }}/>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'2px solid var(--gray-100)', flexShrink:0, background:'var(--gray-50)' }}>
          {[{id:'setup',label:'1 — Script & Phases'},{id:'score',label:'2 — Score'}].map(t => (
            <button key={t.id}
              onClick={() => { if (t.id === 'score' && !canScore) return; setStep(t.id); }}
              style={{ flex:1, padding:'10px 0', fontSize:12, fontWeight:700, background:'none', border:'none', cursor:'pointer', borderBottom:step===t.id?'2px solid var(--navy-800)':'2px solid transparent', color:step===t.id?'var(--navy-800)':'var(--gray-400)', marginBottom:-2, opacity:t.id==='score'&&!canScore?.4:1 }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ overflowY:'auto', flex:1, padding:'16px 20px' }}>

          {/* ── STEP 1: Script + Phases ── */}
          {step === 'setup' && (
            <>
              {loading ? (
                <div style={{ textAlign:'center', padding:40, color:'var(--gray-400)' }}>Loading…</div>
              ) : (
                <>
                  {/* Script selection */}
                  <div style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>
                      Which script(s) did you use?
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                      {scripts.map(s => {
                        const sel = selectedIds.includes(s.id);
                        const isLoading = loadingScript === s.id;
                        return (
                          <button key={s.id} onClick={() => toggleScript(s)} disabled={isLoading}
                            style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', borderRadius:10, border:`2px solid ${sel?'var(--navy-700)':'var(--gray-200)'}`, background:sel?'#f0f4ff':'white', cursor:'pointer', textAlign:'left', transition:'all .1s' }}>
                            <div style={{ width:20, height:20, borderRadius:5, border:`2px solid ${sel?'var(--navy-700)':'var(--gray-300)'}`, background:sel?'var(--navy-800)':'white', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:12, color:'white' }}>
                              {sel && '✓'}
                            </div>
                            <span style={{ fontWeight:700, fontSize:13, color:'var(--navy-800)', flex:1 }}>{s.name}</span>
                            {isLoading && <span style={{ fontSize:11, color:'var(--gray-400)' }}>Loading…</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Phase checklist per script */}
                  {selectedIds.map(sid => {
                    const { phases=[], script } = loadedScripts[sid] || {};
                    if (!phases.length) return null;
                    return (
                      <div key={sid} style={{ marginBottom:20 }}>
                        {selectedIds.length > 1 && (
                          <div style={{ fontSize:11, fontWeight:800, color:'var(--navy-800)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8, paddingBottom:6, borderBottom:'2px solid var(--gray-200)' }}>
                            📋 {script?.name}
                          </div>
                        )}
                        <div style={{ fontSize:11, color:'var(--gray-400)', marginBottom:10 }}>
                          Check which phases actually happened:
                        </div>
                        {phases.map((ph, pi) => {
                          const phKey = `${sid}_${ph.id}`;
                          const phUsed = !!usedPhaseIds[phKey];
                          const hasObjSections = ph.sections.some(s => s.type === 'objection');
                          const anyObj = !!objCameUp[phKey];
                          return (
                            <div key={ph.id} style={{ marginBottom:10 }}>
                              {/* Phase toggle */}
                              <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'10px 14px', borderRadius:8, background:phUsed?'var(--navy-950)':'var(--gray-100)', transition:'background .15s' }}>
                                <input type="checkbox" checked={phUsed} onChange={() => togglePhase(sid, ph.id)}
                                  style={{ accentColor:'#fbbf24', width:16, height:16, flexShrink:0 }}/>
                                <span style={{ fontWeight:800, fontSize:14, color:phUsed?'white':'var(--gray-500)', flex:1 }}>
                                  {ph.name}
                                </span>
                                {!phUsed && <span style={{ fontSize:11, color:'var(--gray-400)' }}>skip</span>}
                              </label>

                              {/* Objection sub-toggle */}
                              {phUsed && hasObjSections && (
                                <div style={{ marginLeft:16, marginTop:6 }}>
                                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'8px 12px', borderRadius:7, border:'1.5px solid #fed7aa', background:anyObj?'#fff7ed':'white', transition:'background .15s' }}>
                                    <input type="checkbox" checked={anyObj} onChange={e => setObjCameUp(p => ({...p, [phKey]:e.target.checked}))}
                                      style={{ accentColor:'#f97316', width:14, height:14, flexShrink:0 }}/>
                                    <span style={{ fontSize:12, fontWeight:700, color:anyObj?'#9a3412':'var(--gray-500)', flex:1 }}>
                                      🛡️ Did an objection come up?
                                    </span>
                                    {!anyObj && <span style={{ fontSize:10, color:'var(--gray-300)' }}>no — skip</span>}
                                  </label>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}

                  {selectedIds.length === 0 && (
                    <div style={{ textAlign:'center', padding:'20px 0', color:'var(--gray-400)', fontSize:13, fontStyle:'italic' }}>
                      Select a script above to continue
                    </div>
                  )}

                  <div style={{ display:'flex', gap:8, marginTop:4 }}>
                    <button className="btn btn-ghost btn-sm" style={{ color:'var(--gray-400)' }} onClick={handleSkip}>Skip</button>
                    <button className="btn btn-primary" style={{ flex:1 }} disabled={!canScore} onClick={() => setStep('score')}>
                      Next — Score the Call →
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── STEP 2: Score ── */}
          {step === 'score' && (
            <>
              {selectedIds.map(sid => {
                const { phases=[], questions=[], script } = loadedScripts[sid] || {};
                const sitQs = questions.filter(q => q.phase_id === SITUATIONAL_PHASE && q.enabled);
                const usedPhases = phases.filter(ph => usedPhaseIds[`${sid}_${ph.id}`]);
                if (!usedPhases.length && !sitQs.length) return null;

                return (
                  <div key={sid} style={{ marginBottom:24 }}>
                    {selectedIds.length > 1 && (
                      <div style={{ fontSize:11, fontWeight:800, color:'var(--navy-800)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:10, paddingBottom:6, borderBottom:'2px solid var(--gray-200)' }}>
                        📋 {script?.name}
                      </div>
                    )}

                    {usedPhases.map(ph => {
                      const phKey = `${sid}_${ph.id}`;
                      // Questions for this phase (excluding objection-section questions unless obj came up)
                      const objSectionIds = new Set(ph.sections.filter(s => s.type === 'objection').map(s => s.id));
                      const phaseQs = questions.filter(q =>
                        q.phase_id === ph.id &&
                        q.enabled &&
                        !objSectionIds.has(q.section_id)
                      );
                      const objQs = objCameUp[phKey]
                        ? questions.filter(q => q.phase_id === ph.id && q.enabled && objSectionIds.has(q.section_id))
                        : [];
                      const totalQs = phaseQs.length + objQs.length;
                      if (totalQs === 0 && !objCameUp[phKey]) {
                        return (
                          <div key={ph.id} style={{ marginBottom:10, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:12, color:'var(--gray-400)' }}>
                            <strong style={{ color:'var(--navy-800)' }}>{ph.name}</strong> — no questions built for this phase yet. Add them in Settings → Scorecard.
                          </div>
                        );
                      }

                      return (
                        <div key={ph.id} style={{ marginBottom:12 }}>
                          <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:'var(--gray-400)', marginBottom:8, paddingBottom:4, borderBottom:'1px solid var(--gray-100)' }}>
                            {ph.name}
                          </div>
                          {phaseQs.length > 0 && (
                            <div style={{ border:'1.5px solid var(--gray-200)', borderRadius:10, overflow:'hidden', marginBottom:8 }}>
                              {phaseQs.map((q, qi) => (
                                <div key={q.id} style={{ borderTop:qi > 0 ? '1px solid var(--gray-100)' : 'none' }}>
                                  <YesNo
                                    qid={`${sid}_${q.id}`}
                                    question={q.question}
                                    hint={`${ph.name}`}
                                    yesPts={q.yes_points} noPts={q.no_points}
                                    value={answers[`${sid}_${q.id}`]}
                                    onChange={setAnswer}
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {objQs.length > 0 && (
                            <div style={{ border:'1.5px solid #fed7aa', borderRadius:10, overflow:'hidden', marginBottom:8 }}>
                              <div style={{ padding:'6px 14px', background:'#fff7ed', borderBottom:'1px solid #fed7aa', fontSize:10, fontWeight:700, color:'#9a3412', textTransform:'uppercase', letterSpacing:'.07em' }}>
                                🛡️ Objection
                              </div>
                              {objQs.map((q, qi) => (
                                <div key={q.id} style={{ borderTop:qi > 0 ? '1px solid #fef3c7' : 'none' }}>
                                  <YesNo
                                    qid={`obj_${sid}_${q.id}`}
                                    question={q.question}
                                    yesPts={q.yes_points} noPts={q.no_points}
                                    value={answers[`obj_${sid}_${q.id}`]}
                                    onChange={setAnswer}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Situational */}
                    {sitQs.length > 0 && (
                      <div style={{ marginBottom:12 }}>
                        <div style={{ fontSize:10, fontWeight:800, textTransform:'uppercase', letterSpacing:'.08em', color:'#92400e', marginBottom:8, paddingBottom:4, borderBottom:'1px solid #fde68a' }}>
                          ⚡ Situational — N/A = no penalty
                        </div>
                        <div style={{ border:'1.5px solid #fde68a', borderRadius:10, overflow:'hidden' }}>
                          {sitQs.map((q, qi) => (
                            <div key={q.id} style={{ borderTop:qi > 0 ? '1px solid #fef9c3' : 'none' }}>
                              <YesNo
                                qid={`sit_${sid}_${q.id}`}
                                question={q.question}
                                yesPts={q.yes_points} noPts={q.no_points}
                                value={answers[`sit_${sid}_${q.id}`]}
                                onChange={setAnswer}
                                allowSkip
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Empty state */}
              {selectedIds.every(sid => {
                const { phases=[], questions=[] } = loadedScripts[sid] || {};
                return !phases.some(ph => usedPhaseIds[`${sid}_${ph.id}`]);
              }) && (
                <div style={{ textAlign:'center', padding:32, color:'var(--gray-400)', fontSize:13 }}>
                  No phases were checked. Go back and check which phases happened.
                </div>
              )}

              <div className="form-group" style={{ marginTop:8 }}>
                <label className="form-label">Notes (optional)</label>
                <textarea className="form-textarea" rows={2} placeholder="Anything notable about this call…" value={notes} onChange={e => setNotes(e.target.value)}/>
              </div>

              <div style={{ display:'flex', gap:8, marginTop:4 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setStep('setup')}>← Back</button>
                <button className="btn btn-primary" style={{ flex:1 }} onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : `✅ Save${pct !== null ? ` — ${pct}%` : ''}`}
                </button>
                <button className="btn btn-ghost btn-sm" style={{ color:'var(--gray-400)' }} onClick={handleSkip}>Skip</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
