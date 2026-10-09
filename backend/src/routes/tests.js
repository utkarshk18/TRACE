import express from "express";
import multer from "multer";
import { z } from "zod";
import { getDb } from "../db.js";
import { requireAuth, requireRoles } from "../auth.js";
import { runPipeline } from "../vision.js";
import { finalizeEvidence, publicEvidence } from "../evidence.js";
import { randomBytes } from "node:crypto";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPEG, PNG, or WebP images are accepted."));
  },
});

const newTestSchema = z.object({
  profileSlug: z.string().min(1),
  demoScenario: z.enum(["positive", "negative", "inconclusive", "poor-capture"]).optional(),
  notes: z.string().max(500).optional(),
  locationLabel: z.string().max(200).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  deviceId: z.string().optional(),
  offline: z.boolean().optional(),
});

export const testsRouter = express.Router();
testsRouter.use(requireAuth);

testsRouter.post("/", requireRoles("FIELD_OFFICER", "SUPERVISOR", "ADMIN"), async (req, res) => {
  const parsed = newTestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: "Test request failed validation.", code: "INVALID_INPUT" });
  }
  const data = parsed.data;
  const profile = await getDb().collection("test_profiles").findOne({ slug: data.profileSlug });
  if (!profile) {
    return res.status(404).json({ detail: "Test profile not found.", code: "NOT_FOUND" });
  }
  const testId = `TST-${randomBytes(4).toString("hex").toUpperCase()}`;
  const test = {
    testId,
    profileSlug: profile.slug,
    status: "CAPTURE_PENDING",
    operatorId: req.user.id,
    operatorName: req.user.name,
    notes: data.notes || "",
    location: {
      label: data.locationLabel || "Demo field site",
      lat: data.latitude ?? 19.076,
      lng: data.longitude ?? 72.8777,
    },
    deviceId: data.deviceId || "TRC-BROWSER",
    demoScenario: data.demoScenario || null,
    offline: Boolean(data.offline),
    createdAt: new Date().toISOString(),
  };
  await getDb().collection("tests").insertOne(test);
  res.status(201).json({ test });
});

testsRouter.post("/:testId/capture", (req, res) => {
  const processCapture = async () => {
    try {
      const test = await getDb().collection("tests").findOne({ testId: req.params.testId });
      if (!test) return res.status(404).json({ detail: "Test not found.", code: "NOT_FOUND" });
      const scenario = req.body?.demoScenario || test.demoScenario;
      const failQuality = scenario === "poor-capture" || req.body?.failQuality === true || req.body?.failQuality === "true";
      const profile = await getDb().collection("test_profiles").findOne({ slug: test.profileSlug });
      const { quality, analysis } = await runPipeline({
        imageBuffer: req.file?.buffer,
        profile,
        scenario: failQuality ? "poor-capture" : scenario,
        failQuality,
      });
      await getDb().collection("tests").updateOne(
        { testId: test.testId },
        {
          $set: {
            status: quality.accepted ? "READY" : "CAPTURE_REJECTED",
            quality,
            lastImageMime: req.file?.mimetype || null,
          },
        }
      );
      res.json({
        accepted: quality.accepted,
        quality,
        analysisPreview: analysis,
        message: quality.accepted
          ? "READY FOR ANALYSIS"
          : "CAPTURE NOT ACCEPTED",
      });
    } catch (e) {
      res.status(500).json({ detail: e.message || "Failed to process capture", code: "INTERNAL" });
    }
  };

  if (req.is("multipart/form-data")) {
    upload.single("image")(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ detail: err.message, code: "INVALID_FILE" });
      }
      await processCapture();
    });
  } else {
    processCapture();
  }
});

testsRouter.post("/:testId/analyze", async (req, res) => {
  const test = await getDb().collection("tests").findOne({ testId: req.params.testId });
  if (!test) return res.status(404).json({ detail: "Test not found.", code: "NOT_FOUND" });
  const profile = await getDb().collection("test_profiles").findOne({ slug: test.profileSlug });
  const scenario = req.body.demoScenario || test.demoScenario;
  if (scenario === "poor-capture") {
    return res.status(422).json({
      detail: "Capture was not accepted. Retake before analysis.",
      code: "CAPTURE_REJECTED",
    });
  }
  const { quality, analysis } = await runPipeline({
    imageBuffer: null,
    profile,
    scenario,
    failQuality: false,
  });
  if (!quality.accepted || !analysis) {
    return res.status(422).json({
      detail: "Capture was not accepted. Retake before analysis.",
      code: "CAPTURE_REJECTED",
      quality,
    });
  }
  const evidence = await finalizeEvidence({
    testId: test.testId,
    profile,
    analysis,
    quality,
    user: req.user,
    location: test.location,
    device: test.deviceId,
    imageData: req.body.imageData || null,
    simulated: Boolean(scenario) || analysis.simulated,
    offline: Boolean(test.offline || req.body.offline),
  });
  await getDb().collection("tests").updateOne(
    { testId: test.testId },
    { $set: { status: "FINALIZED", evidenceId: evidence.evidenceId } }
  );
  res.json({
    testId: test.testId,
    evidence: publicEvidence(evidence),
    calibration: {
      steps: [
        "Reference card detected",
        "Camera response normalized",
        "Lighting compensation applied",
        "CIELAB conversion completed",
      ],
    },
  });
});

testsRouter.get("/:testId", async (req, res) => {
  const test = await getDb().collection("tests").findOne({ testId: req.params.testId });
  if (!test) return res.status(404).json({ detail: "Test not found.", code: "NOT_FOUND" });
  res.json({ test });
});
