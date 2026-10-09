import { useAuth } from "../auth.jsx";

export function RoleGate({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user?.role)) {
    return (
      <div className="error-box">
        <h1>Permission denied</h1>
        <p>Your role does not include this workspace.</p>
      </div>
    );
  }
  return children;
}
