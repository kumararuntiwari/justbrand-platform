import { useCallback, useEffect, useMemo, useState } from "react";

// =====================================================
// ADMIN — SELLER SCHEME APPROVALS
// =====================================================
// Talks to the authenticated backend endpoints:
//   GET  /api/admin/seller-schemes            (?status= optional)
//   POST /api/admin/seller-schemes/:id/approve  { note? }
//   POST /api/admin/seller-schemes/:id/reject   { note }
// Server-side authorization (requireAuth + requireRole
// "super_admin"/"manager") is the ONLY authority: this UI never
// marks a scheme approved locally — every state change comes back
// from the server response. A 401/403/409 from the server is shown
// verbatim so role enforcement is never a frontend-only check.
//
// Endpoint availability: these routes exist in this repository's
// backend source. If the connected backend is older, the list call
// 404s and the section degrades to a clearly-labelled notice instead
// of pretending to work (no production-readiness claims).

import { API } from "./apiConfig";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "Pending Approval", label: "Pending Approval" },
  { key: "Approved", label: "Approved" },
  { key: "Rejected", label: "Rejected" },
  { key: "Expired", label: "Expired" },
];

const STATUS_TAG = {
  "Pending Approval": "sec-tag-warn",
  Approved: "sec-tag-good",
  Rejected: "sec-tag-bad",
  Expired: "sec-tag",
  Draft: "sec-tag",
};

function formatDiscount(scheme) {
  if (scheme.discountType === "flat") {
    return `₹${Number(scheme.discountValue).toFixed(0)} flat off`;
  }
  return `${Number(scheme.discountValue)}% off`;
}

function formatDate(value) {
  return value ? value : "—";
}

export default function SchemeApprovals({ token, sellers, onMessage }) {
  const [schemes, setSchemes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [filter, setFilter] = useState("Pending Approval");

  // Row action dialog: { id, mode: "approve" | "reject", note, error }
  const [dialog, setDialog] = useState(null);
  const [actingId, setActingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setUnavailable(false);

    try {
      const response = await fetch(`${API}/api/admin/seller-schemes`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        setLoadError("Session expired — please log in again.");
        return;
      }

      if (response.status === 404) {
        // The connected backend does not expose the scheme routes.
        setUnavailable(true);
        return;
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || `Could not load schemes (${response.status}).`);
      }

      setSchemes(Array.isArray(data.schemes) ? data.schemes : []);
    } catch (error) {
      setLoadError(error.message || "Could not load schemes.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  const counts = useMemo(() => {
    const map = { all: schemes.length };
    for (const scheme of schemes) {
      map[scheme.status] = (map[scheme.status] || 0) + 1;
    }
    return map;
  }, [schemes]);

  const visible = useMemo(() => {
    if (filter === "all") return schemes;
    return schemes.filter((scheme) => scheme.status === filter);
  }, [schemes, filter]);

  // Enrich seller ids with the shop/staff names the panel already
  // loaded — purely cosmetic; the server response stays the source
  // of truth for every scheme field. Numeric ids are normalised
  // because SQLite may return them from a TEXT column as "1.0".
  const sellerName = useCallback(
    (sellerId) => {
      const target = String(sellerId ?? "").trim();
      const numeric = Number(target);
      const match = (sellers || []).find(
        (s) =>
          String(s.id) === target ||
          String(s.sellerCode) === target ||
          (Number.isFinite(numeric) && Number(s.id) === numeric)
      );

      if (match) {
        return match.shopName || match.name || `Seller #${match.id}`;
      }
      if (Number.isFinite(numeric)) return `Seller #${numeric}`;
      return target ? `Seller #${target}` : "Unknown seller";
    },
    [sellers]
  );

  async function act(scheme, mode, note) {
    setActingId(scheme.id);

    try {
      const response = await fetch(
        `${API}/api/admin/seller-schemes/${scheme.id}/${mode}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ note }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.message || `Request failed (${response.status}).`
        );
      }

      // Replace the row with the server's updated record — the UI
      // only ever reflects what the backend actually stored.
      setSchemes((prev) =>
        prev.map((s) => (s.id === data.scheme.id ? data.scheme : s))
      );
      setDialog(null);
      onMessage(
        mode === "approve"
          ? `✅ “${scheme.name}” approved — sellers can now run this scheme.`
          : `✅ “${scheme.name}” rejected — the seller sees your reason.`
      );
    } catch (error) {
      const message = error.message || "Action failed.";
      setDialog((prev) => (prev ? { ...prev, error: message } : prev));
      onMessage(`❌ ${message}`);
    } finally {
      setActingId(null);
    }
  }

  // ---------------- states ----------------

  if (loading) {
    return (
      <div className="sec-wrap">
        <div className="ov-skeleton-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="ov-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sec-wrap">
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>🎟️ Seller Scheme Approvals</h2>
            <p>
              Discount schemes submitted by sellers go live only after an
              admin approves them here. Approve / reject is enforced
              server-side for super_admin and manager roles.
            </p>
          </div>
          <button type="button" className="refresh-btn" onClick={load} disabled={loading}>
            ⟳ Refresh
          </button>
        </div>

        {unavailable ? (
          <div className="sch-notice">
            <strong>Scheme API not available on this backend.</strong>
            <p>
              The connected backend does not expose{" "}
              <code>/api/admin/seller-schemes</code>. These endpoints exist in
              this repository’s backend source but are not deployed yet, so
              approvals cannot be performed from here right now. Nothing is
              simulated — this section will work as soon as a scheme-enabled
              backend is connected.
            </p>
          </div>
        ) : loadError ? (
          <div className="empty">
            <p>❌ {loadError}</p>
            <button
              type="button"
              className="refresh-btn"
              style={{ marginTop: "10px" }}
              onClick={load}
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <div className="sch-tabs" role="tablist" aria-label="Scheme status filters">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.key}
                  className={`sch-tab${filter === f.key ? " sch-tab-on" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <span className="sch-tab-count">{counts[f.key] || 0}</span>
                </button>
              ))}
            </div>

            <div className="sec-tablewrap">
              {visible.length === 0 ? (
                <div className="empty">
                  {schemes.length === 0
                    ? "No schemes yet — sellers create them from My Schemes in the Seller Panel."
                    : `No schemes with status “${filter}”.`}
                </div>
              ) : (
                <table className="sec-table">
                  <thead>
                    <tr>
                      <th>Scheme</th>
                      <th>Seller</th>
                      <th>Discount</th>
                      <th>Products</th>
                      <th>Schedule</th>
                      <th>Status</th>
                      <th>Admin note</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((scheme) => (
                      <FragmentRow
                        key={scheme.id}
                        scheme={scheme}
                        sellerName={sellerName}
                        dialog={dialog && dialog.id === scheme.id ? dialog : null}
                        acting={actingId === scheme.id}
                        onOpen={(mode) =>
                          setDialog({ id: scheme.id, mode, note: "", error: "" })
                        }
                        onClose={() => setDialog(null)}
                        onNote={(note) => setDialog((d) => (d ? { ...d, note } : d))}
                        onConfirm={() =>
                          act(
                            scheme,
                            dialog.mode,
                            dialog.note.trim() ||
                              (dialog.mode === "reject" ? "Rejected by admin" : "")
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <p className="ov-note">
              Statuses: Draft → (seller submits) → Pending Approval → Approved |
              Rejected. An Approved scheme past its end date shows as Expired.
            </p>
          </>
        )}
      </section>
    </div>
  );
}

function FragmentRow({
  scheme,
  sellerName,
  dialog,
  acting,
  onOpen,
  onClose,
  onNote,
  onConfirm,
}) {
  const pending = scheme.status === "Pending Approval";

  return (
    <>
      <tr>
        <td className="sch-cell">
          <strong>{scheme.name}</strong>
          {scheme.description ? <small>{scheme.description}</small> : null}
        </td>
        <td>{sellerName(scheme.sellerId)}</td>
        <td>
          <span className="sec-tag sec-tag-family">{formatDiscount(scheme)}</span>
        </td>
        <td>
          {scheme.productIds && scheme.productIds.length ? (
            <span className="sch-chips">
              {scheme.productIds.map((id) => (
                <span key={id} className="sch-chip">
                  #{id}
                </span>
              ))}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="sch-cell">
          <small>
            {formatDate(scheme.startDate)} → {formatDate(scheme.endDate)}
          </small>
        </td>
        <td>
          <span className={`sec-tag ${STATUS_TAG[scheme.status] || "sec-tag"}`}>
            {scheme.status}
          </span>
        </td>
        <td className="sch-cell">
          <small>{scheme.adminNote || "—"}</small>
        </td>
        <td>
          {pending ? (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              <button
                type="button"
                className="approve"
                disabled={acting}
                onClick={() => onOpen("approve")}
              >
                Approve
              </button>
              <button
                type="button"
                className="reject"
                disabled={acting}
                onClick={() => onOpen("reject")}
              >
                Reject
              </button>
            </div>
          ) : (
            <span className="ov-note">No action</span>
          )}
        </td>
      </tr>

      {dialog ? (
        <tr className="sch-dialogrow">
          <td colSpan={8}>
            <div className="sch-dialog">
              <strong>
                {dialog.mode === "approve"
                  ? `Approve “${scheme.name}”?`
                  : `Reject “${scheme.name}”`}
              </strong>
              <label className="cm-field">
                <span className="cm-field-label">
                  {dialog.mode === "approve"
                    ? "Note for the seller (optional)"
                    : "Rejection reason (shown to the seller) *"}
                </span>
                <textarea
                  className="cm-input sch-note"
                  rows={3}
                  value={dialog.note}
                  placeholder={
                    dialog.mode === "approve"
                      ? "e.g. Approved for the festive season."
                      : "e.g. Discount is too deep for the selected products."
                  }
                  onChange={(e) => onNote(e.target.value)}
                  disabled={acting}
                />
              </label>
              {dialog.error ? (
                <div className="cm-error">
                  {dialog.error}
                  {(dialog.error.toLowerCase().includes("role") ||
                    dialog.error.toLowerCase().includes("forbidden")) &&
                    " (The server rejected this action for your staff role.)"}
                </div>
              ) : null}
              <div className="cm-actions">
                <button
                  type="button"
                  className={dialog.mode === "approve" ? "approve" : "reject"}
                  disabled={acting || (dialog.mode === "reject" && !dialog.note.trim())}
                  onClick={onConfirm}
                >
                  {acting
                    ? "Working…"
                    : dialog.mode === "approve"
                    ? "✓ Confirm approve"
                    : "✓ Confirm reject"}
                </button>
                <button
                  type="button"
                  className="refresh-btn"
                  onClick={onClose}
                  disabled={acting}
                >
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
