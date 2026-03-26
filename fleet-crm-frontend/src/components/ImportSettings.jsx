/**
 * ImportSettings — Call Log Import (Safe, Reviewed)
 *
 * Flow:
 *   1. Upload CSV (the Company Call Log export)
 *   2. Parse + auto-deduplicate sync artifacts
 *   3. Match companies to existing CRM by Company ID or phone
 *   4. Review table: NEW vs EXISTING vs SKIP per company
 *      - Shows call count, date range, last note, most recent contact type
 *   5. User checks/unchecks each company
 *   6. Confirm → companies created (if new) + all history attached
 *
 * Nothing writes until the final confirm button.
 */
import { useState, useRef } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

// ── Column positions in the call log CSV ─────────────────────────────────────
// Headers: Completed, Notes, Contact Type, Contact Date, Phone, Direct Line,
//          Contact Name, Email, Role/Title, Company Name, Company ID, Industry,
//          Attempt Count, Source, Logged At, Logged By, Next Follow-up Date,
//          Synced, Action Type, Next Action
const C = {
  completed: 0, notes: 1, contact_type: 2, contact_date: 3,
  phone: 4, direct_line: 5, contact_name: 6, email: 7, role_title: 8,
  company_name: 9, company_id: 10, industry: 11, attempt_count: 12,
  source: 13, logged_at: 14, logged_by: 15, next_follow_up_date: 16,
  synced: 17, action_type: 18, next_action: 19,
};

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    row.push(cur.trim());
    result.push(row);
  }
  return result;
}

function parseDate(val) {
  if (!val || val === 'None' || val === 'FALSE' || val === 'TRUE') return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
}

function fmtPhone(p) {
  const d = String(p||'').replace(/\D/g,'');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0]==='1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return d;
}

// Fingerprint for deduplication: company + date + type + note prefix
function fingerprint(row) {
  const date = String(row[C.contact_date]||'').slice(0,10);
  const note = String(row[C.notes]||'').slice(0,30).toLowerCase().replace(/\s+/g,' ').trim();
  return `${row[C.company_id]}|${date}|${row[C.contact_type]}|${note}`;
}

const TYPE_BADGE = {
  'Gatekeeper':    { bg:'#eff6ff', color:'#1e40af' },
  'Spoke To':      { bg:'#f0fdf4', color:'#15803d' },
  'Voicemail':     { bg:'#f0f9ff', color:'#0369a1' },
  'Follow Up':     { bg:'#fdf4ff', color:'#7c3aed' },
  'No Answer':     { bg:'#f9fafb', color:'#374151' },
  'Do Not Call':   { bg:'#fef2f2', color:'#dc2626' },
  'Wrong Number':  { bg:'#fef2f2', color:'#dc2626' },
  'Not Interested':{ bg:'#fff7ed', color:'#9a3412' },
  'Visited':       { bg:'#fffbeb', color:'#92400e' },
  'Call':          { bg:'#f0fdf4', color:'#15803d' },
};

export default function ImportSettings() {
  const [step, setStep]           = useState('upload');
  const [companies, setCompanies] = useState([]);  // grouped, reviewed
  const [checked, setChecked]     = useState({});   // original_id → bool
  const [addToQueue, setAddToQueue] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult]       = useState(null);
  const [parseStats, setParseStats] = useState(null);
  const fileRef                   = useRef();
  const { showToast }             = useApp();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      showToast('Please export as CSV — in Excel: File → Save As → CSV UTF-8', 'error');
      return;
    }

    const text = await file.text();
    const allRows = parseCSV(text);
    if (allRows.length < 2) { showToast('File appears empty', 'error'); return; }

    // Detect if first row is the actual header
    const header = allRows[0];
    const hasHeader = header.some(h => String(h||'').toLowerCase().includes('company') || String(h||'').toLowerCase().includes('contact'));
    const dataRows = hasHeader ? allRows.slice(1) : allRows;

    // ── Step 1: Deduplicate by fingerprint ───────────────────────────────────
    const seen = new Set();
    const deduped = [];
    let dupCount = 0;
    for (const row of dataRows) {
      if (!row[C.company_id] && !row[C.company_name]) continue;
      const fp = fingerprint(row);
      if (seen.has(fp)) { dupCount++; continue; }
      seen.add(fp);
      deduped.push(row);
    }

    // ── Step 2: Group by Company ID ──────────────────────────────────────────
    const byCompany = {};
    for (const row of deduped) {
      const coId   = String(row[C.company_id] || '').trim();
      const coName = String(row[C.company_name] || '').trim();
      const key    = coId || coName;
      if (!key) continue;
      if (!byCompany[key]) {
        byCompany[key] = {
          original_id:  coId,
          name:         coName,
          phone:        fmtPhone(row[C.phone]),
          industry:     String(row[C.industry] || '').trim(),
          entries:      [],
        };
      }
      byCompany[key].entries.push(row);
    }

    // ── Step 3: Check which company IDs already exist in CRM ─────────────────
    let existingByOrigId = {};
    try {
      const existing = await api.companies({ limit: 9999 });
      for (const co of existing) {
        if (co.company_id) existingByOrigId[co.company_id] = co;
      }
    } catch(e) { /* non-fatal — proceed without matching */ }

    // ── Step 4: Build review list ────────────────────────────────────────────
    const list = Object.values(byCompany).map(co => {
      const entries = co.entries.sort((a,b) => new Date(a[C.contact_date]||0) - new Date(b[C.contact_date]||0));
      const lastEntry = entries[entries.length - 1];
      const firstEntry = entries[0];

      // Use the follow-up date from the most recent entry only — exact date, no substitution
      const nextFollowUp = parseDate(lastEntry[C.next_follow_up_date]) || null;

      // Most recent next action
      const lastNextAction = lastEntry[C.next_action] || null;

      // If the most recent contact type is Do Not Call, flag it — no queue, mark dead
      const isDNC = (lastEntry[C.contact_type] || '').trim().toLowerCase() === 'do not call';

      const existing = existingByOrigId[co.original_id] || null;

      return {
        ...co,
        entries,
        firstDate:      parseDate(firstEntry[C.contact_date]),
        lastDate:       parseDate(lastEntry[C.contact_date]),
        lastNote:       String(lastEntry[C.notes] || '').slice(0,120),
        lastType:       lastEntry[C.contact_type] || '',
        lastNextAction,
        nextFollowUp:   isDNC ? null : nextFollowUp,
        isDNC,
        existingCrmId:  existing?.id || null,
        existingName:   existing?.name || null,
        status:         existing ? 'existing' : 'new',
      };
    }).sort((a,b) => (b.entries.length - a.entries.length));

    // Init all new + existing checked; skips unchecked
    const initChecked = {};
    for (const co of list) initChecked[co.original_id || co.name] = true;

    setCompanies(list);
    setChecked(initChecked);
    setParseStats({ total: dataRows.length, dupes: dupCount, deduped: deduped.length, companies: list.length });
    setStep('review');
  }

  function toggleAll(val) {
    const next = {};
    for (const co of companies) next[co.original_id || co.name] = val;
    setChecked(next);
  }

  async function handleImport() {
    const toImport = companies.filter(co => checked[co.original_id || co.name]);
    if (!toImport.length) { showToast('Nothing selected', 'error'); return; }

    setImporting(true);
    try {
      // Build payload — one company per entry with full history array
      const payload = toImport.map(co => ({
        name:               co.name,
        main_phone:         co.phone,
        industry:           co.industry,
        original_company_id: co.original_id,
        existing_crm_id:    co.existingCrmId,  // if already in CRM, skip create, just add history
        next_follow_up:     co.nextFollowUp,
        last_next_action:   co.lastNextAction,
        is_dnc:             co.isDNC,
        history: co.entries.map(e => ({
          contact_type:     String(e[C.contact_type] || 'Call').trim(),
          contact_name:     String(e[C.contact_name] || '').trim() || null,
          role_title:       String(e[C.role_title] || '').trim() || null,
          direct_line:      fmtPhone(e[C.direct_line]),
          notes:            String(e[C.notes] || '').trim() || null,
          logged_at:        parseDate(e[C.contact_date]) || parseDate(e[C.logged_at]),
          next_action:      String(e[C.next_action] || 'Call').replace(/stop/i,'Stop').trim(),
          next_action_date: parseDate(e[C.next_follow_up_date]),
          attempt_number:   parseInt(e[C.attempt_count]) || 1,
          logged_by:        'Import',
          action_type:      'Call',
        })),
      }));

      const r = await api.importCompanies(payload, addToQueue);
      setResult({ ...r, imported_count: toImport.filter(c=>!c.existingCrmId).length, history_count: toImport.reduce((s,c)=>s+c.entries.length,0) });
      setStep('done');
    } catch(e) {
      showToast('Import failed: ' + e.message, 'error');
    } finally { setImporting(false); }
  }

  const selectedCount  = companies.filter(co => checked[co.original_id || co.name]).length;
  const newCount       = companies.filter(co => checked[co.original_id || co.name] && !co.existingCrmId).length;
  const existingCount  = companies.filter(co => checked[co.original_id || co.name] && co.existingCrmId).length;
  const historyCount   = companies.filter(co => checked[co.original_id || co.name]).reduce((s,c)=>s+c.entries.length,0);
  const dncCount       = companies.filter(co => checked[co.original_id || co.name] && co.isDNC).length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:1000 }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontWeight:800, fontSize:18, color:'var(--navy-800)', marginBottom:4 }}>📥 Import Call History</div>
        <div style={{ fontSize:13, color:'var(--gray-500)', lineHeight:1.6 }}>
          Upload your Company Call Log CSV. Every entry is reviewed before anything is written to the CRM.
          Duplicate sync artifacts are removed automatically.
        </div>
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div>
          <div style={{ background:'#f8fafc', border:'2px dashed var(--gray-300)', borderRadius:12, padding:40, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>📄</div>
            <div style={{ fontWeight:800, fontSize:16, color:'var(--navy-800)', marginBottom:8 }}>
              Company Call Log CSV
            </div>
            <div style={{ fontSize:12, color:'var(--gray-500)', marginBottom:20, lineHeight:1.8 }}>
              Export from your old system as <strong>CSV UTF-8</strong><br/>
              (Excel: File → Save As → CSV UTF-8 (Comma delimited))<br/>
              Expected columns: Company ID, Company Name, Phone, Contact Type, Notes, Contact Date, Next Follow-up Date, etc.
            </div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display:'none' }}/>
            <button className="btn btn-primary" style={{ fontSize:14, padding:'10px 28px' }} onClick={()=>fileRef.current?.click()}>
              📁 Choose CSV File
            </button>
          </div>

          <div style={{ marginTop:20, padding:'14px 18px', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, fontSize:12, color:'#92400e', lineHeight:1.9 }}>
            <strong>What this import does:</strong><br/>
            ✓ Reads every call entry from your CSV<br/>
            ✓ Removes duplicate sync artifacts automatically<br/>
            ✓ Groups entries by Company ID<br/>
            ✓ Checks which companies already exist in your CRM<br/>
            ✓ Shows you a full review table — nothing imports until you confirm<br/>
            ✓ For existing companies, only adds call history (doesn't overwrite company data)<br/>
            ✓ For new companies, creates the company + attaches all history<br/>
            ✓ Uses the most recent entry's follow-up date as the due date (exact date preserved)<br/>
            ✓ Companies where the last contact was "Do Not Call" are marked dead and skipped from queue
          </div>
        </div>
      )}

      {/* ── STEP 2: Review ── */}
      {step === 'review' && (
        <>
          {/* Stats bar */}
          <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
            {[
              { label:'Total Entries', val:parseStats.total, color:'var(--navy-800)' },
              { label:'Duplicates Removed', val:parseStats.dupes, color:'#d97706', sub:'sync artifacts' },
              { label:'Unique Entries', val:parseStats.deduped, color:'#15803d' },
              { label:'Companies', val:parseStats.companies, color:'#1e40af' },
            ].map((s,i)=>(
              <div key={i} style={{ flex:1, minWidth:130, background:'#f8fafc', border:'1px solid var(--gray-200)', borderRadius:8, padding:'10px 14px' }}>
                <div style={{ fontSize:10, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:2 }}>{s.label}</div>
                <div style={{ fontSize:22, fontWeight:900, color:s.color }}>{s.val.toLocaleString()}</div>
                {s.sub && <div style={{ fontSize:10, color:'var(--gray-400)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Selection summary + actions */}
          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', background:'var(--navy-950)', borderRadius:10, marginBottom:12, flexWrap:'wrap' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'white' }}>
              {selectedCount} selected · {newCount} new companies · {existingCount} add history to existing · {historyCount.toLocaleString()} entries
              {dncCount > 0 && <span style={{ color:'#fca5a5', marginLeft:8 }}>· {dncCount} Do Not Call → dead</span>}
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button className="btn btn-ghost btn-sm" style={{ color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.2)' }} onClick={()=>toggleAll(true)}>Select All</button>
              <button className="btn btn-ghost btn-sm" style={{ color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.2)' }} onClick={()=>toggleAll(false)}>Deselect All</button>
            </div>
          </div>

          {/* Add to queue option */}
          <label style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#fefce8', border:'1px solid #fde68a', borderRadius:8, marginBottom:12, cursor:'pointer', fontSize:12, fontWeight:600 }}>
            <input type="checkbox" checked={addToQueue} onChange={e=>setAddToQueue(e.target.checked)} style={{ accentColor:'var(--navy-800)', width:14, height:14 }}/>
            Add all NEW companies to Calling Queue after import
          </label>

          {/* Review table */}
          <div style={{ border:'1px solid var(--gray-200)', borderRadius:10, overflow:'hidden', marginBottom:16 }}>
            {/* Table header */}
            <div style={{ display:'grid', gridTemplateColumns:'32px 1fr 80px 100px 80px 120px 1fr', gap:0, padding:'8px 12px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em' }}>
              <div/>
              <div>Company</div>
              <div>Calls</div>
              <div>Status</div>
              <div>Last Type</div>
              <div>Date Range</div>
              <div>Last Note</div>
            </div>

            <div style={{ maxHeight:500, overflowY:'auto' }}>
              {companies.map(co => {
                const key = co.original_id || co.name;
                const isChecked = !!checked[key];
                const badge = TYPE_BADGE[co.lastType] || { bg:'#f9fafb', color:'#374151' };
                return (
                  <div key={key}
                    style={{ display:'grid', gridTemplateColumns:'32px 1fr 80px 100px 80px 120px 1fr', gap:0, padding:'9px 12px', borderBottom:'1px solid var(--gray-100)', background:isChecked?(co.isDNC?'#fef2f2':'white'):'#fafafa', opacity:isChecked?1:.55, alignItems:'center', cursor:'pointer' }}
                    onClick={()=>setChecked(p=>({...p,[key]:!p[key]}))}>
                    <input type="checkbox" checked={isChecked} onChange={()=>{}} style={{ accentColor:'var(--navy-800)', width:13, height:13 }}/>
                    <div>
                      <div style={{ fontWeight:700, fontSize:12, color:co.isDNC?'#dc2626':'var(--navy-800)' }}>{co.name}</div>
                      <div style={{ fontSize:10, color:'var(--gray-400)' }}>{co.original_id} {co.phone && `· ${co.phone}`} {co.industry && `· ${co.industry}`}</div>
                      {co.isDNC && <div style={{ fontSize:10, fontWeight:700, color:'#dc2626', marginTop:2 }}>🚫 Do Not Call — will be marked dead</div>}
                    </div>
                    <div style={{ fontSize:13, fontWeight:800, color:'var(--navy-800)', textAlign:'center' }}>{co.entries.length}</div>
                    <div>
                      {co.existingCrmId ? (
                        <span style={{ fontSize:10, fontWeight:700, background:'#eff6ff', color:'#1e40af', padding:'2px 8px', borderRadius:20 }}>+ History Only</span>
                      ) : (
                        <span style={{ fontSize:10, fontWeight:700, background:'#f0fdf4', color:'#15803d', padding:'2px 8px', borderRadius:20 }}>🆕 New Company</span>
                      )}
                    </div>
                    <div>
                      <span style={{ fontSize:10, fontWeight:600, padding:'2px 7px', borderRadius:12, background:badge.bg, color:badge.color }}>
                        {co.lastType}
                      </span>
                    </div>
                    <div style={{ fontSize:10, color:'var(--gray-500)' }}>
                      {fmtDate(co.firstDate)}<br/>
                      <span style={{ color:'var(--gray-400)' }}>→ {fmtDate(co.lastDate)}</span>
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray-500)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:260 }} title={co.lastNote}>
                      {co.lastNote || '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Confirm button */}
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button className="btn btn-ghost" onClick={()=>{ setStep('upload'); setCompanies([]); }}>← Start Over</button>
            <button className="btn btn-primary btn-lg" style={{ flex:1 }} onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? '⏳ Importing…' : `✅ Import ${selectedCount} Companies · ${historyCount.toLocaleString()} History Entries`}
            </button>
          </div>
        </>
      )}

      {/* ── STEP 3: Done ── */}
      {step === 'done' && result && (
        <div style={{ background:'#f0fdf4', border:'1.5px solid #bbf7d0', borderRadius:12, padding:28 }}>
          <div style={{ fontSize:20, fontWeight:900, color:'#15803d', marginBottom:16 }}>✅ Import Complete</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              { label:'New Companies Created', val:result.imported, color:'#15803d' },
              { label:'History Added To Existing', val:result.skipped, color:'#1e40af' },
              { label:'Call History Entries', val:result.history||0, color:'#7c3aed' },
              { label:'Errors', val:result.errors?.length||0, color:result.errors?.length?'#dc2626':'#94a3b8' },
            ].map((s,i)=>(
              <div key={i} style={{ background:'white', borderRadius:8, padding:'12px 16px', border:'1px solid var(--gray-200)' }}>
                <div style={{ fontSize:10, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:26, fontWeight:900, color:s.color }}>{s.val?.toLocaleString?.()??s.val}</div>
              </div>
            ))}
          </div>
          {result.errors?.length > 0 && (
            <div style={{ background:'#fef2f2', border:'1px solid #fca5a5', borderRadius:8, padding:'10px 14px', marginBottom:16, fontSize:12, color:'#dc2626' }}>
              <strong>Errors ({result.errors.length}):</strong> {result.errors.slice(0,3).map(e=>e.error||e).join(' · ')}
            </div>
          )}
          <div style={{ fontSize:13, color:'#15803d', marginBottom:16 }}>
            Go to <strong>Companies</strong> to verify the import. Each company now has its full call history.
            {addToQueue && ' New companies have been added to your Calling Queue.'}
          </div>
          <button className="btn btn-ghost" onClick={()=>{ setStep('upload'); setCompanies([]); setResult(null); setParseStats(null); }}>
            ← Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
