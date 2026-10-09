import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";
import { getAllCachedEvidence } from "../offline.js";
import { Modal, ResultBadge } from "../components/ui.jsx";

export default function EvidenceVault() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [result, setResult] = useState("ALL");
  const [officer, setOfficer] = useState("");
  const [location, setLocation] = useState("");
  const [integrity, setIntegrity] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState("");

  async function load(p = page) {
    const params = new URLSearchParams({
      q, result, officer, location, integrity, sort, dir: "desc", page: String(p), pageSize: "8",
    });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const d = await api(`/evidence?${params}`);
      const cached = await getAllCachedEvidence();
      const existingIds = new Set(d.records.map((r) => r.evidenceId));
      const unmerged = cached.filter((c) => !existingIds.has(c.evidenceId));
      setData({
        ...d,
        records: [...unmerged, ...d.records],
        total: d.total + unmerged.length,
      });
    } catch (e) {
      // Offline fallback: load cached records from IndexedDB
      const cached = await getAllCachedEvidence();
      if (cached.length) {
        setData({
          page: 1,
          pageSize: 20,
          total: cached.length,
          records: cached,
        });
      } else {
        setError(e.message);
      }
    }
  }

  function exportCSV() {
    if (!data?.records?.length) return;
    const headers = ["Evidence ID", "Result", "Confidence", "Officer", "Location", "Timestamp", "Integrity", "Countersigned", "SHA256 Hash"];
    const rows = data.records.map((r) => [
      `"${r.evidenceId}"`,
      `"${r.result}"`,
      `"${(r.confidence * 100).toFixed(1)}%"`,
      `"${r.operatorName || ''}"`,
      `"${r.location?.label || ''}"`,
      `"${r.createdAt}"`,
      `"${r.integrityStatus}"`,
      `"${r.countersigned ? 'YES (' + (r.countersignedBy || '') + ')' : 'NO'}"`,
      `"${r.hash || ''}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TRACE-Evidence-Export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    if (!data?.records?.length) return;
    const jsonStr = JSON.stringify(data.records, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `TRACE-Evidence-Export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    load(1).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>Evidence vault</h1>
      <p className="lede">Search, filter, and export digital field records. Demo rows are marked simulated.</p>
      {error && <div className="error-box">{error}</div>}
      <div className="filters">
        <input className="input" placeholder="Search ID, officer, location" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={result} onChange={(e) => setResult(e.target.value)}>
          <option value="ALL">All results</option>
          <option>POSITIVE</option>
          <option>NEGATIVE</option>
          <option>INCONCLUSIVE</option>
        </select>
        <input className="input" placeholder="Officer" value={officer} onChange={(e) => setOfficer(e.target.value)} />
        <input className="input" placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
        <select value={integrity} onChange={(e) => setIntegrity(e.target.value)}>
          <option value="ALL">Integrity</option>
          <option>INTACT</option>
          <option>TAMPERED</option>
        </select>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="createdAt">Timestamp</option>
          <option value="confidence">Confidence</option>
          <option value="evidenceId">Evidence ID</option>
        </select>
        <button className="btn btn-primary" onClick={() => { setPage(1); load(1); }}>Apply</button>
        <button className="btn" disabled={!data?.records?.length} onClick={exportCSV}>Export CSV</button>
        <button className="btn" disabled={!data?.records?.length} onClick={exportJSON}>Export JSON</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Evidence ID</th>
              <th>Result</th>
              <th>Confidence</th>
              <th>Officer</th>
              <th>Location</th>
              <th>Timestamp</th>
              <th>Integrity & Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.records?.length ? data.records.map((r) => (
              <tr key={r.evidenceId}>
                <td className="mono">
                  {r.evidenceId}
                  {r.simulated && <div className="badge demo">Demo</div>}
                  {r.syncStatus === "pending" && <div className="badge" style={{ background: "var(--amber, #f59e0b)", color: "#000" }}>Pending Sync</div>}
                </td>
                <td><ResultBadge result={r.result} /></td>
                <td className="mono">{(r.confidence * 100).toFixed(1)}%</td>
                <td>{r.operatorName}</td>
                <td>{r.location?.label}</td>
                <td className="mono">{new Date(r.createdAt).toLocaleString()}</td>
                <td>
                  <span className="badge ok">{r.integrityStatus}</span>
                  {r.countersigned && (
                    <div className="badge ok" style={{ marginTop: 4 }} title={`Countersigned by ${r.countersignedBy}`}>
                      ✓ Countersigned
                    </div>
                  )}
                </td>
                <td>
                  <div className="btn-row">
                    <button className="btn" onClick={() => navigate(`/evidence/${r.evidenceId}`)}>View</button>
                    <button className="btn" onClick={() => navigate(`/verify?id=${r.evidenceId}`)}>Verify</button>
                    <button className="btn" onClick={() => setQr(r)}>QR</button>
                    <button className="btn" onClick={() => navigate(`/evidence/${r.evidenceId}?export=1`)}>Export</button>
                  </div>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={8}><div className="empty">No evidence matches these filters.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn" disabled={page <= 1} onClick={() => { const p = page - 1; setPage(p); load(p); }}>Previous</button>
          <span className="mono">Page {data.page} · {data.total} records</span>
          <button className="btn" disabled={page * data.pageSize >= data.total} onClick={() => { const p = page + 1; setPage(p); load(p); }}>Next</button>
        </div>
      )}
      {qr && (
        <Modal title={`QR · ${qr.evidenceId}`} onClose={() => setQr(null)}>
          <div style={{ background: "#fff", padding: 12, width: "fit-content" }}>
            <QRCodeSVG value={qr.verificationToken} size={180} />
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={() => navigate(`/evidence/${qr.evidenceId}`)}>View evidence</button>
            <button className="btn" onClick={() => navigate(`/verify?token=${qr.verificationToken}`)}>Verify record</button>
          </div>
        </Modal>
      )}
    </>
  );
}
