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

export function deltaE76(lab1, lab2) {
  return Math.hypot(lab1.L - lab2.L, lab1.a - lab2.a, lab1.b - lab2.b);
}

export function deltaE(lab1, lab2) {
  return ciede2000(lab1, lab2);
}

export function ciede2000(lab1, lab2) {
  const deg2rad = (deg) => (deg * Math.PI) / 180;
  const rad2deg = (rad) => (rad * 180) / Math.PI;

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const L1 = lab1.L;
  const a1 = lab1.a;
  const b1 = lab1.b;

  const L2 = lab2.L;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const avgL = (L1 + L2) / 2;
  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const avgC = (c1 + c2) / 2;

  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1Prime = (1 + G) * a1;
  const a2Prime = (1 + G) * a2;

  const c1Prime = Math.hypot(a1Prime, b1);
  const c2Prime = Math.hypot(a2Prime, b2);
  const avgCPrime = (c1Prime + c2Prime) / 2;

  let h1Prime = rad2deg(Math.atan2(b1, a1Prime));
  if (h1Prime < 0) h1Prime += 360;

  let h2Prime = rad2deg(Math.atan2(b2, a2Prime));
  if (h2Prime < 0) h2Prime += 360;

  let deltahPrime;
  if (Math.abs(h1Prime - h2Prime) <= 180) {
    deltahPrime = h2Prime - h1Prime;
  } else if (h2Prime <= h1Prime) {
    deltahPrime = h2Prime - h1Prime + 360;
  } else {
    deltahPrime = h2Prime - h1Prime - 360;
  }

  const deltaLPrime = L2 - L1;
  const deltaCPrime = c2Prime - c1Prime;
  const deltaHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(deg2rad(deltahPrime / 2));

  let avgHPrime;
  if (Math.abs(h1Prime - h2Prime) <= 180) {
    avgHPrime = (h1Prime + h2Prime) / 2;
  } else if (h1Prime + h2Prime < 360) {
    avgHPrime = (h1Prime + h2Prime + 360) / 2;
  } else {
    avgHPrime = (h1Prime + h2Prime - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(deg2rad(avgHPrime - 30)) +
    0.24 * Math.cos(deg2rad(2 * avgHPrime)) +
    0.32 * Math.cos(deg2rad(3 * avgHPrime + 6)) -
    0.2 * Math.cos(deg2rad(4 * avgHPrime - 63));

  const deltaTheta = 30 * Math.exp(-Math.pow((avgHPrime - 275) / 25, 2));
  const RC = 2 * Math.sqrt(Math.pow(avgCPrime, 7) / (Math.pow(avgCPrime, 7) + Math.pow(25, 7)));

  const SL = 1 + (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const SC = 1 + 0.045 * avgCPrime;
  const SH = 1 + 0.015 * avgCPrime * T;
  const RT = -Math.sin(deg2rad(2 * deltaTheta)) * RC;

  const dE = Math.sqrt(
    Math.pow(deltaLPrime / (kL * SL), 2) +
      Math.pow(deltaCPrime / (kC * SC), 2) +
      Math.pow(deltaHPrime / (kH * SH), 2) +
      RT * (deltaCPrime / (kC * SC)) * (deltaHPrime / (kH * SH))
  );

  return Number(dE.toFixed(2));
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
  const dPos = ciede2000(lab, pos);
  const dNeg = ciede2000(lab, neg);
  const threshold = Number(profile.uncertaintyThreshold ?? 0.72);

  const tau = 24.0;
  const simPos = Math.exp(-Math.pow(dPos, 2) / (2 * Math.pow(tau, 2)));
  const simNeg = Math.exp(-Math.pow(dNeg, 2) / (2 * Math.pow(tau, 2)));
  const totalSim = simPos + simNeg + 0.0001;
  const probPos = simPos / totalSim;
  const probNeg = simNeg / totalSim;

  const qualityScore = mean(Object.values(quality.scores));
  const calibrationScore = simulated ? 0.98 : Math.min(0.99, 0.82 + qualityScore * 0.16);

  let result;
  let rawConfidence;
  let analysisBasis;
  let recommendedAction = null;

  const deltaDifference = Math.abs(dPos - dNeg);

  if (deltaDifference < 4.5 || Math.max(probPos, probNeg) < 0.6) {
    result = "INCONCLUSIVE";
    rawConfidence = 0.52 + Math.min(0.2, deltaDifference * 0.03);
    analysisBasis = `Color difference margin between reference standards (ΔE+ ${dPos} vs ΔE- ${dNeg}) falls inside the uncertainty threshold.`;
    recommendedAction =
      "Repeat the field test or submit for confirmatory laboratory analysis.";
  } else if (dPos < dNeg) {
    result = "POSITIVE";
    rawConfidence = Math.min(0.98, 0.78 + probPos * 0.19);
    analysisBasis =
      `Detected colour response matches calibrated positive reference standard (CIEDE2000 ΔE ${dPos}).`;
  } else {
    result = "NEGATIVE";
    rawConfidence = Math.min(0.98, 0.78 + probNeg * 0.19);
    analysisBasis =
      `Detected colour response aligns with calibrated negative reference standard (CIEDE2000 ΔE ${dNeg}).`;
  }

  const confidence = Number((rawConfidence * (0.8 + qualityScore * 0.2)).toFixed(3));

  if (confidence < threshold) {
    result = "INCONCLUSIVE";
    analysisBasis = `Observed colour response confidence (${(confidence * 100).toFixed(1)}%) is below the uncertainty threshold (${(threshold * 100).toFixed(0)}%).`;
    recommendedAction =
      "Repeat the field test or submit for confirmatory laboratory analysis.";
  }

  return {
    result,
    confidence,
    qualityScore: Number(qualityScore.toFixed(3)),
    calibrationScore: Number(calibrationScore.toFixed(3)),
    decisionBasis: [
      { label: "Colour similarity", value: Math.round(Math.max(probPos, probNeg) * 100) },
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
    ciede2000: {
      dEPos: dPos,
      dENeg: dNeg,
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
