// Background work for Stock Inventory, once a minute: keep the warehouse list in step
// with DTF Monitor, send queued Telegram alerts and the daily report. The bot itself is stockBot.ts.
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";
import { syncIfStale } from "./stock";
import { buildSummary, getTelegramCfg, telegramSend, TelegramCfg } from "./stockTelegram";
import { startStockBot } from "./stockBot";

const TICK_MS = 60000;
const SYNC_MAX_AGE_MS = 5 * 60000;
const MAX_ATTEMPTS = 3;

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
  startStockBot();
}
