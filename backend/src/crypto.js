import crypto from "node:crypto";
import { config } from "./config.js";

let keyPair;

function loadKeys() {
  if (keyPair) return keyPair;
  if (config.signingPrivateKey.trim()) {
    const privateKey = crypto.createPrivateKey(config.signingPrivateKey);
    const publicKey = config.signingPublicKey.trim()
      ? crypto.createPublicKey(config.signingPublicKey)
      : crypto.createPublicKey(privateKey);
    keyPair = { privateKey, publicKey, demoGenerated: false };
    return keyPair;
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  keyPair = { privateKey, publicKey, demoGenerated: true };
  return keyPair;
}

export function canonicalJson(payload) {
  return Buffer.from(JSON.stringify(payload, Object.keys(payload).sort()), "utf8");
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function hashEvidencePackage(payload) {
  const json = JSON.stringify(payload, Object.keys(payload).sort());
  return sha256Hex(Buffer.from(json, "utf8"));
}

export function signHash(digestHex) {
  const { privateKey } = loadKeys();
  const sig = crypto.sign(null, Buffer.from(digestHex, "hex"), privateKey);
  return sig.toString("base64");
}

export function verifySignature(digestHex, signatureB64) {
  try {
    const { publicKey } = loadKeys();
    return crypto.verify(
      null,
      Buffer.from(digestHex, "hex"),
      publicKey,
      Buffer.from(signatureB64, "base64")
    );
  } catch {
    return false;
  }
}

export function publicKeyPem() {
  const { publicKey } = loadKeys();
  return publicKey.export({ type: "spki", format: "pem" });
}

export function signingStatus() {
  const keys = loadKeys();
  return {
    algorithm: "Ed25519",
    hashAlgorithm: "SHA-256",
    demoGeneratedKeys: keys.demoGenerated,
  };
}

export function randomToken(bytes = 16) {
  return crypto.randomBytes(bytes).toString("hex");
}

export function verificationToken(evidenceId) {
  return crypto.createHash("sha256").update(`trace-verify:${evidenceId}`).digest("hex").slice(0, 24);
}
