import { useEffect, useState } from "react";

const API = "https://justbrand-in-144629.hostingersite.com";

// ---------------------------------------------------------
// LEVEL-WISE COMMISSION EDITOR
// Levels 1..3 mirror the existing 3-level JustBrand Family
// structure (max 3 directs + spillover). Saved values are read
// by business.js commission calculation via mlm_settings key
// 'level_commissions'; levels without an override keep the
// existing flat rules percentage (backward compatible).
// ---------------------------------------------------------

const LEVEL_COMMISSION_DEFAULTS = {
  level1: null,
  level2: null,
  level3: null,
};

function LevelCommissionsEditor({ token, isSuper, onMessage }) {
  const [levels, setLevels] = useState({ ...LEVEL_COMMISSION_DEFAULTS });
  const [savedLevels, setSavedLevels] = useState({
    ...LEVEL_COMMISSION_DEFAULTS,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      try {
        const response = await fetch(`${API}/api/mlm/level-commissions`);
        const data = await response.json().catch(() => null);

        if (cancelled) return;

        if (response.ok && data?.success) {
          const next = {
            level1: data.levels?.level1 ?? null,
            level2: data.levels?.level2 ?? null,
            level3: data.levels?.level3 ?? null,
          };

          setLevels(next);
          setSavedLevels({ ...next });
        } else {
          onMessage("❌ Could not load level commissions.");
        }
      } catch {
        if (!cancelled) onMessage("❌ Network error loading level commissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty =
    levels.level1 !== savedLevels.level1 ||
    levels.level2 !== savedLevels.level2 ||
    levels.level3 !== savedLevels.level3;

  function validate(name, raw) {
    if (raw === "" || raw === null) return ""; // empty = use flat rules value

    const n = Number(raw);

    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return "0–100 के बीच होना चाहिए";
    }

    return "";
  }

  function setLevel(name, raw) {
    setErrors((prev) => ({ ...prev, [name]: validate(name, raw) }));
    setLevels((prev) => ({
      ...prev,
      [name]: raw === "" ? null : raw,
    }));
  }

  async function save() {
    if (Object.values(errors).some(Boolean)) {
      onMessage("❌ Fix validation errors first.");
      return;
    }

    const body = {};

    for (const key of ["level1", "level2", "level3"]) {
      if (levels[key] !== null) body[key] = Number(levels[key]);
    }

    if (Object.keys(body).length === 0) {
      onMessage("ℹ️ कुछ बदला नहीं — खाली field = flat rules value.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/admin/mlm/level-commissions`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Save failed.");
      }

      if (data.levels) {
        setSavedLevels({
          level1: data.levels.level1 ?? null,
          level2: data.levels.level2 ?? null,
          level3: data.levels.level3 ?? null,
        });
        setLevels({
          level1: data.levels.level1 ?? null,
          level2: data.levels.level2 ?? null,
          level3: data.levels.level3 ?? null,
        });
      }

      onMessage("✅ Level-wise commissions saved — अगली eligible commission से लागू होंगी।");
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  function resetDefaults() {
    if (
      dirty &&
      !window.confirm("Saved values को हटाकर flat rules value पर लौटें?")
    ) {
      return;
    }

    // "Reset to default" = clear overrides (fallback to flat rules %).
    if (!isSuper) {
      onMessage("❌ केवल Super Admin overrides reset कर सकता है।");
      return;
    }

    setSaving(true);

    fetch(`${API}/api/admin/mlm/level-commissions`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ level1: 0, level2: 0, level3: 0 }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) {
          onMessage("ℹ️ Overrides cleared — अब flat rules value लागू।");
          setLevels({ level1: null, level2: null, level3: null });
          setSavedLevels({ level1: null, level2: null, level3: null });
        } else {
          onMessage(`❌ ${data?.message || "Reset failed."}`);
        }
      })
      .catch(() => onMessage("❌ Network error."))
      .finally(() => setSaving(false));
  }

  if (loading) {
    return (
      <div className="ov-skeleton-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="ov-skeleton" />
        ))}
      </div>
    );
  }

  const LEVEL_LABELS = {
    level1: "Level 1 (Direct members)",
    level2: "Level 2 (Indirect)",
    level3: "Level 3 (Extended)",
  };

  return (
    <div className="sec-wrap">
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>📈 Level-wise Commission</h2>
            <p>
              हर level का commission % अलग से set करें। खाली field = existing
              flat rules value (current behaviour unchanged)।
            </p>
          </div>
        </div>

        <div className="cm-grid3">
          {["level1", "level2", "level3"].map((key) => (
            <div key={key} className="ov-kpi" style={{ padding: "16px" }}>
              <strong style={{ fontSize: "13px" }}>{LEVEL_LABELS[key]}</strong>
              <div style={{ display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" }}>
                <input
                  type="number"
                  className="cm-input"
                  min="0"
                  max="100"
                  step="0.5"
                  placeholder="— (flat rules)"
                  value={levels[key] ?? ""}
                  disabled={!isSuper}
                  onChange={(e) => setLevel(key, e.target.value)}
                />
                <span>%</span>
              </div>
              {errors[key] ? (
                <div className="cm-error" style={{ marginTop: "6px" }}>
                  {errors[key]}
                </div>
              ) : null}
              {savedLevels[key] !== null && levels[key] === savedLevels[key] ? (
                <small className="cm-field-hint" style={{ display: "block", marginTop: "4px" }}>
                  Saved: {savedLevels[key]}%
                </small>
              ) : null}
            </div>
          ))}
        </div>

        {!isSuper && (
          <p className="ov-note">
            🔒 केवल Super Admin level commissions edit कर सकता है।
          </p>
        )}

        <div className="cm-actions">
          <button
            type="button"
            className="approve"
            onClick={save}
            disabled={saving || !isSuper || Object.values(errors).some(Boolean)}
          >
            {saving ? "Saving…" : "✓ Save"}
          </button>
          <button
            type="button"
            className="refresh-btn"
            onClick={() => {
              setLevels({ ...savedLevels });
              setErrors({});
            }}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="refresh-btn"
            onClick={resetDefaults}
            disabled={saving || !isSuper}
          >
            ↺ Reset overrides
          </button>
          {dirty ? <span className="cm-dirtytag">● Unsaved changes</span> : null}
        </div>

        <p className="ov-note">
          Existing 3-direct-member limit और spillover rules इस change से
          प्रभावित नहीं होते — केवल percentage values बदलती हैं। Commission
          release वही existing eligibility/return-window logic follow करता है।
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------
// LEVEL-WISE GIFTS MANAGER
// family_gifts table (additive) — admin CRUD, members read via
// GET /api/family/gifts (active only).
// ---------------------------------------------------------

const GIFT_EMPTY = { level: 1, name: "", description: "", eligibility: "", active: true };

function FamilyGiftsManager({ token, onMessage }) {
  const [gifts, setGifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // null | "new" | id
  const [draft, setDraft] = useState({ ...GIFT_EMPTY });
  const [errors, setErrors] = useState({});

  async function reload() {
    setLoading(true);

    try {
      const response = await fetch(`${API}/api/admin/family/gifts`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Load failed.");
      }

      setGifts(data.gifts || []);
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function validate(d) {
    const e = {};

    if (!d.name.trim()) e.name = "Gift name required.";
    else if (d.name.length > 120) e.name = "Max 120 characters.";

    if (d.eligibility.length > 200) e.eligibility = "Max 200 characters.";
    if (d.description.length > 500) e.description = "Max 500 characters.";

    return e;
  }

  async function save() {
    const e = validate(draft);

    setErrors(e);

    if (Object.keys(e).length) return;

    setSaving(true);

    const isNew = editing === "new";
    const url = isNew
      ? `${API}/api/admin/family/gifts`
      : `${API}/api/admin/family/gifts/${editing}`;

    try {
      const response = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          level: Number(draft.level),
          name: draft.name.trim(),
          description: draft.description.trim(),
          eligibility: draft.eligibility.trim(),
          active: draft.active,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Save failed.");
      }

      onMessage(isNew ? "✅ Gift added." : "✅ Gift updated.");
      setEditing(null);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(gift) {
    try {
      const response = await fetch(`${API}/api/admin/family/gifts/${gift.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ active: !gift.active }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Update failed.");
      }

      onMessage(`✅ Gift ${gift.active ? "inactive" : "active"} कर दिया।`);
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  async function remove(gift) {
    if (!window.confirm(`Delete gift “${gift.name}”?`)) return;

    try {
      const response = await fetch(`${API}/api/admin/family/gifts/${gift.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(data?.message || "Delete failed.");
      }

      onMessage("✅ Gift deleted.");
      reload();
    } catch (error) {
      onMessage(`❌ ${error.message}`);
    }
  }

  if (loading) {
    return (
      <div className="ov-skeleton-grid">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="ov-skeleton" />
        ))}
      </div>
    );
  }

  return (
    <div className="sec-wrap">
      <section className="products-section">
        <div className="section-title">
          <div>
            <h2>🎁 Level-wise Gifts</h2>
            <p>
              JustBrand Family levels (1–3) के gifts configure करें। Active
              gifts members को Family pages पर दिखते हैं।
            </p>
          </div>
          {editing === null && (
            <button
              className="approve"
              onClick={() => {
                setDraft({ ...GIFT_EMPTY });
                setErrors({});
                setEditing("new");
              }}
            >
              ＋ Add gift
            </button>
          )}
        </div>

        {editing === "new" ? (
          <div className="cm-bannerform">
            <div className="cm-grid2">
              <label className="cm-field">
                <span className="cm-field-label">Level *</span>
                <select
                  className="cm-input"
                  value={draft.level}
                  onChange={(e) => setDraft({ ...draft, level: Number(e.target.value) })}
                >
                  <option value={1}>Level 1</option>
                  <option value={2}>Level 2</option>
                  <option value={3}>Level 3</option>
                </select>
              </label>
              <label className="cm-field">
                <span className="cm-field-label">Gift name *</span>
                <input
                  className="cm-input"
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
            </div>
            <label className="cm-field">
              <span className="cm-field-label">Description</span>
              <textarea
                className="cm-input"
                rows={2}
                maxLength={500}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="cm-field">
              <span className="cm-field-label">Eligibility condition</span>
              <input
                className="cm-input"
                maxLength={200}
                placeholder="e.g. 10 direct members जोड़ने पर"
                value={draft.eligibility}
                onChange={(e) => setDraft({ ...draft, eligibility: e.target.value })}
              />
            </label>
            <label className="cm-checkline">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
              />
              Active (members को दिखे)
            </label>
            {Object.values(errors).some(Boolean) ? (
              <div className="cm-error">
                {Object.values(errors).filter(Boolean).join(" ")}
              </div>
            ) : null}
            <div className="cm-actions">
              <button className="approve" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "✓ Save"}
              </button>
              <button className="refresh-btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="sec-tablewrap">
          {gifts.length === 0 ? (
            <div className="empty">
              कोई gift configure नहीं है — “＋ Add gift” से पहला gift जोड़ें।
            </div>
          ) : (
            <table className="sec-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Gift</th>
                  <th>Description</th>
                  <th>Eligibility</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {gifts.map((gift) =>
                  editing === gift.id ? (
                    <tr key={gift.id}>
                      <td colSpan={6}>
                        <div className="cm-bannerform">
                          <div className="cm-grid2">
                            <label className="cm-field">
                              <span className="cm-field-label">Level *</span>
                              <select
                                className="cm-input"
                                value={draft.level}
                                onChange={(e) =>
                                  setDraft({ ...draft, level: Number(e.target.value) })
                                }
                              >
                                <option value={1}>Level 1</option>
                                <option value={2}>Level 2</option>
                                <option value={3}>Level 3</option>
                              </select>
                            </label>
                            <label className="cm-field">
                              <span className="cm-field-label">Gift name *</span>
                              <input
                                className="cm-input"
                                value={draft.name}
                                maxLength={120}
                                onChange={(e) =>
                                  setDraft({ ...draft, name: e.target.value })
                                }
                              />
                            </label>
                          </div>
                          <label className="cm-field">
                            <span className="cm-field-label">Description</span>
                            <textarea
                              className="cm-input"
                              rows={2}
                              maxLength={500}
                              value={draft.description}
                              onChange={(e) =>
                                setDraft({ ...draft, description: e.target.value })
                              }
                            />
                          </label>
                          <label className="cm-field">
                            <span className="cm-field-label">Eligibility condition</span>
                            <input
                              className="cm-input"
                              maxLength={200}
                              value={draft.eligibility}
                              onChange={(e) =>
                                setDraft({ ...draft, eligibility: e.target.value })
                              }
                            />
                          </label>
                          <label className="cm-checkline">
                            <input
                              type="checkbox"
                              checked={draft.active}
                              onChange={(e) =>
                                setDraft({ ...draft, active: e.target.checked })
                              }
                            />
                            Active
                          </label>
                          {Object.values(errors).some(Boolean) ? (
                            <div className="cm-error">
                              {Object.values(errors).filter(Boolean).join(" ")}
                            </div>
                          ) : null}
                          <div className="cm-actions">
                            <button className="approve" onClick={save} disabled={saving}>
                              {saving ? "Saving…" : "✓ Save"}
                            </button>
                            <button
                              className="refresh-btn"
                              onClick={() => setEditing(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={gift.id}>
                      <td>
                        <span className="sec-tag">L{gift.level}</span>
                      </td>
                      <td>
                        <strong>{gift.name}</strong>
                      </td>
                      <td>{gift.description || "—"}</td>
                      <td>{gift.eligibility || "—"}</td>
                      <td>
                        <span
                          className={`sec-tag ${gift.active ? "sec-tag-good" : "sec-tag-bad"}`}
                        >
                          {gift.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                          <button
                            className="refresh-btn"
                            onClick={() => {
                              setDraft({
                                level: gift.level,
                                name: gift.name,
                                description: gift.description || "",
                                eligibility: gift.eligibility || "",
                                active: !!gift.active,
                              });
                              setErrors({});
                              setEditing(gift.id);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="refresh-btn"
                            onClick={() => toggleActive(gift)}
                          >
                            {gift.active ? "Hide" : "Show"}
                          </button>
                          <button className="reject" onClick={() => remove(gift)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

export { LevelCommissionsEditor, FamilyGiftsManager };
