// Pull the warehouse split (per store, per machine type) from the DTF Monitor
// production site and turn it into Sheet splitPct percentages.
import { env } from "../env";
import { SPLIT_WAREHOUSES } from "./sheetCategories";

// DTF Monitor store abbreviation -> Order Tracker store code.
const STORE_MAP: Record<string, string> = {
  B: "BOSTONIAN", C: "CHEETAH", DWC: "WESTCOAST", G: "GANGROLL", IN: "INDIANA",
  LSV: "LUISVILLE", MC: "MUSICCITY", MS: "MISSOURI", P: "PICASSO", PRO: "PROMO",
};

// DTF Monitor warehouse name -> Sheet warehouse (Promo is the base/remainder).
function mapWarehouse(name: string): string {
  const n = (name || "").toLowerCase();
  if (n.includes("cheetah")) return "Cheetah";
  if (n.includes("houston")) return "Houston";
  if (n.includes("mesquite")) return "Mesquite";
  return "Promo";
}

interface Row { store: string; machine_type: string; warehouse: string; total_inches: number }

// Returns { [otStore]: { DTF: {Cheetah:%,...}, UV: {...} } } — non-base warehouse %.
export async function fetchWarehouseSplit(
  start: string,
  end: string
): Promise<Record<string, Record<string, Record<string, number>>>> {
  if (!env.dtfMonitorUrl || !env.dtfMonitorApiKey) throw new Error("DTF Monitor integration is not configured");
  const url = `${env.dtfMonitorUrl.replace(/\/$/, "")}/api/integrations/warehouse-split?start=${start}&end=${end}`;
  const resp = await fetch(url, { headers: { "X-API-Key": env.dtfMonitorApiKey } });
  if (!resp.ok) throw new Error(`DTF Monitor responded ${resp.status}`);
  const data = (await resp.json()) as { store_type_wh?: Row[] };

  // inches per (otStore, type, warehouse)
  const acc: Record<string, Record<string, Record<string, number>>> = {};
  for (const r of data.store_type_wh || []) {
    const store = STORE_MAP[r.store];
    const type = r.machine_type === "DTF" ? "DTF" : r.machine_type === "UV" ? "UV" : null;
    if (!store || !type) continue; // skip UNRECOGNIZED / unset types
    const wh = mapWarehouse(r.warehouse);
    (acc[store] ||= {});
    (acc[store][type] ||= {});
    acc[store][type][wh] = (acc[store][type][wh] || 0) + (r.total_inches || 0);
  }

  // percentages: non-base warehouse % = inches / total * 100 (0.1% precision)
  const out: Record<string, Record<string, Record<string, number>>> = {};
  for (const [store, byType] of Object.entries(acc)) {
    out[store] = {};
    for (const [type, wh] of Object.entries(byType)) {
      const total = Object.values(wh).reduce((s, v) => s + v, 0);
      const pct: Record<string, number> = {};
      if (total > 0) for (const w of SPLIT_WAREHOUSES) if (wh[w]) pct[w] = Math.round((wh[w] / total) * 1000) / 10;
      out[store][type] = pct;
    }
  }
  return out;
}
