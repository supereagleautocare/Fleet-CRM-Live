import { useState } from 'react';

export default function RowActions({ companyStatus='prospect', onStatusChange, onMove }) {
  const [open, setOpen] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);

  async function handleStatusChange(e) {
    e.stopPropagation();
    const status = e.target.value;
    setSavingStatus(true);
    try {
      await onStatusChange(status);
      setOpen(false);
    } finally {
      setSavingStatus(false);
    }
  }

  function handleMove(e) {
    e.stopPropagation();
    setOpen(false);
    onMove();
  }

  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center', gap:6 }} onClick={e => e.stopPropagation()}>
      <button
        onClick={e => { e.stopPropagation(); setOpen(p => !p); }}
        style={{ border:'none', background:'none', cursor:'pointer', fontSize:18, color:'var(--gray-400)', padding:'4px 8px', borderRadius:6, lineHeight:1, letterSpacing:1 }}
        title="Actions"
      >
        ···
      </button>

      {open && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:998 }} onClick={() => setOpen(false)} />
          <div style={{ position:'fixed', right:'auto', left:'auto', zIndex:9999, background:'white', borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.15)', border:'1px solid var(--gray-200)', minWidth:190, overflow:'hidden', transform:'translateX(-80%)' }}>
            
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--gray-100)' }}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--gray-400)', textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6 }}>
                Status
              </div>
              <select
                value={companyStatus || 'prospect'}
                onChange={handleStatusChange}
                disabled={savingStatus}
                style={{
                  width:'100%',
                  padding:'6px 10px',
                  borderRadius:8,
                  fontSize:12,
                  fontWeight:700,
                  cursor:'pointer',
                  border:`1.5px solid ${
                    companyStatus==='interested' ? '#fde68a' :
                    companyStatus==='customer'   ? '#bbf7d0' :
                    companyStatus==='dead'       ? '#fca5a5' : '#e2e8f0'
                  }`,
                  background:
                    companyStatus==='interested' ? '#fef9c3' :
                    companyStatus==='customer'   ? '#f0fdf4' :
                    companyStatus==='dead'       ? '#fef2f2' : '#f8fafc',
                  color:
                    companyStatus==='interested' ? '#92400e' :
                    companyStatus==='customer'   ? '#166534' :
                    companyStatus==='dead'       ? '#dc2626' : '#64748b',
                }}
              >
                <option value="prospect">Prospect</option>
                <option value="interested">⭐ Interested</option>
                <option value="customer">✅ Customer</option>
                <option value="dead">💀 Dead</option>
              </select>
            </div>

            <button
              onClick={handleMove}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'10px 14px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:600, textAlign:'left', color:'var(--gray-700)' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--gray-50)'}
              onMouseLeave={e => e.currentTarget.style.background='none'}
            >
              ➡️ Move to Stage
            </button>
          </div>
        </>
      )}
    </div>
  );
}
