import React, { useEffect, useState } from "react";

function MLMTree({ member, onBack }) {
  const [members, setMembers] = useState([]);

  useEffect(() => {
    loadMembers();

    const timer = setInterval(() => {
      loadMembers();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  function loadMembers() {
    try {
      const saved = localStorage.getItem("justbrand_mlm_members");

      if (saved) {
        const data = JSON.parse(saved);

        if (Array.isArray(data)) {
          setMembers(data);
        } else {
          setMembers([]);
        }
      } else {
        setMembers([]);
      }
    } catch (error) {
      console.log("MLM members loading error:", error);
      setMembers([]);
    }
  }

  const currentMember = member || {
    id: "root",
    name: "You",
    memberId: "JB001",
  };

  const directMembers = members.filter(
    (item) =>
      String(item.sponsorId || "") ===
      String(currentMember.id || currentMember.memberId)
  );

  const leftMember = directMembers[0] || null;
  const centerMember = directMembers[1] || null;
  const rightMember = directMembers[2] || null;

  return (
    <div style={styles.page}>
      {/* HEADER */}
      <header style={styles.header}>
        <div>
          <div style={styles.logo}>JustBrand</div>
          <div style={styles.panelText}>MLM Network</div>
        </div>

        <button onClick={onBack} style={styles.backButton}>
          ← Back
        </button>
      </header>

      {/* CONTENT */}
      <main style={styles.container}>
        <div style={styles.titleBox}>
          <div>
            <h1 style={styles.title}>🌳 My MLM Network</h1>

            <p style={styles.subtitle}>
              View your direct members and network placement.
            </p>
          </div>

          <div style={styles.badge}>
            3 Leg Structure
          </div>
        </div>

        {/* ROOT MEMBER */}
        <section style={styles.treeSection}>
          <div style={styles.sectionTitle}>
            Your Position
          </div>

          <div style={styles.rootArea}>
            <MemberCard
              member={currentMember}
              root
            />
          </div>

          {/* CONNECTOR */}
          <div style={styles.verticalLine}></div>

          <div style={styles.horizontalLine}></div>

          {/* THREE LEGS */}
          <div style={styles.childrenGrid}>
            <TreePosition
              title="Left"
              member={leftMember}
            />

            <TreePosition
              title="Center"
              member={centerMember}
            />

            <TreePosition
              title="Right"
              member={rightMember}
            />
          </div>
        </section>

        {/* DIRECT MEMBERS */}
        <section style={styles.infoSection}>
          <h2 style={styles.sectionHeading}>
            👥 Direct Members
          </h2>

          <p style={styles.sectionText}>
            Members directly introduced by you.
          </p>

          <div style={styles.directGrid}>
            <MemberInfo
              position="Left"
              member={leftMember}
            />

            <MemberInfo
              position="Center"
              member={centerMember}
            />

            <MemberInfo
              position="Right"
              member={rightMember}
            />
          </div>
        </section>

        {/* COMMISSION INFO */}
        <section style={styles.commissionBox}>
          <div style={styles.commissionIcon}>
            💰
          </div>

          <div style={styles.commissionContent}>
            <h3 style={styles.commissionTitle}>
              Shopping Commission
            </h3>

            <p style={styles.commissionText}>
              Eligible shopping by members in your
              network can generate commission according
              to the JustBrand MLM commission rules.
            </p>

            <div style={styles.commissionRules}>
              <div>✓ Direct member commission</div>
              <div>✓ Network / level commission</div>
              <div>✓ Shopping based commission</div>
              <div>✓ Refund/cancellation adjustment</div>
            </div>
          </div>
        </section>

        {/* SPILLOVER */}
        <section style={styles.spilloverBox}>
          <div style={styles.spilloverIcon}>
            🔄
          </div>

          <div>
            <h3 style={styles.spilloverTitle}>
              Spillover
            </h3>

            <p style={styles.spilloverText}>
              When the available direct placement
              positions are full, new members can be
              placed automatically into eligible
              positions according to the MLM placement
              rules.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}

/* ==========================================
   TREE POSITION
========================================== */

function TreePosition({ title, member }) {
  return (
    <div style={styles.positionColumn}>
      <div style={styles.positionLabel}>
        {title}
      </div>

      {member ? (
        <MemberCard member={member} />
      ) : (
        <EmptyPosition title={title} />
      )}
    </div>
  );
}

/* ==========================================
   MEMBER CARD
========================================== */

function MemberCard({ member, root = false }) {
  const name =
    member?.name ||
    member?.sellerName ||
    member?.fullName ||
    (root ? "You" : "Member");

  const memberId =
    member?.memberId ||
    member?.id ||
    "JB000";

  return (
    <div
      style={{
        ...styles.memberCard,
        ...(root ? styles.rootCard : {}),
      }}
    >
      <div
        style={{
          ...styles.avatar,
          ...(root ? styles.rootAvatar : {}),
        }}
      >
        {name.charAt(0).toUpperCase()}
      </div>

      <div style={styles.memberName}>
        {name}
      </div>

      <div style={styles.memberId}>
        ID: {memberId}
      </div>

      {root && (
        <div style={styles.youBadge}>
          YOU
        </div>
      )}
    </div>
  );
}

/* ==========================================
   EMPTY POSITION
========================================== */

function EmptyPosition({ title }) {
  return (
    <div style={styles.emptyCard}>
      <div style={styles.emptyIcon}>
        +
      </div>

      <div style={styles.emptyTitle}>
        Empty
      </div>

      <div style={styles.emptyText}>
        {title} position available
      </div>
    </div>
  );
}

/* ==========================================
   MEMBER INFO
========================================== */

function MemberInfo({ position, member }) {
  if (!member) {
    return (
      <div style={styles.memberInfo}>
        <div style={styles.memberInfoPosition}>
          {position}
        </div>

        <div style={styles.noMember}>
          No member yet
        </div>
      </div>
    );
  }

  const name =
    member.name ||
    member.sellerName ||
    member.fullName ||
    "Member";

  const memberId =
    member.memberId ||
    member.id ||
    "JB000";

  return (
    <div style={styles.memberInfo}>
      <div style={styles.memberInfoPosition}>
        {position}
      </div>

      <div style={styles.memberInfoName}>
        {name}
      </div>

      <div style={styles.memberInfoId}>
        Member ID: {memberId}
      </div>

      <div style={styles.activeStatus}>
        ● Active
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
    background: "#f5f5f5",
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
    boxSizing: "border-box",
  },

  logo: {
    fontSize: "25px",
    fontWeight: "bold",
  },

  panelText: {
    fontSize: "12px",
    marginTop: "2px",
    opacity: 0.9,
  },

  backButton: {
    padding: "10px 16px",
    border: "none",
    borderRadius: "8px",
    background: "#fff",
    color: "#ff1493",
    cursor: "pointer",
    fontWeight: "bold",
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
    padding: "20px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "15px",
    flexWrap: "wrap",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
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

  badge: {
    padding: "8px 14px",
    background: "#fff0f5",
    color: "#ff1493",
    borderRadius: "20px",
    fontSize: "12px",
    fontWeight: "bold",
  },

  treeSection: {
    marginTop: "20px",
    background: "#fff",
    borderRadius: "14px",
    padding: "25px 15px 35px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.06)",
    overflowX: "auto",
  },

  sectionTitle: {
    textAlign: "center",
    fontSize: "16px",
    fontWeight: "bold",
    marginBottom: "15px",
  },

  rootArea: {
    display: "flex",
    justifyContent: "center",
  },

  verticalLine: {
    width: "2px",
    height: "30px",
    background: "#ddd",
    margin: "0 auto",
  },

  horizontalLine: {
    height: "2px",
    background: "#ddd",
    width: "66%",
    margin: "0 auto",
  },

  childrenGrid: {
    minWidth: "650px",
    display: "grid",
    gridTemplateColumns:
      "repeat(3,1fr)",
    gap: "20px",
    marginTop: "30px",
  },

  positionColumn: {
    textAlign: "center",
  },

  positionLabel: {
    fontSize: "12px",
    fontWeight: "bold",
    color: "#ff1493",
    marginBottom: "8px",
  },

  memberCard: {
    width: "150px",
    margin: "0 auto",
    padding: "15px 10px",
    background: "#fff",
    border:
      "2px solid #eee",
    borderRadius: "12px",
    textAlign: "center",
    boxShadow:
      "0 3px 8px rgba(0,0,0,0.06)",
    boxSizing: "border-box",
  },

  rootCard: {
    border:
      "2px solid #ff1493",
    background: "#fff8fb",
  },

  avatar: {
    width: "48px",
    height: "48px",
    borderRadius: "50%",
    margin: "0 auto 8px",
    background: "#fff0f5",
    color: "#ff1493",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    fontWeight: "bold",
  },

  rootAvatar: {
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
  },

  memberName: {
    fontWeight: "bold",
    fontSize: "14px",
    wordBreak: "break-word",
  },

  memberId: {
    marginTop: "4px",
    fontSize: "10px",
    color: "#888",
    wordBreak: "break-word",
  },

  youBadge: {
    display: "inline-block",
    marginTop: "8px",
    padding: "3px 8px",
    borderRadius: "10px",
    background: "#ff1493",
    color: "#fff",
    fontSize: "9px",
    fontWeight: "bold",
  },

  emptyCard: {
    width: "150px",
    minHeight: "110px",
    margin: "0 auto",
    padding: "15px 10px",
    border:
      "2px dashed #ddd",
    borderRadius: "12px",
    textAlign: "center",
    boxSizing: "border-box",
    background: "#fafafa",
  },

  emptyIcon: {
    width: "35px",
    height: "35px",
    margin: "0 auto 7px",
    borderRadius: "50%",
    background: "#eee",
    color: "#aaa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "22px",
  },

  emptyTitle: {
    fontWeight: "bold",
    color: "#999",
    fontSize: "13px",
  },

  emptyText: {
    marginTop: "4px",
    color: "#aaa",
    fontSize: "10px",
  },

  infoSection: {
    marginTop: "20px",
    background: "#fff",
    borderRadius: "14px",
    padding: "20px",
    boxShadow:
      "0 2px 8px rgba(0,0,0,0.05)",
  },

  sectionHeading: {
    margin: 0,
    fontSize: "19px",
  },

  sectionText: {
    margin: "5px 0 15px",
    color: "#888",
    fontSize: "13px",
  },

  directGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(200px,1fr))",
    gap: "12px",
  },

  memberInfo: {
    padding: "15px",
    background: "#fafafa",
    border:
      "1px solid #eee",
    borderRadius: "10px",
  },

  memberInfoPosition: {
    fontSize: "11px",
    color: "#ff1493",
    fontWeight: "bold",
  },

  memberInfoName: {
    marginTop: "7px",
    fontSize: "15px",
    fontWeight: "bold",
  },

  memberInfoId: {
    marginTop: "4px",
    color: "#888",
    fontSize: "11px",
  },

  activeStatus: {
    marginTop: "8px",
    color: "#198754",
    fontSize: "11px",
    fontWeight: "bold",
  },

  noMember: {
    marginTop: "8px",
    color: "#999",
    fontSize: "13px",
  },

  commissionBox: {
    marginTop: "20px",
    background:
      "linear-gradient(135deg,#fff8e8,#fff)",
    border:
      "1px solid #ffe0a3",
    borderRadius: "14px",
    padding: "20px",
    display: "flex",
    gap: "15px",
    alignItems: "flex-start",
    boxSizing: "border-box",
  },

  commissionIcon: {
    width: "50px",
    height: "50px",
    borderRadius: "12px",
    background: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "25px",
    flexShrink: 0,
  },

  commissionContent: {
    flex: 1,
  },

  commissionTitle: {
    margin: 0,
    fontSize: "18px",
  },

  commissionText: {
    margin: "6px 0 10px",
    color: "#666",
    fontSize: "13px",
    lineHeight: 1.5,
  },

  commissionRules: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(220px,1fr))",
    gap: "7px",
    color: "#555",
    fontSize: "12px",
  },

  spilloverBox: {
    marginTop: "20px",
    background: "#eef7ff",
    border:
      "1px solid #cfe5ff",
    borderRadius: "14px",
    padding: "18px",
    display: "flex",
    gap: "15px",
    alignItems: "flex-start",
  },

  spilloverIcon: {
    fontSize: "30px",
  },

  spilloverTitle: {
    margin: 0,
    fontSize: "17px",
  },

  spilloverText: {
    margin: "5px 0 0",
    color: "#666",
    fontSize: "13px",
    lineHeight: 1.5,
  },
};

export default MLMTree;