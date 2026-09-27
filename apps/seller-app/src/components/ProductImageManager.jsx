import React, { useState } from "react";
import "../index.css";

// =====================================
// PRODUCT IMAGE MANAGER (shared)
// =====================================
// Multi-image manager for seller products (1–6 images):
//  - multi-select upload (JPG / JPEG / PNG / WebP, max 5 MB each)
//  - thumbnail previews with remove option
//  - drag-and-drop reorder (touch-friendly via pointer events)
//  - "Set as Main" moves any image to first position (primary)
//  - duplicate-safe selection (same image cannot be added twice)
//  - clear errors for invalid type / size
//  - loading state while images are read
// The first image is treated as the primary/main image everywhere.

export const MAX_PRODUCT_IMAGES = 6;
export const MAX_IMAGE_SIZE_MB = 5;

const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Image read failed."));
    reader.readAsDataURL(file);
  });
}

export default function ProductImageManager({ images, onChange, onError }) {
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);

  const showError = (message) => {
    setErrors((prev) => [...prev, message]);
    if (onError) onError(message);
  };

  const clearErrors = () => setErrors([]);

  // -------------------------------------
  // SELECT / UPLOAD (multi-select, duplicate-safe)
  // -------------------------------------
  const handleFiles = async (fileList) => {
    clearErrors();
    if (!fileList || fileList.length === 0) return;

    setUploading(true);

    try {
      const files = Array.from(fileList);
      const accepted = [...images];
      const localErrors = [];

      for (const file of files) {
        if (accepted.length >= MAX_PRODUCT_IMAGES) {
          localErrors.push(`Maximum ${MAX_PRODUCT_IMAGES} images allowed — some files were skipped.`);
          break;
        }

        const mime = String(file.type || "").toLowerCase();
        const ext = String(file.name || "").split(".").pop()?.toLowerCase() || "";
        const typeOk =
          ALLOWED_TYPES.includes(mime) ||
          ["jpg", "jpeg", "png", "webp"].includes(ext);
        if (!typeOk) {
          localErrors.push(`${file.name}: Only JPG, JPEG, PNG and WebP images are allowed.`);
          continue;
        }

        if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
          localErrors.push(`${file.name}: Image must be under ${MAX_IMAGE_SIZE_MB} MB.`);
          continue;
        }

        const dataUrl = await readAsDataURL(file);

        // Duplicate-safe: skip an identical image already in the list.
        if (accepted.includes(dataUrl)) {
          localErrors.push(`${file.name}: This image is already added.`);
          continue;
        }

        accepted.push(dataUrl);
      }

      if (localErrors.length > 0) {
        setErrors(localErrors);
        if (onError) onError(localErrors.join(" "));
      }

      if (accepted.length !== images.length) {
        onChange(accepted);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = (index) => {
    clearErrors();
    onChange(images.filter((_, i) => i !== index));
  };

  const handleSetMain = (index) => {
    clearErrors();
    if (index === 0) return;
    const next = [...images];
    const [picked] = next.splice(index, 1);
    onChange([picked, ...next]);
  };

  // -------------------------------------
  // DRAG-AND-DROP REORDER (pointer events → works on touch too)
  // -------------------------------------
  const handlePointerDown = (index) => (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    setDragIndex(index);
  };

  const handlePointerEnter = (index) => () => {
    if (dragIndex === null || dragIndex === index) return;
    setOverIndex(index);
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(index, 0, moved);
    onChange(next);
    setDragIndex(index);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  const gridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
    gap: "10px",
    marginTop: "10px",
  };

  return (
    <div>
      <label style={{ fontWeight: "600", display: "block", marginBottom: "4px" }}>
        Product Images * <span style={{ fontWeight: 400, color: "#777" }}>(1–{MAX_PRODUCT_IMAGES} · first image = Main)</span>
      </label>

      <label
        style={{
          display: "block",
          border: "2px dashed #ff6b00",
          borderRadius: "10px",
          padding: "16px",
          textAlign: "center",
          cursor: uploading ? "wait" : "pointer",
          background: "#fff8f3",
          opacity: uploading ? 0.6 : 1,
          pointerEvents: uploading ? "none" : "auto",
        }}
      >
        <input
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          multiple
          disabled={uploading || images.length >= MAX_PRODUCT_IMAGES}
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
          style={{ display: "none" }}
        />
        {uploading ? (
          <span style={{ color: "#ff6b00", fontWeight: "600" }}>⏳ Processing images…</span>
        ) : images.length >= MAX_PRODUCT_IMAGES ? (
          <span style={{ color: "#777" }}>Maximum {MAX_PRODUCT_IMAGES} images added</span>
        ) : (
          <span>
            📷 <strong>Add Images</strong>
            <span style={{ color: "#777" }}> — JPG, JPEG, PNG, WebP · up to {MAX_IMAGE_SIZE_MB} MB each</span>
          </span>
        )}
      </label>

      {errors.map((message, i) => (
        <p
          key={i}
          style={{
            color: "#d32f2f",
            fontSize: "13px",
            margin: "8px 0 0",
            fontWeight: 600,
          }}
        >
          ⚠ {message}
        </p>
      ))}

      {images.length > 0 && (
        <div style={gridStyle} onDragEnd={endDrag}>
          {images.map((src, index) => (
            <div
              key={`${index}-${src.slice(-24)}`}
              draggable
              onPointerDown={handlePointerDown(index)}
              onPointerEnter={handlePointerEnter(index)}
              onPointerUp={endDrag}
              onPointerLeave={() => index === overIndex && setOverIndex(null)}
              style={{
                position: "relative",
                border:
                  index === 0
                    ? "2px solid #ff6b00"
                    : overIndex === index
                    ? "2px dashed #ff6b00"
                    : "1px solid #ddd",
                borderRadius: "10px",
                padding: "4px",
                background: "#fafafa",
                opacity: dragIndex === index ? 0.55 : 1,
                touchAction: "none",
                userSelect: "none",
              }}
            >
              {index === 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: "-9px",
                    left: "6px",
                    background: "#ff6b00",
                    color: "#fff",
                    fontSize: "10px",
                    fontWeight: 700,
                    padding: "2px 7px",
                    borderRadius: "999px",
                    zIndex: 1,
                  }}
                >
                  MAIN
                </span>
              )}

              <img
                src={src}
                alt={`Product ${index + 1}`}
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  objectFit: "contain",
                  borderRadius: "7px",
                  background: "#fff",
                  display: "block",
                }}
              />

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "4px",
                  marginTop: "4px",
                }}
              >
                <span
                  title="Drag to reorder"
                  style={{ cursor: "grab", fontSize: "13px", lineHeight: 1 }}
                >
                  ⇅
                </span>

                {index !== 0 && (
                  <button
                    type="button"
                    onClick={() => handleSetMain(index)}
                    style={{
                      border: "none",
                      background: "none",
                      color: "#ff6b00",
                      fontSize: "11px",
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: "2px",
                    }}
                  >
                    Set as Main
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  style={{
                    border: "none",
                    background: "none",
                    color: "#d32f2f",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: "2px",
                  }}
                  title="Remove image"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
