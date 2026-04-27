import CompanyMergeModal from '../components/CompanyMergeModal.jsx';
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AddressAutocomplete from '../components/AddressAutocomplete.jsx';
import { api, fmtPhone, fmtDate, companyDisplayName } from '../api.js';
import { useApp } from '../App.jsx';
import ScoreCardModal from '../components/ScoreCardModal.jsx';
import ImportSettings from '../components/ImportSettings.jsx'; import SimpleImport from '../components/SimpleImport.jsx';// ── Note cell for history table ───────────────────────────────────────────────
function NoteCell({ note }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button onClick={e => { e.stopPropagation(); setOpen(true); }}
        style={{ fontSize:11, color:'var(--navy-700)', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:5, cursor:'pointer', fontWeight:600, padding:'2px 8px', whiteSpace:'nowrap' }}>
        📝 view
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(0,0,0,.3)' }}/>
          <div style={{ position:'fixed', zIndex:9999, background:'white', borderRadius:12, padding:'20px 24px', boxShadow:'0 12px 40px rgba(0,0,0,.2)', width:360, maxWidth:'90vw', top:'50%', left:'50%', transform:'translate(-50%,-50%)' }}>
            <div style={{ fontWeight:700, marginBottom:12, color:'var(--gray-900)', fontSize:14 }}>📝 Call Note</div>
            <div style={{ fontSize:13, color:'var(--gray-700)', lineHeight:1.7, wordBreak:'break-word', whiteSpace:'pre-wrap', maxHeight:300, overflowY:'auto' }}>{note}</div>
            <button onClick={() => setOpen(false)} style={{ marginTop:16, fontSize:12, color:'white', background:'var(--navy-800)', border:'none', borderRadius:6, cursor:'pointer', padding:'6px 16px', fontWeight:600, display:'block' }}>Close</button>
          </div>
        </>
      )}
    </>
  );
}

// ── Pipeline stage bar shown at top of every company profile ─────────────────
const STAGES = [
  { key:'new',      label:'New',      icon:'🆕', color:'#64748b', bg:'#f8fafc' },
  { key:'call',     label:'Call',     icon:'📞', color:'#1e40af', bg:'#eff6ff' },
  { key:'mail',     label:'Mail',     icon:'✉️',  color:'#065f46', bg:'#ecfdf5' },
  { key:'email',    label:'Email',    icon:'📧', color:'#6b21a8', bg:'#faf5ff' },
  { key:'visit',    label:'Visit',    icon:'📍', color:'#92400e', bg:'#fffbeb' },
  { key:'dead',     label:'Dead',     icon:'💀', color:'#6b7280', bg:'#f9fafb' },
];

function PipelineBar({ company, onMove, onStatusChange }) {
  const [showMove, setShowMove] = useState(false);
  const [moveForm, setMoveForm] = useState({ stage:'', due_date:'', notes:'' });
  const stage = STAGES.find(s => s.key === (company.pipeline_stage || 'new')) || STAGES[0];

  async function handleMove(e) {
    e.preventDefault();
    await onMove(moveForm.stage, moveForm.due_date || null, moveForm.notes || null);
    setShowMove(false);
    setMoveForm({ stage:'', due_date:'', notes:'' });
  }

  return (
    <div style={{ background:'white', border:`2px solid ${stage.bg === '#f8fafc' ? '#e2e8f0' : stage.bg}`, borderRadius:10, padding:'12px 16px' }}>
      <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:8 }}>📊 Pipeline Stage</div>
      <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
        {/* Stage pills */}
        <div style={{ display:'flex', gap:4, flex:1, flexWrap:'wrap', alignItems:'center' }}>
          {STAGES.map(s => (
            <div key={s.key} style={{
              padding:'4px 10px', borderRadius:16, fontSize:12, fontWeight:700,
              background: s.key === company.pipeline_stage ? s.bg : 'var(--gray-50)',
              color: s.key === company.pipeline_stage ? s.color : 'var(--gray-400)',
              border: s.key === company.pipeline_stage ? `1.5px solid ${s.color}` : '1.5px solid transparent',
              display:'flex', alignItems:'center', gap:4,
            }}>
              {s.icon} {s.label}
            </div>
          ))}
          {(company.followup_due || company.follow_up?.due_date) && (() => {
            const due = company.followup_due || company.follow_up?.due_date;
            const isOverdue = new Date(due+'T00:00:00') < new Date();
            const isToday = due === new Date().toISOString().split('T')[0];
            return (
              <div style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:8,
                background: isOverdue?'#fef2f2':isToday?'#fffbeb':'#f0fdf4',
                color: isOverdue?'#dc2626':isToday?'#92400e':'#15803d',
                border: `1px solid ${isOverdue?'#fca5a5':isToday?'#fde68a':'#bbf7d0'}`,
              }}>
                📅 {isToday?'Due Today':isOverdue?'Overdue':new Date(due+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
              </div>
            );
          })()}
        </div>
        {/* Follow-up date + Company status */}
        <div style={{ display:'flex', gap:6, flexShrink:0, alignItems:'center' }}>
  
          <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
            <div style={{ fontSize:9, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em' }}>Status</div>
            <select
              value={company.company_status || 'prospect'}
              onChange={e => onStatusChange(e.target.value)}
              style={{
                padding:'5px 10px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer',
                border:`1.5px solid ${
                  company.company_status==='interested'?'#fde68a':
                  company.company_status==='customer'?'#bbf7d0':
                  company.company_status==='dead'?'#fca5a5':'#e2e8f0'}`,
                background:
                  company.company_status==='interested'?'#fef9c3':
                  company.company_status==='customer'?'#f0fdf4':
                  company.company_status==='dead'?'#fef2f2':'#f8fafc',
                color:
                  company.company_status==='interested'?'#92400e':
                  company.company_status==='customer'?'#166534':
                  company.company_status==='dead'?'#dc2626':'#64748b',
              }}>
              <option value="prospect">Prospect</option>
              <option value="interested">⭐ Interested</option>
              <option value="customer">✅ Customer</option>
              <option value="dead">💀 Dead</option>
            </select>
          </div>
        </div>
      </div>

      {/* Move form */}
      {showMove && (
        <form onSubmit={handleMove} style={{ marginTop:12, display:'flex', gap:8, alignItems:'flex-end', flexWrap:'wrap', padding:'12px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)' }}>
          <div style={{ fontSize:11, color:'var(--gray-500)', width:'100%', marginBottom:4 }}>
            💡 This moves the company without counting as a call. It will be saved to history.
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)' }}>Stage *</label>
            <select required className="form-input" style={{ width:140 }} value={moveForm.stage} onChange={e=>setMoveForm(f=>({...f,stage:e.target.value}))}>
              <option value="">Choose…</option>
              {STAGES.map(s=><option key={s.key} value={s.key}>{s.icon} {s.label}</option>)}
            </select>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)' }}>Due Date</label>
            <input type="date" className="form-input" style={{ width:150 }} value={moveForm.due_date} onChange={e=>setMoveForm(f=>({...f,due_date:e.target.value}))}/>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:4, flex:1, minWidth:120 }}>
            <label style={{ fontSize:11, fontWeight:700, color:'var(--gray-500)' }}>Reason</label>
            <input className="form-input" placeholder="Optional note…" value={moveForm.notes} onChange={e=>setMoveForm(f=>({...f,notes:e.target.value}))}/>
          </div>
          <button type="submit" className="btn btn-primary btn-sm">Move</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setShowMove(false)}>Cancel</button>
        </form>
      )}
    </div>
  );
}

// ── Contact Form (inline add/edit) ────────────────────────────────────────────
function ContactForm({ companyId, contact, onSave, onCancel }) {
  const [form, setForm] = useState({
    name:        contact?.name        || '',
    role_title:  contact?.role_title  || '',
    direct_line: contact?.direct_line || '',
    email:       contact?.email       || '',
    notes:       contact?.notes       || '',
    is_preferred: contact?.is_preferred ? true : false,
  });
  const [saving, setSaving] = useState(false);
  const { showToast, refreshCounts } = useApp();

  function set(f, v) { setForm(p => ({...p, [f]: v})); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (contact?.id) {
        await api.updateContact(contact.id, form);
      } else {
        await api.addContact(companyId, form);
      }
      onSave();
    } catch(err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background:'var(--gray-50)', border:'1px solid var(--gray-200)', borderRadius:10, padding:'16px 18px', margin:'8px 0' }}>
      <div style={{ fontWeight:700, fontSize:13, marginBottom:12, color:'var(--gray-700)' }}>
        {contact?.id ? '✏️ Edit Contact' : '+ New Contact'}
      </div>
      <form onSubmit={handleSubmit}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div className="form-group" style={{ margin:0 }}>
            <label className="form-label">Name *</label>
            <input className="form-input" required value={form.name} onChange={e=>set('name',e.target.value)} placeholder="Mary Johnson"/>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label className="form-label">Title / Role</label>
            <input className="form-input" value={form.role_title} onChange={e=>set('role_title',e.target.value)} placeholder="Fleet Manager, Gatekeeper…"/>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label className="form-label">Direct Line</label>
            <input className="form-input" value={form.direct_line} onChange={e=>set('direct_line',e.target.value)} placeholder="(704) 555-0101"/>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="mary@company.com"/>
          </div>
        </div>
        <div className="form-group" style={{ marginBottom:10 }}>
          <label className="form-label">Description / Notes</label>
          <textarea className="form-textarea" rows={2} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="e.g. Gatekeeper — always answers, routes to John Smith. Best time to call: mornings."/>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--gray-700)' }}>
            <input type="checkbox" checked={form.is_preferred} onChange={e=>set('is_preferred',e.target.checked)}
              style={{ width:15, height:15, accentColor:'var(--gold-500)' }}/>
            ⭐ Set as preferred contact (used as default when calling)
          </label>
          <div style={{ display:'flex', gap:8 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving||!form.name.trim()}>
              {saving ? 'Saving…' : contact?.id ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Contact Card ──────────────────────────────────────────────────────────────
function ContactCard({ contact, companyId, onRefresh }) {
  const [editing, setEditing] = useState(false);
  const { showToast } = useApp();

  async function handleDelete() {
    if (!confirm(`Delete ${contact.name}?`)) return;
    try {
      await api.deleteContact(contact.id);
      onRefresh();
    } catch(e) { showToast(e.message, 'error'); }
  }

  async function togglePreferred() {
    try {
      await api.updateContact(contact.id, { ...contact, is_preferred: !contact.is_preferred });
      onRefresh();
    } catch(e) { showToast(e.message, 'error'); }
  }

  if (editing) return (
    <ContactForm companyId={companyId} contact={contact}
      onSave={() => { setEditing(false); onRefresh(); }}
      onCancel={() => setEditing(false)}/>
  );

  return (
    <div style={{
      padding:'14px 16px', borderBottom:'1px solid var(--gray-100)',
      background: contact.is_preferred ? '#fefce8' : 'white',
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontWeight:700, fontSize:14, color:'var(--gray-900)' }}>{contact.name}</span>
            {contact.is_preferred && (
              <span style={{ background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', borderRadius:10, padding:'1px 8px', fontSize:10, fontWeight:700 }}>
                ⭐ Preferred
              </span>
            )}
            {contact.role_title && (
              <span className="badge badge-gray" style={{ fontSize:11 }}>{contact.role_title}</span>
            )}
          </div>
          <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12, color:'var(--gray-600)' }}>
            {contact.direct_line && <span>📱 {fmtPhone(contact.direct_line)}</span>}
            {contact.email && <span>✉️ {contact.email}</span>}
          </div>
          {contact.notes && (
            <div style={{ fontSize:12, color:'var(--gray-500)', marginTop:5, fontStyle:'italic', borderLeft:'2px solid var(--gray-200)', paddingLeft:8 }}>
              {contact.notes}
            </div>
          )}
        </div>
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          <button onClick={togglePreferred} title={contact.is_preferred?'Remove preferred':'Set as preferred'}
            style={{ padding:'4px 8px', borderRadius:6, border:'1px solid var(--gray-200)', background:'white', cursor:'pointer', fontSize:14 }}>
            {contact.is_preferred ? '⭐' : '☆'}
          </button>
          <button onClick={() => setEditing(true)} className="pill-btn pill-btn-ghost" style={{ fontSize:11 }}>Edit</button>
          <button onClick={handleDelete} style={{ padding:'4px 8px', borderRadius:6, border:'1px solid #fca5a5', background:'#fef2f2', color:'#ef4444', cursor:'pointer', fontSize:11, fontWeight:600 }}>✕</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Companies() {
  const [companies, setCompanies]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [filterStatus, setFilterStatus] = useState([]);
  const [filterStage, setFilterStage]   = useState('');
  const [filterContacted, setFilterContacted] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importTab, setImportTab]   = useState('simple');
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting]   = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [selected, setSelected]     = useState(null);
  const [followupEdit, setFollowupEdit] = useState(null);
  const [followupAction, setFollowupAction] = useState('Call');
  const [followupSaving, setFollowupSaving] = useState(false);
  const [contacts, setContacts]     = useState([]);
  const [history, setHistory]       = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [scorecardView, setScorecardView] = useState(null); // { entityName, entityId } — open manual scorecard
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [addForm, setAddForm]       = useState({ name:'', main_phone:'', industry:'', address:'', city:'', state:'', zip:'' });
  const [addressDisplay, setAddressDisplay] = useState('');
  const [nameMatches, setNameMatches] = useState([]);
  const [multiLocPrompt, setMultiLocPrompt] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [isMultiLoc, setIsMultiLoc] = useState(false);
  const nameSearchTimer = useRef(null);
  const [merging, setMerging]       = useState(false);
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeResults, setMergeResults] = useState([]);
  const [saving, setSaving]         = useState(false);
  const [addToQueue, setAddToQueue] = useState(true);
  const [editingCompany, setEditingCompany] = useState(false);
  const [editForm, setEditForm]     = useState({});
  const [editAddressDisplay, setEditAddressDisplay] = useState('');
  const { showToast, refreshCounts } = useApp();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Auto-open company by ?company=<id> param (from queue links)
  useEffect(() => {
    const id = searchParams.get('company');
    if (id) selectCompany({ id: Number(id) });
    else setSelected(null);
  }, [searchParams]);
 useEffect(() => {
  function handleReset() { setSelected(null); }
  window.addEventListener('companies-reset', handleReset);
  return () => window.removeEventListener('companies-reset', handleReset);
 }, []);
  
  async function load() {
    setLoading(true);
    try {
     const params = { search };
      if (filterStatus.length > 0) params.company_status = filterStatus.join(',');
      if (filterStage && !filterStage.startsWith('followup_')) params.pipeline_stage = filterStage;
      if (filterContacted) params.last_contacted = filterContacted;
      let results = await api.companies(params);
      const today = new Date().toISOString().split('T')[0];
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() + 7);
      const weekEndStr = weekEnd.toISOString().split('T')[0];
      if (filterStage === 'followup_overdue') results = results.filter(c => c.followup_due && c.followup_due < today);
      if (filterStage === 'followup_today')   results = results.filter(c => c.followup_due && c.followup_due === today);
      if (filterStage === 'followup_week')    results = results.filter(c => c.followup_due && c.followup_due >= today && c.followup_due <= weekEndStr);
      setCompanies(results);
    }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [search, filterStatus.join(','), filterStage, filterContacted]);
  useEffect(() => {
    if (search) {
       setSelected(null);
       navigate('/companies'); // clears the ?company= param from the URL too
     }
  }, [search]);
  
  async function selectCompany(c) {
    setSelected(c);
    setShowAddContact(false);
    setEditingCompany(false);
    setHistoryLoading(true);
    try {
      const [full, hist] = await Promise.all([api.company(c.id), api.companyHistory(c.id)]);
      setSelected(full);
      setContacts(full.contacts || []);
      setHistory(hist);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function refreshContacts() {
    if (!selected) return;
    const full = await api.company(selected.id);
    // Load current followup
    try { const fu = await api.companyFollowup(full.id); setFollowupEdit(fu ? fu.due_date : null); } catch(_) {}
    setContacts(full.contacts || []);
    setSelected(full);
  }

  async function handleAddToQueue(companyId) {
    try {
      await api.addToCompanyQueue(companyId);
      showToast('Added to calling queue');
      // Refresh the selected company so the button updates to "In Queue"
      const updated = await api.company(companyId);
      setSelected(updated);
      await refreshCounts();
    } catch(err) { showToast(err.message, 'error'); }
  }

  function onAddFormNameChange(val) {
    setAddForm(f => ({...f, name: val}));
    setMultiLocPrompt(false); setIsMultiLoc(false); setLocationName('');
    clearTimeout(nameSearchTimer.current);
    if (val.trim().length >= 2) {
      nameSearchTimer.current = setTimeout(async () => {
        try { const m = await api.searchCompanyName(val.trim()); setNameMatches(m); }
        catch(_) { setNameMatches([]); }
      }, 350);
    } else { setNameMatches([]); }
  }

  async function handleAddCompany(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...addForm,
        is_multi_location: isMultiLoc ? 1 : 0,
        location_name: isMultiLoc ? locationName.trim() : '',
        location_group: isMultiLoc ? addForm.name.trim() : '',
      };
      const company = await api.createCompany(payload);
      if (isMultiLoc && nameMatches.length > 0) {
        for (const m of nameMatches) {
          await api.updateCompany(m.id, {
            is_multi_location: 1,
            location_group: addForm.name.trim(),
            location_name: m.location_name || m.city || m.name,
          });
        }
      }
      if (addToQueue) await api.addToCompanyQueue(company.id);
      showToast(company.name + ' added' + (addToQueue ? ' and queued' : ''));
      setShowAddForm(false);
      setAddForm({ name:'', main_phone:'', industry:'', address:'', city:'', state:'', zip:'' });
      setAddressDisplay('');
      setNameMatches([]); setMultiLocPrompt(false); setIsMultiLoc(false); setLocationName('');
      await load();
      await refreshCounts();
    } catch(err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleSaveCompanyEdit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateCompany(selected.id, editForm);
      showToast('Company updated');
      setEditingCompany(false);
      await selectCompany({ id: selected.id });
      await load();
    } catch(err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }
async function handleImport(e) {
    e.preventDefault();
    if (!importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await fetch('/api/companies/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('fleet_crm_token')}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      setImportResult(data);
      await load();
      await refreshCounts();
    } catch(err) { showToast(err.message, 'error'); }
    finally { setImporting(false); }
  }
  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">🗂️ Companies</div>
          <div className="page-subtitle">{companies.length} companies in database</div>
        </div>
        <div className="header-actions">
          <div className="search-bar">
            <span style={{ color:'var(--gray-400)' }}>🔍</span>
            <input placeholder="Search name, industry…" value={search} onChange={e=>setSearch(e.target.value)}/>
          </div>
          <button className="btn btn-ghost" onClick={()=>setShowImport(v=>!v)}>📥 Import CSV</button>
          <button className="btn btn-ghost" onClick={async()=>{
            showToast('Building export with contacts…');
            try {
              const enriched = await Promise.all(
                companies.map(async (c) => {
                  try { const full = await api.company(c.id); return { ...c, contacts: full.contacts || [] }; }
                  catch (_) { return { ...c, contacts: [] }; }
                })
              );
              const maxContacts = Math.max(0, ...enriched.map(c => c.contacts.length));
              const contactHeaders = [];
              for (let i = 1; i <= maxContacts; i++) {
                contactHeaders.push(`Contact ${i} Name`, `Contact ${i} Role`, `Contact ${i} Phone`, `Contact ${i} Email`, `Contact ${i} Preferred`);
              }
              const headers = ['Name','Industry','Phone','Address','City','State','Website','Pipeline Stage','Status','Last Contact Type','Last Contacted','Follow-Up Date','Notes',...contactHeaders];
              const rows = enriched.map(c => {
                const contactCols = [];
                for (let i = 0; i < maxContacts; i++) {
                  const contact = c.contacts[i];
                  if (contact) { contactCols.push(contact.name||'', contact.role_title||'', contact.direct_line||'', contact.email||'', contact.is_preferred ? 'Yes' : ''); }
                  else { contactCols.push('','','','',''); }
                }
                return [c.name||'', c.industry||'', c.main_phone||'', c.address||'', c.city||'', c.state||'', c.website||'', c.pipeline_stage||'', c.company_status||'prospect', c.last_contact_type||'', c.last_contacted ? c.last_contacted.slice(0,10) : '', c.followup_due||'', c.notes||'', ...contactCols];
              });
              const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], {type:'text/csv'});
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `companies-${new Date().toISOString().slice(0,10)}.csv`;
              a.click(); URL.revokeObjectURL(url);
              showToast(`Exported ${enriched.length} companies`);
            } catch(err) { showToast('Export failed: ' + err.message, 'error'); }
          }}>⬇️ Export CSV</button>
          <button className="btn btn-ghost" onClick={async()=>{
            showToast('Pulling all emails…');
            try {
              const enriched = await Promise.all(
                companies.map(async (c) => {
                  try { const full = await api.company(c.id); return { ...c, contacts: full.contacts || [] }; }
                  catch (_) { return { ...c, contacts: [] }; }
                })
              );
              const rows = [['Email','Contact Name','Role','Company','Company Phone']];
              for (const c of enriched) {
                for (const contact of c.contacts) {
                  if (contact.email?.trim()) {
                    rows.push([
                      contact.email.trim(),
                      contact.name || '',
                      contact.role_title || '',
                      c.name || '',
                      c.main_phone || '',
                    ]);
                  }
                }
              }
              if (rows.length === 1) { showToast('No contact emails found', 'error'); return; }
              const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], {type:'text/csv'});
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `emails-${new Date().toISOString().slice(0,10)}.csv`;
              a.click(); URL.revokeObjectURL(url);
              showToast(`Exported ${rows.length - 1} emails`);
            } catch(err) { showToast('Export failed: ' + err.message, 'error'); }
          }}>📧 Export Emails</button>
          <button className="btn btn-primary" onClick={()=>setShowAddForm(true)}>+ Add Company</button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ padding:'0 0 12px 0', display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
        {[
          { key:'prospect',  label:'Prospect',  icon:'',   active:'#e2e8f0', activeText:'#334155' },
          { key:'interested',label:'Interested',icon:'⭐', active:'#fef9c3', activeText:'#92400e' },
          { key:'customer',  label:'Customer',  icon:'✅', active:'#dcfce7', activeText:'#166534' },
          { key:'dead',      label:'Dead',      icon:'💀', active:'#fee2e2', activeText:'#dc2626' },
        ].map(s => {
          const on = filterStatus.includes(s.key);
          return (
            <button key={s.key} onClick={() => { setFilterStatus(prev => on ? prev.filter(x=>x!==s.key) : [...prev, s.key]); setSelected(null); }}
              style={{ padding:'5px 12px', borderRadius:16, fontSize:12, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap', border: on ? `1.5px solid ${s.activeText}` : '1.5px solid #e2e8f0', background: on ? s.active : 'var(--gray-50)', color: on ? s.activeText : 'var(--gray-400)', transition:'all .12s' }}>
              {s.icon ? s.icon+' ' : ''}{s.label}
            </button>
          );
        })}
        <select className="form-input" style={{ width:'auto', fontSize:12, padding:'5px 10px' }}
          value={filterStage} onChange={e=>{ setFilterStage(e.target.value); setSelected(null); }}>
          <option value="">All Queues</option>
          <option value="new">🆕 New</option>
          <option value="call">📞 Call</option>
          <option value="mail">✉️ Mail</option>
          <option value="email">📧 Email</option>
          <option value="visit">📍 Visit</option>
        </select>
        <select className="form-input" style={{ width:'auto', fontSize:12, padding:'5px 10px' }}
          value={filterContacted} onChange={e=>{ setFilterContacted(e.target.value); setSelected(null); }}>
          <option value="">Any Last Contact</option>
          <option value="never">Never Contacted</option>
          <option value="this_week">Contacted This Week</option>
          <option value="this_month">Contacted This Month</option>
          <option value="stale">Stale (30+ days)</option>
        </select>
        <select className="form-input" style={{ width:'auto', fontSize:12, padding:'5px 10px' }}
          value={filterStage === 'followup_overdue' ? 'followup_overdue' : filterStage === 'followup_today' ? 'followup_today' : filterStage === 'followup_week' ? 'followup_week' : ''}
          onChange={e=>{ setFilterStage(e.target.value); setSelected(null); }}>
          <option value="">Any Follow-Up</option>
          <option value="followup_overdue">🔴 Follow-Up Overdue</option>
          <option value="followup_today">🟡 Follow-Up Today</option>
          <option value="followup_week">📅 Follow-Up This Week</option>
        </select>
        {(filterStatus.length > 0 || filterStage || filterContacted) && (
          <button className="btn btn-ghost btn-sm" onClick={()=>{ setFilterStatus([]); setFilterStage(''); setFilterContacted(''); }}>
            ✕ Clear filters
          </button>
        )}
        <span style={{ fontSize:12, color:'var(--gray-400)', marginLeft:'auto' }}>{companies.length} companies</span>
      </div>

     <div className="page-body">
        {/* Import panel */}
        {showImport && (
          <div style={{ marginBottom:16, padding:'20px 24px', background:'white', borderRadius:10, border:'1px solid var(--gray-200)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>📥 Import Companies</div>
              <button className="btn btn-ghost btn-sm" onClick={()=>setShowImport(false)}>✕ Close</button>
            </div>
            {/* Tab switcher */}
            <div style={{ display:'flex', gap:4, marginBottom:20, borderBottom:'2px solid var(--gray-100)', paddingBottom:0 }}>
              {[
                { key:'simple',  label:'🏢 New Companies CSV' },
                { key:'history', label:'📋 Import Call History' },
              ].map(t => (
                <button key={t.key} onClick={()=>setImportTab(t.key)}
                  style={{ padding:'8px 18px', border:'none', borderBottom: importTab===t.key ? '2px solid var(--navy-800)' : '2px solid transparent',
                    marginBottom:'-2px', background:'none', fontWeight: importTab===t.key ? 700 : 500,
                    color: importTab===t.key ? 'var(--navy-800)' : 'var(--gray-400)', cursor:'pointer', fontSize:13 }}>
                  {t.label}
                </button>
              ))}
            </div>
            {importTab === 'simple' && <SimpleImport onDone={() => { setShowImport(false); load(); refreshCounts(); }} />}
            {importTab === 'history' && <ImportSettings onDone={() => { setShowImport(false); load(); refreshCounts(); }} />}
          </div>
        )}
        {/* Company list — hidden when a company is selected */}
        {!selected && <div style={{ background:'white', borderRadius:10, border:'1px solid var(--gray-200)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
         {loading ? (
            <div className="loading-wrap"><div className="spinner"/></div>
          ) : companies.length === 0 ? (
            <div style={{ padding:16, textAlign:'center', fontSize:12, color:'var(--gray-400)' }}>No companies yet</div>
          ) : (
            <div style={{ overflowY:'auto', flex:1 }}>
              {!selected && (
                <div style={{ display:'grid', gridTemplateColumns:'1.8fr 0.9fr 1fr 1.4fr 1.3fr 1fr 0.6fr', gap:0, padding:'6px 14px', borderBottom:'2px solid var(--gray-200)', background:'var(--gray-50)' }}>
                  {['Company','Industry','Phone','Contact','Last Contact','Follow-Up','Stage'].map(h => (
                    <div key={h} style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em' }}>{h}</div>
                  ))}
                </div>
              )}
              {companies.map(c => (
                <div key={c.id} onClick={()=>selectCompany(c)} style={{
                  display: selected ? 'block' : 'grid',
                  gridTemplateColumns: selected ? undefined : '1.8fr 0.9fr 1fr 1.4fr 1.3fr 1fr 0.6fr',
                  padding:'10px 14px', cursor:'pointer', borderBottom:'1px solid var(--gray-100)',
                  background: selected?.id===c.id ? '#fef3c7' : 'white',
                  borderLeft: selected?.id===c.id ? '3px solid var(--gold-500)' : '3px solid transparent',
                  alignItems:'center', gap:0,
                }}>
                  <div style={{ textAlign: selected ? 'center' : 'left' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5, justifyContent: selected ? 'center' : 'flex-start' }}>
                      {!!c.is_starred && <span style={{ fontSize:11 }}>⭐</span>}
                      <div style={{ fontWeight:600, fontSize:13, color:'var(--gray-900)' }}>{companyDisplayName(c)}</div>
                    </div>
                    {selected && <div style={{ fontSize:11, color:'var(--gray-400)', marginTop:1 }}>{fmtPhone(c.main_phone)}</div>}
                  </div>
                  {!selected && <div style={{ fontSize:12, color:'var(--gray-500)' }}>{c.industry||'—'}</div>}
                  {!selected && <div style={{ fontSize:12, color:'var(--gray-500)' }}>{fmtPhone(c.main_phone)}</div>}
                  {!selected && <div style={{ fontSize:12, color:'var(--gray-500)' }}>{c.preferred_contact_name ? `${c.preferred_contact_name}${c.preferred_contact_role ? ' · '+c.preferred_contact_role : ''}` : '—'}</div>}
                  {!selected && <div style={{ fontSize:12, color:'var(--gray-500)' }}>{c.last_contact_type ? `${c.last_contact_type} · ${c.last_contacted ? fmtDate(c.last_contacted.slice(0,10)) : '—'}` : '—'}</div>}
                  {!selected && <div style={{ fontSize:12 }}>
                    {c.followup_due ? (
                      <span style={{
                        fontWeight:700, fontSize:11, padding:'1px 7px', borderRadius:8,
                        background: new Date(c.followup_due+'T00:00:00') < new Date() ? '#fef2f2' : c.followup_due === new Date().toISOString().split('T')[0] ? '#fffbeb' : '#f0fdf4',
                        color: new Date(c.followup_due+'T00:00:00') < new Date() ? '#dc2626' : c.followup_due === new Date().toISOString().split('T')[0] ? '#92400e' : '#15803d',
                      }}>
                        {fmtDate(c.followup_due)}
                      </span>
                    ) : <span style={{color:'var(--gray-300)'}}>—</span>}
                  </div>}
                  {!selected && <div><span style={{ fontSize:9, padding:'1px 6px', borderRadius:8, background:'var(--gray-100)', color:'var(--gray-500)', fontWeight:700, textTransform:'uppercase' }}>{c.pipeline_stage||'new'}</span></div>}
                </div>
              ))}
            </div>
          )}
        </div>}

        {/* Detail panel */}
        {selected && (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <button className="btn btn-ghost btn-sm" style={{ alignSelf:'flex-start' }} onClick={()=>setSelected(null)}>
              ← Back to Companies
            </button>

            {/* Pipeline status bar */}
            <PipelineBar company={selected} onMove={async (stage, due_date, notes) => {
              await api.pipelineMove(selected.id, { stage, due_date, notes });
              const updated = await api.company(selected.id);
              setSelected(updated);
            }} onStatusChange={async (status) => {
              await api.updateCompanyStatus(selected.id, status);
              const updated = await api.company(selected.id);
              setSelected(updated);
              load();
            }} />

            {/* Header card */}
            <div className="table-card" style={{ padding:'18px 20px' }}>
              {!editingCompany ? (
                <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div>
                      <div style={{ fontSize:20, fontWeight:800, color:'var(--gray-900)', display:'flex', alignItems:'center', gap:8 }}>
                        {companyDisplayName(selected)}
                        {selected.is_starred ? <span title="Warm Lead" style={{ fontSize:18, cursor:'default' }}>⭐</span> : null}
                      </div>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:3, flexWrap:'wrap' }}>
                        {selected.is_multi_location ? (
                          <span className="badge badge-blue" style={{ fontSize:10 }}>🏢 Multi-Location{selected.location_name ? ` · ${selected.location_name}` : ''}</span>
                        ) : null}
                      </div>
                      {selected.location_group && (
                        <div style={{ fontSize:12, color:'var(--gray-400)', marginTop:2 }}>Chain: <strong>{selected.location_group}</strong></div>
                      )}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      {selected.in_queue ? (
                        <span style={{ padding:'5px 12px', borderRadius:8, background:'#f0fdf4', border:'1px solid #bbf7d0', color:'#166534', fontSize:12, fontWeight:700 }}>
                          ✓ In Calling Queue
                        </span>
                      ) : (
                        <button className="btn btn-primary btn-sm" onClick={()=>handleAddToQueue(selected.id)}>
                          + Add to Queue
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" style={{ color:'#dc2626', border:'1px solid #fca5a5' }}
                        onClick={async()=>{
                          if (!confirm(`Permanently delete ${selected.name} and all their history? This cannot be undone.`)) return;
                          try {
                            await api.deleteCompany(selected.id);
                            showToast(selected.name + ' deleted');
                            setSelected(null);
                            await load();
                            await refreshCounts();
                          } catch(err) { showToast(err.message, 'error'); }
                        }}>🗑️ Delete</button>
                      <button className="btn btn-ghost btn-sm" onClick={()=>{
                        const addr = [selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ');
                        setEditAddressDisplay(addr);
                        setEditForm({name:selected.name,main_phone:selected.main_phone||'',industry:selected.industry||'',address:selected.address||'',city:selected.city||'',state:selected.state||'',zip:selected.zip||'',website:selected.website||'',notes:selected.notes||'',is_multi_location:selected.is_multi_location||0,location_group:selected.location_group||'',location_name:selected.location_name||''});
                        setEditingCompany(true);
                      }}>✏️ Edit</button>
                      <button className="pill-btn pill-btn-ghost" onClick={()=>setSelected(null)}>✕</button>
                      <button className="btn btn-ghost btn-sm" style={{ color:'#1e40af', border:'1px solid #bfdbfe' }}
                        onClick={()=>{ setMerging(true); setMergeSearch(''); setMergeResults([]); }}>
                        🔀 Merge
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {[
                      ['📱 Main Phone', fmtPhone(selected.main_phone)],
                      ['🏭 Industry',   selected.industry||'—'],
                      ['📍 Address',    [selected.address, selected.city, selected.state, selected.zip].filter(Boolean).join(', ') || '—'],
                      ['🌐 Website',    selected.website||'—'],
                      ['📊 Total Calls', selected.stats?.total_calls||0],
                      ['🤝 Total Contacts', selected.stats?.total_contacts||0],
                      ['📅 Last Contact',fmtDate(selected.stats?.last_contacted)],
                    ].map(([label,val]) => (
                      <div key={label} className="info-row">
                        <span className="info-label">{label}</span>
                        <span className="info-value">{val}</span>
                      </div>
                    ))}
                  </div>
                  {selected.notes && (
                    <div style={{ marginTop:12, padding:'10px 14px', background:'var(--gray-50)', borderRadius:8, fontSize:13, color:'var(--gray-600)', borderLeft:'3px solid var(--gold-400)' }}>
                      {selected.notes}
                    </div>
                  )}

                  {/* Follow-up scheduler */}
                  <div style={{ marginTop:14, padding:'14px 16px', background:'#fffbeb', borderRadius:8, border:'1px solid #fde68a' }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#92400e', marginBottom:10 }}>📅 Schedule Follow-Up</div>
                    {/* Action type row */}
                    <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap' }}>
                      {[['Call','📞 Call'],['Visit','📍 Visit'],['Mail','✉️ Mail'],['Email','📧 Email']].map(([val,label])=>(
                        <button key={val} type="button"
                          onClick={()=>setFollowupAction(val)}
                          style={{
                            padding:'5px 12px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                            border:`1.5px solid ${followupAction===val?'#92400e':'#fde68a'}`,
                            background:followupAction===val?'#92400e':'white',
                            color:followupAction===val?'white':'#92400e',
                          }}>
                          {label}
                        </button>
                      ))}
                    </div>
                    {/* Date row */}
                    <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                      <input type="date" className="form-input" style={{ width:160, fontSize:13, padding:'4px 8px' }}
                        value={followupEdit || ''}
                        onChange={e => setFollowupEdit(e.target.value)}
                      />
                      <button className="btn btn-sm btn-primary" disabled={followupSaving || !followupEdit}
                        style={{background:'#92400e',borderColor:'#92400e'}}
                        onClick={async () => {
                          setFollowupSaving(true);
                          try {
                            await api.updateFollowupDate(selected.id, followupEdit, followupAction);
                            showToast(`${followupAction} follow-up scheduled for ${followupEdit}`);
                            await refreshCounts();
                            await selectCompany({ id: selected.id });
                            load();
                          } catch(e) { showToast(e.message, 'error'); }
                          finally { setFollowupSaving(false); }
                        }}>
                        {followupSaving ? 'Saving…' : `Schedule ${followupAction}`}
                      </button>
                      {(selected.followup_due || selected.follow_up?.due_date) && (
                        <span style={{ fontSize:11, color:'#a16207' }}>
                          Current: {new Date((selected.followup_due || selected.follow_up?.due_date) + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:'#a16207', marginTop:8 }}>Sets date manually — overrides auto-schedule</div>
                  </div>

                  {/* Other branches in the chain */}
                  {selected.branches?.length > 0 && (
                    <div style={{ marginTop:14, padding:'12px 14px', background:'#eff6ff', borderRadius:8, border:'1px solid #bfdbfe' }}>
                      <div style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.07em', color:'#1d4ed8', marginBottom:8 }}>
                        🏢 Other {selected.location_group} Branches ({selected.branches.length})
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {selected.branches.map(b => (
                          <div key={b.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'6px 10px', background:'white', borderRadius:6, border:'1px solid #bfdbfe' }}>
                            <div>
                              <span style={{ fontWeight:600, fontSize:13 }}>{b.location_name || b.name}</span>
                              {b.city && <span style={{ fontSize:11, color:'var(--gray-400)', marginLeft:6 }}>{b.city}</span>}
                              {b.main_phone && <div style={{ fontSize:11, color:'var(--gray-500)', marginTop:1 }}>{fmtPhone(b.main_phone)}</div>}
                            </div>
                            {b.last_contact_type && (
                              <span style={{ fontSize:11, padding:'2px 8px', borderRadius:10, background: b.last_contact_type==='Spoke To'?'#dcfce7':'var(--gray-100)', color: b.last_contact_type==='Spoke To'?'#166534':'var(--gray-500)', fontWeight:600 }}>
                                {b.last_contact_type}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <form onSubmit={handleSaveCompanyEdit}>
                  <div style={{ fontWeight:700, fontSize:14, marginBottom:14 }}>✏️ Edit Company</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                    {[['name','Company Name'],['main_phone','Main Phone'],['industry','Industry'],['website','Website']].map(([f,l])=>(
                      <div key={f} className="form-group" style={{ margin:0 }}>
                        <label className="form-label">{l}</label>
                        <input className="form-input" value={editForm[f]||''} onChange={e=>setEditForm(p=>({...p,[f]:e.target.value}))}/>
                      </div>
                    ))}
                  </div>
                  <div className="form-group" style={{ marginBottom:10 }}>
                    <label className="form-label">Address</label>
                    <AddressAutocomplete
                      value={editAddressDisplay}
                      onChange={val => { setEditAddressDisplay(val); setEditForm(p => ({...p, address: val})); }}
                      onSelect={({address, city, state, zip, display}) => {
                        setEditAddressDisplay(display);
                        setEditForm(p => ({...p, address, city: city||p.city, state: state||p.state, zip: zip||p.zip}));
                      }}
                      placeholder="Start typing address or business name…"
                    />
                  </div>

                  {/* Multi-location */}
                  <div style={{ marginBottom:10, padding:'12px 14px', background:'var(--gray-50)', borderRadius:8, border:'1px solid var(--gray-200)' }}>
                    <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, marginBottom:8 }}>
                      <input type="checkbox" checked={!!editForm.is_multi_location} onChange={e=>setEditForm(p=>({...p,is_multi_location:e.target.checked?1:0}))} style={{ width:15,height:15,accentColor:'var(--gold-500)' }}/>
                      🏢 This is part of a multi-location chain
                    </label>
                    {!!editForm.is_multi_location && (
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:4 }}>
                        <div className="form-group" style={{ margin:0 }}>
                          <label className="form-label">Chain / Group Name</label>
                          <input className="form-input" placeholder="e.g. Hendrick Automotive" value={editForm.location_group||''} onChange={e=>setEditForm(p=>({...p,location_group:e.target.value}))}/>
                        </div>
                        <div className="form-group" style={{ margin:0 }}>
                          <label className="form-label">This Location Name</label>
                          <input className="form-input" placeholder="e.g. Concord Branch" value={editForm.location_name||''} onChange={e=>setEditForm(p=>({...p,location_name:e.target.value}))}/>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="form-group" style={{ marginBottom:10 }}>
                    <label className="form-label">Notes</label>
                    <textarea className="form-textarea" rows={2} value={editForm.notes||''} onChange={e=>setEditForm(p=>({...p,notes:e.target.value}))}/>
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving?'Saving…':'Save'}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>setEditingCompany(false)}>Cancel</button>
                  </div>
                </form>
              )}
            </div>

            {/* ── CONTACTS SECTION ──────────────────────────────────── */}
            <div className="table-card" style={{ padding:0 }}>
              <div className="table-card-header" style={{ padding:'12px 16px' }}>
                <span style={{ fontSize:15 }}>👥</span>
                <span className="table-card-title">Contacts / Employees</span>
                <span className="table-card-count">{contacts.length} people</span>
                <button className="btn btn-primary btn-sm" style={{ marginLeft:'auto' }}
                  onClick={()=>setShowAddContact(v=>!v)}>
                  {showAddContact ? 'Cancel' : '+ Add Contact'}
                </button>
              </div>

              {showAddContact && (
                <div style={{ padding:'0 16px' }}>
                  <ContactForm
                    companyId={selected.id}
                    onSave={()=>{ setShowAddContact(false); refreshContacts(); }}
                    onCancel={()=>setShowAddContact(false)}
                  />
                </div>
              )}

              {contacts.length === 0 && !showAddContact ? (
                <div style={{ padding:'20px 16px', textAlign:'center', fontSize:13, color:'var(--gray-400)' }}>
                  No contacts yet — add employees, managers, or gatekeepers
                </div>
              ) : (
                contacts.map(c => (
                  <ContactCard key={c.id} contact={c} companyId={selected.id} onRefresh={refreshContacts}/>
                ))
              )}

              {/* How this works explainer */}
              <div style={{ padding:'10px 16px', borderTop:'1px solid var(--gray-100)', fontSize:11, color:'var(--gray-400)', background:'var(--gray-50)' }}>
                💡 <strong>How contacts work:</strong> Add anyone you've encountered here — gatekeepers, decision makers, assistants. 
                The ⭐ preferred contact is used as the default when calling. When logging a call you can note who you spoke with for that call only, without saving them here.
              </div>
            </div>

            {/* ── CALL HISTORY ──────────────────────────────────────── */}
            <div className="table-card">
              <div className="table-card-header">
                <span className="table-card-title">📋 Call & Visit History</span>
                <span className="table-card-count">({history.length} entries)</span>
              </div>
              {historyLoading ? (
                <div className="loading-wrap"><div className="spinner"/></div>
              ) : history.length === 0 ? (
                <div className="empty-state" style={{ padding:24 }}><div className="desc">No calls logged yet</div></div>
              ) : (
                <div className="table-wrapper" style={{overflowX:'auto'}}>
                  <table style={{minWidth:900}}>
                    <thead><tr><th>#</th><th>Date</th><th>Type</th><th>Outcome</th><th>Spoke With</th><th>Next Action</th><th>Notes</th><th>Score</th><th>By</th></tr></thead>
                    <tbody>
                      {history.map(h => (
                        <tr key={h.id}>
                          <td style={{ color:'var(--gray-400)', fontSize:11 }}>{h.attempt_number}</td>
                          <td style={{ fontSize:12 }}>{h.logged_at?.slice(0,10)}</td>
                          <td><span className={`badge ${h.action_type==='Visit'?'badge-gold':h.action_type==='Move'?'badge-gray':'badge-company'}`}>{h.action_type==='Visit'?'📍 Visit':h.action_type==='Move'?'➡️ Move':'📞 Call'}</span></td>
                          <td style={{ fontSize:12, fontWeight:500 }}>{h.contact_type}{h.mail_piece ? ` — ${h.mail_piece}` : ''}</td>
                          <td style={{ fontSize:12 }}>
                            {h.contact_name||'—'}
                            {h.role_title && <span style={{ color:'var(--gray-400)', fontSize:10, marginLeft:4 }}>({h.role_title})</span>}
                          </td>
                          <td style={{ fontSize:12 }}>{h.next_action||'—'}{h.next_action_date&&<span style={{color:'var(--gray-400)',fontSize:10,marginLeft:4}}>{fmtDate(h.next_action_date)}</span>}</td>
                          <td style={{ fontSize:11, color:'var(--gray-500)', whiteSpace:'nowrap' }}>
                            {h.notes ? <NoteCell note={h.notes} /> : '—'}
                          </td>
                          <td style={{ fontSize:12, whiteSpace:'nowrap' }}>
                            {h.scorecard_id ? (() => {
                              if (h.scorecard_notes === '__skipped__') {
                                return (
                                  <span style={{ padding:'2px 10px',borderRadius:20,background:'#f1f5f9',color:'#94a3b8',fontWeight:700,fontSize:11,border:'1px solid #e2e8f0' }}>
                                    Skipped
                                  </span>
                                );
                              }
                              const pct = h.scorecard_max > 0 ? Math.round((h.scorecard_total / h.scorecard_max) * 100) : 0;
                              const color = pct >= 80 ? '#15803d' : pct >= 60 ? '#d97706' : '#dc2626';
                              const bg    = pct >= 80 ? '#dcfce7' : pct >= 60 ? '#fef9c3' : '#fee2e2';
                              return (
                                <button onClick={()=>navigate('/settings?tab=scorecard&subtab=history')}
                                  title="View in scorecard history"
                                  style={{ padding:'2px 10px',borderRadius:20,background:bg,color,fontWeight:800,fontSize:12,border:'none',cursor:'pointer' }}>
                                  {pct}%
                                </button>
                              );
                            })() : (
                              <button onClick={()=>setScorecardView({ entityName:selected?.name, entityId:selected?.id })}
                                title="Add scorecard for this call"
                                style={{ padding:'2px 8px',borderRadius:20,background:'var(--gray-100)',color:'var(--gray-400)',fontWeight:600,fontSize:11,border:'1px dashed var(--gray-300)',cursor:'pointer' }}>
                                + Score
                              </button>
                            )}
                          </td>
                          <td style={{ fontSize:11, color:'var(--gray-500)', whiteSpace:'nowrap' }}>{h.logged_by_name||'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add company drawer */}
      {showAddForm && (
        <div className="drawer-overlay" onClick={e=>e.target===e.currentTarget&&setShowAddForm(false)}>
          <div className="drawer">
            <div className="drawer-header" style={{ position:'relative' }}>
              <button className="drawer-close" onClick={()=>setShowAddForm(false)}>✕</button>
              <div className="drawer-title">Add New Company</div>
              <div className="drawer-subtitle">Manually add a company to the database</div>
            </div>
            <div className="drawer-body">
              <form onSubmit={handleAddCompany}>
                <div className="form-group">
                  <label className="form-label">Company Name *</label>
                  <input className="form-input" required value={addForm.name}
                    onChange={e => onAddFormNameChange(e.target.value)}
                    placeholder="Acme Fleet Services"/>
                  {/* Name-match warning */}
                  {nameMatches.length > 0 && !isMultiLoc && (
                    <div style={{marginTop:8,padding:'10px 12px',background:'#fffbeb',border:'1px solid #fde68a',borderRadius:8,fontSize:12}}>
                      <div style={{fontWeight:700,color:'#92400e',marginBottom:6}}>
                        ⚠ {nameMatches.length} existing {nameMatches.length===1?'company':'companies'} with a similar name:
                      </div>
                      {nameMatches.map(m => (
                        <div key={m.id} style={{color:'#78350f',marginBottom:3,fontSize:11}}>
                          • <b>{m.name}</b>{m.city ? ' — '+m.city : ''}{m.location_name ? ' ('+m.location_name+')' : ''}
                        </div>
                      ))}
                      <div style={{marginTop:8,display:'flex',gap:6}}>
                        <button type="button" className="btn btn-sm btn-primary"
                          onClick={()=>{ setIsMultiLoc(true); setMultiLocPrompt(true); }}
                          style={{fontSize:11,padding:'3px 10px'}}>
                          Yes, it's a chain / multi-location
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost"
                          onClick={()=>setNameMatches([])}
                          style={{fontSize:11,padding:'3px 10px'}}>
                          No, different company
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Main Phone</label>
                  <input className="form-input" value={addForm.main_phone} onChange={e=>setAddForm(f=>({...f,main_phone:e.target.value}))} placeholder="(704) 555-0100"/>
                </div>
                <div className="form-group">
                  <label className="form-label">Industry</label>
                  <input className="form-input" value={addForm.industry} onChange={e=>setAddForm(f=>({...f,industry:e.target.value}))} placeholder="HVAC / Plumbing…"/>
                </div>
                {/* Multi-location — always visible checkbox */}
                <div style={{ marginBottom:12, padding:'10px 14px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8 }}>
                  <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, fontWeight:600, color:'#1e40af' }}>
                    <input type="checkbox" checked={isMultiLoc} onChange={e=>{ setIsMultiLoc(e.target.checked); if (!e.target.checked) setLocationName(''); }}
                      style={{ width:15, height:15, accentColor:'#3b82f6', flexShrink:0 }}/>
                    🏢 This is part of a multi-location chain
                  </label>
                  {isMultiLoc && (
                    <div style={{marginTop:8}}>
                      <div style={{fontSize:11,color:'#1e3a8a',marginBottom:5}}>Give this location a specific name shown in all queues (e.g. "North Charlotte" or "Concord"):</div>
                      <input className="form-input" value={locationName}
                        onChange={e=>setLocationName(e.target.value)}
                        placeholder="e.g. North Charlotte, Downtown, Concord…"
                        style={{fontSize:12}}/>
                      {nameMatches.length > 0 && (
                        <div style={{fontSize:11,color:'#1e40af',marginTop:4}}>
                          The existing location{nameMatches.length>1?'s':''} will also be updated to show as part of this chain.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="form-group">
                  <label className="form-label">Address</label>
                  <AddressAutocomplete
                    value={addressDisplay}
                    onChange={val => { setAddressDisplay(val); setAddForm(f => ({...f, address: val})); }}
                    onSelect={({address, city, state, zip, display}) => {
                      setAddressDisplay(display);
                      setAddForm(f => ({...f, address, city: city||f.city, state: state||f.state, zip: zip||f.zip}));
                    }}
                    placeholder="Start typing address or business name…"
                  />
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, marginBottom:12 }}>
                  <input type="checkbox" id="addqueue" checked={addToQueue} onChange={e=>setAddToQueue(e.target.checked)} style={{ width:16, height:16, accentColor:'var(--gold-500)', flexShrink:0 }}/>
                  <label htmlFor="addqueue" style={{ fontSize:13, color:'#92400e', cursor:'pointer', fontWeight:600 }}>
                    📞 Add to Calling Queue immediately after creating
                  </label>
                </div>
                <button type="submit" className="btn btn-primary btn-lg" style={{ width:'100%', marginTop:8 }} disabled={saving}>
                  {saving ? 'Saving…' : '+ Add Company'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {scorecardView && (
        <ScoreCardModal
          entityName={scorecardView.entityName}
          entityId={scorecardView.entityId}
          callLogId={null}
          onClose={()=>setScorecardView(null)}
          onSaved={()=>{
            setScorecardView(null);
            // Reload history to show new score
            if (selected) {
              api.companyHistory(selected.id).then(h=>setHistory(h)).catch(()=>{});
            }
          }}
        />
      )}
      {merging && (
        <CompanyMergeModal
          sourceCompany={selected}
          onClose={() => setMerging(false)}
          onMerged={(targetId) => {
            setMerging(false);
            setSelected(null);
            load();
            refreshCounts();
          }}
        />
       )}
    </>
  );
}
