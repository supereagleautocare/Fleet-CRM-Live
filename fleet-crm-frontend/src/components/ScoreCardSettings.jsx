/**
 * ScoreCardSettings v2
 *
 * Scorecard tab: Script → Phase → Section — full drill-down tree
 * Every scoreable section gets its own question bucket.
 * "Situational" questions float independently — skip = no penalty.
 *
 * Builder tree:
 *   ├── Script (Gate Keeper)
 *   │   ├── Phase: Gatekeeper
 *   │   │   ├── Section: Opener "Call Center"   ← questions here
 *   │   │   ├── Section: Response "What's this" ← questions here
 *   │   │   └── Section: Response "Not in"      ← questions here
 *   │   └── Phase: Decision Maker
 *   │       ├── Section: Pitch "3 YEAR WARRANTY" ← questions here
 *   │       └── Section: Objection "Happy where we are"
 *   └── ⚡ Situational Questions (no section tied, each is toggled on scorecard)
 *
 * History tab: same as before + manager review
 */
import { useState, useEffect } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import { SECTION_TYPES } from './ScriptEditor.jsx';

function pctColor(p) { return p===null?'#94a3b8':p>=80?'#15803d':p>=60?'#d97706':'#dc2626'; }
function Badge({ pct }) {
  if (pct===null||pct===undefined) return <span style={{color:'#94a3b8',fontSize:12}}>—</span>;
  return <span style={{display:'inline-flex',alignItems:'center',minWidth:46,padding:'2px 8px',borderRadius:20,background:pct>=80?'#dcfce7':pct>=60?'#fef9c3':'#fee2e2',color:pctColor(pct),fontWeight:800,fontSize:12}}>{pct}%</span>;
}

// ── Per-section question list ─────────────────────────────────────────────────
function SectionQuestions({ scriptId, phaseId, sectionId, sectionLabel }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newQ, setNewQ]           = useState('');
  const [newYes, setNewYes]       = useState(1);
  const [newNo, setNewNo]         = useState(0);
  const [adding, setAdding]       = useState(false);
  const [editId, setEditId]       = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const { showToast }             = useApp();

  async function load() {
    setLoading(true);
    try {
      const all = await api.sectionQuestions(scriptId);
      setQuestions(all.filter(q => q.section_id === sectionId));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [sectionId]);

  async function add() {
    if (!newQ.trim()) return;
    setAdding(true);
    try {
      await api.addSectionQuestion(scriptId, { phase_id:phaseId, section_id:sectionId, question:newQ.trim(), yes_points:parseFloat(newYes)||1, no_points:parseFloat(newNo)||0 });
      setNewQ(''); setNewYes(1); setNewNo(0);
      await load(); showToast('Question added');
    } catch(e) { showToast(e.message,'error'); }
    finally { setAdding(false); }
  }

  async function save(id) {
    await api.updateSectionQuestion(scriptId, id, { question:editDraft.question?.trim(), yes_points:parseFloat(editDraft.yes_points)||0, no_points:parseFloat(editDraft.no_points)||0 });
    setEditId(null); await load();
  }

  async function toggle(id, enabled) {
    await api.updateSectionQuestion(scriptId, id, { enabled });
    await load();
  }

  async function remove(id) {
    if (!confirm('Remove this question?')) return;
    await api.deleteSectionQuestion(scriptId, id);
    await load(); showToast('Removed');
  }

  if (loading) return <div style={{padding:'8px 0',color:'var(--gray-400)',fontSize:12}}>Loading…</div>;

  return (
    <div style={{ paddingLeft:16, borderLeft:'2px solid var(--gray-200)', marginBottom:4 }}>
      {questions.length === 0 && (
        <div style={{ fontSize:12,color:'var(--gray-400)',fontStyle:'italic',padding:'4px 0 8px' }}>No questions yet</div>
      )}
      {questions.map((q,i) => (
        <div key={q.id} style={{ marginBottom:6,border:'1px solid var(--gray-200)',borderRadius:7,overflow:'hidden',opacity:q.enabled?1:0.55,background:q.enabled?'white':'#f8fafc' }}>
          {editId===q.id ? (
            <div style={{ padding:'8px 12px',display:'flex',flexDirection:'column',gap:8 }}>
              <textarea className="form-textarea" rows={2} value={editDraft.question||''} onChange={e=>setEditDraft(d=>({...d,question:e.target.value}))} style={{ marginBottom:0 }}/>
              <div style={{ display:'flex',gap:8,alignItems:'center' }}>
                <label style={{ fontSize:11,fontWeight:700,color:'#15803d' }}>Yes</label>
                <input type="number" step={0.5} value={editDraft.yes_points||0} onChange={e=>setEditDraft(d=>({...d,yes_points:e.target.value}))}
                  style={{ width:50,border:'1.5px solid #bbf7d0',borderRadius:5,padding:'2px 6px',fontSize:12,color:'#15803d',fontWeight:700,textAlign:'center' }}/>
                <label style={{ fontSize:11,fontWeight:700,color:'#dc2626' }}>No</label>
                <input type="number" step={0.5} value={editDraft.no_points||0} onChange={e=>setEditDraft(d=>({...d,no_points:e.target.value}))}
                  style={{ width:50,border:'1.5px solid #fca5a5',borderRadius:5,padding:'2px 6px',fontSize:12,color:'#dc2626',fontWeight:700,textAlign:'center' }}/>
                <button className="btn btn-primary btn-sm" onClick={()=>save(q.id)}>✓ Save</button>
                <button className="btn btn-ghost btn-sm" onClick={()=>setEditId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 10px' }}>
              <input type="checkbox" checked={!!q.enabled} onChange={e=>toggle(q.id,e.target.checked)} style={{ accentColor:'var(--navy-800)',flexShrink:0 }}/>
              <span style={{ flex:1,fontSize:12,fontWeight:600,color:'var(--navy-800)' }}>{q.question}</span>
              <span style={{ fontSize:11,padding:'1px 6px',borderRadius:8,background:'#dcfce7',color:'#15803d',fontWeight:700,flexShrink:0 }}>+{q.yes_points}</span>
              <span style={{ fontSize:11,padding:'1px 6px',borderRadius:8,background:'#fee2e2',color:'#dc2626',fontWeight:700,flexShrink:0 }}>{q.no_points>0?'+':''}{q.no_points}</span>
              <button onClick={()=>{setEditId(q.id);setEditDraft({question:q.question,yes_points:q.yes_points,no_points:q.no_points});}}
                style={{ fontSize:11,border:'1px solid var(--gray-200)',borderRadius:4,padding:'2px 7px',background:'white',cursor:'pointer',color:'var(--gray-600)',flexShrink:0 }}>✏️</button>
              <button onClick={()=>remove(q.id)}
                style={{ fontSize:11,border:'1px solid #fca5a5',borderRadius:4,padding:'2px 7px',background:'#fef2f2',cursor:'pointer',color:'#ef4444',flexShrink:0 }}>✕</button>
            </div>
          )}
        </div>
      ))}

      {/* Add inline */}
      <div style={{ display:'flex',gap:6,alignItems:'center',marginTop:4,flexWrap:'wrap' }}>
        <input className="form-input" value={newQ} onChange={e=>setNewQ(e.target.value)}
          placeholder='Add question — e.g. "Did you ask for the cell?"'
          onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); add(); } }}
          style={{ flex:1,fontSize:12,minWidth:200 }}/>
        <div style={{ display:'flex',gap:4,alignItems:'center',flexShrink:0 }}>
          <label style={{ fontSize:11,fontWeight:700,color:'#15803d' }}>Y</label>
          <input type="number" step={0.5} value={newYes} onChange={e=>setNewYes(e.target.value)}
            style={{ width:46,border:'1.5px solid #bbf7d0',borderRadius:5,padding:'3px 5px',fontSize:12,color:'#15803d',fontWeight:700,textAlign:'center' }}/>
          <label style={{ fontSize:11,fontWeight:700,color:'#dc2626' }}>N</label>
          <input type="number" step={0.5} value={newNo} onChange={e=>setNewNo(e.target.value)}
            style={{ width:46,border:'1.5px solid #fca5a5',borderRadius:5,padding:'3px 5px',fontSize:12,color:'#dc2626',fontWeight:700,textAlign:'center' }}/>
          <button className="btn btn-primary btn-sm" onClick={add} disabled={adding||!newQ.trim()}>
            {adding?'…':'+ Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Situational questions (script-level, no section) ─────────────────────────
function SituationalQuestions({ scriptId }) {
  const SITUATIONAL_PHASE = '__situational__';
  const SITUATIONAL_SECTION = '__situational__';
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [newQ, setNewQ]           = useState('');
  const [newYes, setNewYes]       = useState(1);
  const [newNo, setNewNo]         = useState(0);
  const [adding, setAdding]       = useState(false);
  const { showToast }             = useApp();

  async function load() {
    setLoading(true);
    try {
      const all = await api.sectionQuestions(scriptId);
      setQuestions(all.filter(q => q.phase_id === SITUATIONAL_PHASE));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [scriptId]);

  async function add() {
    if (!newQ.trim()) return;
    setAdding(true);
    try {
      await api.addSectionQuestion(scriptId, { phase_id:SITUATIONAL_PHASE, section_id:SITUATIONAL_SECTION, question:newQ.trim(), yes_points:parseFloat(newYes)||1, no_points:parseFloat(newNo)||0 });
      setNewQ(''); setNewYes(1); setNewNo(0);
      await load(); showToast('Situational question added');
    } catch(e) { showToast(e.message,'error'); }
    finally { setAdding(false); }
  }

  async function toggle(id, enabled) { await api.updateSectionQuestion(scriptId, id, { enabled }); await load(); }
  async function remove(id) {
    if (!confirm('Remove?')) return;
    await api.deleteSectionQuestion(scriptId, id); await load(); showToast('Removed');
  }

  if (loading) return <div style={{ padding:8,color:'var(--gray-400)',fontSize:12 }}>Loading…</div>;

  return (
    <div style={{ border:'2px solid #fde68a',borderRadius:10,overflow:'hidden',marginBottom:12 }}>
      <div style={{ padding:'10px 14px',background:'#fffbeb',borderBottom:'1px solid #fde68a',display:'flex',alignItems:'center',gap:10 }}>
        <span style={{ fontWeight:800,fontSize:13,color:'#92400e' }}>⚡ Situational Questions</span>
        <span style={{ fontSize:11,color:'#a16207',flex:1 }}>
          Not tied to any section — during scoring each one has its own "skip" toggle. Skipping = no penalty.
        </span>
      </div>
      <div style={{ padding:'10px 14px' }}>
        {questions.length===0 && <div style={{ fontSize:12,color:'var(--gray-400)',fontStyle:'italic',marginBottom:8 }}>No situational questions yet</div>}
        {questions.map(q=>(
          <div key={q.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'7px 10px',border:'1px solid var(--gray-200)',borderRadius:7,marginBottom:6,opacity:q.enabled?1:.55,background:q.enabled?'white':'#f8fafc' }}>
            <input type="checkbox" checked={!!q.enabled} onChange={e=>toggle(q.id,e.target.checked)} style={{ accentColor:'var(--navy-800)',flexShrink:0 }}/>
            <span style={{ flex:1,fontSize:12,fontWeight:600,color:'var(--navy-800)' }}>{q.question}</span>
            <span style={{ fontSize:10,color:'#a16207',background:'#fef9c3',padding:'1px 6px',borderRadius:8,border:'1px solid #fde68a',flexShrink:0 }}>situational</span>
            <span style={{ fontSize:11,padding:'1px 6px',borderRadius:8,background:'#dcfce7',color:'#15803d',fontWeight:700,flexShrink:0 }}>+{q.yes_points}</span>
            <button onClick={()=>remove(q.id)} style={{ fontSize:11,border:'1px solid #fca5a5',borderRadius:4,padding:'2px 7px',background:'#fef2f2',cursor:'pointer',color:'#ef4444',flexShrink:0 }}>✕</button>
          </div>
        ))}
        <div style={{ display:'flex',gap:6,alignItems:'center',flexWrap:'wrap' }}>
          <input className="form-input" value={newQ} onChange={e=>setNewQ(e.target.value)}
            placeholder='e.g. "Did you get their cell number?" / "Did you use a value word?"'
            onKeyDown={e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); add(); } }}
            style={{ flex:1,fontSize:12,minWidth:200 }}/>
          <div style={{ display:'flex',gap:4,alignItems:'center',flexShrink:0 }}>
            <label style={{ fontSize:11,fontWeight:700,color:'#15803d' }}>Y</label>
            <input type="number" step={0.5} value={newYes} onChange={e=>setNewYes(e.target.value)}
              style={{ width:46,border:'1.5px solid #bbf7d0',borderRadius:5,padding:'3px 5px',fontSize:12,color:'#15803d',fontWeight:700,textAlign:'center' }}/>
            <button className="btn btn-primary btn-sm" onClick={add} disabled={adding||!newQ.trim()}>
              {adding?'…':'+ Add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Builder tab ───────────────────────────────────────────────────────────────
function BuilderTab({ scripts }) {
  const [activeScriptId, setActiveScriptId] = useState(scripts[0]?.id || null);
  const [phases, setPhases]                 = useState([]);
  const [openPhase, setOpenPhase]           = useState(null);
  const [openSection, setOpenSection]       = useState(null);
  const [loading, setLoading]               = useState(false);

  async function loadScript(id) {
    setLoading(true);
    setOpenPhase(null); setOpenSection(null);
    try {
      const s = await api.script(id);
      const data = s.blocks;
      if (Array.isArray(data) && data.length>0 && data[0]?.sections) setPhases(data);
      else setPhases([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (activeScriptId) loadScript(activeScriptId); }, [activeScriptId]);

  const activeScript = scripts.find(s=>s.id===activeScriptId);

  return (
    <div style={{ display:'flex',gap:16 }}>
      {/* Script selector */}
      <div style={{ width:200,flexShrink:0 }}>
        <div style={{ fontWeight:700,fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8 }}>Scripts</div>
        <div className="table-card" style={{ padding:0 }}>
          {scripts.map(s=>(
            <div key={s.id} onClick={()=>setActiveScriptId(s.id)}
              style={{ padding:'10px 14px',cursor:'pointer',borderBottom:'1px solid var(--gray-100)',background:activeScriptId===s.id?'#fef9ec':'white',borderLeft:activeScriptId===s.id?'3px solid var(--gold-500)':'3px solid transparent',display:'flex',justifyContent:'space-between',alignItems:'center' }}>
              <span style={{ fontSize:13,fontWeight:activeScriptId===s.id?700:400 }}>{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Phase / section tree */}
      <div style={{ flex:1,minWidth:0 }}>
        {loading ? (
          <div style={{ color:'var(--gray-400)',padding:20 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14 }}>
              <div style={{ fontWeight:800,fontSize:15,color:'var(--navy-800)' }}>
                📊 {activeScript?.name} — Scorecard Builder
              </div>
              {activeScriptId && (
                <button className="btn btn-ghost btn-sm"
                  onClick={()=>{
                    // Open a preview scorecard modal
                    window.__scorecardPreviewScriptId = activeScriptId;
                    window.__scorecardPreviewScriptName = activeScript?.name;
                    window.dispatchEvent(new CustomEvent('scorecard-preview'));
                  }}
                  style={{ fontSize:11,display:'flex',alignItems:'center',gap:5 }}>
                  👁 Preview Scorecard
                </button>
              )}
            </div>

            {/* Tip */}
            <div style={{ background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'8px 14px',fontSize:11,color:'#1e40af',marginBottom:16,lineHeight:1.6 }}>
              Click any section to add questions to it. During scoring, questions only count when that section is marked as used.
              Use <strong>Situational Questions</strong> for things that can happen at any point in the call.
            </div>

            {phases.length === 0 ? (
              <div style={{ color:'var(--gray-400)',fontSize:13,textAlign:'center',padding:32 }}>
                No phases found — build your script in Settings → Scripts first.
              </div>
            ) : phases.map(ph => {
              const allSections = ph.sections;
              return (
                <div key={ph.id} style={{ border:'1px solid var(--gray-200)',borderRadius:10,overflow:'hidden',marginBottom:12 }}>
                  {/* Phase header */}
                  <div onClick={()=>setOpenPhase(p=>p===ph.id?null:ph.id)}
                    style={{ padding:'10px 14px',background:'var(--navy-950)',cursor:'pointer',display:'flex',alignItems:'center',gap:10 }}>
                    <span style={{ fontSize:11,color:'rgba(255,255,255,.35)',display:'inline-block',transition:'transform .15s',transform:openPhase===ph.id?'none':'rotate(-90deg)' }}>▼</span>
                    <span style={{ fontWeight:800,fontSize:14,color:'white',flex:1 }}>{ph.name}</span>
                    <span style={{ fontSize:11,color:'rgba(255,255,255,.35)' }}>{allSections.length} section{allSections.length!==1?'s':''}</span>
                  </div>

                  {openPhase === ph.id && (
                    <div style={{ padding:'12px 14px' }}>
                      {allSections.length === 0 ? (
                        <div style={{ fontSize:12,color:'var(--gray-400)',fontStyle:'italic',padding:'4px 0' }}>
                          No sections yet — add sections in the Script editor.
                        </div>
                      ) : allSections.map(sec => {
                        const def = SECTION_TYPES[sec.type] || SECTION_TYPES.info;
                        const secKey = `${ph.id}_${sec.id}`;
                        const isOpen = openSection === secKey;
                        const displayLabel = sec.label || sec.title || (sec.type.charAt(0).toUpperCase()+sec.type.slice(1));
                        return (
                          <div key={sec.id} style={{ marginBottom:8 }}>
                            {/* Section row */}
                            <div onClick={()=>setOpenSection(k=>k===secKey?null:secKey)}
                              style={{ display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderRadius:8,border:`1.5px solid ${isOpen?def.border:'var(--gray-200)'}`,background:isOpen?def.bg:'white',cursor:'pointer' }}>
                              <span style={{ fontSize:14 }}>{def.icon}</span>
                              <span style={{ fontSize:12,fontWeight:700,color:isOpen?def.color:'var(--navy-800)',flex:1 }}>
                                {def.label}: {displayLabel}
                              </span>
                              <span style={{ fontSize:10,color:'var(--gray-400)',transform:isOpen?'none':'rotate(-90deg)',display:'inline-block',transition:'transform .15s' }}>▼</span>
                            </div>

                            {isOpen && (
                              <div style={{ marginTop:6 }}>
                                <SectionQuestions
                                  scriptId={activeScriptId}
                                  phaseId={ph.id}
                                  sectionId={sec.id}
                                  sectionLabel={displayLabel}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Situational questions — always shown at bottom */}
            {activeScriptId && <SituationalQuestions scriptId={activeScriptId}/>}
          </>
        )}
      </div>
    </div>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────
function HistoryRow({ entry, scripts, onReviewSaved }) {
  const [expanded, setExpanded]         = useState(false);
  const [reviewNote, setReviewNote]     = useState(entry.reviewer_notes||'');
  const [saving, setSaving]             = useState(false);
  const [allQuestions, setAllQuestions] = useState([]);
  const { showToast, user }             = useApp();

  const pct        = entry.max_score>0 ? Math.round((entry.total_score/entry.max_score)*100) : null;
  const scriptNames= (entry.script_ids||[]).map(id=>scripts.find(s=>s.id===id)?.name||`Script ${id}`).join(', ');
  const rawDate    = entry.logged_at || '';
  const dateStr    = (() => {
    try {
      const iso = rawDate.includes('T') ? rawDate : rawDate.replace(' ','T')+'Z';
      return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    } catch { return rawDate.slice(0,10)||'—'; }
  })();

  async function handleExpand() {
    const next = !expanded;
    setExpanded(next);
    if (next && allQuestions.length===0 && entry.script_ids?.length>0) {
      try {
        const qs = await Promise.all(entry.script_ids.map(sid=>api.sectionQuestions(sid)));
        setAllQuestions(qs.flat());
      } catch(_) {}
    }
  }

  async function saveReview() {
    setSaving(true);
    try {
      await api.updateScorecardEntry(entry.id,{reviewer_notes:reviewNote,reviewed_by:user?.name||'Manager'});
      onReviewSaved?.(); showToast('Review saved');
    } catch(e){ showToast(e.message,'error'); }
    finally { setSaving(false); }
  }

  const answers     = entry.answers || {};
  const answeredQs  = allQuestions.filter(q => {
    const sid = entry.script_ids?.[0];
    return [`${sid}_${q.id}`,String(q.id),`obj_${sid}_${q.id}`,`sit_${sid}_${q.id}`].some(k=>answers[k]!==undefined);
  }).map(q => {
    const sid = entry.script_ids?.[0];
    const val = answers[`${sid}_${q.id}`]??answers[String(q.id)]??answers[`obj_${sid}_${q.id}`]??answers[`sit_${sid}_${q.id}`];
    return { question:q.question, val, yes_points:q.yes_points, no_points:q.no_points };
  });

  return (
    <div style={{ border:'1px solid var(--gray-200)',borderRadius:9,overflow:'hidden',marginBottom:6 }}>
      <div onClick={handleExpand} style={{ padding:'10px 14px',cursor:'pointer',display:'flex',alignItems:'center',gap:12,background:expanded?'#fef9ec':'white',borderBottom:expanded?'1px solid var(--gray-200)':'none' }}>
        <span style={{ fontSize:11,color:'var(--gray-400)',whiteSpace:'nowrap',minWidth:80 }}>{dateStr}</span>
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ fontWeight:700,fontSize:13,color:'var(--navy-800)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{entry.entity_name||'Manual Entry'}</div>
          {scriptNames&&<div style={{ fontSize:11,color:'var(--gray-400)',marginTop:1 }}>{scriptNames}</div>}
        </div>
        {entry.reviewer_notes&&<span title="Manager reviewed">👁</span>}
        <Badge pct={pct}/>
        <span style={{ fontSize:11,color:'var(--gray-400)',whiteSpace:'nowrap' }}>{entry.total_score.toFixed(1)}/{entry.max_score.toFixed(1)} pts</span>
        <span style={{ fontSize:11,color:'var(--gray-400)',display:'inline-block',transition:'transform .15s',transform:expanded?'rotate(180deg)':'none' }}>▼</span>
      </div>
      {expanded&&(
        <div style={{ padding:'14px 16px',background:'#fafafa',display:'flex',flexDirection:'column',gap:12 }}>
          {pct!==null&&(
            <div>
              <div style={{ display:'flex',justifyContent:'space-between',fontSize:11,color:'var(--gray-500)',marginBottom:4 }}><span>Score</span><span style={{ fontWeight:700,color:pctColor(pct) }}>{pct}%</span></div>
              <div style={{ height:8,background:'#e2e8f0',borderRadius:4,overflow:'hidden' }}><div style={{ height:'100%',width:`${pct}%`,background:pctColor(pct),borderRadius:4,transition:'width .3s' }}/></div>
            </div>
          )}
          {answeredQs.length>0&&(
            <div>
              <div style={{ fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8 }}>Questions & Answers</div>
              <div style={{ border:'1px solid var(--gray-200)',borderRadius:8,overflow:'hidden' }}>
                {answeredQs.map((q,i)=>{
                  const isYes=q.val==='yes', isNo=q.val==='no';
                  return (
                    <div key={i} style={{ display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderBottom:i<answeredQs.length-1?'1px solid var(--gray-100)':'none',background:'white' }}>
                      <span style={{ flex:1,fontSize:12,color:'var(--navy-800)',fontWeight:500 }}>{q.question}</span>
                      <span style={{ fontSize:11,fontWeight:700,padding:'2px 10px',borderRadius:20,background:isYes?'#dcfce7':isNo?'#fee2e2':'#f1f5f9',color:isYes?'#15803d':isNo?'#dc2626':'#94a3b8' }}>
                        {isYes?`✓ Yes (+${q.yes_points}pts)`:isNo?`✗ No (${q.no_points}pts)`:'Skipped'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {entry.notes&&<div><div style={{ fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4 }}>Rep Notes</div><div style={{ fontSize:13,color:'var(--gray-700)',background:'white',border:'1px solid var(--gray-200)',borderRadius:7,padding:'8px 12px' }}>{entry.notes}</div></div>}
          <div>
            <div style={{ fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6 }}>
              Manager Review {entry.reviewed_by&&<span style={{ fontWeight:400,textTransform:'none',marginLeft:8,color:'var(--gray-400)' }}>by {entry.reviewed_by}</span>}
            </div>
            <textarea className="form-textarea" rows={2} placeholder="Add coaching notes…" value={reviewNote} onChange={e=>setReviewNote(e.target.value)} style={{ marginBottom:6 }}/>
            <button className="btn btn-primary btn-sm" onClick={saveReview} disabled={saving||reviewNote===(entry.reviewer_notes||'')}>{saving?'Saving…':'💾 Save Review'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryTab({ scripts }) {
  const [entries, setEntries] = useState([]);
  const [daily, setDaily]     = useState([]);
  const [days, setDays]       = useState(30);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');

  async function load() {
    setLoading(true);
    try { const [e,d]=await Promise.all([api.scorecardEntries(days),api.scorecardDaily(days)]); setEntries(e); setDaily(d); }
    finally { setLoading(false); }
  }
  useEffect(()=>{ load(); },[days]);

  const filtered = entries.filter(e=>!search||(e.entity_name||'').toLowerCase().includes(search.toLowerCase()));
  const avgPct = entries.length>0 ? Math.round(entries.reduce((s,e)=>s+(e.max_score>0?e.total_score/e.max_score*100:0),0)/entries.length) : null;

  return (
    <div>
      {entries.length>0&&(
        <div style={{ display:'flex',gap:12,marginBottom:20,flexWrap:'wrap' }}>
          {[{label:'Scorecards',val:entries.length,sub:`last ${days} days`,color:'var(--navy-800)'},{label:'Avg Score',val:avgPct!==null?avgPct+'%':'—',sub:'',color:pctColor(avgPct)},{label:'Reviewed',val:entries.filter(e=>e.reviewer_notes).length,sub:`of ${entries.length}`,color:'var(--navy-800)'}].map((c,i)=>(
            <div key={i} style={{ flex:1,minWidth:120,background:'#f8fafc',border:'1px solid var(--gray-200)',borderRadius:10,padding:'12px 16px' }}>
              <div style={{ fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4 }}>{c.label}</div>
              <div style={{ fontSize:24,fontWeight:800,color:c.color }}>{c.val}</div>
              {c.sub&&<div style={{ fontSize:11,color:'var(--gray-400)' }}>{c.sub}</div>}
            </div>
          ))}
          {daily.length>0&&(
            <div style={{ flex:2,minWidth:180,background:'#f8fafc',border:'1px solid var(--gray-200)',borderRadius:10,padding:'12px 16px' }}>
              <div style={{ fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8 }}>Trend</div>
              <div style={{ display:'flex',alignItems:'flex-end',gap:3,height:32 }}>
                {[...daily].reverse().slice(0,20).map(d=>{ const h=d.avg_pct?Math.max(3,Math.round((d.avg_pct/100)*32)):3; return <div key={d.day} title={`${d.day}: ${d.avg_pct}%`} style={{ flex:1,height:h,background:pctColor(d.avg_pct),borderRadius:'2px 2px 0 0',minWidth:4,opacity:.85 }}/>; })}
              </div>
            </div>
          )}
        </div>
      )}
      <div style={{ display:'flex',gap:10,alignItems:'center',marginBottom:14 }}>
        {[7,30,90].map(d=>(<button key={d} onClick={()=>setDays(d)} className={`btn btn-sm ${days===d?'btn-navy':'btn-ghost'}`} style={{ fontSize:11 }}>{d}d</button>))}
        <input className="form-input" placeholder="Search company…" value={search} onChange={e=>setSearch(e.target.value)} style={{ maxWidth:220,fontSize:12 }}/>
        <span style={{ fontSize:11,color:'var(--gray-400)',marginLeft:'auto' }}>{filtered.length} scorecard{filtered.length!==1?'s':''}</span>
      </div>
      {loading?(<div style={{ textAlign:'center',padding:32,color:'var(--gray-400)' }}>Loading…</div>
      ):filtered.length===0?(<div style={{ textAlign:'center',padding:'40px 0',color:'var(--gray-400)',fontSize:13 }}>No scorecards yet.</div>
      ):filtered.map(entry=>(<HistoryRow key={entry.id} entry={entry} scripts={scripts} onReviewSaved={load}/>))}
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function ScoreCardSettings({ defaultTab = 'builder' }) {
  const [scripts, setScripts]   = useState([]);
  const [enabled, setEnabled]   = useState(false);
  const [tab, setTab]           = useState(defaultTab);
  const [loading, setLoading]   = useState(true);
  const [toggling, setToggling] = useState(false);
  const { showToast }           = useApp();

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try { const [s,e]=await Promise.all([api.scripts(),api.scorecardEnabled()]); setScripts(s); setEnabled(e.enabled); }
      finally { setLoading(false); }
    })();
  },[]);

  async function toggleEnabled() {
    setToggling(true);
    try {
      const r=await api.setScorecardEnabled(!enabled);
      setEnabled(r.enabled);
      showToast(r.enabled?'✅ Scorecard enabled':'Scorecard disabled');
    } catch(e){ showToast(e.message,'error'); }
    finally { setToggling(false); }
  }

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <div style={{ maxWidth:960 }}>
      {/* Toggle */}
      <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between',background:enabled?'#f0fdf4':'#f8fafc',border:`1.5px solid ${enabled?'#bbf7d0':'var(--gray-200)'}`,borderRadius:10,padding:'14px 18px',marginBottom:20 }}>
        <div>
          <div style={{ fontWeight:800,fontSize:14,color:enabled?'#15803d':'var(--navy-800)' }}>{enabled?'✅ Scorecard is ON':'⏸ Scorecard is OFF'}</div>
          <div style={{ fontSize:12,color:'var(--gray-500)',marginTop:2 }}>
            {enabled?'A scorecard popup will appear after every logged call.':'Enable to pop up a scorecard after every call. The manual 📋 Scorecard button in the Calling Queue always works.'}
          </div>
        </div>
        <button className={`btn btn-sm ${enabled?'btn-ghost':'btn-primary'}`}
          style={{ border:enabled?'1.5px solid #bbf7d0':undefined,color:enabled?'#15803d':undefined,flexShrink:0 }}
          onClick={toggleEnabled} disabled={toggling}>
          {toggling?'…':enabled?'⏸ Disable':'▶ Enable'}
        </button>
      </div>

      {scripts.length===0?(
        <div style={{ textAlign:'center',padding:'40px 20px',color:'var(--gray-400)',fontSize:13,background:'#f8fafc',borderRadius:10,border:'1px solid var(--gray-200)' }}>
          No scripts yet — go to <strong>Scripts</strong> tab to create a script first.
        </div>
      ):(
        <>
          <div style={{ display:'flex',borderBottom:'2px solid var(--gray-100)',marginBottom:20 }}>
            {[{id:'builder',label:'🏗️ Question Builder'},{id:'history',label:'📊 Score History'}].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:'9px 20px',fontSize:13,fontWeight:700,background:'none',border:'none',cursor:'pointer',borderBottom:tab===t.id?'2px solid var(--navy-800)':'2px solid transparent',color:tab===t.id?'var(--navy-800)':'var(--gray-400)',marginBottom:-2 }}>
                {t.label}
              </button>
            ))}
          </div>
          {tab==='builder'&&<BuilderTab scripts={scripts}/>}
          {tab==='history'&&<HistoryTab scripts={scripts}/>}
        </>
      )}
    </div>
  );
}
