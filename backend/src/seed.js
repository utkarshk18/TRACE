import bcrypt from "bcryptjs";
import { connectDb } from "./db.js";
import { hashEvidencePackage, signHash, verificationToken } from "./crypto.js";

const DEMO_PASSWORD = "TraceDemo!2026";

export const DEMO_PROFILES = [
  {
    slug: "field-test-a",
    name: "Field Test A (Demo)",
    version: "1.0",
    calibration: "CIELAB",
    status: "Active",
    uncertaintyThreshold: 0.72,
    positiveLab: { L: 48.2, a: 42.1, b: 18.6 },
    negativeLab: { L: 82.4, a: 4.2, b: 12.1 },
    notes: "Demo / synthetic calibration profile. Not a validated forensic threshold.",
  },
  {
    slug: "field-test-b",
    name: "Field Test B (Demo)",
    version: "1.1",
    calibration: "CIELAB",
    status: "Active",
    uncertaintyThreshold: 0.7,
    positiveLab: { L: 36.8, a: 12.4, b: 38.9 },
    negativeLab: { L: 78.1, a: -2.1, b: 8.4 },
    notes: "Demo / synthetic calibration profile. Not a validated forensic threshold.",
  },
];

function iso(offsetHours) {
  return new Date(Date.now() - offsetHours * 3600 * 1000).toISOString();
}

export async function seedIfEmpty() {
  const db = await connectDb();
  const users = db.collection("users");
  if ((await users.countDocuments()) > 0) return { seeded: false };

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const now = new Date().toISOString();
  const userDocs = [
    {
      name: "Asha Menon",
      email: "officer@trace.demo",
      passwordHash,
      role: "FIELD_OFFICER",
      unit: "North Field Unit",
      active: true,
      createdAt: now,
    },
    {
      name: "Ravi Kapoor",
      email: "supervisor@trace.demo",
      passwordHash,
      role: "SUPERVISOR",
      unit: "Regional Command",
      active: true,
      createdAt: now,
    },
    {
      name: "Priya Shah",
      email: "admin@trace.demo",
      passwordHash,
      role: "ADMIN",
      unit: "TRACE Operations",
      active: true,
      createdAt: now,
    },
  ];
  const inserted = await users.insertMany(userDocs);
  const officerId = String(inserted.insertedIds[0]);
  const supervisorId = String(inserted.insertedIds[1]);

  await db.collection("test_profiles").insertMany(
    DEMO_PROFILES.map((p) => ({ ...p, createdAt: now, updatedAt: now }))
  );

  await db.collection("devices").insertMany([
    {
      deviceId: "TRC-FIELD-8841",
      label: "Field Tablet 8841",
      status: "Online",
      lastSeen: now,
    },
    {
      deviceId: "TRC-FIELD-2290",
      label: "Field Phone 2290",
      status: "Offline queue",
      lastSeen: iso(6),
    },
  ]);

  const seedRecords = [
    {
      evidenceId: "TRC-2026-10-03-8F42A1",
      result: "POSITIVE",
      confidence: 0.942,
      hoursAgo: 2,
      location: { label: "Harbor Checkpoint, Sector 4", lat: 19.076, lng: 72.8777 },
      operatorId: officerId,
      operatorName: "Asha Menon",
      profileSlug: "field-test-a",
      syncStatus: "synced",
    },
    {
      evidenceId: "TRC-2026-10-03-4D19C2",
      result: "NEGATIVE",
      confidence: 0.911,
      hoursAgo: 5,
      location: { label: "West Approach Road, KM 18", lat: 18.5204, lng: 73.8567 },
      operatorId: officerId,
      operatorName: "Asha Menon",
      profileSlug: "field-test-b",
      syncStatus: "synced",
    },
    {
      evidenceId: "TRC-2026-10-02-9A77E4",
      result: "INCONCLUSIVE",
      confidence: 0.614,
      hoursAgo: 22,
      location: { label: "Riverside Lot B (synthetic demo)", lat: 13.0827, lng: 80.2707 },
      operatorId: supervisorId,
      operatorName: "Ravi Kapoor",
      profileSlug: "field-test-a",
      syncStatus: "pending",
    },
  ];

  for (const rec of seedRecords) {
    const createdAt = iso(rec.hoursAgo);
    const profile = DEMO_PROFILES.find((p) => p.slug === rec.profileSlug);
    const analysis = {
      result: rec.result,
      confidence: rec.confidence,
      qualityScore: rec.result === "INCONCLUSIVE" ? 0.71 : 0.94,
      calibrationScore: 0.98,
      decisionBasis: [
        { label: "Colour similarity", value: rec.result === "INCONCLUSIVE" ? 61 : 96 },
        { label: "Calibration quality", value: 98 },
        { label: "Image quality", value: rec.result === "INCONCLUSIVE" ? 71 : 94 },
        { label: "Model confidence", value: Math.round(rec.confidence * 100) },
      ],
      analysisBasis:
        rec.result === "POSITIVE"
          ? "Detected colour response falls within the calibrated positive reference range."
          : rec.result === "NEGATIVE"
            ? "Detected colour response aligns with the calibrated negative reference range."
            : "Observed colour response overlaps the uncertainty range.",
      recommendedAction:
        rec.result === "INCONCLUSIVE"
          ? "Repeat the field test or submit for confirmatory laboratory analysis."
          : null,
      simulated: true,
    };
    const packagePayload = {
      evidenceId: rec.evidenceId,
      result: rec.result,
      confidence: rec.confidence,
      createdAt,
      operatorId: rec.operatorId,
      profileSlug: rec.profileSlug,
      analysisVersion: "trace-vision-1.0-demo",
    };
    const hash = hashEvidencePackage(packagePayload);
    const signature = signHash(hash);
    const evidence = {
      evidenceId: rec.evidenceId,
      testId: rec.evidenceId.replace("TRC", "TST"),
      result: rec.result,
      confidence: rec.confidence,
      createdAt,
      timestamp: createdAt,
      location: rec.location,
      operatorId: rec.operatorId,
      operatorName: rec.operatorName,
      device: "TRC-FIELD-8841",
      profile,
      analysis,
      analysisVersion: "trace-vision-1.0-demo",
      hash,
      signature,
      signatureAlgorithm: "Ed25519",
      integrityStatus: "INTACT",
      recordStatus: "UNCHANGED",
      verificationToken: verificationToken(rec.evidenceId),
      simulated: true,
      demoLabel: "SIMULATED DEMO DATA",
      syncStatus: rec.syncStatus,
      originalImage: null,
      processedImage: null,
      packagePayload,
    };
    await db.collection("evidence").insertOne(evidence);
    const events = [
      [0, "Evidence captured"],
      [5, "Image validated"],
      [7, "Colour calibration completed"],
      [9, "AI analysis completed"],
      [10, "Result generated"],
      [11, "Evidence hashed"],
      [12, "Digital signature generated"],
      [13, "Evidence record finalized"],
    ];
    const base = new Date(createdAt).getTime();
    await db.collection("audit_events").insertMany(
      events.map(([sec, action]) => ({
        evidenceId: rec.evidenceId,
        action,
        actor: rec.operatorName,
        timestamp: new Date(base + sec * 1000).toISOString(),
        detail: rec.simulated !== false ? "SIMULATED DEMO DATA" : null,
      }))
    );
    if (rec.syncStatus === "pending") {
      await db.collection("sync_queue").insertOne({
        evidenceId: rec.evidenceId,
        status: "pending",
        createdAt,
        attempts: 0,
      });
    }
  }

  return { seeded: true };
}

const isMain = process.argv[1]?.includes("seed.js");
if (isMain) {
  seedIfEmpty()
    .then(async (r) => {
      console.log(r.seeded ? "Seeded TRACE demo data." : "Database already has data.");
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
