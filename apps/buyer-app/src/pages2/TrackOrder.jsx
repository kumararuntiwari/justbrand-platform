import React from "react";

// Track Order — dedicated delivery tracking screen for one order.
// Renders ONLY real backend data (additive delivery fields); steps without
// backend data stay pending. Delivery partner is shown by NAME only —
// partner contact details and OTP material are never displayed here.

function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtShort(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// 8-step timeline mapped onto the existing backend fields.
// "Packed" follows the seller's Shipped milestone; "Ready for Pickup"
// follows the admin delivery assignment; the failure/return step appears
// only when the backend actually recorded it.
function buildSteps(order) {
  const returned =
    order.deliveryStatus === "Returned to Seller" ||
    order.status === "Returned" ||
    Boolean(order.returnedToSellerAt);
  const delivered =
    order.deliveryStatus === "Delivered" || Boolean(order.deliveryOtpVerifiedAt);
  const outForDelivery = Boolean(order.outForDeliveryAt) || delivered;
  const pickedUp = Boolean(order.pickedUpAt) || outForDelivery;
  const ready = Boolean(order.assignedAt) || pickedUp;
  const packed =
    ["Shipped", "Delivered"].includes(order.status) || ready;
  const confirmed =
    order.status !== "Pending" || packed || ready;
  const failed = order.deliveryStatus === "Delivery Failed";

  const steps = [
    { label: "Order Placed", done: true, at: order.createdAt },
    { label: "Order Confirmed", done: confirmed, at: order.createdAt },
    { label: "Packed", done: packed, at: null },
    { label: "Ready for Pickup", done: ready, at: order.assignedAt },
    { label: "Picked Up", done: pickedUp, at: order.pickedUpAt },
    { label: "Out for Delivery", done: outForDelivery, at: order.outForDeliveryAt },
    { label: "Delivered", done: delivered, at: order.deliveredAt },
  ];

  if (failed) {
    steps.push({
      label: "Delivery Failed",
      failed: true,
      done: true,
      at: order.deliveryFailedAt,
      note: order.deliveryFailureReason || "A retry is being arranged.",
    });
  } else if (returned) {
    steps.push({
      label: "Returned to Seller",
      failed: true,
      done: true,
      at: order.returnedToSellerAt,
      note: "This order was returned to the seller.",
    });
  }

  return steps;
}

function currentStepLabel(steps, order) {
  if (order.deliveryStatus === "Delivered") return "Delivered";
  if (order.deliveryStatus === "Returned to Seller") return "Returned to Seller";
  if (order.deliveryStatus === "Delivery Failed") return "Delivery Failed";
  let last = "Order Placed";
  for (const s of steps) {
    if (s.done && !s.failed) last = s.label;
  }
  return last;
}

function statusBadgeStyle(status) {
  if (status === "Delivered")
    return { background: "#e6f7e6", color: "#1a7a1a" };
  if (["Delivery Failed", "Returned to Seller", "Cancelled", "Returned"].includes(status))
    return { background: "#fff0f0", color: "#c00" };
  return { background: "#fff2e8", color: "#c2410c" };
}

function TrackOrder({ order, onBack }) {
  const steps = buildSteps(order);
  const current = currentStepLabel(steps, order);
  const isDone = current === "Delivered";
  const isBad = ["Delivery Failed", "Returned to Seller"].includes(current);
  const lastUpdated =
    order.updatedAt ||
    order.deliveredAt ||
    order.outForDeliveryAt ||
    order.pickedUpAt ||
    order.assignedAt ||
    order.createdAt;

  // Expected delivery: order date + 5 days (clearly marked as an estimate).
  const expected = order.createdAt
    ? new Date(new Date(order.createdAt).getTime() + 5 * 24 * 60 * 60 * 1000)
    : null;

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>Track Order</div>
        </div>
        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.inner}>
          {/* Order summary */}
          <div style={styles.card}>
            <div style={styles.summaryTop}>
              <div>
                <div style={styles.orderNumber}>#{order.orderNumber}</div>
                <div style={styles.orderDate}>
                  Placed on {fmtDate(order.createdAt)}
                </div>
              </div>
              <span
                style={{
                  ...styles.statusBadge,
                  ...statusBadgeStyle(
                    isBad ? current : order.deliveryStatus || order.status
                  ),
                }}
              >
                {order.status}
              </span>
            </div>

            {/* Current status banner */}
            <div
              style={{
                ...styles.currentBanner,
                ...(isDone
                  ? styles.bannerDone
                  : isBad
                    ? styles.bannerBad
                    : styles.bannerActive),
              }}
            >
              <div style={styles.bannerLabel}>CURRENT STATUS</div>
              <div style={styles.bannerValue}>
                {isDone ? "✓ " : isBad ? "⚠️ " : "🚚 "}
                {current}
              </div>
              {isBad && order.deliveryFailureReason ? (
                <div style={styles.bannerNote}>
                  Reason: {order.deliveryFailureReason}
                  {order.deliveryStatus === "Delivery Failed"
                    ? " — a retry or return is being arranged."
                    : ""}
                </div>
              ) : null}
              {order.deliveryStatus === "Delivery Failed" && !isBad ? null : null}
            </div>

            {/* Tracking details */}
            <div style={styles.detailsGrid}>
              <div style={styles.detailCell}>
                <div style={styles.detailLabel}>Tracking ID</div>
                <div style={styles.detailValue}>
                  JB-{order.orderNumber}
                </div>
              </div>
              <div style={styles.detailCell}>
                <div style={styles.detailLabel}>Delivery Partner</div>
                <div style={styles.detailValue}>
                  {order.deliveryPartnerName || "Will be assigned soon"}
                </div>
              </div>
              <div style={styles.detailCell}>
                <div style={styles.detailLabel}>
                  {isDone ? "Delivered On" : "Expected Delivery"}
                </div>
                <div style={styles.detailValue}>
                  {isDone ? fmtShort(order.deliveredAt) : fmtShort(expected)}
                  {!isDone ? (
                    <span style={styles.estimateTag}> (estimate)</span>
                  ) : null}
                </div>
              </div>
              <div style={styles.detailCell}>
                <div style={styles.detailLabel}>Last Updated</div>
                <div style={styles.detailValue}>{fmtDate(lastUpdated)}</div>
              </div>
            </div>
          </div>

          {/* 8-step vertical timeline */}
          <div style={styles.card}>
            <div style={styles.timelineTitle}>Delivery Journey</div>
            <div style={styles.timeline}>
              {steps.map((step, index) => {
                const isLast = index === steps.length - 1;
                const isCurrent =
                  step.done &&
                  !steps
                    .slice(index + 1)
                    .some((s) => s.done);
                return (
                  <div key={step.label} style={styles.stepRow}>
                    <div style={styles.stepRail}>
                      <div
                        style={{
                          ...styles.stepDot,
                          ...(step.failed
                            ? styles.stepDotFailed
                            : step.done
                              ? styles.stepDotDone
                              : {}),
                          ...(isCurrent && !step.failed
                            ? styles.stepDotCurrent
                            : {}),
                        }}
                      >
                        {step.failed ? "!" : step.done ? "✓" : index + 1}
                      </div>
                      {!isLast ? (
                        <div
                          style={{
                            ...styles.stepLine,
                            ...(step.done ? styles.stepLineDone : {}),
                          }}
                        />
                      ) : null}
                    </div>
                    <div style={styles.stepBody}>
                      <div
                        style={{
                          ...styles.stepLabel,
                          ...(step.failed
                            ? styles.stepLabelFailed
                            : step.done
                              ? styles.stepLabelDone
                              : {}),
                          ...(isCurrent && !step.failed
                            ? styles.stepLabelCurrent
                            : {}),
                        }}
                      >
                        {step.label}
                        {isCurrent && !step.failed ? (
                          <span style={styles.nowTag}>Current</span>
                        ) : null}
                      </div>
                      {step.done && step.at ? (
                        <div style={styles.stepTime}>{fmtDate(step.at)}</div>
                      ) : null}
                      {step.note ? (
                        <div style={styles.stepNote}>{step.note}</div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Payment / address summary */}
          <div style={styles.card}>
            <div style={styles.timelineTitle}>Shipment Details</div>
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>Payment</span>
              <span style={styles.metaVal}>
                {order.paymentMethod} · {order.paymentStatus}
              </span>
            </div>
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>Deliver to</span>
              <span style={styles.metaVal}>{order.customerName}</span>
            </div>
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>Address</span>
              <span style={styles.metaVal}>{order.address}</span>
            </div>
            <div style={styles.metaRow}>
              <span style={styles.metaKey}>Order Total</span>
              <span style={styles.metaTotal}>₹{order.totalAmount}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            style={styles.backToOrders}
          >
            ← Back to My Orders
          </button>
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "transparent",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  headerText: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  backButton: {
    border: "none",
    background: "#fff",
    color: "#ff1493",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  container: {
    width: "100%",
    padding: "24px 16px 40px",
    boxSizing: "border-box",
  },

  inner: {
    maxWidth: "720px",
    margin: "0 auto",
  },

  card: {
    background: "#fff",
    borderRadius: "14px",
    padding: "18px",
    marginBottom: "16px",
    boxShadow: "0 3px 15px rgba(0,0,0,0.07)",
  },

  summaryTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "10px",
  },

  orderNumber: {
    fontWeight: "bold",
    fontSize: "16px",
    color: "#333",
  },

  orderDate: {
    fontSize: "12px",
    color: "#999",
    marginTop: "3px",
  },

  statusBadge: {
    padding: "5px 12px",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },

  currentBanner: {
    marginTop: "14px",
    borderRadius: "10px",
    padding: "12px 14px",
  },

  bannerActive: {
    background: "#fff7ed",
    border: "1px solid #fed7aa",
  },

  bannerDone: {
    background: "#e6f7e6",
    border: "1px solid #b7e4b7",
  },

  bannerBad: {
    background: "#fff0f0",
    border: "1px solid #ffc9c9",
  },

  bannerLabel: {
    fontSize: "11px",
    letterSpacing: "0.6px",
    color: "#8a8f9c",
    fontWeight: "bold",
  },

  bannerValue: {
    fontSize: "17px",
    fontWeight: "bold",
    color: "#333",
    marginTop: "3px",
  },

  bannerNote: {
    fontSize: "13px",
    color: "#b91c1c",
    marginTop: "6px",
  },

  detailsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "12px",
    marginTop: "14px",
  },

  detailCell: {
    background: "#fafafa",
    borderRadius: "10px",
    padding: "10px 12px",
  },

  detailLabel: {
    fontSize: "11px",
    color: "#8a8f9c",
    fontWeight: "bold",
    letterSpacing: "0.4px",
  },

  detailValue: {
    fontSize: "14px",
    fontWeight: "600",
    color: "#333",
    marginTop: "3px",
    wordBreak: "break-word",
  },

  estimateTag: {
    fontSize: "11px",
    color: "#999",
    fontWeight: "normal",
  },

  timelineTitle: {
    fontWeight: "bold",
    fontSize: "15px",
    color: "#333",
    marginBottom: "14px",
  },

  timeline: {
    display: "flex",
    flexDirection: "column",
  },

  stepRow: {
    display: "flex",
    gap: "12px",
  },

  stepRail: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },

  stepDot: {
    width: "26px",
    height: "26px",
    minWidth: "26px",
    borderRadius: "50%",
    background: "#eef1f7",
    color: "#8b93a8",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: "bold",
  },

  stepDotDone: {
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
  },

  stepDotCurrent: {
    boxShadow: "0 0 0 4px rgba(255,107,0,0.18)",
  },

  stepDotFailed: {
    background: "#ef4444",
    color: "#fff",
  },

  stepLine: {
    width: "2px",
    flex: 1,
    minHeight: "26px",
    background: "#e7eaf2",
  },

  stepLineDone: {
    background: "linear-gradient(180deg,#ff8c00,#ff1493)",
  },

  stepBody: {
    paddingBottom: "18px",
    flex: 1,
    minWidth: 0,
  },

  stepLabel: {
    fontSize: "14px",
    color: "#8b93a8",
    fontWeight: 500,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },

  stepLabelDone: {
    color: "#333",
    fontWeight: "600",
  },

  stepLabelCurrent: {
    color: "#c2410c",
  },

  stepLabelFailed: {
    color: "#c00",
    fontWeight: "600",
  },

  nowTag: {
    fontSize: "10px",
    fontWeight: "bold",
    color: "#fff",
    background: "linear-gradient(90deg,#ff6b00,#ff1493)",
    padding: "2px 8px",
    borderRadius: "10px",
    letterSpacing: "0.4px",
  },

  stepTime: {
    fontSize: "12px",
    color: "#999",
    marginTop: "2px",
  },

  stepNote: {
    fontSize: "12px",
    color: "#b91c1c",
    background: "#fff0f0",
    borderRadius: "8px",
    padding: "6px 9px",
    marginTop: "6px",
  },

  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    padding: "7px 0",
    borderBottom: "1px solid #f2f3f7",
    fontSize: "13px",
  },

  metaKey: {
    color: "#8a8f9c",
    minWidth: "90px",
  },

  metaVal: {
    color: "#333",
    textAlign: "right",
    wordBreak: "break-word",
  },

  metaTotal: {
    fontWeight: "bold",
    color: "#ff1493",
  },

  backToOrders: {
    width: "100%",
    padding: "13px",
    border: "none",
    borderRadius: "10px",
    background: "#fff",
    color: "#ff1493",
    boxShadow: "0 3px 15px rgba(0,0,0,0.07)",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "14px",
  },
};

export default TrackOrder;
