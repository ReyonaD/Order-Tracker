// The Stock Inventory Telegram bot: /menu shows report buttons, typed commands still work.
// It long-polls Telegram on its own loop so a button press is answered within a second.
// Only the chat configured in Stock settings is answered.
import { DateTime } from "luxon";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import {
  api, buildSummary, formatQty, getTelegramCfg, Lang, SummaryMode, TelegramCfg, telegramSend, telegramUpdates, unitLabel,
} from "./stockTelegram";

const OFFSET_KEY = "stockTelegramOffset";
const MAX_LINES = 120;   // keep one report readable; the CSV has everything

const T: Record<Lang, Record<string, string>> = {
  en: {
    menu: "📋 Stock reports — choose one:", summary: "📊 Daily summary", stock: "📦 Current stock", critical: "⚠️ Low / out",
    usage: "🧴 Today's usage", week: "📅 Weekly report", machine: "🖨 By machine", operator: "👤 By person", received: "📥 Received today",
    csv: "📄 Excel / CSV", close: "❌ Close", pickWarehouse: "📦 Which warehouse?", allWarehouses: "All warehouses", pickPeriod: "Which period?",
    today: "Today", thisWeek: "Last 7 days", none: "Nothing recorded.", usageTitle: "🧴 Usage today", weekTitle: "📅 Usage, last 7 days",
    machineTitle: "🖨 Usage by machine", operatorTitle: "👤 Usage by person", receivedTitle: "📥 Stock received today", web: "Web",
    csvCaption: "Consumption this month", csvEmpty: "No consumption this month yet.", notFound: "Warehouse not found. List them with /warehouses.",
    privacyHint: "Tip: to keep these buttons under the message box, open @BotFather → /setprivacy → this bot → Disable, then remove the bot from the group and add it again.",
    warehouses: "🏢 Warehouses", help: "Stock bot\n/menu — report buttons\n/summary /usage /stock /critical [warehouse]\n/warehouses /help",
    cols: "Date;Warehouse;Product;Quantity;Unit;Person;Machine;Note",
  },
  tr: {
    menu: "📋 Stok raporları — birini seçin:", summary: "📊 Günlük özet", stock: "📦 Mevcut stok", critical: "⚠️ Kritik / tükenen",
    usage: "🧴 Bugünkü tüketim", week: "📅 Haftalık rapor", machine: "🖨 Makineye göre", operator: "👤 Kişiye göre", received: "📥 Bugün gelen stok",
    csv: "📄 Excel / CSV", close: "❌ Kapat", pickWarehouse: "📦 Hangi depo?", allWarehouses: "Tüm depolar", pickPeriod: "Hangi dönem?",
    today: "Bugün", thisWeek: "Son 7 gün", none: "Kayıt yok.", usageTitle: "🧴 Bugünkü tüketim", weekTitle: "📅 Son 7 günün tüketimi",
    machineTitle: "🖨 Makineye göre tüketim", operatorTitle: "👤 Kişiye göre tüketim", receivedTitle: "📥 Bugün gelen stok", web: "Web",
    csvCaption: "Bu ayın tüketimi", csvEmpty: "Bu ay henüz tüketim kaydı yok.", notFound: "Depo bulunamadı. /depolar komutuyla listeleyin.",
    privacyHint: "İpucu: butonların mesaj kutusunun altında hep durması için @BotFather → /setprivacy → bu bot → Disable yapın, sonra botu gruptan çıkarıp yeniden ekleyin.",
    warehouses: "🏢 Depolar", help: "Stok botu\n/menu — rapor butonları\n/ozet /tuketim /stok /kritik [depo]\n/depolar /yardim",
    cols: "Tarih;Depo;Ürün;Miktar;Birim;Kişi;Makine;Not",
  },
  es: {
    menu: "📋 Informes de stock — elija uno:", summary: "📊 Resumen diario", stock: "📦 Stock actual", critical: "⚠️ Crítico / agotado",
    usage: "🧴 Consumo de hoy", week: "📅 Informe semanal", machine: "🖨 Por máquina", operator: "👤 Por persona", received: "📥 Recibido hoy",
    csv: "📄 Excel / CSV", close: "❌ Cerrar", pickWarehouse: "📦 ¿Qué almacén?", allWarehouses: "Todos los almacenes", pickPeriod: "¿Qué periodo?",
    today: "Hoy", thisWeek: "Últimos 7 días", none: "Sin registros.", usageTitle: "🧴 Consumo de hoy", weekTitle: "📅 Consumo, últimos 7 días",
    machineTitle: "🖨 Consumo por máquina", operatorTitle: "👤 Consumo por persona", receivedTitle: "📥 Stock recibido hoy", web: "Web",
    csvCaption: "Consumo de este mes", csvEmpty: "Aún no hay consumo este mes.", notFound: "Almacén no encontrado. Lístelos con /almacenes.",
    privacyHint: "Consejo: para dejar estos botones bajo el cuadro de mensaje, abra @BotFather → /setprivacy → este bot → Disable y vuelva a añadir el bot al grupo.",
    warehouses: "🏢 Almacenes", help: "Bot de stock\n/menu — botones de informes\n/resumen /consumo /stock /critico [almacén]\n/almacenes /ayuda",
    cols: "Fecha;Almacén;Producto;Cantidad;Unidad;Persona;Máquina;Nota",
  },
};

const COMMANDS: Record<string, SummaryMode> = {
  summary: "summary", ozet: "summary", resumen: "summary",
  usage: "usage", tuketim: "usage", consumo: "usage",
  stock: "stock", stok: "stock",
  critical: "critical", kritik: "critical", critico: "critical",
};
const LIST_COMMANDS = new Set(["warehouses", "depolar", "almacenes", "subeler"]);
const MENU_COMMANDS = new Set(["menu", "start", "menü"]);

type Keyboard = { text: string; callback_data: string }[][];

// The persistent keyboard under the message box: a press sends its label as a normal
// message, which the bot only sees when its group privacy mode is off.
const PERSISTENT: string[][] = [["summary", "stock"], ["critical", "usage"], ["week", "received"], ["machine", "operator"], ["csv", "close"]];
let canReadAll = false;

function persistentKeyboard(t: Record<string, string>) {
  return { keyboard: PERSISTENT.map((row) => row.map((k) => ({ text: t[k] }))), is_persistent: true, resize_keyboard: true };
}

/** A label from the persistent keyboard, in any language, back to its button. */
function labelToAction(text: string): string | null {
  for (const t of Object.values(T)) {
    for (const row of PERSISTENT) for (const k of row) if (t[k] === text) return k;
  }
  return null;
}

function menuKeyboard(t: Record<string, string>): Keyboard {
  return [
    [{ text: t.summary, callback_data: "r:summary" }, { text: t.stock, callback_data: "r:stock" }],
    [{ text: t.critical, callback_data: "r:critical" }, { text: t.usage, callback_data: "r:usage" }],
    [{ text: t.week, callback_data: "r:week" }, { text: t.received, callback_data: "r:received" }],
    [{ text: t.machine, callback_data: "r:machine" }, { text: t.operator, callback_data: "r:operator" }],
    [{ text: t.csv, callback_data: "r:csv" }],
    [{ text: t.close, callback_data: "x" }],
  ];
}

async function send(cfg: TelegramCfg, chatId: string, text: string, keyboard?: Keyboard) {
  if (!keyboard) return telegramSend(cfg, text, chatId);
  await api(cfg.token, "sendMessage", { chat_id: chatId, text, reply_markup: JSON.stringify({ inline_keyboard: keyboard }) });
}

const zone = () => env.defaultTimezone;
const startOfToday = () => DateTime.now().setZone(zone()).startOf("day");
const clock = (d: Date) => DateTime.fromJSDate(d).setZone(zone()).toFormat("HH:mm");

function rangeOf(period: string) {
  const today = startOfToday();
  return period === "week" ? today.minus({ days: 6 }) : today;
}

type Row = Prisma.StockMovementGetPayload<{ include: { product: true; warehouse: true } }>;

function consumption(from: DateTime): Promise<Row[]> {
  return prisma.stockMovement.findMany({
    where: { kind: "consumption", reversedAt: null, createdAt: { gte: from.toJSDate() } },
    include: { product: true, warehouse: true }, orderBy: { id: "asc" },
  });
}

/** Lines "• product: total unit" for a list of movements, biggest first. */
function totals(rows: Row[], lang: Lang): string[] {
  const sum = new Map<number, { name: string; unit: string; q: number }>();
  for (const r of rows) {
    const e = sum.get(r.productId) ?? { name: r.product.name, unit: r.product.unit, q: 0 };
    e.q += Number(r.quantity);
    sum.set(r.productId, e);
  }
  return [...sum.values()].sort((a, b) => b.q - a.q).map((e) => `• ${e.name}: ${formatQty(e.q.toFixed(2))} ${unitLabel(e.unit, lang)}`);
}

function grouped(rows: Row[], key: (r: Row) => string, lang: Lang): string[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  const out: string[] = [];
  for (const [name, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(`\n${name}`, ...totals(list, lang));
  }
  return out;
}

function head(title: string, from: DateTime, period: string) {
  const to = startOfToday();
  return period === "week" ? `${title} · ${from.toFormat("MM/dd")}–${to.toFormat("MM/dd")}` : `${title} · ${to.toFormat("MM/dd/yyyy")}`;
}

function cap(lines: string[]): string {
  return lines.length > MAX_LINES ? [...lines.slice(0, MAX_LINES), "…"].join("\n") : lines.join("\n");
}

export async function report(kind: string, lang: Lang, arg = ""): Promise<string> {
  const t = T[lang];
  if (kind === "usage") {
    const from = startOfToday();
    const rows = await consumption(from);
    const lines = [head(t.usageTitle, from, "today")];
    if (!rows.length) lines.push(t.none);
    let wh = "";
    for (const r of rows.sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name) || a.id - b.id)) {
      if (r.warehouse.name !== wh) { wh = r.warehouse.name; lines.push(`\n🏢 ${wh}`); }
      const who = [r.actor, r.machine || (r.source === "web" ? t.web : "")].filter(Boolean).join(" · ");
      lines.push(`• ${clock(r.createdAt)} ${r.product.name}: ${formatQty(r.quantity)} ${unitLabel(r.product.unit, lang)} — ${who}`);
    }
    return cap(lines);
  }
  if (kind === "week") {
    const from = rangeOf("week");
    const rows = await consumption(from);
    return cap([head(t.weekTitle, from, "week"), ...(rows.length ? grouped(rows, (r) => `🏢 ${r.warehouse.name}`, lang) : [t.none])]);
  }
  if (kind === "machine" || kind === "operator") {
    const from = rangeOf(arg);
    const rows = await consumption(from);
    const key = kind === "machine"
      ? (r: Row) => `🖨 ${r.machine || t.web} · ${r.warehouse.name}`
      : (r: Row) => `👤 ${r.actor || "?"}`;
    return cap([head(kind === "machine" ? t.machineTitle : t.operatorTitle, from, arg), ...(rows.length ? grouped(rows, key, lang) : [t.none])]);
  }
  if (kind === "received") {
    const from = startOfToday();
    const rows = await prisma.stockMovement.findMany({
      where: { kind: "stock", type: "in", reversedAt: null, createdAt: { gte: from.toJSDate() } },
      include: { product: true, warehouse: true }, orderBy: { id: "asc" },
    });
    const lines = [head(t.receivedTitle, from, "today")];
    if (!rows.length) lines.push(t.none);
    let wh = "";
    for (const r of rows.sort((a, b) => a.warehouse.name.localeCompare(b.warehouse.name) || a.id - b.id)) {
      if (r.warehouse.name !== wh) { wh = r.warehouse.name; lines.push(`\n🏢 ${wh}`); }
      lines.push(`• ${clock(r.createdAt)} ${r.product.name}: +${formatQty(r.quantity)} ${unitLabel(r.product.unit, lang)} — ${r.actor}${r.note ? ` (${r.note})` : ""}`);
    }
    return cap(lines);
  }
  const mode = (kind === "summary" || kind === "critical" || kind === "stock" ? kind : "summary") as SummaryMode;
  return buildSummary(mode, lang, arg ? Number(arg) : undefined);
}

/** This month's consumption as a CSV Excel opens directly (UTF-8 BOM, semicolons). */
export async function monthCsv(lang: Lang): Promise<{ name: string; body: string; count: number }> {
  const from = startOfToday().startOf("month");
  const rows = await consumption(from);
  const cell = (v: unknown) => {
    const s = String(v ?? "");
    return `"${(/^\s*[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => [
    DateTime.fromJSDate(r.createdAt).setZone(zone()).toFormat("yyyy-MM-dd HH:mm"), r.warehouse.name, r.product.name,
    formatQty(r.quantity), unitLabel(r.product.unit, lang), r.actor, r.machine, r.note,
  ].map(cell).join(";"));
  return { name: `stock-usage-${from.toFormat("yyyy-MM")}.csv`, body: "﻿" + [T[lang].cols, ...lines].join("\r\n"), count: rows.length };
}

async function warehousePicker(t: Record<string, string>): Promise<Keyboard> {
  const all = await prisma.stockWarehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const rows: Keyboard = [];
  for (let i = 0; i < all.length; i += 2) rows.push(all.slice(i, i + 2).map((w) => ({ text: w.name, callback_data: `s:${w.id}` })));
  rows.push([{ text: t.allWarehouses, callback_data: "s:" }]);
  return rows;
}

async function onButton(cfg: TelegramCfg, chatId: string, data: string) {
  const t = T[cfg.lang];
  const [kind, value = ""] = data.split(":");
  if (data === "x") return;
  if (data === "r:stock") return send(cfg, chatId, t.pickWarehouse, await warehousePicker(t));
  if (data === "r:machine" || data === "r:operator") {
    return send(cfg, chatId, t.pickPeriod, [[{ text: t.today, callback_data: `${value}:today` }, { text: t.thisWeek, callback_data: `${value}:week` }]]);
  }
  if (data === "r:csv") {
    const csv = await monthCsv(cfg.lang);
    if (!csv.count) return send(cfg, chatId, t.csvEmpty);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", `${t.csvCaption} · ${csv.count}`);
    form.append("document", new Blob([csv.body], { type: "text/csv" }), csv.name);
    await api(cfg.token, "sendDocument", form, 60000);
    return;
  }
  if (kind === "s") return send(cfg, chatId, await report("stock", cfg.lang, value));
  if (kind === "machine" || kind === "operator") return send(cfg, chatId, await report(kind, cfg.lang, value));
  if (kind === "r") return send(cfg, chatId, await report(value, cfg.lang));
}

async function onText(cfg: TelegramCfg, chatId: string, text: string) {
  const t = T[cfg.lang];
  const pressed = labelToAction(text);
  if (pressed === "close") {
    await api(cfg.token, "sendMessage", { chat_id: chatId, text: "👋", reply_markup: JSON.stringify({ remove_keyboard: true }) });
    return;
  }
  if (pressed) return onButton(cfg, chatId, `r:${pressed}`);
  if (MENU_COMMANDS.has(text.slice(1).split(/[\s@]/)[0].toLowerCase())) {
    if (canReadAll) {
      await api(cfg.token, "sendMessage", { chat_id: chatId, text: t.menu, reply_markup: JSON.stringify(persistentKeyboard(t)) });
      return;
    }
    await send(cfg, chatId, t.menu, menuKeyboard(t));
    return send(cfg, chatId, t.privacyHint);
  }
  const [first, ...rest] = text.split(/\s+/);
  const command = first.slice(1).split("@")[0].toLowerCase();
  const arg = rest.join(" ");
  const mode = COMMANDS[command];
  if (mode) {
    const w = arg ? await prisma.stockWarehouse.findFirst({ where: { name: { equals: arg, mode: "insensitive" }, active: true } }) : null;
    if (arg && !w) return send(cfg, chatId, t.notFound);
    if (mode === "usage" && !w) return send(cfg, chatId, await report("usage", cfg.lang));
    return send(cfg, chatId, await buildSummary(mode, cfg.lang, w?.id));
  }
  if (LIST_COMMANDS.has(command)) {
    const all = await prisma.stockWarehouse.findMany({ where: { active: true }, orderBy: { name: "asc" } });
    return send(cfg, chatId, [t.warehouses, ...all.map((w) => w.name)].join("\n"));
  }
  return send(cfg, chatId, t.help);
}

async function handle(cfg: TelegramCfg, u: any) {
  if (u.callback_query) {
    const q = u.callback_query;
    const chatId = String(q.message?.chat?.id ?? "");
    // stop the button's spinner first; a report can take a moment
    await api(cfg.token, "answerCallbackQuery", { callback_query_id: q.id }).catch(() => undefined);
    if (chatId !== cfg.chatId) return;
    if (q.data === "x" && q.message) {
      await api(cfg.token, "deleteMessage", { chat_id: chatId, message_id: String(q.message.message_id) }).catch(() => undefined);
      return;
    }
    await onButton(cfg, chatId, String(q.data ?? ""));
    return;
  }
  const m = u.message;
  const text = String(m?.text ?? "").trim();
  if (String(m?.chat?.id ?? "") !== cfg.chatId) return;
  if (text.startsWith("/") || labelToAction(text)) await onText(cfg, cfg.chatId, text);   // other chatter is ignored
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let commandsFor = "";

async function loop() {
  for (;;) {
    const cfg = await getTelegramCfg(true).catch(() => null);
    if (!cfg) { await sleep(5000); continue; }   // Telegram switched on in Settings is picked up within seconds
    try {
      if (commandsFor !== cfg.token + cfg.lang) {
        canReadAll = !!(await api(cfg.token, "getMe", {}))?.can_read_all_group_messages;
        // the "/" list Telegram offers in the chat
        await api(cfg.token, "setMyCommands", { commands: JSON.stringify([{ command: "menu", description: T[cfg.lang].menu.replace(/^\S+\s/, "").replace(/ —.*$/, "") }]) });
        commandsFor = cfg.token + cfg.lang;
      }
      const row = await prisma.appConfig.findUnique({ where: { key: OFFSET_KEY } });
      const updates = await telegramUpdates(cfg, Number(row?.value ?? 0));
      for (const u of updates) {
        try { await handle(cfg, u); } catch (e) { console.warn("Stock bot:", (e as Error).message); }
        const value = Number(u.update_id) + 1;
        await prisma.appConfig.upsert({ where: { key: OFFSET_KEY }, create: { key: OFFSET_KEY, value }, update: { value } });
      }
      if (!updates.length) await sleep(1000);
    } catch (e) {
      // e.g. HTTP 409 while another copy of the server is still polling during a deploy
      console.warn("Stock bot:", (e as Error).message);
      await sleep(10000);
    }
  }
}

let started = false;
export function startStockBot() {
  if (started) return;
  started = true;
  setTimeout(() => { loop().catch((e) => console.error("Stock bot stopped:", e)); }, 3000);
}
