import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtPhone, fmtDate, dueDateStatus } from '../api.js';
import { useApp } from '../App.jsx';
import UpcomingList from '../components/UpcomingList.jsx';
import CompanyPanel from '../components/CompanyPanel.jsx';
import ScoreCardModal from '../components/ScoreCardModal.jsx';
import QueueFilter from '../components/QueueFilter.jsx';
import RowActions from '../components/RowActions.jsx';
import MoveModal from '../components/MoveModal.jsx';
import ForecastStrip from '../components/ForecastStrip.jsx';

const FILTERS = [
  { key: 'all',      label: '📋 All Due' },
  { key: 'first',    label: '🆕 First Time' },
  { key: 'followup', label: '🔄 Follow-Up' },
  { key: 'overdue',  label: '🔴 Overdue' },
];

export default function CallingQueue() {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [contactTypes, setContactTypes] = useState([]);
  const [filter, setFilter]         = useState('all');
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [qFilter, setQFilter]           = useState('today');
  const [customFrom, setCustomFrom]     = useState('');
  const [customTo, setCustomTo]         = useState('');
  const [forecast, setForecast]       = useState([]);
  const [allRows, setAllRows]         = useState([]);
  const [industry, setIndustry]     = useState('');
  const [search, setSearch]         = useState('');
  const [industries, setIndustries] = useState([]);
  const { showToast, refreshCounts } = useApp();
  const [scorecardEnabled, setScorecardEnabled] = useState(false);
  const [view, setView]                         = useState('queue'); // 'queue' | 'scores'
  const [scoreEntries, setScoreEntries]         = useState([]);
  const [scoresLoading, setScoresLoading]       = useState(false);
  const [pendingScorecard, setPendingScorecard] = useState(null); // {entityName, entityId, callLogId}
  const [manualScorecard, setManualScorecard]   = useState(false);
  const [movingId, setMovingId] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    api.scorecardEnabled().then(r => setScorecardEnabled(r.enabled)).catch(()=>{});
  }, []);

  async function load() {
    setLoading(true);
    try {
      const opts = {};
      if (filter !== 'all') opts.filter = filter;
      if (industry) opts.industry = industry;
      if (search) opts.search = search;
      if (showUpcoming) opts.upcoming = 1;
      const data = await api.callingQueue(opts);
      // Always load all upcoming for the 7-day strip
      const [fc, allData] = await Promise.all([api.pipelineForecast(), api.callingQueue({...opts, upcoming:1})]);
      setForecast(fc || []);
      setAllRows(allData || []);
      setRows(data);
      const inds = [...new Set(data.map(r => r.industry).filter(Boolean))].sort();
      setIndustries(inds);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [filter, industry, search, showUpcoming]);
  useEffect(() => {
    if (view === 'scores') {
      setScoresLoading(true);
      api.scorecardEntries(60).then(d => setScoreEntries(d)).finally(() => setScoresLoading(false));
    }
  }, [view]);
  useEffect(() => { api.contactTypes().then(d => setContactTypes(d)); }, []);
  // Clear selected panel when navigating away
  useEffect(() => { return () => setSelected(null); }, []);

  async function handleComplete(form) {
    setSaving(true);
    try {
      // Route to the correct backend endpoint based on what type of row this is:
      //   followup_id      → this is a follow-up call, use the followups hub
      //   calling_queue_id → this is a first call from the manual queue
      //   neither          → fallback to quicklog (edge case: stage='new', no queue row)
      if (selected.followup_id) {
        await api.completeFollowup(selected.followup_id, form);
      } else if (selected.calling_queue_id) {
        await api.completeCompanyCall(selected.calling_queue_id, form);
      } else {
        await api.quicklogCompany(selected.id, form);
      }
      showToast('Logged — next: ' + form.next_action);
      // Close the calling panel FIRST, then trigger scorecard
      const scorecardData = scorecardEnabled ? {
        entityName: selected.entity_name || selected.name,
        entityId:   selected.id,
        callLogId:  null,
      } : null;
      setSelected(null);
      await load();
      await refreshCounts();
      // Small delay so panel fully unmounts before scorecard renders
      if (scorecardData) {
        setTimeout(() => setPendingScorecard(scorecardData), 150);
      }
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  const overdue = rows.filter(r => r.due_date && dueDateStatus(r.due_date) === 'overdue');

  return (
    <>
      <div className="page-header">
        <div>
           <div className="page-title">📞 Calling Queue</div>
          <ForecastStrip forecast={forecast} queueKey="calling" />
        </div>
        <div className="header-actions">
          <div className="search-bar">
            <span style={{ color:'var(--gray-400)' }}>🔍</span>
            <input placeholder="Search company or industry…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
        </div>
      </div>

      {view === 'queue' && <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>

        {/* Filters */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', gap:4, background:'var(--gray-100)', borderRadius:8, padding:3 }}>
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`btn btn-sm ${filter===f.key?'btn-navy':'btn-ghost'}`} style={{ border:'none', whiteSpace:'nowrap' }}>
                {f.label}
              </button>
            ))}
          </div>

          {industries.length > 0 && (
            <select className="form-input" style={{ width:'auto', fontSize:13, padding:'5px 10px' }} value={industry} onChange={e=>setIndustry(e.target.value)}>
              <option value="">All Industries</option>
              {industries.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          )}

          <div style={{ marginLeft:'auto' }}>
            <QueueFilter value={qFilter} onChange={v => { setQFilter(v); setShowUpcoming(v === 'all' || v === 'month' || v === 'week' || v === 'custom'); }} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
          </div>
          {overdue.length > 0 && !showUpcoming && (
            <span className="badge badge-overdue">🔴 {overdue.length} OVERDUE</span>
          )}
        </div>

        {/* Queue table */}
        <div className="table-card">
          <div className="table-card-header">
            <span style={{ fontSize:15 }}>📞</span>
            <span className="table-card-title">Calling Queue</span>
            <span className="table-card-count">click a row to call</span>
          </div>

          {loading ? <div className="loading-wrap"><div className="spinner"/></div>
          : rows.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📭</div>
              <div className="title">No calls due</div>
              <div className="desc">All caught up, or try a different filter</div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Company</th>
                    <th>Phone</th>
                    <th>Industry</th>
                    <th>Contacts</th>
                    <th>Preferred Contact</th>
                    <th>Due</th>
                    <th>Last Call</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const isSel   = selected?.id === row.id;
                    const isFirst = !row.call_count || row.call_count === 0;
                    const status  = row.due_date ? dueDateStatus(row.due_date) : null;
                    return (
                      <tr key={row.id} onClick={() => setSelected(prev => prev?.id===row.id ? null : row)}
                        style={{ cursor:'pointer', background: isSel?'#fef9ec':undefined, borderLeft: isSel?'3px solid var(--gold-500)':'3px solid transparent' }}>
                        <td style={{ color:'var(--gray-400)', fontSize:12 }}>{i+1}</td>
                        <td>
                          <div
                            style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3, display:'inline' }}
                            onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+row.id); }}
                            title="Open company profile"
                          >{row.name}</div>
                          {row.company_id && <div className="company-id">{row.company_id}</div>}
                        </td>
                        <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                        <td>{row.industry?<span className="badge badge-gray">{row.industry}</span>:'—'}</td>
                        <td style={{ textAlign:'center' }}>
                          <div style={{ fontWeight:700, fontSize:14, color:'var(--gray-700)' }}>{row.call_count || 0}</div>
                          {isFirst && <div style={{ fontSize:10, color:'var(--navy-600)', fontWeight:600 }}>First Time</div>}
                        </td>
                        <td style={{ fontSize:12 }}>
                          {row.preferred_contact_name
                            ? <div>
                                <span style={{ fontWeight:600 }}>{row.preferred_contact_name}</span>
                                {row.preferred_role && <span style={{ color:'var(--gray-400)', fontSize:11, marginLeft:5 }}>{row.preferred_role}</span>}
                              </div>
                            : <span style={{ color:'var(--gray-300)' }}>—</span>}
                        </td>
                        <td>
                          {row.due_date
                            ? <>
                                {status==='overdue' && <span className="badge badge-overdue">Overdue</span>}
                                {status==='today'   && <span className="badge badge-today">Today</span>}
                                {status==='upcoming'&& <span style={{ fontSize:12, color:'var(--gray-500)' }}>{fmtDate(row.due_date)}</span>}
                              </>
                            : <span style={{ fontSize:11, color:'var(--gray-300)' }}>No date set</span>}
                        </td>
                        <td style={{ fontSize:11, color:'var(--gray-500)', maxWidth:140 }} className="truncate">
                          {row.last_contact_type ? `${row.last_contact_type} · ${fmtDate(row.last_contacted)}` : '—'}
                        </td>
                        <td onClick={e=>e.stopPropagation()} style={{textAlign:'right'}}>
                          <RowActions isStarred={!!row.is_starred} onStar={async()=>{ await api.pipelineStar(row.id); load(); }} onMove={()=>setMovingId(row.id)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inline log panel */}
        {selected && (
          <CompanyPanel
            key={selected.id}
            row={{ ...selected, entity_id: selected.id, company_name: selected.name, main_phone: selected.main_phone }}
            sourceType="company"
            contactTypes={contactTypes}
            onComplete={handleComplete}
            onClose={() => setSelected(null)}
            saving={saving}
          />
        )}
      </div>}
      {/* ── Score History ── */}
      {view === 'scores' && (
        <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {scoresLoading ? <div className="loading-wrap"><div className="spinner"/></div> :
          scoreEntries.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📊</div>
              <div className="title">No scorecards yet</div>
              <div className="desc">Complete a call with the scorecard enabled to see your scores here</div>
            </div>
          ) : (
            <div className="table-card">
              <div className="table-card-header">
                <span style={{ fontSize:15 }}>📊</span>
                <span className="table-card-title">Score History</span>
                <span className="table-card-count">{scoreEntries.length} entries · last 60 days</span>
              </div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Script(s)</th>
                      <th>Score</th>
                      <th>%</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoreEntries.map(e => {
                      const pct = e.max_score > 0 ? Math.round((e.total_score/e.max_score)*100) : null;
                      const color = pct==null?'var(--gray-400)':pct>=80?'#15803d':pct>=60?'#d97706':'#dc2626';
                      const loggedDate = new Date(e.logged_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
                      return (
                        <tr key={e.id}>
                          <td style={{ fontSize:12, color:'var(--gray-500)', whiteSpace:'nowrap' }}>{loggedDate}</td>
                          <td style={{ fontWeight:600, fontSize:13 }}>{e.entity_name || '—'}</td>
                          <td style={{ fontSize:11, color:'var(--gray-500)' }}>
                            {Array.isArray(e.script_ids) && e.script_ids.length > 0
                              ? e.script_ids.join(', ')
                              : '—'}
                          </td>
                          <td style={{ fontWeight:700, fontSize:13, color }}>
                            {e.total_score}/{e.max_score} pts
                          </td>
                          <td>
                            {pct != null && (
                              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                                <div style={{ width:50, height:6, background:'var(--gray-200)', borderRadius:3, overflow:'hidden' }}>
                                  <div style={{ width:pct+'%', height:'100%', background:color, borderRadius:3 }}/>
                                </div>
                                <span style={{ fontSize:11, fontWeight:700, color }}>{pct}%</span>
                              </div>
                            )}
                          </td>
                          <td style={{ fontSize:11, color:'var(--gray-500)', maxWidth:160 }} className="truncate">{e.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {movingId && (
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); load(); }}
        />
      )}
      {/* Scorecard popups */}
      {(pendingScorecard || manualScorecard) && (
        <ScoreCardModal
          entityName={pendingScorecard?.entityName || ''}
          entityId={pendingScorecard?.entityId || null}
          callLogId={pendingScorecard?.callLogId || null}
          onClose={()=>{ setPendingScorecard(null); setManualScorecard(false); }}
          onSaved={()=>{ setPendingScorecard(null); setManualScorecard(false); showToast('✅ Scorecard saved'); }}
        />
      )}
    </>
  );
}
