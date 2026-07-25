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

export default function EventsAdmin() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");

  const { data } = useQuery({
    queryKey: ["events", status],
    queryFn: () => api.get<EventsResponse>(`/events${qs({ status: status || undefined, pageSize: 100 })}`),
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

  return (
    <div className="admin-section">
      <p className="muted">
        Every received webhook is stored here before processing, so nothing is lost.
        Errors are retried by Shopify automatically; you can also replay any event.
      </p>
      <div className="admin-subtabs">
        {FILTERS.map((f) => (
          <button key={f} className={status === f ? "active" : ""} onClick={() => setStatus(f)}>
            {LABEL[f]} {f && counts[f] ? `(${counts[f]})` : f === "" ? "" : ""}
          </button>
        ))}
      </div>

      <table className="admin-table">
        <thead>
          <tr><th>Received</th><th>Store</th><th>Kind</th><th>Order</th><th>Status</th><th>Message</th><th></th></tr>
        </thead>
        <tbody>
          {(data?.events ?? []).map((e) => (
            <tr key={e.id}>
              <td className="nowrap">{new Date(e.receivedAt).toLocaleString()}</td>
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
          {(data?.events ?? []).length === 0 && <tr><td colSpan={7} className="muted">No events.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
