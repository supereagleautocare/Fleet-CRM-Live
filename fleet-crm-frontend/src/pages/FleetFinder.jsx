import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

// ── Vehicle types ─────────────────────────────────────────────────────────────
const VEHICLE_LABELS = {
  passenger:          'Passenger / Sedan',
  light_duty_gas:     'Light Duty Gas (F-150 thru F-350)',
  light_duty_diesel:  'Light Duty Diesel (F-250/350 diesel, RAM diesel)',
  cargo_van:          'Cargo / Sprinter Van',
  medium_duty:        'Medium Duty Gas (F-450, F-550, F-650)',
  medium_duty_diesel: 'Medium Duty Diesel',
  heavy_duty_diesel:  'Heavy Duty Diesel (F-750+, Class 7-8)',
};

const TOOLTIPS = {
  searchZone:   'Defines the geographic area the AI searches. Circle and Drive Time use your shop as the center. Draw lets you outline a custom area on the map.',
  driveTime:    'Converts drive minutes to an approximate search radius from your shop. Useful for finding companies within your realistic service reach.',
  industries:   'Tells the AI which business types to focus on. It searches Google, FMCSA, LinkedIn, job boards, and registries specifically for these industries.',
  vehicleTypes: 'The AI uses this to filter which companies are relevant — it looks for FMCSA vehicle class registrations, job postings requiring specific license types, and company descriptions that match your selected classes.',
  fleetSize:    'Type any size or range (e.g. "5", "5-10", "10+"). The AI uses this to prioritize companies based on FMCSA registered vehicle counts, employee count, and service area coverage signals.',
  probability:  'How likely the AI thinks this company operates a fleet, based on FMCSA registrations, job postings, service area size, employee count, and other signals. 75%+ means strong evidence.',
};

const FLEET_SIZE_EXAMPLES = ['5', '5-10', '10+', '20+', '2-5'];

const PROB_COLOR = (p) => {
  if (p >= 75) return { bar: '#16a34a', bg: '#f0fdf4', text: '#15803d' };
  if (p >= 50) return { bar: '#d97706', bg: '#fffbeb', text: '#92400e' };
  return         { bar: '#ef4444', bg: '#fef2f2', text: '#b91c1c' };
};

// Approximate drive time → miles (suburban/mixed area)
function driveTimeToMiles(minutes) {
  return Math.max(3, Math.round(minutes * 0.55));
}

// ── Tooltip component ─────────────────────────────────────────────────────────
function Tip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex', marginLeft: 4 }}>
      <span
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 14, height: 14, borderRadius: '50%', background: 'var(--gray-300)',
          color: 'var(--gray-600)', fontSize: 9, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
        }}
      >?</span>
      {open && (
        <div style={{
          position: 'absolute', left: 18, top: -4, zIndex: 1000, width: 220,
          background: 'var(--gray-800)', color: 'white', fontSize: 11, lineHeight: 1.5,
          padding: '8px 10px', borderRadius: 7, boxShadow: '0 4px 16px rgba(0,0,0,.3)',
          pointerEvents: 'none',
        }}>{text}</div>
      )}
    </span>
  );
}

// ── Leaflet map ───────────────────────────────────────────────────────────────
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
        html: '<div style="background:#1a3358;color:#fbbf24;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fbbf24;box-shadow:0 2px 6px rgba(0,0,0,.4)">🔧</div>',
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
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
      if (drawnLayersRef.current) drawnLayersRef.current.clearLayers();
      const draw = new L.Draw.Polygon(leafletRef.current, {
        shapeOptions: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.12, weight: 2 },
      });
      draw.enable();
      leafletRef.current.once(L.Draw.Event.CREATED, (e) => {
        drawnLayersRef.current.addLayer(e.layer);
        onPolygonChange?.(e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]));
      });
    }
    if (!window.L.Draw) {
      if (!document.getElementById('ld-css')) {
        const lc = document.createElement('link');
        lc.id = 'ld-css'; lc.rel = 'stylesheet';
        lc.href = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css';
        document.head.appendChild(lc);
      }
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js';
      s.onload = activate;
      document.head.appendChild(s);
    } else { activate(); }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'polygon') return;
    drawnLayersRef.current?.clearLayers();
    onPolygonChange?.(null);
  }, [mode === 'circle' || mode === 'drivetime']);

  useEffect(() => {
    const L = window.L; const map = leafletRef.current;
    if (!L || !map) return;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];
    results.forEach(co => {
      if (!co._lat || !co._lng) return;
      const p = co.fleet_probability || 0;
      const c = p >= 75 ? '#16a34a' : p >= 50 ? '#d97706' : '#ef4444';
      const icon = L.divIcon({
        html: `<div style="background:${c};color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3)">${p}</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      });
      markersRef.current.push(
        L.marker([co._lat, co._lng], { icon }).addTo(map)
          .bindPopup(`<b>${co.name}</b><br>${co.city}, ${co.state}<br>${p}% fleet probability`)
      );
    });
  }, [results]);

  return <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 6 }} />;
}

// ── Duplicate check modal ─────────────────────────────────────────────────────
function DuplicateModal({ company, matches, onDecision, onCancel }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ background:'white', borderRadius:10, padding:24, maxWidth:520, width:'100%', boxShadow:'0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ fontWeight:700, fontSize:15, marginBottom:6 }}>Possible Match Found</div>
        <div style={{ fontSize:12, color:'var(--gray-500)', marginBottom:16 }}>We found a similar company already in your CRM. How should we handle this?</div>
        <div style={{ background:'var(--blue-50)', border:'1px solid var(--blue-100)', borderRadius:7, padding:12, marginBottom:16 }}>
          <div style={{ fontSize:11, color:'var(--gray-500)', marginBottom:2 }}>Importing</div>
          <div style={{ fontWeight:700, fontSize:13 }}>{company.name}</div>
          <div style={{ fontSize:11, color:'var(--gray-500)' }}>{company.address}, {company.city}, {company.state}</div>
        </div>
        {matches.map(m => (
          <div key={m.id} style={{ background:'var(--yellow-50)', border:'1px solid var(--yellow-100)', borderRadius:7, padding:12, marginBottom:12 }}>
            <div style={{ fontSize:11, color:'var(--gray-500)', marginBottom:2 }}>Existing record — {m.match_score}% match</div>
            <div style={{ fontWeight:700, fontSize:13 }}>{m.name}</div>
            <div style={{ fontSize:11, color:'var(--gray-500)' }}>{m.address}, {m.city}, {m.state}</div>
          </div>
        ))}
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:4 }}>
          {[
            { d:'duplicate',      label:'✕  Same company, same location — skip import',               bg:'var(--gray-50)',   border:'var(--gray-200)' },
            { d:'multi_location', label:'⊕  Different location of same chain — group as multi-location', bg:'var(--blue-50)', border:'var(--blue-100)' },
            { d:'new',            label:'+  Different company entirely — import as new',               bg:'var(--green-50)', border:'var(--green-100)' },
          ].map(({ d, label, bg, border }) => (
            <button key={d} onClick={() => onDecision(d)} style={{ padding:'10px 16px', borderRadius:7, border:`1px solid ${border}`, background:bg, fontSize:13, fontWeight:600, cursor:'pointer', textAlign:'left' }}>{label}</button>
          ))}
        </div>
        <button onClick={onCancel} style={{ marginTop:12, width:'100%', padding:'8px', borderRadius:7, border:'1px solid var(--gray-200)', background:'white', fontSize:12, color:'var(--gray-500)', cursor:'pointer' }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ company, expanded, onToggle, onImport, onDismiss, importing }) {
  const prob   = company.fleet_probability || 0;
  const colors = PROB_COLOR(prob);
  const vtypes = (company.vehicle_types_detected || []).map(v => VEHICLE_LABELS[v] || v).join(', ') || null;
  return (
    <div style={{ background:'white', borderRadius:8, border:'1px solid var(--gray-200)', marginBottom:8, overflow:'hidden' }}>
      <div onClick={onToggle} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none' }}>
        <div style={{ minWidth:42, height:42, borderRadius:8, background:colors.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
          <div style={{ fontSize:14, fontWeight:800, color:colors.text }}>{prob}%</div>
          <div style={{ width:30, height:3, borderRadius:2, background:'var(--gray-200)', marginTop:2 }}>
            <div style={{ width:`${prob}%`, height:'100%', borderRadius:2, background:colors.bar }} />
          </div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:700, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
            {company.name}
            {company.is_chain && <span style={{ marginLeft:6, fontSize:10, background:'#e0e7ff', color:'#3730a3', borderRadius:4, padding:'1px 5px', fontWeight:600 }}>CHAIN</span>}
          </div>
          <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>
            {company.industry}{company.distance_miles != null && ` · ${company.distance_miles.toFixed(1)} mi`}{company.city && ` · ${company.city}, ${company.state}`}
          </div>
          {vtypes && <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:1 }}>{vtypes}{company.vehicle_type_confidence && company.vehicle_type_confidence !== 'unknown' && <span style={{ marginLeft:4, color: company.vehicle_type_confidence === 'confirmed' ? 'var(--green-600)' : 'var(--yellow-500)' }}>({company.vehicle_type_confidence})</span>}</div>}
        </div>
        <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
          <button onClick={e => { e.stopPropagation(); onImport(); }} disabled={importing}
            style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, border:'none', background:'var(--navy-700)', color:'white', cursor:'pointer' }}>
            {importing ? '...' : 'Import'}
          </button>
          <button onClick={e => { e.stopPropagation(); onDismiss(); }} title="Never show again"
            style={{ padding:'5px 8px', borderRadius:6, fontSize:11, border:'1px solid var(--gray-200)', background:'var(--gray-50)', color:'var(--gray-500)', cursor:'pointer' }}>✕</button>
          <span style={{ fontSize:11, color:'var(--gray-400)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop:'1px solid var(--gray-100)', padding:'12px 14px', background:'var(--gray-50)', fontSize:12 }}>
          {company.fleet_note && (
            <div style={{ background:colors.bg, border:`1px solid ${colors.bar}30`, borderRadius:6, padding:'8px 10px', marginBottom:10, color:colors.text, fontSize:11 }}>
              {company.fleet_note}
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px' }}>
            {company.address && <div><span style={{ color:'var(--gray-400)' }}>Address</span><br />{company.address}<br />{company.city}, {company.state} {company.zip}</div>}
            {company.main_phone && <div><span style={{ color:'var(--gray-400)' }}>Phone</span><br />{company.main_phone}</div>}
            {company.website && <div><span style={{ color:'var(--gray-400)' }}>Website</span><br /><a href={company.website} target="_blank" rel="noreferrer" style={{ color:'var(--blue-500)' }}>{company.website.replace(/^https?:\/\/(www\.)?/,'')}</a></div>}
            {company.contact_name && <div><span style={{ color:'var(--gray-400)' }}>Contact</span><br />{company.contact_name}{company.contact_title && <span style={{ color:'var(--gray-500)' }}> · {company.contact_title}</span>}</div>}
            {company.estimated_fleet_size && <div><span style={{ color:'var(--gray-400)' }}>Est. Fleet</span><br />{company.estimated_fleet_size} vehicles</div>}
            {company.sources_found?.length > 0 && <div><span style={{ color:'var(--gray-400)' }}>Sources</span><br />{company.sources_found.join(', ')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function FleetFinder() {
  const { showToast } = useApp();

  // Settings + budget
  const [settings,      setSettings]      = useState(null);
  const [budget,        setBudget]         = useState({ budget:50, spent:0, remaining:50 });
  const [costLog,       setCostLog]        = useState([]);
  const [activePanel,   setActivePanel]    = useState('results'); // 'results' | 'history'

  // Filters
  const [mode,          setMode]           = useState('circle');
  const [radius,        setRadius]         = useState(25);
  const [driveMinutes,  setDriveMinutes]   = useState(20);
  const [polygonCoords, setPolygonCoords]  = useState(null);
  const [allIndustries, setAllIndustries]  = useState([]);
  const [industries,    setIndustries]     = useState([]);
  const [indSearch,     setIndSearch]      = useState('');
  const [vehicleTypes,  setVehicleTypes]   = useState(Object.keys(VEHICLE_LABELS));
  const [fleetSize,     setFleetSize]      = useState('');

  // Search state
  const [estimate,      setEstimate]       = useState(null);
  const [searching,     setSearching]      = useState(false);
  const [results,       setResults]        = useState([]);
  const [searchMeta,    setSearchMeta]     = useState(null);
  const [expanded,      setExpanded]       = useState({});
  const [importing,     setImporting]      = useState({});
  const [dupModal,      setDupModal]       = useState(null);

  // Shop coords
  const [shopLat, setShopLat] = useState(35.1965);
  const [shopLng, setShopLng] = useState(-80.7812);

  // Effective radius (circle/drivetime)
  const effectiveRadius = mode === 'drivetime' ? driveTimeToMiles(driveMinutes) : radius;

  useEffect(() => {
    async function load() {
      try {
        const [s, b, cl, cfg] = await Promise.all([api.ffSettings(), api.ffBudget(), api.ffCostLog(), api.settings()]);
        setSettings(s);
        setBudget(b);
        setCostLog(cl);
        const ind = [...(s.ff_industries || []), ...(s.ff_custom_industries || [])];
        setAllIndustries(ind);
        setIndustries(ind);
        setRadius(parseFloat(s.ff_default_radius) || 25);
        const latR = cfg.find(r => r.key === 'shop_lat');
        const lngR = cfg.find(r => r.key === 'shop_lng');
        if (latR) setShopLat(parseFloat(latR.value));
        if (lngR) setShopLng(parseFloat(lngR.value));
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

  // Add industry one-time (just for this search)
  function addOneTime() {
    const name = indSearch.trim();
    if (!name) return;
    if (!allIndustries.includes(name)) setAllIndustries(p => [...p, name]);
    if (!industries.includes(name))    setIndustries(p => [...p, name]);
    setIndSearch('');
  }

  // Save industry permanently
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

  // Remove industry from list (and saved settings if custom)
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
    setSearching(true); setResults([]); setSearchMeta(null); setActivePanel('results');
    try {
      const data = await api.ffSearch({
        lat: shopLat, lng: shopLng,
        radius_miles:   effectiveRadius,
        polygon_coords: polygonCoords,
        industries, vehicle_types: vehicleTypes, fleet_size: fleetSize,
      });
      setResults(data.results || []);
      setSearchMeta(data);
      const [b, cl] = await Promise.all([api.ffBudget(), api.ffCostLog()]);
      setBudget(b); setCostLog(cl);
    } catch (e) { showToast(e.message || 'Search failed', 'error'); }
    finally { setSearching(false); }
  }

  async function handleImport(company, index) {
    setImporting(p => ({ ...p, [index]: true }));
    try {
      const { matches } = await api.ffCheckDuplicate({ name: company.name, address: company.address, phone: company.main_phone, city: company.city });
      if (matches.length > 0) { setDupModal({ company, matches, index }); return; }
      await doImport(company, 'new', null, index);
    } catch (e) { showToast(e.message || 'Import failed', 'error'); setImporting(p => ({ ...p, [index]: false })); }
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

  async function doImport(company, decision, matches, index) {
    const isMulti = decision === 'multi_location' || company.is_multi_location;
    const noteLines = [];
    if (company.fleet_note) noteLines.push(company.fleet_note);
    if (company.vehicle_types_detected?.length) noteLines.push(`Vehicle types: ${company.vehicle_types_detected.map(v => VEHICLE_LABELS[v] || v).join(', ')} (${company.vehicle_type_confidence || 'likely'})`);
    if (company.estimated_fleet_size) noteLines.push(`Est. fleet size: ${company.estimated_fleet_size} vehicles`);
    if (company.contact_title) noteLines.push(`Contact: ${company.contact_name || ''} — ${company.contact_title}`);
    if (company.sources_found?.length) noteLines.push(`Sources: ${company.sources_found.join(', ')}`);
    if (company.distance_miles != null) noteLines.push(`Distance from shop: ${company.distance_miles.toFixed(1)} mi`);
    await api.createCompany({
      name: company.name, main_phone: company.main_phone || null, industry: company.industry || null,
      address: company.address || null, city: company.city || null, state: company.state || null,
      zip: company.zip || null, website: company.website || null, notes: noteLines.join('\n') || null,
      is_multi_location: isMulti ? 1 : 0,
      location_name: isMulti ? (company.city || null) : null,
      location_group: isMulti && matches?.length ? (matches[0].location_group || matches[0].name) : (company.is_chain ? company.name : null),
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

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', overflow:'hidden', background:'#edf0f5' }}>

      {/* ── Header ── */}
      <div style={{ background:'white', borderBottom:'1px solid var(--gray-200)', padding:'10px 20px', display:'flex', alignItems:'center', gap:16, flexShrink:0, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontWeight:800, fontSize:16, color:'var(--navy-900)' }}>Find Companies</div>
          <div style={{ fontSize:11, color:'var(--gray-500)' }}>AI-powered fleet business discovery</div>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10, background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8, padding:'7px 14px' }}>
          <div>
            <div style={{ fontSize:10, color:'var(--gray-400)', marginBottom:3 }}>Monthly Budget</div>
            <div style={{ width:120, height:5, background:'var(--gray-200)', borderRadius:3 }}>
              <div style={{ width:`${budgetPct}%`, height:'100%', borderRadius:3, background:budgetColor, transition:'width .4s' }} />
            </div>
          </div>
          <div style={{ fontSize:12, fontWeight:700, color:budgetColor }}>${budget.spent.toFixed(2)} / ${budget.budget}</div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* ── Filters sidebar ── */}
        <div style={{ width:236, background:'white', borderRight:'1px solid var(--gray-200)', display:'flex', flexDirection:'column', overflow:'hidden', flexShrink:0 }}>
          <div style={{ flex:1, overflowY:'auto', padding:'12px 12px 0' }}>

            {/* Search Zone */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', fontSize:10, fontWeight:700, color:'var(--gray-400)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:6 }}>
                Search Zone <Tip text={TOOLTIPS.searchZone} />
              </div>
              <div style={{ display:'flex', gap:4, marginBottom:8 }}>
                {[['circle','⬤ Radius'],['drivetime','⏱ Drive'],['polygon','⬡ Draw']].map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)} style={{
                    flex:1, padding:'6px 0', borderRadius:6, fontSize:10, fontWeight:700, cursor:'pointer',
                    border: mode===m ? '2px solid var(--navy-700)' : '1px solid var(--gray-200)',
                    background: mode===m ? 'var(--navy-700)' : 'var(--gray-50)',
                    color: mode===m ? 'white' : 'var(--gray-600)',
                  }}>{label}</button>
                ))}
              </div>

              {mode === 'circle' && (
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:4 }}>
                    <span style={{ color:'var(--gray-500)' }}>Radius</span>
                    <span style={{ fontWeight:700 }}>{radius} mi</span>
                  </div>
                  <input type="range" min={5} max={100} value={radius} onChange={e => setRadius(parseInt(e.target.value))}
                    style={{ width:'100%', accentColor:'var(--navy-700)' }} />
                </div>
              )}

              {mode === 'drivetime' && (
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:6 }}>
                    <input type="number" min={5} max={90} value={driveMinutes}
                      onChange={e => setDriveMinutes(parseInt(e.target.value) || 20)}
                      style={{ width:60, padding:'5px 8px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:13, fontWeight:700, textAlign:'center' }} />
                    <span style={{ fontSize:12, color:'var(--gray-500)' }}>min drive ≈ {driveTimeToMiles(driveMinutes)} mi</span>
                    <Tip text={TOOLTIPS.driveTime} />
                  </div>
                  <input type="range" min={5} max={90} value={driveMinutes} onChange={e => setDriveMinutes(parseInt(e.target.value))}
                    style={{ width:'100%', accentColor:'var(--navy-700)' }} />
                </div>
              )}

              {mode === 'polygon' && (
                <div style={{ fontSize:11, color:'var(--gray-500)', background:'var(--yellow-50)', borderRadius:5, padding:'6px 8px' }}>
                  Click points on the map to draw. Double-click to close the shape.
                </div>
              )}
            </div>

            {/* Industries */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                <div style={{ display:'flex', alignItems:'center', fontSize:10, fontWeight:700, color:'var(--gray-400)', letterSpacing:'.08em', textTransform:'uppercase' }}>
                  Industries <Tip text={TOOLTIPS.industries} />
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={() => setIndustries([...allIndustries])} style={{ fontSize:9, color:'var(--blue-500)', background:'none', border:'none', cursor:'pointer', fontWeight:700 }}>All</button>
                  <button onClick={() => setIndustries([])} style={{ fontSize:9, color:'var(--gray-400)', background:'none', border:'none', cursor:'pointer' }}>None</button>
                </div>
              </div>

              {/* Industry search/add input */}
              <div style={{ marginBottom:6 }}>
                <input
                  type="text" placeholder="Search or add industry..."
                  value={indSearch} onChange={e => setIndSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addOneTime()}
                  style={{ width:'100%', padding:'5px 8px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:11 }}
                />
                {indSearchIsNew && (
                  <div style={{ display:'flex', gap:4, marginTop:4 }}>
                    <button onClick={addOneTime} style={{ flex:1, padding:'4px 0', borderRadius:5, fontSize:10, fontWeight:700, border:'1px solid var(--gold-500)', background:'var(--yellow-50)', color:'#92400e', cursor:'pointer' }}>
                      + This search only
                    </button>
                    <button onClick={saveIndustry} style={{ flex:1, padding:'4px 0', borderRadius:5, fontSize:10, fontWeight:700, border:'1px solid var(--navy-700)', background:'var(--navy-700)', color:'white', cursor:'pointer' }}>
                      + Save permanently
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:200, overflowY:'auto' }}>
                {filteredIndustries.map(ind => (
                  <div key={ind} style={{ display:'flex', alignItems:'center', gap:4 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', fontSize:11, flex:1, minWidth:0 }}>
                      <input type="checkbox" checked={industries.includes(ind)} onChange={() => toggleIndustry(ind)}
                        style={{ accentColor:'var(--navy-700)', cursor:'pointer', flexShrink:0 }} />
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{ind}</span>
                    </label>
                    <button onClick={() => removeIndustry(ind)} title="Remove from list"
                      style={{ background:'none', border:'none', color:'var(--gray-300)', cursor:'pointer', fontSize:10, padding:'0 2px', flexShrink:0, lineHeight:1 }}>✕</button>
                  </div>
                ))}
              </div>
            </div>

            {/* Vehicle types */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', fontSize:10, fontWeight:700, color:'var(--gray-400)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:6 }}>
                Vehicle Types <Tip text={TOOLTIPS.vehicleTypes} />
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                {Object.entries(VEHICLE_LABELS).map(([key, label]) => (
                  <label key={key} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:11 }}>
                    <input type="checkbox" checked={vehicleTypes.includes(key)} onChange={() => toggleVehicle(key)}
                      style={{ accentColor:'var(--navy-700)', cursor:'pointer' }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Fleet size */}
            <div style={{ marginBottom:14 }}>
              <div style={{ display:'flex', alignItems:'center', fontSize:10, fontWeight:700, color:'var(--gray-400)', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:6 }}>
                Fleet Size <Tip text={TOOLTIPS.fleetSize} />
              </div>
              <input
                type="text"
                placeholder='e.g. "5-10" or "10+"'
                value={fleetSize}
                onChange={e => setFleetSize(e.target.value)}
                style={{ width:'100%', padding:'6px 8px', border:'1px solid var(--gray-200)', borderRadius:6, fontSize:12 }}
              />
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginTop:5 }}>
                {FLEET_SIZE_EXAMPLES.map(ex => (
                  <button key={ex} onClick={() => setFleetSize(ex)} style={{
                    padding:'2px 7px', borderRadius:10, fontSize:10, cursor:'pointer', fontWeight:600,
                    border: fleetSize===ex ? '1px solid var(--navy-700)' : '1px solid var(--gray-200)',
                    background: fleetSize===ex ? 'var(--navy-700)' : 'var(--gray-50)',
                    color: fleetSize===ex ? 'white' : 'var(--gray-500)',
                  }}>{ex}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Search button */}
          <div style={{ padding:12, borderTop:'1px solid var(--gray-100)', flexShrink:0 }}>
            {estimate != null && (
              <div style={{ fontSize:11, color:'var(--gray-500)', marginBottom:6, textAlign:'center' }}>
                Est. cost: <strong>${estimate.toFixed(3)}</strong>
                {budget.remaining < estimate && <div style={{ color:'var(--red-500)', fontSize:10 }}>Exceeds remaining budget</div>}
              </div>
            )}
            <button onClick={runSearch} disabled={searching || industries.length === 0 || budget.spent >= budget.budget} style={{
              width:'100%', padding:'10px 0', borderRadius:7, border:'none',
              background: searching ? 'var(--gray-300)' : 'var(--navy-700)',
              color:'white', fontWeight:700, fontSize:13, cursor: searching ? 'not-allowed' : 'pointer',
            }}>
              {searching ? 'Searching...' : '🔍 Run Search'}
            </button>
          </div>
        </div>

        {/* ── Map + Results/History ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Map */}
          <div style={{ height:260, flexShrink:0, padding:'10px 10px 0' }}>
            <FleetFinderMap shopLat={shopLat} shopLng={shopLng} radiusMiles={effectiveRadius}
              mode={mode} onPolygonChange={setPolygonCoords} results={results} />
          </div>

          {/* Panel tabs */}
          <div style={{ display:'flex', gap:4, padding:'8px 10px 0', flexShrink:0 }}>
            {[
              { id:'results', label: results.length > 0 ? `Results (${results.length})` : 'Results' },
              { id:'history', label:`Search History${costLog.length > 0 ? ` (${costLog.length})` : ''}` },
            ].map(t => (
              <button key={t.id} onClick={() => setActivePanel(t.id)} style={{
                padding:'5px 14px', borderRadius:'6px 6px 0 0', fontSize:12, fontWeight:600, cursor:'pointer',
                border: activePanel===t.id ? '1px solid var(--gray-200)' : '1px solid transparent',
                borderBottom: activePanel===t.id ? '1px solid white' : '1px solid var(--gray-200)',
                background: activePanel===t.id ? 'white' : 'transparent',
                color: activePanel===t.id ? 'var(--navy-900)' : 'var(--gray-500)',
              }}>{t.label}</button>
            ))}
            <div style={{ flex:1, borderBottom:'1px solid var(--gray-200)' }} />
            {searchMeta && (
              <div style={{ fontSize:10, color:'var(--gray-400)', alignSelf:'flex-end', marginBottom:2, marginRight:4 }}>
                Last search: ${searchMeta.cost_usd?.toFixed(4)} · States: {searchMeta.states_searched?.join(', ')}
              </div>
            )}
          </div>

          {/* Panel content */}
          <div style={{ flex:1, overflowY:'auto', background:'white', padding:10, borderTop:'none' }}>

            {/* Results panel */}
            {activePanel === 'results' && (
              <>
                {searching && (
                  <div style={{ textAlign:'center', padding:40, color:'var(--gray-400)' }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>🔍</div>
                    <div style={{ fontWeight:700, marginBottom:4 }}>Searching across multiple sources...</div>
                    <div style={{ fontSize:11 }}>Google · FMCSA · LinkedIn · Job boards · State registries</div>
                    <div style={{ fontSize:11, marginTop:4, color:'var(--gray-300)' }}>This takes 30–90 seconds</div>
                  </div>
                )}
                {!searching && results.length === 0 && searchMeta && (
                  <div style={{ textAlign:'center', padding:40, color:'var(--gray-400)', fontSize:12 }}>No new companies found matching your filters.</div>
                )}
                {!searching && results.length === 0 && !searchMeta && (
                  <div style={{ textAlign:'center', padding:40, color:'var(--gray-400)' }}>
                    <div style={{ fontSize:13, marginBottom:4 }}>Set your filters and hit Run Search</div>
                    <div style={{ fontSize:11 }}>Results sorted by fleet probability — highest first</div>
                  </div>
                )}
                {results.map((co, i) => (
                  <ResultCard key={`${co.name}-${i}`} company={co} expanded={!!expanded[i]}
                    onToggle={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}
                    onImport={() => handleImport(co, i)}
                    onDismiss={() => handleDismiss(co, i)}
                    importing={!!importing[i]} />
                ))}
              </>
            )}

            {/* History panel */}
            {activePanel === 'history' && (
              <div>
                {costLog.length === 0 ? (
                  <div style={{ textAlign:'center', padding:40, color:'var(--gray-400)', fontSize:12 }}>No searches run yet.</div>
                ) : (
                  <table style={{ width:'100%', fontSize:12, borderCollapse:'collapse' }}>
                    <thead>
                      <tr style={{ color:'var(--gray-400)', fontSize:11 }}>
                        <th style={{ textAlign:'left', padding:'4px 8px 8px 0', borderBottom:'1px solid var(--gray-200)' }}>Date</th>
                        <th style={{ textAlign:'left', padding:'4px 8px 8px', borderBottom:'1px solid var(--gray-200)' }}>Industries</th>
                        <th style={{ textAlign:'right', padding:'4px 8px 8px', borderBottom:'1px solid var(--gray-200)' }}>Radius</th>
                        <th style={{ textAlign:'right', padding:'4px 8px 8px', borderBottom:'1px solid var(--gray-200)' }}>Results</th>
                        <th style={{ textAlign:'right', padding:'4px 0 8px 8px', borderBottom:'1px solid var(--gray-200)' }}>Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costLog.map(r => (
                        <tr key={r.id} style={{ borderBottom:'1px solid var(--gray-100)' }}>
                          <td style={{ padding:'8px 8px 8px 0', color:'var(--gray-500)', whiteSpace:'nowrap' }}>{new Date(r.ran_at).toLocaleDateString()}</td>
                          <td style={{ padding:'8px', color:'var(--gray-700)', maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.search_label || '—'}</td>
                          <td style={{ padding:'8px', textAlign:'right', color:'var(--gray-500)' }}>{r.radius_miles}mi</td>
                          <td style={{ padding:'8px', textAlign:'right' }}>{r.result_count}</td>
                          <td style={{ padding:'8px 0 8px 8px', textAlign:'right', fontWeight:700, color:'var(--gray-700)' }}>${r.cost_usd?.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} style={{ padding:'8px 0', fontSize:11, color:'var(--gray-400)', fontWeight:600 }}>Total spent this month</td>
                        <td style={{ padding:'8px 0', textAlign:'right', fontWeight:800, color:'var(--navy-900)' }}>${budget.spent.toFixed(4)}</td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </div>
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
    </div>
  );
}
