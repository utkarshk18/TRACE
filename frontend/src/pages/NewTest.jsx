import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";
import { queueEvidence, cacheProfiles, getCachedProfiles, sha256HexWeb, DEFAULT_PROFILES } from "../offline.js";
import { Disclaimer, Modal, ResultBadge } from "../components/ui.jsx";

const SCENARIOS = [
  { id: "positive", label: "Scenario 1 — Positive" },
  { id: "negative", label: "Scenario 2 — Negative" },
  { id: "inconclusive", label: "Scenario 3 — Inconclusive" },
  { id: "poor-capture", label: "Poor capture (quality reject)" },
];

export default function NewTest() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [profiles, setProfiles] = useState([]);
  const [profileSlug, setProfileSlug] = useState("field-test-a");
  const [scenario, setScenario] = useState("positive");
  const [test, setTest] = useState(null);
  const [quality, setQuality] = useState(null);
  const [phase, setPhase] = useState("setup");
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    api("/profiles")
      .then((d) => {
        setProfiles(d.profiles);
        cacheProfiles(d.profiles);
      })
      .catch(async () => {
        const cached = await getCachedProfiles();
        setProfiles(cached);
      });
  }, []);

  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("TRACE could not access the camera. Check browser permissions and try again.");
    }
  }

  useEffect(() => {
    if (phase === "capture") startCamera();
    return () => {
      const stream = videoRef.current?.srcObject;
      stream?.getTracks?.().forEach((t) => t.stop());
    };
  }, [phase]);

  async function begin() {
    setError("");
    if (!navigator.onLine) {
      const offlineTestId = `TST-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      setTest({
        testId: offlineTestId,
        profileSlug,
        status: "CAPTURE_PENDING",
        location: { label: "Offline Field Site (Queued locally)", lat: 19.076, lng: 72.8777 },
        deviceId: "TRC-OFFLINE-DEVICE",
        demoScenario: scenario,
        offline: true,
        createdAt: new Date().toISOString(),
      });
      setPhase("capture");
      return;
    }
    try {
      const created = await api("/tests", {
        method: "POST",
        body: JSON.stringify({
          profileSlug,
          demoScenario: scenario,
          locationLabel: "Harbor Checkpoint, Sector 4 (synthetic demo)",
          offline: false,
        }),
      });
      setTest(created.test);
      setPhase("capture");
    } catch (e) {
      setError(e.message);
    }
  }

  function snap() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video?.videoWidth || 960;
    canvas.height = video?.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (video?.srcObject) ctx.drawImage(video, 0, 0);
    else {
      ctx.fillStyle = scenario === "positive" ? "#8a3b3b" : scenario === "negative" ? "#d9d2c3" : "#9a7a55";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#eee";
      ctx.fillRect(40, 40, 120, 80);
    }
    setPreview(canvas.toDataURL("image/jpeg", 0.85));
  }

  async function submitCapture({ fail } = {}) {
    if (!test) return;
    setError("");
    if (!navigator.onLine) {
      const failQuality = scenario === "poor-capture" || fail;
      const q = failQuality
        ? {
            resolution: "Insufficient",
            focus: "Soft",
            lighting: "Uneven",
            referenceCard: "Partial",
            testRegion: "Detected",
            accepted: false,
            issues: [
              "Reference colour card is partially outside the detection region.",
              "Please reposition the test and capture again.",
            ],
            scores: { resolution: 0.42, focus: 0.51, lighting: 0.48, referenceCard: 0.31, testRegion: 0.74 },
          }
        : {
            resolution: "Optimal",
            focus: "Sharp",
            lighting: "Acceptable",
            referenceCard: "Detected",
            testRegion: "Detected",
            accepted: true,
            issues: [],
            scores: { resolution: 0.96, focus: 0.94, lighting: 0.91, referenceCard: 0.97, testRegion: 0.95 },
          };
      setQuality(q);
      if (!q.accepted) {
        setPhase("rejected");
        return;
      }
      setPhase("quality");
      return;
    }

    try {
      const form = new FormData();
      form.append("demoScenario", fail ? "poor-capture" : scenario);
      if (fail) form.append("failQuality", "true");
      if (preview) {
        const blob = await (await fetch(preview)).blob();
        form.append("image", blob, "capture.jpg");
      }
      const data = await api(`/tests/${test.testId}/capture`, { method: "POST", body: form });
      setQuality(data.quality);
      if (!data.accepted) {
        setPhase("rejected");
        return;
      }
      setPhase("quality");
    } catch (e) {
      setError(e.message);
    }
  }

  async function analyze() {
    setError("");
    setPhase("calibrate");
    await new Promise((r) => setTimeout(r, 700));
    setPhase("analyze");
    const stages = 8;
    for (let i = 0; i < stages; i += 1) {
      setStageIdx(i);
      await new Promise((r) => setTimeout(r, 180));
    }

    if (!navigator.onLine) {
      const activeProf = profiles.find((p) => p.slug === profileSlug) || profiles[0] || DEFAULT_PROFILES[0];
      const now = new Date().toISOString();
      const evId = `TRC-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      const resVal = scenario === "positive" ? "POSITIVE" : scenario === "negative" ? "NEGATIVE" : "INCONCLUSIVE";
      const confVal = resVal === "POSITIVE" ? 0.942 : resVal === "NEGATIVE" ? 0.915 : 0.612;
      const analysisObj = {
        result: resVal,
        confidence: confVal,
        qualityScore: 0.94,
        calibrationScore: 0.98,
        decisionBasis: [
          { label: "Colour similarity", value: resVal === "INCONCLUSIVE" ? 61 : 95 },
          { label: "Calibration quality", value: 98 },
          { label: "Image quality", value: 94 },
          { label: "Model confidence", value: Math.round(confVal * 100) },
        ],
        analysisBasis:
          resVal === "POSITIVE"
            ? "Detected colour response falls within calibrated positive reference range (offline evaluation)."
            : resVal === "NEGATIVE"
              ? "Detected colour response aligns with calibrated negative reference range (offline evaluation)."
              : "Observed colour response overlaps uncertainty range (offline evaluation).",
        recommendedAction:
          resVal === "INCONCLUSIVE"
            ? "Repeat the field test or submit for confirmatory laboratory analysis."
            : null,
        simulated: true,
      };
      const packagePayload = {
        evidenceId: evId,
        result: resVal,
        confidence: confVal,
        createdAt: now,
        operatorId: "OFFLINE_OPERATOR",
        profileSlug: activeProf.slug,
        analysisVersion: "trace-vision-1.0-demo",
      };
      const canonical = JSON.stringify(packagePayload, Object.keys(packagePayload).sort());
      const hash = await sha256HexWeb(canonical);
      const offlineEvidence = {
        evidenceId: evId,
        testId: test.testId,
        result: resVal,
        confidence: confVal,
        createdAt: now,
        timestamp: now,
        location: test.location || { label: "Offline Field Site" },
        operatorId: "OFFLINE_OPERATOR",
        operatorName: "Field Officer (Offline)",
        device: "TRC-OFFLINE-DEVICE",
        profile: activeProf,
        analysis: analysisObj,
        quality: quality || { resolution: "Optimal", focus: "Sharp", lighting: "Acceptable", referenceCard: "Detected", testRegion: "Detected", accepted: true, issues: [] },
        analysisVersion: "trace-vision-1.0-demo",
        hash,
        signature: `SIG-OFFLINE-${hash.slice(0, 32)}`,
        signatureAlgorithm: "Ed25519",
        integrityStatus: "INTACT",
        recordStatus: "UNCHANGED",
        verificationToken: hash.slice(0, 24),
        simulated: true,
        demoLabel: "OFFLINE FIELD CAPTURE (Queued for sync)",
        syncStatus: "pending",
        originalImage: preview,
        processedImage: preview,
        packagePayload,
      };
      await queueEvidence(offlineEvidence);
      setResult({ evidence: offlineEvidence });
      setPhase("result");
      return;
    }

    try {
      const data = await api(`/tests/${test.testId}/analyze`, {
        method: "POST",
        body: JSON.stringify({
          demoScenario: scenario === "poor-capture" ? "inconclusive" : scenario,
          imageData: preview,
          offline: false,
        }),
      });
      setResult(data);
      setPhase("result");
    } catch (e) {
      setError(e.message);
      setPhase("quality");
    }
  }

  const evidence = result?.evidence;
  const analysis = evidence?.analysis;

  return (
    <>
      <h1>Smart test capture</h1>
      <p className="lede">Position the kit reaction and the reference colour card inside the frame. Demo scenarios are labelled simulated.</p>
      {error && <div className="error-box">{error}</div>}

      {phase === "setup" && (
        <div className="card">
          <span className="badge demo">SIMULATED DEMO DATA available</span>
          <div className="filters" style={{ marginTop: 16 }}>
            <div>
              <label htmlFor="profile">Test profile</label>
              <select id="profile" value={profileSlug} onChange={(e) => setProfileSlug(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.slug} value={p.slug}>{p.name} · v{p.version}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="scene">Demo mode</label>
              <select id="scene" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <button className="btn btn-primary" onClick={begin}>Open capture</button>
        </div>
      )}

      {(phase === "capture" || phase === "rejected") && (
        <div className="capture-stage">
          <div>
            <div className="viewfinder">
              <video ref={videoRef} playsInline muted />
              <div className="guides" />
            </div>
            <canvas ref={canvasRef} className="sr-only" />
            {preview && <img alt="Capture preview" src={preview} style={{ marginTop: 12, border: "1px solid var(--line)" }} />}
            {cameraError && (
              <div className="error-box" style={{ marginTop: 12 }}>
                <strong>CAMERA UNAVAILABLE</strong>
                <p>{cameraError}</p>
                <p>Demo capture will use a synthetic frame instead.</p>
                <button className="btn" onClick={startCamera}>Try again</button>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn" onClick={snap}>Capture frame</button>
              <button className="btn btn-primary" onClick={() => submitCapture({ fail: scenario === "poor-capture" })}>
                Submit for quality check
              </button>
              {scenario === "poor-capture" && (
                <button className="btn" onClick={() => submitCapture({ fail: true })}>Simulate poor framing</button>
              )}
            </div>
          </div>
          <aside className="card">
            <h2>Field status</h2>
            <div className="quality-list">
              <div><span>Lighting</span><span>Guided</span></div>
              <div><span>Focus</span><span>Hold steady</span></div>
              <div><span>Location</span><span>Demo site</span></div>
              <div><span>Device</span><span className="mono">TRC-BROWSER</span></div>
            </div>
            {phase === "rejected" && quality && (
              <div className="error-box" style={{ marginTop: 16 }}>
                <strong>CAPTURE NOT ACCEPTED</strong>
                {quality.issues.map((i) => <p key={i}>{i}</p>)}
                <button className="btn" onClick={() => { setPhase("capture"); setQuality(null); setPreview(null); }}>Retake capture</button>
              </div>
            )}
          </aside>
        </div>
      )}

      {phase === "quality" && quality && (
        <div className="card">
          <h2>Capture quality</h2>
          <div className="quality-list">
            <div><span>✓ Resolution</span><span>{quality.resolution}</span></div>
            <div><span>✓ Focus</span><span>{quality.focus}</span></div>
            <div><span>✓ Lighting</span><span>{quality.lighting}</span></div>
            <div><span>✓ Reference card</span><span>{quality.referenceCard}</span></div>
            <div><span>✓ Test region</span><span>{quality.testRegion}</span></div>
          </div>
          <p style={{ marginTop: 16 }}><strong>READY FOR ANALYSIS</strong></p>
          <button className="btn btn-primary" onClick={analyze}>Run calibration and AI evaluation</button>
        </div>
      )}

      {phase === "calibrate" && (
        <div className="card">
          <h2>Calibrating colour</h2>
          <ul className="stage-list">
            <li className="on">Reference card detected</li>
            <li className="on">Camera response normalized</li>
            <li className="on">Lighting compensation applied</li>
            <li className="on">CIELAB conversion completed</li>
          </ul>
        </div>
      )}

      {phase === "analyze" && (
        <div className="card">
          <h2>AI analysis</h2>
          <ol className="stage-list">
            {["Image validation","Perspective correction","Lighting normalization","Colour extraction","CIELAB comparison","Pattern analysis","Confidence estimation","Result generation"].map((s, i) => (
              <li key={s} className={i <= stageIdx ? "on" : ""}>
                <span>{String(i + 1).padStart(2, "0")} {s}</span>
                <span>{i < stageIdx ? "Done" : i === stageIdx ? "Running" : "Queued"}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {phase === "result" && evidence && (
        <>
          <span className="badge demo">{evidence.demoLabel}</span>
          <div className="grid-12" style={{ marginTop: 16 }}>
            <section className="card span-6">
              <h2>Result</h2>
              <ResultBadge result={analysis.result} />
              <p style={{ fontSize: 42, margin: "8px 0 0" }}>{analysis.result}</p>
              <p>Confidence</p>
              <p className="mono" style={{ fontSize: 28 }}>{(analysis.confidence * 100).toFixed(1)}%</p>
              <div className="meter" aria-label="Confidence"><span style={{ width: `${analysis.confidence * 100}%` }} /></div>
              <p style={{ marginTop: 16 }}><strong>Analysis basis</strong></p>
              <p>{analysis.analysisBasis}</p>
              {analysis.recommendedAction && (
                <>
                  <p><strong>Recommended action</strong></p>
                  <p>{analysis.recommendedAction}</p>
                </>
              )}
              <p>Evidence integrity <span className="badge ok">VERIFIED</span></p>
            </section>
            <section className="card span-6">
              <h2>Why TRACE reached this result</h2>
              <div className="quality-list">
                {analysis.decisionBasis.map((d) => (
                  <div key={d.label}><span>{d.label}</span><span className="mono">{d.value}%</span></div>
                ))}
              </div>
              <p style={{ marginTop: 12 }}>Classification: <strong>{analysis.result}</strong></p>
            </section>
            <section className="card span-6">
              <h2>Evidence record</h2>
              <p className="mono">{evidence.evidenceId}</p>
              <p>SHA-256</p>
              <div className="hash-box">{evidence.hash}</div>
              <p style={{ marginTop: 12 }}>Digital signature · {evidence.signatureAlgorithm}</p>
              <div className="hash-box">{evidence.signature}</div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => navigator.clipboard.writeText(evidence.hash)}>Copy hash</button>
                <button className="btn" onClick={() => setQrOpen(true)}>QR</button>
                <button className="btn btn-primary" onClick={() => navigate(`/evidence/${evidence.evidenceId}`)}>View evidence</button>
                <button className="btn" onClick={() => navigate("/evidence")}>Evidence vault</button>
              </div>
            </section>
            <section className="card span-6">
              <h2>Audit timeline</h2>
              <p className="lede">Opened on the evidence report after finalization.</p>
              <button className="btn" onClick={() => navigate(`/evidence/${evidence.evidenceId}`)}>Open full report</button>
            </section>
          </div>
        </>
      )}

      {qrOpen && evidence && (
        <Modal title="Verification QR" onClose={() => setQrOpen(false)}>
          <p>Encodes a verification identifier, not the case file.</p>
          <div style={{ background: "#fff", padding: 12, width: "fit-content" }}>
            <QRCodeSVG value={evidence.verificationToken} size={180} />
          </div>
          <p className="mono">{evidence.verificationToken}</p>
        </Modal>
      )}
      <Disclaimer />
    </>
  );
}
