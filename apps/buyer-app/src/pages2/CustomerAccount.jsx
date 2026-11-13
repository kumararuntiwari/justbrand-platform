import React, { useEffect, useState } from "react";
import { api, getCustomerToken } from "../api";

function CustomerAccount({
  customer,
  onBack,
  onOrders,
  onWishlist,
  onLogout,
  onProfileUpdated,
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(customer?.name || "");
  const [email, setEmail] = useState(customer?.email || "");
  const [address, setAddress] = useState(customer?.address || "");
  const [city, setCity] = useState(customer?.city || "");
  const [stateName, setStateName] = useState(customer?.state || "");
  const [pincode, setPincode] = useState(customer?.pincode || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [addresses, setAddresses] = useState([]);
  const [addressFormOpen, setAddressFormOpen] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState(null);
  const [addressSaving, setAddressSaving] = useState(false);
  const [addressMessage, setAddressMessage] = useState("");
  const [addressDraft, setAddressDraft] = useState({
    label: "Home",
    recipientName: customer?.name || "",
    mobile: customer?.mobile || "",
    address: "",
    city: "",
    state: "",
    pincode: "",
  });

  async function loadAddresses() {
    try {
      const data = await api("/api/customers/addresses", {
        token: getCustomerToken(),
      });
      if (data?.success) setAddresses(data.addresses || []);
    } catch (error) {
      setAddressMessage(error.message || "Could not load saved addresses.");
    }
  }

  useEffect(() => {
    loadAddresses();
  }, []);

  if (!customer) {
    return null;
  }

  function startAddressForm(item = null) {
    setEditingAddressId(item?.id ?? null);
    setAddressDraft(item ? {
      label: item.label || "Home",
      recipientName: item.recipientName || customer?.name || "",
      mobile: item.mobile || customer?.mobile || "",
      address: item.address || "",
      city: item.city || "",
      state: item.state || "",
      pincode: item.pincode || "",
    } : {
      label: "Home",
      recipientName: customer?.name || "",
      mobile: customer?.mobile || "",
      address: "",
      city: "",
      state: "",
      pincode: "",
    });
    setAddressMessage("");
    setAddressFormOpen(true);
  }

  async function saveAddress() {
    setAddressMessage("");
    if (!addressDraft.recipientName.trim() || !addressDraft.address.trim() ||
        !addressDraft.city.trim() || !addressDraft.state.trim() ||
        !/^\\d{6}$/.test(addressDraft.pincode.trim())) {
      setAddressMessage("Name, full address, city, state and 6-digit PIN are required.");
      return;
    }
    setAddressSaving(true);
    try {
      const data = await api(editingAddressId
        ? `/api/customers/addresses/${editingAddressId}`
        : "/api/customers/addresses", {
        method: editingAddressId ? "PUT" : "POST",
        token: getCustomerToken(),
        body: addressDraft,
      });
      if (!data?.success) throw new Error(data?.message || "Could not save address.");
      setAddressFormOpen(false);
      await loadAddresses();
      setAddressMessage("Address saved successfully.");
    } catch (error) {
      setAddressMessage(error.message || "Could not save address.");
    } finally {
      setAddressSaving(false);
    }
  }

  async function makeDefaultAddress(id) {
    try {
      const data = await api(`/api/customers/addresses/${id}/default`, {
        method: "PUT",
        token: getCustomerToken(),
      });
      if (!data?.success) throw new Error(data?.message || "Could not set default address.");
      await loadAddresses();
      if (onProfileUpdated) {
        const profile = await api("/api/customers/me", { token: getCustomerToken() });
        if (profile?.success && profile.customer) onProfileUpdated(profile.customer);
      }
    } catch (error) {
      setAddressMessage(error.message || "Could not set default address.");
    }
  }

  async function deleteAddress(id) {
    if (!window.confirm("Delete this saved address?")) return;
    try {
      const data = await api(`/api/customers/addresses/${id}`, {
        method: "DELETE",
        token: getCustomerToken(),
      });
      if (!data?.success) throw new Error(data?.message || "Could not delete address.");
      await loadAddresses();
      const profile = await api("/api/customers/me", { token: getCustomerToken() });
      if (profile?.success && profile.customer && onProfileUpdated) onProfileUpdated(profile.customer);
    } catch (error) {
      setAddressMessage(error.message || "Could not delete address.");
    }
  }

  async function handleSaveProfile() {
    setMessage("");

    if (!name.trim()) {
      setMessage("Name cannot be empty.");
      return;
    }

    if (pincode && !/^\d{6}$/.test(pincode.trim())) {
      setMessage("PIN code must be exactly 6 digits.");
      return;
    }

    setSaving(true);

    try {
      const token = getCustomerToken();

      const data = await api("/api/customers/me", {
        method: "PUT",
        token,
        body: {
          name: name.trim(),
          email: email.trim(),
          address: address.trim(),
          city: city.trim(),
          state: stateName.trim(),
          pincode: pincode.trim(),
        },
      });

      if (data?.success && data?.customer) {
        setMessage("Profile updated.");
        setEditing(false);

        if (onProfileUpdated) {
          onProfileUpdated(data.customer);
        }
      } else {
        setMessage(data?.message || "Failed to update profile.");
      }
    } catch (error) {
      setMessage(error.message || "Could not update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="jb-page" style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.headerText}>My Account</div>
        </div>

        <button type="button" onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      <main style={styles.container}>
        <div style={styles.card}>
          <div style={styles.iconCircle}>👤</div>

          <h1 style={styles.title}>{customer.name}</h1>

          <p style={styles.subtitle}>
            📱 {customer.mobile}
            {customer.email ? ` · ${customer.email}` : ""}
          </p>

          {customer.referredByMemberId && (
            <div style={styles.refBox}>
              🎁 Referred by member: {customer.referredByMemberId}
            </div>
          )}

          {/* PROFILE / DEFAULT ADDRESS */}
          {editing ? (
            <div style={styles.editBox}>
              <label style={styles.editLabel}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={styles.editInput}
              />

              <label style={styles.editLabel}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={styles.editInput}
              />

              <label style={styles.editLabel}>Default Address</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="House no, street, area"
                style={styles.editInput}
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  gap: "8px",
                }}
              >
                <div>
                  <label style={styles.editLabel}>City</label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    style={styles.editInput}
                  />
                </div>

                <div>
                  <label style={styles.editLabel}>State</label>
                  <input
                    type="text"
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    style={styles.editInput}
                  />
                </div>

                <div>
                  <label style={styles.editLabel}>PIN</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={pincode}
                    onChange={(e) =>
                      setPincode(e.target.value.replace(/\D/g, ""))
                    }
                    maxLength="6"
                    style={styles.editInput}
                  />
                </div>
              </div>

              {message && (
                <p style={{ color: "#28a745", fontSize: 14 }}>{message}</p>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={saving}
                  style={styles.saveButton}
                >
                  {saving ? "Saving..." : "💾 Save"}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setMessage("");
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={styles.editBox}>
              <div style={styles.addressLine}>
                {customer.address
                  ? `${customer.address}${customer.city ? `, ${customer.city}` : ""}${customer.state ? `, ${customer.state}` : ""}${customer.pincode ? ` - ${customer.pincode}` : ""}`
                  : "📍 No default address saved yet."}
              </div>

              {message && (
                <p style={{ color: "#28a745", fontSize: 14 }}>{message}</p>
              )}

              <button
                type="button"
                onClick={() => setEditing(true)}
                style={styles.editButton}
              >
                ✏️ Edit Profile & Address
              </button>
            </div>
          )}

          {/* SAVED DELIVERY ADDRESSES */}
          <section style={{ ...styles.editBox, marginTop: 16 }}>
            <h2 style={{ margin: "0 0 10px", fontSize: 18 }}>📍 My Delivery Addresses</h2>
            <p style={{ margin: "0 0 12px", color: "#666", fontSize: 13 }}>Save up to 10 addresses and choose one as your default checkout address.</p>
            {addresses.map((item) => (
              <div key={item.id} style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <strong>{item.label} {item.isDefault ? "· Default" : ""}</strong>
                  <span style={{ fontSize: 12, color: "#666" }}>{item.recipientName} · {item.mobile}</span>
                </div>
                <div style={{ fontSize: 14, margin: "7px 0" }}>{item.address}, {item.city}, {item.state} - {item.pincode}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {!item.isDefault && <button type="button" onClick={() => makeDefaultAddress(item.id)} style={styles.editButton}>Make Default</button>}
                  <button type="button" onClick={() => startAddressForm(item)} style={styles.editButton}>Edit</button>
                  <button type="button" onClick={() => deleteAddress(item.id)} style={styles.cancelButton}>Delete</button>
                </div>
              </div>
            ))}
            {addressFormOpen ? (
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  ["label", "Address label (Home / Work)"],
                  ["recipientName", "Receiver name"],
                  ["mobile", "Mobile number"],
                  ["address", "House no, street, area, landmark"],
                  ["city", "City"],
                  ["state", "State"],
                  ["pincode", "6-digit PIN code"],
                ].map(([key, placeholder]) => (
                  <input key={key} value={addressDraft[key]} placeholder={placeholder}
                    inputMode={key === "mobile" || key === "pincode" ? "numeric" : undefined}
                    maxLength={key === "pincode" ? 6 : key === "mobile" ? 10 : undefined}
                    onChange={(e) => setAddressDraft((old) => ({ ...old, [key]: key === "pincode" || key === "mobile" ? e.target.value.replace(/\\D/g, "") : e.target.value }))}
                    style={styles.editInput} />
                ))}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" disabled={addressSaving} onClick={saveAddress} style={styles.saveButton}>{addressSaving ? "Saving..." : "Save Address"}</button>
                  <button type="button" onClick={() => setAddressFormOpen(false)} style={styles.cancelButton}>Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={addresses.length >= 10} onClick={() => startAddressForm()} style={styles.saveButton}>＋ Add New Address</button>
            )}
            {addressMessage && <p style={{ color: "#b45309", fontSize: 13 }}>{addressMessage}</p>}
          </section>

          <div style={styles.menuBox}>
            <button type="button" onClick={onOrders} style={styles.menuButton}>
              📦 My Orders
              <span style={styles.menuArrow}>›</span>
            </button>

            <button
              type="button"
              onClick={onWishlist}
              style={styles.menuButton}
            >
              ❤️ My Wishlist
              <span style={styles.menuArrow}>›</span>
            </button>
          </div>

          <button type="button" onClick={onLogout} style={styles.logoutButton}>
            🚪 Logout
          </button>

          <div style={styles.infoBox}>
            <div style={styles.infoText}>
              🔒 Your personal data is stored securely on our servers and is
              never shared with sellers beyond what is required to fulfil your
              order.
            </div>
          </div>
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
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "30px 20px",
    boxSizing: "border-box",
  },

  card: {
    width: "100%",
    maxWidth: "430px",
    background: "#fff",
    borderRadius: "16px",
    padding: "30px",
    boxShadow: "0 5px 25px rgba(0,0,0,0.09)",
    boxSizing: "border-box",
    textAlign: "center",
  },

  iconCircle: {
    width: "65px",
    height: "65px",
    margin: "0 auto 12px",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "30px",
  },

  title: {
    margin: 0,
    fontSize: "24px",
  },

  subtitle: {
    margin: "6px 0 15px",
    color: "#777",
    fontSize: "14px",
  },

  refBox: {
    padding: "10px",
    background: "#fff7e6",
    borderRadius: "8px",
    fontSize: "13px",
    color: "#a06a00",
    marginBottom: "15px",
  },

  menuBox: {
    borderTop: "1px solid #eee",
    borderBottom: "1px solid #eee",
    margin: "15px 0",
  },

  menuButton: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "15px 5px",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #f5f5f5",
    fontSize: "15px",
    color: "#333",
    cursor: "pointer",
  },

  menuArrow: {
    color: "#bbb",
    fontSize: "18px",
  },

  logoutButton: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ffb3b3",
    background: "#fff5f5",
    color: "#c00",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
    marginBottom: "15px",
  },

  infoBox: {
    padding: "12px",
    background: "#eef7ff",
    borderRadius: "8px",
  },

  infoText: {
    fontSize: "12px",
    color: "#666",
    lineHeight: 1.5,
  },

  editBox: {
    width: "100%",
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "15px",
    margin: "15px 0",
    boxSizing: "border-box",
    textAlign: "left",
  },

  editLabel: {
    display: "block",
    fontSize: "12px",
    fontWeight: "bold",
    color: "#555",
    margin: "8px 0 4px",
  },

  editInput: {
    width: "100%",
    padding: "10px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  },

  addressLine: {
    fontSize: "14px",
    color: "#444",
    lineHeight: 1.5,
  },

  editButton: {
    width: "100%",
    marginTop: "10px",
    padding: "10px",
    background: "#fff",
    border: "1px solid #ff6b00",
    color: "#ff6b00",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  },

  saveButton: {
    flex: 1,
    padding: "10px",
    background: "#ff6b00",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "14px",
  },

  cancelButton: {
    flex: 1,
    padding: "10px",
    background: "#fff",
    border: "1px solid #ccc",
    color: "#555",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "14px",
  },
};

export default CustomerAccount;
