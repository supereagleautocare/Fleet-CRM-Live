import { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import ActiveFleet from './pages/ActiveFleet.jsx';
import ResetPassword from './pages/ResetPassword.jsx';

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

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
             <div className="mobile-menu-btn" onClick={() => setMobileOpen(!mobileOpen)}>
              ☰
            </div>
            <div>Fleet CRM</div>
           </div>
           <Sidebar mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} />
           {mobileOpen && <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} />}
           <div className="main-content">
              <Routes>
                <Route path="/"             element={<Navigate to="/dashboard" />} />
                <Route path="/active-fleet" element={<ActiveFleet />} />
                <Route path="/dashboard"    element={<Dashboard />} />
                <Route path="/calling"      element={<CallingQueue />} />
                <Route path="/mail-queue"   element={<MailQueue />} />
                <Route path="/email-queue"  element={<EmailQueue />} />
                <Route path="/visit-queue"  element={<VisitQueue />} />
                <Route path="/companies"    element={<Companies />} />
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
