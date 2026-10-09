import jwt from "jsonwebtoken";
import { config } from "./config.js";
import { getDb } from "./db.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.email, role: user.role, name: user.name, uid: user.id },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({
      detail: "Authentication required.",
      code: "UNAUTHENTICATED",
    });
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await getDb().collection("users").findOne({ email: payload.sub });
    if (!user || user.active === false) {
      return res.status(401).json({
        detail: "Invalid or expired session. Sign in again.",
        code: "UNAUTHENTICATED",
      });
    }
    req.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      unit: user.unit,
    };
    return next();
  } catch {
    return res.status(401).json({
      detail: "Invalid or expired session. Sign in again.",
      code: "UNAUTHENTICATED",
    });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        detail: "Your role does not have permission for this action.",
        code: "FORBIDDEN",
      });
    }
    return next();
  };
}
