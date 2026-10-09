import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";
import { hashEvidencePackage, signHash, verificationToken } from "./crypto.js";

export function makeEvidenceId(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const suffix = randomBytes(3).toString("hex").toUpperCase();
  return `TRC-${y}-${m}-${d}-${suffix}`;
}

export async function appendAudit(evidenceId, action, actor, detail = null) {
  const event = {
    evidenceId,
    action,
    actor,
    timestamp: new Date().toISOString(),
    detail,
  };
  await getDb().collection("audit_events").insertOne(event);
  return event;
}

export async function finalizeEvidence({
  testId,
  profile,
  analysis,
  quality,
  user,
  location,
  device,
  imageData,
  simulated,
  offline,
}) {
  const evidenceId = makeEvidenceId();
  const createdAt = new Date().toISOString();
  const packagePayload = {
    evidenceId,
    result: analysis.result,
    confidence: analysis.confidence,
    createdAt,
    operatorId: user.id,
    profileSlug: profile.slug,
    analysisVersion: "trace-vision-1.0-demo",
  };
  const hash = hashEvidencePackage(packagePayload);
  const signature = signHash(hash);
  const record = {
    evidenceId,
    testId,
    result: analysis.result,
    confidence: analysis.confidence,
    createdAt,
    timestamp: createdAt,
    location: location || {
      label: "Field location unavailable",
      lat: null,
      lng: null,
    },
    operatorId: user.id,
    operatorName: user.name,
    device: device || "TRC-BROWSER",
    profile,
    analysis,
    quality,
    analysisVersion: "trace-vision-1.0-demo",
    hash,
    signature,
    signatureAlgorithm: "Ed25519",
    integrityStatus: "INTACT",
    recordStatus: "UNCHANGED",
    verificationToken: verificationToken(evidenceId),
    simulated,
    demoLabel: simulated ? "SIMULATED DEMO DATA" : "FIELD CAPTURE (presumptive)",
    syncStatus: offline ? "pending" : "synced",
    originalImage: imageData || null,
    processedImage: imageData || null,
    packagePayload,
  };
  await getDb().collection("evidence").insertOne(record);
  const steps = [
    "Evidence captured",
    "Image validated",
    "Colour calibration completed",
    "AI analysis completed",
    "Result generated",
    "Evidence hashed",
    "Digital signature generated",
    "Evidence record finalized",
  ];
  const base = Date.now();
  await getDb().collection("audit_events").insertMany(
    steps.map((action, i) => ({
      evidenceId,
      action,
      actor: user.name,
      timestamp: new Date(base + i * 700).toISOString(),
      detail: simulated ? "SIMULATED DEMO DATA" : null,
    }))
  );
  if (offline) {
    await getDb().collection("sync_queue").insertOne({
      evidenceId,
      status: "pending",
      createdAt,
      attempts: 0,
    });
  }
  return record;
}

export function publicEvidence(record) {
  if (!record) return null;
  const { _id, packagePayload, ...rest } = record;
  return { ...rest, id: String(_id) };
}
