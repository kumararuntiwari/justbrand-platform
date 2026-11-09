import { useCallback, useEffect, useMemo, useState } from "react";

// =====================================================
// ADMIN — COURIER / LOGISTICS PARTNERS
// =====================================================
// Courier COMPANIES (India Post, Ekart, Shiprocket, DTDC + custom
// enabled by the admin) — completely SEPARATE from the person-based
// delivery-partner workflow (Delivery section, delivery.js), which is
// untouched.
//
// This section has two cards:
//   1. Courier Partners — per-partner configuration: enabled status,
//      COD availability, serviceable pincodes, shipping rates,
//      tracking URL template, notes. API credentials are write-only
//      (saved server-side; never displayed).
//   2. Per-Order Courier Booking — select the courier for an order and
//      record the real AWB/tracking number + shipping label reference
//      + courier status (Manual Mode: the admin books on the courier's
//      own system/dashboard and records the details here — nothing is
//      auto-synced and nothing fake is shown).
//
// Courier booking NEVER changes order totals, payment status or the
// configured delivery-charge / GST calculation — the backend only
// writes courier columns on the order.

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

export default function CourierPartners({ token, canManage = true, onMessage }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [partners, setPartners] = useState([]);
  const [courierStatuses, setCourierStatuses] = useState([]);
  const [modeNote, setModeNote] = useState("");

  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState(null);

  const api = useCallback(
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

      if (response.status === 401) {
        throw new Error("Session expired — please log in again.");
      }
      if (response.status === 403) {
        throw new Error(data?.message || "Your staff role is not allowed to manage courier partners.");
      }
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }

      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api("/api/admin/courier-partners");
      setPartners(data.partners || []);
      setCourierStatuses(data.courierStatuses || []);
      setModeNote(data.modeNote || "");
      setDrafts({});
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  function draftOf(partner) {
    return (
      drafts[partner.id] || {
        enabled: partner.enabled,
        codAvailable: partner.codAvailable,
        serviceablePincodes: partner.serviceablePincodes.join(", "),
        baseRate: String(partner.baseRate),
        perKgRate: String(partner.perKgRate),
        codCharge: String(partner.codCharge),
        trackingUrlTemplate: partner.trackingUrlTemplate,
        notes: partner.notes,
        apiCredentialsJson: "",
        clearApiCredentials: false,
      }
    );
  }

  function patchDraft(partner, patch) {
    setDrafts((prev) => ({ ...prev, [partner.id]: { ...draftOf(partner), ...patch } }));
  }

  async function savePartner(partner) {
    const draft = draftOf(partner);
    setSavingId(partner.id);

    try {
      let apiCredentials;
      if (draft.clearApiCredentials) {
        apiCredentials = null;
      } else if (draft.apiCredentialsJson.trim()) {
        try {
          apiCredentials = JSON.parse(draft.apiCredentialsJson);
        } catch {
          throw new Error("API credentials must be valid JSON (server-side only, never displayed).");
        }
      }

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
          trackingUrlTemplate: draft.trackingUrlTemplate,
          notes: draft.notes,
          ...(apiCredentials !== undefined ? { apiCredentials } : {}),
        },
      });

      onMessage?.(`✅ ${partner.name} settings saved.`);
      await load();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <Card
        title="📦 Courier Partners (Logistics Companies)"
        description="Configure courier companies used for shipping. This is separate from the local delivery-partner (person) workflow in the Delivery section. Manual Mode: book on the courier's own site/dashboard, then record the AWB here — nothing is auto-synced."
        actions={
          <button type="button" className="refresh-btn" onClick={load}>
            ⟳ Refresh
          </button>
        }
      >
        {modeNote ? <div className="ov-note" style={{ marginBottom: 10 }}>{modeNote}</div> : null}

        {loadError ? (
          <div className="empty">⚠️ {loadError}</div>
        ) : loading ? (
          <div className="empty">Loading courier partners…</div>
        ) : (
          <div className="sec-tablewrap">
            <table className="sec-table">
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>Enabled</th>
                  <th>COD</th>
                  <th>Serviceable PINs</th>
                  <th>Shipping rates</th>
                  <th>Tracking URL template</th>
                  <th>API credentials</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {partners.map((partner) => {
                  const draft = draftOf(partner);
                  return (
                    <tr key={partner.id}>
                      <td>
                        <strong>{partner.name}</strong>
                        <br />
                        <small className="ov-note">
                          {partner.code} · {partner.partnerType} · {partner.apiMode === "manual" ? "Manual Mode" : partner.apiMode}
                        </small>
                      </td>
                      <td>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: canManage ? "pointer" : "default" }}>
                          <input
                            type="checkbox"
                            disabled={!canManage}
                            checked={draft.enabled}
                            onChange={(e) => patchDraft(partner, { enabled: e.target.checked })}
                          />
                          {draft.enabled ? "Yes" : "No"}
                        </label>
                      </td>
                      <td>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: canManage ? "pointer" : "default" }}>
                          <input
                            type="checkbox"
                            disabled={!canManage}
                            checked={draft.codAvailable}
                            onChange={(e) => patchDraft(partner, { codAvailable: e.target.checked })}
                          />
                          {draft.codAvailable ? "Yes" : "No"}
                        </label>
                      </td>
                      <td>
                        <input
                          className="cm-input"
                          style={{ minWidth: "170px" }}
                          disabled={!canManage}
                          placeholder="e.g. 226001, 110001 (blank = all India)"
                          value={draft.serviceablePincodes}
                          onChange={(e) => patchDraft(partner, { serviceablePincodes: e.target.value })}
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <input
                            className="cm-input"
                            style={{ maxWidth: "80px" }}
                            type="number"
                            min="0"
                            disabled={!canManage}
                            title="Base rate (₹)"
                            value={draft.baseRate}
                            onChange={(e) => patchDraft(partner, { baseRate: e.target.value })}
                          />
                          <input
                            className="cm-input"
                            style={{ maxWidth: "80px" }}
                            type="number"
                            min="0"
                            disabled={!canManage}
                            title="Per kg rate (₹)"
                            value={draft.perKgRate}
                            onChange={(e) => patchDraft(partner, { perKgRate: e.target.value })}
                          />
                          <input
                            className="cm-input"
                            style={{ maxWidth: "80px" }}
                            type="number"
                            min="0"
                            disabled={!canManage}
                            title="COD charge (₹)"
                            value={draft.codCharge}
                            onChange={(e) => patchDraft(partner, { codCharge: e.target.value })}
                          />
                        </div>
                        <small className="ov-note">base ₹ / per kg ₹ / COD ₹</small>
                      </td>
                      <td>
                        <input
                          className="cm-input"
                          style={{ minWidth: "200px" }}
                          disabled={!canManage}
                          placeholder="https://…?awb={awb}"
                          value={draft.trackingUrlTemplate}
                          onChange={(e) => patchDraft(partner, { trackingUrlTemplate: e.target.value })}
                        />
                      </td>
                      <td>
                        {partner.hasApiCredentials ? (
                          <span className="sec-tag" style={{ background: "#ecfdf5", color: "#047857" }}>
                            Saved (hidden)
                          </span>
                        ) : (
                          <span className="sec-tag ov-note">None</span>
                        )}
                        {canManage ? (
                          <>
                            <input
                              className="cm-input"
                              style={{ minWidth: "160px", marginTop: 6 }}
                              placeholder='JSON, e.g. {"accountId":"…"}'
                              value={draft.apiCredentialsJson}
                              onChange={(e) => patchDraft(partner, { apiCredentialsJson: e.target.value })}
                            />
                            {partner.hasApiCredentials ? (
                              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                                <input
                                  type="checkbox"
                                  checked={draft.clearApiCredentials}
                                  onChange={(e) => patchDraft(partner, { clearApiCredentials: e.target.checked })}
                                />
                                Clear saved credentials
                              </label>
                            ) : null}
                          </>
                        ) : null}
                        <small className="ov-note" style={{ display: "block" }}>
                          Server-side only — never displayed.
                        </small>
                      </td>
                      <td>
                        <input
                          className="cm-input"
                          style={{ minWidth: "140px" }}
                          disabled={!canManage}
                          placeholder="Internal note"
                          value={draft.notes}
                          onChange={(e) => patchDraft(partner, { notes: e.target.value })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="approve"
                          disabled={!canManage || savingId === partner.id}
                          onClick={() => savePartner(partner)}
                        >
                          {savingId === partner.id ? "…" : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="ov-note" style={{ marginTop: 10 }}>
          API integration status: <strong>Manual Mode for all partners</strong> — no courier API credentials are
          configured for this project, so bookings and tracking updates are recorded manually from the courier's own
          system. No live tracking or booking is simulated.
        </div>
      </Card>

      <ApiIntegration token={token} canManage={canManage} onMessage={onMessage} />

      <PerOrderBooking
        token={token}
        canManage={canManage}
        partners={partners}
        courierStatuses={courierStatuses}
        onMessage={onMessage}
      />

      <ShipmentManager token={token} canManage={canManage} partners={partners} onMessage={onMessage} />
    </div>
  );
}

// =====================================================
// PER-ORDER COURIER BOOKING
// =====================================================

function PerOrderBooking({ token, canManage, partners, courierStatuses, onMessage }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [forms, setForms] = useState({});

  const api = useCallback(
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
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }
      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/orders");
      setOrders(data.orders || []);
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((order) => !["Cancelled", "Refunded"].includes(order.status))
      .filter(
        (order) =>
          !q ||
          String(order.orderNumber || "").toLowerCase().includes(q) ||
          String(order.customerName || "").toLowerCase().includes(q) ||
          String(order.awbNumber || "").toLowerCase().includes(q) ||
          String(order.pincode || "").includes(q)
      );
  }, [orders, query]);

  function formOf(order) {
    return (
      forms[order.id] || {
        courierPartnerId: order.courierPartnerId ? String(order.courierPartnerId) : "",
        awbNumber: order.awbNumber || "",
        shippingLabelRef: order.shippingLabelRef || "",
        courierStatus: order.courierStatus || "Booked",
      }
    );
  }

  function patchForm(order, patch) {
    setForms((prev) => ({ ...prev, [order.id]: { ...formOf(order), ...patch } }));
  }

  async function saveBooking(order) {
    const form = formOf(order);
    setSavingId(order.id);
    try {
      await api(`/api/admin/orders/${order.id}/courier`, {
        method: "PUT",
        body: {
          courierPartnerId: form.courierPartnerId ? Number(form.courierPartnerId) : null,
          awbNumber: form.awbNumber.trim(),
          shippingLabelRef: form.shippingLabelRef.trim(),
          courierStatus: form.courierStatus,
        },
      });
      onMessage?.(`✅ Courier booking saved for #${order.orderNumber}.`);
      await load();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setSavingId(null);
    }
  }

  const enabledPartners = partners.filter((p) => p.enabled);

  return (
    <Card
      title="📋 Per-Order Courier Booking (AWB / Label / Status)"
      description="Assign a courier company to each order and record the real AWB/tracking number, shipping label reference and courier status (Manual Mode — booked on the courier's own system). This never changes order totals, payment status or order status."
      actions={
        <button type="button" className="refresh-btn" onClick={load}>
          ⟳ Refresh
        </button>
      }
    >
      <div className="sec-toolbar">
        <input
          className="sec-search"
          placeholder="Search order #, customer, AWB or PIN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="sec-count">{rows.length} order(s)</span>
      </div>

      <div className="sec-tablewrap">
        {loading ? (
          <div className="empty">Loading orders…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No orders match this view.</div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Ship to</th>
                <th>Payment</th>
                <th>Courier partner</th>
                <th>AWB / tracking no.</th>
                <th>Label ref</th>
                <th>Courier status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((order) => {
                const form = formOf(order);
                return (
                  <tr key={order.id}>
                    <td>
                      <strong>#{order.orderNumber}</strong>
                      <br />
                      <small className="ov-note">{order.status}</small>
                    </td>
                    <td>
                      <small>
                        {order.city || "—"}
                        {order.pincode ? ` · ${order.pincode}` : ""}
                      </small>
                      <br />
                      <small className="ov-note">{order.customerName}</small>
                    </td>
                    <td>
                      <small>
                        {order.paymentMethod}
                        <br />
                        {order.paymentStatus}
                      </small>
                    </td>
                    <td>
                      <select
                        className="cm-select"
                        disabled={!canManage}
                        value={form.courierPartnerId}
                        onChange={(e) => patchForm(order, { courierPartnerId: e.target.value })}
                      >
                        <option value="">— not assigned —</option>
                        {(form.courierPartnerId && !enabledPartners.some((p) => String(p.id) === form.courierPartnerId)
                          ? partners
                          : enabledPartners
                        ).map((p) => (
                          <option key={p.id} value={String(p.id)}>
                            {p.name}
                            {p.enabled ? "" : " (disabled)"}
                          </option>
                        ))}
                      </select>
                      {order.courierPartnerName ? (
                        <small className="ov-note" style={{ display: "block" }}>
                          current: {order.courierPartnerName}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="cm-input"
                        style={{ minWidth: "140px" }}
                        disabled={!canManage || !form.courierPartnerId}
                        placeholder="AWB number"
                        value={form.awbNumber}
                        onChange={(e) => patchForm(order, { awbNumber: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="cm-input"
                        style={{ minWidth: "120px" }}
                        disabled={!canManage || !form.courierPartnerId}
                        placeholder="Label ref"
                        value={form.shippingLabelRef}
                        onChange={(e) => patchForm(order, { shippingLabelRef: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="cm-select"
                        disabled={!canManage || !form.courierPartnerId}
                        value={form.courierStatus}
                        onChange={(e) => patchForm(order, { courierStatus: e.target.value })}
                      >
                        {courierStatuses.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="approve"
                          disabled={!canManage || savingId === order.id}
                          onClick={() => saveBooking(order)}
                        >
                          {savingId === order.id ? "…" : form.courierPartnerId ? "Save" : "Clear"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="ov-note" style={{ marginTop: 10 }}>
        Showing up to 60 matching orders. Courier assignment is separate from order status (Shipped/Delivered) and from
        the local delivery-partner assignment in the Delivery section.
      </div>
    </Card>
  );
}

// =====================================================
// API INTEGRATION SETTINGS (secure — status + env NAMES only)
// =====================================================
// Shows, per partner, whether server-side credentials exist, the
// current mode (manual / sandbox / live) and a Test Connection button.
// Credentials are NEVER shown or entered here — they come from
// server-side secrets (Settings → Environment). When credentials are
// missing we show an honest "Not configured" badge — never a fake OK.

function ApiIntegration({ token, canManage, onMessage }) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [note, setNote] = useState("");
  const [testingId, setTestingId] = useState(null);
  const [results, setResults] = useState({});

  const api = useCallback(
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
      if (response.status === 403) {
        throw new Error(data?.message || "Your staff role cannot manage courier API settings.");
      }
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }
      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/courier/api-status");
      setRows(data.partners || []);
      setNote(data.note || "");
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  async function testConnection(partner) {
    setTestingId(partner.id);
    try {
      const data = await api(`/api/admin/courier/api/test/${partner.id}`, { method: "POST" });
      setResults((prev) => ({ ...prev, [partner.id]: data.result }));
      onMessage?.(
        data.result.ok
          ? `✅ ${partner.name}: ${data.result.message}`
          : `⚠️ ${partner.name}: ${data.result.message}`
      );
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setTestingId(null);
    }
  }

  function badgeFor(row) {
    if (!row.hasApi) {
      return (
        <span className="sec-tag ov-note" title={row.note}>
          Manual Mode (no API)
        </span>
      );
    }
    if (!row.configured) {
      // HONEST "Not configured" — never a fake success.
      return (
        <span className="sec-tag" style={{ background: "#fff1f2", color: "#be123c" }} title={row.note}>
          Not configured
        </span>
      );
    }
    if (row.mode === "live") {
      return (
        <span className="sec-tag" style={{ background: "#ecfdf5", color: "#047857" }} title={row.note}>
          Live
        </span>
      );
    }
    return (
      <span className="sec-tag" style={{ background: "#eff6ff", color: "#1d4ed8" }} title={row.note}>
        Sandbox / dry-run
      </span>
    );
  }

  return (
    <Card
      title="🔌 Courier API Integration (Shiprocket)"
      description="Connection status + Test Connection for real courier APIs. Credentials are read from server-side secrets (Settings → Environment) and are NEVER displayed, stored in the DB, logged or committed. Without COURIER_LIVE_ENABLED=1 every partner runs as a dry-run/sandbox: shipment creation returns a clearly labelled TEST AWB and no courier is contacted."
      actions={
        <button type="button" className="refresh-btn" onClick={load}>
          ⟳ Refresh
        </button>
      }
    >
      {note ? (
        <div className="ov-note" style={{ marginBottom: 10 }}>
          {note}
        </div>
      ) : null}

      {loading ? (
        <div className="empty">Loading API status…</div>
      ) : (
        <div className="sec-tablewrap">
          <table className="sec-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>API</th>
                <th>Connection</th>
                <th>Mode</th>
                <th>Required secrets (names only)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = results[row.id] || row.lastTest;
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      <br />
                      <small className="ov-note">{row.code}</small>
                    </td>
                    <td>{row.hasApi ? <span className="sec-tag">{row.code === "SHIPROCKET" ? "Shiprocket API" : "API available"}</span> : <small className="ov-note">—</small>}</td>
                    <td>{badgeFor(row)}</td>
                    <td>
                      <small>{row.mode}</small>
                      {!row.configured && row.missingEnv?.length ? (
                        <small className="ov-note" style={{ display: "block" }}>
                          missing: {row.missingEnv.join(", ")}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <small className="ov-note">
                        {(row.envNames?.required || []).join(", ") || "—"}
                        {(row.envNames?.optional || []).length
                          ? ` (optional: ${row.envNames.optional.join(", ")})`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="approve"
                        disabled={!canManage || testingId === row.id}
                        onClick={() => testConnection(row)}
                        title={row.hasApi ? "Dry-run by default; never fakes success" : "No API integrated"}
                      >
                        {testingId === row.id ? "…" : "Test Connection"}
                      </button>
                      {result ? (
                        <small
                          className="ov-note"
                          style={{ display: "block", marginTop: 4, color: result.ok ? "#047857" : "#be123c" }}
                        >
                          {result.ok ? "✓" : "✗"} {result.status} — {result.message}
                        </small>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="ov-note" style={{ marginTop: 10 }}>
        Shiprocket endpoints used (official API): POST /v1/external/auth/login → token; POST
        /v1/external/orders/create/adhoc → shipment; POST /v1/external/courier/assign/awb → AWB; POST
        /v1/external/courier/generate/label → PDF; GET /v1/external/courier/track/awb/&#123;awb&#125; → tracking. In this preview no
        live call is ever made — Test Connection is a dry-run and reports the real status (including "Not configured").
      </div>
    </Card>
  );
}

// =====================================================
// SHIPMENT MANAGEMENT (sandbox/mock by default)
// =====================================================
// Create a shipment for an order (TEST AWB, no real courier), and view
// every shipment with its tracking HISTORY and the last API error.
// Duplicate bookings are rejected by the backend (409).

function ShipmentManager({ token, canManage, partners, onMessage }) {
  const [shipments, setShipments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingId, setCreatingId] = useState(null);
  const [expanded, setExpanded] = useState({});

  const api = useCallback(
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
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }
      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ship, ord] = await Promise.all([
        api("/api/admin/courier/shipments"),
        api("/api/admin/orders"),
      ]);
      setShipments(ship.shipments || []);
      // Cancelled/refunded orders are not shippable; already-shipped
      // orders show a disabled "Shipped" button (backend also blocks
      // duplicates with 409).
      setOrders((ord.orders || []).filter((o) => !["Cancelled", "Refunded"].includes(o.status)));
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [api, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  const enabledPartners = partners.filter((p) => p.enabled);

  async function createShipment(order, partnerId) {
    if (!partnerId) {
      onMessage?.("⚠️ Choose a courier partner first.");
      return;
    }
    setCreatingId(order.id);
    try {
      const data = await api(`/api/admin/orders/${order.id}/shipment`, {
        method: "POST",
        body: { courierPartnerId: Number(partnerId) },
      });
      onMessage?.(`✅ ${data.message}`);
      await load();
    } catch (error) {
      // 409 duplicate → clear, honest error; no fake success.
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setCreatingId(null);
    }
  }

  return (
    <Card
      title="📤 Shipment Management (Sandbox / Mock)"
      description="Create a shipment for an order and view its tracking history + API errors. In this preview every shipment is a clearly labelled SANDBOX booking with a TEST- AWB — no real courier is contacted, no pickup is scheduled. Duplicate bookings are blocked."
      actions={
        <button type="button" className="refresh-btn" onClick={load}>
          ⟳ Refresh
        </button>
      }
    >
      <div className="sec-tablewrap">
        {loading ? (
          <div className="empty">Loading shipments…</div>
        ) : orders.length === 0 ? (
          <div className="empty">No orders to ship yet.</div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Ship to</th>
                <th>Payment</th>
                <th>Courier</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 40).map((order) => {
                const alreadyShipped = shipments.some((s) => s.orderId === order.id);
                return (
                  <tr key={order.id}>
                    <td>
                      <strong>#{order.orderNumber}</strong>
                      <br />
                      <small className="ov-note">{order.status}</small>
                    </td>
                    <td>
                      <small>
                        {order.city || "—"}
                        {order.pincode ? ` · ${order.pincode}` : ""}
                      </small>
                    </td>
                    <td>
                      <small>
                        {order.paymentMethod}
                        <br />
                        {order.paymentStatus}
                      </small>
                    </td>
                    <td>
                      <select
                        className="cm-select"
                        disabled={!canManage}
                        defaultValue=""
                        id={`ship-partner-${order.id}`}
                      >
                        <option value="">— select —</option>
                        {enabledPartners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="approve"
                        disabled={!canManage || creatingId === order.id || alreadyShipped}
                        onClick={() =>
                          createShipment(order, document.getElementById(`ship-partner-${order.id}`)?.value)
                        }
                      >
                        {creatingId === order.id ? "…" : alreadyShipped ? "Shipped" : "Create Shipment"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <h3 style={{ margin: "18px 0 8px" }}>Existing shipments</h3>
      <div className="sec-tablewrap">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : shipments.length === 0 ? (
          <div className="empty">No shipments created yet.</div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Partner</th>
                <th>Mode</th>
                <th>AWB</th>
                <th>Label ref</th>
                <th>Status</th>
                <th>API error</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id}>
                  <td>#{s.orderId}</td>
                  <td>{s.partnerName}</td>
                  <td>
                    <span
                      className="sec-tag"
                      style={
                        s.mode === "sandbox"
                          ? { background: "#eff6ff", color: "#1d4ed8" }
                          : { background: "#fff1f2", color: "#be123c" }
                      }
                    >
                      {s.mode}
                    </span>
                  </td>
                  <td>{s.awbNumber}</td>
                  <td>{s.shippingLabelRef}</td>
                  <td>{s.courierStatus}</td>
                  <td>
                    {s.lastApiError ? (
                      <span className="sec-tag" style={{ background: "#fff1f2", color: "#be123c" }} title={s.lastApiError}>
                        Error
                      </span>
                    ) : (
                      <small className="ov-note">—</small>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="refresh-btn"
                      onClick={() => setExpanded((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                    >
                      {expanded[s.id] ? "Hide" : "History"}
                    </button>
                  </td>
                </tr>
              ))}
              {shipments.map((s) =>
                expanded[s.id] ? (
                  <tr key={`${s.id}-hist`}>
                    <td colSpan={8}>
                      <div style={{ padding: "6px 0" }}>
                        <strong>Tracking history — #{s.orderId} ({s.partnerName})</strong>
                        {s.lastApiError ? (
                          <div style={{ color: "#be123c", fontSize: 12, marginTop: 4 }}>API error: {s.lastApiError}</div>
                        ) : null}
                        <ul style={{ margin: "6px 0 0 18px", fontSize: 12 }}>
                          {(s.history || []).map((h, i) => (
                            <li key={i}>
                              <strong>{h.status}</strong> — {h.at} {h.note ? `· ${h.note}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </td>
                  </tr>
                ) : null
              )}
            </tbody>
          </table>
        )}
      </div>

      <div className="ov-note" style={{ marginTop: 10 }}>
        Shipments here are SANDBOX only (TEST- AWBs). No real booking, pickup or courier contact happens. Order totals,
        payment status and the configured delivery/GST calculation are never changed by creating a shipment.
      </div>
    </Card>
  );
}
