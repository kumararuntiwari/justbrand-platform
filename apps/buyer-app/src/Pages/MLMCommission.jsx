import React, { useEffect, useState } from "react";
import {
  api,
  getMlmToken,
} from "../api";

function MLMCommission({ onBack }) {
  const [commissions, setCommissions] = useState([]);
  const [summary, setSummary] = useState({
    pending: 0,
    approved: 0,
    cancelled: 0,
    total: 0,
  });

  const [filter, setFilter] = useState("all");

  // ==========================================
  // LOAD COMMISSION DATA
  // ==========================================

  useEffect(() => {
    loadCommissionData();

    const timer = setInterval(() => {
      loadCommissionData();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  async function loadCommissionData() {
    const token = getMlmToken();

    if (!token) {
      setCommissions([]);
      calculateSummary([]);
      return;
    }

    try {
      const data = await api("/api/mlm/commissions", { token });

      const records = Array.isArray(data?.commissions)
        ? data.commissions
        : [];

      // Map backend records to the item shape this page renders.
      const mapped = records.map((record) => ({
        id: record.id,
        commission: Number(record.amount) || 0,
        amount: Number(record.amount) || 0,
        status: record.status,
        type: record.type,
        description: record.description,
        createdAt: record.createdAt,
        date: record.createdAt,
      }));

      setCommissions(mapped);
      calculateSummary(mapped);
    } catch (error) {
      console.log(
        "Commission loading error:",
        error
      );
    }
  }

  // ==========================================
  // SUMMARY
  // ==========================================

  function calculateSummary(data) {
    let pending = 0;
    let approved = 0;
    let cancelled = 0;
    let total = 0;

    data.forEach((item) => {
      const amount =
        Number(item?.commission || item?.amount || 0);

      const status =
        String(item?.status || "pending").toLowerCase();

      if (status === "approved") {
        approved += amount;
        total += amount;
      } else if (
        status === "cancelled" ||
        status === "canceled"
      ) {
        cancelled += amount;
      } else {
        pending += amount;
      }
    });

    setSummary({
      pending,
      approved,
      cancelled,
      total,
    });
  }

  // ==========================================
  // FILTER
  // ==========================================

  const filteredCommissions =
    commissions.filter((item) => {
      const status =
        String(item?.status || "pending").toLowerCase();

      if (filter === "all") {
        return true;
      }

      if (filter === "pending") {
        return status === "pending";
      }

      if (filter === "approved") {
        return status === "approved";
      }

      if (filter === "cancelled") {
        return (
          status === "cancelled" ||
          status === "canceled"
        );
      }

      return true;
    });

  // ==========================================
  // STATUS
  // ==========================================

  function getStatus(item) {
    const status =
      String(item?.status || "pending").toLowerCase();

    if (
      status === "cancelled" ||
      status === "canceled"
    ) {
      return "cancelled";
    }

    if (status === "approved") {
      return "approved";
    }

    return "pending";
  }

  // ==========================================
  // COMMISSION TYPE
  // ==========================================

  function getCommissionType(item) {
    if (item?.type) {
      return item.type;
    }

    if (item?.commissionType) {
      return item.commissionType;
    }

    if (item?.source) {
      return item.source;
    }

    return "Shopping Commission";
  }

  // ==========================================
  // RETURN DAYS
  // ==========================================

  function getReturnDays(item) {
    if (item?.returnPeriod !== undefined) {
      return item.returnPeriod;
    }

    if (item?.returnDays !== undefined) {
      return item.returnDays;
    }

    return 7;
  }

  // ==========================================
  // STATUS TEXT
  // ==========================================

  function getStatusText(item) {
    const status = getStatus(item);

    if (status === "approved") {
      return "Approved";
    }

    if (status === "cancelled") {
      return "Cancelled";
    }

    return "Pending";
  }

  // ==========================================
  // STATUS DESCRIPTION
  // ==========================================

  function getStatusDescription(item) {
    const status = getStatus(item);

    if (status === "approved") {
      return "Return period completed. Commission added to wallet.";
    }

    if (status === "cancelled") {
      return "Order cancelled/returned. Commission not payable.";
    }

    const days = getReturnDays(item);

    return `Commission will be released after ${days} days return period.`;
  }

  // ==========================================
  // EMPTY
  // ==========================================

  function EmptyState() {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>💰</div>

        <h3 style={styles.emptyTitle}>
          No Commission Found
        </h3>

        <p style={styles.emptyText}>
          Your Family commission will appear here
          when eligible shopping or referral
          transactions are generated.
        </p>
      </div>
    );
  }

  // ==========================================
  // RENDER
  // ==========================================

  return (
    <div style={styles.page}>

      {/* ======================================
          HEADER
      ====================================== */}

      <div style={styles.header}>

        <div style={styles.headerLeft}>

          <button
            onClick={onBack}
            style={styles.backButton}
          >
            ← Back
          </button>

          <div>
            <div style={styles.logo}>
              JustBrand
            </div>

            <div style={styles.headerTitle}>
              Family Commission
            </div>
          </div>

        </div>

        <div style={styles.headerBadge}>
          Commission Center
        </div>

      </div>

      {/* ======================================
          MAIN
      ====================================== */}

      <main style={styles.content}>

        {/* ====================================
            TITLE
        ==================================== */}

        <div style={styles.pageIntro}>

          <div>

            <h1 style={styles.title}>
              💰 Family Commission
            </h1>

            <p style={styles.subtitle}>
              Track your shopping, referral and
              binary commissions.
            </p>

          </div>

        </div>

        {/* ====================================
            SUMMARY CARDS
        ==================================== */}

        <div style={styles.summaryGrid}>

          <SummaryCard
            icon="⏳"
            title="Pending"
            value={summary.pending}
            description="Waiting for return period"
          />

          <SummaryCard
            icon="✅"
            title="Approved"
            value={summary.approved}
            description="Released to wallet"
          />

          <SummaryCard
            icon="❌"
            title="Cancelled"
            value={summary.cancelled}
            description="Not payable"
          />

          <SummaryCard
            icon="💰"
            title="Total Earned"
            value={summary.total}
            description="Approved commission"
          />

        </div>

        {/* ====================================
            COMMISSION RULE
        ==================================== */}

        <section style={styles.ruleBox}>

          <div style={styles.ruleIcon}>
            ℹ️
          </div>

          <div>

            <div style={styles.ruleTitle}>
              JustBrand Commission Rule
            </div>

            <div style={styles.ruleText}>
              Commission is credited to the
              wallet only after the applicable
              order return period is completed.
              Cancelled or returned orders do
              not generate payable commission.
            </div>

          </div>

        </section>

        {/* ====================================
            COMMISSION TYPES
        ==================================== */}

        <section style={styles.typesSection}>

          <h2 style={styles.sectionTitle}>
            Commission Types
          </h2>

          <div style={styles.typeGrid}>

            <TypeCard
              icon="🛒"
              title="Shopping Commission"
              text="Eligible purchases made through the JustBrand network."
            />

            <TypeCard
              icon="👥"
              title="Direct Referral"
              text="Special commission for directly introduced members."
            />

            <TypeCard
              icon="🌳"
              title="Binary Commission"
              text="Commission based on the applicable left and right team rules."
            />

            <TypeCard
              icon="🌐"
              title="Network Commission"
              text="Eligible shopping activity across the JustBrand network."
            />

          </div>

        </section>

        {/* ====================================
            FILTER
        ==================================== */}

        <section style={styles.historySection}>

          <div style={styles.historyHeader}>

            <div>

              <h2 style={styles.sectionTitle}>
                📜 Commission History
              </h2>

              <p style={styles.historySubtitle}>
                All commission transactions
              </p>

            </div>

            <div style={styles.filterBox}>

              <button
                onClick={() => setFilter("all")}
                style={getFilterStyle(
                  filter === "all"
                )}
              >
                All
              </button>

              <button
                onClick={() =>
                  setFilter("pending")
                }
                style={getFilterStyle(
                  filter === "pending"
                )}
              >
                Pending
              </button>

              <button
                onClick={() =>
                  setFilter("approved")
                }
                style={getFilterStyle(
                  filter === "approved"
                )}
              >
                Approved
              </button>

              <button
                onClick={() =>
                  setFilter("cancelled")
                }
                style={getFilterStyle(
                  filter === "cancelled"
                )}
              >
                Cancelled
              </button>

            </div>

          </div>

          {/* ==================================
              LIST
          ================================== */}

          {filteredCommissions.length === 0 ? (
            <EmptyState />
          ) : (
            <div style={styles.list}>

              {filteredCommissions.map(
                (item, index) => (
                  <CommissionItem
                    key={
                      item?.id ||
                      item?.commissionId ||
                      index
                    }
                    item={item}
                    getStatus={getStatus}
                    getStatusText={
                      getStatusText
                    }
                    getStatusDescription={
                      getStatusDescription
                    }
                    getCommissionType={
                      getCommissionType
                    }
                  />
                )
              )}

            </div>
          )}

        </section>

      </main>

    </div>
  );
}

/* ==========================================
   SUMMARY CARD
========================================== */

function SummaryCard({
  icon,
  title,
  value,
  description,
}) {
  return (
    <div style={styles.summaryCard}>

      <div style={styles.summaryIcon}>
        {icon}
      </div>

      <div style={styles.summaryTitle}>
        {title}
      </div>

      <div style={styles.summaryValue}>
        ₹{Number(value || 0).toLocaleString("en-IN")}
      </div>

      <div style={styles.summaryDescription}>
        {description}
      </div>

    </div>
  );
}

/* ==========================================
   TYPE CARD
========================================== */

function TypeCard({
  icon,
  title,
  text,
}) {
  return (
    <div style={styles.typeCard}>

      <div style={styles.typeIcon}>
        {icon}
      </div>

      <div>

        <div style={styles.typeTitle}>
          {title}
        </div>

        <div style={styles.typeText}>
          {text}
        </div>

      </div>

    </div>
  );
}

/* ==========================================
   COMMISSION ITEM
========================================== */

function CommissionItem({
  item,
  getStatus,
  getStatusText,
  getStatusDescription,
  getCommissionType,
}) {
  const status = getStatus(item);

  const amount = Number(
    item?.commission ||
    item?.amount ||
    0
  );

  const orderAmount = Number(
    item?.orderAmount ||
    item?.purchaseAmount ||
    item?.saleAmount ||
    0
  );

  const memberName =
    item?.memberName ||
    item?.customerName ||
    item?.buyerName ||
    "Customer";

  const orderId =
    item?.orderId ||
    item?.transactionId ||
    item?.id ||
    "N/A";

  const date =
    item?.date ||
    item?.createdAt ||
    "Recent";

  return (
    <div style={styles.commissionItem}>

      {/* LEFT */}

      <div style={styles.itemLeft}>

        <div
          style={{
            ...styles.itemIcon,
            background:
              status === "approved"
                ? "#e9fff1"
                : status === "cancelled"
                ? "#fff0f0"
                : "#fff8e6",
          }}
        >
          {status === "approved"
            ? "✅"
            : status === "cancelled"
            ? "❌"
            : "⏳"}
        </div>

        <div style={styles.itemInfo}>

          <div style={styles.itemTitle}>
            {getCommissionType(item)}
          </div>

          <div style={styles.itemDetails}>
            Member/Customer: {memberName}
          </div>

          <div style={styles.itemDetails}>
            Order ID: {orderId}
          </div>

          <div style={styles.itemDate}>
            {date}
          </div>

        </div>

      </div>

      {/* RIGHT */}

      <div style={styles.itemRight}>

        <div
          style={{
            ...styles.amount,
            color:
              status === "approved"
                ? "#198754"
                : status === "cancelled"
                ? "#dc3545"
                : "#d98b00",
          }}
        >
          {status === "cancelled"
            ? "₹0"
            : `₹${amount.toLocaleString("en-IN")}`}
        </div>

        <div
          style={{
            ...styles.status,
            background:
              status === "approved"
                ? "#e9fff1"
                : status === "cancelled"
                ? "#fff0f0"
                : "#fff8e6",
            color:
              status === "approved"
                ? "#198754"
                : status === "cancelled"
                ? "#dc3545"
                : "#d98b00",
          }}
        >
          {getStatusText(item)}
        </div>

      </div>

      {/* DETAILS */}

      <div style={styles.itemBottom}>

        {orderAmount > 0 && (
          <div style={styles.detailBox}>
            <span>Order Value</span>
            <strong>
              ₹{orderAmount.toLocaleString("en-IN")}
            </strong>
          </div>
        )}

        <div style={styles.detailBox}>
          <span>Commission</span>
          <strong>
            ₹{amount.toLocaleString("en-IN")}
          </strong>
        </div>

        <div style={styles.descriptionBox}>
          {getStatusDescription(item)}
        </div>

      </div>

    </div>
  );
}

/* ==========================================
   FILTER STYLE
========================================== */

function getFilterStyle(active) {
  return {
    border: "none",
    padding: "8px 12px",
    borderRadius: "7px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: active
      ? "bold"
      : "500",
    background: active
      ? "#ff1493"
      : "#f5f5f5",
    color: active
      ? "#fff"
      : "#555",
  };
}

/* ==========================================
   STYLES
========================================== */

const styles = {

  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },

  backButton: {
    border: "1px solid rgba(255,255,255,0.5)",
    background: "rgba(255,255,255,0.15)",
    color: "#fff",
    padding: "8px 12px",
    borderRadius: "7px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  logo: {
    fontSize: "22px",
    fontWeight: "bold",
  },

  headerTitle: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  headerBadge: {
    padding: "8px 13px",
    borderRadius: "20px",
    background: "rgba(255,255,255,0.15)",
    fontSize: "12px",
    fontWeight: "bold",
  },

  content: {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "25px",
    boxSizing: "border-box",
  },

  pageIntro: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
    flexWrap: "wrap",
  },

  title: {
    margin: 0,
    fontSize: "27px",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  summaryGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(200px,1fr))",
    gap: "15px",
    marginTop: "22px",
  },

  summaryCard: {
    background: "#fff",
    borderRadius: "13px",
    padding: "18px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
    border: "1px solid #eee",
  },

  summaryIcon: {
    fontSize: "27px",
  },

  summaryTitle: {
    marginTop: "8px",
    color: "#666",
    fontSize: "13px",
  },

  summaryValue: {
    marginTop: "4px",
    fontSize: "24px",
    fontWeight: "bold",
    wordBreak: "break-word",
  },

  summaryDescription: {
    marginTop: "4px",
    color: "#999",
    fontSize: "11px",
  },

  ruleBox: {
    marginTop: "20px",
    padding: "15px",
    background: "#eef7ff",
    border: "1px solid #d7ecff",
    borderRadius: "11px",
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
  },

  ruleIcon: {
    fontSize: "22px",
  },

  ruleTitle: {
    fontWeight: "bold",
    fontSize: "14px",
  },

  ruleText: {
    marginTop: "5px",
    color: "#555",
    fontSize: "12px",
    lineHeight: 1.6,
  },

  typesSection: {
    marginTop: "22px",
    background: "#fff",
    padding: "20px",
    borderRadius: "13px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "19px",
  },

  typeGrid: {
    marginTop: "15px",
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(230px,1fr))",
    gap: "12px",
  },

  typeCard: {
    display: "flex",
    gap: "12px",
    alignItems: "flex-start",
    padding: "14px",
    background: "#fafafa",
    borderRadius: "10px",
    border: "1px solid #eee",
  },

  typeIcon: {
    width: "42px",
    height: "42px",
    borderRadius: "10px",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "21px",
    flexShrink: 0,
  },

  typeTitle: {
    fontWeight: "bold",
    fontSize: "13px",
  },

  typeText: {
    marginTop: "4px",
    color: "#777",
    fontSize: "11px",
    lineHeight: 1.5,
  },

  historySection: {
    marginTop: "22px",
    background: "#fff",
    padding: "20px",
    borderRadius: "13px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  historyHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    marginBottom: "18px",
  },

  historySubtitle: {
    margin: "5px 0 0",
    color: "#888",
    fontSize: "12px",
  },

  filterBox: {
    display: "flex",
    gap: "5px",
    flexWrap: "wrap",
    background: "#fafafa",
    padding: "5px",
    borderRadius: "9px",
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  commissionItem: {
    padding: "15px",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "11px",
  },

  itemLeft: {
    display: "flex",
    alignItems: "flex-start",
    gap: "12px",
  },

  itemIcon: {
    width: "45px",
    height: "45px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "21px",
    flexShrink: 0,
  },

  itemInfo: {
    flex: 1,
    minWidth: 0,
  },

  itemTitle: {
    fontSize: "14px",
    fontWeight: "bold",
  },

  itemDetails: {
    marginTop: "3px",
    color: "#777",
    fontSize: "11px",
    wordBreak: "break-word",
  },

  itemDate: {
    marginTop: "5px",
    color: "#999",
    fontSize: "10px",
  },

  itemRight: {
    marginTop: "-45px",
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "5px",
  },

  amount: {
    fontSize: "18px",
    fontWeight: "bold",
  },

  status: {
    padding: "5px 9px",
    borderRadius: "15px",
    fontSize: "10px",
    fontWeight: "bold",
  },

  itemBottom: {
    marginTop: "15px",
    paddingTop: "12px",
    borderTop: "1px solid #eee",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
  },

  detailBox: {
    padding: "8px 11px",
    background: "#fff",
    borderRadius: "7px",
    border: "1px solid #eee",
    display: "flex",
    gap: "8px",
    fontSize: "11px",
  },

  descriptionBox: {
    flex: 1,
    minWidth: "230px",
    padding: "8px 11px",
    background: "#fff8f5",
    borderRadius: "7px",
    color: "#666",
    fontSize: "11px",
    lineHeight: 1.4,
  },

  empty: {
    textAlign: "center",
    padding: "55px 20px",
    color: "#777",
  },

  emptyIcon: {
    fontSize: "48px",
  },

  emptyTitle: {
    margin: "10px 0 5px",
    color: "#333",
  },

  emptyText: {
    maxWidth: "500px",
    margin: "0 auto",
    fontSize: "13px",
    lineHeight: 1.6,
  },
};

export default MLMCommission;