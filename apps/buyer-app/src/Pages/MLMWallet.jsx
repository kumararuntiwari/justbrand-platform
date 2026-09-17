import React, { useEffect, useState } from "react";
import {
  api,
  getMlmToken,
} from "../api";

function MLMWallet({ member, onBack }) {
  const [wallet, setWallet] = useState({
    available: 0,
    pending: 0,
    totalEarned: 0,
    withdrawn: 0,
  });

  const [transactions, setTransactions] = useState([]);

  const [withdrawAmount, setWithdrawAmount] =
    useState("");

  const [withdrawMethod, setWithdrawMethod] =
    useState("Bank Account");

  const [showWithdraw, setShowWithdraw] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  // ==========================================
  // LOAD WALLET
  // ==========================================

  useEffect(() => {
    loadWallet();
  }, []);

  async function loadWallet() {
    const token = getMlmToken();

    if (!token) {
      return;
    }

    try {
      const data = await api("/api/mlm/me", { token });

      const backendWallet = data?.wallet || {};

      const nextWallet = {
        available:
          Number(backendWallet.balance) || 0,

        pending:
          Number(backendWallet.pending) || 0,

        totalEarned:
          Number(backendWallet.totalEarned) || 0,

        withdrawn:
          Number(backendWallet.totalPaid) || 0,
      };

      setWallet(nextWallet);

      localStorage.setItem(
        "justbrand_mlm_wallet",
        JSON.stringify(nextWallet)
      );

      const commissionsResponse = await api("/api/mlm/commissions", {
        token,
      });

      const records = Array.isArray(commissionsResponse?.commissions)
        ? commissionsResponse.commissions
        : [];

      const mapped = records.map((record) => ({
        id: record.id,
        type: record.description || record.type || "Commission",
        amount: Number(record.amount) || 0,
        status: record.status || "Pending",
        date: record.createdAt,
        description: record.description || "",
      }));

      setTransactions(mapped);

      localStorage.setItem(
        "justbrand_mlm_transactions",
        JSON.stringify(mapped)
      );
    } catch (error) {
      console.log(
        "Wallet loading error:",
        error
      );
    }
  }

  // ==========================================
  // SAVE WALLET
  // ==========================================

  function saveWallet(newWallet) {
    setWallet(newWallet);

    localStorage.setItem(
      "justbrand_mlm_wallet",
      JSON.stringify(newWallet)
    );
  }

  // ==========================================
  // FORMAT MONEY
  // ==========================================

  function money(amount) {
    return `₹${Number(amount || 0).toLocaleString(
      "en-IN"
    )}`;
  }

  // ==========================================
  // WITHDRAW
  // ==========================================

  async function handleWithdraw() {
    const amount = Number(
      withdrawAmount
    );

    if (!amount || amount <= 0) {
      alert(
        "Please enter a valid withdrawal amount."
      );
      return;
    }

    if (amount < 100) {
      alert(
        "Minimum withdrawal amount is ₹100."
      );
      return;
    }

    if (
      amount >
      Number(wallet.available || 0)
    ) {
      alert(
        "Insufficient available wallet balance."
      );
      return;
    }

    setLoading(true);

    try {
      // Withdrawals are payout requests recorded on the backend;
      // the actual payment is processed by the accounts team and
      // the authoritative balance lives server-side.
      await api("/api/mlm/payout-request", {
        method: "POST",
        token,
        body: {
          amount,
          method: withdrawMethod,
        },
      });

      await loadWallet();
    } catch (error) {
      setLoading(false);
      setWithdrawAmount("");
      setShowWithdraw(false);

      alert(
        error?.message ||
          "Payout request failed. Please try again."
      );

      return;
    }

    setWithdrawAmount("");

    setShowWithdraw(false);

    setLoading(false);

    alert(
      `Payout request of ₹${amount.toLocaleString("en-IN")} via ${withdrawMethod} has been recorded. JustBrand accounts team will process your payout.`
    );
  }

  // ==========================================
  // MEMBER NAME
  // ==========================================

  const memberName =
    member?.name ||
    member?.memberName ||
    member?.fullName ||
    "Family Member";

  const memberId =
    member?.memberId ||
    member?.id ||
    "JB-MEMBER";

  return (
    <div className="jb-page" style={styles.page}>
      <div className="jb-family-chakra" aria-hidden="true" />

      {/* ======================================
          HEADER
      ====================================== */}

      <header style={styles.header}>

        <div style={styles.headerLeft}>

          <button
            onClick={onBack}
            style={styles.backButton}
          >
            ←
          </button>

          <div>

            <div style={styles.logo}>
              JustBrand
            </div>

            <div style={styles.headerText}>
              Family Wallet
            </div>

          </div>

        </div>

        <div style={styles.memberBox}>

          <div style={styles.avatar}>
            {memberName
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>

            <div style={styles.memberName}>
              {memberName}
            </div>

            <div style={styles.memberId}>
              ID: {memberId}
            </div>

          </div>

        </div>

      </header>

      {/* ======================================
          MAIN
      ====================================== */}

      <main style={styles.container}>

        {/* PAGE TITLE */}

        <div style={styles.titleBox}>

          <div>

            <h1 style={styles.title}>
              💰 Family Wallet
            </h1>

            <p style={styles.subtitle}>
              Manage your commission,
              earnings and withdrawals.
            </p>

          </div>

          <button
            onClick={() =>
              setShowWithdraw(true)
            }
            style={styles.withdrawTopButton}
          >
            💸 Withdraw
          </button>

        </div>

        {/* ====================================
            WALLET CARDS
        ==================================== */}

        <div style={styles.walletGrid}>

          <WalletCard
            icon="💰"
            title="Available Balance"
            amount={wallet.available}
            description="Ready to withdraw"
            main
          />

          <WalletCard
            icon="🕐"
            title="Pending Commission"
            amount={wallet.pending}
            description="Return period pending"
          />

          <WalletCard
            icon="📈"
            title="Total Earned"
            amount={wallet.totalEarned}
            description="Lifetime commission"
          />

          <WalletCard
            icon="💸"
            title="Withdrawn"
            amount={wallet.withdrawn}
            description="Total withdrawn"
          />

        </div>

        {/* ====================================
            COMMISSION RULE
        ==================================== */}

        <section style={styles.infoBox}>

          <div style={styles.infoIcon}>
            ℹ️
          </div>

          <div>

            <h3 style={styles.infoTitle}>
              Commission Release Rule
            </h3>

            <p style={styles.infoText}>
              Product order cancel होने पर
              commission calculate नहीं होगी।
              Successful order की commission
              return period पूरा होने के बाद
              Pending से Available Wallet में
              जाएगी।
            </p>

          </div>

        </section>

        {/* ====================================
            WITHDRAW SECTION
        ==================================== */}

        <section style={styles.section}>

          <div style={styles.sectionHeader}>

            <div>

              <h2 style={styles.sectionTitle}>
                💳 Withdraw Commission
              </h2>

              <p style={styles.sectionSubtitle}>
                Available balance से withdrawal
                request करें।
              </p>

            </div>

            <div style={styles.availableBadge}>
              Available:{" "}
              {money(wallet.available)}
            </div>

          </div>

          {!showWithdraw ? (
            <button
              onClick={() =>
                setShowWithdraw(true)
              }
              style={styles.withdrawButton}
            >
              💸 Request Withdrawal
            </button>
          ) : (
            <div style={styles.withdrawForm}>

              <div style={styles.field}>

                <label style={styles.label}>
                  Withdrawal Amount
                </label>

                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) =>
                    setWithdrawAmount(
                      e.target.value
                    )
                  }
                  placeholder="Enter amount"
                  style={styles.input}
                />

              </div>

              <div style={styles.field}>

                <label style={styles.label}>
                  Withdrawal Method
                </label>

                <select
                  value={withdrawMethod}
                  onChange={(e) =>
                    setWithdrawMethod(
                      e.target.value
                    )
                  }
                  style={styles.input}
                >

                  <option>
                    Bank Account
                  </option>

                  <option>
                    UPI
                  </option>

                </select>

              </div>

              <div style={styles.formButtons}>

                <button
                  type="button"
                  onClick={() =>
                    setShowWithdraw(false)
                  }
                  style={styles.cancelButton}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleWithdraw}
                  style={{
                    ...styles.submitButton,
                    opacity:
                      loading ? 0.6 : 1,
                  }}
                >
                  {loading
                    ? "Processing..."
                    : "✅ Submit Withdrawal"}
                </button>

              </div>

            </div>
          )}

        </section>

        {/* ====================================
            TRANSACTIONS
        ==================================== */}

        <section style={styles.section}>

          <div style={styles.sectionHeader}>

            <div>

              <h2 style={styles.sectionTitle}>
                📋 Wallet Transactions
              </h2>

              <p style={styles.sectionSubtitle}>
                Your commission and withdrawal
                history.
              </p>

            </div>

          </div>

          {transactions.length === 0 ? (

            <div style={styles.empty}>

              <div style={styles.emptyIcon}>
                💰
              </div>

              <h3>
                No Transactions Yet
              </h3>

              <p>
                Your Family commission
                transactions will appear here.
              </p>

            </div>

          ) : (

            <div style={styles.transactionList}>

              {transactions.map(
                (transaction) => (

                  <Transaction
                    key={
                      transaction.id
                    }
                    transaction={
                      transaction
                    }
                  />

                )
              )}

            </div>

          )}

        </section>

        {/* ====================================
            COMMISSION TYPES
        ==================================== */}

        <section style={styles.section}>

          <h2 style={styles.sectionTitle}>
            🌐 Commission Types
          </h2>

          <div style={styles.commissionGrid}>

            <CommissionBox
              icon="👤"
              title="Direct Commission"
              description="आपके द्वारा directly introduce किए गए member की eligible shopping पर commission."
            />

            <CommissionBox
              icon="👥"
              title="Team Commission"
              description="आपकी Family team की eligible shopping से applicable commission."
            />

            <CommissionBox
              icon="⏱️"
              title="Time / Level Commission"
              description="Level और configured time-based rules के अनुसार commission."
            />

            <CommissionBox
              icon="🛍️"
              title="Shopping Commission"
              description="पूरे India में eligible customer shopping से applicable Family commission."
            />

          </div>

        </section>

        {/* ====================================
            FOOTER NOTE
        ==================================== */}

        <div style={styles.footerNote}>

          🔒 Commission तभी withdraw होगी जब
          order की return/cancellation eligibility
          successfully complete हो जाए।

        </div>

      </main>

    </div>
  );
}


/* ==========================================
   WALLET CARD
========================================== */

function WalletCard({
  icon,
  title,
  amount,
  description,
  main,
}) {
  return (
    <div
      style={{
        ...styles.walletCard,
        ...(main
          ? styles.walletCardMain
          : {}),
      }}
    >

      <div style={styles.walletIcon}>
        {icon}
      </div>

      <div style={styles.walletTitle}>
        {title}
      </div>

      <div style={styles.walletAmount}>
        ₹
        {Number(
          amount || 0
        ).toLocaleString("en-IN")}
      </div>

      <div style={styles.walletDescription}>
        {description}
      </div>

    </div>
  );
}


/* ==========================================
   TRANSACTION
========================================== */

function Transaction({
  transaction,
}) {
  const isWithdrawal =
    transaction.type ===
    "Withdrawal";

  const amount =
    Number(
      transaction.amount || 0
    );

  return (
    <div style={styles.transaction}>

      <div
        style={{
          ...styles.transactionIcon,
          background:
            isWithdrawal
              ? "#fff0f0"
              : "#eefbf2",
        }}
      >
        {isWithdrawal
          ? "💸"
          : "💰"}
      </div>

      <div style={styles.transactionContent}>

        <div style={styles.transactionTitle}>
          {transaction.description ||
            transaction.type ||
            "Commission"}
        </div>

        <div style={styles.transactionDate}>
          {transaction.date
            ? new Date(
                transaction.date
              ).toLocaleString("en-IN")
            : ""}
        </div>

        <div style={styles.transactionStatus}>
          Status:{" "}
          {transaction.status ||
            "Completed"}
        </div>

      </div>

      <div
        style={{
          ...styles.transactionAmount,
          color: isWithdrawal
            ? "#dc3545"
            : "#198754",
        }}
      >
        {isWithdrawal
          ? "-"
          : "+"}
        ₹
        {amount.toLocaleString(
          "en-IN"
        )}
      </div>

    </div>
  );
}


/* ==========================================
   COMMISSION BOX
========================================== */

function CommissionBox({
  icon,
  title,
  description,
}) {
  return (
    <div style={styles.commissionBox}>

      <div style={styles.commissionIcon}>
        {icon}
      </div>

      <div style={styles.commissionTitle}>
        {title}
      </div>

      <div style={styles.commissionDescription}>
        {description}
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
    color: "#222",
  },

  header: {
    minHeight: "70px",
    padding: "12px 25px",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    boxSizing: "border-box",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  },

  backButton: {
    width: "38px",
    height: "38px",
    border: "none",
    borderRadius: "8px",
    background:
      "rgba(255,255,255,0.2)",
    color: "#fff",
    fontSize: "22px",
    cursor: "pointer",
  },

  logo: {
    fontSize: "24px",
    fontWeight: "bold",
  },

  headerText: {
    fontSize: "12px",
    opacity: 0.9,
  },

  memberBox: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
  },

  avatar: {
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    background: "#fff",
    color: "#ff1493",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
    fontSize: "18px",
  },

  memberName: {
    fontSize: "13px",
    fontWeight: "bold",
  },

  memberId: {
    fontSize: "10px",
    opacity: 0.85,
  },

  container: {
    width: "100%",
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "25px",
    boxSizing: "border-box",
  },

  titleBox: {
    background: "#fff",
    borderRadius: "14px",
    padding: "22px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
    flexWrap: "wrap",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  title: {
    margin: 0,
    fontSize: "25px",
  },

  subtitle: {
    margin: "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  withdrawTopButton: {
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "12px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  walletGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(210px,1fr))",
    gap: "15px",
    marginTop: "20px",
  },

  walletCard: {
    background: "#fff",
    borderRadius: "13px",
    padding: "20px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
    border: "1px solid #eee",
  },

  walletCardMain: {
    border:
      "2px solid #ff6b00",
  },

  walletIcon: {
    fontSize: "28px",
  },

  walletTitle: {
    marginTop: "8px",
    color: "#666",
    fontSize: "13px",
  },

  walletAmount: {
    marginTop: "4px",
    fontSize: "27px",
    fontWeight: "bold",
  },

  walletDescription: {
    marginTop: "5px",
    color: "#999",
    fontSize: "11px",
  },

  infoBox: {
    marginTop: "20px",
    background: "#eef7ff",
    border:
      "1px solid #cfe5ff",
    borderRadius: "12px",
    padding: "16px",
    display: "flex",
    gap: "12px",
  },

  infoIcon: {
    fontSize: "23px",
  },

  infoTitle: {
    margin: 0,
    fontSize: "15px",
  },

  infoText: {
    margin: "5px 0 0",
    color: "#555",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  section: {
    marginTop: "20px",
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    marginBottom: "15px",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "19px",
  },

  sectionSubtitle: {
    margin: "5px 0 0",
    color: "#888",
    fontSize: "13px",
  },

  availableBadge: {
    padding: "8px 12px",
    borderRadius: "20px",
    background: "#eefbf2",
    color: "#198754",
    fontSize: "12px",
    fontWeight: "bold",
  },

  withdrawButton: {
    border: "none",
    background: "#ff6b00",
    color: "#fff",
    padding: "11px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  withdrawForm: {
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "18px",
  },

  field: {
    marginBottom: "15px",
  },

  label: {
    display: "block",
    marginBottom: "7px",
    fontSize: "13px",
    fontWeight: "bold",
  },

  input: {
    width: "100%",
    padding: "12px",
    border: "1px solid #ccc",
    borderRadius: "8px",
    fontSize: "14px",
    boxSizing: "border-box",
    outline: "none",
    background: "#fff",
  },

  formButtons: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
  },

  cancelButton: {
    padding: "11px 18px",
    border: "1px solid #ccc",
    background: "#fff",
    color: "#555",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  submitButton: {
    padding: "11px 18px",
    border: "none",
    background: "#198754",
    color: "#fff",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  transactionList: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },

  transaction: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "13px",
    border: "1px solid #eee",
    borderRadius: "10px",
    background: "#fafafa",
  },

  transactionIcon: {
    width: "42px",
    height: "42px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "19px",
    flexShrink: 0,
  },

  transactionContent: {
    flex: 1,
    minWidth: 0,
  },

  transactionTitle: {
    fontSize: "14px",
    fontWeight: "bold",
  },

  transactionDate: {
    marginTop: "3px",
    fontSize: "10px",
    color: "#999",
  },

  transactionStatus: {
    marginTop: "4px",
    fontSize: "11px",
    color: "#666",
  },

  transactionAmount: {
    fontSize: "16px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },

  commissionGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: "12px",
    marginTop: "15px",
  },

  commissionBox: {
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "10px",
    padding: "15px",
  },

  commissionIcon: {
    fontSize: "26px",
  },

  commissionTitle: {
    marginTop: "7px",
    fontWeight: "bold",
    fontSize: "14px",
  },

  commissionDescription: {
    marginTop: "5px",
    color: "#777",
    fontSize: "12px",
    lineHeight: 1.5,
  },

  empty: {
    textAlign: "center",
    padding: "35px 15px",
    color: "#777",
  },

  emptyIcon: {
    fontSize: "45px",
  },

  footerNote: {
    marginTop: "20px",
    padding: "13px",
    background: "#fff8e8",
    border:
      "1px solid #ffe0a3",
    borderRadius: "9px",
    color: "#665",
    fontSize: "12px",
    lineHeight: 1.5,
  },
};

export default MLMWallet;