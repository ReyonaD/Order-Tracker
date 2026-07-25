import { ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, orderImageUrl, uploadOrderImage } from "../api/client";
import { Dropdowns, FilterCond, Order, Role, RolePerms } from "../types";
import { formatDeadline, formatDateTime, deadlineState } from "../utils";
import { LineItem, summarizeItems, classifyItem, itemLength, relabelType, hasLength, typeLabel, TYPE_COLOR } from "../itemClassify";
import { Layout, useLayoutPrefs } from "../hooks/useLayoutPrefs";
import EditableCell from "./EditableCell";
import ColumnFilters from "./ColumnFilters";

interface Props {
  orders: Order[];
  loading: boolean;
  role: Role;
  dropdowns?: Dropdowns;
  perms?: RolePerms; // current role's column permissions (undefined for ADMIN)
  viewKey: string; // column layout is saved per view
  filters: FilterCond[];
  setFilters: (f: FilterCond[]) => void;
}

interface Ctx {
  dropdowns?: Dropdowns;
  update: (id: string, field: string, value: unknown) => void;
  canEdit: (colKey: string) => boolean;
  refresh: () => void;
}

interface ColumnDef {
  key: string;
  label: string;
  width: number;
  cls?: string;
  render: (o: Order, ctx: Ctx) => ReactNode;
}

const COLUMNS: ColumnDef[] = [
  { key: "orderName", label: "Order No", width: 90, render: (o) => <span className="mono">{o.orderName}</span> },
  {
    key: "urgent", label: "Urgent", width: 60,
    render: (o, c) => (
      <EditableCell type="checkbox" value={o.urgent} editable={c.canEdit("urgent")}
        onCommit={(v) => c.update(o.id, "urgent", v)} />
    ),
  },
  {
    key: "store", label: "Store", width: 92,
    render: (o) => <span className="store-badge" style={{ background: o.store?.color || "#eee" }}>{o.storeCode}</span>,
  },
  { key: "shipping", label: "Pickup/Ship", width: 150, cls: "col-truncate", render: (o) => <span title={o.displayShippingMethod}>{o.displayShippingMethod}</span> },
  { key: "date", label: "Date", width: 128, cls: "nowrap", render: (o) => formatDateTime(o.orderDate) },
  {
    key: "deadline", label: "Deadline", width: 100, cls: "nowrap",
    render: (o) => <span className={`deadline-${deadlineState(o.deadlineAt, o.status)}`}>{formatDeadline(o.deadlineAt, o.deadlineHour)}</span>,
  },
  {
    key: "item", label: "Item", width: 150,
    render: (o) => <ItemCell types={o.itemTypes} lineItems={o.lineItems} />,
  },
  {
    key: "price", label: "Price", width: 80, cls: "nowrap",
    render: (o) => (o.totalPrice != null ? <span className="price-cell">${o.totalPrice.toFixed(2)}</span> : ""),
  },
  {
    key: "designer", label: "Designer", width: 104,
    render: (o, c) => (
      <EditableCell type="select" value={o.designerName} editable={c.canEdit("designer")}
        options={c.dropdowns?.designer ?? []} onCommit={(v) => c.update(o.id, "designerName", v)} />
    ),
  },
  {
    key: "upload", label: "Uploaded", width: 130,
    render: (o, c) => (
      <div className="upload-cell">
        <EditableCell type="select" value={o.uploadStatus} editable={c.canEdit("upload")}
          options={c.dropdowns?.uploadStatus ?? []} onCommit={(v) => c.update(o.id, "uploadStatus", v)} />
        {(o.uploadStatus || "").toLowerCase().includes("problem") && (
          <label className="mail-check" title="Email sent to customer?">
            <input type="checkbox" checked={o.problemEmailSent} disabled={!c.canEdit("upload")}
              onChange={(e) => c.update(o.id, "problemEmailSent", e.target.checked)} />
            <span>mail</span>
          </label>
        )}
      </div>
    ),
  },
  {
    key: "file", label: "File", width: 90,
    render: (o, c) => (
      <FileCell value={o.fileLink} editable={c.canEdit("file")} onCommit={(v) => c.update(o.id, "fileLink", v)} />
    ),
  },
  {
    key: "image", label: "Image", width: 70,
    render: (o, c) => <ImageCell order={o} editable={c.canEdit("image")} refresh={c.refresh} />,
  },
  {
    key: "print", label: "Print", width: 96,
    render: (o, c) => (
      <EditableCell type="select" value={o.printStatus} editable={c.canEdit("print")}
        options={c.dropdowns?.printStatus ?? []} onCommit={(v) => c.update(o.id, "printStatus", v)} />
    ),
  },
  {
    key: "machinist", label: "Operator", width: 110,
    render: (o, c) => (
      <EditableCell type="select" value={o.machinistName} editable={c.canEdit("machinist")}
        options={c.dropdowns?.machinist ?? []} onCommit={(v) => c.update(o.id, "machinistName", v)} />
    ),
  },
  {
    key: "machine", label: "Machine", width: 122,
    render: (o, c) => (
      <EditableCell type="select" value={o.machineName} editable={c.canEdit("machine")}
        options={c.dropdowns?.machine ?? []} onCommit={(v) => c.update(o.id, "machineName", v)} />
    ),
  },
  {
    key: "note", label: "Note", width: 130, cls: "col-truncate",
    render: (o, c) => (
      <NoteCell value={o.designerNote} editable={c.canEdit("note")}
        onCommit={(v) => c.update(o.id, "designerNote", v)} />
    ),
  },
  { key: "order", label: "Order", width: 62, render: (o) => (o.orderUrl ? <a href={o.orderUrl} target="_blank" rel="noreferrer">View</a> : "") },
  {
    key: "tracking", label: "Tracking", width: 130, cls: "col-truncate",
    render: (o) =>
      o.trackingNumber ? (
        o.trackingUrl ? <a href={o.trackingUrl} target="_blank" rel="noreferrer" title={o.trackingNumber}>{o.trackingNumber}</a> : o.trackingNumber
      ) : "",
  },
  { key: "status", label: "Status", width: 94, render: (o) => <span className={`status-badge status-${o.status.toLowerCase()}`}>{o.status}</span> },
];

// File cell: always shows an "open" link when set AND an edit control, so a link
// can be changed after it's first entered (fixes the "can't re-edit" issue).
function FileCell({
  value,
  editable,
  onCommit,
}: {
  value: string | null;
  editable: boolean;
  onCommit: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  useEffect(() => setDraft(value || ""), [value]);

  if (editing) {
    const commit = () => {
      setEditing(false);
      if (draft !== (value || "")) onCommit(draft.trim() || null);
    };
    return (
      <input
        autoFocus
        className="cell-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        }}
      />
    );
  }
  return (
    <span className="file-cell">
      {value && <a href={value} target="_blank" rel="noreferrer" title={value}>file ↗</a>}
      {editable && (
        <button className="file-edit" onClick={() => setEditing(true)}>
          {value ? "edit" : "add link"}
        </button>
      )}
    </span>
  );
}

// Image cell: thumbnail if present (click to enlarge + replace/remove), else an
// upload button. Images are stored server-side and loaded via a tokenized URL.
function ImageCell({ order, editable, refresh }: { order: Order; editable: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement>(null);
  const hasImg = !!order.image;
  const src = `${orderImageUrl(order.id)}&v=${encodeURIComponent(order.image?.updatedAt || "")}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = () => fileRef.current?.click();
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    try { await uploadOrderImage(order.id, f); refresh(); }
    catch (err) { alert(err instanceof Error ? err.message : "Upload failed"); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const remove = async () => {
    if (!confirm("Remove this image?")) return;
    setBusy(true);
    try { await api.del(`/orders/${order.id}/image`); refresh(); setOpen(false); }
    catch (err) { alert(err instanceof Error ? err.message : "Failed"); }
    finally { setBusy(false); }
  };
  const openBox = () => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      const boxW = 320, boxH = 320;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - boxW - 12));
      const top = r.bottom + boxH + 12 > window.innerHeight ? Math.max(8, r.top - boxH - 6) : r.bottom + 6;
      setPos({ top, left });
    }
    setOpen(true);
  };

  return (
    <>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={onFile} />
      {hasImg ? (
        <img ref={anchorRef as React.RefObject<HTMLImageElement>} className="img-thumb" src={src} alt="order" onClick={openBox} />
      ) : editable ? (
        <button ref={anchorRef as React.RefObject<HTMLButtonElement>} className="img-upload" onClick={pick} disabled={busy}>
          {busy ? "…" : "+ img"}
        </button>
      ) : (
        <span className="cell-placeholder">—</span>
      )}
      {open && pos && (
        <div ref={boxRef} className="img-box" style={{ top: pos.top, left: pos.left }}>
          <img src={src} className="img-full" alt="order" />
          {editable && (
            <div className="img-actions">
              <button onClick={pick} disabled={busy}>Replace</button>
              <button className="danger" onClick={remove} disabled={busy}>Remove</button>
              <a href={src} target="_blank" rel="noreferrer">Open</a>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// Note cell: shows a truncated preview; clicking opens a floating box with the full
// note (editable). Clicking outside closes it (and saves if changed).
function NoteCell({
  value,
  editable,
  onCommit,
}: {
  value: string | null;
  editable: boolean;
  onCommit: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setDraft(value || ""), [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setDraft(value || ""); setOpen(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const openBox = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const boxW = 340, boxH = 200;
      let left = Math.min(r.left, window.innerWidth - boxW - 12);
      left = Math.max(8, left);
      // Prefer below; flip above if it would overflow the viewport bottom.
      const top = r.bottom + boxH + 12 > window.innerHeight ? Math.max(8, r.top - boxH - 6) : r.bottom + 6;
      setPos({ top, left });
    }
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    if (editable && draft !== (value || "")) onCommit(draft.trim() || null);
  };

  return (
    <>
      <span ref={triggerRef} className="note-trigger" onClick={openBox} title="Click to open note">
        {value ? value : <span className="cell-placeholder">note</span>}
      </span>
      {open && pos && (
        <div ref={boxRef} className="note-box" style={{ top: pos.top, left: pos.left }}>
          <div className="note-box-head">Note {editable && <span className="note-hint">click outside to save</span>}</div>
          {editable ? (
            <textarea className="note-textarea" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} placeholder="Write a note…" />
          ) : (
            <div className="note-readonly">{value || <span className="cell-placeholder">No note</span>}</div>
          )}
        </div>
      )}
    </>
  );
}

// Item cell: shows each item type in the order with its total length (inches),
// e.g. DTF 120"  UV 60".  Length = sum(M * quantity) where the size is "N x M".
// Clicking opens a popover listing each product with quantity, length and price.
function ItemCell({
  types,
  lineItems,
}: {
  types: string[];
  lineItems?: LineItem[] | null;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const items = lineItems ?? [];
  const hasDetail = items.length > 0;
  const summary = summarizeItems(items);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openBox = () => {
    if (!hasDetail) return;
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) {
      const boxW = 380, boxH = Math.min(320, 60 + items.length * 24);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - boxW - 12));
      const top = r.bottom + boxH + 12 > window.innerHeight ? Math.max(8, r.top - boxH - 6) : r.bottom + 6;
      setPos({ top, left });
    }
    setOpen(true);
  };

  // Fallback for orders without line item data (old CSV imports): stored types.
  const fallback = types.map((t) => typeLabel(relabelType(t)));

  return (
    <>
      <span
        ref={anchorRef}
        className={hasDetail ? "item-trigger item-summary" : "item-summary"}
        onClick={openBox}
        title={hasDetail ? "Click for item details" : undefined}
      >
        {summary.length > 0
          ? summary.map((s) => (
              <span className="item-type-col" key={s.type} style={{ color: TYPE_COLOR[s.type] }}>
                <span className="itc-type">{typeLabel(s.type)}</span>
                <span className="itc-len">{s.inches > 0 ? `${s.inches}"` : `×${s.qty}`}</span>
              </span>
            ))
          : fallback.length > 0
          ? <span style={{ color: TYPE_COLOR[fallback[0]], fontWeight: 600 }}>{fallback.join(", ")}</span>
          : hasDetail
          ? <span>{items.length} item(s)</span>
          : ""}
      </span>
      {open && pos && (
        <div ref={boxRef} className="item-box" style={{ top: pos.top, left: pos.left }}>
          <div className="item-box-head">Items ({items.length})</div>
          {items.map((it, i) => {
            const qty = it.quantity ?? 1;
            const unit = it.price != null ? Number(it.price) : null;
            const type = classifyItem(it);
            const len = hasLength(type) ? itemLength(it) : 0;
            return (
              <div className="item-line" key={i}>
                <span className="item-qty">{qty}×</span>
                <span className="item-name" title={it.name || it.title}>{it.name || it.title || "item"}</span>
                {len > 0 && <span className="item-len">{len * qty}"</span>}
                {type && <span className="item-tag" style={{ color: TYPE_COLOR[type] }}>{type}</span>}
                {unit != null && <span className="item-price">${(unit * qty).toFixed(2)}</span>}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));
const ALL_KEYS = COLUMNS.map((c) => c.key);
const REORDERABLE = ALL_KEYS.filter((k) => k !== "orderName");
const DEFAULT_LAYOUT: Layout = { order: REORDERABLE, widths: {}, visible: ALL_KEYS };
const MINIMAL_VISIBLE = ["store", "deadline", "item", "status"];

function orderWithMissing(saved: string[]): string[] {
  const known = saved.filter((k) => REORDERABLE.includes(k));
  return [...known, ...REORDERABLE.filter((k) => !known.includes(k))];
}

export default function OrdersTable({ orders, loading, role, dropdowns, perms, viewKey, filters, setFilters }: Props) {
  const queryClient = useQueryClient();
  const { layout, setLayout, presets, setPresets } = useLayoutPrefs(DEFAULT_LAYOUT, viewKey);
  const order = layout.order;
  const widths = layout.widths;
  const visible = new Set(layout.visible);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const setOrder = (fn: (prev: string[]) => string[]) => setLayout((l) => ({ ...l, order: fn(l.order) }));
  const setWidths = (fn: (prev: Record<string, number>) => Record<string, number>) =>
    setLayout((l) => ({ ...l, widths: fn(l.widths) }));
  const setVisibleArr = (fn: (prev: string[]) => string[]) => setLayout((l) => ({ ...l, visible: fn(l.visible) }));

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const mutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => api.patch(`/orders/${id}`, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });
  const update = (id: string, field: string, value: unknown) => mutation.mutate({ id, patch: { [field]: value } });

  // Role permissions (ADMIN sees/edits everything).
  const canView = (key: string) => role === "ADMIN" || key === "orderName" || perms?.[key]?.view !== false;
  const canEdit = (key: string) => role === "ADMIN" || perms?.[key]?.edit === true;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["orders"] });
  const ctx: Ctx = { dropdowns, update, canEdit, refresh };

  const cols: ColumnDef[] = [
    BY_KEY.get("orderName")!,
    ...order.filter((k) => visible.has(k) && canView(k)).map((k) => BY_KEY.get(k)!),
  ];
  const widthOf = (c: ColumnDef) => widths[c.key] ?? c.width;

  const toggle = (key: string) =>
    setVisibleArr((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const applyPreset = (p: { order: string[]; widths: Record<string, number>; visible: string[] }) =>
    setLayout({ order: orderWithMissing(p.order), widths: p.widths ?? {}, visible: p.visible ?? ALL_KEYS });
  const savePreset = () => {
    const name = prompt("Preset name:")?.trim();
    if (!name) return;
    setPresets((prev) => [...prev.filter((x) => x.name !== name), { name, order, widths, visible: layout.visible }]);
  };
  const deletePreset = (name: string) => setPresets((prev) => prev.filter((x) => x.name !== name));

  const onDrop = (targetKey: string) => {
    const from = dragKey.current;
    dragKey.current = null;
    if (!from || from === targetKey || from === "orderName" || targetKey === "orderName") return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== from);
      next.splice(next.indexOf(targetKey), 0, from);
      return next;
    });
  };

  const startResize = (e: React.MouseEvent, c: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key: c.key, startX: e.clientX, startW: widthOf(c) };
    const onMove = (ev: MouseEvent) => {
      const r = resizing.current;
      if (!r) return;
      // Capture key/start locally — resizing.current may be null by the time the
      // state updater runs (on mouseup), which previously crashed to a white screen.
      const w = Math.max(44, r.startW + (ev.clientX - r.startX));
      setWidths((prev) => ({ ...prev, [r.key]: w }));
    };
    const onUp = () => {
      resizing.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const pickerKeys = REORDERABLE.filter(canView);

  return (
    <div className="table-scroll">
      <div className="table-toolbar">
        <div className="col-picker" ref={pickerRef}>
          <button className="toolbar-btn" onClick={() => setPickerOpen((o) => !o)}>⚙ Columns</button>
          {pickerOpen && (
            <div className="col-picker-menu">
              {pickerKeys.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked={visible.has(k)} onChange={() => toggle(k)} />
                  {BY_KEY.get(k)!.label}
                </label>
              ))}
              <div className="col-picker-actions">
                <button onClick={() => setVisibleArr(() => ALL_KEYS)}>All</button>
                <button onClick={() => setVisibleArr(() => MINIMAL_VISIBLE)}>Minimal</button>
                <button onClick={() => setLayout((l) => ({ ...l, order: REORDERABLE.slice(), widths: {} }))}>Reset layout</button>
              </div>
              <div className="preset-section">
                <div className="preset-title">Presets</div>
                {presets.length === 0 && <div className="muted small">No presets yet.</div>}
                {presets.map((p) => (
                  <div className="preset-row" key={p.name}>
                    <button className="preset-apply" onClick={() => applyPreset(p)}>{p.name}</button>
                    <button className="link-btn danger" title="Delete preset" onClick={() => deletePreset(p.name)}>×</button>
                  </div>
                ))}
                <button className="preset-save" onClick={savePreset}>+ Save current as preset</button>
              </div>
            </div>
          )}
        </div>
        <ColumnFilters filters={filters} setFilters={setFilters} dropdowns={dropdowns} />
        <span className="toolbar-hint">Drag a header to reorder · drag its right edge to resize · Order No is pinned</span>
      </div>

      <div className="table-viewport">
        {loading ? (
          <div className="table-status">Loading orders…</div>
        ) : orders.length === 0 ? (
          <div className="table-status">No orders match this view.</div>
        ) : (
          <table className="orders-table fixed">
            <colgroup>
              {cols.map((c) => <col key={c.key} style={{ width: widthOf(c) }} />)}
            </colgroup>
            <thead>
              <tr>
                {cols.map((c) => {
                  const pinned = c.key === "orderName";
                  return (
                    <th
                      key={c.key}
                      className={pinned ? "sticky-col" : "draggable-col"}
                      draggable={!pinned}
                      onDragStart={() => { if (!pinned) dragKey.current = c.key; }}
                      onDragOver={(e) => { if (!pinned) e.preventDefault(); }}
                      onDrop={() => onDrop(c.key)}
                    >
                      <span className="th-label">{c.label}</span>
                      <span className="th-resize" onMouseDown={(e) => startResize(e, c)} />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const rowClass = [
                  o.status === "CANCELLED" ? "row-cancelled" : "",
                  o.status === "FULFILLED" ? "row-fulfilled" : "",
                  o.urgent ? "row-urgent" : "",
                ].filter(Boolean).join(" ");
                return (
                  <tr key={o.id} className={rowClass}>
                    {cols.map((c) => (
                      <td
                        key={c.key}
                        className={[c.cls || "", c.key === "orderName" ? "sticky-col" : "", c.key === "urgent" ? "center" : ""].filter(Boolean).join(" ")}
                      >
                        {c.render(o, ctx)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
