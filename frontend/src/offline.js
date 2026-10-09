import { get, set, del, keys } from "idb-keyval";

const QUEUE = "trace-sync-queue";
const PROFILES_CACHE = "trace-cached-profiles";

export const DEFAULT_PROFILES = [
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

export async function queueEvidence(record) {
  const list = (await get(QUEUE)) || [];
  // Avoid duplicate queueing
  if (!list.some((item) => item.evidenceId === record.evidenceId)) {
    list.push(record);
    await set(QUEUE, list);
  }
  await set(`evidence:${record.evidenceId}`, record);
}

export async function pendingCount() {
  const list = (await get(QUEUE)) || [];
  return list.length;
}

export async function flushQueue(api) {
  const list = (await get(QUEUE)) || [];
  try {
    const res = await api("/system/sync", {
      method: "POST",
      body: JSON.stringify({ records: list }),
    });
    await set(QUEUE, []);
    return {
      synchronized: res.synchronized ?? list.length,
      total: res.total ?? list.length,
    };
  } catch {
    return { synchronized: 0, total: list.length };
  }
}

export async function cacheRecord(record) {
  await set(`evidence:${record.evidenceId}`, record);
}

export async function readCached(id) {
  return get(`evidence:${id}`);
}

export async function cachedIds() {
  const all = await keys();
  return all.filter((k) => String(k).startsWith("evidence:"));
}

export async function getAllCachedEvidence() {
  const allKeys = await keys();
  const evKeys = allKeys.filter((k) => String(k).startsWith("evidence:"));
  const records = [];
  for (const k of evKeys) {
    const r = await get(k);
    if (r) records.push(r);
  }
  return records;
}

export async function clearQueueItem() {
  await del(QUEUE);
}

export async function cacheProfiles(profiles) {
  if (Array.isArray(profiles) && profiles.length) {
    await set(PROFILES_CACHE, profiles);
  }
}

export async function getCachedProfiles() {
  const cached = await get(PROFILES_CACHE);
  if (Array.isArray(cached) && cached.length) return cached;
  return DEFAULT_PROFILES;
}

export async function sha256HexWeb(text) {
  const buffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
