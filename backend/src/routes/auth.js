import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { ObjectId } from "mongodb";
import { getDb } from "../db.js";
import { requireAuth, requireRoles, signToken } from "../auth.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(4).max(128),
});

const userSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["FIELD_OFFICER", "SUPERVISOR", "ADMIN"]),
  unit: z.string().min(2).default("Field Unit"),
});

export const authRouter = express.Router();

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: "Enter a valid email and password.", code: "INVALID_INPUT" });
  }
  const { email, password } = parsed.data;
  const user = await getDb().collection("users").findOne({ email: email.toLowerCase() });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ detail: "Those credentials were not recognised.", code: "INVALID_CREDENTIALS" });
  }
  if (user.active === false) {
    return res.status(403).json({ detail: "This account is disabled.", code: "DISABLED" });
  }
  const safe = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    unit: user.unit,
  };
  return res.json({ accessToken: signToken(safe), tokenType: "bearer", user: safe });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export const usersRouter = express.Router();
usersRouter.use(requireAuth, requireRoles("ADMIN"));

usersRouter.get("/", async (_req, res) => {
  const users = await getDb()
    .collection("users")
    .find({}, { projection: { passwordHash: 0 } })
    .toArray();
  res.json({
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      role: u.role,
      unit: u.unit,
      active: u.active !== false,
    })),
  });
});

usersRouter.post("/", async (req, res) => {
  const parsed = userSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ detail: "User payload failed validation.", code: "INVALID_INPUT" });
  }
  const data = parsed.data;
  const existing = await getDb().collection("users").findOne({ email: data.email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ detail: "A user with that email already exists.", code: "CONFLICT" });
  }
  const doc = {
    name: data.name,
    email: data.email.toLowerCase(),
    passwordHash: await bcrypt.hash(data.password, 10),
    role: data.role,
    unit: data.unit,
    active: true,
    createdAt: new Date().toISOString(),
  };
  const result = await getDb().collection("users").insertOne(doc);
  res.status(201).json({
    user: {
      id: String(result.insertedId),
      name: doc.name,
      email: doc.email,
      role: doc.role,
      unit: doc.unit,
      active: true,
    },
  });
});

usersRouter.patch("/:id", async (req, res) => {
  let _id;
  try {
    _id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ detail: "Invalid user ID format.", code: "INVALID_ID" });
  }
  const col = getDb().collection("users");
  const user = await col.findOne({ _id });
  if (!user) return res.status(404).json({ detail: "User not found.", code: "NOT_FOUND" });

  if (req.user.id === String(user._id) && req.body.active === false) {
    return res.status(400).json({ detail: "You cannot disable your own admin account.", code: "SELF_DISABLE" });
  }

  const updates = {};
  if (req.body.name) updates.name = String(req.body.name);
  if (req.body.unit) updates.unit = String(req.body.unit);
  if (req.body.role && ["FIELD_OFFICER", "SUPERVISOR", "ADMIN"].includes(req.body.role)) {
    updates.role = req.body.role;
  }
  if (req.body.active !== undefined) {
    updates.active = Boolean(req.body.active);
  }
  if (req.body.password && typeof req.body.password === "string" && req.body.password.length >= 8) {
    updates.passwordHash = await bcrypt.hash(req.body.password, 10);
  }

  await col.updateOne({ _id }, { $set: updates });
  const updated = await col.findOne({ _id });
  res.json({
    user: {
      id: String(updated._id),
      name: updated.name,
      email: updated.email,
      role: updated.role,
      unit: updated.unit,
      active: updated.active !== false,
    },
  });
});

usersRouter.delete("/:id", async (req, res) => {
  let _id;
  try {
    _id = new ObjectId(req.params.id);
  } catch {
    return res.status(400).json({ detail: "Invalid user ID format.", code: "INVALID_ID" });
  }
  if (req.user.id === String(_id)) {
    return res.status(400).json({ detail: "You cannot delete your own admin account.", code: "SELF_DELETE" });
  }
  const col = getDb().collection("users");
  const result = await col.deleteOne({ _id });
  if (result.deletedCount === 0) {
    return res.status(404).json({ detail: "User not found.", code: "NOT_FOUND" });
  }
  res.json({ ok: true, deleted: req.params.id });
});
