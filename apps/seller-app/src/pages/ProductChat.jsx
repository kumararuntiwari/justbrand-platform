import React, { useEffect, useRef, useState } from "react";

// ==========================================
// PROTECTED PRODUCT CHAT (SELLER SIDE)
// ==========================================
// Seller sees ONLY conversations on their own products — the
// backend enforces this (/api/chat/threads/seller filters by the
// token's sellerId; thread access is participant-checked there).
// Contact info in messages is redacted on the backend before it is
// ever delivered to this screen.

const API_URL = "https://justbrand-in-144629.hostingersite.com";

function getToken() {
  return localStorage.getItem("justbrand_seller_token") || "";
}

async function chatApi(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getToken()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function ProductChat({ onBack }) {
  const [threads, setThreads] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);

  const bottomRef = useRef(null);

  // Load the seller's own threads (server-side filtered).
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const data = await chatApi("/api/chat/threads/seller");
        if (alive) {
          setThreads(data.threads || []);
          setError("");
        }
      } catch (e) {
        if (alive) setError(e.message || "Could not load chats.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 8000);

    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Load messages for the active thread (+ light polling).
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return undefined;
    }

    let alive = true;

    async function load() {
      try {
        const data = await chatApi(`/api/chat/threads/${activeId}/messages`);
        if (alive) setMessages(data.messages || []);
      } catch (e) {
        if (alive && e.status === 404) {
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
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const value = text.trim();
    if (!value || sending || !activeId) return;

    setSending(true);
    try {
      const data = await chatApi(`/api/chat/threads/${activeId}/messages`, {
        method: "POST",
        body: { message: value },
      });

      if (data?.message) setMessages((old) => [...old, data.message]);
      setText("");
      setError("");
    } catch (e) {
      setError(e.message || "Could not send message.");
    } finally {
      setSending(false);
    }
  }

  const activeThread = threads.find((t) => t.id === activeId) || null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f5f5",
        color: "#222",
      }}
    >
      {/* HEADER */}
      <header
        style={{
          background: "linear-gradient(135deg,#ff6b00,#ff1493)",
          color: "white",
          padding: "15px 25px",
          display: "flex",
          alignItems: "center",
          gap: "15px",
        }}
      >
        <button
          onClick={activeId ? () => setActiveId(null) : onBack}
          style={{
            background: "rgba(255,255,255,0.18)",
            border: "none",
            color: "white",
            borderRadius: "8px",
            padding: "9px 14px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          {activeId ? "← Chats" : "← Back"}
        </button>

        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>
            💬 Buyer Chats
          </h2>
          <p style={{ margin: "2px 0 0", fontSize: 12.5, opacity: 0.92 }}>
            {activeThread
              ? activeThread.productName
              : "Product questions from buyers"}
          </p>
        </div>
      </header>

      <div style={{ padding: "18px 25px 40px", maxWidth: 900, margin: "0 auto" }}>
        {/* SAFETY NOTICE */}
        <div
          style={{
            background: "#fff7ed",
            border: "1px solid #fed7aa",
            color: "#9a3412",
            fontSize: 13,
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 14,
          }}
        >
          🔒 Phone numbers, emails and WhatsApp/contact details are hidden
          automatically in this chat — for everyone.
        </div>

        {error ? (
          <div
            style={{
              background: "#fef2f2",
              color: "#b91c1c",
              borderRadius: 10,
              padding: "10px 14px",
              fontSize: 13.5,
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        ) : null}

        {!activeId ? (
          // ---------- THREAD LIST ----------
          loading ? (
            <div style={{ color: "#777", padding: "30px 0", textAlign: "center" }}>
              Loading chats…
            </div>
          ) : threads.length === 0 ? (
            <div
              style={{
                background: "#fff",
                border: "1px solid #eee",
                borderRadius: 12,
                padding: 30,
                textAlign: "center",
                color: "#777",
              }}
            >
              No buyer conversations yet. Buyers can message you from any of
              your product pages.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {threads.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  style={{
                    background: "#fff",
                    border: "1px solid #e8e8e8",
                    borderRadius: 12,
                    padding: "14px 16px",
                    textAlign: "left",
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <strong style={{ display: "block" }}>
                      {t.displayName}
                    </strong>
                    <small
                      style={{
                        color: "#777",
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "60vw",
                      }}
                    >
                      {t.productName} · {t.lastMessage || "New conversation"}
                    </small>
                  </span>
                  <span style={{ color: "#ff6b00", fontWeight: "bold" }}>›</span>
                </button>
              ))}
            </div>
          )
        ) : (
          // ---------- CONVERSATION ----------
          <>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                background: "#fff",
                border: "1px solid #e8e8e8",
                borderRadius: 12,
                padding: 16,
                minHeight: 280,
                maxHeight: "55vh",
                overflowY: "auto",
                marginBottom: 12,
              }}
            >
              {messages.length === 0 ? (
                <div style={{ color: "#777", textAlign: "center", paddingTop: 30 }}>
                  No messages yet — the buyer will see your reply here.
                </div>
              ) : (
                messages.map((m) => {
                  const mine = m.senderType === "seller";
                  return (
                    <div
                      key={m.id}
                      style={{
                        alignSelf: mine ? "flex-end" : "flex-start",
                        maxWidth: "78%",
                        background: mine
                          ? "linear-gradient(135deg,#ff6b00,#ff1493)"
                          : "#f3f4f6",
                        color: mine ? "#fff" : "#222",
                        borderRadius: "12px",
                        padding: "9px 13px",
                        fontSize: 14.5,
                        lineHeight: 1.45,
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

            <div style={{ display: "flex", gap: 10 }}>
              <input
                type="text"
                value={text}
                maxLength={2000}
                placeholder="Answer the buyer's product question…"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") send();
                }}
                style={{
                  flex: 1,
                  border: "1.5px solid #d1d5db",
                  borderRadius: 10,
                  padding: "11px 13px",
                  fontSize: 15,
                  outline: "none",
                }}
              />
              <button
                onClick={send}
                disabled={sending || !text.trim()}
                style={{
                  background: sending
                    ? "#ccc"
                    : "linear-gradient(135deg,#ff6b00,#ff1493)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "11px 18px",
                  fontWeight: "bold",
                  cursor: sending ? "wait" : "pointer",
                }}
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ProductChat;
