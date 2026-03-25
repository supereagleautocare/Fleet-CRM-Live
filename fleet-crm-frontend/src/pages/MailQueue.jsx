import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';
import UpcomingList from '../components/UpcomingList.jsx';
import MoveModal from '../components/MoveModal.jsx'; 
import QueueFilter from '../components/QueueFilter.jsx';
import RowActions from '../components/RowActions.jsx';
import ForecastStrip from '../components/ForecastStrip.jsx';

export default function MailQueue() {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [pieces, setPieces]       = useState([]);
  const [selected, setSelected]   = useState(null);
  const [saving, setSaving]       = useState(false);
  const [movingId, setMovingId]   = useState(null);
  const [qFilter, setQFilter]     = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo]     = useState('');
  const [forecast, setForecast]   = useState([]);
  const [allRows, setAllRows]     = useState([]);
  const [form, setForm]           = useState({ mail_piece:'', notes:'', contact_type:'', next_action:'Call', next_action_date_override:'', show_date:false });
  const [contactTypes, setContactTypes] = useState([]);
  const navigate = useNavigate();
  const { showToast, refreshCounts } = useApp();

  async function load() {
    setLoading(true);
    try {
      const [r, p, fc, ar] = await Promise.all([api.mailQueue(), api.mailPieces(), api.pipelineForecast(), api.mailQueue()]);
      setForecast(fc || []);
      setAllRows(ar || []);
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
      setPieces(p);
      const ct = await api.contactTypes();
      setContactTypes((ct?.configured || []).filter(r => r.action_type === 'mail' && r.enabled !== 0).map(r => r.contact_type));
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [qFilter, customFrom, customTo]);

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  async function handleLog(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.logMail(selected.id, {
        mail_piece:    form.mail_piece,
        contact_type:  form.contact_type || 'Sent',
        notes:         form.notes,
        next_action:   form.next_action,
        next_action_date_override: form.show_date && form.next_action_date_override ? form.next_action_date_override : undefined,
      });
      showToast('Mail logged');
      setSelected(null);
      setForm({ mail_piece:'', notes:'', contact_type:'', next_action:'Call', next_action_date_override:'', show_date:false });
      await load(); await refreshCounts();
    } catch(e) { showToast(e.message,'error'); }
    finally { setSaving(false); }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">✉️ Mail Queue</div>
          <ForecastStrip forecast={forecast} queueKey="mail" />
        </div>
        <div className="header-actions">
          <QueueFilter value={qFilter} onChange={setQFilter} customFrom={customFrom} customTo={customTo} onCustomFrom={setCustomFrom} onCustomTo={setCustomTo} />
        </div>
      </div>

      <div className="page-body" style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <div className="table-card">
          <div className="table-card-header">
            <span>✉️</span>
            <span className="table-card-title">Mail Queue</span>
            <span className="table-card-count">click a row to log mail</span>
          </div>

          {loading ? <div className="loading-wrap"><div className="spinner"/></div>
          : rows.length === 0 ? (
            <div className="empty-state">
              <div className="icon">📭</div>
              <div className="title">Mail queue empty</div>
              <div className="desc">Move companies here from the pipeline board or when logging a call</div>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead><tr><th>Company</th><th>Phone</th><th>Industry</th><th>Contacts</th><th>Preferred Contact</th><th>Due</th><th></th></tr></thead>
                <tbody>
                  {rows.map(row => {
                    const isSel = selected?.id === row.id;
                    return (
                      <tr key={row.id} onClick={() => setSelected(p => p?.id===row.id ? null : row)}
                        style={{ cursor:'pointer', background:isSel?'#ecfdf5':undefined, borderLeft:isSel?'3px solid #10b981':'3px solid transparent' }}>
                        <td>
                          {row.company_status && row.company_status !== 'prospect' && (
                            <div style={{ fontSize:10, fontWeight:700, marginBottom:3,
                              color:row.company_status==='interested'?'#92400e':row.company_status==='customer'?'#166534':'#dc2626',
                              background:row.company_status==='interested'?'#fef9c3':row.company_status==='customer'?'#f0fdf4':'#fef2f2',
                              display:'inline-block', padding:'1px 7px', borderRadius:8 }}>
                              {row.company_status==='interested'?'⭐ Interested':row.company_status==='customer'?'✅ Customer':'💀 Dead'}
                            </div>
                          )}
                          <div
                            style={{ fontWeight:700, fontSize:13, color:'var(--navy-700)', cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:3, display:'inline' }}
                            onClick={e=>{ e.stopPropagation(); navigate('/companies?company='+row.id); }}
                            title="Open company profile"
                          >
                            {row.name}
                          </div>
                          </td>
                        <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                        <td>{row.industry?<span className="badge badge-gray">{row.industry}</span>:'—'}</td>
                        <td>
                          <div style={{ fontSize:12, color:'var(--gray-700)' }}>{row.call_count || 0}</div>
                          {(!row.call_count || row.call_count === 0) && <div style={{ fontSize:10, color:'var(--gray-400)' }}>First Time</div>}
                        </td>
                        <td style={{ fontSize:12 }}>{row.preferred_contact_name||'—'}</td>
                        <td style={{ fontSize:12 }}>{row.due_date?fmtDate(row.due_date):'—'}</td>
                        <td onClick={e=>e.stopPropagation()} style={{textAlign:'right'}}>
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

        {/* Log mail form — fixed modal overlay */}
        {selected && (
          <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
            onClick={e=>{ if(e.target===e.currentTarget) setSelected(null); }}>
            <div style={{ display:'flex', background:'white', borderRadius:14, overflow:'hidden', boxShadow:'0 8px 40px rgba(0,0,0,.25)', maxWidth:780, width:'100%', maxHeight:'90vh' }}>
              {/* Left: company info */}
              <div style={{ width:240, flexShrink:0, borderRight:'1px solid var(--gray-200)', padding:'20px 16px', background:'var(--navy-950)', overflowY:'auto' }}>
                <div style={{ fontWeight:800, fontSize:15, color:'white' }}>{selected.name}</div>
                <div style={{ fontSize:13, color:'var(--gold-400)', marginTop:2, fontFamily:'var(--font-mono)' }}>{fmtPhone(selected.main_phone)}</div>
                {selected.address && <div style={{ fontSize:12, color:'rgba(255,255,255,.45)', marginTop:6 }}>📍 {selected.address}{selected.city?', '+selected.city:''}</div>}
                {selected.preferred_contact_name && (
                  <div style={{ marginTop:14, padding:'10px', background:'rgba(255,255,255,.08)', borderRadius:8 }}>
                    <div style={{ fontSize:10, color:'var(--gold-400)', fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:4 }}>⭐ Preferred Contact</div>
                    <div style={{ color:'white', fontWeight:600, fontSize:13 }}>{selected.preferred_contact_name}</div>
                    {selected.preferred_role && <div style={{ color:'var(--gray-400)', fontSize:11 }}>{selected.preferred_role}</div>}
                  </div>
                )}
              </div>
              {/* Right: log form */}
              <form onSubmit={handleLog} style={{ flex:1, padding:'22px 24px', display:'flex', flexDirection:'column', gap:16, overflowY:'auto' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontWeight:800, fontSize:16 }}>✉️ Log Mail Piece</div>
                  <button type="button" onClick={()=>setSelected(null)} style={{ border:'none', background:'none', cursor:'pointer', fontSize:20, color:'var(--gray-400)', lineHeight:1 }}>✕</button>
                </div>
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Mail Piece Sent </label>
                  {pieces.length > 0
                   ? <select className="form-input" value={form.mail_piece} onChange={e=>set('mail_piece',e.target.value)}>
                       <option value="">Select piece…</option>
                       {pieces.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}
                     </select>
                   : <input className="form-input" placeholder="e.g. Postcard A, Intro Letter…" value={form.mail_piece} onChange={e=>set('mail_piece',e.target.value)}/>
                 }
                  {pieces.length === 0 && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:3 }}>Add mail pieces in Settings to use a dropdown</div>}
                </div>
                
                {contactTypes.length > 0 && (
                  <div>
                    <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'var(--gray-400)', marginBottom:8 }}>What Happened?</div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                      {contactTypes.map(t => (
                        <button key={t} type="button"
                          onClick={() => set('contact_type', t)}
                          style={{ padding:'5px 11px', borderRadius:7, border:`1.5px solid ${form.contact_type===t?'var(--navy-700)':'var(--gray-200)'}`, background:form.contact_type===t?'var(--navy-800)':'white', color:form.contact_type===t?'white':'var(--gray-700)', fontSize:12, fontWeight:600, cursor:'pointer' }}>
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="form-group" style={{ margin:0 }}>
                  <label className="form-label">Notes</label>
                  <textarea className="form-textarea" rows={3} placeholder="Anything to note about this mailing…" value={form.notes} onChange={e=>set('notes',e.target.value)}/>
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
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  style={{ width:'100%' }}
                  disabled={saving || !form.contact_type}
                >
                 {saving ? 'Saving…' : '✅ Log Mail & Complete'}
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
    </>
  );
}
