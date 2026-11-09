// =====================================================
// SELLER — MARKETPLACE CONNECTIONS (Amazon / Flipkart / Meesho / GlowRoad)
// =====================================================
// Separate connectors with their own authorization:
//   • Amazon  — official SP-API, seller authorizes through Amazon OAuth
//   • Flipkart— official Seller API, token generated server-side
//   • Meesho  — API access required (no public seller API); bulk import
//   • GlowRoad— API-key connector, unverified until GlowRoad issues access
// Credentials/tokens never reach the browser: only status + hints.

import React, { useEffect, useState } from "react";
import { API_URL } from "../api.js";

const AUTH = () => localStorage.getItem("justbrand_seller_token") || "";

const EMPTY_FORMS = {
  amazon: { accountLabel: "", externalSellerId: "", marketplaceId: "A21KJY", region: "na", autoSync: true },
  flipkart: { accountLabel: "", externalSellerId: "", autoSync: true },
  glowroad: { accountLabel: "", baseUrl: "", listingsPath: "/products", apiKey: "", autoSync: true },
};

function statusTone(status) {
  if (["Approved", "Connected", "success"].includes(status)) return { background: "#e8f8ef", color: "#0f7a45" };
  if (["Rejected", "Error", "failed", "Disconnected"].includes(status)) return { background: "#feecec", color: "#b42318" };
  if (["Pending Approval", "partial", "Untested"].includes(status)) return { background: "#fff4dc", color: "#946200" };
  return { background: "#eef2f7", color: "#475467" };
}

function fmt(value) {
  return value ? String(value).slice(0, 16).replace("T", " ") : "—";
}

export default function MarketplaceConnections({ onBulkUpload, flash, fail }) {
  const [providers, setProviders] = useState([]);
  const [forms, setForms] = useState(EMPTY_FORMS);
  const [busy, setBusy] = useState("");
  const [runs, setRuns] = useState({});
  const [loading, setLoading] = useState(true);

  async function request(path, options = {}) {
    const token = AUTH();
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
      const error = new Error(data?.message || `Request failed (HTTP ${response.status}).`);
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  async function load() {
    setLoading(true);
    try {
      const data = await request("/api/sellers/marketplaces");
      setProviders(data.providers || []);
      setForms((previous) => {
        const next = { ...previous };
        for (const provider of data.providers || []) {
          const saved = provider.integration;
          if (!saved) continue;
          if (provider.key === "amazon") {
            next.amazon = {
              ...next.amazon,
              accountLabel: saved.accountLabel || "",
              externalSellerId: saved.externalSellerId || "",
              marketplaceId: saved.marketplaceId || next.amazon.marketplaceId,
              region: saved.region || "na",
              autoSync: Boolean(saved.autoSync),
            };
          }
          if (provider.key === "flipkart") {
            next.flipkart = {
              ...next.flipkart,
              accountLabel: saved.accountLabel || "",
              externalSellerId: saved.externalSellerId || "",
              autoSync: Boolean(saved.autoSync),
            };
          }
          if (provider.key === "glowroad") {
            next.glowroad = {
              ...next.glowroad,
              accountLabel: saved.accountLabel || "",
              baseUrl: saved.baseUrl || "",
              listingsPath: saved.listingsPath || "/products",
              apiKey: "",
              autoSync: Boolean(saved.autoSync),
            };
          }
        }
        return next;
      });
    } catch (error) {
      fail(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadRuns(provider) {
    try {
      const data = await request(`/api/sellers/marketplaces/${provider}/runs`);
      setRuns((previous) => ({ ...previous, [provider]: data.runs || [] }));
    } catch (error) {
      fail(error.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function update(provider, patch) {
    setForms((previous) => ({ ...previous, [provider]: { ...previous[provider], ...patch } }));
  }

  async function save(provider) {
    setBusy(provider);
    try {
      const form = forms[provider];
      const data = await request(`/api/sellers/marketplaces/${provider}`, {
        method: "PUT",
        body: JSON.stringify({
          accountLabel: form.accountLabel,
          externalSellerId: form.externalSellerId,
          marketplaceId: form.marketplaceId,
          region: form.region,
          baseUrl: form.baseUrl,
          listingsPath: form.listingsPath,
          apiKey: form.apiKey,
          autoSync: form.autoSync,
        }),
      });
      flash(data.message || "Marketplace configuration saved.");
      await load();
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  async function connect(provider) {
    setBusy(provider);
    try {
      const data = await request(`/api/sellers/marketplaces/${provider}/connect`, {
        method: "POST",
        body: JSON.stringify({ returnTo: window.location.origin }),
      });

      if (data.authorizeUrl) {
        window.open(data.authorizeUrl, "_blank", "noopener,noreferrer");
        flash("Amazon authorization खुल गया है — वहाँ approve करके Seller Panel में लौटें।");
      } else {
        flash(data.message || "Connected.");
      }
      await load();
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  async function test(provider) {
    setBusy(provider);
    try {
      const data = await request(`/api/sellers/marketplaces/${provider}/test`, { method: "POST" });
      const sample = (data.sample || [])
        .map((item) => `${item.sku || "?"} — ${item.name || "?"}`)
        .join(", ");
      flash(`${data.message}${sample ? ` Sample: ${sample}` : ""}`);
      await load();
    } catch (error) {
      fail(error.message);
      await load();
    } finally {
      setBusy("");
    }
  }

  async function sync(provider) {
    setBusy(provider);
    try {
      const data = await request(`/api/sellers/marketplaces/${provider}/sync`, { method: "POST" });
      flash(data.message || "Sync finished.");
      await load();
      await loadRuns(provider);
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  async function disconnect(provider) {
    if (!window.confirm(`Disconnect ${provider}? Existing products stay, but no further sync will run.`)) return;
    setBusy(provider);
    try {
      const data = await request(`/api/sellers/marketplaces/${provider}`, { method: "DELETE" });
      flash(data.message || "Disconnected.");
      await load();
    } catch (error) {
      fail(error.message);
    } finally {
      setBusy("");
    }
  }

  if (loading && providers.length === 0) {
    return <p style={{ color: "#667085", fontSize: "13px" }}>Loading marketplace connections…</p>;
  }

  return (
    <>
      <div style={{ display: "grid", gap: "14px" }}>
        {providers.map((provider) => {
          const saved = provider.integration;
          const isAmazon = provider.key === "amazon";
          const isFlipkart = provider.key === "flipkart";
          const isGlow = provider.key === "glowroad";
          const isMeesho = provider.key === "meesho";
          const providerRuns = runs[provider.key] || [];
          const tone = statusTone(saved?.status || "Not connected");

          return (
            <section key={provider.key} style={card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <h2 style={h2}>
                    {provider.label}{" "}
                    <span style={{ ...tag, ...tone, fontSize: "11px" }}>
                      {saved ? saved.status : "Not connected"}
                    </span>{" "}
                    {provider.verification === "unverified_partner" ? (
                      <span style={{ ...tag, background: "#fff4dc", color: "#946200", fontSize: "11px" }}>
                        UNVERIFIED
                      </span>
                    ) : null}
                  </h2>
                  <p style={muted}>{provider.notes}</p>
                </div>
                <a href={provider.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "#c2410c", fontWeight: 700, alignSelf: "flex-start" }}>
                  Official docs ↗
                </a>
              </div>

              {isMeesho ? (
                <div style={{ marginTop: "12px", padding: "12px 14px", borderRadius: "10px", background: "#fff7e6", color: "#8a5b00", fontSize: "12.5px", lineHeight: 1.6 }}>
                  <b>API access required.</b> Meesho कोई public seller API/API key नहीं देता — unofficial API या
                  password login इस्तेमाल नहीं होता। अधिकृत bulk CSV/XLSX import से products जोड़ें, या Meesho
                  partner access का अनुरोध करें.
                  <div style={{ marginTop: "10px" }}>
                    <button style={secondary} onClick={onBulkUpload}>📤 Bulk upload खोलें</button>
                  </div>
                </div>
              ) : null}

              {!isMeesho && !provider.appConfigured && provider.appFields.length > 0 ? (
                <p style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "#fff7e6", color: "#946200", fontSize: "12px" }}>
                  Admin setup pending — {provider.label} app credentials अभी configure नहीं हुए हैं.
                </p>
              ) : null}

              {saved ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "10px", marginTop: "12px" }}>
                  <Info label="Account" value={saved.accountLabel || saved.externalSellerId || "—"} />
                  <Info label="Connection" value={saved.connectionStatus} />
                  <Info label="Last sync" value={fmt(saved.lastSyncAt)} />
                  <Info label="Last successful" value={fmt(saved.lastSuccessfulSyncAt)} />
                  <Info label="Next scheduled" value={fmt(saved.nextSyncAt)} />
                  <Info label="Products imported" value={String(saved.totalImportedCount)} />
                  <Info label="Last import" value={String(saved.lastImportedCount)} />
                  <Info label="Token" value={saved.hasAccessToken ? `valid till ${fmt(saved.tokenExpiresAt)}` : "—"} />
                </div>
              ) : null}

              {saved?.lastSyncError ? (
                <p style={{ marginTop: "10px", padding: "10px 14px", borderRadius: "10px", background: "#fff7e6", color: "#946200", fontSize: "12px" }}>
                  Sync error: {saved.lastSyncError}
                </p>
              ) : null}

              {saved?.lastTestError ? (
                <p style={{ marginTop: "8px", padding: "10px 14px", borderRadius: "10px", background: "#feecec", color: "#b42318", fontSize: "12px" }}>
                  Connection error: {saved.lastTestError}
                </p>
              ) : null}

              {saved?.status === "Rejected" && saved.rejectionReason ? (
                <p style={{ marginTop: "8px", padding: "10px 14px", borderRadius: "10px", background: "#feecec", color: "#b42318", fontSize: "12px" }}>
                  Rejected by admin: {saved.rejectionReason}
                </p>
              ) : null}

              {!isMeesho ? (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "12px", marginTop: "14px" }}>
                    <Field label="Account label">
                      <input style={input} value={forms[provider.key]?.accountLabel || ""} onChange={(e) => update(provider.key, { accountLabel: e.target.value })} placeholder="e.g. JustBrand Amazon IN" />
                    </Field>

                    {isAmazon || isFlipkart ? (
                      <Field label={`${provider.label} Seller ID`}>
                        <input style={input} value={forms[provider.key]?.externalSellerId || ""} onChange={(e) => update(provider.key, { externalSellerId: e.target.value })} placeholder="Seller / merchant ID" />
                      </Field>
                    ) : null}

                    {isAmazon ? (
                      <>
                        <Field label="Marketplace ID">
                          <input style={input} value={forms.amazon.marketplaceId} onChange={(e) => update("amazon", { marketplaceId: e.target.value })} placeholder="A21KJY" />
                        </Field>
                        <Field label="Region">
                          <select style={input} value={forms.amazon.region} onChange={(e) => update("amazon", { region: e.target.value })}>
                            <option value="na">North America (na)</option>
                            <option value="eu">Europe (eu)</option>
                            <option value="fe">Far East (fe)</option>
                          </select>
                        </Field>
                      </>
                    ) : null}

                    {isGlow ? (
                      <>
                        <Field label="GlowRoad API base URL">
                          <input style={input} value={forms.glowroad.baseUrl} onChange={(e) => update("glowroad", { baseUrl: e.target.value })} placeholder="https://api.glowroad.com/partner" />
                        </Field>
                        <Field label="Listings path">
                          <input style={input} value={forms.glowroad.listingsPath} onChange={(e) => update("glowroad", { listingsPath: e.target.value })} placeholder="/products" />
                        </Field>
                        <Field label={saved?.hasCredentials ? "API key (leave blank to keep saved key)" : "API key"}>
                          <input style={input} type="password" autoComplete="new-password" value={forms.glowroad.apiKey} onChange={(e) => update("glowroad", { apiKey: e.target.value })} placeholder={saved?.apiKeyHint || "GlowRoad API key"} />
                        </Field>
                      </>
                    ) : null}
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", marginTop: "10px" }}>
                    <input type="checkbox" checked={Boolean(forms[provider.key]?.autoSync)} onChange={(e) => update(provider.key, { autoSync: e.target.checked })} />
                    Scheduled sync चालू रखें (default 12:00 AM IST, admin schedule)
                  </label>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                    <button style={primary} disabled={busy === provider.key} onClick={() => save(provider.key)}>
                      💾 Save configuration
                    </button>
                    <button style={secondary} disabled={busy === provider.key} onClick={() => connect(provider.key)}>
                      {isAmazon ? "🔐 Authorize with Amazon" : isFlipkart ? "🔑 Generate Flipkart token" : "🔌 Connect API key"}
                    </button>
                    <button style={secondary} disabled={busy === provider.key || !saved} onClick={() => test(provider.key)}>
                      🧪 Test connection
                    </button>
                    <button style={secondary} disabled={busy === provider.key || saved?.status !== "Approved"} onClick={() => sync(provider.key)}>
                      🔄 Sync now
                    </button>
                    {saved ? (
                      <button style={danger} disabled={busy === provider.key} onClick={() => disconnect(provider.key)}>
                        ⏏ Disconnect
                      </button>
                    ) : null}
                  </div>

                  {saved ? (
                    <div style={{ marginTop: "10px", fontSize: "12px" }}>
                      <button style={{ ...secondary, padding: "6px 10px", fontSize: "11.5px" }} onClick={() => loadRuns(provider.key)}>
                        View sync history
                      </button>
                      {providerRuns.length > 0 ? (
                        <div style={{ display: "grid", gap: "8px", marginTop: "10px" }}>
                          {providerRuns.slice(0, 5).map((run) => (
                            <div key={run.id} style={{ border: "1px solid #eaecf0", borderRadius: "8px", padding: "10px", fontSize: "11.5px", color: "#475467" }}>
                              <b>#{run.id}</b> · {run.status} · {run.trigger} · {fmt(run.startedAt)} · fetched {run.fetched}, created {run.created}, updated {run.updated}, failed {run.failed}
                              {Array.isArray(run.errors) && run.errors.length > 0 ? (
                                <ul style={{ margin: "6px 0 0", paddingLeft: "16px", color: "#b42318" }}>
                                  {run.errors.slice(0, 4).map((entry, index) => (
                                    <li key={index}>{entry}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          );
        })}
      </div>

      <section style={{ ...card, background: "#fbfdff" }}>
        <h2 style={h2}>Marketplace rules (same as supplier sync)</h2>
        <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "12.5px", color: "#475467", lineHeight: 1.8 }}>
          <li>नए SKU → product <b>Pending</b> (admin approval के बिना live नहीं). मौजूदा SKU → सिर्फ price/stock/listing status update; approval status नहीं बदलता.</li>
          <li>Selling price = marketplace price + admin Profit Margin rule; markup दोबारा नहीं जुड़ता। GST/delivery एक ही बार लगते हैं.</li>
          <li>Stock 0 → Out of Stock. Sync fail या listing inactive → stock unverified; checkout पर live stock दोबारा check होता है.</li>
          <li>Credentials/tokens server-side encrypted हैं — response में सिर्फ hint/status आता है.</li>
        </ul>
      </section>
    </>
  );
}

function Info({ label, value }) {
  return (
    <div style={{ background: "#fafafa", borderRadius: "9px", padding: "9px 11px" }}>
      <div style={{ fontSize: "10px", color: "#98a2b1", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      <div style={{ fontSize: "12.5px", color: "#1d2939", marginTop: "3px", wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: "11.5px", fontWeight: 700, color: "#475467", marginBottom: "5px" }}>{label}</span>
      {children}
    </label>
  );
}

const card = { background: "white", borderRadius: "14px", padding: "20px", boxShadow: "0 6px 20px rgba(16,24,40,.06)" };
const h2 = { margin: 0, fontSize: "16.5px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
const muted = { margin: "6px 0 0", color: "#667085", fontSize: "12px", lineHeight: 1.6 };
const input = { width: "100%", boxSizing: "border-box", border: "1px solid #d0d5dd", borderRadius: "9px", padding: "9px 11px", fontSize: "13px", background: "white", color: "#1d2939" };
const primary = { border: "none", borderRadius: "10px", padding: "10px 14px", background: "linear-gradient(135deg,#ff6b00,#ff1493)", color: "white", fontWeight: 800, cursor: "pointer", fontSize: "12.5px" };
const secondary = { border: "1px solid #d0d5dd", borderRadius: "10px", padding: "9px 13px", background: "white", color: "#344054", fontWeight: 700, cursor: "pointer", fontSize: "12.5px" };
const danger = { border: "1px solid #f3c6c6", borderRadius: "10px", padding: "9px 13px", background: "#fff5f5", color: "#b42318", fontWeight: 700, cursor: "pointer", fontSize: "12.5px" };
const tag = { display: "inline-block", padding: "3px 8px", borderRadius: "999px", fontWeight: 800 };
