function Cart({ cart, onBack }) {
  const total = cart.reduce((sum, item) => {
    const price = Number(
      item.price.replace("₹", "").replace(",", "")
    );
    return sum + price;
  }, 0);

  return (
    <div
      style={{
        padding: "30px",
        maxWidth: "900px",
        margin: "auto",
      }}
    >
      <button
        onClick={onBack}
        style={{
          padding: "10px 20px",
          background: "#ddd",
          border: "none",
          borderRadius: "6px",
          cursor: "pointer",
          marginBottom: "20px",
        }}
      >
        ← Back
      </button>

      <h2>🛒 My Cart</h2>

      {cart.length === 0 ? (
        <h3>Your cart is empty</h3>
      ) : (
        <>
          {cart.map((item, index) => (
            <div
              key={index}
              style={{
                background: "white",
                padding: "15px",
                marginBottom: "15px",
                borderRadius: "10px",
                display: "flex",
                alignItems: "center",
                gap: "20px",
                boxShadow: "0 2px 8px #ddd",
              }}
            >
              <img
                src={item.image}
                alt={item.name}
                style={{
                  width: "90px",
                  height: "90px",
                  objectFit: "cover",
                  borderRadius: "8px",
                }}
              />

              <div>
                <h3>{item.name}</h3>
                <p>{item.price}</p>
              </div>
            </div>
          ))}

          <h2>
            Total: ₹{total}
          </h2>

          <button
            style={{
              padding: "12px 25px",
              background: "#ff6b00",
              color: "white",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Proceed to Checkout
          </button>
        </>
      )}
    </div>
  );
}

export default Cart;