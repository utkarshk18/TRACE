import { Link } from "react-router-dom";
import { Disclaimer } from "../components/ui.jsx";

const stages = [
  { n: "01", t: "CAPTURE", d: "Guided photograph of the kit reaction and reference colour card." },
  { n: "02", t: "CALIBRATE", d: "CIELAB conversion with lighting compensation against the card." },
  { n: "03", t: "ANALYZE", d: "Uncertainty-aware classification: positive, negative, or inconclusive." },
  { n: "04", t: "SECURE", d: "SHA-256 hash and Ed25519 signature bound to the evidence package." },
  { n: "05", t: "VERIFY", d: "Independent check of hash, signature, timestamp, and record status." },
];

export default function Landing() {
  return (
    <div className="landing">
      <div className="kicker">TRACE</div>
      <h1>Turn field test reactions into verifiable digital evidence.</h1>
      <p className="lede">
        AI-assisted colorimetric evaluation for faster, more consistent, tamper-evident field documentation.
        TRACE does not replace the chemical kit — it records, calibrates, and protects what the kit already shows.
      </p>
      <div className="btn-row">
        <Link className="btn btn-primary" to="/login">Start Demo</Link>
        <Link className="btn" to="/login">Explore Evidence Verification</Link>
      </div>
      <div className="flow" aria-label="Workflow">
        <div className="flow-node">FIELD TEST</div>
        <div>↓</div>
        <div className="flow-node">AI ANALYSIS</div>
        <div>↓</div>
        <div className="flow-node">VERIFIED EVIDENCE</div>
      </div>
      <div className="grid-12">
        <section className="card span-6">
          <h2>The problem</h2>
          <p>Colour reading in the field is subjective. Lighting, fatigue, and undocumented photos weaken later review. Kits remain essential; the record around them is not.</p>
        </section>
        <section className="card span-6">
          <h2>Why TRACE?</h2>
          <p>No new hardware + computer vision + uncertainty-aware AI + cryptographic evidence + offline-first workflow.</p>
        </section>
        <section className="card span-12">
          <h2>How TRACE works</h2>
          <div className="grid-12">
            {stages.map((s) => (
              <div key={s.n} className="span-3" style={{ gridColumn: "span 2" }}>
                <div className="mono" style={{ color: "var(--accent)" }}>{s.n}</div>
                <strong>{s.t}</strong>
                <p className="lede" style={{ marginBottom: 0 }}>{s.d}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="card span-4">
          <h2>Technology</h2>
          <p>CIELAB comparison, quality gates, and a modular vision pipeline. Inconclusive is a first-class result — TRACE will not invent certainty.</p>
        </section>
        <section className="card span-4">
          <h2>Evidence integrity</h2>
          <p>Every finalized record is hashed (SHA-256) and signed (Ed25519). QR codes carry a verification token, not the raw case file.</p>
        </section>
        <section className="card span-4">
          <h2>Offline field operation</h2>
          <p>IndexedDB queue and service worker keep captures on-device until the network returns. Pending sync is visible on the command board.</p>
        </section>
      </div>
      <Disclaimer />
    </div>
  );
}
