import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";
import { useAuth } from "../auth.jsx";
import { Disclaimer, Modal, ResultBadge } from "../components/ui.jsx";

export default function EvidenceDetail() {
  const { user } = useAuth();
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [qr, setQr] = useState(false);
  const [verify, setVerify] = useState(null);
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    api(`/evidence/${id}`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  const report = useMemo(() => {
    if (!data) return "";
    const e = data.evidence;
    return [
      "TRACE Digital Evidence Report",
      e.simulated ? "SIMULATED / DEMONSTRATION RECORD" : "FIELD RECORD (presumptive)",
      `Evidence ID: ${e.evidenceId}`,
      `Test profile: ${e.profile?.name} v${e.profile?.version}`,
      `Result: ${e.result}`,
      `Confidence: ${(e.confidence * 100).toFixed(1)}%`,
      `Timestamp: ${e.createdAt}`,
      `Location: ${e.location?.label}`,
      `Operator: ${e.operatorName}`,
      `Analysis: ${e.analysis?.analysisBasis}`,
      `SHA-256: ${e.hash}`,
      `Ed25519: ${e.signature}`,
      `Verification: ${e.integrityStatus}`,
      "",
      "Audit timeline",
      ...data.audit.map((a) => `${a.timestamp}  ${a.action}  (${a.actor})`),
    ].join("\n");
  }, [data]);

  useEffect(() => {
    if (params.get("export") === "1" && report) {
      download(report, id);
    }
  }, [params, report, id]);

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const e = data.evidence;

  async function runVerify() {
    const v = await api(`/evidence/${e.evidenceId}/verify`, { method: "POST" });
    setVerify(v);
  }

  async function countersign() {
    setError("");
    setSigning(true);
    try {
      const res = await api(`/evidence/${e.evidenceId}/sign`, { method: "POST" });
      setData((prev) => ({
        ...prev,
        evidence: res.evidence,
        audit: [
          ...prev.audit,
          {
            timestamp: new Date().toISOString(),
            action: "Supervisor countersignature recorded",
            actor: user?.name || "Supervisor",
          },
        ],
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSigning(false);
    }
  }

  return (
    <>
      <h1>Evidence report</h1>
      <p className="mono">{e.evidenceId}</p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
        {e.simulated && <span className="badge demo">SIMULATED / DEMONSTRATION RECORD</span>}
        {e.countersigned && (
          <span className="badge ok">
            ✓ COUNTERSIGNED by {e.countersignedBy} ({new Date(e.countersignedAt).toLocaleDateString()})
          </span>
        )}
      </div>
      <div className="grid-12" style={{ marginTop: 16 }}>
        <section className="card span-6">
          <h2>Overview</h2>
          <p><ResultBadge result={e.result} /> · {(e.confidence * 100).toFixed(1)}% confidence</p>
          <p>{e.analysis?.analysisBasis}</p>
        </section>
        <section className="card span-6">
          <h2>Test image</h2>
          {e.originalImage ? <img alt="Captured test" src={e.originalImage} /> : <p className="lede">No still stored for this seed record. Capture a new demo test to attach a frame.</p>}
        </section>
        <section className="card span-6">
          <h2>Analysis</h2>
          {e.analysis?.decisionBasis?.map((d) => (
            <div key={d.label} className="quality-list"><div><span>{d.label}</span><span className="mono">{d.value}%</span></div></div>
          ))}
        </section>
        <section className="card span-6">
          <h2>Evidence integrity</h2>
          <p>SHA-256</p>
          <div className="hash-box">{e.hash}</div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => navigator.clipboard.writeText(e.hash)}>Copy hash</button>
          <p style={{ marginTop: 12 }}>Ed25519 signature · {verify ? "VALID ✓" : e.integrityStatus}</p>
          <div className="hash-box">{e.signature}</div>
        </section>
        <section className="card span-6">
          <h2>Location</h2>
          <p>{e.location?.label}</p>
          <p className="mono">{e.location?.lat}, {e.location?.lng}</p>
        </section>
        <section className="card span-6">
          <h2>Operator & custody</h2>
          <p>{e.operatorName}</p>
          <p className="mono">{e.device}</p>
          {e.countersigned ? (
            <p className="lede" style={{ marginTop: 8 }}>
              Supervisor endorsement: <strong>{e.countersignedBy}</strong> on {new Date(e.countersignedAt).toLocaleString()}
            </p>
          ) : (
            <p className="lede" style={{ marginTop: 8 }}>Awaiting supervisor countersignature review.</p>
          )}
        </section>
        <section className="card span-12">
          <h2>Audit timeline</h2>
          <div className="timeline">
            {data.audit.map((a) => (
              <div className="tl-item" key={a.timestamp + a.action}>
                <time>{new Date(a.timestamp).toLocaleTimeString()}</time>
                <i />
                <div className="tl-body">
                  <strong>{a.action}</strong>
                  <span className="lede">{a.actor}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card span-12">
          <h2>Verification & export</h2>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={runVerify}>Verify record</button>
            {(user?.role === "SUPERVISOR" || user?.role === "ADMIN") && !e.countersigned && (
              <button className="btn btn-primary" disabled={signing} onClick={countersign}>
                {signing ? "Countersigning…" : "Countersign record"}
              </button>
            )}
            <button className="btn" onClick={() => setQr(true)}>QR</button>
            <button className="btn" onClick={() => download(report, e.evidenceId)}>Export report</button>
            <button className="btn" onClick={() => navigate("/verify")}>Open verify desk</button>
          </div>
          {verify && (
            <div className={verify.verified ? "card" : "error-box"} style={{ marginTop: 16 }}>
              <strong>{verify.headline}</strong>
              <p>Integrity {verify.integrity} · Signature {verify.signature} · Timestamp {verify.timestamp} · Record {verify.recordStatus}</p>
            </div>
          )}
        </section>
      </div>
      {qr && (
        <Modal title="Verification QR" onClose={() => setQr(false)}>
          <div style={{ background: "#fff", padding: 12, width: "fit-content" }}>
            <QRCodeSVG value={e.verificationToken} size={180} />
          </div>
        </Modal>
      )}
      <Disclaimer />
    </>
  );
}

function download(text, id) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${id}-TRACE-report.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
