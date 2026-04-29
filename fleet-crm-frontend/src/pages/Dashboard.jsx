import { useState, useEffect } from 'react';
import { api, fmtPhone, fmtDate, companyDisplayName } from '../api.js';
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

const DEFAULT_GOALS = { calls: 20, mail: 10, email: 5, visits: 3 };

function loadGoals() {
  try { return { ...DEFAULT_GOALS, ...JSON.parse(localStorage.getItem('pipeline_goals') || '{}') }; }
  catch { return DEFAULT_GOALS; }
}
function saveGoals(g) { localStorage.setItem('pipeline_goals', JSON.stringify(g)); }

function StatusBadge({ status }) {
  if (!status || status === 'prospect') return <span style={{ fontSize:11, color:'var(--gray-400)' }}>Prospect</span>;
  const map = {
    interested: { label:'⭐ Interested', color:'#92400e', bg:'#fef9c3' },
    customer:   { label:'✅ Customer',   color:'#166534', bg:'#f0fdf4' },
    dead:       { label:'💀 Dead',       color:'#dc2626', bg:'#fef2f2' },
  };
  const s = map[status];
  if (!s) return null;
  return <span style={{ fontSize:10, fontWeight:700, color:s.color, background:s.bg, padding:'1px 7px', borderRadius:8 }}>{s.label}</span>;
}

function GoalBar({ value, goal }) {
  const pct = goal > 0 ? Math.min(100, Math.round((value / goal) * 100)) : 0;
  const done = pct >= 100;
  return (
    <div style={{ marginTop:6 }}>
      <div style={{ height:4, background:'#f1f5f9', borderRadius:2, overflow:'hidden' }}>
        <div style={{ height:'100%', borderRadius:2, width:`${pct}%`, background: done ? '#16a34a' : '#1e40af', transition:'width .3s' }}/>
      </div>
      <div style={{ fontSize:10, color: done ? '#16a34a' : 'var(--gray-400)', marginTop:3, fontWeight: done ? 700 : 400 }}>
        {done ? `✅ Goal hit! ${value}/${goal}` : `${value} / ${goal} goal`}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [board, setBoard]     = useState(null);
  const [stats, setStats]     = useState(null);
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState('month');
  const [goals, setGoals]     = useState(loadGoals);
  const [editingGoals, setEditingGoals] = useState(false);
  const [draftGoals, setDraftGoals]     = useState(loadGoals);

  const [drillStage, setDrillStage]   = useState(null);
  const [drillRows, setDrillRows]     = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const [activeStat, setActiveStat]   = useState(null);
  const [statRows, setStatRows]       = useState([]);
  const [statLoading, setStatLoading] = useState(false);

  const [movingId, setMovingId] = useState(null);
  const navigate = useNavigate();

  async function load(p = period) {
    setLoading(true);
    try {
      const [b, s, f] = await Promise.all([api.pipelineBoard(), api.dashboard(p), api.pipelineForecast()]);
      setBoard(b); setStats(s); setForecast(f || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(period); }, [period]);

  async function drillInto(stage) {
    if (drillStage === stage) { setDrillStage(null); return; }
    setActiveStat(null); setDrillStage(stage); setDrillLoading(true);
    try { setDrillRows(await api.pipelineStage(stage, {})); } finally { setDrillLoading(false); }
  }

  async function clickStat(type, p) {
    const key = `${type}-${p}`;
    if (activeStat === key) { setActiveStat(null); return; }
    setDrillStage(null); setActiveStat(key); setStatLoading(true);
    try { setStatRows(await api.dashboardDrill(type, p)); } finally { setStatLoading(false); }
  }

  function saveGoalEdits() {
    setGoals(draftGoals); saveGoals(draftGoals); setEditingGoals(false);
  }

  const { counts = {} } = board || {};
  const total = STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0);
  const a = stats?.activity || {};

  const ACTIVITIES = [
    { key:'calls',  label:'Calls',  icon:'📞', color:'#1e40af', type:'calls',
      today: a.calls_today  ?? 0, week: a.calls_this_week  ?? 0, month: a.calls_this_month  ?? 0 },
    { key:'mail',   label:'Mail',   icon:'✉️',  color:'#065f46', type:'mail',
      today: a.mail_today   ?? 0, week: a.mail_this_week   ?? 0, month: a.mail_this_month   ?? 0 },
    { key:'email',  label:'Email',  icon:'📧', color:'#6b21a8', type:'email',
      today: a.email_today  ?? 0, week: a.email_this_week  ?? 0, month: a.email_this_month  ?? 0 },
    { key:'visits', label:'Visits', icon:'📍', color:'#92400e', type:'visits',
      today: a.visits_today ?? 0, week: a.visits_this_week ?? 0, month: a.visits_this_month ?? 0 },
  ];

  const periodLabel = { week:'This Week', month:'This Month', year:'This Year' }[period] ?? 'This Month';
  const byOutcome = stats?.breakdowns?.by_outcome ?? [];
  const byRep     = stats?.breakdowns?.by_rep     ?? [];

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <>
      <div className="page-header">
        <div><div className="page-title">📊 Pipeline</div></div>
        <div className="header-actions">
          <div style={{ display:'flex', gap:4, background:'var(--gray-100)', borderRadius:8, padding:3 }}>
            {[['week','Week'],['month','Month'],['year','Year']].map(([k,l]) => (
              <button key={k} className={`btn btn-sm ${period===k?'btn-navy':'btn-ghost'}`}
                style={{ border:'none' }} onClick={() => setPeriod(k)}>{l}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setDraftGoals(goals); setEditingGoals(v=>!v); }}>
            🎯 Goals
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => load(period)}>🔄</button>
        </div>
      </div>

      <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:16 }}>

        {/* ── Goals editor ── */}
        {editingGoals && (
          <div className="table-card" style={{ padding:'16px 20px' }}>
            <div style={{ fontWeight:700, fontSize:13, marginBottom:12, color:'var(--navy-800)' }}>🎯 Daily Goals</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 }}>
              {ACTIVITIES.map(act => (
                <div key={act.key}>
                  <label style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)', display:'block', marginBottom:4 }}>
                    {act.icon} {act.label}
                  </label>
                  <input type="number" min="0" className="form-input" style={{ fontSize:15, fontWeight:700, textAlign:'center' }}
                    value={draftGoals[act.key] ?? 0}
                    onChange={e => setDraftGoals(g => ({ ...g, [act.key]: Math.max(0, parseInt(e.target.value)||0) }))}/>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button className="btn btn-primary btn-sm" onClick={saveGoalEdits}>Save Goals</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingGoals(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* ── Activity + Goals ── */}
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>
            Today's Activity
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {ACTIVITIES.map(act => {
              const periodVal = period === 'week' ? act.week : period === 'year' ? act.month : act.month;
              const isActive = activeStat === `${act.type}-today`;
              return (
                <div key={act.key} onClick={() => clickStat(act.type, 'today')}
                  className="table-card"
                  style={{ padding:'14px 16px', cursor:'pointer', borderLeft:`3px solid ${act.color}`,
                    border: isActive ? `2px solid ${act.color}` : `1px solid var(--gray-200)`,
                    borderLeft: isActive ? `3px solid ${act.color}` : `3px solid ${act.color}`,
                    background: isActive ? '#f8fafc' : 'white' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)' }}>{act.icon} {act.label}</div>
                  </div>
                  <div style={{ fontSize:32, fontWeight:900, color: act.color, lineHeight:1.1, marginTop:4 }}>{act.today}</div>
                  <GoalBar value={act.today} goal={goals[act.key] ?? 0} />
                  <div style={{ display:'flex', gap:10, marginTop:8, fontSize:11, color:'var(--gray-400)' }}>
                    <span>Wk: <b style={{ color:'var(--gray-600)' }}>{act.week}</b></span>
                    <span>Mo: <b style={{ color:'var(--gray-600)' }}>{act.month}</b></span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Activity drill-down ── */}
        {activeStat && (
          <div className="table-card">
            <div className="table-card-header">
              <span>{ACTIVITIES.find(a=>activeStat.startsWith(a.type))?.icon}</span>
              <span className="table-card-title">
                {ACTIVITIES.find(a=>activeStat.startsWith(a.type))?.label} — Today
              </span>
              <span className="table-card-count">{statRows.length} companies</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={() => setActiveStat(null)}>✕</button>
            </div>
            {statLoading ? <div className="loading-wrap"><div className="spinner"/></div>
            : statRows.length === 0
              ? <div style={{ padding:20, textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>No activity today</div>
              : (
                <div className="table-wrapper">
                  <table>
                    <thead><tr><th>Company</th><th>Industry</th><th>Status</th><th>Last Contact</th></tr></thead>
                    <tbody>
                      {statRows.map(row => (
                        <tr key={row.id} style={{ cursor:'pointer' }} onClick={() => navigate('/companies?company='+row.id)}>
                          <td><div style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{companyDisplayName(row)}</div></td>
                          <td>{row.industry ? <span className="badge badge-gray">{row.industry}</span> : '—'}</td>
                          <td><StatusBadge status={row.company_status} /></td>
                          <td style={{ fontSize:12, color:'var(--gray-600)' }}>
                            {row.last_contact_type ? `${row.last_contact_type} · ${fmtDate(row.last_contact)}` : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ── Two column: stages + schedule ── */}
        <div style={{ display:'grid', gridTemplateColumns:'300px 1fr', gap:16, alignItems:'flex-start' }}>

          {/* Pipeline Stages — compact list */}
          <div className="table-card" style={{ padding:0 }}>
            <div className="table-card-header">
              <span className="table-card-title">🗂️ Pipeline Stages</span>
              <span className="table-card-count">{total} total</span>
            </div>
            {STAGES.map(st => {
              const count = counts[st.key] || 0;
              const pct   = total > 0 ? Math.round((count/total)*100) : 0;
              const active = drillStage === st.key;
              return (
                <div key={st.key} onClick={() => drillInto(st.key)}
                  style={{ padding:'10px 16px', borderBottom:'1px solid var(--gray-100)', cursor:'pointer',
                    background: active ? st.bg : 'white', transition:'background .12s',
                    borderLeft: active ? `3px solid ${st.color}` : '3px solid transparent' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:600, color: active ? st.color : 'var(--gray-700)' }}>
                      {st.icon} {st.label}
                    </span>
                    <span style={{ fontSize:15, fontWeight:900, color:st.color }}>{count}</span>
                  </div>
                  <div style={{ height:3, background:'#f1f5f9', borderRadius:2 }}>
                    <div style={{ height:'100%', borderRadius:2, background:st.color, width:`${pct}%`, transition:'width .3s' }}/>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upcoming Schedule */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {forecast.length > 0 && (
              <div className="table-card" style={{ padding:'14px 18px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:12 }}>
                  📅 Upcoming Schedule
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6 }}>
                  {forecast.filter(d => !d.isOverdue).map(day => {
                    const visible = forecast.filter(d => !d.isOverdue);
                    const maxTotal = Math.max(...visible.map(d => d.total), 1);
                    const pct = Math.round((day.total / maxTotal) * 100);
                    return (
                      <div key={day.date} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:10, fontWeight:700, color: day.isToday ? 'var(--navy-800)' : 'var(--gray-500)', marginBottom:4 }}>
                          {day.label}
                        </div>
                        <div style={{ height:50, display:'flex', flexDirection:'column', justifyContent:'flex-end', alignItems:'center', gap:1 }}>
                          {day.calling>0 && <div style={{ width:'100%', background:'#1e40af', borderRadius:'2px 2px 0 0', minHeight:4, height:Math.max(4,(day.calling/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                          {day.mail>0    && <div style={{ width:'100%', background:'#065f46', minHeight:3, height:Math.max(3,(day.mail/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                          {day.email>0   && <div style={{ width:'100%', background:'#6b21a8', minHeight:3, height:Math.max(3,(day.email/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                          {day.visits>0  && <div style={{ width:'100%', background:'#92400e', borderRadius:'0 0 2px 2px', minHeight:3, height:Math.max(3,(day.visits/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                        </div>
                        <div style={{ fontSize:13, fontWeight:900, color: day.isToday ? 'var(--navy-800)' : 'var(--gray-700)', marginTop:3 }}>
                          {day.total || '—'}
                        </div>
                        {day.total > 0 && (
                          <div style={{ fontSize:9, color:'var(--gray-400)', lineHeight:1.5 }}>
                            {day.calling>0 && <div style={{color:'#1e40af'}}>📞{day.calling}</div>}
                            {day.mail>0    && <div style={{color:'#065f46'}}>✉️{day.mail}</div>}
                            {day.visits>0  && <div style={{color:'#92400e'}}>📍{day.visits}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ display:'flex', gap:12, marginTop:10, fontSize:11, color:'var(--gray-400)' }}>
                  <span><span style={{color:'#1e40af',fontWeight:700}}>■</span> Call</span>
                  <span><span style={{color:'#065f46',fontWeight:700}}>■</span> Mail</span>
                  <span><span style={{color:'#6b21a8',fontWeight:700}}>■</span> Email</span>
                  <span><span style={{color:'#92400e',fontWeight:700}}>■</span> Visit</span>
                </div>
              </div>
            )}

            {/* Outcomes + By Rep side by side */}
            {(byOutcome.length > 0 || byRep.length > 0) && (
              <div style={{ display:'grid', gridTemplateColumns: byRep.length > 0 ? '1fr 1fr' : '1fr', gap:12 }}>
                {byOutcome.length > 0 && (
                  <div className="table-card" style={{ padding:0 }}>
                    <div className="table-card-header">
                      <span className="table-card-title">📋 Outcomes — {periodLabel}</span>
                    </div>
                    {byOutcome.slice(0,6).map(r => (
                      <div key={r.contact_type} style={{ padding:'7px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:12, color:'var(--gray-700)' }}>{r.contact_type}</span>
                        <span style={{ fontSize:13, fontWeight:800, color:'var(--navy-800)' }}>{r.cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
                {byRep.length > 0 && (
                  <div className="table-card" style={{ padding:0 }}>
                    <div className="table-card-header">
                      <span className="table-card-title">👤 By Rep — {periodLabel}</span>
                    </div>
                    {byRep.map(r => (
                      <div key={r.logged_by_name} style={{ padding:'7px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:12, color:'var(--gray-700)' }}>{r.logged_by_name || 'Unknown'}</span>
                        <span style={{ fontSize:13, fontWeight:800, color:'var(--navy-800)' }}>{r.cnt}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Stage drill-down ── */}
        {drillStage && (
          <div className="table-card">
            <div className="table-card-header">
              <span>{STAGES.find(s=>s.key===drillStage)?.icon}</span>
              <span className="table-card-title">{STAGES.find(s=>s.key===drillStage)?.label} Pipeline</span>
              <span className="table-card-count">{drillRows.length} companies</span>
              {['call','mail','email','visit'].includes(drillStage) && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }}
                  onClick={() => navigate(drillStage==='call'?'/calling':drillStage==='mail'?'/mail-queue':drillStage==='email'?'/email-queue':'/visit-queue')}>
                  Open Queue →
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setDrillStage(null)}>✕</button>
            </div>
            {drillLoading
              ? <div className="loading-wrap"><div className="spinner"/></div>
              : drillRows.length === 0
                ? <div style={{ padding:24, textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>No companies here</div>
                : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr><th>Company</th><th>Phone</th><th>Industry</th><th>Status</th><th>Last Contact</th><th>Stage Since</th><th></th></tr>
                      </thead>
                      <tbody>
                        {drillRows.map(row => (
                          <tr key={row.id} style={{ cursor:'pointer' }} onClick={() => navigate('/companies?company='+row.id)}>
                            <td>
                              <div style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{companyDisplayName(row)}</div>
                              <div className="company-id">{row.company_id}</div>
                            </td>
                            <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                            <td>{row.industry ? <span className="badge badge-gray">{row.industry}</span> : '—'}</td>
                            <td><StatusBadge status={row.company_status} /></td>
                            <td style={{ fontSize:12, color:'var(--gray-600)' }}>
                              {row.last_contact_type ? `${row.last_contact_type} · ${fmtDate(row.last_contacted)}` : '—'}
                            </td>
                            <td style={{ fontSize:12, color:'var(--gray-400)' }}>{fmtDate(row.stage_updated_at)}</td>
                            <td onClick={e => e.stopPropagation()}>
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
        <MoveModal companyId={movingId} onClose={() => setMovingId(null)} onMoved={() => { setMovingId(null); load(period); }}/>
      )}
    </>
  );
}
