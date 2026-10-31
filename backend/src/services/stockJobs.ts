// Background work for Stock Inventory, once a minute: keep the warehouse list in step
// with DTF Monitor, send queued Telegram alerts, the daily report, and answer bot commands.
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { syncIfStale } from "./stock";
import {
  buildSummary, getTelegramCfg, SummaryMode, stockMessage, telegramSend, telegramUpdates, TelegramCfg,
} from "./stockTelegram";

const TICK_MS = 60000;
const SYNC_MAX_AGE_MS = 5 * 60000;
const OFFSET_KEY = "stockTelegramOffset";
const MAX_ATTEMPTS = 3;

const COMMANDS: Record<string, SummaryMode> = {
  summary: "summary", ozet: "summary", resumen: "summary",
  usage: "usage", tuketim: "usage", consumo: "usage",
  stock: "stock", stok: "stock",
  critical: "critical", kritik: "critical", critico: "critical",
};
const LIST_COMMANDS = new Set(["warehouses", "depolar", "almacenes", "subeler"]);

async function queueDailyReport(cfg: TelegramCfg) {
  const now = DateTime.now().setZone(env.defaultTimezone);
  if (now.toFormat("HH:mm") < cfg.summaryTime) return;
  const eventKey = `daily:${now.toFormat("yyyy-MM-dd")}`;
  if (await prisma.stockNotification.findUnique({ where: { eventKey } })) return;
  const message = await buildSummary("daily", cfg.lang);
  await prisma.stockNotification.createMany({ data: [{ eventKey, message }], skipDuplicates: true });
}

async function flushQueue(cfg: TelegramCfg) {
  const jobs = await prisma.stockNotification.findMany({ where: { status: "pending" }, orderBy: { id: "asc" }, take: 10 });
  for (const job of jobs) {
    try {
      await telegramSend(cfg, job.message);
      await prisma.stockNotification.update({ where: { id: job.id }, data: { status: "sent", attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
    } catch (e) {
      await prisma.stockNotification.update({
        where: { id: job.id },
        data: { status: job.attempts + 1 >= MAX_ATTEMPTS ? "failed" : "pending", attempts: { increment: 1 }, lastError: (e as Error).message.slice(0, 255) },
      });
    }
  }
}

async function answerCommands(cfg: TelegramCfg) {
  const row = await prisma.appConfig.findUnique({ where: { key: OFFSET_KEY } });
  const updates = await telegramUpdates(cfg, Number(row?.value ?? 0));
  for (const u of updates) {
    const text = String(u.message?.text ?? "").trim();
    // Only the configured chat may ask.
    if (String(u.message?.chat?.id ?? "") === cfg.chatId && text.startsWith("/")) {
      const [head, ...rest] = text.split(/\s+/);
      const command = head.slice(1).split("@")[0].toLowerCase();
      const arg = rest.join(" ");
      const mode = COMMANDS[command];
      if (mode) {
        const w = arg ? await prisma.stockWarehouse.findFirst({ where: { name: { equals: arg, mode: "insensitive" }, active: true } }) : null;
        if (arg && !w) await telegramSend(cfg, stockMessage(cfg.lang, "notFound"));
        else await telegramSend(cfg, await buildSummary(mode, cfg.lang, w?.id));
      } else if (LIST_COMMANDS.has(command)) {
        const all = await prisma.stockWarehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } });
        await telegramSend(cfg, [stockMessage(cfg.lang, "warehouses"), ...all.map((w) => w.name)].join("\n"));
      } else {
        await telegramSend(cfg, stockMessage(cfg.lang, "help"));
      }
    }
    const value = Number(u.update_id) + 1;
    await prisma.appConfig.upsert({ where: { key: OFFSET_KEY }, create: { key: OFFSET_KEY, value }, update: { value } });
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await syncIfStale(SYNC_MAX_AGE_MS);
    const cfg = await getTelegramCfg(true);
    if (cfg) {
      await queueDailyReport(cfg);
      await flushQueue(cfg);
      await answerCommands(cfg);
    }
  } catch (e) {
    console.warn("Stock job:", (e as Error).message);
  } finally {
    running = false;
  }
}

export function startStockJobs() {
  setTimeout(tick, 5000).unref();
  setInterval(tick, TICK_MS).unref();
}
