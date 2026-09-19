import React, { useCallback, useEffect, useState } from "react";

// DELIVERY — JustBrand Admin delivery operations manager.
// Additive section: Delivery Dashboard, Partners, Delivery Orders,
// Assign/Reassign (with one-time delivery OTP), Tracking, Settings.
// Uses the existing staff token and role model: super_admin/manager
// manage; accountant can view. Backend enforces all permissions.

const API =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "https://justbrand-in-144629.hostingersite.com";

const STATUS_META = {
  Assigned: { bg: "#fff7ed", fg: "#c2410c" },
  "Pickup Pending": { bg: "#fffbeb", fg: "#b45309" },
  "Picked Up": { bg: "#eff6ff", fg: "#1d4ed8" },
  "Out for Delivery": { bg: "#f5f3ff", fg: "#6d28d9" },
  Delivered: { bg: "#ecfdf5", fg: "#047857" },
  "Delivery Failed": { bg: "#fef2f2", fg: "#b91c1c" },
  "Return to Seller": { bg: "#fef2f2", fg: "#9f1239" },
  "Returned to Seller": { bg: "#f1f5f9", fg: "#475569" },
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        background: meta.bg,
        color: meta.fg,
        whiteSpace: "nowrap",
      }}
    >
      {status || "Not assigned"}
    </span>
  );
}

function fmtTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rupees(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

async function apiFetch(path, token, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function Kpi({ label, value, accent = "#f97316", onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "#fff",
        border: "1px solid #e8ecf5",
        borderRadius: 14,
        padding: 16,
        cursor: onClick ? "pointer" : "default",
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7490", textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color: "#14213d", marginTop: 4 }}>{value}</div>
    </div>
  );
}

const SECTION_STYLE = { marginTop: 0 };
const inputStyle = {
  padding: "9px 12px",
  borderRadius: 10,
  border: "1px solid #d8deec",
  fontSize: 14,
  width: "100%",
};

// ------------------------------------------------------------------

export default function DeliveryManager({ token, role, onMessage }) {
  const [tab, setTab] = useState("dashboard");
  const canManage = role === "super_admin" || role === "manager";
  const canSeeFinance = role === "super_admin" || role === "accountant";

  return (
    <section style={SECTION_STYLE}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          ["dashboard", "🛵 Dashboard"],
          ["partners", "🤝 Partners"],
          ["orders", "📦 Delivery Orders"],
          ["assign", "➕ Assign Delivery"],
          ["tracking", "📍 Tracking"],
          ["settings", "⚙️ Settings"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid " + (tab === key ? "#f97316" : "#d8deec"),
              background: tab === key ? "#fff7ed" : "#fff",
              color: tab === key ? "#c2410c" : "#37435f",
              fontWeight: 600,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "dashboard" && <DeliveryDashboard token={token} goTo={setTab} />}
      {tab === "partners" && <Partners token={token} canManage={canManage} onMessage={onMessage} />}
      {tab === "orders" && <DeliveryOrders token={token} canManage={canManage} onMessage={onMessage} />}
      {tab === "assign" && <AssignPanel token={token} canManage={canManage} onMessage={onMessage} />}
      {tab === "tracking" && <Tracking token={token} />}
      {tab === "settings" && <DeliverySettings token={token} canManage={role === "super_admin"} onMessage={onMessage} />}
      {tab === "settings" && canSeeFinance && <EarningsPanel token={token} />}
    </section>
  );
}

// ---------------- DASHBOARD ----------------

function DeliveryDashboard({ token, goTo }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    apiFetch("/api/admin/delivery/dashboard", token)
      .then(setData)
      .catch(() => setData({ counts: {}, recentOrders: [] }));
  }, [token]);

  const c = data?.counts || {};

  return (
    <div>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 16 }}>
        <Kpi label="Total Assigned" value={c.totalAssigned ?? 0} onClick={() => goTo("orders")} />
        <Kpi label="Pickup Pending" value={c.pickupPending ?? 0} accent="#f59e0b" onClick={() => goTo("orders")} />
        <Kpi label="Picked Up" value={c.pickedUp ?? 0} accent="#3b82f6" />
        <Kpi label="Out for Delivery" value={c.outForDelivery ?? 0} accent="#8b5cf6" />
        <Kpi label="Delivered Today" value={c.deliveredToday ?? 0} accent="#10b981" />
        <Kpi label="Failed" value={c.failed ?? 0} accent="#ef4444" />
        <Kpi label="Returns" value={c.returns ?? 0} accent="#64748b" />
        <Kpi
          label="Active Partners"
          value={`${c.partnersActive ?? 0}/${c.partnersTotal ?? 0}`}
          accent="#ec4899"
          onClick={() => goTo("partners")}
        />
      </div>
      <DeliveryOrdersTable token={token} limit={10} title="Recent Delivery Orders" showAll={false} />
    </div>
  );
}

// ---------------- PARTNERS ----------------

function Partners({ token, canManage, onMessage }) {
  const [partners, setPartners] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    mobile: "",
    email: "",
    city: "",
    vehicleNumber: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch("/api/admin/delivery/partners", token)
      .then((d) => setPartners(d.partners || []))
      .catch((e) => onMessage?.(e.message, "error"));
  }, [token, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPartner(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await apiFetch("/api/admin/delivery/partners", token, {
        method: "POST",
        body: form,
      });
      onMessage?.(data.message || "Partner created.");
      setShowForm(false);
      setForm({ name: "", username: "", password: "", mobile: "", email: "", city: "", vehicleNumber: "" });
      load();
    } catch (error) {
      onMessage?.(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(partner) {
    try {
      const data = await apiFetch(`/api/admin/delivery/partners/${partner.id}`, token, {
        method: "PUT",
        body: { status: partner.status === "active" ? "inactive" : "active" },
      });
      onMessage?.(data.message || "Partner updated.");
      load();
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  async function resetPassword(partner) {
    const newPassword = window.prompt(
      `New password for ${partner.name} (min 6 characters). Leave empty to cancel:`
    );
    if (!newPassword) return;
    try {
      const data = await apiFetch(`/api/admin/delivery/partners/${partner.id}`, token, {
        method: "PUT",
        body: { password: newPassword },
      });
      onMessage?.(data.message || "Password updated.");
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ margin: 0, color: "#14213d" }}>Delivery Partners</h3>
        {canManage ? (
          <button
            onClick={() => setShowForm((v) => !v)}
            style={{
              padding: "9px 16px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(90deg, #f97316, #ec4899)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {showForm ? "Cancel" : "+ Add Partner"}
          </button>
        ) : null}
      </div>

      {showForm && canManage ? (
        <form
          onSubmit={createPartner}
          style={{
            background: "#fff",
            border: "1px solid #e8ecf5",
            borderRadius: 14,
            padding: 16,
            marginBottom: 16,
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          }}
        >
          <input style={inputStyle} placeholder="Full name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input style={inputStyle} placeholder="Username (4-30 chars) *" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          <input style={inputStyle} type="password" placeholder="Password (min 6) *" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <input style={inputStyle} placeholder="Mobile (10 digits) *" value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} required />
          <input style={inputStyle} placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input style={inputStyle} placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input style={inputStyle} placeholder="Vehicle number" value={form.vehicleNumber} onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })} />
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "#14213d",
              color: "#fff",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Creating…" : "Create Partner"}
          </button>
        </form>
      ) : null}

      {partners === null ? (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 24, color: "#8b93a8" }}>
          Loading partners…
        </div>
      ) : partners.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 28, textAlign: "center", color: "#8b93a8" }}>
          No delivery partners yet. {canManage ? "Add your first partner to start assigning deliveries." : ""}
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase" }}>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Partner</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Contact</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>City</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Active Orders</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Bank</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th>
                {canManage ? <th style={{ padding: "10px 14px", textAlign: "left" }}>Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid #eef1f7" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "#8b93a8" }}>
                      {p.partnerCode} • @{p.username}
                    </div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div>{p.mobile}</div>
                    {p.email ? <div style={{ fontSize: 12, color: "#8b93a8" }}>{p.email}</div> : null}
                  </td>
                  <td style={{ padding: "10px 14px" }}>{p.city || "—"}</td>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>{p.activeOrders ?? 0}</td>
                  <td style={{ padding: "10px 14px", fontSize: 12, color: "#6b7490" }}>
                    {p.bankAccountLast4 ? `•••• ${p.bankAccountLast4}` : p.upiId || "Not added"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: p.status === "active" ? "#ecfdf5" : "#f1f5f9",
                        color: p.status === "active" ? "#047857" : "#64748b",
                      }}
                    >
                      {p.status}
                    </span>
                  </td>
                  {canManage ? (
                    <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                      <button onClick={() => toggleStatus(p)} style={miniBtn}>
                        {p.status === "active" ? "Deactivate" : "Activate"}
                      </button>{" "}
                      <button onClick={() => resetPassword(p)} style={miniBtn}>
                        Reset Password
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const miniBtn = {
  padding: "5px 10px",
  borderRadius: 8,
  border: "1px solid #d8deec",
  background: "#fff",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  color: "#37435f",
};

// ---------------- ORDERS ----------------

function DeliveryOrders({ token, canManage, onMessage }) {
  return (
    <div>
      <h3 style={{ margin: "0 0 12px", color: "#14213d" }}>Delivery Orders</h3>
      <DeliveryOrdersTable token={token} canManage={canManage} onMessage={onMessage} title="All Delivery Orders" showAll />
    </div>
  );
}

function DeliveryOrdersTable({ token, canManage, onMessage, title, showAll }) {
  const [orders, setOrders] = useState(null);
  const [partners, setPartners] = useState([]);
  const [reassigning, setReassigning] = useState(null);

  const load = useCallback(() => {
    apiFetch("/api/admin/delivery/orders", token)
      .then((d) => setOrders(d.orders || []))
      .catch(() => setOrders([]));
    apiFetch("/api/admin/delivery/partners", token)
      .then((d) => setPartners((d.partners || []).filter((p) => p.status === "active")))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function assign(orderId, partnerId) {
    try {
      const data = await apiFetch(`/api/admin/delivery/orders/${orderId}/assign`, token, {
        method: "POST",
        body: { partnerId: Number(partnerId) },
      });
      const otpNote = data.deliveryOtp ? ` Customer delivery OTP: ${data.deliveryOtp} (share with the customer).` : "";
      onMessage?.((data.message || "Assigned.") + otpNote);
      setReassigning(null);
      load();
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  async function unassign(orderId) {
    if (!window.confirm("Unassign this order from its delivery partner?")) return;
    try {
      const data = await apiFetch(`/api/admin/delivery/orders/${orderId}/unassign`, token, { method: "POST" });
      onMessage?.(data.message || "Unassigned.");
      load();
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  const rows = showAll ? orders || [] : (orders || []).slice(0, 10);

  return (
    <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, overflowX: "auto" }}>
      <div style={{ padding: "12px 16px", fontWeight: 700, color: "#14213d", borderBottom: "1px solid #eef1f7" }}>
        {title}
      </div>
      {orders === null ? (
        <div style={{ padding: 20, color: "#8b93a8" }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 24, color: "#8b93a8", textAlign: "center" }}>
          No delivery orders yet. Assign an order from the Assign Delivery tab.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 860 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase" }}>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Order</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Customer</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Amount</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Partner</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Delivery Status</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Assigned</th>
              <th style={{ padding: "10px 14px", textAlign: "left" }}>Delivered</th>
              {canManage ? <th style={{ padding: "10px 14px", textAlign: "left" }}>Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} style={{ borderTop: "1px solid #eef1f7" }}>
                <td style={{ padding: "10px 14px", fontWeight: 600 }}>#{o.orderNumber || o.id}</td>
                <td style={{ padding: "10px 14px" }}>
                  <div>{o.customerName}</div>
                  <div style={{ fontSize: 12, color: "#8b93a8" }}>{o.phoneMasked}</div>
                </td>
                <td style={{ padding: "10px 14px" }}>{rupees(o.totalAmount)}</td>
                <td style={{ padding: "10px 14px" }}>{o.partner?.name || "—"}</td>
                <td style={{ padding: "10px 14px" }}>
                  <StatusBadge status={o.deliveryStatus} />
                  {o.deliveryFailureReason ? (
                    <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 2 }}>{o.deliveryFailureReason}</div>
                  ) : null}
                </td>
                <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(o.assignedAt)}</td>
                <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(o.deliveredAt)}</td>
                {canManage ? (
                  <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                    {reassigning === o.id ? (
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) assign(o.id, e.target.value);
                        }}
                        style={{ padding: "5px 8px", borderRadius: 8, border: "1px solid #d8deec", fontSize: 12 }}
                      >
                        <option value="">Select partner…</option>
                        {partners.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.partnerCode})
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button onClick={() => setReassigning(reassigning === o.id ? null : o.id)} style={miniBtn}>
                      {o.deliveryStatus ? "Reassign" : "Assign"}
                    </button>{" "}
                    {o.deliveryStatus === "Assigned" ? (
                      <button onClick={() => unassign(o.id)} style={{ ...miniBtn, color: "#b91c1c", borderColor: "#fecaca" }}>
                        Unassign
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------- ASSIGN (standalone) ----------------

function AssignPanel({ token, canManage, onMessage }) {
  const [orders, setOrders] = useState([]);
  const [partners, setPartners] = useState([]);
  const [picks, setPicks] = useState({});
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    apiFetch("/api/admin/delivery/partners", token)
      .then((d) => setPartners((d.partners || []).filter((p) => p.status === "active")))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  // Orders come from the existing admin orders feed (delivery field additive).
  useEffect(() => {
    apiFetch("/api/admin/orders", token)
      .then((d) => setOrders((d.orders || []).filter((o) => !o.deliveryStatus)))
      .catch(() => {});
  }, [token]);

  async function assign(orderId, partnerId) {
    try {
      const data = await apiFetch(`/api/admin/delivery/orders/${orderId}/assign`, token, {
        method: "POST",
        body: { partnerId: Number(partnerId) },
      });
      const otpNote = data.deliveryOtp ? ` Customer OTP: ${data.deliveryOtp}.` : "";
      onMessage?.((data.message || "Assigned.") + otpNote);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setPicks((prev) => ({ ...prev, [orderId]: "" }));
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  const filtered = orders.filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      String(o.orderNumber || o.id).toLowerCase().includes(q) ||
      String(o.customerName || "").toLowerCase().includes(q)
    );
  });

  if (!canManage) {
    return (
      <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 24, color: "#8b93a8" }}>
        Only super admin and manager can assign deliveries.
      </div>
    );
  }

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", color: "#14213d" }}>Assign Delivery</h3>
      <input
        style={{ ...inputStyle, maxWidth: 320, marginBottom: 12 }}
        placeholder="Search unassigned orders…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 24, textAlign: "center", color: "#8b93a8" }}>
          No unassigned orders. All orders already have delivery partners.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.slice(0, 30).map((o) => (
            <div
              key={o.id}
              style={{
                background: "#fff",
                border: "1px solid #e8ecf5",
                borderRadius: 14,
                padding: 14,
                display: "flex",
                gap: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 180 }}>
                <div style={{ fontWeight: 700 }}>#{o.orderNumber || o.id}</div>
                <div style={{ fontSize: 13, color: "#6b7490" }}>
                  {o.customerName} • {rupees(o.totalAmount)}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 160, fontSize: 13, color: "#6b7490" }}>
                {[o.address, o.city, o.pincode].filter(Boolean).join(", ") || "—"}
              </div>
              <select
                value={picks[o.id] || ""}
                onChange={(e) => setPicks({ ...picks, [o.id]: e.target.value })}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d8deec", fontSize: 13 }}
              >
                <option value="">Choose partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.city || p.partnerCode})
                  </option>
                ))}
              </select>
              <button
                disabled={!picks[o.id]}
                onClick={() => assign(o.id, picks[o.id])}
                style={{
                  padding: "9px 16px",
                  borderRadius: 10,
                  border: "none",
                  background: picks[o.id] ? "linear-gradient(90deg, #f97316, #ec4899)" : "#e2e8f0",
                  color: picks[o.id] ? "#fff" : "#94a3b8",
                  fontWeight: 700,
                  cursor: picks[o.id] ? "pointer" : "not-allowed",
                }}
              >
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- TRACKING ----------------

function Tracking({ token }) {
  const [orders, setOrders] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    apiFetch("/api/admin/delivery/orders", token)
      .then((d) => setOrders(d.orders || []))
      .catch(() => setOrders([]));
  }, [token]);

  const steps = ["Assigned", "Pickup Pending", "Picked Up", "Out for Delivery", "Delivered"];

  const filtered = (orders || []).filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return String(o.orderNumber || o.id).toLowerCase().includes(q) || String(o.customerName || "").toLowerCase().includes(q);
  });

  return (
    <div>
      <h3 style={{ margin: "0 0 12px", color: "#14213d" }}>Tracking</h3>
      <input
        style={{ ...inputStyle, maxWidth: 320, marginBottom: 12 }}
        placeholder="Search by order number or customer…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {orders === null ? (
        <div style={{ color: "#8b93a8" }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 24, textAlign: "center", color: "#8b93a8" }}>
          No delivery orders to track.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.slice(0, 25).map((o) => {
            const failed = o.deliveryStatus === "Delivery Failed";
            const returned = ["Return to Seller", "Returned to Seller"].includes(o.deliveryStatus);
            const stepIndex = steps.indexOf(o.deliveryStatus);
            return (
              <div key={o.id} style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <b>#{o.orderNumber || o.id}</b>
                  <span style={{ fontSize: 13, color: "#6b7490" }}>{o.customerName}</span>
                  <StatusBadge status={o.deliveryStatus} />
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  {steps.map((step, i) => {
                    const done = stepIndex >= i;
                    return (
                      <span
                        key={step}
                        style={{
                          fontSize: 11,
                          padding: "3px 9px",
                          borderRadius: 999,
                          fontWeight: 600,
                          color: done ? "#fff" : "#8b93a8",
                          background: done ? "linear-gradient(90deg, #f97316, #ec4899)" : "#eef1f7",
                        }}
                      >
                        {step}
                      </span>
                    );
                  })}
                  {failed ? (
                    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 600, color: "#fff", background: "#ef4444" }}>
                      Delivery Failed
                    </span>
                  ) : null}
                  {returned ? (
                    <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 999, fontWeight: 600, color: "#fff", background: "#64748b" }}>
                      {o.deliveryStatus}
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------- SETTINGS ----------------

function DeliverySettings({ token, canManage, onMessage }) {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    apiFetch("/api/admin/delivery/settings", token)
      .then((d) => setSettings(d.settings))
      .catch((e) => onMessage?.(e.message, "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function save() {
    try {
      const data = await apiFetch("/api/admin/delivery/settings", token, {
        method: "PUT",
        body: settings,
      });
      onMessage?.(data.message || "Settings saved.");
    } catch (error) {
      onMessage?.(error.message, "error");
    }
  }

  if (!settings) return <div style={{ color: "#8b93a8" }}>Loading settings…</div>;

  const num = (key, label, hint) => (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#37435f", marginBottom: 5 }}>{label}</span>
      <input
        type="number"
        min="0"
        style={inputStyle}
        value={settings[key]}
        disabled={!canManage}
        onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
      />
      {hint ? <span style={{ display: "block", fontSize: 12, color: "#8b93a8", marginTop: 4 }}>{hint}</span> : null}
    </label>
  );

  return (
    <div style={{ maxWidth: 520 }}>
      <h3 style={{ margin: "0 0 12px", color: "#14213d" }}>Delivery Settings</h3>
      <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 16 }}>
        {num("deliveryCharge", "Delivery Charge (₹)", "Display/config value — order pricing is not changed automatically.")}
        {num("partnerEarningPerDelivery", "Partner Earning per Delivery (₹)", "Recorded per completed delivery; payouts follow existing finance rules.")}
        {num("maxDeliveryAttempts", "Max Delivery Attempts", "After this many failed attempts, partners are asked to return the package.")}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={Boolean(settings.otpRequired)}
            disabled={!canManage}
            onChange={(e) => setSettings({ ...settings, otpRequired: e.target.checked })}
          />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#37435f" }}>Require delivery OTP</span>
        </label>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#37435f", marginBottom: 5 }}>COD Handling</span>
          <select
            style={inputStyle}
            value={settings.codHandling}
            disabled={!canManage}
            onChange={(e) => setSettings({ ...settings, codHandling: e.target.value })}
          >
            <option value="collect-and-deposit">Collect and deposit</option>
            <option value="seller-pays-online">Seller pays online</option>
          </select>
        </label>
        {canManage ? (
          <button
            onClick={save}
            style={{
              padding: "11px 18px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(90deg, #f97316, #ec4899)",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Save Settings
          </button>
        ) : (
          <div style={{ color: "#8b93a8", fontSize: 13 }}>Only super admin can change delivery settings.</div>
        )}
      </div>
    </div>
  );
}

// ---------------- EARNINGS (finance) ----------------

function EarningsPanel({ token }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    apiFetch("/api/admin/delivery/earnings", token)
      .then(setData)
      .catch(() => setData({ earnings: [], totals: {} }));
  }, [token]);

  if (!data) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <h3 style={{ margin: "0 0 12px", color: "#14213d" }}>Delivery Earnings (finance)</h3>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 12 }}>
        <Kpi label="Pending" value={rupees(data.totals?.pending)} accent="#f59e0b" />
        <Kpi label="Paid" value={rupees(data.totals?.paid)} accent="#10b981" />
        <Kpi label="Total" value={rupees(data.totals?.total)} accent="#ec4899" />
      </div>
      {(data.earnings || []).length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, padding: 20, color: "#8b93a8" }}>
          No earnings recorded yet.
        </div>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e8ecf5", borderRadius: 14, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 620 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase" }}>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Partner</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Order</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Amount</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {data.earnings.slice(0, 30).map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #eef1f7" }}>
                  <td style={{ padding: "10px 14px" }}>
                    {e.partnerName} <span style={{ color: "#8b93a8", fontSize: 12 }}>({e.partnerCode})</span>
                  </td>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>#{e.orderNumber || e.orderId}</td>
                  <td style={{ padding: "10px 14px" }}>{rupees(e.amount)}</td>
                  <td style={{ padding: "10px 14px" }}>{e.status}</td>
                  <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(e.deliveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
