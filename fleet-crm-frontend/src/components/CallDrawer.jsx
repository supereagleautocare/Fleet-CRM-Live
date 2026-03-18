import { useState, useEffect } from 'react';
import { fmtPhone } from '../api.js';

/**
 * CallDrawer — slides out from the right when logging mail, email, or visits.
 * For calls, CompanyPanel is used instead.
 *
 * Props:
 *   open          — bool
 *   onClose       — fn
 *   onComplete    — fn(formData)
 *   contact       — the row data object
 *   type          — 'visit' | 'mail' | 'email'
 *   contactTypes  — full { byAction, all } object from api.contactTypes()
 *   loading       — bool
 */
export default function CallDrawer({ open, onClose, onComplete, contact, type, contactTypes = {}, loading }) {
  const [form, setForm] = useState({
    contact_type: '',
    notes: '',
    next_action: 'Call',
    contact_name: '',
    direct_line: '',
    email: '',
    role_title: '',
    set_as_preferred: true, // default ON — always save contacts
    next_action_date_override: '',
    show_date_override: false,
    mail_piece: '',
    email_template: '',
    email_to: '',
  });

  useEffect(() => {
    if (open) {
      setForm({
        contact_type: '',
        notes: '',
        next_action: 'Call',
        contact_name: contact?.contact_name || contact?.preferred_contact_name || '',
        direct_line:  contact?.direct_line  || contact?.preferred_direct_line  || '',
        email:        contact?.email        || contact?.preferred_email         || '',
        role_title:   contact?.role_title   || contact?.preferred_role          || '',
        set_as_preferred: true,
        next_action_date_override: '',
        show_date_override: false,
        mail_piece: '',
        email_template: '',
        email_to: contact?.preferred_email || contact?.email || '',
      });
    }
  }, [open, contact]);

  if (!open || !contact) return null;

  const isVisit = type === 'visit';
  const isMail  = type === 'mail';
  const isEmail = type === 'email';

  const name   = contact.company_name || contact.entity_name || contact.name || '';
  const phone  = fmtPhone(contact.main_phone || contact.phone);
  const compId = contact.company_id || '';

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.contact_type) return;
    onComplete(form);
  }

  // Get action-specific contact types
  const byAction = contactTypes?.byAction || {};
  const actionKey = isVisit ? 'visit' : isMail ? 'mail' : isEmail ? 'email' : 'call';
  const defaultVisitTypes = ['Spoke To Decision Maker','Spoke To Fleet Manager','Spoke To Receptionist','Left Materials','Drop Off Flyer','No One Available'];
  const defaultMailTypes  = ['Postcard','Handwritten Letter','Intro Letter','Follow-Up Letter','Flyer'];
  const defaultEmailTypes = ['Intro Email','Follow-Up Email','Proposal','Newsletter'];
  const types = byAction[actionKey]?.length > 0
    ? byAction[actionKey]
    : isVisit ? defaultVisitTypes
    : isMail  ? defaultMailTypes
    : isEmail ? defaultEmailTypes
    : (contactTypes?.all || []);

  const actionLabel = isVisit ? 'Log Visit' : isMail ? 'Log Mail' : isEmail ? 'Log Email' : 'Log Call';
  const actionEmoji = isVisit ? '📍' : isMail ? '✉️' : isEmail ? '📧' : '📞';

  return (
    <div className="drawer-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="drawer">

        {/* Header */}
        <div className="drawer-header">
          <button className="drawer-close" onClick={onClose}>✕</button>
          <div>
            <div className="drawer-title">{actionEmoji} {actionLabel}</div>
            <div className="drawer-subtitle">{name}</div>
          </div>
        </div>

        <div className="drawer-body">
          {/* Company info strip */}
          <div style={{ background:'var(--gray-50)', borderRadius:10, padding:'12px 14px', marginBottom:18, border:'1px solid var(--gray-100)' }}>
            {phone !== '—' && (
              <div className="info-row">
                <span className="info-label">📱 Phone</span>
                <span className="info-value mono">{phone}</span>
              </div>
            )}
            {contact.address && (
              <div className="info-row">
                <span className="info-label">📍 Address</span>
                <span className="info-value">{contact.address}{contact.city ? ', ' + contact.city : ''}</span>
              </div>
            )}
            {compId && (
              <div className="info-row">
                <span className="info-label">🆔 ID</span>
                <span className="info-value mono">{compId}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit}>

            {/* ── VISIT-specific: who you saw ──────────────────────── */}
            {isVisit && (
              <>
                <div className="section-divider">Who Did You See?</div>
                <div className="form-group">
                  <label className="form-label">Contact Name <span style={{color:'var(--gray-400)',fontWeight:400}}>(optional)</span></label>
                  <input className="form-input" placeholder="Name of person you spoke with" value={form.contact_name} onChange={e => set('contact_name', e.target.value)} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div className="form-group">
                    <label className="form-label">Title / Role</label>
                    <input className="form-input" placeholder="Fleet Manager, Owner…" value={form.role_title} onChange={e => set('role_title', e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Direct Line</label>
                    <input className="form-input" placeholder="Direct #" value={form.direct_line} onChange={e => set('direct_line', e.target.value)} />
                  </div>
                </div>
                {form.contact_name && (
                  <div className="form-group" style={{ flexDirection:'row', alignItems:'center', gap:8, padding:'8px 12px', background:'#fefce8', border:'1px solid #fde68a', borderRadius:8 }}>
                    <input type="checkbox" id="pref" checked={form.set_as_preferred} onChange={e => set('set_as_preferred', e.target.checked)} style={{ width:16, height:16, accentColor:'var(--gold-500)' }} />
                    <label htmlFor="pref" style={{ fontSize:13, cursor:'pointer', color:'var(--gray-700)' }}>
                      ⭐ Save <strong>{form.contact_name}</strong> to company contacts
                    </label>
                  </div>
                )}
              </>
            )}

            {/* ── MAIL-specific: mail piece ────────────────────────── */}
            {isMail && (
              <>
                <div className="section-divider">What Did You Send?</div>
              </>
            )}

            {/* ── EMAIL-specific ───────────────────────────────────── */}
            {isEmail && (
              <>
                <div className="section-divider">Email Details</div>
                <div className="form-group">
                  <label className="form-label">Sent To</label>
                  <input className="form-input" type="email" placeholder="email@company.com" value={form.email_to} onChange={e => set('email_to', e.target.value)} />
                </div>
              </>
            )}

            {/* ── What happened (action-specific types) ───────────── */}
            <div className="section-divider">
              {isVisit ? 'What Happened' : isMail ? 'Mail Piece *' : isEmail ? 'Email Type *' : 'What Happened *'}
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
              {types.map(t => (
                <button key={t} type="button" onClick={() => set('contact_type', t)}
                  style={{
                    padding:'7px 14px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:600,
                    border:`1.5px solid ${form.contact_type===t ? 'var(--navy-700)' : 'var(--gray-200)'}`,
                    background: form.contact_type===t ? 'var(--navy-800)' : 'white',
                    color: form.contact_type===t ? 'white' : 'var(--gray-700)',
                    transition:'all .1s',
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Notes */}
            <div className="form-group">
              <label className="form-label">Notes</label>
              <textarea className="form-textarea" placeholder={
                isVisit ? "What did you observe? Who did you speak with? Any details…"
                : isMail ? "Any notes about this mailing…"
                : isEmail ? "What was the email about? Any response?"
                : "What happened? Key details…"
              } value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} />
            </div>

            {/* Next action */}
            <div className="section-divider">Next Action</div>
            <div className="next-action-group" style={{ marginBottom:12 }}>
              {[
                ['Call', '📞 Call'],
                ['Mail', '✉️ Mail'],
                ['Email', '📧 Email'],
                ['Visit', '📍 Visit'],
                ['Stop', '🚫 Stop'],
              ].map(([val, label]) => (
                <button key={val} type="button"
                  className={`action-btn${form.next_action===val ? val==='Stop' ? ' selected-stop' : val==='Visit' ? ' selected-visit' : ' selected-call' : ''}`}
                  onClick={() => set('next_action', val)}>
                  {label}
                </button>
              ))}
            </div>

            <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:13, color:'var(--gray-600)', marginBottom:8 }}>
              <input type="checkbox" checked={form.show_date_override} onChange={e => set('show_date_override', e.target.checked)} style={{ width:15, height:15, accentColor:'var(--gold-500)' }} />
              Set follow-up date manually
            </label>
            {form.show_date_override && (
              <input className="form-input" type="date" style={{ marginBottom:12 }}
                value={form.next_action_date_override}
                onChange={e => set('next_action_date_override', e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            )}

            <button type="submit" className="btn btn-primary btn-lg" style={{ width:'100%' }} disabled={loading || !form.contact_type}>
              {loading ? 'Saving…' : `✅ ${actionLabel} & Complete`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
