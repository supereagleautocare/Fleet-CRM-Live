import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api.js';
import { useApp } from '../App.jsx';
import ScriptEditor from '../components/ScriptEditor.jsx';
import ScoreCardSettings from '../components/ScoreCardSettings.jsx';
import ScoreCardModal from '../components/ScoreCardModal.jsx';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';

const DEFAULT_PERMS = {
  can_access_settings:  false,
  can_add_companies:    true,
  can_delete_companies: false,
  can_delete_calls:     false,
  can_manage_queue:     true,
  can_manage_team:      false,
};

const PERM_LABELS = {
  can_access_settings:  { label: 'Access Settings',      desc: 'View and change app settings' },
  can_add_companies:    { label: 'Add Companies',         desc: 'Create new company records' },
  can_delete_companies: { label: 'Delete Companies',      desc: 'Permanently remove companies' },
  can_delete_calls:     { label: 'Delete Call Logs',      desc: 'Erase call history entries' },
  can_manage_queue:     { label: 'Manage Calling Queue',  desc: 'Add and remove from queue' },
  can_manage_team:      { label: 'Manage Team Members',   desc: 'Invite and remove users' },
};

function PermissionsPanel({ users, currentUserId, onRefresh }) {
  const [selected, setSelected] = useState(null);
  const [perms, setPerms]       = useState({});
  const [role, setRole]         = useState('user');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const { showToast }           = useApp();

  async function loadUser(u) {
    setSelected(u);
    setSaved(false);
    try {
      const r = await api.getUserPermissions(u.id);
      setRole(r.role || 'user');
      setPerms({ ...DEFAULT_PERMS, ...r.permissions });
    } catch(e) { showToast(e.message, 'error'); }
  }

  async function save() {
    setSaving(true);
    try {
      if (role !== selected.role) await api.updateUserRole(selected.id, role);
      await api.updateUserPermissions(selected.id, perms);
      setSaved(true);
      onRefresh();
      setTimeout(() => setSaved(false), 2000);
    } catch(e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  const editableUsers = users.filter(u => u.id !== currentUserId);

  return (
    <div className="table-card" style={{ padding:'18px 20px', marginBottom:16 }}>
      <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🔐 User Permissions</div>
      <div style={{ fontSize:12, color:'var(--gray-400)', marginBottom:16 }}>
        Click a team member to manage what they can do. Admins always have full access.
      </div>

      <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:20 }}>
        {editableUsers.map(u => (
          <button key={u.id} onClick={() => loadUser(u)}
            style={{
              padding:'7px 14px', borderRadius:8, fontSize:13, fontWeight:600, cursor:'pointer',
              border: selected?.id === u.id ? '2px solid var(--gold-500)' : '1px solid var(--gray-200)',
              background: selected?.id === u.id ? '#fffbeb' : 'var(--gray-50)',
              color: selected?.id === u.id ? '#92400e' : 'var(--gray-700)',
            }}>
            {u.name}
            {u.role === 'admin' && (
              <span style={{ marginLeft:6, fontSize:10, background:'#fde68a', borderRadius:4, padding:'1px 5px', color:'#92400e' }}>ADMIN</span>
            )}
          </button>
        ))}
        {editableUsers.length === 0 && (
          <div style={{ fontSize:12, color:'var(--gray-400)' }}>No other team members yet.</div>
        )}
      </div>

      {selected && (
        <>
          <div style={{ borderTop:'1px solid var(--gray-100)', paddingTop:16, marginBottom:16 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)' }}>
              <div>
                <div style={{ fontWeight:700, fontSize:13 }}>Account Role</div>
                <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>Admin has full access to everything</div>
              </div>
              <select value={role} onChange={e => setRole(e.target.value)}
                style={{ padding:'5px 10px', borderRadius:6, border:'1px solid var(--gray-200)', fontSize:13, fontWeight:600, background:'white', cursor:'pointer' }}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {role !== 'admin' ? (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {Object.entries(PERM_LABELS).map(([key, { label, desc }]) => (
                  <div key={key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)' }}>
                    <div>
                      <div style={{ fontWeight:600, fontSize:13 }}>{label}</div>
                      <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:2 }}>{desc}</div>
                    </div>
                    <div onClick={() => setPerms(p => ({ ...p, [key]: !p[key] }))}
                      style={{ width:42, height:24, borderRadius:12, cursor:'pointer', position:'relative', flexShrink:0, background: perms[key] ? '#22c55e' : 'var(--gray-300)', transition:'background .2s' }}>
                      <div style={{ position:'absolute', top:3, left: perms[key] ? 21 : 3, width:18, height:18, borderRadius:9, background:'white', transition:'left .2s', boxShadow:'0 1px 3px rgba(0,0,0,.2)' }}/>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ padding:'12px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, fontSize:12, color:'#92400e' }}>
                ⚡ Admins automatically have all permissions. No restrictions apply.
              </div>
            )}
          </div>

          <button onClick={save} disabled={saving} className="btn btn-primary" style={{ width:'100%' }}>
            {saving ? 'Saving…' : saved ? '✓ Saved!' : `Save Permissions for ${selected.name}`}
          </button>
        </>
      )}
    </div>
  );
}

function TeamInvitePanel({ users, onRefresh }) {
  const [inviteUrl, setInviteUrl]     = useState(null);
  const [resetEmail, setResetEmail]   = useState('');
  const [resetUrl, setResetUrl]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const { showToast }                 = useApp();

  async function handleInvite(userId) {
    setLoading(userId);
    try {
      const r = await api.inviteUser(userId);
      setInviteUrl(r.invite_url);
      setResetUrl(null);
    } catch(e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  async function handleReset(e) {
    e.preventDefault();
    setLoading('reset');
    try {
      const r = await api.forgotPassword(resetEmail);
      setResetUrl(r.reset_url);
      setInviteUrl(null);
    } catch(e) { showToast(e.message, 'error'); }
    finally { setLoading(false); }
  }

  return (
    <div className="table-card" style={{ padding:'18px 20px', marginBottom:16 }}>
      <div style={{ fontWeight:700, fontSize:14, marginBottom:4 }}>🔗 Invite Links & Password Reset</div>
      <div style={{ fontSize:12, color:'var(--gray-400)', marginBottom:16 }}>
        Generate a link and send it manually via text or email. Invite links expire in 48 hours, reset links in 2 hours.
      </div>

      <div style={{ marginBottom:20 }}>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Send Invite Link</div>
        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
          {users.map(u => (
            <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)' }}>
              <div style={{ flex:1 }}>
                <div style={{ fontWeight:600, fontSize:13 }}>{u.name}</div>
                <div style={{ fontSize:11, color:'var(--gray-400)' }}>{u.email}</div>
              </div>
              <button className="btn btn-ghost btn-sm" disabled={loading === u.id}
                onClick={() => { setInviteUrl(null); setResetUrl(null); handleInvite(u.id); }}>
                {loading === u.id ? '…' : '📨 Get Invite Link'}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: resetUrl ? 16 : 0 }}>
        <div style={{ fontWeight:600, fontSize:13, marginBottom:10 }}>Password Reset Link</div>
        <form onSubmit={handleReset} style={{ display:'flex', gap:8 }}>
          <input className="form-input" type="email" placeholder="Enter their email address…"
            value={resetEmail} onChange={e => setResetEmail(e.target.value)} required style={{ flex:1 }}/>
          <button type="submit" className="btn btn-ghost btn-sm" disabled={loading === 'reset'}>
            {loading === 'reset' ? '…' : '🔑 Get Reset Link'}
          </button>
        </form>
      </div>

      {(inviteUrl || resetUrl) && (
        <div style={{ marginTop:16, padding:'12px 14px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:8 }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#15803d', marginBottom:6 }}>
            {inviteUrl ? '📨 Invite Link — copy and send this:' : '🔑 Reset Link — copy and send this:'}
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            <input readOnly value={inviteUrl || resetUrl}
              style={{ flex:1, fontSize:11, padding:'6px 10px', border:'1px solid #bbf7d0', borderRadius:6, background:'white', fontFamily:'monospace' }}
              onFocus={e => e.target.select()}/>
            <button className="btn btn-primary btn-sm"
              onClick={() => { navigator.clipboard.writeText(inviteUrl || resetUrl); showToast('Link copied!'); }}>
              Copy
            </button>
          </div>
          <div style={{ fontSize:11, color:'#15803d', marginTop:6 }}>
            {inviteUrl ? 'They open this link and set their own password. Expires in 48 hours.' : 'They open this link to set a new password. Expires in 2 hours.'}
          </div>
        </div>
      )}
    </div>
  );
}

// ── API LOG TAB ───────────────────────────────────────────────────────────────
function ApiLogTab() {
  const [logData,    setLogData]    = useState(null);
  const [loading,    setLoading]    = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api.tekmetricCallLog();
      setLogData(data);
    } catch (e) {
      console.error('[ApiLog]', e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // Auto-refresh every 15 seconds when the tab is open
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [autoRefresh]);

  const cap         = logData?.cap         || 300;
  const thisMinute  = logData?.rateLimiter?.thisMinute || 0;
  const pct         = Math.round((thisMinute / cap) * 100);
  const todayTotal  = logData?.todayTotal  || 0;
  const perMinute   = logData?.perMinute   || [];
  const recent      = logData?.recent      || [];

  // Gauge bar color
  const gaugeColor = pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#16a34a';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:900 }}>

      {/* Controls */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ fontSize:12, color:'var(--gray-400)' }}>
          {loading ? '⏳ Refreshing…' : 'Auto-refreshes every 15s'}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer' }}>
            <input type="checkbox" checked={autoRefresh} onChange={() => setAutoRefresh(v => !v)}
              style={{ accentColor:'var(--gold-500)' }}/>
            Auto-refresh
          </label>
          <button onClick={load} disabled={loading} className="btn btn-ghost btn-sm" style={{ fontSize:11 }}>
            Refresh Now
          </button>
        </div>
      </div>

      {/* Live rate gauge */}
      <div className="table-card" style={{ padding:'18px 22px' }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:14 }}>Live Rate — This Minute</div>
        <div style={{ display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ height:18, background:'var(--gray-100)', borderRadius:9, overflow:'hidden', position:'relative' }}>
              <div style={{
                height:'100%',
                width:`${Math.min(pct, 100)}%`,
                background:gaugeColor,
                borderRadius:9,
                transition:'width .4s ease',
              }}/>
            </div>
            <div style={{ display:'flex', justifyContent:'space-between', marginTop:5, fontSize:11, color:'var(--gray-400)' }}>
              <span>0</span>
              <span style={{ fontWeight:700, color:gaugeColor }}>{thisMinute} / {cap} req/min ({pct}%)</span>
              <span>{cap}</span>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16, flexShrink:0 }}>
            {[
              { l:'This Minute', v:thisMinute, c:gaugeColor },
              { l:'Today Total', v:todayTotal, c:'var(--navy-800)' },
              { l:'Cap',         v:cap,        c:'var(--gray-400)' },
            ].map(s => (
              <div key={s.l} style={{ textAlign:'center' }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--gray-400)', marginBottom:3 }}>{s.l}</div>
                <div style={{ fontFamily:'var(--font-mono)', fontWeight:800, fontSize:18, color:s.c }}>{s.v}</div>
              </div>
            ))}
          </div>
        </div>
        {pct >= 80 && (
          <div style={{ marginTop:12, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, fontSize:12, color:'#dc2626', fontWeight:600 }}>
            ⚠ Rate is high — other applications sharing this API key may be affected.
          </div>
        )}
      </div>

      {/* Per-minute breakdown */}
      <div className="table-card">
        <div className="table-card-header">
          <span className="table-card-title">Calls Per Minute (last 120 min)</span>
          <span className="table-card-count">{perMinute.length} minutes tracked</span>
        </div>
        {perMinute.length === 0 ? (
          <div className="empty-state" style={{ padding:24 }}>
            <div className="desc">No calls logged yet</div>
          </div>
        ) : (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--gray-50)' }}>
                  <th style={{ padding:'8px 18px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Time</th>
                  <th style={{ padding:'8px 18px', textAlign:'right', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Calls</th>
                  <th style={{ padding:'8px 18px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Bar</th>
                </tr>
              </thead>
              <tbody>
                {[...perMinute].reverse().map(({ minute, count }) => {
                  const barPct = Math.min(Math.round((count / cap) * 100), 100);
                  const barColor = barPct >= 90 ? '#dc2626' : barPct >= 70 ? '#f59e0b' : '#16a34a';
                  const is429 = count >= cap;
                  return (
                    <tr key={minute} style={{ borderTop:'1px solid var(--gray-100)', background: is429 ? '#fef2f2' : 'transparent' }}>
                      <td style={{ padding:'8px 18px', fontFamily:'var(--font-mono)', fontSize:12, color: is429 ? '#dc2626' : 'var(--gray-700)', fontWeight: is429 ? 700 : 400 }}>
                        {minute.replace('T', ' ')}
                        {is429 && <span className="badge badge-overdue" style={{ marginLeft:8, fontSize:9.5 }}>429 RISK</span>}
                      </td>
                      <td style={{ padding:'8px 18px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:700, color:barColor }}>{count}</td>
                      <td style={{ padding:'8px 18px' }}>
                        <div style={{ height:10, width:200, background:'var(--gray-100)', borderRadius:5, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${barPct}%`, background:barColor, borderRadius:5 }}/>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent individual calls */}
      <div className="table-card">
        <div className="table-card-header">
          <span className="table-card-title">Recent Calls (last 100)</span>
        </div>
        {recent.length === 0 ? (
          <div className="empty-state" style={{ padding:24 }}>
            <div className="desc">No recent calls</div>
          </div>
        ) : (
          <div style={{ overflowX:'auto', maxHeight:360, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'var(--gray-50)', position:'sticky', top:0 }}>
                  <th style={{ padding:'8px 18px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Time</th>
                  <th style={{ padding:'8px 18px', textAlign:'left', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Endpoint</th>
                  <th style={{ padding:'8px 18px', textAlign:'right', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>Status</th>
                  <th style={{ padding:'8px 18px', textAlign:'right', fontSize:11, fontWeight:700, color:'var(--gray-500)', textTransform:'uppercase', letterSpacing:'.06em' }}>ms</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry, i) => {
                  const is429 = entry.status === 429;
                  const isErr = entry.status >= 400;
                  const endpoint = entry.url?.replace(/https?:\/\/[^/]+/, '').split('?')[0] || entry.url;
                  return (
                    <tr key={i} style={{ borderTop:'1px solid var(--gray-100)', background: is429 ? '#fef2f2' : isErr ? '#fff7ed' : 'transparent' }}>
                      <td style={{ padding:'6px 18px', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--gray-400)' }}>
                        {new Date(entry.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', second:'2-digit' })}
                      </td>
                      <td style={{ padding:'6px 18px', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--gray-700)', maxWidth:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {endpoint}
                      </td>
                      <td style={{ padding:'6px 18px', textAlign:'right', fontFamily:'var(--font-mono)', fontWeight:700, fontSize:12, color: is429 ? '#dc2626' : isErr ? '#f59e0b' : '#16a34a' }}>
                        {entry.status}
                      </td>
                      <td style={{ padding:'6px 18px', textAlign:'right', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--gray-400)' }}>
                        {entry.ms}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
}

function FleetFinderSettings({ showToast }) {
  const [ffSettings, setFfSettings] = useState(null);
  const [saving,     setSaving]     = useState(false);

  useEffect(() => {
    api.ffSettings().then(setFfSettings).catch(e => showToast(e.message, 'error'));
  }, []);

  async function save(updates) {
    setSaving(true);
    try {
      await api.ffUpdateSettings(updates);
      setFfSettings(prev => ({ ...prev, ...updates }));
      showToast('Fleet Finder settings saved');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSaving(false); }
  }

  if (!ffSettings) return <div className="loading-wrap"><div className="spinner"/></div>;

  return (
    <div style={{ maxWidth: 700, display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* API Keys */}
      <div className="table-card" style={{ padding: '18px 22px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>API Keys</div>

        <div>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Anthropic API Key</div>
          <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 8 }}>
            Required to run searches. Get your key at console.anthropic.com → API Keys.
          </div>
          <input
            type="password"
            defaultValue={ffSettings.ff_anthropic_key || ''}
            placeholder="sk-ant-..."
            onBlur={e => save({ ff_anthropic_key: e.target.value.trim() })}
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 7, fontSize: 13, fontFamily: 'var(--font-mono)' }}
          />
          {ffSettings.ff_anthropic_key && (
            <div style={{ fontSize: 11, color: 'var(--green-600)', marginTop: 5 }}>✓ Key saved</div>
          )}
        </div>
      </div>

      {/* Budget + Radius */}
      <div className="table-card" style={{ padding: '18px 22px' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Budget & Search Defaults</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>Monthly Budget Cap ($)</label>
            <input
              type="number" min={1} max={500}
              defaultValue={ffSettings.ff_monthly_budget || 50}
              onBlur={e => save({ ff_monthly_budget: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 7, fontSize: 13 }}
            />
            <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 4 }}>
              Hard stop — searches lock when this amount is reached each month.
            </div>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 5 }}>Default Search Radius (miles)</label>
            <input
              type="number" min={5} max={100}
              defaultValue={ffSettings.ff_default_radius || 25}
              onBlur={e => save({ ff_default_radius: e.target.value })}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--gray-200)', borderRadius: 7, fontSize: 13 }}
            />
          </div>
        </div>
      </div>

    </div>
  );
}

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
  const { showToast, user: currentUser } = useApp();

  async function load(silent = false) {
    if (!silent) setLoading(true);
    try {
      const [r, s, u] = await Promise.all([api.rules(), api.settings(), api.users()]);
      setRules(r);
      const obj = {};
      s.forEach(item => { obj[item.key] = item; });
      setSettings(obj);
      setUsers(u);
    } finally { if (!silent) setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function reloadKeepScroll() {
    const el = document.querySelector('.page-body');
    const saved = el ? el.scrollTop : 0;
    await load(true);
    requestAnimationFrame(() => {
      const el2 = document.querySelector('.page-body');
      if (el2) el2.scrollTop = saved;
    });
  }

  async function updateSetting(key, value) {
    setSaving(key);
    try {
      await api.updateSetting(key, value);
      setSettings(prev => ({ ...prev, [key]: { ...(prev[key] || { key }), value } }));
    }
    catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(null); }
  }

  async function handleDeleteRule(id) {
    if (!confirm('Remove this type?')) return;
    try { await api.deleteRule(id); await reloadKeepScroll(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  async function handleUpdateRule(id, fields) {
    try { await api.updateRule(id, fields); await reloadKeepScroll(); }
    catch (err) { showToast(err.message, 'error'); }
  }

  async function handleAddType(actionKey) {
    const name = newTypes[actionKey]?.trim();
    if (!name) return;
    setAddingType(a => ({ ...a, [actionKey]: true }));
    try {
      await api.createRule({ action_type: actionKey, contact_type: name, days: defDays[actionKey], source: 'company' });
      setNewTypes(t => ({ ...t, [actionKey]: '' }));
      await reloadKeepScroll();
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
      await reloadKeepScroll();
    } catch (err) { showToast(err.message, 'error'); }
  }

  async function handleDeleteUser(u) {
    if (!confirm(`Remove ${u.name} from the team? This cannot be undone.`)) return;
    try {
      await api.deleteUser(u.id);
      showToast(u.name + ' removed');
      await reloadKeepScroll();
    } catch(err) { showToast(err.message, 'error'); }
  }

  const tabs = [
    { id:'scripts',     label:'📋 Scripts' },
    { id:'scorecard',   label:'🏆 Scorecard' },
    { id:'followups',   label:'📅 Follow-Ups' },
    { id:'settings',    label:'🔧 System' },
    { id:'fleetfinder', label:'🔍 Fleet Finder' },
    { id:'team',        label:'👥 Team' },
    { id:'apilog',      label:'🔌 API Log' },
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
                    <AddressAutocomplete
                      value={settings['shop_address']?.value || ''}
                      onChange={val => setSettings(prev => ({ ...prev, shop_address: { ...(prev.shop_address || { key:'shop_address' }), value: val } }))}
                      onSelect={async ({ display, lat, lng }) => {
                        await Promise.all([
                          updateSetting('shop_address', display),
                          lat && updateSetting('shop_lat', String(lat)),
                          lng && updateSetting('shop_lng', String(lng)),
                        ]);
                        showToast('✅ Shop address saved');
                      }}
                      placeholder="123 Main St, Charlotte, NC 28205"
                    />
                    {settings['shop_lat']?.value && settings['shop_lng']?.value && (
                      <div style={{ fontSize:11, color:'#15803d', marginTop:6 }}>
                        ✓ Geocoded: {parseFloat(settings['shop_lat'].value).toFixed(4)}, {parseFloat(settings['shop_lng'].value).toFixed(4)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── TEAM ── */}
            {tab === 'team' && (
              <div style={{ display:'flex', flexDirection:'column', gap:16, maxWidth:640 }}>

                <PermissionsPanel users={users} currentUserId={currentUser?.id} onRefresh={load} />
                <TeamInvitePanel users={users} onRefresh={load} />

                <div className="table-card">
                  <div className="table-card-header"><span className="table-card-title">Team Members</span></div>
                  <table>
                    <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
                    <tbody>
                      {users.map(u=>(
                        <tr key={u.id}>
                          <td style={{ fontWeight:600 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:'50%', background:u.id===currentUser?.id?'var(--gold-500)':'var(--navy-700)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color:u.id===currentUser?.id?'var(--navy-950)':'var(--white)' }}>
                                {u.name?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
                              </div>
                              {u.name} {u.id===currentUser?.id && <span style={{ fontSize:10, color:'var(--gray-400)' }}>(you)</span>}
                            </div>
                          </td>
                          <td style={{ fontSize:13, color:'var(--gray-600)' }}>{u.email}</td>
                          <td><span className={'badge '+(u.role==='admin'?'badge-gold':'badge-gray')}>{u.role==='admin'?'⭐ Admin':'User'}</span></td>
                          <td style={{ fontSize:12, color:'var(--gray-400)' }}>{u.created_at?.slice(0,10)}</td>
                          <td>
                            {u.id !== currentUser?.id && (
                              <button onClick={() => handleDeleteUser(u)}
                                style={{ background:'none', border:'none', cursor:'pointer', color:'var(--gray-300)', fontSize:16, padding:'2px 6px' }}
                                title="Remove user">
                                🗑️
                              </button>
                            )}
                          </td>
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
            {/* ── API LOG ── */}
            {tab === 'apilog' && <ApiLogTab />}

            {/* ── FLEET FINDER ── */}
            {tab === 'fleetfinder' && <FleetFinderSettings showToast={showToast} />}
          </>
        )}
      </div>
    </>
  );
}
