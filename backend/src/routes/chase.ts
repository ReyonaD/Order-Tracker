import { Router } from "express";
import { DateTime } from "luxon";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { requireAuth, requireRole } from "../middleware/auth";

// Chase list: every order due today (optionally + the last N days) that has NOT fully
// gone through the oven, with the stage it is stuck in. "Expected" = orders, "actual" =
// Sheet rows reported by DTF Monitor; the gap is what would otherwise be missed.
// Nothing leaves this list except a Printed rollup (every sheet scanned), a manual
// "Mark printed", or the order being fulfilled/cancelled.
export const chaseRouter = Router();
chaseRouter.use(requireAuth);

// ── Settings (AppConfig "chaseSettings"), editable from the panel's ⚙ by admins ──
const settingsSchema = z.object({
  lookbackDays: z.number().int().min(0).max(14),     // 0 = today only
  notStartedWarnMin: z.number().int().min(0),         // amber when due within N min and nothing happened
  downloaded: z.tuple([z.number().int().min(0), z.number().int().min(0)]), // [warn, late] minutes in stage
  ripped: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
  partial: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});
type ChaseSettings = z.infer<typeof settingsSchema>;
const DEFAULT_SETTINGS: ChaseSettings = {
  lookbackDays: 0, notStartedWarnMin: 120, downloaded: [30, 60], ripped: [45, 90], partial: [45, 90],
};

async function loadSettings(): Promise<ChaseSettings> {
  const row = await prisma.appConfig.findUnique({ where: { key: "chaseSettings" } });
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...((row?.value as object) || {}) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

chaseRouter.get("/settings", async (_req, res) => {
  res.json({ status: "success", settings: await loadSettings() });
});

chaseRouter.put("/settings", requireRole("ADMIN"), async (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ status: "error", message: "Invalid settings" }); return; }
  await prisma.appConfig.upsert({
    where: { key: "chaseSettings" },
    create: { key: "chaseSettings", value: parsed.data },
    update: { value: parsed.data },
  });
  res.json({ status: "success", settings: parsed.data });
});

type Stage = "not_started" | "downloaded" | "ripped" | "partial";
type Flag = "ok" | "warn" | "late";
const FLAG_RANK: Record<Flag, number> = { late: 0, warn: 1, ok: 2 };

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

chaseRouter.get("/", async (_req, res) => {
  const settings = await loadSettings();
  const now = DateTime.now().setZone(env.defaultTimezone);
  const nowMs = Date.now();
  const orders = await prisma.order.findMany({
    where: {
      status: "NEW",
      deadlineAt: {
        gte: now.startOf("day").minus({ days: settings.lookbackDays }).toJSDate(),
        lte: now.endOf("day").toJSDate(),
      },
      OR: [{ printStatus: null }, { printStatus: { not: "Printed" } }],
    },
    select: {
      id: true, orderName: true, storeCode: true, deadlineAt: true, isPickup: true,
      displayShippingMethod: true, urgent: true, printStatus: true, itemTypes: true,
      sheets: {
        select: {
          part: true, total: true, copies: true, status: true, machine: true, operator: true,
          downloadedAt: true, rippedAt: true, printedAt: true, printedCount: true,
        },
        orderBy: { part: "asc" },
      },
    },
    orderBy: { deadlineAt: "asc" },
  });

  const items = orders.map((o) => {
    const sheets = o.sheets;
    const total = sheets.length ? Math.max(sheets.length, ...sheets.map((s) => s.total)) : 0;
    const printed = sheets.filter((s) => s.status === "PRINTED");
    const ripped = sheets.filter((s) => s.status === "RIPPED");
    const downloaded = sheets.filter((s) => s.status === "DOWNLOADED");
    const latest = (xs: typeof sheets, key: "downloadedAt" | "rippedAt" | "printedAt") =>
      xs.reduce<Date | null>((m, s) => (s[key] && (!m || (s[key] as Date) > m) ? (s[key] as Date) : m), null);
    const label = (xs: typeof sheets) => {
      const m = uniq(xs.map((s) => s.machine)), op = uniq(xs.map((s) => s.operator));
      return m.length ? `${m.join(", ")}${op.length ? ` (${op.join(", ")})` : ""}` : "";
    };

    let stage: Stage, since: Date | null, who: string;
    if (printed.length > 0) { stage = "partial"; since = latest(printed, "printedAt"); who = label(printed); }
    else if (ripped.length > 0) { stage = "ripped"; since = latest(ripped, "rippedAt"); who = label(ripped); }
    else if (downloaded.length > 0) { stage = "downloaded"; since = latest(downloaded, "downloadedAt"); who = label(downloaded); }
    else { stage = "not_started"; since = null; who = ""; }

    const sinceMin = since ? Math.max(0, Math.round((nowMs - since.getTime()) / 60000)) : 0;
    const dueInMin = Math.round((o.deadlineAt.getTime() - nowMs) / 60000);
    let flag: Flag;
    if (dueInMin < 0) flag = "late";
    else if (stage === "not_started") flag = dueInMin <= settings.notStartedWarnMin ? "warn" : "ok";
    else flag = sinceMin >= settings[stage][1] ? "late" : sinceMin >= settings[stage][0] ? "warn" : "ok";

    const due = dueInMin < 0 ? `overdue by ${fmtMin(-dueInMin)}` : `due in ${fmtMin(dueInMin)}`;
    let message: string;
    if (stage === "not_started") message = `Not started · ${due}`;
    else if (stage === "downloaded") message = `Downloaded on ${who} · ${fmtMin(sinceMin)} ago, not RIP'd`;
    else if (stage === "ripped") message = `RIP'd${total > 1 ? ` ${ripped.length}/${total}` : ""} on ${who} · ${fmtMin(sinceMin)} ago, not printed`;
    else message = `${printed.length} of ${total} printed · last ${fmtMin(sinceMin)} ago (${who})`;

    return {
      id: o.id, orderName: o.orderName, storeCode: o.storeCode, deadlineAt: o.deadlineAt,
      isPickup: o.isPickup, shipping: o.displayShippingMethod, urgent: o.urgent, itemTypes: o.itemTypes,
      printStatus: o.printStatus, stage, flag, since, sinceMin, dueInMin, message, who,
      progress: { printed: printed.length, ripped: ripped.length, downloaded: downloaded.length, total },
      sheets,
    };
  });

  // An order whose every sheet was scanned is through the oven even if a legacy
  // order-level update left printStatus out of sync — it is not a chase item.
  const open = items.filter((it) => !(it.progress.total > 0 && it.progress.printed >= it.progress.total));
  open.sort((a, b) => FLAG_RANK[a.flag] - FLAG_RANK[b.flag] || a.deadlineAt.getTime() - b.deadlineAt.getTime());
  const counts = { late: 0, warn: 0, ok: 0, total: open.length };
  for (const it of open) counts[it.flag]++;
  res.json({ status: "success", now: now.toISO(), items: open, counts, settings });
});
