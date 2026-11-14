import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, purchaseFileUrl, uploadPurchaseFiles } from "../../api/client";
import "./purchases.css";

// Purchases (Finance): drop supplier invoices here, Claude reads each one into line
// items, a Finance user checks the read next to the original and approves it.
// Approved invoices feed the per-product price history.

export type Status = "processing" | "review" | "approved" | "failed";
export interface Item {
  id?: string; description: string; sku: string | null; quantity: number | null; unit: string | null;
  unitPrice: number | null; lineTotal: number | null;
}
export interface Invoice {
  id: string; fileName: string; mimeType: string; fileSize: number; status: Status;
  supplier: string | null; invoiceNumber: string | null; invoiceDate: string | null; currency: string | null;
  subtotal: number | null; tax: number | null; shipping: number | null; discount: number | null; total: number | null;
  checkNote: string | null; aiModel: string | null; error: string | null;
  uploadedBy: string | null; approvedBy: string | null; approvedAt: string | null; createdAt: string;
  _count?: { items: number };
  items?: Item[];
}

const STATUS_LABEL: Record<Status, string> = { processing: "Reading…", review: "To review", approved: "Approved", failed: "Failed" };
const FILTERS: { key: "" | Status; label: string }[] = [
  { key: "", label: "All" }, { key: "review", label: "To review" }, { key: "processing", label: "Reading" },
  { key: "approved", label: "Approved" }, { key: "failed", label: "Failed" },
];

export const money = (v: number | null | undefined, cur?: string | null) => {
  if (v == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: cur || "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(v);
  } catch {
    return `${v.toFixed(2)} ${cur ?? ""}`.trim();
  }
};
const shortDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export default function PurchasesPanel() {
  const [tab, setTab] = useState<"invoices" | "products">("invoices");
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="pu-panel">
      <div className="pu-tabs">
        <button className={`pu-tab ${tab === "invoices" ? "on" : ""}`} onClick={() => setTab("invoices")}>Invoices</button>
        <button className={`pu-tab ${tab === "products" ? "on" : ""}`} onClick={() => setTab("products")}>Products &amp; prices</button>
      </div>
      {tab === "invoices" ? <InvoicesTab onOpen={setOpenId} /> : <ProductsTab onOpenInvoice={setOpenId} />}
      {openId && <ReviewDrawer id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ── Invoices ────────────────────────────────────────────────────────────────
function InvoicesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"" | Status>("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  const listQ = useQuery({
    queryKey: ["purchases", q],
    queryFn: () => api.get<{ invoices: Invoice[] }>(`/purchases${q ? `?q=${encodeURIComponent(q)}` : ""}`),
    // keep polling while something is being read
    refetchInterval: (query) => (query.state.data?.invoices.some((i) => i.status === "processing") ? 3000 : false),
  });
  const all = listQ.data?.invoices ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { "": all.length };
    for (const i of all) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [all]);
  const rows = filter ? all.filter((i) => i.status === filter) : all;

  // approved spend per month (by invoice date), per currency
  const months = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const i of all) {
      if (i.status !== "approved" || !i.invoiceDate || i.total == null) continue;
      const key = i.invoiceDate.slice(0, 7);
      const cur = i.currency || "USD";
      if (!m.has(key)) m.set(key, new Map());
      m.get(key)!.set(cur, (m.get(key)!.get(cur) ?? 0) + i.total);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [all]);

  return (
    <div className="pu-invoices">
      <UploadZone onDone={() => qc.invalidateQueries({ queryKey: ["purchases"] })} />

      {months.length > 0 && (
        <div className="pu-months">
          {months.map(([m, curs]) => (
            <div key={m} className="pu-month">
              <span className="pu-month-k">{new Date(`${m}-15`).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
              {[...curs.entries()].map(([cur, v]) => <b key={cur}>{money(v, cur)}</b>)}
            </div>
          ))}
        </div>
      )}

      <div className="pu-toolbar">
        <div className="pu-filters">
          {FILTERS.map((f) => (
            <button key={f.key} className={`pu-filter ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label} <span>{counts[f.key] ?? 0}</span>
            </button>
          ))}
        </div>
        <input className="pu-search" placeholder="Search supplier, invoice no, product…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {listQ.isError && <div className="banner error">{(listQ.error as Error).message}</div>}
      <div className="pu-table-wrap">
        <table className="pu-table">
          <thead>
            <tr><th>Invoice date</th><th>Supplier</th><th>Invoice no</th><th className="num">Items</th><th className="num">Total</th><th>Status</th><th>Uploaded</th></tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} onClick={() => onOpen(i.id)} className="pu-row">
                <td>{shortDate(i.invoiceDate)}</td>
                <td>
                  <div className="pu-sup">{i.supplier || <span className="pu-dim">{i.status === "processing" ? "…" : "Unknown"}</span>}</div>
                  <div className="pu-file" title={i.fileName}>{i.fileName}</div>
                </td>
                <td>{i.invoiceNumber || "—"}</td>
                <td className="num">{i.status === "processing" ? "…" : i._count?.items ?? 0}</td>
                <td className="num">{money(i.total, i.currency)}</td>
                <td>
                  <span className={`pu-status ${i.status}`}>{STATUS_LABEL[i.status]}</span>
                  {i.status === "review" && i.checkNote && <span className="pu-flag" title={i.checkNote}>⚠ check</span>}
                </td>
                <td className="pu-dim">{new Date(i.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{i.uploadedBy ? ` · ${i.uploadedBy}` : ""}</td>
              </tr>
            ))}
            {!listQ.isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className="pu-empty">{all.length ? "Nothing here with this filter." : "No invoices yet. Drop your first PDF or photo above."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UploadZone({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "warn" | "err"; text: string } | null>(null);

  const send = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    setBusy(true); setMsg(null);
    try {
      // the server takes up to 30 files per request
      const results = [];
      for (let i = 0; i < files.length; i += 30) results.push(...(await uploadPurchaseFiles(files.slice(i, i + 30))).results);
      const added = results.filter((r) => r.outcome === "added").length;
      const problems = results.filter((r) => r.outcome !== "added").map((r) => `${r.fileName}: ${r.message}`);
      setMsg({
        kind: problems.length ? "warn" : "ok",
        text: `${added} invoice${added === 1 ? "" : "s"} added and being read.` + (problems.length ? ` Skipped: ${problems.join(" · ")}` : ""),
      });
      onDone();
    } catch (e) {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div>
      <div
        className={`pu-drop ${over ? "over" : ""} ${busy ? "busy" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") input.current?.click(); }}
      >
        <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => send(e.target.files)} />
        <div className="pu-drop-title">{busy ? "Uploading…" : "Drop invoices here or click to choose"}</div>
        <div className="pu-drop-sub">PDF, PNG, JPG or WEBP · up to 20 MB each · many at once</div>
      </div>
      {msg && <div className={`pu-msg ${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}

// ── Review drawer: original file next to the editable read ──────────────────
const r2 = (n: number) => Math.round(n * 100) / 100;
function checkTotals(d: { subtotal: number | null; tax: number | null; shipping: number | null; discount: number | null; total: number | null; items: Item[] }): string | null {
  if (!d.items.length) return "No line items.";
  const lines = d.items.map((i) => i.lineTotal ?? (i.quantity != null && i.unitPrice != null ? i.quantity * i.unitPrice : null));
  if (lines.some((v) => v == null)) return "Some lines have no amount.";
  const sum = r2(lines.reduce((a: number, v) => a + (v as number), 0));
  const extras = (d.tax ?? 0) + (d.shipping ?? 0) - (d.discount ?? 0);
  const expected = d.subtotal ?? (d.total != null ? r2(d.total - extras) : null);
  if (expected == null) return "No subtotal or total to compare with.";
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);
  if (!close(sum, expected)) return `Line items add up to ${sum.toFixed(2)}, the invoice says ${expected.toFixed(2)}.`;
  if (d.subtotal != null && d.total != null && !close(r2(d.subtotal + extras), d.total))
    return `Subtotal + tax + shipping − discount = ${r2(d.subtotal + extras).toFixed(2)}, total is ${d.total.toFixed(2)}.`;
  return null;
}

type Draft = Pick<Invoice, "supplier" | "invoiceNumber" | "invoiceDate" | "currency" | "subtotal" | "tax" | "shipping" | "discount" | "total"> & { items: Item[] };
const toDraft = (i: Invoice): Draft => ({
  supplier: i.supplier, invoiceNumber: i.invoiceNumber, invoiceDate: i.invoiceDate, currency: i.currency,
  subtotal: i.subtotal, tax: i.tax, shipping: i.shipping, discount: i.discount, total: i.total,
  items: (i.items ?? []).map(({ description, sku, quantity, unit, unitPrice, lineTotal }) => ({ description, sku, quantity, unit, unitPrice, lineTotal })),
});
const numOrNull = (s: string): number | null => {
  const t = s.replace(/[$,\s]/g, "");
  if (t === "" || t === "-") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

function ReviewDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const invQ = useQuery({
    queryKey: ["purchase", id],
    queryFn: () => api.get<{ invoice: Invoice }>(`/purchases/${id}`),
    refetchInterval: (query) => (query.state.data?.invoice.status === "processing" ? 3000 : false),
  });
  const inv = invQ.data?.invoice;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);

  // load the server copy whenever it changes and nothing is being edited
  useEffect(() => { if (inv && !dirty) setDraft(toDraft(inv)); }, [inv, dirty]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["purchases"] }); qc.invalidateQueries({ queryKey: ["purchase", id] }); qc.invalidateQueries({ queryKey: ["purchaseProducts"] }); };
  const save = useMutation({
    mutationFn: (d: Draft) => api.put<{ invoice: Invoice }>(`/purchases/${id}`, d),
    onSuccess: () => { setDirty(false); setErr(""); refresh(); },
    onError: (e) => setErr((e as Error).message),
  });
  const act = useMutation({
    mutationFn: async (a: "approve" | "unapprove" | "reread" | "delete") => {
      if (a === "approve" && dirty && draft) { await api.put(`/purchases/${id}`, draft); setDirty(false); }
      return a === "delete" ? api.del(`/purchases/${id}`) : api.post(`/purchases/${id}/${a}`);
    },
    onSuccess: (_r, a) => { setErr(""); refresh(); if (a === "delete" || a === "approve") onClose(); },
    onError: (e) => setErr((e as Error).message),
  });

  const edit = (fn: (d: Draft) => Draft) => { setDraft((d) => (d ? fn(d) : d)); setDirty(true); };
  const setItem = (idx: number, patch: Partial<Item>) =>
    edit((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));

  const locked = !inv || inv.status === "approved" || inv.status === "processing";
  const note = draft ? checkTotals(draft) : null;
  const isPdf = inv?.mimeType === "application/pdf";
  const cur = draft?.currency || "USD";

  return (
    <div className="pu-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pu-drawer" role="dialog" aria-label="Invoice review">
        <div className="pu-dhead">
          <div className="pu-dtitle">
            <b>{inv?.supplier || inv?.fileName || "Invoice"}</b>
            {inv && <span className={`pu-status ${inv.status}`}>{STATUS_LABEL[inv.status]}</span>}
            {inv?.aiModel && <span className="pu-dim pu-small">read by {inv.aiModel.replace("claude-", "").replace(/-(\d)-(\d)$/, " $1.$2")}</span>}
          </div>
          <button className="pu-x" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="pu-dbody">
          <div className="pu-original">
            {inv && (isPdf
              ? <iframe title="Original invoice" src={purchaseFileUrl(inv.id)} />
              : <div className="pu-imgwrap"><img alt="Original invoice" src={purchaseFileUrl(inv.id)} /></div>)}
            {inv && <a className="pu-openfile" href={purchaseFileUrl(inv.id)} target="_blank" rel="noreferrer">Open original ↗</a>}
          </div>

          <div className="pu-read">
            {!inv || !draft ? <div className="pu-dim">Loading…</div> : inv.status === "processing" ? (
              <div className="pu-reading">Reading the invoice… this usually takes 10–30 seconds.</div>
            ) : (
              <>
                {inv.status === "failed" && <div className="pu-msg err">Could not read this file: {inv.error}. Re-read it, or type the lines in below.</div>}
                {inv.status !== "failed" && (note
                  ? <div className="pu-msg warn">⚠ {note} Check the lines against the original.</div>
                  : <div className="pu-msg ok">✓ Line items add up to the invoice totals.</div>)}
                {inv.checkNote && inv.checkNote !== note && <div className="pu-ainote">Note from the read: {inv.checkNote}</div>}

                <div className="pu-head-grid">
                  <label>Supplier<input disabled={locked} value={draft.supplier ?? ""} onChange={(e) => edit((d) => ({ ...d, supplier: e.target.value }))} /></label>
                  <label>Invoice no<input disabled={locked} value={draft.invoiceNumber ?? ""} onChange={(e) => edit((d) => ({ ...d, invoiceNumber: e.target.value }))} /></label>
                  <label>Date<input disabled={locked} type="date" value={draft.invoiceDate ?? ""} onChange={(e) => edit((d) => ({ ...d, invoiceDate: e.target.value || null }))} /></label>
                  <label>Currency<input disabled={locked} value={draft.currency ?? ""} maxLength={3} onChange={(e) => edit((d) => ({ ...d, currency: e.target.value.toUpperCase() }))} /></label>
                </div>

                <div className="pu-items-wrap">
                  <table className="pu-items">
                    <thead><tr><th>Product</th><th>SKU</th><th className="num">Qty</th><th>Unit</th><th className="num">Unit price</th><th className="num">Line total</th>{!locked && <th />}</tr></thead>
                    <tbody>
                      {draft.items.map((it, idx) => (
                        <tr key={idx}>
                          <td><input disabled={locked} value={it.description} onChange={(e) => setItem(idx, { description: e.target.value })} /></td>
                          <td><input disabled={locked} className="pu-sku" value={it.sku ?? ""} onChange={(e) => setItem(idx, { sku: e.target.value || null })} /></td>
                          <td><NumInput disabled={locked} value={it.quantity} onChange={(v) => setItem(idx, { quantity: v })} /></td>
                          <td><input disabled={locked} className="pu-unit" value={it.unit ?? ""} onChange={(e) => setItem(idx, { unit: e.target.value || null })} /></td>
                          <td><NumInput disabled={locked} value={it.unitPrice} onChange={(v) => setItem(idx, { unitPrice: v })} /></td>
                          <td><NumInput disabled={locked} value={it.lineTotal} onChange={(v) => setItem(idx, { lineTotal: v })} /></td>
                          {!locked && <td><button className="pu-del" title="Remove line" onClick={() => edit((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))}>✕</button></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!locked && <button className="pu-addline" onClick={() => edit((d) => ({ ...d, items: [...d.items, { description: "", sku: null, quantity: null, unit: null, unitPrice: null, lineTotal: null }] }))}>+ Add line</button>}

                <div className="pu-totals">
                  {(["subtotal", "tax", "shipping", "discount", "total"] as const).map((k) => (
                    <label key={k} className={k === "total" ? "pu-total" : ""}>
                      <span>{k === "discount" ? "Discount (−)" : k[0].toUpperCase() + k.slice(1)}</span>
                      {locked ? <b>{money(draft[k], cur)}</b> : <NumInput value={draft[k]} onChange={(v) => edit((d) => ({ ...d, [k]: v }))} />}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="pu-dfoot">
          {err && <span className="pu-err">{err}</span>}
          <span className="pu-dim pu-small">
            {inv?.uploadedBy && `Uploaded by ${inv.uploadedBy}. `}
            {inv?.status === "approved" && inv.approvedAt && `Approved by ${inv.approvedBy ?? "—"} on ${new Date(inv.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.`}
          </span>
          <div className="pu-actions">
            {confirmDel ? (
              <>
                <span className="pu-small">Delete this invoice and its file?</span>
                <button className="pu-btn danger" onClick={() => act.mutate("delete")}>Delete</button>
                <button className="pu-btn" onClick={() => setConfirmDel(false)}>Keep</button>
              </>
            ) : (
              <>
                <button className="pu-btn ghost" onClick={() => setConfirmDel(true)}>Delete</button>
                {inv && (inv.status === "review" || inv.status === "failed") && (
                  <button className="pu-btn" disabled={act.isPending} title="Throw away this read (and your edits) and read the file again"
                    onClick={() => { setDirty(false); act.mutate("reread"); }}>Re-read</button>
                )}
                {inv?.status === "approved" && <button className="pu-btn" onClick={() => act.mutate("unapprove")}>Edit</button>}
                {!locked && <button className="pu-btn" disabled={!dirty || save.isPending} onClick={() => draft && save.mutate(draft)}>{save.isPending ? "Saving…" : "Save"}</button>}
                {inv && (inv.status === "review" || (inv.status === "failed" && dirty)) && (
                  <button className="pu-btn primary" disabled={act.isPending || !draft?.items.length || draft.items.some((i) => !i.description.trim())}
                    onClick={() => act.mutate("approve")}>Approve</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumInput({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setText(value == null ? "" : String(value)); } }, [value]);
  return (
    <input className="pu-num" inputMode="decimal" disabled={disabled} value={text}
      onChange={(e) => { setText(e.target.value); const v = numOrNull(e.target.value); last.current = v; onChange(v); }} />
  );
}

// ── Products & prices ───────────────────────────────────────────────────────
// Lines of approved invoices, grouped category > family (variants such as ink colors share
// a family). Free lines ("FREE GIFT", $0) are listed but left out of the price figures.
interface PItem {
  id: string; description: string; sku: string | null; quantity: number | null; unit: string | null;
  unitPrice: number | null; lineTotal: number | null;
  category: string | null; family: string | null; variant: string | null;
  invoice: { id: string; supplier: string | null; invoiceDate: string | null; invoiceNumber: string | null; currency: string | null; createdAt: string };
}
const UNGROUPED = "Not grouped yet";
const when = (i: PItem) => i.invoice.invoiceDate ?? i.invoice.createdAt.slice(0, 10);
const unitPriceOf = (i: PItem) => i.unitPrice ?? (i.lineTotal != null && i.quantity ? i.lineTotal / i.quantity : null);
const isFree = (i: PItem) => { const p = unitPriceOf(i); return p != null && p === 0; };

interface Family {
  key: string; name: string; category: string; rows: PItem[]; variants: string[];
  last: PItem; lastPrice: number | null; change: number | null; min: number | null; max: number | null;
  purchases: number; qty: number; unit: string | null; suppliers: string[];
}

function buildFamilies(items: PItem[]): Family[] {
  const m = new Map<string, PItem[]>();
  for (const it of items) {
    const name = it.family ?? it.description.trim();
    const key = `${it.family ? it.category : UNGROUPED}|${name.toLowerCase()}`;
    if (!m.has(key)) m.set(key, []);
    m.get(key)!.push(it);
  }
  return [...m.entries()].map(([key, rows]) => {
    rows.sort((a, b) => when(b).localeCompare(when(a)));
    const paid = rows.filter((r) => !isFree(r) && unitPriceOf(r) != null);
    const prices = paid.map((r) => unitPriceOf(r) as number);
    // price change = latest invoice's average unit price vs the invoice before it
    const invOrder = [...new Map(paid.map((r) => [r.invoice.id, when(r)])).entries()].sort((a, b) => b[1].localeCompare(a[1]));
    const avgOf = (invId: string) => { const ps = paid.filter((r) => r.invoice.id === invId).map((r) => unitPriceOf(r) as number); return ps.reduce((a, v) => a + v, 0) / ps.length; };
    const lastPrice = invOrder.length ? avgOf(invOrder[0][0]) : null;
    const prevPrice = invOrder.length > 1 ? avgOf(invOrder[1][0]) : null;
    const variants = [...new Set(rows.map((r) => r.variant).filter((v): v is string => !!v))];
    return {
      key, rows, variants,
      name: rows[0].family ?? rows[0].description.trim(),
      category: rows[0].family ? rows[0].category ?? "Other" : UNGROUPED,
      last: paid[0] ?? rows[0], lastPrice,
      change: lastPrice != null && prevPrice ? (lastPrice - prevPrice) / prevPrice : null,
      min: prices.length ? Math.min(...prices) : null, max: prices.length ? Math.max(...prices) : null,
      purchases: new Set(rows.map((r) => r.invoice.id)).size,
      qty: paid.reduce((a, r) => a + (r.quantity ?? 0), 0), unit: rows[0].unit,
      suppliers: [...new Set(rows.map((r) => r.invoice.supplier).filter((s): s is string => !!s))],
    };
  });
}

function ProductsTab({ onOpenInvoice }: { onOpenInvoice: (id: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["purchaseProducts"],
    queryFn: () => api.get<{ items: PItem[]; categories: string[]; ungrouped: number }>("/purchases/products"),
  });
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: "family" | "product"; key: string } | null>(null);
  const [err, setErr] = useState("");

  const groupAll = useMutation({
    mutationFn: () => api.post<{ grouped: number }>("/purchases/group"),
    onSuccess: () => { setErr(""); qc.invalidateQueries({ queryKey: ["purchaseProducts"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const move = useMutation({
    mutationFn: (b: { description?: string; fromFamily?: string; category: string; family: string }) => api.patch("/purchases/groups", b),
    onSuccess: () => { setErr(""); setEditing(null); qc.invalidateQueries({ queryKey: ["purchaseProducts"] }); },
    onError: (e) => setErr((e as Error).message),
  });

  const categories = q.data?.categories ?? [];
  const families = useMemo(() => buildFamilies(q.data?.items ?? []), [q.data]);
  const familyNames = useMemo(() => [...new Set(families.filter((f) => f.category !== UNGROUPED).map((f) => f.name))].sort(), [families]);
  const s = search.trim().toLowerCase();
  const shown = s
    ? families.filter((f) => `${f.name} ${f.category} ${f.suppliers.join(" ")} ${f.rows.map((r) => `${r.description} ${r.sku ?? ""}`).join(" ")}`.toLowerCase().includes(s))
    : families;
  const sections = [...categories, UNGROUPED]
    .map((c) => ({ c, fams: shown.filter((f) => f.category === c).sort((a, b) => a.name.localeCompare(b.name)) }))
    .filter((x) => x.fams.length);
  const ungrouped = q.data?.ungrouped ?? 0;

  return (
    <div className="pu-products">
      <div className="pu-toolbar">
        <span className="pu-dim">Only approved invoices count. Free lines are listed but not used for prices.</span>
        <div className="pu-actions">
          {ungrouped > 0 && (
            <button className="pu-btn" disabled={groupAll.isPending} onClick={() => groupAll.mutate()}>
              {groupAll.isPending ? "Grouping…" : `Group ${ungrouped} line${ungrouped === 1 ? "" : "s"} with AI`}
            </button>
          )}
          <input className="pu-search" placeholder="Search product, SKU, supplier…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {err && <div className="pu-msg err">{err}</div>}
      <datalist id="pu-families">{familyNames.map((n) => <option key={n} value={n} />)}</datalist>

      {sections.map(({ c, fams }) => (
        <section key={c} className="pu-cat">
          <h3 className="pu-cat-h">{c} <span>{fams.length}</span></h3>
          <div className="pu-table-wrap">
            <table className="pu-table">
              <thead><tr><th>Product</th><th>Supplier</th><th>Last bought</th><th className="num">Last unit price</th><th className="num">Change</th><th className="num">Lowest – highest</th><th className="num">Bought</th></tr></thead>
              <tbody>
                {fams.map((f) => {
                  const cur = f.last.invoice.currency;
                  const isOpen = open === f.key;
                  return [
                    <tr key={f.key} className={`pu-row ${isOpen ? "open" : ""}`} onClick={() => setOpen(isOpen ? null : f.key)}>
                      <td>
                        <div className="pu-sup"><span className="pu-caret">{isOpen ? "▾" : "▸"}</span>{f.name}</div>
                        {f.variants.length > 0 && <div className="pu-variants">{f.variants.join(" · ")}</div>}
                      </td>
                      <td>{f.suppliers.join(", ") || "—"}</td>
                      <td>{shortDate(when(f.last))}</td>
                      <td className="num">{money(f.lastPrice, cur)}</td>
                      <td className="num">{f.change == null || Math.abs(f.change) < 0.0005 ? <span className="pu-dim">—</span>
                        : <span className={f.change > 0 ? "pu-up" : "pu-down"}>{f.change > 0 ? "▲" : "▼"} {Math.abs(f.change * 100).toFixed(1)}%</span>}</td>
                      <td className="num">{f.min == null ? "—" : f.min === f.max ? money(f.min, cur) : `${money(f.min, cur)} – ${money(f.max, cur)}`}</td>
                      <td className="num">{f.purchases}× {f.qty ? `· ${+f.qty.toFixed(2)}${f.unit ? ` ${f.unit}` : ""}` : ""}</td>
                    </tr>,
                    isOpen && (
                      <tr key={`${f.key}-h`} className="pu-hist-row">
                        <td colSpan={7}>
                          <div className="pu-hist-bar">
                            {editing?.kind === "family" && editing.key === f.key ? (
                              <GroupEditor categories={categories} category={f.category === UNGROUPED ? "Other" : f.category} family={f.name}
                                saving={move.isPending} onCancel={() => setEditing(null)}
                                onSave={(category, family) => f.category === UNGROUPED
                                  ? Promise.all(f.rows.map((r) => r.description)).then((ds) => [...new Set(ds)].forEach((d) => move.mutate({ description: d, category, family })))
                                  : move.mutate({ fromFamily: f.name, category, family })} />
                            ) : (
                              <button className="pu-link" onClick={() => setEditing({ kind: "family", key: f.key })}>Rename or move this group</button>
                            )}
                          </div>
                          <table className="pu-hist">
                            <thead><tr><th>Date</th><th>Product</th><th>Supplier</th><th>Invoice</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Line total</th><th /></tr></thead>
                            <tbody>
                              {f.rows.map((r) => {
                                const ed = editing?.kind === "product" && editing.key === r.id;
                                return (
                                  <tr key={r.id} className={isFree(r) ? "pu-free" : ""}>
                                    <td>{shortDate(when(r))}</td>
                                    <td>{r.description}{r.variant && <span className="pu-vtag">{r.variant}</span>}{isFree(r) && <span className="pu-vtag free">free</span>}</td>
                                    <td>{r.invoice.supplier ?? "—"}</td>
                                    <td><button className="pu-link" onClick={() => onOpenInvoice(r.invoice.id)}>{r.invoice.invoiceNumber || "open"}</button></td>
                                    <td className="num">{r.quantity ?? "—"}{r.unit ? ` ${r.unit}` : ""}</td>
                                    <td className="num">{money(unitPriceOf(r), r.invoice.currency)}</td>
                                    <td className="num">{money(r.lineTotal, r.invoice.currency)}</td>
                                    <td className="num">
                                      {ed ? (
                                        <GroupEditor categories={categories} category={f.category === UNGROUPED ? "Other" : f.category} family={f.name}
                                          saving={move.isPending} onCancel={() => setEditing(null)}
                                          onSave={(category, family) => move.mutate({ description: r.description, category, family })} />
                                      ) : (
                                        <button className="pu-link" title="Move this product (all its lines) to another group" onClick={() => setEditing({ kind: "product", key: r.id })}>Move</button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!q.isLoading && sections.length === 0 && (
        <div className="pu-table-wrap"><div className="pu-empty">{families.length ? "No product matches the search." : "Approve an invoice to start the price history."}</div></div>
      )}
    </div>
  );
}

function GroupEditor({ categories, category, family, saving, onSave, onCancel }: {
  categories: string[]; category: string; family: string; saving: boolean;
  onSave: (category: string, family: string) => void; onCancel: () => void;
}) {
  const [cat, setCat] = useState(category);
  const [fam, setFam] = useState(family);
  return (
    <span className="pu-geditor" onClick={(e) => e.stopPropagation()}>
      <select value={cat} onChange={(e) => setCat(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
      <input list="pu-families" value={fam} onChange={(e) => setFam(e.target.value)} placeholder="Group name" />
      <button className="pu-btn primary" disabled={saving || !fam.trim()} onClick={() => onSave(cat, fam.trim())}>Save</button>
      <button className="pu-btn" onClick={onCancel}>Cancel</button>
    </span>
  );
}
