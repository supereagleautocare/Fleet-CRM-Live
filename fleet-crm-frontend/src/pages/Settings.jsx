import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ScriptEditor from '../components/ScriptEditor.jsx';
import ScoreCardSettings from '../components/ScoreCardSettings.jsx';
import ScoreCardModal from '../components/ScoreCardModal.jsx';

export default function Settings() {
  const [rules, setRules]     = useState([]);
  const [settings, setSettings] = useState({});
  const [users, setUsers]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(null);
  const [newUser, setNewUser] = useState({ name:'', email:'', password:'', role:'user' });
  const location = useLocation();
  const [tab, setTab] = useState(() => {
    const p = new URLSearchParams(location.search).get('tab');
    return p || 'followups';
  });
  const [newTypes, setNewTypes] = useState({ call:'', mail:'', email:'', visit:'' });
  const [previewScorecard, setPreviewScorecard] = useState(null);

  useEffect(()=>{
    function handlePreview() {
      setPreviewScorecard({
        scriptId: window.__scorecardPreviewScriptId,
        scriptName: window.__scorecardPreviewScriptName || 'Preview',
      });
    }
    window.addEventListener('scorecard-preview', handlePreview);
    return ()=>window.removeEventListener('scorecard-preview', handlePreview);
  },[]);
  const [addingType, setAddingType] = useState({});
  const { showToast, user } = useApp();

  async function load() {
    setLoading(true);
    try {
      const [r, s, u] = await Promise.all([api.rules(), api.settings(), api.users()]);
      setRules(r);
      const obj = {};
      s.forEach(item => { obj[item.key] = item; });
      setSettings(obj);
      setUsers(u);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function updateSetting(key, value) {
    setSaving(key);
    try { await api.updateSetting(key, value); await load(); }
    catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(null); }
  }

  async function handleDeleteRule(id) {
    if (!confirm('Remove this type?')) return;
    try { await api.deleteRule(id); await load(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  async function handleUpdateRule(id, fields) {
    try { await api.updateRule(id, fields); await load(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  async function handleAddType(actionKey) {
    const name = newTypes[actionKey]?.trim();
    if (!name) return;
    setAddingType(a => ({ ...a, [actionKey]: true }));
    try {
      await api.createRule({ action_type: actionKey, contact_type: name, days: defDays[actionKey], source: 'company' });
      setNewTypes(t => ({ ...t, [actionKey]: '' }));
      await load();
      showToast('"' + name + '" added');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setAddingType(a => ({ ...a, [actionKey]: false })); }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    try {
      await api.addUser(newUser);
      showToast(newUser.name + ' added as ' + newUser.role);
      setNewUser({ name:'', email:'', password:'', role:'user' });
      await load();
    } catch (err) { showToast(err.message, 'error'); }
  }

  const tabs = [
    { id:'scripts',   label:'📋 Scripts' },
    { id:'scorecard', label:'🏆 Scorecard' },
    { id:'followups', label:'📅 Follow-Ups' },
    { id:'settings',  label:'🔧 System' },
    { id:'team',      label:'👥 Team' },
  ];

  const qOrder  = ['call','mail','email','visit'];
  const qLabels = { call:'📞 Calling', mail:'✉️ Mail', email:'📧 Email', visit:'📍 Visit' };
  const qColors = { call:'#1e40af', mail:'#065f46', email:'#6b21a8', visit:'#92400e' };
  const qBgs    = { call:'#eff6ff', mail:'#f0fdf4', email:'#faf5ff', visit:'#fff7ed' };
  const defDays = { call:3, mail:30, email:14, visit:3 };
  const dKeys   = { call:'call_followup_days', mail:'mail_followup_days', email:'email_followup_days', visit:'visit_delay_days' };
  const dDefs   = { call:'3', mail:'30', email:'14', visit:'3' };

  return (
    <>
      <div className="page-header"><div className="page-title">⚙️ Settings</div></div>
      <div className="page-body">

        <div style={{ display:'flex', gap:4, marginBottom:20, background:'var(--white)', border:'1px solid var(--gray-200)', borderRadius:10, padding:4, width:'fit-content' }}>
          {tabs.map(t => (
            <button key={t.id} className={'btn btn-sm ' + (tab===t.id?'btn-navy':'btn-ghost')} style={{ border:'none' }} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <div className="loading-wrap"><div className="spinner"/></div> : (
          <>
            {tab === 'scripts' && <ScriptEditor />}
            {tab === 'scorecard' && <ScoreCardSettings defaultTab={new URLSearchParams(location.search).get('subtab') || 'builder'} />}
          

            {/* ── FOLLOW-UPS unified tab ── */}
            {tab === 'followups' && (
              <div style={{ display:'flex', flexDirection:'column', gap:20, maxWidth:820 }}>

                <div style={{ fontSize:13, color:'var(--gray-500)', padding:'10px 16px', background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:8 }}>
                  <b>How this works:</b> Each type you add shows as an option when logging a call, mail, email, or visit.
                  The <b>default days</b> applies when no specific type is matched.
                  Per-type days override the default.
                  Follow-up dates landing on <b>Saturday → Friday</b>, <b>Sunday → Monday</b> automatically.
                </div>

                {qOrder.map(actionKey => {
                  const qRules = rules.filter(r => (r.action_type||'call') === actionKey);
                  const dKey = dKeys[actionKey];
                  const color = qColors[actionKey];
                  const bg = qBgs[actionKey];

                  return (
                    <div key={actionKey} className="table-card" style={{ padding:'18px 22px' }}>

                      {/* Header row */}
                      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                        <div style={{ fontWeight:800, fontSize:15, color }}>{qLabels[actionKey]}</div>
                        {dKey && (
                          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:12, color:'var(--gray-400)' }}>Default follow-up:</span>
                            <input type="number" min="1" max="365"
                              style={{ width:64, textAlign:'center', fontWeight:700, padding:'4px 8px', border:'1.5px solid var(--gray-200)', borderRadius:6, fontSize:13 }}
                              defaultValue={settings[dKey]?.value || dDefs[actionKey]}
                              onBlur={async e => {
                                const val = e.target.value.trim();
                                if (!val || val === (settings[dKey]?.value || dDefs[actionKey])) return;
                                await updateSetting(dKey, val);
                                showToast(qLabels[actionKey] + ' default → ' + val + ' days');
                              }}
                            />
                            <span style={{ fontSize:12, color:'var(--gray-400)' }}>days</span>
                          </div>
                        )}
                        {!dKey && (
                          <span style={{ marginLeft:'auto', fontSize:11, color:'var(--gray-400)' }}>Days set per type below</span>
                        )}
                      </div>

                      {/* Type rows */}
                      {qRules.length === 0 ? (
                        <div style={{ fontSize:13, color:'var(--gray-400)', paddingBottom:10 }}>
                          No types yet. Add one below — it will appear as a log option.
                        </div>
                      ) : (
                        <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13, marginBottom:12 }}>
                          <thead>
                            <tr style={{ borderBottom:'2px solid var(--gray-100)' }}>
                              <th style={{ textAlign:'left', padding:'4px 8px 8px', fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase' }}>Type / Outcome</th>
                              <th style={{ textAlign:'center', padding:'4px 8px 8px', fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase' }}>Follow-up days</th>
                              <th style={{ textAlign:'center', padding:'4px 8px 8px', fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase' }}>Counts as attempt</th>
                              <th style={{ textAlign:'center', padding:'4px 8px 8px', fontSize:11, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase' }}>Shown</th>
                              <th style={{ width:28 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {qRules.map(r => (
                              <tr key={r.id} style={{ borderBottom:'1px solid var(--gray-50)' }}>
                                <td style={{ padding:'8px 8px', fontWeight:600, color: r.enabled ? color : 'var(--gray-400)' }}>
                                  {r.contact_type}
                                </td>
                                <td style={{ textAlign:'center', padding:'8px 8px' }}>
                                  <div style={{ display:'flex', alignItems:'center', gap:4, justifyContent:'center' }}>
                                    <input type="number" min="1" max="365"
                                      defaultValue={r.days}
                                      style={{ width:56, textAlign:'center', padding:'3px 6px', border:'1.5px solid var(--gray-200)', borderRadius:5, fontWeight:700, fontSize:13 }}
                                      onBlur={e => { if (Number(e.target.value) !== r.days) handleUpdateRule(r.id, { days: Number(e.target.value) }); }}
                                    />
                                    <span style={{ fontSize:11, color:'var(--gray-400)' }}>d</span>
                                  </div>
                                </td>
                                <td style={{ textAlign:'center', padding:'8px 8px' }}>
                                  <button onClick={() => handleUpdateRule(r.id, { counts_as_attempt: r.counts_as_attempt!==0?0:1 })}
                                    style={{ padding:'3px 10px', borderRadius:12, border:'1px solid '+(r.counts_as_attempt!==0?'#1e40af':'var(--gray-200)'), background:r.counts_as_attempt!==0?'#dbeafe':'var(--gray-50)', color:r.counts_as_attempt!==0?'#1e40af':'var(--gray-400)', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                                    {r.counts_as_attempt!==0 ? '✓ Yes' : 'No'}
                                  </button>
                                </td>
                                <td style={{ textAlign:'center', padding:'8px 8px' }}>
                                  <button onClick={() => handleUpdateRule(r.id, { enabled: r.enabled?0:1 })}
                                    style={{ padding:'3px 10px', borderRadius:12, border:'1px solid '+(r.enabled?color:'var(--gray-200)'), background:r.enabled?bg:'var(--gray-50)', color:r.enabled?color:'var(--gray-400)', fontSize:11, fontWeight:700, cursor:'pointer' }}>
                                    {r.enabled ? '✓ On' : 'Off'}
                                  </button>
                                </td>
                                <td style={{ padding:'8px 4px', textAlign:'center' }}>
                                  <button onClick={() => handleDeleteRule(r.id)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:14, color:'var(--gray-300)', padding:'2px' }}>✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}

                      {/* Add new type */}
                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        <input className="form-input"
                          style={{ flex:1, margin:0, fontSize:13 }}
                          placeholder={'Add ' + actionKey + ' type…'}
                          value={newTypes[actionKey]}
                          onChange={e => setNewTypes(t => ({ ...t, [actionKey]: e.target.value }))}
                          onKeyDown={e => { if (e.key==='Enter') handleAddType(actionKey); }}
                        />
                        <button className="btn btn-primary btn-sm" onClick={() => handleAddType(actionKey)}
                          disabled={addingType[actionKey] || !newTypes[actionKey]?.trim()} style={{ whiteSpace:'nowrap' }}>
                          {addingType[actionKey] ? '…' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── SYSTEM SETTINGS ── */}
            {tab === 'settings' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:640 }}>
                <div className="table-card" style={{ padding:'20px 24px' }}>
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>🏠 Shop / Home Base</div>
                  <div style={{ fontSize:12, color:'var(--gray-400)', marginBottom:16 }}>Used to calculate distance in call logs, route planner, and nearby views.</div>
                  <div className="form-group">
                    <label className="form-label">Address</label>
                    <input className="form-input" defaultValue={settings['shop_address']?.value || ''} placeholder="123 Main St, Charlotte, NC 28205"
                      onBlur={async e => {
                        const val = e.target.value.trim();
                        if (!val || val===settings['shop_address']?.value) return;
                        await updateSetting('shop_address', val);
                        try {
                          const r = await fetch('https://nominatim.openstreetmap.org/search?q='+encodeURIComponent(val)+'&format=json&limit=1&countrycodes=us',{headers:{'User-Agent':'FleetCRM/1.0'}});
                          const d = await r.json();
                          if (d[0]) { await updateSetting('shop_lat',d[0].lat); await updateSetting('shop_lng',d[0].lon); showToast('✅ Shop address saved and geocoded'); }
                        } catch(_) {}
                      }}
                    />
                    {settings['shop_lat']?.value && settings['shop_lng']?.value && (
                      <div style={{ fontSize:11, color:'#15803d', marginTop:6 }}>
                        ✓ Geocoded: {parseFloat(settings['shop_lat'].value).toFixed(4)}, {parseFloat(settings['shop_lng'].value).toFixed(4)}
                      </div>
                    )}
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">Fuel Price ($/gal)</label>
                      <input className="form-input" type="number" step="0.01" min="0" defaultValue={settings['fuel_price']?.value||'3.50'} onBlur={e=>updateSetting('fuel_price',e.target.value)}/>
                    </div>
                    <div className="form-group" style={{ marginBottom:0 }}>
                      <label className="form-label">Vehicle MPG</label>
                      <input className="form-input" type="number" step="1" min="1" defaultValue={settings['mpg']?.value||'22'} onBlur={e=>updateSetting('mpg',e.target.value)}/>
                    </div>
                  </div>
                </div>
                {Object.entries(settings)
                  .filter(([k])=>!['shop_address','shop_lat','shop_lng','fuel_price','mpg','mail_followup_days','email_followup_days','visit_delay_days'].includes(k))
                  .length > 0 && (
                  <div className="table-card" style={{ padding:'20px 24px' }}>
                    <div style={{ fontWeight:700, fontSize:15, marginBottom:16 }}>⚙️ Other Settings</div>
                    {Object.entries(settings)
                      .filter(([k])=>!['shop_address','shop_lat','shop_lng','fuel_price','mpg','mail_followup_days','email_followup_days','visit_delay_days'].includes(k))
                      .map(([key,item])=>(
                      <div key={key} style={{ paddingBottom:16, marginBottom:16, borderBottom:'1px solid var(--gray-100)' }}>
                        <div style={{ fontWeight:600, fontSize:13, marginBottom:4 }}>{item.label||key}</div>
                        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                          <input className="form-input" defaultValue={item.value} style={{ maxWidth:260 }}
                            onBlur={e=>{ if(e.target.value!==item.value) updateSetting(key,e.target.value); }}/>
                          {saving===key && <span style={{ fontSize:12, color:'var(--gray-400)' }}>Saving…</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── TEAM ── */}
            {tab === 'team' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:640 }}>
                <div className="table-card">
                  <div className="table-card-header"><span className="table-card-title">Team Members</span></div>
                  <table>
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead>
                    <tbody>
                      {users.map(u=>(
                        <tr key={u.id}>
                          <td style={{ fontWeight:600 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:'50%', background:u.id===user?.id?'var(--gold-500)':'var(--navy-700)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:u.id===user?.id?'var(--navy-950)':'var(--white)' }}>
                                {u.name?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                              </div>
                              {u.name} {u.id===user?.id && <span style={{ fontSize:10, color:'var(--gray-400)' }}>(you)</span>}
                            </div>
                          </td>
                          <td style={{ fontSize:13, color:'var(--gray-600)' }}>{u.email}</td>
                          <td><span className={'badge '+(u.role==='admin'?'badge-gold':'badge-gray')}>{u.role==='admin'?'⭐ Admin':'User'}</span></td>
                          <td style={{ fontSize:12, color:'var(--gray-400)' }}>{u.created_at?.slice(0,10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-card" style={{ padding:'18px 20px' }}>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>+ Add Team Member</div>
                  <form onSubmit={handleAddUser}>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                      <div className="form-group"><label className="form-label">Full Name</label><input className="form-input" required value={newUser.name} onChange={e=>setNewUser(u=>({...u,name:e.target.value}))} placeholder="Jane Smith"/></div>
                      <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" required value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} placeholder="jane@supereagle.com"/></div>
                      <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" required minLength={6} value={newUser.password} onChange={e=>setNewUser(u=>({...u,password:e.target.value}))} placeholder="Min 6 characters"/></div>
                      <div className="form-group"><label className="form-label">Role</label><select className="form-select" value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}><option value="user">User</option><option value="admin">Admin</option></select></div>
                    </div>
                    <button type="submit" className="btn btn-primary">Add Team Member</button>
                  </form>
                </div>
              </div>
            )}
          </>
        )}

        {/* Database Tools */}
        <div className="table-card" style={{ padding:'20px 24px', marginTop:16 }}>
          <div style={{ fontWeight:700, fontSize:15, marginBottom:8 }}>🔧 Database Tools</div>
          <div style={{ fontSize:13, color:'var(--gray-500)', marginBottom:12 }}>
            Fix missing follow-up dates for companies already in the database. Safe to run multiple times.
          </div>
          <button className="btn btn-primary" onClick={async () => {
            try {
              const res = await api.backfillFollowups();
              alert(`Done! Created ${res.created} follow-up records.`);
            } catch(e) { alert('Error: ' + e.message); }
          }}>
            🔄 Backfill Follow-Up Dates
          </button>
        </div>

      </div>

      {previewScorecard && (
</div>
    </>
  );
}
