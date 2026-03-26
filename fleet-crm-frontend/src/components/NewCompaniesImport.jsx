import { useRef, useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let cur = '';
    let inQ = false;
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

function normalizeHeader(h) {
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function phoneDigits(p) {
  return String(p || '').replace(/\D/g, '');
}

function fmtPhone(p) {
  const d = phoneDigits(p);
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return d;
}

function rowToObject(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
  return obj;
}

function getField(row, names) {
  for (const n of names) {
    const key = Object.keys(row).find(k => normalizeHeader(k) === normalizeHeader(n));
    if (key && row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

export default function NewCompaniesImport() {
  const fileRef = useRef();
  const { showToast } = useApp();

  const [step, setStep] = useState('upload');
  const [rows, setRows] = useState([]);
  const [checked, setChecked] = useState({});
  const [parseStats, setParseStats] = useState(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      showToast('Please upload a CSV file', 'error');
      return;
    }

    const text = await file.text();
    const allRows = parseCSV(text);
    if (allRows.length < 2) {
      showToast('File appears empty', 'error');
      return;
    }

    const headers = allRows[0];
    const dataRows = allRows.slice(1);

    const mapped = dataRows
      .map(r => rowToObject(headers, r))
      .map((r, idx) => ({
        _row: idx + 2,
        name: getField(r, ['Company Name', 'Name', 'Business Name']),
        main_phone: phoneDigits(getField(r, ['Phone', 'Main Phone', 'Company Phone', 'Business Phone'])),
        industry: getField(r, ['Industry']),
        address: getField(r, ['Address', 'Street Address']),
        city: getField(r, ['City']),
        state: getField(r, ['State']),
        zip: getField(r, ['Zip', 'ZIP', 'Postal Code']),
        website: getField(r, ['Website', 'URL']),
        notes: getField(r, ['Notes', 'Company Notes']),
      }))
      .filter(r => r.name);

    if (!mapped.length) {
      showToast('No company rows found', 'error');
      return;
    }

    const review = mapped.map(r => ({
      ...r,
      review_action: 'import',
      review_type: 'new',
      matched_name: null,
      matched_phone: null,
      matched_company_id: null,
    }));

    const payload = review.map(r => ({
      name: r.name,
      main_phone: r.main_phone,
      industry: r.industry,
      address: r.address,
      city: r.city,
      state: r.state,
      zip: r.zip,
      website: r.website,
      notes: r.notes,
    }));

    try {
      const precheck = await api.importNewCompanies(payload);

      const merged = review.map(r => {
        const match = (precheck.review || []).find(x =>
          (x.incoming?.name || '').trim().toLowerCase() === r.name.trim().toLowerCase() &&
          phoneDigits(x.incoming?.main_phone || '') === phoneDigits(r.main_phone || '')
        );

        if (!match) return r;

        return {
          ...r,
          review_action: 'review',
          review_type: match.type,
          matched_name: match.matched_name || null,
          matched_phone: match.matched_phone || null,
          matched_company_id: match.matched_company_id || null,
          decision: match.type === 'duplicate' ? 'skip' : 'chain',
        };
      });

      const initChecked = {};
      for (const r of merged) initChecked[`${r._row}|${r.name}|${r.main_phone}`] = r.review_type !== 'duplicate';

      setRows(merged);
      setChecked(initChecked);
      setParseStats({
        total: mapped.length,
        duplicates: precheck.duplicates || 0,
        possible_duplicates: precheck.possible_duplicates || 0,
        clean: mapped.length - ((precheck.review || []).length || 0),
      });
      setStep('review');
    } catch (err) {
      showToast('Precheck failed: ' + err.message, 'error');
    }
  }

  function keyForRow(r) {
    return `${r._row}|${r.name}|${r.main_phone}`;
  }

  function updateDecision(idx, decision) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, decision } : r));
  }

  function toggleAll(val) {
    const next = {};
    for (const r of rows) next[keyForRow(r)] = val;
    setChecked(next);
  }

  async function handleImport() {
    const selected = rows.filter(r => checked[keyForRow(r)]);
    if (!selected.length) {
      showToast('Nothing selected', 'error');
      return;
    }

    const finalPayload = selected
      .filter(r => r.decision !== 'skip')
      .map(r => ({
        name: r.name,
        main_phone: r.main_phone,
        industry: r.industry,
        address: r.address,
        city: r.city,
        state: r.state,
        zip: r.zip,
        website: r.website,
        notes: r.notes,
        import_decision: r.decision || 'import',
        matched_company_id: r.matched_company_id || null,
      }));

    setImporting(true);
    try {
      const res = await api.importNewCompanies(finalPayload);
      setResult(res);
      setStep('done');
    } catch (err) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = rows.filter(r => checked[keyForRow(r)]).length;
  const duplicateCount = rows.filter(r => r.review_type === 'duplicate').length;
  const possibleCount = rows.filter(r => r.review_type === 'possible_duplicate_or_chain').length;

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--navy-800)', marginBottom: 4 }}>🏢 Import New Companies</div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          Upload a company CSV. This importer checks for duplicates and lets you decide whether a row is a real duplicate, a chain/location, or a brand new company.
        </div>
      </div>

      {step === 'upload' && (
        <div>
          <div style={{ background:'#f8fafc', border:'2px dashed var(--gray-300)', borderRadius:12, padding:40, textAlign:'center' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>🏢</div>
            <div style={{ fontWeight:800, fontSize:16, color:'var(--navy-800)', marginBottom:8 }}>
              New Companies CSV
            </div>
            <div style={{ fontSize:12, color:'var(--gray-500)', marginBottom:20, lineHeight:1.8 }}>
              Expected columns: Company Name, Phone, Industry, Address, City, State, Zip, Website, Notes
            </div>
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display:'none' }} />
            <button className="btn btn-primary" style={{ fontSize:14, padding:'10px 28px' }} onClick={() => fileRef.current?.click()}>
              📁 Choose CSV File
            </button>
          </div>

          <div style={{ marginTop:20, padding:'14px 18px', background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, fontSize:12, color:'#1e40af', lineHeight:1.9 }}>
            <strong>What this import does:</strong><br/>
            ✓ Checks existing companies before import<br/>
            ✓ Flags exact duplicates<br/>
            ✓ Flags possible duplicate / chain matches<br/>
            ✓ Lets you choose whether a row is new, chain/location, or skip<br/>
            ✓ Imports only approved rows
          </div>
        </div>
      )}

      {step === 'review' && (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
            {[
              { label:'Rows', val:parseStats.total, color:'var(--navy-800)' },
              { label:'Exact Duplicates', val:parseStats.duplicates, color:'#dc2626' },
              { label:'Possible Chain / Duplicate', val:parseStats.possible_duplicates, color:'#d97706' },
              { label:'Clean New Rows', val:parseStats.clean, color:'#15803d' },
            ].map((s,i)=>(
              <div key={i} style={{ flex:1, minWidth:130, background:'#f8fafc', border:'1px solid var(--gray-200)', borderRadius:8, padding:'10px 14px' }}>
                <div style={{ fontSize:10, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:2 }}>{s.label}</div>
                <div style={{ fontSize:22, fontWeight:900, color:s.color }}>{s.val.toLocaleString()}</div>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', background:'var(--navy-950)', borderRadius:10, marginBottom:12, flexWrap:'wrap' }}>
            <div style={{ fontSize:13, fontWeight:700, color:'white' }}>
              {selectedCount} selected · {duplicateCount} exact duplicates · {possibleCount} needs review
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button className="btn btn-ghost btn-sm" style={{ color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.2)' }} onClick={()=>toggleAll(true)}>Select All</button>
              <button className="btn btn-ghost btn-sm" style={{ color:'rgba(255,255,255,.7)', border:'1px solid rgba(255,255,255,.2)' }} onClick={()=>toggleAll(false)}>Deselect All</button>
            </div>
          </div>

          <div style={{ border:'1px solid var(--gray-200)', borderRadius:10, overflow:'hidden', marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'32px 1.2fr 120px 160px 1fr 180px', padding:'8px 12px', background:'var(--gray-50)', borderBottom:'1px solid var(--gray-200)', fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em' }}>
              <div />
              <div>Company</div>
              <div>Phone</div>
              <div>Review Type</div>
              <div>Matched Company</div>
              <div>Decision</div>
            </div>

            <div style={{ maxHeight:500, overflowY:'auto' }}>
              {rows.map((r, idx) => {
                const key = keyForRow(r);
                const isChecked = !!checked[key];
                return (
                  <div
                    key={key}
                    style={{ display:'grid', gridTemplateColumns:'32px 1.2fr 120px 160px 1fr 180px', padding:'9px 12px', borderBottom:'1px solid var(--gray-100)', background:isChecked?'white':'#fafafa', opacity:isChecked?1:.55, alignItems:'center' }}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => setChecked(p => ({ ...p, [key]: !p[key] }))} style={{ accentColor:'var(--navy-800)', width:13, height:13 }} />
                    <div>
                      <div style={{ fontWeight:700, fontSize:12, color:'var(--navy-800)' }}>{r.name}</div>
                      <div style={{ fontSize:10, color:'var(--gray-400)' }}>
                        {r.city || '—'} {r.state ? `· ${r.state}` : ''} {r.industry ? `· ${r.industry}` : ''}
                      </div>
                    </div>
                    <div style={{ fontSize:12, color:'var(--gray-700)' }}>{fmtPhone(r.main_phone) || '—'}</div>
                    <div>
                      {r.review_type === 'duplicate' && <span style={{ fontSize:10, fontWeight:700, background:'#fef2f2', color:'#dc2626', padding:'2px 8px', borderRadius:20 }}>Duplicate</span>}
                      {r.review_type === 'possible_duplicate_or_chain' && <span style={{ fontSize:10, fontWeight:700, background:'#fff7ed', color:'#9a3412', padding:'2px 8px', borderRadius:20 }}>Review Needed</span>}
                      {r.review_type === 'new' && <span style={{ fontSize:10, fontWeight:700, background:'#f0fdf4', color:'#15803d', padding:'2px 8px', borderRadius:20 }}>New</span>}
                    </div>
                    <div style={{ fontSize:11, color:'var(--gray-500)' }}>
                      {r.matched_name ? `${r.matched_name}${r.matched_phone ? ` · ${fmtPhone(r.matched_phone)}` : ''}` : '—'}
                    </div>
                    <div>
                      {r.review_type === 'new' ? (
                        <span style={{ fontSize:11, fontWeight:700, color:'#15803d' }}>Import as New</span>
                      ) : (
                        <select
                          className="form-input"
                          value={r.decision || (r.review_type === 'duplicate' ? 'skip' : 'chain')}
                          onChange={e => updateDecision(idx, e.target.value)}
                          style={{ fontSize:12, padding:'6px 8px' }}
                        >
                          {r.review_type === 'duplicate' && <option value="skip">Skip Duplicate</option>}
                          <option value="chain">Import as Chain / Location</option>
                          <option value="import">Import as New Company</option>
                          <option value="skip">Skip</option>
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button className="btn btn-ghost" onClick={() => { setStep('upload'); setRows([]); setResult(null); }}>← Start Over</button>
            <button className="btn btn-primary btn-lg" style={{ flex:1 }} onClick={handleImport} disabled={importing || selectedCount === 0}>
              {importing ? '⏳ Importing…' : `✅ Import ${selectedCount} Companies`}
            </button>
          </div>
        </>
      )}

      {step === 'done' && result && (
        <div style={{ background:'#f0fdf4', border:'1.5px solid #bbf7d0', borderRadius:12, padding:28 }}>
          <div style={{ fontSize:20, fontWeight:900, color:'#15803d', marginBottom:16 }}>✅ New Company Import Complete</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:20 }}>
            {[
              { label:'Imported', val:result.imported || 0, color:'#15803d' },
              { label:'Duplicates', val:result.duplicates || 0, color:'#dc2626' },
              { label:'Possible Duplicates', val:result.possible_duplicates || 0, color:'#d97706' },
              { label:'Errors', val:result.errors?.length || 0, color:(result.errors?.length ? '#dc2626' : '#94a3b8') },
            ].map((s,i)=>(
              <div key={i} style={{ background:'white', borderRadius:8, padding:'12px 16px', border:'1px solid var(--gray-200)' }}>
                <div style={{ fontSize:10, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.07em', marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:26, fontWeight:900, color:s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          <button className="btn btn-ghost" onClick={() => { setStep('upload'); setRows([]); setResult(null); setParseStats(null); }}>
            ← Import Another File
          </button>
        </div>
      )}
    </div>
  );
}
