import { useState, useEffect, useRef } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import QueueFilter from '../components/QueueFilter.jsx';
import RowActions from '../components/RowActions.jsx';
import MoveModal from '../components/MoveModal.jsx';
import ForecastStrip from '../components/ForecastStrip.jsx';
import { useNavigate } from 'react-router-dom';

// ── Helpers ───────────────────────────────────────────────────────────────────
function dist(a, b) {
  if (!a?.lat || !b?.lat) return 9999;
  const R = 3958.8, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function optimize(start, stops, end) {
  if (stops.length <= 1) return stops.map(s=>({...s, driveMiles: dist(start,s)}));
  const rem=[...stops], out=[]; let cur=start;
  while(rem.length>0) {
    const target = (end && rem.length === 1) ? end : null;
    let bi=0, bd=Infinity;
    rem.forEach((s,i)=>{
      const d = dist(cur,s) + (target ? dist(s,target)*0.5 : 0);
      if(d<bd){bd=d;bi=i;}
    });
    out.push({...rem[bi], driveMiles:dist(cur,rem[bi])}); cur=rem[bi]; rem.splice(bi,1);
  }
  return out;
}

function driveMins(miles) { return Math.max(1, Math.round((miles/25)*60)); }
function fmt(m) { m=Math.round(m); if(m<60) return `${m}m`; return `${Math.floor(m/60)}h ${m%60>0?m%60+'m':''}`.trim(); }
function fmtTime(date) { return date.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',hour12:true}); }
function addMins(date, mins) { return new Date(date.getTime()+mins*60000); }
function nowTimeStr() { const n=new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; }

// Geocode via backend (avoids CORS issues) — only used when building a route
async function geocodeViaBackend(companyId) {
  try {
    return await api.geocodeLookup(companyId);
  } catch(_) { return null; }
}

// Fallback geocode for start/end address (not company-based)
async function geocodeAddress(address) {
  try {
    const https = { get: null }; // not available in browser
    // Use our backend proxy for address geocoding
    const r = await fetch(`/api/geocode-address?q=${encodeURIComponent(address)}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('fleet_crm_token') || ''}` }
    });
    if (r.ok) {
      const d = await r.json();
      if (d.lat) return { lat: d.lat, lng: d.lng, ok: true };
    }
  } catch(_) {}
  // Hard fallback to Charlotte center
  return { lat: 35.2271, lng: -80.8431, ok: false };
}

function getPriority(company) {
  const today=new Date(); today.setHours(0,0,0,0);
  const dropIn=['Not Interested','Gatekeeper','No Answer','Voicemail','Left Message','Drop In'];
  if (!company.last_contacted) return 'none';
  if (company.followup_due) { const due=new Date(company.followup_due+'T00:00:00'); if(due<=today) return 'hot'; }
  if (dropIn.includes(company.last_contact_type)) return 'hot';
  if (company.followup_due) { const due=new Date(company.followup_due+'T00:00:00'); if((due-today)/86400000<=7) return 'warm'; }
  if (company.last_contacted) { if((today-new Date(company.last_contacted))/86400000>30) return 'warm'; }
  return 'good';
}

const PRI = {
  hot:  {color:'#ef4444',dot:'🔴',label:'Drop In',   bg:'#fef2f2',border:'#fca5a5'},
  warm: {color:'#f59e0b',dot:'🟡',label:'Due Soon',  bg:'#fffbeb',border:'#fde68a'},
  good: {color:'#22c55e',dot:'🟢',label:'Recent',    bg:'#f0fdf4',border:'#86efac'},
  none: {color:'#94a3b8',dot:'⚪',label:'No Contact',bg:'#f8fafc',border:'#e2e8f0'},
};

// ── Main Component ────────────────────────────────────────────────────────────
export default function RoutePlanner({ embedded = false }) {
  // ── Planner state ─────────────────────────────────────────────────────────
  const [visits, setVisits]               = useState([]);
  const [selected, setSelected]           = useState(new Set());
  const [stopTimes, setStopTimes]         = useState({});
  const [order, setOrder]                 = useState([]);
  const [startMode, setStartMode]         = useState('address');
  const [startAddr, setStartAddr]         = useState('3816 Monroe Rd, Charlotte, NC 28205');
  const [timeMode, setTimeMode]           = useState('now');
  const [startTime, setStartTime]         = useState(nowTimeStr());
  const [endMode, setEndMode]             = useState('none');
  const [endAddr, setEndAddr]             = useState('');
  const [autoOpt, setAutoOpt]             = useState(true);
  const [planning, setPlanning]           = useState(false);
  const [planStep, setPlanStep]           = useState('');
  const [route, setRoute]                 = useState(null);
  const [routeStopMins, setRouteStopMins] = useState({});
  const [arriveAt, setArriveAt]           = useState({});
  const [loggingStop, setLoggingStop]     = useState(null);
  const [logging, setLogging]             = useState(false);
  const [logForm, setLogForm]             = useState({ contact_type:'', notes:'', contact_name:'', direct_line:'', next_action:'Call' });
  const [stopFilter, setStopFilter]       = useState('today');
  const [customFrom, setCustomFrom]       = useState('');
  const [customTo, setCustomTo]           = useState('');
  const [queueStatus, setQueueStatus]     = useState(null);
  const [error, setError]                 = useState('');
  const [loading, setLoading]             = useState(true);
  const [forecast, setForecast]           = useState([]);
  const [movingId, setMovingId]           = useState(null);
  const [contactTypes, setContactTypes]   = useState([]);
  const [myGps, setMyGps]                 = useState(null);

  // ── Nearby state ──────────────────────────────────────────────────────────
  const [nearbyCompanies, setNearbyCompanies] = useState([]);
  const [nearbyMapped, setNearbyMapped]       = useState([]);
  const [nearbyFilter, setNearbyFilter]       = useState('all');

  const { showToast, refreshCounts } = useApp();
  const navigate = useNavigate();
  const prevStartAddr = useRef(startAddr);

  // ── 1. Restore persisted route ────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('fleet_route');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.route) {
          setRoute(parsed.route);
          setRouteStopMins(parsed.routeStopMins || {});
          setArriveAt(parsed.arriveAt || {});
          if (parsed.endMode) setEndMode(parsed.endMode);
          if (parsed.endAddr) setEndAddr(parsed.endAddr);
        }
      }
    } catch(_) {}
  }, []);

  // ── 2. Persist route to sessionStorage when it changes ───────────────────
  useEffect(() => {
    if (route) {
      try { sessionStorage.setItem('fleet_route', JSON.stringify({ route, routeStopMins, arriveAt, endMode, endAddr })); }
      catch(_) {}
    } else {
      sessionStorage.removeItem('fleet_route');
    }
  }, [route, routeStopMins, arriveAt]);

  // ── 3. Clear stale route when start address changes ───────────────────────
  useEffect(() => {
    if (prevStartAddr.current !== startAddr && route) {
      setRoute(null);
      showToast('Start address changed — re-plan your route');
    }
    prevStartAddr.current = startAddr;
  }, [startAddr]);

  // ── 4. Load page data ─────────────────────────────────────────────────────
  useEffect(() => {
    api.pipelineForecast().then(fc => setForecast(fc || [])).catch(()=>{});
    Promise.all([api.visitsAll(), api.contactTypes(), api.settings()])
      .then(([data, ct, settings]) => {
        setVisits(data);
        setContactTypes(ct.configured || []);
        const shopAddr = settings?.find?.(s => s.key === 'shop_address')?.value;
        if (shopAddr) setStartAddr(shopAddr);
        const today = new Date().toISOString().split('T')[0];
        setSelected(new Set(data.filter(v=>v.scheduled_date<=today).map(v=>v.id)));
        const t={}, o=[];
        data.forEach(v=>{ t[v.id]=20; o.push(v.id); });
        setStopTimes(t); setOrder(o);
      })
      .catch(e => console.error('Failed to load visits page:', e))
      .finally(()=>setLoading(false));
  }, []);

  // ── 5. Get GPS ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => setMyGps({lat:pos.coords.latitude,lng:pos.coords.longitude}),
      () => setMyGps({lat:35.2073,lng:-80.7980}),
      {timeout:8000}
    );
  }, []);

  // ── 6. Load nearby companies + auto-refresh while geocoding is running ────
const [stillGeocoding, setStillGeocoding] = useState(0);

useEffect(() => {
  let interval = null;

  function load() {
    api.nearbyData()
      .then(data => {
        const companies = data || [];
        setNearbyCompanies(companies);

        // Count how many still need coordinates
        const missing = companies.filter(c => c.address && (!c.lat || !c.lng)).length;
        setStillGeocoding(missing);

        // If some are still missing, keep polling every 15 seconds
        // Once they all have coords the interval clears itself
        if (missing > 0 && !interval) {
          interval = setInterval(() => {
            api.nearbyData().then(fresh => {
              const freshCompanies = fresh || [];
              setNearbyCompanies(freshCompanies);
              const stillMissing = freshCompanies.filter(c => c.address && (!c.lat || !c.lng)).length;
              setStillGeocoding(stillMissing);
              if (stillMissing === 0) {
                clearInterval(interval);
                interval = null;
              }
            }).catch(() => {});
          }, 15000);
        } else if (missing === 0 && interval) {
          clearInterval(interval);
          interval = null;
        }
      })
      .catch(e => console.error('nearbyData failed:', e));
  }

  load();
  return () => { if (interval) clearInterval(interval); };
}, []);

  // ── 7. Map nearby companies — ONLY use stored coordinates, no geocoding ───
  // This keeps the page fast. Run the bulk geocode in Settings to populate coords.
  useEffect(() => {
    if (nearbyCompanies.length === 0) return;
    const mapped = nearbyCompanies
      .filter(c => c.lat && c.lng)
      .map(c => ({ ...c, geoOk: true, priority: getPriority(c) }));
    setNearbyMapped(mapped);
  }, [nearbyCompanies]);

  // ── Planner functions ─────────────────────────────────────────────────────
  function toggleStop(id) {
    setSelected(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  }
  function moveUp(id) {
    setOrder(prev => {
      const i=prev.indexOf(id); if(i<=0) return prev;
      const n=[...prev]; [n[i-1],n[i]]=[n[i],n[i-1]]; return n;
    });
  }
  function moveDown(id) {
    setOrder(prev => {
      const i=prev.indexOf(id); if(i>=prev.length-1) return prev;
      const n=[...prev]; [n[i],n[i+1]]=[n[i+1],n[i]]; return n;
    });
  }

  async function getStartCoords() {
    if (startMode === 'gps' && myGps) return myGps;
    return await geocodeAddress(startAddr);
  }

  async function buildRoute() {
    if (selected.size === 0) { showToast('Select at least one stop', 'error'); return; }
    if (selected.size > 23)  { showToast('Max 23 stops for Google Maps', 'error'); return; }
    setPlanning(true); setError('');
    try {
      setPlanStep('Finding start location…');
      const startGeo = await getStartCoords();
      const sel = order.filter(id=>selected.has(id)).map(id=>visits.find(v=>v.id===id)).filter(Boolean);
      const geocoded = [];

      for (let i=0; i<sel.length; i++) {
        const v = sel[i];
        setPlanStep(`Locating ${i+1}/${sel.length}: ${v.entity_name}…`);

        let lat = v.lat, lng = v.lng;

        // If company doesn't have stored coords, try geocoding via backend
        if (!lat || !lng) {
          const result = await geocodeViaBackend(v.entity_id || v.id);
          if (result) { lat = result.lat; lng = result.lng; }
        }

        // Final fallback: use Charlotte center so route still builds
        if (!lat || !lng) { lat = 35.2271; lng = -80.8431; }

        geocoded.push({
          id: v.id,
          name: v.entity_name,
          address: v.address || '',
          city: v.city || 'Charlotte',
          phone: v.direct_line || '',
          contact: v.contact_name || '',
          notes: v.notes || '',
          workingNotes: v.working_notes || '',
          scheduledDate: v.scheduled_date || '',
          stopMins: stopTimes[v.id] || 20,
          lat, lng,
          geoOk: !!(lat && lng),
          visitId: v.id,
          companyId: v.entity_id || v.id,
        });
      }

      setPlanStep('Calculating best route…');
      await new Promise(r=>setTimeout(r,100));

      let endGeoLocal = null;
      if (endMode === 'custom' && endAddr.trim()) {
        setPlanStep('Locating end destination…');
        endGeoLocal = await geocodeAddress(endAddr.trim());
      }

      const ordered = autoOpt
        ? optimize(startGeo, geocoded, endGeoLocal)
        : geocoded.map((s,i)=>({...s, driveMiles: i===0 ? dist(startGeo,s) : dist(geocoded[i-1],s)}));

      const timeStr = timeMode==='now' ? nowTimeStr() : startTime;
      const [h,m] = timeStr.split(':').map(Number);
      let clock=new Date(); clock.setHours(h,m,0,0);

      const stops = ordered.map((stop) => {
        const dm = driveMins(stop.driveMiles||0);
        clock = addMins(clock, dm);
        const arriveTime = fmtTime(clock);
        clock = addMins(clock, stop.stopMins);
        const leaveTime = fmtTime(clock);
        return {...stop, driveMinutes:dm, arriveTime, leaveTime};
      });

      const returnDest = (endMode==='custom' && endGeoLocal) ? endGeoLocal : startGeo;
      const shouldReturn = endMode === 'home' || (endMode==='custom' && endAddr.trim());
      let retMiles=0, retMins=0, retArrival='', retAddr='';

      if (shouldReturn && stops.length>0) {
        const last = stops[stops.length-1];
        retMiles = dist(last, returnDest);
        retMins = driveMins(retMiles);
        retArrival = fmtTime(addMins(clock, retMins));
        retAddr = endMode==='custom' && endAddr.trim() ? endAddr.trim() : '';
      }

      const initMins = {};
      stops.forEach(s => { initMins[s.id] = s.stopMins; });
      setRouteStopMins(initMins);
      setArriveAt({});
      setRoute({
        stops,
        startAddr: startMode==='gps' ? 'Current Location' : startAddr,
        startGeo,
        startTime: timeStr,
        returnHome: shouldReturn,
        retMiles, retMins, retArrival, retAddr,
        endMode, endGeo: endGeoLocal,
        totalDrive: stops.reduce((s,x)=>s+x.driveMinutes,0)+retMins,
        totalStop:  stops.reduce((s,x)=>s+x.stopMins,0),
        totalMiles: stops.reduce((s,x)=>s+(x.driveMiles||0),0)+retMiles,
        failed: stops.filter(s=>!s.geoOk).map(s=>s.name),
      });
    } catch(err) {
      setError('Route planning failed: '+err.message);
    } finally {
      setPlanning(false); setPlanStep('');
    }
  }

  // ── Timeline recalculation ────────────────────────────────────────────────
  function fmtMinOfDay(min) {
    const nextDay = min >= 1440;
    const wrapped = ((min % 1440) + 1440) % 1440;
    const hh = Math.floor(wrapped / 60);
    const mm = wrapped % 60;
    const d = new Date(); d.setHours(hh, mm, 0, 0);
    const label = d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', hour12:true});
    return nextDay ? label + ' (+1)' : label;
  }

  function recalcTimeline(stops, stopMins, startTimeStr, startGeo, returnHome, arriveAtMap={}) {
    const [h,m] = startTimeStr.split(':').map(Number);
    let clockMin = h * 60 + m;
    const result = stops.map((stop) => {
      const dm = stop.driveMinutes || driveMins(stop.driveMiles||0);
      clockMin += dm;
      let displayArriveMin = clockMin;
      const targetStr = arriveAtMap?.[stop.id];
      if (targetStr) {
        const [th, tm] = targetStr.split(':').map(Number);
        let targetMin = th * 60 + tm;
        if (targetMin < clockMin - 720) targetMin += 1440;
        if (targetMin > clockMin) { clockMin = targetMin; displayArriveMin = targetMin; }
      }
      clockMin = displayArriveMin;
      const arriveTime = fmtMinOfDay(displayArriveMin);
      const mins = stopMins[stop.id] ?? stop.stopMins ?? 20;
      clockMin += mins;
      const leaveTime = fmtMinOfDay(clockMin);
      return {...stop, stopMins: mins, arriveTime, leaveTime, arriveMinOfDay: displayArriveMin, leaveMinOfDay: clockMin};
    });
    let retMiles=0, retMins=0, retArrival='';
    if (returnHome && result.length > 0) {
      const last = result[result.length-1];
      retMiles = dist(last, startGeo); retMins = driveMins(retMiles);
      retArrival = fmtMinOfDay(clockMin + retMins);
    }
    return {
      stops: result, retMiles, retMins, retArrival,
      totalDrive: result.reduce((s,x)=>s+x.driveMinutes,0)+retMins,
      totalStop:  result.reduce((s,x)=>s+x.stopMins,0),
      totalMiles: result.reduce((s,x)=>s+(x.driveMiles||0),0)+retMiles,
    };
  }

  function computeArriveAtInfo(stopIdx, targetStr, liveStops, stopMins, startTimeStr, timeModeArg) {
    if (!targetStr) return null;
    const [th, tm] = targetStr.split(':').map(Number);
    const prevStop = stopIdx > 0 ? liveStops[stopIdx - 1] : null;
    const hhmm2min = s => { if(!s) return null; const [h,m]=s.split(':').map(Number); return h*60+m; };
    const prevLeaveMin = prevStop ? prevStop.leaveMinOfDay : hhmm2min(startTimeStr);
    const driveToThis = liveStops[stopIdx].driveMinutes || driveMins(liveStops[stopIdx].driveMiles||0);
    const earliestArriveMin = prevLeaveMin + driveToThis;
    let targetMin = th * 60 + tm;
    if (targetMin < earliestArriveMin - 720) targetMin += 1440;
    const bufferMin = targetMin - earliestArriveMin;
    let needed = targetMin;
    for (let j=stopIdx; j>=0; j--) {
      needed -= (liveStops[j].driveMinutes || driveMins(liveStops[j].driveMiles||0));
      if (j > 0) needed -= (stopMins[liveStops[j-1].id] ?? liveStops[j-1].stopMins ?? 20);
    }
    const now = new Date(); const nowMin = now.getHours()*60+now.getMinutes();
    const leaveInMin = timeModeArg === 'now' ? needed - nowMin : null;
    const mustLeaveByMin = targetMin - driveToThis;
    const prevName = prevStop ? prevStop.name : 'home';
    return { bufferMin, leaveInMin, targetMin, earliestArriveMin, mustLeaveByMin, prevName, driveToThis };
  }

  function getNavUrl(stop) {
    const dest = encodeURIComponent(`${stop.address}, ${stop.city||'Charlotte'}, NC`);
    if (myGps) return `https://www.google.com/maps/dir/${myGps.lat},${myGps.lng}/${dest}`;
    return `https://www.google.com/maps/dir/current+location/${dest}`;
  }

  function printRoute() {
    const recalc = recalcTimeline(route.stops, routeStopMins, route.startTime, route.startGeo, route.returnHome, arriveAt);
    const today = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
    const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const stopRows = recalc.stops.map((stop, i) => {
      const prevLabel = i===0 ? (route.startAddr||'Start') : recalc.stops[i-1].name;
      return (
        '<div class="stop-block">' +
          '<div class="drive-seg">🚗 ' + (stop.driveMiles||0).toFixed(1) + ' mi · ' + fmt(stop.driveMinutes) + ' from ' + esc(prevLabel) + '</div>' +
          '<div class="stop-header">' +
            '<div class="stop-num">' + (i+1) + '</div>' +
            '<div class="stop-info"><div class="stop-name">' + esc(stop.name) + '</div>' +
            '<div class="stop-addr">' + esc(stop.address) + (stop.city ? ', '+esc(stop.city) : '') + '</div></div>' +
            '<div class="stop-times"><div class="arrive">▶ ' + stop.arriveTime + '</div><div class="leave">◀ ' + stop.leaveTime + '</div></div>' +
          '</div>' +
          '<div class="stop-meta">' +
            '<span class="meta-chip">⏱ ' + stop.stopMins + 'm</span>' +
            (stop.contact ? '<span class="meta-chip">👤 ' + esc(stop.contact) + '</span>' : '') +
            (stop.phone   ? '<span class="meta-chip">📞 ' + esc(stop.phone)   + '</span>' : '') +
          '</div>' +
          (stop.notes ? '<div class="stop-notes">' + esc(stop.notes) + '</div>' : '') +
          '<div class="log-line"><span class="log-label">Outcome:</span><span class="log-blank"></span>&emsp;<span class="log-label">Spoke with:</span><span class="log-blank"></span>&emsp;<span class="log-label">Next:</span><span class="log-blank short"></span></div>' +
        '</div>'
      );
    }).join('');
    const [dh,dm] = route.startTime.split(':').map(Number);
    const depDate = new Date(); depDate.setHours(dh,dm,0,0);
    const win = window.open('', '_blank', 'width=860,height=960');
    win.document.write('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Route Sheet</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,Arial,sans-serif;font-size:12px;color:#1e293b;padding:24px;background:white}.page-header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:12px;margin-bottom:14px}.logo{font-size:18px;font-weight:900;color:#1e3a5f}.logo span{color:#f59e0b}.route-title{font-size:13px;font-weight:800;color:#1e3a5f;text-align:right}.route-meta{font-size:11px;color:#64748b;margin-top:2px;text-align:right}.summary-bar{display:flex;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin-bottom:14px}.summary-item{flex:1;text-align:center;padding:9px 4px;border-right:1px solid #e2e8f0}.summary-item:last-child{border-right:none}.summary-val{font-size:17px;font-weight:900;color:#1e3a5f}.summary-lbl{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-top:1px}.drive-seg{padding:3px 8px 3px 38px;font-size:10px;color:#94a3b8;background:#f8fafc;border-top:1px solid #f1f5f9}.stop-block{border:1.5px solid #e2e8f0;border-radius:8px;margin-bottom:10px;overflow:hidden;page-break-inside:avoid}.stop-header{display:flex;gap:10px;align-items:flex-start;padding:10px 12px 6px}.stop-num{width:26px;height:26px;border-radius:50%;background:#f59e0b;color:#1e293b;font-weight:900;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0}.stop-info{flex:1}.stop-name{font-size:14px;font-weight:800;color:#1e293b}.stop-addr{font-size:11px;color:#64748b;margin-top:1px}.stop-times{text-align:right;flex-shrink:0}.arrive{font-weight:800;color:#15803d;font-size:12px}.leave{color:#dc2626;font-size:11px;margin-top:1px}.stop-meta{display:flex;flex-wrap:wrap;gap:5px;padding:0 12px 8px}.meta-chip{background:#f1f5f9;border-radius:20px;padding:2px 9px;font-size:10px;color:#475569}.stop-notes{font-size:11px;color:#475569;background:#fef9ec;border-left:3px solid #f59e0b;padding:5px 9px;margin:0 12px 8px;border-radius:0 5px 5px 0}.log-line{display:flex;align-items:center;padding:7px 12px 9px;border-top:1px dashed #e2e8f0;font-size:11px;gap:4px}.log-blank{display:inline-block;border-bottom:1px solid #94a3b8;min-width:100px;height:15px;margin-left:4px;flex:1}.log-blank.short{flex:none;min-width:60px}.log-label{font-weight:600;color:#64748b;white-space:nowrap}.return-block{display:flex;justify-content:space-between;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:7px;padding:9px 14px;font-size:12px;font-weight:700;color:#15803d}.print-btn{display:block;margin:0 auto 18px;padding:8px 26px;background:#1e3a5f;color:white;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer}@media print{.no-print{display:none!important}.stop-block{break-inside:avoid}}</style></head><body>' +
      '<button class="print-btn no-print" onclick="window.print()">🖨️ Print / Save as PDF</button>' +
      '<div class="page-header"><div><div class="logo">🦅 Super<span>Eagle</span> Fleet CRM</div><div style="font-size:11px;color:#94a3b8;margin-top:3px;">' + today + '</div></div>' +
      '<div><div class="route-title">📍 Route Sheet</div><div class="route-meta">Start: ' + esc(route.startAddr||'') + '</div><div class="route-meta">Depart: ' + fmtTime(depDate) + '</div></div></div>' +
      '<div class="summary-bar">' +
        '<div class="summary-item"><div class="summary-val">' + recalc.stops.length + '</div><div class="summary-lbl">📍 Stops</div></div>' +
        '<div class="summary-item"><div class="summary-val">' + recalc.totalMiles.toFixed(1) + '</div><div class="summary-lbl">📏 Miles</div></div>' +
        '<div class="summary-item"><div class="summary-val">' + fmt(recalc.totalDrive) + '</div><div class="summary-lbl">🚗 Drive</div></div>' +
        '<div class="summary-item"><div class="summary-val">' + fmt(recalc.totalStop) + '</div><div class="summary-lbl">🤝 Stops</div></div>' +
        '<div class="summary-item"><div class="summary-val">' + fmt(recalc.totalDrive+recalc.totalStop) + '</div><div class="summary-lbl">⏱ Total</div></div>' +
      '</div>' + stopRows +
      (route.returnHome ? '<div class="return-block"><span>🏠 Return to ' + esc(route.retAddr||route.startAddr) + '</span><span>' + recalc.retMiles.toFixed(1) + ' mi · ' + fmt(recalc.retMins) + ' · arrive ' + recalc.retArrival + '</span></div>' : '') +
      '</body></html>');
    win.document.close();
  }

  async function addNearbyToRoute(company) {
    try {
      const visit = await api.scheduleVisit(company.id);
      showToast(`${company.name} added to Visit Queue`);
      const data = await api.visitsAll();
      setVisits(data);
      const t = {...stopTimes}, o = [...order];
      data.forEach(v => { if (!t[v.id]) t[v.id]=20; if (!o.includes(v.id)) o.push(v.id); });
      setStopTimes(t); setOrder(o);
      setSelected(prev => new Set([...prev, visit.id]));
    } catch(e) { showToast(e.message, 'error'); }
  }

  const today = new Date().toISOString().split('T')[0];

  if (loading) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'calc(100vh - 54px)',minHeight:0,overflow:'hidden'}}>

      {/* TOP BAR */}
      <div style={{flexShrink:0,borderBottom:'1px solid var(--gray-200)',background:'white'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 20px 0',gap:12}}>
          <div>
            <div className="page-title" style={{fontSize:16}}>🗺️ Route Planner</div>
            <ForecastStrip forecast={forecast} queueKey="visits" />
            {route && (
              <div className="page-subtitle">
                {route.stops.length} stops · {route.totalMiles.toFixed(1)} mi · {fmt(route.totalDrive+route.totalStop)} total
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:8}}>
            {route && <button className="btn btn-ghost btn-sm" onClick={()=>setRoute(null)}>← Edit Stops</button>}
            {route && <button className="btn btn-ghost btn-sm" onClick={printRoute}>🖨️ Print</button>}
          </div>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:16,padding:'10px 20px 12px',flexWrap:'wrap'}}>
          {/* Start address */}
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',whiteSpace:'nowrap'}}>FROM</span>
            <div style={{display:'flex',gap:3}}>
              {[{k:'gps',l:'📍 GPS'},{k:'address',l:'🏠 Address'}].map(o=>(
                <button key={o.k} onClick={()=>setStartMode(o.k)}
                  className={`btn btn-sm ${startMode===o.k?'btn-navy':'btn-ghost'}`}
                  style={{fontSize:11,padding:'3px 10px'}}>{o.l}</button>
              ))}
            </div>
            {startMode==='address' && (
              <div style={{width:280}}>
                <AddressAutocomplete value={startAddr} onChange={setStartAddr}
                  onSelect={({display})=>setStartAddr(display)} placeholder="Starting address…"/>
              </div>
            )}
            {startMode==='gps' && (
              <span style={{fontSize:11,color:'var(--gray-500)',padding:'4px 8px',background:'var(--gray-50)',borderRadius:6,border:'1px solid var(--gray-200)'}}>
                {myGps ? `📍 ${myGps.lat.toFixed(3)}, ${myGps.lng.toFixed(3)}` : '⏳ Getting location…'}
              </span>
            )}
          </div>

          <div style={{width:1,height:24,background:'var(--gray-200)',flexShrink:0}}/>

          {/* Depart time */}
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',whiteSpace:'nowrap'}}>DEPART</span>
            <div style={{display:'flex',gap:3}}>
              {[{k:'now',l:'⏱️ Now'},{k:'custom',l:'🕐 Custom'}].map(o=>(
                <button key={o.k} onClick={()=>{ setTimeMode(o.k); if(o.k==='now'&&route){ const t=nowTimeStr(); setStartTime(t); setRoute(r=>({...r,startTime:t})); } }}
                  className={`btn btn-sm ${timeMode===o.k?'btn-navy':'btn-ghost'}`}
                  style={{fontSize:11,padding:'3px 10px'}}>{o.l}</button>
              ))}
            </div>
            {timeMode==='custom' && (
              <input className="form-input" type="time" value={startTime}
                onChange={e=>{ setStartTime(e.target.value); if(route) setRoute(r=>({...r,startTime:e.target.value})); }}
                style={{width:120,padding:'3px 8px',fontSize:12}}/>
            )}
          </div>

          <div style={{width:1,height:24,background:'var(--gray-200)',flexShrink:0}}/>

          {/* Options */}
          <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
            <label style={{display:'flex',alignItems:'center',gap:5,cursor:'pointer',fontSize:12,color:'var(--gray-700)',whiteSpace:'nowrap'}}>
              <input type="checkbox" checked={autoOpt} onChange={e=>setAutoOpt(e.target.checked)} style={{accentColor:'var(--gold-500)'}}/>
              Auto-optimize
            </label>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:12,color:'var(--gray-500)',whiteSpace:'nowrap'}}>End at:</span>
              {[{k:'none',l:'✕ None'},{k:'home',l:'🏠 Shop'},{k:'custom',l:'📌 Custom'}].map(o=>(
                <button key={o.k} onClick={()=>{ setEndMode(o.k); if(o.k!=='custom') setEndAddr(''); }}
                  className={'btn btn-sm '+(endMode===o.k?'btn-navy':'btn-ghost')}
                  style={{fontSize:11,padding:'3px 9px'}}>{o.l}</button>
              ))}
            </div>
            {endMode==='custom' && (
              <div style={{width:260}}>
                <AddressAutocomplete value={endAddr} onChange={setEndAddr}
                  onSelect={({display})=>setEndAddr(display)} placeholder="Custom end address…" inputClass="form-input"/>
              </div>
            )}
          </div>

          {!route && (
            <button className="btn btn-primary" style={{marginLeft:'auto',whiteSpace:'nowrap'}}
              onClick={buildRoute} disabled={planning||selected.size===0}>
              {planning ? (
                <span style={{display:'flex',alignItems:'center',gap:6}}>
                  <span style={{width:12,height:12,border:'2px solid rgba(0,0,0,.2)',borderTopColor:'var(--navy-950)',borderRadius:'50%',display:'inline-block',animation:'spin .7s linear infinite'}}/>
                  {planStep||'Planning…'}
                </span>
              ) : `🗺️ Plan Route — ${selected.size} stop${selected.size!==1?'s':''}`}
            </button>
          )}
        </div>
      </div>

      {error && <div style={{padding:'8px 20px',background:'#fef2f2',borderBottom:'1px solid #fca5a5',color:'#dc2626',fontSize:13,flexShrink:0}}>❌ {error}</div>}

      {/* BODY */}
      <div style={{flex:1,minHeight:0,display:'grid',gridTemplateColumns:'300px 1fr',overflow:'hidden'}}>

        {/* LEFT: Stop list OR timeline */}
        <div style={{display:'flex',flexDirection:'column',borderRight:'1px solid var(--gray-200)',overflow:'hidden'}}>

          {/* STOP SELECTOR */}
          {!route && (
            <>
              <div style={{padding:'10px 12px',borderBottom:'1px solid var(--gray-200)',flexShrink:0}}>
                <QueueFilter value={stopFilter} onChange={setStopFilter} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderBottom:'1px solid var(--gray-200)',flexShrink:0}}>
                {(() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate()+7);
                  const weekEndStr = weekEnd.toISOString().split('T')[0];
                  const filteredVisits = visits.filter(v => {
                    if (stopFilter==='today')  return v.scheduled_date <= todayStr;
                    if (stopFilter==='week')   return v.scheduled_date <= weekEndStr;
                    if (stopFilter==='month')  { const me=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().split('T')[0]; return v.scheduled_date <= me; }
                    if (stopFilter==='custom') return (!customFrom||v.scheduled_date>=customFrom)&&(!customTo||v.scheduled_date<=customTo);
                    return true;
                  });
                  return <>
                    <input type="checkbox"
                      checked={filteredVisits.length>0 && filteredVisits.every(v=>selected.has(v.id))}
                      onChange={()=>{
                        const allSel = filteredVisits.every(v=>selected.has(v.id));
                        const next = new Set(selected);
                        filteredVisits.forEach(v => allSel ? next.delete(v.id) : next.add(v.id));
                        setSelected(next);
                      }}
                      style={{width:15,height:15,accentColor:'var(--gold-500)',cursor:'pointer'}}/>
                    <span style={{fontWeight:700,fontSize:13}}>Select Stops</span>
                    <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>{selected.size} selected · {filteredVisits.length} shown</span>
                  </>;
                })()}
              </div>

              {visits.length===0 ? (
                <div className="empty-state" style={{flex:1}}>
                  <div className="icon">📭</div>
                  <div className="title">No visits scheduled</div>
                  <div className="desc">Log a call with "Visit" as next action</div>
                </div>
              ) : (
                <div style={{overflowY:'auto',flex:1}}>
                  {(() => {
                    const todayStr = new Date().toISOString().split('T')[0];
                    const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate()+7);
                    const weekEndStr = weekEnd.toISOString().split('T')[0];
                    const filteredIds = order.filter(id => {
                      const v = visits.find(v=>v.id===id); if(!v) return false;
                      if (stopFilter==='today')  return v.scheduled_date <= todayStr;
                      if (stopFilter==='week')   return v.scheduled_date <= weekEndStr;
                      if (stopFilter==='month')  { const me=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).toISOString().split('T')[0]; return v.scheduled_date <= me; }
                      if (stopFilter==='custom') return (!customFrom||v.scheduled_date>=customFrom)&&(!customTo||v.scheduled_date<=customTo);
                      return true;
                    });
                    if (filteredIds.length === 0) return (
                      <div style={{padding:'24px',textAlign:'center',color:'var(--gray-400)',fontSize:12}}>
                        No visits in this range
                        <div style={{marginTop:8}}><button className="btn btn-ghost btn-sm" onClick={()=>setStopFilter('all')}>Show all</button></div>
                      </div>
                    );
                    return filteredIds.map((id, idx) => {
                      const v = visits.find(v=>v.id===id); if(!v) return null;
                      const isOver = v.scheduled_date < todayStr;
                      const isToday = v.scheduled_date === todayStr;
                      const isSel = selected.has(v.id);
                      return (
                        <div key={v.id} onClick={()=>toggleStop(v.id)}
                          style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--gray-100)',cursor:'pointer',
                            background:isSel?'#fffbeb':'white',opacity:isSel?1:.55,
                            borderLeft:`3px solid ${isSel?'var(--gold-500)':'transparent'}`}}>
                          <input type="checkbox" checked={isSel} onChange={()=>toggleStop(v.id)}
                            onClick={e=>e.stopPropagation()}
                            style={{width:14,height:14,accentColor:'var(--gold-500)',cursor:'pointer',flexShrink:0,marginTop:3}}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                              <div
                                style={{fontWeight:600,fontSize:13,color:'var(--navy-700)',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted',textUnderlineOffset:3,display:'inline'}}
                                onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+v.entity_id); }}
                              >{v.entity_name}</div>
                              <div style={{display:'flex',gap:2,flexShrink:0,marginLeft:6}} onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>moveUp(id)} disabled={idx===0}
                                  style={{padding:'0 5px',border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:10,opacity:idx===0?.3:1}}>↑</button>
                                <button onClick={()=>moveDown(id)} disabled={idx===filteredIds.length-1}
                                  style={{padding:'0 5px',border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:10,opacity:idx===filteredIds.length-1?.3:1}}>↓</button>
                              </div>
                            </div>
                            <div style={{fontSize:11,color:v.address?'var(--gray-400)':'#dc2626',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              {v.address ? `${v.address}${v.city?', '+v.city:''}` : '⚠️ No address'}
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:5}} onClick={e=>e.stopPropagation()}>
                              {isOver  && <span className="badge badge-overdue">Overdue</span>}
                              {isToday && <span className="badge badge-today">Today</span>}
                              {!isOver && !isToday && v.scheduled_date && <span style={{fontSize:11,color:'var(--gray-500)'}}>Due {fmtDate(v.scheduled_date)}</span>}
                              <div style={{display:'flex',alignItems:'center',gap:3,marginLeft:'auto'}}>
                                <button onClick={()=>setStopTimes(p=>({...p,[v.id]:Math.max(5,(stopTimes[v.id]||20)-5)}))}
                                  style={{width:18,height:18,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:12,lineHeight:1,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
                                <span style={{fontWeight:700,fontSize:12,minWidth:28,textAlign:'center'}}>{stopTimes[v.id]||20}m</span>
                                <button onClick={()=>setStopTimes(p=>({...p,[v.id]:Math.min(240,(stopTimes[v.id]||20)+5)}))}
                                  style={{width:18,height:18,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:12,lineHeight:1,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
                              </div>
                            </div>
                            <div style={{display:'flex',gap:4,marginTop:6,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
                              <RowActions
                                companyStatus={v.company_status || 'prospect'}
                                onStatusChange={async status => { await api.updateCompanyStatus(v.entity_id, status); const d=await api.visitsAll(); setVisits(d); }}
                                onMove={() => setMovingId(v.entity_id)}
                              />
                              <button className="btn btn-sm btn-primary" style={{flex:1,fontSize:10,padding:'3px 0'}}
                                onClick={()=>{ setLogForm({contact_type:'',notes:'',contact_name:'',direct_line:'',next_action:'Call'}); setLoggingStop(v.id); }}>
                                ✅ Log Visit
                              </button>
                              <button className="btn btn-sm btn-ghost" style={{fontSize:10,padding:'3px 8px',color:'#dc2626',border:'1px solid #fca5a5'}}
                                onClick={async e=>{ e.stopPropagation(); if(!confirm('Cancel this scheduled visit?')) return;
                                  try { await api.cancelVisit(v.id); const d=await api.visitsAll(); setVisits(d); await refreshCounts(); showToast('Visit cancelled'); }
                                  catch(err){ showToast(err.message,'error'); }
                                }}>✕ Cancel</button>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </>
          )}

          {/* DAY TIMELINE */}
          {route && (() => {
            const recalc = recalcTimeline(route.stops, routeStopMins, route.startTime, route.startGeo, route.returnHome, arriveAt);
            const liveStops = recalc.stops;
            const [dh,dm] = route.startTime.split(':').map(Number);
            const nowMin = new Date().getHours()*60+new Date().getMinutes();
            const minsUntil = (dh*60+dm) - nowMin;
            return (
              <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0}}>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderBottom:'1px solid var(--gray-200)',flexShrink:0}}>
                  {[{icon:'📍',val:liveStops.length,lbl:'Stops'},{icon:'📏',val:recalc.totalMiles.toFixed(1),lbl:'Miles'},{icon:'🚗',val:fmt(recalc.totalDrive),lbl:'Drive'},{icon:'⏱️',val:fmt(recalc.totalDrive+recalc.totalStop),lbl:'Total'}].map(s=>(
                    <div key={s.lbl} style={{padding:'8px 0',textAlign:'center',borderRight:'1px solid var(--gray-100)'}}>
                      <div style={{fontSize:14,fontWeight:800}}>{s.val}</div>
                      <div style={{fontSize:10,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.04em'}}>{s.icon} {s.lbl}</div>
                    </div>
                  ))}
                </div>
                <div style={{padding:'6px 12px',borderBottom:'1px solid var(--gray-200)',flexShrink:0,background:'var(--gray-50)',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:11,color:'var(--gray-600)'}}>
                    🕐 <b>{fmtTime((() => { const d=new Date(); d.setHours(dh,dm,0,0); return d; })())}</b> depart
                    {route.returnHome && <> · 🏁 <b>{recalc.retArrival}</b></>}
                  </span>
                  {minsUntil>0 && <span style={{fontSize:10,padding:'2px 7px',borderRadius:8,background:'#eff6ff',color:'#1e40af',fontWeight:700,marginLeft:'auto'}}>{minsUntil>=60?`${Math.floor(minsUntil/60)}h${minsUntil%60}m`:`${minsUntil}m`} to go</span>}
                </div>
                <div style={{overflowY:'auto',flex:1}}>
                  {/* Depart row */}
                  <div style={{display:'flex',gap:8,padding:'9px 12px',borderBottom:'1px solid var(--gray-100)',background:'var(--navy-950)'}}>
                    <div style={{width:26,height:26,borderRadius:'50%',background:'var(--gold-500)',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>🏠</div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',justifyContent:'space-between'}}>
                        <span style={{fontWeight:700,fontSize:12,color:'white'}}>Depart</span>
                        <span style={{fontWeight:700,fontSize:11,color:'var(--gold-400)'}}>{fmtTime((() => { const d=new Date(); d.setHours(dh,dm,0,0); return d; })())}</span>
                      </div>
                      <div style={{fontSize:10,color:'rgba(255,255,255,.35)'}}>{route.startAddr}</div>
                    </div>
                  </div>

                  {liveStops.map((stop, i) => {
                    const stopMins = routeStopMins[stop.id] ?? stop.stopMins ?? 20;
                    const target = arriveAt[stop.id];
                    const info = target ? computeArriveAtInfo(i, target, liveStops, routeStopMins, route.startTime, timeMode) : null;
                    const bufferOk = info ? info.bufferMin >= 0 : true;
                    return (
                      <div key={stop.id}>
                        <div style={{padding:'2px 12px 2px 46px',background:'#f8fafc',fontSize:10,color:'var(--gray-400)',borderBottom:'1px solid var(--gray-100)'}}>
                          🚗 {(stop.driveMiles||0).toFixed(1)} mi · {fmt(stop.driveMinutes)}
                        </div>
                        <div style={{padding:'9px 12px',borderBottom:'1px solid var(--gray-100)',borderLeft:`3px solid ${target?bufferOk?'#22c55e':'#ef4444':'transparent'}`}}>
                          <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:2,flexShrink:0}}>
                              <div style={{width:26,height:26,borderRadius:'50%',background:'var(--gold-500)',color:'var(--navy-950)',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:11}}>{i+1}</div>
                              <button disabled={i===0} onClick={()=>setRoute(r=>{ const s=[...r.stops]; [s[i-1],s[i]]=[s[i],s[i-1]]; return {...r,stops:s}; })}
                                style={{width:20,height:16,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:9,opacity:i===0?.25:1,padding:0}}>↑</button>
                              <button disabled={i===liveStops.length-1} onClick={()=>setRoute(r=>{ const s=[...r.stops]; [s[i],s[i+1]]=[s[i+1],s[i]]; return {...r,stops:s}; })}
                                style={{width:20,height:16,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:9,opacity:i===liveStops.length-1?.25:1,padding:0}}>↓</button>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:6}}>
                                <div
                                  style={{fontWeight:700,fontSize:12,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--navy-700)',cursor:'pointer',textDecoration:'underline',textDecorationStyle:'dotted',textUnderlineOffset:2}}
                                  onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+stop.companyId); }}
                                >{stop.name}</div>
                                <div style={{textAlign:'right',fontSize:10,lineHeight:1.7,flexShrink:0}}>
                                  <div style={{color:'#15803d',fontWeight:700}}>▶ {stop.arriveTime}</div>
                                  <div style={{color:'#dc2626'}}>◀ {stop.leaveTime}</div>
                                </div>
                              </div>
                              <div style={{fontSize:10,color:'var(--gray-400)',marginTop:1}}>{stop.address}{stop.city?', '+stop.city:''}</div>
                              <div style={{display:'flex',gap:5,marginTop:6,alignItems:'center',flexWrap:'wrap'}}>
                                <button onClick={()=>setRouteStopMins(p=>({...p,[stop.id]:Math.max(5,stopMins-5)}))} style={{width:18,height:18,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:12,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>−</button>
                                <span style={{fontWeight:700,fontSize:11,minWidth:26,textAlign:'center'}}>{stopMins}m</span>
                                <button onClick={()=>setRouteStopMins(p=>({...p,[stop.id]:Math.min(240,stopMins+5)}))} style={{width:18,height:18,border:'1px solid var(--gray-200)',borderRadius:3,background:'white',cursor:'pointer',fontSize:12,padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>+</button>
                                <span style={{width:1,height:14,background:'var(--gray-200)',margin:'0 2px'}}/>
                                <span style={{fontSize:10,color:'var(--gray-500)'}}>arrive at:</span>
                                <input type="time" value={target||''}
                                  onChange={e=>setArriveAt(p=>({...p,[stop.id]:e.target.value||undefined}))}
                                  style={{fontSize:10,padding:'1px 4px',border:`1.5px solid ${target?bufferOk?'#22c55e':'#ef4444':'var(--gray-200)'}`,borderRadius:4,color:target?bufferOk?'#15803d':'#dc2626':'var(--gray-500)',background:target?bufferOk?'#f0fdf4':'#fef2f2':'white'}}/>
                                {target && <button onClick={()=>setArriveAt(p=>{ const n={...p}; delete n[stop.id]; return n; })} style={{fontSize:11,color:'var(--gray-400)',background:'none',border:'none',cursor:'pointer',padding:'0 2px'}}>✕</button>}
                              </div>
                              <div style={{display:'flex',gap:5,marginTop:8}}>
                                <button className="btn btn-primary btn-sm" style={{flex:1,fontSize:11,padding:'6px 0',fontWeight:700}}
                                  onClick={()=>window.open(getNavUrl(stop),'_blank')}>🚗 Navigate</button>
                                <button className="btn btn-ghost btn-sm" style={{flex:1,fontSize:11,padding:'6px 0'}}
                                  onClick={async()=>{ setLoggingStop(stop.id); try { const qs=await api.visitQueueStatus(stop.companyId||stop.id); setQueueStatus(qs); } catch(_){ setQueueStatus(null); } }}>✅ Log</button>
                                <button style={{fontSize:10,padding:'6px 8px',background:'white',border:'1px solid #fca5a5',color:'#dc2626',borderRadius:5,cursor:'pointer'}}
                                  onClick={()=>{ const ns=route.stops.filter(s=>s.id!==stop.id); const nm={...routeStopMins}; delete nm[stop.id]; setRouteStopMins(nm); if(ns.length===0){setRoute(null);return;} setRoute(r=>({...r,stops:ns})); }}>✕</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {route.returnHome && (
                    <>
                      <div style={{padding:'2px 12px 2px 46px',background:'#f8fafc',fontSize:10,color:'var(--gray-400)',borderBottom:'1px solid var(--gray-100)'}}>
                        🚗 {recalc.retMiles.toFixed(1)} mi · {fmt(recalc.retMins)} back
                      </div>
                      <div style={{display:'flex',gap:8,padding:'9px 12px',background:'#f0fdf4'}}>
                        <div style={{width:26,height:26,borderRadius:'50%',background:'#15803d',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>{route.endMode==='custom'?'📌':'🏠'}</div>
                        <div style={{flex:1}}>
                          <div style={{display:'flex',justifyContent:'space-between'}}>
                            <span style={{fontWeight:700,fontSize:12,color:'#14532d'}}>{route.endMode==='custom'?'End Destination':'Back to Shop'}</span>
                            <span style={{fontWeight:700,fontSize:11,color:'#15803d'}}>{recalc.retArrival}</span>
                          </div>
                          <div style={{fontSize:10,color:'#4ade80'}}>{route.retAddr||route.startAddr}</div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* RIGHT: Map */}
        <div style={{position:'relative',overflow:'hidden',minWidth:0}}>
          <PersistentMap
            routeStops={route ? (() => { const r=recalcTimeline(route.stops,routeStopMins,route.startTime,route.startGeo,route.returnHome); return r.stops; })() : []}
            startGeo={route?.startGeo || null}
            returnHome={route?.returnHome || false}
            nearbyCompanies={nearbyMapped.filter(c => {
              if (!c.geoOk) return false;
              if (nearbyFilter !== 'all' && c.priority !== nearbyFilter) return false;
              return true;
            })}
            onAddNearby={async(comp)=>{
              try {
                if (route) {
                  const tempId = 'nearby_' + comp.id + '_' + Date.now();
                  showToast('📍 Locating ' + comp.name + '…');
                  let lat = comp.lat, lng = comp.lng;
                  if (!lat || !lng) {
                    const result = await geocodeViaBackend(comp.id);
                    if (result) { lat = result.lat; lng = result.lng; }
                  }
                  const newStop = { id:tempId, name:comp.name, address:comp.address||'', city:comp.city||'', lat, lng, geoOk:!!(lat&&lng), driveMiles:0, driveMinutes:0, stopMins:20, visitId:null, companyId:comp.id, stopNum:route.stops.length+1 };
                  setRouteStopMins(p=>({...p,[tempId]:20}));
                  setRoute(r => {
                    const allStops = [...r.stops, newStop];
                    if (autoOpt) {
                      const reordered = optimize(r.startGeo, allStops, r.endGeo||null);
                      return { ...r, stops: reordered.map((s,i) => ({...s, stopNum:i+1})) };
                    }
                    return { ...r, stops: allStops };
                  });
                  showToast('✅ ' + comp.name + ' added');
                } else {
                  await addNearbyToRoute(comp);
                }
              } catch(e){ showToast(e.message,'error'); }
            }}
          />

          {/* Nearby filter pills */}
          <div style={{position:'absolute',top:10,right:10,zIndex:1000}}>
            <div style={{display:'flex',gap:4,background:'rgba(255,255,255,.92)',backdropFilter:'blur(6px)',borderRadius:20,padding:'5px 8px',boxShadow:'0 2px 10px rgba(0,0,0,.15)'}}>
              {[{k:'all',l:'All'},{k:'hot',l:'🔴 Drop In'},{k:'warm',l:'🟡 Due Soon'},{k:'good',l:'🟢 Recent'},{k:'none',l:'⚪ No Contact'}].map(f=>(
                <button key={f.k} onClick={()=>setNearbyFilter(f.k)}
                  style={{padding:'3px 10px',borderRadius:14,fontSize:11,fontWeight:700,cursor:'pointer',border:'none',
                    background:nearbyFilter===f.k?'var(--navy-800)':'transparent',
                    color:nearbyFilter===f.k?'white':'var(--gray-500)',transition:'all .12s'}}>
                  {f.l}
                </button>
              ))}
            </div>
            <div style={{marginTop:6,fontSize:10,color:'var(--gray-500)',textAlign:'right',padding:'2px 8px',background:'rgba(255,255,255,.8)',borderRadius:8}}>
              {nearbyMapped.length} companies on map
              {stillGeocoding > 0 && (
                <div style={{marginTop:4,fontSize:10,color:'var(--gray-400)'}}>
                 ⏳ locating {stillGeocoding} more…
               </div>
             )}
            </div>
          </div>

          {/* Google Maps link */}
          {route && (() => {
            const recalc = recalcTimeline(route.stops, routeStopMins, route.startTime, route.startGeo, route.returnHome, arriveAt);
            const url = `https://www.google.com/maps/dir/${encodeURIComponent(route.startAddr)}/${recalc.stops.map(s=>encodeURIComponent((s.address||s.name)+', '+(s.city||'Charlotte')+', NC')).join('/')}${route.returnHome?'/'+encodeURIComponent(route.startAddr):''}`;
            return (
              <a href={url} target="_blank" rel="noreferrer"
                style={{position:'absolute',bottom:24,right:10,zIndex:1000,background:'rgba(255,255,255,.92)',backdropFilter:'blur(6px)',borderRadius:10,padding:'5px 12px',fontSize:11,color:'#1d4ed8',fontWeight:700,textDecoration:'none',boxShadow:'0 2px 8px rgba(0,0,0,.15)'}}>
                Open in Google Maps ↗
              </a>
            );
          })()}
        </div>
      </div>

      {/* LOG VISIT MODAL */}
      {loggingStop && (() => {
        const routeStop = route?.stops?.find(s=>s.id===loggingStop);
        const queueVisit = !routeStop ? visits.find(v=>v.id===loggingStop) : null;
        const stop = routeStop || (queueVisit ? { id:queueVisit.id, name:queueVisit.entity_name, address:queueVisit.address||'', city:queueVisit.city||'', visitId:queueVisit.id, companyId:queueVisit.entity_id } : null);
        if (!stop) return null;
        const ctypes = contactTypes.filter(ct => ct.action_type==='visit' && ct.enabled!==0);
        const typeOptions = ctypes.map(ct=>ct.contact_type);
        return (
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.45)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}
            onClick={e=>{ if(e.target===e.currentTarget){ setLoggingStop(null); setQueueStatus(null); } }}>
            <div style={{background:'white',borderRadius:14,overflow:'hidden',boxShadow:'0 8px 40px rgba(0,0,0,.25)',maxWidth:560,width:'100%',maxHeight:'88vh',display:'flex',flexDirection:'column'}}>
              <div style={{background:'var(--navy-950)',padding:'14px 18px',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontWeight:800,fontSize:14,color:'white'}}>📍 Log Visit — {stop.name}</div>
                  <div style={{fontSize:11,color:'var(--gold-400)',marginTop:2}}>{stop.address}{stop.city?', '+stop.city:''}</div>
                </div>
                <button onClick={()=>{ setLoggingStop(null); setQueueStatus(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'rgba(255,255,255,.5)'}}>✕</button>
              </div>
              <div style={{overflowY:'auto',padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
                {queueStatus && (queueStatus.inCalling||queueStatus.inMail||queueStatus.inEmail) && (
                  <div style={{padding:'10px 12px',borderRadius:8,background:'#fffbeb',border:'1px solid #fde68a',fontSize:12}}>
                    <div style={{fontWeight:700,color:'#92400e',marginBottom:3}}>⚠ This company is currently in the <b>{queueStatus.inCalling?'Calling':queueStatus.inMail?'Mail':'Email'} Queue</b></div>
                    <div style={{color:'#78350f',fontSize:11,marginTop:4}}>Logging this visit will override it and move the company to whichever next action you choose below.</div>
                  </div>
                )}
                <div>
                  <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--gray-500)',marginBottom:7}}>What happened?</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                    {typeOptions.map(t=>(
                      <button key={t} onClick={()=>setLogForm(f=>({...f,contact_type:t}))}
                        style={{padding:'5px 11px',borderRadius:7,border:`1.5px solid ${logForm.contact_type===t?'var(--navy-700)':'var(--gray-200)'}`,background:logForm.contact_type===t?'var(--navy-800)':'white',color:logForm.contact_type===t?'white':'var(--gray-700)',fontSize:12,fontWeight:600,cursor:'pointer'}}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="form-group" style={{margin:0}}>
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} placeholder="What happened, who you talked to…" value={logForm.notes} onChange={e=>setLogForm(f=>({...f,notes:e.target.value}))}/>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">Who answered?</label>
                    <input className="form-input" placeholder="Name" value={logForm.contact_name} onChange={e=>setLogForm(f=>({...f,contact_name:e.target.value}))}/>
                  </div>
                  <div className="form-group" style={{margin:0}}>
                    <label className="form-label">Direct Line</label>
                    <input className="form-input" placeholder="555-0100" value={logForm.direct_line||''} onChange={e=>setLogForm(f=>({...f,direct_line:e.target.value}))}/>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:'var(--gray-500)',marginBottom:7}}>Next Action</div>
                  <div className="next-action-group">
                    {['Call','Visit','Mail','Email','Stop'].map(a=>(
                      <button key={a} className={`action-btn${logForm.next_action===a?a==='Stop'?' selected-stop':' selected-call':''}`}
                        onClick={()=>setLogForm(f=>({...f,next_action:a}))}>
                        {a==='Call'?'📞 ':a==='Visit'?'📍 ':a==='Mail'?'✉️ ':a==='Email'?'📧 ':'🚫 '}{a}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="btn btn-primary btn-lg" style={{width:'100%'}} disabled={logging||!logForm.contact_type}
                  onClick={async()=>{
                    setLogging(true);
                    try {
                      if (stop.visitId) {
                        await api.completeVisit(stop.visitId, { contact_type:logForm.contact_type, next_action:logForm.next_action, notes:logForm.notes, contact_name:logForm.contact_name, direct_line:logForm.direct_line||undefined, counts_as_attempt:contactTypes.find(ct=>ct.contact_type===logForm.contact_type)?.counts_as_attempt??1 });
                      } else if (stop.companyId) {
                        const vr = await api.scheduleVisit(stop.companyId);
                        await api.completeVisit(vr.id, { contact_type:logForm.contact_type, next_action:logForm.next_action, notes:logForm.notes, contact_name:logForm.contact_name, counts_as_attempt:1 });
                      }
                      showToast(`✅ ${stop.name} logged`);
                      if (routeStop) setRoute(r => r ? ({...r, stops:r.stops.filter(s=>s.id!==stop.id)}) : null);
                      setLoggingStop(null);
                      setLogForm(f=>({...f,contact_type:'',notes:'',contact_name:'',direct_line:''}));
                      const fresh = await api.visitsAll(); setVisits(fresh);
                      await refreshCounts();
                    } catch(e){ showToast(e.message||'Log failed','error'); }
                    finally { setLogging(false); }
                  }}>
                  {logging?'Saving…':(routeStop?'✅ Log & Remove from Route':'✅ Log Visit')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {movingId && (
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); api.visitsAll().then(d=>setVisits(d)); refreshCounts(); }}
        />
      )}
    </div>
  );
}

// ── Persistent Leaflet Map ────────────────────────────────────────────────────
function PersistentMap({ routeStops=[], startGeo=null, returnHome=false, nearbyCompanies=[], onAddNearby }) {
  const mapRef          = useRef(null);
  const mapInstanceRef  = useRef(null);
  const routeLayerRef   = useRef(null);
  const nearbyLayerRef  = useRef(null);
  const LRef            = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link'); link.id='leaflet-css'; link.rel='stylesheet';
      link.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(link);
    }
    let ro = null;
    import('leaflet').then(Lmod => {
      const L = Lmod.default || Lmod;
      LRef.current = L;
      if (mapInstanceRef.current) return;
      const map = L.map(mapRef.current, { zoomControl:true }).setView([35.2271, -80.8431], 10);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap', maxZoom:19 }).addTo(map);
      mapInstanceRef.current = map;
      routeLayerRef.current  = L.layerGroup().addTo(map);
      nearbyLayerRef.current = L.layerGroup().addTo(map);
      [50,150,300,600,1200].forEach(ms => setTimeout(() => { try { map.invalidateSize(); } catch(_){} }, ms));
      if (typeof ResizeObserver !== 'undefined' && mapRef.current) {
        ro = new ResizeObserver(() => { try { map.invalidateSize(); } catch(_){} });
        ro.observe(mapRef.current);
      }
    });
    return () => {
      if (ro) ro.disconnect();
      if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }
    };
  }, []);

  // Update route layer
  useEffect(() => {
    const map = mapInstanceRef.current; const L = LRef.current;
    if (!map || !L || !routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();
    const validStops = routeStops.filter(s => s.lat && s.lng);
    validStops.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: L.divIcon({ html:`<div style="width:30px;height:30px;border-radius:50%;background:#f59e0b;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:13px;color:#1e293b">${i+1}</div>`, className:'', iconAnchor:[15,15] }) })
        .addTo(routeLayerRef.current).bindPopup(`<b>${s.name}</b><br><span style="font-size:11px;color:#64748b">${s.address||''}</span>`);
    });
    if (startGeo?.lat) {
      L.marker([startGeo.lat, startGeo.lng], { icon: L.divIcon({ html:`<div style="width:22px;height:22px;border-radius:50%;background:#1e3a5f;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px">🏠</div>`, className:'', iconAnchor:[11,11] }) })
        .addTo(routeLayerRef.current).bindPopup('<b>🏠 Start / Shop</b>');
    }
    if (validStops.length >= 1 && startGeo?.lat) {
      const waypoints = [[startGeo.lat,startGeo.lng], ...validStops.map(s=>[s.lat,s.lng]), ...(returnHome?[[startGeo.lat,startGeo.lng]]:[])];
      const coords = waypoints.map(p=>`${p[1]},${p[0]}`).join(';');
      fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`, {headers:{'User-Agent':'FleetCRM/1.0'}})
        .then(r=>r.json())
        .then(d => {
          if (d.routes?.[0] && routeLayerRef.current) {
            const line = L.polyline(d.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]), {color:'#1e40af',weight:4,opacity:0.85});
            line.addTo(routeLayerRef.current); map.fitBounds(line.getBounds().pad(0.12));
          }
        })
        .catch(() => {
          const line = L.polyline(waypoints, {color:'#1e40af',weight:3,dashArray:'8 5',opacity:0.7});
          line.addTo(routeLayerRef.current); map.fitBounds(line.getBounds().pad(0.12));
        });
    } else if (validStops.length > 0) {
      map.fitBounds(L.latLngBounds(validStops.map(s=>[s.lat,s.lng])).pad(0.2));
    }
  }, [routeStops.map(s=>s.id+','+s.lat).join('|'), startGeo?.lat, returnHome]);

  // Update nearby layer
  useEffect(() => {
    const map = mapInstanceRef.current; const L = LRef.current;
    if (!map || !L || !nearbyLayerRef.current) return;
    nearbyLayerRef.current.clearLayers();
    Object.keys(window).filter(k=>k.startsWith('_addNearby_')).forEach(k=>delete window[k]);
    const PCOLOR = { hot:'#ef4444', warm:'#f59e0b', good:'#22c55e', none:'#94a3b8' };
    const PLBL   = { hot:'🔴 Drop In', warm:'🟡 Due Soon', good:'🟢 Recent', none:'⚪ No Contact' };
    const routeIds = new Set(routeStops.map(s => s.companyId ?? s.id));
    nearbyCompanies.filter(c => c.geoOk && c.lat && c.lng).forEach(c => {
      const col = PCOLOR[c.priority] || '#94a3b8';
      const isInRoute = routeIds.has(c.id);
      const lastContactDate = c.last_contacted ? new Date(c.last_contacted).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null;
      const followup = c.followup_due ? new Date(c.followup_due+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'}) : null;
      const popup = `<div style="min-width:210px;max-width:260px;font-family:system-ui,sans-serif">
        <div style="font-weight:800;font-size:13px;color:#0f172a;margin-bottom:2px">${c.name}</div>
        ${c.main_phone?`<div style="font-size:11px;color:#3b82f6;font-family:monospace;margin-bottom:3px">${c.main_phone}</div>`:''}
        ${c.address?`<div style="font-size:11px;color:#64748b;margin-bottom:4px">📍 ${c.address}${c.city?', '+c.city:''}</div>`:''}
        <span style="display:inline-block;padding:2px 8px;border-radius:10px;background:${col}22;border:1px solid ${col}55;font-size:10px;font-weight:700;color:${col};margin-bottom:5px">${PLBL[c.priority]}</span>
        ${lastContactDate?`<div style="font-size:11px;color:#475569;margin-bottom:3px">📞 <b>${c.last_contact_type||'Contacted'}</b> · ${lastContactDate}</div>`:`<div style="font-size:11px;color:#94a3b8;margin-bottom:3px">No contact yet</div>`}
        ${followup?`<div style="font-size:11px;color:#d97706;margin-bottom:3px">📅 Follow-up: <b>${followup}</b></div>`:''}
        ${c.last_notes?`<div style="font-size:11px;color:#475569;padding:4px 6px;background:#f8fafc;border-radius:4px;border-left:2px solid #e2e8f0;margin-bottom:5px;font-style:italic">"${c.last_notes.slice(0,80)}${c.last_notes.length>80?'…':''}"</div>`:''}
        ${!isInRoute&&onAddNearby?`<button onclick="window._addNearby_${c.id}&&window._addNearby_${c.id}()" style="margin-top:4px;width:100%;padding:6px 0;background:#f59e0b;border:none;border-radius:6px;cursor:pointer;font-weight:800;font-size:12px;color:#1e293b">+ Add to Route</button>`:`<div style="margin-top:4px;font-size:11px;color:#15803d;font-weight:700;text-align:center;padding:4px;background:#f0fdf4;border-radius:5px">✓ Already in route</div>`}
      </div>`;
      const marker = L.marker([c.lat, c.lng], { icon: L.divIcon({ html:`<div style="width:${isInRoute?18:12}px;height:${isInRoute?18:12}px;border-radius:50%;background:${isInRoute?'#1e40af':col};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer"></div>`, className:'', iconAnchor:[isInRoute?9:6,isInRoute?9:6] }) })
        .addTo(nearbyLayerRef.current).bindPopup(popup, {maxWidth:270});
      if (!isInRoute && onAddNearby) window[`_addNearby_${c.id}`] = () => { onAddNearby(c); map.closePopup(); };
    });
  }, [nearbyCompanies.map(c=>c.id+'@'+(c.geoOk?1:0)).join('|'), routeStops.map(s=>(s.companyId??s.id)+':'+s.id).join(',')]);

  return <div ref={mapRef} style={{position:'absolute',inset:0}} />;
}
