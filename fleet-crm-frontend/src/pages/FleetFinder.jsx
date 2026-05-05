import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

const VEHICLE_LABELS = {
  passenger:          'Passenger / Sedan',
  light_duty_gas:     'Light Duty Gas (F-150 thru F-350)',
  light_duty_diesel:  'Light Duty Diesel (F-250/350 diesel, RAM diesel)',
  cargo_van:          'Cargo / Sprinter Van',
  medium_duty:        'Medium Duty Gas (F-450, F-550, F-650)',
  medium_duty_diesel: 'Medium Duty Diesel',
  heavy_duty_diesel:  'Heavy Duty Diesel (F-750+, Class 7-8)',
};

const FLEET_SIZE_OPTIONS = [
  { value: 'any',   label: 'Any size' },
  { value: 'xs',    label: '1–5' },
  { value: 'small', label: '6–20' },
  { value: 'mid',   label: '21–100' },
  { value: 'large', label: '100+' },
];

const RADIUS_OPTIONS  = [1, 5, 10, 25, 50, 75, 100];
const DRIVE_OPTIONS   = [10, 15, 20, 30, 45, 60];

const PROB_COLOR = (p) => {
  if (p >= 75) return { bar: '#16a34a', bg: '#f0fdf4', text: '#15803d' };
  if (p >= 50) return { bar: '#d97706', bg: '#fffbeb', text: '#92400e' };
  return               { bar: '#ef4444', bg: '#fef2f2', text: '#b91c1c' };
};

function driveTimeToMiles(m) { return Math.max(3, Math.round(m * 0.55)); }

// ── Reusable pill dropdown ─────────────────────────────────────────────────────
function Pill({ label, active, children, width = 300 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 14px', height: 38, borderRadius: 24, fontSize: 13, fontWeight: 600,
          cursor: 'pointer', whiteSpace: 'nowrap',
          border: active || open ? '2px solid #1a3358' : '1.5px solid #d1d5db',
          background: active ? '#1a3358' : 'white',
          color: active ? 'white' : '#374151',
          boxShadow: '0 1px 3px rgba(0,0,0,.07)',
          transition: 'all .15s',
        }}
      >
        {label}
        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ opacity: .55, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 400,
          background: 'white', borderRadius: 14, border: '1px solid #e5e7eb',
          boxShadow: '0 12px 40px rgba(0,0,0,.14)', width, padding: 18,
        }}>
          {children}
          <button onClick={() => setOpen(false)} style={{
            width: '100%', marginTop: 14, padding: '9px', borderRadius: 8,
            border: 'none', background: '#1a3358', color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer',
          }}>Done</button>
        </div>
      )}
    </div>
  );
}

// ── Map ────────────────────────────────────────────────────────────────────────
function FleetFinderMap({ shopLat, shopLng, radiusMiles, mode, onPolygonChange, results }) {
  const mapRef         = useRef(null);
  const leafletRef     = useRef(null);
  const circleRef      = useRef(null);
  const drawnLayersRef = useRef(null);
  const markersRef     = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css'; link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    function init(L) {
      if (leafletRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true }).setView([shopLat, shopLng], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap', maxZoom: 18,
      }).addTo(map);
      const shopIcon = L.divIcon({
        html: '<div style="background:#1a3358;color:#fbbf24;border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:15px;border:2px solid #fbbf24;box-shadow:0 2px 8px rgba(0,0,0,.35)">🔧</div>',
        className: '', iconSize: [30, 30], iconAnchor: [15, 15],
      });
      L.marker([shopLat, shopLng], { icon: shopIcon }).addTo(map).bindPopup('Your Shop');
      circleRef.current = L.circle([shopLat, shopLng], {
        radius: radiusMiles * 1609.34, color: '#2d5690', fillColor: '#2d5690', fillOpacity: 0.08, weight: 2,
      }).addTo(map);
      const drawn = new L.FeatureGroup();
      map.addLayer(drawn);
      drawnLayersRef.current = drawn;
      leafletRef.current = map;
    }
    window.L ? init(window.L) : (() => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => init(window.L);
      document.head.appendChild(s);
    })();
  }, [shopLat, shopLng]);

  useEffect(() => {
    if (!leafletRef.current || !circleRef.current) return;
    if (mode === 'circle' || mode === 'drivetime') {
      circleRef.current.setRadius(radiusMiles * 1609.34);
      circleRef.current.setStyle({ opacity: 1, fillOpacity: 0.08 });
    } else {
      circleRef.current.setStyle({ opacity: 0, fillOpacity: 0 });
    }
  }, [radiusMiles, mode]);

  useEffect(() => {
    if (!leafletRef.current || !window.L || mode !== 'polygon') return;
    function activate() {
      const L = window.L;
      if (!L.Draw) return;
      const map = leafletRef.current;
      const drawn = drawnLayersRef.current;
      drawn.clearLayers();
      const handler = new L.Draw.Polygon(map, { shapeOptions: { color: '#2d5690', fillOpacity: 0.08 } });
      handler.enable();
      map.once(L.Draw.Event.CREATED, (e) => {
        drawn.addLayer(e.layer);
        onPolygonChange(e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]));
      });
    }
    if (!window.L.Draw) {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js';
      s.onload = activate;
      document.head.appendChild(s);
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css';
      document.head.appendChild(css);
    } else {
      activate();
    }
  }, [mode]);

  useEffect(() => {
    if (!leafletRef.current || !window.L) return;
    const L = window.L;
    const map = leafletRef.current;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    results.forEach(co => {
      if (!co.lat || !co.lng) return;
      const prob  = co.fleet_probability || 0;
      const color = prob >= 75 ? '#16a34a' : prob >= 50 ? '#d97706' : '#ef4444';
      const icon  = L.divIcon({
        html: `<div style="background:${color};color:white;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,.3)">${prob}%</div>`,
        className: '', iconSize: [26, 26], iconAnchor: [13, 13],
      });
      const m = L.marker([co.lat, co.lng], { icon }).addTo(map).bindPopup(`<b>${co.name}</b><br>${co.industry || ''}`);
      markersRef.current.push(m);
    });
  }, [results]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />;
}

// ── Shared modal shell ─────────────────────────────────────────────────────────
function ModalShell({ title, subtitle, children, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'white', borderRadius:16, padding:28, maxWidth:480, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.22)' }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:4, color:'#111827' }}>{title}</div>
        {subtitle && <div style={{ fontSize:13, color:'#6b7280', marginBottom:16 }}>{subtitle}</div>}
        {children}
        <button onClick={onCancel} style={{ marginTop:14, width:'100%', padding:'9px', borderRadius:8, border:'1px solid #e5e7eb', background:'white', fontSize:12, color:'#9ca3af', cursor:'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

function ModalBtn({ onClick, border='#e5e7eb', bg='#f9fafb', children }) {
  return (
    <button onClick={onClick} style={{
      padding:'11px 18px', borderRadius:10, border:`2px solid ${border}`,
      background:bg, fontSize:13, fontWeight:600, cursor:'pointer', textAlign:'left', color:'#111827', width:'100%',
    }}>{children}</button>
  );
}

// ── Duplicate modal ────────────────────────────────────────────────────────────
function DuplicateModal({ company, matches, onDecision, onCancel }) {
  return (
    <ModalShell
      title="Possible Duplicate"
      subtitle={<><b>{company.name}</b> looks like it may already be in your CRM:</>}
      onCancel={onCancel}
    >
      {matches.map(m => (
        <div key={m.id} style={{ marginBottom:12, padding:'10px 14px', background:'#f9fafb', borderRadius:10, border:'1px solid #e5e7eb', fontSize:12 }}>
          <div style={{ fontWeight:700, color:'#111827' }}>{m.name}</div>
          <div style={{ color:'#6b7280', marginTop:2 }}>{m.city}, {m.state} · <span style={{ color:'#9ca3af' }}>{m.match_score}% name match</span></div>
        </div>
      ))}
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
        <ModalBtn onClick={() => onDecision('duplicate')} border='#e5e7eb' bg='#f9fafb'>
          Skip — already have this one
        </ModalBtn>
        <ModalBtn onClick={() => onDecision('multi_location')} border='#0369a1' bg='#f0f9ff'>
          ➕ Add as a new location of this chain
        </ModalBtn>
        <ModalBtn onClick={() => onDecision('new')} border='#1a3358' bg='#eef2ff'>
          Import as a completely separate company
        </ModalBtn>
      </div>
    </ModalShell>
  );
}

// ── Chain modal (national chain detected in CRM) ───────────────────────────────
function ChainModal({ company, chainInfo, onDecision, onCancel }) {
  const locList = chainInfo.existing_locations?.slice(0, 4) || [];
  return (
    <ModalShell
      title={`${company.chain_name || company.name} is already in your CRM`}
      onCancel={onCancel}
    >
      <div style={{ marginBottom:14, padding:'12px 14px', background:'#f0f9ff', borderRadius:10, border:'1px solid #bae6fd', fontSize:12 }}>
        <div style={{ fontWeight:700, color:'#0369a1', marginBottom:6 }}>
          {chainInfo.location_count} location{chainInfo.location_count !== 1 ? 's' : ''} already in CRM
        </div>
        {locList.map((l, i) => (
          <div key={i} style={{ color:'#374151', marginTop:3 }}>• {l.name}{l.city ? ` — ${l.city}, ${l.state}` : ''}</div>
        ))}
        {chainInfo.existing_locations?.length > 4 && (
          <div style={{ color:'#9ca3af', marginTop:4 }}>+ {chainInfo.existing_locations.length - 4} more</div>
        )}
      </div>
      <div style={{ fontWeight:600, fontSize:13, color:'#374151', marginBottom:10 }}>
        What do you want to do with <b>{company.name}</b>{company.city ? ` (${company.city})` : ''}?
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <ModalBtn onClick={() => onDecision('chain_location')} border='#0369a1' bg='#f0f9ff'>
          ➕ Add as a new {company.chain_name || company.name} location
        </ModalBtn>
        <ModalBtn onClick={() => onDecision('new')} border='#1a3358' bg='#eef2ff'>
          Import as a separate standalone company
        </ModalBtn>
        <ModalBtn onClick={() => onDecision('skip')} border='#e5e7eb' bg='#f9fafb'>
          Skip this one
        </ModalBtn>
      </div>
    </ModalShell>
  );
}

// ── New chain modal (first location of a chain) ────────────────────────────────
function NewChainModal({ company, onDecision, onCancel }) {
  return (
    <ModalShell
      title={`Start a chain group for ${company.chain_name || company.name}?`}
      subtitle={`This looks like a national chain. Starting a chain group lets you track all local locations together.`}
      onCancel={onCancel}
    >
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        <ModalBtn onClick={() => onDecision('start_chain')} border='#0369a1' bg='#f0f9ff'>
          ➕ Import and start a "{company.chain_name || company.name}" chain group
        </ModalBtn>
        <ModalBtn onClick={() => onDecision('new')} border='#1a3358' bg='#eef2ff'>
          Import as a regular standalone company
        </ModalBtn>
      </div>
    </ModalShell>
  );
}

// ── Score factors tooltip ──────────────────────────────────────────────────────
function ScoreTooltip({ factors, colors }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  if (!factors?.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={e => { e.stopPropagation(); setOpen(o => !o); }} style={{
        width: 16, height: 16, borderRadius: '50%', border: `1px solid ${colors.bar}`,
        background: colors.bg, color: colors.text, fontSize: 9, fontWeight: 800,
        cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
      }}>?</button>
      {open && (
        <div style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'white', border: '1px solid #e5e7eb', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,.14)', padding: '10px 12px', zIndex: 500,
          minWidth: 220, maxWidth: 280,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>Score Breakdown</div>
          {factors.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <span style={{
                fontSize: 10, fontWeight: 800, minWidth: 32, textAlign: 'right',
                color: f.impact === '+' ? '#15803d' : '#b91c1c',
              }}>{f.impact}{f.points}</span>
              <span style={{ fontSize: 11, color: '#374151', flex: 1 }}>{f.factor}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Result card ────────────────────────────────────────────────────────────────
function ResultCard({ company, onImport, onDismiss, importing }) {
  const [expanded, setExpanded] = useState(false);
  const prob      = company.fleet_probability || 0;
  const colors    = PROB_COLOR(prob);
  const inCrm     = company.already_in_crm;

  return (
    <div style={{
      background: inCrm ? '#f9fafb' : 'white',
      borderRadius: 14, marginBottom: 10,
      border: `1px solid ${inCrm ? '#d1d5db' : '#e5e7eb'}`,
      boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      overflow: 'hidden',
      opacity: inCrm ? 0.75 : 1,
    }}>
      {/* Top stripe */}
      <div style={{ height: 3, background: inCrm ? '#d1d5db' : colors.bar }} />

      {/* Already in CRM banner */}
      {inCrm && (
        <div style={{ padding: '5px 16px', background: '#f3f4f6', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>Already in CRM</span>
          {company.crm_match_name && (
            <span style={{ fontSize: 11, color: '#9ca3af' }}>→ matched to <b style={{ color: '#374151' }}>{company.crm_match_name}</b>{company.crm_match_city ? ` (${company.crm_match_city})` : ''}</span>
          )}
        </div>
      )}

      <div style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 13 }}>

          {/* Probability badge + score tooltip */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 12, background: inCrm ? '#f3f4f6' : colors.bg,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: inCrm ? '#9ca3af' : colors.text, lineHeight: 1 }}>{prob}%</div>
              <div style={{ fontSize: 9, color: inCrm ? '#9ca3af' : colors.text, opacity: .65, marginTop: 2, fontWeight: 700, letterSpacing: '.04em' }}>FLEET</div>
            </div>
            <ScoreTooltip factors={company.score_factors} colors={inCrm ? { bg: '#f3f4f6', bar: '#9ca3af', text: '#6b7280' } : colors} />
          </div>

          {/* Info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 700, fontSize: 14, color: inCrm ? '#6b7280' : '#111827', marginBottom: 3,
              display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap',
            }}>
              {company.name}
              {company.is_national_chain    && <Tag bg="#ede9fe" c="#6d28d9">Chain</Tag>}
              {company.is_local_independent && <Tag bg="#dcfce7" c="#15803d">Local</Tag>}
              {company.industry_category === 'contract_driven' && <Tag bg="#fef3c7" c="#92400e">B2B</Tag>}
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: company.local_office_found || company.local_field_employees_found > 0 ? 7 : 0 }}>
              {[company.industry, company.city && `${company.city}, ${company.state}`, company.distance_miles != null && `${company.distance_miles.toFixed(1)} mi away`].filter(Boolean).join(' · ')}
            </div>
            {!inCrm && (company.local_office_found || company.local_field_employees_found > 0) && (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {company.local_office_found && <Signal bg="#dcfce7" c="#15803d">✓ Local office</Signal>}
                {company.local_field_employees_found > 0 && <Signal bg="#dbeafe" c="#1e40af">{company.local_field_employees_found} field employees</Signal>}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            {inCrm ? (
              <div style={{ padding: '8px 14px', borderRadius: 8, background: '#f3f4f6', border: '1px solid #e5e7eb', fontSize: 11, color: '#9ca3af', fontWeight: 600, textAlign: 'center', whiteSpace: 'nowrap' }}>
                In CRM
              </div>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); onImport(); }}
                disabled={importing}
                style={{
                  padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                  background: importing ? '#9ca3af' : '#1a3358', color: 'white', fontWeight: 700, fontSize: 12,
                }}>
                {importing ? '…' : 'Import'}
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); onDismiss(); }}
              style={{
                padding: '6px 18px', borderRadius: 8, border: '1px solid #e5e7eb',
                background: 'white', color: '#9ca3af', fontSize: 11, cursor: 'pointer',
              }}>
              Skip
            </button>
          </div>
        </div>

        {/* Expand toggle */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ marginTop: 10, width: '100%', textAlign: 'center', fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>
          {expanded ? '▲ Less' : '▼ More details'}
        </button>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid #f3f4f6', padding: '14px 16px', background: '#f9fafb', fontSize: 12 }}>
          {company.fleet_note && (
            <div style={{ background: colors.bg, borderLeft: `3px solid ${colors.bar}`, padding: '8px 12px', borderRadius: 6, marginBottom: 10, color: colors.text, fontWeight: 500, lineHeight: 1.5 }}>
              {company.fleet_note}
            </div>
          )}
          {company.research_notes && (
            <div style={{ color: '#4b5563', marginBottom: 10, lineHeight: 1.6 }}>{company.research_notes}</div>
          )}
          {company.fleet_signals?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {company.fleet_signals.map((s, i) => (
                <span key={i} style={{ padding: '2px 8px', background: '#dbeafe', borderRadius: 8, fontSize: 10, color: '#1e40af', fontWeight: 600 }}>{s}</span>
              ))}
            </div>
          )}
          {company.local_field_employee_titles?.length > 0 && (
            <div style={{ marginBottom: 10, padding: '8px 10px', background: '#f0fdf4', borderRadius: 7, border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#15803d', marginBottom: 4 }}>Local Field Employees Found</div>
              <div style={{ fontSize: 11, color: '#166534' }}>{company.local_field_employee_titles.join(' · ')}</div>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', color: '#4b5563', marginBottom: 10 }}>
            {company.address && <InfoRow label="Address">{company.address}<br />{company.city}, {company.state} {company.zip}</InfoRow>}
            {company.main_phone && <InfoRow label="Phone">{company.main_phone}</InfoRow>}
            {company.website && (
              <InfoRow label="Website">
                <a href={company.website} target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>
                  {company.website.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </InfoRow>
            )}
            {company.estimated_fleet_size && <InfoRow label="Est. Fleet">{company.estimated_fleet_size}</InfoRow>}
            {company.contact_name && <InfoRow label="Contact">{company.contact_name}{company.contact_title && <span style={{ color: '#9ca3af' }}> · {company.contact_title}</span>}</InfoRow>}
            {company.local_office_address && <InfoRow label="Local Office">{company.local_office_address}</InfoRow>}
          </div>
          {company.sources?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {company.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{ padding: '3px 10px', background: 'white', border: '1px solid #bae6fd', borderRadius: 10, fontSize: 10, color: '#0284c7', fontWeight: 600, textDecoration: 'none' }}>
                  ↗ {s.label || s.url}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tag({ bg, c, children }) {
  return <span style={{ fontSize: 10, background: bg, color: c, borderRadius: 4, padding: '2px 7px', fontWeight: 600 }}>{children}</span>;
}
function Signal({ bg, c, children }) {
  return <span style={{ fontSize: 10, background: bg, color: c, borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>{children}</span>;
}
function InfoRow({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

// ── Segment buttons (shared style for radius / drive / fleet size) ─────────────
function SegBtns({ options, selected, onSelect, format = v => v }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {options.map(opt => {
        const val   = typeof opt === 'object' ? opt.value : opt;
        const label = typeof opt === 'object' ? opt.label : format(opt);
        const active = selected === val;
        return (
          <button key={val} onClick={() => onSelect(val)} style={{
            padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            border: active ? '2px solid #1a3358' : '1.5px solid #d1d5db',
            background: active ? '#1a3358' : 'white',
            color: active ? 'white' : '#374151',
            transition: 'all .12s',
          }}>{label}</button>
        );
      })}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function FleetFinder() {
  const { showToast } = useApp();

  const [settings,     setSettings]     = useState(null);
  const [budget,       setBudget]        = useState({ budget: 50, spent: 0, remaining: 50 });
  const [costLog,      setCostLog]       = useState([]);
  const [activePanel,  setActivePanel]   = useState('results');

  const [mode,         setMode]          = useState('circle');
  const [radius,       setRadius]        = useState(25);
  const [driveMinutes, setDriveMinutes]  = useState(20);
  const [polygonCoords,setPolygonCoords] = useState(null);
  const [allIndustries,setAllIndustries] = useState([]);
  const [industries,   setIndustries]    = useState([]);
  const [indSearch,    setIndSearch]     = useState('');
  const [vehicleTypes, setVehicleTypes]  = useState(Object.keys(VEHICLE_LABELS));
  const [fleetSizes,   setFleetSizes]    = useState(['any']);

  const [estimate,     setEstimate]      = useState(null);
  const [searching,    setSearching]     = useState(false);
  const [lastDebug,    setLastDebug]     = useState(null);
  const [results,      setResults]       = useState([]);
  const [searchMeta,   setSearchMeta]    = useState(null);
  const [searchSummary,setSearchSummary] = useState(null);
  const [importing,      setImporting]      = useState({});
  const [dupModal,       setDupModal]       = useState(null);
  const [chainModal,     setChainModal]     = useState(null);  // { company, chainInfo, index }
  const [newChainModal,  setNewChainModal]  = useState(null);  // { company, index }

  const [shopLat, setShopLat] = useState(35.1965);
  const [shopLng, setShopLng] = useState(-80.7812);

  const effectiveRadius = mode === 'drivetime' ? driveTimeToMiles(driveMinutes) : radius;

  useEffect(() => {
    async function load() {
      try {
        const [s, b, cl] = await Promise.all([api.ffSettings(), api.ffBudget(), api.ffCostLog()]);
        setSettings(s); setBudget(b); setCostLog(cl);
        const ind = [...(s.ff_industries || []), ...(s.ff_custom_industries || [])];
        setAllIndustries(ind); setIndustries(ind);
        setRadius(parseFloat(s.ff_default_radius) || 25);
        if (s.shop_lat) setShopLat(parseFloat(s.shop_lat));
        if (s.shop_lng) setShopLng(parseFloat(s.shop_lng));
      } catch (e) { showToast('Failed to load settings', 'error'); }
    }
    load();
  }, []);

  useEffect(() => {
    if (!industries.length) { setEstimate(null); return; }
    api.ffEstimate({ industries, radius_miles: effectiveRadius }).then(r => setEstimate(r.estimate_usd)).catch(() => {});
  }, [industries, effectiveRadius]);

  const toggleIndustry = ind => setIndustries(p => p.includes(ind) ? p.filter(i => i !== ind) : [...p, ind]);
  const toggleVehicle  = vt  => setVehicleTypes(p => p.includes(vt)  ? p.filter(v => v !== vt)  : [...p, vt]);

  function addOneTime() {
    const name = indSearch.trim();
    if (!name) return;
    if (!allIndustries.includes(name)) setAllIndustries(p => [...p, name]);
    if (!industries.includes(name))    setIndustries(p => [...p, name]);
    setIndSearch('');
  }

  async function saveIndustry() {
    const name = indSearch.trim();
    if (!name) return;
    try {
      const current = settings?.ff_custom_industries || [];
      if (current.includes(name)) { addOneTime(); return; }
      const updated = [...current, name];
      await api.ffUpdateSettings({ ff_custom_industries: updated });
      setSettings(p => ({ ...p, ff_custom_industries: updated }));
      if (!allIndustries.includes(name)) setAllIndustries(p => [...p, name]);
      if (!industries.includes(name))    setIndustries(p => [...p, name]);
      setIndSearch('');
      showToast(`"${name}" saved to your industry list`);
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function removeIndustry(ind) {
    setAllIndustries(p => p.filter(i => i !== ind));
    setIndustries(p => p.filter(i => i !== ind));
    const custom = settings?.ff_custom_industries || [];
    if (custom.includes(ind)) {
      const updated = custom.filter(i => i !== ind);
      await api.ffUpdateSettings({ ff_custom_industries: updated }).catch(() => {});
      setSettings(p => ({ ...p, ff_custom_industries: updated }));
    }
  }

  const filteredIndustries = allIndustries.filter(i =>
    !indSearch.trim() || i.toLowerCase().includes(indSearch.toLowerCase())
  );
  const indSearchIsNew = indSearch.trim() && !allIndustries.some(i => i.toLowerCase() === indSearch.trim().toLowerCase());

  async function runSearch() {
    if (searching) return;
    if (budget.spent >= budget.budget) { showToast(`Monthly budget of $${budget.budget} reached`, 'error'); return; }
    setSearching(true); setResults([]); setSearchMeta(null); setSearchSummary(null); setActivePanel('results');
    try {
      const data = await api.ffSearch({
        lat: shopLat, lng: shopLng,
        radius_miles:   effectiveRadius,
        polygon_coords: polygonCoords,
        industries, vehicle_types: vehicleTypes, fleet_size: fleetSizes,
      });
      setResults(data.results || []);
      setSearchMeta(data);
      if (data.search_summary) setSearchSummary(data.search_summary);
      if (data.debug) setLastDebug(data.debug);
      const [b, cl] = await Promise.all([api.ffBudget(), api.ffCostLog()]);
      setBudget(b); setCostLog(cl);
    } catch (e) { showToast(e.message || 'Search failed', 'error'); }
    finally { setSearching(false); }
  }

  async function handleImport(company, index) {
    setImporting(p => ({ ...p, [index]: true }));
    try {
      // 1. Check for fuzzy name duplicates
      const { matches } = await api.ffCheckDuplicate({
        name: company.name, address: company.address,
        phone: company.main_phone, city: company.city,
      });
      if (matches.length > 0) {
        setDupModal({ company, matches, index });
        return;
      }

      // 2. If national chain, check if that chain already exists in CRM
      if (company.is_national_chain && company.chain_name) {
        const chainInfo = await api.ffCheckChain({ chain_name: company.chain_name });
        if (chainInfo.found) {
          setChainModal({ company, chainInfo, index });
          return;
        }
        // Chain not in CRM yet — ask if they want to start a chain group
        setNewChainModal({ company, index });
        return;
      }

      await doImport(company, 'new', null, index);
    } catch (e) {
      showToast(e.message || 'Import failed', 'error');
      setImporting(p => ({ ...p, [index]: false }));
    }
  }

  async function handleDupDecision(decision, company, index, matches) {
    setDupModal(null);
    setImporting(p => ({ ...p, [index]: true }));
    try {
      if (decision === 'duplicate') { showToast('Skipped — already in CRM', 'success'); removeResult(index); return; }
      await doImport(company, decision, matches, index);
    } catch (e) { showToast(e.message || 'Import failed', 'error'); }
    finally { setImporting(p => ({ ...p, [index]: false })); }
  }

  async function handleChainDecision(decision, company, chainInfo, index) {
    setChainModal(null);
    setImporting(p => ({ ...p, [index]: true }));
    try {
      if (decision === 'skip') { removeResult(index); return; }
      await doImport(company, decision, null, index, chainInfo);
    } catch (e) { showToast(e.message || 'Import failed', 'error'); }
    finally { setImporting(p => ({ ...p, [index]: false })); }
  }

  async function handleNewChainDecision(decision, company, index) {
    setNewChainModal(null);
    setImporting(p => ({ ...p, [index]: true }));
    try {
      await doImport(company, decision, null, index, null);
    } catch (e) { showToast(e.message || 'Import failed', 'error'); }
    finally { setImporting(p => ({ ...p, [index]: false })); }
  }

  async function doImport(company, decision, matches, index, chainInfo = null) {
    const isChainLocation = decision === 'multi_location' || decision === 'chain_location';
    const isStartChain    = decision === 'start_chain';
    const isMulti         = isChainLocation || company.is_multi_location;

    // Determine location_group for chain linking
    let locationGroup = null;
    if (isChainLocation && chainInfo) {
      locationGroup = chainInfo.location_group || company.chain_name || company.name;
    } else if (isChainLocation && matches?.length) {
      locationGroup = matches[0].location_group || matches[0].name;
    } else if (isStartChain) {
      locationGroup = company.chain_name || company.name;
    }

    await api.createCompany({
      name:       company.name,
      main_phone: company.main_phone  || null,
      industry:   company.industry    || null,
      address:    company.address     || null,
      city:       company.city        || null,
      state:      company.state       || null,
      zip:        company.zip         || null,
      website:    company.website     || null,
      fleet_research: {
        fleet_note:                  company.fleet_note                 || null,
        research_notes:              company.research_notes             || null,
        fleet_probability:           company.fleet_probability          || null,
        fleet_signals:               company.fleet_signals              || [],
        score_factors:               company.score_factors              || [],
        estimated_fleet_size:        company.estimated_fleet_size       || null,
        vehicle_types:               company.vehicle_types_detected     || [],
        vehicle_type_confidence:     company.vehicle_type_confidence    || null,
        industry_category:           company.industry_category          || null,
        local_office_found:          company.local_office_found         || false,
        local_office_address:        company.local_office_address       || null,
        local_field_employees_found: company.local_field_employees_found || null,
        local_field_employee_titles: company.local_field_employee_titles || [],
        is_local_independent:        company.is_local_independent       ?? null,
        is_national_chain:           company.is_national_chain          ?? null,
        chain_name:                  company.chain_name                 || null,
        contact_name:                company.contact_name               || null,
        contact_title:               company.contact_title              || null,
        sources:                     company.sources                    || [],
        distance_miles:              company.distance_miles != null ? parseFloat(company.distance_miles.toFixed(1)) : null,
        searched_at:                 new Date().toISOString(),
      },
      is_multi_location: isMulti || isStartChain ? 1 : 0,
      location_name:     isMulti || isStartChain ? (company.city || null) : null,
      location_group:    locationGroup,
    });

    showToast(`${company.name} imported`, 'success');
    removeResult(index);
  }

  function removeResult(index) { setResults(p => p.filter((_, i) => i !== index)); }

  async function handleDismiss(company, index) {
    try {
      await api.ffDismiss({ name: company.name, address: company.address, phone: company.main_phone, city: company.city, state: company.state });
      removeResult(index);
      showToast('Hidden from future searches', 'success');
    } catch (e) { showToast(e.message || 'Failed', 'error'); }
  }

  const budgetPct   = budget.budget > 0 ? Math.min(100, Math.round((budget.spent / budget.budget) * 100)) : 0;
  const budgetColor = budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#d97706' : '#16a34a';

  const industryLabel = industries.length === 0 ? 'No Industries'
    : industries.length === allIndustries.length ? 'All Industries'
    : `${industries.length} ${industries.length === 1 ? 'Industry' : 'Industries'}`;

  const vehicleLabel = vehicleTypes.length === Object.keys(VEHICLE_LABELS).length ? 'All Vehicles'
    : `${vehicleTypes.length} Vehicle${vehicleTypes.length !== 1 ? 's' : ''}`;

  const zoneModeLabel = mode === 'circle' ? `${radius} mi radius`
    : mode === 'drivetime' ? `${driveMinutes} min drive`
    : 'Custom area';


  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#f3f4f6' }}>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white', borderBottom: '1px solid #e5e7eb', padding: '0 24px',
        height: 58, display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0,
        boxShadow: '0 1px 3px rgba(0,0,0,.06)',
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#111827', letterSpacing: '-.01em' }}>Find Companies</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>AI-powered fleet lead discovery</div>
        </div>

        {/* Budget meter */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 3 }}>Monthly Budget</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: budgetColor }}>
              ${budget.spent.toFixed(2)} <span style={{ color: '#9ca3af', fontWeight: 400 }}>/ ${budget.budget}</span>
            </div>
          </div>
          <div style={{ width: 100, height: 6, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${budgetPct}%`, height: '100%', background: budgetColor, borderRadius: 4, transition: 'width .4s' }} />
          </div>
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <div style={{
        background: 'white', borderBottom: '1px solid #e5e7eb', padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap',
        position: 'relative', zIndex: 500,
      }}>

        {/* Search Zone pill */}
        <Pill label={`📍 ${zoneModeLabel}`} active={mode !== 'circle' || radius !== 25} width={300}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#111827', marginBottom: 14 }}>Search Zone</div>

          {/* Mode tabs */}
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 16, gap: 2 }}>
            {[['circle', '⬤ Radius'], ['drivetime', '⏱ Drive Time'], ['polygon', '⬡ Draw Area']].map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '6px 4px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: mode === m ? 'white' : 'transparent',
                color: mode === m ? '#1a3358' : '#6b7280',
                boxShadow: mode === m ? '0 1px 4px rgba(0,0,0,.1)' : 'none',
              }}>{lbl}</button>
            ))}
          </div>

          {mode === 'circle' && (
            <>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 10 }}>Select radius</div>
              <SegBtns
                options={RADIUS_OPTIONS}
                selected={radius}
                onSelect={setRadius}
                format={v => `${v} mi`}
              />
            </>
          )}
          {mode === 'drivetime' && (
            <>
              <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 10 }}>
                Select drive time <span style={{ color: '#9ca3af', fontWeight: 400 }}>(≈ {driveTimeToMiles(driveMinutes)} mi)</span>
              </div>
              <SegBtns
                options={DRIVE_OPTIONS}
                selected={driveMinutes}
                onSelect={setDriveMinutes}
                format={v => `${v} min`}
              />
            </>
          )}
          {mode === 'polygon' && (
            <div style={{ fontSize: 11, color: '#6b7280', background: '#fefce8', borderRadius: 8, padding: '10px 12px', lineHeight: 1.6 }}>
              Click points on the map to draw your search area. Double-click to finish the shape.
            </div>
          )}
        </Pill>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: '#e5e7eb', flexShrink: 0 }} />

        {/* Industries */}
        <Pill label={`🏭 ${industryLabel}`} active={industries.length > 0 && industries.length !== allIndustries.length} width={330}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>Industries</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setIndustries([...allIndustries])} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>All</button>
              <button onClick={() => setIndustries([])} style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
            </div>
          </div>
          <input
            type="text" placeholder="Search or add industry…"
            value={indSearch} onChange={e => setIndSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addOneTime()}
            style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 12, marginBottom: 8, boxSizing: 'border-box', outline: 'none' }}
          />
          {indSearchIsNew && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button onClick={addOneTime} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: '1px solid #fbbf24', background: '#fefce8', color: '#92400e', cursor: 'pointer' }}>
                + This search only
              </button>
              <button onClick={saveIndustry} style={{ flex: 1, padding: '6px', borderRadius: 7, fontSize: 11, fontWeight: 700, border: 'none', background: '#1a3358', color: 'white', cursor: 'pointer' }}>
                + Save permanently
              </button>
            </div>
          )}
          <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredIndustries.map(ind => (
              <label key={ind} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 8px', borderRadius: 8, background: industries.includes(ind) ? '#eef2ff' : 'transparent' }}>
                <input type="checkbox" checked={industries.includes(ind)} onChange={() => toggleIndustry(ind)} style={{ accentColor: '#1a3358', cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ fontSize: 12, flex: 1, color: '#374151' }}>{ind}</span>
                <button onClick={e => { e.preventDefault(); removeIndustry(ind); }} style={{ background: 'none', border: 'none', color: '#d1d5db', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>✕</button>
              </label>
            ))}
          </div>
        </Pill>

        {/* Vehicles */}
        <Pill label={`🚛 ${vehicleLabel}`} active={vehicleTypes.length !== Object.keys(VEHICLE_LABELS).length} width={300}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>Vehicle Types</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => setVehicleTypes(Object.keys(VEHICLE_LABELS))} style={{ fontSize: 11, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>All</button>
              <button onClick={() => setVehicleTypes([])} style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {Object.entries(VEHICLE_LABELS).map(([key, label]) => (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                <input type="checkbox" checked={vehicleTypes.includes(key)} onChange={() => toggleVehicle(key)} style={{ accentColor: '#1a3358', cursor: 'pointer' }} />
                <span style={{ fontSize: 12, color: '#374151' }}>{label}</span>
              </label>
            ))}
          </div>
        </Pill>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: '#e5e7eb', flexShrink: 0 }} />

        {/* Fleet Size — inline fixed buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>Fleet size</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FLEET_SIZE_OPTIONS.map(opt => {
              const active = fleetSizes.includes(opt.value);
              return (
                <button key={opt.value} onClick={() => {
                  if (opt.value === 'any') { setFleetSizes(['any']); return; }
                  setFleetSizes(prev => {
                    const without = prev.filter(v => v !== 'any' && v !== opt.value);
                    const next = prev.includes(opt.value) ? without : [...without, opt.value];
                    return next.length === 0 ? ['any'] : next;
                  });
                }} style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  border: active ? '2px solid #1a3358' : '1.5px solid #d1d5db',
                  background: active ? '#1a3358' : 'white',
                  color: active ? 'white' : '#374151',
                  transition: 'all .12s',
                }}>{opt.label}</button>
              );
            })}
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Cost estimate + Search button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {estimate != null && (
            <div style={{ fontSize: 11, color: '#9ca3af' }}>
              Est. <strong style={{ color: '#374151' }}>${estimate.toFixed(3)}</strong>
            </div>
          )}
          <button
            onClick={runSearch}
            disabled={searching || industries.length === 0 || budget.spent >= budget.budget}
            style={{
              height: 40, padding: '0 24px', borderRadius: 24, border: 'none', fontWeight: 700, fontSize: 13,
              cursor: searching || industries.length === 0 ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
              background: searching || industries.length === 0 ? '#9ca3af' : '#1a3358',
              color: 'white', boxShadow: searching ? 'none' : '0 2px 10px rgba(26,51,88,.3)',
              transition: 'all .15s',
            }}>
            {searching ? '⏳ Searching…' : 'Search'}
          </button>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Map */}
        <div style={{ flex: '0 0 56%', padding: 10, overflow: 'hidden' }}>
          <FleetFinderMap
            shopLat={shopLat} shopLng={shopLng} radiusMiles={effectiveRadius}
            mode={mode} onPolygonChange={setPolygonCoords} results={results}
          />
        </div>

        {/* Results panel */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderLeft: '1px solid #e5e7eb', background: '#f9fafb', overflow: 'hidden', minWidth: 0 }}>

          {/* Tabs */}
          <div style={{ padding: '0 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, background: 'white' }}>
            {[
              { id: 'results', label: results.length > 0 ? `Results (${results.length})` : 'Results' },
              { id: 'history', label: costLog.length > 0 ? `History (${costLog.length})` : 'History' },
            ].map(t => (
              <button key={t.id} onClick={() => setActivePanel(t.id)} style={{
                padding: '12px 16px', border: 'none', background: 'transparent', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                color: activePanel === t.id ? '#111827' : '#9ca3af',
                borderBottom: activePanel === t.id ? '2px solid #1a3358' : '2px solid transparent',
              }}>{t.label}</button>
            ))}
            {searchMeta && (
              <div style={{ marginLeft: 'auto', fontSize: 10, color: '#9ca3af', paddingBottom: 2 }}>
                Last: ${searchMeta.cost_usd?.toFixed(4)} · {searchMeta.states_searched?.join(', ')}
              </div>
            )}
          </div>

          {/* Panel content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

            {activePanel === 'results' && (
              <>
                {searching && (
                  <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🔍</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#111827', marginBottom: 8 }}>Searching across multiple sources…</div>
                    <div style={{ fontSize: 12, color: '#9ca3af', lineHeight: 1.7 }}>Google · LinkedIn · FMCSA · Indeed · State registries</div>
                    <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 6 }}>This takes 30–90 seconds</div>
                  </div>
                )}
                {!searching && results.length === 0 && searchMeta && (
                  <div style={{ textAlign: 'center', padding: '60px 24px', color: '#9ca3af' }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>🏙️</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#374151' }}>No new companies found</div>
                    <div style={{ fontSize: 12 }}>Try adjusting your filters or expanding your search zone.</div>
                  </div>
                )}
                {!searching && results.length === 0 && !searchMeta && (
                  <div style={{ textAlign: 'center', padding: '60px 24px' }}>
                    <div style={{ fontSize: 40, marginBottom: 16 }}>🏢</div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#374151', marginBottom: 6 }}>Ready to find leads</div>
                    <div style={{ fontSize: 12, color: '#9ca3af' }}>Set your filters above and hit Search</div>
                    <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 4 }}>Results sorted by fleet probability — highest first</div>
                  </div>
                )}
                {results.map((co, i) => (
                  <ResultCard key={`${co.name}-${i}`} company={co}
                    onImport={() => handleImport(co, i)}
                    onDismiss={() => handleDismiss(co, i)}
                    importing={!!importing[i]} />
                ))}

                {searchSummary && !searching && (
                  <div style={{
                    marginTop: 8, padding: '12px 14px', borderRadius: 10,
                    background: '#f0f9ff', border: '1px solid #bae6fd',
                    fontSize: 12, color: '#0369a1', lineHeight: 1.6,
                  }}>
                    <span style={{ fontWeight: 700, display: 'block', marginBottom: 4, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#0284c7' }}>Search Coverage</span>
                    {searchSummary}
                  </div>
                )}
              </>
            )}

            {activePanel === 'history' && (
              <>
                {costLog.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 24px', color: '#9ca3af', fontSize: 13 }}>No searches run yet.</div>
                ) : (
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ color: '#9ca3af', fontSize: 11 }}>
                        {['Date', 'Industries', 'Radius', 'Results', 'Cost'].map((h, i) => (
                          <th key={h} style={{ textAlign: i > 1 ? 'right' : 'left', padding: '4px 8px 12px', borderBottom: '1px solid #e5e7eb', fontWeight: 700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {costLog.map(r => (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '9px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>{new Date(r.ran_at).toLocaleDateString()}</td>
                          <td style={{ padding: '9px 8px', color: '#374151', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.search_label || '—'}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', color: '#6b7280' }}>{r.radius_miles}mi</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right' }}>{r.result_count}</td>
                          <td style={{ padding: '9px 8px', textAlign: 'right', fontWeight: 700, color: '#374151' }}>${r.cost_usd?.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ padding: '12px 8px 4px', fontSize: 11, color: '#9ca3af', fontWeight: 600 }}>Total spent this month</td>
                        <td style={{ padding: '12px 8px 4px', textAlign: 'right', fontWeight: 800, color: '#111827' }}>${budget.spent.toFixed(4)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* Last search debug panel */}
                {lastDebug && (
                  <div style={{ marginTop: 20, borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    <div style={{ padding: '10px 14px', background: lastDebug.parse_error ? '#fef2f2' : '#f0fdf4', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: lastDebug.parse_error ? '#b91c1c' : '#15803d' }}>
                        {lastDebug.parse_error ? '⚠ Last Search Debug' : '✓ Last Search Debug'}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>
                        {lastDebug.turns} AI turn{lastDebug.turns !== 1 ? 's' : ''} · {lastDebug.raw_companies} companies found · {lastDebug.filtered_out} filtered out
                      </span>
                    </div>
                    {lastDebug.parse_error && (
                      <div style={{ padding: '10px 14px', background: '#fef2f2', fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
                        Parse error: {lastDebug.parse_error}
                      </div>
                    )}
                    <div style={{ padding: '10px 14px', background: '#f9fafb' }}>
                      <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.04em' }}>Raw AI output preview</div>
                      <pre style={{ fontSize: 10, color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0, maxHeight: 220, overflowY: 'auto', lineHeight: 1.5 }}>
                        {lastDebug.raw_preview || '(empty)'}
                      </pre>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {dupModal && (
        <DuplicateModal
          company={dupModal.company} matches={dupModal.matches}
          onDecision={d => handleDupDecision(d, dupModal.company, dupModal.index, dupModal.matches)}
          onCancel={() => { setDupModal(null); setImporting(p => ({ ...p, [dupModal.index]: false })); }}
        />
      )}
      {chainModal && (
        <ChainModal
          company={chainModal.company} chainInfo={chainModal.chainInfo}
          onDecision={d => handleChainDecision(d, chainModal.company, chainModal.chainInfo, chainModal.index)}
          onCancel={() => { setChainModal(null); setImporting(p => ({ ...p, [chainModal.index]: false })); }}
        />
      )}
      {newChainModal && (
        <NewChainModal
          company={newChainModal.company}
          onDecision={d => handleNewChainDecision(d, newChainModal.company, newChainModal.index)}
          onCancel={() => { setNewChainModal(null); setImporting(p => ({ ...p, [newChainModal.index]: false })); }}
        />
      )}
    </div>
  );
}
