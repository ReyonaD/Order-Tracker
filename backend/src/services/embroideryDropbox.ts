// Embroidery designs in Dropbox. The design folder (EMB_DROPBOX_PATH, in the team
// namespace like DTF Monitor's PRODUCTION) is listed recursively once, then followed
// with list_folder/continue every minute. The order number is read from each file name.
import { prisma } from "../db";

const API = "https://api.dropboxapi.com/2";
const CURSOR_KEY = "dbx_cursor";
// Dropbox's edge 403s some default user agents
const UA = "Mozilla/5.0 (OrderTracker)";

const cfg = () => ({
  appKey: process.env.DROPBOX_APP_KEY || "",
  appSecret: process.env.DROPBOX_APP_SECRET || "",
  refresh: process.env.DROPBOX_REFRESH_TOKEN || "",
  rootNs: process.env.DROPBOX_ROOT_NS || "",
  path: (process.env.EMB_DROPBOX_PATH || "").trim().replace(/\/+$/, ""),
});
export const dbxConfigured = () => { const c = cfg(); return !!(c.appKey && c.appSecret && c.refresh && c.path); };

let token = "";
let tokenExp = 0;
async function bearer() {
  if (token && Date.now() < tokenExp - 120_000) return token;
  const c = cfg();
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${c.appKey}:${c.appSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: c.refresh }),
  });
  if (!res.ok) throw new Error(`Dropbox token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = (await res.json()) as { access_token: string; expires_in?: number };
  token = d.access_token;
  tokenExp = Date.now() + (d.expires_in ?? 14400) * 1000;
  return token;
}

class DbxError extends Error { constructor(public status: number, public body: string) { super(`Dropbox ${status}: ${body.slice(0, 200)}`); } }

async function post<T>(endpoint: string, payload: unknown): Promise<T> {
  const c = cfg();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await bearer()}`, "Content-Type": "application/json", "User-Agent": UA,
        ...(c.rootNs ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", root: c.rootNs }) } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (res.ok) return (await res.json()) as T;
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get("Retry-After")) || 2 ** attempt) * 1000));
      continue;
    }
    throw new DbxError(res.status, await res.text());
  }
}

/** Etsy receipt (10 digits) or Amazon (123-1234567-1234567) order number in a file name. */
export function orderNumberIn(name: string): string | null {
  const amazon = name.match(/\d{3}-\d{7}-\d{7}/);
  if (amazon) return amazon[0];
  const runs = name.match(/(?<!\d)\d{9,12}(?!\d)/g);
  return runs ? (runs.find((r) => r.length === 10) ?? runs[0]) : null;
}

interface Entry { ".tag": "file" | "folder" | "deleted"; name: string; path_lower: string; path_display?: string; size?: number; server_modified?: string }
interface ListResult { entries: Entry[]; cursor: string; has_more: boolean }

async function apply(entries: Entry[]) {
  for (const e of entries) {
    if (e[".tag"] === "deleted") {
      // a deleted folder takes its files with it
      await prisma.embDesignFile.deleteMany({ where: { OR: [{ path: e.path_lower }, { path: { startsWith: `${e.path_lower}/` } }] } });
    } else if (e[".tag"] === "file") {
      const data = {
        pathDisplay: e.path_display ?? e.path_lower, name: e.name, orderNumber: orderNumberIn(e.name),
        size: e.size ?? null, uploadedAt: e.server_modified ? new Date(e.server_modified) : null,
      };
      await prisma.embDesignFile.upsert({ where: { path: e.path_lower }, create: { path: e.path_lower, ...data }, update: data });
    }
  }
}

let running = false;
let lastRun: { at: Date; changes: number; error: string | null } | null = null;
export const dbxStatus = () => lastRun;

export async function syncDropbox(full = false): Promise<void> {
  if (!dbxConfigured() || running) return;
  running = true;
  let changes = 0;
  try {
    const cur = full ? null : await prisma.embSyncState.findUnique({ where: { key: CURSOR_KEY } });
    let r: ListResult;
    try {
      r = cur ? await post<ListResult>("files/list_folder/continue", { cursor: cur.value })
        : await post<ListResult>("files/list_folder", { path: cfg().path, recursive: true, limit: 2000 });
    } catch (e) {
      // an expired/reset cursor: start over with a full listing
      if (!(cur && e instanceof DbxError && e.status === 409)) throw e;
      r = await post<ListResult>("files/list_folder", { path: cfg().path, recursive: true, limit: 2000 });
    }
    if (!cur) await prisma.embDesignFile.deleteMany({});   // a full listing is the whole truth
    for (;;) {
      changes += r.entries.length;
      await apply(r.entries);
      await prisma.embSyncState.upsert({ where: { key: CURSOR_KEY }, create: { key: CURSOR_KEY, value: r.cursor }, update: { value: r.cursor } });
      if (!r.has_more) break;
      r = await post<ListResult>("files/list_folder/continue", { cursor: r.cursor });
    }
    lastRun = { at: new Date(), changes, error: null };
  } catch (e) {
    lastRun = { at: new Date(), changes, error: (e as Error).message };
    console.warn("Embroidery Dropbox sync:", (e as Error).message);
  } finally {
    running = false;
  }
}

/** A 4-hour download link for a design file. */
export async function temporaryLink(pathLower: string): Promise<string> {
  const r = await post<{ link: string }>("files/get_temporary_link", { path: pathLower });
  return r.link;
}
