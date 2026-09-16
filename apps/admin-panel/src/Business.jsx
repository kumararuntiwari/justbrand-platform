import { useEffect, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

// =====================================================
// BUSINESS MANAGEMENT (Sellers / Orders / MLM)
// =====================================================
// Additive admin section: everything here talks to the
// authenticated /api/admin/* endpoints. Role gating is
// enforced server-side; UI checks are convenience only.

function Business({ token, staff, onMessage }) {
  const [tab, setTab] = useState("sellers");

  const [sellers, setSellers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [members, setMembers] = useState([]);
  const [rules, setRules] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [payouts, setPayouts] = useState([]);

  const [loading, setLoading] = useState(false);

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
      if (which === "sellers") {
        const data = await apiCall("/api/admin/sellers");
        setSellers(data.sellers || []);
      } else if (which === "orders") {
        const data = await apiCall("/api/admin/orders");
        setOrders(data.orders || []);
      } else if (which === "mlm") {
        const membersData = await apiCall("/api/admin/mlm/members");
        setMembers(membersData.members || []);

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

  // ---------------- SELLER ACTIONS ----------------

  async function setSellerStatus(seller, status) {
    try {
      const data = await apiCall(`/api/admin/sellers/${seller.id}/status`, {
        method: "PUT",
        body: { status },
      });

      onMessage(`✅ ${data.message}`);
      loadTab("sellers");
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

  // ---------------- MLM ACTIONS ----------------

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
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  function updateRule(key, value) {
    setRules((prev) => ({ ...prev, [key]: value }));
  }

  // ---------------- RENDER ----------------

  return (
    <section className="products-section">
      <div className="section-title">
        <div>
          <h2>🏪 Sellers · 📦 Orders · 👥 MLM Family</h2>
          <p>Business management (new backend-connected sections)</p>
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
        {[
          { key: "sellers", label: "🏪 Sellers" },
          { key: "orders", label: "📦 Orders" },
          { key: "mlm", label: "👥 MLM Family" },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
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

      {tab === "sellers" && !loading && (
        <div style={{ overflowX: "auto" }}>
          {sellers.length === 0 ? (
            <div className="empty">No sellers registered yet.</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Seller</th>
                  <th>Contact</th>
                  <th>Business</th>
                  <th>Status</th>
                  <th>KYC</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <tr key={seller.id}>
                    <td>
                      <strong>{seller.name || seller.businessName || "-"}</strong>
                    </td>
                    <td>
                      {seller.mobile || "-"}
                      <br />
                      <small>{seller.email || ""}</small>
                    </td>
                    <td>{seller.businessName || seller.businessType || "-"}</td>
                    <td>
                      <StatusPill
                        value={seller.status}
                        good="active"
                        bad="suspended"
                      />
                    </td>
                    <td>
                      <StatusPill value={seller.kycStatus} good="Approved" bad="Rejected" />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
                          <button
                            className="refresh-btn"
                            onClick={() => setSellerKyc(seller, "Approved")}
                          >
                            KYC ✓
                          </button>
                        )}

                        {canModerate && seller.kycStatus !== "Rejected" && (
                          <button
                            className="refresh-btn"
                            onClick={() => setSellerKyc(seller, "Rejected")}
                          >
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
      )}

      {/* ============ ORDERS ============ */}

      {tab === "orders" && !loading && (
        <div style={{ overflowX: "auto" }}>
          {orders.length === 0 ? (
            <div className="empty">No orders yet.</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Update</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
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
                    <td>₹{order.totalAmount}</td>
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
                      {canModerate && (
                        <select
                          value={order.status}
                          onChange={(e) => setOrderStatus(order, e.target.value)}
                          style={{ padding: "6px", borderRadius: "6px" }}
                        >
                          {[
                            "Pending",
                            "Processing",
                            "Shipped",
                            "Delivered",
                            "Cancelled",
                            "Returned",
                            "Refunded",
                          ].map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ============ MLM ============ */}

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
                          border: "1px solid #ddd",
                          borderRadius: "8px",
                          boxSizing: "border-box",
                        }}
                      />
                    </label>
                  ))}
                </div>

                <label style={{ fontSize: "13px", display: "block", marginBottom: "12px" }}>
                  <input
                    type="checkbox"
                    checked={!!rules.commissionAfterReturn}
                    disabled={!isSuper}
                    onChange={(e) => updateRule("commissionAfterReturn", e.target.checked)}
                  />{" "}
                  Release commission only after return window completes
                </label>

                {isSuper ? (
                  <button className="refresh-btn" onClick={saveRules}>
                    💾 Save Rules
                  </button>
                ) : (
                  <small style={{ color: "#888" }}>
                    Only Super Admin can edit rules.
                  </small>
                )}
              </>
            ) : (
              <div className="empty">Rules unavailable.</div>
            )}
          </div>

          {/* MEMBERS */}
          <h3>👥 Members ({members.length})</h3>

          <div style={{ overflowX: "auto", marginBottom: "20px" }}>
            {members.length === 0 ? (
              <div className="empty">No MLM members yet.</div>
            ) : (
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Member ID</th>
                    <th>Referral</th>
                    <th>Directs</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.memberId}>
                      <td>
                        <strong>{member.name}</strong>
                      </td>
                      <td>{member.memberId}</td>
                      <td>{member.referralCode}</td>
                      <td>{member.directCount ?? 0}</td>
                      <td>
                        <StatusPill value={member.status} good="active" bad="blocked" />
                      </td>
                      <td>
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

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

              <div style={{ overflowX: "auto", marginBottom: "20px" }}>
                {commissions.length === 0 ? (
                  <div className="empty">No commission records.</div>
                ) : (
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.slice(0, 50).map((commission) => (
                        <tr key={commission.id}>
                          <td>{commission.memberId}</td>
                          <td>{commission.type}</td>
                          <td>₹{commission.amount}</td>
                          <td>
                            <StatusPill value={commission.status} good="Paid" />
                          </td>
                          <td>
                            {commission.status === "Payable" && (
                              <button
                                className="refresh-btn"
                                onClick={() => markCommissionPaid(commission)}
                              >
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

              <div style={{ overflowX: "auto" }}>
                {payouts.length === 0 ? (
                  <div className="empty">No payout requests.</div>
                ) : (
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.map((payout) => (
                        <tr key={payout.id}>
                          <td>{payout.memberId}</td>
                          <td>₹{payout.amount}</td>
                          <td>{payout.method}</td>
                          <td>
                            <StatusPill value={payout.status} good="Paid" />
                          </td>
                          <td>
                            {payout.status === "Processing" && (
                              <button
                                className="refresh-btn"
                                onClick={() => markPayoutPaid(payout)}
                              >
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
    </section>
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

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
  background: "#fff",
};

export default Business;
