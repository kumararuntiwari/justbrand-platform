// =====================================================
// SELLER — MY SCHEME (READ-ONLY)
// =====================================================
// Shows the JustBrand Family member linked to the logged-in seller
// and the Admin-controlled 3×3 earning rules. The endpoint resolves
// the seller from the Bearer token; no member/seller id is sent from
// the browser. There is deliberately no edit control here — only an
// Admin can change percentages, ON/OFF, base, levels or dates.

import React, { useEffect, useState } from "react";
import { API_URL } from "../api.js";

const SCHEME_META = [
  {
    key: "direct",
    title: "Direct Introduce",
    icon: "🤝",
    note: "First three introductions",
  },
  {
    key: "spillover",
    title: "Spillover",
    icon: "🌊",
    note: "4th and later introductions",
  },
  {
    key: "timewise",
    title: "Time-wise Earning",
    icon: "⏱️",
    note: "Earlier eligible shopping chain",
  },
];

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function dateTime(value) {
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

function baseLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MyScheme({ onBack }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const token = localStorage.getItem("justbrand_seller_token") || "";
      if (!token) {
        if (active) {
          setError("Seller session not found. Please log in again.");
          setLoading(false);
        }
        return;
      }

      try {
        const response = await fetch(`${API_URL}/api/sellers/my-scheme`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) {
          throw new Error(body?.message || `Could not load scheme (HTTP ${response.status}).`);
        }
        if (active) {
          setData(body);
          setError("");
        }
      } catch (err) {
        if (active) setError(err.message || "Could not load your scheme.");
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 900 }}>JustBrand</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>Seller Panel · My Scheme</div>
        </div>
        <button type="button" onClick={onBack} style={backButton}>
          ← Dashboard
        </button>
      </header>

      <main style={main}>
        <section style={hero}>
          <div>
            <div style={eyebrow}>JUSTBRAND FAMILY · SELLER VIEW</div>
            <h1 style={{ margin: "5px 0 7px", fontSize: 27 }}>My Scheme</h1>
            <p style={{ margin: 0, color: "#667085", fontSize: 13, lineHeight: 1.6 }}>
              Your Member ID, Admin-set earning schemes and your own earnings. Scheme changes are
              read-only here and can only be made by Admin.
            </p>
          </div>
          <div style={lockBadge}>🔒 Admin controlled</div>
        </section>

        {loading ? <section style={card}>Loading your scheme…</section> : null}

        {!loading && error ? (
          <section style={{ ...card, borderColor: "#fecaca", background: "#fff7f7", color: "#b42318" }}>
            {error}
          </section>
        ) : null}

        {!loading && !error && data && !data.linked ? (
          <section style={card}>
            <div style={{ fontSize: 34 }}>🔗</div>
            <h2 style={{ margin: "8px 0 6px", fontSize: 19 }}>Family Member not linked</h2>
            <p style={{ margin: 0, color: "#667085", fontSize: 13, lineHeight: 1.7 }}>
              {data.message ||
                "This seller account is not linked to a JustBrand Family Member ID."}
            </p>
            <p style={{ margin: "10px 0 0", color: "#946200", fontSize: 12.5 }}>
              No earnings or Member ID are shown because no member record matches this seller. Only
              an Admin can confirm the correct Family account.
            </p>
          </section>
        ) : null}

        {!loading && !error && data?.linked ? (
          <>
            <section style={card}>
              <h2 style={h2}>Member identity</h2>
              <div style={idGrid}>
                <IdTile label="Member ID" value={data.member.memberId} />
                <IdTile label="Sponsor ID" value={data.member.sponsorId || "Root member"} />
                <IdTile label="Referral ID" value={data.member.referralCode} />
                <IdTile
                  label="Introduction"
                  value={
                    data.member.introductionType
                      ? `${baseLabel(data.member.introductionType)}${
                          data.member.directSlot ? ` · slot ${data.member.directSlot}` : ""
                        }`
                      : "Legacy / not recorded"
                  }
                />
              </div>
              <p style={{ ...muted, marginTop: 10 }}>
                Member ID is the Sponsor ID and Referral ID used across JustBrand Family. Placement:{" "}
                {data.member.placed
                  ? `${data.member.position || "placed"} under ${data.member.parentId || "—"}`
                  : "pending first eligible shopping"}
                .
              </p>
            </section>

            <section style={statsGrid}>
              <EarningTile
                label="Pending earning"
                value={money(data.earnings.pending)}
                note={`${data.earnings.pendingCount} entr${
                  data.earnings.pendingCount === 1 ? "y" : "ies"
                } · return period running`}
                color="#946200"
                background="#fff8e8"
              />
              <EarningTile
                label="Eligible earning"
                value={money(data.earnings.eligible)}
                note={`${data.earnings.eligibleCount} released after return period`}
                color="#0f7a45"
                background="#eafaf2"
              />
              <EarningTile
                label="Credited earning"
                value={money(data.earnings.credited)}
                note={`${data.earnings.creditedCount} paid to wallet`}
                color="#175cd3"
                background="#eff8ff"
              />
              <EarningTile
                label="Wallet balance"
                value={money(data.earnings.wallet?.balance)}
                note={`Lifetime earned ${money(data.earnings.wallet?.totalEarned)}`}
                color="#c2410c"
                background="#fff4ec"
              />
            </section>

            <section style={card}>
              <div style={sectionHead}>
                <div>
                  <h2 style={h2}>Earning schemes</h2>
                  <p style={muted}>
                    Return period: {data.returnPeriod.days} day(s) after delivery.{" "}
                    {data.returnPeriod.afterReturn
                      ? "Earnings become eligible only after this period."
                      : "Admin has disabled the return-period wait."}
                  </p>
                </div>
                <span style={{ ...pill, background: "#eef2f7", color: "#475467" }}>
                  Seller cannot edit
                </span>
              </div>

              <div style={schemeGrid}>
                {SCHEME_META.map((meta) => {
                  const rule = data.schemes?.[meta.key] || {};
                  return (
                    <article key={meta.key} style={schemeCard}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                          <span style={schemeIcon}>{meta.icon}</span>
                          <div>
                            <strong style={{ fontSize: 14 }}>{meta.title}</strong>
                            <div style={{ ...muted, marginTop: 2 }}>{meta.note}</div>
                          </div>
                        </div>
                        <span
                          style={{
                            ...pill,
                            background: rule.enabled ? "#eafaf2" : "#f2f4f7",
                            color: rule.enabled ? "#0f7a45" : "#667085",
                          }}
                        >
                          {rule.enabled ? "ON" : "OFF"}
                        </span>
                      </div>

                      <div style={{ fontSize: 28, fontWeight: 900, margin: "13px 0 2px" }}>
                        {Number(rule.percentage) || 0}%
                      </div>
                      <div style={{ fontSize: 11, color: "#667085" }}>Applied percentage</div>

                      <dl style={ruleList}>
                        <Row label="Calculation base" value={baseLabel(rule.calculationBase)} />
                        <Row label="Eligible levels" value={String(rule.maxLevels || "—")} />
                        <Row label="Chain limit" value={String(rule.chainLimit || "—")} />
                        <Row label="Effective from" value={dateTime(rule.effectiveFrom)} />
                      </dl>
                    </article>
                  );
                })}
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>My earnings</h2>
              <p style={muted}>
                Only commissions credited to your own Member ID are listed. Cancelled, refunded or
                reversed orders show as Void/Reversed.
              </p>

              {data.earnings.rows.length === 0 ? (
                <p style={{ ...muted, padding: "16px 0" }}>No eligible scheme earning yet.</p>
              ) : (
                <div style={{ overflowX: "auto", marginTop: 12 }}>
                  <table style={table}>
                    <thead>
                      <tr>
                        <th style={th}>Order</th>
                        <th style={th}>Type</th>
                        <th style={th}>Rate / base</th>
                        <th style={th}>Amount</th>
                        <th style={th}>Status</th>
                        <th style={th}>Return period</th>
                        <th style={th}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.earnings.rows.map((row) => (
                        <tr key={row.id} style={{ borderTop: "1px solid #eef1f5" }}>
                          <td style={td}>
                            <strong>{row.orderNumber || `#${row.orderId || "—"}`}</strong>
                            {row.orderPaymentStatus ? (
                              <div style={small}>Payment: {row.orderPaymentStatus}</div>
                            ) : null}
                          </td>
                          <td style={td}>{baseLabel(row.type)}</td>
                          <td style={td}>
                            {Number(row.percentage) || 0}% of {money(row.baseAmount)}
                          </td>
                          <td style={{ ...td, fontWeight: 800 }}>{money(row.amount)}</td>
                          <td style={td}>
                            <span
                              style={{
                                ...pill,
                                background:
                                  row.status === "Paid"
                                    ? "#eafaf2"
                                    : row.status === "Payable"
                                      ? "#eff8ff"
                                      : row.status === "Pending"
                                        ? "#fff8e8"
                                        : "#fef2f2",
                                color:
                                  row.status === "Paid"
                                    ? "#0f7a45"
                                    : row.status === "Payable"
                                      ? "#175cd3"
                                      : row.status === "Pending"
                                        ? "#946200"
                                        : "#b42318",
                              }}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td style={td}>
                            {row.returnPeriodPending
                              ? `${row.daysRemaining} day(s) left`
                              : row.returnPeriodComplete
                                ? "Complete"
                                : "Not applicable"}
                            <div style={small}>{dateTime(row.payableAt)}</div>
                          </td>
                          <td style={td}>{dateTime(row.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section style={card}>
              <h2 style={h2}>Scheme change history</h2>
              <p style={muted}>
                Admin changes only. Existing orders keep the rates saved when they were placed.
              </p>
              {data.history.length === 0 ? (
                <p style={{ ...muted, padding: "12px 0" }}>No scheme change recorded yet.</p>
              ) : (
                <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                  {data.history.map((item, index) => (
                    <div key={`${item.at}-${index}`} style={historyRow}>
                      <div>
                        <strong style={{ fontSize: 12.5 }}>{dateTime(item.at)}</strong>
                        <div style={small}>{item.note || "Scheme settings updated"}</div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {SCHEME_META.map((meta) => {
                          const after = item.after?.[meta.key];
                          if (!after) return null;
                          return (
                            <span key={meta.key} style={{ ...pill, background: "#f2f4f7", color: "#475467" }}>
                              {meta.title}: {after.enabled ? `${after.percentage}% ON` : "OFF"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function IdTile({ label, value }) {
  return (
    <div style={idTile}>
      <div style={{ fontSize: 9.5, fontWeight: 900, color: "#98a2b1", letterSpacing: 0.7 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ marginTop: 4, fontSize: 14, fontWeight: 800, color: "#273348", wordBreak: "break-word" }}>
        {value || "—"}
      </div>
    </div>
  );
}

function EarningTile({ label, value, note, color, background }) {
  return (
    <div style={{ ...earningTile, background }}>
      <div style={{ fontSize: 11, fontWeight: 800, color }}>{label}</div>
      <div style={{ fontSize: 23, fontWeight: 900, margin: "5px 0 2px", color: "#1d2939" }}>
        {value}
      </div>
      <div style={{ fontSize: 10.5, color: "#667085" }}>{note}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <>
      <dt style={{ color: "#667085", fontSize: 11.5 }}>{label}</dt>
      <dd style={{ margin: 0, textAlign: "right", fontSize: 11.5, fontWeight: 700 }}>{value}</dd>
    </>
  );
}

const page = { minHeight: "100vh", background: "#f5f7fb", color: "#1d2939" };
const header = {
  background: "linear-gradient(135deg,#ff6b00,#ff1493)",
  color: "white",
  padding: "15px 25px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 15,
  flexWrap: "wrap",
};
const backButton = {
  border: "none",
  background: "white",
  color: "#c2185b",
  padding: "10px 16px",
  borderRadius: 9,
  cursor: "pointer",
  fontWeight: 800,
};
const main = { maxWidth: 1180, margin: "0 auto", padding: 20, boxSizing: "border-box" };
const hero = {
  background: "linear-gradient(115deg,#ffffff,#fff7f2)",
  border: "1px solid #ffe0d1",
  borderRadius: 16,
  padding: 22,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 18,
  flexWrap: "wrap",
  boxShadow: "0 8px 26px rgba(16,24,40,.05)",
};
const eyebrow = { color: "#e85d04", fontSize: 9.5, fontWeight: 900, letterSpacing: 1.4 };
const lockBadge = {
  background: "#fff1e8",
  color: "#c2410c",
  border: "1px solid #ffd9c2",
  padding: "9px 12px",
  borderRadius: 999,
  fontSize: 11.5,
  fontWeight: 800,
};
const card = {
  background: "white",
  border: "1px solid #e9edf4",
  borderRadius: 15,
  padding: 20,
  marginTop: 14,
  boxShadow: "0 7px 22px rgba(16,24,40,.05)",
};
const h2 = { margin: 0, fontSize: 18 };
const muted = { margin: "5px 0 0", color: "#667085", fontSize: 12, lineHeight: 1.6 };
const sectionHead = { display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" };
const idGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
  gap: 10,
  marginTop: 13,
};
const idTile = { border: "1px solid #eef1f5", background: "#fafbfd", borderRadius: 11, padding: "12px 14px" };
const statsGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
  gap: 10,
  marginTop: 14,
};
const earningTile = { border: "1px solid #eef1f5", borderRadius: 13, padding: 15 };
const schemeGrid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
  gap: 11,
  marginTop: 14,
};
const schemeCard = { border: "1px solid #e9edf4", borderRadius: 13, padding: 15, background: "#fcfdff" };
const schemeIcon = {
  width: 34,
  height: 34,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  background: "#fff1e8",
  fontSize: 17,
  flex: "0 0 34px",
};
const pill = {
  display: "inline-block",
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 800,
  whiteSpace: "nowrap",
};
const ruleList = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: "7px 12px",
  margin: "13px 0 0",
  paddingTop: 11,
  borderTop: "1px solid #eef1f5",
};
const table = { width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: 760 };
const th = { textAlign: "left", padding: "9px 10px", background: "#f9fafb", color: "#667085", whiteSpace: "nowrap" };
const td = { padding: "10px", verticalAlign: "top" };
const small = { fontSize: 10, color: "#98a2b1", marginTop: 3 };
const historyRow = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  flexWrap: "wrap",
  border: "1px solid #eef1f5",
  borderRadius: 10,
  padding: "10px 12px",
  background: "#fcfdff",
};
