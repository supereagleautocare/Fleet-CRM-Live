/**
 * ForecastStrip — shows overdue + 7-day forecast counts for a queue type.
 * Props:
 *   forecast  — array from /api/pipeline/forecast
 *   queueKey  — 'calling' | 'mail' | 'email' | 'visits'
 */
export default function ForecastStrip({ forecast, queueKey }) {
  if (!forecast || forecast.length === 0) return null;

  const items = forecast.map(day => ({
    label:     day.label,
    count:     day[queueKey] || 0,
    isOverdue: day.isOverdue || false,
    isToday:   day.isToday   || false,
  })).filter(item => item.isOverdue || item.count > 0 || item.isToday);

  if (items.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '4px 0 2px', marginTop: 2,
    }}>
      {items.map((item, i) => {
        const color = item.isOverdue ? '#ef4444' : item.isToday ? '#f59e0b' : '#94a3b8';
        const bg    = item.isOverdue ? '#fef2f2' : item.isToday ? '#fffbeb' : 'transparent';
        const bold  = item.isOverdue || item.isToday;
        return (
          <span key={i} style={{
            fontSize: 11, fontWeight: bold ? 700 : 500,
            color, background: bg,
            padding: item.isOverdue || item.isToday ? '1px 6px' : '0',
            borderRadius: 5,
            whiteSpace: 'nowrap',
          }}>
            {item.count > 0 || item.isOverdue
              ? `${item.count} ${item.label}`
              : item.isToday ? '0 Today' : null}
            {i < items.length - 1 && !item.isOverdue && (
              <span style={{ color:'var(--gray-300)', marginLeft: 6 }}>·</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
