export default function ForecastStrip({ forecast, queueKey }) {
  if (!forecast || forecast.length === 0) return null;

  // Separate overdue from daily forecast
  const overdue = forecast.find(d => d.isOverdue);
  const days = forecast.filter(d => !d.isOverdue);

  const overdueCount = overdue ? (overdue[queueKey] || 0) : 0;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap', padding:'2px 0' }}>
      <span style={{ fontSize:11, fontWeight:700, color:'white', background:'#ef4444', padding:'1px 7px', borderRadius:5, whiteSpace:'nowrap' }}>
        {overdueCount} Overdue
      </span>
      <span style={{ fontSize:11, color:'var(--gray-300)' }}>·</span>
      {days.map((day, i) => {
        const count = day[queueKey] || 0;
        const isToday = day.isToday;
        const color = isToday ? '#f59e0b' : '#94a3b8';
        const fontWeight = isToday ? 700 : 400;
        const bg = isToday ? '#fffbeb' : 'transparent';
        return (
          <span key={i} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <span style={{ fontSize:11, fontWeight, color, background:bg, padding: isToday ? '1px 6px' : '0', borderRadius:5, whiteSpace:'nowrap' }}>
              {count} {day.label}
            </span>
            {i < days.length - 1 && <span style={{ fontSize:11, color:'var(--gray-300)' }}>·</span>}
          </span>
        );
      })}
    </div>
  );
}
