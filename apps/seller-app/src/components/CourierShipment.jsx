import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api.js";

// Seller-side courier workflow for the seller's OWN items in an order.
// A multi-seller order produces one shipment per seller; this panel only
// ever reads/writes the current seller's group.

function token() {
  return localStorage.getItem("justbrand_seller_token") || "";
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token()}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.success === false) {
    throw new Error(data?.message || `Request failed (${response.status})`);
  }
  return data;
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CourierShipment({ order, onStatusUpdate }) {
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState(null);
  const [error, setError] = useState("");
  const [pickup, setPickup] = useState(null);
  const [pkg, setPkg] = useState({ weightKg: "0.5", length: "10", breadth: "10", height: "5" });
  const [quotes, setQuotes] = useState([]);
  const [recommended, setRecommended] = useState(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [manualAwb, setManualAwb] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const shipment = group?.shipment || null;

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await request(`/api/sellers/orders/${order.id}/shipment-groups`);
      const nextGroup = data.groups?.[0] || null;
      setGroup(nextGroup);
      setPickup(
        nextGroup?.pickup || {
          contactName: "",
          phone: "",
          address: "",
          city: "",
          state: "",
          pincode: "",
          providerLocationName: "",
        }
      );
      if (nextGroup?.package) {
        setPkg({
          weightKg: String(nextGroup.package.weightKg ?? 0.5),
          length: String(nextGroup.package.length ?? 10),
          breadth: String(nextGroup.package.breadth ?? 10),
          height: String(nextGroup.package.height ?? 5),
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => quotes.find((quote) => quoteKey(quote) === selectedKey) || null,
    [quotes, selectedKey]
  );

  async function savePickup() {
    setBusy("pickup");
    setMessage("");
    try {
      const data = await request("/api/sellers/courier/pickup", {
        method: "PUT",
        body: pickup,
      });
      setMessage(data.message || "Pickup address saved.");
      await load();
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function compare() {
    setBusy("compare");
    setMessage("");
    try {
      const data = await request(`/api/sellers/orders/${order.id}/shipments/quote`, {
        method: "POST",
        body: {
          package: {
            weightKg: Number(pkg.weightKg) || 0.5,
            length: Number(pkg.length) || 10,
            breadth: Number(pkg.breadth) || 10,
            height: Number(pkg.height) || 5,
          },
        },
      });
      setQuotes(data.quotes || []);
      setRecommended(data.recommended || null);
      setSelectedKey(data.recommended ? quoteKey(data.recommended) : "");
      setMessage(
        data.recommended
          ? `${data.quotes.length} courier option(s) available.`
          : "No courier is serviceable for this PIN/package. Nothing fake was added."
      );
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function book() {
    if (!selected) return;
    if (selected.mode === "live" && !selected.courierCompanyId) {
      setMessage("⚠️ Select a live Shiprocket courier option before booking.");
      return;
    }
    if (
      selected.mode === "live" &&
      !window.confirm("This will create a real Shiprocket shipment. Continue?")
    ) {
      return;
    }
    setBusy("book");
    setMessage("");
    try {
      const data = await request(`/api/sellers/orders/${order.id}/shipments`, {
        method: "POST",
        body: {
          courierPartnerId: selected.partnerId,
          courierCompanyId: selected.courierCompanyId || null,
          courierName: selected.courierName || selected.partnerName,
          package: {
            weightKg: Number(pkg.weightKg) || 0.5,
            length: Number(pkg.length) || 10,
            breadth: Number(pkg.breadth) || 10,
            height: Number(pkg.height) || 5,
          },
          rate: selected.rate,
          estimatedDeliveryDays: selected.estimatedDeliveryDays,
          estimatedDeliveryDate: selected.estimatedDeliveryDate,
          awbNumber: manualAwb || undefined,
          requestPickup: selected.mode === "live",
          generateLabel: selected.mode === "live",
        },
      });
      setMessage(data.message || "Shipment recorded.");
      setQuotes([]);
      setSelectedKey("");
      setManualAwb("");
      await load();
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function action(kind) {
    if (!shipment) return;
    let body = { action: kind };
    if (kind === "label" && shipment.mode === "manual") {
      const labelUrl = window.prompt("Paste the label URL/reference from the courier:");
      if (!labelUrl) return;
      body = { ...body, labelUrl };
    }
    setBusy(kind);
    setMessage("");
    try {
      const data = await request(`/api/sellers/courier/shipments/${shipment.id}/action`, {
        method: "POST",
        body,
      });
      setMessage(data.message || "Shipment updated.");
      await load();
    } catch (err) {
      setMessage(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  if (loading) {
    return <div style={styles.notice}>Loading your shipment details…</div>;
  }
  if (error) {
    return <div style={styles.error}>⚠️ {error}</div>;
  }
  if (!group) {
    return <div style={styles.notice}>No seller shipment group was found for this order.</div>;
  }

  const canMarkPacked = !["Shipped", "Delivered", "Cancelled", "Returned", "Refunded"].includes(
    order.status
  );

  return (
    <div>
      <div style={styles.notice}>
        <strong>Your pickup and package</strong>
        <div style={{ marginTop: 4 }}>
          Only your items in this order are shipped. The customer may receive separate shipments from
          other sellers.
        </div>
      </div>

      <div style={styles.grid}>
        <Field label="Pickup contact">
          <input
            style={styles.input}
            value={pickup?.contactName || ""}
            onChange={(event) => setPickup({ ...pickup, contactName: event.target.value })}
          />
        </Field>
        <Field label="Pickup phone">
          <input
            style={styles.input}
            value={pickup?.phone || ""}
            onChange={(event) => setPickup({ ...pickup, phone: event.target.value })}
          />
        </Field>
        <Field label="Pickup address">
          <input
            style={styles.input}
            value={pickup?.address || ""}
            onChange={(event) => setPickup({ ...pickup, address: event.target.value })}
          />
        </Field>
        <Field label="City">
          <input
            style={styles.input}
            value={pickup?.city || ""}
            onChange={(event) => setPickup({ ...pickup, city: event.target.value })}
          />
        </Field>
        <Field label="State">
          <input
            style={styles.input}
            value={pickup?.state || ""}
            onChange={(event) => setPickup({ ...pickup, state: event.target.value })}
          />
        </Field>
        <Field label="Pickup PIN">
          <input
            style={styles.input}
            value={pickup?.pincode || ""}
            onChange={(event) => setPickup({ ...pickup, pincode: event.target.value })}
          />
        </Field>
        <Field label="Shiprocket pickup nickname (if registered)">
          <input
            style={styles.input}
            value={pickup?.providerLocationName || ""}
            onChange={(event) => setPickup({ ...pickup, providerLocationName: event.target.value })}
          />
        </Field>
      </div>

      <div style={{ marginTop: 8 }}>
        <button type="button" style={styles.primary} disabled={busy === "pickup"} onClick={savePickup}>
          {busy === "pickup" ? "Saving…" : "Save pickup address"}
        </button>
      </div>

      <div style={{ ...styles.grid, marginTop: 14 }}>
        <Field label="Weight (kg)">
          <input
            style={styles.input}
            type="number"
            min="0.01"
            value={pkg.weightKg}
            onChange={(event) => setPkg({ ...pkg, weightKg: event.target.value })}
          />
        </Field>
        <Field label="Length (cm)">
          <input
            style={styles.input}
            type="number"
            min="1"
            value={pkg.length}
            onChange={(event) => setPkg({ ...pkg, length: event.target.value })}
          />
        </Field>
        <Field label="Breadth (cm)">
          <input
            style={styles.input}
            type="number"
            min="1"
            value={pkg.breadth}
            onChange={(event) => setPkg({ ...pkg, breadth: event.target.value })}
          />
        </Field>
        <Field label="Height (cm)">
          <input
            style={styles.input}
            type="number"
            min="1"
            value={pkg.height}
            onChange={(event) => setPkg({ ...pkg, height: event.target.value })}
          />
        </Field>
      </div>

      {!shipment ? (
        <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" style={styles.primary} disabled={busy === "compare"} onClick={compare}>
            {busy === "compare" ? "Checking…" : "Check courier options"}
          </button>
          {canMarkPacked ? (
            <button
              type="button"
              style={styles.secondary}
              onClick={() => onStatusUpdate?.(order.id, "Ready for Pickup")}
            >
              Mark packed & ready for pickup
            </button>
          ) : null}
        </div>
      ) : null}

      {quotes.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th>Use</th>
                  <th>Courier</th>
                  <th>Mode</th>
                  <th>Rate</th>
                  <th>ETA</th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((quote) => {
                  const key = quoteKey(quote);
                  const best = recommended && quoteKey(recommended) === key;
                  return (
                    <tr key={key}>
                      <td>
                        <input
                          type="radio"
                          name="seller-courier"
                          checked={selectedKey === key}
                          onChange={() => setSelectedKey(key)}
                        />
                      </td>
                      <td>
                        <strong>{quote.courierName || quote.partnerName}</strong>
                        {best ? <span style={styles.best}>Best</span> : null}
                        <div style={styles.muted}>{quote.note || ""}</div>
                      </td>
                      <td>{quote.mode}</td>
                      <td>₹{Number(quote.rate || 0).toFixed(2)}</td>
                      <td>
                        {quote.estimatedDeliveryDays
                          ? `${quote.estimatedDeliveryDays} day(s)`
                          : "—"}
                        <div style={styles.muted}>{quote.estimatedDeliveryDate || ""}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selected?.mode === "manual" ? (
            <div style={{ ...styles.grid, marginTop: 10 }}>
              <Field label="Manual AWB from courier">
                <input
                  style={styles.input}
                  value={manualAwb}
                  onChange={(event) => setManualAwb(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <button
            type="button"
            style={{ ...styles.primary, marginTop: 10 }}
            disabled={!selected || busy === "book"}
            onClick={book}
          >
            {busy === "book" ? "Booking…" : "Book selected courier"}
          </button>
        </div>
      ) : null}

      {shipment ? (
        <div style={styles.shipmentBox}>
          <div style={styles.shipmentTop}>
            <div>
              <div style={styles.muted}>SHIPMENT</div>
              <strong>{shipment.courierName || shipment.partnerName}</strong>
              <div style={styles.muted}>
                {shipment.mode} · {shipment.courierStatus}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={styles.muted}>AWB / TRACKING</div>
              <strong>{shipment.awbNumber || "AWB pending"}</strong>
              <div style={styles.muted}>
                {shipment.estimatedDeliveryDate
                  ? `ETA ${shipment.estimatedDeliveryDate}`
                  : shipment.estimatedDeliveryDays
                    ? `${shipment.estimatedDeliveryDays} day(s)`
                    : "ETA not available"}
              </div>
            </div>
          </div>

          <div style={styles.actions}>
            <button type="button" style={styles.secondary} disabled={busy === "track"} onClick={() => action("track")}>
              {busy === "track" ? "Refreshing…" : "Refresh tracking"}
            </button>
            <button type="button" style={styles.secondary} disabled={busy === "label"} onClick={() => action("label")}>
              {busy === "label" ? "Working…" : "Shipping label"}
            </button>
            {shipment.labelUrl ? (
              <a href={shipment.labelUrl} target="_blank" rel="noreferrer" style={styles.link}>
                Open label ↗
              </a>
            ) : null}
            {shipment.trackingUrl ? (
              <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" style={styles.link}>
                Courier tracking ↗
              </a>
            ) : null}
          </div>

          {shipment.rtoStatus || shipment.ndrStatus ? (
            <div style={styles.error}>
              {shipment.rtoStatus ? `RTO: ${shipment.rtoStatus}. ` : ""}
              {shipment.ndrStatus ? `NDR: ${shipment.ndrStatus}.` : ""} Admin handles the next action.
            </div>
          ) : null}

          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 12 }}>Tracking history</strong>
            {shipment.history?.length ? (
              <ul style={styles.history}>
                {shipment.history.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <strong>{entry.status || "Update"}</strong> — {fmtDate(entry.at)}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </li>
                ))}
              </ul>
            ) : (
              <div style={styles.muted}>
                No scan events yet. Tracking appears only when the courier or admin records a real
                update.
              </div>
            )}
          </div>

          <div style={styles.muted}>
            Packed: {shipment.packedAt ? fmtDate(shipment.packedAt) : "not recorded"} · Ready:{" "}
            {shipment.readyAt ? fmtDate(shipment.readyAt) : "not recorded"}
          </div>
        </div>
      ) : null}

      {message ? <div style={styles.message}>{message}</div> : null}
    </div>
  );
}

function quoteKey(quote) {
  return `${quote.partnerId}|${quote.courierCompanyId || quote.courierName || "manual"}|${quote.rate}`;
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 11, color: "#64748b", fontWeight: 700 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
    gap: 8,
  },
  input: {
    width: "100%",
    boxSizing: "border-box",
    padding: "8px 9px",
    border: "1px solid #d7dce5",
    borderRadius: 7,
    fontSize: 12,
    background: "#fff",
  },
  primary: {
    border: "none",
    background: "linear-gradient(90deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "9px 13px",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  secondary: {
    border: "1px solid #d7dce5",
    background: "#fff",
    color: "#334155",
    padding: "8px 11px",
    borderRadius: 8,
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 12,
  },
  notice: {
    background: "#f8fafc",
    color: "#475569",
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12,
    marginBottom: 10,
  },
  error: {
    background: "#fff1f2",
    color: "#be123c",
    borderRadius: 8,
    padding: "9px 11px",
    fontSize: 12,
    marginTop: 8,
  },
  message: {
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: 8,
    padding: "9px 11px",
    fontSize: 12,
    marginTop: 10,
  },
  muted: { color: "#64748b", fontSize: 11, marginTop: 3 },
  tableWrap: { overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 8 },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 12,
  },
  best: {
    marginLeft: 6,
    background: "#ecfdf5",
    color: "#047857",
    borderRadius: 999,
    padding: "2px 6px",
    fontSize: 10,
    fontWeight: 700,
  },
  shipmentBox: {
    marginTop: 14,
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    background: "#fff",
  },
  shipmentTop: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  actions: {
    display: "flex",
    gap: 7,
    flexWrap: "wrap",
    marginTop: 10,
    alignItems: "center",
  },
  link: { color: "#1d4ed8", fontSize: 12, fontWeight: 700 },
  history: { margin: "6px 0 0 18px", fontSize: 12, lineHeight: 1.7, color: "#475569" },
};

export { CourierShipment };
