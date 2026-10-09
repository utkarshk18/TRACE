import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export function Protected({ roles }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="page">Loading session…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="page">
        <div className="error-box">
          <h1>Permission denied</h1>
          <p>Your role does not include this workspace.</p>
        </div>
      </div>
    );
  }
  return <Outlet />;
}
