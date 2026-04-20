/**
 * CompanyPanel — full-screen overlay for logging a call.
 * Left: company info, contacts, full history.
 * Right: log form.
 *
 * Improvements:
 *  - Unsaved-changes confirm on close
 *  - Straight-line distance + estimated drive time shown in header
 *  - Multi-location badge shows branch count
 *  - Mail / email / visit all shown in history timeline with icons
 *  - History cap removed (shows all)
 *  - Geocodes company address on mount and stores lat/lng
 */
import { useState, useEffect, useRef } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';

const CATEGORY_ICONS = { call:'📞', mail:'✉️', email:'📧', visit:'📍', move:'➡️' };
const CATEGORY_COLORS = { call:'var(--navy-800)', mail:'#065f46', email:'#6b21a8', visit:'#92400e', move:'var(--gray-400)' };

function distMiles(a, b) {
  if (!a || !b || !a.lat || !b.lat) return null;
  const R=3958.8, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

// ── Fetch actual route distance + time from OSRM ─────────────────────────────
// Session cache — no re-fetch when reopening the same company
const _routeCache = new Map();

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic3VwZXJlYWdsZSIsImEiOiJjbW5razA0eG0wenhiMnNxNGM2N3J5Nm5rIn0.N5S0ONYavIOfHa_p3sMF7Q';

async function fetchRouteFromOSRM(from, to) {
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false&access_token=${MAPBOX_TOKEN}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (d.routes?.[0]) {
      return {
        miles: d.routes[0].distance / 1609.34,
        minutes: Math.round(d.routes[0].duration / 60),
      };
    }
  } catch(_) {}
  return null;
}

function fmtDrive(minutes) {
  if (!minutes && minutes !== 0) return null;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60 > 0 ? minutes % 60 + 'm' : ''}`.trim();
}

async function geocode(address) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=us`,
      { headers:{'Accept-Language':'en','User-Agent':'SuperEagleFleetCRM/1.0'} }
    );
    const d = await r.json();
    if (d.length > 0) return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
  } catch(_) {}
  try {
    const r = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?country=us&limit=1&access_token=${MAPBOX_TOKEN}`
    );
    const d = await r.json();
    if (d.features?.length > 0) {
      const [lng, lat] = d.features[0].center;
      return { lat, lng };
    }
  } catch(_) {}
  return null;
}

export default function CompanyPanel({ row, sourceType, contactTypes, onComplete, onClose, saving }) {
  const [data, setData]   = useState(null);
  const [busy, setBusy]   = useState(true);
  const [editingPreferred, setEditingPreferred] = useState(false);
  const [prefEdit, setPrefEdit] = useState({ name:'', role_title:'', direct_line:'', email:'' });
  const [prefSaving, setPrefSaving] = useState(false);
  const [companyStatus, setCompanyStatus] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const [dist, setDist]         = useState(null);   // straight-line miles (fallback)
  const [routeDist, setRouteDist] = useState(null); // actual route miles via OSRM
  const [routeTime, setRouteTime] = useState(null); // actual drive minutes via OSRM
  const [routeLoading, setRouteLoading] = useState(false);
  const [form, setForm]   = useState({
    contact_name: '', role_title: '',
    referral_name: '', referral_role: '', referral_phone: '', referral_email: '',
    save_referral_as_contact: false,
    set_as_preferred: false,
    contact_type: '', notes: '',
    next_action: 'Call', next_action_date_override: '', show_date_override: false,
  });
  const isDirty = useRef(false);
  const { showToast } = useApp();

  const entityId    = row.entity_id ?? row.id;
  const companyName = row.company_name ?? row.entity_name ?? row.name ?? '';
  const mainPhone   = row.main_phone ?? row.phone ?? '';

  // Get shop location from settings (preferred) then fall back to GPS
  useEffect(() => {
    api.settings().then(settingsList => {
      // settingsList is array [{key, value, label}]
      const obj = Array.isArray(settingsList)
        ? Object.fromEntries(settingsList.map(s => [s.key, s.value]))
        : settingsList;
      const lat = parseFloat(obj['shop_lat'] || obj?.shop_lat?.value);
      const lng = parseFloat(obj['shop_lng'] || obj?.shop_lng?.value);
      if (!isNaN(lat) && !isNaN(lng)) {
        setMyPos({ lat, lng, isShop: true });
        return;
      }
      // Fall back to GPS
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {}
        );
      }
    }).catch(() => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          pos => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => {}
        );
      }
    });
  }, []);

  useEffect(() => {
    setForm(f => ({
      ...f,
      contact_name: '',
      role_title: '',
    }));
    setEditingPreferred(false);
    setBusy(true);
    Promise.all([api.company(entityId), api.companyHistory(entityId)])
      .then(async ([full, hist]) => {
        setData({ full, hist, contacts: full.contacts || [], branches: full.branches || [] });
        setCompanyStatus(full.company_status || 'prospect');
        // Geocode if no stored coords
        let compLat = full.lat, compLng = full.lng;
        if ((!compLat || !compLng) && full.address) {
          const geo = await geocode(`${full.address}, ${full.city||'Charlotte'}, ${full.state||'NC'}`);
          if (geo) {
            compLat = geo.lat; compLng = geo.lng;
            api.geocodeCompany(entityId, geo).catch(()=>{});
          }
        }
        if (compLat && compLng) {
          setData(d => ({ ...d, compLat, compLng }));
        }
      })
      .catch(() => setData({ full: {}, hist: [], contacts: [], branches: [] }))
      .finally(() => setBusy(false));
  }, [row.id]);

  /// Calculate distance once we have both positions
  useEffect(() => {
    if (myPos && data?.compLat) {
      const d = distMiles(myPos, { lat: data.compLat, lng: data.compLng });
      setDist(d);
      const cacheKey = `${myPos.lat.toFixed(4)},${myPos.lng.toFixed(4)}->${data.compLat.toFixed(4)},${data.compLng.toFixed(4)}`;
      if (_routeCache.has(cacheKey)) {
        const cached = _routeCache.get(cacheKey);
        setRouteDist(cached.miles);
        setRouteTime(cached.minutes);
        return;
      }
      setRouteLoading(true);
      setRouteDist(null);
      setRouteTime(null);
      fetchRouteFromOSRM(myPos, { lat: data.compLat, lng: data.compLng })
        .then(result => {
          if (result) {
            _routeCache.set(cacheKey, result);
            setRouteDist(result.miles);
            setRouteTime(result.minutes);
          }
        })
        .finally(() => setRouteLoading(false));
    }
  }, [myPos, data?.compLat]);

  function set(f, v) {
    isDirty.current = true;
    setForm(p => ({ ...p, [f]: v }));
  }

  async function handleStatusChange(status) {
    setCompanyStatus(status);
    try { await api.updateCompanyStatus(entityId, status); }
    catch(e) { showToast(e.message, 'error'); setCompanyStatus(data?.full?.company_status || 'prospect'); }
  }

  function startEditPreferred(contact) {
    setPrefEdit({ name: contact.name || '', role_title: contact.role_title || '', direct_line: contact.direct_line || '', email: contact.email || '' });
    setEditingPreferred(true);
  }

  async function savePreferred() {
    if (!preferred) return;
    setPrefSaving(true);
    try {
      await api.updateContact(preferred.id, { ...prefEdit, is_preferred: true });
      // refresh data
      const [full, hist] = await Promise.all([api.company(entityId), api.companyHistory(entityId)]);
      setData(d => ({ ...d, full, hist, contacts: full.contacts || [] }));
      setEditingPreferred(false);
      showToast('✅ Contact updated');
    } catch(e) {
      showToast(e.message, 'error');
    } finally {
      setPrefSaving(false);
    }
  }

  function handleClose() {
    if (isDirty.current && form.contact_type) {
      if (!window.confirm("You have unsaved info. Close anyway and lose it?")) return;
    }
    onClose();
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.contact_type) { showToast('Select what happened', 'error'); return; }
    isDirty.current = false;
    onComplete({
      contact_name: form.contact_name || undefined,
      role_title:   form.role_title   || undefined,
      set_as_preferred: form.set_as_preferred || false,
      referral_name:  form.referral_name  || undefined,
      referral_role:  form.referral_role  || undefined,
      referral_phone: form.referral_phone || undefined,
      referral_email: form.referral_email || undefined,
      save_referral_as_contact: form.save_referral_as_contact,
      contact_type: form.contact_type,
      notes: form.notes,
      next_action: form.next_action,
      next_action_date_override: form.show_date_override && form.next_action_date_override
        ? form.next_action_date_override : undefined,
    });
  }

  const defaultTypes = ['Voicemail','No Answer','Spoke To','Gatekeeper','Not Interested','Call Back','Left Message','Drop In'];
  const types = contactTypes.length > 0
    ? ['Drop In', ...contactTypes.filter(t => t !== 'Drop In')]
    : defaultTypes;

  const preferred  = data?.contacts?.find(c => c.is_preferred);
  const others     = data?.contacts?.filter(c => !c.is_preferred) ?? [];
  const hasReferral= form.referral_name || form.referral_phone || form.referral_email || form.referral_role;
  const branches   = data?.branches ?? [];

  const STAGE_COLORS = { new:'#64748b', call:'#1e40af', mail:'#065f46', email:'#6b21a8', visit:'#92400e', dead:'#6b7280' };
  const stage = data?.full?.pipeline_stage;

  // Drive time from straight-line as fallback (25mph avg)
  const straightMin = dist ? Math.round((dist / 25) * 60) : null;
  const straightStr = straightMin
    ? straightMin < 60 ? `~${straightMin} min` : `~${Math.floor(straightMin/60)}h ${straightMin%60}m`
    : null;

  // Use actual route when available, otherwise show straight-line estimate
  const displayMiles = routeDist ?? dist;
  const displayTime  = routeTime != null ? fmtDrive(routeTime) : straightStr;
  const isActualRoute = routeDist != null;

  return (
    <div className="call-modal-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
      <div className="call-modal">

        {/* ── LEFT PANEL ─────────────────────────────────────────── */}
        <div style={{ width:340, flexShrink:0, borderRight:'1px solid var(--gray-200)', display:'flex', flexDirection:'column', background:'var(--gray-50)', overflow:'hidden' }}>

          {/* Company header */}
          <div style={{ padding:'20px 22px 16px', background:'var(--navy-950)', flexShrink:0 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:17, fontWeight:800, color:'white', lineHeight:1.3 }}>{companyName}</div>
                <div style={{ fontSize:14, color:'var(--gold-400)', fontFamily:'var(--font-mono)', marginTop:4 }}>{fmtPhone(mainPhone)}</div>
                {row.industry && <div style={{ fontSize:11, color:'rgba(255,255,255,.35)', marginTop:3 }}>{row.industry}</div>}
              </div>
              <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4, flexShrink:0 }}>
                {stage && <div style={{ padding:'3px 9px', borderRadius:3, background:'rgba(255,255,255,.08)', color:'rgba(255,255,255,.5)', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em' }}>{stage}</div>}
                {data?.full?.follow_up?.due_date && (
                  <div style={{ fontSize:10, fontWeight:600, padding:'2px 8px', borderRadius:3,
                    background: new Date(data.full.follow_up.due_date+'T00:00:00') < new Date() ? 'rgba(220,38,38,.2)' : 'rgba(255,255,255,.06)',
                    color: new Date(data.full.follow_up.due_date+'T00:00:00') < new Date() ? '#fca5a5' : 'rgba(255,255,255,.4)',
                  }}>
                    Due {fmtDate(data.full.follow_up.due_date)}
                  </div>
                )}
              </div>
            </div>
            {data?.full?.address && (
              <div style={{ fontSize:11, color:'rgba(255,255,255,.35)', marginTop:6 }}>📍 {data.full.address}{data.full.city ? ', '+data.full.city : ''}</div>
            )}
            {displayMiles && (
              <div style={{ marginTop:6, display:'flex', gap:10, fontSize:11 }}>
                <span style={{ color:'var(--gold-400)', fontWeight:700 }}>
                  📏 {displayMiles.toFixed(1)} mi {myPos?.isShop ? 'from shop' : 'away'}
                  {isActualRoute && <span style={{ fontSize:9, marginLeft:3, opacity:.6 }}>route</span>}
                </span>
                {displayTime && <span style={{ color:'rgba(255,255,255,.4)' }}>🚗 {displayTime}</span>}
              </div>
            )}
            {/* Multi-location badge */}
            {branches.length > 0 && (
              <div style={{ marginTop:6, display:'inline-flex', alignItems:'center', gap:5, background:'rgba(251,191,36,.15)', border:'1px solid rgba(251,191,36,.3)', borderRadius:6, padding:'3px 8px' }}>
                <span style={{ fontSize:11, color:'var(--gold-400)', fontWeight:700 }}>🏢 Multi-Location · {branches.length + 1} sites</span>
              </div>
            )}
            {data?.full?.is_starred ? <div style={{ marginTop:6, fontSize:11, color:'var(--gold-400)' }}>⭐ Starred warm lead</div> : null}
          </div>

          {/* Scrollable content */}
          <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column' }}>
            {busy ? (
              <div style={{ padding:30, textAlign:'center', color:'var(--gray-400)', fontSize:12 }}>Loading…</div>
            ) : <>

              {/* Preferred contact */}
              {preferred && (
                <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--gray-200)', background:'#fffbeb' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                    <div style={{ fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'#92400e' }}>⭐ Preferred Contact</div>
                    {!editingPreferred && (
                      <button type="button" onClick={() => startEditPreferred(preferred)}
                        style={{ fontSize:10, fontWeight:700, color:'#92400e', background:'rgba(146,64,14,.1)', border:'1px solid rgba(146,64,14,.2)', borderRadius:4, padding:'2px 7px', cursor:'pointer' }}>
                        ✏️ Edit
                      </button>
                    )}
                  </div>
                  {!editingPreferred ? (
                    <>
                      <div style={{ fontWeight:700, fontSize:14, color:'var(--gray-900)' }}>{preferred.name}</div>
                      {preferred.role_title && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{preferred.role_title}</div>}
                      <div style={{ display:'flex', gap:12, fontSize:12, color:'var(--gray-600)', marginTop:5, flexWrap:'wrap' }}>
                        {preferred.direct_line && <span className="phone-num">📱 {fmtPhone(preferred.direct_line)}</span>}
                        {preferred.email && <span>✉️ {preferred.email}</span>}
                      </div>
                    </>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:4 }}>
                      <input style={{ fontSize:12, padding:'5px 8px', border:'1px solid #fcd34d', borderRadius:5, background:'white', width:'100%', boxSizing:'border-box' }}
                        placeholder="Name" value={prefEdit.name} onChange={e => setPrefEdit(p=>({...p,name:e.target.value}))} />
                      <input style={{ fontSize:12, padding:'5px 8px', border:'1px solid #fcd34d', borderRadius:5, background:'white', width:'100%', boxSizing:'border-box' }}
                        placeholder="Role / Title" value={prefEdit.role_title} onChange={e => setPrefEdit(p=>({...p,role_title:e.target.value}))} />
                      <input style={{ fontSize:12, padding:'5px 8px', border:'1px solid #fcd34d', borderRadius:5, background:'white', width:'100%', boxSizing:'border-box' }}
                        placeholder="Direct line" value={prefEdit.direct_line} onChange={e => setPrefEdit(p=>({...p,direct_line:e.target.value}))} />
                      <input style={{ fontSize:12, padding:'5px 8px', border:'1px solid #fcd34d', borderRadius:5, background:'white', width:'100%', boxSizing:'border-box' }}
                        placeholder="Email" type="email" value={prefEdit.email} onChange={e => setPrefEdit(p=>({...p,email:e.target.value}))} />
                      <div style={{ display:'flex', gap:6, marginTop:2 }}>
                        <button type="button" onClick={savePreferred} disabled={prefSaving}
                          style={{ flex:1, fontSize:11, fontWeight:700, padding:'5px 0', background:'#92400e', color:'white', border:'none', borderRadius:5, cursor:'pointer' }}>
                          {prefSaving ? 'Saving…' : '✅ Save'}
                        </button>
                        <button type="button" onClick={() => setEditingPreferred(false)}
                          style={{ fontSize:11, fontWeight:700, padding:'5px 10px', background:'white', color:'var(--gray-500)', border:'1px solid var(--gray-200)', borderRadius:5, cursor:'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Other contacts */}
              {others.length > 0 && (
                <div style={{ borderBottom:'1px solid var(--gray-200)' }}>
                  <div style={{ padding:'10px 18px 4px', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)' }}>Other Contacts</div>
                  {others.map(c => (
                    <div key={c.id} style={{ padding:'8px 18px', borderTop:'1px solid var(--gray-100)' }}>
                      <div style={{ fontWeight:600, fontSize:12.5 }}>
                        {c.name}
                        {c.role_title && <span style={{ fontWeight:400, fontSize:11, color:'var(--gray-400)', marginLeft:5 }}>{c.role_title}</span>}
                      </div>
                      <div style={{ fontSize:11, color:'var(--gray-500)', display:'flex', gap:10, marginTop:2, flexWrap:'wrap' }}>
                        {c.direct_line && <span>📱 {fmtPhone(c.direct_line)}</span>}
                        {c.email && <span>✉️ {c.email}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Other branches / locations */}
              {branches.length > 0 && (
                <div style={{ borderBottom:'1px solid var(--gray-200)' }}>
                  <div style={{ padding:'10px 18px 4px', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'#92400e' }}>🏢 Other Locations ({branches.length})</div>
                  {branches.map(b => (
                    <div key={b.id} style={{ padding:'8px 18px', borderTop:'1px solid var(--gray-100)' }}>
                      <div style={{ fontWeight:600, fontSize:12.5 }}>{b.location_name || b.name}</div>
                      <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2, display:'flex', gap:8, flexWrap:'wrap' }}>
                        {b.main_phone && <span>📱 {fmtPhone(b.main_phone)}</span>}
                        {b.address && <span>📍 {b.address}{b.city?', '+b.city:''}</span>}
                        {b.last_contact_type && <span style={{ color:b.last_contact_type==='Spoke To'?'#15803d':'var(--gray-400)' }}>· {b.last_contact_type}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* History timeline — ALL log types */}
              <div style={{ padding:'10px 18px 4px', fontSize:9.5, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)', flexShrink:0 }}>
                History {data?.hist?.length > 0 ? `(${data.hist.length})` : ''}
              </div>
              <div style={{ flex:1, padding:'0 18px 16px' }}>
                {!data?.hist?.length ? (
                  <div style={{ fontSize:12, color:'var(--gray-400)', padding:'6px 0' }}>No activity yet — this will be the first.</div>
                ) : data.hist.map(h => {
                  const cat = h.log_category || 'call';
                  const catIcon  = CATEGORY_ICONS[cat]  || '📞';
                  const catColor = CATEGORY_COLORS[cat] || 'var(--navy-800)';
                  return (
                    <div key={h.id} className="history-item">
                      <div className="history-dot" style={{ background: catColor, color:'white', fontSize:10, display:'flex', alignItems:'center', justifyContent:'center' }}>
                        {cat === 'call' ? (h.attempt_number || catIcon) : catIcon}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <span style={{ fontWeight:700, fontSize:12.5 }}>
                            {h.contact_type || h.mail_piece || h.email_template || h.log_category}
                          </span>
                          <span style={{ fontSize:10, color:'var(--gray-400)', flexShrink:0, marginLeft:6 }}>{h.logged_at?.slice(0,10)}</span>
                        </div>
                        {h.contact_name && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>with {h.contact_name}{h.role_title?` · ${h.role_title}`:''}</div>}
                        {h.mail_piece && <div style={{ fontSize:11, color:'#065f46', marginTop:1 }}>✉️ {h.mail_piece}</div>}
                        {h.email_to && <div style={{ fontSize:11, color:'#6b21a8', marginTop:1 }}>📧 to {h.email_to}</div>}
                        {h.referral_name && <div style={{ fontSize:11, color:'var(--green-600)', fontWeight:600, marginTop:1 }}>→ referred {h.referral_name}{h.referral_role?` · ${h.referral_role}`:''}</div>}
                        {h.notes && <div style={{ fontSize:11, color:'var(--gray-600)', marginTop:2, lineHeight:1.5 }}>{h.notes}</div>}
                        {h.log_category === 'move' && h.notes && <div style={{ fontSize:11, fontWeight:700, color:'var(--navy-700)', marginTop:2 }}>{h.notes}</div>}
                        {h.next_action && h.log_category !== 'move' && <div style={{ fontSize:10, color:'var(--gray-400)', marginTop:2 }}>Next: {h.next_action}{h.next_action_date?` · ${fmtDate(h.next_action_date)}`:''}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>}
          </div>
        </div>

        {/* ── RIGHT PANEL: log form ─────────────────────────────── */}
        <form onSubmit={handleSubmit} style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

          {/* Header */}
          <div style={{ padding:'16px 24px', borderBottom:'1px solid var(--gray-200)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--gray-900)' }}>Log Call — {companyName}</div>
              <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>
                Fill in what happened and what's next
              </div>
            </div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              {companyStatus !== null && (
                <select value={companyStatus} onChange={e=>handleStatusChange(e.target.value)}
                  style={{ fontSize:12, fontWeight:700, padding:'5px 10px', borderRadius:7, cursor:'pointer', border:'1px solid var(--gray-200)', background:'white', color:'var(--gray-800)' }}>
                  <option value="prospect">Prospect</option>
                  <option value="interested">⭐ Interested</option>
                  <option value="customer">✅ Customer</option>
                </select>
              )}
              <button type="button"
                onClick={() => window.open(`${window.location.origin}/script-popup`, 'fleet-crm-script', 'width=1100,height=820,menubar=no,toolbar=no,scrollbars=yes')}
                style={{ padding:'5px 13px', borderRadius:'var(--r-md)', border:'1px solid #fde68a', background:'#fffbeb', color:'#92400e', cursor:'pointer', fontSize:12, fontWeight:700 }}>
                📋 Script
              </button>
              <button type="button" onClick={handleClose}
                style={{ width:30, height:30, border:'1px solid var(--gray-200)', borderRadius:'var(--r-md)', background:'white', cursor:'pointer', fontSize:16, color:'var(--gray-400)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                ✕
              </button>
            </div>
          </div>

          {/* Form body */}
          <div style={{ flex:1, overflowY:'auto', padding:'20px 28px', display:'flex', flexDirection:'column', gap:22 }}>

            {/* ① What Happened — MOVED FIRST so it's always visible */}
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gold-500)', marginBottom:10 }}>① What Happened *</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {types.map(t => (
                  <button key={t} type="button" onClick={() => set('contact_type', t)}
                    style={{
                      padding:'7px 16px', borderRadius:'var(--r-sm)',
                      fontSize:13, fontWeight:600, cursor:'pointer',
                      border:`1.5px solid ${form.contact_type===t?'var(--navy-700)':'var(--gray-200)'}`,
                      background:form.contact_type===t?'var(--navy-800)':'white',
                      color:form.contact_type===t?'white':'var(--gray-700)',
                      transition:'all .1s',
                    }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* ② Notes */}
            <div className="form-group" style={{ margin:0 }}>
              <label className="form-label" style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)' }}>② Notes</label>
              <textarea className="form-textarea" rows={4}
                placeholder="What happened? What did they say? Tone? Any details worth remembering for next time…"
                value={form.notes} onChange={e => set('notes', e.target.value)} />
            </div>

            {/* ③ Who answered */}
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)', marginBottom:10 }}>② Who Answered</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Name</label>
                  <input className="form-input" placeholder="First name or full name" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
                </div>
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Role / Title</label>
                  <input className="form-input" placeholder="Receptionist, Owner, Manager…" value={form.role_title} onChange={e => set('role_title', e.target.value)} />
                </div>
              </div>
              {form.contact_name && (
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, padding:'6px 10px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:7, color:'#15803d', marginTop:8 }}>
                  <input type="checkbox" checked={form.set_as_preferred} onChange={e=>set('set_as_preferred',e.target.checked)} style={{ width:13, height:13, accentColor:'#15803d' }}/>
                  ⭐ Set <strong style={{ margin:'0 3px' }}>{form.contact_name}</strong> as the preferred contact
                  {preferred && preferred.name !== form.contact_name && (
                    <span style={{ fontSize:10, color:'#6b7280', fontWeight:400, marginLeft:2 }}>(replaces {preferred.name})</span>
                  )}
                </label>
              )}
            </div>
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)', marginBottom:4 }}>
                ③ Contact They Gave You
                <span style={{ fontSize:10, fontWeight:400, textTransform:'none', color:'var(--gray-300)', marginLeft:6 }}>optional</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                {[
                  ['referral_name',  'Name',             'John Smith'],
                  ['referral_role',  'Title / Role',     'Fleet Manager, Owner…'],
                  ['referral_phone', 'Phone',            '(704) 555-0101'],
                  ['referral_email', 'Email',            'john@company.com'],
                ].map(([field, label, placeholder]) => (
                  <div key={field} className="form-group" style={{ margin:0 }}>
                    <label className="form-label">{label}</label>
                    <input className="form-input" placeholder={placeholder} type={field==='referral_email'?'email':'text'}
                      value={form[field]} onChange={e => set(field, e.target.value)} />
                  </div>
                ))}
              </div>
              {hasReferral && (
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, padding:'8px 12px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:'var(--r-md)', color:'var(--gray-700)', marginTop:8 }}>
                  <input type="checkbox" checked={form.save_referral_as_contact} onChange={e => set('save_referral_as_contact', e.target.checked)} style={{ width:13, height:13, accentColor:'var(--gold-500)' }} />
                  ⭐ Save <strong style={{ margin:'0 3px' }}>{form.referral_name || 'this contact'}</strong> to this company permanently
                </label>
              )}
            </div>

            {/* ⑤ Next action */}
            <div>
              <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.1em', color:'var(--gray-400)', marginBottom:10 }}>⑤ Next Action *</div>
              <div className="next-action-group">
                {[['Call','📞 Call Again'],['Mail','✉️ Mail'],['Email','📧 Email'],['Visit','📍 Visit'],['Stop','🚫 Stop']].map(([val,label]) => (
                  <button key={val} type="button"
                    className={`action-btn${form.next_action===val ? val==='Stop'?' selected-stop':val==='Visit'?' selected-visit':' selected-call' : ''}`}
                    onClick={() => set('next_action', val)}>
                    {label}
                  </button>
                ))}
              </div>
              <label style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:12, color:'var(--gray-600)', marginTop:10 }}>
                <input type="checkbox" checked={form.show_date_override} onChange={e => set('show_date_override', e.target.checked)} style={{ width:13, height:13, accentColor:'var(--gold-500)' }} />
                Set follow-up date manually
              </label>
              {form.show_date_override && (
                <input className="form-input" type="date" style={{ marginTop:8, width:200 }}
                  value={form.next_action_date_override} onChange={e => set('next_action_date_override', e.target.value)}
                  min={new Date().toISOString().split('T')[0]} />
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{ padding:'14px 28px', borderTop:'1px solid var(--gray-200)', background:'var(--gray-50)', flexShrink:0, display:'flex', gap:10, alignItems:'center' }}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={saving || !form.contact_type}>
              {saving ? 'Saving…' : '✅ Log Call & Complete'}
            </button>
            {!form.contact_type && <span style={{ fontSize:11, color:'var(--gray-400)' }}>Select what happened first</span>}
            <button type="button" className="btn btn-ghost" style={{ marginLeft:'auto' }} onClick={handleClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
