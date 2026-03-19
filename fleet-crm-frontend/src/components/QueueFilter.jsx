/**
 * QueueFilter — shared date range filter used across all queue pages.
 * Props:
 *   value      — current filter key: 'today' | 'week' | 'month' | 'all' | 'custom'
 *   onChange   — called with new filter key
 *   customFrom — string 'YYYY-MM-DD'
 *   customTo   — string 'YYYY-MM-DD'
 *   onCustomFrom — called with new from date string
 *   onCustomTo   — called with new to date string
 */
export default function QueueFilter({ value, onChange, customFrom, customTo, onCustomFrom, onCustomTo }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="form-input"
        style={{ width:'auto', fontSize:12, padding:'4px 10px', fontWeight:700, cursor:'pointer' }}
      >
        <option value="today">📅 Due Today</option>
        <option value="week">📅 This Week</option>
        <option value="month">📅 This Month</option>
        <option value="all">📋 All Scheduled</option>
        <option value="custom">🗓️ Custom Range</option>
      </select>
      {value === 'custom' && (
        <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap' }}>
          <input
            type="date"
            className="form-input"
            style={{ width:120, fontSize:11, padding:'3px 6px' }}
            value={customFrom}
            onChange={e => onCustomFrom(e.target.value)}
          />
          <span style={{ fontSize:11, color:'var(--gray-400)' }}>to</span>
          <input
            type="date"
            className="form-input"
            style={{ width:120, fontSize:11, padding:'3px 6px' }}
            value={customTo}
            onChange={e => onCustomTo(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
