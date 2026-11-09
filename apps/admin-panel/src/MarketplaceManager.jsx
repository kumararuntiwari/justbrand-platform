// =====================================================
// ADMIN — MARKETPLACE CONNECTORS (Amazon / Flipkart / Meesho / GlowRoad)
// =====================================================
// • provider-wide enable/disable + app credentials (write-only, encrypted)
// • seller-wise approve / reject / per-connection disable
// • connection status, last sync, imported counts and error history
// • manual sync for support/retry
// No credential/token is ever rendered — the API only returns hints.

import { useEffect, useState } from "react";
import { API } from "./apiConfig";

const PROVIDER_ORDER = ["amazon", "flipkart", "meesho", "glowroad"];

export default function MarketplaceManager({ token, onMessage }) {
  const [providers, setProviders] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [runs, setRuns] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

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

    if (!response.ok) throw new Error(data?.message || `Request failed (HTTP ${response.status}).`);
    return data;
  }

  async function load() {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      request("/api/admin/marketplaces"),
      request("/api/admin/marketplace-sync-runs"),
    ]);

    if (results[0].status === "fulfilled") {
      setProviders(results[0].value.providers || []);
      setIntegrations(results[0].value.integrations || []);
    }
    if (results[1].status === "fulfilled") setRuns(results[1].value.runs || []);

    const failed = results.find((result) => result.status === "rejected");
    if (failed) setError(failed.reason?.message || "Could not load marketplace data.");
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function notify(text) {
    if (onMessage) onMessage(text);
  }

  function draftFor(provider) {
    return drafts[provider.key] || {};
  }

  function setDraft(provider, patch) {
    setDrafts((previous) => ({ ...previous, [provider.key]: { ...(previous[provider.key] || {}), ...patch } }));
  }

  async function saveProvider(provider) {
    setBusy(provider.key);
    setError("");
    try {
      const draft = draftFor(provider);
      const data = await request(`/api/admin/marketplaces/providers/${provider.key}`, {
        method: "PUT",
        body: JSON.stringify({
          enabled: draft.enabled === undefined ? provider.enabled : Boolean(draft.enabled),
          credentials: draft.credentials || {},
        }),
      });
      notify(data.message || "Marketplace settings saved.");
      setDrafts((previous) => ({ ...previous, [provider.key]: {} }));
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleProvider(provider, enabled) {
    setDrafts((previous) => ({ ...previous, [provider.key]: { ...(previous[provider.key] || {}), enabled } }));
  }

  async function approve(row) {
    setBusy(`i${row.id}`);
    try {
      const data = await request(`/api/admin/marketplaces/${row.id}/approve`, { method: "POST" });
      notify(data.message || "Approved.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function reject(row) {
    const reason = window.prompt("Rejection reason shown to the seller:", "Credentials not verified");
    if (reason === null) return;
    setBusy(`i${row.id}`);
    try {
      const data = await request(`/api/admin/marketplaces/${row.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      notify(data.message || "Rejected.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function toggleIntegration(row) {
    setBusy(`i${row.id}`);
    try {
      const data = await request(`/api/admin/marketplaces/${row.id}/toggle`, {
        method: "POST",
        body: JSON.stringify({ disabled: !row.adminDisabled }),
      });
      notify(data.message || "Updated.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function syncNow(row) {
    setBusy(`i${row.id}`);
    try {
      const data = await request(`/api/admin/marketplaces/${row.id}/sync`, { method: "POST" });
      notify(data.message || "Sync finished.");
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (loading && providers.length === 0) {
    return <p style={{ margin: 0, color: "#6b6b74" }}>Loading marketplace connectors…</p>;
  }

  return (
    <div>
      {error ? (
        <div style={{ marginBottom: "14px", padding: "10px 14px", borderRadius: "10px", background: "#fff0f0", color: "#c00", fontSize: "13px" }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "12px" }}>
        {[...providers]
          .sort((a, b) => PROVIDER_ORDER.indexOf(a.key) - PROVIDER_ORDER.indexOf(b.key))
          .map((provider) => {
            const draft = draftFor(provider);
            const enabled = draft.enabled === undefined ? provider.enabled : draft.enabled;

            return (
              <div key={provider.key} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <b style={{ fontSize: "14px" }}>{provider.label}</b>{" "}
                    <span className="sec-tag">{provider.appConfigured ? "App configured" : "App setup needed"}</span>{" "}
                    {provider.verification === "unverified_partner" ? (
                      <span className="sec-tag sec-tag-warn">UNVERIFIED</span>
                    ) : null}
                    {provider.apiAccessRequired ? <span className="sec-tag sec-tag-warn">API access required</span> : null}
                  </div>
                  <a href={provider.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: "12px", fontWeight: 700, color: "#a06a00" }}>
                    Official docs ↗
                  </a>
                </div>

                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "#7a7a83", lineHeight: 1.6 }}>{provider.notes}</p>

                <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginTop: "10px", fontSize: "12px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input type="checkbox" checked={Boolean(enabled)} onChange={(event) => toggleProvider(provider, event.target.checked)} />
                    Enabled for sellers
                  </label>
                  <span style={{ color: "#6b6b74" }}>
                    {integrations.filter((row) => row.provider === provider.key).length} seller connection(s)
                  </span>
                </div>

                {provider.apiAccessRequired ? (
                  <p style={{ margin: "10px 0 0", padding: "10px 12px", borderRadius: "8px", background: "#fff8ea", color: "#8a5b00", fontSize: "12px", lineHeight: 1.6 }}>
                    Meesho का कोई public seller API नहीं है — sellers के लिए authorized bulk CSV/XLSX import उपलब्ध है.
                    इसे API connector के रूप में enable नहीं किया जाता.
                  </p>
                ) : null}

                {provider.appFields?.length ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: "10px", marginTop: "12px" }}>
                    {provider.appFields.map((field) => (
                      <label key={field.key} style={{ display: "block" }}>
                        <span style={{ display: "block", fontSize: "11.5px", fontWeight: 700, color: "#33333a", marginBottom: "4px" }}>
                          {field.label}
                          {field.required ? " *" : ""}
                        </span>
                        <input
                          type={field.secret ? "password" : "text"}
                          autoComplete="new-password"
                          placeholder={field.hasValue ? `Saved (${field.hint})` : "Not set"}
                          value={draft.credentials?.[field.key] || ""}
                          onChange={(event) =>
                            setDraft(provider, {
                              credentials: { ...(draft.credentials || {}), [field.key]: event.target.value },
                            })
                          }
                          style={inputStyle}
                        />
                      </label>
                    ))}
                  </div>
                ) : null}

                <div style={{ marginTop: "12px" }}>
                  <button type="button" style={primaryBtn} disabled={busy === provider.key} onClick={() => saveProvider(provider)}>
                    {busy === provider.key ? "Saving…" : "💾 Save provider settings"}
                  </button>
                </div>
              </div>
            );
          })}
      </div>

      <div className="products-section" style={{ marginTop: "18px" }}>
        <div className="section-title">
          <div>
            <h2>Seller marketplace connections</h2>
            <p>Approve, disable or re-sync a single seller's Amazon / Flipkart / GlowRoad connection.</p>
          </div>
          <span>{integrations.length} total</span>
        </div>

        {integrations.length === 0 ? (
          <p style={{ margin: 0, color: "#6b6b74" }}>No seller has connected a marketplace yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {integrations.map((row) => (
              <div key={row.id} style={{ ...cardStyle, padding: "14px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <b>
                      {row.providerLabel} · {row.shopName || row.sellerName}
                    </b>{" "}
                    <span className={`sec-tag ${row.status === "Approved" ? "sec-tag-good" : row.status === "Rejected" ? "sec-tag-bad" : "sec-tag-warn"}`}>
                      {row.status}
                    </span>{" "}
                    {row.adminDisabled ? <span className="sec-tag sec-tag-bad">Disabled</span> : null}
                    {!row.providerEnabled ? <span className="sec-tag sec-tag-warn">Provider off</span> : null}
                  </div>

                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <button type="button" style={approveBtn} disabled={busy === `i${row.id}` || row.status === "Approved"} onClick={() => approve(row)}>
                      ✅ Approve
                    </button>
                    <button type="button" style={rejectBtn} disabled={busy === `i${row.id}`} onClick={() => reject(row)}>
                      ⛔ Reject
                    </button>
                    <button type="button" style={ghostBtn} disabled={busy === `i${row.id}`} onClick={() => toggleIntegration(row)}>
                      {row.adminDisabled ? "▶ Enable" : "⏸ Disable"}
                    </button>
                    <button type="button" style={ghostBtn} disabled={busy === `i${row.id}` || row.status !== "Approved"} onClick={() => syncNow(row)}>
                      🔄 Sync now
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "8px", marginTop: "10px", fontSize: "11.5px", color: "#55555e" }}>
                  <span>Account: <b>{row.accountLabel || row.externalSellerId || "—"}</b></span>
                  <span>Connection: <b>{row.connectionStatus}</b></span>
                  <span>Last sync: <b>{row.lastSyncAt ? String(row.lastSyncAt).slice(0, 16).replace("T", " ") : "—"}</b></span>
                  <span>Last successful: <b>{row.lastSuccessfulSyncAt ? String(row.lastSuccessfulSyncAt).slice(0, 16).replace("T", " ") : "—"}</b></span>
                  <span>Imported: <b>{row.totalImportedCount}</b></span>
                  <span>Next run: <b>{row.nextSyncAt ? String(row.nextSyncAt).slice(0, 16).replace("T", " ") : "—"}</b></span>
                </div>

                {row.lastSyncError ? (
                  <p style={{ margin: "8px 0 0", fontSize: "11.5px", color: "#c00" }}>Sync error: {row.lastSyncError}</p>
                ) : null}
                {row.rejectionReason ? (
                  <p style={{ margin: "6px 0 0", fontSize: "11.5px", color: "#a06a00" }}>Rejection: {row.rejectionReason}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="products-section" style={{ marginTop: "18px" }}>
        <div className="section-title">
          <div>
            <h2>Marketplace sync history &amp; errors</h2>
            <p>Manual and scheduled runs across every seller, with per-item errors.</p>
          </div>
          <span>{runs.length} runs</span>
        </div>

        {runs.length === 0 ? (
          <p style={{ margin: 0, color: "#6b6b74" }}>No marketplace sync has run yet.</p>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {runs.slice(0, 20).map((run) => (
              <div key={run.id} style={{ ...cardStyle, padding: "12px" }}>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", fontSize: "12px" }}>
                  <span className={`sec-tag ${run.status === "success" ? "sec-tag-good" : run.status === "failed" ? "sec-tag-bad" : "sec-tag-warn"}`}>
                    {run.status}
                  </span>
                  <b>#{run.id}</b>
                  <span>{run.shopName || run.sellerName}</span>
                  <span style={{ textTransform: "capitalize" }}>{run.provider}</span>
                  <span>{run.trigger}</span>
                  <span style={{ color: "#9a9aa3" }}>{String(run.startedAt || "").slice(0, 16).replace("T", " ")}</span>
                  <span>fetched {run.fetched}</span>
                  <span>created {run.created}</span>
                  <span>updated {run.updated}</span>
                  <span style={{ color: run.failed ? "#c00" : undefined }}>failed {run.failed}</span>
                </div>
                {Array.isArray(run.errors) && run.errors.length > 0 ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: "18px", fontSize: "11.5px", color: "#c00" }}>
                    {run.errors.slice(0, 6).map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const cardStyle = { border: "1px solid #f0f0f3", borderRadius: "12px", padding: "16px", background: "#fdfdfe" };
const inputStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #e0e0e6", borderRadius: "9px", padding: "9px 11px", fontSize: "13px", background: "white", color: "#17171c" };
const primaryBtn = { border: "none", borderRadius: "9px", padding: "9px 13px", background: "#138808", color: "white", fontWeight: 700, cursor: "pointer", fontSize: "12.5px" };
const approveBtn = primaryBtn;
const rejectBtn = { border: "1px solid #f3c6c6", borderRadius: "9px", padding: "9px 13px", background: "#fff5f5", color: "#c00", fontWeight: 700, cursor: "pointer", fontSize: "12.5px" };
const ghostBtn = { border: "1px solid #e0e0e6", borderRadius: "9px", padding: "9px 13px", background: "white", color: "#33333a", fontWeight: 700, cursor: "pointer", fontSize: "12.5px" };
