import { NavLink, useNavigate } from 'react-router-dom';
import { useApp } from '../App.jsx';

export default function Sidebar() {
  const { user, logout, counts } = useApp();
  const navigate = useNavigate();

  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '?';

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="eagle">🦅</div>
        <div className="brand">Super Eagle</div>
        <div className="sub">Fleet CRM</div>
      </div>

      <div className="sidebar-section-label">Shop</div>
      <nav className="sidebar-nav">
        <NavLink to="/active-fleet" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">🚛</span> Active Fleet
        </NavLink>
      </nav>
      <div className="sidebar-section-label">Overview</div>
      <nav className="sidebar-nav">
        <NavLink to="/dashboard" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">📊</span> Pipeline
        </NavLink>
      </nav>

      <div className="sidebar-section-label">Queues</div>
      <nav className="sidebar-nav">
        <NavLink to="/calling" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
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
        <NavLink to="/starred" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">⭐</span> Starred
        </NavLink>
        <NavLink to="/companies" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">🏢</span> Companies
        </NavLink>
      </nav>

      <div className="sidebar-section-label">System</div>
      <nav className="sidebar-nav">
        <NavLink to="/settings" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
          <span className="icon">⚙️</span> Settings
        </NavLink>
      </nav>

      <div className="sidebar-footer">
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
