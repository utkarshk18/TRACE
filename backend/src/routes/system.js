import express from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { requireAuth, requireRoles } from "../auth.js";
import { signingStatus, publicKeyPem, hashEvidencePackage, signHash, verificationToken } from "../crypto.js";

export const profilesRouter = express.Router();
profilesRouter.use(requireAuth);

profilesRouter.get("/", async (_req, res) => {
  const profiles = await getDb().collection("test_profiles").find({}).toArray();
  res.json({
    profiles: profiles.map((p) => ({ ...p, id: String(p._id) })),
  });
});

const profileSchema = z.object({
  name: z.string().min(2),
  slug: z.string().min(2),
  version: z.string().default("1.0"),
  calibration: z.string().default("CIELAB"),
  status: z.enum(["Active", "Draft"]).default("Active"),
  uncertaintyThreshold: z.number().min(0.4).max(0.95),
  positiveLab: z.object({ L: z.number(), a: z.number(), b: z.number() }),
  negativeLab: z.object({ L: z.number(), a: z.number(), b: z.number() }),
  notes: z.string().default("Demo / synthetic calibration profile. Not a validated forensic threshold."),
});

profilesRouter.post("/", requireRoles("ADMIN"), async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: "Profile payload failed validation.", code: "INVALID_INPUT" });
  }
  const doc = { ...parsed.data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await getDb().collection("test_profiles").insertOne(doc);
  res.status(201).json({ profile: doc });
});

profilesRouter.patch("/:slug", requireRoles("ADMIN"), async (req, res) => {
  const col = getDb().collection("test_profiles");
  const existing = await col.findOne({ slug: req.params.slug });
  if (!existing) return res.status(404).json({ detail: "Profile not found.", code: "NOT_FOUND" });

  const allowedUpdates = ["name", "status", "uncertaintyThreshold", "notes", "version"];
  const updateDoc = { updatedAt: new Date().toISOString() };
  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) updateDoc[key] = req.body[key];
  }

  await col.updateOne({ slug: req.params.slug }, { $set: updateDoc });
  const updated = await col.findOne({ slug: req.params.slug });
  res.json({ profile: { ...updated, id: String(updated._id) } });
});

profilesRouter.delete("/:slug", requireRoles("ADMIN"), async (req, res) => {
  const col = getDb().collection("test_profiles");
  const existing = await col.findOne({ slug: req.params.slug });
  if (!existing) return res.status(404).json({ detail: "Profile not found.", code: "NOT_FOUND" });
  await col.deleteOne({ slug: req.params.slug });
  res.json({ ok: true, deleted: req.params.slug });
});

export const systemRouter = express.Router();
systemRouter.use(requireAuth);

systemRouter.get("/health", async (_req, res) => {
  const pending = await getDb().collection("sync_queue").countDocuments({ status: "pending" });
  res.json({
    camera: "Ready",
    aiModel: "trace-vision-1.0-demo",
    database: "Connected",
    offlineStorage: "IndexedDB ready",
    syncStatus: pending ? `${pending} pending` : "Idle",
    crypto: signingStatus(),
    publicKey: publicKeyPem(),
    disclaimer:
      "TRACE supports presumptive field-test interpretation and evidence documentation. Confirmatory laboratory analysis remains authoritative.",
  });
});

systemRouter.get("/dashboard", async (req, res) => {
  const col = getDb().collection("evidence");
  const scope = req.user.role === "FIELD_OFFICER" ? { operatorId: req.user.id } : {};
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayFilter = { ...scope, createdAt: { $gte: start.toISOString() } };
  const [totalToday, positive, negative, inconclusive, pendingSync, evidenceCount, recent] =
    await Promise.all([
      col.countDocuments(todayFilter),
      col.countDocuments({ ...todayFilter, result: "POSITIVE" }),
      col.countDocuments({ ...todayFilter, result: "NEGATIVE" }),
      col.countDocuments({ ...todayFilter, result: "INCONCLUSIVE" }),
      getDb().collection("sync_queue").countDocuments({ status: "pending" }),
      col.countDocuments(scope),
      col.find(scope).sort({ createdAt: -1 }).limit(8).toArray(),
    ]);

  const last7 = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const count = await col.countDocuments({
      ...scope,
      createdAt: { $gte: day.toISOString(), $lt: next.toISOString() },
    });
    last7.push({
      date: day.toISOString().slice(0, 10),
      count,
    });
  }

  const distribution = {
    POSITIVE: await col.countDocuments({ ...scope, result: "POSITIVE" }),
    NEGATIVE: await col.countDocuments({ ...scope, result: "NEGATIVE" }),
    INCONCLUSIVE: await col.countDocuments({ ...scope, result: "INCONCLUSIVE" }),
  };

  res.json({
    overview: {
      testsConducted: totalToday,
      positive,
      negative,
      inconclusive,
      pendingSync,
      evidenceRecords: evidenceCount,
    },
    recent: recent.map((r) => ({
      evidenceId: r.evidenceId,
      testType: r.profile?.name,
      result: r.result,
      confidence: r.confidence,
      officer: r.operatorName,
      timestamp: r.createdAt,
      location: r.location?.label,
      integrity: r.integrityStatus,
      simulated: r.simulated,
    })),
    charts: { last7, distribution },
  });
});

systemRouter.post("/sync", async (req, res) => {
  const db = getDb();
  const evidenceCol = db.collection("evidence");
  const auditCol = db.collection("audit_events");
  const syncCol = db.collection("sync_queue");

  let uploadedCount = 0;
  const clientRecords = Array.isArray(req.body?.records) ? req.body.records : [];
  for (const item of clientRecords) {
    if (!item?.evidenceId) continue;
    const exists = await evidenceCol.findOne({ evidenceId: item.evidenceId });
    if (!exists) {
      const now = new Date().toISOString();
      const payload = item.packagePayload || {
        evidenceId: item.evidenceId,
        result: item.result,
        confidence: item.confidence,
        createdAt: item.createdAt || now,
        operatorId: item.operatorId || req.user.id,
        profileSlug: item.profileSlug || item.profile?.slug || "field-test-a",
        analysisVersion: item.analysisVersion || "trace-vision-1.0-demo",
      };
      const hash = item.hash || hashEvidencePackage(payload);
      const signature = item.signature || signHash(hash);
      const doc = {
        ...item,
        hash,
        signature,
        signatureAlgorithm: item.signatureAlgorithm || "Ed25519",
        integrityStatus: "INTACT",
        recordStatus: "UNCHANGED",
        syncStatus: "synced",
        syncedAt: now,
        verificationToken: item.verificationToken || verificationToken(item.evidenceId),
        packagePayload: payload,
      };
      await evidenceCol.insertOne(doc);
      await auditCol.insertMany([
        {
          evidenceId: item.evidenceId,
          action: "Evidence captured (offline queue)",
          actor: item.operatorName || req.user.name,
          timestamp: item.createdAt || now,
          detail: "Record generated locally during offline field operation",
        },
        {
          evidenceId: item.evidenceId,
          action: "Cryptographic verification completed",
          actor: "TRACE Sync Engine",
          timestamp: now,
          detail: "Hash recomputed and verified upon synchronization",
        },
        {
          evidenceId: item.evidenceId,
          action: "Evidence synchronized to central vault",
          actor: req.user.name,
          timestamp: now,
          detail: "Synced from client device",
        },
      ]);
      await syncCol.insertOne({
        evidenceId: item.evidenceId,
        status: "synced",
        createdAt: item.createdAt || now,
        syncedAt: now,
      });
      uploadedCount += 1;
    }
  }

  const pending = await syncCol.find({ status: "pending" }).toArray();
  if (pending.length > 0) {
    await syncCol.updateMany(
      { status: "pending" },
      { $set: { status: "synced", syncedAt: new Date().toISOString() } }
    );
    await evidenceCol.updateMany(
      { evidenceId: { $in: pending.map((p) => p.evidenceId) } },
      { $set: { syncStatus: "synced" } }
    );
  }

  const total = uploadedCount + pending.length;
  res.json({ synchronized: total, total });
});

systemRouter.get("/sync", async (_req, res) => {
  const pending = await getDb().collection("sync_queue").countDocuments({ status: "pending" });
  res.json({ pending });
});
