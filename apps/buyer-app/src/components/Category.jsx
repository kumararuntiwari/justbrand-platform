import { useEffect, useState } from "react";

// Phase 1: categories come from the admin-managed API. On any
// failure the built-in list below keeps rendering exactly as
// before (fallback safety — never a blank section).
const FALLBACK_CATEGORIES = [
  "👕 Fashion",
  "📱 Electronics",
  "🥫 Grocery",
  "💄 Beauty",
  "🏠 Home",
  "💻 Computers",
];

function Category() {
  const [apiCategories, setApiCategories] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function loadCategories() {
      try {
        const response = await fetch(
          "https://justbrand-in-144629.hostingersite.com/api/categories"
        );

        if (!response.ok) return;

        const data = await response.json().catch(() => null);

        if (!cancelled && data?.success && Array.isArray(data.categories)) {
          const names = data.categories
            .filter((c) => c && c.name)
            .map((c) => `${c.icon ? `${c.icon} ` : ""}${c.name}`);

          if (names.length > 0) setApiCategories(names);
        }
      } catch {
        // Keep the built-in fallback categories.
      }
    }

    loadCategories();

    return () => {
      cancelled = true;
    };
  }, []);

  const categories =
    apiCategories.length > 0 ? apiCategories : FALLBACK_CATEGORIES;

  return (
    <div
      style={{
        padding: "20px",
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: "15px",
      }}
    >
      {categories.map((item, index) => (
        <div
          key={index}
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "10px",
            textAlign: "center",
            boxShadow: "0 2px 8px #ddd",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export default Category;
