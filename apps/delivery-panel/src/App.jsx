import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  API,
  Card,
  Field,
  StatCard,
  StatusBadge,
  Toast,
  inputStyle,
} from "./api.jsx";

const TOKEN_KEY = "jb_delivery_token";
const PARTNER_KEY = "jb_delivery_partner";

// Ordered flow steps shown on order cards.
const FLOW_STEPS = [
  "Assigned",
  "Pickup Pending",
  "Picked Up",
  "Out for Delivery",
  "Delivered",
];

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
  const n = Number(value || 0);
  return `₹${n.toLocaleString("en-IN")}`;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 960 : false
  );
  useEffect(() => {
    const onResize = () => setMobile(window.innerWidth < 960);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return mobile;
}

// Section id → (label, icon emoji, group)
const NAV = [
  ["dashboard", "Dashboard", "🛵", "DELIVERY"],
  ["assigned", "Assigned Orders", "📦", "DELIVERY"],
  ["pickup", "Pickup", "🏪", "DELIVERY"],
  ["ofd", "Out for Delivery", "🛣️", "DELIVERY"],
  ["delivered", "Delivered", "✅", "DELIVERY"],
  ["failed", "Failed Delivery", "⚠️", "DELIVERY"],
  ["history", "Delivery History", "🕘", "DELIVERY"],
  ["profile", "My Profile", "👤", "ACCOUNT"],
  ["bank", "Bank Details", "🏦", "ACCOUNT"],
  ["help", "Help & Support", "🆘", "ACCOUNT"],
];

export default function App() {
  const isMobile = useIsMobile();
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [partner, setPartner] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(PARTNER_KEY) || "null");
    } catch {
      return null;
    }
  });
  const [toast, setToast] = useState(null);

  const notify = useCallback((message, kind = "success") => {
    setToast({ message, kind });
    window.clearTimeout(notify._timer);
    notify._timer = window.setTimeout(() => setToast(null), 3500);
  }, []);

  if (!token) {
    return (
      <LoginScreen
        onLoggedIn={(newToken, newPartner) => {
          localStorage.setItem(TOKEN_KEY, newToken);
          localStorage.setItem(PARTNER_KEY, JSON.stringify(newPartner));
          setToken(newToken);
          setPartner(newPartner);
        }}
      />
    );
  }

  return (
    <Shell
      token={token}
      partner={partner}
      isMobile={isMobile}
      notify={notify}
      onLogout={() => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(PARTNER_KEY);
        setToken("");
        setPartner(null);
      }}
    >
      <Toast toast={toast} />
    </Shell>
  );
}

function LoginScreen({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/delivery/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setError(data.message || "Login failed.");
        return;
      }
      onLoggedIn(data.token, data.partner);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, #14213d 0%, #1b2b52 55%, #26355e 100%)",
        padding: 16,
      }}
    >
      <Card style={{ width: "100%", maxWidth: 420, padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              background: "linear-gradient(90deg, #f97316, #ec4899)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            JustBrand
          </div>
          <div style={{ color: "#6b7490", fontSize: 14, marginTop: 4 }}>
            Delivery Partner Panel
          </div>
          <div style={{ fontSize: 12, color: "#9aa3ba", marginTop: 6 }}>
            🇮🇳 Serving India, one delivery at a time
          </div>
        </div>
        <form onSubmit={submit}>
          <Field label="Username">
            <input
              style={inputStyle}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              required
            />
          </Field>
          <Field label="Password">
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          {error ? (
            <div
              style={{
                background: "#fef2f2",
                color: "#b91c1c",
                borderRadius: 10,
                padding: "10px 12px",
                fontSize: 13,
                marginBottom: 12,
              }}
            >
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              border: "none",
              cursor: busy ? "wait" : "pointer",
              fontWeight: 700,
              fontSize: 15,
              color: "#fff",
              background: "linear-gradient(90deg, #f97316, #ec4899)",
            }}
          >
            {busy ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div style={{ textAlign: "center", fontSize: 12, color: "#8b93a8", marginTop: 16 }}>
          Delivery partner accounts are created by the JustBrand admin team.
        </div>
      </Card>
    </div>
  );
}

function Shell({ token, partner, isMobile, notify, onLogout, children }) {
  const [section, setSection] = useState("dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [me, setMe] = useState(partner);

  // Refresh own profile so status/permission changes reflect live.
  useEffect(() => {
    let active = true;
    fetch(`${API}/api/delivery/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unauthorized"))))
      .then((data) => {
        if (active && data.partner) {
          setMe(data.partner);
          localStorage.setItem(PARTNER_KEY, JSON.stringify(data.partner));
        }
      })
      .catch(() => {
        if (active) onLogout();
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const groups = ["DELIVERY", "ACCOUNT"];

  return (
    <div style={{ minHeight: "100vh", background: "#f4f6fb" }}>
      {/* Top bar */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "#14213d",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 16px",
          height: 58,
        }}
      >
        {isMobile ? (
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: 20,
              cursor: "pointer",
              padding: 8,
            }}
            aria-label="Toggle menu"
          >
            ☰
          </button>
        ) : null}
        <div style={{ fontWeight: 800, fontSize: 19 }}>
          <span
            style={{
              background: "linear-gradient(90deg, #fb923c, #f472b6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            JustBrand
          </span>{" "}
          <span style={{ color: "#fff", fontWeight: 600 }}>Delivery</span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 13, color: "#cbd5e1", display: "flex", alignItems: "center", gap: 8 }}>
          {me?.partnerCode ? <span style={{ opacity: 0.8 }}>{me.partnerCode}</span> : null}
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #f97316, #ec4899)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
            }}
          >
            {(me?.name || "?").slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>

      <div style={{ display: "flex" }}>
        {/* Sidebar */}
        <aside
          style={{
            width: isMobile ? 260 : 240,
            flexShrink: 0,
            background: "#fff",
            borderRight: "1px solid #e8ecf5",
            minHeight: "calc(100vh - 58px)",
            position: isMobile ? "fixed" : "static",
            top: 58,
            left: 0,
            bottom: 0,
            zIndex: 40,
            transform: isMobile && !sidebarOpen ? "translateX(-100%)" : "none",
            transition: "transform 0.2s ease",
            overflowY: "auto",
            paddingTop: 10,
            paddingBottom: 20,
          }}
        >
          {groups.map((group) => (
            <div key={group} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: "#8b93a8",
                  padding: "10px 16px 6px",
                }}
              >
                {group}
              </div>
              {NAV.filter(([, , , navGroup]) => navGroup === group).map(
                ([id, label, icon]) => {
                  const active = section === id;
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setSection(id);
                        setSidebarOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 16px",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 14,
                        fontWeight: active ? 700 : 500,
                        color: active ? "#c2410c" : "#37435f",
                        background: active ? "#fff7ed" : "transparent",
                        borderLeft: active ? "3px solid #f97316" : "3px solid transparent",
                      }}
                    >
                      <span>{icon}</span>
                      {label}
                    </button>
                  );
                }
              )}
            </div>
          ))}
          <div style={{ padding: "12px 16px" }}>
            <button
              onClick={onLogout}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #fecdd3",
                background: "#fff1f2",
                color: "#be123c",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Logout
            </button>
          </div>
        </aside>

        {/* Mobile overlay */}
        {isMobile && sidebarOpen ? (
          <div
            onClick={() => setSidebarOpen(false)}
            style={{
              position: "fixed",
              inset: "58px 0 0 0",
              background: "rgba(20,33,61,0.35)",
              zIndex: 35,
            }}
          />
        ) : null}

        {/* Main */}
        <main style={{ flex: 1, padding: isMobile ? 14 : 22, minWidth: 0 }}>
          <Section
            section={section}
            token={token}
            me={me}
            isMobile={isMobile}
            notify={notify}
            goTo={setSection}
          />
        </main>
      </div>
      {children}
    </div>
  );
}

function Section({ section, token, me, isMobile, notify, goTo }) {
  switch (section) {
    case "dashboard":
      return <Dashboard token={token} isMobile={isMobile} notify={notify} goTo={goTo} />;
    case "assigned":
      return (
        <OrdersList
          token={token}
          isMobile={isMobile}
          notify={notify}
          filter={() => true}
          title="Assigned Orders"
          emptyText="No assigned orders yet."
        />
      );
    case "pickup":
      return (
        <OrdersList
          token={token}
          isMobile={isMobile}
          notify={notify}
          filter={(o) => ["Assigned", "Pickup Pending"].includes(o.deliveryStatus)}
          title="Pickup"
          emptyText="No pickups pending."
        />
      );
    case "ofd":
      return (
        <OrdersList
          token={token}
          isMobile={isMobile}
          notify={notify}
          filter={(o) => ["Picked Up", "Out for Delivery", "Delivery Failed"].includes(o.deliveryStatus)}
          title="Out for Delivery"
          emptyText="Nothing out for delivery right now."
        />
      );
    case "delivered":
      return (
        <OrdersList
          token={token}
          isMobile={isMobile}
          notify={notify}
          filter={(o) => o.deliveryStatus === "Delivered"}
          title="Delivered"
          emptyText="No delivered orders yet."
        />
      );
    case "failed":
      return (
        <OrdersList
          token={token}
          isMobile={isMobile}
          notify={notify}
          filter={(o) => o.deliveryStatus === "Delivery Failed"}
          title="Failed Delivery"
          emptyText="No failed deliveries. Great job!"
        />
      );
    case "history":
      return <History token={token} isMobile={isMobile} />;
    case "profile":
      return <Profile token={token} me={me} notify={notify} />;
    case "bank":
      return <BankDetails token={token} me={me} notify={notify} />;
    case "help":
      return <Help />;
    default:
      return null;
  }
}

function PageHeader({ title, subtitle }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h1 style={{ margin: 0, fontSize: 22, color: "#14213d" }}>{title}</h1>
      {subtitle ? <div style={{ color: "#6b7490", fontSize: 13, marginTop: 4 }}>{subtitle}</div> : null}
    </div>
  );
}

async function apiPut(token, path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Request failed.");
  }
  return data;
}

// ---------------- DASHBOARD ----------------

function Dashboard({ token, isMobile, notify, goTo }) {
  const [data, setData] = useState(null);
  const [earnings, setEarnings] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, earnRes] = await Promise.all([
        fetch(`${API}/api/delivery/dashboard`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API}/api/delivery/earnings`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      const dash = await dashRes.json().catch(() => ({}));
      const earn = await earnRes.json().catch(() => ({}));
      if (dashRes.ok) setData(dash);
      if (earnRes.ok) setEarnings(earn.summary || null);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const counts = data?.counts || {};

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Your delivery activity at a glance" />
      {loading ? (
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr" : "repeat(4, 1fr)" }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="dp-shimmer" style={{ height: 92 }} />
          ))}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)" }}>
            <StatCard label="Today's Assigned" value={counts.assignedToday ?? 0} accent="#f97316" />
            <StatCard label="Pickup Pending" value={counts.pickupPending ?? 0} accent="#f59e0b" onClick={() => goTo("pickup")} />
            <StatCard label="Picked Up" value={counts.pickedUp ?? 0} accent="#3b82f6" onClick={() => goTo("ofd")} />
            <StatCard label="Out for Delivery" value={counts.outForDelivery ?? 0} accent="#8b5cf6" onClick={() => goTo("ofd")} />
            <StatCard label="Delivered Today" value={counts.deliveredToday ?? 0} accent="#10b981" onClick={() => goTo("delivered")} />
            <StatCard label="Failed Delivery" value={counts.failed ?? 0} accent="#ef4444" onClick={() => goTo("failed")} />
            <StatCard label="Total Earnings" value={rupees(earnings?.totalAmount)} accent="#ec4899" sub={`Pending ${rupees(earnings?.pendingAmount)}`} onClick={() => goTo("history")} />
            <StatCard label="Pending Earnings" value={rupees(earnings?.pendingAmount)} accent="#64748b" sub={`Rate ${rupees(earnings?.perDeliveryRate)} / delivery`} />
          </div>

          <Card style={{ marginTop: 16, padding: 0, overflowX: "auto" }}>
            <div style={{ padding: "14px 16px", fontWeight: 700, color: "#14213d", borderBottom: "1px solid #eef1f7" }}>
              Recent Assigned Orders
            </div>
            {(data?.recentOrders || []).length === 0 ? (
              <div style={{ padding: 24, color: "#8b93a8", textAlign: "center" }}>
                No orders assigned yet. New assignments from admin will appear here.
              </div>
            ) : isMobile ? (
              <div style={{ padding: 12, display: "grid", gap: 10 }}>
                {data.recentOrders.map((o) => (
                  <OrderCard key={o.id} order={o} token={token} notify={notify} refresh={load} compact />
                ))}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Order</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Customer</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Pickup</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Delivery</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Amount</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th>
                    <th style={{ padding: "10px 14px", textAlign: "left" }}>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentOrders.map((o) => (
                    <tr key={o.id} style={{ borderTop: "1px solid #eef1f7" }}>
                      <td style={{ padding: "10px 14px", fontWeight: 600 }}>#{o.orderNumber || o.id}</td>
                      <td style={{ padding: "10px 14px" }}>{o.customerName}</td>
                      <td style={{ padding: "10px 14px", maxWidth: 160 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {o.pickup?.shopName || o.pickup?.sellerName || "—"}
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px", maxWidth: 160 }}>
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {[o.city, o.state].filter(Boolean).join(", ") || "—"}
                        </div>
                      </td>
                      <td style={{ padding: "10px 14px" }}>{rupees(o.totalAmount)}</td>
                      <td style={{ padding: "10px 14px" }}><StatusBadge status={o.deliveryStatus} /></td>
                      <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(o.assignedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------- ORDER CARD (shared) ----------------

function OrderCard({ order, token, notify, refresh, compact = false }) {
  const [busy, setBusy] = useState("");
  const [showOtp, setShowOtp] = useState(false);
  const [otp, setOtp] = useState("");
  const [failOpen, setFailOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");

  const status = order.deliveryStatus || "Assigned";

  async function act(action, body = {}) {
    setBusy(action);
    try {
      const data = await apiPut(token, `/api/delivery/orders/${order.id}/${action}`, body);
      notify(data.message || "Updated.");
      setFailOpen(false);
      setShowOtp(false);
      setOtp("");
      setReason("");
      setDetails("");
      refresh?.();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy("");
    }
  }

  const stepsDone = FLOW_STEPS.indexOf(status);

  return (
    <Card style={{ padding: 16 }}>
      {/* Head */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#14213d" }}>
            Order #{order.orderNumber || order.id}
          </div>
          <div style={{ fontSize: 13, color: "#6b7490", marginTop: 2 }}>
            {order.customerName} • {order.itemCount} item{order.itemCount === 1 ? "" : "s"} • {rupees(order.totalAmount)}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Progress */}
      {!compact ? (
        <div style={{ display: "flex", gap: 4, margin: "14px 0 10px", flexWrap: "wrap" }}>
          {FLOW_STEPS.map((step, index) => {
            const done = stepsDone >= index && stepsDone !== -1;
            return (
              <div
                key={step}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 999,
                  fontWeight: 600,
                  color: done ? "#fff" : "#8b93a8",
                  background: done ? "linear-gradient(90deg, #f97316, #ec4899)" : "#eef1f7",
                }}
              >
                {step}
              </div>
            );
          })}
          {status === "Delivery Failed" ? (
            <div style={{ fontSize: 11, padding: "3px 8px", borderRadius: 999, fontWeight: 600, color: "#fff", background: "#ef4444" }}>
              Delivery Failed
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Pickup + delivery info */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: compact ? "1fr" : "1fr 1fr", marginTop: 10 }}>
        <div style={{ background: "#fff7ed", borderRadius: 10, padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: "#c2410c", marginBottom: 4 }}>🏪 Pickup</div>
          <div style={{ color: "#37435f" }}>
            {order.pickup?.shopName || order.pickup?.sellerName || "Seller pickup"}
          </div>
          {order.pickup?.pickupAddress ? (
            <div style={{ color: "#6b7490", marginTop: 2 }}>{order.pickup.pickupAddress}</div>
          ) : null}
        </div>
        <div style={{ background: "#eff6ff", borderRadius: 10, padding: 12, fontSize: 13 }}>
          <div style={{ fontWeight: 700, color: "#1d4ed8", marginBottom: 4 }}>📍 Deliver to</div>
          <div style={{ color: "#37435f" }}>{order.customerName}</div>
          <div style={{ color: "#6b7490", marginTop: 2 }}>
            {[order.address, order.city, order.state, order.pincode].filter(Boolean).join(", ")}
          </div>
          <div style={{ color: "#6b7490", marginTop: 2 }}>
            📞 {order.phone || order.phoneMasked || "—"}
            {order.paymentMethod ? ` • ${order.paymentMethod}` : ""}
            {order.paymentStatus ? ` (${order.paymentStatus})` : ""}
          </div>
        </div>
      </div>

      {order.deliveryFailureReason && status === "Delivery Failed" ? (
        <div style={{ background: "#fef2f2", color: "#b91c1c", borderRadius: 10, padding: 10, fontSize: 13, marginTop: 10 }}>
          Last failure: {order.deliveryFailureReason} • Attempts: {order.deliveryRetryCount || 0}
        </div>
      ) : null}

      {/* Actions per state */}
      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {status === "Assigned" ? (
          <ActionBtn onClick={() => act("accept-pickup")} busy={busy === "accept-pickup"} label="Accept Pickup" />
        ) : null}
        {status === "Pickup Pending" ? (
          <ActionBtn onClick={() => act("picked-up")} busy={busy === "picked-up"} label="Picked Up" tone="primary" />
        ) : null}
        {status === "Picked Up" ? (
          <ActionBtn onClick={() => act("start-delivery")} busy={busy === "start-delivery"} label="Start Delivery" tone="primary" />
        ) : null}
        {status === "Out for Delivery" ? (
          <>
            <ActionBtn onClick={() => setShowOtp((v) => !v)} busy={false} label="Reached Customer — Deliver" tone="primary" />
            <ActionBtn onClick={() => setFailOpen((v) => !v)} busy={false} label="Mark Failed" tone="danger" />
          </>
        ) : null}
        {status === "Delivery Failed" ? (
          <>
            <ActionBtn onClick={() => act("retry")} busy={busy === "retry"} label="Retry Delivery" tone="primary" />
            <ActionBtn onClick={() => act("return-to-seller")} busy={busy === "return-to-seller"} label="Return to Seller" tone="danger" />
          </>
        ) : null}
        {status === "Return to Seller" ? (
          <ActionBtn onClick={() => act("returned")} busy={busy === "returned"} label="Confirm Returned" tone="danger" />
        ) : null}
      </div>

      {/* OTP input */}
      {showOtp && status === "Out for Delivery" ? (
        <div style={{ marginTop: 12, background: "#f8fafc", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#37435f", marginBottom: 8 }}>
            Ask the customer for their 6-digit delivery OTP and enter it here:
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              style={{ ...inputStyle, maxWidth: 180 }}
              inputMode="numeric"
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit OTP"
            />
            <ActionBtn onClick={() => act("deliver", { otp })} busy={busy === "deliver"} label="Deliver Order" tone="primary" />
          </div>
        </div>
      ) : null}

      {/* Failure reason form */}
      {failOpen && status === "Out for Delivery" ? (
        <div style={{ marginTop: 12, background: "#fef2f2", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#b91c1c", marginBottom: 8 }}>
            Why did this delivery fail? (reason required)
          </div>
          <select style={inputStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Select a reason…</option>
            <option>Customer unavailable</option>
            <option>Wrong address</option>
            <option>Customer refused</option>
            <option>Phone unreachable</option>
            <option>Other</option>
          </select>
          <input
            style={{ ...inputStyle, marginTop: 8 }}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Optional details (e.g. gate closed, will retry at 6pm)"
          />
          <div style={{ marginTop: 10 }}>
            <ActionBtn
              onClick={() => act("failed", { reason, details })}
              busy={busy === "failed"}
              label="Submit Failure"
              tone="danger"
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function ActionBtn({ onClick, busy, label, tone = "default" }) {
  const styles = {
    default: { background: "#fff", color: "#37435f", border: "1px solid #d8deec" },
    primary: { background: "linear-gradient(90deg, #f97316, #ec4899)", color: "#fff", border: "none" },
    danger: { background: "#fff", color: "#b91c1c", border: "1px solid #fecaca" },
  }[tone];
  return (
    <button
      onClick={onClick}
      disabled={busy}
      style={{
        padding: "9px 14px",
        borderRadius: 10,
        fontWeight: 600,
        fontSize: 13,
        cursor: busy ? "wait" : "pointer",
        ...styles,
      }}
    >
      {busy ? "…" : label}
    </button>
  );
}

// ---------------- ORDERS LIST ----------------

function OrdersList({ token, isMobile, notify, filter, title, emptyText }) {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`${API}/api/delivery/orders`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Failed to load orders.");
      const data = await response.json();
      setOrders((data.orders || []).filter(filter));
    } catch (e) {
      setError(e.message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader title={title} />
      {error ? (
        <Card style={{ color: "#b91c1c" }}>{error}</Card>
      ) : orders === null ? (
        <div style={{ display: "grid", gap: 12 }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="dp-shimmer" style={{ height: 180 }} />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <Card style={{ textAlign: "center", color: "#8b93a8", padding: 32 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>📭</div>
          {emptyText}
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} token={token} notify={notify} refresh={load} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- HISTORY ----------------

function History({ token, isMobile }) {
  const [orders, setOrders] = useState(null);
  const [earnings, setEarnings] = useState([]);

  useEffect(() => {
    fetch(`${API}/api/delivery/history`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setOrders(d.orders || []))
      .catch(() => setOrders([]));
    fetch(`${API}/api/delivery/earnings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => setEarnings(d.earnings || []))
      .catch(() => setEarnings([]));
  }, [token]);

  return (
    <div>
      <PageHeader title="Delivery History" subtitle="Completed deliveries and earning records" />
      {orders === null ? (
        <div className="dp-shimmer" style={{ height: 200 }} />
      ) : orders.length === 0 ? (
        <Card style={{ textAlign: "center", color: "#8b93a8", padding: 32 }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🕘</div>
          No completed deliveries yet.
        </Card>
      ) : (
        <Card style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 640 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase" }}>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Order</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Customer</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Amount</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Result</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid #eef1f7" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>#{o.orderNumber || o.id}</td>
                  <td style={{ padding: "10px 14px" }}>{o.customerName}</td>
                  <td style={{ padding: "10px 14px" }}>{rupees(o.totalAmount)}</td>
                  <td style={{ padding: "10px 14px" }}><StatusBadge status={o.deliveryStatus} /></td>
                  <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(o.deliveredAt || o.returnedToSellerAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <h2 style={{ fontSize: 17, color: "#14213d", margin: "22px 0 10px" }}>Earnings</h2>
      {earnings.length === 0 ? (
        <Card style={{ color: "#8b93a8", fontSize: 14 }}>
          Earnings appear here after each completed delivery. Actual payouts follow the
          existing JustBrand finance rules.
        </Card>
      ) : (
        <Card style={{ padding: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14, minWidth: 560 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#6b7490", fontSize: 12, textTransform: "uppercase" }}>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Order</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Amount</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Status</th>
                <th style={{ padding: "10px 14px", textAlign: "left" }}>Delivered</th>
              </tr>
            </thead>
            <tbody>
              {earnings.map((e) => (
                <tr key={e.id} style={{ borderTop: "1px solid #eef1f7" }}>
                  <td style={{ padding: "10px 14px", fontWeight: 600 }}>#{e.orderNumber || e.orderId}</td>
                  <td style={{ padding: "10px 14px" }}>{rupees(e.amount)}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "3px 10px",
                        borderRadius: 999,
                        background: e.status === "Paid" ? "#ecfdf5" : "#fffbeb",
                        color: e.status === "Paid" ? "#047857" : "#b45309",
                      }}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#6b7490" }}>{fmtTime(e.deliveredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ---------------- PROFILE ----------------

function Profile({ token, me, notify }) {
  const [form, setForm] = useState({
    email: me?.email || "",
    city: me?.city || "",
    vehicleNumber: me?.vehicleNumber || "",
  });
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await apiPut(token, "/api/delivery/me", form);
      notify(data.message || "Profile updated.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="My Profile" subtitle={`${me?.name || ""} • ${me?.partnerCode || ""}`} />
      <Card style={{ maxWidth: 560 }}>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginBottom: 14 }}>
          <InfoLine label="Name" value={me?.name} />
          <InfoLine label="Mobile" value={me?.mobile} />
          <InfoLine label="Username" value={me?.username} />
          <InfoLine label="Vehicle" value={me?.vehicleNumber || "—"} />
        </div>
        <form onSubmit={save}>
          <Field label="Email">
            <input
              style={inputStyle}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="City">
            <input
              style={inputStyle}
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
          </Field>
          <Field label="Vehicle Number">
            <input
              style={inputStyle}
              value={form.vehicleNumber}
              onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
            />
          </Field>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "11px 18px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(90deg, #f97316, #ec4899)",
              color: "#fff",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </Card>
    </div>
  );
}

function InfoLine({ label, value }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 12px", fontSize: 13 }}>
      <div style={{ color: "#8b93a8", fontSize: 11, fontWeight: 600, textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: "#14213d", fontWeight: 600, marginTop: 2 }}>{value || "—"}</div>
    </div>
  );
}

// ---------------- BANK ----------------

function BankDetails({ token, me, notify }) {
  const [form, setForm] = useState({
    bankAccountName: me?.bankAccountName || "",
    bankAccountNumber: me?.bankAccountNumber || "",
    bankIfscCode: me?.bankIfscCode || "",
    upiId: me?.upiId || "",
  });
  const [busy, setBusy] = useState(false);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await apiPut(token, "/api/delivery/me", form);
      notify(data.message || "Bank details saved.");
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Bank Details" subtitle="Used for delivery earnings payouts" />
      <Card style={{ maxWidth: 560 }}>
        <form onSubmit={save}>
          <Field label="Account Holder Name">
            <input
              style={inputStyle}
              value={form.bankAccountName}
              onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
            />
          </Field>
          <Field label="Account Number" hint="6–20 digits">
            <input
              style={inputStyle}
              inputMode="numeric"
              value={form.bankAccountNumber}
              onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value.replace(/\s/g, "") })}
            />
          </Field>
          <Field label="IFSC Code" hint="e.g. SBIN0001234">
            <input
              style={inputStyle}
              value={form.bankIfscCode}
              onChange={(e) => setForm({ ...form, bankIfscCode: e.target.value.toUpperCase() })}
            />
          </Field>
          <Field label="UPI ID (optional)">
            <input
              style={inputStyle}
              value={form.upiId}
              onChange={(e) => setForm({ ...form, upiId: e.target.value })}
            />
          </Field>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "11px 18px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(90deg, #f97316, #ec4899)",
              color: "#fff",
              fontWeight: 700,
              cursor: busy ? "wait" : "pointer",
            }}
          >
            {busy ? "Saving…" : "Save Bank Details"}
          </button>
        </form>
      </Card>
    </div>
  );
}

// ---------------- HELP ----------------

function Help() {
  return (
    <div>
      <PageHeader title="Help & Support" subtitle="How the delivery flow works" />
      <div style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <Card>
          <b style={{ color: "#14213d" }}>Delivery flow</b>
          <div style={{ color: "#37435f", fontSize: 14, marginTop: 6, lineHeight: 1.7 }}>
            Accept Pickup → Picked Up → Start Delivery → Reached Customer → enter the customer's
            6-digit OTP → Delivered. If a delivery fails, submit a reason and then Retry or Return
            to Seller.
          </div>
        </Card>
        <Card>
          <b style={{ color: "#14213d" }}>Delivery OTP</b>
          <div style={{ color: "#37435f", fontSize: 14, marginTop: 6, lineHeight: 1.7 }}>
            When admin assigns an order, a 6-digit OTP is generated and shared with the customer
            through JustBrand support. Always verify the OTP with the customer before marking an
            order delivered.
          </div>
        </Card>
        <Card>
          <b style={{ color: "#14213d" }}>Earnings</b>
          <div style={{ color: "#37435f", fontSize: 14, marginTop: 6, lineHeight: 1.7 }}>
            Each completed delivery records an earning at the current per-delivery rate set by
            admin. Earnings stay Pending until finance approves payout under the existing
            JustBrand finance rules.
          </div>
        </Card>
        <Card>
          <b style={{ color: "#14213d" }}>Need more help?</b>
          <div style={{ color: "#37435f", fontSize: 14, marginTop: 6, lineHeight: 1.7 }}>
            Contact the JustBrand operations team from your registered mobile number.
          </div>
        </Card>
      </div>
    </div>
  );
}
