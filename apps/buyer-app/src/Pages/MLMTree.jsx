import React, { useEffect, useState } from "react";
import {
  api,
  getMlmToken,
} from "../api";

function MLMTree({ member, onBack }) {
  const [members, setMembers] = useState([]);

  useEffect(() => {
    loadMembers();

    const timer = setInterval(() => {
      loadMembers();
    }, 15000);

    return () => clearInterval(timer);
  }, []);

  // ==========================================
  // LOAD TEAM FROM BACKEND
  // ==========================================
  // The backend returns the member's subtree (nested). We flatten
  // it into the same list shape this page already renders.

  async function loadMembers() {
    const token = getMlmToken();

    if (!token) {
      setMembers([]);
      return;
    }

    try {
      const data = await api("/api/mlm/tree", { token });

      const rootMember = data?.member;

      if (!rootMember) {
        setMembers([]);
        return;
      }

      const flat = [];

      const flatten = (node, parentId) => {
        flat.push({
          memberId: node.memberId,
          name: node.name,
          position: node.position || null,
          parentId: parentId || null,
          createdAt: node.createdAt,
        });

        (node.children || []).forEach((child) =>
          flatten(child, node.memberId)
        );
      };

      flatten(
        {
          ...rootMember,
          children: data.children || [],
        },
        rootMember.parentId
      );

      setMembers(flat);
    } catch (error) {
      console.log(
        "MLM Tree Error:",
        error
      );

      setMembers([]);
    }
  }

  // ==========================================
  // CURRENT MEMBER ID
  // ==========================================

  const currentMemberId =
    member?.memberId ||
    member?.id ||
    null;

  // ==========================================
  // GET CHILDREN OF CURRENT MEMBER
  // ==========================================

  function getChildren(parentId) {
    if (!parentId) return [];

    return members.filter(
      (item) =>
        String(
          item?.parentId || ""
        ) === String(parentId)
    );
  }

  // ==========================================
  // FIND POSITION
  // ==========================================

  function getPositionMember(
    parentId,
    position
  ) {
    const children =
      getChildren(parentId);

    // Backend stores placements as A / B / C (max 3 direct members).
    // The tree displays them as LEFT / CENTER / RIGHT columns.
    const positionMap = {
      left: "a",
      center: "b",
      right: "c",
    };

    const wanted =
      positionMap[position] || position;

    return (
      children.find(
        (item) =>
          String(
            item?.position || ""
          ).toLowerCase() === wanted
      ) || null
    );
  }

  // ==========================================
  // MEMBER CARD
  // ==========================================

  function MemberCard({
    memberData,
    isCurrent = false,
  }) {
    if (!memberData) return null;

    const name =
      memberData.name ||
      memberData.memberName ||
      "Member";

    const memberId =
      memberData.memberId ||
      memberData.id ||
      "No ID";

    const position =
      memberData.position ||
      "root";

    return (
      <div
        style={{
          ...styles.memberCard,
          ...(isCurrent
            ? styles.currentMemberCard
            : {}),
        }}
      >
        <div style={styles.avatar}>
          {String(name)
            .charAt(0)
            .toUpperCase()}
        </div>

        <div style={styles.memberName}>
          {name}
        </div>

        <div style={styles.memberId}>
          {memberId}
        </div>

        <div
          style={{
            ...styles.positionBadge,
            ...(isCurrent
              ? styles.currentBadge
              : {}),
          }}
        >
          {isCurrent
            ? "YOU"
            : position.toUpperCase()}
        </div>
      </div>
    );
  }

  // ==========================================
  // EMPTY POSITION
  // ==========================================

  function EmptyNode({ position }) {
    return (
      <div style={styles.emptyNode}>
        <div style={styles.emptyCircle}>
          +
        </div>

        <div style={styles.emptyPosition}>
          {position}
        </div>

        <div style={styles.emptyText}>
          Available
        </div>
      </div>
    );
  }

  // ==========================================
  // TEAM MEMBER NODE
  // ==========================================

  function TeamNode({
    memberData,
    level = 0,
  }) {
    if (!memberData) return null;

    const memberId =
      memberData.memberId ||
      memberData.id;

    const left =
      getPositionMember(
        memberId,
        "left"
      );

    const center =
      getPositionMember(
        memberId,
        "center"
      );

    const right =
      getPositionMember(
        memberId,
        "right"
      );

    return (
      <div
        style={{
          ...styles.treeNode,
          minWidth:
            level === 0
              ? "620px"
              : "560px",
        }}
      >
        <MemberCard
          memberData={memberData}
        />

        <div style={styles.verticalLine} />

        <div style={styles.childrenArea}>
          {/* LEFT */}

          <div style={styles.childColumn}>
            <div
              style={
                styles.horizontalLine
              }
            />

            {left ? (
              <TeamNode
                memberData={left}
                level={level + 1}
              />
            ) : (
              <EmptyNode position="LEFT" />
            )}
          </div>

          {/* CENTER */}

          <div style={styles.childColumn}>
            <div
              style={
                styles.horizontalLine
              }
            />

            {center ? (
              <TeamNode
                memberData={center}
                level={level + 1}
              />
            ) : (
              <EmptyNode position="CENTER" />
            )}
          </div>

          {/* RIGHT */}

          <div style={styles.childColumn}>
            <div
              style={
                styles.horizontalLine
              }
            />

            {right ? (
              <TeamNode
                memberData={right}
                level={level + 1}
              />
            ) : (
              <EmptyNode position="RIGHT" />
            )}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // CURRENT MEMBER TEAM
  // ==========================================

  const leftMember =
    getPositionMember(
      currentMemberId,
      "left"
    );

  const centerMember =
    getPositionMember(
      currentMemberId,
      "center"
    );

  const rightMember =
    getPositionMember(
      currentMemberId,
      "right"
    );

  const directTeam = [
    leftMember,
    centerMember,
    rightMember,
  ].filter(Boolean);

  // ==========================================
  // TOTAL DOWNLINE
  // ==========================================

  function countDownline(parentId) {
    const children =
      getChildren(parentId);

    let total = children.length;

    children.forEach((child) => {
      total += countDownline(
        child.memberId ||
          child.id
      );
    });

    return total;
  }

  const totalDownline =
    currentMemberId
      ? countDownline(
          currentMemberId
        )
      : 0;

  // ==========================================
  // NO MEMBER
  // ==========================================

  if (!member || !currentMemberId) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.logo}>
            JustBrand
          </div>

          <h1 style={styles.title}>
            🌳 My Family Team
          </h1>
        </div>

        <div style={styles.emptyMain}>
          <div style={styles.bigIcon}>
            🔐
          </div>

          <h2>
            Family Member Login Required
          </h2>

          <p style={styles.emptyMessage}>
            Please login or register for
            JustBrand Family.
          </p>

          <button
            onClick={onBack}
            style={styles.backButton}
          >
            ← Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ==========================================
  // MAIN
  // ==========================================

  return (
    <div style={styles.page}>
      {/* HEADER */}

      <div style={styles.header}>
        <div style={styles.logo}>
          JustBrand
        </div>

        <h1 style={styles.title}>
          🌳 My Family Team
        </h1>

        <p style={styles.subtitle}>
          JustBrand Family Network
        </p>

        <div style={styles.currentInfo}>
          <strong>
            {member.name ||
              "Member"}
          </strong>

          <span>
            {currentMemberId}
          </span>
        </div>
      </div>

      {/* BACK BUTTON */}

      <div style={styles.topActions}>
        <button
          onClick={onBack}
          style={styles.backButton}
        >
          ← Back to Dashboard
        </button>
      </div>

      {/* TEAM SUMMARY */}

      <div style={styles.summary}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            👥
          </div>

          <div style={styles.summaryNumber}>
            {directTeam.length}
          </div>

          <div style={styles.summaryLabel}>
            Direct Team
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            🌳
          </div>

          <div style={styles.summaryNumber}>
            {totalDownline}
          </div>

          <div style={styles.summaryLabel}>
            Total Downline
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            ⬅️
          </div>

          <div style={styles.summaryNumber}>
            {leftMember ? 1 : 0}
          </div>

          <div style={styles.summaryLabel}>
            Left Team
          </div>
        </div>

        <div style={styles.summaryCard}>
          <div style={styles.summaryIcon}>
            ➡️
          </div>

          <div style={styles.summaryNumber}>
            {rightMember ? 1 : 0}
          </div>

          <div style={styles.summaryLabel}>
            Right Team
          </div>
        </div>
      </div>

      {/* CURRENT MEMBER */}

      <div style={styles.currentMemberSection}>
        <div style={styles.sectionTitle}>
          👤 Your Position
        </div>

        <MemberCard
          memberData={member}
          isCurrent={true}
        />
      </div>

      {/* DIRECT TEAM */}

      <div style={styles.directSection}>
        <div style={styles.sectionTitle}>
          🌳 Direct Team
        </div>

        <div style={styles.directGrid}>
          {/* LEFT */}

          <div style={styles.directCard}>
            <div
              style={{
                ...styles.directHeader,
                background: "#fff4e8",
                color: "#ff6b00",
              }}
            >
              ⬅️ LEFT TEAM
            </div>

            {leftMember ? (
              <MemberCard
                memberData={leftMember}
              />
            ) : (
              <EmptyNode position="LEFT" />
            )}
          </div>

          {/* CENTER */}

          <div style={styles.directCard}>
            <div
              style={{
                ...styles.directHeader,
                background: "#f3f3f3",
                color: "#555",
              }}
            >
              👤 CENTER TEAM
            </div>

            {centerMember ? (
              <MemberCard
                memberData={centerMember}
              />
            ) : (
              <EmptyNode position="CENTER" />
            )}
          </div>

          {/* RIGHT */}

          <div style={styles.directCard}>
            <div
              style={{
                ...styles.directHeader,
                background: "#fff0f5",
                color: "#ff1493",
              }}
            >
              ➡️ RIGHT TEAM
            </div>

            {rightMember ? (
              <MemberCard
                memberData={rightMember}
              />
            ) : (
              <EmptyNode position="RIGHT" />
            )}
          </div>
        </div>
      </div>

      {/* FULL TREE */}

      <div style={styles.treeContainer}>
        <div style={styles.treeTitle}>
          🌳 Complete Team Tree
        </div>

        <div style={styles.treeScroll}>
          <TeamNode
            memberData={member}
            level={0}
          />
        </div>
      </div>

      {/* LEGEND */}

      <div style={styles.legend}>
        <div style={styles.legendTitle}>
          Family Position
        </div>

        <div style={styles.legendItems}>
          <div style={styles.legendItem}>
            <span style={styles.dotLeft} />
            LEFT
          </div>

          <div style={styles.legendItem}>
            <span style={styles.dotCenter} />
            CENTER
          </div>

          <div style={styles.legendItem}>
            <span style={styles.dotRight} />
            RIGHT
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// STYLES
// ==========================================

const styles = {
  page: {
    width: "100%",
    minHeight: "100vh",
    background: "#f5f5f5",
    padding: "20px",
    boxSizing: "border-box",
    overflowX: "hidden",
  },

  header: {
    width: "100%",
    maxWidth: "1200px",
    margin: "0 auto",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "22px 15px",
    borderRadius: "15px",
    textAlign: "center",
    boxSizing: "border-box",
  },

  logo: {
    fontSize: "24px",
    fontWeight: "bold",
    marginBottom: "4px",
  },

  title: {
    margin: 0,
    fontSize: "27px",
  },

  subtitle: {
    margin: "6px 0",
    fontSize: "13px",
    opacity: 0.9,
  },

  currentInfo: {
    marginTop: "12px",
    display: "flex",
    justifyContent: "center",
    gap: "10px",
    flexWrap: "wrap",
    fontSize: "13px",
  },

  topActions: {
    width: "100%",
    maxWidth: "1200px",
    margin: "15px auto 0",
  },

  backButton: {
    border: "none",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    padding: "10px 18px",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
  },

  summary: {
    width: "100%",
    maxWidth: "1200px",
    margin: "20px auto 0",
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit,minmax(170px,1fr))",
    gap: "12px",
  },

  summaryCard: {
    background: "#fff",
    borderRadius: "12px",
    padding: "18px 10px",
    textAlign: "center",
    boxShadow:
      "0 3px 10px rgba(0,0,0,0.06)",
  },

  summaryIcon: {
    fontSize: "23px",
  },

  summaryNumber: {
    marginTop: "5px",
    fontSize: "24px",
    fontWeight: "bold",
    color: "#ff1493",
  },

  summaryLabel: {
    marginTop: "3px",
    fontSize: "11px",
    color: "#777",
  },

  currentMemberSection: {
    width: "100%",
    maxWidth: "1200px",
    margin: "20px auto 0",
    background: "#fff",
    borderRadius: "15px",
    padding: "20px",
    boxSizing: "border-box",
    textAlign: "center",
  },

  sectionTitle: {
    fontSize: "17px",
    fontWeight: "bold",
    marginBottom: "15px",
    color: "#222",
  },

  memberCard: {
    width: "155px",
    margin: "0 auto",
    padding: "13px",
    background: "#fff",
    border: "2px solid #ff1493",
    borderRadius: "12px",
    boxSizing: "border-box",
    textAlign: "center",
    boxShadow:
      "0 3px 12px rgba(0,0,0,0.10)",
    flexShrink: 0,
  },

  currentMemberCard: {
    border:
      "3px solid #ff6b00",
    boxShadow:
      "0 4px 15px rgba(255,107,0,0.25)",
  },

  avatar: {
    width: "45px",
    height: "45px",
    margin: "0 auto 7px",
    borderRadius: "50%",
    background:
      "linear-gradient(135deg,#ff6b00,#ff1493)",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "20px",
    fontWeight: "bold",
  },

  memberName: {
    fontSize: "13px",
    fontWeight: "bold",
    color: "#222",
    wordBreak: "break-word",
  },

  memberId: {
    marginTop: "4px",
    fontSize: "10px",
    color: "#777",
    wordBreak: "break-word",
  },

  positionBadge: {
    display: "inline-block",
    marginTop: "7px",
    padding: "4px 8px",
    borderRadius: "12px",
    background: "#fff0f5",
    color: "#ff1493",
    fontSize: "9px",
    fontWeight: "bold",
  },

  currentBadge: {
    background: "#fff4e8",
    color: "#ff6b00",
  },

  directSection: {
    width: "100%",
    maxWidth: "1200px",
    margin: "20px auto 0",
    background: "#fff",
    borderRadius: "15px",
    padding: "20px",
    boxSizing: "border-box",
  },

  directGrid: {
    display: "grid",
    gridTemplateColumns:
      "repeat(3,minmax(0,1fr))",
    gap: "15px",
  },

  directCard: {
    border: "1px solid #eee",
    borderRadius: "12px",
    padding: "12px",
    textAlign: "center",
    boxSizing: "border-box",
  },

  directHeader: {
    padding: "10px",
    borderRadius: "8px",
    marginBottom: "12px",
    fontSize: "12px",
    fontWeight: "bold",
  },

  treeContainer: {
    width: "100%",
    maxWidth: "1200px",
    margin: "20px auto 0",
    background: "#fff",
    borderRadius: "15px",
    padding: "30px 15px 50px",
    boxSizing: "border-box",
    overflowX: "auto",
    overflowY: "hidden",
  },

  treeTitle: {
    textAlign: "center",
    fontSize: "18px",
    fontWeight: "bold",
    marginBottom: "25px",
  },

  treeScroll: {
    width: "max-content",
    minWidth: "100%",
    display: "flex",
    justifyContent: "center",
    boxSizing: "border-box",
  },

  treeNode: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    boxSizing: "border-box",
  },

  verticalLine: {
    width: "2px",
    height: "25px",
    background: "#ccc",
  },

  childrenArea: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: "25px",
    width: "100%",
    boxSizing: "border-box",
  },

  childColumn: {
    width: "180px",
    minWidth: "180px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    position: "relative",
  },

  horizontalLine: {
    width: "100%",
    height: "2px",
    background: "#ddd",
    marginBottom: "25px",
  },

  emptyNode: {
    width: "155px",
    padding: "13px",
    background: "#fafafa",
    border: "1px dashed #ccc",
    borderRadius: "12px",
    boxSizing: "border-box",
    textAlign: "center",
  },

  emptyCircle: {
    width: "42px",
    height: "42px",
    margin: "0 auto 7px",
    borderRadius: "50%",
    background: "#eee",
    color: "#aaa",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "25px",
  },

  emptyPosition: {
    fontSize: "10px",
    fontWeight: "bold",
    color: "#ff1493",
  },

  emptyText: {
    marginTop: "3px",
    fontSize: "9px",
    color: "#aaa",
  },

  emptyMain: {
    width: "100%",
    maxWidth: "500px",
    margin: "25px auto",
    padding: "50px 20px",
    background: "#fff",
    borderRadius: "15px",
    textAlign: "center",
    boxSizing: "border-box",
  },

  bigIcon: {
    fontSize: "55px",
  },

  emptyMessage: {
    color: "#777",
    fontSize: "14px",
  },

  legend: {
    width: "100%",
    maxWidth: "700px",
    margin: "20px auto 0",
    background: "#fff",
    borderRadius: "12px",
    padding: "15px",
    boxSizing: "border-box",
  },

  legendTitle: {
    textAlign: "center",
    fontSize: "14px",
    fontWeight: "bold",
    marginBottom: "12px",
  },

  legendItems: {
    display: "flex",
    justifyContent: "center",
    gap: "25px",
    flexWrap: "wrap",
  },

  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "11px",
    fontWeight: "bold",
    color: "#555",
  },

  dotLeft: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#ff6b00",
    display: "inline-block",
  },

  dotCenter: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#777",
    display: "inline-block",
  },

  dotRight: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "#ff1493",
    display: "inline-block",
  },
};

export default MLMTree;