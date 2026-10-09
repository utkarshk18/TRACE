import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

const links = [
  { to: "/dashboard", label: "Command" },
  { to: "/test/new", label: "New test" },
  { to: "/evidence", label: "Evidence vault" },
  { to: "/verify", label: "Verify" },
  { to: "/audit", label: "Audit trail" },
  { to: "/profiles", label: "Test profiles", roles: ["SUPERVISOR", "ADMIN"] },
  { to: "/admin", label: "Administration", roles: ["ADMIN"] },
];

export function Shell({ children, online, pending, banner }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <strong>TRACE</strong>
          <span>Colorimetric evidence platform</span>
        </div>
        <div>
          <div className="nav-kicker">Operations</div>
          <nav className="nav-group">
            {links
              .filter((l) => !l.roles || l.roles.includes(user?.role))
              .map((l) => (
                <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
                  {l.label}
                </NavLink>
              ))}
          </nav>
        </div>
        <div className="sidebar-foot">
          <div>{user?.name}</div>
          <div className="mono" style={{ marginTop: 4 }}>
            {user?.role?.replace("_", " ")}
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 10, width: "100%" }}
            onClick={() => {
              logout();
              navigate("/");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        {!online && (
          <div className="offline-banner" role="status">
            OFFLINE MODE — All evidence is being stored securely on this device.
            {pending ? ` ${pending} records pending synchronization.` : ""}
          </div>
        )}
        {online && banner && (
          <div className="offline-banner" role="status">
            {banner}
          </div>
        )}
        <header className="topbar">
          <div className="badge">{online ? "Network linked" : "Field offline"}</div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => navigate("/test/new")}>
              Start new test
            </button>
            <button className="btn" onClick={() => navigate("/verify")}>
              Verify evidence
            </button>
          </div>
        </header>
        <div className="page">{children}</div>
      </div>
    </div>
  );
}

export function ResultBadge({ result }) {
  const cls = result?.toLowerCase() || "";
  return (
    <span className={`badge ${cls}`}>
      <span aria-hidden="true">●</span>
      {result}
    </span>
  );
}

export function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-back" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function Disclaimer() {
  return (
    <p className="disclaimer">
      TRACE supports presumptive field-test interpretation and evidence documentation. Confirmatory laboratory
      analysis remains authoritative.
    </p>
  );
}
