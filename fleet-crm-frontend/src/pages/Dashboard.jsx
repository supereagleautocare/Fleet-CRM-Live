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

const PERIODS = [
  { key: 'week',  label: 'This Week'  },
  { key: 'month', label: 'This Month' },
  { key: 'year',  label: 'This Year'  },
];

export default function Dashboard() {
  const [board, setBoard]           = useState(null);
  const [stats, setStats]           = useState(null);
  const [forecast, setForecast]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [period, setPeriod]         = useState('month');

  // Stage drill-down
  const [drillStage, setDrillStage]     = useState(null);
  const [drillRows, setDrillRows]       = useState([]);
  const [drillLoading, setDrillLoading] = useState(false);

  // Stat drill-down (calls/contacts)
  const [activeStat, setActiveStat]   = useState(null);
  const [statRows, setStatRows]       = useState([]);
  const [statLoading, setStatLoading] = useState(false);

  const [movingId, setMovingId] = useState(null);
  const navigate = useNavigate();

  async function load(p = period) {
    setLoading(true);
    try {
      const [b, s, f] = await Promise.all([
        api.pipelineBoard(),
        api.dashboard(p),
        api.pipelineForecast(),
      ]);
      setBoard(b);
      setStats(s);
      setForecast(f || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(period); }, [period]);

  async function drillInto(stage) {
    if (drillStage === stage) { setDrillStage(null); return; }
    setActiveStat(null);
    setDrillStage(stage);
    setDrillLoading(true);
    try {
      setDrillRows(await api.pipelineStage(stage, {}));
    } finally { setDrillLoading(false); }
  }

  async function clickStat(type, period) {
    const key = `${type}-${period}`;
    if (activeStat === key) { setActiveStat(null); return; }
    setDrillStage(null);
    setActiveStat(key);
    setStatLoading(true);
    try {
      setStatRows(await api.dashboardDrill(type, period));
    } finally { setStatLoading(false); }
  }

  const { counts = {} } = board || {};
  const total = STAGES.reduce((s, st) => s + (counts[st.key] || 0), 0);

  const callsToday  = stats?.activity?.calls_today         ?? 0;
  const callsWeek   = stats?.activity?.calls_this_week     ?? 0;
  const callsMonth  = stats?.activity?.calls_this_month    ?? 0;
  const callsYear   = stats?.activity?.calls_this_year     ?? 0;
  const ctcToday    = stats?.activity?.contacts_today      ?? 0;
  const ctcWeek     = stats?.activity?.contacts_this_week  ?? 0;
  const ctcMonth    = stats?.activity?.contacts_this_month ?? 0;
  const ctcYear     = stats?.activity?.contacts_this_year  ?? 0;
  const byRep       = stats?.breakdowns?.by_rep     ?? [];
  const byOutcome   = stats?.breakdowns?.by_outcome ?? [];

  // Stat cards based on selected period
  const periodLabel = PERIODS.find(p => p.key === period)?.label ?? 'This Month';
  const callCards = period === 'week'
    ? [['Today', callsToday, 'today'], ['This Week', callsWeek, 'week']]
    : period === 'year'
    ? [['Today', callsToday, 'today'], ['This Month', callsMonth, 'month'], ['This Year', callsYear, 'year']]
    : [['Today', callsToday, 'today'], ['This Week', callsWeek, 'week'], ['This Month', callsMonth, 'month']];
  const ctcCards = period === 'week'
    ? [['Today', ctcToday, 'today'], ['This Week', ctcWeek, 'week']]
    : period === 'year'
    ? [['Today', ctcToday, 'today'], ['This Month', ctcMonth, 'month'], ['This Year', ctcYear, 'year']]
    : [['Today', ctcToday, 'today'], ['This Week', ctcWeek, 'week'], ['This Month', ctcMonth, 'month']];

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  const sectionLabel = (text) => (
    <div style={{ marginBottom:6, fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em' }}>{text}</div>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">📊 Pipeline</div>
        </div>
        <div className="header-actions">
          <div style={{ display:'flex', gap:4, background:'var(--gray-100)', borderRadius:8, padding:3 }}>
            {PERIODS.map(p => (
              <button key={p.key}
                className={`btn btn-sm ${period===p.key ? 'btn-navy' : 'btn-ghost'}`}
                style={{ border:'none', whiteSpace:'nowrap' }}
                onClick={() => setPeriod(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => load(period)}>🔄 Refresh</button>
        </div>
      </div>

      <div className="page-body">

        {/* ── Call Activity ─────────────────────────────────────────── */}
        {sectionLabel('📞 Call Activity')}
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${callCards.length},1fr)`, gap:12, marginBottom:16 }}>
          {callCards.map(([label, value, p]) => (
            <div key={label} onClick={() => clickStat('calls', p)}
              className="table-card"
              style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer',
                border: activeStat===`calls-${p}` ? '2px solid #1e40af' : undefined,
                background: activeStat===`calls-${p}` ? '#eff6ff' : 'white' }}>
              <div style={{ fontSize:28, fontWeight:900, color:'#1e40af', lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:13, color:'var(--gray-500)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Total Contacts ────────────────────────────────────────── */}
        {sectionLabel('🤝 Total Contacts (all types)')}
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${ctcCards.length},1fr)`, gap:12, marginBottom:20 }}>
          {ctcCards.map(([label, value, p]) => (
            <div key={label} onClick={() => clickStat('contacts', p)}
              className="table-card"
              style={{ padding:'16px 20px', display:'flex', alignItems:'center', gap:14, cursor:'pointer',
                border: activeStat===`contacts-${p}` ? '2px solid #065f46' : undefined,
                background: activeStat===`contacts-${p}` ? '#ecfdf5' : 'white' }}>
              <div style={{ fontSize:28, fontWeight:900, color:'#065f46', lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:13, color:'var(--gray-500)' }}>{label}</div>
            </div>
          ))}
        </div>

        {/* ── Stat drill-down table ─────────────────────────────────── */}
        {activeStat && (
          <div className="table-card" style={{ marginBottom:20 }}>
            <div className="table-card-header">
              <span>{activeStat.startsWith('calls') ? '📞' : '🤝'}</span>
              <span className="table-card-title">
                {activeStat.startsWith('calls') ? 'Calls' : 'Contacts'} —{' '}
                {activeStat.endsWith('today') ? 'Today' : activeStat.endsWith('week') ? 'This Week' : activeStat.endsWith('year') ? 'This Year' : 'This Month'}
              </span>
              <span className="table-card-count">{statRows.length} companies</span>
              <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }} onClick={() => setActiveStat(null)}>✕ Close</button>
            </div>
            {statLoading ? <div className="loading-wrap"><div className="spinner"/></div>
            : statRows.length === 0
              ? <div style={{ padding:24, textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>No activity in this period</div>
              : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th>
                        <th>Industry</th>
                        <th>Status</th>
                        <th>Contacts</th>
                        <th>Last Contact</th>
                        <th>Pipeline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statRows.map(row => (
                        <tr key={row.id} style={{ cursor:'pointer' }} onClick={() => navigate('/companies?company='+row.id)}>
                          <td>
                            <div style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{row.name}</div>
                            <div className="company-id">{row.company_id}</div>
                          </td>
                          <td>{row.industry ? <span className="badge badge-gray">{row.industry}</span> : '—'}</td>
                          <td><StatusBadge status={row.company_status} /></td>
                          <td style={{ fontSize:13, fontWeight:700, color:'var(--navy-800)' }}>{row.contact_count}</td>
                          <td style={{ fontSize:12, color:'var(--gray-600)' }}>
                            {row.last_contact_type ? `${row.last_contact_type} · ${fmtDate(row.last_contact)}` : '—'}
                          </td>
                          <td>
                            <span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:'var(--gray-100)', color:'var(--gray-500)', fontWeight:700, textTransform:'uppercase' }}>
                              {row.pipeline_stage}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        )}

        {/* ── Upcoming Schedule ─────────────────────────────────────── */}
        {sectionLabel('📅 Upcoming Schedule')}
        {forecast.length > 0 && (
          <div className="table-card" style={{ padding:'16px 20px', marginBottom:20 }}>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:8 }}>
              {forecast.filter(d => !d.isOverdue).map((day) => {
                const visibleDays = forecast.filter(d => !d.isOverdue);
                const maxTotal = Math.max(...visibleDays.map(d => d.total), 1);
                const pct = Math.round((day.total / maxTotal) * 100);
                return (
                  <div key={day.date} style={{ textAlign:'center' }}>
                    <div style={{ fontSize:11, fontWeight:700, color: day.isToday ? 'var(--navy-800)' : 'var(--gray-500)', marginBottom:6 }}>
                      {day.label}
                    </div>
                    <div style={{ height:60, display:'flex', flexDirection:'column', justifyContent:'flex-end', alignItems:'center', gap:1 }}>
                      {day.calling>0 && <div style={{ width:'100%', background:'#1e40af', borderRadius:'2px 2px 0 0', minHeight:6, height:Math.max(6,(day.calling/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                      {day.mail>0    && <div style={{ width:'100%', background:'#065f46', minHeight:4, height:Math.max(4,(day.mail/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                      {day.email>0   && <div style={{ width:'100%', background:'#6b21a8', minHeight:4, height:Math.max(4,(day.email/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                      {day.visits>0  && <div style={{ width:'100%', background:'#92400e', borderRadius:'0 0 2px 2px', minHeight:4, height:Math.max(4,(day.visits/Math.max(day.total,1))*pct*0.6)+'%' }}/>}
                    </div>
                    <div style={{ fontSize:14, fontWeight:900, color: day.isToday ? 'var(--navy-800)' : 'var(--gray-700)', marginTop:4 }}>
                      {day.total || '—'}
                    </div>
                    {day.total > 0 && (
                      <div style={{ fontSize:9, color:'var(--gray-400)', lineHeight:1.4 }}>
                        {day.calling>0 && <div style={{color:'#1e40af'}}>📞{day.calling}</div>}
                        {day.mail>0    && <div style={{color:'#065f46'}}>✉️{day.mail}</div>}
                        {day.email>0   && <div style={{color:'#6b21a8'}}>📧{day.email}</div>}
                        {day.visits>0  && <div style={{color:'#92400e'}}>📍{day.visits}</div>}
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

        {/* ── Calls by Rep + Outcomes ───────────────────────────────── */}
        {(byRep.length > 0 || byOutcome.length > 0) && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20 }}>
            {byRep.length > 0 && (
              <div className="table-card" style={{ padding:0 }}>
                <div className="table-card-header">
                  <span className="table-card-title">📊 Calls by Rep — {periodLabel}</span>
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
                  <span className="table-card-title">📋 Outcomes — {periodLabel}</span>
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

        {/* ── Pipeline Stages ───────────────────────────────────────── */}
        {sectionLabel('🗂️ Pipeline Stages — click any to see companies')}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
          {STAGES.map(st => {
            const count  = counts[st.key] || 0;
            const pct    = total > 0 ? Math.round((count/total)*100) : 0;
            const active = drillStage === st.key;
            return (
              <div key={st.key} onClick={() => drillInto(st.key)}
                style={{ padding:'16px 18px', borderRadius:12, cursor:'pointer',
                  border:`2px solid ${active ? st.color : st.border}`,
                  background: active ? st.bg : 'white',
                  transition:'all .15s', userSelect:'none' }}>
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

        {/* ── Stage drill-down table ────────────────────────────────── */}
        {drillStage && (
          <div className="table-card">
            <div className="table-card-header">
              <span>{STAGES.find(s=>s.key===drillStage)?.icon}</span>
              <span className="table-card-title">{STAGES.find(s=>s.key===drillStage)?.label}</span>
              <span className="table-card-count">{drillRows.length} companies</span>
              {['call','mail','email','visit'].includes(drillStage) && (
                <button className="btn btn-ghost btn-sm" style={{ marginLeft:'auto' }}
                  onClick={() => navigate(
                    drillStage==='call'?'/calling':
                    drillStage==='mail'?'/mail-queue':
                    drillStage==='email'?'/email-queue':'/visit-queue'
                  )}>
                  Open Queue →
                </button>
              )}
            </div>
            {drillLoading
              ? <div className="loading-wrap"><div className="spinner"/></div>
              : drillRows.length === 0
                ? <div style={{ padding:24, textAlign:'center', color:'var(--gray-400)', fontSize:13 }}>No companies here</div>
                : (
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Phone</th>
                          <th>Industry</th>
                          <th>Status</th>
                          <th>Contacts</th>
                          <th>Last Contact</th>
                          <th>Stage Since</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillRows.map(row => (
                          <tr key={row.id} style={{ cursor:'pointer' }} onClick={() => navigate('/companies?company='+row.id)}>
                            <td>
                              <div style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)' }}>{row.name}</div>
                              <div className="company-id">{row.company_id}</div>
                            </td>
                            <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                            <td>{row.industry ? <span className="badge badge-gray">{row.industry}</span> : '—'}</td>
                            <td><StatusBadge status={row.company_status} /></td>
                            <td style={{ fontSize:12, color:'var(--gray-700)' }}>{row.total_contacts || 0}</td>
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
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); load(); if (drillStage) drillInto(drillStage); }}
        />
      )}
    </>
  );
}
