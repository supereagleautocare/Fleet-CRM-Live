/**
 * CompanyMergeModal — robust company merge with field-by-field control
 *
 * What it does:
 *  1. Search for target company (with working live search)
 *  2. Side-by-side comparison of both companies
 *  3. Per-field radio: keep Source, keep Target, or Combine (for notes)
 *  4. Preview what the merged company will look like
 *  5. Confirm → POST /api/companies/:id/merge/:into_id with options
 *
 * Contacts + Call History always merge automatically (no data is lost).
 */
import { useState, useRef, useEffect } from 'react';
import { api, fmtPhone } from '../api.js';
import { useApp } from '../App.jsx';

const FIELDS = [
  { key: 'name',       label: '🏢 Company Name' },
  { key: 'main_phone', label: '📱 Main Phone',   fmt: fmtPhone },
  { key: 'industry',   label: '🏭 Industry' },
  { key: 'address',    label: '📍 Address' },
  { key: 'city',       label: '🌆 City' },
  { key: 'state',      label: '🗺️ State' },
  { key: 'zip',        label: '📮 Zip' },
  { key: 'website',    label: '🌐 Website' },
  { key: 'notes',      label: '📝 Notes',        canCombine: true },
];

function FieldValue({ val, fmt }) {
  if (!val) return <span style={{ color: 'var(--gray-300)', fontStyle: 'italic', fontSize: 12 }}>empty</span>;
  return <span>{fmt ? fmt(val) : val}</span>;
}

export default function CompanyMergeModal({ sourceCompany, onClose, onMerged }) {
  const [step, setStep] = useState('search'); // search | configure | confirm
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [target, setTarget] = useState(null);
  const [targetFull, setTargetFull] = useState(null);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [choices, setChoices] = useState({}); // field → 'source' | 'target' | 'combine'
  const [merging, setMerging] = useState(false);
  const debounceRef = useRef(null);
  const { showToast } = useApp();

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (searchQuery.trim().length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await api.searchCompanyName(searchQuery.trim());
        // Exclude the source company itself
        setSearchResults((results || []).filter(r => r.id !== sourceCompany.id));
      } catch (e) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [searchQuery]);

  async function selectTarget(company) {
    setTarget(company);
    setLoadingTarget(true);
    try {
      const full = await api.company(company.id);
      setTargetFull(full);
      // Default choices: prefer whichever company has a value
      const defaultChoices = {};
      for (const f of FIELDS) {
        const srcVal = sourceCompany[f.key];
        const tgtVal = full[f.key];
        if (f.canCombine && srcVal && tgtVal) {
          defaultChoices[f.key] = 'combine';
        } else if (tgtVal && !srcVal) {
          defaultChoices[f.key] = 'target';
        } else {
          defaultChoices[f.key] = 'source'; // default keep source (the company you opened)
        }
      }
      setChoices(defaultChoices);
      setStep('configure');
    } catch (e) {
      showToast('Failed to load company: ' + e.message, 'error');
    } finally {
      setLoadingTarget(false);
    }
  }

  function setChoice(field, val) {
    setChoices(c => ({ ...c, [field]: val }));
  }

  // Build preview of what the merged company will look like
  function buildPreview() {
    const preview = {};
    for (const f of FIELDS) {
      const choice = choices[f.key];
      if (choice === 'source') preview[f.key] = sourceCompany[f.key];
      else if (choice === 'target') preview[f.key] = targetFull[f.key];
      else if (choice === 'combine') {
        const parts = [sourceCompany[f.key], targetFull[f.key]].filter(Boolean);
        preview[f.key] = parts.join('\n\n---\n\n');
      }
    }
    return preview;
  }

  async function handleMerge() {
    setMerging(true);
    try {
      await api.mergeCompany(sourceCompany.id, targetFull.id, { field_choices: choices });
      showToast(`✅ Merged into ${targetFull.name}`);
      onMerged(targetFull.id);
    } catch (e) {
      showToast('Merge failed: ' + e.message, 'error');
    } finally {
      setMerging(false);
    }
  }

  const preview = step === 'confirm' ? buildPreview() : null;

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(6,13,31,.6)',
      zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'white',
        borderRadius: 16,
        width: '100%',
        maxWidth: step === 'configure' ? 860 : 520,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 24px 80px rgba(0,0,0,.35)',
      }}>

        {/* Header */}
        <div style={{
          background: 'var(--navy-950)', padding: '16px 22px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'white' }}>
              🔀 Merge Company
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', marginTop: 2 }}>
              {step === 'search' && 'Find the company to merge into'}
              {step === 'configure' && `Merging "${sourceCompany.name}" → choose what to keep`}
              {step === 'confirm' && 'Review and confirm'}
            </div>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, border: '1px solid rgba(255,255,255,.15)',
            borderRadius: 8, background: 'transparent', color: 'rgba(255,255,255,.5)',
            cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>✕</button>
        </div>

        {/* Step tabs */}
        <div style={{
          display: 'flex', background: 'var(--gray-50)',
          borderBottom: '1px solid var(--gray-200)', flexShrink: 0,
        }}>
          {[
            { id: 'search', num: '1', label: 'Find Company' },
            { id: 'configure', num: '2', label: 'Choose Fields' },
            { id: 'confirm', num: '3', label: 'Confirm' },
          ].map((s, i) => {
            const steps = ['search', 'configure', 'confirm'];
            const currentIdx = steps.indexOf(step);
            const thisIdx = steps.indexOf(s.id);
            const done = thisIdx < currentIdx;
            const active = s.id === step;
            return (
              <div key={s.id} style={{
                flex: 1, padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: 8,
                borderBottom: active ? '2px solid var(--navy-800)' : '2px solid transparent',
                cursor: done ? 'pointer' : 'default',
                opacity: thisIdx > currentIdx ? 0.4 : 1,
              }} onClick={() => done && setStep(s.id)}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                  background: done ? '#15803d' : active ? 'var(--navy-800)' : 'var(--gray-200)',
                  color: done || active ? 'white' : 'var(--gray-400)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, fontWeight: 800,
                }}>
                  {done ? '✓' : s.num}
                </div>
                <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? 'var(--navy-800)' : 'var(--gray-500)' }}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 22 }}>

          {/* ── STEP 1: Search ── */}
          {step === 'search' && (
            <div>
              {/* Source company reminder */}
              <div style={{
                padding: '12px 16px', borderRadius: 10,
                background: '#eff6ff', border: '1px solid #bfdbfe', marginBottom: 18,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 4 }}>
                  Merging FROM (will be deleted after merge)
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--navy-800)' }}>{sourceCompany.name}</div>
                <div style={{ fontSize: 12, color: 'var(--gray-500)', marginTop: 2 }}>
                  {fmtPhone(sourceCompany.main_phone)}{sourceCompany.industry ? ` · ${sourceCompany.industry}` : ''}
                </div>
              </div>

              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13, color: 'var(--gray-700)' }}>
                Search for the company to merge INTO:
              </div>
              <div style={{ position: 'relative', marginBottom: 16 }}>
                <input
                  className="form-input"
                  autoFocus
                  placeholder="Type company name to search…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{ paddingLeft: 36, fontSize: 14 }}
                />
                <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 15, color: 'var(--gray-400)' }}>
                  {searching ? '⏳' : '🔍'}
                </span>
              </div>

              {/* Results */}
              {searchResults.length > 0 && (
                <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
                  {searchResults.map((r, i) => (
                    <div key={r.id}
                      onClick={() => selectTarget(r)}
                      style={{
                        padding: '12px 16px', cursor: 'pointer',
                        borderBottom: i < searchResults.length - 1 ? '1px solid var(--gray-100)' : 'none',
                        background: 'white',
                        transition: 'background .08s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--gray-50)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-400)', marginTop: 2, display: 'flex', gap: 10 }}>
                        <span>{fmtPhone(r.main_phone)}</span>
                        {r.city && <span>📍 {r.city}</span>}
                        {r.is_multi_location ? <span className="badge badge-blue" style={{ fontSize: 9 }}>Multi-location</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
                <div style={{
                  padding: '20px', textAlign: 'center', background: 'var(--gray-50)',
                  borderRadius: 10, border: '1px solid var(--gray-200)', color: 'var(--gray-400)', fontSize: 13,
                }}>
                  No companies found for "{searchQuery}"
                </div>
              )}

              {loadingTarget && (
                <div style={{ textAlign: 'center', padding: 20, color: 'var(--gray-400)' }}>
                  Loading company details…
                </div>
              )}

              {/* Warning */}
              <div style={{
                marginTop: 18, padding: '12px 16px', borderRadius: 8,
                background: '#fffbeb', border: '1px solid #fde68a', fontSize: 12, color: '#92400e',
              }}>
                <strong>How merging works:</strong> All call history, contacts, follow-ups, and queue entries from
                "{sourceCompany.name}" will be transferred to the target company. "{sourceCompany.name}" will then be
                permanently deleted. You choose field by field what to keep.
              </div>
            </div>
          )}

          {/* ── STEP 2: Configure ── */}
          {step === 'configure' && targetFull && (
            <div>
              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 80px 1fr', gap: 0, marginBottom: 8 }}>
                <div />
                <div style={{ padding: '8px 12px', background: '#eff6ff', borderRadius: '8px 0 0 0', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 2 }}>FROM (will be deleted)</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: 'var(--navy-800)' }}>{sourceCompany.name}</div>
                </div>
                <div />
                <div style={{ padding: '8px 12px', background: '#f0fdf4', borderRadius: '0 8px 0 0', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 2 }}>INTO (will be kept)</div>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#15803d' }}>{targetFull.name}</div>
                </div>
              </div>

              {/* Field rows */}
              <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden' }}>
                {FIELDS.map((field, idx) => {
                  const srcVal = sourceCompany[field.key];
                  const tgtVal = targetFull[field.key];
                  const choice = choices[field.key];
                  const bothEmpty = !srcVal && !tgtVal;

                  return (
                    <div key={field.key} style={{
                      display: 'grid',
                      gridTemplateColumns: '160px 1fr 80px 1fr',
                      borderBottom: idx < FIELDS.length - 1 ? '1px solid var(--gray-100)' : 'none',
                      background: bothEmpty ? 'var(--gray-50)' : 'white',
                      opacity: bothEmpty ? 0.5 : 1,
                    }}>
                      {/* Field label */}
                      <div style={{
                        padding: '10px 14px',
                        borderRight: '1px solid var(--gray-100)',
                        display: 'flex', alignItems: 'center',
                        fontSize: 11, fontWeight: 700, color: 'var(--gray-500)',
                      }}>
                        {field.label}
                      </div>

                      {/* Source value */}
                      <div
                        onClick={() => !bothEmpty && srcVal && setChoice(field.key, 'source')}
                        style={{
                          padding: '10px 14px',
                          borderRight: '1px solid var(--gray-100)',
                          cursor: srcVal ? 'pointer' : 'default',
                          background: choice === 'source' ? '#eff6ff' : 'transparent',
                          borderLeft: choice === 'source' ? '3px solid #1d4ed8' : '3px solid transparent',
                          fontSize: 12, color: 'var(--gray-700)',
                          display: 'flex', alignItems: 'center', gap: 8,
                          transition: 'all .1s',
                        }}
                      >
                        {srcVal && (
                          <input type="radio" checked={choice === 'source'} onChange={() => setChoice(field.key, 'source')}
                            style={{ accentColor: '#1d4ed8', flexShrink: 0 }} onClick={e => e.stopPropagation()} />
                        )}
                        <FieldValue val={srcVal} fmt={field.fmt} />
                      </div>

                      {/* Middle: combine button for notes */}
                      <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRight: '1px solid var(--gray-100)',
                        padding: '0 4px',
                      }}>
                        {field.canCombine && srcVal && tgtVal ? (
                          <button
                            onClick={() => setChoice(field.key, 'combine')}
                            style={{
                              padding: '3px 6px', borderRadius: 6, fontSize: 9, fontWeight: 700,
                              border: `1.5px solid ${choice === 'combine' ? '#7c3aed' : 'var(--gray-200)'}`,
                              background: choice === 'combine' ? '#7c3aed' : 'white',
                              color: choice === 'combine' ? 'white' : 'var(--gray-400)',
                              cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.4,
                              transition: 'all .1s',
                            }}
                          >
                            Combine<br/>both
                          </button>
                        ) : (
                          <span style={{ fontSize: 10, color: 'var(--gray-300)' }}>↔</span>
                        )}
                      </div>

                      {/* Target value */}
                      <div
                        onClick={() => !bothEmpty && tgtVal && setChoice(field.key, 'target')}
                        style={{
                          padding: '10px 14px',
                          cursor: tgtVal ? 'pointer' : 'default',
                          background: choice === 'target' ? '#f0fdf4' : 'transparent',
                          borderLeft: choice === 'target' ? '3px solid #15803d' : '3px solid transparent',
                          fontSize: 12, color: 'var(--gray-700)',
                          display: 'flex', alignItems: 'center', gap: 8,
                          transition: 'all .1s',
                        }}
                      >
                        {tgtVal && (
                          <input type="radio" checked={choice === 'target'} onChange={() => setChoice(field.key, 'target')}
                            style={{ accentColor: '#15803d', flexShrink: 0 }} onClick={e => e.stopPropagation()} />
                        )}
                        <FieldValue val={tgtVal} fmt={field.fmt} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Always-merged section */}
              <div style={{
                marginTop: 16, padding: '12px 16px', borderRadius: 8,
                background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d',
              }}>
                <strong>✅ Always merged automatically (no data lost):</strong>
                <div style={{ marginTop: 5, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <span>📋 All call history</span>
                  <span>👥 All contacts</span>
                  <span>📅 Follow-ups</span>
                  <span>📋 Queue entries</span>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Confirm ── */}
          {step === 'confirm' && preview && (
            <div>
              <div style={{
                padding: '12px 16px', marginBottom: 16, borderRadius: 8,
                background: '#fef2f2', border: '1px solid #fca5a5', fontSize: 12, color: '#dc2626',
              }}>
                ⚠️ <strong>This cannot be undone.</strong> "{sourceCompany.name}" will be permanently deleted and all
                its data moved to "{targetFull.name}".
              </div>

              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--gray-700)', marginBottom: 12 }}>
                The merged company will look like this:
              </div>

              <div style={{ border: '1px solid var(--gray-200)', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                {FIELDS.map((field, idx) => {
                  const val = preview[field.key];
                  if (!val) return null;
                  return (
                    <div key={field.key} style={{
                      display: 'flex', gap: 0,
                      borderBottom: idx < FIELDS.length - 1 ? '1px solid var(--gray-100)' : 'none',
                    }}>
                      <div style={{
                        padding: '10px 14px', width: 140, flexShrink: 0,
                        fontSize: 11, fontWeight: 700, color: 'var(--gray-400)',
                        borderRight: '1px solid var(--gray-100)', background: 'var(--gray-50)',
                      }}>
                        {field.label}
                      </div>
                      <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--gray-800)', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {field.fmt ? field.fmt(val) : val}
                        {choices[field.key] === 'combine' && (
                          <span style={{ marginLeft: 8, fontSize: 10, background: '#ede9fe', color: '#7c3aed', padding: '1px 7px', borderRadius: 10, fontWeight: 700 }}>
                            combined
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: 12, color: 'var(--gray-500)', padding: '10px 14px', background: 'var(--gray-50)', borderRadius: 8 }}>
                <strong>📋 Also transferring:</strong> {(sourceCompany.stats?.total_calls || 0)} call log entries,
                all contacts, all follow-ups, and queue entries from "{sourceCompany.name}" into "{targetFull?.name}".
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 22px', borderTop: '1px solid var(--gray-200)',
          background: 'var(--gray-50)', flexShrink: 0,
          display: 'flex', gap: 10, justifyContent: 'flex-end',
        }}>
          {step === 'search' && (
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          )}
          {step === 'configure' && (
            <>
              <button className="btn btn-ghost" onClick={() => setStep('search')}>← Back</button>
              <button className="btn btn-navy" onClick={() => setStep('confirm')}>
                Preview Merge →
              </button>
            </>
          )}
          {step === 'confirm' && (
            <>
              <button className="btn btn-ghost" onClick={() => setStep('configure')}>← Back</button>
              <button
                className="btn btn-danger"
                disabled={merging}
                onClick={handleMerge}
                style={{ fontWeight: 800 }}
              >
                {merging ? '⏳ Merging…' : `✅ Confirm Merge — Delete "${sourceCompany.name}"`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
