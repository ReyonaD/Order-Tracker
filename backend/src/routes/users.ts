import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { loadPermissions } from "../config/permissions";

export const userRouter = Router();

// Allowed roles = ADMIN + every role in the permission matrix (incl. custom ones).
async function isValidRole(role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  const perms = await loadPermissions();
  return Object.prototype.hasOwnProperty.call(perms, role);
}

// All user management is admin-only.
userRouter.use(requireAuth, requireRole("ADMIN"));

const userSelect = { id: true, email: true, name: true, role: true, active: true, canViewReports: true, canViewSheets: true, canViewStaff: true, createdAt: true };

userRouter.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: userSelect });
  res.json({ status: "success", users });
});

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.string().min(1),
  canViewReports: z.boolean().optional(),
  canViewSheets: z.boolean().optional(),
  canViewStaff: z.boolean().optional(),
});

userRouter.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input (password min 6 chars)" });
    return;
  }
  const { email, name, password, role, canViewReports, canViewSheets, canViewStaff } = parsed.data;
  if (!(await isValidRole(role))) {
    res.status(400).json({ status: "error", message: `Unknown role: ${role}` });
    return;
  }
  try {
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), name, role, canViewReports: canViewReports ?? false, canViewSheets: canViewSheets ?? false, canViewStaff: canViewStaff ?? false, passwordHash: await bcrypt.hash(password, 10) },
      select: userSelect,
    });
    res.status(201).json({ status: "success", user });
  } catch {
    res.status(409).json({ status: "error", message: "Email already in use" });
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  active: z.boolean().optional(),
  canViewReports: z.boolean().optional(),
  canViewSheets: z.boolean().optional(),
  canViewStaff: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

userRouter.patch("/:id", async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ status: "error", message: "Invalid input" });
    return;
  }
  const { name, role, active, canViewReports, canViewSheets, canViewStaff, password } = parsed.data;
  if (role !== undefined && !(await isValidRole(role))) {
    res.status(400).json({ status: "error", message: `Unknown role: ${role}` });
    return;
  }
  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (active !== undefined) data.active = active;
  if (canViewReports !== undefined) data.canViewReports = canViewReports;
  if (canViewSheets !== undefined) data.canViewSheets = canViewSheets;
  if (canViewStaff !== undefined) data.canViewStaff = canViewStaff;
  if (password) data.passwordHash = await bcrypt.hash(password, 10);

  // Guard: don't let the last active admin lock themselves out.
  if ((role && role !== "ADMIN") || active === false) {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (target?.role === "ADMIN") {
      const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
      if (admins <= 1) {
        res.status(400).json({ status: "error", message: "Cannot demote/deactivate the last admin" });
        return;
      }
    }
  }

  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: userSelect });
    res.json({ status: "success", user });
  } catch {
    res.status(404).json({ status: "error", message: "User not found" });
  }
});

userRouter.delete("/:id", async (req, res) => {
  // Can't delete your own account.
  if (req.params.id === req.user!.id) {
    res.status(400).json({ status: "error", message: "You can't delete your own account" });
    return;
  }
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) {
    res.status(404).json({ status: "error", message: "User not found" });
    return;
  }
  // Don't remove the last active admin.
  if (target.role === "ADMIN" && target.active) {
    const admins = await prisma.user.count({ where: { role: "ADMIN", active: true } });
    if (admins <= 1) {
      res.status(400).json({ status: "error", message: "Cannot delete the last admin" });
      return;
    }
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ status: "success" });
});
