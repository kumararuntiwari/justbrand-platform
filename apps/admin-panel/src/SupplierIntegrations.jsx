import { useEffect, useMemo, useState } from "react";

import { API } from "./apiConfig";

// =====================================================
// ADMIN — SUPPLIER & MANUFACTURER INTEGRATIONS
// =====================================================
// Configures the server-side supplier connector, product sync,
// order sync and webhook verification. Secrets are write-only:
// the API returns a masked hint, never the key or secret.
//
// "Configured" is not the same as "integrated". A connection only
// becomes Connected after a successful real API test; products stay
// Pending until an admin approves them.

const EMPTY_FORM = {
  sellerId: "",
  providerName: "",
  baseUrl: "",
  authType: "api_key",
  authHeaderName: "X-API-Key",
  apiKey: "",
  apiSecret: "",
  webhookSecret: "",
  productsPath: "/products",
  productsKey: "",
  stockPath: "",
  pricePath: "",
  orderPath: "",
  orderStatusPath: "",
  syncFrequencyMinutes: "1440",
  autoSync: false,
  enabled: true,
  orderSyncEnabled: false,
};

const CARD = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
};

const INPUT = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 10px",
  border: "1px solid #d7d7de",
  borderRadius: 8,
  fontSize: 12.5,
  color: "#222",
  background: "#fff",
};

const LABEL = {
  display: "grid",
  gap: 4,
  fontSize: 11.5,
  fontWeight: 700,
  color: "#64748b",
};

function badgeStyle(tone) {
  if (tone === "good") return { background: "#ecfdf5", color: "#047857" };
  if (tone === "bad") return { background: "#fff1f2", color: "#be123c" };
  if (tone === "warn") return { background: "#fffbeb", color: "#a16207" };
  return { background: "#f1f5f9", color: "#475569" };
}

function providerState(integration) {
  if (!integration.enabled) return { label: "Disabled", tone: "muted" };
  if (integration.connectionStatus === "Connected") {
    return { label: "Connected — tested", tone: "good" };
  }
  if (integration.connectionStatus === "Error") {
    return { label: "Connection error", tone: "bad" };
  }
  if (integration.authType !== "none" && !integration.hasApiKey) {
    return { label: "Not Configured — credentials missing", tone: "warn" };
  }
  return { label: "Configured — untested", tone: "warn" };
}

function fmtDate(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—";
}

function Field({ label, hint, children }) {
  return (
    <label style={LABEL}>
      <span>{label}</span>
      {children}
      {hint ? <small style={{ color: "#94a3b8", fontWeight: 500 }}>{hint}</small> : null}
    </label>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label style={{ display: "flex", gap: 7, alignItems: "center", fontSize: 12.5 }}>
      <input type="checkbox" checked={checked} onChange={onChange} disabled={disabled} />
      {label}
    </label>
  );
}

export default function SupplierIntegrations({ token, onMessage }) {
  const [data, setData] = useState({
    integrations: [],
    sellers: [],
    jobs: [],
    runs: [],
    alerts: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState("integrations");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

  const editing = useMemo(
    () => data.integrations.find((row) => row.id === editingId) || null,
    [data.integrations, editingId]
  );

  async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new Error(payload?.message || `Request failed (HTTP ${response.status}).`);
    }
    return payload;
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const payload = await request("/api/admin/supplier-integrations");
      setData({
        integrations: payload.integrations || [],
        sellers: payload.sellers || [],
        jobs: payload.jobs || [],
        runs: payload.runs || [],
        alerts: payload.alerts || [],
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function notify(text) {
    onMessage?.(text);
  }

  function startCreate() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setShowForm(true);
  }

  function startEdit(integration) {
    setEditingId(integration.id);
    setForm({
      sellerId: String(integration.sellerId || ""),
      providerName: integration.providerName || "",
      baseUrl: integration.baseUrl || "",
      authType: integration.authType || "api_key",
      authHeaderName: integration.authHeaderName || "X-API-Key",
      apiKey: "",
      apiSecret: "",
      webhookSecret: "",
      productsPath: integration.productsPath || "/products",
      productsKey: integration.productsKey || "",
      stockPath: integration.stockPath || "",
      pricePath: integration.pricePath || "",
      orderPath: integration.orderPath || "",
      orderStatusPath: integration.orderStatusPath || "",
      syncFrequencyMinutes: String(integration.syncFrequencyMinutes || 1440),
      autoSync: Boolean(integration.autoSync),
      enabled: Boolean(integration.enabled),
      orderSyncEnabled: Boolean(integration.orderSyncEnabled),
    });
    setShowForm(true);
  }

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setBusy("save");
    setError("");
    try {
      const body = {
        ...form,
        sellerId: Number(form.sellerId),
        syncFrequencyMinutes: Number(form.syncFrequencyMinutes),
      };
      const payload = await request(
        editingId
          ? `/api/admin/supplier-integrations/${editingId}`
          : "/api/admin/supplier-integrations",
        { method: editingId ? "PUT" : "POST", body: JSON.stringify(body) }
      );
      notify(payload.message || "Supplier configuration saved.");
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function action(integration, kind) {
    setBusy(`${kind}-${integration.id}`);
    setError("");
    try {
      if (kind === "toggle") {
        const payload = await request(
          `/api/admin/supplier-integrations/${integration.id}/toggle`,
          {
            method: "POST",
            body: JSON.stringify({ enabled: !integration.enabled }),
          }
        );
        notify(payload.message);
      } else if (kind === "test") {
        const payload = await request(
          `/api/admin/supplier-integrations/${integration.id}/test`,
          { method: "POST" }
        );
        notify(payload.message);
      } else if (kind === "sync") {
        const payload = await request(
          `/api/admin/supplier-integrations/${integration.id}/sync`,
          { method: "POST" }
        );
        notify(payload.message);
      }
      await load();
    } catch (err) {
      setError(err.message);
      notify(`⚠️ ${err.message}`);
    } finally {
      setBusy("");
    }
  }

  async function processJobs() {
    setBusy("process");
    setError("");
    try {
      const payload = await request("/api/admin/supplier-integrations/process-jobs", {
        method: "POST",
        body: JSON.stringify({ limit: 10 }),
      });
      notify(`Supplier order worker: ${payload.processed || 0} job(s) processed.`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function jobAction(job, kind) {
    setBusy(`${kind}-job-${job.id}`);
    setError("");
    try {
      const payload = await request(`/api/admin/supplier-order-jobs/${job.id}/${kind}`, {
        method: "POST",
      });
      notify(payload.message || "Supplier order updated.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function copyWebhook(path) {
    const url = `${API}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("Webhook URL copied.");
    } catch {
      notify(url);
    }
  }

  return (
    <div>
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>🏭 Supplier &amp; Manufacturer Integrations</h2>
            <p>
              Product, stock, price and order APIs with encrypted credentials. A supplier is not
              shown as integrated until its real endpoint passes a connection test.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="refresh-btn" onClick={load} disabled={loading}>
              ⟳ Refresh
            </button>
            <button type="button" className="approve" onClick={startCreate}>
              + Add supplier
            </button>
          </div>
        </div>

        <div className="ov-note" style={{ marginBottom: 12 }}>
          <strong>Credential safety:</strong> API keys, secrets and webhook secrets are encrypted
          with AES-256-GCM on the server and never returned to this browser. Saving a configuration
          does not prove the supplier accepts it — use <b>Test connection</b>. Synced products stay
          <b> Pending</b> until product approval.
        </div>

        {error ? <div className="empty">⚠️ {error}</div> : null}
        {loading ? <div className="empty">Loading supplier integrations…</div> : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {[
            ["integrations", `Integrations (${data.integrations.length})`],
            ["jobs", `Order sync (${data.jobs.length})`],
            ["logs", `Logs & alerts (${data.alerts.length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={tab === key ? "approve" : "refresh-btn"}
            >
              {label}
            </button>
          ))}
        </div>

        {showForm ? (
          <form onSubmit={save} style={{ ...CARD, display: "grid", gap: 12, marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <strong>{editing ? `Edit ${editing.providerName || "supplier"}` : "New supplier integration"}</strong>
              <button type="button" className="refresh-btn" onClick={() => setShowForm(false)}>
                Close
              </button>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
                gap: 12,
              }}
            >
              <Field label="Seller / Supplier *">
                <select
                  style={INPUT}
                  required
                  disabled={Boolean(editing)}
                  value={form.sellerId}
                  onChange={(event) => update("sellerId", event.target.value)}
                >
                  <option value="">Choose a seller…</option>
                  {data.sellers.map((seller) => (
                    <option key={seller.id} value={seller.id}>
                      {seller.shopName || seller.name} · {seller.sellerCode}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Company / API provider name">
                <input
                  style={INPUT}
                  value={form.providerName}
                  onChange={(event) => update("providerName", event.target.value)}
                  placeholder="e.g. Acme Manufacturing"
                />
              </Field>
              <Field label="API Base URL *">
                <input
                  style={INPUT}
                  required
                  value={form.baseUrl}
                  onChange={(event) => update("baseUrl", event.target.value)}
                  placeholder="https://supplier.example.com/api"
                />
              </Field>
              <Field label="Authentication type">
                <select
                  style={INPUT}
                  value={form.authType}
                  onChange={(event) => update("authType", event.target.value)}
                >
                  <option value="api_key">API key header</option>
                  <option value="bearer">Bearer token</option>
                  <option value="basic">Basic auth</option>
                  <option value="crmkey">CRM key query (IndiaMART)</option>
                  <option value="none">No auth</option>
                </select>
              </Field>
              <Field label="API Key / Access token">
                <input
                  style={INPUT}
                  value={form.apiKey}
                  onChange={(event) => update("apiKey", event.target.value)}
                  placeholder={
                    editing?.hasApiKey
                      ? `Saved ${editing.apiKeyHint || "••••"} — leave blank to keep`
                      : "Stored encrypted"
                  }
                  autoComplete="new-password"
                />
              </Field>
              <Field label="API Secret">
                <input
                  style={INPUT}
                  type="password"
                  value={form.apiSecret}
                  onChange={(event) => update("apiSecret", event.target.value)}
                  placeholder={editing?.hasApiSecret ? "Saved — leave blank to keep" : "Stored encrypted"}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Auth header name">
                <input
                  style={INPUT}
                  value={form.authHeaderName}
                  onChange={(event) => update("authHeaderName", event.target.value)}
                  placeholder="X-API-Key"
                />
              </Field>
              <Field label="Webhook verification secret">
                <input
                  style={INPUT}
                  type="password"
                  value={form.webhookSecret}
                  onChange={(event) => update("webhookSecret", event.target.value)}
                  placeholder={
                    editing?.hasWebhookSecret
                      ? "Saved — leave blank to keep"
                      : "At least 8 characters"
                  }
                  autoComplete="new-password"
                />
              </Field>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))",
                gap: 12,
              }}
            >
              <Field label="Product API endpoint">
                <input
                  style={INPUT}
                  value={form.productsPath}
                  onChange={(event) => update("productsPath", event.target.value)}
                  placeholder="/products"
                />
              </Field>
              <Field label="Products list key" hint="Optional, e.g. data.products">
                <input
                  style={INPUT}
                  value={form.productsKey}
                  onChange={(event) => update("productsKey", event.target.value)}
                />
              </Field>
              <Field label="Stock API endpoint" hint="Optional; merged by SKU">
                <input
                  style={INPUT}
                  value={form.stockPath}
                  onChange={(event) => update("stockPath", event.target.value)}
                  placeholder="/stock"
                />
              </Field>
              <Field label="Price API endpoint" hint="Optional; merged by SKU">
                <input
                  style={INPUT}
                  value={form.pricePath}
                  onChange={(event) => update("pricePath", event.target.value)}
                  placeholder="/prices"
                />
              </Field>
              <Field label="Order API endpoint" hint="POST a new supplier order">
                <input
                  style={INPUT}
                  value={form.orderPath}
                  onChange={(event) => update("orderPath", event.target.value)}
                  placeholder="/orders"
                />
              </Field>
              <Field
                label="Order status endpoint"
                hint="Optional; supports {externalOrderId} and {orderNumber}"
              >
                <input
                  style={INPUT}
                  value={form.orderStatusPath}
                  onChange={(event) => update("orderStatusPath", event.target.value)}
                  placeholder="/orders/{externalOrderId}"
                />
              </Field>
              <Field label="Sync frequency (minutes)">
                <input
                  style={INPUT}
                  type="number"
                  min="15"
                  max="10080"
                  value={form.syncFrequencyMinutes}
                  onChange={(event) => update("syncFrequencyMinutes", event.target.value)}
                />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Toggle
                label="Enabled"
                checked={form.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
              />
              <Toggle
                label="Automatic product sync"
                checked={form.autoSync}
                onChange={(event) => update("autoSync", event.target.checked)}
              />
              <Toggle
                label="Send buyer orders to this supplier"
                checked={form.orderSyncEnabled}
                onChange={(event) => update("orderSyncEnabled", event.target.checked)}
              />
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="submit" className="approve" disabled={busy === "save"}>
                {busy === "save" ? "Saving…" : "💾 Save configuration"}
              </button>
              <button type="button" className="refresh-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        {tab === "integrations" && !loading ? (
          data.integrations.length === 0 ? (
            <div className="empty">
              No supplier API is configured. Add one only when you have its real API documentation
              and credentials; nothing is shown as connected by default.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {data.integrations.map((integration) => {
                const state = providerState(integration);
                return (
                  <div key={integration.id} style={CARD}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 16 }}>
                          {integration.providerName || `Supplier #${integration.id}`}
                        </strong>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                          {integration.shopName || integration.sellerName} ·{" "}
                          {integration.sellerCode || `seller #${integration.sellerId}`} ·{" "}
                          {integration.authType}
                        </div>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
                          <span className="sec-tag" style={badgeStyle(state.tone)}>
                            {state.label}
                          </span>
                          <span className="sec-tag" style={badgeStyle("muted")}>
                            {integration.orderSyncEnabled ? "Order sync ON" : "Order sync OFF"}
                          </span>
                          <span className="sec-tag" style={badgeStyle("muted")}>
                            {integration.enabled ? "Enabled" : "Disabled"}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "start" }}>
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => action(integration, "test")}
                          disabled={busy === `test-${integration.id}`}
                        >
                          {busy === `test-${integration.id}` ? "Testing…" : "Test connection"}
                        </button>
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => action(integration, "sync")}
                          disabled={busy === `sync-${integration.id}` || !integration.enabled}
                        >
                          {busy === `sync-${integration.id}` ? "Syncing…" : "Sync products"}
                        </button>
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => action(integration, "toggle")}
                          disabled={busy === `toggle-${integration.id}`}
                        >
                          {integration.enabled ? "Disable" : "Enable"}
                        </button>
                        <button type="button" className="approve" onClick={() => startEdit(integration)}>
                          Edit
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
                        gap: 10,
                        marginTop: 12,
                        fontSize: 12,
                        color: "#475569",
                      }}
                    >
                      <div>
                        <b>Base URL</b>
                        <div style={{ wordBreak: "break-all" }}>{integration.baseUrl}</div>
                      </div>
                      <div>
                        <b>Products</b>
                        <div>{integration.productsPath || "/products"}</div>
                      </div>
                      <div>
                        <b>Stock / Price</b>
                        <div>
                          {integration.stockPath || "—"} / {integration.pricePath || "—"}
                        </div>
                      </div>
                      <div>
                        <b>Order / Status</b>
                        <div>
                          {integration.orderPath || "—"} / {integration.orderStatusPath || "—"}
                        </div>
                      </div>
                      <div>
                        <b>Last product sync</b>
                        <div>
                          {fmtDate(integration.lastSyncAt)} · {integration.lastSyncStatus || "never"}
                        </div>
                      </div>
                      <div>
                        <b>Last order sync</b>
                        <div>
                          {fmtDate(integration.lastOrderSyncAt)} ·{" "}
                          {integration.lastOrderSyncError ? "error" : "ok / not run"}
                        </div>
                      </div>
                      <div>
                        <b>Order jobs</b>
                        <div>
                          {integration.jobCounts?.synced || 0} synced ·{" "}
                          {integration.jobCounts?.failed || 0} failed ·{" "}
                          {integration.jobCounts?.pending || 0} pending
                        </div>
                      </div>
                      <div>
                        <b>Webhook</b>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <code style={{ fontSize: 10.5, wordBreak: "break-all" }}>
                            {integration.webhookPath}
                          </code>
                          <button
                            type="button"
                            className="refresh-btn"
                            onClick={() => copyWebhook(integration.webhookPath)}
                          >
                            Copy URL
                          </button>
                        </div>
                      </div>
                    </div>

                    {integration.lastTestError || integration.lastSyncError || integration.lastOrderSyncError ? (
                      <div className="ov-note" style={{ marginTop: 10, color: "#be123c" }}>
                        <b>Last error:</b>{" "}
                        {integration.lastTestError ||
                          integration.lastSyncError ||
                          integration.lastOrderSyncError}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )
        ) : null}

        {tab === "jobs" && !loading ? (
          <div style={CARD}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong>Supplier order sync</strong>
                <p style={{ margin: "4px 0 10px", fontSize: 12, color: "#64748b" }}>
                  Each seller group is one job with a unique order/integration key. Failed jobs retry
                  automatically; no order is marked synced without a supplier response.
                </p>
              </div>
              <button
                type="button"
                className="refresh-btn"
                onClick={processJobs}
                disabled={busy === "process"}
              >
                {busy === "process" ? "Processing…" : "Process due jobs"}
              </button>
            </div>
            {data.jobs.length === 0 ? (
              <div className="empty">No supplier order jobs yet.</div>
            ) : (
              <div className="sec-tablewrap">
                <table className="sec-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Supplier</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>External ref</th>
                      <th>Tracking</th>
                      <th>Last error</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((job) => (
                      <tr key={job.id}>
                        <td>
                          <b>{job.orderNumber}</b>
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {job.sellerCode} · {fmtDate(job.createdAt)}
                          </div>
                        </td>
                        <td>{job.providerName || `#${job.integrationId}`}</td>
                        <td>
                          <span
                            className="sec-tag"
                            style={badgeStyle(
                              job.status === "synced"
                                ? "good"
                                : job.status === "failed"
                                  ? "bad"
                                  : "warn"
                            )}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td>{job.attempts}</td>
                        <td>
                          {job.externalOrderId || "—"}
                          <div style={{ fontSize: 11, color: "#94a3b8" }}>
                            {job.externalStatus || ""}
                          </div>
                        </td>
                        <td>
                          {job.trackingNumber || "—"}
                          {job.trackingUrl ? (
                            <div>
                              <a href={job.trackingUrl} target="_blank" rel="noreferrer">
                                Tracking ↗
                              </a>
                            </div>
                          ) : null}
                        </td>
                        <td style={{ maxWidth: 230, color: job.lastError ? "#be123c" : "#64748b" }}>
                          {job.lastError || "—"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {job.status !== "synced" ? (
                              <button
                                type="button"
                                className="refresh-btn"
                                onClick={() => jobAction(job, "retry")}
                                disabled={busy === `retry-job-${job.id}`}
                              >
                                Retry
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="refresh-btn"
                              onClick={() => jobAction(job, "status-sync")}
                              disabled={busy === `status-sync-job-${job.id}`}
                            >
                              Status sync
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : null}

        {tab === "logs" && !loading ? (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={CARD}>
              <strong>⚠️ Alerts</strong>
              {data.alerts.length === 0 ? (
                <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 12.5 }}>
                  No product or order sync failures recorded.
                </p>
              ) : (
                <ul style={{ margin: "8px 0 0 18px", fontSize: 12.5, lineHeight: 1.6 }}>
                  {data.alerts.map((alert, index) => (
                    <li key={`${alert.kind}-${alert.id}-${index}`}>
                      <b>{alert.providerName || "Supplier"}</b> · {alert.kind} ·{" "}
                      {alert.orderNumber ? `order ${alert.orderNumber} · ` : ""}
                      {alert.message} <span style={{ color: "#94a3b8" }}>({fmtDate(alert.at)})</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div style={CARD}>
              <strong>Product sync runs</strong>
              {data.runs.length === 0 ? (
                <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 12.5 }}>
                  No product sync has run yet.
                </p>
              ) : (
                <div className="sec-tablewrap" style={{ marginTop: 8 }}>
                  <table className="sec-table">
                    <thead>
                      <tr>
                        <th>When</th>
                        <th>Supplier</th>
                        <th>Status</th>
                        <th>Fetched</th>
                        <th>Created</th>
                        <th>Updated</th>
                        <th>Failed</th>
                        <th>First error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.runs.map((run) => (
                        <tr key={run.id}>
                          <td>{fmtDate(run.startedAt)}</td>
                          <td>{run.providerName || `#${run.integrationId}`}</td>
                          <td>{run.status}</td>
                          <td>{run.fetched}</td>
                          <td>{run.created}</td>
                          <td>{run.updated}</td>
                          <td>{run.failed}</td>
                          <td style={{ maxWidth: 280 }}>{run.errors?.[0] || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
