import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

// ── Vehicle type display helpers ─────────────────────────────────────────────
const VEHICLE_LABELS = {
  passenger:   'Passenger / Sedan',
  light_duty:  'Light Duty (F-150 thru F-350)',
  cargo_van:   'Cargo / Sprinter Van',
  medium_duty: 'Medium Duty (F-450+)',
  heavy_duty:  'Heavy Duty Diesel (F-750+)',
  diesel:      'Diesel (any class)',
};

const FLEET_SIZE_OPTIONS = [
  { value: 'any',   label: 'Any size' },
  { value: 'small', label: '2–5 vehicles' },
  { value: 'mid',   label: '6–15 vehicles' },
  { value: 'large', label: '16+ vehicles' },
];

const PROB_COLOR = (p) => {
  if (p >= 75) return { bar: '#16a34a', bg: '#f0fdf4', text: '#15803d' };
  if (p >= 50) return { bar: '#d97706', bg: '#fffbeb', text: '#92400e' };
  return         { bar: '#ef4444', bg: '#fef2f2', text: '#b91c1c' };
};

// ── Leaflet map with circle radius + polygon drawing ─────────────────────────
function FleetFinderMap({ shopLat, shopLng, radiusMiles, mode, onPolygonChange, results }) {
  const mapRef      = useRef(null);
  const leafletRef  = useRef(null);
  const circleRef   = useRef(null);
  const drawnLayersRef = useRef(null);
  const resultMarkersRef = useRef([]);

  useEffect(() => {
    if (!mapRef.current) return;

    // Load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id   = 'leaflet-css';
      link.rel  = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }

    function initMap(L) {
      if (leafletRef.current) return;
      const map = L.map(mapRef.current, { zoomControl: true }).setView([shopLat, shopLng], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);

      // Shop marker
      const shopIcon = L.divIcon({
        html: '<div style="background:#1a3358;color:#fbbf24;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:14px;border:2px solid #fbbf24;box-shadow:0 2px 6px rgba(0,0,0,.4)">🔧</div>',
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      });
      L.marker([shopLat, shopLng], { icon: shopIcon }).addTo(map).bindPopup('Your Shop');

      leafletRef.current = map;

      // Draw initial circle
      const radiusM = radiusMiles * 1609.34;
      circleRef.current = L.circle([shopLat, shopLng], {
        radius: radiusM, color: '#2d5690', fillColor: '#2d5690', fillOpacity: 0.08, weight: 2,
      }).addTo(map);

      // Drawn layers group for polygon mode
      const drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
      drawnLayersRef.current = drawnItems;

      // Load leaflet-draw for polygon mode
      if (!document.getElementById('leaflet-draw-css')) {
        const dcss = document.createElement('link');
        dcss.id   = 'leaflet-draw-css';
        dcss.rel  = 'stylesheet';
        dcss.href = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css';
        document.head.appendChild(dcss);
      }
    }

    if (window.L) {
      initMap(window.L);
    } else {
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => initMap(window.L);
      document.head.appendChild(script);
    }

    return () => {};
  }, [shopLat, shopLng]);

  // Update circle when radius changes
  useEffect(() => {
    if (!leafletRef.current || !circleRef.current || !window.L) return;
    if (mode === 'circle') {
      circleRef.current.setRadius(radiusMiles * 1609.34);
      circleRef.current.setStyle({ opacity: 1, fillOpacity: 0.08 });
    } else {
      circleRef.current.setStyle({ opacity: 0, fillOpacity: 0 });
    }
  }, [radiusMiles, mode]);

  // Polygon draw mode
  useEffect(() => {
    if (!leafletRef.current || !window.L || mode !== 'polygon') return;

    function loadAndActivate() {
      if (!window.L.Draw) {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js';
        script.onload = activateDraw;
        document.head.appendChild(script);
      } else {
        activateDraw();
      }
    }

    function activateDraw() {
      const L = window.L;
      const map = leafletRef.current;
      if (drawnLayersRef.current) drawnLayersRef.current.clearLayers();

      const drawControl = new L.Draw.Polygon(map, {
        shapeOptions: { color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.12, weight: 2 },
        showArea: true,
        metric: false,
      });
      drawControl.enable();

      map.once(L.Draw.Event.CREATED, (e) => {
        drawnLayersRef.current.addLayer(e.layer);
        const coords = e.layer.getLatLngs()[0].map(ll => [ll.lat, ll.lng]);
        if (onPolygonChange) onPolygonChange(coords);
      });
    }

    loadAndActivate();
  }, [mode]);

  // Clear polygon when switching back to circle
  useEffect(() => {
    if (mode === 'circle' && drawnLayersRef.current) {
      drawnLayersRef.current.clearLayers();
      if (onPolygonChange) onPolygonChange(null);
    }
  }, [mode]);

  // Plot result markers
  useEffect(() => {
    const L = window.L;
    const map = leafletRef.current;
    if (!L || !map) return;

    // Clear old markers
    resultMarkersRef.current.forEach(m => map.removeLayer(m));
    resultMarkersRef.current = [];

    results.forEach(co => {
      if (!co._lat || !co._lng) return;
      const prob = co.fleet_probability || 0;
      const c = prob >= 75 ? '#16a34a' : prob >= 50 ? '#d97706' : '#ef4444';
      const icon = L.divIcon({
        html: `<div style="background:${c};color:white;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35)">${prob}</div>`,
        className: '', iconSize: [20, 20], iconAnchor: [10, 10],
      });
      const marker = L.marker([co._lat, co._lng], { icon })
        .addTo(map)
        .bindPopup(`<b>${co.name}</b><br>${co.city}, ${co.state}<br>${prob}% fleet probability`);
      resultMarkersRef.current.push(marker);
    });
  }, [results]);

  return (
    <div ref={mapRef} style={{ width: '100%', height: '100%', borderRadius: 6 }} />
  );
}

// ── Duplicate check modal ─────────────────────────────────────────────────────
function DuplicateModal({ company, matches, onDecision, onCancel }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'white', borderRadius: 10, padding: 24, maxWidth: 520, width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,.3)',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Possible Match Found</div>
        <div style={{ fontSize: 12, color: 'var(--gray-500)', marginBottom: 16 }}>
          We found a similar company already in your CRM. How should we handle this?
        </div>

        <div style={{ background: 'var(--blue-50)', border: '1px solid var(--blue-100)', borderRadius: 7, padding: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 2 }}>Importing</div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{company.name}</div>
          <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>{company.address}, {company.city}, {company.state}</div>
        </div>

        {matches.map(m => (
          <div key={m.id} style={{
            background: 'var(--yellow-50)', border: '1px solid var(--yellow-100)',
            borderRadius: 7, padding: 12, marginBottom: 12,
          }}>
            <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 2 }}>
              Existing CRM record — {m.match_score}% match
            </div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{m.name}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>
              {m.address}, {m.city}, {m.state}
              {m.is_multi_location ? ' · Multi-location' : ''}
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button onClick={() => onDecision('duplicate')} style={{
            padding: '10px 16px', borderRadius: 7, border: '1px solid var(--gray-200)',
            background: 'var(--gray-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ color: 'var(--red-500)' }}>✕</span> Same company, same location — skip import
          </button>
          <button onClick={() => onDecision('multi_location')} style={{
            padding: '10px 16px', borderRadius: 7, border: '1px solid var(--blue-100)',
            background: 'var(--blue-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ color: 'var(--blue-500)' }}>⊕</span> Different location of same chain — import & group as multi-location
          </button>
          <button onClick={() => onDecision('new')} style={{
            padding: '10px 16px', borderRadius: 7, border: '1px solid var(--green-100)',
            background: 'var(--green-50)', fontSize: 13, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          }}>
            <span style={{ color: 'var(--green-600)' }}>+</span> Different company entirely — import as new
          </button>
        </div>

        <button onClick={onCancel} style={{
          marginTop: 12, width: '100%', padding: '8px', borderRadius: 7,
          border: '1px solid var(--gray-200)', background: 'white', fontSize: 12,
          color: 'var(--gray-500)', cursor: 'pointer',
        }}>Cancel</button>
      </div>
    </div>
  );
}

// ── Result card ───────────────────────────────────────────────────────────────
function ResultCard({ company, expanded, onToggle, onImport, onDismiss, importing }) {
  const prob   = company.fleet_probability || 0;
  const colors = PROB_COLOR(prob);
  const vtypes = (company.vehicle_types_detected || [])
    .map(v => VEHICLE_LABELS[v] || v).join(', ') || null;

  return (
    <div style={{
      background: 'white', borderRadius: 8, border: '1px solid var(--gray-200)',
      marginBottom: 8, overflow: 'hidden',
    }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {/* Probability badge */}
        <div style={{
          minWidth: 42, height: 42, borderRadius: 8, background: colors.bg,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: colors.text }}>{prob}%</div>
          <div style={{ width: 30, height: 3, borderRadius: 2, background: 'var(--gray-200)', marginTop: 2 }}>
            <div style={{ width: `${prob}%`, height: '100%', borderRadius: 2, background: colors.bar }} />
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {company.name}
            {company.is_chain && <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#3730a3', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>CHAIN</span>}
          </div>
          <div style={{ fontSize: 11, color: 'var(--gray-500)', marginTop: 1 }}>
            {company.industry}
            {company.distance_miles != null && ` · ${company.distance_miles.toFixed(1)} mi`}
            {company.city && ` · ${company.city}, ${company.state}`}
          </div>
          {vtypes && (
            <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 1 }}>
              {vtypes}
              {company.vehicle_type_confidence && company.vehicle_type_confidence !== 'unknown' &&
                <span style={{ marginLeft: 4, color: company.vehicle_type_confidence === 'confirmed' ? 'var(--green-600)' : 'var(--yellow-500)' }}>
                  ({company.vehicle_type_confidence})
                </span>
              }
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onImport(); }}
            disabled={importing}
            style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700,
              border: 'none', background: 'var(--navy-700)', color: 'white', cursor: 'pointer',
            }}
          >{importing ? '...' : 'Import'}</button>
          <button
            onClick={e => { e.stopPropagation(); onDismiss(); }}
            title="Never show again"
            style={{
              padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: '1px solid var(--gray-200)', background: 'var(--gray-50)',
              color: 'var(--gray-500)', cursor: 'pointer',
            }}
          >✕</button>
          <span style={{ fontSize: 11, color: 'var(--gray-400)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--gray-100)', padding: '12px 14px', background: 'var(--gray-50)',
          fontSize: 12,
        }}>
          {/* Fleet note */}
          {company.fleet_note && (
            <div style={{
              background: colors.bg, border: `1px solid ${colors.bar}30`,
              borderRadius: 6, padding: '8px 10px', marginBottom: 10, color: colors.text, fontSize: 11,
            }}>
              {company.fleet_note}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
            {company.address && (
              <div><span style={{ color: 'var(--gray-400)' }}>Address</span><br />
                {company.address}<br />{company.city}, {company.state} {company.zip}
              </div>
            )}
            {company.main_phone && (
              <div><span style={{ color: 'var(--gray-400)' }}>Phone</span><br />{company.main_phone}</div>
            )}
            {company.website && (
              <div><span style={{ color: 'var(--gray-400)' }}>Website</span><br />
                <a href={company.website} target="_blank" rel="noreferrer" style={{ color: 'var(--blue-500)' }}>
                  {company.website.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              </div>
            )}
            {company.contact_name && (
              <div><span style={{ color: 'var(--gray-400)' }}>Contact</span><br />
                {company.contact_name}
                {company.contact_title && <span style={{ color: 'var(--gray-500)' }}> · {company.contact_title}</span>}
              </div>
            )}
            {company.estimated_fleet_size && (
              <div><span style={{ color: 'var(--gray-400)' }}>Est. Fleet Size</span><br />{company.estimated_fleet_size} vehicles</div>
            )}
            {company.sources_found?.length > 0 && (
              <div><span style={{ color: 'var(--gray-400)' }}>Sources</span><br />{company.sources_found.join(', ')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Fleet Finder page ────────────────────────────────────────────────────
export default function FleetFinder() {
  const { showToast } = useApp();

  // Settings + budget
  const [settings,  setSettings]  = useState(null);
  const [budget,    setBudget]     = useState({ budget: 50, spent: 0, remaining: 50 });
  const [costLog,   setCostLog]    = useState([]);
  const [costLogOpen, setCostLogOpen] = useState(false);

  // Filters
  const [radius,      setRadius]      = useState(25);
  const [mapMode,     setMapMode]     = useState('circle');
  const [polygonCoords, setPolygonCoords] = useState(null);
  const [industries,  setIndustries]  = useState([]);
  const [allIndustries, setAllIndustries] = useState([]);
  const [vehicleTypes, setVehicleTypes] = useState([]);
  const [fleetSize,   setFleetSize]   = useState('any');

  // Search state
  const [estimate,  setEstimate]  = useState(null);
  const [searching, setSearching] = useState(false);
  const [results,   setResults]   = useState([]);
  const [searchMeta, setSearchMeta] = useState(null);
  const [expanded,  setExpanded]  = useState({});
  const [importing, setImporting] = useState({});

  // Duplicate modal
  const [dupModal, setDupModal] = useState(null);

  // Shop location
  const [shopLat, setShopLat] = useState(35.1965);
  const [shopLng, setShopLng] = useState(-80.7812);

  // Load settings + budget on mount
  useEffect(() => {
    async function load() {
      try {
        const [s, b, cl, cfg] = await Promise.all([
          api.ffSettings(),
          api.ffBudget(),
          api.ffCostLog(),
          api.settings(),
        ]);
        setSettings(s);
        setBudget(b);
        setCostLog(cl);

        const ind = s.ff_industries || [];
        const vt  = s.ff_vehicle_types || [];
        const custom = s.ff_custom_industries || [];
        setAllIndustries([...ind, ...custom]);
        setIndustries([...ind, ...custom]);
        setVehicleTypes(vt);
        setRadius(parseFloat(s.ff_default_radius) || 25);

        // Shop coords from config
        const shopLatCfg = cfg.find(r => r.key === 'shop_lat');
        const shopLngCfg = cfg.find(r => r.key === 'shop_lng');
        if (shopLatCfg) setShopLat(parseFloat(shopLatCfg.value));
        if (shopLngCfg) setShopLng(parseFloat(shopLngCfg.value));
      } catch (e) {
        showToast('Failed to load Fleet Finder settings', 'error');
      }
    }
    load();
  }, []);

  // Re-estimate when filters change
  useEffect(() => {
    if (!industries.length) { setEstimate(null); return; }
    api.ffEstimate({ industries, radius_miles: radius })
      .then(r => setEstimate(r.estimate_usd))
      .catch(() => {});
  }, [industries, radius]);

  const toggleIndustry = (ind) => {
    setIndustries(prev =>
      prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
    );
  };

  const toggleVehicle = (vt) => {
    setVehicleTypes(prev =>
      prev.includes(vt) ? prev.filter(v => v !== vt) : [...prev, vt]
    );
  };

  async function runSearch() {
    if (searching) return;
    if (budget.spent >= budget.budget) {
      showToast(`Monthly budget of $${budget.budget} reached`, 'error');
      return;
    }
    setSearching(true);
    setResults([]);
    setSearchMeta(null);
    try {
      const data = await api.ffSearch({
        lat: shopLat,
        lng: shopLng,
        radius_miles:  radius,
        polygon_coords: polygonCoords,
        industries,
        vehicle_types:  vehicleTypes,
        fleet_size:     fleetSize,
      });
      setResults(data.results || []);
      setSearchMeta(data);
      // Refresh budget
      const b = await api.ffBudget();
      setBudget(b);
      const cl = await api.ffCostLog();
      setCostLog(cl);
    } catch (e) {
      showToast(e.message || 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  }

  async function handleImport(company, index) {
    setImporting(prev => ({ ...prev, [index]: true }));
    try {
      // 1. Check for duplicates
      const { matches } = await api.ffCheckDuplicate({
        name:    company.name,
        address: company.address,
        phone:   company.main_phone,
        city:    company.city,
      });

      if (matches.length > 0) {
        setDupModal({ company, matches, index });
        return; // modal handles the rest
      }

      // No match found — import directly
      await doImport(company, 'new', null);
    } catch (e) {
      showToast(e.message || 'Import failed', 'error');
    } finally {
      setImporting(prev => ({ ...prev, [index]: false }));
    }
  }

  async function handleDupDecision(decision, company, index, matches) {
    setDupModal(null);
    setImporting(prev => ({ ...prev, [index]: true }));
    try {
      if (decision === 'duplicate') {
        showToast('Skipped — already in CRM', 'success');
        removeResult(index);
        return;
      }
      await doImport(company, decision, matches);
    } catch (e) {
      showToast(e.message || 'Import failed', 'error');
    } finally {
      setImporting(prev => ({ ...prev, [index]: false }));
    }
  }

  async function doImport(company, decision, matches) {
    const isMulti  = decision === 'multi_location' || company.is_multi_location;
    const cityName = company.city || '';
    const locationName = isMulti ? cityName : (company.location_name || cityName);
    const locationGroup = isMulti && matches?.length
      ? matches[0].location_group || matches[0].name
      : (company.is_chain ? company.name : null);

    // Build fleet note for CRM notes field
    const noteLines = [];
    if (company.fleet_note) noteLines.push(company.fleet_note);
    if (company.vehicle_types_detected?.length) {
      noteLines.push(`Vehicle types: ${company.vehicle_types_detected.map(v => VEHICLE_LABELS[v] || v).join(', ')} (${company.vehicle_type_confidence || 'likely'})`);
    }
    if (company.estimated_fleet_size) noteLines.push(`Est. fleet size: ${company.estimated_fleet_size} vehicles`);
    if (company.contact_title) noteLines.push(`Contact: ${company.contact_name || ''} — ${company.contact_title}`);
    if (company.sources_found?.length) noteLines.push(`Sources: ${company.sources_found.join(', ')}`);
    if (company.distance_miles != null) noteLines.push(`Distance from shop: ${company.distance_miles.toFixed(1)} mi`);

    const payload = {
      name:               isMulti ? company.name : company.name,
      main_phone:         company.main_phone  || null,
      industry:           company.industry    || null,
      address:            company.address     || null,
      city:               company.city        || null,
      state:              company.state       || null,
      zip:                company.zip         || null,
      website:            company.website     || null,
      notes:              noteLines.join('\n') || null,
      is_multi_location:  isMulti ? 1 : 0,
      location_name:      isMulti ? locationName : null,
      location_group:     locationGroup || null,
    };

    await api.createCompany(payload);

    // Add contact if found
    // (company creation returns the new company — we'd need the id to add contact.
    //  For now, note is embedded in notes field. Contact can be added from the company panel.)

    showToast(`${company.name} imported successfully`, 'success');
    removeResult(index);
    // Note: index param passed from caller
  }

  function removeResult(index) {
    setResults(prev => prev.filter((_, i) => i !== index));
  }

  async function handleDismiss(company, index) {
    try {
      await api.ffDismiss({
        name:    company.name,
        address: company.address,
        phone:   company.main_phone,
        city:    company.city,
        state:   company.state,
      });
      removeResult(index);
      showToast('Company hidden from future searches', 'success');
    } catch (e) {
      showToast(e.message || 'Failed to dismiss', 'error');
    }
  }

  const budgetPct = budget.budget > 0
    ? Math.min(100, Math.round((budget.spent / budget.budget) * 100))
    : 0;

  const budgetColor = budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#d97706' : '#16a34a';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#edf0f5' }}>

      {/* ── Header ── */}
      <div style={{
        background: 'white', borderBottom: '1px solid var(--gray-200)', padding: '10px 20px',
        display: 'flex', alignItems: 'center', gap: 20, flexShrink: 0,
      }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--navy-900)' }}>Find Companies</div>
          <div style={{ fontSize: 11, color: 'var(--gray-500)' }}>AI-powered fleet business discovery</div>
        </div>

        {/* Budget tracker */}
        <div style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12,
          background: 'var(--gray-50)', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '7px 14px',
        }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--gray-400)', marginBottom: 3 }}>Monthly Budget</div>
            <div style={{ width: 140, height: 5, background: 'var(--gray-200)', borderRadius: 3 }}>
              <div style={{ width: `${budgetPct}%`, height: '100%', borderRadius: 3, background: budgetColor, transition: 'width .4s' }} />
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: budgetColor }}>
            ${budget.spent.toFixed(2)} / ${budget.budget}
          </div>
          <button
            onClick={() => setCostLogOpen(o => !o)}
            style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 5,
              border: '1px solid var(--gray-200)', background: 'white', cursor: 'pointer',
              color: 'var(--gray-600)', fontWeight: 600,
            }}
          >{costLogOpen ? 'Hide Log ▲' : 'Cost Log ▼'}</button>
        </div>
      </div>

      {/* ── Cost log dropdown ── */}
      {costLogOpen && (
        <div style={{
          background: 'white', borderBottom: '1px solid var(--gray-200)',
          padding: '10px 20px', maxHeight: 180, overflowY: 'auto', flexShrink: 0,
        }}>
          {costLog.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--gray-400)' }}>No searches run yet.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--gray-400)' }}>
                  <th style={{ textAlign: 'left', padding: '2px 8px 4px 0' }}>Date</th>
                  <th style={{ textAlign: 'left', padding: '2px 8px 4px 0' }}>Search</th>
                  <th style={{ textAlign: 'right', padding: '2px 0 4px 8px' }}>Results</th>
                  <th style={{ textAlign: 'right', padding: '2px 0 4px 8px' }}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {costLog.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--gray-100)' }}>
                    <td style={{ padding: '3px 8px 3px 0', color: 'var(--gray-500)' }}>
                      {new Date(r.ran_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '3px 8px' }}>{r.search_label || '—'} · {r.radius_miles}mi</td>
                    <td style={{ padding: '3px 0 3px 8px', textAlign: 'right' }}>{r.result_count}</td>
                    <td style={{ padding: '3px 0 3px 8px', textAlign: 'right', fontWeight: 700, color: 'var(--gray-700)' }}>
                      ${r.cost_usd?.toFixed(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Body: sidebar + main ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* ── Filters sidebar ── */}
        <div style={{
          width: 230, background: 'white', borderRight: '1px solid var(--gray-200)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
        }}>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 0' }}>

            {/* Map mode */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Search Zone</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['circle', 'polygon'].map(m => (
                  <button key={m} onClick={() => setMapMode(m)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: mapMode === m ? '2px solid var(--navy-700)' : '1px solid var(--gray-200)',
                    background: mapMode === m ? 'var(--navy-700)' : 'var(--gray-50)',
                    color: mapMode === m ? 'white' : 'var(--gray-600)',
                  }}>
                    {m === 'circle' ? '⬤ Radius' : '⬡ Draw'}
                  </button>
                ))}
              </div>
              {mapMode === 'circle' && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: 'var(--gray-500)' }}>Radius</span>
                    <span style={{ fontWeight: 700 }}>{radius} mi</span>
                  </div>
                  <input type="range" min={5} max={100} value={radius}
                    onChange={e => setRadius(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--navy-700)' }} />
                </div>
              )}
              {mapMode === 'polygon' && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--gray-500)', background: 'var(--yellow-50)', borderRadius: 5, padding: '6px 8px' }}>
                  Click points on the map to draw your search area. Double-click to close the shape.
                </div>
              )}
            </div>

            {/* Industries */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', letterSpacing: '.08em', textTransform: 'uppercase' }}>Industries</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setIndustries([...allIndustries])} style={{ fontSize: 9, color: 'var(--blue-500)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>All</button>
                  <button onClick={() => setIndustries([])} style={{ fontSize: 9, color: 'var(--gray-400)', background: 'none', border: 'none', cursor: 'pointer' }}>None</button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {allIndustries.map(ind => (
                  <label key={ind} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={industries.includes(ind)} onChange={() => toggleIndustry(ind)}
                      style={{ accentColor: 'var(--navy-700)', cursor: 'pointer' }} />
                    {ind}
                  </label>
                ))}
              </div>
            </div>

            {/* Vehicle types */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Vehicle Types</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {Object.entries(VEHICLE_LABELS).map(([key, label]) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                    <input type="checkbox" checked={vehicleTypes.includes(key)} onChange={() => toggleVehicle(key)}
                      style={{ accentColor: 'var(--navy-700)', cursor: 'pointer' }} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Fleet size */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 6 }}>Fleet Size</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {FLEET_SIZE_OPTIONS.map(opt => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12 }}>
                    <input type="radio" name="fleet_size" value={opt.value} checked={fleetSize === opt.value}
                      onChange={() => setFleetSize(opt.value)}
                      style={{ accentColor: 'var(--navy-700)', cursor: 'pointer' }} />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Search button pinned to bottom */}
          <div style={{ padding: 14, borderTop: '1px solid var(--gray-100)', flexShrink: 0 }}>
            {estimate != null && (
              <div style={{ fontSize: 11, color: 'var(--gray-500)', marginBottom: 6, textAlign: 'center' }}>
                Est. cost: <strong>${estimate.toFixed(3)}</strong>
                {budget.remaining < estimate && (
                  <div style={{ color: 'var(--red-500)', fontSize: 10 }}>Exceeds remaining budget</div>
                )}
              </div>
            )}
            <button
              onClick={runSearch}
              disabled={searching || industries.length === 0 || budget.spent >= budget.budget}
              style={{
                width: '100%', padding: '10px 0', borderRadius: 7, border: 'none',
                background: searching ? 'var(--gray-300)' : 'var(--navy-700)',
                color: 'white', fontWeight: 700, fontSize: 13, cursor: searching ? 'not-allowed' : 'pointer',
              }}
            >
              {searching ? 'Searching...' : '🔍 Run Search'}
            </button>
          </div>
        </div>

        {/* ── Map + Results ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Map */}
          <div style={{ height: 280, flexShrink: 0, padding: 12, paddingBottom: 0 }}>
            <FleetFinderMap
              shopLat={shopLat}
              shopLng={shopLng}
              radiusMiles={radius}
              mode={mapMode}
              onPolygonChange={setPolygonCoords}
              results={results}
            />
          </div>

          {/* Results */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

            {/* Search meta */}
            {searchMeta && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, fontSize: 11 }}>
                <div style={{ color: 'var(--gray-600)' }}>
                  <strong>{results.length}</strong> companies found
                  {searchMeta.states_searched?.length > 1 &&
                    <span style={{ color: 'var(--gray-400)', marginLeft: 6 }}>
                      · States: {searchMeta.states_searched.join(', ')}
                    </span>
                  }
                </div>
                <div style={{ color: 'var(--gray-400)' }}>
                  Cost: ${searchMeta.cost_usd?.toFixed(4)}
                </div>
              </div>
            )}

            {searching && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Searching across multiple sources...</div>
                <div style={{ fontSize: 11 }}>Google · FMCSA · LinkedIn · Job boards · State registries</div>
                <div style={{ fontSize: 11, marginTop: 4, color: 'var(--gray-300)' }}>This takes 30–90 seconds</div>
              </div>
            )}

            {!searching && results.length === 0 && searchMeta && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                <div style={{ fontSize: 11 }}>No new companies found matching your filters in this area.</div>
              </div>
            )}

            {!searching && results.length === 0 && !searchMeta && (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray-400)' }}>
                <div style={{ fontSize: 13, marginBottom: 6 }}>Set your filters and hit Run Search</div>
                <div style={{ fontSize: 11 }}>Results are sorted by fleet probability — highest first</div>
              </div>
            )}

            {results.map((co, i) => (
              <ResultCard
                key={`${co.name}-${i}`}
                company={co}
                expanded={!!expanded[i]}
                onToggle={() => setExpanded(p => ({ ...p, [i]: !p[i] }))}
                onImport={() => handleImport(co, i)}
                onDismiss={() => handleDismiss(co, i)}
                importing={!!importing[i]}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Duplicate modal ── */}
      {dupModal && (
        <DuplicateModal
          company={dupModal.company}
          matches={dupModal.matches}
          onDecision={(decision) => handleDupDecision(decision, dupModal.company, dupModal.index, dupModal.matches)}
          onCancel={() => {
            setDupModal(null);
            setImporting(prev => ({ ...prev, [dupModal.index]: false }));
          }}
        />
      )}
    </div>
  );
}
