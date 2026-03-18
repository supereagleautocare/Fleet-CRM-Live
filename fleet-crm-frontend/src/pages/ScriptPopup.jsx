/**
 * ScriptPopup v3 — Teleprompter redesign
 *
 * Design principles:
 *  - No nested boxes — left-border accent + subtle tint instead
 *  - Stump questions are BIG, amber, impossible to miss
 *  - "Wait / Pause" section renders as a horizontal break with ↩ cue
 *  - Pitch sections: question → [wait break auto-inserted] → benefit body
 *  - Responses/objections indent with a colored left bar
 *  - Type labels are small muted pills, not full header bars
 *  - Comfortable 17px reading size, generous line height
 *  - Print-friendly via @media print
 */
import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { parseInline } from '../components/ScriptEditor.jsx';

const BG    = '#0d1117';
const PANEL = '#0a0d14';
const FONT  = "'Inter', system-ui, sans-serif";

// ── Inline text (single chunk, no pause splitting) ────────────────────────────
function InlineText({ text, baseColor='#cbd5e1', size=17 }) {
  const parts = parseInline(text||'');
  return (
    <span style={{ fontSize:size, color:baseColor, lineHeight:2, fontFamily:FONT }}>
      {parts.map((p,i)=>{
        if (p.t==='bold')      return <strong key={i} style={{ color:'#f1f5f9', fontWeight:800 }}>{p.v}</strong>;
        if (p.t==='highlight') return <mark key={i} style={{ background:'#fef08a', color:'#713f12', borderRadius:3, padding:'1px 6px', fontWeight:700 }}>{p.v}</mark>;
        return <span key={i}>{p.v}</span>;
      })}
    </span>
  );
}

// ── ContentBlock — splits on || pause markers ─────────────────────────────────
// Type || anywhere in content to insert a "Wait for response" break.
// e.g. "How about I stop by || and give you some free oil changes"
// Each || becomes a purple pause bar in the teleprompter.
function ContentBlock({ text, baseColor='#cbd5e1', size=17 }) {
  if (!text) return null;
  const chunks = text.split(/\s*\|\|\s*/);
  if (chunks.length === 1) return <InlineText text={text} baseColor={baseColor} size={size}/>;
  return (
    <div>
      {chunks.map((chunk, i) => (
        <div key={i}>
          {chunk.trim() && (
            <div style={{ marginBottom: i < chunks.length - 1 ? 6 : 0 }}>
              <InlineText text={chunk.trim()} baseColor={baseColor} size={size}/>
            </div>
          )}
          {i < chunks.length - 1 && <WaitBreak label="Wait for response"/>}
        </div>
      ))}
    </div>
  );
}

// ── Wait break ────────────────────────────────────────────────────────────────
function WaitBreak({ label }) {
  return (
    <div className="wait-break" style={{ display:'flex', alignItems:'center', gap:10, margin:'14px 0', opacity:.75 }}>
      <div style={{ flex:1, height:1, background:'rgba(139,92,246,.4)' }}/>
      <span style={{ fontSize:11, fontWeight:800, color:'#a78bfa', textTransform:'uppercase', letterSpacing:'.12em', whiteSpace:'nowrap', padding:'3px 12px', border:'1px solid rgba(139,92,246,.35)', borderRadius:20, background:'rgba(139,92,246,.1)' }}>
        ⏸ {label || 'Wait for response'}
      </span>
      <div style={{ flex:1, height:1, background:'rgba(139,92,246,.4)' }}/>
    </div>
  );
}

// ── Section block ─────────────────────────────────────────────────────────────
const STYLES = {
  opener:    { accent:'#3b82f6', label:'🎯 OPENER',      labelColor:'#93c5fd', textColor:'#bfdbfe', bg:'rgba(59,130,246,.07)' },
  response:  { accent:'#22c55e', label:'↩️ IF THEY SAY', labelColor:'#86efac', textColor:'#bbf7d0', bg:'rgba(34,197,94,.06)',  indent:24 },
  objection: { accent:'#f97316', label:'🛡️ OBJECTION',  labelColor:'#fdba74', textColor:'#fed7aa', bg:'rgba(251,146,60,.08)', indent:24 },
  pitch:     { accent:'#64748b', label:'📢 PITCH',       labelColor:'#94a3b8', textColor:'#e2e8f0', bg:'rgba(100,116,139,.05)' },
  close:     { accent:'#a855f7', label:'🏁 CLOSE',       labelColor:'#d8b4fe', textColor:'#e9d5ff', bg:'rgba(168,85,247,.08)' },
  info:      { accent:'#475569', label:'📌 NOTE',        labelColor:'#64748b', textColor:'#94a3b8', bg:'rgba(71,85,105,.05)' },
  voicemail: { accent:'#0284c7', label:'📭 VOICEMAIL',   labelColor:'#7dd3fc', textColor:'#bae6fd', bg:'rgba(3,105,161,.08)' },
  oneliners: { accent:'#f59e0b', label:'⚡ ONE-LINER',   labelColor:'#fcd34d', textColor:'#fde68a', bg:'rgba(251,191,36,.06)' },
  values:    { accent:'#10b981', label:'💎 VALUE WORD',  labelColor:'#6ee7b7', textColor:'#a7f3d0', bg:'rgba(5,150,105,.07)' },
};

function SectionBlock({ section, openerVariants, activeVariant, onVariantChange }) {
  const st = STYLES[section.type] || STYLES.info;
  const isVariantGroup = section.type==='opener' && openerVariants && openerVariants.length > 1;
  const hasTrigger     = section.type==='response' || section.type==='objection';
  const hasStump       = section.type==='pitch' && !!section.question;

  const marginLeft = st.indent || 0;

  return (
    <div style={{ marginLeft, marginBottom:6 }}>
      {/* Left accent bar + card */}
      <div style={{ display:'flex', gap:0 }}>
        {/* Accent bar */}
        <div style={{ width:3, flexShrink:0, background:st.accent, borderRadius:'3px 0 0 3px', opacity:.7 }}/>

        <div style={{ flex:1, background:st.bg, borderRadius:'0 8px 8px 0', overflow:'hidden', borderTop:`1px solid rgba(255,255,255,.04)`, borderRight:`1px solid rgba(255,255,255,.04)`, borderBottom:`1px solid rgba(255,255,255,.04)` }}>

          {/* Type pill + label + variant tabs */}
          <div style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 14px', borderBottom:`1px solid rgba(255,255,255,.05)`, flexWrap:'wrap' }}>
            <span style={{ fontSize:9, fontWeight:800, color:st.labelColor, textTransform:'uppercase', letterSpacing:'.12em', opacity:.7, background:'rgba(255,255,255,.06)', padding:'2px 8px', borderRadius:20 }}>
              {st.label}
            </span>

            {/* Opener label / trigger text */}
            {(hasTrigger || section.type==='opener' || section.type==='voicemail') && section.label && (
              <span style={{ fontSize:13, color:st.labelColor, fontStyle:'italic', fontWeight:600 }}>
                "{section.label}"
              </span>
            )}

            {/* Opener variant tabs */}
            {isVariantGroup && (
              <div style={{ display:'flex', gap:4, marginLeft:'auto', flexWrap:'wrap' }}>
                {openerVariants.map((v,i)=>(
                  <button key={v.id} onClick={()=>onVariantChange(v.id)}
                    style={{ padding:'2px 12px', fontSize:11, borderRadius:20, border:`1.5px solid ${activeVariant===v.id?st.accent:'rgba(255,255,255,.15)'}`, background:activeVariant===v.id?st.accent:'transparent', color:activeVariant===v.id?'#000':st.labelColor, cursor:'pointer', fontWeight:700, transition:'all .1s' }}>
                    {v.label || `Option ${i+1}`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pitch title */}
          {section.title && (
            <div style={{ padding:'10px 16px 4px', fontSize:14, fontWeight:900, color:'white', textTransform:'uppercase', letterSpacing:'.06em' }}>
              {section.title}
            </div>
          )}

          {/* ── Stump question — BIG and impossible to miss ── */}
          {hasStump && (
            <div style={{ margin:'8px 14px', padding:'12px 16px', background:'rgba(251,191,36,.12)', border:'1.5px solid rgba(251,191,36,.4)', borderRadius:8 }}>
              <div style={{ fontSize:10, fontWeight:800, color:'#fbbf24', textTransform:'uppercase', letterSpacing:'.1em', marginBottom:6 }}>❓ Ask first</div>
              <div style={{ fontSize:17, fontStyle:'italic', color:'#fef3c7', lineHeight:1.65, fontWeight:500 }}>
                {(section.question||'').replace(/\s*\|\|\s*/g, '')}
              </div>
            </div>
          )}

          {/* Auto wait-break after stump question */}
          {hasStump && <WaitBreak label="Wait for their answer"/>}

          {/* If-they-say trigger (response/objection) */}
          {hasTrigger && section.label && (
            <div style={{ padding:'6px 16px 2px', fontSize:13, color:st.labelColor, opacity:.7, fontStyle:'italic' }}>
              They say: "{section.label}"
            </div>
          )}

          {/* Main content — || anywhere splits into wait breaks */}
          {section.content && (
            <div style={{ padding: hasStump ? '4px 16px 14px' : '12px 16px 14px' }}>
              <ContentBlock text={section.content} baseColor={st.textColor} size={17}/>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wait/Pause section as its own block ───────────────────────────────────────
function WaitSection({ section }) {
  return <WaitBreak label={section.label || section.content || 'Wait for response'}/>;
}

// ── Main popup ────────────────────────────────────────────────────────────────
export default function ScriptPopup() {
  const [scripts, setScripts]                = useState([]);
  const [activeScriptId, setActiveScriptId]  = useState(null);
  const [phases, setPhases]                  = useState([]);
  const [activePhaseId, setActivePhaseId]    = useState(null);
  const [activeVariants, setActiveVariants]  = useState({});
  const [loading, setLoading]                = useState(true);

  useEffect(()=>{
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('scriptId');
    document.title = '📋 Teleprompter';
    document.body.style.margin = '0';
    document.body.style.background = BG;
    (async()=>{
      try {
        const list = await api.scripts();
        setScripts(list);
        const targetId = sid ? parseInt(sid) : list[0]?.id;
        if (targetId) await loadScript(targetId);
      } finally { setLoading(false); }
    })();
  },[]);

  async function loadScript(id) {
    const s = await api.script(id);
    setActiveScriptId(id);
    const data = s.blocks;
    let phasesData;
    if (Array.isArray(data) && data.length>0 && data[0]?.sections) {
      phasesData = data;
    } else {
      phasesData = [{ id:'main', name:'Script', sections: (Array.isArray(data)?data:[]).map(b=>({...b,id:b.id||Math.random().toString(36).slice(2)})) }];
    }
    setPhases(phasesData);
    setActivePhaseId(phasesData[0]?.id);
  }

  const activePhase   = phases.find(p=>p.id===activePhaseId);
  const mainSections  = activePhase?.sections.filter(s=>s.type!=='oneliners'&&s.type!=='values') || [];
  const allSide       = phases.flatMap(p=>p.sections.filter(s=>s.type==='oneliners'||s.type==='values'));
  const uniqueSide    = allSide.filter((s,i,a)=>a.findIndex(x=>x.id===s.id)===i);

  // Group consecutive openers into variant groups
  function groupSections(sections) {
    const groups=[];
    let i=0;
    while (i<sections.length) {
      const s=sections[i];
      if (s.type==='opener') {
        const group=[s]; let j=i+1;
        while(j<sections.length&&sections[j].type==='opener'){group.push(sections[j]);j++;}
        groups.push({kind:'openerGroup',sections:group}); i=j;
      } else {
        groups.push({kind:'single',section:s}); i++;
      }
    }
    return groups;
  }

  function handlePrint() { window.print(); }

  if (loading) return (
    <div style={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',color:'#475569',fontFamily:FONT,background:BG,fontSize:14 }}>
      Loading…
    </div>
  );

  return (
    <>
      {/* Print styles injected into head */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-root { background: white !important; color: #111 !important; }
          .side-panel { display: none !important; }
          .wait-break { border-top: 1px dashed #999; margin: 10px 0; }
          .wait-break span { color: #666 !important; border-color: #ccc !important; background: white !important; }
        }
        @media screen {
          ::-webkit-scrollbar { width:6px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius:3px; }
        }
      `}</style>

      <div className="print-root" style={{ background:BG, minHeight:'100vh', fontFamily:FONT, color:'#e2e8f0', display:'flex', flexDirection:'column' }}>

        {/* ── Top bar ── */}
        <div className="no-print" style={{ background:PANEL, borderBottom:'1px solid rgba(255,255,255,.07)', padding:'0 16px', display:'flex', alignItems:'stretch', overflowX:'auto' }}>
          <select value={activeScriptId||''} onChange={e=>loadScript(parseInt(e.target.value))}
            style={{ background:'transparent',border:'none',color:'#64748b',fontSize:12,fontWeight:700,padding:'10px 12px 10px 0',fontFamily:FONT,cursor:'pointer',outline:'none',marginRight:12,borderRight:'1px solid rgba(255,255,255,.07)',paddingRight:16 }}>
            {scripts.map(s=><option key={s.id} value={s.id} style={{background:'#0a0d14'}}>{s.name}</option>)}
          </select>

          {phases.map(ph=>(
            <button key={ph.id} onClick={()=>setActivePhaseId(ph.id)}
              style={{ padding:'0 18px',border:'none',borderBottom:`3px solid ${activePhaseId===ph.id?'#f59e0b':'transparent'}`,background:'transparent',color:activePhaseId===ph.id?'#fbbf24':'#475569',fontWeight:700,fontSize:13,cursor:'pointer',fontFamily:FONT,whiteSpace:'nowrap',height:44,transition:'all .12s' }}>
              {ph.name}
            </button>
          ))}

          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8, paddingLeft:16, borderLeft:'1px solid rgba(255,255,255,.07)' }}>
            <button onClick={handlePrint}
              style={{ padding:'5px 12px', fontSize:11, fontWeight:700, border:'1px solid rgba(255,255,255,.15)', borderRadius:6, background:'transparent', color:'#94a3b8', cursor:'pointer', fontFamily:FONT }}>
              🖨 Print
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

          {/* Main scroll */}
          <div style={{ flex:1, overflowY:'auto', padding:'20px 20px 40px 20px', maxWidth:760 }}>
            {activePhase ? (
              groupSections(mainSections).map((group,gi)=>{
                if (group.kind==='openerGroup') {
                  const variants=group.sections;
                  const gid=variants[0].id;
                  const selected=activeVariants[gid]||variants[0].id;
                  const shown=variants.find(v=>v.id===selected)||variants[0];
                  return (
                    <SectionBlock key={gid} section={shown}
                      openerVariants={variants.map(v=>({id:v.id,label:v.label||''}))}
                      activeVariant={selected}
                      onVariantChange={vid=>setActiveVariants(a=>({...a,[gid]:vid}))}/>
                  );
                }
                const s=group.section;
                if (s.type==='wait') return <WaitSection key={s.id} section={s}/>;
                return <SectionBlock key={s.id} section={s}/>;
              })
            ) : (
              <div style={{ color:'#334155',textAlign:'center',paddingTop:80,fontSize:14 }}>Select a phase above</div>
            )}
          </div>

          {/* Side panel — one-liners + values */}
          {uniqueSide.length>0 && (
            <div className="side-panel" style={{ width:230, flexShrink:0, borderLeft:'1px solid rgba(255,255,255,.07)', overflowY:'auto', padding:'20px 14px', background:PANEL }}>
              {uniqueSide.map(s=>{
                const st=STYLES[s.type]||STYLES.info;
                const lines=(s.content||'').split('\n').filter(Boolean);
                return (
                  <div key={s.id} style={{ marginBottom:18 }}>
                    <div style={{ fontSize:9,fontWeight:800,color:st.labelColor,textTransform:'uppercase',letterSpacing:'.12em',marginBottom:8,opacity:.7 }}>{st.label}</div>
                    {lines.map((line,i)=>(
                      <div key={i} style={{ padding:'7px 10px',borderLeft:`3px solid ${st.accent}`,background:st.bg,fontSize:12,color:st.textColor,marginBottom:6,lineHeight:1.6,borderRadius:'0 6px 6px 0' }}>
                        <InlineText text={line} baseColor={st.textColor} size={12}/>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
