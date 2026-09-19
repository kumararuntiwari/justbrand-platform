import { useEffect, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

// ---------------------------------------------------------
// BUYER SETTINGS PANEL
// Read-only operational overview of Buyer-experience behaviour
// driven by the JustBrand backend. Sensitive/creative content
// editing lives in the Business and Buyer Experience sections;
// this panel surfaces the current state so admins can sanity
// check what buyers currently see.
// ---------------------------------------------------------

function Stat({ label, value, tone }) {
  return (
    <div className={`ov-kpi ${tone ? tone : ""}`} style={{ padding: "16px" }}>
      <span style={{ fontSize: "12px", opacity: 0.75 }}>{label}</span>
      <strong style={{ display: "block", fontSize: "24px", marginTop: "4px" }}>
        {value}
      </strong>
    </div>
  );
}

export default function BuyerSettingsPanel({ customers, products }) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`${API}/api/site/content`);

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json().catch(() => null);

        if (!cancelled && data?.success) {
          setContent(data.content || {});
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const activeBanners = (content?.banners || []).filter((b) => b.active);
  const branding = content?.branding || {};
  const homepage = content?.homepage || {};

  return (
    <div className="sec-wrap">
      <section className="products-section">
          <div className="section-title">
            <div>
              <h2>⚙️ Buyer Settings</h2>
              <p>
                Buyer app अभी क्या दिखा रहा है — live production content feed से
                (`/api/site/content`)। Edit करने के लिए Buyer Experience
                section में जाएँ।
              </p>
            </div>
          </div>

          {error ? (
            <div className="cm-error">
              Content feed नहीं मिला ({error}) — Buyer app अपने built-in
              defaults दिखा रहा है (fallback safety)।
            </div>
          ) : !content ? (
            <div className="ov-skeleton-grid">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="ov-skeleton" />
              ))}
            </div>
          ) : (
            <>
              <div className="ov-kpis">
                <Stat
                  label="Active homepage banners"
                  value={activeBanners.length}
                  tone={activeBanners.length ? "approved-card" : "pending-card"}
                />
                <Stat
                  label="Custom logo set"
                  value={branding?.logoUrl ? "Yes" : "Default"}
                />
                <Stat
                  label="Custom About content"
                  value={content?.about ? "Yes" : "Default copy"}
                />
                <Stat
                  label="Custom Contact content"
                  value={content?.contact ? "Yes" : "Default copy"}
                />
              </div>

              <div className="cm-grid2" style={{ marginTop: "16px" }}>
                <div>
                  <strong style={{ fontSize: "13px" }}>Homepage promo</strong>
                  <ul className="jb-info-list" style={{ marginTop: "6px" }}>
                    <li>
                      <strong>Heading:</strong> {homepage.promoHeading || "—"}
                    </li>
                    <li>
                      <strong>Subtitle:</strong> {homepage.promoSubtitle || "—"}
                    </li>
                    <li>
                      <strong>Announcement:</strong> {homepage.announcement || "—"}
                    </li>
                    <li>
                      <strong>Section visible:</strong>{" "}
                      {homepage.sectionVisible === false ? "No" : "Yes"}
                    </li>
                  </ul>
                </div>
                <div>
                  <strong style={{ fontSize: "13px" }}>Buyers & products</strong>
                  <ul className="jb-info-list" style={{ marginTop: "6px" }}>
                    <li>
                      <strong>Buyers (loaded):</strong> {customers?.length ?? "—"}
                    </li>
                    <li>
                      <strong>Products (loaded):</strong> {products?.length ?? "—"}
                    </li>
                    <li>
                      <strong>Banners total:</strong>{" "}
                      {(content?.banners || []).length}
                    </li>
                  </ul>
                  <p className="ov-note">
                    Buyer app products/banners live-update करता है — यह panel
                    सिर्फ current state दिखाता है।
                  </p>
                </div>
              </div>
            </>
          )}
      </section>
    </div>
  );
}
