/**
 * UpcomingList — shows a 7-day strip + expandable company list for a queue type.
 * Props:
 *   forecast  — array from /api/pipeline/forecast
 *   queueKey  — 'calling' | 'mail' | 'email' | 'visits'
 *   label     — display label e.g. "Calls"
 *   color     — hex or css var
 *   emoji     — e.g. '📞'
 *   upcomingRows — full list of all upcoming companies (used to group by date)
 */
import { useState } from 'react';
import { fmtDate } from '../api.js';

export default function UpcomingList({ forecast = [], queueKey, label, color, emoji, upcomingRows = [] }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  if (!forecast.length) return null;

  const total7 = forecast.reduce((s, d) => s + (d[queueKey] || 0), 0);
  if (total7 === 0) return null;

  // Group upcomingRows by due_date / scheduled_date
  const rowsByDate = {};
  for (const r of upcomingRows) {
    const d = r.due_date || r.scheduled_date;
    if (!d) continue;
    if (!rowsByDate[d]) rowsByDate[d] = [];
    rowsByDate[d].push(r);
  }

  const dayRows = selectedDay ? (rowsByDate[selectedDay] || []) : upcomingRows;

  return (
    <div style={{ background:'white', border:'1px solid var(--gray-200)', borderRadius:10, overflow:'hidden', marginBottom:14 }}>
      {/* 7-day bar */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', borderBottom:'1px solid var(--gray-100)' }}>
        {forecast.map((day, i) => {
          const count = day[queueKey] || 0;
          const isSel = selectedDay === day.date;
          const isToday = i === 0;
          return (
            <button key={day.date}
              onClick={() => { setExpanded(true); setSelectedDay(isSel ? null : day.date); }}
              style={{
                padding:'10px 6px', border:'none', borderRight:'1px solid var(--gray-100)',
                background: isSel ? color : isToday && count > 0 ? '#fefce8' : 'white',
                cursor: count > 0 ? 'pointer' : 'default',
                transition:'background .1s', textAlign:'center',
              }}>
              <div style={{ fontSize:10, fontWeight:700, color: isSel ? 'white' : isToday ? 'var(--navy-800)' : 'var(--gray-400)', marginBottom:4, textTransform:'uppercase', letterSpacing:'.04em' }}>
                {day.label.slice(0,3)}
              </div>
              <div style={{ fontSize:18, fontWeight:900, color: isSel ? 'white' : count > 0 ? (isToday ? color : 'var(--gray-700)') : 'var(--gray-200)' }}>
                {count || '·'}
              </div>
              {isToday && count > 0 && !isSel && (
                <div style={{ width:5, height:5, borderRadius:'50%', background:color, margin:'4px auto 0' }} />
              )}
            </button>
          );
        })}
      </div>

      {/* Expand toggle */}
      <button onClick={() => { setExpanded(p=>!p); setSelectedDay(null); }}
        style={{ width:'100%', padding:'8px 16px', border:'none', borderBottom: expanded ? '1px solid var(--gray-100)' : 'none', background:'var(--gray-50)', cursor:'pointer', display:'flex', alignItems:'center', gap:8, fontSize:12, color:'var(--gray-600)', fontWeight:600 }}>
        <span>{emoji}</span>
        <span>{total7} {label} due in next 7 days {selectedDay && `· showing ${fmtDate(selectedDay)}`}</span>
        <span style={{ marginLeft:'auto', fontSize:10 }}>{expanded ? '▲ Hide' : '▼ Show list'}</span>
      </button>

      {/* Company list */}
      {expanded && (
        <div style={{ maxHeight:260, overflowY:'auto' }}>
          {dayRows.length === 0 ? (
            <div style={{ padding:'12px 16px', fontSize:12, color:'var(--gray-400)' }}>No {label.toLowerCase()} scheduled{selectedDay ? ` for ${fmtDate(selectedDay)}` : ''}.</div>
          ) : dayRows.map((r, i) => {
            const dateVal = r.due_date || r.scheduled_date;
            return (
              <div key={r.id || i} style={{ padding:'8px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:13 }}>
                <div>
                  <span style={{ fontWeight:700 }}>{r.name || r.entity_name}</span>
                  {r.industry && <span style={{ fontSize:11, color:'var(--gray-400)', marginLeft:6 }}>{r.industry}</span>}
                </div>
                <span style={{ fontSize:11, color:'var(--gray-500)', flexShrink:0, marginLeft:8 }}>{fmtDate(dateVal)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
