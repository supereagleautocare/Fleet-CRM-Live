import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token');

  useEffect(() => { if (!token) navigate('/'); }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setDone(true);
    } catch(err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="eagle">🦅</span>
          <div className="brand">Super Eagle Fleet CRM</div>
          <div className="sub">{done ? 'Password updated!' : 'Reset your password'}</div>
        </div>
        {done ? (
          <div style={{ textAlign:'center' }}>
            <div style={{ fontSize:13, color:'rgba(255,255,255,.6)', marginBottom:20, lineHeight:1.7 }}>
              Your password has been reset successfully. You can now log in with your new password.
            </div>
            <button className="btn btn-primary btn-lg" style={{ width:'100%' }} onClick={() => navigate('/')}>
              Go to Login →
            </button>
          </div>
        ) : (
          <>
            {error && <div className="login-error">{error}</div>}
            <form className="login-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input className="form-input" type="password" autoFocus
                  placeholder="Min 6 characters"
                  value={password} onChange={e=>setPassword(e.target.value)} required/>
              </div>
              <div className="form-group">
                <label className="form-label">Confirm Password</label>
                <input className="form-input" type="password"
                  placeholder="Repeat your password"
                  value={confirm} onChange={e=>setConfirm(e.target.value)} required/>
              </div>
              <button type="submit" className="btn btn-primary btn-lg" style={{ width:'100%', marginTop:8 }} disabled={loading}>
                {loading ? 'Resetting…' : 'Reset Password →'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
