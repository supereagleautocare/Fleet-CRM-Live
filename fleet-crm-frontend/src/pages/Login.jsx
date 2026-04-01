import { useState } from 'react';
import { useApp } from '../App.jsx';

export default function Login() {
  const { login } = useApp();
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [error, setError]             = useState('');
  const [loading, setLoading]         = useState(false);
  const [showForgot, setShowForgot]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent]   = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  async function handleForgot(e) {
    e.preventDefault();
    setForgotLoading(true);
    try {
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      setForgotSent(true);
    } catch(_) {
      setForgotSent(true);
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="eagle">🦅</span>
          <div className="brand">Super Eagle Fleet CRM</div>
          <div className="sub">Sign in to your account</div>
        </div>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              placeholder="you@supereagle.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>

        {!showForgot ? (
          <div style={{ textAlign:'center', marginTop:16 }}>
            <button onClick={()=>setShowForgot(true)}
              style={{ background:'none', border:'none', color:'rgba(255,255,255,.35)', fontSize:12, cursor:'pointer', textDecoration:'underline' }}>
              Forgot password?
            </button>
          </div>
        ) : (
          <div style={{ marginTop:20, padding:'16px', background:'rgba(255,255,255,.06)', borderRadius:8, border:'1px solid rgba(255,255,255,.1)' }}>
            {forgotSent ? (
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:24, marginBottom:8 }}>📧</div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,.7)', lineHeight:1.6 }}>
                  If that email is in our system, a reset link is on its way. Check your inbox.
                </div>
                <button onClick={()=>{ setShowForgot(false); setForgotSent(false); setForgotEmail(''); }}
                  style={{ marginTop:12, background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:11, cursor:'pointer', textDecoration:'underline' }}>
                  Back to login
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize:13, fontWeight:700, color:'rgba(255,255,255,.7)', marginBottom:10 }}>Reset your password</div>
                <form onSubmit={handleForgot}>
                  <input className="form-input" type="email" required
                    placeholder="Enter your email address"
                    value={forgotEmail} onChange={e=>setForgotEmail(e.target.value)}
                    style={{ marginBottom:8, background:'rgba(0,0,0,.2)', borderColor:'rgba(255,255,255,.15)', color:'white' }}/>
                  <button type="submit" className="btn btn-primary" style={{ width:'100%' }} disabled={forgotLoading}>
                    {forgotLoading ? 'Sending…' : 'Send Reset Link'}
                  </button>
                </form>
                <button onClick={()=>setShowForgot(false)}
                  style={{ marginTop:8, background:'none', border:'none', color:'rgba(255,255,255,.4)', fontSize:11, cursor:'pointer', textDecoration:'underline', display:'block', textAlign:'center', width:'100%' }}>
                  Back to login
                </button>
              </>
            )}
          </div>
        )}
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 11, color: 'var(--navy-500)' }}>
          Super Eagle Fleet CRM v1.0
        </div>
      </div>
    </div>
  );
}
