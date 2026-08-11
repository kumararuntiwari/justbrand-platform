import { useState, useEffect } from "react";

function Banner() {
  const banners = [
    "/images/banner1.jpg",
    "/images/banner2.jpg",
    "/images/banner3.jpg",
    "/images/banner4.jpg",
  ];

  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrent((prev) => (prev + 1) % banners.length);
    }, 3000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div
      style={{
        margin: "20px",
        borderRadius: "12px",
        overflow: "hidden",
        width: "100%",
      }}
    >
      <img
        src={banners[current]}
        alt="Banner"
        style={{
          width: "100%",
          height: "250px",
          objectFit: "contain",
          display: "block",
          background: "#f5f5f5",
        }}
      />
    </div>
  );
}

export default Banner;