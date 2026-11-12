import { useEffect, useMemo, useState } from "react";

import { API } from "./apiConfig";

// =====================================================
// ADMIN — BUSINESS LAUNCH CONTROL CENTER
// =====================================================
// One read-only view over shopping, Family earnings, supplier APIs,
// courier readiness, audit/error queues and the real blockers. It never
// claims a feature is live unless the backend has a successful real
// configuration/test behind it.

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Card({ title, tone = "", children }) {
  return (
    <section
      className="products-section"
      style={{
        borderTop: `4px solid ${
          tone === "good" ? "#10b981" : tone === "bad" ? "#e11d48" : "#f59e0b"
        }`,
      }}
    >
      <div className="section-title" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{title}</h2>
        </div>
        <span
          className="sec-tag"
          style={
            tone === "good"
              ? { background: "#ecfdf5", color: "#047857" }
              : tone === "bad"
                ? { background: "#fff1f2", color: "#be123c" }
                : { background: "#fffbeb", color: "#a16207" }
          }
        >
          {tone === "good" ? "Ready" : tone === "bad" ? "Blocked" : "Needs setup"}
        </span>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, sub }) {
  return (
    <div
      style={{
        border: "1px solid #eef0f3",
        borderRadius: 10,
        padding: "10px 12px",
        background: "#fbfcfd",
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, marginTop: 2 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div> : null}
    </div>
  );
}

export default function LaunchControl({ token, onNavigate }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`${API}/api/admin/launch-status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false) {
          throw new Error(data?.message || `Request failed (HTTP ${response.status}).`);
        }
        if (alive) setStatus(data);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (token) load();
    return () => {
      alive = false;
    };
  }, [token]);

  const blockers = useMemo(() => {
    if (!status) return [];
    const out = [];

    if (status.shopping.approvedProducts === 0) {
      out.push("No approved product is live. Add and approve a real product; demo products are not shown as live.");
    }
    if (status.shopping.kycApproved === 0) {
      out.push("No seller has completed KYC approval.");
    }
    if (status.family.members === 0) {
      out.push("No Family member exists. Sponsor ID is mandatory for real registration.");
    }
    const activeEarnings = (status.family.settings || []).filter((row) => Number(row.enabled) === 1);
    if (activeEarnings.length === 0) {
      out.push("All three 3×3 earnings are OFF. Enable the approved Direct / Spillover / Time-wise rules.");
    }
    if (status.suppliers.connected === 0) {
      out.push("No supplier API has passed a real connection test.");
    }
    if (status.suppliers.failedOrderJobs > 0 || status.suppliers.failedProductRuns > 0) {
      out.push("Supplier sync failures need review in Supplier & Manufacturer logs.");
    }
    if (status.couriers.live === 0) {
      out.push("No courier is in live API mode. Shiprocket credentials / COURIER_LIVE_ENABLED are required for live booking.");
    }
    if (status.couriers.apiErrors > 0) {
      out.push("Courier API errors are recorded in Courier Partners.");
    }
    return out;
  }, [status]);

  const familyAmount = useMemo(() => {
    return (status?.family.commissions || []).reduce(
      (total, row) => total + Number(row.amount || 0),
      0
    );
  }, [status]);

  if (loading) {
    return <div className="empty">Loading launch control…</div>;
  }
  if (error) {
    return <div className="empty">⚠️ {error}</div>;
  }
  if (!status) return null;

  const shoppingReady =
    status.shopping.approvedProducts > 0 && status.shopping.kycApproved > 0;
  const familyReady = (status.family.settings || []).some((row) => Number(row.enabled) === 1);
  const supplierReady = status.suppliers.connected > 0;
  const courierReady = status.couriers.live > 0;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="ov-note">
        <strong>Business Launch Control.</strong> This page reports verified backend state only.
        Configured credentials are not a live integration; a supplier/courier is marked ready only
        after a real successful API test or live booking.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
          gap: 10,
        }}
      >
        <Metric
          label="Approved products"
          value={status.shopping.approvedProducts}
          sub={`${status.shopping.products} total`}
        />
        <Metric
          label="Orders"
          value={status.shopping.orders}
          sub={`${status.shopping.activeOrders} active`}
        />
        <Metric
          label="Family members"
          value={status.family.members}
          sub={`${familyAmount ? money(familyAmount) : "₹0"} 3×3 ledger`}
        />
        <Metric
          label="Supplier APIs"
          value={`${status.suppliers.connected}/${status.suppliers.total}`}
          sub="connected / configured"
        />
        <Metric
          label="Courier live"
          value={`${status.couriers.live}/${status.couriers.total}`}
          sub={`${status.couriers.shipments} shipments`}
        />
      </div>

      <Card title="🛒 Shopping & Orders" tone={shoppingReady ? "good" : "bad"}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Metric label="KYC-approved sellers" value={status.shopping.kycApproved} />
          <Metric label="Pending / active orders" value={status.shopping.activeOrders} />
          <Metric label="Product catalogue" value={status.shopping.products} />
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, color: "#64748b" }}>
          Buyer only receives <b>Approved</b> products. An empty catalogue stays empty — no demo
          product is presented as live.
        </p>
        <button type="button" className="refresh-btn" onClick={() => onNavigate?.("products")}>
          Open Products
        </button>
      </Card>

      <Card title="👨‍👩‍👧 JustBrand Family — 3×3 Earnings" tone={familyReady ? "good" : "bad"}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          {(status.family.settings || []).map((row) => (
            <Metric
              key={row.earningType}
              label={row.earningType.replaceAll("_", " ")}
              value={Number(row.enabled) ? `${row.percentage}%` : "OFF"}
              sub={`${row.calculationBase} · levels ${row.maxLevels} · chain ${row.chainLimit}`}
            />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {(status.family.commissions || []).map((row) => (
            <span key={`${row.source}-${row.status}`} className="sec-tag">
              {row.source} · {row.status}: {row.count}
            </span>
          ))}
        </div>
        <button type="button" className="refresh-btn" onClick={() => onNavigate?.("fam-earning")}>
          Open 3×3 Earning Settings
        </button>
      </Card>

      <Card
        title="🏭 Supplier & Manufacturer APIs"
        tone={supplierReady ? "good" : status.suppliers.total ? "warn" : "bad"}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Metric label="Configured" value={status.suppliers.total} />
          <Metric label="Connected (tested)" value={status.suppliers.connected} />
          <Metric label="Order sync enabled" value={status.suppliers.orderSyncEnabled} />
          <Metric label="Failed order jobs" value={status.suppliers.failedOrderJobs} />
          <Metric label="Failed product runs" value={status.suppliers.failedProductRuns} />
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={() => onNavigate?.("supplier-integrations")}
        >
          Open Supplier Integrations
        </button>
      </Card>

      <Card
        title="🚚 Courier & Delivery"
        tone={courierReady ? "good" : status.couriers.enabled ? "warn" : "bad"}
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
          <Metric label="Enabled partners" value={status.couriers.enabled} />
          <Metric label="Live API partners" value={status.couriers.live} />
          <Metric label="Live shipments" value={status.couriers.liveShipments} />
          <Metric label="Delivered" value={status.couriers.delivered} />
          <Metric label="API errors" value={status.couriers.apiErrors} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
          {(status.couriers.partners || []).map((partner) => (
            <span
              key={partner.id}
              className="sec-tag"
              style={
                partner.mode === "live"
                  ? { background: "#ecfdf5", color: "#047857" }
                  : { background: "#f1f5f9", color: "#475569" }
              }
            >
              {partner.name}: {partner.mode}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="refresh-btn"
          onClick={() => onNavigate?.("courier-partners")}
        >
          Open Courier Partners
        </button>
      </Card>

      <Card title="🚦 Launch blockers" tone={blockers.length ? "bad" : "good"}>
        {blockers.length === 0 ? (
          <p style={{ margin: 0, color: "#047857", fontSize: 13 }}>
            No configuration blocker is detected in the checked areas. This is not a substitute for
            a live transaction test with real credentials.
          </p>
        ) : (
          <ol style={{ margin: "0 0 0 18px", padding: 0, fontSize: 12.8, lineHeight: 1.7 }}>
            {blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ol>
        )}
        <p style={{ margin: "10px 0 0", fontSize: 11.5, color: "#94a3b8" }}>{status.note}</p>
      </Card>
    </div>
  );
}
