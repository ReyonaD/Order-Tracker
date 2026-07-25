import { prisma } from "../db";

// Role-based column permissions. ADMIN is always full access and is NOT in the matrix.
export const CONFIG_ROLES = ["DESIGNER", "MACHINIST", "CUSTOMER_SERVICE", "VIEWER"] as const;

// Columns that appear in the permission matrix (orderName is always visible → excluded).
export const PERMISSION_COLUMNS = [
  "urgent", "store", "shipping", "date", "deadline", "item", "price", "designer",
  "upload", "file", "image", "print", "machinist", "machine", "note", "order", "tracking", "status",
];

// column key -> Order field that it edits.
export const FIELD_BY_COLUMN: Record<string, string> = {
  urgent: "urgent",
  designer: "designerName",
  upload: "uploadStatus",
  file: "fileLink",
  note: "designerNote",
  print: "printStatus",
  machinist: "machinistName",
  machine: "machineName",
  status: "status",
};
export const COLUMN_BY_FIELD: Record<string, string> = Object.fromEntries(
  Object.entries(FIELD_BY_COLUMN).map(([col, field]) => [field, col])
);
// The "email sent?" flag lives in the Uploaded column, so it's gated by that column.
COLUMN_BY_FIELD["problemEmailSent"] = "upload";
// "image" is editable via its own upload endpoint (not a plain Order field).
export const EDITABLE_COLUMNS = [...Object.keys(FIELD_BY_COLUMN), "image"];

export interface ColPerm { view: boolean; edit: boolean }
export type RolePerms = Record<string, ColPerm>;

function build(editable: string[]): RolePerms {
  const o: RolePerms = {};
  for (const k of PERMISSION_COLUMNS) o[k] = { view: true, edit: editable.includes(k) };
  return o;
}

// Defaults mirror the original hardcoded behavior.
export const DEFAULT_PERMISSIONS: Record<string, RolePerms> = {
  DESIGNER: build(["designer", "upload", "file", "image", "note", "urgent"]),
  MACHINIST: build(["print", "machinist", "machine", "urgent"]),
  // Customer service handles problem orders / customer comms.
  CUSTOMER_SERVICE: build(["upload", "image", "note", "urgent"]),
  VIEWER: build([]),
};

// Merge stored config over defaults, enforcing the invariants:
//  - edit requires view (a hidden column can't be edited)
//  - only mapped columns are editable
export function mergePermissions(stored: unknown): Record<string, RolePerms> {
  const s = (stored as Record<string, RolePerms> | null) || {};
  const out: Record<string, RolePerms> = {};
  for (const role of CONFIG_ROLES) {
    const base = DEFAULT_PERMISSIONS[role];
    const sr = s[role] || {};
    const merged: RolePerms = {};
    for (const k of PERMISSION_COLUMNS) {
      const sv = sr[k] || {};
      const view = typeof sv.view === "boolean" ? sv.view : base[k].view;
      let edit = typeof sv.edit === "boolean" ? sv.edit : base[k].edit;
      if (!view) edit = false;
      if (!EDITABLE_COLUMNS.includes(k)) edit = false;
      merged[k] = { view, edit };
    }
    out[role] = merged;
  }
  return out;
}

export async function loadPermissions(): Promise<Record<string, RolePerms>> {
  const row = await prisma.appConfig.findUnique({ where: { key: "rolePermissions" } });
  return mergePermissions(row?.value);
}
