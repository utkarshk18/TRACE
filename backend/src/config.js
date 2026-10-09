import dotenv from "dotenv";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

export const config = {
  port: Number(process.env.PORT || 8000),
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "mongodb://localhost:27017",
  mongodbDnsFallbackServers: (process.env.MONGODB_DNS_FALLBACK_SERVERS || "1.1.1.1,8.8.8.8")
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server && isIP(server)),
  dbName: process.env.MONGODB_DB || "trace",
  jwtSecret: process.env.JWT_SECRET || "trace-demo-jwt-secret-change-in-production",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  signingPrivateKey: process.env.SIGNING_PRIVATE_KEY || "",
  signingPublicKey: process.env.SIGNING_PUBLIC_KEY || "",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  demoMode: String(process.env.DEMO_MODE || "true") === "true",
};
