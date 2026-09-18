import { useEffect, useMemo, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

const PAGE_SIZE = 8;

function money(value) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

// Mask helpers — sensitive KYC values are NEVER shown in full.
function maskPan(value) {
  const v = String(value || "").trim();
  if (!v) return "—";
  return v.length <= 4 ? "XXXX" : `XXXX${v.slice(-4)}`;
}

function maskAadhaar(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "—";
  return `XXXX XXXX ${digits.slice(-4)}`;
}

function maskAccount(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "—";
  return `••••••${digits.slice(-4)}`;
}

const ORDER_STATUSES = [
  "Pending",
  "Processing",
  "Shipped",
  "Delivered",
  "Cancelled",
  "Returned",
  "Refunded",
];

function Business({
  token,
  staff,
  onMessage,
  customers = [],
  members = [],
  products = [],
  initialTab = "sellers",
}) {
  const [tab, setTab] = useState(initialTab);

  const [sellers, setSellers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [rules, setRules] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [payouts, setPayouts] = useState([]);

  const [loading, setLoading] = useState(false);

  // --- shared table controls ---
  const [sellerQuery, setSellerQuery] = useState("");
  const [sellerStatusFilter, setSellerStatusFilter] = useState("all");
  const [sellerPage, setSellerPage] = useState(1);

  const [orderQuery, setOrderQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderDateFilter, setOrderDateFilter] = useState("");
  const [orderPage, setOrderPage] = useState(1);

  const [memberQuery, setMemberQuery] = useState("");
  const [memberPage, setMemberPage] = useState(1);

  const [treeQuery, setTreeQuery] = useState("");
  const [treeRoot, setTreeRoot] = useState(null);

  // --- detail drawers ---
  const [sellerDetail, setSellerDetail] = useState(null); // {seller, kyc, bank}
  const [memberDetail, setMemberDetail] = useState(null); // {member, downline, commissions}
  const [detailLoading, setDetailLoading] = useState(false);

  const isSuper = staff?.role === "super_admin";
  const canModerate = isSuper || staff?.role === "manager";
  const isFinance = isSuper || staff?.role === "accountant";

  async function apiCall(path, options = {}) {
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

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || `Request failed (${response.status})`);
    }

    return data;
  }

  async function loadTab(which = tab) {
    setLoading(true);

    try {
      if (which === "sellers" || which === "kyc") {
        const data = await apiCall("/api/admin/sellers");
        setSellers(data.sellers || []);
      } else if (which === "orders") {
        const data = await apiCall("/api/admin/orders");
        setOrders(data.orders || []);
      } else if (which === "mlm") {
        const rulesData = await apiCall("/api/admin/mlm/settings");
        setRules(rulesData.rules || null);

        if (isFinance) {
          const commissionsData = await apiCall("/api/admin/mlm/commissions");
          setCommissions(commissionsData.commissions || []);

          const payoutsData = await apiCall("/api/admin/mlm/payouts");
          setPayouts(payoutsData.payouts || []);
        }
      }
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      loadTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, token]);

  // Follow the admin sidebar when it points at a different section.
  useEffect(() => {
    if (initialTab !== tab) {
      setTab(initialTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTab]);

  // ---------------- SELLER ACTIONS ----------------

  async function setSellerStatus(seller, status) {
    try {
      const data = await apiCall(`/api/admin/sellers/${seller.id}/status`, {
        method: "PUT",
        body: { status },
      });

      onMessage(`✅ ${data.message}`);
      loadTab("sellers");
      if (sellerDetail) openSellerDetail(seller.id);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function setSellerKyc(seller, kycStatus) {
    try {
      const data = await apiCall(`/api/admin/sellers/${seller.id}/kyc`, {
        method: "PUT",
        body: { kycStatus },
      });

      onMessage(`✅ ${data.message}`);
      loadTab("sellers");
      if (sellerDetail) openSellerDetail(seller.id);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  // ---------------- ORDER ACTIONS ----------------

  async function setOrderStatus(order, status) {
    try {
      const data = await apiCall(`/api/admin/orders/${order.id}/status`, {
        method: "PUT",
        body: { status },
      });

      onMessage(`✅ ${data.message}`);
      loadTab("orders");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function setOrderPayment(order, paymentStatus) {
    try {
      const data = await apiCall(`/api/admin/orders/${order.id}/payment`, {
        method: "PUT",
        body: { paymentStatus },
      });

      onMessage(`✅ Payment status updated.`);
      loadTab("orders");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  // ---------------- FAMILY ACTIONS ----------------

  async function setMemberStatus(member, status) {
    try {
      const data = await apiCall(
        `/api/admin/mlm/members/${member.memberId}/status`,
        {
          method: "PUT",
          body: { status },
        }
      );

      onMessage(`✅ ${data.message}`);
      loadTab("mlm");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function saveRules() {
    try {
      const data = await apiCall("/api/admin/mlm/settings", {
        method: "PUT",
        body: {
          directCommission: Number(rules.directCommission),
          levelCommission: Number(rules.levelCommission),
          binaryCommission: Number(rules.binaryCommission),
          shoppingCommission: Number(rules.shoppingCommission),
          returnPeriodDays: Number(rules.returnPeriodDays),
          directMemberLimit: Number(rules.directMemberLimit),
          commissionAfterReturn: !!rules.commissionAfterReturn,
        },
      });

      onMessage(`✅ ${data.message}`);
      loadTab("mlm");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function releaseCommissions() {
    try {
      const data = await apiCall("/api/admin/mlm/commissions/release", {
        method: "POST",
      });

      onMessage(`✅ ${data.message}`);
      loadTab("mlm");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function markPayoutPaid(payout) {
    try {
      const data = await apiCall(`/api/admin/mlm/payouts/${payout.id}`, {
        method: "PUT",
      });

      onMessage(`✅ ${data.message}`);
      loadTab("mlm");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function markCommissionPaid(commission) {
    try {
      const data = await apiCall(
        `/api/admin/mlm/commissions/${commission.id}/paid`,
        {
          method: "PUT",
        }
      );

      onMessage(`✅ ${data.message}`);
      loadTab("mlm");
      if (memberDetail) openMemberDetail(memberDetail.memberId);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  function updateRule(key, value) {
    setRules((prev) => ({ ...prev, [key]: value }));
  }

  // ---------------- DETAIL DRAWERS ----------------

  async function openSellerDetail(sellerId) {
    setDetailLoading(true);
    try {
      const data = await apiCall(`/api/admin/sellers/${sellerId}`);
      setSellerDetail({ seller: data.seller, kyc: data.kyc, bank: data.bank });
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setDetailLoading(false);
    }
  }

  async function openMemberDetail(memberId) {
    if (!isFinance) {
      setMemberDetail({ memberId });
      return;
    }

    setDetailLoading(true);
    try {
      // Refresh the finance-only commission ledger so the drawer shows
      // the latest confirmed rows (never stale, never projected).
      const data = await apiCall("/api/admin/mlm/commissions");
      setCommissions(data.commissions || []);
    } catch {
      /* fall back to whatever ledger rows are already loaded */
    } finally {
      setDetailLoading(false);
    }

    setMemberDetail({ memberId });
  }

  // ---------------- DERIVED TABLE DATA ----------------

  const productCountsBySeller = useMemo(() => {
    const map = new Map();
    products.forEach((p) => {
      const key = p.sellerId;
      if (!map.has(key)) map.set(key, { total: 0, approved: 0, pending: 0, rejected: 0 });
      const entry = map.get(key);
      entry.total += 1;
      if (p.status === "Approved") entry.approved += 1;
      if (p.status === "Pending") entry.pending += 1;
      if (p.status === "Rejected") entry.rejected += 1;
    });
    return map;
  }, [products]);

  const sellerRows = useMemo(() => {
    const q = sellerQuery.trim().toLowerCase();
    return sellers
      .filter((s) => {
        if (q && `${s.name || ""} ${s.shopName || ""} ${s.mobile || ""} ${s.email || ""} ${s.sellerCode || ""}`.toLowerCase().includes(q) === false) {
          return false;
        }
        if (tab === "kyc") {
          if (sellerStatusFilter !== "all" && (s.kycStatus || "Pending") !== sellerStatusFilter) return false;
        } else if (sellerStatusFilter !== "all" && (s.status || "active") !== sellerStatusFilter) {
          return false;
        }
        return true;
      })
      .map((s) => ({
        ...s,
        counts: productCountsBySeller.get(s.sellerCode) || { total: 0, approved: 0, pending: 0, rejected: 0 },
      }));
  }, [sellers, sellerQuery, sellerStatusFilter, tab, productCountsBySeller]);

  const sellerPageCount = Math.max(1, Math.ceil(sellerRows.length / PAGE_SIZE));
  const sellerSafePage = Math.min(sellerPage, sellerPageCount);
  const sellerPageRows = sellerRows.slice((sellerSafePage - 1) * PAGE_SIZE, sellerSafePage * PAGE_SIZE);

  const orderRows = useMemo(() => {
    const q = orderQuery.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (q && `${o.orderNumber || ""} ${o.customerName || ""} ${o.phone || ""}`.toLowerCase().includes(q) === false) {
          return false;
        }
        if (orderStatusFilter !== "all" && o.status !== orderStatusFilter) return false;
        if (orderDateFilter && !String(o.createdAt || "").startsWith(orderDateFilter)) return false;
        return true;
      })
      .map((o) => ({
        ...o,
        itemsText: (o.items || [])
          .map((it) => `${it.productName || `#${it.productId}`} ×${it.quantity}`)
          .join(", "),
        sellersText: [...new Set((o.items || []).map((it) => it.sellerName || it.sellerId || "—"))].join(", "),
      }));
  }, [orders, orderQuery, orderStatusFilter, orderDateFilter]);

  const orderPageCount = Math.max(1, Math.ceil(orderRows.length / PAGE_SIZE));
  const orderSafePage = Math.min(orderPage, orderPageCount);
  const orderPageRows = orderRows.slice((orderSafePage - 1) * PAGE_SIZE, orderSafePage * PAGE_SIZE);

  const memberRows = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    return members.filter((m) => {
      if (q && `${m.name || ""} ${m.memberId || ""} ${m.mobile || ""} ${m.referralCode || ""}`.toLowerCase().includes(q) === false) {
        return false;
      }
      return true;
    });
  }, [members, memberQuery]);

  const memberPageCount = Math.max(1, Math.ceil(memberRows.length / PAGE_SIZE));
  const memberSafePage = Math.min(memberPage, memberPageCount);
  const memberPageRows = memberRows.slice((memberSafePage - 1) * PAGE_SIZE, memberSafePage * PAGE_SIZE);

  // ---------------- FAMILY TREE ----------------

  const childrenByParent = useMemo(() => {
    const map = new Map();
    members.forEach((m) => {
      const key = m.parentId || "__root__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    });
    return map;
  }, [members]);

  const memberById = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(String(m.memberId), m));
    return map;
  }, [members]);

  const treeSearchResult = useMemo(() => {
    const q = treeQuery.trim().toLowerCase();
    if (!q) return null;
    return members.find(
      (m) =>
        String(m.memberId || "").toLowerCase() === q ||
        String(m.referralCode || "").toLowerCase() === q ||
        String(m.name || "").toLowerCase().includes(q) ||
        String(m.mobile || "").includes(q)
    ) || null;
  }, [treeQuery, members]);

  const activeTreeRoot = treeSearchResult || treeRoot;

  // ---------------- RENDER ----------------

  const tabs = [
    { key: "sellers", label: "🏪 Sellers" },
    { key: "orders", label: "📦 Orders" },
    { key: "mlm", label: "👨‍👩‍👧 JustBrand Family" },
    { key: "kyc", label: "🪪 KYC" },
    { key: "tree", label: "🌳 Family Tree" },
  ];

  return (
    <section className="products-section">
      <div className="section-title">
        <div>
          <h2>🏪 Sellers · 📦 Orders · 👨‍👩‍👧 JustBrand Family</h2>
          <p>Business management — live backend data</p>
        </div>

        <button className="refresh-btn" onClick={() => loadTab()}>
          🔄 Refresh
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "20px",
          flexWrap: "wrap",
        }}
      >
        {tabs.map((item) => (
          <button
            key={item.key}
            onClick={() => {
              setTab(item.key);
              setSellerPage(1);
              setOrderPage(1);
              setMemberPage(1);
            }}
            style={{
              padding: "9px 18px",
              borderRadius: "20px",
              border: "1px solid #eee",
              cursor: "pointer",
              fontWeight: "600",
              background: tab === item.key ? "#ff7a00" : "#fff",
              color: tab === item.key ? "#fff" : "#444",
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && <div className="empty">Loading...</div>}

      {/* ============ SELLERS ============ */}

      {(tab === "sellers" || tab === "kyc") && !loading && (
        <>
          <div className="sec-toolbar">
            <input
              className="sec-search"
              placeholder="Search sellers by name, shop, mobile, email or code…"
              value={sellerQuery}
              onChange={(e) => {
                setSellerQuery(e.target.value);
                setSellerPage(1);
              }}
            />
            <select
              className="sec-date"
              value={sellerStatusFilter}
              onChange={(e) => {
                setSellerStatusFilter(e.target.value);
                setSellerPage(1);
              }}
            >
              {tab === "kyc" ? (
                <>
                  <option value="all">All KYC statuses</option>
                  <option value="Pending">KYC Pending</option>
                  <option value="Approved">KYC Approved</option>
                  <option value="Rejected">KYC Rejected</option>
                </>
              ) : (
                <>
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </>
              )}
            </select>
            <span className="sec-count">{sellerRows.length} seller(s)</span>
          </div>

          <div className="sec-tablewrap">
            {sellerRows.length === 0 ? (
              <div className="empty">No sellers match this view.</div>
            ) : (
              <table className="sec-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Seller</th>
                    <th>Shop / Business</th>
                    <th>Contact</th>
                    <th>Registered</th>
                    <th>Status</th>
                    {tab !== "kyc" && <th>Products (A/P/R)</th>}
                    <th>KYC</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sellerPageRows.map((seller) => (
                    <tr key={seller.id}>
                      <td><small>{seller.sellerCode || `#${seller.id}`}</small></td>
                      <td>
                        <strong>{seller.name || "-"}</strong>
                      </td>
                      <td>{seller.shopName || seller.businessName || "-"}</td>
                      <td>
                        {seller.mobile || "-"}
                        <br />
                        <small>{seller.email || ""}</small>
                      </td>
                      <td><small>{String(seller.createdAt || "").slice(0, 10)}</small></td>
                      <td>
                        <span className={`sec-tag ${seller.status === "active" ? "sec-tag-good" : "sec-tag-bad"}`}>
                          {seller.status}
                        </span>
                      </td>
                      {tab !== "kyc" && (
                        <td>
                          <small>
                            {seller.counts.approved}/{seller.counts.pending}/{seller.counts.rejected}
                          </small>
                        </td>
                      )}
                      <td>
                        <StatusPill value={seller.kycStatus} good="Approved" bad="Rejected" />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="refresh-btn"
                            onClick={() => openSellerDetail(seller.id)}
                          >
                            View
                          </button>
                          {isSuper && (
                            <button
                              className="refresh-btn"
                              onClick={() =>
                                setSellerStatus(
                                  seller,
                                  seller.status === "active" ? "suspended" : "active"
                                )
                              }
                            >
                              {seller.status === "active" ? "Suspend" : "Activate"}
                            </button>
                          )}
                          {canModerate && seller.kycStatus !== "Approved" && (
                            <button className="refresh-btn" onClick={() => setSellerKyc(seller, "Approved")}>
                              KYC ✓
                            </button>
                          )}
                          {canModerate && seller.kycStatus !== "Rejected" && (
                            <button className="refresh-btn" onClick={() => setSellerKyc(seller, "Rejected")}>
                              KYC ✗
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {sellerPageCount > 1 && (
            <div className="sec-pager">
              <button type="button" disabled={sellerSafePage <= 1} onClick={() => setSellerPage(sellerSafePage - 1)}>‹ Prev</button>
              <span>Page {sellerSafePage} of {sellerPageCount}</span>
              <button type="button" disabled={sellerSafePage >= sellerPageCount} onClick={() => setSellerPage(sellerSafePage + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}

      {/* ============ ORDERS ============ */}

      {tab === "orders" && !loading && (
        <>
          <div className="sec-toolbar">
            <input
              className="sec-search"
              placeholder="Search by order #, customer or phone…"
              value={orderQuery}
              onChange={(e) => {
                setOrderQuery(e.target.value);
                setOrderPage(1);
              }}
            />
            <select
              className="sec-date"
              value={orderStatusFilter}
              onChange={(e) => {
                setOrderStatusFilter(e.target.value);
                setOrderPage(1);
              }}
            >
              <option value="all">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <input
              type="date"
              className="sec-date"
              value={orderDateFilter}
              onChange={(e) => {
                setOrderDateFilter(e.target.value);
                setOrderPage(1);
              }}
            />
            <span className="sec-count">{orderRows.length} order(s)</span>
          </div>

          <div className="sec-tablewrap">
            {orderRows.length === 0 ? (
              <div className="empty">No orders match this view.</div>
            ) : (
              <table className="sec-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Customer</th>
                    <th>Items / Sellers</th>
                    <th>Amount</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Update</th>
                  </tr>
                </thead>
                <tbody>
                  {orderPageRows.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>#{order.orderNumber}</strong>
                        <br />
                        <small>
                          {String(order.createdAt || "").slice(0, 19).replace("T", " ")}
                        </small>
                      </td>
                      <td>
                        {order.customerName}
                        <br />
                        <small>{order.phone}</small>
                      </td>
                      <td>
                        <small>{order.itemsText || "—"}</small>
                        <br />
                        <small className="ov-note">Sellers: {order.sellersText || "—"}</small>
                      </td>
                      <td>₹{money(order.totalAmount).toLocaleString("en-IN")}</td>
                      <td>
                        {order.paymentMethod}
                        <br />
                        <small>{order.paymentStatus}</small>
                      </td>
                      <td>
                        <StatusPill
                          value={order.status}
                          good="Delivered"
                          bad="Cancelled"
                        />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          {canModerate && (
                            <select
                              value={order.status}
                              onChange={(e) => setOrderStatus(order, e.target.value)}
                              style={{ padding: "6px", borderRadius: "6px" }}
                            >
                              {ORDER_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                          {isFinance && (
                            <select
                              value={order.paymentStatus}
                              onChange={(e) => setOrderPayment(order, e.target.value)}
                              style={{ padding: "6px", borderRadius: "6px" }}
                            >
                              {["Pending", "Paid", "Refunded"].map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {orderPageCount > 1 && (
            <div className="sec-pager">
              <button type="button" disabled={orderSafePage <= 1} onClick={() => setOrderPage(orderSafePage - 1)}>‹ Prev</button>
              <span>Page {orderSafePage} of {orderPageCount}</span>
              <button type="button" disabled={orderSafePage >= orderPageCount} onClick={() => setOrderPage(orderSafePage + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}

      {/* ============ JUSTBRAND FAMILY ============ */}

      {tab === "mlm" && !loading && (
        <>
          {/* RULES EDITOR */}
          <div
            style={{
              padding: "20px",
              border: "1px solid #eee",
              borderRadius: "14px",
              marginBottom: "20px",
            }}
          >
            <h3 style={{ marginTop: 0 }}>⚙️ Commission Rules (admin-configurable)</h3>

            {rules ? (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "12px",
                    marginBottom: "12px",
                  }}
                >
                  {[
                    { key: "directCommission", label: "Direct %" },
                    { key: "levelCommission", label: "Level %" },
                    { key: "binaryCommission", label: "Binary %" },
                    { key: "shoppingCommission", label: "Shopping %" },
                    { key: "returnPeriodDays", label: "Return Window (days)" },
                    { key: "directMemberLimit", label: "Max Direct Members" },
                  ].map((field) => (
                    <label key={field.key} style={{ fontSize: "13px" }}>
                      {field.label}
                      <input
                        type="number"
                        min="0"
                        value={rules[field.key] ?? 0}
                        disabled={!isSuper}
                        onChange={(e) => updateRule(field.key, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "8px",
                          marginTop: "4px",
                          borderRadius: "7px",
                          border: "1px solid #ddd",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  ))}
                </div>

                {isSuper && (
                  <button className="approve" onClick={saveRules}>
                    ✓ Save Rules
                  </button>
                )}
              </>
            ) : (
              <div className="empty">Rules loading…</div>
            )}
          </div>

          {/* MEMBERS */}
          <div className="sec-toolbar">
            <h3 style={{ margin: 0 }}>👨‍👩‍👧 Family Members ({members.length})</h3>
            <input
              className="sec-search"
              placeholder="Search by name, member ID, mobile or referral code…"
              value={memberQuery}
              onChange={(e) => {
                setMemberQuery(e.target.value);
                setMemberPage(1);
              }}
            />
            <span className="sec-count">{memberRows.length} member(s)</span>
          </div>

          <div className="sec-tablewrap" style={{ marginBottom: "20px" }}>
            {memberRows.length === 0 ? (
              <div className="empty">No JustBrand Family members yet.</div>
            ) : (
              <table className="sec-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Member ID</th>
                    <th>Referral Code</th>
                    <th>Referrer</th>
                    <th>Position</th>
                    <th>Joined</th>
                    <th>Directs</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {memberPageRows.map((member) => (
                    <tr key={member.memberId}>
                      <td>
                        <strong>{member.name}</strong>
                        <br />
                        <small>{member.mobile}</small>
                      </td>
                      <td><small>{member.memberId}</small></td>
                      <td><small>{member.referralCode || "—"}</small></td>
                      <td>
                        <small>
                          {member.parentId
                            ? `${memberById.get(String(member.parentId))?.name || member.parentName || member.parentId}`
                            : "— (root)"}
                        </small>
                      </td>
                      <td>{member.position || "—"}</td>
                      <td><small>{String(member.createdAt || "").slice(0, 10)}</small></td>
                      <td>
                        {(childrenByParent.get(String(member.memberId)) || []).length}
                      </td>
                      <td>
                        <StatusPill value={member.status} good="active" bad="blocked" />
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button type="button" className="refresh-btn" onClick={() => openMemberDetail(member.memberId)}>
                            View
                          </button>
                          {isSuper && (
                            <button
                              className="refresh-btn"
                              onClick={() =>
                                setMemberStatus(
                                  member,
                                  member.status === "active" ? "blocked" : "active"
                                )
                              }
                            >
                              {member.status === "active" ? "Block" : "Activate"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {memberPageCount > 1 && (
            <div className="sec-pager">
              <button type="button" disabled={memberSafePage <= 1} onClick={() => setMemberPage(memberSafePage - 1)}>‹ Prev</button>
              <span>Page {memberSafePage} of {memberPageCount}</span>
              <button type="button" disabled={memberSafePage >= memberPageCount} onClick={() => setMemberPage(memberSafePage + 1)}>Next ›</button>
            </div>
          )}

          {/* FINANCIALS (restricted) */}
          {isFinance ? (
            <>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <h3>💰 Commissions ({commissions.length})</h3>
                <button className="refresh-btn" onClick={releaseCommissions}>
                  🔄 Release Due Commissions
                </button>
              </div>

              <div className="sec-tablewrap" style={{ marginBottom: "20px" }}>
                {commissions.length === 0 ? (
                  <div className="empty">No commission records.</div>
                ) : (
                  <table className="sec-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Order Ref</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Eligible From</th>
                        <th>Paid At</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.slice(0, 100).map((commission) => (
                        <tr key={commission.id}>
                          <td>
                            {memberById.get(String(commission.memberId))?.name || commission.memberId}
                            <br />
                            <small>{commission.memberId}</small>
                          </td>
                          <td>{commission.type}</td>
                          <td><small>{commission.orderId ? `#${commission.orderId}` : "—"}</small></td>
                          <td>₹{Number(commission.amount || 0).toLocaleString("en-IN")}</td>
                          <td>
                            <StatusPill value={commission.status} good="Paid" />
                          </td>
                          <td><small>{String(commission.createdAt || "").slice(0, 10)}</small></td>
                          <td><small>{commission.payableAt ? String(commission.payableAt).slice(0, 10) : "—"}</small></td>
                          <td><small>{commission.paidAt ? String(commission.paidAt).slice(0, 10) : "—"}</small></td>
                          <td>
                            {commission.status === "Payable" && (
                              <button className="refresh-btn" onClick={() => markCommissionPaid(commission)}>
                                Mark Paid
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <h3>🏧 Payout Requests ({payouts.length})</h3>

              <div className="sec-tablewrap">
                {payouts.length === 0 ? (
                  <div className="empty">No payout requests.</div>
                ) : (
                  <table className="sec-table">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Requested</th>
                        <th>Processed</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td>
                            {memberById.get(String(payout.memberId))?.name || payout.memberId}
                            <br />
                            <small>{payout.memberId}</small>
                          </td>
                          <td>₹{Number(payout.amount || 0).toLocaleString("en-IN")}</td>
                          <td>{payout.method}</td>
                          <td>
                            <StatusPill value={payout.status} good="Paid" />
                          </td>
                          <td><small>{String(payout.createdAt || "").slice(0, 10)}</small></td>
                          <td><small>{payout.processedAt ? String(payout.processedAt).slice(0, 10) : "—"}</small></td>
                          <td>
                            {payout.status === "Processing" && (
                              <button className="refresh-btn" onClick={() => markPayoutPaid(payout)}>
                                Mark Paid
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          ) : (
            <div className="empty">
              🔒 Commission and payout records are restricted to Super Admin /
              Accountant roles.
            </div>
          )}
        </>
      )}

      {/* ============ FAMILY TREE ============ */}

      {tab === "tree" && (
        <>
          <div className="sec-toolbar">
            <input
              className="sec-search"
              placeholder="Search a member to focus their subtree (name, member ID, referral code, mobile)…"
              value={treeQuery}
              onChange={(e) => setTreeQuery(e.target.value)}
            />
            {treeSearchResult && (
              <button type="button" className="refresh-btn" onClick={() => setTreeQuery("")}>
                ✕ Clear focus
              </button>
            )}
          </div>

          {members.length === 0 ? (
            <div className="empty">No Family members to display yet.</div>
          ) : treeQuery && !treeSearchResult ? (
            <div className="empty">No member matches “{treeQuery}”.</div>
          ) : (
            <div className="tree-wrap">
              {(activeTreeRoot
                ? [activeTreeRoot]
                : childrenByParent.get("__root__") || members.slice(0, 1)
              ).map((root) => (
                <FamilyTreeNode
                  key={root.memberId}
                  member={root}
                  depth={0}
                  childrenByParent={childrenByParent}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ============ SELLER DETAIL DRAWER (KYC masked) ============ */}

      {sellerDetail && (
        <div className="drawer-backdrop" onClick={() => setSellerDetail(null)}>
          <div className="drawer drawer-lg" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h3>{sellerDetail.seller?.name}</h3>
                <small>
                  {sellerDetail.seller?.sellerCode} · joined{" "}
                  {String(sellerDetail.seller?.createdAt || "").slice(0, 10)}
                </small>
              </div>
              <button type="button" className="refresh-btn" onClick={() => setSellerDetail(null)}>
                ✕
              </button>
            </div>

            {detailLoading ? (
              <div className="empty">Loading seller details…</div>
            ) : (
              <div className="drawer-grid">
                <div className="drawer-card">
                  <h4>Profile</h4>
                  <p><b>Shop:</b> {sellerDetail.seller?.shopName || "—"}</p>
                  <p><b>Mobile:</b> {sellerDetail.seller?.mobile || "—"}</p>
                  <p><b>Email:</b> {sellerDetail.seller?.email || "—"}</p>
                  <p><b>Status:</b> {sellerDetail.seller?.status}</p>
                  <p><b>Last login:</b> {sellerDetail.seller?.lastLoginAt ? String(sellerDetail.seller.lastLoginAt).slice(0, 19).replace("T", " ") : "—"}</p>
                </div>

                <div className="drawer-card">
                  <h4>KYC (masked)</h4>
                  <p><b>KYC status:</b> {sellerDetail.kyc?.kycStatus || "Pending"}</p>
                  <p><b>PAN:</b> {maskPan(sellerDetail.kyc?.panNumber)}</p>
                  <p><b>Aadhaar:</b> {maskAadhaar(sellerDetail.kyc?.aadhaarNumber)}</p>
                  <p><b>GST:</b> {sellerDetail.kyc?.gstNumber || "—"}</p>
                  <p>
                    <b>Address:</b>{" "}
                    {[sellerDetail.kyc?.address, sellerDetail.kyc?.city, sellerDetail.kyc?.state, sellerDetail.kyc?.pincode]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                  {sellerDetail.kyc?.rejectionReason && (
                    <p><b>Rejection reason:</b> {sellerDetail.kyc.rejectionReason}</p>
                  )}
                  <p className="ov-note">Full PAN/Aadhaar are never displayed in the admin UI.</p>
                </div>

                <div className="drawer-card">
                  <h4>Payout bank (masked)</h4>
                  <p><b>Account name:</b> {sellerDetail.bank?.accountName || "—"}</p>
                  <p><b>Account no.:</b> {maskAccount(sellerDetail.bank?.accountNumber)}</p>
                  <p><b>IFSC:</b> {sellerDetail.bank?.ifscCode || "—"}</p>
                  <p><b>Bank:</b> {sellerDetail.bank?.bankName || "—"}</p>
                  <p><b>UPI:</b> {sellerDetail.bank?.upiId || "—"}</p>
                </div>

                <div className="drawer-card">
                  <h4>Catalogue</h4>
                  {(() => {
                    const own = products.filter((p) => p.sellerId === sellerDetail.seller?.sellerCode);
                    if (own.length === 0) return <p className="ov-note">No products yet.</p>;
                    return (
                      <div className="sec-tablewrap">
                        <table className="sec-table">
                          <thead>
                            <tr><th>Product</th><th>Price</th><th>Status</th></tr>
                          </thead>
                          <tbody>
                            {own.slice(0, 20).map((p) => (
                              <tr key={p.id}>
                                <td><small>{p.name}</small></td>
                                <td>₹{p.price}</td>
                                <td>
                                  <span className={`sec-tag ${p.status === "Approved" ? "sec-tag-good" : p.status === "Rejected" ? "sec-tag-bad" : "sec-tag-warn"}`}>
                                    {p.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ FAMILY MEMBER DETAIL DRAWER ============ */}

      {memberDetail && (() => {
        const member = memberById.get(String(memberDetail.memberId));
        if (!member) return null;
        const downline = childrenByParent.get(String(member.memberId)) || [];
        const myCommissions = commissions.filter((c) => String(c.memberId) === String(member.memberId));
        const walletRow = myCommissions.reduce(
          (acc, c) => {
            if (c.status === "Paid") acc.paid += Number(c.amount || 0);
            else if (c.status === "Void") acc.void += Number(c.amount || 0);
            else acc.pending += Number(c.amount || 0);
            return acc;
          },
          { pending: 0, paid: 0, void: 0 }
        );

        return (
          <div className="drawer-backdrop" onClick={() => setMemberDetail(null)}>
            <div className="drawer drawer-lg" onClick={(e) => e.stopPropagation()}>
              <div className="drawer-head">
                <div>
                  <h3>{member.name}</h3>
                  <small>
                    {member.memberId} · joined {String(member.createdAt || "").slice(0, 10)}
                  </small>
                </div>
                <button type="button" className="refresh-btn" onClick={() => setMemberDetail(null)}>✕</button>
              </div>

              <div className="drawer-grid">
                <div className="drawer-card">
                  <h4>Profile</h4>
                  <p><b>Mobile:</b> {member.mobile}</p>
                  <p><b>Email:</b> {member.email || "—"}</p>
                  <p><b>Referral code:</b> {member.referralCode || "—"}</p>
                  <p><b>Status:</b> {member.status}</p>
                </div>

                <div className="drawer-card">
                  <h4>Placement</h4>
                  <p>
                    <b>Referrer:</b>{" "}
                    {member.parentId
                      ? `${memberById.get(String(member.parentId))?.name || member.parentName || member.parentId} (${member.parentId})`
                      : "— (root member)"}
                  </p>
                  <p><b>Position:</b> {member.position || "—"}</p>
                  <p><b>Direct members:</b> {downline.length}</p>
                </div>

                {isFinance && (
                  <div className="drawer-card">
                    <h4>Commission summary (ledger)</h4>
                    <p><b>Pending / Eligible:</b> ₹{walletRow.pending.toLocaleString("en-IN")}</p>
                    <p><b>Paid:</b> ₹{walletRow.paid.toLocaleString("en-IN")}</p>
                    <p><b>Void:</b> ₹{walletRow.void.toLocaleString("en-IN")}</p>
                    <p className="ov-note">Only backend-confirmed ledger rows are counted — no projections.</p>
                  </div>
                )}

                <div className="drawer-card">
                  <h4>Direct downline ({downline.length})</h4>
                  {downline.length === 0 ? (
                    <p className="ov-note">No direct members yet.</p>
                  ) : (
                    <div className="sec-tablewrap">
                      <table className="sec-table">
                        <thead>
                          <tr><th>Member</th><th>ID</th><th>Position</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                          {downline.map((d) => (
                            <tr key={d.memberId}>
                              <td><small>{d.name}</small></td>
                              <td><small>{d.memberId}</small></td>
                              <td>{d.position || "—"}</td>
                              <td>
                                <span className={`sec-tag ${d.status === "active" ? "sec-tag-good" : "sec-tag-bad"}`}>
                                  {d.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {isFinance && (
                  <div className="drawer-card drawer-wide">
                    <h4>Commission history ({myCommissions.length})</h4>
                    {myCommissions.length === 0 ? (
                      <p className="ov-note">No commission records.</p>
                    ) : (
                      <div className="sec-tablewrap">
                        <table className="sec-table">
                          <thead>
                            <tr><th>Type</th><th>Order</th><th>Amount</th><th>Status</th><th>Created</th><th>Eligible</th><th>Paid</th></tr>
                          </thead>
                          <tbody>
                            {myCommissions.slice(0, 20).map((c) => (
                              <tr key={c.id}>
                                <td>{c.type}</td>
                                <td><small>{c.orderId ? `#${c.orderId}` : "—"}</small></td>
                                <td>₹{Number(c.amount || 0).toLocaleString("en-IN")}</td>
                                <td><StatusPill value={c.status} good="Paid" /></td>
                                <td><small>{String(c.createdAt || "").slice(0, 10)}</small></td>
                                <td><small>{c.payableAt ? String(c.payableAt).slice(0, 10) : "—"}</small></td>
                                <td><small>{c.paidAt ? String(c.paidAt).slice(0, 10) : "—"}</small></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </section>
  );
}

// Defined outside Business so expanding/collapsing survives parent
// re-renders (a component defined inline would remount every render).
function FamilyTreeNode({ member, depth, childrenByParent }) {
  const [open, setOpen] = useState(depth < 1);
  const children = childrenByParent.get(String(member.memberId)) || [];

  return (
    <div className={`tree-node ${depth === 0 ? "tree-root" : ""}`}>
      <div className="tree-card">
        <button
          type="button"
          className="tree-open"
          onClick={() => setOpen(!open)}
          disabled={children.length === 0}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {children.length === 0 ? "•" : open ? "−" : "+"}
        </button>
        <div className="tree-info">
          <strong>{member.name}</strong>
          <small>
            {member.memberId} · pos {member.position || "—"} · {children.length} direct
          </small>
        </div>
        <span className={`sec-tag ${member.status === "active" ? "sec-tag-good" : "sec-tag-bad"}`}>
          {member.status}
        </span>
      </div>
      {open && children.length > 0 && (
        <div className="tree-children">
          {children.map((child) => (
            <FamilyTreeNode
              key={child.memberId}
              member={child}
              depth={depth + 1}
              childrenByParent={childrenByParent}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ value, good, bad }) {
  const style = {
    padding: "4px 10px",
    borderRadius: "14px",
    fontSize: "12px",
    fontWeight: "600",
    display: "inline-block",
  };

  if (value === good) {
    return (
      <span style={{ ...style, background: "#e6f7e6", color: "#1a7a1a" }}>
        {value}
      </span>
    );
  }

  if (bad && value === bad) {
    return (
      <span style={{ ...style, background: "#fff0f0", color: "#c00" }}>
        {value}
      </span>
    );
  }

  return (
    <span style={{ ...style, background: "#fff7e6", color: "#a06a00" }}>
      {value || "-"}
    </span>
  );
}

export default Business;
