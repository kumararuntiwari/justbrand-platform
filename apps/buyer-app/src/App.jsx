import { useLocation, useNavigate } from "react-router-dom";
import ProductCard from "./components/ProductCard";
import ComparePriceSlider from "./components/ComparePriceSlider";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { useState, useEffect } from 'react';
import ProductDetails from "./pages2/ProductDetails";
import ProductDetailRoute from "./pages2/ProductDetailRoute";
import ProductChat from "./pages2/ProductChat";
import Cart from "./pages2/Cart";
import InfoPages from "./pages2/InfoPages.jsx";
import {
  infoPageMeta,
} from "./pages2/InfoPages.jsx";
import ComparePrice from "./pages2/ComparePrice";
import CustomerAuth from "./pages2/CustomerAuth";
import CustomerAccount from "./pages2/CustomerAccount";
import CustomerOrders from "./pages2/CustomerOrders";
import Checkout from "./pages2/Checkout";
import Wishlist from "./pages2/Wishlist";
import {
  API_BASE,
  getCustomerToken,
  setCustomerToken,
  setMlmToken,
} from "./api";

// ==========================================
// MLM PAGES
// ==========================================

import MLMCommission from "./Pages/MLMCommission";
import MLMCommissionRules from "./Pages/MLMCommissionRules";
import MLMDashboard from "./Pages/MLMDashboard";
import MLMLogin from "./Pages/MLMLogin";
import MLMRegister from "./Pages/MLMRegister";
import MLMTree from "./Pages/MLMTree";
import MLMWallet from "./Pages/MLMWallet";

// ==========================================
// BACKEND
// ==========================================

// API base is runtime-injectable (see src/api.js): the Freebuff
// preview injects window.__JB_API_BASE__ = "" (same-origin, isolated
// local backend); a production build keeps the live backend URL.
const BACKEND_URL = `${API_BASE}/api/products`;

// Phase 1: admin-managed category list. On any failure the Buyer
// keeps showing the built-in fallback category chips below.
const CATEGORIES_URL = `${API_BASE}/api/categories`;

const FALLBACK_CATEGORY_CHIPS = [
  "All",
  "Electronics",
  "Fashion",
  "Beauty",
  "Home",
  "Grocery",
  "Sports & Fitness",
  "Baby & Kids",
  "Jewellery & Accessories",
  "Books & Stationery",
  "Automotive",
  "Pet Supplies",
];

const HOME_CATEGORY_CARDS = [
  { label: "Mobiles & Accessories", value: "Electronics", icon: "📱", subcategories: "Smartphones • Covers • Earbuds" },
  { label: "Fashion & Clothing", value: "Fashion", icon: "👗", subcategories: "Men • Women • Kids • Footwear" },
  { label: "Electronics", value: "Electronics", icon: "💻", subcategories: "Laptops • Audio • Smart Watches" },
  { label: "Beauty & Personal Care", value: "Beauty", icon: "💄", subcategories: "Makeup • Skin • Hair Care" },
  { label: "Home & Kitchen", value: "Home", icon: "🏠", subcategories: "Cookware • Decor • Storage" },
  { label: "Grocery & Food", value: "Grocery", icon: "🛒", subcategories: "Staples • Snacks • Beverages" },
  { label: "Sports & Fitness", value: "Sports & Fitness", icon: "🏸", subcategories: "Gym • Yoga • Outdoor" },
  { label: "Baby & Kids", value: "Baby & Kids", icon: "🧸", subcategories: "Toys • Baby Care • Clothing" },
  { label: "Jewellery & Accessories", value: "Jewellery & Accessories", icon: "💍", subcategories: "Jewellery • Watches • Bags" },
  { label: "Books & Stationery", value: "Books & Stationery", icon: "📚", subcategories: "Books • Office • Art" },
  { label: "Automotive", value: "Automotive", icon: "🚗", subcategories: "Car • Bike • Vehicle Care" },
  { label: "Pet Supplies", value: "Pet Supplies", icon: "🐾", subcategories: "Pet Food • Toys • Care" },
];

// Admin-managed site content (logo, banners, About/Contact copy).
// Same API origin as the products API (see API_BASE in src/api.js).
const SITE_CONTENT_URL = `${API_BASE}/api/site/content`;

// ==========================================
// HOME HERO (admin-managed)
// Admin-configured banners/promo from the site content feed.
// Fallback safety: with nothing configured the original built-in
// JustBrand gradient is shown exactly as before.
// ==========================================

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");

    const onChange = (e) => setIsMobile(e.matches);

    mq.addEventListener("change", onChange);

    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

function HomeHero({ banners, promo, onCta, fitMode }) {
  const isMobile = useIsMobileViewport();
  const [slide, setSlide] = useState(0);

  // More prominent hero strip (was 230/250) while staying
  // responsive: the same value drives the image slider and the
  // promo-gradient fallback below, so the two states never jump in
  // height. The title/subtitle/CTA overlay is pinned to the bottom
  // edge and wraps, so it is never cropped at any viewport.
  const bannerHeight = isMobile ? 190 : 300;
  const bannerMargin = "18px auto 16px";

  // Buyer banners must remain fully visible inside the banner box.
  // Never crop the seller/admin-uploaded artwork on the storefront.
  const bannerFit = "contain";

  const slides = (banners || []).filter((b) => {
    if (!b || !b.active) return false;

    const img = isMobile ? b.mobileImageUrl || b.imageUrl : b.imageUrl;

    return Boolean(img);
  });

  useEffect(() => {
    if (slides.length <= 1) return undefined;

    const timer = setInterval(
      () => setSlide((p) => (p + 1) % slides.length),
      5000
    );

    return () => clearInterval(timer);
  }, [slides.length]);

  const promoVisible =
    promo &&
    promo.sectionVisible !== false &&
    String(promo.promoHeading || "").trim().length > 0;

  // Admin banner slider — wins over the promo gradient.
  if (slides.length > 0) {
    const banner = slides[slide % slides.length];
    const img = isMobile
      ? banner.mobileImageUrl || banner.imageUrl
      : banner.imageUrl;

    return (
      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          margin: bannerMargin,
          padding: "0 10px",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: bannerHeight,
            borderRadius: "15px",
            overflow: "hidden",
            background: "#f2f2f2",
          }}
        >
          <img
            src={img}
            alt={banner.title || "JustBrand banner"}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: bannerFit,
              display: "block",
            }}
            onError={(e) => {
              // Broken banner image never breaks the homepage —
              // hide it and the gradient fallback shows instead.
              e.currentTarget.style.display = "none";
            }}
          />

          {(banner.subtitle || banner.ctaText) && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: 0,
                padding: "14px 16px",
                background:
                  "linear-gradient(180deg, rgba(0,31,84,0) 0%, rgba(0,31,84,0.68) 100%)",
                color: "#fff",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: "10px",
                flexWrap: "wrap",
              }}
            >
              <div>
                {banner.subtitle ? (
                  <span style={{ fontSize: "13px", opacity: 0.95 }}>
                    {banner.subtitle}
                  </span>
                ) : null}
              </div>

              {banner.ctaText ? (
                <button
                  type="button"
                  onClick={() => onCta(banner.ctaLink)}
                  style={{
                    background: "linear-gradient(90deg,#ff6b00,#ff1493)",
                    color: "#fff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: "20px",
                    fontWeight: 700,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  {banner.ctaText}
                </button>
              ) : null}
            </div>
          )}

          {slides.length > 1 && (
            <div
              style={{
                position: "absolute",
                bottom: "6px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "5px",
              }}
            >
              {slides.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: i === slide % slides.length ? "16px" : "6px",
                    height: "6px",
                    borderRadius: "3px",
                    background:
                      i === slide % slides.length
                        ? "#ff6b00"
                        : "rgba(255,255,255,0.75)",
                    transition: "width 0.2s",
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Promo gradient fallback — admin copy when saved, otherwise the
  // original built-in JustBrand hero (unchanged default behaviour).
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1200px",
        height: bannerHeight,
        margin: bannerMargin,
        padding: "0 10px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg,#ff6b00,#ff1493)",
          borderRadius: "15px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: "25px",
          fontWeight: "bold",
          textAlign: "center",
          padding: "20px",
          boxSizing: "border-box",
          gap: "6px",
        }}
      >
        <span>
          {promoVisible
            ? promo.promoHeading
            : "Shop & Earn with JustBrand"}
        </span>
        {promoVisible && promo.promoSubtitle ? (
          <span style={{ fontSize: "14px", fontWeight: 400, opacity: 0.95 }}>
            {promo.promoSubtitle}
          </span>
        ) : null}
        {promoVisible && promo.ctaText ? (
          <button
            type="button"
            onClick={() => onCta(promo.ctaLink)}
            style={{
              background: "#fff",
              color: "#ff1493",
              border: "none",
              padding: "8px 18px",
              borderRadius: "20px",
              fontWeight: 700,
              cursor: "pointer",
              marginTop: "4px",
              fontSize: "14px",
            }}
          >
            {promo.ctaText} →
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ==========================================
// APP
// ==========================================

function App() {
  // ==========================================
  // CART
  // ==========================================

  const [cart, setCart] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_cart");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // ==========================================
  // WISHLIST
  // ==========================================

  const [wishlist, setWishlist] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_wishlist");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // ==========================================
  // PRODUCTS
  // ==========================================

  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  // True only when the backend ANSWERED with a real, empty catalog.
  // The homepage then shows an honest "no products yet" state instead
  // of the offline fallback items, so an empty shop is never masked by
  // products that cannot actually be ordered.
  const [catalogEmpty, setCatalogEmpty] = useState(false);
  // True when a real (non-preview) build could not reach the backend
  // at all — the homepage then shows an honest error state instead
  // of inventing offline demo products.
  const [backendDown, setBackendDown] = useState(false);

  // ==========================================
  // SITE CONTENT (admin-managed)
  // Logo, homepage banners, About/Contact copy.
  // null = not loaded yet → Buyer keeps its built-in
  // defaults everywhere (fallback safety, never blank).
  // ==========================================

  const [siteContent, setSiteContent] = useState(null);

  // Admin-managed categories (Phase 1). Empty = API not loaded/failed →
  // the hardcoded fallback chips keep rendering exactly as before.
  const [shopCategories, setShopCategories] = useState([]);

  // Fallback safety: any API failure keeps the built-in chips.
  const categoryChips =
    shopCategories.length > 0
      ? ["All", ...shopCategories.map((c) => c.name)]
      : FALLBACK_CATEGORY_CHIPS;

  // Admin-configured banners/promo — used by HomeHero on the homepage.
  const adminBanners = (siteContent?.banners || []).filter((b) => b.active);
  const homepagePromo = siteContent?.homepage || null;

  // ==========================================
  // SHOPPING PAGES
  // ==========================================

  const [selectedProduct, setSelectedProduct] = useState(null);

  // URL-Routed Product Detail Page (/product/:id). The URL is the
  // source of truth so a PDP can be opened directly, bookmarked and
  // refreshed; product cards navigate here. BrowserRouter already
  // wraps App in main.jsx.
  const location = useLocation();
  const navigate = useNavigate();
  const productRouteMatch = location.pathname.match(/^\/product\/(\d+)$/);
  const routeProductId = productRouteMatch ? productRouteMatch[1] : null;
  const [showCart, setShowCart] = useState(false);

  // Cart -> Checkout can hit the customer login gate. Remember that
  // intent so a successful login resumes checkout instead of dropping
  // the buyer on the account page (previously checkout was lost).
  const [checkoutIntent, setCheckoutIntent] = useState(false);

  // ==========================================
  // COMPARE
  // ==========================================

  const [compareProducts, setCompareProducts] = useState([]);
  const [compareSelectedProduct, setCompareSelectedProduct] =
    useState(null);
  const [showCompare, setShowCompare] = useState(false);

  // ==========================================
  // SEARCH
  // ==========================================

  const [search, setSearch] = useState("");

  // ==========================================
  // CATEGORY
  // ==========================================

  const [category, setCategory] = useState("All");

  // ==========================================
  // MLM PAGE
  // ==========================================

  const [mlmPage, setMlmPage] = useState(null);

  // ==========================================
  // MLM MEMBER
  // ==========================================

  const [mlmMember, setMlmMember] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_mlm_member");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // ==========================================
  // CUSTOMER (BUYER ACCOUNT)
  // ==========================================

  const [customer, setCustomer] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_customer");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const customerToken = getCustomerToken();

  // ==========================================
  // BUYER PAGES (account / orders / wishlist /
  // auth / checkout) — null = normal shopping
  // ==========================================

  const [buyerPage, setBuyerPage] = useState(null);

  // Checkout items snapshot — exactly the cart items the user
  // selected in Cart and chose to check out with. State (not a
  // plain variable) so it survives the page switch re-render;
  // reset after checkout ends or the order completes.
  const [checkoutItems, setCheckoutItems] = useState([]);
  // ==============================
  // CART SELECTION (for checkout)
  // ==============================
  const [cartSelected, setCartSelected] = useState(null); // null = all selected

  function toggleCartSelect(id) {
    setCartSelected((prev) => {
      const base =
        prev ||
        new Set(cart.map((item) => String(item.id)));
      const next = new Set(base);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCartSelectAll() {
    setCartSelected((prev) => {
      const all = new Set(
        cart.map((item) => String(item.id))
      );
      const isAll =
        prev &&
        prev.size === all.size &&
        cart.every((item) =>
          prev.has(String(item.id))
        );
      // If everything is selected -> deselect all; otherwise select all.
      return isAll ? new Set() : all;
      void prev;
    });
  }

  function clearCart() {
    setCart([]);
    setCartSelected(null);
    localStorage.removeItem("justbrand_cart");
  }


  // Product chosen via "Buy Now" — a single-item cart used for the
  // express checkout flow (does not disturb the normal cart).
  // Persisted so Buy Now → login → checkout survives a page reload.
  const [buyNowItem, setBuyNowItem] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_buynow");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (buyNowItem) {
        localStorage.setItem("justbrand_buynow", JSON.stringify(buyNowItem));
      } else {
        localStorage.removeItem("justbrand_buynow");
      }
    } catch {
      /* storage unavailable */
    }
  }, [buyNowItem]);

  function handleCustomerAuth(authCustomer) {
    setCustomer(authCustomer);

    localStorage.setItem(
      "justbrand_customer",
      JSON.stringify(authCustomer)
    );

    // If the customer logged in from a Buy Now flow or from the cart's
    // checkout button, resume checkout; otherwise go to the account page.
    setBuyerPage(buyNowItem || checkoutIntent ? "checkout" : "account");
    setCheckoutIntent(false);
  }

  function handleCustomerLogout() {
    setCustomer(null);
    setCustomerToken("");

    localStorage.removeItem("justbrand_customer");

    setBuyerPage(null);
  }

  // ==========================================
  // LOAD PRODUCTS
  // ==========================================

  useEffect(() => {
    loadProducts();
  }, []);

  // ==========================================
  // LOAD SITE CONTENT (admin-managed)
  // Failure-tolerant: any network/API error simply leaves
  // siteContent null and the app shows built-in defaults.
  // ==========================================

  useEffect(() => {
    let cancelled = false;

    async function loadSiteContent() {
      try {
        const response = await fetch(SITE_CONTENT_URL);

        if (!response.ok) return;

        const data = await response.json().catch(() => null);

        if (!cancelled && data?.success && data.content) {
          setSiteContent(data.content);
        }
      } catch {
        // Keep defaults — never break the Buyer app on content errors.
      }
    }

    loadSiteContent();

    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================
  // LOAD CATEGORIES (admin-managed, Phase 1)
  // Failure-tolerant: on error the list stays empty and the
  // built-in fallback categories are shown — never a blank bar.
  // ==========================================

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch(CATEGORIES_URL);

        if (!response.ok) return;

        const data = await response.json().catch(() => null);

        if (!cancelled && data?.success && Array.isArray(data.categories)) {
          setShopCategories(data.categories);
        }
      } catch {
        // Keep fallback categories — never break the Buyer app.
      }
    }

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  // ==========================================
  // CUSTOM FAVICON (admin-managed, Phase 1)
  // Applied at runtime — index.html is never modified. When no
  // custom favicon is configured the built-in /favicon.svg stays.
  // ==========================================

  useEffect(() => {
    const url = siteContent?.branding?.faviconUrl;

    if (!url) return;
    if (!/^data:image\//i.test(url) && !/^https:\/\//i.test(url)) return;

    let link = document.querySelector("link[rel~='icon']");

    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }

    link.href = url;
  }, [siteContent]);

  async function loadProducts() {
    setLoading(true);
    setBackendDown(false);

    // Preview builds (window.__JB_PREVIEW__ injected by the preview
    // server) may fall back to offline demo data. A real published
    // build must NEVER invent products — it shows the backendDown
    // error state instead (see below).
    const isPreview =
      typeof window !== "undefined" &&
      window.__JB_PREVIEW__ === true;

    let loadedProducts = [];
    // Set when the backend returned a recognised catalog response,
    // even an empty one. An ANSWERED catalog is authoritative: the
    // localStorage / demo fallbacks below must not mask it, or real
    // customers would see phantom products that fail at checkout.
    let backendAnswered = false;

    // ========================================
    // BACKEND PRODUCTS
    // ========================================

    try {
      const response = await fetch(BACKEND_URL);

      if (response.ok) {
        const data = await response.json();

        console.log("Backend products:", data);

        if (Array.isArray(data)) {
          loadedProducts = data;
          backendAnswered = true;
        } else if (
          data &&
          Array.isArray(data.products)
        ) {
          loadedProducts = data.products;
          backendAnswered = true;
        }
      } else {
        console.log(
          "Backend response error:",
          response.status
        );
      }
    } catch (error) {
      console.log(
        "Backend unavailable:",
        error
      );
    }

    // ========================================
    // LOCAL STORAGE FALLBACK (preview/offline only — never
    // overrides an answered backend catalog)
    // ========================================

    if (
      !backendAnswered &&
      loadedProducts.length === 0 &&
      isPreview
    ) {
      try {
        const savedProducts =
          localStorage.getItem(
            "justbrand_products"
          );

        if (savedProducts) {
          const localProducts =
            JSON.parse(savedProducts);

          if (Array.isArray(localProducts)) {
            loadedProducts = localProducts;
          }
        }
      } catch (error) {
        console.log(
          "Local products error:",
          error
        );
      }
    }

    // ========================================
    // DEMO PRODUCTS (PREVIEW ONLY — an answered backend, including
    // a valid empty catalog, always wins; a published build never
    // invents products and shows the backendDown error state)
    // ========================================

    if (
      !backendAnswered &&
      loadedProducts.length === 0 &&
      !isPreview
    ) {
      // Published build + unreachable backend: honest error state.
      setBackendDown(true);
    }

    if (
      !backendAnswered &&
      loadedProducts.length === 0 &&
      isPreview
    ) {
      loadedProducts = [
        {
          id: 1,
          name: "Wireless Earbuds",
          price: "₹999",
          category: "Electronics",
          image: "/images/product1.png",
          shortDetails:
            "Premium wireless earbuds",
        },
        {
          id: 2,
          name: "Smart Watch",
          price: "₹1499",
          category: "Electronics",
          image: "/images/product2.jpeg",
          shortDetails:
            "Smart fitness watch",
        },
        {
          id: 3,
          name: "Men Fashion Shirt",
          price: "₹799",
          category: "Fashion",
          image: "/images/product3.jpeg",
          shortDetails:
            "Premium cotton shirt",
        },
        {
          id: 4,
          name: "Beauty Product",
          price: "₹599",
          category: "Beauty",
          image: "/images/product4.jpg",
          shortDetails:
            "Premium beauty product",
        },
      ];
    }

    // ========================================
    // NORMALIZE PRODUCTS
    // ========================================

    const normalizedProducts =
      loadedProducts.map(
        (product, index) => {
          let image =
            product.image ||
            product.imageUrl ||
            product.photo ||
            product.thumbnail ||
            "";

          // ======================================
          // IMAGE NORMALIZATION
          // ======================================

          if (
            image &&
            String(image).startsWith("data:image/")
          ) {
            // Base64 image - keep unchanged
          } else if (
            image &&
            /^https?:\/\//i.test(String(image))
          ) {
            // Absolute image URL - keep unchanged
          } else {
            image = String(image);

            // Windows path
            if (image.includes("\\")) {
              image = image.split("\\").pop();
            }

            // Remove public/images path
            image = image.replace(
              /^.*[\/\\]public[\/\\]images[\/\\]/i,
              ""
            );

            // Remove /images/ or images/
            image = image.replace(
              /^\/?images[\/\\]/i,
              ""
            );

            if (image) {
              image = "/images/" + image;
            }
          }

          // ======================================
          // FALLBACK IMAGE
          // ======================================

          if (!image) {
            const fallbackImages = [
              "/images/product1.png",
              "/images/product2.jpeg",
              "/images/product3.jpeg",
              "/images/product4.jpg",
            ];

            image =
              fallbackImages[
                index % fallbackImages.length
              ];
          }

          // ======================================
          // FINAL PRODUCT
          // ======================================

          return {
            ...product,

            id:
              product.id !== undefined &&
              product.id !== null
                ? product.id
                : Date.now() + index,

            name:
              product.name ||
              product.productName ||
              "Product",

            price:
              product.price ||
              "₹0",

            category:
              product.category ||
              "Other",

            shortDetails:
              product.shortDetails ||
              product.description ||
              "",

            image,
          };
        }
      );

    console.log(
      "FINAL PRODUCTS:",
      normalizedProducts
    );

    setCatalogEmpty(
      backendAnswered && normalizedProducts.length === 0
    );
    setProducts(normalizedProducts);
    setLoading(false);
  }

  // ==========================================
  // ADD TO CART
  // ==========================================

  function addToCart(product, quantity = 1) {
    // LIMITED STOCK TRACKING: never add an out-of-stock product —
    // the server re-checks atomically at quote/order time regardless.
    if (product && product.inStock === false) {
      alert("Ye product abhi out of stock hai.");
      return;
    }

    const qty = Math.max(1, Number(quantity) || 1);

    setCart((prevCart) => {
      const existingProduct =
        prevCart.find(
          (item) =>
            item.id === product.id
        );

      let updatedCart;

      if (existingProduct) {
        updatedCart =
          prevCart.map((item) => {
            if (
              item.id === product.id
            ) {
              return {
                ...item,
                quantity:
                  (item.quantity || 1) + qty,
              };
            }

            return item;
          });
      } else {
        updatedCart = [
          ...prevCart,
          {
            ...product,
            quantity: qty,
          },
        ];
      }

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });

    alert("Product added to cart!");
  }

  // ==========================================
  // REMOVE FROM CART
  // ==========================================

  function removeFromCart(id) {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.filter(
          (item) =>
            item.id !== id
        );

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });
  }

  // ==========================================
  // UPDATE QUANTITY
  // ==========================================

  function updateQuantity(id, quantity) {
    setCart((prevCart) => {
      const updatedCart =
        prevCart.map((item) => {
          if (
            item.id === id
          ) {
            return {
              ...item,
              quantity:
                Math.max(
                  1,
                  Number(quantity) || 1
                ),
            };
          }

          return item;
        });

      localStorage.setItem(
        "justbrand_cart",
        JSON.stringify(updatedCart)
      );

      return updatedCart;
    });
  }

  // ==========================================
  // WISHLIST
  // ==========================================

  function addToWishlist(product) {
    setWishlist((prevWishlist) => {
      const exists =
        prevWishlist.some(
          (item) =>
            item.id === product.id
        );

      if (exists) {
        alert("Already in wishlist!");
        return prevWishlist;
      }

      const updatedWishlist = [
        ...prevWishlist,
        product,
      ];

      localStorage.setItem(
        "justbrand_wishlist",
        JSON.stringify(updatedWishlist)
      );

      alert("Added to wishlist!");

      return updatedWishlist;
    });
  }

  function removeFromWishlist(product) {
    setWishlist((prevWishlist) => {
      const updatedWishlist = prevWishlist.filter(
        (item) => String(item.id) !== String(product.id)
      );

      localStorage.setItem(
        "justbrand_wishlist",
        JSON.stringify(updatedWishlist)
      );

      return updatedWishlist;
    });
  }

  // ==========================================
  // COMPARE
  // ==========================================

  function onCompare(product) {
    // IMPORTANT:
    // Remember exactly which product
    // user clicked for comparison.
    setCompareSelectedProduct(product);

    setCompareProducts((prevProducts) => {
      const exists =
        prevProducts.some(
          (item) =>
            String(item.id) ===
            String(product.id)
        );

      if (exists) {
        return prevProducts;
      }

      if (
        prevProducts.length >= 4
      ) {
        alert(
          "You can compare maximum 4 products."
        );

        return prevProducts;
      }

      return [
        ...prevProducts,
        product,
      ];
    });

    setShowCompare(true);
  }

  // ==========================================
  // COMPARE SINGLE PRODUCT
  // ==========================================

  function compareSingleProduct(product) {
    onCompare(product);
  }

  // ==========================================
  // REMOVE COMPARE
  // ==========================================

  function removeCompare(id) {
    setCompareProducts(
      (prevProducts) =>
        prevProducts.filter(
          (item) =>
            String(item.id) !==
            String(id)
        )
    );

    // If removed product was selected,
    // select another available product.
    setCompareSelectedProduct(
      (prevSelected) => {
        if (
          prevSelected &&
          String(prevSelected.id) ===
            String(id)
        ) {
          const remaining =
            compareProducts.filter(
              (item) =>
                String(item.id) !==
                String(id)
            );

          return remaining.length > 0
            ? remaining[0]
            : null;
        }

        return prevSelected;
      }
    );
  }

  // ==========================================
  // FILTER PRODUCTS
  // ==========================================

  const filteredProducts =
    products.filter((product) => {
      const productName =
        String(
          product.name || ""
        ).toLowerCase();

      const productDetails =
        String(
          product.shortDetails ||
          product.description ||
          ""
        ).toLowerCase();

      const productCategory =
        String(
          product.category || ""
        );

      const searchText =
        search
          .toLowerCase()
          .trim();

      const matchesSearch =
        productName.includes(
          searchText
        ) ||
        productDetails.includes(
          searchText
        );

      const matchesCategory =
        category === "All" ||
        productCategory === category;

      return (
        matchesSearch &&
        matchesCategory
      );
    });

  // ==========================================
  // SEARCH CATEGORIES
  // ==========================================

  const filteredCategories = [
    ...new Set(
      products
        .map(
          (product) =>
            product.category
        )
        .filter(Boolean)
    ),
  ].filter((cat) =>
    String(cat)
      .toLowerCase()
      .includes(
        search.toLowerCase()
      )
  );

  // ==========================================
  // CART COUNT
  // ==========================================

  const cartCount =
    cart.reduce(
      (total, item) =>
        total +
        (Number(item.quantity) || 1),
      0
    );

  // ==========================================
  // COMMON HEADER PROPS
  // ==========================================

  const commonHeaderProps = {
    cartCount,
    search,
    setSearch,
    onCategorySelect: (selectedCategory) => {
      setCategory(selectedCategory);
      setSearch("");
    },
    filteredProducts,
    filteredCategories,
    onProductSelect: (product) =>
      navigate(
        `/product/${product.id}`
      ),
    onAccount: () =>
      setBuyerPage(
        customer && customerToken
          ? "account"
          : "auth"
      ),
    onWishlist: () =>
      setBuyerPage("wishlist"),
    // Header Compare entry — opens the existing Compare page with
    // whatever the buyer has selected so far (works from any view).
    onCompare: () => setShowCompare(true),
    compareCount: compareProducts.length,
    onOrders: () =>
      setBuyerPage(
        customer && customerToken
          ? "orders"
          : "auth"
      ),
    onFamily: () =>
      setMlmPage(
        mlmMember ? "dashboard" : "login"
      ),
    logoUrl: siteContent?.branding?.logoUrl || "",
    logoAlt: siteContent?.branding?.logoAlt || "JustBrand",
    headerSettings: siteContent?.header || null,
  };

  // ==========================================
  // MLM LOGIN
  // ==========================================

  if (mlmPage === "login") {
    return (
      <MLMLogin
        onLogin={(member) => {
          setMlmMember(member);

          localStorage.setItem(
            "justbrand_mlm_member",
            JSON.stringify(member)
          );

          setMlmPage("dashboard");
        }}
        onRegister={() =>
          setMlmPage("register")
        }
        onBack={() =>
          setMlmPage(null)
        }
      />
    );
  }

  // ==========================================
  // MLM REGISTER
  // ==========================================

  if (mlmPage === "register") {
    return (
      <MLMRegister
        onRegistered={(member) => {
          setMlmMember(member);

          localStorage.setItem(
            "justbrand_mlm_member",
            JSON.stringify(member)
          );

          setMlmPage("dashboard");
        }}
        onBack={() =>
          setMlmPage(null)
        }
      />
    );
  }

  // ==========================================
  // MLM DASHBOARD
  // ==========================================

  if (mlmPage === "dashboard") {
    return (
      <MLMDashboard
        member={mlmMember}
        onBack={() =>
          setMlmPage(null)
        }
        onCommission={() =>
          setMlmPage("commission")
        }
        onRules={() =>
          setMlmPage("rules")
        }
        onTree={() =>
          setMlmPage("tree")
        }
        onWallet={() =>
          setMlmPage("wallet")
        }
        onLogout={() => {
          localStorage.removeItem(
            "justbrand_mlm_member"
          );

          setMlmToken("");

          setMlmMember(null);
          setMlmPage("login");
        }}
      />
    );
  }

  // ==========================================
  // MLM COMMISSION
  // ==========================================

  if (mlmPage === "commission") {
    return (
      <MLMCommission
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM RULES
  // ==========================================

  if (mlmPage === "rules") {
    return (
      <MLMCommissionRules
        rewardInfo={siteContent?.rewardInfo || null}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM TREE
  // ==========================================

  if (mlmPage === "tree") {
    return (
      <MLMTree
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // MLM WALLET
  // ==========================================

  if (mlmPage === "wallet") {
    return (
      <MLMWallet
        member={mlmMember}
        onBack={() =>
          setMlmPage("dashboard")
        }
      />
    );
  }

  // ==========================================
  // PROTECTED PRODUCT CHAT (buyer ↔ seller)
  // Requires a logged-in customer; the backend enforces product
  // scope + participant checks + contact-info redaction.
  // ==========================================

  if (buyerPage === "chat" && selectedProduct) {
    if (!customer || !customerToken) {
      return (
        <CustomerAuth
          onAuth={(authCustomer) => {
            handleCustomerAuth(authCustomer);
            // Resume the chat right after login.
            setBuyerPage("chat");
          }}
          onBack={() => setBuyerPage(null)}
        />
      );
    }

    return (
      <>
        <Header {...commonHeaderProps} onCart={() => setShowCart(true)} />
        <ProductChat
          product={selectedProduct}
          onBack={() => setBuyerPage(null)}
        />
      </>
    );
  }

  // ==========================================
  // PRODUCT DETAILS (legacy state flow)
  // ==========================================

  if (selectedProduct) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() =>
            setShowCart(true)
          }
        />

        <ProductDetails
          product={selectedProduct}
          onChat={() => setBuyerPage("chat")}
          onBack={() =>
            setSelectedProduct(null)
          }
          addToCart={addToCart}
          onBuyNow={(product) => {
            setSelectedProduct(null);
            setBuyNowItem({
              ...product,
              quantity: 1,
            });

            setBuyerPage(
              customer && customerToken
                ? "checkout"
                : "auth"
            );
          }}
        />
      </>
    );
  }

  // ==========================================
  // CUSTOMER AUTH (LOGIN / REGISTER)
  // ==========================================

  if (buyerPage === "auth") {
    return (
      <CustomerAuth
        onAuth={handleCustomerAuth}
        onBack={() => {
          // Backing out of the login gate abandons any checkout intent.
          setCheckoutIntent(false);
          setBuyerPage(null);
        }}
      />
    );
  }

  // ==========================================
  // CUSTOMER ACCOUNT
  // ==========================================

  if (buyerPage === "account") {
    if (!customer) {
      return (
        <CustomerAuth
          onAuth={handleCustomerAuth}
          onBack={() => setBuyerPage(null)}
        />
      );
    }

    return (
      <CustomerAccount
        customer={customer}
        onBack={() => setBuyerPage(null)}
        onOrders={() => setBuyerPage("orders")}
        onWishlist={() => setBuyerPage("wishlist")}
        onLogout={handleCustomerLogout}
        onProfileUpdated={(updatedCustomer) => {
          setCustomer(updatedCustomer);

          localStorage.setItem(
            "justbrand_customer",
            JSON.stringify(updatedCustomer)
          );
        }}
      />
    );
  }

  // ==========================================
  // CUSTOMER ORDERS
  // ==========================================

  if (buyerPage === "orders") {
    if (!customer || !customerToken) {
      return (
        <CustomerAuth
          onAuth={handleCustomerAuth}
          onBack={() => setBuyerPage(null)}
        />
      );
    }

    return (
      <CustomerOrders
        token={customerToken}
        onBack={() => setBuyerPage("account")}
        onNeedLogin={() => setBuyerPage("auth")}
      />
    );
  }

  // ==========================================
  // WISHLIST
  // ==========================================

  if (buyerPage === "wishlist") {
    return (
      <Wishlist
        wishlist={wishlist}
        onBack={() => setBuyerPage(null)}
        onRemove={removeFromWishlist}
        onAddToCart={(item) => {
          addToCart(item);
          removeFromWishlist(item);
        }}
      />
    );
  }

  // ==========================================
  // INFO PAGES (Contact / About / Return & Refund)
  // ==========================================

  if (
    buyerPage === "contact" ||
    buyerPage === "about" ||
    buyerPage === "returns" ||
    buyerPage === "shipping" ||
    buyerPage === "privacy" ||
    buyerPage === "terms"
  ) {
    const meta = infoPageMeta[buyerPage];
    if (meta) {
      document.title = meta.title;
    }
    return (
      <>
        <Header {...commonHeaderProps} onCart={() => setShowCart(true)} />
        <InfoPages
          kind={buyerPage}
          content={
            buyerPage === "about"
              ? siteContent?.about || null
              : siteContent?.contact || null
          }
          policies={siteContent?.policies || null}
          deliveryInfo={siteContent?.deliveryInfo || null}
          familyInfo={siteContent?.familyInfo || null}
          onBack={() => setBuyerPage(null)}
        />
      </>
    );
  }

  // ==========================================
  // CHECKOUT
  // ==========================================

  if (buyerPage === "checkout") {
    if (!customer || !customerToken) {
      return (
        <CustomerAuth
          onAuth={handleCustomerAuth}
          onBack={() => setBuyerPage(null)}
        />
      );
    }

    const itemsForCheckout =
      buyNowItem
        ? [buyNowItem]
        : checkoutItems.length > 0
        ? checkoutItems
        : cart;

    return (
      <Checkout
        cart={itemsForCheckout}
        customer={customer}
        token={customerToken}
        onBack={() => {
          setBuyerPage(null);
          // Returning from checkout without ordering — resume cart mode.
          setCheckoutItems([]);
        }}
        onOrderPlaced={() => {
          // Clear whichever cart the order came from.
          if (buyNowItem) {
            setBuyNowItem(null);
          } else {
            clearCart();
          }
          setCheckoutItems([]);
        }}
      />
    );
  }

  // ==========================================
  // CART
  // ==========================================

  if (showCart) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() => {}}
        />

        <Cart
          cart={cart}
          onBack={() => {
            setShowCart(false);
            setCartSelected(null);
          }}
          removeFromCart={removeFromCart}
          updateQuantity={updateQuantity}
          onSelectProduct={(item) => {
            const product =
              filteredProducts.find((p) => p.id === item.id) ||
              item;
            setShowCart(false);
            setCartSelected(null);
            setSelectedProduct(product);
          }}
          selectedIds={cartSelected}
          onToggleSelect={toggleCartSelect}
          onToggleSelectAll={toggleCartSelectAll}
          onClearCart={clearCart}
          onCheckout={() => {
            // LIMITED STOCK TRACKING: a cart item that went out of
            // stock after it was added can never reach checkout —
            // the server would reject the order anyway; stop it here
            // with a clear message instead.
            const outOfStockItems = cart.filter(
              (item) => item.inStock === false
            );

            if (outOfStockItems.length > 0) {
              alert(
                `Out of stock: ${outOfStockItems
                  .map((item) => item.name || item.id)
                  .join(", ")}. Please remove it to continue.`
              );
              return;
            }

            // Hand Checkout exactly the selected items only —
            // unselected products never reach checkout.
            const sel =
              cartSelected ||
              new Set(cart.map((i) => String(i.id)));
            setCheckoutItems(
              cart.filter((item) => sel.has(String(item.id)))
            );

            setShowCart(false);

            // Normal cart checkout — clear any leftover Buy Now item so
            // the checkout always shows exactly the cart contents.
            setBuyNowItem(null);

            // Not logged in? The login gate opens next — keep the
            // checkout intent so login resumes here (see handleCustomerAuth).
            setCheckoutIntent(!(customer && customerToken));

            setBuyerPage(
              customer && customerToken
                ? "checkout"
                : "auth"
            );
          }}
        />
      </>
    );
  }

  // ==========================================
  // COMPARE
  // ==========================================

  if (showCompare) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() =>
            setShowCart(true)
          }
        />

        <ComparePrice
          products={compareProducts}
          selectedProduct={
            compareSelectedProduct
          }
          onBack={() => {
            setShowCompare(false);
          }}
          onRemove={removeCompare}
          onBuyNow={(product) => {
            setShowCompare(false);
            setBuyNowItem({
              ...product,
              quantity: 1,
            });

            setBuyerPage(
              customer && customerToken
                ? "checkout"
                : "auth"
            );
          }}
        />
      </>
    );
  }

  // ==========================================
  // PRODUCT DETAILS — URL ROUTE (/product/:id)
  // ==========================================
  // Rendered for direct URLs / refreshes, and only when NO other
  // state-based page (cart / checkout / auth / account / orders /
  // wishlist / info / compare / chat / MLM) is active. Uses the same
  // App-level cart, wishlist, buy-now and chat handlers as the
  // state-based PDP — no second cart, no second checkout.
  //
  // ORDERING FIX: this branch used to sit ABOVE all the state-based
  // pages. Because it returned first, none of those flows could open
  // while the URL was /product/:id — the cart button, Buy Now and
  // login all appeared dead (blank-looking PDP). It now renders last
  // (just before the home page), so every other flow wins.

  if (routeProductId) {
    return (
      <>
        <Header
          {...commonHeaderProps}
          onCart={() =>
            setShowCart(true)
          }
        />

        <ProductDetailRoute
          productId={routeProductId}
          products={products}
          addToCart={addToCart}
          addToWishlist={addToWishlist}
          isWishlisted={(product) =>
            wishlist.some(
              (item) => item.id === product.id
            )
          }
          onBuyNow={(product, quantity) => {
            setBuyNowItem({
              ...product,
              quantity: Math.max(1, Number(quantity) || 1),
            });

            setBuyerPage(
              customer && customerToken
                ? "checkout"
                : "auth"
            );
          }}
          onChat={(product) => {
            setSelectedProduct(product);
            setBuyerPage("chat");
          }}
          onHome={() =>
            navigate("/")
          }
        />
      </>
    );
  }

  // ==========================================
  // MAIN BUYER PAGE
  // ==========================================

  return (
    <div
      className="jb-page"
      style={{
        width: "100%",
        minHeight: "100vh",
        overflowX: "hidden",
      }}
    >
      <div className="jb-family-chakra" aria-hidden="true" />
      {/* ======================================
          HEADER
      ====================================== */}

      <Header
        {...commonHeaderProps}
        onCart={() =>
          setShowCart(true)
        }
      />

      {/* ======================================
          BANNER (admin-managed with built-in fallback)
      ====================================== */}

      {homepagePromo?.announcement ? (
        <div
          className="jb-announcement"
          style={{
            margin: "10px auto 0",
            maxWidth: "1200px",
            width: "calc(100% - 20px)",
            background: "linear-gradient(90deg,#fff4ec,#ffeef6)",
            border: "1px solid #ffd9c2",
            color: "#1f2d4e",
            padding: "9px 14px",
            borderRadius: "10px",
            fontSize: "13.5px",
            fontWeight: 600,
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          {homepagePromo.announcement}
        </div>
      ) : null}

      <HomeHero
        banners={adminBanners}
        promo={homepagePromo}
        fitMode={siteContent?.display?.bannerFit || "cover"}
        onCta={(link) => {
          // In-app paths navigate inside JustBrand; external https
          // links open safely in a new tab.
          if (!link) return;

          if (link.startsWith("https://")) {
            window.open(link, "_blank", "noopener,noreferrer");
          } else if (link === "/wishlist") {
            setBuyerPage("wishlist");
          } else if (link === "/orders") {
            if (customer && customerToken) {
              setBuyerPage("orders");
            } else {
              setBuyerPage("auth");
            }
          } else if (link === "/family") {
            setMlmPage(mlmMember ? "dashboard" : "login");
          } else {
            const match = link.match(/^\/product\/(.+)$/);

            if (match) {
              const product =
                filteredProducts.find(
                  (p) => String(p.id) === match[1]
                ) || null;

              if (product) {
                setSelectedProduct(product);
              }
            }
          }
        }}
      />

      {/* ======================================
          MARKETPLACE CATEGORY DISCOVERY
      ====================================== */}

      <section className="jb-category-section" aria-label="Shop by category">
        <div className="jb-category-heading">
          <div>
            <span className="jb-section-eyebrow">EXPLORE JUSTBRAND</span>
            <h2>Shop by Category</h2>
            <p>Find what you need from everyday essentials to your favourite brands.</p>
          </div>
          <button
            type="button"
            className="jb-view-all-categories"
            onClick={() => {
              setCategory("All");
              setSearch("");
            }}
          >
            View all products <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="jb-category-grid">
          {HOME_CATEGORY_CARDS.map((item) => (
            <button
              type="button"
              key={item.label}
              className={`jb-category-card${category === item.value ? " is-active" : ""}`}
              onClick={() => {
                setCategory(item.value);
                setSearch("");
              }}
              aria-pressed={category === item.value}
            >
              <span className="jb-category-icon" aria-hidden="true">{item.icon}</span>
              <span className="jb-category-name">{item.label}</span>
              <span className="jb-category-subcategories">{item.subcategories}</span>
            </button>
          ))}
        </div>

        <div className="jb-category-quickfilters" aria-label="Quick category filters">
          {categoryChips.map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? "is-active" : ""}
              onClick={() => {
                setCategory(item);
                setSearch("");
              }}
            >
              {item === "All" ? "All products" : item}
            </button>
          ))}
        </div>
      </section>

      {/* ======================================
          MAIN CONTENT
      ====================================== */}

      <div
        style={{
          width: "100%",
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "20px",
          boxSizing: "border-box",
        }}
      >
        {/* ====================================
            COMPARE SLIDER
        ==================================== */}

        {!loading &&
          products.length > 0 && (
            <div
              style={{
                marginBottom:
                  "30px",
              }}
            >
              <ComparePriceSlider
                products={products}
                onCompare={
                  compareSingleProduct
                }
              />
            </div>
          )}

        {/* ====================================
            TITLE
        ==================================== */}

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems:
              "center",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom:
              "20px",
          }}
        >
          <div>
            <h2
              style={{
                margin:
                  "0 0 5px",
              }}
            >
              JustBrand Products
            </h2>

            <p
              style={{
                color: "#666",
                margin: 0,
              }}
            >
              Best products at best prices
            </p>
          </div>

          {compareProducts.length >
            0 && (
            <button
              onClick={() =>
                setShowCompare(
                  true
                )
              }
              style={{
                background:
                  "#ff1493",
                color:
                  "white",
                border:
                  "none",
                padding:
                  "10px 18px",
                borderRadius:
                  "8px",
                cursor:
                  "pointer",
                fontWeight:
                  "bold",
              }}
            >
              ⚖️ Compare (
              {compareProducts.length}
              )
            </button>
          )}
        </div>

        {/* ====================================
            LOADING
        ==================================== */}

        {loading && (
          <div className="jb-product-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                style={{
                  background: "white",
                  borderRadius: "14px",
                  padding: "12px",
                  border: "1px solid #eee",
                }}
              >
                <div
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: "12px",
                    background:
                      "linear-gradient(90deg,#f0f0f2 25%,#fafafb 50%,#f0f0f2 75%)",
                    backgroundSize: "200% 100%",
                    animation: "jb-shimmer 1.1s infinite",
                    marginBottom: "10px",
                  }}
                />
                <div
                  style={{
                    height: "14px",
                    borderRadius: "7px",
                    background:
                      "linear-gradient(90deg,#f0f0f2 25%,#fafafb 50%,#f0f0f2 75%)",
                    backgroundSize: "200% 100%",
                    animation: "jb-shimmer 1.1s infinite",
                    marginBottom: "8px",
                  }}
                />
                <div
                  style={{
                    height: "14px",
                    width: "55%",
                    borderRadius: "7px",
                    background:
                      "linear-gradient(90deg,#f0f0f2 25%,#fafafb 50%,#f0f0f2 75%)",
                    backgroundSize: "200% 100%",
                    animation: "jb-shimmer 1.1s infinite",
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* ====================================
            PRODUCTS
        ==================================== */}

        {!loading &&
          filteredProducts.length >
            0 && (            <div className="jb-product-grid">
              {filteredProducts.map(
                (product) => (
                  <ProductCard
                    key={
                      product.id
                    }
                    product={
                      product
                    }
                    addToCart={
                      addToCart
                    }
                    addToWishlist={
                      addToWishlist
                    }
                    isWishlisted={wishlist.some(
                      (item) => item.id === product.id
                    )}
                    onSelect={(product) =>
                      navigate(
                        `/product/${product.id}`
                      )
                    }
                    onCompare={
                      onCompare
                    }
                  />
                )
              )}
            </div>
          )}

        {/* ====================================
            NO PRODUCTS
        ==================================== */}

        {!loading &&
          filteredProducts.length ===
            0 && (
            <div
              style={{
                background:
                  "white",
                padding:
                  "48px 24px",
                borderRadius:
                  "16px",
                textAlign:
                  "center",
                marginTop:
                  "20px",
                border: "1px solid #eee",
              }}
            >              <div
                style={{
                  fontSize: "44px",
                  marginBottom: "10px",
                }}
              >
                {backendDown ? "⚠️" : catalogEmpty ? "🛍️" : "🔍"}
              </div>
              <h3
                style={{
                  margin: "0 0 6px",
                  color: "#222",
                }}
              >
                {backendDown
                  ? "Unable to load products"
                  : catalogEmpty
                    ? "No products available yet"
                    : "No products found"}
              </h3>

              <p
                style={{
                  color: "#777",
                  margin: "0 0 18px",
                  fontSize: "14.5px",
                }}
              >
                {backendDown
                  ? "The store server is not responding right now. Please refresh in a while."
                  : catalogEmpty
                    ? "Please check back soon — new products are added regularly."
                    : "Please try another search or category."}
              </p>

              <button
                onClick={() => {
                  if (catalogEmpty || backendDown) {
                    loadProducts();
                    return;
                  }
                  setSearch("");
                  setCategory("All");
                }}
                style={{
                  background:
                    "linear-gradient(135deg, #ff8a00, #ff1493)",
                  color:
                    "white",
                  border:
                    "none",
                  padding:
                    "11px 22px",
                  borderRadius:
                    "24px",
                  cursor:
                    "pointer",
                  fontWeight: 700,
                  fontSize: "14px",
                  boxShadow:
                    "0 4px 12px rgba(255,20,147,0.25)",
                }}
              >
                {catalogEmpty || backendDown
                  ? "Refresh"
                  : "Show All Products"}
              </button>
            </div>
          )}

        {/* ====================================
            INFO PAGE LINKS
        ==================================== */}

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "18px",
            justifyContent: "center",
            margin: "26px auto 8px",
            maxWidth: "700px",
            padding: "0 16px",
          }}
        >
          {[
            ["contact", "Contact Us"],
            ["about", "About Us"],
            ["returns", "Return & Refund Policy"],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setBuyerPage(key)}
              style={{
                background: "none",
                border: "none",
                color: "#555",
                fontSize: "13px",
                cursor: "pointer",
                padding: "6px 2px",
                borderBottom: "1px solid transparent",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.color =
                  "var(--jb-saffron-deep, #e85d04)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.color = "#555")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Footer
        onInfoPage={(key) => setBuyerPage(key)}
        onFamily={() => setMlmPage(mlmMember ? "dashboard" : "login")}
        onCart={() => setShowCart(true)}
        onWishlist={() => setBuyerPage("wishlist")}
        content={siteContent?.footer || null}
      />
    </div>
  );
}

// ==========================================
// EXPORT
// ==========================================

export default App;
