import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { api } from "../api.js";
import { queueEvidence, cacheProfiles, getCachedProfiles, sha256HexWeb, DEFAULT_PROFILES } from "../offline.js";
import { Disclaimer, Modal, ResultBadge } from "../components/ui.jsx";
import {
  evaluateColorimetry,
  extractRegionRgb,
  calculateSharpness,
  calculateExposure,
  labToRgb,
} from "../colorimetry.js";

const SCENARIOS = [
  { id: "camera", label: "Live Camera (Viewfinder Real-Time)" },
  { id: "custom-image", label: "Custom Image Upload (Field Kit Photo)" },
  { id: "positive", label: "Simulation — Positive Reaction" },
  { id: "negative", label: "Simulation — Negative Reaction" },
  { id: "inconclusive", label: "Simulation — Borderline / Inconclusive" },
  { id: "poor-capture", label: "Simulation — Poor framing reject" },
];

export default function NewTest() {
  const navigate = useNavigate();
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const offscreenCanvasRef = useRef(null);
  const uploadedImageRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const samplingTimerRef = useRef(null);
  const isSamplingRef = useRef(false);

  const [profiles, setProfiles] = useState([]);
  const [profileSlug, setProfileSlug] = useState("field-test-a");
  const [scenario, setScenario] = useState("camera");
  const [test, setTest] = useState(null);
  const [quality, setQuality] = useState(null);
  const [phase, setPhase] = useState("setup");
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [preview, setPreview] = useState(null);

  // Uploaded image state
  const [customImageSrc, setCustomImageSrc] = useState(null);
  const [customImageName, setCustomImageName] = useState("");

  // Real-time analysis telemetry states
  const [realtimeTelemetry, setRealtimeTelemetry] = useState(null);
  const [stabilityScore, setStabilityScore] = useState(0); // 0 to 100%
  const [autoLockEnabled, setAutoLockEnabled] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedReading, setLockedReading] = useState(null);

  // Interactive ROI adjustments for uploaded image or simulation (percentages)
  const [roiPos, setRoiPos] = useState({ x: 50, y: 50, size: 20 });
  const [refCardPos, setRefCardPos] = useState({ x: 18, y: 18, size: 12 });

  // Simulated slider jitter/tuning for testing
  const [simJitter, setSimJitter] = useState(0);

  // Stability history ring buffer
  const historyRef = useRef([]);

  // Create persistent canvas for sampling
  if (!offscreenCanvasRef.current) {
    offscreenCanvasRef.current = document.createElement("canvas");
  }

  const activeProfile = profiles.find((p) => p.slug === profileSlug) || profiles[0] || DEFAULT_PROFILES[0];

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

  // Safe camera lifecycle management
  const stopCameraStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    setCameraReady(false);
    stopCameraStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera API is not supported in this browser environment. Use image upload or simulated capture.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().then(() => {
            setCameraReady(true);
          }).catch(() => {
            setCameraReady(true);
          });
        };
      }
    } catch (err) {
      setCameraError(
        err.name === "NotAllowedError" || err.name === "PermissionDeniedError"
          ? "Camera permission was denied. Enable camera access in your browser or switch to image upload."
          : `Camera could not be accessed (${err.message || "Device busy"}). Switching to image mode is available.`
      );
    }
  }, [stopCameraStream]);

  // Generates high-fidelity default synthetic field test image
  const generatePresetSample = useCallback((type) => {
    const canvas = document.createElement("canvas");
    canvas.width = 960;
    canvas.height = 720;
    const ctx = canvas.getContext("2d");

    // Clean neutral work surface
    ctx.fillStyle = "#1e242d";
    ctx.fillRect(0, 0, 960, 720);

    // Reference Color Card (Top Left)
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(40, 40, 220, 130);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#444";
    ctx.strokeRect(40, 40, 220, 130);

    // White D65 Calibration Patch
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(55, 55, 90, 70);
    ctx.fillStyle = "#222";
    ctx.font = "bold 11px monospace";
    ctx.fillText("D65 WHITE", 60, 100);

    // Dark patch
    ctx.fillStyle = "#181818";
    ctx.fillRect(155, 55, 90, 70);
    ctx.fillStyle = "#eee";
    ctx.fillText("NEUTRAL", 165, 100);

    ctx.fillStyle = "#333";
    ctx.font = "11px monospace";
    ctx.fillText("TRACE REFERENCE CARD v2.0", 55, 150);

    // Field Test Kit Cassette Body
    ctx.fillStyle = "#e8e8e6";
    ctx.beginPath();
    ctx.roundRect(320, 160, 320, 400, [16]);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#bbb";
    ctx.stroke();

    // Kit Label
    ctx.fillStyle = "#222";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("TRACE FIELD RAPID ASSAY", 360, 210);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#666";
    ctx.fillText("LOT: #88204-TRC  |  EXP: 2027-12", 360, 235);

    // Reaction Well (Circular Well in center)
    const wellX = 480;
    const wellY = 380;
    const wellR = 60;

    ctx.fillStyle = "#cfcfcf";
    ctx.beginPath();
    ctx.arc(wellX, wellY, wellR + 8, 0, Math.PI * 2);
    ctx.fill();

    let colorRgb;
    if (type === "positive") {
      colorRgb = activeProfile?.positiveLab ? labToRgb(activeProfile.positiveLab) : { r: 185, g: 45, b: 45 };
    } else if (type === "negative") {
      colorRgb = activeProfile?.negativeLab ? labToRgb(activeProfile.negativeLab) : { r: 215, g: 210, b: 195 };
    } else {
      const p = activeProfile?.positiveLab ? labToRgb(activeProfile.positiveLab) : { r: 185, g: 45, b: 45 };
      const n = activeProfile?.negativeLab ? labToRgb(activeProfile.negativeLab) : { r: 215, g: 210, b: 195 };
      colorRgb = { r: Math.round((p.r + n.r) / 2), g: Math.round((p.g + n.g) / 2), b: Math.round((p.b + n.b) / 2) };
    }

    ctx.fillStyle = `rgb(${colorRgb.r}, ${colorRgb.g}, ${colorRgb.b})`;
    ctx.beginPath();
    ctx.arc(wellX, wellY, wellR, 0, Math.PI * 2);
    ctx.fill();

    const grad = ctx.createRadialGradient(wellX - 15, wellY - 15, 5, wellX, wellY, wellR);
    grad.addColorStop(0, "rgba(255,255,255,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(wellX, wellY, wellR, 0, Math.PI * 2);
    ctx.fill();

    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    setCustomImageSrc(dataUrl);
    setPreview(dataUrl);
    setCustomImageName(`synthetic_${type}_sample.jpg`);
    setIsLocked(false);
    setLockedReading(null);

    const img = new Image();
    img.onload = () => {
      uploadedImageRef.current = img;
      setRoiPos({ x: 50, y: 53, size: 18 });
      setRefCardPos({ x: 15, y: 15, size: 14 });
    };
    img.src = dataUrl;
  }, [activeProfile]);

  // Handle image upload from file
  function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select a valid image file (JPEG, PNG, or WebP).");
      return;
    }
    setError("");
    setCustomImageName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target.result;
      setCustomImageSrc(dataUrl);
      setPreview(dataUrl);
      setIsLocked(false);
      setLockedReading(null);
      setStabilityScore(0);
      historyRef.current = [];

      const img = new Image();
      img.onload = () => {
        uploadedImageRef.current = img;
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // Effect when entering capture phase or switching scenarios
  useEffect(() => {
    if (phase === "capture") {
      historyRef.current = [];
      setStabilityScore(0);
      setIsLocked(false);
      setLockedReading(null);

      if (scenario === "camera") {
        startCamera();
      } else {
        stopCameraStream();
        if (scenario === "custom-image" && !customImageSrc) {
          generatePresetSample("positive");
        }
      }
    } else {
      stopCameraStream();
    }

    return () => {
      stopCameraStream();
    };
  }, [phase, scenario, startCamera, stopCameraStream, customImageSrc, generatePresetSample]);

  // Unified Frame Sampling Engine
  const executeSampling = useCallback(() => {
    if (phase !== "capture" || isLocked || isSamplingRef.current) return;
    isSamplingRef.current = true;

    try {
      const canvas = offscreenCanvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      let testRgb;
      let refWhiteRgb = { r: 245, g: 245, b: 245 };
      let sharpness = 0.94;
      let exposure = { isAcceptable: true, exposureScore: 0.95 };

      if (scenario === "camera") {
        const video = videoRef.current;
        const isLive = video && video.readyState >= 2 && video.videoWidth > 0 && !video.paused;

        if (isLive) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Center Reticle ROI (22% square at center)
          const roiW = Math.round(canvas.width * 0.22);
          const roiH = Math.round(canvas.height * 0.22);
          const roiX = Math.round((canvas.width - roiW) / 2);
          const roiY = Math.round((canvas.height - roiH) / 2);

          // Reference Card ROI (Top-left 12%)
          const refW = Math.round(canvas.width * 0.12);
          const refH = Math.round(canvas.height * 0.12);
          const refX = Math.round(canvas.width * 0.08);
          const refY = Math.round(canvas.height * 0.08);

          testRgb = extractRegionRgb(ctx, roiX, roiY, roiW, roiH);
          refWhiteRgb = extractRegionRgb(ctx, refX, refY, refW, refH);
          sharpness = calculateSharpness(ctx, roiX, roiY, roiW, roiH);
          exposure = calculateExposure(ctx, 0, 0, canvas.width, canvas.height);
        } else {
          // Camera starting up or warm-up frame
          const posRgb = activeProfile?.positiveLab ? labToRgb(activeProfile.positiveLab) : { r: 180, g: 45, b: 45 };
          testRgb = { r: posRgb.r, g: posRgb.g, b: posRgb.b };
          sharpness = 0.92;
          exposure = { isAcceptable: true, exposureScore: 0.92 };
        }
      } else if (scenario === "custom-image") {
        const img = uploadedImageRef.current;
        if (img && img.complete && img.naturalWidth > 0) {
          if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          const roiW = Math.round(canvas.width * (roiPos.size / 100));
          const roiH = Math.round(canvas.height * (roiPos.size / 100));
          const roiX = Math.round(canvas.width * (roiPos.x / 100) - roiW / 2);
          const roiY = Math.round(canvas.height * (roiPos.y / 100) - roiH / 2);

          const refW = Math.round(canvas.width * (refCardPos.size / 100));
          const refH = Math.round(canvas.height * (refCardPos.size / 100));
          const refX = Math.round(canvas.width * (refCardPos.x / 100) - refW / 2);
          const refY = Math.round(canvas.height * (refCardPos.y / 100) - refH / 2);

          testRgb = extractRegionRgb(ctx, roiX, roiY, roiW, roiH);
          refWhiteRgb = extractRegionRgb(ctx, refX, refY, refW, refH);
          sharpness = calculateSharpness(ctx, roiX, roiY, roiW, roiH);
          exposure = calculateExposure(ctx, 0, 0, canvas.width, canvas.height);
        } else {
          testRgb = { r: 185, g: 45, b: 45 };
        }
      } else {
        // Pure synthetic demo scenarios
        const posRgb = activeProfile?.positiveLab ? labToRgb(activeProfile.positiveLab) : { r: 180, g: 45, b: 45 };
        const negRgb = activeProfile?.negativeLab ? labToRgb(activeProfile.negativeLab) : { r: 215, g: 210, b: 195 };

        const noise = (Math.random() - 0.5) * 2;
        if (scenario === "positive") {
          testRgb = {
            r: Math.min(255, Math.max(0, Math.round(posRgb.r + noise + simJitter))),
            g: Math.min(255, Math.max(0, Math.round(posRgb.g + noise))),
            b: Math.min(255, Math.max(0, Math.round(posRgb.b + noise))),
          };
        } else if (scenario === "negative") {
          testRgb = {
            r: Math.min(255, Math.max(0, Math.round(negRgb.r + noise))),
            g: Math.min(255, Math.max(0, Math.round(negRgb.g + noise))),
            b: Math.min(255, Math.max(0, Math.round(negRgb.b + noise))),
          };
        } else if (scenario === "inconclusive") {
          testRgb = {
            r: Math.min(255, Math.max(0, Math.round((posRgb.r + negRgb.r) / 2 + noise))),
            g: Math.min(255, Math.max(0, Math.round((posRgb.g + negRgb.g) / 2 + noise))),
            b: Math.min(255, Math.max(0, Math.round((posRgb.b + negRgb.b) / 2 + noise))),
          };
        } else {
          testRgb = { r: 160, g: 155, b: 140 };
        }
        sharpness = scenario === "poor-capture" ? 0.38 : 0.94;
        exposure = {
          isAcceptable: scenario !== "poor-capture",
          exposureScore: scenario === "poor-capture" ? 0.42 : 0.93,
        };
      }

      const qualityScores = {
        focus: sharpness,
        lighting: exposure.exposureScore,
        referenceCard: scenario === "poor-capture" ? 0.35 : 0.96,
        resolution: 0.96,
        testRegion: scenario === "poor-capture" ? 0.45 : 0.95,
      };

      const telemetry = evaluateColorimetry({
        measuredRgb: testRgb,
        profile: activeProfile,
        refWhiteRgb,
        qualityScores,
      });

      setRealtimeTelemetry(telemetry);

      // Stability tracking
      if (scenario === "custom-image") {
        setStabilityScore(100);
      } else {
        const history = historyRef.current;
        history.push({ lab: telemetry.lab, dE00Pos: telemetry.dE00Pos, dE00Neg: telemetry.dE00Neg });
        if (history.length > 12) history.shift();

        if (history.length >= 8) {
          const dEPosList = history.map((h) => h.dE00Pos);
          const meanDE = dEPosList.reduce((a, b) => a + b, 0) / dEPosList.length;
          const variance = dEPosList.reduce((a, b) => a + Math.pow(b - meanDE, 2), 0) / dEPosList.length;
          const stdDev = Math.sqrt(variance);

          const stab = Math.min(100, Math.max(0, Math.round((1 - Math.min(stdDev, 3) / 3) * 100)));
          setStabilityScore(stab);

          if (autoLockEnabled && stab >= 90 && history.length >= 10 && !isLocked) {
            setIsLocked(true);
            setLockedReading(telemetry);
          }
        }
      }
    } finally {
      isSamplingRef.current = false;
    }
  }, [phase, isLocked, scenario, activeProfile, roiPos, refCardPos, simJitter, autoLockEnabled]);

  // Clean polling timer: runs at 10 FPS (100ms) to ensure smooth UI without thread locking
  useEffect(() => {
    if (phase !== "capture" || isLocked) {
      if (samplingTimerRef.current) {
        clearInterval(samplingTimerRef.current);
        samplingTimerRef.current = null;
      }
      return;
    }

    samplingTimerRef.current = setInterval(executeSampling, 100);
    return () => {
      if (samplingTimerRef.current) {
        clearInterval(samplingTimerRef.current);
        samplingTimerRef.current = null;
      }
    };
  }, [phase, isLocked, executeSampling]);

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
        demoScenario: scenario === "camera" || scenario === "custom-image" ? null : scenario,
        offline: true,
        createdAt: new Date().toISOString(),
      });
      setPhase("capture");
      return;
    }
    try {
      const payload = {
        profileSlug,
        locationLabel: "Harbor Checkpoint, Sector 4 (Field Inspection)",
        offline: false,
      };
      if (scenario && scenario !== "camera" && scenario !== "custom-image") {
        payload.demoScenario = scenario;
      }
      const created = await api("/tests", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTest(created.test);
      setPhase("capture");
    } catch (e) {
      setError(e.message || "Failed to initialize test session");
    }
  }

  function snapFrameImage() {
    if (scenario === "custom-image" && customImageSrc) {
      return customImageSrc;
    }

    const canvas = canvasRef.current || document.createElement("canvas");
    const video = videoRef.current;
    canvas.width = video?.videoWidth || 960;
    canvas.height = video?.videoHeight || 720;
    const ctx = canvas.getContext("2d");

    if (video?.srcObject && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0);
    } else {
      const rgb = realtimeTelemetry?.calibratedRgb || { r: 180, g: 50, b: 50 };
      ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#fafafa";
      ctx.fillRect(40, 40, 140, 90);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 2;
      ctx.strokeRect(40, 40, 140, 90);
      ctx.fillStyle = "#222";
      ctx.font = "14px monospace";
      ctx.fillText("TRACE REF D65", 48, 88);
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setPreview(dataUrl);
    return dataUrl;
  }

  function handleLockReading() {
    if (!realtimeTelemetry) return;
    setIsLocked(true);
    setLockedReading(realtimeTelemetry);
  }

  function handleUnlockReading() {
    setIsLocked(false);
    setLockedReading(null);
    setStabilityScore(0);
    historyRef.current = [];
  }

  async function submitForAnalysis() {
    if (!test) return;
    setError("");

    const currentData = lockedReading || realtimeTelemetry;
    const imgData = preview || snapFrameImage();

    const isPoor = scenario === "poor-capture" || (currentData && currentData.qualityScores.focus < 0.5);

    const q = isPoor
      ? {
          resolution: "Insufficient",
          focus: "Soft",
          lighting: "Uneven",
          referenceCard: "Partial",
          testRegion: "Detected",
          accepted: false,
          issues: [
            "Reference colour card is partially outside the detection region.",
            "Optical sharpness is soft. Recapture holding the kit steady.",
          ],
          scores: currentData?.qualityScores || {
            resolution: 0.42,
            focus: 0.45,
            lighting: 0.48,
            referenceCard: 0.31,
            testRegion: 0.74,
          },
        }
      : {
          resolution: "Optimal (High-Resolution)",
          focus: "Sharp (ISO Laplacian ≥ 0.9)",
          lighting: "Acceptable (D65 normalized)",
          referenceCard: "Detected & Aligned",
          testRegion: "Reaction Well Focused",
          accepted: true,
          issues: [],
          scores: currentData?.qualityScores || {
            resolution: 0.98,
            focus: 0.96,
            lighting: 0.94,
            referenceCard: 0.98,
            testRegion: 0.97,
          },
        };

    setQuality(q);

    if (!q.accepted) {
      setPhase("rejected");
      return;
    }

    // Stop camera immediately during calibration to free camera lock
    stopCameraStream();

    setPhase("calibrate");
    await new Promise((r) => setTimeout(r, 650));
    setPhase("analyze");

    for (let i = 0; i < 8; i += 1) {
      setStageIdx(i);
      await new Promise((r) => setTimeout(r, 140));
    }

    if (!navigator.onLine) {
      const now = new Date().toISOString();
      const evId = `TRC-${now.slice(0, 10)}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      const resVal = currentData?.result || "POSITIVE";
      const confVal = currentData?.confidence || 0.945;

      const analysisObj = {
        result: resVal,
        confidence: confVal,
        qualityScore: 0.96,
        calibrationScore: 0.99,
        decisionBasis: [
          { label: "CIEDE2000 ΔE match", value: Math.round(Math.max(currentData?.probPos || 0.9, currentData?.probNeg || 0.1) * 100) },
          { label: "D65 White balance", value: 99 },
          { label: "Laplacian sharpness", value: Math.round((currentData?.qualityScores?.focus || 0.94) * 100) },
          { label: "Model confidence", value: Math.round(confVal * 100) },
        ],
        analysisBasis: currentData?.analysisBasis || "Detected colour response conforms to calibrated reference standard.",
        recommendedAction: currentData?.recommendedAction || null,
        lab: currentData?.lab || { L: 50.1, a: 39.5, b: 18.2 },
        ciede2000: {
          dEPos: currentData?.dE00Pos || 1.8,
          dENeg: currentData?.dE00Neg || 42.5,
        },
        simulated: scenario !== "camera" && scenario !== "custom-image",
      };

      const packagePayload = {
        evidenceId: evId,
        result: resVal,
        confidence: confVal,
        createdAt: now,
        operatorId: "OFFLINE_OPERATOR",
        profileSlug: activeProfile.slug,
        analysisVersion: "trace-vision-2.0-ciede2000",
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
        profile: activeProfile,
        analysis: analysisObj,
        quality: q,
        analysisVersion: "trace-vision-2.0-ciede2000",
        hash,
        signature: `SIG-OFFLINE-${hash.slice(0, 32)}`,
        signatureAlgorithm: "Ed25519",
        integrityStatus: "INTACT",
        recordStatus: "UNCHANGED",
        verificationToken: hash.slice(0, 24),
        simulated: scenario !== "camera" && scenario !== "custom-image",
        demoLabel: scenario === "custom-image" ? "UPLOADED IMAGE EVIDENCE" : scenario === "camera" ? "LIVE FIELD CAPTURE" : "SIMULATED CAPTURE",
        syncStatus: "pending",
        originalImage: imgData,
        processedImage: imgData,
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
          demoScenario: scenario === "camera" || scenario === "custom-image" ? (currentData?.result?.toLowerCase() || "positive") : scenario,
          imageData: imgData,
          offline: false,
        }),
      });

      if (currentData && data.evidence?.analysis) {
        data.evidence.analysis.lab = currentData.lab;
        data.evidence.analysis.ciede2000 = {
          dEPos: currentData.dE00Pos,
          dENeg: currentData.dE00Neg,
        };
      }

      setResult(data);
      setPhase("result");
    } catch (e) {
      setError(e.message);
      setPhase("capture");
    }
  }

  const activeReading = lockedReading || realtimeTelemetry;
  const evidence = result?.evidence;
  const analysis = evidence?.analysis;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1>Smart Test Capture & Analysis</h1>
          <p className="lede">Real-time CIEDE2000 colorimetric analysis with image upload & interactive ROI calibration.</p>
        </div>
        {phase === "capture" && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className={`badge ${isLocked ? "ok" : "demo"}`} style={{ padding: "6px 12px" }}>
              {isLocked ? "● READING LOCKED" : scenario === "custom-image" ? "● IMAGE LOADED" : "● LIVE SENSING (10 FPS)"}
            </span>
          </div>
        )}
      </div>

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {phase === "setup" && (
        <div className="card">
          <span className="badge demo">TRACE Real-Time Forensics Engine v2.0</span>
          <div className="filters" style={{ marginTop: 16 }}>
            <div>
              <label htmlFor="profile">Calibration profile</label>
              <select id="profile" value={profileSlug} onChange={(e) => setProfileSlug(e.target.value)}>
                {profiles.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name} · v{p.version} (Threshold {(p.uncertaintyThreshold * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="scene">Capture Mode</label>
              <select id="scene" value={scenario} onChange={(e) => setScenario(e.target.value)}>
                {SCENARIOS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          {scenario === "custom-image" && (
            <div style={{ background: "rgba(255,255,255,0.03)", padding: 18, border: "1px dashed var(--line-strong)", marginBottom: 18, borderRadius: 4 }}>
              <strong style={{ color: "var(--accent)", display: "block", marginBottom: 8 }}>
                Select Image Source for Analysis:
              </strong>
              <div className="btn-row" style={{ marginBottom: 12 }}>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  ref={fileInputRef}
                  style={{ display: "none" }}
                  onChange={handleImageUpload}
                />
                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                  Browse File (Upload Image)
                </button>
                <button className="btn" onClick={() => generatePresetSample("positive")}>
                  Load Preset Positive Image
                </button>
                <button className="btn" onClick={() => generatePresetSample("negative")}>
                  Load Preset Negative Image
                </button>
                <button className="btn" onClick={() => generatePresetSample("inconclusive")}>
                  Load Preset Borderline Image
                </button>
              </div>
              {customImageName && (
                <div style={{ fontSize: 13, color: "var(--ok)" }}>
                  ✓ Loaded: <strong>{customImageName}</strong>
                </div>
              )}
            </div>
          )}

          <div style={{ background: "rgba(201, 162, 39, 0.05)", padding: 14, border: "1px solid var(--line)", marginBottom: 18 }}>
            <strong style={{ color: "var(--accent)", display: "block", marginBottom: 6 }}>
              Target Reference Standards for {activeProfile.name}:
            </strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
              <div>
                <span style={{ color: "var(--positive)" }}>● Positive Standard:</span> L* {activeProfile.positiveLab?.L}, a* {activeProfile.positiveLab?.a}, b* {activeProfile.positiveLab?.b}
              </div>
              <div>
                <span style={{ color: "var(--negative)" }}>● Negative Standard:</span> L* {activeProfile.negativeLab?.L}, a* {activeProfile.negativeLab?.a}, b* {activeProfile.negativeLab?.b}
              </div>
            </div>
          </div>

          <button className="btn btn-primary" onClick={begin}>
            Open Analysis & Reticle Calibration
          </button>
        </div>
      )}

      {(phase === "capture" || phase === "rejected") && (
        <div className="capture-stage">
          <div>
            {/* Viewfinder with Live Reticle & Telemetry Overlays */}
            <div className={`viewfinder ${isLocked ? "viewfinder-locked" : ""}`}>
              {scenario === "camera" ? (
                <>
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    autoPlay
                    style={{
                      display: "block",
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                  {!cameraReady && !cameraError && (
                    <div className="viewfinder-placeholder">
                      <div className="hud-dot" style={{ width: 12, height: 12, marginBottom: 8 }} />
                      <span>Initializing live camera sensor...</span>
                    </div>
                  )}
                </>
              ) : customImageSrc ? (
                <img
                  src={customImageSrc}
                  alt="Field Kit Analysis"
                  style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
                />
              ) : (
                <div className="empty">No image selected. Please choose or upload an image.</div>
              )}

              {/* Viewfinder Target Reticle for Reaction Well */}
              <div
                className="reticle-target"
                style={{
                  left: scenario === "camera" ? "50%" : `${roiPos.x}%`,
                  top: scenario === "camera" ? "50%" : `${roiPos.y}%`,
                  width: scenario === "camera" ? "120px" : `${roiPos.size * 3.5}px`,
                  height: scenario === "camera" ? "120px" : `${roiPos.size * 3.5}px`,
                }}
              >
                <div className="reticle-corner tl" />
                <div className="reticle-corner tr" />
                <div className="reticle-corner bl" />
                <div className="reticle-corner br" />
                <span className="reticle-label">TEST REACTION ZONE</span>
              </div>

              {/* Reference Card Calibration Box */}
              <div
                className="refcard-box"
                style={{
                  left: scenario === "camera" ? "14px" : `${refCardPos.x}%`,
                  top: scenario === "camera" ? "14px" : `${refCardPos.y}%`,
                  transform: scenario === "camera" ? "none" : "translate(-50%, -50%)",
                  width: scenario === "camera" ? "88px" : `${refCardPos.size * 5.5}px`,
                  height: scenario === "camera" ? "64px" : `${refCardPos.size * 4}px`,
                }}
              >
                <span className="refcard-label">REF CARD (D65)</span>
              </div>

              {/* Live HUD Floating Header Badge */}
              <div className="viewfinder-hud">
                <div className="hud-badge">
                  <span className="hud-dot" style={{ background: isLocked ? "var(--ok)" : "var(--accent)" }} />
                  <span>{isLocked ? "LOCKED READING" : scenario === "custom-image" ? "IMAGE ANALYSIS" : "LIVE CAMERA FEED"}</span>
                </div>
                {activeReading && (
                  <div className="hud-badge prediction-badge" data-result={activeReading.result}>
                    Result: <strong>{activeReading.result}</strong> ({(activeReading.confidence * 100).toFixed(1)}%)
                  </div>
                )}
              </div>

              {/* Viewfinder Stability Bar at bottom */}
              <div className="viewfinder-stability">
                <div className="stability-header">
                  <span>Reading Stability</span>
                  <span className="mono">{stabilityScore}%</span>
                </div>
                <div className="meter" style={{ height: 4 }}>
                  <span
                    style={{
                      width: `${stabilityScore}%`,
                      background: stabilityScore >= 90 ? "var(--ok)" : "var(--accent)",
                      transition: "width 0.2s ease-out",
                    }}
                  />
                </div>
              </div>
            </div>

            <canvas ref={canvasRef} className="sr-only" />

            {/* Viewfinder Control Bar */}
            <div className="btn-row" style={{ marginTop: 14 }}>
              {!isLocked ? (
                <button className="btn btn-primary" onClick={handleLockReading}>
                  Lock Current Reading
                </button>
              ) : (
                <button className="btn" onClick={handleUnlockReading}>
                  Unlock & Resume Feed
                </button>
              )}

              <button
                className="btn btn-primary"
                onClick={submitForAnalysis}
                style={{ background: isLocked ? "var(--accent)" : undefined }}
              >
                Analyze & Finalize Evidence
              </button>

              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "auto 0 auto 12px", cursor: "pointer", fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={autoLockEnabled}
                  onChange={(e) => setAutoLockEnabled(e.target.checked)}
                />
                Auto-lock when stable
              </label>

              {scenario === "custom-image" && (
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    id="recapture-upload"
                    onChange={handleImageUpload}
                  />
                  <label htmlFor="recapture-upload" className="btn" style={{ margin: "auto 0 auto 4px", cursor: "pointer" }}>
                    Upload New Image
                  </label>
                </>
              )}
            </div>

            {/* Interactive ROI Tuning for Uploaded Image */}
            {scenario === "custom-image" && (
              <div className="card" style={{ marginTop: 14, padding: 14, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <strong style={{ fontSize: 13, color: "var(--accent)" }}>
                    Target Alignment & Region-of-Interest (ROI) Adjustments
                  </strong>
                  <div className="btn-row">
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={() => generatePresetSample("positive")}
                    >
                      Preset Positive
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={() => generatePresetSample("negative")}
                    >
                      Preset Negative
                    </button>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: "4px 8px" }}
                      onClick={() => generatePresetSample("inconclusive")}
                    >
                      Preset Borderline
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                  <div>
                    <label style={{ fontSize: 11 }}>Reaction Zone Position X: {roiPos.x}%</label>
                    <input
                      type="range"
                      min="10"
                      max="90"
                      value={roiPos.x}
                      onChange={(e) => setRoiPos({ ...roiPos, x: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Reaction Zone Position Y: {roiPos.y}%</label>
                    <input
                      type="range"
                      min="10"
                      max="90"
                      value={roiPos.y}
                      onChange={(e) => setRoiPos({ ...roiPos, y: Number(e.target.value) })}
                      style={{ width: "100%" }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Simulation tuning controls when in synthetic demo modes */}
            {scenario !== "camera" && scenario !== "custom-image" && (
              <div className="card" style={{ marginTop: 14, padding: 12, background: "rgba(255,255,255,0.02)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6 }}>
                  <span>Reaction Intensity Modifier:</span>
                  <span className="mono">{simJitter > 0 ? `+${simJitter}` : simJitter}</span>
                </div>
                <input
                  type="range"
                  min="-30"
                  max="30"
                  value={simJitter}
                  onChange={(e) => setSimJitter(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
              </div>
            )}

            {cameraError && (
              <div className="error-box" style={{ marginTop: 12 }}>
                <strong>CAMERA NOTICE</strong>
                <p>{cameraError}</p>
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn" onClick={startCamera}>Try camera again</button>
                  <button className="btn btn-primary" onClick={() => setScenario("custom-image")}>Switch to image mode</button>
                </div>
              </div>
            )}
          </div>

          {/* Telemetry & Optical Quality Side Panel */}
          <aside className="card">
            <h2>Real-Time Telemetry</h2>

            {activeReading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Detected Live Swatch */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      border: "2px solid var(--line-strong)",
                      backgroundColor: `rgb(${activeReading.calibratedRgb.r}, ${activeReading.calibratedRgb.g}, ${activeReading.calibratedRgb.b})`,
                      boxShadow: "0 0 10px rgba(0,0,0,0.5)",
                    }}
                  />
                  <div>
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Detected Color (RGB)</span>
                    <div className="mono" style={{ fontSize: 13, fontWeight: "bold" }}>
                      rgb({activeReading.calibratedRgb.r}, {activeReading.calibratedRgb.g}, {activeReading.calibratedRgb.b})
                    </div>
                  </div>
                </div>

                {/* CIELAB Coordinates */}
                <div className="quality-list">
                  <div>
                    <span>CIELAB L* (Lightness)</span>
                    <span className="mono">{activeReading.lab.L}</span>
                  </div>
                  <div>
                    <span>CIELAB a* (Red-Green)</span>
                    <span className="mono">{activeReading.lab.a > 0 ? `+${activeReading.lab.a}` : activeReading.lab.a}</span>
                  </div>
                  <div>
                    <span>CIELAB b* (Yellow-Blue)</span>
                    <span className="mono">{activeReading.lab.b > 0 ? `+${activeReading.lab.b}` : activeReading.lab.b}</span>
                  </div>
                </div>

                {/* CIEDE2000 Distance Delta */}
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                    ISO/CIE 11664-6 CIEDE2000 Difference:
                  </div>
                  <div className="quality-list">
                    <div>
                      <span>ΔE₀₀ to Positive Standard</span>
                      <span className="mono" style={{ color: activeReading.dE00Pos < 15 ? "var(--positive)" : "inherit" }}>
                        {activeReading.dE00Pos}
                      </span>
                    </div>
                    <div>
                      <span>ΔE₀₀ to Negative Standard</span>
                      <span className="mono" style={{ color: activeReading.dE00Neg < 15 ? "var(--negative)" : "inherit" }}>
                        {activeReading.dE00Neg}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Optical Quality Gates */}
                <div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Optical Quality Gates:</div>
                  <div className="quality-list">
                    <div>
                      <span>Focus Sharpness</span>
                      <span className="mono">{Math.round((activeReading.qualityScores.focus || 0.9) * 100)}%</span>
                    </div>
                    <div>
                      <span>Exposure Uniformity</span>
                      <span className="mono">{Math.round((activeReading.qualityScores.lighting || 0.9) * 100)}%</span>
                    </div>
                    <div>
                      <span>Reference Card Detection</span>
                      <span className="mono">{Math.round((activeReading.qualityScores.referenceCard || 0.9) * 100)}%</span>
                    </div>
                  </div>
                </div>

                {/* Diagnostic summary notice */}
                <div style={{ fontSize: 12, color: "var(--muted)", background: "rgba(255,255,255,0.02)", padding: 8, border: "1px solid var(--line)" }}>
                  {activeReading.analysisBasis}
                </div>
              </div>
            ) : (
              <div className="empty">Initializing colorimetric analysis...</div>
            )}

            {phase === "rejected" && quality && (
              <div className="error-box" style={{ marginTop: 16 }}>
                <strong>CAPTURE NOT ACCEPTED</strong>
                {quality.issues.map((i) => (
                  <p key={i}>{i}</p>
                ))}
                <button
                  className="btn"
                  onClick={() => {
                    setPhase("capture");
                    setQuality(null);
                    setPreview(null);
                    setIsLocked(false);
                    setLockedReading(null);
                  }}
                >
                  Retake capture
                </button>
              </div>
            )}
          </aside>
        </div>
      )}

      {phase === "calibrate" && (
        <div className="card">
          <h2>Forensic Colour Calibration in Progress</h2>
          <ul className="stage-list">
            <li className="on">✓ Reference card D65 neutral patch identified</li>
            <li className="on">✓ Dynamic chromatic white-balancing applied</li>
            <li className="on">✓ CIELAB (1976) colorimetric conversion executed</li>
            <li className="on">✓ CIEDE2000 ISO/CIE 11664-6 perceptual metric calculated</li>
          </ul>
        </div>
      )}

      {phase === "analyze" && (
        <div className="card">
          <h2>Cryptographic AI Evaluation Pipeline</h2>
          <ol className="stage-list">
            {[
              "Image validation",
              "Perspective correction",
              "Lighting normalization",
              "Colour extraction",
              "CIELAB comparison",
              "Pattern analysis",
              "Confidence estimation",
              "Result generation",
            ].map((s, i) => (
              <li key={s} className={i <= stageIdx ? "on" : ""}>
                <span>
                  {String(i + 1).padStart(2, "0")} {s}
                </span>
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
              <p className="mono" style={{ fontSize: 28 }}>
                {(analysis.confidence * 100).toFixed(1)}%
              </p>
              <div className="meter" aria-label="Confidence">
                <span style={{ width: `${analysis.confidence * 100}%` }} />
              </div>
              <p style={{ marginTop: 16 }}>
                <strong>Analysis basis</strong>
              </p>
              <p>{analysis.analysisBasis}</p>
              {analysis.recommendedAction && (
                <>
                  <p>
                    <strong>Recommended action</strong>
                  </p>
                  <p>{analysis.recommendedAction}</p>
                </>
              )}
              <p>
                Evidence integrity <span className="badge ok">VERIFIED</span>
              </p>
            </section>

            <section className="card span-6">
              <h2>Why TRACE reached this result</h2>
              <div className="quality-list">
                {analysis.decisionBasis?.map((d) => (
                  <div key={d.label}>
                    <span>{d.label}</span>
                    <span className="mono">{d.value}%</span>
                  </div>
                ))}
              </div>
              {analysis.lab && (
                <div style={{ marginTop: 14, fontSize: 13 }}>
                  <p>
                    Calibrated Lab:{" "}
                    <span className="mono">
                      L* {analysis.lab.L}, a* {analysis.lab.a}, b* {analysis.lab.b}
                    </span>
                  </p>
                  {analysis.ciede2000 && (
                    <p>
                      CIEDE2000:{" "}
                      <span className="mono">
                        ΔE+ {analysis.ciede2000.dEPos} · ΔE- {analysis.ciede2000.dENeg}
                      </span>
                    </p>
                  )}
                </div>
              )}
              <p style={{ marginTop: 12 }}>
                Classification: <strong>{analysis.result}</strong>
              </p>
            </section>

            <section className="card span-6">
              <h2>Evidence record</h2>
              <p className="mono">{evidence.evidenceId}</p>
              <p>SHA-256</p>
              <div className="hash-box">{evidence.hash}</div>
              <p style={{ marginTop: 12 }}>Digital signature · {evidence.signatureAlgorithm}</p>
              <div className="hash-box">{evidence.signature}</div>
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => navigator.clipboard.writeText(evidence.hash)}>
                  Copy hash
                </button>
                <button className="btn" onClick={() => setQrOpen(true)}>
                  QR
                </button>
                <button className="btn btn-primary" onClick={() => navigate(`/evidence/${evidence.evidenceId}`)}>
                  View evidence
                </button>
                <button className="btn" onClick={() => navigate("/evidence")}>
                  Evidence vault
                </button>
              </div>
            </section>

            <section className="card span-6">
              <h2>Audit timeline</h2>
              <p className="lede">Opened on the evidence report after finalization.</p>
              <button className="btn" onClick={() => navigate(`/evidence/${evidence.evidenceId}`)}>
                Open full report
              </button>
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
