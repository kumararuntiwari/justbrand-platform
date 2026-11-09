import { useCallback, useEffect, useState } from "react";

// =====================================================
// ADMIN — PAYMENT SETTINGS
// =====================================================
// Admin-configurable checkout payment settings (server-side, DB):
// which methods buyers see (COD always available; UPI / Bank Transfer
// optional) plus the UPI ID and bank details displayed to buyers for
// manual transfer.
//
// HONESTY RULES:
//   - No online payment gateway is integrated in this project — the
//     section says so explicitly and never claims live/auto payment.
//     UPI / bank-transfer orders stay Pending until the accounts team
//     verifies them (existing business rule, unchanged).
//   - The bank account number is write-only here (shown masked as the
//     last 4 digits); secrets are stored server-side and never
//     returned by any API.
//   - The buyer checkout reads the same values via /api/payment/config,
//     so what buyers see always matches this configuration.

import { API } from "./apiConfig";

const METHOD_META = {
  COD: {
    label: "💵 Cash on Delivery (COD)",
    note: "Always available — buyer pays cash when the order arrives.",
  },
  UPI: {
    label: "📲 UPI Transfer (manual)",
    note: "Buyer sends the order total to your UPI ID manually; the order stays Pending until your team verifies the payment.",
  },
  BankTransfer: {
    label: "🏦 Bank Transfer (manual)",
    note: "Buyer transfers to your bank account and shares the reference; the order stays Pending until verified.",
  },
};

function Card({ title, description, actions, children }) {
  return (
    <section className="products-section">
      <div className="section-title">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export default function PaymentSettings({ token, onMessage }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);

  const api = useCallback(
    async (path, options = {}) => {
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

      if (response.status === 401) throw new Error("Session expired — please log in again.");
      if (response.status === 403)
        throw new Error(data?.message || "Your staff role is not allowed to manage payment settings.");
      if (!response.ok || data?.success === false) {
        throw new Error(data?.message || `Request failed (${response.status})`);
      }

      return data;
    },
    [token]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api("/api/admin/payment/settings");
      setSettings(data.settings);
      setDraft({
        methods: new Set(data.settings.methods),
        upiId: data.settings.upiId,
        bankName: data.settings.bankName,
        bankAccountName: data.settings.bankAccountName,
        bankAccountNumber: "",
        bankIfsc: data.settings.bankIfsc,
        instructions: data.settings.instructions,
      });
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleMethod(method) {
    setDraft((prev) => {
      const next = new Set(prev.methods);
      if (next.has(method)) next.delete(method);
      else next.add(method);
      next.add("COD"); // COD stays always-on (existing invariant)
      return { ...prev, methods: next };
    });
  }

  async function save() {
    setSaving(true);
    try {
      const methods = [...draft.methods];
      const mode = ["COD", "UPI", "BankTransfer"].filter((m) => methods.includes(m)).join(",");

      await api("/api/admin/payment/settings", {
        method: "PUT",
        body: {
          mode,
          upiId: draft.upiId,
          bankName: draft.bankName,
          bankAccountName: draft.bankAccountName,
          // Empty = keep the existing server-side number.
          ...(draft.bankAccountNumber.trim() ? { bankAccountNumber: draft.bankAccountNumber.trim() } : {}),
          bankIfsc: draft.bankIfsc,
          instructions: draft.instructions,
        },
      });

      onMessage?.("✅ Payment settings saved.");
      await load();
    } catch (error) {
      onMessage?.(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="💳 Payment Settings"
      description="Choose which payment methods buyers see at checkout and configure the UPI / bank details shown for manual transfers. Buyer checkout reads these values live — what you save here is exactly what buyers see."
      actions={
        <button type="button" className="refresh-btn" onClick={load}>
          ⟳ Refresh
        </button>
      }
    >
      {loading ? (
        <div className="empty">Loading payment settings…</div>
      ) : loadError ? (
        <div className="empty">⚠️ {loadError}</div>
      ) : draft && settings ? (
        <>
          {/* honest status banner */}
          <div
            style={{
              background: "#fff7ed",
              border: "1px solid #fed7aa",
              borderRadius: 10,
              padding: "10px 14px",
              marginBottom: 16,
              fontSize: 13,
              color: "#9a3412",
            }}
          >
            <strong>⚠️ No online payment gateway is connected.</strong> UPI and bank-transfer payments are{" "}
            <strong>manual</strong> — the buyer sends the money and the order stays{" "}
            <em>Pending until verified by your accounts team</em>. Integrating a live gateway (Razorpay, PhonePe,
            Cashfree etc.) needs that provider's account + API credentials and a separate integration.
          </div>

          {/* methods */}
          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            {Object.entries(METHOD_META).map(([method, meta]) => (
              <label
                key={method}
                className="cm-checkline"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  border: "1px solid #e8ecf5",
                  borderRadius: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={draft.methods.has(method)}
                  disabled={method === "COD"} // COD is the permanent baseline
                  onChange={() => toggleMethod(method)}
                  style={{ marginTop: 3 }}
                />
                <span>
                  <strong>{meta.label}</strong>
                  {method === "COD" ? (
                    <small className="ov-note" style={{ display: "block" }}>
                      Always on — the default payment method.
                    </small>
                  ) : (
                    <small className="ov-note" style={{ display: "block" }}>
                      {meta.note}
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>

          {/* UPI details */}
          {draft.methods.has("UPI") ? (
            <div style={{ marginBottom: 18 }}>
              <label className="cm-field">
                <span className="cm-field-label">UPI ID (shown to buyers for manual payment)</span>
                <input
                  className="cm-input"
                  placeholder="yourname@upi"
                  value={draft.upiId}
                  onChange={(e) => setDraft({ ...draft, upiId: e.target.value })}
                />
              </label>
            </div>
          ) : null}

          {/* bank details */}
          {draft.methods.has("BankTransfer") ? (
            <div style={{ display: "grid", gap: 12, marginBottom: 18 }}>
              <label className="cm-field">
                <span className="cm-field-label">Bank name</span>
                <input
                  className="cm-input"
                  placeholder="e.g. HDFC Bank"
                  value={draft.bankName}
                  onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                />
              </label>
              <label className="cm-field">
                <span className="cm-field-label">Account holder name</span>
                <input
                  className="cm-input"
                  placeholder="e.g. JustBrand Enterprises"
                  value={draft.bankAccountName}
                  onChange={(e) => setDraft({ ...draft, bankAccountName: e.target.value })}
                />
              </label>
              <label className="cm-field">
                <span className="cm-field-label">
                  Bank account number{" "}
                  {settings.bankAccountLast4 ? (
                    <small className="ov-note">
                      (saved — ending {settings.bankAccountLast4}; enter a new number only to replace it)
                    </small>
                  ) : (
                    <small className="ov-note">(not saved yet)</small>
                  )}
                </span>
                <input
                  className="cm-input"
                  type="password"
                  autoComplete="off"
                  placeholder="•••••••• (write-only — never displayed)"
                  value={draft.bankAccountNumber}
                  onChange={(e) => setDraft({ ...draft, bankAccountNumber: e.target.value })}
                />
              </label>
              <label className="cm-field">
                <span className="cm-field-label">IFSC code</span>
                <input
                  className="cm-input"
                  placeholder="e.g. HDFC0000123"
                  value={draft.bankIfsc}
                  onChange={(e) => setDraft({ ...draft, bankIfsc: e.target.value.toUpperCase() })}
                />
              </label>
            </div>
          ) : null}

          {/* instructions */}
          <label className="cm-field" style={{ display: "block", marginBottom: 16 }}>
            <span className="cm-field-label">Checkout note for buyers (optional)</span>
            <input
              className="cm-input"
              maxLength={500}
              value={draft.instructions}
              onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
            />
            <small className="cm-field-hint">
              Buyers see this note with the payment methods at checkout.
            </small>
          </label>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="button" className="approve" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save payment settings"}
            </button>
            {!settings.hasSavedSettings ? (
              <small className="ov-note">
                No saved settings yet — buyers currently see the legacy default (COD only, unless configured via
                server environment).
              </small>
            ) : (
              <small className="ov-note">Saved settings are live for the buyer checkout immediately.</small>
            )}
          </div>
        </>
      ) : null}
    </Card>
  );
}
