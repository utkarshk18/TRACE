import express from "express";
import { getDb } from "../db.js";
import { requireAuth, requireRoles } from "../auth.js";
import { publicEvidence, appendAudit } from "../evidence.js";
import { hashEvidencePackage, verifySignature } from "../crypto.js";

export const evidenceRouter = express.Router();
evidenceRouter.use(requireAuth);

function canView(user, record) {
  if (user.role === "ADMIN" || user.role === "SUPERVISOR") return true;
  return record.operatorId === user.id;
}

evidenceRouter.get("/", async (req, res) => {
  const {
    q,
    result,
    officer,
    location,
    integrity,
    from,
    to,
    sort = "createdAt",
    dir = "desc",
    page = "1",
    pageSize = "10",
  } = req.query;
  const filter = {};
  if (req.user.role === "FIELD_OFFICER") filter.operatorId = req.user.id;
  if (result && result !== "ALL") filter.result = result;
  if (integrity && integrity !== "ALL") filter.integrityStatus = integrity;
  if (officer) filter.operatorName = { $regex: String(officer), $options: "i" };
  if (location) filter["location.label"] = { $regex: String(location), $options: "i" };
  if (q) {
    filter.$or = [
      { evidenceId: { $regex: String(q), $options: "i" } },
      { operatorName: { $regex: String(q), $options: "i" } },
      { "location.label": { $regex: String(q), $options: "i" } },
    ];
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = String(from);
    if (to) filter.createdAt.$lte = String(to);
  }
  const pageN = Math.max(1, Number(page));
  const sizeN = Math.min(50, Math.max(1, Number(pageSize)));
  const sortSpec = { [sort]: dir === "asc" ? 1 : -1 };
  const col = getDb().collection("evidence");
  const total = await col.countDocuments(filter);
  const rows = await col
    .find(filter)
    .sort(sortSpec)
    .skip((pageN - 1) * sizeN)
    .limit(sizeN)
    .toArray();
  res.json({
    total,
    page: pageN,
    pageSize: sizeN,
    records: rows.filter((r) => canView(req.user, r)).map(publicEvidence),
  });
});

evidenceRouter.get("/:id", async (req, res) => {
  const record = await getDb().collection("evidence").findOne({ evidenceId: req.params.id });
  if (!record) return res.status(404).json({ detail: "Evidence not found.", code: "NOT_FOUND" });
  if (!canView(req.user, record)) {
    return res.status(403).json({ detail: "You cannot view this evidence record.", code: "FORBIDDEN" });
  }
  const audit = await getDb()
    .collection("audit_events")
    .find({ evidenceId: record.evidenceId })
    .sort({ timestamp: 1 })
    .toArray();
  res.json({ evidence: publicEvidence(record), audit });
});

evidenceRouter.post("/:id/verify", async (req, res) => {
  const record = await getDb().collection("evidence").findOne({ evidenceId: req.params.id });
  if (!record) return res.status(404).json({ detail: "Evidence not found.", code: "NOT_FOUND" });
  const recomputed = hashEvidencePackage(record.packagePayload);
  const hashMatch = recomputed === record.hash;
  const signatureValid = verifySignature(record.hash, record.signature);
  const intact = hashMatch && signatureValid;
  const event = {
    evidenceId: record.evidenceId,
    actor: req.user.name,
    timestamp: new Date().toISOString(),
    intact,
    hashMatch,
    signatureValid,
  };
  await getDb().collection("verification_events").insertOne(event);
  await appendAudit(
    record.evidenceId,
    intact ? "Cryptographic verification succeeded" : "Integrity warning issued",
    req.user.name
  );
  if (!intact) {
    return res.status(409).json({
      verified: false,
      headline: "INTEGRITY WARNING",
      message:
        "The supplied evidence does not match the original cryptographic record. Do not treat this record as verified.",
      evidenceId: record.evidenceId,
      integrity: "TAMPERED",
      signature: signatureValid ? "VALID" : "INVALID",
      timestamp: "VALID",
      recordStatus: "CHANGED",
      hashMatch,
    });
  }
  res.json({
    verified: true,
    headline: "EVIDENCE VERIFIED",
    evidenceId: record.evidenceId,
    integrity: "VALID",
    signature: "VALID",
    timestamp: "VALID",
    recordStatus: "UNCHANGED",
    hashMatch,
    algorithm: "Ed25519",
  });
});

evidenceRouter.post("/:id/sign", requireRoles("SUPERVISOR", "ADMIN"), async (req, res) => {
  const col = getDb().collection("evidence");
  const record = await col.findOne({ evidenceId: req.params.id });
  if (!record) return res.status(404).json({ detail: "Evidence not found.", code: "NOT_FOUND" });
  
  const now = new Date().toISOString();
  await col.updateOne(
    { evidenceId: record.evidenceId },
    {
      $set: {
        countersigned: true,
        countersignedBy: req.user.name,
        countersignedByRole: req.user.role,
        countersignedAt: now,
      },
    }
  );
  await appendAudit(
    record.evidenceId,
    "Supervisor countersignature recorded",
    req.user.name,
    `Endorsement recorded by ${req.user.name} (${req.user.role.replace("_", " ")})`
  );
  const updated = await col.findOne({ evidenceId: record.evidenceId });
  res.json({ ok: true, evidence: publicEvidence(updated) });
});
