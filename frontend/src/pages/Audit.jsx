import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function AuditPage() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api("/audit").then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  }, []);
  if (error) return <div className="error-box">{error}</div>;
  return (
    <>
      <h1>Audit trail</h1>
      <p className="lede">Every capture, hash, signature, and verification is append-only.</p>
      <div className="card">
        <div className="timeline">
          {events.map((a) => (
            <div className="tl-item" key={a._id || a.timestamp + a.action}>
              <time>{new Date(a.timestamp).toLocaleTimeString()}</time>
              <i />
              <div className="tl-body">
                <strong>{a.action}</strong>
                <span className="mono">{a.evidenceId}</span>
                <span className="lede">{a.actor}</span>
              </div>
            </div>
          ))}
        </div>
        {!events.length && <div className="empty">No audit events yet.</div>}
      </div>
    </>
  );
}
