import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';

export default function Sidebar({ mobileOpen = false, setMobileOpen = () => {} }) {
  const { user, logout, counts } = useApp();
  const navigate = useNavigate();

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?';

  return (
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="sidebar-logo">
        <div className="eagle">🦅</div>
        <div className="brand">Super Eagle</div>
        <div className="sub">Fleet CRM</div>
      </div>

      <div className="sidebar-section-label">Overview</div>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">📊</span> Pipeline
        </NavLink>
      </nav>

      <div className="sidebar-section-label">Queues</div>
      <nav className="sidebar-nav">
        <NavLink to="/calling" onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">📞</span> Calling
          {counts.calling > 0 && <span className="nav-badge">{counts.calling}</span>}
        </NavLink>
        <NavLink to="/mail-queue" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">✉️</span> Mail
          {counts.mail > 0 && <span className="nav-badge">{counts.mail}</span>}
        </NavLink>
        <NavLink to="/email-queue" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">📧</span> Email
          {counts.email > 0 && <span className="nav-badge">{counts.email}</span>}
        </NavLink>
        <NavLink to="/visit-queue" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">📍</span> Visits
          {counts.visits > 0 && <span className="nav-badge">{counts.visits}</span>}
        </NavLink>
        <NavLink to="/quicklog" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">⚡</span> Quick Log
        </NavLink>
      </nav>

      <div className="sidebar-section-label">Database</div>
      <nav className="sidebar-nav">
        <NavLink to="/companies" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          onClick={() => window.dispatchEvent(new CustomEvent('companies-reset'))}>
          <span className="icon">🏢</span> Companies
        </NavLink>
        <NavLink to="/fleet-finder" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">🔍</span> Find Companies
        </NavLink>
      </nav>

      <div className="sidebar-section-label">System</div>
      <nav className="sidebar-nav">
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">⚙️</span> Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        {user?.role === 'admin' && (
          <a href="/admin" target="_blank" rel="noreferrer"
            style={{ display: 'block', textAlign: 'center', fontSize: 10, color: 'var(--gray-500)',
              textDecoration: 'none', marginBottom: 8, letterSpacing: '.06em' }}>
            ⚙ PLATFORM ADMIN
          </a>
        )}
        <div className="sidebar-user" onClick={() => { logout(); navigate('/'); }} title="Click to log out">
          <div className="user-avatar">{initials}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--gray-200)' }}>{user?.name}</div>
            <div style={{ fontSize: 10, color: 'var(--gray-500)', marginTop: 1 }}>Log out</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
