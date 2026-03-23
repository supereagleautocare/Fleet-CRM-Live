import { useState, useEffect } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useNavigate } from 'react-router-dom';
import MoveModal from '../components/MoveModal.jsx';

const STAGES = [
  { key: 'new',   label: 'New',   icon: '🆕', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  { key: 'call',  label: 'Call',  icon: '📞', color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe' },
  { key: 'mail',  label: 'Mail',  icon: '✉️',  color: '#065f46', bg: '#ecfdf5', border: '#a7f3d0' },
  { key: 'email', label: 'Email', icon: '📧', color: '#6b21a8', bg: '#faf5ff', border: '#e9d5ff' },
  { key: 'visit', label: 'Visit', icon: '📍', color: '#92400e', bg: '#fffbeb', border: '#fde68a' },
  { key: 'dead',  label: 'Dead',  icon: '💀', color: '#6b7280', bg: '#f9fafb', border: '#e5e7eb' },
];

export default function Dashboard() {
  const [board, setBoard]           = useState(null);
  const [stats, setStats]           = useState(null);
  const [forecast, setForecast]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [drillStage, setDrillStage] = useState(null);
  const [drillRows, setDrillRows]   = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [movingId, setMovingId]     = useState(null);
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try {
      const [b, s, f] = await Promise.all([api.pipelineBoard(), api.dashboard(), api.pipelineForecast()]);
      setBoard(b);
      setStats(s);
      setForecast(f || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function drillInto(stage) {
    if (drillStage === stage) { setDrillStage(null); return; }
    setDrillStage(stage);
    setDrillLoading(true);
    try {
      const opts = stage === 'starred' ? { starred: 1 } : {};
      const key  = stage === 'starred' ? 'all' : stage;
      setDrillRows(await api.pipelineStage(key, opts));
    } finally { setDrillLoading(false); }
  }

  async function handleStar(id) {
    await api.pipelineStar(id);
    load();
    if (drillStage) drillInto(drillStage);
  }

  const { counts = {} } = board || {};
  const total = STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0);

  const callsToday = stats?.activity?.calls_today ?? 0;
  const callsWeek  = stats?.activity?.calls_this_week ?? 0;
  const callsMonth = stats?.activity?.calls_this_month ?? 0;
  const byRep      = stats?.breakdowns?.by_rep ?? [];
  const byOutcome  = stats?.breakdowns?.by_outcome ?? [];

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">📊 Pipeline</div>
          <div className="page-subtitle">{total} companies · {counts.starred || 0} starred</div>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost btn-sm" onClick={load}>🔄 Refresh</button>
        </div>
      </div>

      <div className="page-body">

        {/* ── Activity stats strip ─────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:20 }}>
          {[
            ['📞 Calls Today',         callsToday,                        '#1e40af'],
            ['📞 Calls This Week',     callsWeek,                         '#1e40af'],
            ['🤝 Contacts This Month', stats?.activity?.contacts_this_month ?? 0, '#065f46'],
          ].map(([label, value, color]) => (
            <div key={label} className="table-card" style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ fontSize:28, fontWeight:900, color, lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:13, color:'var(--gray-500)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── 7-day forecast chart ────────────────────────────── */}
        {forecast.length > 0 && (
          <div className="table-card" style={{ padding:'16px 20px', marginBottom:8 }}>
            <div style={{ fontWeight:700, fontSize:13, color:'var(--gray-700)', marginBottom:14 }}>📅 Upcoming — Next 7 Days</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8 }}>
              {forecast.map((day, i) => {
                const maxTotal = Math.max(...forecast.map(d => d.total), 1);
                const pct = Math.round((day.total / maxTotal) * 100);
                const isToday = i === 0;
                return (
                  <div key={day.date} style={{ textAlign:'center' }}>
                    <div style={{ fontSize:11, fontWeight:700, color: isToday ? 'var(--navy-800)' : 'var(--gray-500)', marginBottom:6 }}>
                      {day.label}
                    </div>
                    <div style={{ height:60, display:'flex', flexDirection:'column', justifyContent:'flex-end', alignItems:'center', gap:1 }}>
                      {day.calls > 0 && <div style={{ width:'100%', height:Math.max(4,(day.calling/day.total)*pct*0.6)+'%', background:'#1e40af', borderRadius:'2px 2px 0 0', minHeight:day.calling?6:0 }} title={`${day.calling} calls`}/>}
                      {day.mail > 0 && <div style={{ width:'100%', height:Math.max(4,(day.mail/day.total)*pct*0.6)+'%', background:'#065f46', minHeight:day.mail?4:0 }} title={`${day.mail} mail`}/>}
                      {day.email > 0 && <div style={{ width:'100%', height:Math.max(4,(day.email/day.total)*pct*0.6)+'%', background:'#6b21a8', minHeight:day.email?4:0 }} title={`${day.email} email`}/>}
                      {day.visits > 0 && <div style={{ width:'100%', height:Math.max(4,(day.visits/day.total)*pct*0.6)+'%', background:'#92400e', borderRadius:'0 0 2px 2px', minHeight:day.visits?4:0 }} title={`${day.visits} visits`}/>}
                    </div>
                    <div style={{ fontSize:14, fontWeight:900, color: isToday ? 'var(--navy-800)' : 'var(--gray-700)', marginTop:4 }}>{day.total || '—'}</div>
                    {day.total > 0 && (
                      <div style={{ fontSize:9, color:'var(--gray-400)', lineHeight:1.4 }}>
                        {day.calling>0 && <div style={{color:'#1e40af'}}>📞{day.calling}</div>}
                        {day.mail>0 && <div style={{color:'#065f46'}}>✉️{day.mail}</div>}
                        {day.email>0 && <div style={{color:'#6b21a8'}}>📧{day.email}</div>}
                        {day.visits>0 && <div style={{color:'#92400e'}}>📍{day.visits}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ display:'flex', gap:12, marginTop:12, fontSize:11, color:'var(--gray-500)' }}>
              <span><span style={{color:'#1e40af',fontWeight:700}}>■</span> Call</span>
              <span><span style={{color:'#065f46',fontWeight:700}}>■</span> Mail</span>
              <span><span style={{color:'#6b21a8',fontWeight:700}}>■</span> Email</span>
              <span><span style={{color:'#92400e',fontWeight:700}}>■</span> Visit</span>
            </div>
          </div>
        )}

        {/* ── Reps + outcomes (only show if there's data) ──────── */}
        {(byRep.length > 0 || byOutcome.length > 0) && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
            {byRep.length > 0 && (
              <div className="table-card" style={{ padding:0 }}>
                <div className="table-card-header">
                  <span className="table-card-title">📊 Calls by Rep (30d)</span>
                </div>
                {byRep.map(r => (
                  <div key={r.logged_by_name} style={{ padding:'8px 18px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13, fontWeight:600 }}>{r.logged_by_name || 'Unknown'}</span>
                    <span style={{ fontSize:13, fontWeight:800, color:'var(--navy-800)' }}>{r.cnt}</span>
                  </div>
                ))}
              </div>
            )}
            {byOutcome.length > 0 && (
              <div className="table-card" style={{ padding:0 }}>
                <div className="table-card-header">
                  <span className="table-card-title">📋 Outcomes (30d)</span>
                </div>
                {byOutcome.slice(0,8).map(r => (
                  <div key={r.contact_type} style={{ padding:'8px 18px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:13 }}>{r.contact_type}</span>
                    <span style={{ fontSize:13, fontWeight:800, color:'var(--navy-800)' }}>{r.cnt}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Warm leads banner ────────────────────────────────── */}
        {(counts.starred || 0) > 0 && (
          <div onClick={() => drillInto('starred')} className="table-card"
            style={{ padding:'12px 18px', marginBottom:12, cursor:'pointer', border:`2px solid ${drillStage==='starred'?'#f59e0b':'#fde68a'}`, background: drillStage==='starred'?'#fefce8':'white', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:20 }}>⭐</span>
            <div>
              <div style={{ fontWeight:700, fontSize:14, color:'#92400e' }}>{counts.starred} Starred Warm Leads</div>
              <div style={{ fontSize:12, color:'#a16207' }}>Good conversations — don't lose track</div>
            </div>
            <span style={{ marginLeft:'auto', fontSize:12, color:'#a16207' }}>{drillStage==='starred'?'▲ Hide':'▼ Show'}</span>
          </div>
        )}

        {/* ── Stage cards ──────────────────────────────────────── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
          {STAGES.map(st => {
            const count = counts[st.key] || 0;
            const pct   = total > 0 ? Math.round((count/total)*100) : 0;
            const active = drillStage === st.key;
            return (
              <div key={st.key} onClick={() => drillInto(st.key)}
                style={{ padding:'16px 18px', borderRadius:12, cursor:'pointer', border:`2px solid ${active?st.color:st.border}`, background:active?st.bg:'white', transition:'all .15s', userSelect:'none' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <span style={{ fontSize:22 }}>{st.icon}</span>
                  <span style={{ fontSize:30, fontWeight:900, color:st.color, lineHeight:1 }}>{count}</span>
                </div>
                <div style={{ fontWeight:700, fontSize:13, color:st.color, marginTop:6 }}>{st.label}</div>
                <div style={{ height:3, background:'#f1f5f9', borderRadius:2, marginTop:8 }}>
                  <div style={{ height:'100%', borderRadius:2, background:st.color, width:`${pct}%`, transition:'width .3s' }}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Drill-down table ─────────────────────────────────── */}
        {drillStage && (
          <div className="table-card">
            <div className="table-card-header">
              <span>{STAGES.find(s=>s.key===drillStage)?.icon || '⭐'}</span>
              <span className="table-card-title">{drillStage==='starred'?'Warm Leads':STAGES.find(s=>s.key===drillStage)?.label}</span>
              <span className="table-card-count">{drillRows.length} companies</span>
              {['call','mail','email','visit'].includes(drillStage) && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }}
                  onClick={() => navigate(drillStage==='call'?'/calling':drillStage==='mail'?'/mail-queue':drillStage==='email'?'/email-queue':'/visit-queue')}>
                  Open Queue →
                </button>
              )}
            </div>
            {drillLoading ? <div className="loading-wrap"><div className="spinner"/></div>
            : drillRows.length === 0 ? <div style={{ padding:24, textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>No companies here</div>
            : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>Company</th><th>Phone</th><th>Industry</th><th>Status</th><th>Contacts</th><th>Last Contact</th><th>Stage Since</th><th></th></tr></thead>
                  <tbody>
                    {drillRows.map(row => (
                      <tr key={row.id} style={{ cursor:'pointer' }} onClick={()=>navigate('/companies?company='+row.id)}>
                        <td>
                          <div style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{row.name}</div>
                          <div className="company-id">{row.company_id}</div>
                        </td>
                        <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                        <td>{row.industry?<span className="badge badge-gray">{row.industry}</span>:'—'}</td>
                        <td>
                          {row.company_status && row.company_status !== 'prospect' ? (
                            <span style={{ fontSize:10, fontWeight:700,
                              color:row.company_status==='interested'?'#92400e':row.company_status==='customer'?'#166534':'#dc2626',
                              background:row.company_status==='interested'?'#fef9c3':row.company_status==='customer'?'#f0fdf4':'#fef2f2',
                              padding:'1px 7px', borderRadius:8 }}>
                              {row.company_status==='interested'?'⭐ Interested':row.company_status==='customer'?'✅ Customer':'💀 Dead'}
                            </span>
                          ) : <span style={{ fontSize:11, color:'var(--gray-400)' }}>Prospect</span>}
                        </td>
                        <td style={{ fontSize:12, color:'var(--gray-700)' }}>{row.total_contacts || 0}</td>
                        <td style={{ fontSize:12, color:'var(--gray-600)' }}>{row.last_contact_type?`${row.last_contact_type} · ${fmtDate(row.last_contacted)}`:'—'}</td>
                        <td style={{ fontSize:12, color:'var(--gray-400)' }}>{fmtDate(row.stage_updated_at)}</td>
                        <td onClick={e=>e.stopPropagation()}>
                          <button className="pill-btn pill-btn-primary" onClick={() => setMovingId(row.id)}>Move To</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {movingId && (
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); load(); if (drillStage) drillInto(drillStage); }}
        />
      )}
    </>
  );
}
