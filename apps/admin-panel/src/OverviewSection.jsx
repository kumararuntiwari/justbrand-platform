import { useEffect, useMemo, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

const EMPTY_DAILY = () => {
  const days = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  return days;
};

function dayStart(dateLike) {
  const d = new Date(dateLike);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function money(value) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(num)) return 0;
  return num;
}

function fmtINR(num) {
  return `₹${Number(num || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

// Line chart: pure inline SVG — no new dependencies.
function LineChart({ points, height = 170, color = "#ff7a00", prefix = "" }) {
  if (!points.length) {
    return <div className="ov-chart-empty">No data in this period.</div>;
  }
  const W = 640;
  const H = height;
  const P = 8;
  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? (W - P * 2) / (points.length - 1) : 0;
  const y = (v) => H - P - (v / max) * (H - P * 2);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(P + i * stepX).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${(P + (points.length - 1) * stepX).toFixed(1)},${H - P} L${P},${H - P} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ov-chart" role="img" preserveAspectRatio="none">
      <path d={areaPath} fill={color} opacity="0.10" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle
          key={`${p.label}-${i}`}
          cx={P + i * stepX}
          cy={y(p.value)}
          r={points.length > 40 ? 0 : 2.5}
          fill={color}
        >
          <title>{`${p.label}: ${prefix}${p.value.toLocaleString("en-IN")}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function Bars({ items, color = "#ff1493", prefix = "" }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  if (!items.length || max === 0) {
    return <div className="ov-chart-empty">No data in this period.</div>;
  }
  return (
    <div className="ov-bars">
      {items.map((item) => (
        <div key={item.label} className="ov-bar-row" title={`${item.label}: ${prefix}${item.value.toLocaleString("en-IN")}`}>
          <span className="ov-bar-label">{item.label}</span>
          <span className="ov-bar-track">
            <span className="ov-bar-fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="ov-bar-value">{prefix}{item.value.toLocaleString("en-IN")}</span>
        </div>
      ))}
    </div>
  );
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "month", label: "This Month" },
  { key: "lastMonth", label: "Last Month" },
  { key: "all", label: "All time" },
];

function rangeBounds(key, customFrom, customTo) {
  const now = new Date();
  const today = dayStart(now);
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  switch (key) {
    case "today":
      return { from: today, to: null };
    case "yesterday":
      return { from: yest, to: today };
    case "7d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 6);
      return { from: f, to: null };
    }
    case "30d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 29);
      return { from: f, to: null };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case "lastMonth":
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        to: new Date(now.getFullYear(), now.getMonth(), 1),
      };
    case "custom":
      return { from: customFrom ? dayStart(customFrom) : null, to: customTo ? dayStart(customTo) : null };
    default:
      return { from: null, to: null };
  }
}

function inRange(createdAt, from, to) {
  const d = dayStart(createdAt);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d >= to) return false;
  return true;
}

function Kpi({ label, value, tone = "", onClick, sub }) {
  return (
    <button type="button" className={`ov-kpi ${tone}`} onClick={onClick} disabled={!onClick}>
      <span className="ov-kpi-label">{label}</span>
      <strong className="ov-kpi-value">{value}</strong>
      {sub ? <small className="ov-kpi-sub">{sub}</small> : null}
    </button>
  );
}

export default function OverviewSection({ token, onNavigate }) {
  const [orders, setOrders] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [sellers, setSellers] = useState(null);
  const [products, setProducts] = useState(null);
  const [members, setMembers] = useState(null);
  const [commissions, setCommissions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rangeKey, setRangeKey] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const canUseCatalog = useMemo(
    () => ["super_admin", "manager"].includes(token?.role),
    [token?.role]
  );
  const canUseOrders = useMemo(
    () => ["super_admin", "manager", "accountant"].includes(token?.role),
    [token?.role]
  );
  const isFinance = useMemo(
    () => ["super_admin", "accountant"].includes(token?.role),
    [token?.role]
  );

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError("");

      try {
        const headers = { Authorization: `Bearer ${token?.token}` };
      // Each admin endpoint is role-gated server-side, so the dashboard
      // only fetches what this role is allowed to see. Restricted KPIs
      // render as "—" instead of a misleading zero.
      const j = (r) => r.json().catch(() => ({}));
      const requests = [
        canUseOrders ? fetch(`${API}/api/admin/orders`, { headers }).then(j) : null,
        canUseCatalog ? fetch(`${API}/api/admin/customers`, { headers }).then(j) : null,
        canUseCatalog ? fetch(`${API}/api/admin/sellers`, { headers }).then(j) : null,
        canUseCatalog ? fetch(`${API}/api/admin/products`, { headers }).then(j) : null,
        canUseCatalog ? fetch(`${API}/api/admin/mlm/members`, { headers }).then(j) : null,
        isFinance ? fetch(`${API}/api/admin/mlm/commissions`, { headers }).then(j) : null,
      ];
      const [o, c, s, p, m, cm] = await Promise.all(requests);
      if (!alive) return;
      setOrders(canUseOrders ? o?.orders || [] : null);
      setCustomers(canUseCatalog ? c?.customers || [] : null);
      setSellers(canUseCatalog ? s?.sellers || [] : null);
      setProducts(canUseCatalog ? p?.products || [] : null);
      setMembers(canUseCatalog ? m?.members || [] : null);
      setCommissions(isFinance ? cm?.commissions || [] : null);
      } catch (e) {
        if (alive) setError(e.message || "Failed to load dashboard data.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    if (token?.token) load();
    return () => {
      alive = false;
    };
  }, [token?.token, token?.role]);

  const { from, to } = rangeBounds(rangeKey, customFrom, customTo);

  // ---- Real aggregates (no invented numbers) ----
  const stats = useMemo(() => {
    const inPeriod = (arr) => arr.filter((x) => inRange(x.createdAt, from, to));
    const sum = (arr, f) => arr.reduce((acc, x) => acc + f(x), 0);

    const ordersIn = inPeriod(orders);
    const salesIn = sum(ordersIn.filter((o) => !["Cancelled", "Returned", "Refunded"].includes(o.status)), (o) => money(o.totalAmount));

    const dailySeries = EMPTY_DAILY().map((d) => {
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter((o) => {
        const od = new Date(o.createdAt);
        return od >= d && od < next && !["Cancelled", "Returned", "Refunded"].includes(o.status);
      });
      return { label: `${d.getDate()}/${d.getMonth() + 1}`, value: sum(dayOrders, (o) => money(o.totalAmount)) };
    });

    const catTotals = new Map();
    ordersIn.forEach((o) => {
      (o.items || []).forEach((it) => {
        void it;
      });
    });

    // Category sales come from order_items product names only when the
    // backend provides category on items — it does not, so we use product
    // counts per category from the catalogue instead (never invented).
    const catCounts = new Map();
    products.forEach((p) => {
      const c = p.category || "Uncategorised";
      catCounts.set(c, (catCounts.get(c) || 0) + 1);
    });

    const sellerSales = new Map();
    ordersIn.forEach((o) => {
      (o.items || []).forEach((it) => {
        const key = it.sellerId || it.sellerName || "Unknown";
        const prev = sellerSales.get(key) || { label: key, value: 0, qty: 0 };
        prev.value += money(it.price) * (it.quantity || 1);
        prev.qty += it.quantity || 1;
        sellerSales.set(key, prev);
      });
    });

    const productSales = new Map();
    ordersIn.forEach((o) => {
      (o.items || []).forEach((it) => {
        const prev = productSales.get(it.productName) || { label: it.productName || "Unknown", value: 0, qty: 0 };
        prev.value += money(it.price) * (it.quantity || 1);
        prev.qty += it.quantity || 1;
        productSales.set(it.productName, prev);
      });
    });

    const topProducts = [...productSales.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);
    const topSellers = [...sellerSales.values()].sort((a, b) => b.value - a.value).slice(0, 8);

    const customersIn = inPeriod(customers);
    const sellersIn = inPeriod(sellers);
    const membersIn = inPeriod(members);

    return {
      totalBuyers: customers.length,
      newBuyersToday: customers.filter((c) => inRange(c.createdAt, todayStart, null)).length,
      newBuyersMonth: customers.filter((c) => new Date(c.createdAt) >= monthStart).length,
      activeBuyers: customers.filter((c) => (c.status || "active") === "active").length,
      totalSellers: sellers.length,
      activeSellers: sellers.filter((s) => s.status === "active").length,
      pendingSellers: sellers.filter((s) => s.status !== "active").length,
      pendingKyc: sellers.filter((s) => s.kycStatus === "Pending").length,
      totalProducts: products.length,
      pendingProducts: products.filter((p) => p.status === "Pending").length,
      approvedProducts: products.filter((p) => p.status === "Approved").length,
      totalOrders: orders.length,
      ordersInPeriod: ordersIn.length,
      ordersToday: orders.filter((o) => inRange(o.createdAt, todayStart, null)).length,
      pendingOrders: orders.filter((o) => o.status === "Pending").length,
      deliveredOrders: orders.filter((o) => o.status === "Delivered").length,
      cancelledOrders: orders.filter((o) => o.status === "Cancelled").length,
      returnedOrders: orders.filter((o) => o.status === "Returned").length,
      refundedOrders: orders.filter((o) => o.status === "Refunded").length,
      salesInPeriod: salesIn,
      totalSales: sum(orders.filter((o) => !["Cancelled", "Returned", "Refunded"].includes(o.status)), (o) => money(o.totalAmount)),
      todaySales: sum(orders.filter((o) => inRange(o.createdAt, todayStart, null) && !["Cancelled", "Returned", "Refunded"].includes(o.status)), (o) => money(o.totalAmount)),
      monthSales: sum(orders.filter((o) => new Date(o.createdAt) >= monthStart && !["Cancelled", "Returned", "Refunded"].includes(o.status)), (o) => money(o.totalAmount)),
      familyMembers: members.length,
      activeFamily: members.filter((m) => m.status === "active").length,
      newFamilyInPeriod: membersIn.length,
      commissionCounts: commissions.reduce((acc, c) => {
        acc[c.status] = (acc[c.status] || 0) + 1;
        return acc;
      }, {}),
      catCounts: [...catCounts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8),
      topProducts,
      topSellers,
      dailySeries,
      buyersSeries: EMPTY_DAILY().map((d) => {
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return {
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          value: customers.filter((c) => { const cd = new Date(c.createdAt); return cd >= d && cd < next; }).length,
        };
      }),
    };
  }, [orders, customers, sellers, products, members, commissions, from, to]);

  const nav = (key) => onNavigate && onNavigate(key);
  const unknown = (v) => (v === null ? "—" : v);

  if (loading) {
    return (
      <div className="ov-wrap">
        <div className="ov-skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="ov-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ov-wrap">
        <div className="empty">⚠️ {error} — Refresh पर दोबारा प्रयास करें।</div>
      </div>
    );
  }

  return (
    <div className="ov-wrap">
      {/* RANGE FILTER */}
      <div className="ov-rangebar">
        <div className="ov-range-chips">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={rangeKey === r.key ? "ov-chip active" : "ov-chip"}
              onClick={() => setRangeKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeKey === "custom" && (
          <div className="ov-custom-range">
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <span>→</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        )}
      </div>

      {/* KPI GRID */}
      <div className="ov-kpis">
        <Kpi label="Total Buyers" value={unknown(stats.totalBuyers)} onClick={() => nav("buyers")} sub={stats.totalBuyers === null ? null : `${stats.activeBuyers} active`} />
        <Kpi label="New Buyers Today" value={unknown(stats.newBuyersToday)} onClick={() => nav("buyers")} />
        <Kpi label="New Buyers This Month" value={unknown(stats.newBuyersMonth)} onClick={() => nav("buyers")} />
        <Kpi label="Total Sellers" value={unknown(stats.totalSellers)} tone="ov-tone-orange" onClick={() => nav("sellers")} sub={stats.totalSellers === null ? null : `${stats.activeSellers} active`} />
        <Kpi label="Pending Seller Approvals" value={unknown(stats.pendingSellers)} tone="ov-tone-warn" onClick={() => nav("sellers")} />
        <Kpi label="Pending KYC" value={unknown(stats.pendingKyc)} tone="ov-tone-warn" onClick={() => nav("kyc")} />
        <Kpi label="Total Products" value={unknown(stats.totalProducts)} onClick={() => nav("products")} sub={stats.totalProducts === null ? null : `${stats.approvedProducts} approved`} />
        <Kpi label="Pending Product Approval" value={unknown(stats.pendingProducts)} tone="ov-tone-warn" onClick={() => nav("products")} />
        <Kpi label="Total Orders" value={unknown(stats.totalOrders)} onClick={() => nav("orders")} sub={stats.totalOrders === null ? null : `${stats.ordersInPeriod} in period`} />
        <Kpi label="Orders Today" value={unknown(stats.ordersToday)} onClick={() => nav("orders")} />
        <Kpi label="Pending Orders" value={unknown(stats.pendingOrders)} tone="ov-tone-warn" onClick={() => nav("orders")} />
        <Kpi label="Delivered Orders" value={unknown(stats.deliveredOrders)} tone="ov-tone-good" onClick={() => nav("orders")} />
        <Kpi label="Cancelled Orders" value={unknown(stats.cancelledOrders)} tone="ov-tone-bad" onClick={() => nav("orders")} />
        <Kpi label="Returns / Refunds" value={stats.totalOrders === null ? "—" : stats.returnedOrders + stats.refundedOrders} tone="ov-tone-bad" onClick={() => nav("orders")} />
        <Kpi label="Sales (selected period)" value={stats.totalOrders === null ? "—" : fmtINR(stats.salesInPeriod)} tone="ov-tone-orange" sub={stats.totalOrders === null ? null : `${fmtINR(stats.todaySales)} today`} />
        <Kpi label="Total Sales" value={stats.totalOrders === null ? "—" : fmtINR(stats.totalSales)} />
        <Kpi label="This Month's Sales" value={stats.totalOrders === null ? "—" : fmtINR(stats.monthSales)} />
        <Kpi label="JustBrand Family Members" value={unknown(stats.familyMembers)} onClick={() => nav("family")} sub={stats.familyMembers === null ? null : `${stats.activeFamily} active`} tone="ov-tone-family" />
      </div>

      {/* CHARTS */}
      <div className="ov-charts">
        <section className="ov-card ov-span2">
          <h3>Daily sales — last 30 days</h3>
          <LineChart points={stats.dailySeries} prefix="₹" />
        </section>
        <section className="ov-card">
          <h3>Buyer growth — last 30 days</h3>
          <LineChart points={stats.buyersSeries} color="#138808" />
        </section>
        <section className="ov-card">
          <h3>Top-selling products (by units)</h3>
          <Bars items={stats.topProducts} prefix="" />
        </section>
        <section className="ov-card">
          <h3>Top sellers (by revenue in period)</h3>
          <Bars items={stats.topSellers} prefix="₹" />
        </section>
        <section className="ov-card">
          <h3>Catalogue by category (product count)</h3>
          <Bars items={stats.catCounts} color="#ff7a00" prefix="" />
        </section>
        <section className="ov-card">
          <h3>Order status mix (all time)</h3>
          <div className="ov-status-grid">
            {[
              ["Pending", stats.pendingOrders],
              ["Processing", orders.filter((o) => o.status === "Processing").length],
              ["Shipped", orders.filter((o) => o.status === "Shipped").length],
              ["Delivered", stats.deliveredOrders],
              ["Cancelled", stats.cancelledOrders],
              ["Returned", stats.returnedOrders],
              ["Refunded", stats.refundedOrders],
            ].map(([label, n]) => (
              <div key={label} className="ov-status-item">
                <span>{label}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
        </section>
        {isFinance && (
          <section className="ov-card">
            <h3>Family commissions by status</h3>
            <div className="ov-status-grid">
              {["Pending", "Eligible", "Payable", "Paid", "Void"].map((s) => (
                <div key={s} className="ov-status-item">
                  <span>{s}</span>
                  <strong>{stats.commissionCounts[s] || 0}</strong>
                </div>
              ))}
            </div>
            <p className="ov-note">Commission figures come straight from the ledger — nothing is projected.</p>
          </section>
        )}
      </div>
    </div>
  );
}
