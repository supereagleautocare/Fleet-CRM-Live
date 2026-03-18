import { useState, useEffect } from 'react';
import { api, fmtPhone, fmtDate } from '../api.js';
import { useApp } from '../App.jsx';
import MoveModal from '../components/MoveModal.jsx';
import { useNavigate } from 'react-router-dom';

const STAGE_LABELS = {
  new:      { icon:'🆕', color:'#64748b', bg:'#f8fafc' },
  call:     { icon:'📞', color:'#1e40af', bg:'#eff6ff' },
  mail:     { icon:'✉️',  color:'#065f46', bg:'#ecfdf5' },
  email:    { icon:'📧', color:'#6b21a8', bg:'#faf5ff' },
  visit:    { icon:'📍', color:'#92400e', bg:'#fffbeb' },
  customer: { icon:'✅', color:'#166534', bg:'#f0fdf4' },
  dead:     { icon:'💀', color:'#6b7280', bg:'#f9fafb' },
};

export default function Starred() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [movingId, setMovingId] = useState(null);
  const [moveForm, setMoveForm] = useState({ stage:'', due_date:'', notes:'' });
  const { showToast } = useApp();
  const navigate = useNavigate();

  async function load() {
    setLoading(true);
    try { setRows(await api.pipelineStage('all', { starred: 1 })); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleUnstar(id) {
    await api.pipelineStar(id);
    showToast('Removed from starred');
    await load();
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="page-title">⭐ Starred — Warm Leads</div>
          <div className="page-subtitle">{rows.length} companies starred as warm leads</div>
        </div>
      </div>

      <div className="page-body">
        {loading ? <div className="loading-wrap"><div className="spinner"/></div>
        : rows.length === 0 ? (
          <div className="empty-state">
            <div className="icon">⭐</div>
            <div className="title">No starred companies yet</div>
            <div className="desc">Star a company on any queue or profile to track your best warm leads here</div>
          </div>
        ) : (
          <div className="table-card">
            <div className="table-card-header">
              <span>⭐</span>
              <span className="table-card-title">Warm Leads</span>
              <span className="table-card-count">{rows.length} companies</span>
            </div>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Stage</th>
                    <th>Phone</th>
                    <th>Industry</th>
                    <th>Last Contact</th>
                    <th>Preferred Contact</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => {
                    const st = STAGE_LABELS[row.pipeline_stage] || STAGE_LABELS.new;
                    return (
                      <tr key={row.id}>
                        <td>
                          <div style={{ fontWeight:700, fontSize:13, cursor:'pointer', color:'var(--navy-800)' }}
                            onClick={() => navigate('/companies')}>
                            {row.name}
                          </div>
                          <div className="company-id">{row.company_id}</div>
                        </td>
                        <td>
                          <span style={{ padding:'3px 10px', borderRadius:12, fontSize:11, fontWeight:700, background:st.bg, color:st.color, border:`1px solid ${st.color}20` }}>
                            {st.icon} {row.pipeline_stage?.charAt(0).toUpperCase() + row.pipeline_stage?.slice(1)}
                          </span>
                        </td>
                        <td><span className="phone-num">{fmtPhone(row.main_phone)}</span></td>
                        <td>{row.industry ? <span className="badge badge-gray">{row.industry}</span> : '—'}</td>
                        <td style={{ fontSize:12, color:'var(--gray-600)' }}>
                          {row.last_contact_type ? `${row.last_contact_type} · ${fmtDate(row.last_contacted)}` : '—'}
                        </td>
                        <td style={{ fontSize:12 }}>
                          {row.preferred_contact_name
                            ? <div>
                                <span style={{ fontWeight:600 }}>{row.preferred_contact_name}</span>
                                {row.preferred_role && <span style={{ color:'var(--gray-400)', fontSize:11, marginLeft:5 }}>{row.preferred_role}</span>}
                              </div>
                            : <span style={{ color:'var(--gray-300)' }}>—</span>}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button className="pill-btn pill-btn-primary"
                              onClick={() => { setMovingId(row.id); setMoveForm({ stage:'', due_date:'', notes:'' }); }}>
                              Move To
                            </button>
                            <button className="pill-btn pill-btn-ghost"
                              onClick={() => handleUnstar(row.id)} title="Remove star">
                              ✕ Unstar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>


      {movingId && (
        <MoveModal
          companyId={movingId}
          onClose={() => setMovingId(null)}
          onMoved={() => { setMovingId(null); load(); }}
        />
      )}
    </>
  );
}
