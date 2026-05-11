export default function ForecastStrip({ forecast, queueKey }) {
  if (!forecast || forecast.length === 0) return null;

  const overdue = forecast.find(d => d.isOverdue);
  const days = forecast.filter(d => !d.isOverdue);
  const overdueCount = overdue ? (overdue[queueKey] || 0) : 0;

  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', marginTop:4 }}>

      {/* Overdue pill */}
      <div style={{
        display:'inline-flex', alignItems:'center', gap:3,
        background: overdueCount > 0 ? '#dc2626' : '#cbd5e1',
        padding:'3px 9px', borderRadius:20, whiteSpace:'nowrap',
        boxShadow: overdueCount > 0 ? '0 1px 4px rgba(220,38,38,.3)' : 'none',
      }}>
        <span style={{ fontSize:12, fontWeight:800, color:'white', lineHeight:1 }}>{overdueCount}</span>
        <span style={{ fontSize:9, fontWeight:700, color:'rgba(255,255,255,.85)', textTransform:'uppercase', letterSpacing:'.07em' }}>Overdue</span>
      </div>

      <span style={{ color:'var(--gray-300)', fontSize:11, margin:'0 1px' }}>|</span>

      {/* Daily chips */}
      {days.map((day, i) => {
        const count = day[queueKey] || 0;
        const isToday = day.isToday;

        if (isToday) {
          return (
            <div key={i} style={{
              display:'inline-flex', alignItems:'center', gap:4,
              background:'#fef3c7', border:'1.5px solid #fcd34d',
              padding:'3px 9px', borderRadius:20, whiteSpace:'nowrap',
            }}>
              <span style={{ fontSize:13, fontWeight:800, color:'#d97706', lineHeight:1 }}>{count}</span>
              <span style={{ fontSize:9, fontWeight:700, color:'#92400e', textTransform:'uppercase', letterSpacing:'.07em' }}>Today</span>
            </div>
          );
        }

        return (
          <div key={i} style={{
            display:'inline-flex', alignItems:'center', gap:3,
            padding:'2px 7px', borderRadius:20, whiteSpace:'nowrap',
            background: count > 0 ? 'rgba(100,116,139,.1)' : 'transparent',
            opacity: count === 0 ? 0.45 : 1,
            transition:'opacity .15s',
          }}>
            <span style={{ fontSize:12, fontWeight: count > 0 ? 700 : 400, color: count > 0 ? 'var(--gray-700)' : 'var(--gray-500)', lineHeight:1 }}>{count}</span>
            <span style={{ fontSize:10, color:'var(--gray-400)', fontWeight: count > 0 ? 600 : 400 }}>{day.label}</span>
          </div>
        );
      })}
    </div>
  );
}
