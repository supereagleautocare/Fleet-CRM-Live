/**
 * SimpleImport — Fresh Company CSV Import
 * Flexible header matching — strips all non-alphanumeric chars before comparing,
 * so "Company Name", "company_name", "CompanyName", "COMPANY NAME" all work.
 */
import { useState, useRef } from 'react';
import { api, fmtPhone } from '../api.js';
import { useApp } from '../App.jsx';

// ── Column aliases — all lowercased, no spaces/symbols needed ────────────────
// Detection strips everything non-alphanumeric before comparing, so
// "Company Name" → "companyname" matches alias "companyname" ✓
const COL_ALIASES = {
  name:           ['name', 'companyname', 'company', 'business', 'businessname', 'dba', 'accountname', 'account'],
  phone:          ['phone', 'mainphone', 'number', 'tel', 'telephone', 'phonenumber', 'companyphonephone', 'contactphone', 'primaryphone'],
  website:        ['website', 'web', 'url', 'site', 'www', 'homepage'],
  address:        ['address', 'street', 'addr', 'streetaddress', 'address1'],
  city:           ['city', 'town'],
  state:          ['state', 'st', 'province'],
  zip:            ['zip', 'postal', 'zipcode', 'postalcode', 'zip code'],
  industry:       ['industry', 'type', 'sector', 'category', 'businesstype', 'industrytype'],
  contact_name:   ['contact', 'contactname', 'owner', 'manager', 'person', 'keycontact', 'primarycontact', 'firstname', 'fullname'],
  contact_role:   ['contactrole', 'role', 'title', 'contacttitle', 'position', 'jobtitle'],
  notes:          ['notes', 'note', 'comments', 'comment', 'description', 'memo', 'remarks'],
  next_follow_up: ['followup', 'followupdate', 'nextfollowup', 'nextcontact', 'duedate', 'due', 'nextcalldate', 'nextcall'],
};

// Strip everything non-alphanumeric and lowercase — used for both headers and aliases
function normalizeKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectColumns(headers) {
  const map = {};
  // Build a flat lookup: normalizedAlias → fieldName
  const aliasLookup = {};
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    for (const alias of aliases) {
      aliasLookup[normalizeKey(alias)] = field;
    }
  }
  headers.forEach((h, i) => {
    const norm = normalizeKey(h);
    if (norm && aliasLookup[norm] && !(aliasLookup[norm] in map)) {
      map[aliasLookup[norm]] = i;
    }
  });
  return map;
}

function parseCSV(text) {
  // Strip BOM if present
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/);
  const result = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const row = [];
    let cur = '', inQ = false;
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

function cleanPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return d || '';
}

const STAGES = [
  { key: 'new',   label: '🆕 New',   desc: 'Sits in New — no queue' },
  { key: 'call',  label: '📞 Call',  desc: 'Goes straight to Calling Queue' },
  { key: 'mail',  label: '✉️ Mail',  desc: 'Goes to Mail Queue' },
  { key: 'email', label: '📧 Email', desc: 'Goes to Email Queue' },
  { key: 'visit', label: '📍 Visit', desc: 'Goes to Visit Queue' },
];

export default function SimpleImport({ onDone }) {
  const [step, setStep]               = useState('upload');
  const [rows, setRows]               = useState([]);
  const [checked, setChecked]         = useState({});
  const [colMap, setColMap]           = useState({});
  const [headers, setHeaders]         = useState([]);
  const [parseStats, setParseStats]   = useState(null);
  const [stage, setStage]             = useState('new');
  const [importing, setImporting]     = useState(false);
  const [result, setResult]           = useState(null);
  const [unmappedCols, setUnmappedCols] = useState([]);
  const [detectedCols, setDetectedCols] = useState([]);
  const fileRef                       = useRef();
  const { showToast, refreshCounts }  = useApp();

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Accept .csv and also .txt (some exports)
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      showToast('Please use a CSV file — in Excel: File → Save As → CSV UTF-8', 'error');
      return;
    }

    const text = await file.text();
    const allRows = parseCSV(text);
    if (allRows.length < 2) { showToast('File looks empty or has only 1 row', 'error'); return; }

    const hdrs = allRows[0];
    const detected = detectColumns(hdrs);
    const dataRows = allRows.slice(1);

    // Show user what was detected
    const detectedList = Object.entries(detected).map(([field, idx]) => ({
      field,
      header: hdrs[idx],
      colIdx: idx,
    }));

    const mappedIdxs = new Set(Object.values(detected));
    const unmapped = hdrs
      .map((h, i) => ({ label: h, idx: i }))
      .filter(({ idx, label }) => !mappedIdxs.has(idx) && label.trim());

    setHeaders(hdrs);
    setColMap(detected);
    setUnmappedCols(unmapped);
    setDetectedCols(detectedList);

    if (!('name' in detected)) {
      // Show friendly error with what headers we found
      showToast(
        `Could not find a company name column. Your headers: ${hdrs.slice(0,6).join(', ')}`,
        'error'
      );
      return;
    }

    const built = dataRows.map((r, i) => {
      const get = (field) => String(r[detected[field]] ?? '').trim();
      return {
        _idx:           i,
        name:           get('name'),
        phone:          cleanPhone(get('phone')),
        website:        get('website'),
        address:        get('address'),
        city:           get('city'),
        state:          get('state'),
        zip:            get('zip'),
        industry:       get('industry'),
        contact_name:   get('contact_name'),
        contact_role:   get('contact_role'),
        notes:          get('notes'),
        next_follow_up: get('next_follow_up'),
      };
    }).filter(r => r.name);

    if (built.length === 0) {
      showToast(
        `Headers were found but all rows have empty company names. Check your data rows.`,
        'error'
      );
      return;
    }

    // Check for duplicates against CRM
    let existingByPhone = {}, existingByName = {};
    try {
      const existing = await api.companies({ limit: 9999 });
      for (const co of existing) {
        if (co.main_phone) existingByPhone[co.main_phone.replace(/\D/g,'')] = co;
        existingByName[co.name.toLowerCase()] = co;
      }
    } catch(_) {}

    const enriched = built.map(r => {
      const phoneDigits = r.phone.replace(/\D/g,'');
      const dupe = existingByPhone[phoneDigits] || existingByName[r.name.toLowerCase()] || null;
      return { ...r, dupe_name: dupe?.name || null, dupe_id: dupe?.id || null };
    });

    const dupeCount = enriched.filter(r => r.dupe_id).length;
    setParseStats({ total: dataRows.length, withName: enriched.length, dupes: dupeCount });

    const initChecked = {};
    for (const r of enriched) initChecked[r._idx] = !r.dupe_id; // uncheck dupes by default
    setChecked(initChecked);
    setRows(enriched);
    setStep('review');

    // Reset file input so same file can be re-selected if needed
    e.target.value = '';
  }

  function toggleAll(val) {
    const next = {};
    for (const r of rows) next[r._idx] = val;
    setChecked(next);
  }

  async function handleImport() {
    const toImport = rows.filter(r => checked[r._idx]);
    if (!toImport.length) { showToast('Nothing selected', 'error'); return; }

    setImporting(true);
    try {
      const addToQueue = (stage === 'call');
      const payload = toImport.map(r => ({
        name:           r.name,
        main_phone:     r.phone || null,
        website:        r.website || null,
        address:        r.address || null,
        city:           r.city || null,
        state:          r.state || null,
        zip:            r.zip || null,
        industry:       r.industry || null,
        notes:          r.notes || null,
        pipeline_stage: stage,
        existing_crm_id: r.dupe_id || null,
        next_follow_up: r.next_follow_up || null,
        contacts: r.contact_name ? [{
          name:       r.contact_name,
          role_title: r.contact_role || null,
          is_preferred: 1,
        }] : [],
        history: [],
      }));

      const res = await api.importCallHistory(payload, addToQueue);
      setResult({ ...res, stage, count: toImport.length });
      setStep('done');
      refreshCounts();
    } catch(err) {
      showToast('Import failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = rows.filter(r => checked[r._idx]).length;
  const newCount      = rows.filter(r => checked[r._idx] && !r.dupe_id).length;
  const dupeCount     = rows.filter(r => checked[r._idx] && r.dupe_id).length;

  return (
    <div style={{ maxWidth: 1000 }}>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--navy-800)', marginBottom: 4 }}>
          🏢 Import New Companies
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          Upload a CSV with basic company info. Column headers are matched flexibly — spaces, underscores,
          and capitalization don't matter.
        </div>
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div>
          <div
            style={{ background: '#f8fafc', border: '2px dashed var(--gray-300)', borderRadius: 12, padding: 40, textAlign: 'center', cursor: 'pointer' }}
            onClick={() => fileRef.current?.click()}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--navy-800)', marginBottom: 8 }}>
              Click to choose your CSV
            </div>
            <div style={{ fontSize: 12, color: 'var(--gray-400)', marginBottom: 20 }}>
              or drag and drop here
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
            <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px' }}
              onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
              📁 Choose CSV File
            </button>
          </div>

          <div style={{ marginTop: 20, padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#0369a1', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              📐 Accepted Column Headers (flexible matching)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 24px' }}>
              {[
                { field: 'Name *',        examples: 'Name, Company, Business, Account' },
                { field: 'Phone',         examples: 'Phone, Tel, Main Phone, Number' },
                { field: 'Website',       examples: 'Website, Web, URL' },
                { field: 'Address',       examples: 'Address, Street' },
                { field: 'City',          examples: 'City, Town' },
                { field: 'State',         examples: 'State, ST, Province' },
                { field: 'Zip',           examples: 'Zip, Postal, Zip Code' },
                { field: 'Industry',      examples: 'Industry, Type, Sector' },
                { field: 'Contact Name',  examples: 'Contact, Owner, Manager' },
                { field: 'Notes',         examples: 'Notes, Comments, Description' },
              ].map(({ field, examples }) => (
                <div key={field} style={{ fontSize: 12, color: '#0c4a6e' }}>
                  <span style={{ fontWeight: 700 }}>{field}:</span>{' '}
                  <span style={{ color: '#0369a1', fontStyle: 'italic' }}>{examples}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#0369a1' }}>
              * Required. Column order and exact spelling don't matter — spaces, underscores, and capitalization are ignored.
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Review ── */}
      {step === 'review' && (
        <>
          {/* Detected columns strip */}
          <div style={{ marginBottom: 14, padding: '12px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#15803d', marginBottom: 8 }}>
              ✅ Columns detected from your CSV:
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {detectedCols.map(d => (
                <span key={d.field} style={{ fontSize: 11, padding: '2px 10px', borderRadius: 20, background: '#dcfce7', color: '#15803d', fontWeight: 600, border: '1px solid #bbf7d0' }}>
                  {d.header} → {d.field.replace('_', ' ')}
                </span>
              ))}
            </div>
            {unmappedCols.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#92400e' }}>
                ⚠️ Ignored (not recognized): {unmappedCols.map(c => `"${c.label}"`).join(', ')}
              </div>
            )}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Rows in File',      val: parseStats.total,    color: 'var(--navy-800)' },
              { label: 'Valid Companies',   val: parseStats.withName, color: '#15803d' },
              { label: 'Already in CRM',   val: parseStats.dupes,    color: '#d97706', sub: 'unchecked by default' },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, minWidth: 130, background: '#f8fafc', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val.toLocaleString()}</div>
                {s.sub && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Stage picker */}
          <div style={{ marginBottom: 14, padding: '14px 18px', background: 'white', border: '1px solid var(--gray-200)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy-800)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              📍 Where should these companies land?
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {STAGES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setStage(s.key)}
                  style={{
                    padding: '8px 14px', borderRadius: 8,
                    border: stage === s.key ? '2px solid var(--navy-800)' : '2px solid var(--gray-200)',
                    background: stage === s.key ? 'var(--navy-800)' : 'white',
                    color: stage === s.key ? 'white' : 'var(--gray-600)',
                    fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all .15s',
                  }}
                >
                  <div>{s.label}</div>
                  <div style={{ fontSize: 10, fontWeight: 400, marginTop: 2, opacity: .8 }}>{s.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Selection bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'var(--navy-950)', borderRadius: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>
              {selectedCount} selected · {newCount} new · {dupeCount} updating existing
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className="btn btn-ghost btn-sm"
                style={{ color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.2)' }}
                onClick={() => toggleAll(true)}>Select All</button>
              <button className="btn btn-ghost btn-sm"
                style={{ color: 'rgba(255,255,255,.7)', border: '1px solid rgba(255,255,255,.2)' }}
                onClick={() => toggleAll(false)}>Deselect All</button>
            </div>
          </div>

          {/* Table */}
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr',
              padding: '8px 12px', background: 'var(--gray-50)', borderBottom: '1px solid var(--gray-200)',
              fontSize: 10, fontWeight: 700, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.06em',
            }}>
              <div /><div>Company</div><div>Phone</div><div>Industry</div><div>Contact</div><div>Status</div>
            </div>
            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {rows.map(r => {
                const isChecked = !!checked[r._idx];
                return (
                  <div
                    key={r._idx}
                    style={{
                      display: 'grid', gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr',
                      padding: '9px 12px', borderBottom: '1px solid var(--gray-100)',
                      background: isChecked ? 'white' : '#fafafa',
                      opacity: isChecked ? 1 : 0.5, alignItems: 'center', cursor: 'pointer',
                    }}
                    onClick={() => setChecked(p => ({ ...p, [r._idx]: !p[r._idx] }))}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => {}}
                      style={{ accentColor: 'var(--navy-800)', width: 13, height: 13 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy-800)' }}>{r.name}</div>
                      {(r.city || r.state) && (
                        <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                          {[r.address, r.city, r.state, r.zip].filter(Boolean).join(', ')}
                        </div>
                      )}
                      {r.website && <div style={{ fontSize: 10, color: '#0369a1' }}>{r.website}</div>}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.phone || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.industry || '—'}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.contact_name || '—'}</div>
                    <div>
                      {r.dupe_id ? (
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 700, background: '#fffbeb', color: '#92400e', padding: '2px 8px', borderRadius: 20 }}>
                            🔀 Already exists
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>
                            Matches: <strong>{r.dupe_name}</strong>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#f0fdf4', color: '#15803d', padding: '2px 8px', borderRadius: 20 }}>
                          🆕 New
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-ghost"
              onClick={() => { setStep('upload'); setRows([]); }}>
              ← Start Over
            </button>
            <button
              className="btn btn-primary btn-lg"
              style={{ flex: 1 }}
              onClick={handleImport}
              disabled={importing || selectedCount === 0}
            >
              {importing
                ? '⏳ Importing…'
                : `✅ Import ${selectedCount} Companies → ${STAGES.find(s => s.key === stage)?.label}`}
            </button>
          </div>
        </>
      )}

      {/* ── STEP 3: Done ── */}
      {step === 'done' && result && (
        <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: 12, padding: 28 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#15803d', marginBottom: 16 }}>✅ Import Complete</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'New Companies Created',    val: result.imported,          color: '#15803d' },
              { label: 'Already Existed (skipped)',val: result.skipped,           color: '#d97706' },
              { label: 'Errors',                   val: result.errors?.length||0, color: result.errors?.length ? '#dc2626' : '#94a3b8' },
            ].map((s, i) => (
              <div key={i} style={{ background: 'white', borderRadius: 8, padding: '12px 16px', border: '1px solid var(--gray-200)' }}>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {result.errors?.length > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#dc2626' }}>
              <strong>Errors ({result.errors.length}):</strong>{' '}
              {result.errors.slice(0, 5).map(e => e.error || e).join(' · ')}
            </div>
          )}

          <div style={{ fontSize: 13, color: '#15803d', marginBottom: 16 }}>
            Companies landed in: <strong>{STAGES.find(s => s.key === result.stage)?.label}</strong>.
            Go to <strong>Companies</strong> to verify the import.
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost"
              onClick={() => { setStep('upload'); setRows([]); setResult(null); setParseStats(null); setDetectedCols([]); }}>
              ← Import Another File
            </button>
            {onDone && (
              <button className="btn btn-primary" onClick={onDone}>
                Go to Companies →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
