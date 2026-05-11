import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api, fmtPhone, fmtDate, companyDisplayName } from '../api.js';
import { useApp } from '../App.jsx';
import UpcomingList from '../components/UpcomingList.jsx';
import MoveModal from '../components/MoveModal.jsx';
import QueueFilter from '../components/QueueFilter.jsx';
import RowActions from '../components/RowActions.jsx';
import ForecastStrip from '../components/ForecastStrip.jsx';

export default function EmailQueue() {
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [movingId, setMovingId] = useState(null);
  const [qFilter, setQFilter]     = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [form, setForm]         = useState({ email_template:'', email_to:'', contact_type:'', notes:'', next_action:'Call', next_action_date_override:'', show_date:false });
  const [forecast, setForecast]     = useState([]);
  const [allRows, setAllRows]         = useState([]);
  const [contactTypes, setContactTypes] = useState([]);
  const [hist, setHist]           = useState([]);
  const [histLoading, setHistLoading] = useState(false);
  const [expandedNote, setExpandedNote] = useState(null);
  const [selStatus, setSelStatus] = useState(null);
  const [allContacts, setAllContacts] = useState([]);
  const [prefContact, setPrefContact] = useState(null);
  const [editingPref, setEditingPref] = useState(false);
  const [prefEdit, setPrefEdit]   = useState({ name:'', role_title:'', direct_line:'', email:'' });
  const [prefSaving, setPrefSaving] = useState(false);
  const navigate = useNavigate();
  const { showToast, refreshCounts } = useApp();

  async function load() {
    setLoading(true);
    try {
      const [r, t, fc, ct] = await Promise.all([api.emailQueue(), api.emailTemplates(), api.pipelineForecast(), api.contactTypes()]);
      setForecast(fc || []);
      setAllRows(r || []);
      setContactTypes((ct?.configured || []).filter(r => r.action_type === 'email' && r.enabled !== 0).map(r => r.contact_type));
      const today = new Date().toISOString().split('T')[0];
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + (6 - weekEnd.getDay())); const weekEndStr = weekEnd.toISOString().split('T')[0];
      const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).toISOString().split('T')[0];
      setRows(r.filter(row => {
        if (!row.due_date) return qFilter === 'all';
        if (qFilter === 'today') return row.due_date <= today;
        if (qFilter === 'week')  return row.due_date <= weekEndStr;
        if (qFilter === 'month') return row.due_date <= monthEnd;
        if (qFilter === 'custom') return (!customFrom || row.due_date >= customFrom) && (!customTo || row.due_date <= customTo);
        return true;
      }));
      setTemplates(t);
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [qFilter, customFrom, customTo]);

  useEffect(() => {
    if (!selected) { setHist([]); setSelStatus(null); setAllContacts([]); setPrefContact(null); setEditingPref(false); return; }
    setSelStatus(selected.company_status || 'prospect');
    setEditingPref(false);
    setHistLoading(true);
    api.companyHistory(selected.id).then(h => setHist(h || [])).catch(()=>setHist([])).finally(()=>setHistLoading(false));
    api.company(selected.id).then(c => {
      const contacts = c.contacts || [];
      setAllContacts(contacts);
      setPrefContact(contacts.find(x => x.is_preferred) || null);
    }).catch(()=>{});
  }, [selected?.id]);

  async function handleStatusChange(status) {
    if (!selected) return;
    setSelStatus(status);
    try {
      await api.updateCompanyStatus(selected.id, status);
      setRows(r => r.map(row => row.id === selected.id ? { ...row, company_status: status } : row));
    } catch(e) { showToast(e.message, 'error'); setSelStatus(selected.company_status || 'prospect'); }
  }

  async function savePref() {
    if (!prefContact) return;
    setPrefSaving(true);
    try {
      await api.updateContact(prefContact.id, { ...prefEdit, is_preferred: true });
      setPrefContact(p => ({ ...p, ...prefEdit }));
      setEditingPref(false);
      showToast('✅ Contact updated');
    } catch(e) { showToast(e.message, 'error'); }
    finally { setPrefSaving(false); }
  }

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  // When template selected, auto-fill email_to from preferred contact
  function selectTemplate(name) {
    set('email_template', name);
    if (selected?.preferred_email && !form.email_to) set('email_to', selected.preferred_email);
  }

  async function handleLog(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.logEmail(selected.id, {
        email_template: form.email_template,
        email_to:       form.email_to,
        contact_type:   form.contact_type || 'Sent',
        notes:          form.notes,
        next_action:    form.next_action,
        next_action_date_override: form.show_date && form.next_action_date_override ? form.next_action_date_override : undefined,
      });
      showToast('Email logged');
      setSelected(null);
      setForm({ email_template:'', email_to:'', contact_type:'', notes:'', next_action:'Call', next_action_date_override:'', show_date:false });
      await load(); await refreshCounts();
    } catch(e) { showToast(e.message,'error'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">📧 Email Queue</div>
          <ForecastStrip forecast={forecast} queueKey="email" />
        </div>
        <div className="header-actions">
          <QueueFilter value={qFilter} onChange={setQFilter} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
        </div>
      </div>

      <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div className="table-card">
          <div className="table-card-header">
            <span>📧</span>
            <span className="table-card-title">Email Queue</span>
            <span className="table-card-count">click a row to log email</span>
          </div>

          {loading ? <div className="loading-wrap"><div className="spinner"/></div>
          : rows.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📭</div>
              <div className="title">Email queue empty</div>
              <div className="desc">Move companies here from the pipeline board or when logging a call</div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="queue-table">
                <thead><tr><th>Company</th><th>Phone</th><th className="col-industry">Industry</th><th className="col-contacts">Contacts</th><th className="col-preferred">Email Contact</th><th>Due</th><th></th></tr></thead>
                <tbody>
                  {rows.map(row => {
                    const isSel = selected?.id === row.id;
                    return (
                      <tr key={row.id} onClick={() => setSelected(p => p?.id===row.id ? null : row)}
                        style={{ cursor:'pointer', background:isSel?'#faf5ff':undefined, borderLeft:isSel?'3px solid #a855f7':'3px solid transparent' }}>
                        <td className="col-company">
                          {row.company_status && row.company_status !== 'prospect' && (
                            <div style={{ fontSize:10, fontWeight:700, marginBottom:3,
                              color:row.company_status==='interested'?'#92400e':row.company_status==='customer'?'#166534':'#dc2626',
                              background:row.company_status==='interested'?'#fef9c3':row.company_status==='customer'?'#f0fdf4':'#fef2f2',
                              display:'inline-block', padding:'1px 7px', borderRadius:8 }}>
                              {row.company_status==='interested'?'⭐ Interested':row.company_status==='customer'?'✅ Customer':'⏹️ Stopped'}
                            </div>
                          )}
                          <div
                            style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3, display:'inline' }}
                            onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+row.id); }}
                            title="Open company profile"
                          >
                           {companyDisplayName(row)}
                          </div>
                          <div className="col-sub-mobile">
                            {row.preferred_contact_name && <span style={{ fontSize:11, color:'var(--gray-500)' }}>{row.preferred_contact_name}{row.preferred_email ? ` · ${row.preferred_email}` : ''}</span>}
                            {row.industry && <span style={{ fontSize:11, color:'var(--gray-400)', marginLeft:6 }}>{row.industry}</span>}
                          </div>
                        </td>
                        <td className="col-phone"><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                        <td className="col-industry">{row.industry?<span className="badge badge-gray">{row.industry}</span>:'—'}</td>
                        <td className="col-contacts">
                          <div style={{ fontSize:12, color:'var(--gray-700)' }}>{row.call_count || 0}</div>
                          {(!row.call_count || row.call_count === 0) && <div style={{ fontSize:10, color:'var(--gray-400)' }}>First Time</div>}
                        </td>
                        <td className="col-preferred" style={{ fontSize:12 }}>
                          {row.preferred_contact_name ? <div><span style={{ fontWeight:600 }}>{row.preferred_contact_name}</span>{row.preferred_email && <div style={{ color:'var(--gray-400)', fontSize:11 }}>{row.preferred_email}</div>}</div> : '—'}
                        </td>
                        <td className="col-due" style={{ fontSize:12 }}>{row.due_date?fmtDate(row.due_date):'—'}</td>
                        <td className="col-actions" onClick={e=>e.stopPropagation()} style={{textAlign:'right'}}>
                          <RowActions
                            companyStatus={row.company_status || 'prospect'}
                            onStatusChange={async(status) => {
                              await api.updateCompanyStatus(row.id, status);
                              load();
                            }}
                            onMove={() => setMovingId(row.id)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Log email form — fixed modal overlay */}
        {selected && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
            onClick={e=>{ if(e.target===e.currentTarget) setSelected(null); }}>
            <div className="log-modal-columns" style={{ display:'flex', background:'white', borderRadius:14, overflow:'hidden', boxShadow:'0 8px 40px rgba(0,0,0,.25)', maxWidth:960, width:'100%', maxHeight:'90vh' }}>
              {/* Left sidebar: company info + templates + history */}
              <div style={{ width:270, flexShrink:0, borderRight:'1px solid var(--gray-200)', background:'var(--navy-950)', display:'flex', flexDirection:'column', overflowY:'auto' }}>
                <div style={{ padding:'20px 16px 14px', flexShrink:0 }}>
                  <div style={{ fontWeight:800, fontSize:15, color:'white' }}>{companyDisplayName(selected)}</div>
                  <div style={{ fontSize:13, color:'var(--gold-400)', marginTop:2, fontFamily:'var(--font-mono)' }}>{fmtPhone(selected.main_phone)}</div>
                  {selected.address && <div style={{ fontSize:12, color:'rgba(255,255,255,.45)', marginTop:6 }}>📍 {selected.address}{selected.city?', '+selected.city:''}</div>}
                  {/* Preferred contact with edit */}
                  {(prefContact || selected.preferred_contact_name) && (
                    <div style={{ marginTop:12, padding:'10px', background:'rgba(255,255,255,.08)', borderRadius:8 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                        <div style={{ fontSize:10, color:'var(--gold-400)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em' }}>⭐ Preferred Contact</div>
                        {prefContact && !editingPref && (
                          <button type="button" onClick={()=>{ setPrefEdit({ name:prefContact.name||'', role_title:prefContact.role_title||'', direct_line:prefContact.direct_line||'', email:prefContact.email||'' }); setEditingPref(true); }}
                            style={{ fontSize:10, fontWeight:700, color:'var(--gold-400)', background:'rgba(251,191,36,.15)', border:'1px solid rgba(251,191,36,.3)', borderRadius:4, padding:'2px 7px', cursor:'pointer' }}>
                            ✏️ Edit
                          </button>
                        )}
                      </div>
                      {!editingPref ? (
                        <>
                          <div style={{ color:'white', fontWeight:600, fontSize:13 }}>{prefContact?.name || selected.preferred_contact_name}</div>
                          {prefContact?.role_title && <div style={{ color:'rgba(255,255,255,.5)', fontSize:11, marginTop:1 }}>{prefContact.role_title}</div>}
                          {prefContact?.direct_line && <div style={{ color:'rgba(255,255,255,.45)', fontSize:11, marginTop:1 }}>📱 {prefContact.direct_line}</div>}
                          {(prefContact?.email || selected.preferred_email) && <div style={{ color:'rgba(255,255,255,.45)', fontSize:11, marginTop:1 }}>✉️ {prefContact?.email || selected.preferred_email}</div>}
                        </>
                      ) : (
                        <div style={{ display:'flex', flexDirection:'column', gap:5, marginTop:4 }}>
                          {[['name','Name'],['role_title','Role'],['direct_line','Direct line'],['email','Email']].map(([f,pl])=>(
                            <input key={f} style={{ fontSize:11, padding:'4px 7px', border:'1px solid rgba(251,191,36,.4)', borderRadius:4, background:'rgba(255,255,255,.1)', color:'white', width:'100%', boxSizing:'border-box' }}
                              placeholder={pl} value={prefEdit[f]} onChange={e=>setPrefEdit(p=>({...p,[f]:e.target.value}))} type={f==='email'?'email':'text'} />
                          ))}
                          <div style={{ display:'flex', gap:5 }}>
                            <button type="button" onClick={savePref} disabled={prefSaving}
                              style={{ flex:1, fontSize:11, fontWeight:700, padding:'4px 0', background:'#92400e', color:'white', border:'none', borderRadius:4, cursor:'pointer' }}>
                              {prefSaving?'Saving…':'✅ Save'}
                            </button>
                            <button type="button" onClick={()=>setEditingPref(false)}
                              style={{ fontSize:11, padding:'4px 8px', background:'rgba(255,255,255,.1)', color:'rgba(255,255,255,.6)', border:'none', borderRadius:4, cursor:'pointer' }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {templates.length > 0 && (
                    <div style={{ marginTop:12 }}>
                      <div style={{ fontSize:9.5, color:'rgba(255,255,255,.4)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Email Templates</div>
                      {templates.map(t => (
                        <div key={t.id} onClick={()=>selectTemplate(t.name)}
                          style={{ padding:'7px 9px', borderRadius:7, cursor:'pointer', marginBottom:4, background:form.email_template===t.name?'rgba(168,85,247,.3)':'rgba(255,255,255,.08)', border:`1px solid ${form.email_template===t.name?'#a855f7':'transparent'}` }}>
                          <div style={{ fontSize:11, fontWeight:600, color:'white' }}>{t.name}</div>
                          {t.subject && <div style={{ fontSize:10, color:'var(--gray-400)' }}>{t.subject}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Other contacts */}
                  {allContacts.filter(c => !c.is_preferred).length > 0 && (
                    <div style={{ marginTop:10 }}>
                      <div style={{ fontSize:9.5, color:'rgba(255,255,255,.4)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:6 }}>Other Contacts</div>
                      {allContacts.filter(c => !c.is_preferred).map(c => (
                        <div key={c.id} style={{ padding:'7px 9px', background:'rgba(255,255,255,.06)', borderRadius:6, marginBottom:5 }}>
                          <div style={{ color:'white', fontWeight:600, fontSize:12 }}>{c.name}</div>
                          {c.role_title && <div style={{ color:'rgba(255,255,255,.45)', fontSize:10, marginTop:1 }}>{c.role_title}</div>}
                          {c.direct_line && <div style={{ color:'rgba(255,255,255,.4)', fontSize:10, marginTop:1 }}>📱 {c.direct_line}</div>}
                          {c.email && <div style={{ color:'rgba(255,255,255,.4)', fontSize:10, marginTop:1 }}>✉️ {c.email}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {/* History */}
                <div style={{ flex:1, borderTop:'1px solid rgba(255,255,255,.08)', padding:'10px 16px 16px', minHeight:0, overflowY:'auto' }}>
                  <div style={{ fontSize:9.5, color:'rgba(255,255,255,.4)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', marginBottom:8 }}>
                    History {hist.length > 0 ? `(${hist.length})` : ''}
                  </div>
                  {histLoading ? <div style={{ color:'rgba(255,255,255,.3)', fontSize:11 }}>Loading…</div>
                  : hist.length === 0 ? <div style={{ color:'rgba(255,255,255,.25)', fontSize:11 }}>No activity yet</div>
                  : hist.map(h => (
                    <div key={h.id} style={{ paddingBottom:8, marginBottom:8, borderBottom:'1px solid rgba(255,255,255,.07)' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:4 }}>
                        <span style={{ color:'white', fontSize:11, fontWeight:700, lineHeight:1.3 }}>{h.contact_type || h.mail_piece || h.email_template || h.log_category}</span>
                        <span style={{ color:'rgba(255,255,255,.3)', fontSize:9.5, flexShrink:0 }}>{h.logged_at?.slice(0,10)}</span>
                      </div>
                      {h.contact_name && <div style={{ color:'rgba(255,255,255,.45)', fontSize:10, marginTop:1 }}>with {h.contact_name}</div>}
                      {h.notes && (() => { const long = h.notes.length > 100; return (
                        <div style={{ color:'rgba(255,255,255,.35)', fontSize:10, marginTop:2, lineHeight:1.4,
                          ...(long ? { overflow:'hidden', display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', cursor:'pointer' } : {}) }}
                          onClick={() => long && setExpandedNote(h.notes)}>
                          {h.notes}{long && <span style={{ color:'var(--gold-400)', fontWeight:600 }}> read more</span>}
                        </div>
                      ); })()}
                    </div>
                  ))}
                </div>
              </div>
              {/* Right: log form */}
              <form onSubmit={handleLog} style={{ flex:1, padding:'22px 24px', display:'flex', flexDirection:'column', gap:16, overflowY:'auto' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>📧 Log Email</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {selStatus !== null && (
                      <select value={selStatus} onChange={e=>handleStatusChange(e.target.value)}
                        style={{ fontSize:12, fontWeight:700, padding:'5px 10px', borderRadius:7, cursor:'pointer', border:'1px solid var(--gray-200)', background:'white', color:'var(--gray-800)' }}>
                        <option value="prospect">Prospect</option>
                        <option value="interested">⭐ Interested</option>
                        <option value="customer">✅ Customer</option>
                      </select>
                    )}
                    <button type="button" onClick={()=>setSelected(null)} style={{ border:'none', background:'none', cursor:'pointer', fontSize:20, color:'var(--gray-400)', lineHeight:1 }}>✕</button>
                  </div>
                </div>
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
                {contactTypes.length > 0 && (
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:8 }}>What Happened?</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                      {contactTypes.map(t => (
                        <button key={t} type="button"
                          onClick={() => set('contact_type', t)}
                          style={{ padding:'5px 11px', borderRadius:7, border:`1.5px solid ${form.contact_type===t?'#7c3aed':'var(--gray-200)'}`, background:form.contact_type===t?'#7c3aed':'white', color:form.contact_type===t?'white':'var(--gray-700)', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} placeholder="Anything to note about this email…" value={form.notes} onChange={e=>set('notes',e.target.value)}/>
                </div>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:8 }}>Next Action</div>
                  <div className="next-action-group">
                    {['Call','Mail','Email','Visit','Stop'].map(a => (
                      <button key={a} type="button" className={`action-btn${form.next_action===a?' selected-call':''}`} onClick={()=>set('next_action',a)}>
                        {a==='Call'?'📞 ':a==='Mail'?'✉️ ':a==='Email'?'📧 ':a==='Visit'?'📍 ':'🚫 '}{a}
                      </button>
                    ))}
                  </div>
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:'var(--gray-600)', marginTop:10 }}>
                    <input type="checkbox" checked={form.show_date} onChange={e=>set('show_date',e.target.checked)} style={{ accentColor:'var(--gold-500)' }}/>
                    Set follow-up date manually
                  </label>
                  {form.show_date && <input type="date" className="form-input" style={{ marginTop:8 }} value={form.next_action_date_override} onChange={e=>set('next_action_date_override',e.target.value)} min={new Date().toISOString().split('T')[0]}/>}
                </div>
                <button type="submit" className="btn btn-primary btn-lg" style={{ width:'100%' }} disabled={saving||(contactTypes.length>0&&!form.contact_type)}>
                  {saving?'Saving…':'✅ Log Email & Complete'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>


      {movingId && (
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); load(); }}
        />
      )}

      {expandedNote && (
        <div onClick={() => setExpandedNote(null)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'white', borderRadius:12, padding:24, maxWidth:520, width:'100%', maxHeight:'70vh', overflowY:'auto', boxShadow:'0 8px 32px rgba(0,0,0,.25)' }}>
            <div style={{ fontWeight:700, fontSize:14, color:'var(--gray-900)', marginBottom:12 }}>📝 Full Note</div>
            <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.6, whiteSpace:'pre-wrap' }}>{expandedNote}</div>
            <button onClick={() => setExpandedNote(null)}
              style={{ marginTop:18, padding:'8px 20px', background:'var(--navy-800)', color:'white', border:'none', borderRadius:7, cursor:'pointer', fontWeight:600 }}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
