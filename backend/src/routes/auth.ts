import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, signToken } from "../middleware/auth";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ status: "error", message: "Invalid credentials" });
    return;
  }

  const token = signToken({ id: user.id, email: user.email, role: user.role });
  res.json({
    status: "success",
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, canViewReports: user.canViewReports, canViewSheets: user.canViewSheets },
  });
});

// Return the current user from the token.
authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, email: true, name: true, role: true, active: true, canViewReports: true, canViewSheets: true },
  });
  if (!user) {
    res.status(404).json({ status: "error", message: "User not found" });
    return;
  }
  res.json({ status: "success", user });
});

// Per-user UI preferences (column layout + presets). Stored as opaque JSON.
authRouter.get("/preferences", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { preferences: true },
  });
  res.json({ status: "success", preferences: user?.preferences ?? null });
});

authRouter.put("/preferences", requireAuth, async (req, res) => {
  const preferences = req.body?.preferences ?? null;
  await prisma.user.update({
    where: { id: req.user!.id },
    data: { preferences },
  });
  res.json({ status: "success" });
});
