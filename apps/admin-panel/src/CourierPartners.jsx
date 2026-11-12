import { useCallback, useEffect, useMemo, useState } from "react";

// =====================================================
// ADMIN — COURIER / LOGISTICS PARTNERS
// =====================================================
// Shiprocket has a real server-side adapter; the other partners are
// Manual / Not Configured until their agreement and API access exist.
// No screen here fabricates a live AWB, pickup or tracking scan.
//
// The local person-based Delivery Partner workflow (delivery.js, OTP,
// earnings) is separate and untouched.

import { API } from "./apiConfig";

function Card({ title, description, actions, children }) {
  return (
    <section className="products-section">
      <div className="section-title">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function ModeBadge({ status }) {
  const mode = status?.mode || "manual";
  const style =
    mode === "live"
      ? { background: "#ecfdf5", color: "#047857" }
      : mode === "sandbox"
        ? { background: "#eff6ff", color: "#1d4ed8" }
        : status?.hasApi
          ? { background: "#fff1f2", color: "#be123c" }
          : { background: "#f1f5f9", color: "#475569" };
  return (
    <span className="sec-tag" style={style}>
      {mode === "live" ? "Live API" : mode === "sandbox" ? "Sandbox (no live call)" : "Manual / Not Configured"}
    </span>
  );
}

function useAdminApi(token, onMessage) {
  return useCallback(
    async (path, options = {}) => {
      const response = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const data = await response.json().catch(() => null);
      if (response.status === 401) throw new Error("Session expired — please log in again.");
      if (response.status === 403) {
        throw new Error(data?.message || "Your staff role is not allowed to do this.");
      }
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }
      return data;
    },
    [token]
  );
}

export default function CourierPartners({ token, canManage = true, onMessage }) {
  const api = useAdminApi(token, onMessage);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [partners, setPartners] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [statusNote, setStatusNote] = useState("");
  const [shipments, setShipments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [courierStatuses, setCourierStatuses] = useState([]);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [partnerData, statusData, shipmentData, orderData] = await Promise.all([
        api("/api/admin/courier-partners"),
        api("/api/admin/courier/api-status"),
        api("/api/admin/courier/shipments"),
        api("/api/admin/orders"),
      ]);
      setPartners(partnerData.partners || []);
      setStatuses(statusData.partners || []);
      setStatusNote(statusData.note || "");
      setShipments(shipmentData.shipments || []);
      setCourierStatuses(shipmentData.courierStatuses || []);
      setOrders(
        (orderData.orders || []).filter(
          (order) => !["Cancelled", "Refunded"].includes(order.status)
        )
      );
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <Card
        title="📦 Courier Partners (Pan-India Logistics)"
        description="Configure courier companies, serviceability, shipping rules and COD limits. API secrets are never entered here — they live only in server-side environment secrets."
        actions={
          <button type="button" className="refresh-btn" onClick={load} disabled={loading}>
            ⟳ Refresh
          </button>
        }
      >
        <div className="ov-note" style={{ marginBottom: 12 }}>
          <strong>Honest status:</strong> Shiprocket calls its live API only when server-side
          credentials exist and <code>COURIER_LIVE_ENABLED=1</code>. Otherwise it is sandbox/dry-run
          and no external booking is made. India Post, Ekart, DTDC, Delhivery and Xpressbees remain
          Manual / Not Configured until their contracts and API access exist.
        </div>

        {loadError ? <div className="empty">⚠️ {loadError}</div> : null}
        {loading ? (
          <div className="empty">Loading courier partners…</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {partners.map((partner) => (
              <PartnerCard
                key={partner.id}
                partner={partner}
                status={statuses.find((row) => row.code === partner.code) || partner.apiStatus}
                canManage={canManage}
                api={api}
                onMessage={onMessage}
                onSaved={load}
              />
            ))}
          </div>
        )}
      </Card>

      <ApiStatus
        token={token}
        canManage={canManage}
        statuses={statuses}
        note={statusNote}
        onMessage={onMessage}
      />

      <RateComparison
        api={api}
        canManage={canManage}
        partners={partners}
        orders={orders}
        busy={busy}
        setBusy={setBusy}
        onMessage={onMessage}
        onBooked={load}
      />

      <ShipmentManager
        api={api}
        canManage={canManage}
        shipments={shipments}
        courierStatuses={courierStatuses}
        busy={busy}
        setBusy={setBusy}
        onMessage={onMessage}
        onChanged={load}
      />
    </div>
  );
}

function PartnerCard({ partner, status, canManage, api, onMessage, onSaved }) {
  const [draft, setDraft] = useState(() => draftFrom(partner));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftFrom(partner));
  }, [partner]);

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  async function save() {
    setSaving(true);
    try {
      await api(`/api/admin/courier-partners/${partner.id}`, {
        method: "PUT",
        body: {
          enabled: draft.enabled,
          codAvailable: draft.codAvailable,
          serviceablePincodes: draft.serviceablePincodes
            .split(",")
            .map((pin) => pin.trim())
            .filter(Boolean),
          baseRate: draft.baseRate,
          perKgRate: draft.perKgRate,
          codCharge: draft.codCharge,
          freeShippingAbove: draft.freeShippingAbove,
          maxWeightKg: draft.maxWeightKg,
          maxCodAmount: draft.maxCodAmount,
          returnWindowDays: draft.returnWindowDays,
          rtoCharge: draft.rtoCharge,
          pickupLocation: draft.pickupLocation,
          pickupPincode: draft.pickupPincode,
          trackingUrlTemplate: draft.trackingUrlTemplate,
          notes: draft.notes,
        },
      });
      onMessage?.(`✅ ${partner.name} rules saved.`);
      await onSaved();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 16,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <strong style={{ fontSize: 17 }}>{partner.name}</strong>{" "}
          <small className="ov-note">
            {partner.code} · {partner.partnerType}
          </small>
          <div style={{ marginTop: 6 }}>
            <ModeBadge status={status || partner.apiStatus} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={draft.enabled}
              onChange={(event) => set({ enabled: event.target.checked })}
            />
            Enabled
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
            <input
              type="checkbox"
              disabled={!canManage}
              checked={draft.codAvailable}
              onChange={(event) => set({ codAvailable: event.target.checked })}
            />
            COD available
          </label>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        <Field label="Serviceable PINs (blank = all India)">
          <input
            className="cm-input"
            disabled={!canManage}
            placeholder="226001, 110001"
            value={draft.serviceablePincodes}
            onChange={(event) => set({ serviceablePincodes: event.target.value })}
          />
        </Field>
        <Field label="Base rate ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.baseRate}
            onChange={(event) => set({ baseRate: event.target.value })}
          />
        </Field>
        <Field label="Per kg ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.perKgRate}
            onChange={(event) => set({ perKgRate: event.target.value })}
          />
        </Field>
        <Field label="COD charge ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.codCharge}
            onChange={(event) => set({ codCharge: event.target.value })}
          />
        </Field>
        <Field label="Free shipping above ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.freeShippingAbove}
            onChange={(event) => set({ freeShippingAbove: event.target.value })}
          />
        </Field>
        <Field label="Max weight kg">
          <input
            className="cm-input"
            type="number"
            min="0.01"
            disabled={!canManage}
            value={draft.maxWeightKg}
            onChange={(event) => set({ maxWeightKg: event.target.value })}
          />
        </Field>
        <Field label="Max COD ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.maxCodAmount}
            onChange={(event) => set({ maxCodAmount: event.target.value })}
          />
        </Field>
        <Field label="Return window (days)">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.returnWindowDays}
            onChange={(event) => set({ returnWindowDays: event.target.value })}
          />
        </Field>
        <Field label="RTO charge ₹">
          <input
            className="cm-input"
            type="number"
            min="0"
            disabled={!canManage}
            value={draft.rtoCharge}
            onChange={(event) => set({ rtoCharge: event.target.value })}
          />
        </Field>
        <Field label="Shiprocket pickup nickname">
          <input
            className="cm-input"
            disabled={!canManage}
            placeholder="Primary / Warehouse"
            value={draft.pickupLocation}
            onChange={(event) => set({ pickupLocation: event.target.value })}
          />
        </Field>
        <Field label="Default pickup PIN">
          <input
            className="cm-input"
            disabled={!canManage}
            placeholder="226001"
            value={draft.pickupPincode}
            onChange={(event) => set({ pickupPincode: event.target.value })}
          />
        </Field>
        <Field label="Tracking URL template">
          <input
            className="cm-input"
            disabled={!canManage}
            placeholder="https://…?awb={awb}"
            value={draft.trackingUrlTemplate}
            onChange={(event) => set({ trackingUrlTemplate: event.target.value })}
          />
        </Field>
        <Field label="Internal note">
          <input
            className="cm-input"
            disabled={!canManage}
            value={draft.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <small className="ov-note">
          {status?.configured
            ? "Required server-side secrets are present."
            : `Missing env: ${(status?.missingEnv || []).join(", ") || "not applicable (manual)"}`}
        </small>
        <button
          type="button"
          className="approve"
          disabled={!canManage || saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save rules"}
        </button>
      </div>
    </div>
  );
}

function draftFrom(partner) {
  return {
    enabled: Boolean(partner.enabled),
    codAvailable: Boolean(partner.codAvailable),
    serviceablePincodes: (partner.serviceablePincodes || []).join(", "),
    baseRate: String(partner.baseRate ?? 0),
    perKgRate: String(partner.perKgRate ?? 0),
    codCharge: String(partner.codCharge ?? 0),
    freeShippingAbove: String(partner.freeShippingAbove ?? 0),
    maxWeightKg: String(partner.maxWeightKg ?? 20),
    maxCodAmount: String(partner.maxCodAmount ?? 50000),
    returnWindowDays: String(partner.returnWindowDays ?? 7),
    rtoCharge: String(partner.rtoCharge ?? 0),
    pickupLocation: partner.pickupLocation || "",
    pickupPincode: partner.pickupPincode || "",
    trackingUrlTemplate: partner.trackingUrlTemplate || "",
    notes: partner.notes || "",
  };
}

function Field({ label, children }) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 12, color: "#64748b", fontWeight: 600 }}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// =====================================================
// API STATUS + ONBOARDING
// =====================================================

function ApiStatus({ token, canManage, statuses, note, onMessage }) {
  const api = useAdminApi(token, onMessage);
  const [testing, setTesting] = useState("");
  const [results, setResults] = useState({});

  async function test(status) {
    setTesting(status.code);
    try {
      const data = await api(`/api/admin/courier/api/test/${status.id}`, { method: "POST" });
      setResults((current) => ({ ...current, [status.code]: data.result }));
      onMessage?.(
        data.result.ok
          ? `✅ ${status.name}: ${data.result.message}`
          : `⚠️ ${status.name}: ${data.result.message}`
      );
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setTesting("");
    }
  }

  return (
    <Card
      title="🔌 API Connection & Partner Onboarding"
      description="Server-side status only. Secret values are never shown. Manual partners cannot be made live from this screen."
    >
      {note ? <div className="ov-note" style={{ marginBottom: 12 }}>{note}</div> : null}
      <div className="sec-tablewrap">
        <table className="sec-table">
          <thead>
            <tr>
              <th>Partner</th>
              <th>Connection</th>
              <th>Mode</th>
              <th>Required env names</th>
              <th>Docs / onboarding</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((status) => {
              const result = results[status.code] || status.lastTest;
              return (
                <tr key={status.code}>
                  <td>
                    <strong>{status.name}</strong>
                    <br />
                    <small className="ov-note">{status.code}</small>
                  </td>
                  <td>
                    <ModeBadge status={status} />
                    {!status.configured ? (
                      <small className="ov-note" style={{ display: "block", marginTop: 4 }}>
                        Missing: {(status.missingEnv || []).join(", ") || "manual onboarding"}
                      </small>
                    ) : null}
                  </td>
                  <td>
                    <small>{status.mode}</small>
                  </td>
                  <td>
                    <small className="ov-note">
                      {(status.envNames?.required || []).join(", ") || "—"}
                      {(status.envNames?.optional || []).length
                        ? ` (optional: ${status.envNames.optional.join(", ")})`
                        : ""}
                    </small>
                  </td>
                  <td style={{ minWidth: 260 }}>
                    {status.docs ? (
                      <a href={status.docs} target="_blank" rel="noreferrer">
                        Official docs ↗
                      </a>
                    ) : null}
                    {status.onboarding ? (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ cursor: "pointer", fontSize: 12 }}>
                          {status.onboarding.title}
                        </summary>
                        <ul style={{ margin: "6px 0 0 16px", fontSize: 12, lineHeight: 1.5 }}>
                          {(status.onboarding.requirements || status.onboarding.steps || []).map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        {status.onboarding.note ? (
                          <div className="ov-note" style={{ marginTop: 4 }}>
                            {status.onboarding.note}
                          </div>
                        ) : null}
                      </details>
                    ) : null}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="approve"
                      disabled={!canManage || testing === status.code}
                      onClick={() => test(status)}
                    >
                      {testing === status.code ? "…" : "Test connection"}
                    </button>
                    {result ? (
                      <small
                        className="ov-note"
                        style={{
                          display: "block",
                          marginTop: 5,
                          color: result.ok ? "#047857" : "#be123c",
                        }}
                      >
                        {result.ok ? "✓" : "✗"} {result.message}
                      </small>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// =====================================================
// RATE COMPARISON → MANUAL SELECTION → BOOKING
// =====================================================

function RateComparison({ api, canManage, partners, orders, busy, setBusy, onMessage, onBooked }) {
  const [orderId, setOrderId] = useState("");
  const [groups, setGroups] = useState([]);
  const [sellerId, setSellerId] = useState("");
  const [pkg, setPkg] = useState({ weightKg: "0.5", length: "10", breadth: "10", height: "5" });
  const [result, setResult] = useState(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [manualAwb, setManualAwb] = useState("");
  const [manualLabel, setManualLabel] = useState("");

  useEffect(() => {
    if (!orderId && orders.length) setOrderId(String(orders[0].id));
  }, [orderId, orders]);

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      if (!orderId) return;
      try {
        const data = await api(`/api/admin/orders/${orderId}/shipment-groups`);
        if (cancelled) return;
        setGroups(data.groups || []);
        setSellerId(data.groups?.[0]?.sellerId ? String(data.groups[0].sellerId) : data.groups?.[0]?.sellerKey || "");
        setResult(null);
        setSelectedKey("");
      } catch (error) {
        if (!cancelled) onMessage?.(`❌ ${error.message}`);
      }
    }
    loadGroups();
    return () => {
      cancelled = true;
    };
  }, [api, orderId, onMessage]);

  const group = groups.find(
    (row) => String(row.sellerId) === String(sellerId) || row.sellerKey === String(sellerId)
  ) || groups[0];

  const selected = useMemo(
    () => (result?.quotes || []).find((quote) => quoteKey(quote) === selectedKey) || null,
    [result, selectedKey]
  );

  async function compare() {
    if (!orderId || !group) {
      onMessage?.("⚠️ Choose an order with at least one seller group.");
      return;
    }
    setBusy("compare");
    try {
      const data = await api(`/api/admin/orders/${orderId}/shipments/quote`, {
        method: "POST",
        body: {
          sellerId: group.sellerId || group.sellerKey,
          package: {
            weightKg: Number(pkg.weightKg) || 0.5,
            length: Number(pkg.length) || 10,
            breadth: Number(pkg.breadth) || 10,
            height: Number(pkg.height) || 5,
          },
        },
      });
      setResult(data);
      setSelectedKey(data.recommended ? quoteKey(data.recommended) : "");
      onMessage?.(
        data.recommended
          ? `✅ ${data.quotes.length} courier option(s); recommended: ${data.recommended.courierName || data.recommended.partnerName}.`
          : "⚠️ No serviceable courier option for this PIN/package."
      );
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function book() {
    if (!selected || !group) return;
    if (selected.mode === "live" && !selected.courierCompanyId) {
      onMessage?.("❌ Select a live Shiprocket courier option before booking.");
      return;
    }
    setBusy("book");
    try {
      const data = await api(`/api/admin/orders/${orderId}/shipments`, {
        method: "POST",
        body: {
          sellerId: group.sellerId || group.sellerKey,
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
          shippingLabelRef: manualLabel || undefined,
          requestPickup: selected.mode === "live",
          generateLabel: selected.mode === "live",
        },
      });
      onMessage?.(`✅ ${data.message}`);
      setManualAwb("");
      setManualLabel("");
      await onBooked();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  const activeOrder = orders.find((order) => String(order.id) === String(orderId));

  return (
    <Card
      title="⚖️ Rate Comparison, Best Courier & Booking"
      description="Compare every enabled partner. Live Shiprocket rates are used only in live mode; other rows are clearly labelled configured estimates. The admin chooses the courier — the cheapest option is only a recommendation."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))",
          gap: 10,
        }}
      >
        <Field label="Order">
          <select
            className="cm-select"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
          >
            <option value="">— choose order —</option>
            {orders.slice(0, 120).map((order) => (
              <option key={order.id} value={order.id}>
                #{order.orderNumber} · {order.customerName || "Customer"} · {order.pincode || "no PIN"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Seller shipment group">
          <select
            className="cm-select"
            value={sellerId}
            onChange={(event) => {
              setSellerId(event.target.value);
              setResult(null);
              setSelectedKey("");
            }}
            disabled={groups.length < 2}
          >
            {groups.map((row) => (
              <option key={row.sellerKey} value={row.sellerId || row.sellerKey}>
                {row.sellerName} · {row.destination?.pincode || "PIN?"}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weight kg">
          <input
            className="cm-input"
            type="number"
            min="0.01"
            value={pkg.weightKg}
            onChange={(event) => setPkg({ ...pkg, weightKg: event.target.value })}
          />
        </Field>
        <Field label="Length cm">
          <input
            className="cm-input"
            type="number"
            min="1"
            value={pkg.length}
            onChange={(event) => setPkg({ ...pkg, length: event.target.value })}
          />
        </Field>
        <Field label="Breadth cm">
          <input
            className="cm-input"
            type="number"
            min="1"
            value={pkg.breadth}
            onChange={(event) => setPkg({ ...pkg, breadth: event.target.value })}
          />
        </Field>
        <Field label="Height cm">
          <input
            className="cm-input"
            type="number"
            min="1"
            value={pkg.height}
            onChange={(event) => setPkg({ ...pkg, height: event.target.value })}
          />
        </Field>
      </div>

      {activeOrder ? (
        <div className="ov-note" style={{ marginTop: 10 }}>
          Destination: {activeOrder.city || "—"}, {activeOrder.state || "—"} · PIN{" "}
          {activeOrder.pincode || "—"} · {activeOrder.paymentMethod}. Courier booking never changes
          order totals, GST, payment or commission.
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="approve" disabled={!group || busy === "compare"} onClick={compare}>
          {busy === "compare" ? "Comparing…" : "Compare rates"}
        </button>
        {group?.shipment ? (
          <span className="sec-tag" style={{ background: "#ecfdf5", color: "#047857" }}>
            Already booked: {group.shipment.partnerName} · {group.shipment.awbNumber || "AWB pending"}
          </span>
        ) : null}
      </div>

      {result ? (
        <div style={{ marginTop: 14 }}>
          {result.quotes?.length ? (
            <>
              <div className="sec-tablewrap">
                <table className="sec-table">
                  <thead>
                    <tr>
                      <th>Use</th>
                      <th>Courier</th>
                      <th>Mode / source</th>
                      <th>Rate</th>
                      <th>ETA</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.quotes.map((quote) => {
                      const key = quoteKey(quote);
                      const recommended =
                        result.recommended && quoteKey(result.recommended) === key;
                      return (
                        <tr key={key}>
                          <td>
                            <input
                              type="radio"
                              name="courier-quote"
                              checked={selectedKey === key}
                              onChange={() => setSelectedKey(key)}
                            />
                          </td>
                          <td>
                            <strong>{quote.courierName || quote.partnerName}</strong>
                            <br />
                            <small className="ov-note">{quote.partnerName}</small>
                          </td>
                          <td>
                            <small>
                              {quote.mode} · {quote.source}
                            </small>
                          </td>
                          <td>
                            <strong>₹{Number(quote.rate || 0).toFixed(2)}</strong>
                          </td>
                          <td>
                            {quote.estimatedDeliveryDays ? `${quote.estimatedDeliveryDays} day(s)` : "—"}
                            <br />
                            <small className="ov-note">{quote.estimatedDeliveryDate || ""}</small>
                          </td>
                          <td>
                            {recommended ? (
                              <span className="sec-tag" style={{ background: "#ecfdf5", color: "#047857" }}>
                                Recommended
                              </span>
                            ) : null}
                            <small className="ov-note" style={{ display: "block" }}>
                              {quote.note || ""}
                            </small>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {selected?.mode === "manual" ? (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
                    gap: 10,
                    marginTop: 12,
                  }}
                >
                  <Field label="Manual AWB (from courier)">
                    <input
                      className="cm-input"
                      value={manualAwb}
                      onChange={(event) => setManualAwb(event.target.value)}
                    />
                  </Field>
                  <Field label="Manual label reference">
                    <input
                      className="cm-input"
                      value={manualLabel}
                      onChange={(event) => setManualLabel(event.target.value)}
                    />
                  </Field>
                </div>
              ) : null}

              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="approve"
                  disabled={!selected || !canManage || busy === "book"}
                  onClick={book}
                >
                  {busy === "book" ? "Booking…" : "Book selected courier"}
                </button>
                <small className="ov-note" style={{ marginLeft: 10 }}>
                  {selected?.mode === "live"
                    ? "This will create a real Shiprocket shipment. Only use it with live credentials and real orders."
                    : "No external courier call is made in this mode."}
                </small>
              </div>
            </>
          ) : (
            <div className="empty">No courier option is serviceable for this package/PIN.</div>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function quoteKey(quote) {
  return `${quote.partnerId}|${quote.courierCompanyId || quote.courierName || "manual"}|${quote.rate}`;
}

// =====================================================
// SHIPMENTS / AWB / LABEL / PICKUP / TRACKING / RTO
// =====================================================

function ShipmentManager({ api, canManage, shipments, courierStatuses, busy, setBusy, onMessage, onChanged }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState({});
  const [statusDraft, setStatusDraft] = useState({});

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shipments;
    return shipments.filter((shipment) =>
      [
        shipment.awbNumber,
        shipment.partnerName,
        shipment.sellerName,
        shipment.customerName,
        shipment.orderId,
        shipment.courierStatus,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [shipments, query]);

  async function runAction(shipment, action) {
    let extra = {};
    if (action === "cancel" && !window.confirm(`Cancel shipment ${shipment.awbNumber || shipment.id}?`)) return;
    if (action === "rto" && !window.confirm("Mark this shipment for RTO?")) return;

    if (action === "label" && shipment.mode === "manual") {
      const labelUrl = window.prompt("Paste the label URL/file reference for this manual booking:");
      if (!labelUrl) return;
      extra.labelUrl = labelUrl;
    }
    if (action === "manifest" && shipment.mode === "manual") {
      const manifestUrl = window.prompt("Paste the manifest URL/file reference for this manual booking:");
      if (!manifestUrl) return;
      extra.manifestUrl = manifestUrl;
    }
    if (action === "pickup" && shipment.mode === "manual") {
      const pickupToken = window.prompt("Paste the pickup token/reference from the courier:");
      if (!pickupToken) return;
      extra.pickupToken = pickupToken;
    }
    if (action === "ndr") {
      const remarks = window.prompt("NDR remarks (optional):", "Customer unreachable") || "";
      extra.remarks = remarks;
      extra.ndrAction = "reattempt";
    }

    setBusy(`action-${shipment.id}-${action}`);
    try {
      const data = await api(`/api/admin/courier/shipments/${shipment.id}/action`, {
        method: "POST",
        body: { action, ...extra },
      });
      onMessage?.(`✅ ${data.message}`);
      await onChanged();
    } catch (error) {
      onMessage?.(`⚠️ ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function recordStatus(shipment) {
    const status = statusDraft[shipment.id];
    if (!status) return;
    setBusy(`status-${shipment.id}`);
    try {
      await api(`/api/admin/courier/shipments/${shipment.id}/status`, {
        method: "PUT",
        body: { courierStatus: status, note: "Manual courier status recorded by admin." },
      });
      onMessage?.(`✅ ${shipment.partnerName} shipment status recorded as ${status}.`);
      await onChanged();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  async function recordAwb(shipment) {
    const awb = window.prompt("AWB / tracking number from the courier:", shipment.awbNumber || "");
    if (!awb) return;
    setBusy(`awb-${shipment.id}`);
    try {
      await api(`/api/admin/courier/shipments/${shipment.id}/status`, {
        method: "PUT",
        body: { awbNumber: awb, note: "AWB recorded by admin." },
      });
      onMessage?.("✅ AWB recorded.");
      await onChanged();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setBusy("");
    }
  }

  return (
    <Card
      title="📤 Shipments — AWB, Label, Pickup, Tracking & RTO"
      description="One shipment per seller group. Sandbox bookings use TEST- AWBs; manual bookings record the courier's own reference; live Shiprocket actions call the real API only in live mode."
      actions={
        <button type="button" className="refresh-btn" onClick={onChanged}>
          ⟳ Refresh
        </button>
      }
    >
      <div className="sec-toolbar">
        <input
          className="sec-search"
          placeholder="Search order, seller, AWB, courier or status…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="sec-count">{rows.length} shipment(s)</span>
      </div>

      <div className="sec-tablewrap">
        {rows.length === 0 ? (
          <div className="empty">No shipments created yet.</div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Order / Seller</th>
                <th>Courier / Mode</th>
                <th>AWB / Estimate</th>
                <th>Status</th>
                <th>Documents</th>
                <th>Actions</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((shipment) => {
                const open = Boolean(expanded[shipment.id]);
                return (
                  <ShipmentRow
                    key={shipment.id}
                    shipment={shipment}
                    open={open}
                    canManage={canManage}
                    busy={busy}
                    courierStatuses={courierStatuses}
                    statusDraft={statusDraft[shipment.id] || ""}
                    setStatusDraft={(value) =>
                      setStatusDraft((current) => ({ ...current, [shipment.id]: value }))
                    }
                    onToggle={() => setExpanded((current) => ({ ...current, [shipment.id]: !current[shipment.id] }))}
                    onAction={runAction}
                    onRecordStatus={recordStatus}
                    onRecordAwb={recordAwb}
                  />
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="ov-note" style={{ marginTop: 10 }}>
        Shipment records never change order totals, GST, payment status, Family commission or the
        existing local delivery-partner workflow.
      </div>
    </Card>
  );
}

function ShipmentRow({
  shipment,
  open,
  canManage,
  busy,
  courierStatuses,
  statusDraft,
  setStatusDraft,
  onToggle,
  onAction,
  onRecordStatus,
  onRecordAwb,
}) {
  const terminal = ["Delivered", "Returned", "Cancelled"].includes(shipment.courierStatus);
  return (
    <>
      <tr>
        <td>
          <strong>#{shipment.orderId}</strong>
          <br />
          <small className="ov-note">{shipment.sellerName || "Seller"}</small>
        </td>
        <td>
          <strong>{shipment.courierName || shipment.partnerName}</strong>
          <br />
          <small className="ov-note">
            {shipment.partnerName} · {shipment.mode}
          </small>
        </td>
        <td>
          {shipment.awbNumber || "AWB pending"}
          <br />
          <small className="ov-note">
            {shipment.estimatedDeliveryDate
              ? `ETA ${shipment.estimatedDeliveryDate}`
              : shipment.estimatedDeliveryDays
                ? `${shipment.estimatedDeliveryDays} day(s)`
                : "No ETA"}
          </small>
        </td>
        <td>
          <span className="sec-tag">{shipment.courierStatus}</span>
          {shipment.rtoStatus ? (
            <small className="ov-note" style={{ display: "block" }}>
              RTO: {shipment.rtoStatus}
            </small>
          ) : null}
          {shipment.ndrStatus ? (
            <small className="ov-note" style={{ display: "block" }}>
              NDR: {shipment.ndrStatus}
            </small>
          ) : null}
        </td>
        <td>
          {shipment.labelUrl ? (
            <a href={shipment.labelUrl} target="_blank" rel="noreferrer">
              Label ↗
            </a>
          ) : (
            <small className="ov-note">Label not recorded</small>
          )}
          <br />
          {shipment.manifestUrl ? (
            <a href={shipment.manifestUrl} target="_blank" rel="noreferrer">
              Manifest ↗
            </a>
          ) : (
            <small className="ov-note">Manifest not recorded</small>
          )}
          {shipment.pickupToken ? (
            <small className="ov-note" style={{ display: "block" }}>
              Pickup: {shipment.pickupToken}
            </small>
          ) : null}
        </td>
        <td>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            <ActionButton label="Track" action="track" shipment={shipment} busy={busy} onAction={onAction} />
            <ActionButton label="Label" action="label" shipment={shipment} busy={busy} onAction={onAction} />
            <ActionButton label="Manifest" action="manifest" shipment={shipment} busy={busy} onAction={onAction} />
            <ActionButton label="Pickup" action="pickup" shipment={shipment} busy={busy} onAction={onAction} />
            <ActionButton label="AWB" action="awb" shipment={shipment} busy={busy} onAction={(s) => onRecordAwb(s)} />
            {!terminal ? (
              <>
                <ActionButton label="NDR" action="ndr" shipment={shipment} busy={busy} onAction={onAction} />
                <ActionButton label="RTO" action="rto" shipment={shipment} busy={busy} onAction={onAction} />
                <ActionButton label="Cancel" action="cancel" shipment={shipment} busy={busy} onAction={onAction} />
              </>
            ) : null}
          </div>
        </td>
        <td>
          <button type="button" className="refresh-btn" onClick={onToggle}>
            {open ? "Hide" : "History"}
          </button>
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7}>
            <div style={{ padding: "10px 2px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <Field label="Provider order / shipment">
                  <small>
                    {shipment.provider || "—"} · {shipment.providerOrderId || "—"} /{" "}
                    {shipment.providerShipmentId || "—"}
                  </small>
                </Field>
                <Field label="Package">
                  <small>
                    {shipment.package
                      ? `${shipment.package.weightKg} kg · ${shipment.package.length}×${shipment.package.breadth}×${shipment.package.height} cm`
                      : "—"}
                  </small>
                </Field>
                <Field label="Pickup">
                  <small>
                    {shipment.pickup?.city || "—"} · {shipment.pickup?.pincode || "—"}
                  </small>
                </Field>
                <Field label="Rate">
                  <small>{shipment.rate === null ? "—" : `₹${Number(shipment.rate).toFixed(2)}`}</small>
                </Field>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <select
                  className="cm-select"
                  value={statusDraft}
                  onChange={(event) => setStatusDraft(event.target.value)}
                  disabled={!canManage}
                >
                  <option value="">— record courier status —</option>
                  {courierStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="approve"
                  disabled={!canManage || !statusDraft || busy === `status-${shipment.id}`}
                  onClick={() => onRecordStatus(shipment)}
                >
                  {busy === `status-${shipment.id}` ? "Saving…" : "Record status"}
                </button>
                <small className="ov-note">
                  Manual status recording is for courier updates seen on the courier's own system.
                </small>
              </div>

              {shipment.lastApiError ? (
                <div style={{ color: "#be123c", fontSize: 12, marginBottom: 8 }}>
                  Last API error: {shipment.lastApiError}
                </div>
              ) : null}

              <strong style={{ fontSize: 13 }}>Tracking history</strong>
              {shipment.history?.length ? (
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12, lineHeight: 1.7 }}>
                  {shipment.history.map((entry, index) => (
                    <li key={`${entry.at}-${entry.status}-${index}`}>
                      <strong>{entry.status || "Update"}</strong>
                      {entry.at ? ` — ${entry.at}` : ""}
                      {entry.note ? ` · ${entry.note}` : ""}
                      {entry.location ? ` · ${entry.location}` : ""}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="ov-note" style={{ marginTop: 4 }}>
                  No scan events recorded yet. Nothing is fabricated.
                </div>
              )}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ActionButton({ label, action, shipment, busy, onAction }) {
  const key = `action-${shipment.id}-${action}`;
  return (
    <button
      type="button"
      className="refresh-btn"
      disabled={busy === key}
      onClick={() => onAction(shipment, action)}
    >
      {busy === key ? "…" : label}
    </button>
  );
}
