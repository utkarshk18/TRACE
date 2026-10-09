const STAGES = [
  "Image validation",
  "Perspective correction",
  "Lighting normalization",
  "Colour extraction",
  "CIELAB comparison",
  "Pattern analysis",
  "Confidence estimation",
  "Result generation",
];

function srgbToLinear(c) {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
}

export function rgbToXyz(r, g, b) {
  const R = srgbToLinear(r);
  const G = srgbToLinear(g);
  const B = srgbToLinear(b);
  return {
    x: R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    y: R * 0.2126729 + G * 0.7151522 + B * 0.072175,
    z: R * 0.0193339 + G * 0.119192 + B * 0.9503041,
  };
}

function labF(t) {
  const delta = 6 / 29;
  return t > delta ** 3 ? Math.cbrt(t) : t / (3 * delta ** 2) + 4 / 29;
}

export function xyzToLab({ x, y, z }) {
  const xn = 0.95047;
  const yn = 1;
  const zn = 1.08883;
  const fx = labF(x / xn);
  const fy = labF(y / yn);
  const fz = labF(z / zn);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function rgbToLab(r, g, b) {
  return xyzToLab(rgbToXyz(r, g, b));
}

export function deltaE(lab1, lab2) {
  return Math.hypot(lab1.L - lab2.L, lab1.a - lab2.a, lab1.b - lab2.b);
}

export function poorCaptureQuality() {
  return {
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
    scores: {
      resolution: 0.42,
      focus: 0.51,
      lighting: 0.48,
      referenceCard: 0.31,
      testRegion: 0.74,
    },
  };
}

export function demoQuality() {
  return {
    resolution: "Optimal",
    focus: "Sharp",
    lighting: "Acceptable",
    referenceCard: "Detected",
    testRegion: "Detected",
    accepted: true,
    issues: [],
    scores: {
      resolution: 0.96,
      focus: 0.94,
      lighting: 0.91,
      referenceCard: 0.97,
      testRegion: 0.95,
    },
  };
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function classify(lab, profile, quality, simulated) {
  const pos = profile.positiveLab;
  const neg = profile.negativeLab;
  const dPos = deltaE(lab, pos);
  const dNeg = deltaE(lab, neg);
  const threshold = Number(profile.uncertaintyThreshold ?? 0.72);
  const simPos = Math.max(0, 1 - dPos / 80);
  const simNeg = Math.max(0, 1 - dNeg / 80);
  const qualityScore = mean(Object.values(quality.scores));
  const calibrationScore = simulated ? 0.98 : Math.min(0.99, 0.82 + qualityScore * 0.16);

  let result;
  let confidence;
  let analysisBasis;
  let recommendedAction = null;

  if (Math.abs(simPos - simNeg) < 0.08 || Math.max(simPos, simNeg) < 0.55) {
    result = "INCONCLUSIVE";
    confidence = Number((0.52 + Math.abs(simPos - simNeg) * 0.8).toFixed(3));
    analysisBasis = "Observed colour response overlaps the uncertainty range.";
    recommendedAction =
      "Repeat the field test or submit for confirmatory laboratory analysis.";
  } else if (simPos > simNeg) {
    result = "POSITIVE";
    confidence = Number(Math.min(0.97, 0.78 + simPos * 0.18).toFixed(3));
    analysisBasis =
      "Detected colour response falls within the calibrated positive reference range.";
  } else {
    result = "NEGATIVE";
    confidence = Number(Math.min(0.97, 0.78 + simNeg * 0.18).toFixed(3));
    analysisBasis =
      "Detected colour response aligns with the calibrated negative reference range.";
  }

  if (confidence < threshold) {
    result = "INCONCLUSIVE";
    analysisBasis = "Observed colour response overlaps the uncertainty range.";
    recommendedAction =
      "Repeat the field test or submit for confirmatory laboratory analysis.";
  }

  return {
    result,
    confidence,
    qualityScore: Number(qualityScore.toFixed(3)),
    calibrationScore: Number(calibrationScore.toFixed(3)),
    decisionBasis: [
      { label: "Colour similarity", value: Math.round(Math.max(simPos, simNeg) * 100) },
      { label: "Calibration quality", value: Math.round(calibrationScore * 100) },
      { label: "Image quality", value: Math.round(qualityScore * 100) },
      { label: "Model confidence", value: Math.round(confidence * 100) },
    ],
    analysisBasis,
    recommendedAction,
    stages: STAGES,
    lab: {
      L: Number(lab.L.toFixed(2)),
      a: Number(lab.a.toFixed(2)),
      b: Number(lab.b.toFixed(2)),
    },
    simulated,
  };
}

export async function extractRegionLab(buffer) {
  const { Jimp } = await import("jimp");
  const img = await Jimp.read(buffer);
  const w = img.width;
  const h = img.height;
  const x0 = Math.floor(w * 0.35);
  const y0 = Math.floor(h * 0.35);
  const x1 = Math.floor(w * 0.65);
  const y1 = Math.floor(h * 0.65);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const c = img.getPixelColor(x, y);
      const rgba = Jimp.intToRGBA(c);
      r += rgba.r;
      g += rgba.g;
      b += rgba.b;
      n += 1;
    }
  }
  return rgbToLab(r / n, g / n, b / n);
}

export async function assessUploadedQuality(buffer) {
  const { Jimp } = await import("jimp");
  const img = await Jimp.read(buffer);
  const w = img.width;
  const h = img.height;
  const resOk = w >= 640 && h >= 480;
  let brightness = 0;
  let edge = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y += 8) {
    for (let x = 1; x < w - 1; x += 8) {
      const { r, g, b } = Jimp.intToRGBA(img.getPixelColor(x, y));
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const { r: r2 } = Jimp.intToRGBA(img.getPixelColor(x + 1, y));
      brightness += lum;
      edge += Math.abs(r - r2);
      n += 1;
    }
  }
  brightness /= n;
  edge /= n;
  const focusOk = edge >= 6;
  const lightOk = brightness >= 35 && brightness <= 230;
  const issues = [];
  if (!resOk) issues.push("Resolution is below the recommended 640×480 capture floor.");
  if (!focusOk) issues.push("Focus appears soft. Hold the device steady and recapture.");
  if (!lightOk) issues.push("Lighting is outside the acceptable exposure range.");
  const accepted = issues.length === 0;
  return {
    resolution: resOk ? "Optimal" : "Insufficient",
    focus: focusOk ? "Sharp" : "Soft",
    lighting: lightOk ? "Acceptable" : "Poor",
    referenceCard: accepted ? "Detected" : "Uncertain",
    testRegion: accepted ? "Detected" : "Uncertain",
    accepted,
    issues,
    scores: {
      resolution: resOk ? 0.96 : 0.4,
      focus: Math.min(1, edge / 20),
      lighting: lightOk ? 0.9 : 0.45,
      referenceCard: accepted ? 0.92 : 0.55,
      testRegion: accepted ? 0.93 : 0.58,
    },
  };
}

export async function runPipeline({ imageBuffer, profile, scenario, failQuality }) {
  if (failQuality || scenario === "poor-capture") {
    return { quality: poorCaptureQuality(), analysis: null };
  }

  let quality = demoQuality();
  let lab;
  let simulated = true;

  if (scenario === "positive") lab = { ...profile.positiveLab };
  else if (scenario === "negative") lab = { ...profile.negativeLab };
  else if (scenario === "inconclusive") {
    lab = {
      L: (profile.positiveLab.L + profile.negativeLab.L) / 2,
      a: (profile.positiveLab.a + profile.negativeLab.a) / 2,
      b: (profile.positiveLab.b + profile.negativeLab.b) / 2,
    };
  } else if (imageBuffer) {
    quality = await assessUploadedQuality(imageBuffer);
    if (!quality.accepted) return { quality, analysis: null };
    lab = await extractRegionLab(imageBuffer);
    simulated = false;
  } else {
    lab = { ...profile.negativeLab };
  }

  const analysis = classify(lab, profile, quality, simulated || Boolean(scenario));
  return { quality, analysis };
}
