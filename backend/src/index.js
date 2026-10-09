import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { connectDb } from "./db.js";
import { seedIfEmpty } from "./seed.js";
import { authRouter, usersRouter } from "./routes/auth.js";
import { testsRouter } from "./routes/tests.js";
import { evidenceRouter } from "./routes/evidence.js";
import { verifyRouter, auditRouter } from "./routes/verify.js";
import { profilesRouter, systemRouter } from "./routes/system.js";
import { signingStatus } from "./crypto.js";

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = config.corsOrigin.split(",").map((s) => s.trim());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (
        allowedOrigins.includes(origin) ||
        allowedOrigins.includes("*") ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(null, true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 1000,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "TRACE API", crypto: signingStatus() });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/tests", testsRouter);
app.use("/evidence", evidenceRouter);
app.use("/verify", verifyRouter);
app.use("/audit", auditRouter);
app.use("/profiles", profilesRouter);
app.use("/system", systemRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({
    detail: "An unexpected error occurred. The action was not completed.",
    code: "INTERNAL",
  });
});

async function start() {
  try {
    await connectDb();
    const seeded = await seedIfEmpty();
    const server = app.listen(config.port, config.host, () => {
      console.log(`TRACE API listening on http://${config.host === "0.0.0.0" ? "localhost" : config.host}:${config.port}`);
      if (seeded.seeded) console.log("Demo data seeded.");
    });
    server.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
  } catch (error) {
    const message =
      error?.code === 8000 ||
      (error instanceof Error && /bad auth|authentication failed/i.test(error.message))
        ? "MongoDB rejected the credentials. Check the MongoDB Database Access username and password in backend/.env; do not use your Atlas website login."
        : error instanceof Error
          ? error.message
          : String(error);
    console.error(
      "Failed to initialize TRACE API:",
      message
    );
    process.exitCode = 1;
  }
}

start();

export { app, start };
