/**
 * SimpleImport — Fresh Company CSV Import
 *
 * For importing brand new prospect companies with basic info.
 * Columns auto-detected by header name (flexible, forgiving).
 *
 * Supported columns (any order, fuzzy matched):
 *   name / company / business
 *   phone / number / tel
 *   website / web / url
 *   address / street
 *   city
 *   state
 *   zip / postal
 *   industry / type / sector
 *   contact / contact name / owner / manager
 *   notes / comment / description
 *
 * Flow:
 *   1. Upload CSV
 *   2. Review table (new vs duplicate, editable pipeline stage)
 *   3. Choose pipeline stage + queue option
 *   4. Confirm → POST /api/companies/import
 *   5. Done screen
 */

import { useState, useRef } from 'react';
import { api, fmtPhone } from '../api.js';
import { useApp } from '../App.jsx';

// ── Column auto-detection ────────────────────────────────────────────────────
const COL_ALIASES = {
  name:         ['name', 'company', 'business', 'company name', 'business name', 'dba'],
  phone:        ['phone', 'main phone', 'number', 'tel', 'telephone', 'main_phone', 'phone number'],
  website:      ['website', 'web', 'url', 'site', 'www'],
  address:      ['address', 'street', 'addr', 'street address'],
  city:         ['city', 'town'],
  state:        ['state', 'st', 'province'],
  zip:          ['zip', 'postal', 'zipcode', 'zip code', 'postal code'],
  industry:     ['industry', 'type', 'sector', 'category', 'business type'],
  contact_name: ['contact', 'contact name', 'owner', 'manager', 'person', 'key contact', 'primary contact'],
  notes:        ['notes', 'note', 'comments', 'comment', 'description', 'memo'],
};

function detectColumns(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const normalized = String(h || '').toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COL_ALIASES)) {
      if (aliases.includes(normalized) && !(field in map)) {
        map[field] = i;
      }
    }
  });
  return map;
}

// ── CSV parser (handles quoted commas) ───────────────────────────────────────
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
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

// ── Pipeline stage options ────────────────────────────────────────────────────
const STAGES = [
  { key: 'new',   label: '🆕 New',   desc: 'Sits in New — no queue' },
  { key: 'call',  label: '📞 Call',  desc: 'Goes straight to Calling Queue' },
  { key: 'mail',  label: '✉️ Mail',  desc: 'Goes to Mail Queue' },
  { key: 'email', label: '📧 Email', desc: 'Goes to Email Queue' },
  { key: 'visit', label: '📍 Visit', desc: 'Goes to Visit Queue' },
];

export default function SimpleImport({ onDone }) {
  const [step, setStep]               = useState('upload');   // upload | map | review | done
  const [rows, setRows]               = useState([]);         // parsed + enriched rows
  const [checked, setChecked]         = useState({});         // index → bool
  const [colMap, setColMap]           = useState({});         // field → col index
  const [headers, setHeaders]         = useState([]);
  const [parseStats, setParseStats]   = useState(null);
  const [stage, setStage]             = useState('new');
  const [importing, setImporting]     = useState(false);
  const [result, setResult]           = useState(null);
  const [unmappedCols, setUnmappedCols] = useState([]);       // columns we couldn't auto-detect
  const fileRef                       = useRef();
  const { showToast, refreshCounts }  = useApp();

  // ── Step 1: File upload + parse ───────────────────────────────────────────
  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.csv')) {
      showToast('Please use a CSV file — in Excel: File → Save As → CSV UTF-8', 'error');
      return;
    }

    const text = await file.text();
    const allRows = parseCSV(text);
    if (allRows.length < 2) { showToast('File looks empty or has only 1 row', 'error'); return; }

    // First row = headers
    const hdrs = allRows[0];
    const detected = detectColumns(hdrs);
    const dataRows = allRows.slice(1);

    // Find any columns we couldn't auto-match
    const mappedIdxs = new Set(Object.values(detected));
    const unmapped = hdrs
      .map((h, i) => ({ label: h, idx: i }))
      .filter(({ idx }) => !mappedIdxs.has(idx) && idx < hdrs.length);

    setHeaders(hdrs);
    setColMap(detected);
    setUnmappedCols(unmapped);

    // Build row objects
    const built = dataRows.map((r, i) => {
      const get = (field) => String(r[detected[field]] ?? '').trim();
      return {
        _idx:         i,
        name:         get('name'),
        phone:        cleanPhone(get('phone')),
        website:      get('website'),
        address:      get('address'),
        city:         get('city'),
        state:        get('state'),
        zip:          get('zip'),
        industry:     get('industry'),
        contact_name: get('contact_name'),
        notes:        get('notes'),
      };
    }).filter(r => r.name); // must have a name

    if (built.length === 0) {
      showToast('No rows with a company name found. Check your CSV has a "Name" or "Company" column.', 'error');
      return;
    }

    // Check for duplicates against CRM
    let existingByPhone = {};
    let existingByName  = {};
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

    // Default: check all NEW, uncheck dupes
    const initChecked = {};
    for (const r of enriched) initChecked[r._idx] = true;
    setChecked(initChecked);
    setRows(enriched);

    // If we couldn't detect "name" column at all, warn and stop
    if (!('name' in detected)) {
      showToast('Could not find a "Name" or "Company" column — check your headers', 'error');
      return;
    }

    setStep('review');
  }

  function toggleAll(val) {
    const next = {};
    for (const r of rows) next[r._idx] = val;
    setChecked(next);
  }

  // ── Step 2: Confirm import ────────────────────────────────────────────────
  async function handleImport() {
    const toImport = rows.filter(r => checked[r._idx]);
    if (!toImport.length) { showToast('Nothing selected', 'error'); return; }

    setImporting(true);
    try {
      const addToQueue = (stage === 'call');  // calling queue only if stage=call
      const payload = toImport.map(r => ({
        name:         r.name,
        main_phone:   r.phone || null,
        website:      r.website || null,
        address:      r.address || null,
        city:         r.city || null,
        state:        r.state || null,
        zip:          r.zip || null,
        industry:     r.industry || null,
        notes:        r.notes || null,
        pipeline_stage: stage,
        existing_crm_id: r.dupe_id || null,
        // If there's a contact name, send it as the first contact
        contact_name: r.contact_name || null,
        // No history for fresh imports
        history: [],
      }));

      const res = await api.importCompanies(payload, addToQueue);
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1000 }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--navy-800)', marginBottom: 4 }}>
          🏢 Import New Companies
        </div>
        <div style={{ fontSize: 13, color: 'var(--gray-500)', lineHeight: 1.6 }}>
          Upload a simple CSV with company info. Flexible headers — name it whatever makes sense in your spreadsheet.
        </div>
      </div>

      {/* ── STEP 1: Upload ── */}
      {step === 'upload' && (
        <div>
          {/* Drop zone */}
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
            <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
            <button className="btn btn-primary" style={{ fontSize: 14, padding: '10px 28px' }}
              onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
              📁 Choose CSV File
            </button>
          </div>

          {/* Column guide */}
          <div style={{ marginTop: 20, padding: '16px 20px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 12, color: '#0369a1', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              📐 Accepted Column Headers
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '6px 24px' }}>
              {[
                { field: 'Name *', examples: 'Name, Company, Business, DBA' },
                { field: 'Phone', examples: 'Phone, Number, Tel, Main Phone' },
                { field: 'Website', examples: 'Website, Web, URL, Site' },
                { field: 'Address', examples: 'Address, Street' },
                { field: 'City', examples: 'City, Town' },
                { field: 'State', examples: 'State, ST, Province' },
                { field: 'Zip', examples: 'Zip, Postal, Zip Code' },
                { field: 'Industry', examples: 'Industry, Type, Sector' },
                { field: 'Contact Name', examples: 'Contact, Owner, Manager' },
                { field: 'Notes', examples: 'Notes, Comments, Description' },
              ].map(({ field, examples }) => (
                <div key={field} style={{ fontSize: 12, color: '#0c4a6e' }}>
                  <span style={{ fontWeight: 700 }}>{field}:</span>{' '}
                  <span style={{ color: '#0369a1', fontStyle: 'italic' }}>{examples}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: '#0369a1' }}>
              * Required. Everything else is optional. Column order doesn't matter.
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 2: Review ── */}
      {step === 'review' && (
        <>
          {/* Parse stats */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Rows in File', val: parseStats.total, color: 'var(--navy-800)' },
              { label: 'Valid Companies', val: parseStats.withName, color: '#15803d' },
              { label: 'Already in CRM', val: parseStats.dupes, color: '#d97706', sub: 'unchecked by default' },
            ].map((s, i) => (
              <div key={i} style={{ flex: 1, minWidth: 130, background: '#f8fafc', border: '1px solid var(--gray-200)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.val.toLocaleString()}</div>
                {s.sub && <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Unmapped columns warning */}
          {unmappedCols.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 12, color: '#92400e' }}>
              <strong>⚠️ These columns weren't recognized and will be ignored:</strong>{' '}
              {unmappedCols.map(c => `"${c.label}"`).join(', ')}
              <span style={{ marginLeft: 6, color: '#78350f' }}>— rename them to match the accepted headers above if needed.</span>
            </div>
          )}

          {/* Pipeline stage picker */}
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
                    padding: '8px 14px',
                    borderRadius: 8,
                    border: stage === s.key ? '2px solid var(--navy-800)' : '2px solid var(--gray-200)',
                    background: stage === s.key ? 'var(--navy-800)' : 'white',
                    color: stage === s.key ? 'white' : 'var(--gray-600)',
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: 'pointer',
                    transition: 'all .15s',
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

          {/* Review table */}
          <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr',
              gap: 0,
              padding: '8px 12px',
              background: 'var(--gray-50)',
              borderBottom: '1px solid var(--gray-200)',
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--gray-400)',
              textTransform: 'uppercase',
              letterSpacing: '.06em',
            }}>
              <div />
              <div>Company</div>
              <div>Phone</div>
              <div>Industry</div>
              <div>Contact</div>
              <div>Status</div>
            </div>

            <div style={{ maxHeight: 600, overflowY: 'auto' }}>
              {rows.map(r => {
                const isChecked = !!checked[r._idx];
                return (
                  <div
                    key={r._idx}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '32px 2fr 1fr 1fr 1fr 1fr',
                      gap: 0,
                      padding: '9px 12px',
                      borderBottom: '1px solid var(--gray-100)',
                      background: isChecked ? 'white' : '#fafafa',
                      opacity: isChecked ? 1 : 0.5,
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => setChecked(p => ({ ...p, [r._idx]: !p[r._idx] }))}
                  >
                    <input type="checkbox" checked={isChecked} onChange={() => {}}
                      style={{ accentColor: 'var(--navy-800)', width: 13, height: 13 }} />

                    {/* Name + address */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--navy-800)' }}>{r.name}</div>
                      {(r.city || r.state) && (
                        <div style={{ fontSize: 10, color: 'var(--gray-400)' }}>
                          {[r.address, r.city, r.state, r.zip].filter(Boolean).join(', ')}
                        </div>
                      )}
                      {r.website && (
                        <div style={{ fontSize: 10, color: '#0369a1' }}>{r.website}</div>
                      )}
                    </div>

                    {/* Phone */}
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.phone || '—'}</div>

                    {/* Industry */}
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.industry || '—'}</div>

                    {/* Contact */}
                    <div style={{ fontSize: 12, color: 'var(--gray-600)' }}>{r.contact_name || '—'}</div>

                    {/* Status badge */}
                    <div>
                      {r.dupe_id ? (
                        <div>
                          <span style={{ fontSize: 10, fontWeight: 700, background: '#fffbeb', color: '#92400e', padding: '2px 8px', borderRadius: 20 }}>
                            🔀 Merge into existing
                          </span>
                          <div style={{ fontSize: 10, color: 'var(--gray-400)', marginTop: 3 }}>
                            Matches: <strong>{r.dupe_name}</strong> — history + contacts will be combined
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, background: '#f0fdf4', color: '#15803d', padding: '2px 8px', borderRadius: 20 }}>
                          🆕 New Company
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
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
              { label: 'New Companies Created', val: result.imported, color: '#15803d' },
              { label: 'Already Existed (updated)', val: result.skipped, color: '#d97706' },
              { label: 'Errors', val: result.errors?.length || 0, color: result.errors?.length ? '#dc2626' : '#94a3b8' },
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
              onClick={() => { setStep('upload'); setRows([]); setResult(null); setParseStats(null); }}>
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
