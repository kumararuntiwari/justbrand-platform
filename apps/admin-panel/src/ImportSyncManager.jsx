// =====================================================
// ADMIN — SELLER IMPORT & SUPPLIER SYNC
// =====================================================
// Backs the admin controls for the seller import ecosystem:
//   • approve / reject a seller's supplier API integration
//   • seller-wise bulk import history
//   • seller-wise sync history with failed items / connection errors
//   • configurable bulk-import limits + sync frequency
//
// Server-side authorization (requireAuth + requireRole
// "super_admin"/"manager") is the only authority — every state change
// comes from a server response, never from local state. Credentials
// are write-only: the API returns a masked key hint, never the key.

import { useEffect, useState } from "react";
import { API } from "./apiConfig";
import MarketplaceManager from "./MarketplaceManager.jsx";
import GstManager from "./GstManager.jsx";

const TABS = [
  { key: "integrations", label: "🔗 Supplier APIs" },
  { key: "marketplaces", label: "🏬 Marketplaces" },
  { key: "gst", label: "🧾 GST Manager" },
  { key: "margins", label: "💰 Profit Margins" },
  { key: "imports", label: "📥 Bulk Imports" },
  { key: "syncs", label: "🔄 Sync Runs" },
  { key: "settings", label: "⚙️ Limits & Schedule" },
];

const EMPTY_SETTINGS = {
  maxRowsPerImport: 2000,
  maxImportsPerDay: 10,
  maxSyncItems: 500,
  minSyncFrequencyMinutes: 15,
  autoSyncEnabled: true,
  scheduleMode: "global",
  scheduleTime: "00:00",
  scheduleTimezone: "Asia/Kolkata",
  scheduleFrequencyMinutes: 1440,
  syncRetryLimit: 2,
  syncRetryBackoffMinutes: 15,
};

const EMPTY_MARGIN_DRAFT = {
  scopeType: "global",
  scopeId: "",
  marginType: "percent",
  marginValue: 20,
  notes: "",
  reason: "",
};

const EMPTY_PREVIEW = {
  supplierPrice: 1000,
  category: "",
  sellerId: "",
  integrationId: "",
  marginType: "percent",
  marginValue: 20,
  result: null,
};

function statusClass(status) {
  if (["Approved", "success", "Imported"].includes(status)) return "sec-tag sec-tag-good";
  if (["Rejected", "failed"].includes(status)) return "sec-tag sec-tag-bad";
  if (["Pending Approval", "partial", "Previewed"].includes(status)) return "sec-tag sec-tag-warn";
  return "sec-tag";
}

function formatDate(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—";
}

export default function ImportSyncManager({ token, onMessage }) {
  const [tab, setTab] = useState("integrations");

  const [integrations, setIntegrations] = useState([]);
  const [imports, setImports] = useState([]);
  const [runs, setRuns] = useState([]);
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [draft, setDraft] = useState(EMPTY_SETTINGS);

  const [margins, setMargins] = useState({ rules: [], audit: [], options: { sellers: [], suppliers: [], categories: [] } });
  const [marginDraft, setMarginDraft] = useState(EMPTY_MARGIN_DRAFT);
  const [previewDraft, setPreviewDraft] = useState(EMPTY_PREVIEW);
  const [savingMargin, setSavingMargin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [rejectId, setRejectId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      throw new Error(data?.message || `Request failed (HTTP ${response.status}).`);
    }
    return data;
  }

  async function loadAll() {
    setLoading(true);
    setError("");

    const results = await Promise.allSettled([
      request("/api/admin/seller-integrations"),
      request("/api/admin/margins"),
      request("/api/admin/product-imports"),
      request("/api/admin/supplier-sync-runs"),
      request("/api/admin/import-settings"),
    ]);

    if (results[0].status === "fulfilled") setIntegrations(results[0].value.integrations || []);
    if (results[1].status === "fulfilled") {
      setMargins({
        rules: results[1].value.rules || [],
        audit: results[1].value.audit || [],
        options: results[1].value.options || { sellers: [], suppliers: [], categories: [] },
      });
    }
    if (results[2].status === "fulfilled") setImports(results[2].value.imports || []);
    if (results[3].status === "fulfilled") setRuns(results[3].value.runs || []);

    if (results[4].status === "fulfilled") {
      const loaded = { ...EMPTY_SETTINGS, ...(results[4].value.settings || {}) };
      setSettings(loaded);
      setDraft(loaded);
    } else {
      setDraft((prev) => ({ ...prev, ...settings }));
    }

    const failedCall = results.find((result) => result.status === "rejected");
    if (failedCall) setError(failedCall.reason?.message || "Could not load import data.");

    setLoading(false);
  }

  function notify(text) {
    if (onMessage) onMessage(text);
  }

  async function approve(integration) {
    setBusyId(integration.id);
    setError("");
    try {
      const data = await request(`/api/admin/seller-integrations/${integration.id}/approve`, { method: "POST" });
      notify(data.message || "Integration approved.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(integration) {
    setBusyId(integration.id);
    setError("");
    try {
      const data = await request(`/api/admin/seller-integrations/${integration.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason }),
      });
      notify(data.message || "Integration rejected.");
      setRejectId(null);
      setRejectReason("");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function saveSettings() {
    setSavingSettings(true);
    setError("");
    try {
      const data = await request("/api/admin/import-settings", {
        method: "PUT",
        body: JSON.stringify({
          maxRowsPerImport: Number(draft.maxRowsPerImport),
          maxImportsPerDay: Number(draft.maxImportsPerDay),
          maxSyncItems: Number(draft.maxSyncItems),
          minSyncFrequencyMinutes: Number(draft.minSyncFrequencyMinutes),
          autoSyncEnabled: Boolean(draft.autoSyncEnabled),
          scheduleMode: draft.scheduleMode,
          scheduleTime: draft.scheduleTime,
          scheduleTimezone: draft.scheduleTimezone,
          scheduleFrequencyMinutes: Number(draft.scheduleFrequencyMinutes),
          syncRetryLimit: Number(draft.syncRetryLimit),
          syncRetryBackoffMinutes: Number(draft.syncRetryBackoffMinutes),
        }),
      });
      const loaded = { ...EMPTY_SETTINGS, ...(data.settings || {}) };
      setSettings(loaded);
      setDraft(loaded);
      notify(data.message || "Settings saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingSettings(false);
    }
  }

  function editMargin(rule) {
    setMarginDraft({
      scopeType: rule.scopeType,
      scopeId: rule.scopeId || "",
      marginType: rule.marginType,
      marginValue: rule.marginValue,
      notes: rule.notes || "",
      reason: "",
    });
  }

  async function saveMargin() {
    setSavingMargin(true);
    setError("");
    try {
      const data = await request("/api/admin/margins", {
        method: "PUT",
        body: JSON.stringify({
          scopeType: marginDraft.scopeType,
          scopeId: marginDraft.scopeId,
          marginType: marginDraft.marginType,
          marginValue: Number(marginDraft.marginValue),
          notes: marginDraft.notes,
          reason: marginDraft.reason,
        }),
      });

      notify(data.message || "Margin rule saved.");
      await loadAll();
      setMarginDraft((prev) => ({ ...prev, reason: "" }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMargin(false);
    }
  }

  async function removeMargin(rule) {
    setSavingMargin(true);
    setError("");
    try {
      const data = await request(`/api/admin/margins/${rule.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: "Removed from Profit Margins" }),
      });
      notify(data.message || "Margin rule deleted.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMargin(false);
    }
  }

  async function previewMargin() {
    setError("");
    try {
      const data = await request("/api/admin/margins/preview", {
        method: "POST",
        body: JSON.stringify({
          supplierPrice: Number(previewDraft.supplierPrice),
          category: previewDraft.category,
          sellerId: previewDraft.sellerId ? Number(previewDraft.sellerId) : null,
          integrationId: previewDraft.integrationId ? Number(previewDraft.integrationId) : null,
          marginType: previewDraft.marginType,
          marginValue: Number(previewDraft.marginValue),
        }),
      });
      setPreviewDraft((prev) => ({ ...prev, result: data.preview }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function repriceIntegration(integration) {
    setBusyId(integration.id);
    setError("");
    try {
      const data = await request(`/api/admin/seller-integrations/${integration.id}/reprice`, {
        method: "POST",
      });
      notify(data.message || "Supplier products repriced.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function runIntegrationSync(integration) {
    setBusyId(integration.id);
    setError("");
    try {
      const data = await request(`/api/admin/seller-integrations/${integration.id}/sync`, {
        method: "POST",
      });
      notify(data.message || "Sync finished.");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const pendingCount = integrations.filter((row) => row.status === "Pending Approval").length;
  const problemCount = integrations.filter((row) => row.connectionStatus === "Error").length;

  return (
    <div>
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>📥 Seller Import &amp; Supplier Sync</h2>
            <p>
              Approve supplier APIs, review seller-wise import / sync history and set marketplace limits.
              Imported and synced products still go through your normal product approval.
            </p>
          </div>
          <span>
            {pendingCount} pending · {problemCount} connection error(s)
          </span>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={tab === item.key ? "sec-tag sec-tag-warn" : "sec-tag"}
              style={{
                border: "1px solid " + (tab === item.key ? "#f0c36d" : "#e7e7ec"),
                padding: "9px 14px",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? (
          <div style={{ marginTop: "14px", padding: "10px 14px", borderRadius: "10px", background: "#fff0f0", color: "#c00", fontSize: "13px" }}>
            {error}
          </div>
        ) : null}
      </section>

      {loading ? (
        <section className="products-section">
          <p style={{ margin: 0, color: "#6b6b74" }}>Loading…</p>
        </section>
      ) : null}

      {!loading && tab === "integrations" ? (
        <section className="products-section">
          <div className="section-title">
            <div>
              <h2>Supplier API integrations</h2>
              <p>Credentials are encrypted server-side. Only a masked key hint is shown.</p>
            </div>
            <span>{integrations.length} total</span>
          </div>

          {integrations.length === 0 ? (
            <p style={{ margin: 0, color: "#6b6b74" }}>No seller has connected a supplier API yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {integrations.map((row) => (
                <div key={row.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>
                        {row.providerName || "Unnamed supplier"}{" "}
                        <span className={statusClass(row.status)}>{row.status}</span>{" "}
                        <span className={row.connectorInfo?.certified ? "sec-tag" : "sec-tag sec-tag-warn"}>
                          {row.connectorInfo?.label || row.connector || "Generic"}
                          {row.connectorInfo?.certified ? "" : " · unverified"}
                        </span>
                      </div>
                      <div style={{ fontSize: "12.5px", color: "#55555e", marginTop: "4px" }}>
                        {row.shopName || row.sellerName} · {row.sellerCode || `seller #${row.sellerId}`}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b6b74", marginTop: "6px", wordBreak: "break-all" }}>
                        {row.baseUrl}
                        {row.productsPath ? ` · ${row.productsPath}` : ""} · auth: {row.authType}
                        {row.authHeaderName ? ` (${row.authHeaderName})` : ""} · key: {row.apiKeyHint || "not set"}
                      </div>
                      <div style={{ fontSize: "12px", color: "#6b6b74", marginTop: "4px" }}>
                        Sync every {row.syncFrequencyMinutes} min · auto-sync {row.autoSync ? "on" : "off"} · last sync{" "}
                        {formatDate(row.lastSyncAt)} ({row.lastSyncStatus || "never"}) · last successful{" "}
                        {formatDate(row.lastSuccessfulSyncAt)} · next {formatDate(row.nextSyncAt)}
                        {row.syncRetryCount ? ` · retry ${row.syncRetryCount}` : ""}
                      </div>
                      {row.connectorInfo && !row.connectorInfo.certified ? (
                        <div style={{ marginTop: "6px", padding: "8px 10px", borderRadius: "8px", background: "#fff8ea", color: "#8a5b00", fontSize: "11.5px", lineHeight: 1.6 }}>
                          <b>{row.connectorInfo.label} — unverified connector.</b> {row.connectorInfo.notes}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-start" }}>
                      <button
                        type="button"
                        disabled={busyId === row.id || row.status === "Approved"}
                        onClick={() => approve(row)}
                        style={approveBtn}
                      >
                        ✅ Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => {
                          setRejectId(row.id);
                          setRejectReason("");
                        }}
                        style={rejectBtn}
                      >
                        ⛔ Reject
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id || row.status !== "Approved"}
                        onClick={() => runIntegrationSync(row)}
                        style={ghostBtn}
                      >
                        🔄 Sync now
                      </button>
                      <button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => repriceIntegration(row)}
                        style={ghostBtn}
                        title="Recompute selling prices from the raw supplier price with the current margin rules"
                      >
                        💰 Reprice
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "10px", fontSize: "12px" }}>
                    <span>
                      Connection: <b>{row.connectionStatus}</b>
                    </span>
                    <span>
                      Tested: <b>{formatDate(row.lastTestedAt)}</b>
                    </span>
                    {row.lastTestError ? <span style={{ color: "#c00" }}>Test error: {row.lastTestError}</span> : null}
                    {row.lastSyncError ? <span style={{ color: "#c00" }}>Sync error: {row.lastSyncError}</span> : null}
                    {row.rejectionReason ? <span style={{ color: "#a06a00" }}>Rejection: {row.rejectionReason}</span> : null}
                  </div>

                  {rejectId === row.id ? (
                    <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <input
                        value={rejectReason}
                        onChange={(event) => setRejectReason(event.target.value)}
                        placeholder="Reason shown to the seller (e.g. credentials not verified)"
                        style={{ ...inputStyle, flex: "1 1 280px" }}
                      />
                      <button type="button" style={rejectBtn} disabled={busyId === row.id} onClick={() => reject(row)}>
                        Confirm reject
                      </button>
                      <button type="button" style={ghostBtn} onClick={() => setRejectId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === "marketplaces" ? (
        <section className="products-section" style={{ marginTop: "16px" }}>
          <div className="section-title">
            <div>
              <h2>🏬 Marketplace integrations</h2>
              <p>
                Amazon SP-API, Flipkart Seller API, Meesho (API access required) and GlowRoad (API key). Credentials and
                tokens are encrypted server-side; only hints and status are shown.
              </p>
            </div>
          </div>
          <MarketplaceManager token={token} onMessage={notify} />
        </section>
      ) : null}

      {!loading && tab === "gst" ? (
        <section className="products-section" style={{ marginTop: "16px" }}>
          <div className="section-title">
            <div>
              <h2>🧾 GST Manager</h2>
              <p>
                Category / subcategory / HSN GST mappings with admin approval, effective dates, CGST+SGST vs IGST
                split, CSV / Excel import and a product-wise GST review report.
              </p>
            </div>
          </div>
          <GstManager token={token} onMessage={notify} />
        </section>
      ) : null}

      {!loading && tab === "margins" ? (
        <section className="products-section">
          <div className="section-title">
            <div>
              <h2>💰 Profit margin rules</h2>
              <p>
                Selling price = supplier price + JustBrand markup. GST, platform fee and delivery are then applied ONCE
                by the existing pricing engine. Supplier cost and markup are stored separately, so a re-sync never
                applies markup twice.
              </p>
            </div>
            <span>{margins.rules.length} rules</span>
          </div>

          <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))" }}>
            {margins.rules.map((rule) => (
              <div key={rule.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" }}>
                  <b style={{ fontSize: "13px" }}>{rule.scopeLabel}</b>
                  <span className="sec-tag">{rule.scopeType}</span>
                </div>
                <div style={{ fontSize: "22px", fontWeight: 800, marginTop: "8px" }}>
                  {rule.marginType === "percent" ? `${rule.marginValue}%` : `₹${rule.marginValue}`}
                </div>
                <div style={{ fontSize: "11.5px", color: "#9a9aa3", marginTop: "4px" }}>
                  updated {formatDate(rule.updatedAt || rule.createdAt)}
                  {rule.updatedBy ? ` by ${rule.updatedBy}` : ""}
                </div>
                {rule.notes ? (
                  <div style={{ fontSize: "12px", color: "#55555e", marginTop: "6px" }}>{rule.notes}</div>
                ) : null}
                <div style={{ display: "flex", gap: "8px", marginTop: "10px", flexWrap: "wrap" }}>
                  <button type="button" style={ghostBtn} onClick={() => editMargin(rule)}>
                    Edit
                  </button>
                  {rule.scopeType !== "global" ? (
                    <button
                      type="button"
                      style={rejectBtn}
                      disabled={savingMargin}
                      onClick={() => removeMargin(rule)}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...cardStyle, marginTop: "16px", display: "grid", gap: "12px" }}>
            <div>
              <h3 style={h3Style}>Set / update a rule</h3>
              <p style={hintStyle}>
                Precedence: marketplace → supplier → category → seller → global. The most specific matching rule wins.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "12px" }}>
              <label style={labelStyle}>
                Scope
                <select
                  style={inputStyle}
                  value={marginDraft.scopeType}
                  onChange={(event) =>
                    setMarginDraft({ ...marginDraft, scopeType: event.target.value, scopeId: "" })
                  }
                >
                  <option value="global">Global default</option>
                  <option value="seller">Seller</option>
                  <option value="supplier">Supplier</option>
                  <option value="marketplace">Marketplace integration</option>
                  <option value="category">Product category</option>
                </select>
              </label>

              {marginDraft.scopeType === "seller" ? (
                <label style={labelStyle}>
                  Seller
                  <select
                    style={inputStyle}
                    value={marginDraft.scopeId}
                    onChange={(event) => setMarginDraft({ ...marginDraft, scopeId: event.target.value })}
                  >
                    <option value="">Choose a seller…</option>
                    {margins.options.sellers.map((seller) => (
                      <option key={seller.id} value={seller.id}>
                        {seller.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {marginDraft.scopeType === "supplier" ? (
                <label style={labelStyle}>
                  Supplier
                  <select
                    style={inputStyle}
                    value={marginDraft.scopeId}
                    onChange={(event) => setMarginDraft({ ...marginDraft, scopeId: event.target.value })}
                  >
                    <option value="">Choose a supplier…</option>
                    {margins.options.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {marginDraft.scopeType === "marketplace" ? (
                <label style={labelStyle}>
                  Marketplace
                  <select
                    style={inputStyle}
                    value={marginDraft.scopeId}
                    onChange={(event) => setMarginDraft({ ...marginDraft, scopeId: event.target.value })}
                  >
                    <option value="">Choose a marketplace connection…</option>
                    {(margins.options.marketplaces || []).map((marketplace) => (
                      <option key={marketplace.id} value={marketplace.id}>
                        {marketplace.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {marginDraft.scopeType === "category" ? (
                <label style={labelStyle}>
                  Category
                  <input
                    style={inputStyle}
                    list="jb-margin-categories"
                    value={marginDraft.scopeId}
                    onChange={(event) => setMarginDraft({ ...marginDraft, scopeId: event.target.value })}
                    placeholder="e.g. Electronics"
                  />
                  <datalist id="jb-margin-categories">
                    {margins.options.categories.map((category) => (
                      <option key={category} value={category} />
                    ))}
                  </datalist>
                </label>
              ) : null}

              <label style={labelStyle}>
                Markup type
                <select
                  style={inputStyle}
                  value={marginDraft.marginType}
                  onChange={(event) => setMarginDraft({ ...marginDraft, marginType: event.target.value })}
                >
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed rupee amount</option>
                </select>
              </label>

              <label style={labelStyle}>
                {marginDraft.marginType === "percent" ? "Markup %" : "Markup ₹"}
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  step="0.01"
                  value={marginDraft.marginValue}
                  onChange={(event) => setMarginDraft({ ...marginDraft, marginValue: event.target.value })}
                />
              </label>

              <label style={labelStyle}>
                Note (optional)
                <input
                  style={inputStyle}
                  value={marginDraft.notes}
                  onChange={(event) => setMarginDraft({ ...marginDraft, notes: event.target.value })}
                  placeholder="e.g. Appliances category margin"
                />
              </label>

              <label style={labelStyle}>
                Change reason (audit)
                <input
                  style={inputStyle}
                  value={marginDraft.reason}
                  onChange={(event) => setMarginDraft({ ...marginDraft, reason: event.target.value })}
                  placeholder="Why this change?"
                />
              </label>
            </div>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <button type="button" onClick={saveMargin} disabled={savingMargin} style={approveBtn}>
                {savingMargin ? "Saving…" : "💾 Save rule"}
              </button>
              <button type="button" onClick={() => setMarginDraft(EMPTY_MARGIN_DRAFT)} style={ghostBtn}>
                Reset
              </button>
            </div>
          </div>

          <div style={{ ...cardStyle, marginTop: "16px" }}>
            <h3 style={h3Style}>Price preview</h3>
            <p style={hintStyle}>
              Example: supplier ₹1,000 + 20% → selling ₹1,200; ₹1,000 + ₹100 fixed → ₹1,100. Final customer price
              below already includes GST / platform fee / delivery exactly once.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "12px", marginTop: "10px" }}>
              <label style={labelStyle}>
                Supplier price ₹
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  value={previewDraft.supplierPrice}
                  onChange={(event) => setPreviewDraft({ ...previewDraft, supplierPrice: event.target.value })}
                />
              </label>
              <label style={labelStyle}>
                Markup type
                <select
                  style={inputStyle}
                  value={previewDraft.marginType}
                  onChange={(event) => setPreviewDraft({ ...previewDraft, marginType: event.target.value })}
                >
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed ₹</option>
                </select>
              </label>
              <label style={labelStyle}>
                Markup
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  step="0.01"
                  value={previewDraft.marginValue}
                  onChange={(event) => setPreviewDraft({ ...previewDraft, marginValue: event.target.value })}
                />
              </label>
              <label style={labelStyle}>
                Category (for GST)
                <input
                  style={inputStyle}
                  value={previewDraft.category}
                  onChange={(event) => setPreviewDraft({ ...previewDraft, category: event.target.value })}
                  placeholder="e.g. Electronics"
                />
              </label>
            </div>

            <div style={{ marginTop: "10px" }}>
              <button type="button" onClick={previewMargin} style={ghostBtn}>
                🔍 Calculate preview
              </button>
            </div>

            {previewDraft.result ? (
              <div style={{ marginTop: "12px", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                  <tbody>
                    {previewDraft.result.breakdown.map((line) => (
                      <tr key={line.key} style={{ borderTop: "1px solid #f0f0f3" }}>
                        <td style={{ ...tdStyle, color: "#55555e" }}>{line.label}</td>
                        <td style={{ ...tdStyle, textAlign: "right", fontWeight: line.key === "customerPrice" ? 800 : 600 }}>
                          ₹{Number(line.amount).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={hintStyle}>
                  Matched rule level: <b>{previewDraft.result.marginLevel}</b> · supplier price ₹
                  {Number(previewDraft.result.supplierPrice).toFixed(2)} · markup ₹
                  {Number(previewDraft.result.markupAmount).toFixed(2)} · selling ₹
                  {Number(previewDraft.result.sellingPrice).toFixed(2)}
                </p>
              </div>
            ) : null}
          </div>

          <div style={{ ...cardStyle, marginTop: "16px" }}>
            <h3 style={h3Style}>Audit history</h3>
            <p style={hintStyle}>Every margin change keeps the previous and new value — append-only.</p>
            {margins.audit.length === 0 ? (
              <p style={{ margin: 0, color: "#6b6b74", fontSize: "12.5px" }}>No margin changes recorded yet.</p>
            ) : (
              <div style={{ overflowX: "auto", marginTop: "10px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                  <thead>
                    <tr style={{ background: "#fafafc", textAlign: "left" }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>When</th>
                      <th style={thStyle}>Action</th>
                      <th style={thStyle}>Scope</th>
                      <th style={thStyle}>Before</th>
                      <th style={thStyle}>After</th>
                      <th style={thStyle}>By</th>
                      <th style={thStyle}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {margins.audit.map((entry) => (
                      <tr key={entry.id} style={{ borderTop: "1px solid #f0f0f3" }}>
                        <td style={tdStyle}>{entry.id}</td>
                        <td style={tdStyle}>{formatDate(entry.changedAt)}</td>
                        <td style={tdStyle}>{entry.action}</td>
                        <td style={tdStyle}>{entry.scopeKey}</td>
                        <td style={tdStyle}>
                          {entry.before ? `${entry.before.marginType === "percent" ? "%" : "₹"}${entry.before.marginValue}` : "—"}
                        </td>
                        <td style={tdStyle}>
                          {entry.after ? `${entry.after.marginType === "percent" ? "%" : "₹"}${entry.after.marginValue}` : "—"}
                        </td>
                        <td style={tdStyle}>{entry.changedBy || "—"}</td>
                        <td style={tdStyle}>{entry.reason || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {!loading && tab === "imports" ? (
        <section className="products-section">
          <div className="section-title">
            <div>
              <h2>Seller-wise bulk import history</h2>
              <p>Last 100 uploads, with duplicate-SKU and error counts per file.</p>
            </div>
            <span>{imports.length} entries</span>
          </div>

          {imports.length === 0 ? (
            <p style={{ margin: 0, color: "#6b6b74" }}>No seller has uploaded a product file yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                <thead>
                  <tr style={{ background: "#fafafc", textAlign: "left" }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Seller</th>
                    <th style={thStyle}>File</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle}>Rows</th>
                    <th style={thStyle}>Valid</th>
                    <th style={thStyle}>Errors</th>
                    <th style={thStyle}>Duplicates</th>
                    <th style={thStyle}>Imported</th>
                    <th style={thStyle}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((row) => (
                    <tr key={row.id} style={{ borderTop: "1px solid #f0f0f3" }}>
                      <td style={tdStyle}>{row.id}</td>
                      <td style={tdStyle}>
                        <b>{row.shopName || row.sellerName}</b>
                        <div style={{ color: "#9a9aa3", fontSize: "11px" }}>{row.sellerCode || `#${row.sellerId}`}</div>
                      </td>
                      <td style={tdStyle}>{row.fileName || "—"}</td>
                      <td style={tdStyle}>
                        <span className={statusClass(row.status)}>{row.status}</span>
                      </td>
                      <td style={tdStyle}>{row.totalRows}</td>
                      <td style={tdStyle}>{row.validRows}</td>
                      <td style={{ ...tdStyle, color: row.errorRows ? "#c00" : undefined }}>{row.errorRows}</td>
                      <td style={{ ...tdStyle, color: row.duplicateRows ? "#a06a00" : undefined }}>{row.duplicateRows}</td>
                      <td style={tdStyle}>{row.importedRows}</td>
                      <td style={tdStyle}>{formatDate(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === "syncs" ? (
        <section className="products-section">
          <div className="section-title">
            <div>
              <h2>Supplier sync runs</h2>
              <p>Manual and scheduled runs, with the failed items reported by the connector.</p>
            </div>
            <span>{runs.length} runs</span>
          </div>

          {runs.length === 0 ? (
            <p style={{ margin: 0, color: "#6b6b74" }}>No supplier sync has run yet.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {runs.map((run) => (
                <div key={run.id} style={{ ...cardStyle, padding: "14px" }}>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", fontSize: "12.5px" }}>
                    <span className={statusClass(run.status)}>{run.status}</span>
                    <b>#{run.id}</b>
                    <span>{run.shopName || run.sellerName}</span>
                    <span style={{ color: "#6b6b74" }}>{run.providerName || "supplier API"}</span>
                    <span>{run.trigger}</span>
                    <span style={{ color: "#6b6b74" }}>{formatDate(run.startedAt)}</span>
                    <span>fetched {run.fetched}</span>
                    <span>created {run.created}</span>
                    <span>updated {run.updated}</span>
                    <span style={{ color: run.failed ? "#c00" : undefined }}>failed {run.failed}</span>
                  </div>
                  {Array.isArray(run.errors) && run.errors.length > 0 ? (
                    <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#c00" }}>
                      {run.errors.slice(0, 10).map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                      {run.errors.length > 10 ? <li>… {run.errors.length - 10} more</li> : null}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && tab === "settings" ? (
        <section className="products-section">
          <div className="section-title">
            <div>
              <h2>Bulk import limits &amp; sync frequency</h2>
              <p>Applies to every seller. Lowering a value affects new imports only.</p>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "14px" }}>
            <NumberField
              label="Max rows per import file"
              hint="Hard cap checked before a preview is created."
              value={draft.maxRowsPerImport}
              min={1}
              max={20000}
              onChange={(value) => setDraft({ ...draft, maxRowsPerImport: value })}
            />
            <NumberField
              label="Max imports per seller per day"
              hint="Counts committed (Imported) files."
              value={draft.maxImportsPerDay}
              min={1}
              max={200}
              onChange={(value) => setDraft({ ...draft, maxImportsPerDay: value })}
            />
            <NumberField
              label="Max items per supplier sync"
              hint="Products read from one supplier API call."
              value={draft.maxSyncItems}
              min={1}
              max={5000}
              onChange={(value) => setDraft({ ...draft, maxSyncItems: value })}
            />
            <NumberField
              label="Minimum sync frequency (minutes)"
              hint="Fastest schedule a seller can choose."
              value={draft.minSyncFrequencyMinutes}
              min={5}
              max={10080}
              onChange={(value) => setDraft({ ...draft, minSyncFrequencyMinutes: value })}
            />
          </div>

          <div style={{ marginTop: "22px", paddingTop: "18px", borderTop: "1px solid #f0f0f3" }}>
            <h3 style={h3Style}>Automatic stock &amp; price sync schedule</h3>
            <p style={hintStyle}>
              Default: every day at 12:00 AM (00:00) Asia/Kolkata. Changing the schedule recalculates each approved
              supplier’s next run immediately.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "14px", marginTop: "10px" }}>
              <label style={labelStyle}>
                Schedule applies to
                <select
                  style={inputStyle}
                  value={draft.scheduleMode}
                  onChange={(event) => setDraft({ ...draft, scheduleMode: event.target.value })}
                >
                  <option value="global">Global schedule (all suppliers)</option>
                  <option value="seller">Seller-selected frequency (respecting minimum)</option>
                </select>
              </label>

              <label style={labelStyle}>
                Run time (24-hour)
                <input
                  style={inputStyle}
                  type="time"
                  value={draft.scheduleTime}
                  onChange={(event) => setDraft({ ...draft, scheduleTime: event.target.value })}
                />
              </label>

              <label style={labelStyle}>
                Timezone
                <select
                  style={inputStyle}
                  value={draft.scheduleTimezone}
                  onChange={(event) => setDraft({ ...draft, scheduleTimezone: event.target.value })}
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                </select>
              </label>

              <NumberField
                label="Frequency (minutes)"
                hint="1440 = once a day at the time above."
                value={draft.scheduleFrequencyMinutes}
                min={5}
                max={10080}
                onChange={(value) => setDraft({ ...draft, scheduleFrequencyMinutes: value })}
              />

              <NumberField
                label="Retries after a failed sync"
                hint="0 disables automatic retry."
                value={draft.syncRetryLimit}
                min={0}
                max={5}
                onChange={(value) => setDraft({ ...draft, syncRetryLimit: value })}
              />

              <NumberField
                label="Retry delay (minutes)"
                hint="Wait before each retry."
                value={draft.syncRetryBackoffMinutes}
                min={5}
                max={1440}
                onChange={(value) => setDraft({ ...draft, syncRetryBackoffMinutes: value })}
              />
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "18px", fontSize: "13.5px" }}>
            <input
              type="checkbox"
              checked={Boolean(draft.autoSyncEnabled)}
              onChange={(event) => setDraft({ ...draft, autoSyncEnabled: event.target.checked })}
            />
            Allow scheduled supplier sync across the marketplace (global switch)
          </label>

          <div style={{ display: "flex", gap: "10px", marginTop: "18px", flexWrap: "wrap" }}>
            <button type="button" onClick={saveSettings} disabled={savingSettings} style={approveBtn}>
              {savingSettings ? "Saving…" : "💾 Save limits"}
            </button>
            <button type="button" onClick={() => setDraft(settings)} style={ghostBtn} disabled={savingSettings}>
              Reset
            </button>
          </div>

          <p style={{ marginTop: "14px", fontSize: "12px", color: "#9a9aa3" }}>
            Current saved values: {settings.maxRowsPerImport} rows/import · {settings.maxImportsPerDay} imports/day ·{" "}
            {settings.maxSyncItems} items/sync · min {settings.minSyncFrequencyMinutes} min · scheduled sync{" "}
            {settings.autoSyncEnabled ? "enabled" : "disabled"} · {settings.scheduleMode === "global" ? "global" : "seller"}{" "}
            schedule {settings.scheduleTime} {settings.scheduleTimezone} every {settings.scheduleFrequencyMinutes} min ·{" "}
            {settings.syncRetryLimit} retr{settings.syncRetryLimit === 1 ? "y" : "ies"} after{" "}
            {settings.syncRetryBackoffMinutes} min.
          </p>
        </section>
      ) : null}
    </div>
  );
}

// ---------- small presentational helpers ----------

function NumberField({ label, hint, value, min, max, onChange }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#33333a", marginBottom: "5px" }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={inputStyle}
      />
      <span style={{ display: "block", fontSize: "11px", color: "#9a9aa3", marginTop: "4px" }}>{hint}</span>
    </label>
  );
}

const h3Style = { margin: 0, fontSize: "14px" };
const hintStyle = { margin: "4px 0 0", fontSize: "12px", color: "#8a8a92", lineHeight: 1.6 };
const labelStyle = { display: "block", fontSize: "11.5px", fontWeight: 700, color: "#33333a" };

const cardStyle = {
  border: "1px solid #f0f0f3",
  borderRadius: "12px",
  padding: "16px",
  background: "#fdfdfe",
};

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #e0e0e6",
  borderRadius: "9px",
  padding: "9px 11px",
  fontSize: "13px",
  background: "white",
  color: "#17171c",
};

const approveBtn = {
  border: "none",
  borderRadius: "9px",
  padding: "9px 13px",
  background: "#138808",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "12.5px",
};

const rejectBtn = {
  border: "1px solid #f3c6c6",
  borderRadius: "9px",
  padding: "9px 13px",
  background: "#fff5f5",
  color: "#c00",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "12.5px",
};

const ghostBtn = {
  border: "1px solid #e7e7ec",
  borderRadius: "9px",
  padding: "9px 13px",
  background: "white",
  color: "#55555e",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: "12.5px",
};

const thStyle = { padding: "10px 12px", fontSize: "11.5px", color: "#6b6b74", whiteSpace: "nowrap" };
const tdStyle = { padding: "9px 12px", verticalAlign: "top" };
