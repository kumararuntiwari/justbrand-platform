import React, { useEffect, useRef, useState } from "react";
import { api, getCustomerToken } from "../api";

// ==========================================
// PROTECTED PRODUCT CHAT (BUYER SIDE)
// ==========================================
// Buyer ↔ Seller chat for ONE product. Contact information is
// redacted on the backend before delivery — this UI just renders
// what the server returns (never anything else).
// Thread is opened via POST /api/chat/threads (server validates
// product + buyer), messages via /api/chat/threads/:id/messages.

function ProductChat({ product, onBack }) {
  const token = getCustomerToken();

  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef(null);

  // Open (or reuse) the product-scoped thread.
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const data = await api("/api/chat/threads", {
          method: "POST",
          body: { productId: product.id },
          token,
        });

        if (alive && data?.thread) setThread(data.thread);
      } catch (e) {
        if (alive) setError(e.message || "Could not open chat.");
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // Load messages + light polling while the chat is open.
  useEffect(() => {
    if (!thread?.id) return undefined;

    let alive = true;

    async function load() {
      try {
        const data = await api(`/api/chat/threads/${thread.id}/messages`, {
          token,
        });

        if (alive) {
          setMessages(data.messages || []);
          setError("");
        }
      } catch (e) {
        if (alive && !e.status) {
          setError("Chat connection lost — retrying…");
        } else if (alive && e.status === 404) {
          setError("This chat is no longer available.");
        }
      }
    }

    load();
    const timer = setInterval(load, 5000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const value = text.trim();
    if (!value || sending || !thread?.id) return;

    setSending(true);
    try {
      const data = await api(`/api/chat/threads/${thread.id}/messages`, {
        method: "POST",
        body: { message: value },
        token,
      });

      if (data?.message) {
        setMessages((old) => [...old, data.message]);
      }
      setText("");
      setError("");
    } catch (e) {
      setError(e.message || "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f6fa",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background: "linear-gradient(135deg, #ff6b00, #ff1493)",
          color: "white",
          padding: "15px 20px",
          display: "flex",
          alignItems: "center",
          gap: "14px",
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "rgba(255,255,255,0.18)",
            border: "none",
            color: "white",
            borderRadius: "8px",
            padding: "8px 12px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ← Back
        </button>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            💬 Chat about this product
          </div>
          <div
            style={{
              fontSize: 12.5,
              opacity: 0.92,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "60vw",
            }}
          >
            {product?.name || "Product"}
          </div>
        </div>
      </div>

      {/* SAFETY NOTICE */}
      <div
        style={{
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          color: "#9a3412",
          fontSize: 12.5,
          padding: "9px 16px",
        }}
      >
        🔒 Phone numbers, emails and WhatsApp/contact details are hidden
        automatically in this chat. Ask about colour, size, quality,
        material, availability and product details.
      </div>

      {error ? (
        <div
          style={{
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: 13,
            padding: "9px 16px",
          }}
        >
          {error}
        </div>
      ) : null}

      {/* MESSAGES */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          maxHeight: "calc(100vh - 210px)",
        }}
      >
        {!thread ? (
          <div style={{ color: "#777", textAlign: "center", paddingTop: 40 }}>
            Opening chat…
          </div>
        ) : messages.length === 0 ? (
          <div style={{ color: "#777", textAlign: "center", paddingTop: 40 }}>
            Say hello and ask the seller anything about this product 👋
          </div>
        ) : (
          messages.map((m) => {
            const mine = m.senderType === "buyer";
            return (
              <div
                key={m.id}
                style={{
                  alignSelf: mine ? "flex-end" : "flex-start",
                  maxWidth: "78%",
                  background: mine
                    ? "linear-gradient(135deg,#ff6b00,#ff1493)"
                    : "#ffffff",
                  color: mine ? "#fff" : "#222",
                  border: mine ? "none" : "1px solid #e5e7eb",
                  borderRadius: "14px",
                  padding: "9px 13px",
                  fontSize: 14.5,
                  lineHeight: 1.45,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  wordBreak: "break-word",
                }}
              >
                {m.message}
                <div
                  style={{
                    fontSize: 10.5,
                    opacity: 0.75,
                    marginTop: 4,
                    textAlign: "right",
                  }}
                >
                  {new Date(m.createdAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* INPUT */}
      <div
        style={{
          display: "flex",
          gap: "10px",
          padding: "12px 16px 20px",
          background: "#fff",
          borderTop: "1px solid #e5e7eb",
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={2000}
          placeholder="Ask about colour, size, quality, material…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          style={{
            flex: 1,
            border: "1.5px solid #d1d5db",
            borderRadius: "10px",
            padding: "11px 13px",
            fontSize: 15,
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={sending || !text.trim()}
          style={{
            background: sending ? "#ccc" : "linear-gradient(135deg,#ff6b00,#ff1493)",
            color: "#fff",
            border: "none",
            borderRadius: "10px",
            padding: "11px 18px",
            fontWeight: "bold",
            cursor: sending ? "wait" : "pointer",
          }}
        >
          {sending ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}

export default ProductChat;
