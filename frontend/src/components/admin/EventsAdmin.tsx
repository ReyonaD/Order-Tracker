import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "../../api/client";

interface WebhookEvent {
  id: string;
  storeCode: string;
  topic: string;
  kind: string;
  orderName: string | null;
  status: string;
  message: string | null;
  receivedAt: string;
  processedAt: string | null;
  shopifyCreatedAt: string | null;
}

// How long after the order was created in Shopify did our app receive it.
function delayLabel(created: string | null, received: string): string {
  if (!created) return "—";
  const ms = new Date(received).getTime() - new Date(created).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 90) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
interface EventsResponse {
  total: number;
  events: WebhookEvent[];
  counts: Record<string, number>;
}

const FILTERS = ["", "error", "unmatched", "processed", "received"] as const;
const LABEL: Record<string, string> = {
  "": "All", error: "Errors", unmatched: "Unmatched", processed: "Processed", received: "Received",
};

const PAGE_SIZE = 100;

export default function EventsAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");       // debounced/applied search term
  const [page, setPage] = useState(1);

  const { data } = useQuery({
    queryKey: ["events", status, q, page],
    queryFn: () => api.get<EventsResponse>(`/events${qs({ status: status || undefined, q: q || undefined, page, pageSize: PAGE_SIZE })}`),
    refetchInterval: 15000,
  });

  const reprocess = useMutation({
    mutationFn: (id: string) => api.post(`/events/${id}/reprocess`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (e) => alert(e instanceof Error ? e.message : "Reprocess failed"),
  });

  const counts = data?.counts ?? {};
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const applySearch = (v: string) => { setQ(v.trim()); setPage(1); };

  return (
    <div className="admin-section">
      <p className="muted">
        Every received webhook is stored here before processing, so nothing is lost.
        Errors are retried by Shopify automatically; you can also replay any event.
      </p>
      <div className="admin-subtabs">
        {FILTERS.map((f) => (
          <button key={f} className={status === f ? "active" : ""} onClick={() => { setStatus(f); setPage(1); }}>
            {LABEL[f]} {f && counts[f] ? `(${counts[f]})` : f === "" ? "" : ""}
          </button>
        ))}
        <div className="spacer" style={{ flex: 1 }} />
        <input
          className="search"
          placeholder="Search order no (e.g. P24878)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") applySearch(search); }}
        />
        <button onClick={() => applySearch(search)}>Search</button>
        {q && <button className="link-btn" onClick={() => { setSearch(""); applySearch(""); }}>Clear</button>}
      </div>

      <table className="admin-table">
        <thead>
          <tr><th>Shopify created</th><th>Received</th><th>Delay</th><th>Store</th><th>Kind</th><th>Order</th><th>Status</th><th>Message</th><th></th></tr>
        </thead>
        <tbody>
          {(data?.events ?? []).map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{e.shopifyCreatedAt ? new Date(e.shopifyCreatedAt).toLocaleString() : "—"}</td>
              <td className="nowrap">{new Date(e.receivedAt).toLocaleString()}</td>
              <td className="nowrap" title="Time from Shopify order creation until our app received the webhook">{delayLabel(e.shopifyCreatedAt, e.receivedAt)}</td>
              <td>{e.storeCode}</td>
              <td>{e.kind}</td>
              <td className="mono">{e.orderName || ""}</td>
              <td><span className={`event-status event-${e.status}`}>{e.status}</span></td>
              <td className="event-msg" title={e.message || ""}>{e.message || ""}</td>
              <td>
                {(e.status === "error" || e.status === "unmatched") && (
                  <button className="link-btn" onClick={() => reprocess.mutate(e.id)} disabled={reprocess.isPending}>
                    Reprocess
                  </button>
                )}
              </td>
            </tr>
          ))}
          {(data?.events ?? []).length === 0 && <tr><td colSpan={9} className="muted">No events.</td></tr>}
        </tbody>
      </table>

      <div className="pager">
        <span>{total.toLocaleString()} event{total === 1 ? "" : "s"}{q ? ` matching “${q}”` : ""} · page {page}/{totalPages}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
        <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </div>
  );
}
