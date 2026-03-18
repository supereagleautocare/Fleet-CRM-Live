import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, fmtPhone, fmtDate, dueDateStatus } from '../api.js';
import { useApp } from '../App.jsx';
import UpcomingList from './UpcomingList.jsx';
import CallDrawer from './CallDrawer.jsx';

const PRIORITY_FILTERS = [
  { k:'all',     l:'All'          },
  { k:'overdue', l:'🔴 Overdue'   },
  { k:'today',   l:'🟡 Today'     },
  { k:'week',    l:'📅 This Week' },
  { k:'upcoming',l:'🔵 Upcoming'  },
];

export default function VisitQueueTab() {
  const [rows, setRows]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [contactTypes, setContactTypes] = useState({});
  const [forecast, setForecast]     = useState([]);
  const [allRows, setAllRows]       = useState([]);
  const [priorityFilter, setPriorityFilter] = useState('all');
  const navigate = useNavigate();
  const { showToast, refreshCounts } = useApp();

  async function load() {
    setLoading(true);
    try {
      const [all, fc] = await Promise.all([api.visitsAll(), api.pipelineForecast()]);
      setAllRows(all || []);
      setForecast(fc || []);
      setRows(all || []);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { api.contactTypes().then(d => setContactTypes(d || {})); }, []);

  async function handleComplete(form) {
    setSaving(true);
    try {
      await api.completeVisit(selected.id, form);
      showToast('Visit logged — next: ' + form.next_action);
      setDrawerOpen(false);
      await load(); await refreshCounts();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleCancel(id, e) {
    e.stopPropagation();
    if (!confirm('Cancel this visit?')) return;
    try {
      await api.cancelVisit(id);
      await load(); await refreshCounts();
      showToast('Visit cancelled');
    } catch (err) { showToast(err.message, 'error'); }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split('T')[0];

  const filtered = rows.filter(r => {
    if (priorityFilter === 'overdue')  return r.scheduled_date < todayStr;
    if (priorityFilter === 'today')    return r.scheduled_date === todayStr;
    if (priorityFilter === 'week')     return r.scheduled_date > todayStr && r.scheduled_date <= weekEndStr;
    if (priorityFilter === 'upcoming') return r.scheduled_date > weekEndStr;
    return true;
  });

  const sorted = [...filtered].sort((a,b) => a.scheduled_date.localeCompare(b.scheduled_date));

  // Group by date
  const dateKeys = [...new Set(sorted.map(r => r.scheduled_date))];
  const groups = dateKeys.map(date => ({ date, rows: sorted.filter(r => r.scheduled_date === date) }));

  const overdue = rows.filter(r => r.scheduled_date < todayStr);
  const todayRows = rows.filter(r => r.scheduled_date === todayStr);

  function groupLabel(d) {
    if (d < todayStr) return '🔴 Overdue — ' + fmtDate(d);
    if (d === todayStr) return '🟡 Today — ' + fmtDate(d);
    const dt = new Date(d + 'T00:00:00');
    if (d <= weekEndStr) return '📅 ' + dt.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
    return '🔵 ' + fmtDate(d);
  }
  function groupStyle(d) {
    if (d < todayStr)  return { bg:'#fef2f2', border:'#fca5a5' };
    if (d === todayStr) return { bg:'#fffbeb', border:'#fde68a' };
    return { bg:'#f8fafc', border:'var(--gray-200)' };
  }

  return (
    <div className="page-body">

      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{fontSize:13,color:'var(--gray-500)'}}>
          {rows.length} total
          {overdue.length > 0 && <span style={{color:'#dc2626',fontWeight:700}}> · {overdue.length} overdue</span>}
          {todayRows.length > 0 && <span style={{color:'#d97706',fontWeight:700}}> · {todayRows.length} today</span>}
        </div>
        <div style={{marginLeft:'auto',display:'flex',gap:3,flexWrap:'wrap'}}>
          {PRIORITY_FILTERS.map(f => (
            <button key={f.k} onClick={()=>setPriorityFilter(f.k)}
              className={'btn btn-sm ' + (priorityFilter===f.k?'btn-navy':'btn-ghost')}
              style={{border:'none',fontSize:11,padding:'3px 10px'}}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      <UpcomingList forecast={forecast} queueKey="visits" label="Visits" color="#92400e" emoji="📍" upcomingRows={allRows} />

      {loading ? <div className="loading-wrap"><div className="spinner"/></div>
      : sorted.length === 0 ? (
        <div className="empty-state">
          <div className="icon">📭</div>
          <div className="title">{priorityFilter==='all' ? 'No visits scheduled' : 'No visits in this range'}</div>
          <div className="desc">
            {priorityFilter !== 'all'
              ? <button className="btn btn-ghost btn-sm" onClick={()=>setPriorityFilter('all')}>Show all visits</button>
              : 'Select "Visit" as next action on a company call to schedule one.'}
          </div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {groups.map(g => {
            const gs = groupStyle(g.date);
            return (
              <div key={g.date} className="table-card" style={{overflow:'hidden'}}>
                <div style={{padding:'8px 16px',background:gs.bg,borderBottom:'1px solid '+gs.border,
                  display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontWeight:700,fontSize:13}}>{groupLabel(g.date)}</span>
                  <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>{g.rows.length} visit{g.rows.length!==1?'s':''}</span>
                </div>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Company</th><th>Contact</th><th>Phone</th><th>Address</th><th>Notes</th><th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map(row => {
                        const status = dueDateStatus(row.scheduled_date);
                        return (
                          <tr key={row.id}
                            className={status==='overdue'?'row-overdue':status==='today'?'row-today':''}
                            onClick={()=>{ setSelected(row); setDrawerOpen(true); }}
                            style={{cursor:'pointer'}}>
                            <td>
                              <span
                                style={{fontWeight:600, color:'var(--navy-700)', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3}}
                                onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+row.entity_id); }}
                                title="Open company profile"
                              >{row.entity_name}</span>
                            </td>
                            <td style={{fontSize:12}}>{row.contact_name||'—'}</td>
                            <td><span className="phone-num">{fmtPhone(row.direct_line)}</span></td>
                            <td style={{fontSize:12,color:'var(--gray-500)'}}>
                              {row.address ? row.address+(row.city?', '+row.city:'') : '—'}
                            </td>
                            <td style={{fontSize:12,color:'var(--gray-500)',maxWidth:160}} className="truncate">{row.notes||'—'}</td>
                            <td>
                              <div className="row-actions">
                                <button className="pill-btn pill-btn-primary"
                                  onClick={e=>{e.stopPropagation();setSelected(row);setDrawerOpen(true);}}>
                                  Log Visit
                                </button>
                                <button className="pill-btn pill-btn-ghost" onClick={e=>handleCancel(row.id,e)}>Cancel</button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CallDrawer open={drawerOpen} onClose={()=>setDrawerOpen(false)} onComplete={handleComplete}
        contact={selected} type="visit" contactTypes={contactTypes} loading={saving} />
    </div>
  );
}
