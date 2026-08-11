function Header({
  cartCount,
  onCart,
  search,
  setSearch,
  filteredProducts = [],
  filteredCategories = [],
  onProductSelect,
}) {
  return (
    <header
      style={{
        background: "#ff6b00",
        color: "white",
        padding: "15px 25px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        position: "sticky",
        top: 0,
        zIndex: 1000,
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
        }}
      >
        <img
          src="/images/logo.png"
          alt="JustBrand"
          style={{
            height: "50px",
            width: "50px",
            borderRadius: "8px",
          }}
        />

        <h2
          style={{
            margin: 0,
            fontSize: "28px",
            fontWeight: "bold",
          }}
        >
          JustBrand
        </h2>
      </div>

      {/* Search */}
      <div
        style={{
          width: "45%",
          position: "relative",
        }}
      >
        <input
          type="text"
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "8px",
            border: "none",
            fontSize: "15px",
          }}
        />

        {search !== "" && (
          <div
            style={{
              position: "absolute",
              top: "45px",
              left: 0,
              right: 0,
              background: "#fff",
              color: "#000",
              borderRadius: "8px",
              boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
              maxHeight: "300px",
              overflowY: "auto",
              zIndex: 2000,
            }}
          >
            {filteredCategories.map((cat) => (
              <div
                key={cat}
                onClick={() => setSearch(cat)}
                style={{
                  padding: "10px",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                  fontWeight: "bold",
                }}
              >
                📂 {cat}
              </div>
            ))}

            {filteredProducts.map((product) => (
              <div
                key={product.id || product.name}
                onClick={() => {
                  onProductSelect(product);
                  setSearch("");
                }}
                style={{
                  padding: "10px",
                  cursor: "pointer",
                  borderBottom: "1px solid #eee",
                }}
              >
                🔍 {product.name}
              </div>
            ))}

            {filteredProducts.length === 0 &&
              filteredCategories.length === 0 && (
                <div
                  style={{
                    padding: "10px",
                    color: "#666",
                  }}
                >
                  No Result Found
                </div>
              )}
          </div>
        )}
      </div>

      {/* Right Menu */}
      <div
        style={{
          display: "flex",
          gap: "20px",
          alignItems: "center",
        }}
      >
        <span style={{ cursor: "pointer" }}>
          ❤️ Wishlist
        </span>

        <span
          onClick={onCart}
          style={{
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          🛒 Cart ({cartCount})
        </span>

        <span style={{ cursor: "pointer" }}>
          👤 Login
        </span>
      </div>
    </header>
  );
}

export default Header;