import express from "express";
import { z } from "zod";
import { getDb } from "../db.js";
import { requireAuth, requireRoles } from "../auth.js";
import { hashEvidencePackage, verifySignature, verificationToken } from "../crypto.js";
import { publicEvidence } from "../evidence.js";

export const verifyRouter = express.Router();

const bodySchema = z.object({
  evidenceId: z.string().optional(),
  verificationToken: z.string().optional(),
  package: z.record(z.any()).optional(),
});

verifyRouter.post("/", requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: "Provide an evidence ID, QR token, or package.", code: "INVALID_INPUT" });
  }
  const { evidenceId, verificationToken: token, package: pkg } = parsed.data;
  let record = null;
  if (evidenceId) {
    record = await getDb().collection("evidence").findOne({ evidenceId: evidenceId.trim() });
  } else if (token) {
    record = await getDb().collection("evidence").findOne({ verificationToken: token.trim() });
  } else if (pkg?.evidenceId) {
    record = await getDb().collection("evidence").findOne({ evidenceId: pkg.evidenceId });
  }
  if (!record) {
    return res.status(404).json({
      verified: false,
      headline: "INTEGRITY WARNING",
      message: "No matching evidence record was found. Do not treat this record as verified.",
      code: "NOT_FOUND",
    });
  }
  if (req.user.role === "FIELD_OFFICER" && record.operatorId !== req.user.id) {
    return res.status(403).json({ detail: "You cannot verify another officer's record.", code: "FORBIDDEN" });
  }

  let hashMatch = hashEvidencePackage(record.packagePayload) === record.hash;
  let signatureValid = verifySignature(record.hash, record.signature);
  if (pkg) {
    const incomingHash = hashEvidencePackage({
      evidenceId: pkg.evidenceId,
      result: pkg.result,
      confidence: pkg.confidence,
      createdAt: pkg.createdAt,
      operatorId: pkg.operatorId,
      profileSlug: pkg.profileSlug,
      analysisVersion: pkg.analysisVersion,
    });
    hashMatch = incomingHash === record.hash && pkg.hash === record.hash;
  }

  const intact = hashMatch && signatureValid;
  await getDb().collection("verification_events").insertOne({
    evidenceId: record.evidenceId,
    actor: req.user.name,
    timestamp: new Date().toISOString(),
    intact,
    method: evidenceId ? "id" : token ? "qr" : "package",
  });

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
    algorithm: "Ed25519",
    evidence: publicEvidence(record),
    qrToken: verificationToken(record.evidenceId),
  });
});

export const auditRouter = express.Router();
auditRouter.use(requireAuth, requireRoles("SUPERVISOR", "ADMIN", "FIELD_OFFICER"));

auditRouter.get("/:evidenceId", async (req, res) => {
  const events = await getDb()
    .collection("audit_events")
    .find({ evidenceId: req.params.evidenceId })
    .sort({ timestamp: 1 })
    .toArray();
  res.json({ evidenceId: req.params.evidenceId, events });
});

auditRouter.get("/", async (req, res) => {
  if (req.user.role === "FIELD_OFFICER") {
    const mine = await getDb()
      .collection("evidence")
      .find({ operatorId: req.user.id })
      .project({ evidenceId: 1 })
      .toArray();
    const ids = mine.map((e) => e.evidenceId);
    const events = await getDb()
      .collection("audit_events")
      .find({ evidenceId: { $in: ids } })
      .sort({ timestamp: -1 })
      .limit(200)
      .toArray();
    return res.json({ events });
  }
  const events = await getDb()
    .collection("audit_events")
    .find({})
    .sort({ timestamp: -1 })
    .limit(300)
    .toArray();
  res.json({ events });
});
