import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { api, setToken, clearToken } from './api.js';
import Sidebar from './components/Sidebar.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import CallingQueue from './pages/CallingQueue.jsx';
import MailQueue from './pages/MailQueue.jsx';
import EmailQueue from './pages/EmailQueue.jsx';
import VisitQueue from './pages/VisitQueue.jsx';
import Companies from './pages/Companies.jsx';
import Settings from './pages/Settings.jsx';
import QuickLog from './pages/QuickLog.jsx';
import ScriptPopup from './pages/ScriptPopup.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import FleetFinder from './pages/FleetFinder.jsx';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function MobileBottomNav({ counts }) {
  return (
    <nav className="mobile-bottom-nav">
      <NavLink to="/dashboard"   className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">📊</span><span className="mbn-label">Pipeline</span>
      </NavLink>
      <NavLink to="/calling"     className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">📞</span>
        {counts.calling > 0 && <span className="mbn-badge">{counts.calling}</span>}
        <span className="mbn-label">Calling</span>
      </NavLink>
      <NavLink to="/mail-queue"  className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">✉️</span>
        {counts.mail > 0 && <span className="mbn-badge">{counts.mail}</span>}
        <span className="mbn-label">Mail</span>
      </NavLink>
      <NavLink to="/email-queue" className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">📧</span>
        {counts.email > 0 && <span className="mbn-badge">{counts.email}</span>}
        <span className="mbn-label">Email</span>
      </NavLink>
      <NavLink to="/quicklog"    className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">⚡</span><span className="mbn-label">Log</span>
      </NavLink>
      <NavLink to="/visit-queue" className={({isActive})=>`mbn-item${isActive?' active':''}`}>
        <span className="mbn-icon">📍</span>
        {counts.visits > 0 && <span className="mbn-badge">{counts.visits}</span>}
        <span className="mbn-label">Visits</span>
      </NavLink>
    </nav>
  );
}

const TOKEN_KEY = 'fleet_crm_token';
const USER_KEY  = 'fleet_crm_user';

export default function App() {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState(null);
  const [counts, setCounts]   = useState({ calling: 0, mail: 0, email: 0, visits: 0 });
  const [mobileOpen, setMobileOpen] = useState(false);
  
  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  async function refreshCounts() {
    try {
      const counts = await api.pipelineCounts();
      setCounts(counts);
    } catch (_) {}
  }

  // ── Restore session from localStorage on page load ──────────────────────────
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser  = localStorage.getItem(USER_KEY);

    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        // Verify the token is still valid against the server
        api.me()
          .then(u => {
            setUser(u);
            // Update stored user in case name/role changed
            localStorage.setItem(USER_KEY, JSON.stringify(u));
            refreshCounts();
          })
          .catch(() => {
            // Token expired or invalid — clear everything
            clearToken();
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
          })
          .finally(() => setLoading(false));
      } catch (_) {
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, []);

  async function login(email, password) {
    const data = await api.login(email, password);
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    await refreshCounts();
  }

  function logout() {
    clearToken();
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  if (loading) return null;

  const ctx = { user, login, logout, showToast, refreshCounts, counts };

  return (
    <AppCtx.Provider value={ctx}>
      <BrowserRouter>
        {!user ? (
          <Routes>
            <Route path="/script-popup" element={<ScriptPopup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="*" element={<Login />} />
          </Routes>
        ) : (
          <div className="app-layout">
           <div className="mobile-topbar">
             <div style={{ fontWeight:700, fontSize:15, color:'white', letterSpacing:'.01em' }}>🦅 Fleet CRM</div>
             <div style={{ display:'flex', gap:4 }}>
               <NavLink to="/companies" className="mbn-topbar-btn"
                 onClick={() => window.dispatchEvent(new CustomEvent('companies-reset'))}>🏢</NavLink>
               <NavLink to="/settings"  className="mbn-topbar-btn">⚙️</NavLink>
             </div>
           </div>
           <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
           {mobileOpen && <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />}
           <MobileBottomNav counts={counts} />
           <div className="main-content">
              <Routes>
                <Route path="/"             element={<Navigate to="/dashboard" />} />
                <Route path="/dashboard"    element={<Dashboard />} />
                <Route path="/calling"      element={<CallingQueue />} />
                <Route path="/mail-queue"   element={<MailQueue />} />
                <Route path="/email-queue"  element={<EmailQueue />} />
                <Route path="/visit-queue"  element={<VisitQueue />} />
                <Route path="/companies"     element={<Companies />} />
                <Route path="/fleet-finder" element={<FleetFinder />} />
                <Route path="/quicklog"     element={<QuickLog />} />
                <Route path="/settings"     element={<Settings />} />
                <Route path="/script-popup" element={<ScriptPopup />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="*" element={<Navigate to="/dashboard" />} />
                {/* Legacy redirects */}
                <Route path="/followups"       element={<Navigate to="/calling" />} />
                <Route path="/company-calling" element={<Navigate to="/calling" />} />
                <Route path="/route-planner"   element={<Navigate to="/visit-queue" />} />
                <Route path="*"             element={<Navigate to="/dashboard" />} />
              </Routes>
            </div>
          </div>
        )}
      </BrowserRouter>

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✅' : '❌'} {toast.msg}
        </div>
      )}
    </AppCtx.Provider>
  );
}
