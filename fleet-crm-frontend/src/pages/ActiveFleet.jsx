/**
 * ACTIVE FLEET — fleet-crm-frontend/src/pages/ActiveFleet.jsx
 * Complete file — replace your existing one with this entirely.
 *
 * New in this version:
 *  - Auto-sync every 5 minutes, business hours only (Mon-Fri 7am-7pm)
 *  - Loading stage messages while syncing
 *  - Sync stats in header after sync completes
 *  - Next sync countdown in header
 *  - Removed 50-customer cap (backend handles all your businesses)
 */

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../App.jsx';
import { api } from '../api.js';

// ── DEMO DATA ─────────────────────────────────────────────────────────────────

// ── UTILS ─────────────────────────────────────────────────────────────────────
const f$       = c   => `$${(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const fDt      = iso => iso ? new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
const hrsIn    = iso => iso ? Math.floor((Date.now()-new Date(iso))/3600000) : 0;
const daySince = iso => iso ? Math.floor((Date.now()-new Date(iso))/86400000) : null;
function tis(u) { const h=hrsIn(u); if(h<1)return'< 1hr'; if(h<24)return`${h}h`; return`${Math.floor(h/24)}d ${h%24}h`; }
const OIL_KW = ['oil change','oil & filter','oil and filter','synthetic oil','full synthetic','lube'];
const isOil  = n => OIL_KW.some(k => n.toLowerCase().includes(k));
function lastOil(vid, ros) {
  const rs = ros.filter(r => r.vid===vid && r.sid===5 && r.jobs.some(j => j.auth && isOil(j.name)));
  if (!rs.length) return null;
  return rs.sort((a,b) => new Date(b.created)-new Date(a.created))[0].created;
}
const tkRoLink  = id  => `https://shop.tekmetric.com/repair-orders/${id}`;
const tkVehLink = id  => `https://shop.tekmetric.com/vehicles/${id}`;
const cfxLink   = vin => `https://www.carfax.com/VehicleHistory/p/Report.cfx?vin=${vin}`;

// ── SMALL COMPONENTS ──────────────────────────────────────────────────────────
function StatusBadge({ sid, statuses }) {
  const s = statuses.find(x => x.id===sid);
  if (!s) return null;
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,padding:'2px 8px',borderRadius:'var(--r-sm)',background:s.bg,color:s.color,fontSize:10.5,fontWeight:700,border:`1px solid ${s.color}33`,whiteSpace:'nowrap'}}>
      {s.name}
    </span>
  );
}
function ContactBadge({ method }) {
  const m = { Call:['📞','badge-blue'], Text:['💬','badge-blue'], Email:['📧','badge-blue'] };
  if (!method) return <span className="badge badge-gray">No contact</span>;
  const [ico, cls] = m[method] || ['•','badge-gray'];
  return <span className={`badge ${cls}`}>{ico} {method}</span>;
}
function IdleTag({ updated }) {
  const h = hrsIn(updated);
  if (h < 24) return null;
  return <span className="badge badge-overdue" style={{fontSize:9.5,marginLeft:4}}>⏱ {Math.floor(h/24)}d idle</span>;
}

// ── SHOP FLOOR ────────────────────────────────────────────────────────────────
function ShopFloor() {
  const [ros,       setRos]       = useState([]);
  const [statuses,  setStatuses]  = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles,  setVehicles]  = useState([]);
  const [employees, setEmployees] = useState([]);
  const [countdown, setCountdown] = useState(60);
  const [lastPoll,  setLastPoll]  = useState(null);
  const [polling,   setPolling]   = useState(false);

  async function pollShopFloor() {
    setPolling(true);
    try {
      const data = await api.tekmetricShopFloor();
      setRos(data.ros       || []);
      setStatuses(data.statuses   || []);
      setCompanies(data.companies || []);
      setVehicles(data.vehicles   || []);
      setEmployees(data.employees || []);
      setLastPoll(new Date());
    } catch(e) {
      console.error('[ShopFloor]', e.message);
    } finally {
      setPolling(false);
    }
  }

  // Poll on mount and every 60 seconds
  useEffect(() => {
    pollShopFloor();
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          pollShopFloor();
          return 60;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);
  const [sel,       setSel]       = useState(null);
  const [exp,       setExp]       = useState(null);
  const [dateField, setDateField] = useState('created');
  const [drRange,   setDrRange]   = useState('all');
  const [drStart,   setDrStart]   = useState('');
  const [drEnd,     setDrEnd]     = useState('');
  const gc = id => companies.find(c => c.id===id);
  const gv = id => vehicles.find(v => v.id===id);
  const ge = id => employees.find(e => e.id===id);
  const active = filterRange(ros.filter(r => r.sid!==5), drRange, drStart, drEnd, dateField);
  const filt   = sel ? active.filter(r => r.sid===sel) : active;
  const idle   = active.filter(r => hrsIn(r.updated)>24).length;
  const noct   = active.filter(r => !r.lastContact).length;
  const val    = active.reduce((s,r) => s+r.total, 0);
  const sids   = statuses.filter(s => active.some(r => r.sid===s.id));
  const rbg    = ro => { const h=hrsIn(ro.updated); return h>72?'row-overdue':h>24?'row-today':''; };
  return (
    <>
      <div style={{display:'flex',justifyContent:'flex-end',alignItems:'center',gap:8,marginBottom:8}}>
        {lastPoll && <span style={{fontSize:11,color:'var(--gray-400)'}}>Last updated: {lastPoll.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'})}</span>}
        <span style={{fontSize:11,color:polling?'var(--gold-500)':'var(--gray-400)',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:6,padding:'3px 10px'}}>
          {polling ? '⏳ Refreshing…' : `🔄 Next refresh in ${countdown}s`}
        </span>
        <button onClick={pollShopFloor} disabled={polling} className="btn btn-ghost btn-sm" style={{fontSize:11}}>
          Refresh Now
        </button>
      </div>
      <div className="stat-grid" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
        {[
          {l:'Active ROs',   v:active.length, c:''},
          {l:'Open Value',   v:f$(val),        c:'gold'},
          {l:'Idle > 24hrs', v:idle,           c:idle>0?'urgent':''},
          {l:'No Contact',   v:noct,           c:noct>0?'urgent':''},
        ].map(s=>(
          <div key={s.l} className="stat-card">
            <div className="stat-label">{s.l}</div>
            <div className={`stat-value ${s.c}`}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>setSel(null)} className="btn btn-sm"
          style={{background:!sel?'var(--navy-800)':'white',color:!sel?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
          All ({active.length})
        </button>
        {sids.map(s=>{
          const cnt = active.filter(r=>r.sid===s.id).length;
          const on  = sel===s.id;
          return (
            <button key={s.id} onClick={()=>setSel(on?null:s.id)} className="btn btn-sm"
              style={{background:on?s.color:'white',color:on?'white':s.color,border:`1px solid ${s.color}55`}}>
              {s.name} ({cnt})
            </button>
          );
        })}
        <span style={{marginLeft:'auto',fontSize:10.5,color:'var(--gray-400)'}}>🟡 24–72h &nbsp; 🔴 72h+</span>
      </div>
      <div style={{display:'flex',gap:6,marginBottom:14,flexWrap:'wrap',alignItems:'center',padding:'10px 14px',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:8}}>
        <span style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',textTransform:'uppercase',letterSpacing:'.05em',marginRight:4}}>Date field:</span>
        {[{k:'created',l:'Created'},{k:'promiseTime',l:'Promise Date'}].map(f=>(
          <button key={f.k} onClick={()=>setDateField(f.k)} className="btn btn-sm"
            style={{fontSize:11,background:dateField===f.k?'var(--navy-800)':'white',color:dateField===f.k?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
            {f.l}
          </button>
        ))}
        <div style={{width:1,height:18,background:'var(--gray-200)',margin:'0 6px'}}/>
        {DATE_RANGES.map(r=>(
          <button key={r.key} onClick={()=>setDrRange(r.key)} className="btn btn-sm"
            style={{fontSize:11,background:drRange===r.key?'var(--navy-800)':'white',color:drRange===r.key?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
            {r.label}
          </button>
        ))}
        {drRange==='custom'&&(
          <>
            <input type="date" value={drStart} onChange={e=>setDrStart(e.target.value)}
              style={{padding:'4px 8px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:11}}/>
            <span style={{fontSize:11,color:'var(--gray-500)'}}>→</span>
            <input type="date" value={drEnd} onChange={e=>setDrEnd(e.target.value)}
              style={{padding:'4px 8px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:11}}/>
          </>
        )}
        {drRange!=='all'&&(
          <button onClick={()=>{setDrRange('all');setDrStart('');setDrEnd('');}} className="btn btn-ghost btn-sm" style={{fontSize:11,marginLeft:'auto'}}>Clear</button>
        )}
      </div>
      <div className="table-card">
        <div className="table-card-header">
          <span className="table-card-title">🔧 Repair Orders in Shop</span>
          <span className="table-card-count">{filt.length} orders</span>
          <span style={{marginLeft:'auto',fontSize:10,color:'var(--gray-400)'}}>Custom Tekmetric statuses appear automatically</span>
        </div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>RO #</th><th>Company</th><th>Vehicle</th><th>Status</th><th>Time in Status</th><th>Technician</th><th>Advisor</th><th>Last Contact</th><th style={{textAlign:'right'}}>Value</th><th>Paid</th><th></th></tr>
            </thead>
            <tbody>
              {filt.map(ro => {
                const co=gc(ro.cid), veh=gv(ro.vid), tech=ge(ro.techId), sa=ge(ro.saId);
                const hrs=hrsIn(ro.updated), isEx=exp===ro.id, dec=ro.jobs.filter(j=>!j.auth);
                return (
                  <>
                    <tr key={ro.id} className={rbg(ro)} onClick={()=>setExp(isEx?null:ro.id)}>
                      <td>
                        <div style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--navy-800)',fontSize:13}}>#{ro.rn}</div>
                        <IdleTag updated={ro.updated}/>
                      </td>
                      <td>
                        <div style={{fontWeight:600}}>{co?.name||'—'}</div>
                        {dec.length>0&&<div style={{fontSize:10.5,color:'var(--red-500)',marginTop:2}}>⚠ {dec.length} declined job{dec.length>1?'s':''}</div>}
                      </td>
                      <td>
                        <div style={{fontWeight:500}}>{veh?`${veh.year} ${veh.make} ${veh.model}`:'—'}</div>
                        <div className="company-id">{veh?.plate}</div>
                      </td>
                      <td><StatusBadge sid={ro.sid} statuses={statuses}/></td>
                      <td>
                        <span style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:hrs>24?700:400,color:hrs>72?'var(--red-500)':hrs>24?'var(--yellow-500)':'var(--gray-500)'}}>
                          {tis(ro.updated)}
                        </span>
                      </td>
                      <td style={{fontSize:12.5}}>{tech?.name||<span style={{color:'var(--gray-300)'}}>Unassigned</span>}</td>
                      <td style={{fontSize:12.5}}>{sa?.name||'—'}</td>
                      <td>
                        <ContactBadge method={ro.contactMethod}/>
                        {ro.lastContact&&<div style={{fontSize:10.5,color:'var(--gray-400)',marginTop:3}}>{fDt(ro.lastContact)}</div>}
                      </td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:700}}>{f$(ro.total)}</td>
                      <td>
                        <span style={{fontFamily:'var(--font-mono)',fontSize:12,fontWeight:600,color:ro.paid>=ro.total&&ro.total>0?'var(--green-600)':'var(--red-500)'}}>
                          {ro.paid>=ro.total&&ro.total>0?'✓ Paid':'Unpaid'}
                        </span>
                      </td>
                      <td onClick={e=>e.stopPropagation()}>
                        <a href={tkRoLink(ro.id)} target="_blank" rel="noreferrer"
                          style={{color:'var(--blue-500)',fontSize:11,fontWeight:600,textDecoration:'none'}}>
                          View ↗
                        </a>
                      </td>
                    </tr>
                    {isEx&&(
                      <tr key={`e${ro.id}`} style={{background:'var(--gray-50)',cursor:'default'}}>
                        <td colSpan={11} style={{padding:'12px 18px'}}>
                          <div style={{fontWeight:700,fontSize:11,color:'var(--gray-400)',textTransform:'uppercase',letterSpacing:'.07em',marginBottom:8}}>Jobs on RO #{ro.rn}</div>
                          <div style={{display:'flex',flexDirection:'column',gap:6}}>
                            {ro.jobs.map((j,i)=>(
                              <div key={i} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderRadius:'var(--r-md)',background:j.auth?'var(--green-50)':'var(--red-50)',border:`1px solid ${j.auth?'var(--green-100)':'var(--red-100)'}`}}>
                                <div style={{display:'flex',alignItems:'center',gap:8}}>
                                  <span>{j.auth?'✅':'❌'}</span>
                                  <span style={{fontWeight:600,fontSize:13,color:j.auth?'var(--gray-800)':'var(--gray-400)'}}>{j.name}</span>
                                  {!j.auth&&<span className="badge badge-overdue" style={{fontSize:9.5}}>DECLINED</span>}
                                </div>
                                <div style={{display:'flex',gap:18,fontFamily:'var(--font-mono)',fontSize:12,color:'var(--gray-500)'}}>
                                  <span>Labor: {f$(j.labor)}</span>
                                  <span>Parts: {f$(j.parts)}</span>
                                  <span style={{fontWeight:700,color:'var(--gray-800)'}}>Total: {f$(j.labor+j.parts)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                          {dec.length>0&&(
                            <div style={{marginTop:8,padding:'7px 12px',background:'var(--red-50)',border:'1px solid var(--red-100)',borderRadius:'var(--r-md)',fontSize:12.5,color:'var(--red-500)',fontWeight:600}}>
                              ⚠ {f$(dec.reduce((s,j)=>s+j.labor+j.parts,0))} in declined revenue on this ticket
                            </div>
                          )}
                          <div style={{marginTop:10}}>
                            <a href={tkRoLink(ro.id)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Open in Tekmetric ↗</a>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {filt.length===0&&(
                <tr><td colSpan={11}>
                  <div className="empty-state"><div className="icon">🔧</div><div className="title">No orders in this status</div></div>
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── VEHICLES TAB ──────────────────────────────────────────────────────────────
function VehiclesTab({ ros, companies, vehicles, carfax, oilInterval, statuses }) {
  const [view,   setView]   = useState('fleet');
  const [selCo,  setSelCo]  = useState(companies[0]?.id);
  const [selVeh, setSelVeh] = useState(null);
  const [vState, setVState] = useState(()=>{
    const m={};
    vehicles.forEach(v=>{ m[v.id]={oilElsewhere:v.oilElsewhere,sold:v.sold}; });
    return m;
  });
  useEffect(()=>setSelVeh(null),[selCo]);
  const active = vehicles.filter(v=>!vState[v.id]?.sold);
  const co     = companies.find(c=>c.id===selCo);
  const cvs    = active.filter(v=>v.cid===selCo);
  const sv     = active.find(v=>v.id===selVeh);
  const togOil  = vid => setVState(s=>({...s,[vid]:{...s[vid],oilElsewhere:!s[vid].oilElsewhere}}));
  const markSold = vid => { setVState(s=>({...s,[vid]:{...s[vid],sold:true}})); setSelVeh(null); };
  const oilSt = vid => {
    if (vState[vid]?.oilElsewhere) return {st:'elsewhere',days:null,date:null};
    const d = lastOil(vid,ros);
    if (!d) return {st:'unknown',days:null,date:null};
    const days = daySince(d);
    if (days>=oilInterval)    return {st:'overdue',days,date:d};
    if (days>=oilInterval-14) return {st:'soon',days,date:d};
    return {st:'ok',days,date:d};
  };
  const oilColor = st => st==='overdue'?'var(--red-500)':st==='soon'?'var(--yellow-500)':st==='ok'?'var(--green-600)':'var(--gray-400)';
  const oilLabel = o  => o.st==='elsewhere'?'Done elsewhere':o.st==='unknown'?'No record':o.st==='overdue'?`${o.days}d ago — OVERDUE`:o.st==='soon'?`${o.days}d ago — Due soon`:`${o.days}d ago — OK`;
  const due = useMemo(()=>active
    .filter(v=>!vState[v.id]?.oilElsewhere)
    .map(v=>({...v,co:companies.find(c=>c.id===v.cid),oil:oilSt(v.id),cfx:carfax.find(a=>a.vid===v.id)}))
    .filter(v=>['overdue','soon','unknown'].includes(v.oil.st))
    .sort((a,b)=>{
      if(a.oil.st==='unknown'&&b.oil.st!=='unknown')return 1;
      if(b.oil.st==='unknown'&&a.oil.st!=='unknown')return -1;
      return(b.oil.days||0)-(a.oil.days||0);
    }),[active,vState,oilInterval]);
  return (
    <>
      <div style={{display:'flex',gap:6,marginBottom:16}}>
        <button onClick={()=>setView('fleet')} className="btn btn-sm"
          style={{background:view==='fleet'?'var(--navy-800)':'white',color:view==='fleet'?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
          🚛 Fleet Vehicles
        </button>
        <button onClick={()=>setView('due')} className="btn btn-sm"
          style={{background:view==='due'?'var(--red-500)':'white',color:view==='due'?'white':'var(--red-500)',border:'1px solid #fca5a555'}}>
          ⏰ Oil Change Due ({due.length})
        </button>
      </div>
      {view==='due'&&(
        <div className="table-card">
          <div className="table-card-header">
            <span className="table-card-title">⏰ Oil Change Call List</span>
            <span className="table-card-count">{due.length} vehicles</span>
            <span style={{marginLeft:'auto',fontSize:10.5,color:'var(--gray-400)'}}>Interval: {oilInterval} days · sorted by most overdue</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Vehicle</th><th>Company</th><th>Contact</th><th>Phone</th><th>Last Oil Change</th><th>Days Since</th><th>Carfax</th><th></th></tr></thead>
              <tbody>
                {due.map(v=>(
                  <tr key={v.id} className={v.oil.st==='overdue'?'row-overdue':v.oil.st==='soon'?'row-today':''}>
                    <td><div style={{fontWeight:600}}>{v.year} {v.make} {v.model}</div><div className="company-id">{v.plate}</div></td>
                    <td style={{fontWeight:500,fontSize:12.5}}>{v.co?.name||'—'}</td>
                    <td style={{fontSize:12.5}}>{v.co?.contact||'—'}</td>
                    <td><span style={{fontFamily:'var(--font-mono)',fontSize:12}}>{v.co?.phone||'—'}</span></td>
                    <td>{v.oil.date?fDt(v.oil.date):<span style={{color:'var(--gray-400)'}}>No record</span>}</td>
                    <td>
                      <span style={{fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13,color:oilColor(v.oil.st)}}>{v.oil.days!==null?`${v.oil.days}d`:'—'}</span>
                      {v.oil.st==='overdue'&&<div style={{fontSize:10,color:'var(--red-500)',fontWeight:700}}>OVERDUE</div>}
                      {v.oil.st==='soon'&&<div style={{fontSize:10,color:'var(--yellow-500)',fontWeight:700}}>DUE SOON</div>}
                      {v.oil.st==='unknown'&&<div style={{fontSize:10,color:'var(--gray-400)'}}>No history</div>}
                    </td>
                    <td>
                      {v.cfx?(
                        <div>
                          <span className="badge badge-overdue" style={{fontSize:9.5}}>⚠ Serviced elsewhere</span>
                          <div style={{fontSize:10.5,color:'var(--gray-500)',marginTop:2}}>{v.cfx.shop}</div>
                          <div style={{fontSize:10,color:'var(--gray-400)'}}>{fDt(v.cfx.date)}</div>
                        </div>
                      ):<span style={{fontSize:10.5,color:'var(--gray-400)'}}>No alerts</span>}
                    </td>
                    <td><button onClick={()=>togOil(v.id)} className="btn btn-ghost btn-sm" style={{fontSize:10.5}}>Not our customer</button></td>
                  </tr>
                ))}
                {due.length===0&&(
                  <tr><td colSpan={8}><div className="empty-state"><div className="icon">✅</div><div className="title">All caught up</div><div className="desc">No oil changes due</div></div></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {view==='fleet'&&(
        <div style={{display:'flex',gap:14,height:'calc(100vh - 220px)',overflow:'hidden'}}>
          <div style={{width:185,flexShrink:0,background:'white',border:'1px solid var(--gray-200)',borderRadius:'var(--r-lg)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'10px 13px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)',fontSize:10,fontWeight:700,letterSpacing:'.09em',textTransform:'uppercase',color:'var(--gray-400)'}}>Fleet Accounts</div>
            <div style={{overflowY:'auto',flex:1}}>
              {companies.map(c=>{
                const dueCount = active.filter(v=>v.cid===c.id&&!vState[v.id]?.oilElsewhere).filter(v=>{const o=oilSt(v.id);return o.st==='overdue'||o.st==='soon';}).length;
                return (
                  <div key={c.id} onClick={()=>setSelCo(c.id)}
                    style={{padding:'10px 13px',borderBottom:'1px solid var(--gray-100)',cursor:'pointer',borderLeft:`3px solid ${c.id===selCo?'var(--gold-500)':'transparent'}`,background:c.id===selCo?'#fffbeb':'transparent',transition:'all .1s'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{fontSize:12.5,fontWeight:600,color:c.id===selCo?'var(--navy-800)':'var(--gray-800)',lineHeight:1.3}}>{c.name}</div>
                      {dueCount>0&&<span className="badge badge-overdue" style={{fontSize:9,padding:'1px 5px'}}>{dueCount}</span>}
                    </div>
                    <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>{active.filter(v=>v.cid===c.id).length} vehicles</div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{width:210,flexShrink:0,background:'white',border:'1px solid var(--gray-200)',borderRadius:'var(--r-lg)',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'10px 13px',background:'var(--gray-50)',borderBottom:'1px solid var(--gray-200)'}}>
              <div style={{fontSize:12.5,fontWeight:700,color:'var(--gray-800)'}}>{co?.name}</div>
              <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>{cvs.length} active vehicles</div>
            </div>
            <div style={{overflowY:'auto',flex:1}}>
              {cvs.map(v=>{
                const oil=oilSt(v.id), hasOpen=ros.some(r=>r.vid===v.id&&[1,2,3].includes(r.sid)), cfx=carfax.find(a=>a.vid===v.id);
                return (
                  <div key={v.id} onClick={()=>setSelVeh(v.id)}
                    style={{padding:'10px 13px',borderBottom:'1px solid var(--gray-100)',cursor:'pointer',borderLeft:`3px solid ${v.id===selVeh?'var(--gold-500)':'transparent'}`,background:v.id===selVeh?'#fffbeb':'transparent',transition:'all .1s'}}>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <div>
                        <div style={{fontSize:12.5,fontWeight:600,color:'var(--gray-900)'}}>{v.year} {v.make}</div>
                        <div style={{fontSize:11.5,color:'var(--gray-500)'}}>{v.model}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2}}>
                        {hasOpen&&<span style={{width:7,height:7,borderRadius:'50%',background:'var(--gold-500)',display:'inline-block'}}/>}
                        {cfx&&<span style={{fontSize:9,color:'var(--red-500)',fontWeight:700}}>⚠CFX</span>}
                      </div>
                    </div>
                    <div className="company-id" style={{marginTop:3}}>{v.plate}</div>
                    <div style={{fontSize:10.5,marginTop:3,color:oilColor(oil.st),fontWeight:600}}>🛢 {oilLabel(oil)}</div>
                  </div>
                );
              })}
              {cvs.length===0&&<div className="empty-state" style={{padding:20}}><div className="desc">No active vehicles</div></div>}
            </div>
          </div>
          <div style={{flex:1,overflowY:'auto'}}>
            {!sv?(
              <div className="empty-state" style={{paddingTop:80}}>
                <div className="icon">🚛</div>
                <div className="title">Select a vehicle</div>
                <div className="desc">Click any vehicle to see its summary</div>
              </div>
            ):(()=>{
              const oil=oilSt(sv.id), cfx=carfax.find(a=>a.vid===sv.id);
              const vros=ros.filter(r=>r.vid===sv.id).sort((a,b)=>new Date(b.created)-new Date(a.created));
              return (
                <>
                  <div className="table-card" style={{marginBottom:14}}>
                    <div style={{padding:'16px 20px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:14}}>
                        <div>
                          <div style={{fontSize:17,fontWeight:800,color:'var(--gray-900)'}}>{sv.year} {sv.make} {sv.model}</div>
                          <div style={{fontSize:12,color:'var(--gray-500)',marginTop:3}}>{sv.color} · {co?.name}</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:700,color:'var(--navy-800)'}}>{sv.plate}</div>
                          <div className="company-id" style={{marginTop:3}}>{sv.vin}</div>
                        </div>
                      </div>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,paddingTop:12,borderTop:'1px solid var(--gray-100)',marginBottom:14}}>
                        {[
                          {l:'Total Visits', v:vros.length,                                                  c:'var(--navy-800)'},
                          {l:'Total Spent',  v:f$(vros.filter(r=>r.sid===5).reduce((s,r)=>s+r.total,0)),    c:'var(--green-600)'},
                          {l:'Open ROs',     v:vros.filter(r=>[1,2,3].includes(r.sid)).length,               c:'var(--gold-600)'},
                          {l:'Last Visit',   v:vros[0]?fDt(vros[0].created):'Never',                        c:'var(--gray-700)'},
                        ].map(s=>(
                          <div key={s.l}>
                            <div className="stat-label">{s.l}</div>
                            <div style={{fontSize:17,fontWeight:800,color:s.c,lineHeight:1.2,marginTop:4}}>{s.v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{padding:'11px 14px',borderRadius:'var(--r-lg)',background:oil.st==='overdue'?'var(--red-50)':oil.st==='soon'?'var(--yellow-50)':oil.st==='ok'?'var(--green-50)':'var(--gray-50)',border:`1px solid ${oil.st==='overdue'?'var(--red-100)':oil.st==='soon'?'var(--yellow-100)':oil.st==='ok'?'var(--green-100)':'var(--gray-200)'}`,marginBottom:10}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
                          <div>
                            <div style={{fontWeight:700,fontSize:12.5,color:oilColor(oil.st)}}>🛢 Oil Change</div>
                            <div style={{fontSize:12,color:'var(--gray-600)',marginTop:2}}>
                              {oil.st==='elsewhere'?'Marked as getting oil changes elsewhere'
                              :oil.st==='unknown'?'No oil change on record with us'
                              :oil.st==='overdue'?`Last oil change ${oil.days} days ago — overdue by ${oil.days-oilInterval} days`
                              :oil.st==='soon'?`Last oil change ${oil.days} days ago — due within ${oilInterval-oil.days} days`
                              :`Last oil change ${oil.days} days ago — OK`}
                            </div>
                            {oil.date&&<div style={{fontSize:11,color:'var(--gray-400)',marginTop:2}}>Last: {fDt(oil.date)}</div>}
                          </div>
                          <button onClick={()=>togOil(sv.id)} className="btn btn-ghost btn-sm">
                            {vState[sv.id]?.oilElsewhere?'✓ Done elsewhere (click to clear)':'Mark: oil changes elsewhere'}
                          </button>
                        </div>
                      </div>
                      {cfx&&(
                        <div style={{padding:'10px 14px',borderRadius:'var(--r-lg)',background:'var(--red-50)',border:'1px solid var(--red-100)',marginBottom:10}}>
                          <div style={{fontWeight:700,fontSize:12,color:'var(--red-500)',marginBottom:3}}>⚠ Carfax Alert — Serviced Elsewhere</div>
                          <div style={{fontSize:12.5,color:'var(--gray-700)'}}><strong>{cfx.service}</strong> at <strong>{cfx.shop}</strong> on {fDt(cfx.date)}</div>
                        </div>
                      )}
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <a href={tkVehLink(sv.id)} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Full History in Tekmetric ↗</a>
                        <a href={cfxLink(sv.vin)}  target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">Carfax Report ↗</a>
                        <button className="btn btn-danger btn-sm" style={{marginLeft:'auto'}}
                          onClick={()=>{ if(window.confirm(`Mark ${sv.year} ${sv.make} ${sv.model} as sold?`)) markSold(sv.id); }}>
                          Mark as Sold
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="table-card">
                    <div className="table-card-header">
                      <span className="table-card-title">Recent Repair Orders</span>
                      <span className="table-card-count">Last {Math.min(vros.length,5)} of {vros.length}</span>
                      <a href={tkVehLink(sv.id)} target="_blank" rel="noreferrer" style={{marginLeft:'auto',color:'var(--blue-500)',fontSize:11,fontWeight:600,textDecoration:'none'}}>Full history ↗</a>
                    </div>
                    {vros.slice(0,5).map(ro=>{
                      const dec=ro.jobs.filter(j=>!j.auth);
                      return (
                        <div key={ro.id} style={{borderBottom:'1px solid var(--gray-100)',padding:'12px 18px'}}>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:8}}>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <span style={{fontFamily:'var(--font-mono)',fontSize:13,fontWeight:700,color:'var(--navy-800)'}}>RO #{ro.rn}</span>
                              <StatusBadge sid={ro.sid} statuses={statuses}/>
                              {dec.length>0&&<span className="badge badge-overdue" style={{fontSize:9.5}}>{dec.length} declined</span>}
                              {ro.jobs.some(j=>j.auth&&isOil(j.name))&&<span className="badge" style={{fontSize:9.5,background:'#f0fdf4',color:'#15803d'}}>🛢 Oil Change</span>}
                            </div>
                            <div style={{display:'flex',alignItems:'center',gap:10}}>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:13}}>{f$(ro.total)}</div>
                                <div style={{fontSize:11,color:'var(--gray-400)'}}>{fDt(ro.created)}</div>
                              </div>
                              <a href={tkRoLink(ro.id)} target="_blank" rel="noreferrer" style={{color:'var(--blue-500)',fontSize:11,fontWeight:600,textDecoration:'none'}}>Open ↗</a>
                            </div>
                          </div>
                          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                            {ro.jobs.map((j,i)=>(
                              <span key={i} style={{fontSize:11.5,padding:'2px 8px',borderRadius:'var(--r-sm)',background:j.auth?'var(--green-50)':'var(--red-50)',color:j.auth?'var(--green-600)':'var(--red-500)',border:`1px solid ${j.auth?'var(--green-100)':'var(--red-100)'}`}}>
                                {j.auth?'✓':'✗'} {j.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {vros.length===0&&<div className="empty-state"><div className="desc">No repair orders on file</div></div>}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </>
  );
}

// ── SALES TAB ─────────────────────────────────────────────────────────────────
const DATE_RANGES = [
  {key:'today',label:'Today'},{key:'week',label:'This Week'},{key:'month',label:'This Month'},
  {key:'q',label:'This Quarter'},{key:'ytd',label:'YTD'},{key:'30',label:'Last 30d'},
  {key:'90',label:'Last 90d'},{key:'all',label:'All Time'},{key:'custom',label:'Custom Range'},
];
function filterRange(ros, range, customStart, customEnd, dateField = 'created') {
  if (range === 'all') return ros;
  if (range === 'custom') {
    const s = customStart ? new Date(customStart + 'T00:00:00') : null;
    const e = customEnd   ? new Date(customEnd   + 'T23:59:59') : null;
    return ros.filter(r => {
      const d = new Date(r[dateField] || r.created);
      if (s && d < s) return false;
      if (e && d > e) return false;
      return true;
    });
  }
  const now = new Date(), s = new Date();
  if      (range==='today') { s.setHours(0,0,0,0); }
  else if (range==='week')  { s.setDate(now.getDate()-now.getDay()); s.setHours(0,0,0,0); }
  else if (range==='month') { s.setDate(1); s.setHours(0,0,0,0); }
  else if (range==='q')     { s.setMonth(Math.floor(now.getMonth()/3)*3,1); s.setHours(0,0,0,0); }
  else if (range==='ytd')   { s.setMonth(0,1); s.setHours(0,0,0,0); }
  else if (range==='30')    { s.setDate(now.getDate()-30); }
  else if (range==='90')    { s.setDate(now.getDate()-90); }
  return ros.filter(r => new Date(r[dateField] || r.created) >= s);
}
function SalesTab({ ros, companies, vehicles, employees, statuses }) {
  const [range,       setRange]       = useState('ytd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd,   setCustomEnd]   = useState('');
  const [selCo, setSelCo] = useState(null);
  const gv = id => vehicles.find(v=>v.id===id);
  const ge = id => employees.find(e=>e.id===id);
  const filt = useMemo(()=>filterRange(ros,range,customStart,customEnd),[ros,range,customStart,customEnd]);
  const byco = useMemo(()=>companies.map(c=>{
    const cr=filt.filter(r=>r.cid===c.id), p=cr.filter(r=>r.sid===5);
    const dec=cr.flatMap(r=>r.jobs.filter(j=>!j.auth));
    return {...c,rev:p.reduce((s,r)=>s+r.total,0),labor:p.reduce((s,r)=>s+r.labor,0),parts:p.reduce((s,r)=>s+r.parts,0),open:cr.filter(r=>[1,2,3].includes(r.sid)).reduce((s,r)=>s+r.total,0),declined:dec.reduce((s,j)=>s+j.labor+j.parts,0),cnt:cr.length,avg:p.length?p.reduce((s,r)=>s+r.total,0)/p.length:0,allRos:cr};
  }).sort((a,b)=>b.rev-a.rev),[companies,filt]);
  const tot = byco.reduce((a,c)=>({rev:a.rev+c.rev,labor:a.labor+c.labor,parts:a.parts+c.parts,open:a.open+c.open,dec:a.dec+c.declined}),{rev:0,labor:0,parts:0,open:0,dec:0});
  const mx  = Math.max(...byco.map(c=>c.rev),1);
  const scd = byco.find(c=>c.id===selCo);
  return (
    <>
      <div style={{display:'flex',gap:5,marginBottom:range==='custom'?8:16,flexWrap:'wrap',alignItems:'center'}}>
        {selCo&&<button onClick={()=>setSelCo(null)} className="btn btn-ghost btn-sm">← All Companies</button>}
        {DATE_RANGES.map(r=>(
          <button key={r.key} onClick={()=>setRange(r.key)} className="btn btn-sm"
            style={{background:range===r.key?'var(--navy-800)':'white',color:range===r.key?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
            {r.label}
          </button>
        ))}
      </div>
      {range==='custom'&&(
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16,padding:'10px 14px',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:8,flexWrap:'wrap'}}>
          <span style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>From</span>
          <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
            style={{padding:'5px 10px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:12}}/>
          <span style={{fontSize:12,fontWeight:600,color:'var(--gray-600)'}}>To</span>
          <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
            style={{padding:'5px 10px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:12}}/>
          {(customStart||customEnd)&&(
            <button onClick={()=>{setCustomStart('');setCustomEnd('');}} className="btn btn-ghost btn-sm" style={{fontSize:11}}>Clear</button>
          )}
        </div>
      )}
      {selCo&&scd?(
        <>
          <div style={{marginBottom:14,padding:'12px 16px',background:'white',border:'1px solid var(--gray-200)',borderRadius:'var(--r-lg)',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
            <div>
              <div style={{fontSize:16,fontWeight:800}}>{scd.name}</div>
              <div style={{fontSize:12,color:'var(--gray-400)',marginTop:2}}>{scd.cnt} orders · {DATE_RANGES.find(r=>r.key===range)?.label}</div>
            </div>
            <div style={{display:'flex',gap:16,marginLeft:'auto',flexWrap:'wrap'}}>
              {[{l:'Revenue',v:f$(scd.rev),c:'var(--green-600)'},{l:'Labor',v:f$(scd.labor),c:'var(--navy-700)'},{l:'Parts',v:f$(scd.parts),c:'var(--gray-600)'},{l:'Open',v:f$(scd.open),c:'var(--gold-600)'},{l:'Declined',v:f$(scd.declined),c:'var(--red-500)'}].map(s=>(
                <div key={s.l} style={{textAlign:'center'}}>
                  <div style={{fontSize:9.5,fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:'var(--gray-400)',marginBottom:3}}>{s.l}</div>
                  <div style={{fontFamily:'var(--font-mono)',fontWeight:800,fontSize:15,color:s.c}}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="table-card">
            <div className="table-card-header">
              <span className="table-card-title">Repair Orders — {scd.name}</span>
              <span className="table-card-count">{scd.allRos.length} orders</span>
            </div>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>RO #</th><th>Vehicle</th><th>Status</th><th>Date</th><th>Tech</th><th>Advisor</th><th style={{textAlign:'right'}}>Labor</th><th style={{textAlign:'right'}}>Parts</th><th style={{textAlign:'right'}}>Total</th><th>Declined</th><th></th></tr></thead>
                <tbody>
                  {scd.allRos.sort((a,b)=>new Date(b.created)-new Date(a.created)).map(ro=>{
                    const veh=gv(ro.vid),tech=ge(ro.techId),sa=ge(ro.saId),dec=ro.jobs.filter(j=>!j.auth);
                    return (
                      <tr key={ro.id}>
                        <td><span style={{fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--navy-800)'}}>#{ro.rn}</span></td>
                        <td><div style={{fontWeight:500,fontSize:12}}>{veh?`${veh.year} ${veh.make} ${veh.model}`:'—'}</div><div className="company-id">{veh?.plate}</div></td>
                        <td><StatusBadge sid={ro.sid} statuses={statuses}/></td>
                        <td style={{fontSize:12,color:'var(--gray-500)'}}>{fDt(ro.created)}</td>
                        <td style={{fontSize:12}}>{tech?.name||'—'}</td>
                        <td style={{fontSize:12}}>{sa?.name||'—'}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--navy-700)'}}>{f$(ro.labor)}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontSize:12,color:'var(--gray-600)'}}>{f$(ro.parts)}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:700,fontSize:13}}>{f$(ro.total)}</td>
                        <td>{dec.length>0?(<div><span className="badge badge-overdue" style={{fontSize:9.5}}>{dec.length} job{dec.length>1?'s':''}</span><div style={{fontSize:10.5,color:'var(--red-500)',fontWeight:600}}>{f$(dec.reduce((s,j)=>s+j.labor+j.parts,0))}</div></div>):<span style={{color:'var(--gray-300)',fontSize:11}}>—</span>}</td>
                        <td onClick={e=>e.stopPropagation()}><a href={tkRoLink(ro.id)} target="_blank" rel="noreferrer" style={{color:'var(--blue-500)',fontSize:11,fontWeight:600,textDecoration:'none'}}>Open ↗</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ):(
        <>
          <div className="stat-grid" style={{gridTemplateColumns:'repeat(5,1fr)'}}>
            {[{l:'Posted Revenue',v:f$(tot.rev),c:'green'},{l:'Labor',v:f$(tot.labor),c:''},{l:'Parts',v:f$(tot.parts),c:''},{l:'Open Value',v:f$(tot.open),c:'gold'},{l:'Declined',v:f$(tot.dec),c:tot.dec>0?'urgent':''}].map(s=>(
              <div key={s.l} className="stat-card"><div className="stat-label">{s.l}</div><div className={`stat-value ${s.c}`} style={{fontSize:18}}>{s.v}</div></div>
            ))}
          </div>
          <div className="table-card">
            <div className="table-card-header">
              <span className="table-card-title">💰 Revenue by Fleet Account</span>
              <span className="table-card-count">{byco.filter(c=>c.cnt>0).length} active</span>
              <span style={{marginLeft:'auto',fontSize:10.5,color:'var(--gray-400)'}}>Click a company to see individual ROs</span>
            </div>
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Account</th><th style={{textAlign:'right'}}>Revenue</th><th style={{textAlign:'right'}}>Labor</th><th style={{textAlign:'right'}}>Parts</th><th style={{textAlign:'right'}}>Avg Ticket</th><th style={{textAlign:'right'}}>Open</th><th style={{textAlign:'right'}}>Declined</th><th style={{textAlign:'right'}}>ROs</th><th></th></tr></thead>
                <tbody>
                  {byco.map(co=>(
                    <tr key={co.id} onClick={()=>setSelCo(co.id)} style={{cursor:'pointer'}}>
                      <td>
                        <div style={{fontWeight:600}}>{co.name}</div>
                        <div style={{marginTop:5,height:3,background:'var(--gray-100)',borderRadius:3,width:120,overflow:'hidden'}}><div style={{height:'100%',width:`${(co.rev/mx)*100}%`,background:'var(--green-500)',borderRadius:3}}/></div>
                      </td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:700,color:'var(--green-600)'}}>{f$(co.rev)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--navy-700)'}}>{f$(co.labor)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--gray-600)'}}>{f$(co.parts)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',color:'var(--gray-700)'}}>{co.avg?f$(co.avg):'—'}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:co.open>0?700:400,color:co.open>0?'var(--gold-600)':'var(--gray-300)'}}>{f$(co.open)}</td>
                      <td style={{textAlign:'right',fontFamily:'var(--font-mono)',fontWeight:co.declined>0?700:400,color:co.declined>0?'var(--red-500)':'var(--gray-300)'}}>{f$(co.declined)}</td>
                      <td style={{textAlign:'right',color:'var(--gray-500)'}}>{co.cnt}</td>
                      <td><span style={{color:'var(--blue-500)',fontSize:11,fontWeight:600}}>Details →</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ── FLEET SETTINGS ────────────────────────────────────────────────────────────
function FleetSettings({ oilInterval, setOilInterval, statuses }) {
  const { showToast } = useApp();
  const [clientId,        setClientId]        = useState('');
  const [clientSecret,    setClientSecret]    = useState('');
  const [env,             setEnv]             = useState('production');
  const [connected,       setConnected]       = useState(false);
  const [connecting,      setConnecting]      = useState(false);
  const [connectedShopId, setConnectedShopId] = useState('');
  const [cfxKey,          setCfxKey]          = useState('');
  const [cfxEnabled,      setCfxEnabled]      = useState(false);
  const [bizStart,        setBizStart]        = useState(7);
  const [bizEnd,          setBizEnd]          = useState(19);
  const [floorPollSecs,   setFloorPollSecs]   = useState(60);
  const [settingsLoaded,  setSettingsLoaded]  = useState(false);

  useEffect(() => {
    api.tekmetricSettings().then(s => {
      if (s.shopId)       setConnectedShopId(s.shopId);
      if (s.connected)    setConnected(true);
      if (s.env)          setEnv(s.env);
      if (s.oilInterval)  setOilInterval(s.oilInterval);
      if (s.carfaxKey)    setCfxKey(s.carfaxKey);
      setCfxEnabled(!!s.carfaxEnabled);
      if (s.bizHoursStart != null) setBizStart(s.bizHoursStart);
      if (s.bizHoursEnd   != null) setBizEnd(s.bizHoursEnd);
      if (s.floorPollSeconds != null) setFloorPollSecs(s.floorPollSeconds);
      setSettingsLoaded(true);
    }).catch(() => setSettingsLoaded(true));
  }, []);
  const [contacts,   setContacts]   = useState([{id:1,name:'Owner',email:'',phone:'',sms:true,emailOn:true}]);
  const [rules,      setRules]      = useState(statuses.map(s=>({...s,onEnter:s.id===2||s.id===5,onIdle:s.id===2||s.id===6,hours:s.id===6?48:24})));
  const add = () => setContacts(c=>[...c,{id:Date.now(),name:'',email:'',phone:'',sms:true,emailOn:true}]);
  const upd = (id,k,v) => setContacts(c=>c.map(x=>x.id===id?{...x,[k]:v}:x));
  const del = id => setContacts(c=>c.filter(x=>x.id!==id));
  const togR = (i,k) => setRules(r=>r.map((x,j)=>j===i?{...x,[k]:!x[k]}:x));
  const setH = (i,v) => setRules(r=>r.map((x,j)=>j===i?{...x,hours:parseInt(v)||1}:x));
  const connect = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      showToast('Enter both your Client ID and Client Secret first', 'error'); return;
    }
    setConnecting(true);
    try {
      const result = await api.connectTekmetric({ clientId: clientId.trim(), clientSecret: clientSecret.trim(), env });
      setConnected(true);
      setConnectedShopId(result.shopId);
      setClientId('');
      setClientSecret('');
      showToast(`✅ Connected to Tekmetric! Shop ID: ${result.shopId}`);
    } catch(e) { showToast(e.message, 'error'); }
    finally { setConnecting(false); }
  };

  const save = async () => {
    try {
      await api.saveTekmetricSettings({
        env, oilInterval,
        carfaxKey: cfxKey, carfaxEnabled: cfxEnabled,
        bizHoursStart: bizStart, bizHoursEnd: bizEnd,
        floorPollSeconds: floorPollSecs,
      });
      showToast('Settings saved');
    } catch(e) { showToast('Failed to save: ' + e.message, 'error'); }
  };
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="table-card" style={{padding:18}}>
          <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)',marginBottom:14}}>🔌 Tekmetric Connection</div>

          {connected && connectedShopId ? (
            <div style={{padding:'12px 14px',background:'#f0fdf4',border:'1.5px solid #bbf7d0',borderRadius:8,marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
              <div>
                <div style={{fontWeight:700,fontSize:13,color:'#15803d'}}>✅ Connected to Tekmetric</div>
                <div style={{fontSize:11,color:'#166534',marginTop:2}}>Shop ID: <strong>{connectedShopId}</strong> · {env === 'sandbox' ? 'Sandbox (test)' : 'Production (live)'}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" style={{color:'#dc2626',border:'1px solid #fca5a5',flexShrink:0}} onClick={()=>{setConnected(false);setConnectedShopId('');}}>
                Disconnect
              </button>
            </div>
          ) : (
            <div style={{padding:'10px 14px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,marginBottom:14,fontSize:12,color:'#dc2626'}}>
              ⚠ Not connected — enter your credentials below and click Connect.
            </div>
          )}

          <div style={{marginBottom:14,padding:'10px 14px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,fontSize:12,color:'#1e40af',lineHeight:1.7}}>
            Enter your Tekmetric <strong>Client ID</strong> and <strong>Client Secret</strong> — these are provided when Tekmetric approves your API application. Your secret is never stored; only the generated token is saved.<br/>
            <strong>Sandbox</strong> = test environment (safe). <strong>Production</strong> = your live shop.
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div className="form-group">
              <label className="form-label">Client ID</label>
              <input type="text" className="form-input" value={clientId} onChange={e=>setClientId(e.target.value)} placeholder="Your Tekmetric Client ID" autoComplete="off"/>
            </div>
            <div className="form-group">
              <label className="form-label">Client Secret</label>
              <input type="password" className="form-input" value={clientSecret} onChange={e=>setClientSecret(e.target.value)} placeholder="Your Tekmetric Client Secret" autoComplete="new-password"/>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Environment</label>
            <select className="form-select" value={env} onChange={e=>setEnv(e.target.value)}>
              <option value="sandbox">Sandbox — test environment, safe to experiment</option>
              <option value="production">Production — your actual live shop</option>
            </select>
          </div>
          <div style={{padding:'10px 14px',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:8,fontSize:12,color:'var(--gray-600)'}}>
            🔄 <strong>Refresh behavior:</strong> Shop Floor updates every 60 seconds automatically. Vehicles, Sales, and Employees sync when you click <strong>Sync Now</strong> in the header.
          </div>
        </div>
        <div className="table-card" style={{padding:18}}>
          <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)',marginBottom:4}}>🛢 Oil Change Interval</div>
          <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:14}}>Vehicles past this threshold appear in your Oil Change call list.</div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            {[60,75,90,120,180].map(d=>(
              <button key={d} onClick={()=>setOilInterval(d)} className="btn btn-sm"
                style={{background:oilInterval===d?'var(--gold-500)':'white',color:oilInterval===d?'var(--navy-950)':'var(--gray-600)',border:'1px solid var(--gray-200)',fontWeight:oilInterval===d?700:500}}>
                {d} days
              </button>
            ))}
            <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:4}}>
              <span style={{fontSize:12,color:'var(--gray-500)'}}>Custom:</span>
              <input type="number" value={oilInterval} onChange={e=>setOilInterval(parseInt(e.target.value)||90)} min={30} max={365}
                style={{width:58,padding:'4px 8px',border:'1.5px solid var(--gray-200)',borderRadius:'var(--r-md)',fontFamily:'var(--font-mono)',fontSize:13,outline:'none',textAlign:'center'}}/>
              <span style={{fontSize:12,color:'var(--gray-500)'}}>days</span>
            </div>
          </div>
        </div>
        <div className="table-card" style={{padding:18}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
            <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)'}}>🚗 Carfax Integration</div>
            <label style={{display:'flex',alignItems:'center',gap:7,cursor:'pointer',fontSize:12.5,fontWeight:600,color:cfxEnabled?'var(--green-600)':'var(--gray-400)'}}>
              <input type="checkbox" checked={cfxEnabled} onChange={()=>setCfxEnabled(v=>!v)} style={{accentColor:'var(--gold-500)',width:14,height:14}}/>
              {cfxEnabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>
          <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:14}}>Alerts when a fleet vehicle is serviced at a competitor. Requires a Carfax for Dealers account.</div>
          <div className="form-group" style={{marginBottom:10}}>
            <label className="form-label">Carfax API Key</label>
            <input type="password" className="form-input" value={cfxKey} onChange={e=>setCfxKey(e.target.value)} placeholder={cfxEnabled?'Paste your Carfax API key here':'Enable Carfax above to enter your key'} disabled={!cfxEnabled} style={{opacity:cfxEnabled?1:0.5}}/>
          </div>
        </div>
        <div className="table-card" style={{padding:18}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
            <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)'}}>👥 Who Gets Notified</div>
            <button onClick={add} className="btn btn-ghost btn-sm">+ Add Person</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {contacts.map(ct=>(
              <div key={ct.id} style={{padding:'12px 14px',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:'var(--r-md)'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                  <input className="form-input" value={ct.name}  onChange={e=>upd(ct.id,'name',e.target.value)}  placeholder="Name / Role"/>
                  <input className="form-input" value={ct.phone} onChange={e=>upd(ct.id,'phone',e.target.value)} placeholder="Phone (SMS)"/>
                  <input className="form-input" style={{gridColumn:'1/-1'}} value={ct.email} onChange={e=>upd(ct.id,'email',e.target.value)} placeholder="Email address"/>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={ct.sms} onChange={()=>upd(ct.id,'sms',!ct.sms)} style={{accentColor:'var(--gold-500)'}}/> SMS
                  </label>
                  <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={ct.emailOn} onChange={()=>upd(ct.id,'emailOn',!ct.emailOn)} style={{accentColor:'var(--gold-500)'}}/> Email
                  </label>
                  {contacts.length>1&&<button onClick={()=>del(ct.id)} className="btn btn-danger btn-sm" style={{marginLeft:'auto'}}>Remove</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="table-card" style={{padding:18}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
          <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)'}}>🔔 Alert Rules by Status</div>
          <span style={{fontSize:10.5,color:'var(--gray-400)'}}>Auto-read from Tekmetric</span>
        </div>
        <div style={{fontSize:11,color:'var(--blue-500)',marginBottom:14,padding:'6px 10px',background:'var(--blue-50)',borderRadius:'var(--r-md)',border:'1px solid var(--blue-100)'}}>
          ℹ New or renamed statuses in Tekmetric appear here automatically on next sync.
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {rules.map((r,i)=>(
            <div key={r.id} style={{padding:'11px 13px',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:'var(--r-md)'}}>
              <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:8}}>
                <span style={{width:8,height:8,borderRadius:'50%',background:r.color,display:'inline-block'}}/>
                <span style={{fontWeight:700,fontSize:12.5,color:'var(--gray-800)'}}>{r.name}</span>
              </div>
              <div style={{display:'flex',gap:14,flexWrap:'wrap',alignItems:'center'}}>
                <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                  <input type="checkbox" checked={r.onEnter} onChange={()=>togR(i,'onEnter')} style={{accentColor:'var(--gold-500)'}}/> Alert when RO enters
                </label>
                <label style={{display:'flex',alignItems:'center',gap:5,fontSize:12,cursor:'pointer'}}>
                  <input type="checkbox" checked={r.onIdle}  onChange={()=>togR(i,'onIdle')}  style={{accentColor:'var(--gold-500)'}}/> Alert if idle &gt;
                </label>
                {r.onIdle&&(
                  <div style={{display:'flex',alignItems:'center',gap:4}}>
                    <input type="number" value={r.hours} onChange={e=>setH(i,e.target.value)} min={1} max={168}
                      style={{width:46,padding:'3px 6px',border:'1.5px solid var(--gray-200)',borderRadius:'var(--r-md)',fontFamily:'var(--font-mono)',fontSize:12,outline:'none',textAlign:'center'}}/>
                    <span style={{fontSize:12,color:'var(--gray-500)'}}>hrs</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--gray-100)',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
          {!connected && (
            <button onClick={connect} disabled={connecting||!clientId.trim()||!clientSecret.trim()} className="btn btn-primary">
              {connecting ? '⏳ Connecting…' : '🔌 Connect to Tekmetric'}
            </button>
          )}
          <button onClick={save} className="btn btn-navy">Save Settings</button>
        </div>
      </div>
    </div>
  );
}

// ── AUTO-SYNC CONFIG ──────────────────────────────────────────────────────────
// Change these two numbers if your shop hours are different.
// BDAY_START = hour the shop opens (24-hour format, so 7 = 7:00am)
// BDAY_END   = hour the shop closes (19 = 7:00pm)

const POLL_MINUTES = 60;
const POLL_MS = POLL_MINUTES * 60 * 1000;

function isBusinessHours(start = 7, end = 19) {
  const now  = new Date();
  const day  = now.getDay();
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= start && hour < end;
}

// ── INNER TABS ────────────────────────────────────────────────────────────────
const INNER_TABS = [
  { id:'shopfloor', label:'🔧 Shop Floor' },
  { id:'vehicles',  label:'🚛 Vehicles'   },
  { id:'sales',     label:'💰 Sales'      },
  { id:'settings',  label:'⚙️ Settings'   },
];

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function ActiveFleet() {
  const { showToast } = useApp();

  const [tab,         setTab]         = useState('shopfloor');
  const [syncing,     setSyncing]     = useState(false);
  const [syncStage,   setSyncStage]   = useState('');
  const [lastSync,    setLastSync]    = useState(null);
  const [syncedStats, setSyncedStats] = useState(null);
  const [nextSyncIn,  setNextSyncIn]  = useState(POLL_MINUTES * 60);
  const [oilInterval,     setOilInterval]     = useState(90);
  const [isDemo,          setIsDemo]          = useState(false);
  const [bizHoursStart,   setBizHoursStart]   = useState(7);
  const [bizHoursEnd,     setBizHoursEnd]     = useState(19);
  const [floorPollSecs,   setFloorPollSecs]   = useState(60);


  const [statuses,  setStatuses]  = useState([]);
  const [companies, setCompanies] = useState([]);
  const [vehicles,  setVehicles]  = useState([]);
  const [employees, setEmployees] = useState([]);
  const [ros,       setRos]       = useState([]);
  const [carfax,    setCarfax]    = useState([]);

  // Load saved settings on mount so biz hours + floor poll are respected
  useEffect(() => {
    api.tekmetricSettings().then(s => {
      if (s.bizHoursStart != null) setBizHoursStart(s.bizHoursStart);
      if (s.bizHoursEnd   != null) setBizHoursEnd(s.bizHoursEnd);
      if (s.floorPollSeconds != null) setFloorPollSecs(s.floorPollSeconds);
      if (s.oilInterval   != null) setOilInterval(s.oilInterval);
      if (s.pollInterval != null) setPollMinutes(s.pollInterval);
    }).catch(() => {});
  }, []);
  
  const nextSyncTarget = useRef(Date.now() + POLL_MS);
  const syncing_ref    = useRef(false); // ref copy so the interval can read it

  // ── Core sync ──────────────────────────────────────────────────────────────
  const doSync = useCallback(async (silent = false) => {
    if (syncing_ref.current) return;
    syncing_ref.current = true;
    setSyncing(true);
    setSyncStage('Connecting to Tekmetric…');

    // Rotate status messages so you can see it's working
    const stages = [
      'Fetching business customers…',
      'Fetching repair orders…',
      'Fetching vehicles…',
      'Fetching employees…',
      'Almost done…',
    ];
    let si = 0;
    const stageTimer = setInterval(() => {
      si = (si + 1) % stages.length;
      setSyncStage(stages[si]);
    }, 2500);

    try {
      const data = await api.tekmetricFleetData();
      clearInterval(stageTimer);

      if (data.error) throw new Error(data.error);

      setStatuses( data.statuses  || []);
      setCompanies(data.companies || []);
      setVehicles( data.vehicles  || []);
      setRos(      data.ros       || []);
      setEmployees(data.employees || []);
      setIsDemo(false);
      setLastSync(new Date());

      if (data.syncedStats) setSyncedStats(data.syncedStats);

      if (!silent) {
        const s = data.syncedStats;
        showToast(s
          ? `Synced — ${s.customers} businesses · ${s.ros} ROs · ${s.vehicles} vehicles`
          : 'Sync complete'
        );
      }

    } catch (e) {
      clearInterval(stageTimer);
      if (!silent) showToast('Sync failed — ' + e.message, 'error');
      console.error('[ActiveFleet]', e.message);
    } finally {
      syncing_ref.current = false;
      setSyncing(false);
      setSyncStage('');
      // Reset countdown
      nextSyncTarget.current = Date.now() + POLL_MS;
      setNextSyncIn(POLL_MINUTES * 60);
    }
  }, [showToast]);

  // ── Auto-poll ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const tick = setInterval(() => {
      const msLeft = nextSyncTarget.current - Date.now();
      if (msLeft <= 0) {
        if (isBusinessHours(bizHoursStart, bizHoursEnd)) {
          doSync(true);
        } else {
          // outside hours — just push the target forward, don't sync
          nextSyncTarget.current = Date.now() + POLL_MS;
          setNextSyncIn(POLL_MINUTES * 60);
        }
      } else {
        setNextSyncIn(Math.round(msLeft / 1000));
      }
    }, 15000); // check every 15 seconds, only updates the countdown display
    return () => clearInterval(tick);
  }, [doSync]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const activeRos = ros.filter(r => r.sid !== 5 && r.sid !== 7);
  const idleROs   = activeRos.filter(r => hrsIn(r.updated) > 24);

  function fmtCountdown(secs) {
    if (!secs || secs <= 0) return 'syncing soon';
    if (secs < 90) return `< 2 min`;
    return `${Math.floor(secs / 60)} min`;
  }

  function fmtLastSync(date) {
    if (!date) return 'never';
    return date.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  }

  return (
    <>
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <div className="page-title">🚛 Active Fleet</div>

          {syncing ? (
            <div style={{fontSize:12,color:'var(--gold-500)',display:'flex',alignItems:'center',gap:6,marginTop:2}}>
              <span style={{width:10,height:10,borderRadius:'50%',border:'2px solid var(--gold-500)',borderTopColor:'transparent',display:'inline-block',animation:'spin .7s linear infinite'}}/>
              {syncStage || 'Syncing…'}
            </div>
          ) : syncedStats ? (
            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:2,display:'flex',gap:8,flexWrap:'wrap'}}>
              <span>✅ {syncedStats.customers} businesses</span>
              <span>·</span>
              <span>{syncedStats.ros} repair orders</span>
              <span>·</span>
              <span>{syncedStats.vehicles} vehicles</span>
              {syncedStats.roFailures > 0 && (
                <span style={{color:'#f59e0b'}}>· ⚠ {syncedStats.roFailures} errors</span>
              )}
            </div>
          ) : (
            <div className="page-subtitle">{INNER_TABS.find(t=>t.id===tab)?.label}</div>
          )}
        </div>

        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          {activeRos.length > 0 && (
            <span className="badge badge-gold">{activeRos.length} Open ROs</span>
          )}
          {idleROs.length > 0 && (
            <span className="badge badge-overdue">⏱ {idleROs.length} Idle</span>
          )}
        </div>

        <div className="header-actions">
          <div style={{fontSize:11,color:'var(--gray-400)',textAlign:'right',lineHeight:1.7}}>
            {lastSync ? (
              <>
                <div>Last sync: {fmtLastSync(lastSync)}</div>
                {isBusinessHours()
                  ? <div>Next: ~{fmtCountdown(nextSyncIn)}</div>
                  : <div style={{color:'#f59e0b'}}>Auto-sync paused (outside {bizHoursStart}:00–{bizHoursEnd}:00)</div>
                }
              </>
            ) : (
              <div>Not synced yet</div>
            )}
          </div>

          <button onClick={() => doSync(false)} className="btn btn-ghost btn-sm" disabled={syncing}>
            {syncing ? '⏳ Syncing…' : '🔄 Sync Now'}
          </button>

          {isDemo && (
            <span style={{padding:'3px 8px',background:'var(--blue-50)',border:'1px solid var(--blue-100)',borderRadius:'var(--r-sm)',fontSize:10,color:'var(--blue-500)',fontWeight:700}}>
              DEMO — Add token in Settings tab
            </span>
          )}
        </div>
      </div>

      {/* ── Inner tabs ── */}
      <div style={{background:'white',borderBottom:'1px solid var(--gray-200)',padding:'0 22px',display:'flex',flexShrink:0}}>
        {INNER_TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:'11px 16px',border:'none',background:'transparent',fontSize:13,fontWeight:tab===t.id?700:500,color:tab===t.id?'var(--navy-800)':'var(--gray-400)',cursor:'pointer',borderBottom:tab===t.id?'2px solid var(--gold-500)':'2px solid transparent',transition:'all .12s',fontFamily:'var(--font-ui)'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div className="page-body">
        {tab==='shopfloor' && <ShopFloor />}
        {tab==='vehicles' && <VehiclesTab ros={ros} companies={companies} vehicles={vehicles} carfax={carfax} oilInterval={oilInterval} statuses={statuses}/>}
        {tab==='sales'     && <SalesTab ros={ros} companies={companies} vehicles={vehicles} employees={employees} statuses={statuses}/>}
        {tab==='settings'  && <FleetSettings oilInterval={oilInterval} setOilInterval={setOilInterval} statuses={statuses}/>}
      </div>
    </>
  );
}
