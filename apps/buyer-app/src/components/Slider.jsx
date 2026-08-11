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
  }, [banners.length]);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "1200px",
        margin: "20px auto",
      }}
    >
      <img
        key={current}
        src={banners[current]}
        alt={`Banner ${current + 1}`}
        style={{
          width: "100%",
          height: "400px",
          objectFit: "cover",
          borderRadius: "15px",
        }}
      />

      <div
        style={{
          textAlign: "center",
          marginTop: "10px",
          fontWeight: "bold",
        }}
      >
        Banner {current + 1}
      </div>
    </div>
  );
}

export default Slider;