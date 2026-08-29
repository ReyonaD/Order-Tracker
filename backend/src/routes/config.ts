import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { requireAuth, requireRole } from "../middleware/auth";
import { loadPermissions, mergePermissions, PERMISSION_COLUMNS, EDITABLE_COLUMNS, BUILTIN_ROLES, ROLE_NAME_RE, normalizeRoleName } from "../config/permissions";

export const configRouter = Router();

// Any authenticated user can read permissions (the UI needs its own role's rules).
configRouter.get("/permissions", requireAuth, async (_req, res) => {
  const permissions = await loadPermissions();
  res.json({ status: "success", permissions, columns: PERMISSION_COLUMNS, editable: EDITABLE_COLUMNS });
});

// List all roles (ADMIN + every role in the matrix). `builtin` = roles that
// can't be deleted. Any authenticated user can read (dropdowns need it).
configRouter.get("/roles", requireAuth, async (_req, res) => {
  const perms = await loadPermissions();
  const builtin = ["ADMIN", ...BUILTIN_ROLES];
  res.json({ status: "success", roles: ["ADMIN", ...Object.keys(perms)], builtin });
});

// Create a custom role (admin only). Starts as view-all / edit-none.
configRouter.post("/roles", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const name = normalizeRoleName(String(req.body?.name || ""));
  if (!ROLE_NAME_RE.test(name) || name === "ADMIN") {
    res.status(400).json({ status: "error", message: "Invalid role name (letters/numbers/underscore, e.g. QUALITY_CHECK)" });
    return;
  }
  const perms = await loadPermissions();
  if (perms[name]) {
    res.status(409).json({ status: "error", message: "A role with that name already exists" });
    return;
  }
  const merged = mergePermissions({ ...perms, [name]: {} });
  await prisma.appConfig.upsert({
    where: { key: "rolePermissions" },
    create: { key: "rolePermissions", value: merged as unknown as Prisma.InputJsonValue },
    update: { value: merged as unknown as Prisma.InputJsonValue },
  });
  res.status(201).json({ status: "success", role: name, roles: ["ADMIN", ...Object.keys(merged)] });
});

// Delete a custom role (admin only). Built-in roles can't be deleted, and a role
// still assigned to any user is blocked until those users are reassigned.
configRouter.delete("/roles/:name", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const name = req.params.name;
  if (["ADMIN", ...BUILTIN_ROLES].includes(name)) {
    res.status(400).json({ status: "error", message: "Built-in roles can't be deleted" });
    return;
  }
  const inUse = await prisma.user.count({ where: { role: name } });
  if (inUse > 0) {
    res.status(400).json({ status: "error", message: `${inUse} user(s) still have this role — reassign them first` });
    return;
  }
  const perms = await loadPermissions();
  if (!perms[name]) {
    res.status(404).json({ status: "error", message: "Role not found" });
    return;
  }
  delete perms[name];
  const merged = mergePermissions(perms);
  await prisma.appConfig.upsert({
    where: { key: "rolePermissions" },
    create: { key: "rolePermissions", value: merged as unknown as Prisma.InputJsonValue },
    update: { value: merged as unknown as Prisma.InputJsonValue },
  });
  res.json({ status: "success", roles: ["ADMIN", ...Object.keys(merged)] });
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
