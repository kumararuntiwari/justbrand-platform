// JustBrand Delivery Partner Panel — API base follows the same convention
// as the other panels: production origin by default, override in dev.
export const API =
  import.meta.env.VITE_API_URL || "https://justbrand-in-144629.hostingersite.com";

export const STATUS_META = {
  Assigned: { label: "Assigned", bg: "#fff7ed", fg: "#c2410c" },
  "Pickup Pending": { label: "Pickup Pending", bg: "#fffbeb", fg: "#b45309" },
  "Picked Up": { label: "Picked Up", bg: "#eff6ff", fg: "#1d4ed8" },
  "Out for Delivery": { label: "Out for Delivery", bg: "#f5f3ff", fg: "#6d28d9" },
  Delivered: { label: "Delivered", bg: "#ecfdf5", fg: "#047857" },
  "Delivery Failed": { label: "Delivery Failed", bg: "#fef2f2", fg: "#b91c1c" },
  "Return to Seller": { label: "Return to Seller", bg: "#fef2f2", fg: "#9f1239" },
  "Returned to Seller": { label: "Returned", bg: "#f1f5f9", fg: "#475569" },
};

export function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status || "—", bg: "#f1f5f9", fg: "#475569" };
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
      {meta.label}
    </span>
  );
}

export function Card({ children, style }) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e8ecf5",
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 1px 2px rgba(20,33,61,0.05)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#37435f", marginBottom: 6 }}>
        {label}
      </span>
      {children}
      {hint ? (
        <span style={{ display: "block", fontSize: 12, color: "#8b93a8", marginTop: 4 }}>{hint}</span>
      ) : null}
    </label>
  );
}

export const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d8deec",
  fontSize: 14,
  background: "#fff",
  color: "#14213d",
  outline: "none",
};

export function Toast({ toast }) {
  if (!toast) return null;
  const bg = toast.kind === "error" ? "#fee2e2" : "#ecfdf5";
  const fg = toast.kind === "error" ? "#b91c1c" : "#047857";
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        right: 16,
        zIndex: 1000,
        background: bg,
        color: fg,
        padding: "12px 16px",
        borderRadius: 12,
        fontWeight: 600,
        fontSize: 14,
        boxShadow: "0 8px 24px rgba(20,33,61,0.15)",
        maxWidth: 340,
      }}
    >
      {toast.message}
    </div>
  );
}

// KPI stat card used across the dashboard.
export function StatCard({ label, value, accent = "#f97316", sub, onClick }) {
  return (
    <Card
      style={{
        cursor: onClick ? "pointer" : "default",
        borderLeft: `4px solid ${accent}`,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: "#6b7490", textTransform: "uppercase", letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#14213d", marginTop: 6 }}>{value}</div>
      {sub ? <div style={{ fontSize: 12, color: "#8b93a8", marginTop: 4 }}>{sub}</div> : null}
    </Card>
  );
}
