import { useState } from 'react';

export default function RowActions({ isStarred, onStar, onMove }) {
  const [open, setOpen] = useState(false);
  const [starring, setStarring] = useState(false);

  async function handleStar(e) {
    e.stopPropagation();
    setStarring(true);
    await onStar();
    setStarring(false);
    setOpen(false);
  }

  function handleMove(e) {
    e.stopPropagation();
    setOpen(false);
    onMove();
  }

  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center', gap:6 }} onClick={e => e.stopPropagation()}>
      {isStarred && (
        <span style={{ fontSize:13, lineHeight:1 }} title="Important">⭐</span>
      )}
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
          <div style={{ position:'absolute', right:0, top:'100%', zIndex:999, background:'white', borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.15)', border:'1px solid var(--gray-200)', minWidth:160, overflow:'hidden' }}>
            <button
              onClick={handleStar}
              disabled={starring}
              style={{ display:'flex', alignItems:'center', gap:8, width:'100%', padding:'10px 14px', border:'none', background:'none', cursor:'pointer', fontSize:13, fontWeight:600, textAlign:'left', color:'var(--gray-700)' }}
              onMouseEnter={e => e.currentTarget.style.background='var(--gray-50)'}
              onMouseLeave={e => e.currentTarget.style.background='none'}
            >
              {isStarred ? '⭐ Remove Flag' : '☆ Flag as Important'}
            </button>
            <div style={{ height:1, background:'var(--gray-100)' }} />
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
