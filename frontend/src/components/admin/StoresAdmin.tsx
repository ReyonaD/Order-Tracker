import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { Store } from "../../types";

const webhookBase = `${window.location.origin}/webhooks`;

// Friendly labels for the timezones the shops actually use (value = IANA id).
const TIMEZONES: { value: string; label: string }[] = [
  { value: "America/New_York", label: "Eastern — New York" },
  { value: "America/Chicago", label: "Central — Chicago / Dallas" },
  { value: "America/Denver", label: "Mountain — Denver" },
  { value: "America/Phoenix", label: "Arizona — Phoenix (no DST)" },
  { value: "America/Los_Angeles", label: "Pacific — Los Angeles" },
  { value: "America/Indiana/Indianapolis", label: "Indiana — Indianapolis" },
  { value: "America/Anchorage", label: "Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Honolulu" },
];

// A timezone <select> that keeps any unknown current value as an extra option.
function TimezoneSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const known = TIMEZONES.some((t) => t.value === value);
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && value && <option value={value}>{value}</option>}
      {TIMEZONES.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  );
}

export default function StoresAdmin() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["stores"], queryFn: () => api.get<{ stores: Store[] }>("/stores") });
  const [showAdd, setShowAdd] = useState(false);

  return (
    <div className="admin-section">
      <p className="muted">
        Store colors, cutoff hours and Shopify identifiers. Copy each store's webhook URL
        into Shopify (Settings → Notifications → Webhooks) for Order creation, fulfillment
        and cancellation. Then paste the store's Shopify signing secret here so webhooks
        pass HMAC verification.
      </p>

      <button className="toolbar-btn" onClick={() => setShowAdd((s) => !s)} style={{ marginBottom: 12 }}>
        {showAdd ? "− Cancel" : "+ Add store"}
      </button>
      {showAdd && <AddStoreForm onDone={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ["stores"] }); }} />}

      <table className="admin-table stores-table">
        <thead>
          <tr>
            <th>Code</th><th>Name</th><th>Webhook URL</th><th>Color</th><th>Shopify ID</th>
            <th>Timezone</th><th>Pickup</th><th>Ship</th><th>Secret</th><th></th>
          </tr>
        </thead>
        <tbody>
          {(data?.stores ?? []).map((s) => <StoreRow key={s.id} store={s} />)}
        </tbody>
      </table>
    </div>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked; user can select manually */
    }
  };
  return (
    <div className="copy-field">
      <input className="copy-input" readOnly value={value} onFocus={(e) => e.target.select()} />
      <button className="toolbar-btn" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
    </div>
  );
}

function StoreRow({ store }: { store: Store }) {
  const qc = useQueryClient();
  const [color, setColor] = useState(store.color);
  const [shopifyIdentifier, setShopify] = useState(store.shopifyIdentifier);
  const [timezone, setTimezone] = useState(store.timezone);
  const [pickup, setPickup] = useState(store.pickupCutoffHour);
  const [ship, setShip] = useState(store.shippingCutoffHour);
  const [secret, setSecret] = useState("");

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/stores/${store.id}`, {
        color, shopifyIdentifier, timezone,
        pickupCutoffHour: pickup, shippingCutoffHour: ship,
        ...(secret ? { webhookSecret: secret } : {}),
      }),
    onSuccess: () => { setSecret(""); qc.invalidateQueries({ queryKey: ["stores"] }); },
    onError: (e) => alert(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <tr>
      <td><span className="store-badge" style={{ background: color }}>{store.code}</span></td>
      <td>{store.name}</td>
      <td><CopyField value={`${webhookBase}/${store.code}`} /></td>
      <td><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></td>
      <td><input className="w-narrow" value={shopifyIdentifier} onChange={(e) => setShopify(e.target.value)} /></td>
      <td><TimezoneSelect className="w-tz" value={timezone} onChange={setTimezone} /></td>
      <td><input className="w-num" type="number" min={0} max={23} value={pickup} onChange={(e) => setPickup(Number(e.target.value))} /></td>
      <td><input className="w-num" type="number" min={0} max={23} value={ship} onChange={(e) => setShip(Number(e.target.value))} /></td>
      <td>
        <div className="secret-cell">
          <input className="w-narrow" type="password"
            placeholder={store.hasSecret ? "replace secret…" : "set secret…"}
            value={secret} onChange={(e) => setSecret(e.target.value)} />
          {store.hasSecret
            ? <span className="secret-ok" title="A webhook secret is configured">✓ set</span>
            : <span className="secret-none" title="No secret — webhooks will be rejected">✗ none</span>}
        </div>
      </td>
      <td><button onClick={() => save.mutate()} disabled={save.isPending}>{save.isSuccess && !secret ? "Saved" : "Save"}</button></td>
    </tr>
  );
}

function AddStoreForm({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("#00C2E2");
  const [shopifyIdentifier, setShopify] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [pickup, setPickup] = useState(14);
  const [ship, setShip] = useState(14);

  const create = useMutation({
    mutationFn: () =>
      api.post("/stores", {
        code, name, color, shopifyIdentifier, timezone,
        pickupCutoffHour: pickup, shippingCutoffHour: ship,
      }),
    onSuccess: onDone,
    onError: (e) => alert(e instanceof Error ? e.message : "Failed"),
  });

  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate(); };

  return (
    <form className="admin-form" onSubmit={submit}>
      <h3>New store</h3>
      <div className="admin-form-row">
        <input placeholder="CODE (e.g. DALLAS)" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} required />
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="Shopify ID (store handle)" value={shopifyIdentifier} onChange={(e) => setShopify(e.target.value)} required />
        <label className="inline">Color <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
      </div>
      <div className="admin-form-row">
        <TimezoneSelect className="w-tz" value={timezone} onChange={setTimezone} />
        <label className="inline">Pickup cutoff <input className="w-num" type="number" min={0} max={23} value={pickup} onChange={(e) => setPickup(Number(e.target.value))} /></label>
        <label className="inline">Ship cutoff <input className="w-num" type="number" min={0} max={23} value={ship} onChange={(e) => setShip(Number(e.target.value))} /></label>
        <button type="submit" disabled={create.isPending}>Create store</button>
      </div>
    </form>
  );
}
