// Telegram side of Stock Inventory: settings, messages in three languages, summaries.
import { Prisma } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../db";
import { env } from "../env";

export type Lang = "en" | "tr" | "es";
export interface TelegramCfg { token: string; chatId: string; enabled: boolean; summaryTime: string; lang: Lang }

const CONFIG_KEY = "stockTelegram";
const DEFAULTS: TelegramCfg = { token: "", chatId: "", enabled: false, summaryTime: "21:00", lang: "tr" };

async function loadCfg(): Promise<TelegramCfg> {
  const row = await prisma.appConfig.findUnique({ where: { key: CONFIG_KEY } });
  return { ...DEFAULTS, ...((row?.value as Partial<TelegramCfg>) || {}) };
}

/** Effective settings. With `activeOnly`, null unless messages can really be sent —
 *  nothing is queued while Telegram is off, so turning it on doesn't flood the chat. */
export async function getTelegramCfg(activeOnly: true): Promise<TelegramCfg | null>;
export async function getTelegramCfg(activeOnly?: false): Promise<TelegramCfg>;
export async function getTelegramCfg(activeOnly = false): Promise<TelegramCfg | null> {
  const cfg = await loadCfg();
  cfg.token = env.telegramBotToken || cfg.token;
  if (activeOnly && !(cfg.enabled && cfg.token && cfg.chatId)) return null;
  return cfg;
}

export async function saveTelegramCfg(patch: Partial<TelegramCfg>) {
  const value = { ...(await loadCfg()), ...patch };
  await prisma.appConfig.upsert({
    where: { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: value as unknown as Prisma.InputJsonValue },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
}

const UNITS: Record<Lang, Record<string, string>> = {
  en: { bottle: "bottle", roll: "roll", pcs: "pcs", kg: "kg", liter: "liter", meter: "meter", box: "box" },
  tr: { bottle: "şişe", roll: "rulo", pcs: "adet", kg: "kg", liter: "litre", meter: "metre", box: "kutu" },
  es: { bottle: "botella", roll: "rollo", pcs: "uds", kg: "kg", liter: "litro", meter: "metro", box: "caja" },
};
export const unitLabel = (u: string, lang: Lang) => UNITS[lang][u] ?? u;
export const formatQty = (n: unknown) => String(Number(n));

const TEXT: Record<Lang, Record<string, string>> = {
  en: {
    critical: "⚠️ Low stock\n{warehouse} — {product}: {qty} {unit}",
    consumption: "🔔 Stock used\n🕒 {when}\n🏢 {warehouse}\n📦 {product}\n➖ Quantity: {qty} {unit}\n📊 Left: {left} {unit}\n👤 {actor}",
    reversal: "↩️ Usage cancelled\n🏢 {warehouse}\n📦 {product}: +{qty} {unit}\n📊 Left: {left} {unit}\n👤 {actor}",
    test: "✅ Stock Inventory is connected. Alerts will arrive here.",
    daily: "📊 End of day report", summary: "🌙 Daily summary", title: "📊 Stock",
    used: "🧴 Used today", noneUsed: "No usage recorded today.", stock: "📦 Current stock", low: "⚠️ Low stock", noneLow: "No products at a critical level.",
    notFound: "Warehouse not found. List them with /warehouses.", warehouses: "🏢 Warehouses",
    help: "Stock commands\n/summary [warehouse]\n/usage [warehouse]\n/stock [warehouse]\n/critical [warehouse]\n/warehouses\n/help",
  },
  tr: {
    critical: "⚠️ Kritik stok\n{warehouse} — {product}: {qty} {unit}",
    consumption: "🔔 Anlık tüketim\n🕒 {when}\n🏢 {warehouse}\n📦 {product}\n➖ Miktar: {qty} {unit}\n📊 Kalan stok: {left} {unit}\n👤 {actor}",
    reversal: "↩️ Tüketim iptal edildi\n🏢 {warehouse}\n📦 {product}: +{qty} {unit}\n📊 Kalan stok: {left} {unit}\n👤 {actor}",
    test: "✅ Stok bağlantısı başarılı. Bildirimler buraya gelecek.",
    daily: "📊 Gün sonu raporu", summary: "🌙 Günlük özet", title: "📊 Stok",
    used: "🧴 Bugünkü tüketim", noneUsed: "Bugün tüketim kaydı yok.", stock: "📦 Mevcut stok", low: "⚠️ Kritik stok", noneLow: "Kritik seviyede ürün yok.",
    notFound: "Depo bulunamadı. /depolar komutuyla listeleyin.", warehouses: "🏢 Depolar",
    help: "Stok komutları\n/ozet [depo]\n/tuketim [depo]\n/stok [depo]\n/kritik [depo]\n/depolar\n/yardim",
  },
  es: {
    critical: "⚠️ Stock crítico\n{warehouse} — {product}: {qty} {unit}",
    consumption: "🔔 Consumo\n🕒 {when}\n🏢 {warehouse}\n📦 {product}\n➖ Cantidad: {qty} {unit}\n📊 Restante: {left} {unit}\n👤 {actor}",
    reversal: "↩️ Consumo cancelado\n🏢 {warehouse}\n📦 {product}: +{qty} {unit}\n📊 Restante: {left} {unit}\n👤 {actor}",
    test: "✅ Inventario conectado. Las alertas llegarán aquí.",
    daily: "📊 Informe de fin de día", summary: "🌙 Resumen diario", title: "📊 Stock",
    used: "🧴 Consumo de hoy", noneUsed: "Hoy no hay consumo registrado.", stock: "📦 Stock actual", low: "⚠️ Stock crítico", noneLow: "No hay productos en nivel crítico.",
    notFound: "Almacén no encontrado. Lístelos con /almacenes.", warehouses: "🏢 Almacenes",
    help: "Comandos de stock\n/resumen [almacén]\n/consumo [almacén]\n/stock [almacén]\n/critico [almacén]\n/almacenes\n/ayuda",
  },
};

export function stockMessage(lang: Lang, key: string, params: Record<string, string> = {}): string {
  let text = TEXT[lang][key].replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
  if (key === "consumption" && params.machine) text += ` · ${params.machine}`;
  return text;
}

export type SummaryMode = "summary" | "daily" | "usage" | "stock" | "critical";

/** The text of a summary: today's usage and/or stock per warehouse (Texas day). */
export async function buildSummary(mode: SummaryMode, lang: Lang, warehouseId?: number): Promise<string> {
  const now = DateTime.now().setZone(env.defaultTimezone);
  const start = now.startOf("day").toJSDate();
  const head = mode === "daily" ? TEXT[lang].daily : mode === "summary" ? TEXT[lang].summary : TEXT[lang].title;
  const lines = [`${head} · ${now.toFormat("MM/dd/yyyy")}`];
  const warehouses = await prisma.stockWarehouse.findMany({ where: { active: true, ...(warehouseId ? { id: warehouseId } : {}) }, orderBy: { name: "asc" } });
  const products = await prisma.stockProduct.findMany({ where: { active: true }, orderBy: [{ category: "asc" }, { name: "asc" }], include: { levels: true } });
  const names = new Map(products.map((p) => [p.id, p]));

  for (const w of warehouses) {
    lines.push(`\n🏢 ${w.name}`);
    if (mode === "summary" || mode === "daily" || mode === "usage") {
      lines.push(TEXT[lang].used);
      const used = await prisma.stockMovement.groupBy({
        by: ["productId"], where: { warehouseId: w.id, kind: "consumption", reversedAt: null, createdAt: { gte: start } }, _sum: { quantity: true },
      });
      if (!used.length) lines.push(TEXT[lang].noneUsed);
      for (const u of used) {
        const p = names.get(u.productId) ?? await prisma.stockProduct.findUnique({ where: { id: u.productId }, include: { levels: true } });
        lines.push(`• ${p?.name}: ${formatQty(u._sum.quantity)} ${unitLabel(p?.unit ?? "", lang)}`);
      }
    }
    if (mode === "summary" || mode === "critical" || mode === "stock") {
      lines.push(mode === "stock" ? TEXT[lang].stock : TEXT[lang].low);
      let found = 0;
      for (const p of products) {
        const level = p.levels.find((l) => l.warehouseId === w.id);
        const q = Number(level?.quantity ?? 0);
        if (level?.tracked === false && (mode !== "stock" || q <= 0)) continue;   // not kept in this warehouse
        if (mode !== "stock" && q > Number(level?.minStock ?? p.minStock)) continue;
        found++;
        lines.push(`• ${p.name}: ${q} ${unitLabel(p.unit, lang)}`);
      }
      if (!found) lines.push(TEXT[lang].noneLow);
    }
  }
  return lines.join("\n");
}

async function api(token: string, method: string, data: Record<string, string>): Promise<any> {
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", body: new URLSearchParams(data), signal: AbortSignal.timeout(15000),
  });
  const body = (await resp.json().catch(() => null)) as { ok?: boolean; result?: unknown } | null;
  // Never echo the URL: it contains the bot token.
  if (!body?.ok) throw new Error(`Telegram request failed (HTTP ${resp.status}). Check the token, chat id and bot permissions.`);
  return body.result;
}

export async function telegramSend(cfg: TelegramCfg, message: string) {
  // Telegram limits message length; split on whole lines.
  const chunks: string[] = [];
  let chunk = "";
  for (const line of message.split("\n")) {
    if (chunk.length + line.length + 1 > 3800) { chunks.push(chunk); chunk = ""; }
    chunk += (chunk ? "\n" : "") + line;
  }
  if (chunk) chunks.push(chunk);
  for (const text of chunks) await api(cfg.token, "sendMessage", { chat_id: cfg.chatId, text });
}

export async function telegramUpdates(cfg: TelegramCfg, offset: number): Promise<any[]> {
  return api(cfg.token, "getUpdates", { offset: String(offset), timeout: "0", allowed_updates: JSON.stringify(["message"]) });
}
