import { useState, useEffect, useRef } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';
import CompanyPanel from '../components/CompanyPanel.jsx';

function getPriority(company) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (!company.last_contacted && !company.followup_due) return 'none';
  if (company.followup_due) {
    const due = new Date(company.followup_due + 'T00:00:00');
    if (due <= today) return 'hot';
    if ((due - today) / 86400000 <= 7) return 'warm';
  }
  if (company.last_contacted) {
    const daysSince = (today - new Date(company.last_contacted)) / 86400000;
    if (daysSince > 30) return 'warm';
  }
  return 'good';
}

const PRIORITY = {
  hot:  { color:'#ef4444', label:'Drop In',    bg:'#fef2f2', border:'#fca5a5', dot:'🔴' },
  warm: { color:'#f59e0b', label:'Due Soon',   bg:'#fffbeb', border:'#fde68a', dot:'🟡' },
  good: { color:'#22c55e', label:'Recent',     bg:'#f0fdf4', border:'#86efac', dot:'🟢' },
  none: { color:'#94a3b8', label:'No Contact', bg:'#f8fafc', border:'#e2e8f0', dot:'⚪' },
};

function distMiles(a, b) {
  if (!a || !b || !a.lat || !b.lat) return 9999;
  const R=3958.8, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

async function geocodeAddress(address) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`,
      { headers:{'Accept-Language':'en','User-Agent':'SuperEagleFleetCRM/1.0'} }
    );
    const d = await r.json();
    if (d.length > 0) return { lat:parseFloat(d[0].lat), lng:parseFloat(d[0].lon), ok:true };
  } catch(_) {}
  return { lat:null, lng:null, ok:false };
}

function NearbyMap({ companies, myPos, selectedId, onSelect, radius }) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersRef = useRef([]);
  const myMarkerRef = useRef(null);
  const circleRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    import('leaflet').then(L => {
      L = L.default || L;
      if (mapInstanceRef.current) return;
      const center = myPos ? [myPos.lat, myPos.lng] : [35.2271, -80.8431];
      const map = L.map(mapRef.current).setView(center, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{ attribution:'© OpenStreetMap' }).addTo(map);
      mapInstanceRef.current = map;
    });
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
  }, []);

  useEffect(() => {
    if (!mapInstanceRef.current) return;
    import('leaflet').then(L => {
      L = L.default || L;
      markersRef.current.forEach(m => m.remove()); markersRef.current = [];
      if (myMarkerRef.current) { myMarkerRef.current.remove(); myMarkerRef.current = null; }
      if (circleRef.current)   { circleRef.current.remove();   circleRef.current = null; }

      if (myPos) {
        const myIcon = L.divIcon({
          html:`<div style="width:16px;height:16px;border-radius:50%;background:#1e40af;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
          className:'', iconAnchor:[8,8],
        });
        myMarkerRef.current = L.marker([myPos.lat,myPos.lng],{icon:myIcon}).addTo(mapInstanceRef.current).bindPopup('<b>📍 Your Location</b>');
        circleRef.current = L.circle([myPos.lat,myPos.lng],{
          radius: radius*1609.34, color:'#1e40af', fillColor:'#1e40af', fillOpacity:0.05, weight:1, dashArray:'6',
        }).addTo(mapInstanceRef.current);
      }

      companies.filter(c=>c.lat&&c.lng).forEach(c => {
        const p = PRIORITY[c.priority];
        const isSel = c.id === selectedId;
        const size = isSel ? 20 : 13;
        const icon = L.divIcon({
          html:`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${p.color};border:${isSel?3:2}px solid white;box-shadow:0 2px 6px rgba(0,0,0,${isSel?.5:.3});transition:all .15s"></div>`,
          className:'', iconAnchor:[size/2,size/2],
        });
        const miles = myPos ? distMiles(myPos,c).toFixed(1) : '?';
        const marker = L.marker([c.lat,c.lng],{icon})
          .addTo(mapInstanceRef.current)
          .bindPopup(`<div style="min-width:160px;font-family:system-ui"><div style="font-weight:700;font-size:13px">${c.name}</div><div style="font-size:11px;color:#64748b;margin-top:2px">${c.address||''}${c.city?', '+c.city:''}</div><div style="font-size:11px;margin-top:4px">${p.dot} ${p.label} · ${miles} mi</div></div>`)
          .on('click', () => onSelect(c));
        markersRef.current.push(marker);
      });
    });
  }, [companies, selectedId, myPos, radius]);

  return <div ref={mapRef} style={{width:'100%',height:480,borderRadius:0}} />;
}

export default function Nearby({ embedded = false }) {
  const [companies, setCompanies]   = useState([]);
  const [mapped, setMapped]         = useState([]);
  const [myPos, setMyPos]           = useState(null);
  const [geocoding, setGeocoding]   = useState(false);
  const [geocodedCount, setGeocodedCount] = useState(0);
  const [filter, setFilter]         = useState('all');
  const [radius, setRadius]         = useState(10);
  const [radiusInput, setRadiusInput] = useState('10');
  const [locationMode, setLocationMode] = useState('gps'); // 'gps' | 'address'
  const [customAddr, setCustomAddr] = useState('');
  const [customAddrPos, setCustomAddrPos] = useState(null);
  const [loading, setLoading]       = useState(true);
  const [locError, setLocError]     = useState('');
  const [selected, setSelected]     = useState(null);  // company info panel
  const [panelMode, setPanelMode]   = useState(null);  // null | 'log' | 'route'
  const [saving, setSaving]         = useState(false);
  const [contactTypes, setContactTypes] = useState({});
  const [companyHistory, setCompanyHistory] = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const { showToast, refreshCounts } = useApp();

  const activePos = locationMode === 'address' && customAddrPos ? customAddrPos : myPos;

  useEffect(() => {
    Promise.all([api.nearbyData(), api.contactTypes()])
      .then(([data, ct]) => { setCompanies(data); setContactTypes(ct || {}); })
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) { setMyPos({lat:35.2271,lng:-80.8431}); return; }
    navigator.geolocation.getCurrentPosition(
      pos => setMyPos({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      ()  => { setLocError('Location denied — using Charlotte center.'); setMyPos({lat:35.2271,lng:-80.8431}); },
      {timeout:8000}
    );
  }, []);

  async function lookupCustomAddr() {
    if (!customAddr.trim()) return;
    const geo = await geocodeAddress(customAddr);
    if (geo.ok) { setCustomAddrPos({lat:geo.lat,lng:geo.lng}); setLocError(''); }
    else setLocError('Address not found — try a more specific address.');
  }

  useEffect(() => {
    if (companies.length === 0) return;
    let cancelled = false;
    (async () => {
      setGeocoding(true);
      const results = [];
      let count = 0;
      for (const c of companies) {
        if (cancelled) break;
        if (c.lat && c.lng) {
          results.push({...c, geoOk:true, priority:getPriority(c)});
          count++; if (!cancelled) setGeocodedCount(count);
          continue;
        }
        if (!c.address) { results.push({...c,lat:null,lng:null,geoOk:false,priority:getPriority(c)}); continue; }
        await new Promise(r=>setTimeout(r,320));
        const geo = await geocodeAddress(`${c.address}, ${c.city||'Charlotte'}, ${c.state||'NC'}`);
        if (geo.ok) api.geocodeCompany(c.id,{lat:geo.lat,lng:geo.lng}).catch(()=>{});
        results.push({...c,lat:geo.lat,lng:geo.lng,geoOk:geo.ok,priority:getPriority(c)});
        count++; if (!cancelled) setGeocodedCount(count);
      }
      if (!cancelled) { setMapped(results); setGeocoding(false); }
    })();
    return ()=>{ cancelled=true; };
  }, [companies]);

  // Load history when a company is selected
  useEffect(() => {
    if (!selected) { setCompanyHistory([]); return; }
    setHistLoading(true);
    api.companyHistory(selected.id)
      .then(h => setCompanyHistory(h || []))
      .catch(()=>setCompanyHistory([]))
      .finally(()=>setHistLoading(false));
  }, [selected?.id]);

  // For the list: show all companies within radius (even if not geocoded yet)
  // For the map: only geoOk companies show as dots (handled in NearbyMap)
  const filtered = mapped.filter(c => {
    if (filter !== 'all' && c.priority !== filter) return false;
    // Distance filter only applies when we have coordinates
    if (c.geoOk && activePos && distMiles(activePos,c) > radius) return false;
    // If not geocoded and radius is small, still show (can't place on map but show in list)
    return true;
  }).sort((a,b)=>{
    const o={hot:0,warm:1,good:2,none:3};
    if (o[a.priority]!==o[b.priority]) return o[a.priority]-o[b.priority];
    if (a.geoOk && b.geoOk && activePos) return distMiles(activePos,a)-distMiles(activePos,b);
    return 0;
  });

  const counts = {
    all:  mapped.length,
    hot:  mapped.filter(c=>c.priority==='hot').length,
    warm: mapped.filter(c=>c.priority==='warm').length,
    good: mapped.filter(c=>c.priority==='good').length,
    none: mapped.filter(c=>c.priority==='none').length,
  };

  const CATEGORY_ICONS = {call:'📞',mail:'✉️',email:'📧',visit:'📍',move:'➡️'};

  async function handleComplete(form) {
    setSaving(true);
    try {
      const visitQueue = await api.visits();
      const visitEntry = visitQueue.find(v=>v.entity_id===selected.id);
      if (visitEntry) {
        await api.completeVisit(visitEntry.id, form);
        showToast(`✅ Visit logged for ${selected.name}`);
      } else {
        await api.addToCompanyQueue(selected.id);
        const queue = await api.companyQueue();
        const entry = queue.find(q=>q.entity_id===selected.id);
        if (entry) {
          await api.completeCompanyCall(entry.id, form);
          showToast(`✅ Call logged for ${selected.name}`);
        }
      }
      setSelected(null); setPanelMode(null);
      const fresh = await api.nearbyData();
      setCompanies(fresh);
      await refreshCounts();
    } catch(e) { showToast(e.message,'error'); }
    finally { setSaving(false); }
  }

  async function handleAddToRoute() {
    if (!selected) return;
    try {
      await api.addToCompanyQueue(selected.id);
      showToast(`✅ ${selected.name} added to route`);
      setPanelMode(null);
    } catch(e) { showToast(e.message,'error'); }
  }

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <>
      {!embedded && (
        <div className="page-header">
          <div>
            <div className="page-title">📍 Nearby</div>
            <div className="page-subtitle">
              {geocoding ? `Locating… ${geocodedCount}/${companies.filter(c=>c.address).length}` : `${filtered.length} companies within ${radius} mi`}
            </div>
          </div>
        </div>
      )}

      <div className="page-body" style={{display:'flex',flexDirection:'column',gap:14}}>
        {locError && (
          <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#92400e'}}>⚠️ {locError}</div>
        )}

        {/* Controls row */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          {/* Filter pills */}
          {[{key:'all',label:'All'},{key:'hot',label:'🔴 Drop In'},{key:'warm',label:'🟡 Due Soon'},{key:'good',label:'🟢 Recent'},{key:'none',label:'⚪ No Contact'}].map(f=>(
            <button key={f.key} onClick={()=>setFilter(f.key)} style={{
              padding:'6px 14px',borderRadius:20,cursor:'pointer',fontSize:13,fontWeight:600,
              border:`1.5px solid ${filter===f.key?'var(--navy-700)':'var(--gray-200)'}`,
              background:filter===f.key?'var(--navy-800)':'white',
              color:filter===f.key?'white':'var(--gray-700)',
              display:'flex',gap:6,alignItems:'center',
            }}>
              {f.label}
              <span style={{background:filter===f.key?'rgba(255,255,255,.2)':'var(--gray-100)',borderRadius:10,padding:'1px 7px',fontSize:11}}>{counts[f.key]}</span>
            </button>
          ))}

          {/* Radius + location */}
          <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
            {/* Quick radius buttons */}
            {[1,5,10,25].map(r=>(
              <button key={r} className={`btn btn-sm ${radius===r?'btn-navy':'btn-ghost'}`}
                style={{border:'1px solid var(--gray-200)',minWidth:36,padding:'4px 8px'}}
                onClick={()=>{setRadius(r);setRadiusInput(String(r));}}>
                {r}mi
              </button>
            ))}
            {/* Custom radius input */}
            <div style={{display:'flex',alignItems:'center',gap:4}}>
              <input type="number" min="0.01" max="500" step="0.01"
                value={radiusInput}
                onChange={e=>setRadiusInput(e.target.value)}
                onBlur={()=>{const v=parseFloat(radiusInput);if(v>=0.01)setRadius(v);}}
                onKeyDown={e=>{if(e.key==='Enter'){const v=parseFloat(radiusInput);if(v>=0.01)setRadius(v);}}}
                style={{width:70,padding:'4px 8px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:13,textAlign:'center'}}
                placeholder="mi"
              />
              <span style={{fontSize:12,color:'var(--gray-400)'}}>mi</span>
            </div>
          </div>
        </div>

        {/* Location mode */}
        <div style={{display:'flex',gap:8,alignItems:'center',background:'var(--gray-50)',borderRadius:8,padding:'8px 12px',flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:700,color:'var(--gray-500)'}}>Center on:</span>
          <button className={`btn btn-sm ${locationMode==='gps'?'btn-navy':'btn-ghost'}`}
            style={{border:'1px solid var(--gray-200)'}}
            onClick={()=>setLocationMode('gps')}>
            📍 My Location
          </button>
          <button className={`btn btn-sm ${locationMode==='address'?'btn-navy':'btn-ghost'}`}
            style={{border:'1px solid var(--gray-200)'}}
            onClick={()=>setLocationMode('address')}>
            🏠 Specific Address
          </button>
          {locationMode==='address' && (
            <>
              <input className="form-input" style={{width:280,margin:0,fontSize:13}}
                placeholder="123 Main St, Charlotte NC…"
                value={customAddr}
                onChange={e=>setCustomAddr(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&lookupCustomAddr()}
              />
              <button className="btn btn-sm btn-primary" onClick={lookupCustomAddr}>Go</button>
              {customAddrPos && <span style={{fontSize:11,color:'#15803d'}}>✓ Located</span>}
            </>
          )}
        </div>

        {/* Map + List */}
        <div style={{display:'grid',gridTemplateColumns:selected?'1fr 420px':'1fr 340px',gap:14,alignItems:'flex-start',transition:'all .2s'}}>

          {/* Map */}
          <div className="table-card" style={{overflow:'hidden',padding:0}}>
            <div className="table-card-header" style={{padding:'12px 16px'}}>
              <span>🗺️</span>
              <span className="table-card-title">Area Map</span>
              {geocoding && <span style={{marginLeft:'auto',fontSize:11,color:'var(--gray-400)'}}>Locating {geocodedCount}/{companies.filter(c=>c.address).length}…</span>}
            </div>
            <NearbyMap companies={filtered} myPos={activePos} selectedId={selected?.id} onSelect={c=>{ setSelected(prev=>prev?.id===c.id?null:c); setPanelMode(null); }} radius={radius} />
          </div>

          {/* Right panel: list OR selected company info */}
          {!selected ? (
            <div className="table-card" style={{padding:0,maxHeight:560,overflowY:'auto'}}>
              <div style={{padding:'12px 16px',borderBottom:'1px solid var(--gray-100)',fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:'var(--gray-400)'}}>
                {filtered.length} Companies — click to view
              </div>
              {filtered.length===0 ? (
                <div className="empty-state" style={{padding:40}}>
                  <div className="icon">📭</div>
                  <div className="title">None in range</div>
                  <div className="desc">Try a wider radius or different filter</div>
                </div>
              ) : filtered.map(c=>{
                const p=PRIORITY[c.priority];
                const miles=activePos?distMiles(activePos,c).toFixed(1):null;
                return (
                  <div key={c.id} style={{padding:'12px 16px',borderBottom:'1px solid var(--gray-100)',cursor:'pointer',transition:'background .08s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                    onMouseLeave={e=>e.currentTarget.style.background='white'}
                    onClick={()=>{setSelected(c);setPanelMode(null);}}>
                    <div style={{fontWeight:700,fontSize:13}}>{c.name}</div>
                    <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>
                      {c.address?`${c.address}${c.city?', '+c.city:''}`:'No address'}
                      {miles&&<span style={{marginLeft:4,color:'var(--navy-700)',fontWeight:600}}>· {miles}mi</span>}
                    </div>
                    <div style={{display:'flex',gap:5,marginTop:5}}>
                      <span style={{padding:'2px 8px',borderRadius:10,fontSize:10,fontWeight:700,background:p.bg,color:p.color,border:`1px solid ${p.border}`}}>{p.dot} {p.label}</span>
                    </div>
                    {c.last_contact_type&&<div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>Last: <strong>{c.last_contact_type}</strong></div>}
                    {c.followup_due&&<div style={{fontSize:11,color:'#f59e0b',marginTop:2}}>Follow-up: {fmtDate(c.followup_due)}</div>}
                  </div>
                );
              })}
            </div>
          ) : (
            /* Company info panel with action options */
            <div className="table-card" style={{padding:0,overflow:'hidden'}}>
              {/* Panel header */}
              <div style={{background:'var(--navy-950)',padding:'16px 18px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:800,color:'white'}}>{selected.name}</div>
                    <div style={{fontSize:13,color:'var(--gold-400)',marginTop:3,fontFamily:'var(--font-mono)'}}>{fmtPhone(selected.main_phone)}</div>
                    {selected.address&&<div style={{fontSize:11,color:'rgba(255,255,255,.35)',marginTop:4}}>📍 {selected.address}{selected.city?', '+selected.city:''}</div>}
                    {activePos&&selected.geoOk&&<div style={{fontSize:11,color:'rgba(255,255,255,.5)',marginTop:3}}>📏 {distMiles(activePos,selected).toFixed(1)} mi away</div>}
                  </div>
                  <button onClick={()=>{setSelected(null);setPanelMode(null);}}
                    style={{background:'rgba(255,255,255,.1)',border:'none',borderRadius:6,color:'white',cursor:'pointer',fontSize:16,width:28,height:28,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
                </div>
                <div style={{display:'flex',gap:6,marginTop:10}}>
                  <span style={{fontSize:10,padding:'3px 8px',borderRadius:4,background:`${PRIORITY[selected.priority]?.color}22`,color:PRIORITY[selected.priority]?.color,border:`1px solid ${PRIORITY[selected.priority]?.color}44`,fontWeight:700}}>
                    {PRIORITY[selected.priority]?.dot} {PRIORITY[selected.priority]?.label}
                  </span>
                  {selected.industry&&<span style={{fontSize:10,padding:'3px 8px',borderRadius:4,background:'rgba(255,255,255,.08)',color:'rgba(255,255,255,.5)'}}>
                    {selected.industry}
                  </span>}
                </div>
              </div>

              {/* Action buttons */}
              {panelMode===null && (
                <div style={{padding:'14px 16px',display:'flex',flexDirection:'column',gap:8,borderBottom:'1px solid var(--gray-100)'}}>
                  <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--gray-400)',marginBottom:4}}>What do you want to do?</div>
                  <button className="btn btn-primary" onClick={()=>setPanelMode('log')}>📞 Log a Call / Visit</button>
                  <button className="btn btn-ghost" style={{border:'1px solid var(--gray-200)'}} onClick={handleAddToRoute}>📋 Add to Visit Queue</button>
                </div>
              )}

              {/* History */}
              <div style={{maxHeight:320,overflowY:'auto'}}>
                <div style={{padding:'10px 16px 6px',fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.08em',color:'var(--gray-400)'}}>
                  History {companyHistory.length>0?`(${companyHistory.length})`:''}
                </div>
                {histLoading ? (
                  <div style={{padding:'12px 16px',fontSize:12,color:'var(--gray-400)'}}>Loading…</div>
                ) : companyHistory.length===0 ? (
                  <div style={{padding:'12px 16px',fontSize:12,color:'var(--gray-400)'}}>No activity yet.</div>
                ) : companyHistory.map(h=>{
                  const cat = h.log_category||'call';
                  const icon = CATEGORY_ICONS[cat]||'📞';
                  return (
                    <div key={h.id} style={{padding:'8px 16px',borderBottom:'1px solid var(--gray-100)'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                        <span style={{fontWeight:700,fontSize:12,display:'flex',gap:6,alignItems:'center'}}>
                          <span>{icon}</span> {h.contact_type||h.mail_piece||h.log_category}
                        </span>
                        <span style={{fontSize:10,color:'var(--gray-400)'}}>{fmtDate(h.logged_at)}</span>
                      </div>
                      {h.contact_name&&<div style={{fontSize:11,color:'var(--gray-500)',marginTop:1}}>with {h.contact_name}</div>}
                      {h.notes&&<div style={{fontSize:11,color:'var(--gray-600)',marginTop:2,lineHeight:1.5}}>{h.notes}</div>}
                      {h.next_action&&<div style={{fontSize:10,color:'var(--gray-400)',marginTop:2}}>Next: {h.next_action}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full log panel - only opens when user clicks "Log a Call" */}
      {selected && panelMode==='log' && (
        <CompanyPanel
          key={selected.id}
          row={{...selected,entity_id:selected.id,company_name:selected.name}}
          sourceType="company"
          contactTypes={contactTypes?.all||[]}
          onComplete={handleComplete}
          onClose={()=>setPanelMode(null)}
          saving={saving}
        />
      )}
    </>
  );
}
