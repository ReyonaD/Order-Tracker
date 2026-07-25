import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { loadPermissions, mergePermissions, PERMISSION_COLUMNS, EDITABLE_COLUMNS } from "../config/permissions";

export const configRouter = Router();

// Any authenticated user can read permissions (the UI needs its own role's rules).
configRouter.get("/permissions", requireAuth, async (_req, res) => {
  const permissions = await loadPermissions();
  res.json({ status: "success", permissions, columns: PERMISSION_COLUMNS, editable: EDITABLE_COLUMNS });
});

// Only admins can change them.
configRouter.put("/permissions", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const merged = mergePermissions(req.body?.permissions);
  const value = merged as unknown as Prisma.InputJsonValue;
  await prisma.appConfig.upsert({
    where: { key: "rolePermissions" },
    create: { key: "rolePermissions", value },
    update: { value },
  });
  res.json({ status: "success", permissions: merged });
});
