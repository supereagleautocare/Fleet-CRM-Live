import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// USPS secondary unit abbreviations — applied when a full word is followed by a space or end
function normalizeSuite(str) {
  return str
    .replace(/\bsuite\s+/gi,      'Ste ')
    .replace(/\bsuite$/gi,        'Ste')
    .replace(/\bapartment\s+/gi,  'Apt ')
    .replace(/\bapartment$/gi,    'Apt')
    .replace(/\bfloor\s+/gi,      'Fl ')
    .replace(/\bfloor$/gi,        'Fl')
    .replace(/\bbuilding\s+/gi,   'Bldg ')
    .replace(/\bbuilding$/gi,     'Bldg')
    .replace(/\broom\s+/gi,       'Rm ')
    .replace(/\broom$/gi,         'Rm')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * AddressAutocomplete — dropdown renders via portal to escape overflow:hidden containers
 */
export default function AddressAutocomplete({
  value, onChange, onSelect,
  placeholder = 'Type a business name or address…',
  inputClass = 'form-input'
}) {
  const [results, setResults]         = useState([]);
  const [open, setOpen]               = useState(false);
  const [loading, setLoading]         = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [dropPos, setDropPos]         = useState({ top: 0, left: 0, width: 0 });
  const timerRef  = useRef(null);
  const inputRef  = useRef(null);
  const wrapRef   = useRef(null);

  // Reposition dropdown to match input
  function reposition() {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        // Also check if click is inside the portal dropdown
        const portal = document.getElementById('ac-portal-dropdown');
        if (portal && portal.contains(e.target)) return;
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function handleChange(e) {
    const raw = e.target.value;
    const val = raw.trimEnd() !== raw ? raw : normalizeSuite(raw);
    onChange(val);
    setHighlighted(-1);
    clearTimeout(timerRef.current);
    reposition();
    if (val.length < 3) { setResults([]); setOpen(false); return; }
    timerRef.current = setTimeout(() => search(val), 380);
  }

  async function search(val) {
    setLoading(true);
    reposition();
    try {
      const headers = { 'Accept-Language': 'en', 'User-Agent': 'SuperEagleFleetCRM/1.0' };
      const base = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&addressdetails=1&limit=5';
      const [r1, r2] = await Promise.all([
        fetch(`${base}&q=${encodeURIComponent(val + ' Charlotte NC')}`, { headers }).then(r => r.json()).catch(() => []),
        fetch(`${base}&q=${encodeURIComponent(val + ', NC')}`,          { headers }).then(r => r.json()).catch(() => []),
      ]);
      const seen = new Set(); const all = [];
      for (const item of [...r1, ...r2]) {
        if (!seen.has(item.place_id)) { seen.add(item.place_id); all.push(item); }
      }
      // Prefer results with a real street number; fall back to named places
      const withNum = all.filter(i => i.address?.house_number);
      const merged = withNum.length > 0 ? withNum : all.filter(i => i.address?.road);
      merged.sort((a, b) => {
        const aHas = !!(a.address?.house_number), bHas = !!(b.address?.house_number);
        return aHas && !bHas ? -1 : !aHas && bHas ? 1 : 0;
      });
      setResults(merged.slice(0, 4));
      setOpen(merged.length > 0);
      reposition();
    } catch (_) {
      setResults([]); setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  function pick(item) {
    const a = item.address || {};
    const streetAddr = normalizeSuite([a.house_number, a.road || a.pedestrian || a.footway].filter(Boolean).join(' '));
    const city  = a.city || a.town || a.village || a.municipality || a.suburb || '';
    const state = a.state || 'NC';
    const zip   = a.postcode || a.postal_code || '';
    const fullDisplay = normalizeSuite([streetAddr || item.name, city, state, zip].filter(Boolean).join(', '));
    onChange(fullDisplay || item.display_name.split(',').slice(0, 3).join(',').trim());
    onSelect?.({ display: fullDisplay, address: streetAddr || item.name, city, state, zip, name: item.name, lat: parseFloat(item.lat), lng: parseFloat(item.lon) });
    setOpen(false); setResults([]);
  }

  function handleKey(e) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter' && highlighted >= 0) { e.preventDefault(); pick(results[highlighted]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  function label(item) {
    const a = item.address || {};
    const addr = [a.house_number, a.road || a.pedestrian].filter(Boolean).join(' ');
    const city  = a.city || a.town || a.village || '';
    const zip   = a.postcode || a.postal_code || '';
    // Single clean line: "123 Main St, Charlotte, NC 28202"
    return [addr || item.name, city, [a.state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      || item.display_name.split(',').slice(0, 3).join(',');
  }

  function icon(item) {
    const cls = item.class || '';
    const t   = item.type  || '';
    if (cls === 'amenity' || ['restaurant','cafe','fast_food','office','shop'].includes(t)) return '🏢';
    if (['house','residential','apartments'].includes(t)) return '🏠';
    if (cls === 'building') return '🏢';
    return '📍';
  }

  const dropdown = open && results.length > 0 && createPortal(
    <div
      id="ac-portal-dropdown"
      style={{
        position: 'fixed',
        top: dropPos.top,
        left: dropPos.left,
        width: dropPos.width,
        zIndex: 99999,
        background: 'white',
        border: '1.5px solid var(--gray-200)',
        borderRadius: 10,
        boxShadow: '0 8px 28px rgba(0,0,0,.18)',
        overflow: 'hidden',
        minWidth: 240,
      }}
    >
      {results.map((item, i) => (
        <div
          key={item.place_id}
          onMouseDown={e => { e.preventDefault(); pick(item); }}
          onMouseEnter={() => setHighlighted(i)}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '10px 14px', cursor: 'pointer',
            background: highlighted === i ? '#fef9ec' : 'white',
            borderBottom: i < results.length - 1 ? '1px solid var(--gray-100)' : 'none',
          }}
        >
          <span style={{ fontSize: 15, marginTop: 1, flexShrink: 0 }}>{icon(item)}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {label(item)}
            </div>
          </div>
        </div>
      ))}
      <div style={{ padding: '5px 14px', fontSize: 10, color: 'var(--gray-300)', background: 'var(--gray-50)' }}>
        © OpenStreetMap contributors
      </div>
    </div>,
    document.body
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          className={inputClass}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKey}
          onFocus={() => { reposition(); if (results.length > 0) setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {loading && (
          <div style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid var(--gray-200)', borderTopColor: 'var(--gold-500)',
            animation: 'spin .7s linear infinite',
          }} />
        )}
      </div>
      {dropdown}
    </div>
  );
}
