import React from "react";

function Wishlist({ wishlist, onBack, onRemove, onAddToCart }) {
  return (
    <div className="jb-page" style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>My Wishlist</div>
        </div>

        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.inner}>
          {wishlist.length === 0 ? (
            <div style={styles.emptyCard}>
              <div style={styles.emptyIcon}>❤️</div>
              <div style={styles.emptyTitle}>Your wishlist is empty</div>
              <div style={styles.emptyText}>
                Tap the heart on any product to save it here.
              </div>
            </div>
          ) : (
            wishlist.map((item, index) => (
              <div key={index} style={styles.card}>
                <img
                  src={item.image}
                  alt={item.name}
                  style={styles.image}
                />

                <div style={styles.info}>
                  <div style={styles.name}>{item.name}</div>
                  <div style={styles.price}>{item.price}</div>

                  <div style={styles.actions}>
                    {onAddToCart && (
                      <button
                        type="button"
                        onClick={() => onAddToCart(item)}
                        style={styles.cartButton}
                      >
                        🛒 Add to Cart
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onRemove(item)}
                      style={styles.removeButton}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "transparent",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    boxSizing: "border-box",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  headerText: {
    fontSize: "12px",
    opacity: 0.9,
    marginTop: "2px",
  },

  backButton: {
    border: "none",
    background: "#fff",
    color: "#ff1493",
    padding: "10px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  container: {
    minHeight: "calc(100vh - 70px)",
    width: "100%",
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  inner: {
    maxWidth: "760px",
    margin: "0 auto",
  },

  emptyCard: {
    background: "#fff",
    borderRadius: "16px",
    padding: "40px 30px",
    textAlign: "center",
    boxShadow: "0 5px 25px rgba(0,0,0,0.09)",
    color: "#777",
  },

  emptyIcon: {
    fontSize: "40px",
    marginBottom: "10px",
  },

  emptyTitle: {
    fontWeight: "bold",
    fontSize: "18px",
    color: "#333",
    marginBottom: "5px",
  },

  emptyText: {
    fontSize: "13px",
  },

  card: {
    background: "#fff",
    borderRadius: "14px",
    padding: "15px",
    marginBottom: "15px",
    display: "flex",
    gap: "15px",
    boxShadow: "0 3px 15px rgba(0,0,0,0.07)",
  },

  image: {
    width: "90px",
    height: "90px",
    objectFit: "cover",
    borderRadius: "10px",
    flexShrink: 0,
  },

  info: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: "6px",
  },

  name: {
    fontWeight: "bold",
    fontSize: "15px",
    color: "#333",
  },

  price: {
    color: "#ff1493",
    fontWeight: "bold",
    fontSize: "15px",
  },

  actions: {
    display: "flex",
    gap: "10px",
    marginTop: "5px",
  },

  cartButton: {
    border: "none",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "9px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: "bold",
  },

  removeButton: {
    border: "1px solid #ddd",
    background: "#fff",
    color: "#777",
    padding: "9px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "13px",
  },
};

export default Wishlist;
