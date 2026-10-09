import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { ResultBadge } from "../components/ui.jsx";

export default function VerifyPage() {
  const [params] = useSearchParams();
  const [evidenceId, setEvidenceId] = useState(params.get("id") || "");
  const [token, setToken] = useState(params.get("token") || "");
  const [pkg, setPkg] = useState("");
  const [out, setOut] = useState(null);
  const [error, setError] = useState("");

  async function run(body) {
    setError("");
    setOut(null);
    try {
      const data = await api("/verify", { method: "POST", body: JSON.stringify(body) });
      setOut(data);
    } catch (e) {
      setOut(e.body || { headline: "INTEGRITY WARNING", message: e.message, verified: false });
    }
  }

  function verifyPackage() {
    setError("");
    if (!pkg.trim()) {
      setError("Please enter or upload an evidence package JSON.");
      return;
    }
    try {
      const parsed = JSON.parse(pkg);
      run({ package: parsed });
    } catch {
      setError("The package content is not valid JSON.");
    }
  }

  function loadTamperedSample() {
    const tampered = {
      evidenceId: "TRC-2026-10-03-4D19C2",
      result: "POSITIVE",
      confidence: 0.999,
      createdAt: "2026-10-03T08:00:00.000Z",
      operatorId: "6ac0bcdf584ea1780cd4fd3f",
      profileSlug: "field-test-b",
      analysisVersion: "trace-vision-1.0-demo",
      hash: "d41d8cd98f00b204e9800998ecf8427e",
    };
    setPkg(JSON.stringify(tampered, null, 2));
    setError("Loaded simulated tampered payload. Click 'Verify package' to observe cryptographic detection.");
  }

  function onFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result);
        setPkg(JSON.stringify(json, null, 2));
        run({ package: json });
      } catch {
        setError("The uploaded file is not a valid evidence package JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <>
      <h1>Evidence verification</h1>
      <p className="lede">Confirm hash, Ed25519 signature, and record status. TRACE never reports verified unless checks succeed.</p>
      <div className="grid-12">
        <section className="card span-4">
          <h2>Option 1 · Evidence ID</h2>
          <input className="input" value={evidenceId} onChange={(e) => setEvidenceId(e.target.value)} placeholder="TRC-2026-10-03-8F42A1" />
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => run({ evidenceId })}>Verify ID</button>
        </section>
        <section className="card span-4">
          <h2>Option 2 · QR token</h2>
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste token from QR" />
          <button className="btn" style={{ marginTop: 10 }} onClick={() => run({ verificationToken: token })}>Verify token</button>
        </section>
        <section className="card span-4">
          <h2>Option 3 · Upload package</h2>
          <textarea className="input" rows={5} value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder='{"evidenceId":"..."}' />
          <input type="file" accept="application/json" onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" onClick={verifyPackage}>Verify package</button>
            <button className="btn" onClick={loadTamperedSample}>Simulate Tamper</button>
          </div>
        </section>
      </div>
      {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}
      {out && (
        <section className={out.verified ? "card" : "error-box"} style={{ marginTop: 16 }}>
          <h2>{out.headline}</h2>
          {out.verified ? (
            <>
              <p>Evidence ID <span className="mono">{out.evidenceId}</span></p>
              <p>Integrity {out.integrity}</p>
              <p>Signature {out.signature}</p>
              <p>Timestamp {out.timestamp}</p>
              <p>Record status {out.recordStatus}</p>
              {out.evidence && <p><ResultBadge result={out.evidence.result} /></p>}
            </>
          ) : (
            <p>{out.message}</p>
          )}
        </section>
      )}
    </>
  );
}
