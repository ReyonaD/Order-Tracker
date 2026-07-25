import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../env";
import { prisma } from "../db";

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: "7d" });
}

/** Require a valid JWT. Populates req.user. Accepts a `?token=` query param too,
 *  so <img>/<a> tags (which can't set headers) can authenticate. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.get("Authorization") || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : typeof req.query.token === "string"
      ? req.query.token
      : "";
  if (!token) {
    res.status(401).json({ status: "error", message: "Missing token" });
    return;
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;
    req.user = { id: payload.id, email: payload.email, role: payload.role };
    next();
  } catch {
    res.status(401).json({ status: "error", message: "Invalid or expired token" });
  }
}

/** Require the user to have Reports access (admins always do; others need the
 *  canViewReports flag, which isn't in the token, so we check the DB). */
export async function requireReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ status: "error", message: "Not authenticated" });
    return;
  }
  if (req.user.role === "ADMIN") { next(); return; }
  const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { canViewReports: true } });
  if (!u?.canViewReports) {
    res.status(403).json({ status: "error", message: "Reports access required" });
    return;
  }
  next();
}

/** Require the user to have Sheets access (admins always do; others need the
 *  canViewSheets flag). */
export async function requireSheets(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ status: "error", message: "Not authenticated" });
    return;
  }
  if (req.user.role === "ADMIN") { next(); return; }
  const u = await prisma.user.findUnique({ where: { id: req.user.id }, select: { canViewSheets: true } });
  if (!u?.canViewSheets) {
    res.status(403).json({ status: "error", message: "Sheets access required" });
    return;
  }
  next();
}

/** Require the authenticated user to have one of the given roles. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ status: "error", message: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ status: "error", message: "Insufficient permissions" });
      return;
    }
    next();
  };
}
