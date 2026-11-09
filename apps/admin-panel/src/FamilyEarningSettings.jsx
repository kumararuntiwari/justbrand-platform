import { useEffect, useMemo, useState } from "react";

import { API } from "./apiConfig";

const BORDER = "1px solid #e2e6ee";

const TYPE_META = {
  direct: {
    title: "A. Direct Introduce",
    icon: "🤝",
    tone: "#0f766e",
    hint: "पहले 3 सीधे introduce किए गए members की eligible shopping पर।",
  },
  spillover: {
    title: "B. Spillover",
    icon: "🧩",
    tone: "#b45309",
    hint: "4th और उसके बाद के spillover-placed members की eligible shopping पर placement parent को।",
  },
  timewise: {
    title: "C. Time-wise Shopping Chain",
    icon: "⏱️",
    tone: "#1d4ed8",
    hint: "पहले eligible shopping करने वाले upline को बाद की eligible shopping से।",
  },
};

const BASE_OPTIONS = [
  ["product_total", "Product subtotal (excl. delivery / charges)"],
  ["order_total", "Order total (incl. delivery & charges)"],
  ["items_total", "Product + Family component"],
  ["taxable_total", "Taxable value"],
];

function dateInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function money(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function editable(settings) {
  const result = {};
  for (const type of Object.keys(TYPE_META)) {
    const row = settings?.[type] || {};
    result[type] = {
      enabled: Boolean(row.enabled),
      percentage: Number(row.percentage) || 0,
      effectiveFrom: dateInput(row.effectiveFrom),
      calculationBase: row.calculationBase || "product_total",
      maxLevels: Number(row.maxLevels) || 1,
      chainLimit: Number(row.chainLimit) || 1,
    };
  }
  return result;
}

function StatusChip({ status }) {
  const tone =
    status === "Paid"
      ? { bg: "#e8f7ee", fg: "#166534" }
      : status === "Payable"
      ? { bg: "#e8f0ff", fg: "#1d4ed8" }
      : status === "Void" || status === "Reversed"
      ? { bg: "#fdecec", fg: "#b91c1c" }
      : { bg: "#fff7e6", fg: "#a16207" };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        borderRadius: "999px",
        background: tone.bg,
        color: tone.fg,
        fontSize: "11.5px",
        fontWeight: 700,
      }}
    >
      {status || "Pending"}
    </span>
  );
}

function FamilyEarningSettings({ token, isSuper, isFinance, onMessage }) {
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [audit, setAudit] = useState([]);
  const [summary, setSummary] = useState(null);
  const [commissions, setCommissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [errors, setErrors] = useState({});

  async function loadSettings() {
    setLoading(true);
    try {
      const response = await fetch(`${API}/api/admin/mlm/3x3/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Settings load failed.");
      }
      const next = editable(data.settings);
      setSettings(next);
      setSaved(next);
      setAudit(data.audit || []);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadReport(nextType = typeFilter, nextStatus = statusFilter) {
    if (!isFinance) return;
    setReportLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextType) params.set("type", nextType);
      if (nextStatus) params.set("status", nextStatus);
      const response = await fetch(
        `${API}/api/admin/mlm/3x3/commissions?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Report load failed.");
      }
      setCommissions(data.commissions || []);
      setSummary(data.summary || null);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setReportLoading(false);
    }
  }

  useEffect(() => {
    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && isFinance) loadReport("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isFinance]);

  const dirty = useMemo(
    () => Boolean(settings && saved && JSON.stringify(settings) !== JSON.stringify(saved)),
    [settings, saved]
  );

  function validate(next) {
    const result = {};
    for (const type of Object.keys(TYPE_META)) {
      const row = next[type];
      const p = Number(row.percentage);
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        result[`${type}.percentage`] = "0–100 के बीच होना चाहिए";
      }
      if (!row.effectiveFrom) {
        result[`${type}.effectiveFrom`] = "तारीख आवश्यक है";
      }
      for (const field of ["maxLevels", "chainLimit"]) {
        const n = Number(row[field]);
        if (!Number.isInteger(n) || n < 1 || n > 9) {
          result[`${type}.${field}`] = "1–9 का पूर्णांक";
        }
      }
    }
    return result;
  }

  function change(type, field, value) {
    const next = {
      ...settings,
      [type]: {
        ...settings[type],
        [field]: field === "enabled" ? Boolean(value) : value,
      },
    };
    setSettings(next);
    setErrors(validate(next));
  }

  async function save() {
    const nextErrors = validate(settings);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      onMessage("❌ पहले validation errors ठीक करें।");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`${API}/api/admin/mlm/3x3/settings`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ settings }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Save failed.");
      }
      const next = editable(data.settings);
      setSettings(next);
      setSaved(next);
      setAudit(data.audit || []);
      onMessage(`✅ ${data.message || "3×3 settings saved."}`);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return (
      <div className="ov-skeleton-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="ov-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="sec-wrap">
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>💎 Family Earning Settings — 3×3</h2>
            <p>
              Direct Introduce, Spillover और Time-wise Shopping Chain के
              अलग-अलग rules। Rates server-side हैं और हर order पर उसके
              shopping-time snapshot के साथ freeze होते हैं।
            </p>
          </div>
          <span>{isSuper ? "SUPER ADMIN" : "READ ONLY"}</span>
        </div>

        {!isSuper && (
          <p className="ov-note">
            🔒 Percentages और enable/disable केवल Super Admin बदल सकता है।
          </p>
        )}

        <p className="ov-note" style={{ background: "#fff7e6", color: "#92400e" }}>
          ⚠️ यह 3×3 layer additive है। पुरानी Family Reward Settings
          (shopping/direct/level) अपने current percentages पर अलग से चलती
          रहेंगी। Production में दोनों साथ enable करने से double payout हो
          सकता है — पहले legacy percentages disable/zero करने का निर्णय लें।
        </p>

        <div className="cm-grid3">
          {Object.entries(TYPE_META).map(([type, meta]) => {
            const row = settings[type];
            return (
              <div
                key={type}
                className="ov-kpi"
                style={{
                  padding: "16px",
                  borderTop: `3px solid ${meta.tone}`,
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <strong style={{ fontSize: "14px" }}>
                    {meta.icon} {meta.title}
                  </strong>
                  <label
                    style={{
                      display: "flex",
                      gap: "6px",
                      alignItems: "center",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      disabled={!isSuper}
                      onChange={(e) => change(type, "enabled", e.target.checked)}
                    />
                    {row.enabled ? "ON" : "OFF"}
                  </label>
                </div>
                <p style={{ color: "#6b7280", fontSize: "12px", margin: "6px 0 12px" }}>
                  {meta.hint}
                </p>

                <label style={{ fontSize: "12px", fontWeight: 700 }}>Commission %</label>
                <div style={{ display: "flex", gap: "6px", alignItems: "center", margin: "4px 0 10px" }}>
                  <input
                    type="number"
                    className="cm-input"
                    min="0"
                    max="100"
                    step="0.5"
                    value={row.percentage}
                    disabled={!isSuper}
                    onChange={(e) => change(type, "percentage", e.target.value)}
                  />
                  <span>%</span>
                </div>
                {errors[`${type}.percentage`] ? (
                  <div className="cm-error">{errors[`${type}.percentage`]}</div>
                ) : null}

                <label style={{ fontSize: "12px", fontWeight: 700 }}>Effective from (IST)</label>
                <input
                  type="date"
                  className="cm-input"
                  value={row.effectiveFrom}
                  disabled={!isSuper}
                  onChange={(e) => change(type, "effectiveFrom", e.target.value)}
                  style={{ margin: "4px 0 10px" }}
                />
                {errors[`${type}.effectiveFrom`] ? (
                  <div className="cm-error">{errors[`${type}.effectiveFrom`]}</div>
                ) : null}

                <label style={{ fontSize: "12px", fontWeight: 700 }}>Calculation base</label>
                <select
                  className="cm-input"
                  value={row.calculationBase}
                  disabled={!isSuper}
                  onChange={(e) => change(type, "calculationBase", e.target.value)}
                  style={{ margin: "4px 0 10px" }}
                >
                  {BASE_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 700 }}>Max levels</label>
                    <input
                      type="number"
                      className="cm-input"
                      min="1"
                      max="9"
                      value={row.maxLevels}
                      disabled={!isSuper}
                      onChange={(e) => change(type, "maxLevels", e.target.value)}
                      style={{ marginTop: "4px" }}
                    />
                    {errors[`${type}.maxLevels`] ? (
                      <div className="cm-error">{errors[`${type}.maxLevels`]}</div>
                    ) : null}
                  </div>
                  <div>
                    <label style={{ fontSize: "12px", fontWeight: 700 }}>Chain limit</label>
                    <input
                      type="number"
                      className="cm-input"
                      min="1"
                      max="9"
                      value={row.chainLimit}
                      disabled={!isSuper}
                      onChange={(e) => change(type, "chainLimit", e.target.value)}
                      style={{ marginTop: "4px" }}
                    />
                    {errors[`${type}.chainLimit`] ? (
                      <div className="cm-error">{errors[`${type}.chainLimit`]}</div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="cm-actions">
          <button
            type="button"
            className="approve"
            onClick={save}
            disabled={saving || !isSuper || !dirty || Object.keys(errors).length > 0}
          >
            {saving ? "Saving…" : "✓ Save 3×3 Settings"}
          </button>
          <button
            type="button"
            className="refresh-btn"
            disabled={saving || !dirty}
            onClick={() => {
              setSettings({ ...saved });
              setErrors({});
            }}
          >
            Cancel
          </button>
          {dirty ? <span className="cm-dirtytag">● Unsaved changes</span> : null}
        </div>

        <p className="ov-note">
          पुराने orders पर उनका पुराना rate ही रहेगा — order placement पर rate,
          base और effective date का immutable snapshot सेव होता है। Cancelled /
          refunded orders की commission Void हो जाती है; return window पूरा होने
          पर ही Payable बनती है।
        </p>
      </section>

      <section className="products-section" style={{ marginTop: "18px" }}>
        <div className="section-title">
          <div>
            <h2>🧾 Settings Audit History</h2>
            <p>कौन, कब और क्या बदला — append-only record.</p>
          </div>
          <button type="button" className="refresh-btn" onClick={loadSettings}>
            ↻ Refresh
          </button>
        </div>

        <div style={{ overflowX: "auto", border: BORDER, borderRadius: "12px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "720px" }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                {["When (IST)", "Actor", "Direct", "Spillover", "Time-wise", "Note"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", borderBottom: BORDER }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "22px", textAlign: "center", color: "#888" }}>
                    No settings changes recorded yet.
                  </td>
                </tr>
              )}
              {audit.map((row) => (
                <tr key={row.id} style={{ borderBottom: BORDER }}>
                  <td style={{ padding: "10px 12px" }}>
                    {new Date(row.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </td>
                  <td style={{ padding: "10px 12px" }}>{row.actor}</td>
                  {["direct", "spillover", "timewise"].map((type) => {
                    const after = row.after?.[type];
                    return (
                      <td key={type} style={{ padding: "10px 12px" }}>
                        {after
                          ? `${after.enabled ? "ON" : "OFF"} · ${after.percentage}%`
                          : "—"}
                      </td>
                    );
                  })}
                  <td style={{ padding: "10px 12px", color: "#6b7280" }}>{row.note || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="products-section" style={{ marginTop: "18px" }}>
        <div className="section-title">
          <div>
            <h2>📊 3×3 Commission History & Report</h2>
            <p>Source-scoped ledger — legacy Family rewards इस report में mix नहीं होते।</p>
          </div>
          {isFinance ? (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <select
                className="cm-input"
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  loadReport(e.target.value, statusFilter);
                }}
              >
                <option value="">All earning types</option>
                <option value="direct">Direct Introduce</option>
                <option value="spillover">Spillover</option>
                <option value="timewise">Time-wise</option>
              </select>
              <select
                className="cm-input"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  loadReport(typeFilter, e.target.value);
                }}
              >
                <option value="">All statuses</option>
                <option value="Pending">Pending</option>
                <option value="Payable">Payable</option>
                <option value="Paid">Paid</option>
                <option value="Void">Void</option>
                <option value="Reversed">Reversed</option>
              </select>
              <button
                type="button"
                className="refresh-btn"
                onClick={() => loadReport()}
                disabled={reportLoading}
              >
                {reportLoading ? "Loading…" : "↻ Refresh"}
              </button>
            </div>
          ) : null}
        </div>

        {!isFinance ? (
          <p className="ov-note">
            🔒 Commission report केवल Super Admin / Accountant के लिए उपलब्ध है।
          </p>
        ) : (
          <>
            <div className="cm-grid3" style={{ marginBottom: "14px" }}>
              {["direct", "spillover", "timewise"].map((type) => {
                const row = summary?.[type];
                const pending = Number(row?.pending?.amount || 0);
                const payable = Number(row?.payable?.amount || 0);
                const paid = Number(row?.paid?.amount || 0);
                return (
                  <div key={type} className="ov-kpi" style={{ padding: "14px", textAlign: "left" }}>
                    <strong>{TYPE_META[type].icon} {TYPE_META[type].title}</strong>
                    <div style={{ marginTop: "8px", fontSize: "13px", lineHeight: 1.7 }}>
                      <div>Pending: <b>{money(pending)}</b></div>
                      <div>Payable: <b>{money(payable)}</b></div>
                      <div>Paid: <b>{money(paid)}</b></div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ overflowX: "auto", border: BORDER, borderRadius: "12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px", minWidth: "920px" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", textAlign: "left" }}>
                    {[
                      "Member",
                      "Type",
                      "Order",
                      "Rate / Base",
                      "Amount",
                      "Status",
                      "Payable at (IST)",
                    ].map((h) => (
                      <th key={h} style={{ padding: "10px 12px", borderBottom: BORDER }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {commissions.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ padding: "22px", textAlign: "center", color: "#888" }}>
                    {reportLoading ? "Loading report…" : "No 3×3 commission rows for this filter."}
                      </td>
                    </tr>
                  )}
                  {commissions.map((row) => (
                    <tr key={row.id} style={{ borderBottom: BORDER }}>
                      <td style={{ padding: "10px 12px" }}>
                        <strong>{row.memberName || row.memberId}</strong>
                        <div style={{ color: "#888", fontSize: "12px" }}>{row.memberId}</div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>{TYPE_META[row.type]?.title || row.type}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {row.orderId ? `#${row.orderId}` : "—"}
                        <div style={{ color: "#888", fontSize: "12px" }}>
                          {row.orderNumber || ""}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {row.percentage != null ? `${row.percentage}%` : "—"}
                        <div style={{ color: "#888", fontSize: "12px" }}>
                          {money(row.base_amount)} · {row.calculation_base || "—"}
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 800 }}>{money(row.amount)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <StatusChip status={row.status} />
                      </td>
                      <td style={{ padding: "10px 12px" }}>
                        {row.payableAt
                          ? new Date(row.payableAt).toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                            })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default FamilyEarningSettings;
