import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  // Additive (Phase 1): custom favicon. Empty = keep the built-in
  // /favicon.svg — index.html is never modified.
  faviconUrl: "",
};

// ---------------------------------------------------------
// Phase 1 defaults — mirror the Buyer app's current hardcoded
// copy so the preview shows what buyers see today. Empty fields
// mean "fall back to the built-in Buyer copy".
// ---------------------------------------------------------

const FOOTER_DEFAULTS = {
  heading: "JustBrand",
  description:
    "भारत का अपना marketplace — shopping, selling और growing together.",
  aboutText: "About Us",
  contactText: "Contact Us",
  returnPolicyText: "Return & Refund Policy",
  deliveryPolicyText: "Shipping & Delivery Policy",
  privacyText: "Privacy Policy",
  termsText: "Terms & Conditions",
  familyText: "JustBrand Family",
  copyright: "",
  showFamily: true,
  active: true,
};

const POLICIES_DEFAULTS = {
  returnsTitle: "Return & Refund Policy",
  returnsText: "",
  shippingTitle: "Shipping & Delivery Policy",
  shippingText: "",
  privacyTitle: "Privacy Policy",
  privacyText: "",
  termsTitle: "Terms & Conditions",
  termsText: "",
  active: true,
};

const DELIVERY_DEFAULTS = {
  heading: "Delivery Information",
  description: "",
  timeline: "",
  support: "",
  policyText: "",
  active: true,
};

const FAMILY_DEFAULTS = {
  heading: "JustBrand Family",
  intro: "",
  howItWorks: "",
  treeExplanation: "",
  additionalInfo: "",
  active: true,
};

const REWARD_DEFAULTS = {
  heading: "Rewards & Benefits",
  explanation: "",
  rules: "",
  levelInfo: "",
  active: true,
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
      <ImagePicker
        label="Favicon (browser tab icon — optional)"
        value={value.faviconUrl || ""}
        onChange={(v) => setValue({ ...value, faviconUrl: v })}
      />
      <p className="ov-note">
        Leave the favicon empty to keep the default JustBrand favicon. It is
        applied live in the Buyer app — index.html is never modified.
      </p>
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

// ---------------------------------------------------------
// PHASE 1 EDITORS (Footer / Policies / Delivery / Family / Reward)
// ---------------------------------------------------------

function FooterEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.heading || "JustBrand"}</h3>
        <p>{value.description}</p>
        <ul className="jb-info-list">
          <li>{value.aboutText || "About Us"}</li>
          <li>{value.contactText || "Contact Us"}</li>
          <li>{value.returnPolicyText || "Return & Refund Policy"}</li>
          <li>{value.deliveryPolicyText || "Shipping & Delivery Policy"}</li>
          <li>{value.privacyText || "Privacy Policy"}</li>
          <li>{value.termsText || "Terms & Conditions"}</li>
          {value.showFamily ? <li>{value.familyText || "JustBrand Family"}</li> : null}
        </ul>
        <p className="ov-note">
          {value.copyright || `© ${new Date().getFullYear()} JustBrand`}
        </p>
        {!value.active ? (
          <p className="ov-note">Footer inactive — buyers see the built-in footer.</p>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className="cm-grid2">
        <Field label="Footer heading">
          <TextInput
            value={value.heading}
            maxLength={60}
            onChange={(v) => setValue({ ...value, heading: v })}
          />
        </Field>
        <Field label="Copyright text" hint="Empty → © [current year] JustBrand">
          <TextInput
            value={value.copyright}
            maxLength={120}
            placeholder={`© ${new Date().getFullYear()} JustBrand`}
            onChange={(v) => setValue({ ...value, copyright: v })}
          />
        </Field>
      </div>
      <Field label="Footer description">
        <TextArea
          value={value.description}
          rows={2}
          onChange={(v) => setValue({ ...value, description: v })}
        />
      </Field>
      <div className="cm-grid2">
        <Field label="About link text">
          <TextInput value={value.aboutText} maxLength={60} onChange={(v) => setValue({ ...value, aboutText: v })} />
        </Field>
        <Field label="Contact link text">
          <TextInput value={value.contactText} maxLength={60} onChange={(v) => setValue({ ...value, contactText: v })} />
        </Field>
        <Field label="Return policy link text">
          <TextInput value={value.returnPolicyText} maxLength={80} onChange={(v) => setValue({ ...value, returnPolicyText: v })} />
        </Field>
        <Field label="Delivery policy link text">
          <TextInput value={value.deliveryPolicyText} maxLength={80} onChange={(v) => setValue({ ...value, deliveryPolicyText: v })} />
        </Field>
        <Field label="Privacy policy link text">
          <TextInput value={value.privacyText} maxLength={80} onChange={(v) => setValue({ ...value, privacyText: v })} />
        </Field>
        <Field label="Terms link text">
          <TextInput value={value.termsText} maxLength={80} onChange={(v) => setValue({ ...value, termsText: v })} />
        </Field>
        <Field label="JustBrand Family link text">
          <TextInput value={value.familyText} maxLength={80} onChange={(v) => setValue({ ...value, familyText: v })} />
        </Field>
      </div>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.showFamily}
          onChange={(e) => setValue({ ...value, showFamily: e.target.checked })}
        />
        Show the JustBrand Family link in the footer
      </label>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        Active (uncheck to show the built-in footer instead)
      </label>
    </>
  );
}

function PoliciesEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.returnsTitle}</h3>
        <p>{value.returnsText || "[built-in Returns policy copy — unchanged]"}</p>
        <h3>{value.shippingTitle}</h3>
        <p>{value.shippingText || "[no admin copy yet — buyers see the default delivery notes]"}</p>
        <h3>{value.privacyTitle}</h3>
        <p>{value.privacyText || "[no admin copy yet]"}</p>
        <h3>{value.termsTitle}</h3>
        <p>{value.termsText || "[no admin copy yet]"}</p>
      </div>
    );
  }

  return (
    <>
      <div className="cm-grid2">
        <Field label="Returns — page title">
          <TextInput value={value.returnsTitle} maxLength={80} onChange={(v) => setValue({ ...value, returnsTitle: v })} />
        </Field>
        <Field label="Shipping — page title">
          <TextInput value={value.shippingTitle} maxLength={80} onChange={(v) => setValue({ ...value, shippingTitle: v })} />
        </Field>
      </div>
      <Field
        label="Returns / Refund policy text"
        hint="Leave empty to keep the existing built-in Returns page exactly as it is today."
      >
        <TextArea
          value={value.returnsText}
          rows={5}
          placeholder="Leave empty to keep the current Returns page"
          onChange={(v) => setValue({ ...value, returnsText: v })}
        />
      </Field>
      <Field
        label="Shipping / Delivery policy text"
        hint="Shown on the buyer Shipping & Delivery Policy page. Empty → built-in default."
      >
        <TextArea value={value.shippingText} rows={5} onChange={(v) => setValue({ ...value, shippingText: v })} />
      </Field>
      <div className="cm-grid2">
        <Field label="Privacy — page title">
          <TextInput value={value.privacyTitle} maxLength={80} onChange={(v) => setValue({ ...value, privacyTitle: v })} />
        </Field>
        <Field label="Terms — page title">
          <TextInput value={value.termsTitle} maxLength={80} onChange={(v) => setValue({ ...value, termsTitle: v })} />
        </Field>
      </div>
      <Field label="Privacy policy text">
        <TextArea value={value.privacyText} rows={5} onChange={(v) => setValue({ ...value, privacyText: v })} />
      </Field>
      <Field label="Terms & Conditions text">
        <TextArea value={value.termsText} rows={5} onChange={(v) => setValue({ ...value, termsText: v })} />
      </Field>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        Active (uncheck to keep all built-in policy pages unchanged)
      </label>
    </>
  );
}

function DeliveryEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.heading || "Delivery Information"}</h3>
        {value.description ? <p>{value.description}</p> : null}
        {value.timeline ? <p><strong>Timeline:</strong> {value.timeline}</p> : null}
        {value.support ? <p><strong>Support:</strong> {value.support}</p> : null}
        {value.policyText ? <p>{value.policyText}</p> : null}
      </div>
    );
  }

  return (
    <>
      <Field label="Delivery heading">
        <TextInput value={value.heading} maxLength={80} onChange={(v) => setValue({ ...value, heading: v })} />
      </Field>
      <Field label="Delivery description">
        <TextArea value={value.description} rows={3} onChange={(v) => setValue({ ...value, description: v })} />
      </Field>
      <div className="cm-grid2">
        <Field label="Delivery timeline text" hint="e.g. 3–7 business days across India">
          <TextInput value={value.timeline} maxLength={160} onChange={(v) => setValue({ ...value, timeline: v })} />
        </Field>
        <Field label="Delivery support information">
          <TextInput value={value.support} maxLength={200} onChange={(v) => setValue({ ...value, support: v })} />
        </Field>
      </div>
      <Field label="Delivery policy text" hint="Extra paragraph shown under the delivery information.">
        <TextArea value={value.policyText} rows={4} onChange={(v) => setValue({ ...value, policyText: v })} />
      </Field>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        Active (uncheck to hide the custom delivery information)
      </label>
      <p className="ov-note">
        This only changes display text — order delivery, partners and tracking
        are completely unaffected.
      </p>
    </>
  );
}

function FamilyEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.heading || "JustBrand Family"}</h3>
        {value.intro ? <p>{value.intro}</p> : null}
        {value.howItWorks ? (
          <><h4>How it works</h4><p>{value.howItWorks}</p></>
        ) : null}
        {value.treeExplanation ? (
          <><h4>Family tree — direct & spillover</h4><p>{value.treeExplanation}</p></>
        ) : null}
        {value.additionalInfo ? <p>{value.additionalInfo}</p> : null}
      </div>
    );
  }

  return (
    <>
      <Field label="Family heading" hint="Customer-facing name stays “JustBrand Family”.">
        <TextInput value={value.heading} maxLength={80} onChange={(v) => setValue({ ...value, heading: v })} />
      </Field>
      <Field label="Introduction">
        <TextArea value={value.intro} rows={3} onChange={(v) => setValue({ ...value, intro: v })} />
      </Field>
      <Field label="How it works">
        <TextArea value={value.howItWorks} rows={4} onChange={(v) => setValue({ ...value, howItWorks: v })} />
      </Field>
      <Field label="Tree / direct / spillover explanation">
        <TextArea value={value.treeExplanation} rows={4} onChange={(v) => setValue({ ...value, treeExplanation: v })} />
      </Field>
      <Field label="Additional customer-facing information (optional)">
        <TextArea value={value.additionalInfo} rows={3} onChange={(v) => setValue({ ...value, additionalInfo: v })} />
      </Field>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        Active (uncheck to show the built-in family copy)
      </label>
    </>
  );
}

function RewardEditor({ value, setValue, preview }) {
  if (preview) {
    return (
      <div className="cm-preview">
        <h3>{value.heading || "Rewards & Benefits"}</h3>
        {value.explanation ? <p>{value.explanation}</p> : null}
        {value.rules ? (
          <><h4>Reward rules</h4><p>{value.rules}</p></>
        ) : null}
        {value.levelInfo ? (
          <><h4>Level-wise rewards</h4><p>{value.levelInfo}</p></>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <Field label="Reward heading">
        <TextInput value={value.heading} maxLength={80} onChange={(v) => setValue({ ...value, heading: v })} />
      </Field>
      <Field label="Reward explanation">
        <TextArea value={value.explanation} rows={3} onChange={(v) => setValue({ ...value, explanation: v })} />
      </Field>
      <Field label="Reward rules / information">
        <TextArea value={value.rules} rows={5} onChange={(v) => setValue({ ...value, rules: v })} />
      </Field>
      <Field label="Level-wise reward information (optional)">
        <TextArea value={value.levelInfo} rows={4} onChange={(v) => setValue({ ...value, levelInfo: v })} />
      </Field>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!value.active}
          onChange={(e) => setValue({ ...value, active: e.target.checked })}
        />
        Active (uncheck to show the built-in reward copy)
      </label>
      <p className="ov-note">
        Display text only — reward calculations are not changed here.
      </p>
    </>
  );
}

const SECTION_CONFIG = {
  footer: {
    title: "🦶 Footer Content",
    description:
      "Footer heading, description, link labels and copyright shown on every Buyer page. Deactivate to fall back to the built-in footer.",
    storageKey: "footer",
    defaults: FOOTER_DEFAULTS,
    Editor: FooterEditor,
  },
  policies: {
    title: "📜 Policies (Returns / Shipping / Privacy / Terms)",
    description:
      "Customer-facing policy pages. Empty fields keep the Buyer app's built-in copy — the existing Returns page keeps working untouched.",
    storageKey: "policies",
    defaults: POLICIES_DEFAULTS,
    Editor: PoliciesEditor,
  },
  delivery: {
    title: "🛵 Delivery Information",
    description:
      "Delivery heading, timeline and support text shown to buyers. Order/delivery functionality itself is not affected.",
    storageKey: "delivery",
    defaults: DELIVERY_DEFAULTS,
    Editor: DeliveryEditor,
  },
  family: {
    title: "👨‍👩‍👧 JustBrand Family Information",
    description:
      "Customer-facing family program introduction, how-it-works and tree explanation. Internal /api/mlm routes and tables are untouched.",
    storageKey: "family",
    defaults: FAMILY_DEFAULTS,
    Editor: FamilyEditor,
  },
  reward: {
    title: "🎁 Reward Information",
    description:
      "Customer-facing reward heading, explanation and rules. The underlying calculation logic is NOT changed by this content.",
    storageKey: "reward",
    defaults: REWARD_DEFAULTS,
    Editor: RewardEditor,
  },
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
// CATEGORIES / SUB-CATEGORIES (Phase 1 — non-destructive)
// Add / edit / activate / reorder only. There is deliberately NO
// delete action: categories used by products are deactivated so
// existing products never lose their category.
// ---------------------------------------------------------

const CATEGORY_EMPTY = {
  name: "",
  icon: "",
  sortOrder: 0,
  active: true,
  parentId: null,
};

function CategoryForm({ initial, parents, onSave, onCancel, saving }) {
  const [draft, setDraft] = useState(
    initial ? { ...initial } : { ...CATEGORY_EMPTY }
  );
  const [error, setError] = useState("");

  function submit() {
    if (!String(draft.name || "").trim()) {
      setError("Category name is required.");
      return;
    }
    setError("");
    onSave({
      name: String(draft.name).trim(),
      icon: draft.icon || "",
      sortOrder: Number(draft.sortOrder) || 0,
      active: !!draft.active,
      parentId: draft.parentId ?? null,
    });
  }

  return (
    <div className="cm-bannerform">
      <div className="cm-grid2">
        <Field label="Category name *">
          <TextInput
            value={draft.name}
            maxLength={100}
            placeholder="e.g. Fashion"
            onChange={(v) => setDraft({ ...draft, name: v })}
          />
        </Field>
        <Field label="Icon (emoji, max 10 chars)">
          <TextInput
            value={draft.icon}
            maxLength={10}
            placeholder="e.g. 👕"
            onChange={(v) => setDraft({ ...draft, icon: v })}
          />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first.">
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
        <Field label="Parent category" hint="None = top-level category.">
          <select
            className="cm-input"
            value={draft.parentId ?? ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                parentId: e.target.value === "" ? null : Number(e.target.value),
              })
            }
          >
            <option value="">— Top-level —</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="cm-checkline">
        <input
          type="checkbox"
          checked={!!draft.active}
          onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
        />
        Active (visible to buyers and sellers)
      </label>
      {error ? <div className="cm-error">{error}</div> : null}
      <div className="cm-actions">
        <button type="button" className="approve" onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "✓ Save category"}
        </button>
        <button type="button" className="refresh-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CategoriesManager({ token, onMessage }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | category id
  const [newSubParent, setNewSubParent] = useState(null);

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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api("/api/admin/categories");
      setCategories(data.categories || []);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (token) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const parents = categories.filter((c) => c.parentId === null);
  const childrenOf = (id) =>
    categories.filter((c) => c.parentId === id);

  async function saveCategory(draft, id) {
    setSaving(true);
    try {
      if (id) {
        await api(`/api/admin/categories/${id}`, { method: "PUT", body: draft });
        onMessage("✅ Category updated successfully.");
      } else {
        await api("/api/admin/categories", { method: "POST", body: draft });
        onMessage("✅ Category added successfully.");
      }
      setEditing(null);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(category) {
    try {
      await api(`/api/admin/categories/${category.id}`, {
        method: "PUT",
        body: { active: !category.active },
      });
      onMessage(
        `✅ ${category.name} ${
          category.active ? "deactivated (kept safe — not deleted)" : "activated"
        }.`
      );
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  function renderRow(category, isChild) {
    if (editing === category.id) {
      return (
        <tr key={category.id}>
          <td colSpan={6}>
            <CategoryForm
              initial={category}
              parents={isChild ? parents : parents.filter((p) => p.id !== category.id)}
              saving={saving}
              onSave={(draft) => saveCategory(draft, category.id)}
              onCancel={() => setEditing(null)}
            />
          </td>
        </tr>
      );
    }

    return (
      <tr key={category.id}>
        <td>
          <span style={{ fontSize: "18px" }}>{category.icon || "📂"}</span>
        </td>
        <td>
          <span style={{ paddingLeft: isChild ? 18 : 0 }}>
            {isChild ? "└ " : ""}
            <strong>{category.name}</strong>
          </span>
        </td>
        <td>{category.sortOrder}</td>
        <td>
          <span
            className={`sec-tag ${category.active ? "sec-tag-good" : "sec-tag-bad"}`}
          >
            {category.active ? "Active" : "Inactive"}
          </span>
        </td>
        <td>
          {category.productCount || 0}
          {isChild ? "" : ` + ${category.subCategoryCount || 0} sub`}
        </td>
        <td>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              type="button"
              className="refresh-btn"
              onClick={() => setEditing(category.id)}
            >
              Edit
            </button>
            <button
              type="button"
              className="refresh-btn"
              onClick={() => toggleActive(category)}
            >
              {category.active ? "Deactivate" : "Activate"}
            </button>
          </div>
        </td>
      </tr>
    );
  }

  function handleNewSub(parentId) {
    setEditing("new");
    setNewSubParent(parentId);
  }

  return (
    <>
      <div className="sec-toolbar">
        <span className="sec-count">
          {categories.filter((c) => c.active).length} active / {categories.length} total
        </span>
        {editing === null && (
          <button
            className="approve"
            onClick={() => {
              setNewSubParent(null);
              setEditing("new");
            }}
          >
            ＋ Add category
          </button>
        )}
      </div>

      {editing === "new" && (
        <SectionCard
          title="New category"
          description="Categories are never deleted — deactivate them instead so products keep their category."
        >
          <CategoryForm
            initial={
              newSubParent
                ? { ...CATEGORY_EMPTY, parentId: newSubParent }
                : null
            }
            parents={parents}
            saving={saving}
            onSave={(draft) => saveCategory(draft, null)}
            onCancel={() => {
              setEditing(null);
              setNewSubParent(null);
            }}
          />
        </SectionCard>
      )}

      <div className="sec-tablewrap">
        {loading ? (
          <div className="empty">Loading categories…</div>
        ) : categories.length === 0 ? (
          <div className="empty">
            No categories yet — buyers and sellers keep showing the existing
            default categories until you add some.
          </div>
        ) : (
          <table className="sec-table">
            <thead>
              <tr>
                <th>Icon</th>
                <th>Name</th>
                <th>Order</th>
                <th>Status</th>
                <th>Used by</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {parents.map((parent) => (
                <Fragment key={parent.id}>
                  {renderRow(parent, false)}
                  {childrenOf(parent.id).map((child) => renderRow(child, true))}
                  <tr key={`add-${parent.id}`}>
                    <td colSpan={6}>
                      <button
                        type="button"
                        className="refresh-btn"
                        style={{ opacity: editing === null ? 1 : 0.5 }}
                        disabled={editing !== null}
                        onClick={() => handleNewSub(parent.id)}
                      >
                        ＋ Add sub-category under “{parent.name}”
                      </button>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="ov-note">
        There is no delete action on purpose: “Used by” shows how many products
        match each category, and deactivation hides a category from buyers and
        sellers without touching any product.
      </p>
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
  const isCategories = section === "categories";

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

  if (!config && !isBanners && !isCategories) {
    return <div className="empty">Unknown content section.</div>;
  }

  if (loading || (!isBanners && !isCategories && !draft)) {
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

  if (isCategories) {
    return (
      <div className="sec-wrap">
        <SectionCard
          title="📂 Categories & Sub-categories"
          description="Buyers and sellers pick from this list (API-backed). Existing products keep their free-text category — nothing is deleted, only activated or deactivated."
        >
          <CategoriesManager token={token} onMessage={onMessage} />
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
