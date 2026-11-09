import React, { useEffect, useState } from "react";
import "../index.css";

import { API_URL } from "../api.js";

function SellerKYC({ seller, onBack }) {
  const STORAGE_KEY = "justbrand_seller_kyc";

  const [form, setForm] = useState({
    sellerName: "",
    shopName: "",
    mobile: "",
    email: "",

    panNumber: "",
    aadhaarNumber: "",
    gstNumber: "",

    accountHolder: "",
    bankName: "",
    accountNumber: "",
    ifsc: "",

    businessAddress: "",
    city: "",
    state: "",
    pincode: "",
  });

  const [panFile, setPanFile] = useState("");
  const [aadhaarFile, setAadhaarFile] =
    useState("");
  const [gstFile, setGstFile] =
    useState("");

  const [kycStatus, setKycStatus] =
    useState("Pending");

  const [saved, setSaved] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const [taxProfile, setTaxProfile] =
    useState(null);

  const [gstInput, setGstInput] =
    useState("");

  const [taxBusy, setTaxBusy] =
    useState(false);

  const [taxMessage, setTaxMessage] =
    useState("");

  // Authoritative KYC + tax statuses come from the backend, not the
  // local cache. PAN/GST are separate statuses and nothing is verified
  // unless an admin marked it so.
  useEffect(() => {
    const token = localStorage.getItem("justbrand_seller_token") || "";
    if (!token) return;

    fetch(`${API_URL}/api/sellers/tax-profile`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.success) {
          setTaxProfile(data.taxProfile || null);
          if (data.kycStatus) setKycStatus(data.kycStatus);
        }
      })
      .catch((error) => console.error("Tax profile load error:", error));

    fetch(`${API_URL}/api/sellers/kyc`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((response) => response.json())
      .then((data) => {
        if (data?.success && data.kyc?.kycStatus) {
          setKycStatus(data.kyc.kycStatus);
        }
      })
      .catch((error) => console.error("KYC status load error:", error));
  }, []);

  async function handleAddGst(e) {
    e.preventDefault();
    const token = localStorage.getItem("justbrand_seller_token") || "";
    const gstin = gstInput.trim().toUpperCase();

    if (!gstin) {
      setTaxMessage("Enter your 15-character GSTIN first.");
      return;
    }

    setTaxBusy(true);
    setTaxMessage("");

    try {
      const response = await fetch(`${API_URL}/api/sellers/gst`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ gstin }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setTaxMessage(data.message || "GSTIN submission failed.");
        return;
      }

      setTaxProfile(data.taxProfile || null);
      setGstInput("");
      setTaxMessage(
        "GSTIN submitted. It stays GST Verification Pending until admin approval. No GST is charged before approval."
      );
    } catch (error) {
      console.error("GST submit error:", error);
      setTaxMessage("Could not reach the backend. Please try again.");
    } finally {
      setTaxBusy(false);
    }
  }

  // ==========================================
  // LOAD KYC DATA
  // ==========================================

  useEffect(() => {
    try {
      const savedData =
        localStorage.getItem(
          STORAGE_KEY
        );

      if (savedData) {
        const data =
          JSON.parse(savedData);

        setForm({
          sellerName:
            data.sellerName || "",
          shopName:
            data.shopName || "",
          mobile:
            data.mobile || "",
          email:
            data.email || "",

          panNumber:
            data.panNumber || "",
          aadhaarNumber:
            data.aadhaarNumber || "",
          gstNumber:
            data.gstNumber || "",

          accountHolder:
            data.accountHolder || "",
          bankName:
            data.bankName || "",
          accountNumber:
            data.accountNumber || "",
          ifsc:
            data.ifsc || "",

          businessAddress:
            data.businessAddress || "",
          city:
            data.city || "",
          state:
            data.state || "",
          pincode:
            data.pincode || "",
        });

        setPanFile(
          data.panFile || ""
        );

        setAadhaarFile(
          data.aadhaarFile || ""
        );

        setGstFile(
          data.gstFile || ""
        );

        setKycStatus(
          data.kycStatus ||
            "Pending"
        );
      } else {
        setForm((prev) => ({
          ...prev,

          sellerName:
            seller?.sellerName ||
            seller?.name ||
            "",

          shopName:
            seller?.shopName ||
            "",

          mobile:
            seller?.mobile ||
            seller?.phone ||
            "",

          email:
            seller?.email ||
            "",
        }));
      }
    } catch (error) {
      console.log(
        "KYC loading error:",
        error
      );
    }
  }, [seller]);

  // ==========================================
  // INPUT CHANGE
  // ==========================================

  function handleChange(e) {
    const {
      name,
      value,
    } = e.target;

    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));

    setSaved(false);
    setMessage("");
  }

  // ==========================================
  // FILE CHANGE
  // ==========================================

  function handleFileChange(
    e,
    type
  ) {
    const file =
      e.target.files?.[0];

    if (!file) return;

    if (type === "pan") {
      setPanFile(file.name);
    }

    if (type === "aadhaar") {
      setAadhaarFile(file.name);
    }

    if (type === "gst") {
      setGstFile(file.name);
    }

    setSaved(false);
    setMessage("");
  }

  // ==========================================
  // SAVE KYC
  // ==========================================

  function saveKYCData(status) {
    const data = {
      ...form,

      panFile,
      aadhaarFile,
      gstFile,

      kycStatus: status,

      updatedAt:
        new Date().toISOString(),
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(data)
    );

    setKycStatus(status);

    // ========================================
    // SYNC TO BACKEND (real KYC + bank records)
    // ========================================
    // The local copy above remains as an offline cache so the
    // form keeps working if the backend is unreachable; the
    // authoritative record lives in the JustBrand database.

    const token =
      localStorage.getItem("justbrand_seller_token") || "";

    if (token) {
      const kycPayload = {
        shopName: form.shopName,
        address: form.businessAddress,
        city: form.city,
        state: form.state,
        pincode: form.pincode,
        gstNumber: form.gstNumber,
        panNumber: form.panNumber,
        aadhaarNumber: form.aadhaarNumber,
      };

      const bankPayload = {
        accountName: form.accountHolder,
        accountNumber: form.accountNumber,
        ifscCode: form.ifsc,
        bankName: form.bankName,
      };

      const syncStatus =
        status === "Under Review" ? "Pending" : undefined;

      fetch(`${API_URL}/api/sellers/kyc`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(kycPayload),
      })
        .then((response) => response.json())
        .then((result) => {
          if (result?.taxProfile) {
            setTaxProfile(result.taxProfile);
          }

          if (result?.success && syncStatus) {
            // Backend stores approval state; reflect it locally.
            const backendStatus =
              result.kyc?.kycStatus || syncStatus;

            setKycStatus(backendStatus);

            localStorage.setItem(
              STORAGE_KEY,
              JSON.stringify({
                ...data,
                kycStatus: backendStatus,
              })
            );
          }
        })
        .catch((error) =>
          console.error("KYC backend sync error:", error)
        );

      fetch(`${API_URL}/api/sellers/bank`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(bankPayload),
      }).catch((error) =>
        console.error("Bank details sync error:", error)
      );
    }

    return data;
  }

  // ==========================================
  // SAVE DETAILS
  // ==========================================

  function handleSave(e) {
    e.preventDefault();

    saveKYCData(kycStatus);

    setSaved(true);

    setMessage(
      "KYC details saved successfully."
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // ==========================================
  // SUBMIT FOR VERIFICATION
  // ==========================================

  function handleSubmitVerification() {
    // Basic validation
    if (
      !form.sellerName ||
      !form.shopName ||
      !form.mobile ||
      !form.email
    ) {
      setMessage(
        "Please complete your basic seller details first."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.panNumber) {
      setMessage(
        "Please enter your PAN Number before submitting KYC."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.aadhaarNumber) {
      setMessage(
        "Please enter your Aadhaar Number before submitting KYC."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.accountHolder) {
      setMessage(
        "Please enter Bank Account Holder Name."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.bankName) {
      setMessage(
        "Please enter Bank Name."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.accountNumber) {
      setMessage(
        "Please enter Bank Account Number."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    if (!form.ifsc) {
      setMessage(
        "Please enter IFSC Code."
      );

      window.scrollTo({
        top: 0,
        behavior: "smooth",
      });

      return;
    }

    const confirmed =
      window.confirm(
        "Are you sure you want to submit your KYC for verification?"
      );

    if (!confirmed) {
      return;
    }

    saveKYCData(
      "Under Review"
    );

    setSaved(true);

    setMessage(
      "Your KYC has been submitted successfully and is now under review."
    );

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // ==========================================
  // RESET
  // ==========================================

  function handleReset() {
    const confirmed =
      window.confirm(
        "Are you sure you want to clear all KYC details?"
      );

    if (!confirmed) {
      return;
    }

    localStorage.removeItem(
      STORAGE_KEY
    );

    setForm({
      sellerName: "",
      shopName: "",
      mobile: "",
      email: "",

      panNumber: "",
      aadhaarNumber: "",
      gstNumber: "",

      accountHolder: "",
      bankName: "",
      accountNumber: "",
      ifsc: "",

      businessAddress: "",
      city: "",
      state: "",
      pincode: "",
    });

    setPanFile("");
    setAadhaarFile("");
    setGstFile("");

    setKycStatus("Pending");
    setSaved(false);

    setMessage("");
  }

  // ==========================================
  // STATUS DETAILS
  // ==========================================

  function getStatusStyle() {
    if (
      kycStatus ===
      "Approved"
    ) {
      return {
        background: "#e8f7ed",
        color: "#198754",
        border: "#b7e4c7",
        icon: "🟢",
      };
    }

    if (
      kycStatus ===
      "Rejected"
    ) {
      return {
        background: "#fff0f0",
        color: "#dc3545",
        border: "#ffcaca",
        icon: "🔴",
      };
    }

    if (
      kycStatus ===
      "Under Review"
    ) {
      return {
        background: "#eef6ff",
        color: "#0d6efd",
        border: "#cfe2ff",
        icon: "🔵",
      };
    }

    return {
      background: "#fff8e5",
      color: "#856404",
      border: "#ffe69c",
      icon: "🟡",
    };
  }

  const statusStyle =
    getStatusStyle();

  return (
    <div style={styles.page}>

      {/* ======================================
          HEADER
      ====================================== */}

      <header style={styles.header}>

        <div style={styles.headerLeft}>

          <button
            onClick={onBack}
            style={styles.backButton}
          >
            ← Back
          </button>

          <div>

            <div style={styles.logo}>
              JustBrand
            </div>

            <div
              style={
                styles.headerSubtitle
              }
            >
              Seller KYC & Account
            </div>

          </div>

        </div>

      </header>

      {/* ======================================
          CONTENT
      ====================================== */}

      <main style={styles.container}>

        {/* ====================================
            TITLE
        ==================================== */}

        <div
          style={
            styles.titleSection
          }
        >

          <div>

            <h1
              style={
                styles.pageTitle
              }
            >
              🪪 Seller KYC & Account
              Details
            </h1>

            <p
              style={
                styles.pageSubtitle
              }
            >
              Complete your KYC details
              and submit them for
              verification.
            </p>

          </div>

        </div>

        {/* ====================================
            KYC STATUS
        ==================================== */}

        <div
          style={{
            ...styles.statusBox,
            background:
              statusStyle.background,
            borderColor:
              statusStyle.border,
            color:
              statusStyle.color,
          }}
        >

          <div
            style={
              styles.statusIcon
            }
          >
            {statusStyle.icon}
          </div>

          <div
            style={
              styles.statusContent
            }
          >

            <div
              style={
                styles.statusLabel
              }
            >
              KYC VERIFICATION STATUS
            </div>

            <div
              style={
                styles.statusValue
              }
            >
              {kycStatus}
            </div>

            <div
              style={
                styles.statusDescription
              }
            >

              {kycStatus ===
                "Pending" &&
                "Complete your KYC details and submit them for verification."}

              {kycStatus ===
                "Under Review" &&
                "Your documents have been submitted. JustBrand admin is reviewing your KYC."}

              {kycStatus ===
                "Approved" &&
                "Congratulations! Your seller KYC has been approved."}

              {kycStatus ===
                "Rejected" &&
                "Your KYC was rejected. Please check your documents and submit again."}

            </div>

          </div>

        </div>

        {/* ====================================
            PAN / GST TAX STATUS (separate statuses)
        ==================================== */}

        {taxProfile && (
          <div style={styles.taxCard}>
            <div style={styles.taxHeader}>
              <div>
                <div style={styles.taxTitle}>PAN & GST Tax Status</div>
                <div style={styles.taxSub}>
                  PAN and GST are verified separately. GSTIN can be added after
                  registration, but selling requires KYC, PAN and Admin GSTIN
                  approval. GST-unregistered selling is disabled.
                </div>
              </div>
              <span
                style={{
                  ...styles.taxBadge,
                  background: taxProfile.canSell ? "#e8f7ed" : "#fff3e0",
                  color: taxProfile.canSell ? "#198754" : "#a15c00",
                }}
              >
                {taxProfile.canSell ? "Eligible to sell" : "Selling blocked"}
              </span>
            </div>

            <div style={styles.taxGrid}>
              <div style={styles.taxItem}>
                <div style={styles.taxLabel}>PAN NUMBER</div>
                <div style={styles.taxValue}>
                  {taxProfile.panNumberMasked || "Not provided"}
                </div>
                <div style={styles.taxMeta}>{taxProfile.panStatus}</div>
              </div>

              <div style={styles.taxItem}>
                <div style={styles.taxLabel}>GST STATUS</div>
                <div style={styles.taxValue}>{taxProfile.gstStatus}</div>
                <div style={styles.taxMeta}>
                  {taxProfile.gstNumberMasked
                    ? `GSTIN ${taxProfile.gstNumberMasked}`
                    : "No GSTIN on file"}
                </div>
                {taxProfile.gstStatus === "GST Rejected" &&
                taxProfile.gstRejectionReason ? (
                  <div style={{ ...styles.taxMeta, color: "#b91c1c", fontWeight: 600 }}>
                    Reason: {taxProfile.gstRejectionReason}
                  </div>
                ) : null}
              </div>

              <div style={styles.taxItem}>
                <div style={styles.taxLabel}>INVOICE TYPE</div>
                <div style={styles.taxValue}>
                  {taxProfile.invoiceType === "NON_GST_INVOICE"
                    ? "Non-GST invoice"
                    : taxProfile.invoiceType === "TAX_INVOICE"
                    ? "GST tax invoice"
                    : "Not active"}
                </div>
                <div style={styles.taxMeta}>
                  {taxProfile.canSell
                    ? "GST tax invoice enabled"
                    : "Tax invoice available only after GSTIN approval"}
                </div>
              </div>
            </div>

            {taxProfile.legacy && (
              <div style={styles.taxNotice}>
                Your seller profile predates PAN/GST capture. Existing orders
                and invoices are unchanged, but new product listing and selling
                stay blocked until PAN and GSTIN are added and approved.
              </div>
            )}

            {!taxProfile.canSell &&
              Array.isArray(taxProfile.blockers) &&
              taxProfile.blockers.length > 0 && (
                <div style={styles.taxNotice}>
                  <b>Pending before selling:</b>
                  <ul style={{ margin: "6px 0 0", paddingLeft: "18px" }}>
                    {taxProfile.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </div>
              )}

            {taxProfile.gstStatus !== "GST Registered" &&
              taxProfile.gstStatus !== "GST Verification Pending" && (
                <form onSubmit={handleAddGst} style={styles.gstForm}>
                  <div>
                    <label style={styles.label}>Add GST Number</label>
                    <input
                      type="text"
                      value={gstInput}
                      onChange={(e) => setGstInput(e.target.value.toUpperCase())}
                      placeholder="22AAAAA0000A1Z5"
                      maxLength={15}
                      style={styles.input}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={taxBusy}
                    style={{
                      ...styles.submitButton,
                      opacity: taxBusy ? 0.7 : 1,
                      alignSelf: "flex-end",
                    }}
                  >
                    {taxBusy ? "Submitting..." : "Submit GSTIN"}
                  </button>
                </form>
              )}

            {taxProfile.gstStatus === "GST Verification Pending" && (
              <div style={styles.taxNotice}>
                GSTIN is pending Admin approval. Product listing and selling
                remain blocked until it is approved and products are re-approved.
              </div>
            )}

            {taxProfile.gstApprovedAt && (
              <div style={styles.taxMeta}>
                GST approved on {new Date(taxProfile.gstApprovedAt).toLocaleString()}
              </div>
            )}

            {taxMessage && <div style={styles.messageBox}>ℹ️ {taxMessage}</div>}
          </div>
        )}

        {/* ====================================
            MESSAGE
        ==================================== */}

        {message && (
          <div
            style={
              styles.messageBox
            }
          >
            ℹ️ {message}
          </div>
        )}

        {/* ====================================
            SUCCESS
        ==================================== */}

        {saved && (
          <div
            style={
              styles.successBox
            }
          >
            ✓ Details saved successfully.
          </div>
        )}

        <form
          onSubmit={handleSave}
        >

          {/* ==================================
              BASIC DETAILS
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="👤"
              title="Basic Seller Details"
              subtitle="These details came from Seller Registration"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <Input
                label="Seller Name"
                name="sellerName"
                value={
                  form.sellerName
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="Shop / Business Name"
                name="shopName"
                value={
                  form.shopName
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="Mobile Number"
                name="mobile"
                value={
                  form.mobile
                }
                onChange={
                  handleChange
                }
                required
                type="tel"
              />

              <Input
                label="Email Address"
                name="email"
                value={
                  form.email
                }
                onChange={
                  handleChange
                }
                type="email"
              />

            </div>

          </section>

          {/* ==================================
              PAN
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="🪪"
              title="PAN Card Details"
              subtitle="Enter your PAN information"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <Input
                label="PAN Number"
                name="panNumber"
                value={
                  form.panNumber
                }
                onChange={
                  handleChange
                }
                placeholder="ABCDE1234F"
                required
                maxLength={10}
              />

              <FileInput
                label="Upload PAN Card"
                fileName={
                  panFile
                }
                onChange={(e) =>
                  handleFileChange(
                    e,
                    "pan"
                  )
                }
              />

            </div>

          </section>

          {/* ==================================
              AADHAAR
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="🆔"
              title="Aadhaar Card Details"
              subtitle="Enter your Aadhaar information"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <Input
                label="Aadhaar Number"
                name="aadhaarNumber"
                value={
                  form.aadhaarNumber
                }
                onChange={
                  handleChange
                }
                placeholder="XXXX XXXX XXXX"
                maxLength={12}
                type="tel"
                required
              />

              <FileInput
                label="Upload Aadhaar Card"
                fileName={
                  aadhaarFile
                }
                onChange={(e) =>
                  handleFileChange(
                    e,
                    "aadhaar"
                  )
                }
              />

            </div>

          </section>

          {/* ==================================
              GST
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="📄"
              title="GST Certificate"
              subtitle="GST details for your business"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <Input
                label="GST Number"
                name="gstNumber"
                value={
                  form.gstNumber
                }
                onChange={
                  handleChange
                }
                placeholder="22AAAAA0000A1Z5"
                maxLength={15}
              />

              <FileInput
                label="Upload GST Certificate"
                fileName={
                  gstFile
                }
                onChange={(e) =>
                  handleFileChange(
                    e,
                    "gst"
                  )
                }
              />

            </div>

          </section>

          {/* ==================================
              BANK
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="🏦"
              title="Bank Account Details"
              subtitle="Seller payment account"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <Input
                label="Account Holder Name"
                name="accountHolder"
                value={
                  form.accountHolder
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="Bank Name"
                name="bankName"
                value={
                  form.bankName
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="Account Number"
                name="accountNumber"
                value={
                  form.accountNumber
                }
                onChange={
                  handleChange
                }
                required
                type="password"
              />

              <Input
                label="IFSC Code"
                name="ifsc"
                value={
                  form.ifsc
                }
                onChange={
                  handleChange
                }
                placeholder="SBIN0001234"
                required
              />

            </div>

          </section>

          {/* ==================================
              ADDRESS
          ================================== */}

          <section
            style={
              styles.card
            }
          >

            <SectionTitle
              icon="📍"
              title="Business Address"
              subtitle="Your registered business address"
            />

            <div
              style={
                styles.formGrid
              }
            >

              <div
                style={
                  styles.fullWidth
                }
              >

                <label
                  style={
                    styles.label
                  }
                >
                  Business Address
                  <span
                    style={
                      styles.required
                    }
                  >
                    *
                  </span>
                </label>

                <textarea
                  name="businessAddress"
                  value={
                    form.businessAddress
                  }
                  onChange={
                    handleChange
                  }
                  required
                  rows={4}
                  placeholder="Enter complete business address"
                  style={
                    styles.textarea
                  }
                />

              </div>

              <Input
                label="City"
                name="city"
                value={
                  form.city
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="State"
                name="state"
                value={
                  form.state
                }
                onChange={
                  handleChange
                }
                required
              />

              <Input
                label="PIN Code"
                name="pincode"
                value={
                  form.pincode
                }
                onChange={
                  handleChange
                }
                required
                type="tel"
                maxLength={6}
              />

            </div>

          </section>

          {/* ==================================
              ACTION BUTTONS
          ================================== */}

          <div
            style={
              styles.actionBar
            }
          >

            <button
              type="button"
              onClick={onBack}
              style={
                styles.cancelButton
              }
              className="jb-touch-btn"
            >
              ← Back
            </button>

            <button
              type="button"
              onClick={
                handleReset
              }
              style={
                styles.resetButton
              }
              className="jb-touch-btn"
            >
              Reset
            </button>

            <button
              type="submit"
              style={
                styles.saveButton
              }
              className="jb-touch-btn"
            >
              💾 Save KYC Details
            </button>

            {/* SUBMIT BUTTON */}

            {kycStatus !==
              "Approved" && (
              <button
                type="button"
                onClick={
                  handleSubmitVerification
                }
                disabled={
                  kycStatus ===
                  "Under Review"
                }
                style={{
                  ...styles.submitButton,

                  opacity:
                    kycStatus ===
                    "Under Review"
                      ? 0.6
                      : 1,

                  cursor:
                    kycStatus ===
                    "Under Review"
                      ? "not-allowed"
                      : "pointer",
                }}
                className="jb-touch-btn"
              >
                {kycStatus ===
                "Under Review"
                  ? "🔵 Under Review"
                  : kycStatus ===
                    "Rejected"
                  ? "🔄 Submit Again"
                  : "📤 Submit for Verification"}
              </button>
            )}

          </div>

        </form>

      </main>

    </div>
  );
}


/* ==========================================
   SECTION TITLE
========================================== */

function SectionTitle({
  icon,
  title,
  subtitle,
}) {
  return (
    <div
      style={
        styles.sectionTitle
      }
    >

      <div
        style={
          styles.sectionIcon
        }
      >
        {icon}
      </div>

      <div>

        <h2
          style={
            styles.sectionHeading
          }
        >
          {title}
        </h2>

        <p
          style={
            styles.sectionSubtitle
          }
        >
          {subtitle}
        </p>

      </div>

    </div>
  );
}


/* ==========================================
   INPUT
========================================== */

function Input({
  label,
  name,
  value,
  onChange,
  required = false,
  placeholder = "",
  type = "text",
  maxLength,
}) {
  return (
    <div>

      <label
        style={
          styles.label
        }
      >
        {label}

        {required && (
          <span
            style={
              styles.required
            }
          >
            *
          </span>
        )}

      </label>

      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        maxLength={maxLength}
        style={
          styles.input
        }
      />

    </div>
  );
}


/* ==========================================
   FILE INPUT
========================================== */

function FileInput({
  label,
  fileName,
  onChange,
}) {
  return (
    <div>

      <label
        style={
          styles.label
        }
      >
        {label}
      </label>

      <label
        style={
          styles.fileBox
        }
      >

        <span
          style={{
            fontSize: "20px",
          }}
        >
          📎
        </span>

        <span
          style={
            styles.fileText
          }
        >
          {fileName ||
            "Choose document"}
        </span>

        <input
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          onChange={onChange}
          style={{
            display: "none",
          }}
        />

      </label>

      <div
        style={
          styles.fileHint
        }
      >
        JPG, PNG or PDF
      </div>

    </div>
  );
}


/* ==========================================
   STYLES
========================================== */

const styles = {

  page: {
    minHeight: "100vh",
    background: "#f5f6f8",
    color: "#222",
  },

  header: {
    minHeight: "70px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    padding:
      "12px 25px",
    boxSizing:
      "border-box",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
  },

  backButton: {
    border:
      "1px solid rgba(255,255,255,0.5)",
    background:
      "rgba(255,255,255,0.15)",
    color: "#fff",
    padding:
      "9px 14px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  logo: {
    fontSize: "24px",
    fontWeight: "bold",
  },

  headerSubtitle: {
    fontSize: "12px",
    opacity: 0.9,
  },

  container: {
    width: "100%",
    maxWidth: "1050px",
    margin: "0 auto",
    padding:
      "25px 18px 50px",
    boxSizing:
      "border-box",
  },

  titleSection: {
    display: "flex",
    justifyContent:
      "space-between",
    alignItems: "center",
    gap: "15px",
    flexWrap: "wrap",
    marginBottom: "20px",
  },

  pageTitle: {
    margin: 0,
    fontSize: "25px",
  },

  pageSubtitle: {
    margin:
      "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  /* STATUS */

  statusBox: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
    border: "1px solid",
    borderRadius: "12px",
    padding: "16px",
    marginBottom: "18px",
  },

  statusIcon: {
    fontSize: "30px",
  },

  statusContent: {
    flex: 1,
  },

  statusLabel: {
    fontSize: "10px",
    fontWeight: "bold",
    letterSpacing: "0.7px",
    opacity: 0.8,
  },

  statusValue: {
    fontSize: "20px",
    fontWeight: "bold",
    marginTop: "3px",
  },

  statusDescription: {
    fontSize: "12px",
    marginTop: "3px",
    opacity: 0.9,
  },

  taxCard: {
    background: "#fff",
    border: "1px solid #eee",
    borderRadius: "14px",
    padding: "18px",
    marginBottom: "18px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },

  taxHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "12px",
    flexWrap: "wrap",
  },

  taxTitle: {
    fontSize: "17px",
    fontWeight: "bold",
  },

  taxSub: {
    color: "#888",
    fontSize: "12px",
    marginTop: "3px",
  },

  taxBadge: {
    borderRadius: "999px",
    padding: "5px 10px",
    fontSize: "11px",
    fontWeight: "bold",
  },

  taxGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))",
    gap: "12px",
    marginTop: "16px",
  },

  taxItem: {
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "12px",
  },

  taxLabel: {
    color: "#999",
    fontSize: "10px",
    fontWeight: "bold",
    letterSpacing: "0.6px",
  },

  taxValue: {
    fontSize: "15px",
    fontWeight: "bold",
    marginTop: "4px",
  },

  taxMeta: {
    color: "#777",
    fontSize: "11px",
    marginTop: "4px",
  },

  taxNotice: {
    background: "#fff8e8",
    border: "1px solid #f3dfb0",
    color: "#7a5a10",
    borderRadius: "8px",
    padding: "10px 12px",
    marginTop: "12px",
    fontSize: "12px",
    lineHeight: 1.5,
  },

  gstForm: {
    display: "grid",
    gridTemplateColumns: "minmax(180px,1fr) auto",
    gap: "10px",
    alignItems: "end",
    marginTop: "14px",
  },

  messageBox: {
    background: "#eef6ff",
    color: "#075ca8",
    border:
      "1px solid #cfe2ff",
    padding: "12px",
    borderRadius: "9px",
    marginBottom: "15px",
    fontSize: "13px",
  },

  successBox: {
    background: "#eaf8ef",
    color: "#198754",
    border:
      "1px solid #b7e4c7",
    padding: "12px",
    borderRadius: "9px",
    marginBottom: "15px",
    fontSize: "13px",
  },

  card: {
    background: "#fff",
    borderRadius: "14px",
    padding: "22px",
    marginBottom: "18px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
    border:
      "1px solid #eee",
  },

  sectionTitle: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "20px",
  },

  sectionIcon: {
    width: "45px",
    height: "45px",
    borderRadius: "10px",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
    flexShrink: 0,
  },

  sectionHeading: {
    margin: 0,
    fontSize: "18px",
  },

  sectionSubtitle: {
    margin:
      "4px 0 0",
    color: "#888",
    fontSize: "12px",
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(250px,1fr))",
    gap: "17px",
  },

  fullWidth: {
    gridColumn:
      "1 / -1",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontSize: "13px",
    fontWeight: "600",
    color: "#444",
  },

  required: {
    color: "#e53935",
    marginLeft: "3px",
  },

  input: {
    width: "100%",
    padding:
      "12px 13px",
    border:
      "1px solid #d8d8d8",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
    boxSizing:
      "border-box",
    background: "#fff",
  },

  textarea: {
    width: "100%",
    padding:
      "12px 13px",
    border:
      "1px solid #d8d8d8",
    borderRadius: "8px",
    outline: "none",
    fontSize: "14px",
    resize: "vertical",
    boxSizing:
      "border-box",
    fontFamily: "inherit",
  },

  fileBox: {
    minHeight: "45px",
    border:
      "1px dashed #ccc",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    gap: "9px",
    padding:
      "0 12px",
    cursor: "pointer",
    background: "#fafafa",
    boxSizing:
      "border-box",
  },

  fileText: {
    fontSize: "13px",
    color: "#666",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  fileHint: {
    marginTop: "5px",
    color: "#999",
    fontSize: "10px",
  },

  actionBar: {
    display: "flex",
    justifyContent:
      "flex-end",
    gap: "10px",
    flexWrap: "wrap",
    marginTop: "5px",
  },

  actionButton: {
    flex: "1 1 150px",
    minWidth: "140px",
  },

  cancelButton: {
    padding:
      "11px 18px",
    border:
      "1px solid #ccc",
    background: "#fff",
    color: "#555",
    borderRadius: "8px",
    cursor: "pointer",
  },

  resetButton: {
    padding:
      "11px 18px",
    border:
      "1px solid #f0b4b4",
    background: "#fff5f5",
    color: "#d33",
    borderRadius: "8px",
    cursor: "pointer",
  },

  saveButton: {
    padding:
      "11px 20px",
    border: "none",
    background: "#555",
    color: "#fff",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  submitButton: {
    padding:
      "11px 20px",
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    borderRadius: "8px",
    fontWeight: "bold",
  },
};

export default SellerKYC;