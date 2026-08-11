import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

// =====================================
// PRODUCTS
// =====================================

let products = [];

// =====================================
// GET ALL PRODUCTS
// =====================================

app.get("/api/products", (req, res) => {
  res.json(products);
});

// =====================================
// ADD PRODUCT
// =====================================

app.post("/api/products", (req, res) => {
  const product = {
    ...req.body,
    id: Date.now(),
  };

  products.push(product);

  res.json({
    success: true,
    product,
  });
});

// =====================================
// DELETE PRODUCT
// =====================================

app.delete("/api/products/:id", (req, res) => {
  const id = Number(req.params.id);

  products = products.filter(
    (product) => product.id !== id
  );

  res.json({
    success: true,
  });
});

// =====================================
// SEARCH PRODUCTS
// =====================================

app.get("/api/products/search", (req, res) => {
  const search = String(
    req.query.q || ""
  ).toLowerCase();

  const results = products.filter(
    (product) => {
      const name = String(
        product.name || ""
      ).toLowerCase();

      const category = String(
        product.category || ""
      ).toLowerCase();

      const description = String(
        product.description ||
          product.shortDetails ||
          ""
      ).toLowerCase();

      return (
        name.includes(search) ||
        category.includes(search) ||
        description.includes(search)
      );
    }
  );

  res.json({
    success: true,
    products: results,
  });
});

// =====================================
// COMPARE PRICE
// =====================================

app.get("/api/compare", (req, res) => {
  const search = String(
    req.query.q || ""
  ).trim();

  if (!search) {
    return res.json({
      success: false,
      message: "Please enter product name.",
      results: [],
    });
  }

  const searchLower =
    search.toLowerCase();

  // ===================================
  // JUSTBRAND PRODUCT
  // ===================================

  const justBrandProducts =
    products.filter((product) => {
      const name = String(
        product.name || ""
      ).toLowerCase();

      return name.includes(searchLower);
    });

  // ===================================
  // DEMO MARKETPLACE DATA
  // Later API will replace this
  // ===================================

  const baseProduct =
    justBrandProducts[0];

  const productName =
    baseProduct?.name || search;

  const justBrandPrice =
    baseProduct?.price || "₹999";

  const compareResults = [
    {
      platform: "JustBrand",
      productName: productName,
      image:
        baseProduct?.image ||
        "/images/product1.png",
      price: justBrandPrice,
      rating: "4.5",
      delivery: "Fast Delivery",
      link: "#",
      isBestPrice: false,
    },

    {
      platform: "Amazon",
      productName: productName,
      image:
        baseProduct?.image ||
        "/images/product1.png",
      price: "₹949",
      rating: "4.4",
      delivery: "Prime Delivery",
      link: "#",
      isBestPrice: false,
    },

    {
      platform: "Flipkart",
      productName: productName,
      image:
        baseProduct?.image ||
        "/images/product1.png",
      price: "₹929",
      rating: "4.3",
      delivery: "Free Delivery",
      link: "#",
      isBestPrice: false,
    },

    {
      platform: "Meesho",
      productName: productName,
      image:
        baseProduct?.image ||
        "/images/product1.png",
      price: "₹899",
      rating: "4.2",
      delivery: "Standard Delivery",
      link: "#",
      isBestPrice: false,
    },
  ];

  // ===================================
  // FIND BEST PRICE
  // ===================================

  const prices = compareResults.map(
    (item) =>
      Number(
        String(item.price)
          .replace("₹", "")
          .replace(",", "")
      )
  );

  const lowestPrice =
    Math.min(...prices);

  compareResults.forEach((item) => {
    const price = Number(
      String(item.price)
        .replace("₹", "")
        .replace(",", "")
    );

    if (price === lowestPrice) {
      item.isBestPrice = true;
    }
  });

  // ===================================
  // RESPONSE
  // ===================================

  res.json({
    success: true,
    search,
    product: baseProduct || null,
    results: compareResults,
  });
});

// =====================================
// SERVER
// =====================================

app.listen(5000, () => {
  console.log(
    "JustBrand Backend running on http://localhost:5000"
  );
});