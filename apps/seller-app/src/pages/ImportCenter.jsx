// ==========================================
// SELLER — IMPORT CENTER
// ==========================================
// Two seller features backed by backend/seller-imports.js:
//   1. Bulk product upload (CSV / XLSX) with preview, validation
//      report, duplicate-SKU detection and a sample template.
//   2. Supplier API integration with encrypted credentials, field
//      mapping, connection test, manual sync and sync history.
//
// Every import / sync creates products as "Pending" — the existing
// admin approval gate stays in charge of what buyers see. Credentials
// are write-only from this screen: the server returns only a masked
// hint, so the inputs start empty and a blank value keeps the saved
// secret.

import React, { useEffect, useRef, useState } from "react";
import { API_URL } from "../api.js";
import MarketplaceConnections from "./MarketplaceConnections.jsx";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

const DEFAULT_MAPPING = {
  sku: "sku",
  name: "name",
  category: "category",
  price: "price",
  comparePrice: "comparePrice",
  stock: "stock",
  description: "description",
  images: "images",
  hsnCode: "hsnCode",
};

const DEFAULT_SETTINGS = {
  maxRowsPerImport: 2000,
  maxImportsPerDay: 10,
  maxSyncItems: 500,
  minSyncFrequencyMinutes: 15,
};

const AUTH_TYPES = [
  { value: "api_key", label: "API Key header" },
  { value: "bearer", label: "Bearer token" },
  { value: "basic", label: "Basic (key : secret)" },
  { value: "crmkey", label: "CRM key (crmkey query parameter)" },
  { value: "none", label: "No authentication" },
];

// Mirrors the server connector registry. The server response is always
// authoritative; this list only renders before it loads.
const DEFAULT_CONNECTORS = [
  { key: "generic", label: "Generic JSON API", authTypes: ["none", "api_key", "bearer", "basic"] },
  { key: "indiamart", label: "IndiaMART", authTypes: ["crmkey"], verification: "unverified_partner" },
  { key: "udaan", label: "Udaan", authTypes: ["basic"], verification: "unverified_partner" },
];

function getToken() {
  return localStorage.getItem("justbrand_seller_token") || "";
}

function statusColor(status) {
  if (status === "Approved" || status === "Imported" || status === "success") return { background: "#e8f8ef", color: "#0f7a45" };
  if (status === "Rejected" || status === "failed") return { background: "#feecec", color: "#b42318" };
  if (status === "partial") return { background: "#fff4dc", color: "#946200" };
  if (status === "error" || status === "Pending Approval" || status === "Previewed") return { background: "#fff4dc", color: "#946200" };
  return { background: "#eef2f7", color: "#475467" };
}

export default function ImportCenter({ onBack }) {
  const [tab, setTab] = useState("bulk");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  const [imports, setImports] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const fileInput = useRef(null);

  const [integration, setIntegration] = useState(null);
  const [connectors, setConnectors] = useState(DEFAULT_CONNECTORS);
  const [runs, setRuns] = useState([]);
  const [form, setForm] = useState({
    connector: "generic",
    providerName: "",
    baseUrl: "",
    authType: "api_key",
    authHeaderName: "X-API-Key",
    apiKey: "",
    apiSecret: "",
    extraHeaders: "",
    productsPath: "/products",
    productsKey: "",
    mapping: JSON.stringify(DEFAULT_MAPPING, null, 2),
    syncFrequencyMinutes: 1440,
    autoSync: false,
  });

  useEffect(() => {
    loadImports();
    loadIntegration();
    loadRuns();
  }, []);

  function flash(text) {
    setMessage(text);
    setError("");
    setTimeout(() => setMessage(""), 5000);
  }

  function fail(text) {
    setError(text);
    setMessage("");
  }

  async function apiJson(path, options = {}) {
    const token = getToken();
    if (!token) throw new Error("Please log in again — seller session not found.");

    const response = await fetch(`${API_URL}${path}`, {
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
      const err = new Error(data?.message || `Request failed (HTTP ${response.status}).`);
      err.status = response.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---------- loaders ----------

  async function loadImports() {
    try {
      const data = await apiJson("/api/sellers/imports");
      setImports(Array.isArray(data.imports) ? data.imports : []);
      if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
    } catch (err) {
      if (err.status !== 401) fail(err.message);
    }
  }

  async function loadIntegration() {
    try {
      const data = await apiJson("/api/sellers/integration");
      if (data.settings) setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      if (Array.isArray(data.connectors) && data.connectors.length > 0) setConnectors(data.connectors);
      const saved = data.integration;

      if (saved) {
        setIntegration(saved);
        setForm((prev) => ({
          ...prev,
          connector: saved.connector || "generic",
          providerName: saved.providerName || "",
          baseUrl: saved.baseUrl || "",
          authType: saved.authType || "api_key",
          authHeaderName: saved.authHeaderName || "X-API-Key",
          apiKey: "",
          apiSecret: "",
          productsPath: saved.productsPath || "/products",
          productsKey: saved.productsKey || "",
          mapping: JSON.stringify({ ...DEFAULT_MAPPING, ...(saved.mapping || {}) }, null, 2),
          syncFrequencyMinutes: saved.syncFrequencyMinutes || 1440,
          autoSync: Boolean(saved.autoSync),
        }));
      } else {
        setIntegration(null);
      }
    } catch (err) {
      if (err.status !== 401) fail(err.message);
    }
  }

  async function loadRuns() {
    try {
      const data = await apiJson("/api/sellers/integration/runs");
      setRuns(Array.isArray(data.runs) ? data.runs : []);
    } catch (err) {
      if (err.status !== 401) fail(err.message);
    }
  }

  // ---------- bulk upload ----------

  async function downloadTemplate(format) {
    try {
      const response = await fetch(`${API_URL}/api/sellers/imports/template?format=${format}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!response.ok) throw new Error("Template download failed.");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `justbrand-product-import-template.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      flash(`Sample ${format.toUpperCase()} template downloaded.`);
    } catch (err) {
      fail(err.message);
    }
  }

  function pickFile(event) {
    const selected = event.target.files?.[0];
    setPreview(null);
    if (!selected) {
      setFile(null);
      return;
    }

    const lower = selected.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xlsx")) {
      fail("Only .csv and .xlsx files are supported. Save .xls files as .xlsx first.");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    if (selected.size > MAX_FILE_BYTES) {
      fail("File is too large. Maximum upload size is 15 MB.");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }

    setError("");
    setFile(selected);
  }

  async function previewFile() {
    if (!file) {
      fail("Choose a CSV or XLSX file first.");
      return;
    }

    setBusy(true);
    setPreview(null);
    setError("");

    try {
      const buffer = await file.arrayBuffer();
      const type = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";

      const response = await fetch(`${API_URL}/api/sellers/imports/preview`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getToken()}`,
          "Content-Type": "application/octet-stream",
          "X-JB-File-Name": encodeURIComponent(file.name),
          "X-JB-File-Type": type,
        },
        body: buffer,
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(data?.message || `Preview failed (HTTP ${response.status}).`);
      }

      setPreview(data);
      flash("Preview ready — check the rows below before importing.");
    } catch (err) {
      fail(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function commitImport() {
    if (!preview) return;

    setBusy(true);
    try {
      const data = await apiJson(`/api/sellers/imports/${preview.importId}/commit`, { method: "POST" });
      flash(data.message || "Products imported.");
      setPreview(null);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await loadImports();
    } catch (err) {
      fail(err.message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- supplier api ----------

  function updateForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function saveIntegration() {
    setBusy(true);
    try {
      let mapping = form.mapping;
      try {
        mapping = form.mapping.trim() ? JSON.parse(form.mapping) : {};
      } catch {
        throw new Error("Field mapping must be valid JSON.");
      }

      const data = await apiJson("/api/sellers/integration", {
        method: "PUT",
        body: JSON.stringify({
          connector: form.connector,
          providerName: form.providerName,
          baseUrl: form.baseUrl,
          authType: form.authType,
          authHeaderName: form.authHeaderName,
          apiKey: form.apiKey,
          apiSecret: form.apiSecret,
          extraHeaders: form.extraHeaders,
          productsPath: form.productsPath,
          productsKey: form.productsKey,
          mapping,
          syncFrequencyMinutes: Number(form.syncFrequencyMinutes) || 1440,
          autoSync: form.autoSync,
        }),
      });

      setIntegration(data.integration);
      setForm((prev) => ({ ...prev, apiKey: "", apiSecret: "", extraHeaders: "" }));
      flash(data.message || "Supplier API saved.");
    } catch (err) {
      fail(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    try {
      const data = await apiJson("/api/sellers/integration/test", { method: "POST" });
      const sample = (data.sample || [])
        .map((item) => `${item.sku || "(no sku)"} — ${item.name || "(no name)"}`)
        .join(", ");
      flash(`${data.message}${sample ? ` Sample: ${sample}` : ""}`);
      await loadIntegration();
    } catch (err) {
      fail(err.message);
      await loadIntegration();
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      const data = await apiJson("/api/sellers/integration/sync", { method: "POST" });
      flash(data.message || "Sync finished.");
    } catch (err) {
      fail(err.message);
    } finally {
      setBusy(false);
      await loadIntegration();
      await loadRuns();
    }
  }

  // ========== RENDER ==========

  const previewRows = preview?.rows || [];
  const visibleRows = previewRows.slice(0, 100);
  const integrationStatus = integration?.status || "Not configured";
  const canSync = integrationStatus === "Approved";
  const activeConnector =
    connectors.find((item) => item.key === form.connector) || DEFAULT_CONNECTORS[0];
  const connectorAuthTypes = activeConnector.authTypes || ["none"];
  const forcedAuthType = connectorAuthTypes.length === 1 ? connectorAuthTypes[0] : null;
  const isUnverifiedConnector = activeConnector.verification === "unverified_partner";

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fb", color: "#1d2939" }}>
      <header
        style={{
          background: "linear-gradient(135deg,#ff6b00,#ff1493)",
          color: "white",
          padding: "15px 25px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "15px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: "24px", fontWeight: "bold" }}>JustBrand</div>
          <div style={{ fontSize: "13px", opacity: 0.9 }}>Seller Panel · Import &amp; Sync</div>
        </div>
        <button
          onClick={onBack}
          style={{
            border: "none",
            background: "white",
            color: "#ff1493",
            padding: "10px 16px",
            borderRadius: "8px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← Dashboard
        </button>
      </header>

      <main style={{ maxWidth: "1240px", margin: "0 auto", padding: "24px", boxSizing: "border-box" }}>
        <div style={{ background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 6px 20px rgba(16,24,40,.06)" }}>
          <h1 style={{ margin: 0, fontSize: "24px" }}>📥 Product Import &amp; Supplier Sync</h1>
          <p style={{ margin: "6px 0 0", color: "#667085", fontSize: "13px" }}>
            Upload products in bulk or connect your supplier API. Every imported or synced product goes to
            admin approval (Pending) first — nothing goes live automatically.
          </p>

          <div style={{ display: "flex", gap: "8px", marginTop: "16px", flexWrap: "wrap" }}>
            <button
              onClick={() => setTab("bulk")}
              style={{
                border: "1px solid " + (tab === "bulk" ? "#ff6b00" : "#e4e7ec"),
                background: tab === "bulk" ? "#fff4ec" : "white",
                color: tab === "bulk" ? "#c2410c" : "#475467",
                padding: "10px 16px",
                borderRadius: "10px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              📤 Bulk Upload (CSV / Excel)
            </button>
            <button
              onClick={() => setTab("api")}
              style={{
                border: "1px solid " + (tab === "api" ? "#ff6b00" : "#e4e7ec"),
                background: tab === "api" ? "#fff4ec" : "white",
                color: tab === "api" ? "#c2410c" : "#475467",
                padding: "10px 16px",
                borderRadius: "10px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🔗 Supplier API
            </button>
            <button
              onClick={() => setTab("marketplaces")}
              style={{
                border: "1px solid " + (tab === "marketplaces" ? "#ff6b00" : "#e4e7ec"),
                background: tab === "marketplaces" ? "#fff4ec" : "white",
                color: tab === "marketplaces" ? "#c2410c" : "#475467",
                padding: "10px 16px",
                borderRadius: "10px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🏬 Marketplaces
            </button>
          </div>
        </div>

        {message ? (
          <div style={{ marginTop: "14px", padding: "12px 16px", borderRadius: "10px", background: "#e8f8ef", color: "#0f7a45", fontSize: "13px" }}>
            {message}
          </div>
        ) : null}
        {error ? (
          <div style={{ marginTop: "14px", padding: "12px 16px", borderRadius: "10px", background: "#feecec", color: "#b42318", fontSize: "13px" }}>
            {error}
          </div>
        ) : null}

        {tab === "marketplaces" ? (
          <div style={{ marginTop: "16px" }}>
            <MarketplaceConnections
              flash={flash}
              fail={fail}
              onBulkUpload={() => setTab("bulk")}
            />
          </div>
        ) : null}

        {tab === "bulk" ? (
          <>
            <section style={card}>
              <h2 style={h2}>1. Download the sample template</h2>
              <p style={muted}>
                Keep the header row exactly as it is. Required columns: Product Name, Category, Price, Image URLs.
                SKU is optional but must be unique for your shop.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button style={primary} onClick={() => downloadTemplate("xlsx")} disabled={busy}>
                  ⬇️ Excel template (.xlsx)
                </button>
                <button style={secondary} onClick={() => downloadTemplate("csv")} disabled={busy}>
                  ⬇️ CSV template
                </button>
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>2. Upload &amp; preview</h2>
              <p style={muted}>
                CSV or XLSX, up to {settings.maxRowsPerImport} rows per file (15 MB max). You will see every row's
                validation result before anything is created.
              </p>

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={pickFile}
                  style={{ ...input, maxWidth: "340px" }}
                />
                <button style={primary} onClick={previewFile} disabled={busy || !file}>
                  {busy ? "Reading…" : "🔍 Preview & validate"}
                </button>
              </div>

              {preview ? (
                <div style={{ marginTop: "18px" }}>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <Chip label="Rows" value={preview.totalRows} />
                    <Chip label="Valid" value={preview.validRows} tone="good" />
                    <Chip label="Errors" value={preview.errorRows} tone={preview.errorRows ? "bad" : undefined} />
                    <Chip label="Duplicate SKU" value={preview.duplicateRows} tone={preview.duplicateRows ? "warn" : undefined} />
                  </div>

                  <div style={{ overflowX: "auto", marginTop: "14px", border: "1px solid #eaecf0", borderRadius: "10px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <thead>
                        <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                          <th style={th}>Row</th>
                          <th style={th}>Status</th>
                          <th style={th}>SKU</th>
                          <th style={th}>Name</th>
                          <th style={th}>Category</th>
                          <th style={th}>Price</th>
                          <th style={th}>Stock</th>
                          <th style={th}>Images</th>
                          <th style={th}>Validation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleRows.map((row) => (
                          <tr key={row.rowNumber} style={{ borderTop: "1px solid #f2f4f7", background: row.status === "error" ? "#fffafa" : "white" }}>
                            <td style={td}>{row.rowNumber}</td>
                            <td style={td}>
                              <span style={{ ...tag, ...statusColor(row.status === "valid" ? "Approved" : "error") }}>
                                {row.status === "valid" ? "Valid" : "Error"}
                              </span>
                              {row.duplicate ? (
                                <span style={{ ...tag, ...statusColor("Pending Approval"), marginLeft: "4px" }}>Duplicate SKU</span>
                              ) : null}
                            </td>
                            <td style={td}>{row.sku || "—"}</td>
                            <td style={td}>{row.name || "—"}</td>
                            <td style={td}>{row.category || "—"}</td>
                            <td style={td}>{row.price || "—"}</td>
                            <td style={td}>{row.stock || "—"}</td>
                            <td style={td}>{row.imageCount}</td>
                            <td style={{ ...td, color: row.errors?.length ? "#b42318" : "#0f7a45" }}>
                              {row.errors?.length ? row.errors.join(" ") : "OK"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {previewRows.length > visibleRows.length ? (
                    <p style={muted}>Showing the first {visibleRows.length} of {previewRows.length} rows.</p>
                  ) : null}

                  <div style={{ display: "flex", gap: "10px", marginTop: "14px", flexWrap: "wrap", alignItems: "center" }}>
                    <button style={primary} onClick={commitImport} disabled={busy || preview.validRows === 0}>
                      ✅ Import {preview.validRows} valid product(s) for approval
                    </button>
                    <button
                      style={secondary}
                      onClick={() => {
                        setPreview(null);
                        setFile(null);
                        if (fileInput.current) fileInput.current.value = "";
                      }}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    {preview.errorRows > 0 ? (
                      <span style={{ fontSize: "12px", color: "#b54708" }}>
                        {preview.errorRows} row(s) with errors will be skipped and stay in the report.
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </section>

            <section style={card}>
              <h2 style={h2}>Import history</h2>
              <p style={muted}>
                Daily limit: {settings.maxImportsPerDay} imports. Old reports stay here, including the rejected rows.
              </p>
              {imports.length === 0 ? (
                <p style={muted}>No imports yet.</p>
              ) : (
                <div style={{ overflowX: "auto", border: "1px solid #eaecf0", borderRadius: "10px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                        <th style={th}>#</th>
                        <th style={th}>File</th>
                        <th style={th}>Status</th>
                        <th style={th}>Rows</th>
                        <th style={th}>Valid</th>
                        <th style={th}>Errors</th>
                        <th style={th}>Duplicates</th>
                        <th style={th}>Imported</th>
                        <th style={th}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {imports.map((job) => (
                        <tr key={job.id} style={{ borderTop: "1px solid #f2f4f7" }}>
                          <td style={td}>{job.id}</td>
                          <td style={td}>{job.fileName || "—"}</td>
                          <td style={td}>
                            <span style={{ ...tag, ...statusColor(job.status) }}>{job.status}</span>
                          </td>
                          <td style={td}>{job.totalRows}</td>
                          <td style={td}>{job.validRows}</td>
                          <td style={td}>{job.errorRows}</td>
                          <td style={td}>{job.duplicateRows}</td>
                          <td style={td}>{job.importedRows}</td>
                          <td style={td}>{String(job.createdAt || "").slice(0, 16).replace("T", " ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : tab === "api" ? (
          <>
            <section style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <h2 style={h2}>Supplier API status</h2>
                  <p style={muted}>
                    Credentials are encrypted on the server and never shown again — only the last 4 characters of the key.
                  </p>
                </div>
                <span style={{ ...tag, ...statusColor(integrationStatus), fontSize: "12px", padding: "7px 12px" }}>{integrationStatus}</span>
              </div>

              {integration ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: "10px", marginTop: "12px" }}>
                  <Info label="Provider" value={integration.providerName || "—"} />
                  <Info label="Base URL" value={integration.baseUrl} />
                  <Info label="Auth" value={integration.authType} />
                  <Info label="API key" value={integration.apiKeyHint || (integration.hasApiKey ? "saved" : "not set")} />
                  <Info label="Connection" value={integration.connectionStatus} />
                  <Info label="Connector" value={`${integration.connectorInfo?.label || integration.connector || "Generic"}${integration.connectorInfo?.certified ? "" : " (unverified)"}`} />
                  <Info
                    label="Last sync"
                    value={
                      integration.lastSyncAt
                        ? `${String(integration.lastSyncAt).slice(0, 16).replace("T", " ")} (${integration.lastSyncStatus || "—"})`
                        : "never"
                    }
                  />
                  <Info
                    label="Last successful sync"
                    value={
                      integration.lastSuccessfulSyncAt
                        ? String(integration.lastSuccessfulSyncAt).slice(0, 16).replace("T", " ")
                        : "never"
                    }
                  />
                  <Info
                    label="Next scheduled sync (IST)"
                    value={
                      integration.nextSyncAt
                        ? String(integration.nextSyncAt).slice(0, 16).replace("T", " ")
                        : "not scheduled"
                    }
                  />
                </div>
              ) : null}

              {integration?.status === "Rejected" && integration.rejectionReason ? (
                <p style={{ marginTop: "12px", padding: "10px 14px", borderRadius: "10px", background: "#feecec", color: "#b42318", fontSize: "12px" }}>
                  Rejected by admin: {integration.rejectionReason}
                </p>
              ) : null}

              {integration?.lastTestError ? (
                <p style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "#fff7e6", color: "#946200", fontSize: "12px" }}>
                  Connection error: {integration.lastTestError}
                </p>
              ) : null}

              {integration?.lastSyncError ? (
                <p style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "#fff7e6", color: "#946200", fontSize: "12px" }}>
                  Last sync error: {integration.lastSyncError}
                </p>
              ) : null}

              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "14px" }}>
                <button style={secondary} onClick={testConnection} disabled={busy || !integration}>
                  🔌 Test connection
                </button>
                <button style={primary} onClick={syncNow} disabled={busy || !canSync}>
                  🔄 Sync now
                </button>
                {!canSync ? (
                  <span style={{ fontSize: "12px", color: "#946200", alignSelf: "center" }}>
                    Sync is enabled after admin approval.
                  </span>
                ) : null}
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>API configuration</h2>
              <p style={muted}>
                Fields follow the supplier's API documentation. Saving new URL / credentials sends the integration for
                admin approval again. Selling price = supplier price + the admin-set JustBrand markup; GST and delivery
                are added once by JustBrand.
              </p>

              {isUnverifiedConnector ? (
                <div style={{ marginTop: "12px", padding: "12px 14px", borderRadius: "10px", background: "#fff7e6", border: "1px solid #f5d9a8" }}>
                  <strong style={{ fontSize: "12.5px", color: "#946200" }}>
                    {activeConnector.label} connector — UNVERIFIED
                  </strong>
                  <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#7a5200", lineHeight: 1.6 }}>
                    {activeConnector.notes ||
                      "This connector needs official API access from the provider before price/stock sync can be certified."}
                  </p>
                  {activeConnector.docsUrl ? (
                    <a href={activeConnector.docsUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: "6px", fontSize: "12px", color: "#946200", fontWeight: 700 }}>
                      Official documentation ↗
                    </a>
                  ) : null}
                </div>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "12px" }}>
                <Field label="Connector">
                  <select
                    style={input}
                    value={form.connector}
                    onChange={(e) => {
                      const next = connectors.find((item) => item.key === e.target.value) || DEFAULT_CONNECTORS[0];
                      updateForm({
                        connector: next.key,
                        authType: next.authTypes?.length === 1 ? next.authTypes[0] : form.authType,
                      });
                    }}
                  >
                    {connectors.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}
                        {item.verification === "unverified_partner" ? " (unverified)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Provider name">
                  <input style={input} value={form.providerName} onChange={(e) => updateForm({ providerName: e.target.value })} placeholder="e.g. Sharma Wholesale API" />
                </Field>
                <Field label="API Base URL">
                  <input style={input} value={form.baseUrl} onChange={(e) => updateForm({ baseUrl: e.target.value })} placeholder="https://supplier.example.com/api" />
                </Field>
                <Field label="Authentication type">
                  <select
                    style={input}
                    value={form.authType}
                    disabled={Boolean(forcedAuthType)}
                    onChange={(e) => updateForm({ authType: e.target.value })}
                  >
                    {AUTH_TYPES.filter((type) => connectorAuthTypes.includes(type.value)).map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.authType === "api_key" ? (
                  <Field label="API key header name">
                    <input style={input} value={form.authHeaderName} onChange={(e) => updateForm({ authHeaderName: e.target.value })} placeholder="X-API-Key" />
                  </Field>
                ) : null}
                <Field label={integration?.hasApiKey ? "API key (leave blank to keep saved key)" : "API key"}>
                  <input
                    style={input}
                    type="password"
                    autoComplete="new-password"
                    value={form.apiKey}
                    onChange={(e) => updateForm({ apiKey: e.target.value })}
                    placeholder={integration?.apiKeyHint || "Paste the supplier API key"}
                  />
                </Field>
                <Field label={integration?.hasApiSecret ? "API secret (leave blank to keep saved secret)" : "API secret"}>
                  <input
                    style={input}
                    type="password"
                    autoComplete="new-password"
                    value={form.apiSecret}
                    onChange={(e) => updateForm({ apiSecret: e.target.value })}
                    placeholder="Optional — used by Basic auth"
                  />
                </Field>
                <Field label="Products endpoint path">
                  <input style={input} value={form.productsPath} onChange={(e) => updateForm({ productsPath: e.target.value })} placeholder="/products" />
                </Field>
                <Field label="Products key in response (optional)">
                  <input style={input} value={form.productsKey} onChange={(e) => updateForm({ productsKey: e.target.value })} placeholder="data.products" />
                </Field>
                <Field label="Extra headers (JSON, optional)">
                  <input style={input} value={form.extraHeaders} onChange={(e) => updateForm({ extraHeaders: e.target.value })} placeholder='{"X-Tenant":"shop1"}' />
                </Field>
                <Field label={`Sync frequency (minutes, min ${settings.minSyncFrequencyMinutes})`}>
                  <input
                    style={input}
                    type="number"
                    min={settings.minSyncFrequencyMinutes}
                    value={form.syncFrequencyMinutes}
                    onChange={(e) => updateForm({ syncFrequencyMinutes: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Field mapping (JSON — supplier field paths)">
                <textarea
                  style={{ ...input, minHeight: "170px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "12px" }}
                  value={form.mapping}
                  onChange={(e) => updateForm({ mapping: e.target.value })}
                />
              </Field>

              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", marginTop: "10px" }}>
                <input type="checkbox" checked={form.autoSync} onChange={(e) => updateForm({ autoSync: e.target.checked })} />
                Enable scheduled sync automatically (after admin approval)
              </label>

              <div style={{ marginTop: "14px" }}>
                <button style={primary} onClick={saveIntegration} disabled={busy}>
                  💾 Save configuration
                </button>
              </div>
            </section>

            <section style={card}>
              <h2 style={h2}>Sync history</h2>
              <p style={muted}>Last 30 runs, newest first. Failed items are listed with the reason.</p>
              {runs.length === 0 ? (
                <p style={muted}>No syncs yet.</p>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {runs.map((run) => (
                    <div key={run.id} style={{ border: "1px solid #eaecf0", borderRadius: "10px", padding: "12px" }}>
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", fontSize: "12px" }}>
                        <span style={{ ...tag, ...statusColor(run.status) }}>{run.status}</span>
                        <strong>#{run.id}</strong>
                        <span>{run.trigger}</span>
                        <span style={muted}>{String(run.startedAt || "").slice(0, 16).replace("T", " ")}</span>
                        <span>Fetched {run.fetched}</span>
                        <span>Created {run.created}</span>
                        <span>Updated {run.updated}</span>
                        <span style={{ color: run.failed ? "#b42318" : undefined }}>Failed {run.failed}</span>
                      </div>
                      {run.errors?.length ? (
                        <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "12px", color: "#b42318" }}>
                          {run.errors.slice(0, 8).map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                          {run.errors.length > 8 ? <li>… {run.errors.length - 8} more</li> : null}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section style={{ ...card, background: "#fbfdff" }}>
              <h2 style={h2}>How the connector works</h2>
              <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12.5px", color: "#475467", lineHeight: 1.8 }}>
                <li>The server calls your supplier endpoint (GET) with the configured authentication and reads the product list.</li>
                <li>Each item is mapped with the JSON paths above; SKU is the matching key.</li>
                <li>New SKU → product created as Pending. Existing SKU → only price and stock are updated; the approval status is kept.</li>
                <li>Your selling price is calculated from the supplier's price plus the admin-set JustBrand markup — the markup is never applied twice on re-syncs.</li>
                <li>Scheduled sync runs on the server (default daily 12:00 AM IST); it stops if the admin rejects the integration or turns auto-sync off.</li>
                <li>If a sync fails, the supplier's previous stock is not shown as available. At checkout, stock is re-checked live with the supplier before the order is placed.</li>
              </ul>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

// ---------- tiny presentational helpers ----------

const card = {
  background: "white",
  borderRadius: "14px",
  padding: "20px",
  marginTop: "16px",
  boxShadow: "0 6px 20px rgba(16,24,40,.06)",
};

const h2 = { margin: 0, fontSize: "17px" };
const muted = { margin: "6px 0 0", color: "#667085", fontSize: "12.5px" };
const input = {
  width: "100%",
  boxSizing: "border-box",
  border: "1px solid #d0d5dd",
  borderRadius: "9px",
  padding: "10px 12px",
  fontSize: "13px",
  background: "white",
  color: "#1d2939",
};
const primary = {
  border: "none",
  borderRadius: "10px",
  padding: "11px 16px",
  background: "linear-gradient(135deg,#ff6b00,#ff1493)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};
const secondary = {
  border: "1px solid #d0d5dd",
  borderRadius: "10px",
  padding: "10px 15px",
  background: "white",
  color: "#344054",
  fontWeight: 700,
  cursor: "pointer",
};
const th = { padding: "10px 12px", fontSize: "11px", color: "#667085", fontWeight: 800, whiteSpace: "nowrap" };
const td = { padding: "9px 12px", verticalAlign: "top" };
const tag = { display: "inline-block", padding: "3px 8px", borderRadius: "999px", fontSize: "10.5px", fontWeight: 800 };

function Chip({ label, value, tone }) {
  const palette =
    tone === "good"
      ? { background: "#e8f8ef", color: "#0f7a45" }
      : tone === "bad"
      ? { background: "#feecec", color: "#b42318" }
      : tone === "warn"
      ? { background: "#fff4dc", color: "#946200" }
      : { background: "#f2f4f7", color: "#475467" };

  return (
    <div style={{ ...palette, borderRadius: "10px", padding: "8px 12px", minWidth: "92px" }}>
      <div style={{ fontSize: "10px", fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ border: "1px solid #eef1f5", background: "#fafbfd", borderRadius: "10px", padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: "10px", color: "#98a2b1", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div style={{ fontSize: "12.5px", color: "#344054", marginTop: "3px", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block", marginTop: "10px" }}>
      <span style={{ display: "block", fontSize: "11.5px", fontWeight: 700, color: "#475467", marginBottom: "5px" }}>{label}</span>
      {children}
    </label>
  );
}
