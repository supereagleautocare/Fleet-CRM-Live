import { useState, useEffect, useRef } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';
import ScoreCardModal from '../components/ScoreCardModal.jsx';

const DEFAULT_COMPANY_TYPES = ['Drop In', 'Spoke To', 'Voicemail', 'No Answer', 'Gatekeeper', 'Not Interested', 'Call Back', 'Left Message'];

function nowDateStr() { return new Date().toISOString().split('T')[0]; }

export default function QuickLog() {
  const [query, setQuery]         = useState('');
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected]   = useState(null); // entity to log against
  const [contactTypes, setContactTypes] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);

  const [actionMode, setActionMode] = useState('call'); // call | mail | email | visit
  const [form, setForm] = useState({
    contact_type: '',
    notes: '',
    next_action: 'Call',
    contact_name: '',
    direct_line: '',
    email: '',
    role_title: '',
    set_as_preferred: false,
    next_action_date_override: '',
    show_date_override: false,
    mail_piece: '',
    email_template: '',
    email_to: '',
  });
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [pendingScorecard, setPendingScorecard] = useState(null);
  const [scorecardEnabled, setScorecardEnabled] = useState(false);
  const [hist, setHist]       = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [selStatus, setSelStatus] = useState(null);
  const [allContacts, setAllContacts] = useState([]);

  const [shopPos, setShopPos] = useState(null);
  const { showToast, refreshCounts } = useApp();
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  function distMiles(a, b) {
    if (!a || !b) return null;
    const R=3958.8, dLat=(b.lat-a.lat)*Math.PI/180, dLng=(b.lng-a.lng)*Math.PI/180;
    const x=Math.sin(dLat/2)**2+Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }

  useEffect(() => {
    api.contactTypes().then(ct => setContactTypes(ct.configured || [])).catch(()=>{});
    api.scorecardEnabled().then(r => setScorecardEnabled(r.enabled)).catch(()=>{});
    api.settings().then(s => {
      const obj = Array.isArray(s) ? Object.fromEntries(s.map(x=>[x.key,x.value])) : s;
      const lat = parseFloat(obj['shop_lat']);
      const lng = parseFloat(obj['shop_lng']);
      if (!isNaN(lat) && !isNaN(lng)) setShopPos({ lat, lng });
    }).catch(()=>{});
    searchRef.current?.focus();
  }, []);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.trim().length < 1) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.quicklogSearch(query.trim(), 'company');
        setResults(data);
      } catch(e) { console.error(e); }
      finally { setSearching(false); }
    }, 280);
  }, [query]);

  useEffect(() => {
    if (!selected) { setHist([]); setSelStatus(null); setAllContacts([]); return; }
    setSelStatus(selected.company_status || 'prospect');
    setHistLoading(true);
    api.companyHistory(selected.id).then(h => setHist(h || [])).catch(()=>setHist([])).finally(()=>setHistLoading(false));
    api.company(selected.id).then(c => setAllContacts(c.contacts || [])).catch(()=>{});
  }, [selected?.id]);

  async function handleStatusChange(status) {
    if (!selected) return;
    setSelStatus(status);
    try { await api.updateCompanyStatus(selected.id, status); }
    catch(e) { showToast(e.message, 'error'); setSelStatus(selected.company_status || 'prospect'); }
  }

  function selectEntity(entity) {
    setSelected(entity);
    setResults([]);
    setQuery('');
    setSaved(false);
    setForm({
      contact_type: '',
      notes: '',
      next_action: 'Call',
      contact_name: '',
      direct_line: '',
      email: '',
      role_title: '',
      set_as_preferred: false,
      next_action_date_override: '',
      show_date_override: false,
    });
  }

  function set(field, val) { setForm(f => ({...f, [field]: val})); }

  async function handleSave() {
        if (!form.contact_type) { showToast('Select what happened first', 'error'); return; }
    setSaving(true);
    try {
      if (selected.entity_type === 'company') {
        if (actionMode === 'mail') {
          await api.logMail(selected.id, {
            mail_piece: form.mail_piece,
            contact_type: form.contact_type,
            notes: form.notes,
            next_action: form.next_action,
            next_action_date_override: form.show_date_override && form.next_action_date_override ? form.next_action_date_override : undefined,
          });
        } else if (actionMode === 'email') {
          await api.logEmail(selected.id, {
            email_template: form.email_template || 'Email Sent',
            email_to: form.email_to || undefined,
            notes: form.notes,
            next_action: form.next_action,
            next_action_date_override: form.show_date_override && form.next_action_date_override ? form.next_action_date_override : undefined,
          });
        } else {
          const payload = {
            contact_type: form.contact_type,
            notes: form.notes,
            next_action: form.next_action,
            contact_name: form.contact_name || undefined,
            direct_line: form.direct_line || undefined,
            email: form.email || undefined,
            role_title: form.role_title || undefined,
            set_as_preferred: form.set_as_preferred,
            next_action_date_override: form.show_date_override && form.next_action_date_override ? form.next_action_date_override : undefined,
          };
          await api.quicklogCompany(selected.id, payload);
        }
      }
      showToast(`✅ Logged for ${selected.name}`);
      setSaved(true);
      setRecentLogs(prev => [{
        name: selected.name,
        contact_type: actionMode === 'mail' ? `Mail — ${form.mail_piece}` : form.contact_type,
        notes: form.notes,
        next_action: form.next_action,
        loggedAt: new Date(),
      }, ...prev.slice(0,9)]);
      await refreshCounts();
      // Scorecard only for calls
      if (scorecardEnabled && selected.entity_type === 'company' && actionMode === 'call') {
        setTimeout(() => setPendingScorecard({ entityName: selected.name, entityId: selected.id }), 150);
      }
    } catch(e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function logAnother() {
    setSelected(null);
    setSaved(false);
    setForm({ contact_type:'', notes:'', next_action:'Call', contact_name:'', direct_line:'', email:'', role_title:'', set_as_preferred:false, next_action_date_override:'', show_date_override:false });
    setTimeout(() => searchRef.current?.focus(), 100);
  }

  const getTypes = (actionKey, fallback) => {
    const fromSettings = contactTypes.filter(ct => ct.action_type === actionKey && ct.enabled !== 0).map(ct => ct.contact_type);
    return fromSettings.length > 0 ? fromSettings : fallback;
  };

  const callTypes  = getTypes('call',  DEFAULT_COMPANY_TYPES);
  const mailTypes  = getTypes('mail',  []);
  const emailTypes = getTypes('email', []);
  const visitTypes = getTypes('visit', []);

  const types = actionMode === 'mail'  ? mailTypes
              : actionMode === 'email' ? emailTypes
              : actionMode === 'visit' ? visitTypes
              : callTypes;

  const isCompany = true;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">⚡ Quick Log</div>
          <div className="page-subtitle">Log a call or note for any company instantly</div>
        </div>
      </div>

      <div className="page-body">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 320px', gap:16, alignItems:'flex-start' }}>

          {/* Main panel */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

            {/* Search box — always visible */}
            {!selected && (
              <div className="table-card" style={{ padding:'20px 24px' }}>
                <div style={{ fontWeight:700, fontSize:16, marginBottom:14 }}>🔍 Search Company</div>

                <div style={{ position:'relative' }}>
                  <input
                    ref={searchRef}
                    className="form-input"
                    style={{ paddingLeft:38, fontSize:15 }}
                    placeholder="Type a name, phone number, or company…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    autoComplete="off"
                  />
                  <span style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', fontSize:16, color:'var(--gray-400)' }}>
                    {searching ? '⏳' : '🔍'}
                  </span>
                </div>

                {/* Results dropdown */}
                {results.length > 0 && (
                  <div style={{ marginTop:8, border:'1px solid var(--gray-200)', borderRadius:10, overflow:'hidden', boxShadow:'0 4px 16px rgba(0,0,0,.08)' }}>
                    {results.map((r,i) => (
                      <div key={r.id+r.entity_type} onClick={() => selectEntity(r)}
                        style={{ padding:'12px 16px', borderBottom: i<results.length-1?'1px solid var(--gray-100)':'none', cursor:'pointer', background:'white', transition:'background .1s', display:'flex', justifyContent:'space-between', alignItems:'center' }}
                        onMouseEnter={e=>e.currentTarget.style.background='var(--gray-50)'}
                        onMouseLeave={e=>e.currentTarget.style.background='white'}
                      >
                        <div>
                          <div style={{ fontWeight:700, fontSize:13, color:'var(--gray-900)' }}>{r.name}</div>
                          <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2, display:'flex', gap:10 }}>
                            {fmtPhone(r.main_phone)}
                            {r.industry && <span>· {r.industry}</span>}
                            {r.last_contact_type && <span>· Last: {r.last_contact_type} {fmtDate(r.last_contacted)}</span>}
                          </div>
                        </div>
                        <span className="badge badge-blue" style={{ fontSize:10, flexShrink:0 }}>
                          🏢 Company
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {query.trim().length >= 2 && !searching && results.length === 0 && (
                  <div style={{ marginTop:12, padding:'12px 16px', background:'var(--gray-50)', borderRadius:10, fontSize:13, color:'var(--gray-500)', textAlign:'center' }}>
                    No results for "{query}" — check spelling or try a phone number
                  </div>
                )}
              </div>
            )}

            {/* Log form */}
            {selected && !saved && (
              <div className="table-card" style={{ padding:'24px' }}>
                {/* Entity header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <span className="badge badge-blue" style={{ fontSize:11 }}>🏢 Company</span>
                      {selected.followup_due && (
                        <span className="badge badge-overdue" style={{ fontSize:11 }}>
                          Follow-up was {fmtDate(selected.followup_due)}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:22, fontWeight:800, color:'var(--gray-900)' }}>{selected.name}</div>
                    <div style={{ fontSize:13, color:'var(--gray-500)', marginTop:2 }}>
                      {fmtPhone(selected.main_phone)}
                      {selected.industry && ` · ${selected.industry}`}
                      {selected.address && ` · ${selected.address}${selected.city?', '+selected.city:''}`}
                    </div>
                    {shopPos && selected.lat && selected.lng && (() => {
                      const d = distMiles(shopPos, {lat:selected.lat, lng:selected.lng});
                      return d ? <div style={{ fontSize:12, color:'var(--navy-700)', fontWeight:600, marginTop:3 }}>📏 {d.toFixed(1)} mi from shop · 🚗 ~{Math.round(d/25*60)} min drive</div> : null;
                    })()}
                    {selected.last_contact_type && (
                      <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:4 }}>
                        Last contact: <strong>{selected.last_contact_type}</strong> on {fmtDate(selected.last_contacted)}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}>✕ Change</button>
                </div>

                {/* Status toggle */}
                {selected && (
                  <div style={{ marginBottom:14, padding:'10px 14px', background:'var(--gray-50)', borderRadius:9, border:'1px solid var(--gray-100)' }}>
                    <div style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:7 }}>Company Status</div>
                    <div style={{ display:'flex', gap:6 }}>
                      {[['prospect','Prospect','#64748b','#f1f5f9'],['interested','⭐ Interested','#92400e','#fef9c3'],['customer','✅ Customer','#166534','#f0fdf4']].map(([val,label,col,bg])=>(
                        <button key={val} type="button" onClick={()=>handleStatusChange(val)}
                          style={{ fontSize:11, fontWeight:700, padding:'4px 12px', borderRadius:20, cursor:'pointer',
                            border:`1.5px solid ${selStatus===val?col:'var(--gray-200)'}`,
                            background: selStatus===val ? bg : 'white',
                            color: selStatus===val ? col : 'var(--gray-500)',
                          }}>{label}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── What type of contact is this? ── */}
                <div style={{ marginBottom:18 }}>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:10 }}>What type of contact?</div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {[
                      { id:'call',  label:'📞 Called',   nextAction:'Call'  },
                      { id:'mail',  label:'✉️ Mailed',   nextAction:'Call'  },
                      { id:'email', label:'📧 Emailed',  nextAction:'Call'  },
                      { id:'visit', label:'📍 Visited',  nextAction:'Visit' },
                    ].map(m => (
                      <button key={m.id} type="button"
                        onClick={() => {
                          setActionMode(m.id);
                          set('next_action', m.nextAction);
                          set('contact_type', '');
                          set('mail_piece', '');
                          set('email_template', '');
                          set('email_to', '');
                        }}
                        style={{ padding:'7px 16px', borderRadius:20, fontSize:13, fontWeight:700, cursor:'pointer',
                          border:`2px solid ${actionMode===m.id?'var(--navy-700)':'var(--gray-200)'}`,
                          background: actionMode===m.id?'var(--navy-800)':'white',
                          color: actionMode===m.id?'white':'var(--gray-700)',
                        }}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Mail piece field — mail mode only */}
                {actionMode === 'mail' && (
                  <div className="form-group">
                    <label className="form-label">Mail Piece Sent</label>
                    <input className="form-input" placeholder="e.g. Postcard A, Intro Letter…" value={form.mail_piece} onChange={e=>set('mail_piece',e.target.value)}/>
                  </div>
                )}

                {/* Email fields — email mode only */}
                {actionMode === 'email' && (
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                    <div className="form-group" style={{ margin:0 }}>
                      <label className="form-label">Template / Campaign</label>
                      <input className="form-input" placeholder="e.g. Intro Email, Follow-up #1…" value={form.email_template} onChange={e=>set('email_template',e.target.value)}/>
                    </div>
                    <div className="form-group" style={{ margin:0 }}>
                      <label className="form-label">Sent To (email)</label>
                      <input className="form-input" type="email" placeholder="john@company.com" value={form.email_to} onChange={e=>set('email_to',e.target.value)}/>
                    </div>
                  </div>
                )}

                {/* Company contact fields — call and visit only */}
                {isCompany && (actionMode === 'call' || actionMode === 'visit') && (
                  <>
                    <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:10 }}>Contact Person</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="form-label">Contact Name</label>
                        <input className="form-input" placeholder="Who did you talk to?" value={form.contact_name} onChange={e=>set('contact_name',e.target.value)}/>
                      </div>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="form-label">Title / Role</label>
                        <input className="form-input" placeholder="Fleet Manager…" value={form.role_title} onChange={e=>set('role_title',e.target.value)}/>
                      </div>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="form-label">Direct Line</label>
                        <input className="form-input" placeholder="Direct number" value={form.direct_line} onChange={e=>set('direct_line',e.target.value)}/>
                      </div>
                      <div className="form-group" style={{ margin:0 }}>
                        <label className="form-label">Email</label>
                        <input className="form-input" type="email" placeholder="email@company.com" value={form.email} onChange={e=>set('email',e.target.value)}/>
                      </div>
                    </div>
                    {form.contact_name && (
                      <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--gray-600)', marginBottom:16 }}>
                        <input type="checkbox" checked={form.set_as_preferred} onChange={e=>set('set_as_preferred',e.target.checked)} style={{ width:15, height:15, accentColor:'var(--gold-500)' }}/>
                        Set as preferred contact for this company
                      </label>
                    )}
                  </>
                )}

                {/* What Happened — all modes */}
                {(
                <div>
                <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:10 }}>What Happened</div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:14 }}>
                  {types.map(t => (
                    <button key={t} type="button" onClick={() => set('contact_type', t)}
                      style={{ padding:'6px 14px', borderRadius:20, fontSize:13, fontWeight:600, cursor:'pointer',
                        border:`1.5px solid ${form.contact_type===t?'var(--navy-700)':'var(--gray-200)'}`,
                        background: form.contact_type===t?'var(--navy-800)':'white',
                        color: form.contact_type===t?'white':'var(--gray-700)',
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
                </div>
                )}

                <div className="form-group">
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={4}
                    placeholder={actionMode==='mail'?'Anything to note about this mailing…':actionMode==='email'?'Anything to note about this email…':'What was discussed? Key details, promises made, objections…'}
                    value={form.notes} onChange={e=>set('notes',e.target.value)}/>
                </div>

                {/* Next action */}
                <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:10 }}>Next Action</div>
                <div className="next-action-group" style={{ marginBottom:14 }}>
                  <button type="button" className={`action-btn${form.next_action==='Call'?' selected-call':''}`} onClick={()=>set('next_action','Call')}>📞 Call</button>
                  <button type="button" className={`action-btn${form.next_action==='Mail'?' selected-call':''}`} onClick={()=>set('next_action','Mail')}>✉️ Mail</button>
                  <button type="button" className={`action-btn${form.next_action==='Email'?' selected-call':''}`} onClick={()=>set('next_action','Email')}>📧 Email</button>
                  {isCompany && <button type="button" className={`action-btn${form.next_action==='Visit'?' selected-visit':''}`} onClick={()=>set('next_action','Visit')}>📍 Visit</button>}
                  <button type="button" className={`action-btn${form.next_action==='Stop'?' selected-stop':''}`} onClick={()=>set('next_action','Stop')}>🚫 Stop</button>
                </div>

                {/* Manual follow-up date */}
                <div className="form-group">
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--gray-600)' }}>
                    <input type="checkbox" checked={form.show_date_override} onChange={e=>set('show_date_override',e.target.checked)} style={{ width:15, height:15, accentColor:'var(--gold-500)' }}/>
                    Set follow-up date manually
                  </label>
                  {form.show_date_override && (
                    <input className="form-input" type="date" style={{ marginTop:8 }}
                      value={form.next_action_date_override}
                      onChange={e=>set('next_action_date_override',e.target.value)}
                      min={nowDateStr()}
                    />
                  )}
                </div>

                <div style={{ display:'flex', gap:10, marginTop:6 }}>
                  <button className="btn btn-primary btn-lg" style={{ flex:1 }} onClick={handleSave}
                    disabled={saving || !form.contact_type}>
                    {saving ? 'Saving…' : '✅ Save Log'}
                  </button>
                  <button className="btn btn-ghost btn-lg" onClick={()=>setSelected(null)}>Cancel</button>
                </div>
              </div>
            )}

            {/* Success state */}
            {selected && saved && (
              <div className="table-card" style={{ padding:'32px 24px', textAlign:'center' }}>
                <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
                <div style={{ fontSize:20, fontWeight:800, marginBottom:6 }}>Logged for {selected.name}</div>
                <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:24 }}>
                  {actionMode === 'mail' ? `Mail — ${form.mail_piece}` : actionMode === 'email' ? `Email — ${form.email_template}` : form.contact_type} · {form.next_action==='Stop'?'No follow-up scheduled':form.next_action==='Call'?'Follow-up call scheduled':form.next_action==='Visit'?'Visit scheduled':form.next_action==='Mail'?'Mail follow-up scheduled':form.next_action==='Email'?'Email follow-up scheduled':'Follow-up scheduled'}
                </div>
                <div style={{ display:'flex', gap:10, justifyContent:'center' }}>
                  <button className="btn btn-primary btn-lg" onClick={logAnother}>⚡ Log Another</button>
                  <button className="btn btn-ghost btn-lg" onClick={()=>{ setSelected(null); setSaved(false); }}>Log More for {selected.name}</button>
                </div>
              </div>
            )}
          </div>

          {/* Right: history (when company selected) or recent logs */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {selected && (
              <div className="table-card" style={{ padding:0 }}>
                <div className="table-card-header" style={{ background:'var(--navy-950)', borderRadius:'10px 10px 0 0' }}>
                  <span style={{ fontSize:15 }}>📋</span>
                  <span className="table-card-title" style={{ color:'white' }}>History</span>
                  <span className="table-card-count">{hist.length}</span>
                </div>
                {histLoading ? (
                  <div style={{ padding:'20px 16px', textAlign:'center', fontSize:13, color:'var(--gray-400)' }}>Loading…</div>
                ) : hist.length === 0 ? (
                  <div style={{ padding:'20px 16px', textAlign:'center', fontSize:13, color:'var(--gray-400)' }}>No history yet — this will be the first log</div>
                ) : hist.map(h => (
                  <div key={h.id} style={{ padding:'10px 16px', borderBottom:'1px solid var(--gray-100)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ fontWeight:700, fontSize:12.5, color:'var(--gray-900)' }}>{h.contact_type || h.mail_piece || h.email_template || h.log_category}</div>
                      <div style={{ fontSize:10, color:'var(--gray-400)', flexShrink:0, marginLeft:6 }}>{h.logged_at?.slice(0,10)}</div>
                    </div>
                    {h.contact_name && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>with {h.contact_name}</div>}
                    {h.notes && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:3, lineHeight:1.4 }}>{h.notes.length>100?h.notes.slice(0,100)+'…':h.notes}</div>}
                    <div style={{ fontSize:10, color:'var(--gray-300)', marginTop:2 }}>Next: {h.next_action}</div>
                  </div>
                ))}
              </div>
            )}
            {selected && allContacts.length > 0 && (
              <div className="table-card" style={{ padding:0 }}>
                <div className="table-card-header">
                  <span style={{ fontSize:15 }}>👥</span>
                  <span className="table-card-title">Contacts</span>
                  <span className="table-card-count">{allContacts.length}</span>
                </div>
                {allContacts.map(c => (
                  <div key={c.id} style={{ padding:'9px 16px', borderBottom:'1px solid var(--gray-100)', display:'flex', alignItems:'flex-start', gap:8 }}>
                    {c.is_preferred && <span style={{ fontSize:11, marginTop:1, flexShrink:0 }}>⭐</span>}
                    <div style={{ minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:12.5, color:'var(--gray-900)' }}>{c.name}</div>
                      {c.role_title && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{c.role_title}</div>}
                      {c.direct_line && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>📱 {c.direct_line}</div>}
                      {c.email && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>✉️ {c.email}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="table-card" style={{ padding:0 }}>
              <div className="table-card-header">
                <span style={{ fontSize:15 }}>🕐</span>
                <span className="table-card-title">Logged This Session</span>
                <span className="table-card-count">{recentLogs.length}</span>
              </div>
              {recentLogs.length === 0 ? (
                <div style={{ padding:'24px 16px', textAlign:'center', fontSize:13, color:'var(--gray-400)' }}>
                  Logs you save will appear here
                </div>
              ) : (
                recentLogs.map((log, i) => (
                  <div key={i} style={{ padding:'10px 16px', borderBottom:'1px solid var(--gray-100)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                      <div style={{ fontWeight:700, fontSize:13, color:'var(--gray-900)' }}>{log.name}</div>
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:2 }}>
                      {log.contact_type} · {log.next_action}
                    </div>
                    {log.notes && (
                      <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {log.notes}
                      </div>
                    )}
                    <div style={{ fontSize:10, color:'var(--gray-300)', marginTop:3 }}>
                      {log.loggedAt.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Tips card */}
            <div className="table-card" style={{ padding:'16px 18px', background:'var(--navy-950)', border:'none' }}>
              <div style={{ fontWeight:700, fontSize:13, color:'var(--gold-400)', marginBottom:10 }}>💡 Quick Log Tips</div>
              {[
                'Search by name, phone, or company',
                'Drop In is pre-listed for walk-in visits',
                'New log auto-cancels any old follow-up',
                'Most recent call always wins',
                'Set follow-up manually to override rules',
              ].map((tip,i) => (
                <div key={i} style={{ fontSize:12, color:'var(--gray-400)', padding:'4px 0', borderBottom:i<4?'1px solid rgba(255,255,255,.05)':'none' }}>
                  · {tip}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {pendingScorecard && (
        <ScoreCardModal
          entityName={pendingScorecard.entityName}
          entityId={pendingScorecard.entityId}
          callLogId={null}
          onClose={()=>setPendingScorecard(null)}
          onSaved={()=>{ setPendingScorecard(null); showToast('✅ Scorecard saved'); }}
        />
      )}
    </>
  );
}
