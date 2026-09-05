import { useState, useEffect } from "react";

function Slider() {
  const banners = [
    "/images/banner1.jpg",
    "/images/banner2.jpg",
    "/images/banner3.jpg",
    "/images/banner4.jpg",
  ];

  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrent((prev) => (prev + 1) % banners.length);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1200px",
        margin: "15px auto",
        padding: "0 10px",
        boxSizing: "border-box",
      }}
    >
      {/* Stable Banner Area */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16 / 6",
          minHeight: "160px",
          overflow: "hidden",
          borderRadius: "15px",
          position: "relative",
          background: "#f2f2f2",
        }}
      >
        <img
          src={banners[current]}
          alt={`Banner ${current + 1}`}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "cover",
          }}
        />
      </div>

      {/* Banner Number */}
      <div
        style={{
          textAlign: "center",
          marginTop: "8px",
          fontSize: "13px",
          fontWeight: "bold",
        }}
      >
        Banner {current + 1}
      </div>
    </div>
  );
}

export default Slider;