import { useCallback, useEffect, useState } from "react";
import { API } from "./apiConfig";

// =====================================================
// FAMILY PLACEMENT (PAN-INDIA SPILLOVER) — ADMIN VIEW
// =====================================================
// Admin-only inspection of the automatic time-based spillover system:
//   • every placement record (member, parent, A/B/C slot, qualifying
//     order + its status, eligibility timestamp in IST, status)
//   • per-member detail: sponsor, three direct slots (filled/vacant),
//     eligibility events, failure/duplicate audit trail
//   • manual correction (super_admin only): reprocess a still-unplaced
//     member — requires a reason and always writes an audit record.
// Read-only w.r.t. existing data: this view NEVER rearranges members.

const THING = "1px solid #e5e7eb";

const chip = (bg, color) => ({
  display: "inline-block",
  padding: "2px 9px",
  borderRadius: "999px",
  fontSize: "12px",
  fontWeight: 700,
  background: bg,
  color,
});

const statusChip = (status) => {
  if (status === "Placed") return chip("#e8f7ee", "#137a3d");
  if (status === "Revoked") return chip("#fdecec", "#b3261e");
  return chip("#fff4e0", "#8a5a00");
};

function FamilyPlacementPanel({ token, isSuper, onMessage }) {
  const [placements, setPlacements] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState(null); // admin placement detail
  const [detailLoading, setDetailLoading] = useState(false);
  const [reprocessReason, setReprocessReason] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const response = await fetch(`${API}/api/admin/mlm/placements${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setPlacements(data.placements || []);
      } else if (onMessage) {
        onMessage(data.message || "Failed to load placements.");
      }
    } catch (error) {
      console.error(error);
      if (onMessage) onMessage("Failed to load placements.");
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, onMessage]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(memberId) {
    setDetailLoading(true);
    setDetail(null);
    try {
      const response = await fetch(
        `${API}/api/admin/mlm/members/${encodeURIComponent(memberId)}/placement`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json();
      if (data.success) {
        setDetail(data);
      } else if (onMessage) {
        onMessage(data.message || "Failed to load member placement.");
      }
    } catch (error) {
      console.error(error);
      if (onMessage) onMessage("Failed to load member placement.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function reprocess(memberId) {
    if (!isSuper) {
      if (onMessage) onMessage("Only a Super Admin can run manual corrections.");
      return;
    }
    const reason = String(reprocessReason || "").trim();
    if (reason.length < 5) {
      if (onMessage) onMessage("Enter a reason (min 5 characters) for the correction.");
      return;
    }
    try {
      const response = await fetch(
        `${API}/api/admin/mlm/members/${encodeURIComponent(memberId)}/reprocess-placement`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reason }),
        }
      );
      const data = await response.json();
      if (onMessage) onMessage(data.message || "Reprocess finished.");
      setReprocessReason("");
      await load();
      await openDetail(memberId);
    } catch (error) {
      console.error(error);
      if (onMessage) onMessage("Reprocess failed.");
    }
  }

  const placedCount = placements.filter((p) => p.status === "Placed").length;
  const revokedCount = placements.filter((p) => p.status === "Revoked").length;

  return (
    <section aria-label="Family Placement (Spillover)" style={{ padding: "18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "10px",
          marginBottom: "6px",
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: "20px" }}>
            🧩 Placement — Pan India Spillover
          </h2>
          <p style={{ margin: "4px 0 0", color: "#666", fontSize: "13px" }}>
            Automatic breadth-first placement, max 3 direct members, confirmed by
            shopping eligibility. All times shown in IST.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select
            aria-label="Filter by placement status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: "8px 10px",
              borderRadius: "8px",
              border: THING,
              background: "#fff",
            }}
          >
            <option value="">All statuses</option>
            <option value="Placed">Placed</option>
            <option value="Revoked">Revoked</option>
          </select>
          <button
            type="button"
            onClick={load}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "none",
              background: "#ff6b00",
              color: "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      <p style={{ color: "#777", fontSize: "13px", margin: "0 0 14px" }}>
        {placements.length} record{placements.length === 1 ? "" : "s"} · {placedCount}{" "}
        placed · {revokedCount} revoked
      </p>

      {/* PLACEMENTS TABLE */}
      <div style={{ overflowX: "auto", border: THING, borderRadius: "12px" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "13px",
            minWidth: "880px",
          }}
        >
          <thead>
            <tr style={{ background: "#f8fafc", textAlign: "left" }}>
              {[
                "Member",
                "Parent",
                "Slot",
                "Qualifying order",
                "Eligibility (IST)",
                "Status",
                "",
              ].map((head) => (
                <th key={head} style={{ padding: "10px 12px", borderBottom: THING }}>
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {placements.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: "22px", textAlign: "center", color: "#888" }}>
                  {loading ? "Loading placements…" : "No placement records yet — members are placed after their first eligible delivery."}
                </td>
              </tr>
            )}
            {placements.map((p) => (
              <tr key={p.id} style={{ borderBottom: THING }}>
                <td style={{ padding: "10px 12px" }}>
                  <strong>{p.memberName || p.memberId}</strong>
                  <div style={{ color: "#888", fontSize: "12px" }}>{p.memberId}</div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {p.parentId ? (
                    <>
                      <div>{p.parentName || p.parentId}</div>
                      <div style={{ color: "#888", fontSize: "12px" }}>{p.parentId}</div>
                    </>
                  ) : (
                    <span style={{ color: "#888" }}>ROOT</span>
                  )}
                </td>
                <td style={{ padding: "10px 12px", fontWeight: 700 }}>{p.position || "—"}</td>
                <td style={{ padding: "10px 12px" }}>
                  {p.qualifyingOrderId ? (
                    <>
                      <div>#{p.qualifyingOrderId}</div>
                      <div style={{ color: "#888", fontSize: "12px" }}>
                        {p.orderStatus || "?"} · pay: {p.orderPaymentStatus || "?"}
                      </div>
                    </>
                  ) : (
                    <span style={{ color: "#888" }}>—</span>
                  )}
                </td>
                <td style={{ padding: "10px 12px" }}>{p.eligibilityAtIst || "—"}</td>
                <td style={{ padding: "10px 12px" }}>
                  {statusChip(p.status)}
                  {p.reason ? (
                    <div style={{ color: "#888", fontSize: "11.5px", marginTop: "3px" }}>
                      {p.reason}
                    </div>
                  ) : null}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <button
                    type="button"
                    onClick={() => openDetail(p.memberId)}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "8px",
                      border: "1px solid #ff6b00",
                      background: "#fff",
                      color: "#ff6b00",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MEMBER DETAIL */}
      {detailLoading && (
        <p style={{ marginTop: "16px", color: "#777" }}>Loading member placement…</p>
      )}

      {detail && !detailLoading && (
        <div
          style={{
            marginTop: "18px",
            border: THING,
            borderRadius: "12px",
            padding: "16px",
            background: "#fbfcfe",
          }}
        >
          <h3 style={{ margin: "0 0 4px", fontSize: "17px" }}>
            {detail.member.name}{" "}
            <span style={{ color: "#888", fontWeight: 400, fontSize: "13px" }}>
              ({detail.member.memberId} · {detail.member.mobile})
            </span>
          </h3>
          <p style={{ margin: "0 0 12px", color: "#666", fontSize: "13px" }}>
            Joined {detail.member.createdAtIst || detail.member.createdAt} · Sponsor:{" "}
            {detail.member.sponsorId || "—"} · Parent:{" "}
            {detail.member.parentId || "ROOT"} ({detail.member.position || "unplaced"}) ·{" "}
            {detail.member.placed ? "Placed" : "NOT placed yet"}
          </p>

          {/* THREE DIRECT SLOTS */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "14px" }}>
            {detail.directSlots.map((slot) => (
              <div
                key={slot.slot}
                style={{
                  flex: "1 1 180px",
                  minWidth: "170px",
                  border: slot.occupied ? "1px solid #bfe6cd" : "1px dashed #c9ccd4",
                  background: slot.occupied ? "#f2fbf5" : "#fff",
                  borderRadius: "10px",
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontWeight: 800, fontSize: "13px", marginBottom: "4px" }}>
                  Slot {slot.slot} {slot.occupied ? "✓" : "— vacant"}
                </div>
                {slot.occupied ? (
                  <>
                    <div style={{ fontSize: "13px" }}>{slot.name}</div>
                    <div style={{ color: "#888", fontSize: "12px" }}>{slot.memberId}</div>
                    <div style={{ color: "#666", fontSize: "11.5px", marginTop: "3px" }}>
                      Eligibility: {slot.eligibilityAtIst || "legacy (pre-spillover)"}
                    </div>
                  </>
                ) : (
                  <div style={{ color: "#999", fontSize: "12px" }}>
                    Next eligible member lands here
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ELIGIBILITY EVENTS */}
          <h4 style={{ margin: "0 0 6px", fontSize: "14px" }}>Shopping-eligibility events</h4>
          {detail.eligibilityEvents.length === 0 ? (
            <p style={{ color: "#888", fontSize: "13px", margin: "0 0 12px" }}>
              None yet — eligibility is confirmed automatically when one of this member&apos;s
              orders is delivered.
            </p>
          ) : (
            <ul style={{ margin: "0 0 12px", paddingLeft: "18px", fontSize: "13px" }}>
              {detail.eligibilityEvents.map((e) => (
                <li key={e.id} style={{ marginBottom: "4px" }}>
                  Order #{e.orderId} ({e.orderStatus || "?"} · pay {e.orderPaymentStatus || "?"}{" "}
                  · ₹{e.orderTotalAmount || "?"}) — confirmed {e.confirmedAtIst}
                  {e.status === "Revoked" ? (
                    <> · <span style={{ color: "#b3261e" }}>Revoked ({e.revokeReason})</span></>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* AUDIT TRAIL */}
          <h4 style={{ margin: "0 0 6px", fontSize: "14px" }}>Placement audit trail</h4>
          {detail.audit.length === 0 ? (
            <p style={{ color: "#888", fontSize: "13px" }}>No audit entries.</p>
          ) : (
            <ul style={{ margin: "0 0 12px", paddingLeft: "18px", fontSize: "13px" }}>
              {detail.audit.map((a) => (
                <li key={a.id} style={{ marginBottom: "4px" }}>
                  <strong>{a.action}</strong> by {a.actor} — {a.atIst}
                  {a.details && a.details.qualifyingOrderId
                    ? ` · order #${a.details.qualifyingOrderId}`
                    : ""}
                  {a.details && a.details.parentId
                    ? ` · parent ${a.details.parentId} (${a.details.position})`
                    : ""}
                  {a.details && a.details.reason ? ` · ${a.details.reason}` : ""}
                </li>
              ))}
            </ul>
          )}

          {/* MANUAL CORRECTION */}
          {!detail.member.placed && (
            <div
              style={{
                border: "1px solid #ffd9c2",
                background: "#fff8f2",
                borderRadius: "10px",
                padding: "12px",
              }}
            >
              <strong style={{ fontSize: "13px" }}>Manual correction</strong>
              <p style={{ margin: "4px 0 8px", color: "#777", fontSize: "12.5px" }}>
                {isSuper
                  ? "Re-runs the chronological placement engine for this unplaced member (and any earlier-confirmed pending members). Requires a reason; writes an audit record. Existing placements are never rearranged."
                  : "Super Admin only."}
              </p>
              {isSuper && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <input
                    aria-label="Correction reason"
                    value={reprocessReason}
                    onChange={(e) => setReprocessReason(e.target.value)}
                    placeholder="Reason for correction (min 5 chars)"
                    style={{
                      flex: "1 1 240px",
                      padding: "8px 10px",
                      borderRadius: "8px",
                      border: THING,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => reprocess(detail.member.memberId)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: "8px",
                      border: "none",
                      background: "#1f2d4e",
                      color: "#fff",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Reprocess placement
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default FamilyPlacementPanel;
