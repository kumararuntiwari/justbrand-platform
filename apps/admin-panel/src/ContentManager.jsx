import { useEffect, useMemo, useRef, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

const PAGE_SIZE = 8;

// Max upload size for logo/banner images (2 MB keeps SQLite rows sane).
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

// ---------------------------------------------------------
// Default content shapes — pre-filled from the Buyer app's live
// fallback copy so an admin sees exactly what Buyer shows today.
// Nothing is saved until the admin presses Save.
// ---------------------------------------------------------

const ABOUT_DEFAULTS = {
  title: "About JustBrand",
  intro:
    "JustBrand is an Indian online marketplace built with a simple promise: genuine products, fair prices, and a shopping experience that feels made for India.",
  businessIntro:
    "From everyday electronics to home essentials, every product listed on JustBrand goes through a review process before it reaches you — so what you see is what trusted sellers actually deliver.",
  mission: "",
  vision: "",
  additionalInfo: "",
  active: true,
};

const CONTACT_DEFAULTS = {
  phone: "",
  email: "",
  whatsapp: "",
  address: "",
  supportInfo:
    "For order-related questions, please keep your order number handy — it helps us resolve your query faster.",
  supportHours: "Monday–Saturday, 10:00 AM – 7:00 PM IST",
  active: true,
};

const HOMEPAGE_DEFAULTS = {
  promoHeading: "Shop & Earn with JustBrand",
  promoSubtitle: "",
  announcement: "",
  ctaText: "Shop now",
  sectionVisible: true,
};

const BRANDING_DEFAULTS = {
  logoUrl: "",
  logoAlt: "JustBrand",
};

function Field({ label, hint, children }) {
  return (
    <label className="cm-field">
      <span className="cm-field-label">{label}</span>
      {children}
      {hint ? <small className="cm-field-hint">{hint}</small> : null}
    </label>
  );
}

function SectionCard({ title, description, actions, children }) {
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

// Text area / input pair helpers ----------------------------

function TextInput({ value, onChange, placeholder, maxLength }) {
  return (
    <input
      type="text"
      className="cm-input"
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({ value, onChange, rows = 3, placeholder }) {
  return (
    <textarea
      className="cm-input"
      rows={rows}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// Image picker with real validation (type + size) ------------

function ImagePicker({ value, onChange, label }) {
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  function handleFile(file) {
    setError("");

    if (!file) return;

    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
      setError("Only PNG, JPEG, WebP or GIF images are allowed.");
      return;
    }

    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image is too large — maximum 2 MB.");
      return;
    }

    const reader = new FileReader();

    reader.onload = () => onChange(String(reader.result || ""));
    reader.onerror = () => setError("Could not read the file. Try again.");

    reader.readAsDataURL(file);
  }

  return (
    <div className="cm-imagepicker">
      <span className="cm-field-label">{label}</span>
      <div className="cm-imagepicker-row">
        <div className="cm-imagepreview">
          {value ? (
            <img
              src={value}
              alt="Preview"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : (
            <span className="cm-imagepreview-empty">No image</span>
          )}
        </div>
        <div className="cm-imagepicker-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <button
            type="button"
            className="refresh-btn"
            onClick={() => inputRef.current?.click()}
          >
            ⬆ Upload image
          </button>
          <input
            type="text"
            className="cm-input"
            placeholder="…or paste an https image URL"
            value={value.startsWith("data:") ? "" : value}
            onChange={(e) => onChange(e.target.value)}
          />
          {value ? (
            <button
              type="button"
              className="refresh-btn"
              onClick={() => onChange("")}
            >
              ✕ Remove image
            </button>
          ) : null}
        </div>
      </div>
      <small className="cm-field-hint">
        PNG / JPEG / WebP / GIF · max 2 MB · https URL or upload
      </small>
      {error ? <div className="cm-error">{error}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------
// EDITOR SECTIONS
// ---------------------------------------------------------

function AboutEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.title || ABOUT_DEFAULTS.title}</h3>
        <p>{value.intro}</p>
        <p>{value.businessIntro}</p>
        {value.mission ? (
          <>
            <h4>Mission</h4>
            <p>{value.mission}</p>
          </>
        ) : null}
        {value.vision ? (
          <>
            <h4>Vision</h4>
            <p>{value.vision}</p>
          </>
        ) : null}
        {value.additionalInfo ? <p>{value.additionalInfo}</p> : null}
      </div>
    );
  }

  return (
    <>
      <Field label="Page title">
        <TextInput
          value={value.title}
          maxLength={120}
          onChange={(v) => setValue({ ...value, title: v })}
        />
      </Field>
      <Field label="Main description">
        <TextArea
          value={value.intro}
          onChange={(v) => setValue({ ...value, intro: v })}
        />
      </Field>
      <Field label="Business introduction">
        <TextArea
          value={value.businessIntro}
          onChange={(v) => setValue({ ...value, businessIntro: v })}
        />
      </Field>
      <Field label="Mission (optional)">
        <TextArea
          value={value.mission}
          onChange={(v) => setValue({ ...value, mission: v })}
        />
      </Field>
      <Field label="Vision (optional)">
        <TextArea
          value={value.vision}
          onChange={(v) => setValue({ ...value, vision: v })}
        />
      </Field>
      <Field label="Additional information (optional)">
        <TextArea
          value={value.additionalInfo}
          onChange={(v) => setValue({ ...value, additionalInfo: v })}
        />
      </Field>
    </>
  );
}

function ContactEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>Contact JustBrand</h3>
        <ul className="jb-info-list">
          <li><strong>Support hours:</strong> {value.supportHours || "—"}</li>
          <li><strong>Phone:</strong> {value.phone || "— not configured —"}</li>
          <li><strong>Email:</strong> {value.email || "— not configured —"}</li>
          <li><strong>WhatsApp:</strong> {value.whatsapp || "— not configured —"}</li>
          <li><strong>Address:</strong> {value.address || "— not configured —"}</li>
        </ul>
        {value.supportInfo ? <p>{value.supportInfo}</p> : null}
      </div>
    );
  }

  return (
    <>
      <Field label="Support phone" hint="Shown on the Buyer Contact Us page.">
        <TextInput
          value={value.phone}
          maxLength={30}
          placeholder="e.g. +91 90000 00000"
          onChange={(v) => setValue({ ...value, phone: v })}
        />
      </Field>
      <Field label="Support email" hint="Use the official support inbox address.">
        <TextInput
          value={value.email}
          maxLength={120}
          placeholder="e.g. support@justbrand.in"
          onChange={(v) => setValue({ ...value, email: v })}
        />
      </Field>
      <Field label="WhatsApp number (optional)">
        <TextInput
          value={value.whatsapp}
          maxLength={30}
          onChange={(v) => setValue({ ...value, whatsapp: v })}
        />
      </Field>
      <Field label="Business address">
        <TextArea
          value={value.address}
          rows={2}
          onChange={(v) => setValue({ ...value, address: v })}
        />
      </Field>
      <Field label="Support information">
        <TextArea
          value={value.supportInfo}
          onChange={(v) => setValue({ ...value, supportInfo: v })}
        />
      </Field>
      <Field label="Support hours">
        <TextInput
          value={value.supportHours}
          maxLength={120}
          onChange={(v) => setValue({ ...value, supportHours: v })}
        />
      </Field>
      <div className="cm-error" style={{ display: value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ? "block" : "none" }}>
        Email address format looks invalid.
      </div>
    </>
  );
}

function BrandingEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>Header (desktop & mobile)</h3>
        <div className="cm-logo-demo">
          <img
            src={value.logoUrl || "/images/logo.png"}
            alt={value.logoAlt || "JustBrand"}
            onError={(e) => {
              // Fallback safety: broken custom logo falls back to the
              // built-in default logo — never a broken image icon.
              if (!e.currentTarget.src.endsWith("/images/logo.png")) {
                e.currentTarget.src = "/images/logo.png";
              } else {
                e.currentTarget.style.visibility = "hidden";
              }
            }}
          />
          <span>{value.logoAlt || "JustBrand"}</span>
        </div>
        <p className="ov-note">
          This is exactly how the Buyer header will render the logo.
        </p>
      </div>
    );
  }

  return (
    <>
      <ImagePicker
        label="Logo"
        value={value.logoUrl}
        onChange={(v) => setValue({ ...value, logoUrl: v })}
      />
      <Field label="Logo alt text / brand name">
        <TextInput
          value={value.logoAlt}
          maxLength={40}
          onChange={(v) => setValue({ ...value, logoAlt: v })}
        />
      </Field>
      <p className="ov-note">
        Leave the logo empty to keep the default JustBrand logo. A broken or
        missing image automatically falls back to the default in the Buyer app.
      </p>
    </>
  );
}

function HomepageEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        {value.sectionVisible ? (
          <>
            {value.announcement ? (
              <div className="cm-announcement">{value.announcement}</div>
            ) : null}
            <div className="cm-promo-demo">
              <strong>{value.promoHeading}</strong>
              {value.promoSubtitle ? <span>{value.promoSubtitle}</span> : null}
              {value.ctaText ? <em>{value.ctaText} →</em> : null}
            </div>
          </>
        ) : (
          <p className="ov-note">Promotional section is hidden for buyers.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <Field label="Promotional heading">
        <TextInput
          value={value.promoHeading}
          maxLength={120}
          onChange={(v) => setValue({ ...value, promoHeading: v })}
        />
      </Field>
      <Field label="Promotional subtitle">
        <TextInput
          value={value.promoSubtitle}
          maxLength={200}
          onChange={(v) => setValue({ ...value, promoSubtitle: v })}
        />
      </Field>
      <Field label="Announcement (optional)">
        <TextInput
          value={value.announcement}
          maxLength={160}
          placeholder="e.g. Free delivery on first order"
          onChange={(v) => setValue({ ...value, announcement: v })}
        />
      </Field>
      <Field label="CTA text">
        <TextInput
          value={value.ctaText}
          maxLength={40}
          onChange={(v) => setValue({ ...value, ctaText: v })}
        />
      </Field>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.sectionVisible}
          onChange={(e) => setValue({ ...value, sectionVisible: e.target.checked })}
        />
        Show promotional section on the Buyer homepage
      </label>
    </>
  );
}

const SECTION_CONFIG = {
  about: {
    title: "📖 About Us Content",
    description:
      "This content appears on the Buyer app's About Us page the moment it is saved.",
    storageKey: "about",
    defaults: ABOUT_DEFAULTS,
    Editor: AboutEditor,
  },
  contact: {
    title: "📞 Contact Us Content",
    description:
      "Buyer app's Contact Us page renders this information exactly as saved.",
    storageKey: "contact",
    defaults: CONTACT_DEFAULTS,
    Editor: ContactEditor,
  },
  branding: {
    title: "🎨 Logo & Branding",
    description:
      "Logo used across the Buyer app header and mobile header. Default JustBrand logo is used until a new one is saved.",
    storageKey: "branding",
    defaults: BRANDING_DEFAULTS,
    Editor: BrandingEditor,
  },
  homepage: {
    title: "🏠 Homepage Content",
    description:
      "Promotional content shown on the Buyer homepage above the product grid.",
    storageKey: "homepage",
    defaults: HOMEPAGE_DEFAULTS,
    Editor: HomepageEditor,
  },
};

// ---------------------------------------------------------
// BANNERS
// ---------------------------------------------------------

const BANNER_EMPTY = {
  title: "",
  subtitle: "",
  ctaText: "",
  ctaLink: "",
  imageUrl: "",
  mobileImageUrl: "",
  active: true,
  sortOrder: 0,
};

function BannerForm({ initial, onSave, onCancel, saving }) {
  const [draft, setDraft] = useState(clone(initial) || { ...BANNER_EMPTY });
  const [error, setError] = useState("");

  function submit() {
    if (!draft.title.trim()) {
      setError("Banner title is required.");
      return;
    }
    setError("");
    onSave(draft);
  }

  return (
    <div className="cm-bannerform">
      <Field label="Banner title *">
        <TextInput
          value={draft.title}
          maxLength={120}
          onChange={(v) => setDraft({ ...draft, title: v })}
        />
      </Field>
      <Field label="Subtitle">
        <TextInput
          value={draft.subtitle}
          maxLength={200}
          onChange={(v) => setDraft({ ...draft, subtitle: v })}
        />
      </Field>
      <div className="cm-grid2">
        <Field label="CTA text">
          <TextInput
            value={draft.ctaText}
            maxLength={60}
            placeholder="e.g. Shop now"
            onChange={(v) => setDraft({ ...draft, ctaText: v })}
          />
        </Field>
        <Field label="CTA destination (optional)">
          <TextInput
            value={draft.ctaLink}
            maxLength={500}
            placeholder="https://… or an in-app path"
            onChange={(v) => setDraft({ ...draft, ctaLink: v })}
          />
        </Field>
      </div>
      <ImagePicker
        label="Desktop image"
        value={draft.imageUrl}
        onChange={(v) => setDraft({ ...draft, imageUrl: v })}
      />
      <ImagePicker
        label="Mobile image (optional — falls back to desktop image)"
        value={draft.mobileImageUrl}
        onChange={(v) => setDraft({ ...draft, mobileImageUrl: v })}
      />
      <div className="cm-grid2">
        <Field label="Display order" hint="Lower numbers appear first.">
          <input
            type="number"
            className="cm-input"
            min="0"
            max="10000"
            value={draft.sortOrder}
            onChange={(e) =>
              setDraft({ ...draft, sortOrder: Number(e.target.value) || 0 })
            }
          />
        </Field>
        <label className="cm-checkline" style={{ marginTop: "22px" }}>
          <input
            type="checkbox"
            checked={!!draft.active}
            onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
          />
          Active (visible to buyers)
        </label>
      </div>
      {error ? <div className="cm-error">{error}</div> : null}
      <div className="cm-actions">
        <button type="button" className="approve" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "✓ Save banner"}
        </button>
        <button type="button" className="refresh-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function BannersManager({ banners, reload, token, onMessage }) {
  const [editing, setEditing] = useState(null); // null | "new" | banner id
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return banners;
    return banners.filter((b) =>
      `${b.title || ""} ${b.subtitle || ""}`.toLowerCase().includes(q)
    );
  }, [banners, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  async function api(path, options) {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(options?.headers || {}),
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      throw new Error(data?.message || `Request failed (${response.status})`);
    }

    return data;
  }

  async function saveBanner(draft, id) {
    setSaving(true);

    try {
      if (id) {
        await api(`/api/admin/site/banners/${id}`, { method: "PUT", body: draft });
        onMessage("✅ Banner updated successfully.");
      } else {
        await api("/api/admin/site/banners", { method: "POST", body: draft });
        onMessage("✅ Banner added successfully.");
      }

      setEditing(null);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(banner) {
    try {
      await api(`/api/admin/site/banners/${banner.id}`, {
        method: "PUT",
        body: { active: !banner.active },
      });
      onMessage(`✅ Banner ${banner.active ? "hidden from" : "visible to"} buyers.`);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function deleteBanner(banner) {
    if (!window.confirm(`Delete banner “${banner.title}”? This cannot be undone.`)) {
      return;
    }

    try {
      await api(`/api/admin/site/banners/${banner.id}`, { method: "DELETE" });
      onMessage("✅ Banner deleted.");
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  return (
    <>
      <div className="sec-toolbar">
        <input
          className="sec-search"
          placeholder="Search banners…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
        />
        <span className="sec-count">
          {banners.filter((b) => b.active).length} active / {banners.length} total
        </span>
        {editing === null && (
          <button className="approve" onClick={() => setEditing("new")}>
            ＋ Add banner
          </button>
        )}
      </div>

      {editing === "new" && (
        <SectionCard title="New banner" description="Fill the details and save.">
          <BannerForm
            initial={null}
            saving={saving}
            onSave={(draft) => saveBanner(draft, null)}
            onCancel={() => setEditing(null)}
          />
        </SectionCard>
      )}

      <div className="sec-tablewrap">
        {pageRows.length === 0 ? (
          <div className="empty">
            {banners.length === 0
              ? "No banners yet — buyers see the default JustBrand hero strip until you add one."
              : "No banners match this search."}
          </div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Preview</th>
                <th>Title / Subtitle</th>
                <th>CTA</th>
                <th>Order</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((banner) =>
                editing === banner.id ? (
                  <tr key={banner.id}>
                    <td colSpan={6}>
                      <BannerForm
                        initial={banner}
                        saving={saving}
                        onSave={(draft) => saveBanner(draft, banner.id)}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr key={banner.id}>
                    <td>
                      {banner.imageUrl ? (
                        <img
                          className="cm-bannerthumb"
                          src={banner.imageUrl}
                          alt={banner.title}
                          onError={(e) => {
                            e.currentTarget.style.visibility = "hidden";
                          }}
                        />
                      ) : (
                        <div className="cm-bannerthumb cm-bannerthumb-empty">—</div>
                      )}
                    </td>
                    <td>
                      <strong>{banner.title}</strong>
                      {banner.subtitle ? (
                        <>
                          <br />
                          <small>{banner.subtitle}</small>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {banner.ctaText || "—"}
                      {banner.ctaLink ? (
                        <>
                          <br />
                          <small className="ov-note">{banner.ctaLink}</small>
                        </>
                      ) : null}
                    </td>
                    <td>{banner.sortOrder}</td>
                    <td>
                      <span
                        className={`sec-tag ${banner.active ? "sec-tag-good" : "sec-tag-bad"}`}
                      >
                        {banner.active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => setEditing(banner.id)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="refresh-btn"
                          onClick={() => toggleActive(banner)}
                        >
                          {banner.active ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          className="reject"
                          onClick={() => deleteBanner(banner)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        )}
      </div>

      {pageCount > 1 && (
        <div className="sec-pager">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
            ‹ Prev
          </button>
          <span>
            Page {safePage} of {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------

export default function ContentManager({ token, section, isSuper, onMessage }) {
  const [settings, setSettings] = useState(null);
  const [banners, setBanners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);

  const config = SECTION_CONFIG[section];
  const isBanners = section === "banners";

  const [draft, setDraft] = useState(null);

  async function reload() {
    setLoading(true);

    try {
      const response = await fetch(`${API}/api/admin/site/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);

      if (response.status === 401) {
        onMessage("❌ Session expired — please log in again.");
        return;
      }

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Could not load content settings.");
      }

      setSettings(data.settings || {});
      setBanners(data.banners || []);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      reload();
      setDirty(false);
      setPreview(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, section]);

  // Seed the local draft from saved settings (or section defaults) —
  // the defaults mirror the Buyer app's built-in fallback copy.
  useEffect(() => {
    if (!config) return;

    const saved = settings?.[config.storageKey];
    const base = saved ? { ...config.defaults, ...saved } : { ...config.defaults };

    setDraft(base);
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, section]);

  function guardDirty(action) {
    if (dirty && !window.confirm("You have unsaved changes. Discard them?")) {
      return;
    }
    action();
  }

  async function save() {
    if (!config || !draft) return;

    setSaving(true);

    try {
      const response = await fetch(
        `${API}/api/admin/site/settings/${config.storageKey.replace("site_", "")}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ content: draft }),
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Save failed.");
      }

      onMessage("✅ Content saved — Buyer app will show it on next load.");
      setDirty(false);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    guardDirty(() => {
      setDraft({ ...config.defaults });
      setDirty(true);
    });
  }

  if (!config && !isBanners) {
    return <div className="empty">Unknown content section.</div>;
  }

  if (loading || (!isBanners && !draft)) {
    return (
      <div className="ov-skeleton-grid">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="ov-skeleton" />
        ))}
      </div>
    );
  }

  if (isBanners) {
    return (
      <div className="sec-wrap">
        <SectionCard
          title="🖼️ Homepage Banners"
          description="Buyers see only ACTIVE banners, in display order, on the homepage. Inactive banners are kept here but hidden."
        >
          <BannersManager
            banners={banners}
            reload={reload}
            token={token}
            onMessage={onMessage}
          />
        </SectionCard>
      </div>
    );
  }

  const Editor = config.Editor;
  const setDraftValue = (next) => {
    setDraft(next);
    setDirty(true);
  };

  return (
    <div className="sec-wrap">
      <SectionCard
        title={config.title}
        description={config.description}
        actions={
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="refresh-btn"
              onClick={() => setPreview(!preview)}
            >
              {preview ? "✏️ Edit" : "👁 Preview"}
            </button>
          </div>
        }
      >
        {preview ? (
          <Editor value={draft} setValue={setDraftValue} preview />
        ) : (
          <Editor value={draft} setValue={setDraftValue} preview={false} />
        )}

        {!preview && (
          <>
            <div className="cm-actions">
              <button
                type="button"
                className="approve"
                onClick={save}
                disabled={saving}
              >
                {saving ? "Saving…" : "✓ Save"}
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={() =>
                  guardDirty(() => {
                    const saved = settings?.[config.storageKey];
                    setDraft(
                      saved
                        ? { ...config.defaults, ...saved }
                        : { ...config.defaults }
                    );
                    setDirty(false);
                  })
                }
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="refresh-btn"
                onClick={resetToDefaults}
                disabled={saving}
              >
                ↺ Reset to defaults
              </button>
              {dirty ? (
                <span className="cm-dirtytag">● Unsaved changes</span>
              ) : null}
            </div>
            {!isSuper && section !== "about" && section !== "contact" && (
              <p className="ov-note">
                Some branding actions are restricted to Super Admin.
              </p>
            )}
          </>
        )}
      </SectionCard>
    </div>
  );
}
