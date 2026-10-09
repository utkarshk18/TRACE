import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("officer@trace.demo");
  const [password, setPassword] = useState("TraceDemo!2026");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="kicker">TRACE ACCESS</div>
        <h1 style={{ fontSize: 28, margin: "8px 0 6px" }}>Sign in</h1>
        <p className="lede">Restricted workspace for field documentation and evidence review.</p>
        {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary" disabled={loading} type="submit">
          {loading ? "Authenticating…" : "Enter TRACE"}
        </button>
        <p className="lede" style={{ marginTop: 18, marginBottom: 0 }}>
          Demo accounts: officer@trace.demo, supervisor@trace.demo, admin@trace.demo — password TraceDemo!2026
        </p>
        <p><Link to="/">Back to overview</Link></p>
      </form>
    </div>
  );
}
