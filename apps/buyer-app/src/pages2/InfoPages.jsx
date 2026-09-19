import React from "react";

// =====================================================
// JUSTBRAND BUYER INFO PAGES
// =====================================================
// Contact Us / About Us / Return & Refund Policy.
// Purely informational — no business data is invented here.
// Content edited by the Admin Panel (site content feed) is
// rendered when available; otherwise the built-in default
// copy below is shown (fallback safety — never blank).
// Any detail not yet confirmed by the company is marked as
// a clearly-labeled configuration placeholder.

export const infoPageMeta = {
  contact: { title: "Contact Us — JustBrand" },
  about: { title: "About Us — JustBrand" },
  returns: { title: "Return & Refund Policy — JustBrand" },
};

function Section({ title, children }) {
  return (
    <div className="jb-info-card">
      <div className="jb-tricolor-bar" />
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function hasText(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function ContactPage({ content }) {
  const c = content || {};

  return (
    <>
      <Section title="We're Here to Help">
        <p>
          Have a question about an order, a product, selling on
          JustBrand, or the JustBrand Family program? Our team is
          happy to help.
        </p>
        <p>
          <strong>Customer support hours:</strong>{" "}
          {hasText(c.supportHours)
            ? c.supportHours
            : "Monday–Saturday, 10:00 AM – 7:00 PM IST"}
        </p>
        {hasText(c.supportInfo) ? <p>{c.supportInfo}</p> : null}
      </Section>

      <Section title="Reach Us">
        <ul className="jb-info-list">
          <li>
            <strong>Customer support email:</strong>{" "}
            {hasText(c.email) ? (
              c.email
            ) : (
              <em style={{ color: "#a06a00" }}>
                [support email — to be configured]
              </em>
            )}
          </li>
          <li>
            <strong>Support phone / WhatsApp:</strong>{" "}
            {hasText(c.phone) || hasText(c.whatsapp) ? (
              <>
                {hasText(c.phone) ? c.phone : null}
                {hasText(c.phone) && hasText(c.whatsapp) ? " · " : null}
                {hasText(c.whatsapp) ? `WhatsApp: ${c.whatsapp}` : null}
              </>
            ) : (
              <em style={{ color: "#a06a00" }}>
                [support number — to be configured]
              </em>
            )}
          </li>
          <li>
            <strong>Seller enquiries:</strong> use the “Sell on
            JustBrand” option in the menu to register as a seller.
          </li>
          <li>
            <strong>Registered office:</strong>{" "}
            {hasText(c.address) ? (
              c.address
            ) : (
              <em style={{ color: "#a06a00" }}>
                [registered address — to be configured]
              </em>
            )}
          </li>
        </ul>
      </Section>

      {!hasText(c.supportInfo) && (
        <Section title="Before You Write">
          <p>
            For order-related questions, please keep your order number
            handy — you can find all your orders in the
            “Orders” section of your account. It helps us resolve your
            query faster.
          </p>
        </Section>
      )}
    </>
  );
}

function AboutPage({ content }) {
  const c = content || {};

  return (
    <>
      <Section title={hasText(c.title) ? c.title : "About JustBrand"}>
        {hasText(c.intro) ? <p>{c.intro}</p> : (
          <p>
            JustBrand is an Indian online marketplace built with a
            simple promise: genuine products, fair prices, and a
            shopping experience that feels made for India.
          </p>
        )}
        {hasText(c.businessIntro) ? (
          <p>{c.businessIntro}</p>
        ) : (
          <p>
            From everyday electronics to home essentials, every product
            listed on JustBrand goes through a review process before it
            reaches you — so what you see is what trusted sellers
            actually deliver.
          </p>
        )}
      </Section>

      {hasText(c.mission) || hasText(c.vision) ? (
        <Section title="Our Mission & Vision">
          {hasText(c.mission) ? (
            <p>
              <strong>Mission:</strong> {c.mission}
            </p>
          ) : null}
          {hasText(c.vision) ? (
            <p>
              <strong>Vision:</strong> {c.vision}
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section title="What Makes Us Different">
        <ul className="jb-info-list">
          <li>
            <strong>Verified sellers:</strong> sellers complete a KYC
            verification before their products can go live.
          </li>
          <li>
            <strong>Reviewed listings:</strong> products are approved
            by our team before they appear on the storefront.
          </li>
          <li>
            <strong>Transparent pricing:</strong> the price you see is
            the price you pay at checkout — confirmed again on the
            server when you order.
          </li>
          <li>
            <strong>Compare before you buy:</strong> our Compare Price
            feature helps you see how a product stacks up before you
            commit.
          </li>
        </ul>
      </Section>

      {hasText(c.additionalInfo) ? (
        <Section title="More About Us">
          <p>{c.additionalInfo}</p>
        </Section>
      ) : null}

      <Section title="JustBrand Family">
        <p>
          JustBrand Family is our member rewards program. Members get
          a personal referral code, can build their own team, and earn
          commissions on qualifying purchases made through their
          network. You can join from the “JustBrand Family” option in
          the menu — participation is always optional.
        </p>
      </Section>

      <Section title="Our Promise">
        <p>
          भारत का अपना मार्केटप्लेस — honest listings, careful
          sellers, and support that speaks your language. That is the
          JustBrand way.
        </p>
      </Section>
    </>
  );
}

function ReturnsPage() {
  return (
    <>
      <Section title="Return & Refund Policy">
        <p>
          We want you to be satisfied with every JustBrand order. This
          policy explains when and how returns and refunds work.
        </p>
      </Section>

      <Section title="Eligibility for Return">
        <ul className="jb-info-list">
          <li>
            Return requests must be raised within{" "}
            <strong>
              {/* CONFIG PLACEHOLDER: confirm the return window in days. */}
              [7 days — to be configured]
            </strong>{" "}
            of delivery.
          </li>
          <li>
            The item should be unused, with original tags, packaging
            and accessories included.
          </li>
          <li>
            Certain categories (such as innerwear, personal-care items
            and perishables) may be non-returnable for hygiene and
            safety reasons. This is always shown on the product page
            where applicable.
          </li>
          <li>
            Items damaged in transit or significantly different from
            the listing are always eligible — just include photos when
            you contact support.
          </li>
        </ul>
      </Section>

      <Section title="How to Raise a Return">
        <ul className="jb-info-list">
          <li>
            Open <strong>Orders</strong> in your account and select the
            order.
          </li>
          <li>
            Contact support with your order number and the reason for
            return.
          </li>
          <li>
            Our team reviews the request and guides you through pickup
            or drop-off of the item.
          </li>
        </ul>
      </Section>

      <Section title="Refunds">
        <ul className="jb-info-list">
          <li>
            Once the returned item is received and passes a quality
            check, your refund is initiated.
          </li>
          <li>
            Cash-on-delivery orders are refunded to your bank account
            or UPI ID collected during the refund process.
          </li>
          <li>
            Refunds typically reflect within{" "}
            <strong>
              {/* CONFIG PLACEHOLDER: confirm the refund timeline. */}
              [5–7 working days — to be configured]
            </strong>{" "}
            after approval, depending on your bank.
          </li>
        </ul>
      </Section>

      <Section title="Cancellations">
        <p>
          Orders can be cancelled while their status is still
          “Pending” from the Orders section of your account. Once an
          order is packed or shipped, it moves to the return process
          instead.
        </p>
      </Section>
    </>
  );
}

function InfoPages({ kind, onBack, content }) {
  return (
    <div
      className="jb-page"
      style={{
        maxWidth: "860px",
        margin: "0 auto",
        padding: "22px 16px 60px",
        minHeight: "100vh",
      }}
    >
      <div className="jb-family-chakra" aria-hidden="true" />

      <button
        onClick={onBack}
        style={{
          padding: "9px 18px",
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: "8px",
          cursor: "pointer",
          marginBottom: "18px",
          fontWeight: 600,
        }}
      >
        ← Back
      </button>

      {kind === "contact" && <ContactPage content={content} />}
      {kind === "about" && <AboutPage content={content} />}
      {kind === "returns" && <ReturnsPage />}
    </div>
  );
}

export default InfoPages;
