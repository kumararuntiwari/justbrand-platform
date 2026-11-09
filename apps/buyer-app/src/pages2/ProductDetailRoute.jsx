import { useState, useEffect } from "react";
import { API_URL } from "../api";
import ProductDetails from "./ProductDetails";

// =====================================================
// PRODUCT DETAIL PAGE — URL ROUTE (/product/:id)
// =====================================================
// Wraps the existing ProductDetails view with a real URL so a PDP
// can be opened directly, bookmarked and refreshed. Data comes from
// the public GET /api/products/:id endpoint (Approved products only);
// anything missing/unapproved renders a useful not-found state.
// All shopping handlers (cart / wishlist / buy-now / chat) are the
// SAME App-level functions the state-based PDP uses — no second cart,
// no second checkout.

const FALLBACK_IMAGE = "/images/product1.png";

// Inner loader keyed by product+reload so its state always STARTS at
// "loading" (no synchronous setState inside an effect). The outer
// component only handles the Retry remount.
function ProductDetailLoader({
  productId,
  products,
  addToCart,
  addToWishlist,
  isWishlisted,
  onBuyNow,
  onChat,
  onHome,
  onRetry,
}) {
  const [product, setProduct] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | missing | error

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/products/${productId}`,
          { headers: { "Content-Type": "application/json" } }
        );

        if (response.status === 404) {
          if (!cancelled) setStatus("missing");
          return;
        }

        if (!response.ok) {
          throw new Error(`Request failed (${response.status})`);
        }

        const data = await response.json().catch(() => null);

        if (!data || !data.id) {
          if (!cancelled) setStatus("missing");
          return;
        }

        if (!cancelled) {
          setProduct(data);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productId]);

  // CLIENT-SIDE FALLBACK — when the by-id endpoint cannot return the
  // product (the production backend may not expose GET /api/products/:id,
  // or the product only exists in the catalog the homepage already
  // rendered), reuse that already-loaded item instead of dead-ending on
  // a not-found card. Nothing is invented: only products the client
  // genuinely received are eligible, and a real API 200 always wins.
  const clientProduct =
    status === "ready"
      ? null
      : (products || []).find(
          (item) => String(item.id) === String(productId)
        ) || null;

  // LOADING — simple skeleton, no layout shift into the not-found card.
  if (status === "loading") {
    return (
      <div
        className="jb-page"
        style={{
          minHeight: "60vh",
          maxWidth: "1000px",
          margin: "auto",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "#f2f2f2",
            borderRadius: "12px",
            height: "320px",
            width: "100%",
          }}
          aria-hidden="true"
        />
        <p style={{ color: "#777", marginTop: "16px" }} role="status">
          Loading product…
        </p>
      </div>
    );
  }

  // NOT FOUND / UNAVAILABLE — useful state for invalid ids and
  // products that are no longer approved/available. Skipped when the
  // client catalog still has a matching item to show.
  if (status === "missing" && !clientProduct) {
    return (
      <div
        className="jb-page"
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 2px 10px #ddd",
            padding: "34px 26px",
            maxWidth: "460px",
            width: "100%",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div style={{ fontSize: "44px", marginBottom: "10px" }} aria-hidden="true">
            🔍
          </div>
          <h1 style={{ fontSize: "22px", margin: "0 0 8px", color: "#222" }}>
            Product not found
          </h1>
          <p style={{ color: "666", lineHeight: "1.6", margin: "0 0 20px" }}>
            This product may have been removed, is no longer available, or the
            link is incorrect.
          </p>
          <button
            type="button"
            onClick={onHome}
            style={{
              background: "#ff6b00",
              color: "#fff",
              border: "none",
              padding: "13px 26px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "15px",
              fontWeight: "bold",
            }}
          >
            ← Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  // NETWORK/SERVER ERROR — retryable, still offers a way home.
  // Skipped when the client catalog still has a matching item to show.
  if (status === "error" && !clientProduct) {
    return (
      <div
        className="jb-page"
        style={{
          minHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "20px",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "14px",
            boxShadow: "0 2px 10px #ddd",
            padding: "34px 26px",
            maxWidth: "460px",
            width: "100%",
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontSize: "20px", margin: "0 0 8px", color: "#222" }}>
            Could not load this product
          </h1>
          <p style={{ color: "#666", lineHeight: "1.6", margin: "0 0 20px" }}>
            Please check your connection and try again.
          </p>
          <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onRetry}
              style={{
                background: "#ff6b00",
                color: "#fff",
                border: "none",
                padding: "12px 22px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: "bold",
              }}
            >
              ↻ Retry
            </button>
            <button
              type="button"
              onClick={onHome}
              style={{
                background: "#fff",
                color: "#ff6b00",
                border: "2px solid #ff6b00",
                padding: "12px 22px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: "bold",
              }}
            >
              ← Continue Shopping
            </button>
          </div>
        </div>
      </div>
    );
  }

  // READY — the existing PDP, unchanged component, new URL shell.
  // `product` is the API result; `clientProduct` is the homepage-catalog
  // fallback used when the by-id endpoint could not answer.
  const resolvedProduct = product || clientProduct;

  return (
    <ProductDetails
      product={resolvedProduct}
      addToCart={addToCart}
      addToWishlist={addToWishlist}
      isWishlisted={Boolean(
        isWishlisted && isWishlisted(resolvedProduct)
      )}
      fallbackImage={FALLBACK_IMAGE}
      onBack={onHome}
      onBuyNow={onBuyNow}
      onChat={onChat}
    />
  );
}

function ProductDetailRoute({
  productId,
  products,
  addToCart,
  addToWishlist,
  isWishlisted,
  onBuyNow,
  onChat,
  onHome,
}) {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <ProductDetailLoader
      key={`${productId}-${reloadKey}`}
      productId={productId}
      products={products}
      addToCart={addToCart}
      addToWishlist={addToWishlist}
      isWishlisted={isWishlisted}
      onBuyNow={onBuyNow}
      onChat={onChat}
      onHome={onHome}
      onRetry={() => setReloadKey((k) => k + 1)}
    />
  );
}

export default ProductDetailRoute;
