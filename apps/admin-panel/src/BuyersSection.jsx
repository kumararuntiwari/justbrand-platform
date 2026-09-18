import { useMemo, useState } from "react";

const PAGE_SIZE = 10;

function money(value) {
  const num = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(num) ? num : 0;
}

export default function BuyersSection({ customers, orders, members }) {
  const [query, setQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  // Per-customer order aggregates are joined client-side from the real
  // admin orders feed — nothing is estimated.
  const ordersByCustomer = useMemo(() => {
    const map = new Map();
    orders.forEach((o) => {
      const key = o.customerId;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(o);
    });
    return map;
  }, [orders]);

  const memberByReferral = useMemo(() => {
    const map = new Map();
    members.forEach((m) => map.set(String(m.memberId), m));
    return map;
  }, [members]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customers
      .filter((c) => {
        if (q) {
          const haystack = `${c.name || ""} ${c.mobile || ""} ${c.email || ""} #${c.id} ${
            c.referredByMemberId || ""
          }`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        if (dateFilter && !String(c.createdAt || "").startsWith(dateFilter)) return false;
        return true;
      })
      .map((c) => {
        const cOrders = (ordersByCustomer.get(c.id) || []).slice().sort((a, b) => b.id - a.id);
        const valid = cOrders.filter((o) => !["Cancelled", "Returned", "Refunded"].includes(o.status));
        return {
          ...c,
          orderCount: cOrders.length,
          totalSpend: valid.reduce((acc, o) => acc + money(o.totalAmount), 0),
          lastOrderAt: cOrders[0]?.createdAt || null,
          familyMember: c.referredByMemberId ? memberByReferral.get(String(c.referredByMemberId)) || null : null,
          orders: cOrders,
        };
      });
  }, [customers, query, dateFilter, ordersByCustomer, memberByReferral]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="sec-wrap">
      <div className="sec-toolbar">
        <input
          className="sec-search"
          placeholder="Search buyers by name, mobile, email, ID or referral…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <input type="date" className="sec-date" value={dateFilter} onChange={(e) => { setDateFilter(e.target.value); setPage(1); }} />
        <span className="sec-count">{rows.length} buyer(s)</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No buyers match this search.</div>
      ) : (
        <div className="sec-tablewrap">
          <table className="sec-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th>Contact</th>
                <th>Registered</th>
                <th>Orders</th>
                <th>Total Purchase</th>
                <th>Last Order</th>
                <th>Family</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    <br />
                    <small>#{c.id}</small>
                  </td>
                  <td>
                    {c.mobile || "-"}
                    <br />
                    <small>{c.email || ""}</small>
                  </td>
                  <td><small>{String(c.createdAt || "").slice(0, 10)}</small></td>
                  <td>{c.orderCount}</td>
                  <td>₹{c.totalSpend.toLocaleString("en-IN")}</td>
                  <td><small>{c.lastOrderAt ? String(c.lastOrderAt).slice(0, 10) : "—"}</small></td>
                  <td>
                    {c.familyMember ? (
                      <span className="sec-tag sec-tag-family">{c.familyMember.name}</span>
                    ) : (
                      <span className="sec-tag">—</span>
                    )}
                  </td>
                  <td>
                    <button type="button" className="refresh-btn" onClick={() => setSelected(c)}>
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="sec-pager">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹ Prev</button>
          <span>Page {safePage} of {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next ›</button>
        </div>
      )}

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h3>{selected.name}</h3>
                <small>Buyer #{selected.id} · joined {String(selected.createdAt || "").slice(0, 10)}</small>
              </div>
              <button type="button" className="refresh-btn" onClick={() => setSelected(null)}>✕</button>
            </div>

            <div className="drawer-grid">
              <div className="drawer-card">
                <h4>Profile</h4>
                <p><b>Mobile:</b> {selected.mobile || "-"}</p>
                <p><b>Email:</b> {selected.email || "-"}</p>
                <p><b>Address:</b> {[selected.address, selected.city, selected.state, selected.pincode].filter(Boolean).join(", ") || "-"}</p>
              </div>
              <div className="drawer-card">
                <h4>Purchase summary</h4>
                <p><b>Total orders:</b> {selected.orderCount}</p>
                <p><b>Valid purchase amount:</b> ₹{selected.totalSpend.toLocaleString("en-IN")}</p>
                <p className="ov-note">Cancelled / returned / refunded orders are excluded from the amount.</p>
              </div>
              {selected.familyMember && (
                <div className="drawer-card">
                  <h4>JustBrand Family</h4>
                  <p><b>Referred by member:</b> {selected.familyMember.name} ({selected.familyMember.memberId})</p>
                  <p><b>Member status:</b> {selected.familyMember.status}</p>
                </div>
              )}
              <div className="drawer-card drawer-wide">
                <h4>Order history ({selected.orders.length})</h4>
                {selected.orders.length === 0 ? (
                  <p className="ov-note">No orders yet.</p>
                ) : (
                  <div className="sec-tablewrap">
                    <table className="sec-table">
                      <thead>
                        <tr><th>Order</th><th>Date</th><th>Amount</th><th>Payment</th><th>Status</th></tr>
                      </thead>
                      <tbody>
                        {selected.orders.slice(0, 20).map((o) => (
                          <tr key={o.id}>
                            <td>#{o.orderNumber}</td>
                            <td><small>{String(o.createdAt || "").slice(0, 10)}</small></td>
                            <td>₹{money(o.totalAmount).toLocaleString("en-IN")}</td>
                            <td>{o.paymentMethod} · {o.paymentStatus}</td>
                            <td><span className={`sec-tag ${o.status === "Delivered" ? "sec-tag-good" : o.status === "Cancelled" || o.status === "Returned" ? "sec-tag-bad" : "sec-tag-warn"}`}>{o.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
