function Category() {
  const categories = [
    "👕 Fashion",
    "📱 Electronics",
    "🥫 Grocery",
    "💄 Beauty",
    "🏠 Home",
    "💻 Computers",
  ];

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