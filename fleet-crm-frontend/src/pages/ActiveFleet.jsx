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
const DEMO_STATUSES = [
  { id:1, name:'Estimate',            color:'#6366f1', bg:'#eef2ff' },
  { id:2, name:'Work In Progress',    color:'#d97706', bg:'#fffbeb' },
  { id:3, name:'Complete',            color:'#16a34a', bg:'#f0fdf4' },
  { id:4, name:'Saved For Later',     color:'#7c3aed', bg:'#faf5ff' },
  { id:5, name:'Posted',              color:'#1d4ed8', bg:'#eff6ff' },
  { id:6, name:'Accounts Receivable', color:'#dc2626', bg:'#fef2f2' },
];
const DEMO_COMPANIES = [
  { id:101, name:'Riverside Logistics LLC', contact:'Mike Torres',  phone:'713-555-0101', email:'mike@riverside.com'    },
  { id:102, name:'Gulf Coast Contractors',  contact:'Sarah Chen',   phone:'713-555-0202', email:'sarah@gulfcoast.com'   },
  { id:103, name:'Lone Star Deliveries',    contact:'James Webb',   phone:'713-555-0303', email:'james@lonestar.com'    },
  { id:104, name:'Metro HVAC Services',     contact:'Diana Park',   phone:'713-555-0404', email:'diana@metrohvac.com'   },
  { id:105, name:'Texan Plumbing Co',       contact:'Bob Martinez', phone:'713-555-0505', email:'bob@texanplumbing.com' },
];
const DEMO_EMPLOYEES = [
  { id:1, name:'Jake Sullivan', role:'Technician'      },
  { id:2, name:'Maria Reyes',   role:'Technician'      },
  { id:3, name:'Chris Dolan',   role:'Service Advisor' },
  { id:4, name:'Pam Nguyen',    role:'Service Advisor' },
];
const DEMO_VEHICLES = [
  { id:201, cid:101, year:2021, make:'Ford',         model:'F-150',          plate:'TXF-101', vin:'1FTFW1ET0MFA12345', color:'White',  oilElsewhere:false, sold:false },
  { id:202, cid:101, year:2020, make:'Ford',         model:'Transit 350',    plate:'TXF-102', vin:'1FTBW2CM4LKA67890', color:'White',  oilElsewhere:false, sold:false },
  { id:203, cid:101, year:2022, make:'Chevrolet',    model:'Silverado 1500', plate:'TXC-103', vin:'1GCUDDED4NZ234567', color:'Black',  oilElsewhere:true,  sold:false },
  { id:204, cid:102, year:2019, make:'Ram',          model:'1500 Classic',   plate:'TXR-201', vin:'1C6SRFFT8KN345678', color:'Gray',   oilElsewhere:false, sold:false },
  { id:205, cid:102, year:2021, make:'Ford',         model:'Ranger',         plate:'TXF-202', vin:'1FTER4FH4MLD45678', color:'Blue',   oilElsewhere:false, sold:false },
  { id:206, cid:103, year:2020, make:'Mercedes-Benz',model:'Sprinter 2500',  plate:'TXM-301', vin:'WD3PE8CDXKP456789', color:'White',  oilElsewhere:false, sold:false },
  { id:207, cid:103, year:2021, make:'Mercedes-Benz',model:'Sprinter 2500',  plate:'TXM-302', vin:'WD3PE8CDX1P456789', color:'White',  oilElsewhere:false, sold:false },
  { id:208, cid:103, year:2019, make:'Ford',         model:'E-350 Cargo',    plate:'TXF-303', vin:'1FTSS3EL4KDA56789', color:'White',  oilElsewhere:false, sold:false },
  { id:209, cid:104, year:2022, make:'Ford',         model:'Transit Connect', plate:'TXF-401', vin:'NM0LS7F20N1678901', color:'White',  oilElsewhere:false, sold:false },
  { id:210, cid:104, year:2020, make:'Chevrolet',    model:'Express 2500',   plate:'TXC-402', vin:'1GCWGBFP0L1789012', color:'Yellow', oilElsewhere:false, sold:false },
  { id:211, cid:105, year:2021, make:'Ram',          model:'ProMaster City',  plate:'TXR-501', vin:'3C6TRVPG5ME890123', color:'White',  oilElsewhere:false, sold:true  },
  { id:212, cid:105, year:2019, make:'Ford',         model:'F-250 SD',        plate:'TXF-502', vin:'1FT7W2BT9KEA90123', color:'Red',    oilElsewhere:false, sold:false },
];
const DEMO_ROS = [
  { id:1001,rn:2241,cid:101,vid:201,sid:2,techId:1,saId:3,labor:18500,parts:32000,disc:0,   total:50500,paid:0,    created:'2026-03-09T08:00:00Z',updated:'2026-03-10T14:30:00Z',lastContact:'2026-03-10T09:00:00Z',contactMethod:'Call', jobs:[{name:'Oil Change + Full Inspection',auth:true,labor:8500,parts:2000},{name:'Front Brake Pad Replacement',auth:true,labor:10000,parts:30000}] },
  { id:1002,rn:2189,cid:101,vid:202,sid:5,techId:2,saId:4,labor:22000,parts:45000,disc:2000,total:65000,paid:65000,created:'2026-02-20T09:00:00Z',updated:'2026-02-25T16:00:00Z',lastContact:'2026-02-20T10:00:00Z',contactMethod:'Text', jobs:[{name:'Transmission Service',auth:true,labor:22000,parts:45000}] },
  { id:1003,rn:2150,cid:101,vid:201,sid:5,techId:1,saId:3,labor:9500, parts:5000, disc:0,   total:14500,paid:14500,created:'2026-01-15T10:00:00Z',updated:'2026-01-16T15:00:00Z',lastContact:'2026-01-15T11:00:00Z',contactMethod:'Text', jobs:[{name:'Oil Change',auth:true,labor:4500,parts:3000},{name:'Tire Rotation',auth:true,labor:2500,parts:0}] },
  { id:1004,rn:2244,cid:102,vid:204,sid:1,techId:null,saId:3,labor:0,parts:0,disc:0,total:0,paid:0,created:'2026-03-11T07:30:00Z',updated:'2026-03-11T07:30:00Z',lastContact:null,contactMethod:null,jobs:[{name:'AC System Diagnostic',auth:false,labor:12500,parts:0},{name:'AC Compressor Replacement',auth:false,labor:18000,parts:65000}] },
  { id:1005,rn:2198,cid:102,vid:205,sid:5,techId:2,saId:4,labor:14500,parts:28000,disc:1500,total:41000,paid:41000,created:'2026-02-28T08:00:00Z',updated:'2026-03-02T17:00:00Z',lastContact:'2026-02-28T09:00:00Z',contactMethod:'Email',jobs:[{name:'4-Wheel Alignment',auth:true,labor:8500,parts:0},{name:'New Tires 4x Cooper',auth:true,labor:6000,parts:28000}] },
  { id:1006,rn:2210,cid:103,vid:206,sid:5,techId:1,saId:3,labor:35000,parts:72000,disc:5000,total:102000,paid:102000,created:'2026-01-18T09:00:00Z',updated:'2026-01-22T16:00:00Z',lastContact:'2026-01-18T08:00:00Z',contactMethod:'Call', jobs:[{name:'Engine Tune-Up',auth:true,labor:15000,parts:22000},{name:'Cooling System Flush',auth:true,labor:8000,parts:12000}] },
  { id:1007,rn:2228,cid:103,vid:207,sid:3,techId:2,saId:4,labor:12000,parts:18000,disc:0,   total:30000,paid:0,    created:'2026-03-07T10:00:00Z',updated:'2026-03-10T13:00:00Z',lastContact:'2026-03-07T11:00:00Z',contactMethod:'Text', jobs:[{name:'Oil & Filter + Inspection',auth:true,labor:12000,parts:18000}] },
  { id:1008,rn:2238,cid:104,vid:209,sid:2,techId:1,saId:3,labor:8500, parts:4500, disc:0,   total:13000,paid:0,    created:'2026-03-08T08:30:00Z',updated:'2026-03-10T11:00:00Z',lastContact:'2026-03-10T08:00:00Z',contactMethod:'Text', jobs:[{name:'Oil Change',auth:true,labor:4500,parts:2500},{name:'Cabin Air Filter',auth:true,labor:4000,parts:2000}] },
  { id:1009,rn:2239,cid:104,vid:210,sid:2,techId:2,saId:4,labor:24000,parts:55000,disc:3000,total:76000,paid:0,    created:'2026-03-08T09:00:00Z',updated:'2026-03-10T15:00:00Z',lastContact:null,contactMethod:null,jobs:[{name:'Alternator Replacement',auth:true,labor:14000,parts:35000},{name:'Serpentine Belt',auth:true,labor:6000,parts:12000}] },
  { id:1010,rn:2233,cid:104,vid:209,sid:6,techId:1,saId:3,labor:25000,parts:20000,disc:0,   total:45000,paid:0,    created:'2026-03-01T08:00:00Z',updated:'2026-03-05T17:00:00Z',lastContact:'2026-03-03T09:00:00Z',contactMethod:'Call', jobs:[{name:'Transmission Rebuild',auth:true,labor:25000,parts:20000}] },
  { id:1011,rn:2243,cid:105,vid:211,sid:2,techId:2,saId:4,labor:6500, parts:3200, disc:0,   total:9700, paid:0,    created:'2026-03-09T11:00:00Z',updated:'2026-03-10T16:00:00Z',lastContact:'2026-03-09T11:30:00Z',contactMethod:'Text', jobs:[{name:'Full Synthetic Oil Service',auth:true,labor:4500,parts:2200},{name:'Wiper Blades',auth:true,labor:2000,parts:1000}] },
  { id:1012,rn:2230,cid:105,vid:212,sid:5,techId:1,saId:3,labor:32000,parts:48000,disc:4000,total:76000,paid:76000,created:'2026-02-22T09:00:00Z',updated:'2026-02-27T16:00:00Z',lastContact:'2026-02-22T10:00:00Z',contactMethod:'Email',jobs:[{name:'Suspension Overhaul',auth:true,labor:20000,parts:28000},{name:'Exhaust Repair',auth:true,labor:12000,parts:20000}] },
];
const DEMO_CARFAX = [
  { vid:203, date:'2026-02-15', shop:'Jiffy Lube - Houston',         service:'Oil Change'           },
  { vid:208, date:'2026-01-28', shop:'Valvoline Instant Oil Change', service:'Oil Change + Filter'  },
  { vid:210, date:'2026-03-01', shop:'Firestone Complete Auto Care', service:'Synthetic Oil Change'  },
];

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
function ShopFloor({ ros, companies, vehicles, employees, statuses, onRefresh, pollSeconds = 60 }) {
  const [countdown, setCountdown] = React.useState(pollSeconds);

  // Fast auto-refresh while this tab is visible
  React.useEffect(() => {
    setCountdown(pollSeconds);
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          onRefresh?.();
          return pollSeconds;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [pollSeconds, onRefresh]);
  const [sel, setSel] = useState(null);
  const [exp, setExp] = useState(null);
  const gc = id => companies.find(c => c.id===id);
  const gv = id => vehicles.find(v => v.id===id);
  const ge = id => employees.find(e => e.id===id);
  const active = ros.filter(r => r.sid!==5);
  const filt   = sel ? active.filter(r => r.sid===sel) : active;
  const idle   = active.filter(r => hrsIn(r.updated)>24).length;
  const noct   = active.filter(r => !r.lastContact).length;
  const val    = active.reduce((s,r) => s+r.total, 0);
  const sids   = statuses.filter(s => active.some(r => r.sid===s.id));
  const rbg    = ro => { const h=hrsIn(ro.updated); return h>72?'row-overdue':h>24?'row-today':''; };
  return (
    <>
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
        <span style={{fontSize:11,color:'var(--gray-400)',background:'var(--gray-50)',border:'1px solid var(--gray-200)',borderRadius:6,padding:'3px 10px'}}>
          🔄 Auto-refresh in {countdown}s
        </span>
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
function VehiclesTab({ ros, companies, vehicles, carfax, oilInterval }) {
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
                              <StatusBadge sid={ro.sid} statuses={DEMO_STATUSES}/>
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
  {key:'90',label:'Last 90d'},{key:'all',label:'All Time'},
];
function filterRange(ros, range) {
  if (range==='all') return ros;
  const now=new Date(), s=new Date();
  if      (range==='today') { s.setHours(0,0,0,0); }
  else if (range==='week')  { s.setDate(now.getDate()-now.getDay()); s.setHours(0,0,0,0); }
  else if (range==='month') { s.setDate(1); s.setHours(0,0,0,0); }
  else if (range==='q')     { s.setMonth(Math.floor(now.getMonth()/3)*3,1); s.setHours(0,0,0,0); }
  else if (range==='ytd')   { s.setMonth(0,1); s.setHours(0,0,0,0); }
  else if (range==='30')    { s.setDate(now.getDate()-30); }
  else if (range==='90')    { s.setDate(now.getDate()-90); }
  return ros.filter(r=>new Date(r.created)>=s);
}
function SalesTab({ ros, companies, vehicles, employees, statuses }) {
  const [range, setRange] = useState('ytd');
  const [selCo, setSelCo] = useState(null);
  const gv = id => vehicles.find(v=>v.id===id);
  const ge = id => employees.find(e=>e.id===id);
  const filt = useMemo(()=>filterRange(ros,range),[ros,range]);
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
      <div style={{display:'flex',gap:5,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        {selCo&&<button onClick={()=>setSelCo(null)} className="btn btn-ghost btn-sm">← All Companies</button>}
        {DATE_RANGES.map(r=>(
          <button key={r.key} onClick={()=>setRange(r.key)} className="btn btn-sm"
            style={{background:range===r.key?'var(--navy-800)':'white',color:range===r.key?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
            {r.label}
          </button>
        ))}
      </div>
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
  const [token,           setToken]           = useState('');
  const [shopId,          setShopId]          = useState('');
  const [env,             setEnv]             = useState('production');
  const [poll,            setPoll]            = useState(5);
  const [cfxKey,          setCfxKey]          = useState('');
  const [cfxEnabled,      setCfxEnabled]      = useState(false);
  const [bizStart,        setBizStart]        = useState(7);
  const [bizEnd,          setBizEnd]          = useState(19);
  const [floorPollSecs,   setFloorPollSecs]   = useState(60);
  const [settingsLoaded,  setSettingsLoaded]  = useState(false);

  useEffect(() => {
    api.tekmetricSettings().then(s => {
      if (s.shopId)     setShopId(s.shopId);
      if (s.env)        setEnv(s.env);
      if (s.pollInterval) setPoll(s.pollInterval);
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
  const save = async () => {
    try {
      await api.saveTekmetricSettings({ token, shopId, env, pollInterval:poll, oilInterval, carfaxKey:cfxKey, carfaxEnabled:cfxEnabled, bizHoursStart:bizStart, bizHoursEnd:bizEnd, floorPollSeconds:floorPollSecs });
      showToast('Fleet settings saved');
    } catch(e) { showToast('Failed to save: ' + e.message, 'error'); }
  };
  return (
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,alignItems:'start'}}>
      <div style={{display:'flex',flexDirection:'column',gap:14}}>
        <div className="table-card" style={{padding:18}}>
          <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)',marginBottom:14}}>🔌 Tekmetric Connection</div>

          {/* What sandbox vs production means — helpful for the user */}
          <div style={{marginBottom:14,padding:'10px 14px',background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,fontSize:12,color:'#1e40af',lineHeight:1.7}}>
            <strong>Sandbox</strong> = Tekmetric's fake test environment. Safe to experiment — no real shop data.<br/>
            <strong>Production</strong> = your actual live shop. Use this when you're ready to go live.
          </div>

          <div className="form-group">
            <label className="form-label">API Bearer Token</label>
            <input type="password" className="form-input" value={token} onChange={e=>setToken(e.target.value)} placeholder="Paste your Tekmetric token here"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div className="form-group">
              <label className="form-label">Shop ID</label>
              <input type="text" className="form-input" value={shopId} onChange={e=>setShopId(e.target.value)} placeholder="e.g. 1"/>
            </div>
            <div className="form-group">
              <label className="form-label">Environment</label>
              <select className="form-select" value={env} onChange={e=>setEnv(e.target.value)}>
                <option value="sandbox">Sandbox (test — safe)</option>
                <option value="production">Production (live shop)</option>
              </select>
            </div>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">Auto-sync interval</label>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {[1,2,5,10,15].map(m=>(
                <button key={m} onClick={()=>setPoll(m)} className="btn btn-sm"
                  style={{background:poll===m?'var(--navy-800)':'white',color:poll===m?'white':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
                  {m}min
                </button>
              ))}
            </div>
            <div style={{fontSize:11,color:'var(--gray-400)',marginTop:5}}>
              Auto-sync only runs Mon–Fri 7am–7pm. Change hours in BDAY_START/BDAY_END in ActiveFleet.jsx.
            </div>
          </div>
        </div>
        <div className="table-card" style={{padding:18}}>
          <div style={{fontWeight:700,fontSize:13,color:'var(--gray-800)',marginBottom:4}}>🕐 Auto-Sync Hours</div>
          <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:14}}>Auto-sync only runs on weekdays between these hours. Outside these hours it pauses automatically.</div>
          <div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginBottom:16}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',marginBottom:4}}>Opens (24h)</div>
              <input type="number" min="0" max="23" value={bizStart} onChange={e=>setBizStart(parseInt(e.target.value)||0)}
                style={{width:64,padding:'6px 8px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:14,fontWeight:700,textAlign:'center'}}/>
            </div>
            <div style={{fontSize:20,color:'var(--gray-300)',marginTop:18}}>→</div>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',marginBottom:4}}>Closes (24h)</div>
              <input type="number" min="0" max="23" value={bizEnd} onChange={e=>setBizEnd(parseInt(e.target.value)||0)}
                style={{width:64,padding:'6px 8px',border:'1.5px solid var(--gray-200)',borderRadius:6,fontSize:14,fontWeight:700,textAlign:'center'}}/>
            </div>
            <div style={{fontSize:12,color:'var(--gray-500)',marginTop:18}}>
              (7 = 7:00am, 19 = 7:00pm)
            </div>
          </div>
          <div style={{marginBottom:4}}>
            <div style={{fontSize:11,fontWeight:700,color:'var(--gray-500)',marginBottom:6}}>🔴 Shop Floor refresh interval</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
              {[30,60,120,300].map(s=>(
                <button key={s} onClick={()=>setFloorPollSecs(s)} className="btn btn-sm"
                  style={{background:floorPollSecs===s?'var(--gold-500)':'white',color:floorPollSecs===s?'var(--navy-950)':'var(--gray-600)',border:'1px solid var(--gray-200)'}}>
                  {s<60?`${s}s`:s===60?'1 min':s===120?'2 min':'5 min'}
                </button>
              ))}
              <span style={{fontSize:11,color:'var(--gray-400)'}}>— Shop Floor only, while tab is open</span>
            </div>
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
        <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--gray-100)',display:'flex',gap:10,alignItems:'center'}}>
          <button onClick={save} className="btn btn-primary">Save Settings</button>
          <span style={{fontSize:11,color:'var(--gray-400)',marginLeft:'auto'}}>SMS/email delivery wired in at launch</span>
        </div>
      </div>
    </div>
  );
}

// ── AUTO-SYNC CONFIG ──────────────────────────────────────────────────────────
// Change these two numbers if your shop hours are different.
// BDAY_START = hour the shop opens (24-hour format, so 7 = 7:00am)
// BDAY_END   = hour the shop closes (19 = 7:00pm)
const POLL_MINUTES = 5;
const POLL_MS      = POLL_MINUTES * 60 * 1000;

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
  const [isDemo,          setIsDemo]          = useState(true);
  const [bizHoursStart,   setBizHoursStart]   = useState(7);
  const [bizHoursEnd,     setBizHoursEnd]     = useState(19);
  const [floorPollSecs,   setFloorPollSecs]   = useState(60);

  const [statuses,  setStatuses]  = useState(DEMO_STATUSES);
  const [companies, setCompanies] = useState(DEMO_COMPANIES);
  const [vehicles,  setVehicles]  = useState(DEMO_VEHICLES);
  const [employees, setEmployees] = useState(DEMO_EMPLOYEES);
  const [ros,       setRos]       = useState(DEMO_ROS);
  const [carfax,    setCarfax]    = useState(DEMO_CARFAX);

  // Load saved settings on mount so biz hours + floor poll are respected
  useEffect(() => {
    api.tekmetricSettings().then(s => {
      if (s.bizHoursStart != null) setBizHoursStart(s.bizHoursStart);
      if (s.bizHoursEnd   != null) setBizHoursEnd(s.bizHoursEnd);
      if (s.floorPollSeconds != null) setFloorPollSecs(s.floorPollSeconds);
      if (s.oilInterval   != null) setOilInterval(s.oilInterval);
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
  const activeRos = ros.filter(r => r.sid !== 5);
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
        {tab==='shopfloor' && <ShopFloor ros={ros} companies={companies} vehicles={vehicles} employees={employees} statuses={statuses} onRefresh={()=>doSync(true)} pollSeconds={floorPollSecs}/>}
        {tab==='vehicles'  && <VehiclesTab ros={ros} companies={companies} vehicles={vehicles} carfax={carfax} oilInterval={oilInterval}/>}
        {tab==='sales'     && <SalesTab ros={ros} companies={companies} vehicles={vehicles} employees={employees} statuses={statuses}/>}
        {tab==='settings'  && <FleetSettings oilInterval={oilInterval} setOilInterval={setOilInterval} statuses={statuses}/>}
      </div>
    </>
  );
}
