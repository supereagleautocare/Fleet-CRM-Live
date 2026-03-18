/**
 * ScriptEditor v3
 * Section fields: id, type, label, title, question, content, on_scorecard
 *   label    — trigger text (opener: "Call Center", response: "What's this in regards to?")
 *   title    — named heading (pitch: "3 YEAR WARRANTY")
 *   question — stump question shown above benefit (pitch only)
 *   content  — main body / benefit text
 * Auto-save: 2.5s debounce, silent
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

export const SECTION_TYPES = {
  opener:    { label:'Opener',      icon:'🎯', color:'#1e40af', bg:'#eff6ff', border:'#bfdbfe' },
  response:  { label:'Response',    icon:'↩️', color:'#166534', bg:'#f0fdf4', border:'#bbf7d0' },
  objection: { label:'Objection',   icon:'🛡️', color:'#9a3412', bg:'#fff7ed', border:'#fed7aa' },
  pitch:     { label:'Pitch',       icon:'📢', color:'#475569', bg:'#f8fafc', border:'#e2e8f0' },
  close:     { label:'Close',       icon:'🏁', color:'#6b21a8', bg:'#fdf4ff', border:'#e9d5ff' },
  info:      { label:'Info/Note',   icon:'📌', color:'#374151', bg:'#f9fafb', border:'#d1d5db' },
  voicemail: { label:'Voicemail',   icon:'📭', color:'#0369a1', bg:'#f0f9ff', border:'#bae6fd' },
  wait:      { label:'Wait/Pause',  icon:'⏸️', color:'#7c3aed', bg:'#fdf4ff', border:'#ddd6fe' },
  oneliners: { label:'One-Liners',  icon:'⚡', color:'#92400e', bg:'#fffbeb', border:'#fde68a' },
  values:    { label:'Value Words', icon:'💎', color:'#065f46', bg:'#ecfdf5', border:'#a7f3d0' },
};
export const BLOCK_DEFS = SECTION_TYPES;

function uid() { return `s_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

function makeSection(type = 'opener') {
  return {
    id: uid(), type,
    label: '', title: '', question: '', content: '',
    on_scorecard: ['opener','response','objection','close','voicemail'].includes(type),
  };
}
function makePhase(name = 'New Phase') {
  return { id: uid(), name, sections: [makeSection('opener')] };
}

export function parseInline(text) {
  if (!text) return [];
  const parts = [], re = /(\*\*[^*]+\*\*|\[\[[^\]]+\]\])/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ t:'plain', v:text.slice(last, m.index) });
    const raw = m[0];
    if (raw.startsWith('**')) parts.push({ t:'bold', v:raw.slice(2,-2) });
    else parts.push({ t:'highlight', v:raw.slice(2,-2) });
    last = m.index + raw.length;
  }
  if (last < text.length) parts.push({ t:'plain', v:text.slice(last) });
  return parts;
}
export function extractPhrases(text) {
  const out=[]; const re=/\[\[([^\]]+)\]\]/g; let m;
  while((m=re.exec(text||''))!==null) out.push(m[1]);
  return out;
}
export function InlineText({ text }) {
  return (<>{parseInline(text).map((p,i)=>{
    if(p.t==='bold') return <strong key={i}>{p.v}</strong>;
    if(p.t==='highlight') return <mark key={i} style={{background:'#fef08a',color:'#713f12',borderRadius:2,padding:'0 2px'}}>{p.v}</mark>;
    return <span key={i}>{p.v}</span>;
  })}</>);
}

// ── Section row ───────────────────────────────────────────────────────────────
function SectionRow({ section, index, total, onChange, onDelete, onMove, onAddBelow, onDuplicate }) {
  const def = SECTION_TYPES[section.type] || SECTION_TYPES.info;
  const isIndented  = section.type === 'response' || section.type === 'objection';
  const isWordList  = section.type === 'oneliners' || section.type === 'values';
  const hasTrigger  = ['opener','response','objection','voicemail','wait'].includes(section.type);
  const hasTitle    = ['pitch','close','objection','response','info'].includes(section.type);
  const hasQuestion = section.type === 'pitch';
  const phrases     = extractPhrases(section.content || '');

  return (
    <div style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
      {/* Move */}
      <div style={{ display:'flex',flexDirection:'column',gap:2,paddingTop:6,flexShrink:0 }}>
        <button onClick={()=>onMove(-1)} disabled={index===0}
          style={{ width:20,height:20,border:'1px solid #e2e8f0',borderRadius:3,background:'white',cursor:index===0?'default':'pointer',fontSize:9,opacity:index===0?.3:1,display:'flex',alignItems:'center',justifyContent:'center' }}>▲</button>
        <button onClick={()=>onMove(1)} disabled={index===total-1}
          style={{ width:20,height:20,border:'1px solid #e2e8f0',borderRadius:3,background:'white',cursor:index===total-1?'default':'pointer',fontSize:9,opacity:index===total-1?.3:1,display:'flex',alignItems:'center',justifyContent:'center' }}>▼</button>
      </div>

      {isIndented && <div style={{ width:3,background:def.border,borderRadius:2,alignSelf:'stretch',flexShrink:0,marginTop:6 }}/>}

      <div style={{ flex:1,border:`2px solid ${def.border}`,borderRadius:10,overflow:'hidden',background:'white',marginLeft:isIndented?10:0 }}>
        {/* Toolbar */}
        <div style={{ display:'flex',gap:6,padding:'6px 10px',background:def.bg,alignItems:'center',flexWrap:'wrap' }}>
          <select value={section.type} onChange={e=>onChange('type',e.target.value)}
            style={{ fontSize:12,border:'none',borderRadius:6,padding:'3px 8px',background:'rgba(255,255,255,.8)',color:def.color,fontWeight:700,cursor:'pointer' }}>
            {Object.entries(SECTION_TYPES).map(([v,d])=>(
              <option key={v} value={v}>{d.icon} {d.label}</option>
            ))}
          </select>

          {hasTrigger && (
            <input value={section.label||''} onChange={e=>onChange('label',e.target.value)}
              placeholder={
                section.type==='opener'    ? 'Who this is for — e.g. "Call Center", "Have Name", "No Name"' :
                section.type==='voicemail' ? 'VM label — e.g. "VM #1 — First Touch"' :
                section.type==='objection' ? 'If they say: "We\'re happy where we are"…' :
                section.type==='wait'      ? 'Pause label — e.g. "Wait for name", "Wait for response"' :
                                             'If they say: "What\'s this in regards to?"…'
              }
              style={{ flex:1,border:'none',padding:'4px 8px',borderRadius:6,fontSize:12,fontStyle:'italic',background:'rgba(255,255,255,.8)',color:def.color,outline:'none',minWidth:180 }}/>
          )}
          {!hasTrigger && (
            <span style={{ fontSize:11,color:def.color,opacity:.55,fontStyle:'italic',flex:1 }}>{def.label}</span>
          )}

          <div style={{ display:'flex',gap:4,alignItems:'center',flexShrink:0 }}>
            <label title="Include on scorecard" style={{ display:'flex',alignItems:'center',gap:4,cursor:'pointer',fontSize:11,color:def.color,padding:'2px 7px',borderRadius:6,background:section.on_scorecard?'#fef9c3':'rgba(255,255,255,.5)',border:section.on_scorecard?'1px solid #fde68a':'1px solid transparent' }}>
              <input type="checkbox" checked={!!section.on_scorecard} onChange={e=>onChange('on_scorecard',e.target.checked)}
                style={{ accentColor:'#f59e0b',width:11,height:11 }}/>
              📊
            </label>
            <button onClick={onDuplicate} title="Duplicate as variant"
              style={{ padding:'2px 7px',fontSize:11,border:`1px solid ${def.border}`,borderRadius:5,background:'rgba(255,255,255,.7)',color:def.color,cursor:'pointer' }}>⧉</button>
            <button onClick={onDelete}
              style={{ padding:'2px 7px',fontSize:11,border:'1px solid #fca5a5',borderRadius:5,background:'#fef2f2',color:'#ef4444',cursor:'pointer',fontWeight:700 }}>✕</button>
          </div>
        </div>

        {/* Title field (pitch/close/etc) */}
        {hasTitle && (
          <input value={section.title||''} onChange={e=>onChange('title',e.target.value)}
            placeholder={
              section.type==='pitch' ? 'Title — e.g. "3 YEAR WARRANTY" or "SAME DAY SERVICE" (optional)' :
              section.type==='close' ? 'Close name — e.g. "Closing A" or "Direct Ask"' :
                                       'Label — optional heading for this block'
            }
            style={{ display:'block',width:'100%',padding:'7px 12px',border:'none',borderBottom:`1px solid ${def.border}`,background:'rgba(248,250,252,.6)',fontSize:13,fontWeight:700,color:def.color,outline:'none',boxSizing:'border-box',textTransform:section.type==='pitch'?'uppercase':'none',letterSpacing:section.type==='pitch'?'.04em':'normal' }}/>
        )}

        {/* Stump question (pitch only) */}
        {hasQuestion && (
          <input value={section.question||''} onChange={e=>onChange('question',e.target.value)}
            placeholder='Stump question — e.g. "Do you currently get a 3-year warranty on work done?" (optional)'
            style={{ display:'block',width:'100%',padding:'7px 12px',border:'none',borderBottom:`1px solid ${def.border}`,background:'#fefce8',fontSize:13,fontStyle:'italic',color:'#713f12',outline:'none',boxSizing:'border-box' }}/>
        )}

        {/* Main content — hidden for wait/pause sections */}
        {section.type !== 'wait' && (
        <textarea value={section.content||''} onChange={e=>onChange('content',e.target.value)}
          rows={isWordList?3:4}
          placeholder={
            section.type==='opener'    ? 'Opening line — use [[phrase]] to highlight key words' :
            section.type==='response'  ? 'What you say when they respond this way…' :
            section.type==='objection' ? 'Your rebuttal…  Use **word** to bold key words' :
            section.type==='pitch'     ? 'Benefit / body — e.g. "We back our repairs for 3 years because…"' :
            section.type==='close'     ? 'Closing statement to get the appointment…' :
            section.type==='voicemail' ? 'Hey [name], this is [your name] with [company]…' :
            section.type==='oneliners' ? 'One-liners you can drop anywhere (one per line)…' :
                                         'Value words — drop these in naturally: reliability, proven, local…'
          }
          style={{ display:'block',width:'100%',padding:'10px 12px',border:'none',background:'transparent',resize:'vertical',fontFamily:'inherit',outline:'none',fontSize:14,lineHeight:1.65,boxSizing:'border-box',color:'#1e293b' }}/>
        )}

        {/* Phrase preview */}
        {phrases.length > 0 && (
          <div style={{ padding:'5px 12px',background:'#fefce8',borderTop:'1px solid #fde68a',display:'flex',gap:6,flexWrap:'wrap',alignItems:'center' }}>
            <span style={{ fontSize:10,fontWeight:700,color:'#92400e' }}>📊 phrases:</span>
            {phrases.map((p,i)=>(
              <span key={i} style={{ fontSize:11,background:'#fef9c3',color:'#713f12',padding:'1px 8px',borderRadius:10,border:'1px solid #fde68a' }}>{p}</span>
            ))}
          </div>
        )}

        {!isWordList && section.type !== 'wait' && (
          <div style={{ padding:'0 12px 6px',fontSize:10,color:'#94a3b8',display:'flex',gap:14,flexWrap:'wrap' }}>
            <span><code style={{background:'#f1f5f9',padding:'0 3px',borderRadius:3}}>**word**</code> bold</span>
            <span><code style={{background:'#fef9c3',padding:'0 3px',borderRadius:3}}>[[phrase]]</code> highlight + scorecard</span>
            <span><code style={{background:'#ede9fe',padding:'0 3px',borderRadius:3,color:'#7c3aed'}}>||</code> pause / wait for response</span>
          </div>
        )}
      </div>

      {/* Add-below quick buttons */}
      <div style={{ display:'flex',flexDirection:'column',gap:2,paddingTop:6,flexShrink:0 }}>
        {Object.entries(SECTION_TYPES).map(([type,d])=>(
          <button key={type} onClick={()=>onAddBelow(type)} title={`Add ${d.label} below`}
            style={{ width:20,height:20,border:`1px solid ${d.border}`,borderRadius:3,background:d.bg,cursor:'pointer',fontSize:10,display:'flex',alignItems:'center',justifyContent:'center',color:d.color }}>
            {d.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Phase editor ──────────────────────────────────────────────────────────────
function PhaseEditor({ phase, phaseIndex, totalPhases, onChange, onDelete, onMove }) {
  const [collapsed, setCollapsed] = useState(false);

  function chg(id,f,v) { onChange({...phase, sections:phase.sections.map(s=>s.id===id?{...s,[f]:v}:s)}); }
  function del(id)      { if(phase.sections.length===1)return; onChange({...phase, sections:phase.sections.filter(s=>s.id!==id)}); }
  function mov(id,dir)  {
    const a=[...phase.sections],i=a.findIndex(s=>s.id===id),j=i+dir;
    if(j<0||j>=a.length)return; [a[i],a[j]]=[a[j],a[i]]; onChange({...phase,sections:a});
  }
  function addBelow(aftId,type) {
    const ns=makeSection(type), a=[...phase.sections], i=a.findIndex(s=>s.id===aftId);
    a.splice(i+1,0,ns); onChange({...phase,sections:a});
  }
  function addEnd(type)    { onChange({...phase,sections:[...phase.sections,makeSection(type)]}); }
  function duplicate(id)   {
    const src=phase.sections.find(s=>s.id===id);
    const copy={...src,id:uid(),label:(src.label?src.label+' (copy)':'Copy')};
    const a=[...phase.sections]; a.splice(a.findIndex(s=>s.id===id)+1,0,copy);
    onChange({...phase,sections:a});
  }

  return (
    <div style={{ border:'2px solid var(--gray-200)',borderRadius:12,overflow:'hidden',marginBottom:14 }}>
      {/* Phase header */}
      <div style={{ display:'flex',alignItems:'center',gap:10,padding:'10px 14px',background:'var(--navy-950)',cursor:'pointer' }}
        onClick={()=>setCollapsed(c=>!c)}>
        <span style={{ fontSize:11,color:'rgba(255,255,255,.35)',display:'inline-block',transition:'transform .15s',transform:collapsed?'rotate(-90deg)':'none' }}>▼</span>
        <input value={phase.name} onChange={e=>{e.stopPropagation();onChange({...phase,name:e.target.value});}}
          onClick={e=>e.stopPropagation()}
          style={{ background:'transparent',border:'none',color:'white',fontWeight:800,fontSize:15,outline:'none',flex:1,fontFamily:'inherit' }}/>
        <span style={{ fontSize:11,color:'rgba(255,255,255,.35)' }}>{phase.sections.length} section{phase.sections.length!==1?'s':''}</span>
        <div style={{ display:'flex',gap:4 }} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>onMove(-1)} disabled={phaseIndex===0}
            style={{ padding:'2px 7px',fontSize:11,border:'1px solid rgba(255,255,255,.2)',borderRadius:5,background:'transparent',color:'rgba(255,255,255,.6)',cursor:phaseIndex===0?'default':'pointer',opacity:phaseIndex===0?.3:1 }}>▲</button>
          <button onClick={()=>onMove(1)} disabled={phaseIndex===totalPhases-1}
            style={{ padding:'2px 7px',fontSize:11,border:'1px solid rgba(255,255,255,.2)',borderRadius:5,background:'transparent',color:'rgba(255,255,255,.6)',cursor:phaseIndex===totalPhases-1?'default':'pointer',opacity:phaseIndex===totalPhases-1?.3:1 }}>▼</button>
          <button onClick={onDelete}
            style={{ padding:'2px 7px',fontSize:11,border:'1px solid #fca5a5',borderRadius:5,background:'transparent',color:'#fca5a5',cursor:'pointer',fontWeight:700 }}>✕ Phase</button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding:'14px 12px',display:'flex',flexDirection:'column',gap:10 }}>
          {phase.sections.map((s,i)=>(
            <SectionRow key={s.id} section={s} index={i} total={phase.sections.length}
              onChange={(f,v)=>chg(s.id,f,v)}
              onDelete={()=>del(s.id)}
              onMove={dir=>mov(s.id,dir)}
              onAddBelow={type=>addBelow(s.id,type)}
              onDuplicate={()=>duplicate(s.id)}/>
          ))}
          <div style={{ display:'flex',gap:6,flexWrap:'wrap',paddingTop:4 }}>
            <span style={{ fontSize:11,color:'var(--gray-400)',fontWeight:600,alignSelf:'center' }}>+ Add:</span>
            {Object.entries(SECTION_TYPES).map(([type,d])=>(
              <button key={type} onClick={()=>addEnd(type)}
                style={{ padding:'4px 10px',borderRadius:14,border:`1.5px solid ${d.border}`,background:d.bg,color:d.color,cursor:'pointer',fontSize:11,fontWeight:600 }}>
                {d.icon} {d.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ScriptEditor ─────────────────────────────────────────────────────────
export default function ScriptEditor() {
  const [scripts, setScripts]       = useState([]);
  const [activeId, setActiveId]     = useState(null);
  const [phases, setPhases]         = useState([]);
  const [scriptName, setScriptName] = useState('');
  const [loading, setLoading]       = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error
  const [showNew, setShowNew]       = useState(false);
  const [newName, setNewName]       = useState('');
  const activeIdRef                 = useRef(null);
  const phasesRef                   = useRef([]);
  const nameRef                     = useRef('');
  const saveTimer                   = useRef(null);
  const popupRef                    = useRef(null);
  const { showToast }               = useApp();

  // Keep refs in sync for use inside debounced save
  useEffect(()=>{ phasesRef.current = phases; },[phases]);
  useEffect(()=>{ nameRef.current = scriptName; },[scriptName]);
  useEffect(()=>{ activeIdRef.current = activeId; },[activeId]);

  async function loadList() { const l=await api.scripts(); setScripts(l); return l; }

  async function selectScript(id) {
    const s = await api.script(id);
    setActiveId(id);
    setScriptName(s.name);
    const data = s.blocks;
    if (Array.isArray(data) && data.length>0 && data[0]?.sections) {
      setPhases(data);
    } else {
      setPhases([{ id:uid(), name:'Main Script', sections: Array.isArray(data)&&data.length>0
        ? data.map(b=>({...makeSection(b.type||'pitch'),content:b.content||'',label:b.label||'',on_scorecard:b.on_scorecard??false}))
        : [makeSection('opener')] }]);
    }
    setSaveStatus('idle');
  }

  useEffect(()=>{
    (async()=>{
      setLoading(true);
      try { const l=await loadList(); if(l.length>0) await selectScript(l[0].id); }
      finally { setLoading(false); }
    })();
  },[]);

  // Debounced auto-save
  function triggerAutoSave() {
    clearTimeout(saveTimer.current);
    setSaveStatus('idle');
    saveTimer.current = setTimeout(async () => {
      if (!activeIdRef.current) return;
      setSaveStatus('saving');
      try {
        await api.updateScript(activeIdRef.current, { name:nameRef.current, blocks:phasesRef.current });
        setSaveStatus('saved');
        await loadList();
        setTimeout(()=>setSaveStatus('idle'), 2000);
      } catch(e) {
        setSaveStatus('error');
        showToast('Auto-save failed — ' + e.message, 'error');
      }
    }, 2500);
  }

  function chgPhase(id, updated) { setPhases(p=>p.map(ph=>ph.id===id?updated:ph)); triggerAutoSave(); }
  function delPhase(id) { if(phases.length===1)return; setPhases(p=>p.filter(ph=>ph.id!==id)); triggerAutoSave(); }
  function movPhase(id,dir) {
    setPhases(p=>{ const a=[...p],i=a.findIndex(ph=>ph.id===id),j=i+dir; if(j<0||j>=a.length)return a; [a[i],a[j]]=[a[j],a[i]]; return a; });
    triggerAutoSave();
  }
  function addPhase() {
    const nextNum = phases.length + 1;
    setPhases(p=>[...p, makePhase(`Phase ${nextNum}`)]);
    triggerAutoSave();
  }

  async function handleDelete(id,e) {
    e.stopPropagation();
    if(!confirm('Delete this script?')) return;
    try {
      await api.deleteScript(id);
      const l=await loadList();
      if(l.length>0) await selectScript(l[0].id);
      else { setActiveId(null); setPhases([]); setScriptName(''); }
      showToast('Deleted');
    } catch(e){ showToast(e.message,'error'); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if(!newName.trim()) return;
    try {
      const s=await api.createScript({name:newName.trim(),blocks:[makePhase('Phase 1')]});
      setShowNew(false); setNewName('');
      await loadList(); await selectScript(s.id);
      showToast(`"${s.name}" created`);
    } catch(e){ showToast(e.message,'error'); }
  }

  function openPopup() {
    const url=`${window.location.origin}/script-popup${activeId?`?scriptId=${activeId}`:''}`;
    if(popupRef.current&&!popupRef.current.closed){ popupRef.current.location.href=url; popupRef.current.focus(); }
    else popupRef.current=window.open(url,'fleet-crm-script','width=1000,height=860,menubar=no,toolbar=no,scrollbars=yes');
  }

  const statusEl = saveStatus==='saving' ? <span style={{ fontSize:11,color:'var(--gray-400)' }}>● Saving…</span>
    : saveStatus==='saved'  ? <span style={{ fontSize:11,color:'#15803d' }}>✓ Saved</span>
    : saveStatus==='error'  ? <span style={{ fontSize:11,color:'#dc2626' }}>⚠ Save failed</span>
    : null;

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <div style={{ display:'flex',gap:16,alignItems:'flex-start' }}>
      {/* Sidebar */}
      <div style={{ width:210,flexShrink:0 }}>
        <div className="table-card" style={{ padding:0 }}>
          <div style={{ padding:'10px 14px',fontWeight:700,fontSize:13,borderBottom:'1px solid var(--gray-200)' }}>📋 Call Scripts</div>
          {scripts.map(s=>(
            <div key={s.id} onClick={()=>selectScript(s.id)}
              style={{ padding:'10px 14px',cursor:'pointer',display:'flex',justifyContent:'space-between',alignItems:'center',borderBottom:'1px solid var(--gray-100)',background:activeId===s.id?'#fef9ec':'white',borderLeft:activeId===s.id?'3px solid var(--gold-500)':'3px solid transparent' }}>
              <span style={{ fontSize:13,fontWeight:activeId===s.id?700:400,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1 }}>{s.name}</span>
              <button onClick={e=>handleDelete(s.id,e)} style={{ border:'none',background:'none',cursor:'pointer',fontSize:13,color:'#cbd5e1',marginLeft:4,flexShrink:0 }}>✕</button>
            </div>
          ))}
          {showNew ? (
            <form onSubmit={handleCreate} style={{ padding:'10px 14px',borderTop:'1px solid var(--gray-200)' }}>
              <input className="form-input" autoFocus placeholder="e.g. Cold Call" value={newName} onChange={e=>setNewName(e.target.value)} style={{ marginBottom:8 }}/>
              <div style={{ display:'flex',gap:6 }}>
                <button type="submit" className="btn btn-primary btn-sm" style={{ flex:1 }}>Create</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setShowNew(false)}>✕</button>
              </div>
            </form>
          ) : (
            <button onClick={()=>setShowNew(true)} style={{ width:'100%',padding:'10px',border:'none',borderTop:'1px solid var(--gray-200)',background:'white',cursor:'pointer',fontSize:13,color:'var(--gray-500)',fontWeight:600 }}>
              + New Script
            </button>
          )}
        </div>

        <div className="table-card" style={{ padding:'10px 14px',marginTop:12 }}>
          <div style={{ fontWeight:700,fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:8 }}>Section Types</div>
          {Object.entries(SECTION_TYPES).map(([k,d])=>(
            <div key={k} style={{ display:'flex',gap:6,alignItems:'center',marginBottom:5 }}>
              <span style={{ fontSize:13 }}>{d.icon}</span>
              <span style={{ fontSize:11,color:d.color,fontWeight:600 }}>{d.label}</span>
            </div>
          ))}
          <div style={{ marginTop:8,fontSize:10,color:'var(--gray-400)',borderTop:'1px solid var(--gray-100)',paddingTop:8,lineHeight:1.7 }}>
            📊 = on scorecard<br/>
            ⧉ = duplicate variant<br/>
            [[phrase]] = highlight<br/>
            || = pause break<br/>
            <em>Auto-saves as you type</em>
          </div>
        </div>
      </div>

      {/* Editor */}
      {activeId ? (
        <div style={{ flex:1,minWidth:0 }}>
          <div style={{ display:'flex',alignItems:'center',gap:10,marginBottom:16 }}>
            <input className="form-input" value={scriptName}
              onChange={e=>{setScriptName(e.target.value);triggerAutoSave();}}
              style={{ fontWeight:800,fontSize:17,maxWidth:300 }} placeholder="Script name…"/>
            {statusEl}
            <div style={{ marginLeft:'auto',display:'flex',gap:8 }}>
              <button onClick={openPopup} className="btn btn-ghost btn-sm">🔗 Teleprompter</button>
            </div>
          </div>

          {phases.map((ph,i)=>(
            <PhaseEditor key={ph.id} phase={ph} phaseIndex={i} totalPhases={phases.length}
              onChange={updated=>chgPhase(ph.id,updated)}
              onDelete={()=>delPhase(ph.id)}
              onMove={dir=>movPhase(ph.id,dir)}/>
          ))}

          <button onClick={addPhase}
            style={{ width:'100%',padding:'12px',border:'2px dashed var(--gray-300)',borderRadius:10,background:'var(--gray-50)',cursor:'pointer',fontSize:13,color:'var(--gray-500)',fontWeight:600 }}>
            + Add Phase
          </button>
        </div>
      ) : (
        <div style={{ flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--gray-400)',fontSize:15 }}>
          Create your first script →
        </div>
      )}
    </div>
  );
}
