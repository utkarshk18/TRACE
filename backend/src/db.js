import dns from "node:dns";
import { MongoClient } from "mongodb";
import { config } from "./config.js";

let client;
let db;
let memoryServer;

function canUseMemoryFallback(uri) {
  if (config.demoMode) return true;
  try {
    const parsed = new URL(uri);
    return (
      parsed.protocol === "mongodb:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase()) &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

function hasPlaceholderCredentials(uri) {
  const parsed = new URL(uri);
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  return /[<>]/.test(username) || /[<>]/.test(password);
}

async function resolveAtlasSrv(uri) {
  const parsed = new URL(uri);
  if (parsed.protocol !== "mongodb+srv:") return;

  const srvRecord = `_mongodb._tcp.${parsed.hostname}`;
  try {
    await dns.promises.resolveSrv(srvRecord);
  } catch (error) {
    if (
      !["ECONNREFUSED", "ESERVFAIL", "ETIMEOUT"].includes(error?.code) ||
      config.mongodbDnsFallbackServers.length === 0
    ) {
      throw error;
    }

    dns.setServers(config.mongodbDnsFallbackServers);
    await dns.promises.resolveSrv(srvRecord);
    console.warn(
      `Atlas SRV lookup required fallback DNS (${config.mongodbDnsFallbackServers.join(", ")}).`
    );
  }
}

export async function connectDb() {
  if (db) return db;
  if (
    config.databaseUrl.startsWith("mongodb+srv://") &&
    hasPlaceholderCredentials(config.databaseUrl)
  ) {
    throw new Error(
      "DATABASE_URL contains placeholder credentials. Replace the <...> username/password placeholders with a MongoDB Database Access user's real credentials."
    );
  }
  // 1. Try local MongoDB first if active (instant 5ms connection, 100% reliable)
  try {
    const localTimeout = { serverSelectionTimeoutMS: 500, connectTimeoutMS: 800 };
    client = new MongoClient("mongodb://localhost:27017", localTimeout);
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log("Connected to local MongoDB instance on port 27017 (optimal speed).");
  } catch {
    // 2. Fall back to configured DATABASE_URL (Atlas / remote)
    const timeout = { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000 };
    try {
      await resolveAtlasSrv(config.databaseUrl);
      client = new MongoClient(config.databaseUrl, timeout);
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      console.log("Connected to remote MongoDB Atlas cluster.");
    } catch (error) {
      if (!canUseMemoryFallback(config.databaseUrl)) throw error;
      console.warn(`Remote MongoDB connection failed (${error.message}) — attempting in-memory fallback engine.`);
      let MongoMemoryServer;
      try {
        ({ MongoMemoryServer } = await import("mongodb-memory-server"));
      } catch {
        throw new Error(
          "No MongoDB connection available and mongodb-memory-server is not installed. " +
          "Set DATABASE_URL to a valid MongoDB URI or install mongodb-memory-server as a dev dependency."
        );
      }
      memoryServer = await MongoMemoryServer.create();
      client = new MongoClient(memoryServer.getUri(), timeout);
      await client.connect();
      console.warn("Using in-memory MongoDB for this session.");
    }
  }
  db = client.db(config.dbName);
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("users").createIndex({ role: 1 });
  await db.collection("evidence").createIndex({ evidenceId: 1 }, { unique: true });
  await db.collection("evidence").createIndex({ operatorId: 1 });
  await db.collection("evidence").createIndex({ createdAt: -1 });
  await db.collection("evidence").createIndex({ result: 1 });
  await db.collection("tests").createIndex({ testId: 1 }, { unique: true });
  await db.collection("audit_events").createIndex({ evidenceId: 1, timestamp: 1 });
  await db.collection("verification_events").createIndex({ evidenceId: 1 });
  await db.collection("sync_queue").createIndex({ status: 1 });
  await db.collection("test_profiles").createIndex({ slug: 1 }, { unique: true });
  await db.collection("devices").createIndex({ deviceId: 1 }, { unique: true });
  return db;
}

export function getDb() {
  if (!db) throw new Error("Database not connected");
  return db;
}
