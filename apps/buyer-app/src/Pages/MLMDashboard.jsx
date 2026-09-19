import React, { useEffect, useState } from "react";
import MLMCommission from "./MLMCommission";
import {
  api,
  getMlmToken,
  setMlmToken,
} from "../api";

function MLMDashboard({ member, onLogout }) {
  const [activeMenu, setActiveMenu] = useState("dashboard");

  const [mlmMember, setMlmMember] = useState(() => {
    try {
      const saved = localStorage.getItem("justbrand_mlm_member");
      return saved ? JSON.parse(saved) : member || {};
    } catch {
      return member || {};
    }
  });

  const [wallet, setWallet] = useState(0);
  const [earnings, setEarnings] = useState(0);
  const [pendingEarnings, setPendingEarnings] = useState(0);
  const [withdrawn, setWithdrawn] = useState(0);
  const [payouts, setPayouts] = useState([]);
  const [directTeam, setDirectTeam] = useState([]);
  const [transactions, setTransactions] = useState([]);

  // Mobile: collapse the sidebar into a toggleable menu (additive;
  // desktop layout is untouched — the toggle only appears ≤768px).
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" &&
      window.innerWidth <= 768
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    function handleResize() {
      const nowMobile = window.innerWidth <= 768;
      setIsMobile(nowMobile);

      if (!nowMobile) {
        setMobileMenuOpen(false);
      }
    }

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    loadMLMData();

    // Periodic refresh of backend data (wallet/commissions change
    // server-side as orders are delivered and return windows pass).
    const timer = setInterval(() => {
      loadMLMData();
    }, 15000);

    return () => clearInterval(timer);
  }, []);

  async function loadMLMData() {
    const token = getMlmToken();

    if (!token) {
      // No backend session yet — keep any cached member display.
      return;
    }

    try {
      const data = await api("/api/mlm/me", { token });

      if (data?.member) {
        setMlmMember(data.member);

        localStorage.setItem(
          "justbrand_mlm_member",
          JSON.stringify(data.member)
        );
      }

      // Backend wallet: balance (payable), totalEarned, pending.
      setWallet(Number(data?.wallet?.balance) || 0);
      setEarnings(Number(data?.wallet?.totalEarned) || 0);
      setPendingEarnings(Number(data?.wallet?.pending) || 0);
      setWithdrawn(Number(data?.wallet?.totalPaid) || 0);

      // Direct A/B/C placements from the backend.
      // Dashboard shows two team columns: A on the left,
      // B and C on the right (matches the two-box layout).
      const directTeam = Array.isArray(data?.directTeam)
        ? data.directTeam
        : [];

      // All 3 direct placements (A, B, C) — max 3 direct members.
      setDirectTeam(directTeam);

      // Commission history -> transaction list shape.
      const commissionsResponse = await api("/api/mlm/commissions", {
        token,
      });

      const records = Array.isArray(commissionsResponse?.commissions)
        ? commissionsResponse.commissions
        : [];

      setTransactions(
        records.slice(0, 20).map((record) => ({
          id: record.id,
          title: record.description || record.type || "Family Income",
          date: record.createdAt,
          amount: Number(record.amount) || 0,
          status: record.status,
        }))
      );

      // Withdrawal request history (own only) for the payouts section.
      try {
        const payoutsResponse = await api("/api/mlm/payout-requests", {
          token,
        });

        setPayouts(
          Array.isArray(payoutsResponse?.requests)
            ? payoutsResponse.requests
            : []
        );
      } catch {
        // Payout history is optional — dashboard still loads without it.
      }
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        // Session expired — clear the token so the login gate shows.
        setMlmToken("");
        return;
      }

      console.log("MLM data loading error:", error);
    }
  }

  const memberName =
    mlmMember?.name ||
    mlmMember?.memberName ||
    mlmMember?.fullName ||
    "Family Member";

  const memberId =
    mlmMember?.memberId ||
    mlmMember?.id ||
    "JB-MEMBER";

  const mobile =
    mlmMember?.mobile ||
    mlmMember?.phone ||
    "Not Added";

  const email =
    mlmMember?.email ||
    "Not Added";

  const referralCode =
    mlmMember?.referralCode ||
    mlmMember?.referral ||
    memberId;

  const positionA = directTeam.filter(
    (item) => String(item?.position || "").toUpperCase() === "A"
  );
  const positionB = directTeam.filter(
    (item) => String(item?.position || "").toUpperCase() === "B"
  );
  const positionC = directTeam.filter(
    (item) => String(item?.position || "").toUpperCase() === "C"
  );

  const totalTeam = directTeam.length;

  function copyReferralLink() {
    const link =
      `${window.location.origin}/mlm-register?ref=${referralCode}`;

    if (
      navigator.clipboard &&
      navigator.clipboard.writeText
    ) {
      navigator.clipboard
        .writeText(link)
        .then(() => {
          alert("Referral link copied successfully!");
        })
        .catch(() => {
          alert(link);
        });
    } else {
      alert(link);
    }
  }

  function handleLogout() {
    if (onLogout) {
      onLogout();
    }
  }

  return (
    <div className="jb-page" style={styles.page}>
      <div className="jb-family-chakra" aria-hidden="true" />

      <header style={styles.header}>
        <div style={styles.headerLeft}>

          {isMobile && (
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              style={{
                ...styles.mobileMenuBtn,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "40px",
                height: "40px",
                marginRight: "10px",
                border: "1px solid #eee",
                borderRadius: "10px",
                background: "#fff",
                fontSize: "18px",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label="Toggle menu"
            >
              ☰
            </button>
          )}

          <div style={styles.logo}>
            JustBrand
          </div>

          <div style={styles.panelText}>
            Family Dashboard
          </div>
        </div>

        <div style={styles.memberMini}>
          <div style={styles.avatar}>
            {memberName.charAt(0).toUpperCase()}
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

      <div
        style={
          isMobile
            ? { ...styles.layout, flexDirection: "column" }
            : styles.layout
        }
      >

        <aside
          style={
            isMobile
              ? { ...styles.sidebar, display: "none" }
              : styles.sidebar
          }
        >

          <div style={styles.menuTitle}>
            JUSTBRAND FAMILY
          </div>

          <MenuButton
            icon="🏠"
            text="Dashboard"
            active={activeMenu === "dashboard"}
            onClick={() => setActiveMenu("dashboard")}
          />

          <MenuButton
            icon="🌳"
            text="My Team"
            active={activeMenu === "team"}
            onClick={() => setActiveMenu("team")}
          />

          <MenuButton
            icon="💳"
            text="Wallet"
            active={activeMenu === "wallet"}
            onClick={() => setActiveMenu("wallet")}
          />

          <MenuButton
            icon="💰"
            text="Commission"
            active={activeMenu === "commission"}
            onClick={() => setActiveMenu("commission")}
          />

          <MenuButton
            icon="💵"
            text="Earnings"
            active={activeMenu === "earnings"}
            onClick={() => setActiveMenu("earnings")}
          />

          <MenuButton
            icon="🔗"
            text="Referral"
            active={activeMenu === "referral"}
            onClick={() => setActiveMenu("referral")}
          />

          <MenuButton
            icon="📜"
            text="Income History"
            active={activeMenu === "history"}
            onClick={() => setActiveMenu("history")}
          />

          <div style={styles.divider} />

          <div style={styles.menuTitle}>
            ACCOUNT
          </div>

          <MenuButton
            icon="👤"
            text="My Profile"
            active={activeMenu === "profile"}
            onClick={() => setActiveMenu("profile")}
          />

          <div style={styles.logoutArea}>
            <button
              onClick={handleLogout}
              style={styles.logoutButton}
            >
              🚪 Logout
            </button>
          </div>

        </aside>

        {isMobile && mobileMenuOpen && (
          <div
            style={{
              padding: "10px 12px 0",
              background: "#fff",
              borderBottom: "1px solid #eee",
            }}
          >
            {[
              { id: "dashboard", icon: "🏠", text: "Dashboard" },
              { id: "team", icon: "🌳", text: "My Team" },
              { id: "wallet", icon: "💳", text: "Wallet" },
              { id: "commission", icon: "💰", text: "Commission" },
              { id: "earnings", icon: "💵", text: "Earnings" },
              { id: "referral", icon: "🔗", text: "Referral" },
              { id: "history", icon: "📜", text: "Income History" },
              { id: "profile", icon: "👤", text: "My Profile" },
            ].map((item) => (
              <MenuButton
                key={item.id}
                icon={item.icon}
                text={item.text}
                active={activeMenu === item.id}
                onClick={() => {
                  setActiveMenu(item.id);
                  setMobileMenuOpen(false);
                }}
              />
            ))}
          </div>
        )}

        <main style={styles.content}>

          {activeMenu === "commission" && (
            <MLMCommission
              onBack={() => setActiveMenu("dashboard")}
            />
          )}

          {activeMenu === "dashboard" && (
            <>
              <div style={styles.welcomeBox}>

                <div>
                  <h1 style={styles.welcomeTitle}>
                    Welcome, {memberName} 👋
                  </h1>

                  <p style={styles.welcomeText}>
                    Welcome to your JustBrand Family dashboard.
                  </p>
                </div>

                <div style={styles.memberBadge}>
                  Member ID: {memberId}
                </div>

              </div>

              <div style={styles.statsGrid}>

                <StatCard
                  icon="💳"
                  title="Wallet Balance"
                  value={`₹${wallet.toLocaleString("en-IN")}`}
                  description="Available balance"
                />

                <StatCard
                  icon="💰"
                  title="Total Earnings"
                  value={`₹${earnings.toLocaleString("en-IN")}`}
                  description="Lifetime earnings"
                />

                <StatCard
                  icon="👥"
                  title="Total Team"
                  value={totalTeam}
                  description="Left + Right team"
                />

                <StatCard
                  icon="⏳"
                  title="On Hold"
                  value={`₹${pendingEarnings.toLocaleString("en-IN")}`}
                  description="In return window"
                />

                <StatCard
                  icon="🎁"
                  title="Referral Code"
                  value={referralCode}
                  description="Share and grow"
                />

              </div>

              <section style={styles.section}>

                <h2 style={styles.sectionTitle}>
                  🌳 Binary Team
                </h2>

                <p style={styles.sectionSubtitle}>
                  Your 3 direct placements (A, B, C).
                </p>

                <div style={styles.binaryGrid}>

                  <TeamCard
                    side="A"
                    icon="1️⃣"
                    count={positionA.length}
                    members={positionA}
                  />

                  <TeamCard
                    side="B"
                    icon="2️⃣"
                    count={positionB.length}
                    members={positionB}
                  />

                  <TeamCard
                    side="C"
                    icon="3️⃣"
                    count={positionC.length}
                    members={positionC}
                  />

                </div>

                <p
                  style={{
                    margin: "12px 0 0",
                    fontSize: "13px",
                    color: "#777",
                    textAlign: "center",
                  }}
                >
                  You can have maximum 3 direct members (A, B, C).
                  Extra referrals are placed automatically in your
                  Family team (spillover).
                </p>

              </section>

              <section style={styles.section}>

                <h2 style={styles.sectionTitle}>
                  🔗 Your Referral
                </h2>

                <p style={styles.sectionSubtitle}>
                  Invite new members to JustBrand Family.
                </p>

                <div style={styles.referralBox}>

                  <div>
                    <div style={styles.smallLabel}>
                      REFERRAL CODE
                    </div>

                    <div style={styles.referralCode}>
                      {referralCode}
                    </div>
                  </div>

                  <button
                    onClick={copyReferralLink}
                    style={styles.copyButton}
                  >
                    🔗 Copy Referral Link
                  </button>

                </div>

              </section>

              <section style={styles.section}>

                <h2 style={styles.sectionTitle}>
                  🏦 Withdrawal Status
                </h2>

                <p style={styles.sectionSubtitle}>
                  Your payout requests and their progress.
                </p>

                <div style={styles.statsGrid}>

                  <StatCard
                    icon="💳"
                    title="Available"
                    value={`₹${wallet.toLocaleString("en-IN")}`}
                    description="Ready to withdraw"
                  />

                  <StatCard
                    icon="⏳"
                    title="On Hold"
                    value={`₹${pendingEarnings.toLocaleString("en-IN")}`}
                    description="Return window active"
                  />

                  <StatCard
                    icon="🏦"
                    title="Withdrawn"
                    value={`₹${withdrawn.toLocaleString("en-IN")}`}
                    description="Paid to you"
                  />

                </div>

                {payouts.length === 0 ? (
                  <div style={styles.emptyBox}>
                    <p style={{ margin: 0, color: "#777", fontSize: 14 }}>
                      No withdrawal requests yet. Withdrawals from your Family
                      Wallet appear here with their status.
                    </p>
                  </div>
                ) : (
                  <div style={styles.transactionList}>
                    {payouts.slice(0, 5).map((payout) => (
                      <Transaction
                        key={payout.id}
                        item={{
                          id: payout.id,
                          title: `${payout.method || "Bank"} withdrawal`,
                          date: payout.createdAt,
                          amount: -(Number(payout.amount) || 0),
                          status: payout.status || "Processing",
                        }}
                      />
                    ))}
                  </div>
                )}

              </section>

              <section style={styles.section}>

                <h2 style={styles.sectionTitle}>
                  📜 Recent Income
                </h2>

                <p style={styles.sectionSubtitle}>
                  Your latest Family income.
                </p>

                {transactions.length === 0 ? (
                  <div style={styles.emptyBox}>
                    <div style={styles.emptyIcon}>
                      💰
                    </div>

                    <h3>
                      No Income Yet
                    </h3>

                    <p>
                      Your Family earnings will appear here.
                    </p>
                  </div>
                ) : (
                  <div style={styles.transactionList}>
                    {transactions
                      .slice(0, 5)
                      .map((item, index) => (
                        <Transaction
                          key={item.id || index}
                          item={item}
                        />
                      ))}
                  </div>
                )}

              </section>
            </>
          )}

          {activeMenu === "team" && (
            <PageBox
              icon="🌳"
              title="My Team"
              subtitle="Manage your 3 direct Family members."
            >

              <div style={styles.bigTeamGrid}>

                <TeamCard
                  side="A"
                  icon="1️⃣"
                  count={positionA.length}
                  members={positionA}
                />

                <TeamCard
                  side="B"
                  icon="2️⃣"
                  count={positionB.length}
                  members={positionB}
                />

                <TeamCard
                  side="C"
                  icon="3️⃣"
                  count={positionC.length}
                  members={positionC}
                />

              </div>

            </PageBox>
          )}

          {activeMenu === "wallet" && (
            <PageBox
              icon="💳"
              title="Family Wallet"
              subtitle="Manage your JustBrand wallet."
            >

              <div style={styles.walletCard}>

                <div style={styles.walletIcon}>
                  💳
                </div>

                <div style={styles.walletLabel}>
                  Available Balance
                </div>

                <div style={styles.walletAmount}>
                  ₹{wallet.toLocaleString("en-IN")}
                </div>

              </div>

              <div style={styles.infoMessage}>
                ℹ️ Approved commission will be added
                to your wallet after the applicable
                return period.
              </div>

            </PageBox>
          )}

          {activeMenu === "earnings" && (
            <PageBox
              icon="💵"
              title="My Earnings"
              subtitle="Track your Family income."
            >

              <div style={styles.earningsCard}>

                <div style={styles.earningsIcon}>
                  💰
                </div>

                <div style={styles.earningsLabel}>
                  Total Earnings
                </div>

                <div style={styles.earningsAmount}>
                  ₹{earnings.toLocaleString("en-IN")}
                </div>

              </div>

              <div style={styles.infoMessage}>
                🎁 Direct referral, shopping and
                binary commissions will be shown here.
              </div>

            </PageBox>
          )}

          {activeMenu === "referral" && (
            <PageBox
              icon="🔗"
              title="Referral Center"
              subtitle="Invite new members."
            >

              <div style={styles.referralLarge}>

                <div style={styles.smallLabel}>
                  YOUR REFERRAL CODE
                </div>

                <div style={styles.largeReferralCode}>
                  {referralCode}
                </div>

                <button
                  onClick={copyReferralLink}
                  style={styles.primaryButton}
                >
                  🔗 Copy Referral Link
                </button>

              </div>

            </PageBox>
          )}

          {activeMenu === "history" && (
            <PageBox
              icon="📜"
              title="Income History"
              subtitle="View all Family transactions."
            >

              {transactions.length === 0 ? (
                <div style={styles.emptyBox}>

                  <div style={styles.emptyIcon}>
                    📜
                  </div>

                  <h3>
                    No Transactions
                  </h3>

                  <p>
                    Your income history will appear here.
                  </p>

                </div>
              ) : (
                <div style={styles.transactionList}>

                  {transactions.map((item, index) => (
                    <Transaction
                      key={item.id || index}
                      item={item}
                    />
                  ))}

                </div>
              )}

            </PageBox>
          )}

          {activeMenu === "profile" && (
            <PageBox
              icon="👤"
              title="My Profile"
              subtitle="Your JustBrand Family member details."
            >

              <div style={styles.profileGrid}>

                <InfoBox
                  icon="👤"
                  label="Name"
                  value={memberName}
                />

                <InfoBox
                  icon="🆔"
                  label="Member ID"
                  value={memberId}
                />

                <InfoBox
                  icon="📱"
                  label="Mobile"
                  value={mobile}
                />

                <InfoBox
                  icon="📧"
                  label="Email"
                  value={email}
                />

                <InfoBox
                  icon="🔗"
                  label="Referral Code"
                  value={referralCode}
                />

              </div>

            </PageBox>
          )}

        </main>

      </div>

    </div>
  );
}

function MenuButton({
  icon,
  text,
  active,
  onClick,
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        border: "none",
        background: active ? "#fff0f5" : "transparent",
        color: active ? "#ff1493" : "#444",
        padding: "12px 15px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        textAlign: "left",
        borderRadius: "8px",
        cursor: "pointer",
        fontWeight: active ? "bold" : "500",
        fontSize: "14px",
        marginBottom: "4px",
      }}
    >
      <span style={{ fontSize: "18px" }}>
        {icon}
      </span>

      {text}
    </button>
  );
}

function StatCard({
  icon,
  title,
  value,
  description,
}) {
  return (
    <div style={styles.statCard}>

      <div style={styles.statIcon}>
        {icon}
      </div>

      <div style={styles.statTitle}>
        {title}
      </div>

      <div style={styles.statValue}>
        {value}
      </div>

      <div style={styles.statDescription}>
        {description}
      </div>

    </div>
  );
}

function TeamCard({
  side,
  icon,
  count,
  members,
}) {
  return (
    <div style={styles.teamCard}>

      <div style={styles.teamHeader}>

        <div style={styles.teamSide}>
          {icon} {side} TEAM
        </div>

        <div style={styles.teamCount}>
          {count}
        </div>

      </div>

      {members.length === 0 ? (
        <div style={styles.noMember}>
          No member yet
        </div>
      ) : (
        <div style={styles.memberList}>

          {members.map((item, index) => {

            const name =
              item?.name ||
              item?.memberName ||
              item?.fullName ||
              `Member ${index + 1}`;

            const id =
              item?.memberId ||
              item?.id ||
              "Member";

            return (
              <div
                key={
                  item?.memberId ||
                  item?.id ||
                  index
                }
                style={styles.teamMember}
              >

                <div style={styles.memberAvatar}>
                  {name.charAt(0).toUpperCase()}
                </div>

                <div>

                  <div style={styles.memberItemName}>
                    {name}
                  </div>

                  <div style={styles.memberItemId}>
                    {id}
                  </div>

                </div>

              </div>
            );
          })}

        </div>
      )}

    </div>
  );
}

function Transaction({ item }) {
  const amount = Number(item?.amount || 0);

  return (
    <div style={styles.transaction}>

      <div style={styles.transactionIcon}>
        💰
      </div>

      <div style={styles.transactionContent}>

        <div style={styles.transactionTitle}>
          {item?.title ||
            item?.type ||
            "Family Income"}
        </div>

        <div style={styles.transactionDate}>
          {item?.date ||
            item?.createdAt ||
            "Recent"}
        </div>

      </div>

      <div style={styles.transactionAmount}>
        +₹{amount.toLocaleString("en-IN")}
      </div>

    </div>
  );
}

function PageBox({
  icon,
  title,
  subtitle,
  children,
}) {
  return (
    <section style={styles.pageBox}>

      <div style={styles.pageBoxHeader}>

        <div style={styles.pageBoxIcon}>
          {icon}
        </div>

        <div>

          <h1 style={styles.pageBoxTitle}>
            {title}
          </h1>

          <p style={styles.pageBoxSubtitle}>
            {subtitle}
          </p>

        </div>

      </div>

      <div style={styles.pageBoxContent}>
        {children}
      </div>

    </section>
  );
}

function InfoBox({
  icon,
  label,
  value,
}) {
  return (
    <div style={styles.infoBox}>

      <div style={styles.infoIcon}>
        {icon}
      </div>

      <div>

        <div style={styles.infoLabel}>
          {label}
        </div>

        <div style={styles.infoValue}>
          {value}
        </div>

      </div>

    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    color: "#222",
    maxWidth: "100%",
    overflowX: "hidden",
  },

  header: {
    minHeight: "70px",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 25px",
    boxSizing: "border-box",
    gap: "15px",
    flexWrap: "wrap",
    maxWidth: "100%",
  },

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: 0,
    flex: "1 1 auto",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
    whiteSpace: "nowrap",
  },

  panelText: {
    borderLeft: "1px solid rgba(255,255,255,0.5)",
    paddingLeft: "12px",
    fontSize: "14px",
  },

  memberMini: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    minWidth: 0,
  },

  avatar: {
    width: "40px",
    height: "40px",
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
    maxWidth: "130px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  memberId: {
    fontSize: "11px",
    opacity: 0.85,
    marginTop: "2px",
  },

  layout: {
    display: "flex",
    minHeight: "calc(100vh - 70px)",
    alignItems: "stretch",
    flexDirection: "row",
  },

  sidebar: {
    width: "245px",
    background: "#fff",
    padding: "20px 12px",
    boxSizing: "border-box",
    borderRight: "1px solid #eee",
    flexShrink: 0,
  },

  menuTitle: {
    fontSize: "10px",
    fontWeight: "bold",
    color: "#999",
    padding: "5px 12px 10px",
    letterSpacing: "0.5px",
  },

  divider: {
    height: "1px",
    background: "#eee",
    margin: "15px 5px",
  },

  logoutArea: {
    marginTop: "25px",
    padding: "10px 5px",
    borderTop: "1px solid #eee",
  },

  logoutButton: {
    width: "100%",
    padding: "11px",
    border: "none",
    borderRadius: "8px",
    background: "#fff0f0",
    color: "#dc3545",
    cursor: "pointer",
    fontWeight: "bold",
  },

  content: {
    flex: 1,
    minWidth: 0,
    padding: "25px",
    boxSizing: "border-box",
    maxWidth: "100%",
    overflowX: "hidden",
  },

  contentInner: {
    width: "100%",
  },

  mobileMenuBtn: {
    display: "none",
  },

  welcomeBox: {
    background: "linear-gradient(135deg,#fff,#fff8f5)",
    borderRadius: "14px",
    padding: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
    border: "1px solid #f1f1f1",
  },

  welcomeTitle: {
    margin: 0,
    fontSize: "25px",
  },

  welcomeText: {
    margin: "6px 0 0",
    color: "#777",
    fontSize: "14px",
  },

  memberBadge: {
    padding: "10px 15px",
    background: "#fff0f5",
    color: "#ff1493",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
  },

  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
    gap: "15px",
    marginTop: "20px",
  },

  statCard: {
    background: "#fff",
    borderRadius: "12px",
    padding: "18px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
  },

  statIcon: {
    fontSize: "27px",
  },

  statTitle: {
    marginTop: "7px",
    color: "#666",
    fontSize: "13px",
  },

  statValue: {
    marginTop: "3px",
    fontSize: "25px",
    fontWeight: "bold",
    wordBreak: "break-word",
  },

  statDescription: {
    marginTop: "3px",
    color: "#999",
    fontSize: "11px",
  },

  section: {
    marginTop: "22px",
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "19px",
  },

  sectionSubtitle: {
    margin: "5px 0 15px",
    color: "#888",
    fontSize: "13px",
  },

  binaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "15px",
    alignItems: "stretch",
    // Stack vertically on phones (JS-derived; 360px widths otherwise clip).
    ...(typeof window !== "undefined" && window.innerWidth <= 620
      ? {
          gridTemplateColumns: "1fr",
          justifyItems: "center",
        }
      : {}),
  },

  bigTeamGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
    gap: "20px",
  },

  treeCenter: {
    textAlign: "center",
  },

  treeCircle: {
    width: "70px",
    height: "70px",
    margin: "0 auto",
    borderRadius: "50%",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "30px",
  },

  treeName: {
    marginTop: "8px",
    fontWeight: "bold",
    fontSize: "13px",
  },

  treeId: {
    marginTop: "3px",
    color: "#888",
    fontSize: "11px",
  },

  teamCard: {
    background: "#fafafa",
    border: "1px solid #eee",
    borderRadius: "12px",
    padding: "15px",
    minWidth: 0,
    width: "100%",
    boxSizing: "border-box",
  },

  teamHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "10px",
  },

  teamSide: {
    fontWeight: "bold",
    color: "#ff1493",
    fontSize: "13px",
  },

  teamCount: {
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    background: "#fff0f5",
    color: "#ff1493",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
  },

  noMember: {
    padding: "25px 10px",
    textAlign: "center",
    color: "#999",
    fontSize: "13px",
  },

  memberList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxWidth: "100%",
    overflowX: "hidden",
  },

  teamMember: {
    display: "flex",
    alignItems: "center",
    gap: "9px",
    padding: "8px",
    background: "#fff",
    borderRadius: "8px",
    minWidth: 0,
  },

  memberAvatar: {
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    background: "#ffe7d6",
    color: "#ff6b00",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: "bold",
  },

  memberItemName: {
    fontSize: "12px",
    fontWeight: "bold",
    overflowWrap: "anywhere",
  },

  memberItemId: {
    marginTop: "2px",
    color: "#999",
    fontSize: "10px",
  },

  referralBox: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "15px",
    flexWrap: "wrap",
    padding: "15px",
    background: "#fff8f5",
    borderRadius: "10px",
    border: "1px solid #ffe2d0",
  },

  smallLabel: {
    color: "#999",
    fontSize: "10px",
    fontWeight: "bold",
  },

  referralCode: {
    marginTop: "5px",
    fontSize: "20px",
    fontWeight: "bold",
    color: "#ff1493",
    overflowWrap: "anywhere",
  },

  copyButton: {
    border: "none",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "11px 16px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  emptyBox: {
    textAlign: "center",
    padding: "35px 15px",
    color: "#777",
  },

  emptyIcon: {
    fontSize: "45px",
  },

  transactionList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  transaction: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "12px",
    background: "#fafafa",
    borderRadius: "9px",
    border: "1px solid #eee",
    minWidth: 0,
  },

  transactionIcon: {
    width: "38px",
    height: "38px",
    borderRadius: "50%",
    background: "#e9fff1",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },

  transactionContent: {
    flex: 1,
  },

  transactionTitle: {
    fontSize: "13px",
    fontWeight: "bold",
    overflowWrap: "anywhere",
  },

  transactionDate: {
    marginTop: "3px",
    fontSize: "10px",
    color: "#999",
  },

  transactionAmount: {
    color: "#198754",
    fontWeight: "bold",
    fontSize: "14px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  pageBox: {
    background: "#fff",
    borderRadius: "14px",
    padding: "25px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },

  pageBoxHeader: {
    display: "flex",
    alignItems: "center",
    gap: "15px",
    paddingBottom: "20px",
    borderBottom: "1px solid #eee",
  },

  pageBoxIcon: {
    width: "55px",
    height: "55px",
    borderRadius: "12px",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "27px",
  },

  pageBoxTitle: {
    margin: 0,
    fontSize: "24px",
  },

  pageBoxSubtitle: {
    margin: "5px 0 0",
    color: "#888",
    fontSize: "13px",
  },

  pageBoxContent: {
    marginTop: "20px",
  },

  walletCard: {
    maxWidth: "450px",
    padding: "25px",
    borderRadius: "14px",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
  },

  walletIcon: {
    fontSize: "30px",
  },

  walletLabel: {
    marginTop: "15px",
    fontSize: "13px",
  },

  walletAmount: {
    marginTop: "5px",
    fontSize: "32px",
    fontWeight: "bold",
  },

  earningsCard: {
    maxWidth: "450px",
    padding: "25px",
    borderRadius: "14px",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
  },

  earningsIcon: {
    fontSize: "30px",
  },

  earningsLabel: {
    marginTop: "15px",
    fontSize: "13px",
  },

  earningsAmount: {
    marginTop: "5px",
    fontSize: "32px",
    fontWeight: "bold",
  },

  infoMessage: {
    marginTop: "20px",
    padding: "14px",
    background: "#eef7ff",
    borderRadius: "8px",
    color: "#555",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  referralLarge: {
    maxWidth: "500px",
    textAlign: "center",
    padding: "35px 20px",
    background: "#fff8f5",
    borderRadius: "14px",
    border: "1px solid #ffe2d0",
  },

  largeReferralCode: {
    margin: "10px 0 20px",
    fontSize: "30px",
    fontWeight: "bold",
    color: "#ff1493",
  },

  primaryButton: {
    border: "none",
    background: "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "12px 20px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  profileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
    gap: "12px",
  },

  infoBox: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    padding: "14px",
    background: "#fafafa",
    borderRadius: "10px",
    border: "1px solid #eee",
  },

  infoIcon: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    background: "#fff0f5",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "19px",
  },

  infoLabel: {
    fontSize: "11px",
    color: "#999",
  },

  infoValue: {
    marginTop: "3px",
    fontSize: "14px",
    fontWeight: "bold",
    wordBreak: "break-word",
  },
};

export default MLMDashboard;