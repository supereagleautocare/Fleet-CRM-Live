/**
 * MoveModal — shared "Move to Stage" modal used across Dashboard, MailQueue, EmailQueue, Starred.
 * Props:
 *   companyId   — integer id of the company to move
 *   onClose     — called when modal is dismissed (no action)
 *   onMoved     — called after successful move (triggers parent reload)
 */
import { useState } from 'react';
import { api } from '../api.js';
import { useApp } from '../App.jsx';

const STAGES = [
  { key:'call',     label:'📞 Call' },
  { key:'mail',     label:'✉️ Mail' },
  { key:'email',    label:'📧 Email' },
  { key:'visit',    label:'📍 Visit' },
  { key:'dead',     label:'💀 Dead' },
];

export default function MoveModal({ companyId, onClose, onMoved }) {
  const [form, setForm] = useState({ stage: '', due_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const { showToast } = useApp();

  function set(f, v) { setForm(p => ({ ...p, [f]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.stage) return;
    setSaving(true);
    try {
      await api.pipelineMove(companyId, form);
      showToast('Moved to ' + form.stage);
      onMoved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'white', borderRadius:14, padding:28, width:360, boxShadow:'0 20px 60px rgba(0,0,0,.2)' }}>
        <div style={{ fontWeight:800, fontSize:17, marginBottom:18 }}>➡️ Move to Stage</div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Stage *</label>
            <select className="form-input" required value={form.stage} onChange={e => set('stage', e.target.value)}>
              <option value="">Choose stage…</option>
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Due Date <span style={{ fontWeight:400, color:'var(--gray-400)' }}>(optional)</span></label>
            <input type="date" className="form-input" value={form.due_date} onChange={e => set('due_date', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Reason <span style={{ fontWeight:400, color:'var(--gray-400)' }}>(optional)</span></label>
            <input className="form-input" placeholder="Why moving…" value={form.notes} onChange={e => set('notes', e.target.value)} />
          </div>
          <div style={{ fontSize:11, color:'var(--gray-400)', padding:'8px 12px', background:'var(--gray-50)', borderRadius:7, marginBottom:16 }}>
            💡 Saves to history. Does not count as a call attempt.
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button type="submit" className="btn btn-primary" style={{ flex:1 }} disabled={saving || !form.stage}>
              {saving ? 'Moving…' : 'Move'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}
