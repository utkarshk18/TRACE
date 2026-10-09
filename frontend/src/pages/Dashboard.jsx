import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { Disclaimer, ResultBadge } from "../components/ui.jsx";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([api("/system/dashboard"), api("/system/health")])
      .then(([d, h]) => {
        setData(d);
        setHealth(h);
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 240 }} />;

  const o = data.overview;
  const max = Math.max(...data.charts.last7.map((d) => d.count), 1);

  return (
    <>
      <h1>Command dashboard</h1>
      <p className="lede">Today’s field activity, integrity posture, and system readiness.</p>
      <div className="grid-12">
        {[
          ["Tests conducted", o.testsConducted],
          ["Positive", o.positive],
          ["Negative", o.negative],
          ["Inconclusive", o.inconclusive],
          ["Pending sync", o.pendingSync],
          ["Evidence records", o.evidenceRecords],
        ].map(([label, value]) => (
          <div className="card span-4 stat" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
        <section className="card span-8">
          <h2>Tests over time</h2>
          <div className="bar-chart" aria-label="Tests last 7 days">
            {data.charts.last7.map((d) => (
              <i key={d.date} style={{ height: `${(d.count / max) * 100}%` }} title={`${d.date}: ${d.count}`} />
            ))}
          </div>
        </section>
        <section className="card span-4">
          <h2>Result distribution</h2>
          <div className="dist" aria-hidden="true">
            {(() => {
              const d = data.charts.distribution;
              const t = Math.max(1, (d.POSITIVE || 0) + (d.NEGATIVE || 0) + (d.INCONCLUSIVE || 0));
              return (
                <>
                  <span style={{ width: `${((d.POSITIVE || 0) / t) * 100}%`, background: "var(--positive)" }} />
                  <span style={{ width: `${((d.NEGATIVE || 0) / t) * 100}%`, background: "var(--negative)" }} />
                  <span style={{ width: `${((d.INCONCLUSIVE || 0) / t) * 100}%`, background: "var(--inconclusive)" }} />
                </>
              );
            })()}
          </div>
          <p className="lede" style={{ marginTop: 12 }}>
            Positive {data.charts.distribution.POSITIVE} · Negative {data.charts.distribution.NEGATIVE} · Inconclusive {data.charts.distribution.INCONCLUSIVE}
          </p>
        </section>
        <section className="card span-8">
          <h2>Recent tests</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evidence ID</th>
                  <th>Test type</th>
                  <th>Result</th>
                  <th>Confidence</th>
                  <th>Officer</th>
                  <th>Timestamp</th>
                  <th>Location</th>
                  <th>Integrity</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((r) => (
                  <tr key={r.evidenceId} style={{ cursor: "pointer" }} onClick={() => navigate(`/evidence/${r.evidenceId}`)}>
                    <td className="mono">{r.evidenceId}</td>
                    <td>{r.testType}</td>
                    <td><ResultBadge result={r.result} /></td>
                    <td className="mono">{(r.confidence * 100).toFixed(1)}%</td>
                    <td>{r.officer}</td>
                    <td className="mono">{new Date(r.timestamp).toLocaleString()}</td>
                    <td>{r.location}</td>
                    <td><span className="badge ok">{r.integrity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card span-4">
          <h2>System health</h2>
          {health && (
            <div className="quality-list">
              <div><span>Camera</span><span>{health.camera}</span></div>
              <div><span>AI model</span><span className="mono">{health.aiModel}</span></div>
              <div><span>Database</span><span>{health.database}</span></div>
              <div><span>Offline storage</span><span>{health.offlineStorage}</span></div>
              <div><span>Sync</span><span>{health.syncStatus}</span></div>
            </div>
          )}
          <h2 style={{ marginTop: 20 }}>Quick actions</h2>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={() => navigate("/test/new")}>Start new test</button>
            <button className="btn" onClick={() => navigate("/evidence")}>Evidence vault</button>
            <button className="btn" onClick={() => navigate("/verify")}>Verify evidence</button>
            <button className="btn" onClick={() => navigate("/audit")}>Audit trail</button>
          </div>
        </section>
      </div>
      <Disclaimer />
    </>
  );
}
