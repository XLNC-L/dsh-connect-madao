window.__ModuleLoader__.load({
	id: "dsh-connect-madao",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
// src/client/Panel.tsx
const { useCallback, useEffect, useState } = require("react");
// src/client/bridge.ts
var BRIDGE_PORT = 8765;
var BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;
async function bridgeJson(path, timeoutMs = 8e3) {
  return request("GET", path, void 0, timeoutMs);
}
async function bridgePost(path, body, timeoutMs = 15e3) {
  return request("POST", path, body, timeoutMs);
}
async function request(method, path, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BRIDGE_BASE}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        ...body === void 0 ? {} : { "Content-Type": "application/json" }
      },
      ...body === void 0 ? {} : { body: JSON.stringify(body) }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// src/client/Panel.tsx
const { Fragment, jsx, jsxs } = require("react/jsx-runtime");
var FALLBACK_MODELS = [
  { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash", context: 1048576, maxOutput: 65536, ratio: "0.18x" },
  { id: "deepseek-v4.1-flash-1017", name: "DeepSeek-V4.1-Flash-1017", context: 1048576, maxOutput: 65536, ratio: "0.18x" },
  { id: "glm-5.3", name: "GLM-5.3", context: 1048576, maxOutput: 65536, ratio: "0.79x" },
  { id: "glm-5.3-flash", name: "GLM-5.3-Flash", context: 1048576, maxOutput: 65536, ratio: "0.08x" },
  { id: "GLM-5.2", name: "GLM-5.2", context: 202752, maxOutput: 65536, ratio: "0.7x" },
  { id: "glm-5.2-sft-harmony", name: "GLM-5.2-ArkTS-SPARK", context: 202752, maxOutput: 65535, ratio: "0.7x" },
  { id: "kimi-k3", name: "Kimi-K3", context: 1048576, maxOutput: 65536, ratio: "2.38x" },
  { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro", context: 1048576, maxOutput: 65536, ratio: "1.63x" },
  { id: "openpangu-2.0-pro", name: "OpenPangu-2.0-Pro", context: 524288, maxOutput: 65535, ratio: "0.7x" },
  { id: "openpangu-2.0-flash", name: "OpenPangu-2.0-Flash", context: 524288, maxOutput: 65535, ratio: "0.32x" },
  { id: "speed", name: "\u667A\u901F\u6A21\u5F0F", context: 1048576, maxOutput: 65536, ratio: "0.18x" }
];
var S = {
  root: {
    border: "1px solid var(--dsh-border, #333)",
    borderRadius: 10,
    padding: 16,
    fontFamily: "inherit",
    fontSize: 13,
    color: "var(--dsh-fg, #ddd)"
  },
  // 账号详情区块
  section: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: "1px solid var(--dsh-border, #333)"
  },
  sectionTitle: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 8
  },
  detailGrid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "5px 14px",
    alignItems: "center"
  },
  detailKey: { fontSize: 11, opacity: 0.55 },
  detailVal: { fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" },
  miniBtn: {
    background: "none",
    border: "1px solid var(--dsh-border, #333)",
    borderRadius: 5,
    color: "inherit",
    fontSize: 11,
    padding: "1px 8px",
    cursor: "pointer"
  },
  header: { display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 },
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "linear-gradient(135deg,#c7000b,#ff6a00)",
    flex: "0 0 auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#fff",
    fontWeight: 700,
    fontSize: 15
  },
  title: { fontSize: 15, fontWeight: 600, margin: 0 },
  sub: { fontSize: 12, opacity: 0.65, margin: "3px 0 0" },
  tabs: { display: "flex", gap: 4, borderBottom: "1px solid var(--dsh-border, #333)", marginBottom: 14 },
  tab: (active) => ({
    padding: "7px 12px",
    cursor: "pointer",
    background: "transparent",
    border: "none",
    borderBottom: active ? "2px solid #c7000b" : "2px solid transparent",
    color: active ? "var(--dsh-fg,#fff)" : "var(--dsh-muted,#888)",
    fontWeight: active ? 600 : 400,
    fontSize: 13,
    fontFamily: "inherit"
  }),
  field: { marginBottom: 12 },
  label: { display: "block", marginBottom: 5, fontSize: 12, opacity: 0.8 },
  input: {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 6,
    border: "1px solid var(--dsh-border, #3a3a3a)",
    background: "var(--dsh-input-bg, #1b1b1b)",
    color: "inherit",
    fontFamily: "monospace",
    fontSize: 12,
    boxSizing: "border-box"
  },
  row: { display: "flex", gap: 8, alignItems: "center", marginTop: 12 },
  btn: (primary) => ({
    padding: "7px 14px",
    borderRadius: 6,
    cursor: "pointer",
    border: primary ? "none" : "1px solid var(--dsh-border,#3a3a3a)",
    background: primary ? "#c7000b" : "transparent",
    color: primary ? "#fff" : "inherit",
    fontSize: 12,
    fontFamily: "inherit"
  }),
  hint: { fontSize: 12, opacity: 0.6, lineHeight: 1.6, margin: "0 0 14px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "7px 8px", borderBottom: "1px solid var(--dsh-border,#333)", opacity: 0.7, fontWeight: 500 },
  td: { padding: "7px 8px", borderBottom: "1px solid var(--dsh-border,#2a2a2a)" },
  step: (state) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    fontSize: 12
  }),
  dot: (state) => ({
    width: 7,
    height: 7,
    borderRadius: "50%",
    flex: "0 0 auto",
    background: state === "ok" ? "#2ea043" : state === "fail" ? "#d1242f" : state === "run" ? "#d29922" : "#555"
  }),
  kv: { display: "grid", gridTemplateColumns: "110px 1fr", gap: "6px 12px", fontSize: 12, lineHeight: 1.7 },
  kvk: { opacity: 0.6 }
};
function CodeArtsPanel({ t }) {
  const [tab, setTab] = useState("account");
  const [ak, setAk] = useState("");
  const [sk, setSk] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [models, setModels] = useState(FALLBACK_MODELS);
  const [diag, setDiag] = useState({});
  const [diagRunning, setDiagRunning] = useState(false);
  const [acct, setAcct] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const [checkinBusy, setCheckinBusy] = useState(false);
  const loadCheckin = useCallback(async () => {
    try {
      setCheckin(await bridgeJson("/diag/checkin", 3e4));
    } catch {
      setCheckin(null);
    }
  }, []);
  const loadAccount = useCallback(async () => {
    try {
      setAcct(await bridgeJson("/diag/account", 2e4));
    } catch {
      setAcct(null);
    }
  }, []);
  const doCheckin = useCallback(async () => {
    if (checkinBusy) return;
    setCheckinBusy(true);
    try {
      const r = await bridgePost("/diag/checkin", {}, 6e4);
      setCheckin(r);
      void loadAccount();
    } catch (e) {
      setCheckin({ ok: false, reason: String(e?.message ?? e) });
    } finally {
      setCheckinBusy(false);
    }
  }, [checkinBusy, loadAccount]);
  useEffect(() => {
    void loadAccount();
    void loadCheckin();
  }, [loadAccount, loadCheckin]);
  const saveCredentials = useCallback(async () => {
    if (saving) return;
    if (!ak.trim() || !sk.trim()) {
      setTestResult({ ok: false, message: t("account.needBoth") });
      return;
    }
    setSaving(true);
    try {
      const r = await bridgePost(
        "/diag/credentials",
        { ak: ak.trim(), sk: sk.trim() },
        3e4
      );
      setSaved(true);
      setAk("");
      setSk("");
      setTestResult(
        r.warning ? { ok: false, message: r.warning } : { ok: true, message: t("account.saveOk", { source: r.source ?? "file" }) }
      );
      void loadAccount();
    } catch (e) {
      setTestResult({ ok: false, message: `${t("account.saveFail")} \xB7 ${String(e?.message ?? e)}` });
    } finally {
      setSaving(false);
    }
  }, [ak, sk, saving, loadAccount, t]);
  useEffect(() => {
    let cancelled = false;
    bridgeJson("/v1/models").then((j) => {
      if (cancelled || !j?.data) return;
      setModels(
        j.data.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          context: m.context_window ?? 0,
          maxOutput: m.max_output_tokens ?? 0,
          ratio: m.ratio,
          supportsImages: m.supports_images === true,
          strengths: m.strengths ?? [],
          description: void 0
        }))
      );
    }).catch(() => {
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const runDiag = useCallback(async () => {
    setDiagRunning(true);
    setDiag({ credentials: "run", sts: "run", handshake: "run", models: "run", chat: "run" });
    try {
      const j = await bridgeJson(
        "/diag/test",
        9e4
      );
      const byName = (kw) => j.steps?.find((s) => s.name.includes(kw));
      const map = (kw) => {
        const s = byName(kw);
        return s ? s.ok ? "ok" : "fail" : "fail";
      };
      setDiag({
        credentials: map("\u51ED\u8BC1"),
        sts: map("\u51ED\u8BC1"),
        // 凭证一步已包含 STS 换取
        handshake: map("\u534F\u5546"),
        models: map("\u6A21\u578B"),
        chat: j.ok ? "ok" : "fail"
      });
      if (!j.ok) {
        console.warn("[dsh-connect-madao] diag steps", j.steps);
      }
    } catch (e) {
      setDiag({ credentials: "fail", sts: "fail", handshake: "fail", models: "fail", chat: "fail" });
      console.warn("[dsh-connect-madao] diag failed", e);
    } finally {
      setDiagRunning(false);
    }
  }, []);
  const testConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const j = await bridgeJson(
        "/diag/test",
        9e4
      );
      const steps = j.steps ?? [];
      if (j.ok) {
        setTestResult({ ok: true, message: `${t("account.ok")} \xB7 ${steps.length} \u6B65\u5168\u901A` });
      } else {
        const bad = steps.find((s) => !s.ok);
        setTestResult({
          ok: false,
          message: `${t("account.fail")} \xB7 ${bad ? `${bad.name}\uFF1A${bad.detail ?? ""}` : "\u672A\u77E5\u6B65\u9AA4"}`
        });
      }
    } catch (err) {
      setTestResult({ ok: false, message: `${t("account.fail")} \xB7 ${String(err)}` });
    } finally {
      setTesting(false);
    }
  }, [t]);
  const tabBtn = (id, label) => /* @__PURE__ */ jsx("button", { style: S.tab(tab === id), onClick: () => setTab(id), children: label }, id);
  return /* @__PURE__ */ jsxs("div", { style: S.root, children: [
    /* @__PURE__ */ jsxs("div", { style: S.header, children: [
      /* @__PURE__ */ jsx("div", { style: S.logo, children: "\u7801" }),
      /* @__PURE__ */ jsxs("div", { style: { flex: 1 }, children: [
        /* @__PURE__ */ jsx("h3", { style: S.title, children: t("meta.title") }),
        /* @__PURE__ */ jsx("p", { style: S.sub, children: t("meta.desc") })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { style: S.tabs, children: [
      tabBtn("account", t("tab.account")),
      tabBtn("models", t("tab.models")),
      tabBtn("diagnostics", t("tab.diagnostics")),
      tabBtn("about", t("tab.about"))
    ] }),
    tab === "account" && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("div", { style: S.section, children: [
        /* @__PURE__ */ jsx("div", { style: S.sectionTitle, children: t("account.sourceTitle") }),
        /* @__PURE__ */ jsx("p", { style: { ...S.hint, marginTop: 0 }, children: t("account.sourceDesc") }),
        (() => {
          const src = acct?.source;
          const temp = acct?.temporary === true;
          const exp = typeof acct?.expiresAtMs === "number" ? acct.expiresAtMs : null;
          const leftMs = exp ? exp - Date.now() : null;
          const leftMin = leftMs !== null ? Math.round(leftMs / 6e4) : null;
          const expired = temp && leftMs !== null && leftMs <= 0;
          const urgent = temp && !expired && leftMs !== null && leftMs <= 10 * 6e4;
          const rows = [
            { key: "env", label: t("account.sourceEnv"), active: src === "env" },
            { key: "file", label: t("account.sourceFile"), active: src === "file" },
            {
              key: "codearts",
              label: t("account.sourceCodearts"),
              extra: temp ? expired ? t("account.sourceExpired") : leftMs !== null ? leftMs < 6e4 ? t("account.sourceTempSec", { n: Math.max(0, Math.round(leftMs / 1e3)) }) : urgent ? t("account.sourceTempSoon", { n: leftMin ?? 0 }) : t("account.sourceTemp", { n: leftMin ?? 0 }) : void 0 : void 0,
              active: src === "codearts"
            }
          ];
          return /* @__PURE__ */ jsx("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: rows.map((r, i) => /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                padding: "6px 8px",
                borderRadius: 6,
                background: r.active ? "rgba(46,160,67,0.10)" : "transparent",
                border: r.active ? "1px solid rgba(46,160,67,0.35)" : "1px solid transparent",
                color: r.active ? "inherit" : "var(--fg-muted, #8b949e)"
              },
              children: [
                /* @__PURE__ */ jsxs("span", { style: { opacity: 0.6, minWidth: 14 }, children: [
                  i + 1,
                  "."
                ] }),
                /* @__PURE__ */ jsx("span", { style: { flex: 1 }, children: r.label }),
                r.extra && /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      fontSize: 11,
                      fontWeight: expired || urgent ? 600 : 400,
                      color: expired ? "#d1242f" : urgent ? "#d1242f" : "#d29922"
                    },
                    children: r.extra
                  }
                ),
                r.active && /* @__PURE__ */ jsx("span", { style: { fontSize: 11, color: "#2ea043", fontWeight: 600 }, children: t("account.sourceActive") })
              ]
            },
            r.key
          )) });
        })(),
        /* @__PURE__ */ jsx("p", { style: { ...S.hint, marginBottom: 0 }, children: acct?.temporary === true ? t("account.sourceTempNote") : t("account.sourcePermNote") }),
        /* @__PURE__ */ jsxs("details", { style: { marginTop: 10 }, children: [
          /* @__PURE__ */ jsx("summary", { style: { fontSize: 12, cursor: "pointer", opacity: 0.85 }, children: t("account.howToGetAk") }),
          /* @__PURE__ */ jsx("p", { style: { ...S.hint, marginTop: 6, marginBottom: 0 }, children: t("account.howToGetAkSteps") })
        ] }),
        /* @__PURE__ */ jsxs("details", { style: { marginTop: 6 }, children: [
          /* @__PURE__ */ jsx("summary", { style: { fontSize: 12, cursor: "pointer", opacity: 0.85 }, children: t("account.howCodeartsWorks") }),
          /* @__PURE__ */ jsx("p", { style: { ...S.hint, marginTop: 6, marginBottom: 0 }, children: t("account.howCodeartsWorksDesc") })
        ] })
      ] }),
      /* @__PURE__ */ jsx("p", { style: S.hint, children: t("account.hint") }),
      /* @__PURE__ */ jsxs("div", { style: S.field, children: [
        /* @__PURE__ */ jsx("label", { style: S.label, children: t("account.ak") }),
        /* @__PURE__ */ jsx(
          "input",
          {
            style: S.input,
            value: ak,
            placeholder: saved ? t("account.masked") : "HPUA\u2026",
            onChange: (e) => setAk(e.target.value),
            spellCheck: false
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { style: S.field, children: [
        /* @__PURE__ */ jsx("label", { style: S.label, children: t("account.sk") }),
        /* @__PURE__ */ jsx(
          "input",
          {
            style: S.input,
            type: "password",
            value: sk,
            placeholder: saved ? t("account.masked") : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022",
            onChange: (e) => setSk(e.target.value),
            spellCheck: false
          }
        )
      ] }),
      /* @__PURE__ */ jsxs("div", { style: S.row, children: [
        /* @__PURE__ */ jsx("button", { style: S.btn(true), onClick: saveCredentials, disabled: saving, children: saving ? t("account.saving") : saved ? t("account.saved") : t("account.save") }),
        /* @__PURE__ */ jsx("button", { style: S.btn(false), onClick: testConnection, disabled: testing, children: testing ? t("account.testing") : t("account.test") }),
        testResult && /* @__PURE__ */ jsx("span", { style: { fontSize: 12, color: testResult.ok ? "#2ea043" : "#d1242f" }, children: testResult.message })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: S.section, children: [
        /* @__PURE__ */ jsxs("div", { style: S.sectionTitle, children: [
          t("account.current"),
          /* @__PURE__ */ jsx("button", { style: S.miniBtn, onClick: () => void loadAccount(), children: t("account.refresh") })
        ] }),
        acct ? /* @__PURE__ */ jsxs("div", { style: S.detailGrid, children: [
          /* @__PURE__ */ jsx("span", { style: S.detailKey, children: t("account.user") }),
          /* @__PURE__ */ jsx("span", { style: S.detailVal, children: acct.account ?? "\u2014" }),
          /* @__PURE__ */ jsx("span", { style: S.detailKey, children: "AK" }),
          /* @__PURE__ */ jsx("span", { style: S.detailVal, children: acct.ak ?? "\u2014" }),
          /* @__PURE__ */ jsx("span", { style: S.detailKey, children: "SK" }),
          /* @__PURE__ */ jsx("span", { style: S.detailVal, children: acct.sk ?? "\u2014" }),
          /* @__PURE__ */ jsx("span", { style: S.detailKey, children: "STS" }),
          /* @__PURE__ */ jsx("span", { style: S.detailVal, children: acct.sts && typeof acct.sts === "object" ? `${new Date(acct.sts.expiresAt).toLocaleString()} \xB7 \u5269 ${acct.sts.ttlSec}s` : acct.sts ?? "\u2014" }),
          /* @__PURE__ */ jsx("span", { style: S.detailKey, children: "keyId" }),
          /* @__PURE__ */ jsx("span", { style: S.detailVal, children: acct.sessionKey?.keyId ?? "\u2014" }),
          acct.credit ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx("span", { style: S.detailKey, children: t("account.credit") }),
            /* @__PURE__ */ jsxs("span", { style: S.detailVal, children: [
              acct.credit.remain,
              " / ",
              acct.credit.total,
              "\uFF08",
              t("account.used"),
              " ",
              acct.credit.used,
              "\uFF09"
            ] })
          ] }) : null
        ] }) : /* @__PURE__ */ jsx("div", { style: S.hint, children: t("account.noState") })
      ] }),
      /* @__PURE__ */ jsxs("div", { style: S.section, children: [
        /* @__PURE__ */ jsx("div", { style: S.sectionTitle, children: t("account.checkin") }),
        checkin && checkin.available !== false ? /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
          /* @__PURE__ */ jsx("span", { style: { flex: 1, fontSize: 12 }, children: checkin.status === "CLAIMED" || checkin.status === "CONFIRMED" ? t("checkin.done", { n: checkin.amount ?? 100 }) : checkin.claimable ? t("checkin.available", { n: checkin.pendingAmount ?? 100 }) : t("checkin.idle") }),
          checkin.claimable ? /* @__PURE__ */ jsx("button", { style: S.btn(true), onClick: () => void doCheckin(), disabled: checkinBusy, children: checkinBusy ? t("checkin.doing") : t("checkin.claim") }) : null
        ] }) : /* @__PURE__ */ jsx("div", { style: S.hint, children: checkin?.reason ?? t("checkin.unavailable") })
      ] })
    ] }),
    tab === "models" && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("p", { style: S.hint, children: t("models.hint", { n: models.length }) }),
      /* @__PURE__ */ jsxs("table", { style: S.table, children: [
        /* @__PURE__ */ jsx("thead", { children: /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("th", { style: S.th, children: t("models.name") }),
          /* @__PURE__ */ jsx("th", { style: S.th, children: "model_id" }),
          /* @__PURE__ */ jsx("th", { style: S.th, children: t("models.context") }),
          /* @__PURE__ */ jsx("th", { style: S.th, children: t("models.output") }),
          /* @__PURE__ */ jsx("th", { style: S.th, title: t("models.ratioHint"), children: t("models.ratio") }),
          /* @__PURE__ */ jsx("th", { style: S.th, title: t("models.visionHint"), children: "\u{1F441}" }),
          /* @__PURE__ */ jsx("th", { style: S.th, title: t("models.thinkHint"), children: t("models.think") })
        ] }) }),
        /* @__PURE__ */ jsx("tbody", { children: models.map((m) => /* @__PURE__ */ jsxs("tr", { children: [
          /* @__PURE__ */ jsx("td", { style: S.td, title: m.description ?? void 0, children: m.name }),
          /* @__PURE__ */ jsx("td", { style: { ...S.td, fontFamily: "monospace", opacity: 0.65, fontSize: 11 }, children: m.id }),
          /* @__PURE__ */ jsx("td", { style: S.td, children: (m.context ?? m.context_window ?? 0).toLocaleString() }),
          /* @__PURE__ */ jsx("td", { style: S.td, children: (m.maxOutput ?? m.max_output_tokens ?? 0).toLocaleString() }),
          /* @__PURE__ */ jsx("td", { style: { ...S.td, fontFamily: "monospace" }, children: m.ratio ?? "\u2014" }),
          /* @__PURE__ */ jsx("td", { style: S.td, title: m.supportsImages ?? m.supports_images ? t("models.visionYes") : t("models.visionNo"), children: m.supportsImages ?? m.supports_images ? "\u{1F441}" : /* @__PURE__ */ jsx("span", { style: { opacity: 0.25 }, children: "\u2014" }) }),
          /* @__PURE__ */ jsx("td", { style: { ...S.td, fontSize: 11, opacity: m.strengths?.length ? 1 : 0.25 }, children: m.strengths?.length ? m.strengths.join(" / ") : "\u2014" })
        ] }, m.id)) })
      ] })
    ] }),
    tab === "diagnostics" && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { style: S.row, children: /* @__PURE__ */ jsx("button", { style: S.btn(true), onClick: runDiag, disabled: diagRunning, children: diagRunning ? t("diag.running") : t("diag.run") }) }),
      /* @__PURE__ */ jsx("div", { style: { marginTop: 12 }, children: [
        ["credentials", t("diag.credentials")],
        ["sts", t("diag.sts")],
        ["handshake", t("diag.handshake")],
        ["models", t("diag.models")],
        ["chat", t("diag.chat")]
      ].map(([key, label]) => /* @__PURE__ */ jsxs("div", { style: S.step(diag[key] ?? "idle"), children: [
        /* @__PURE__ */ jsx("span", { style: S.dot(diag[key] ?? "idle") }),
        /* @__PURE__ */ jsx("span", { style: { flex: 1 }, children: label }),
        /* @__PURE__ */ jsx("span", { style: { opacity: 0.5, fontSize: 11 }, children: diag[key] === "ok" ? "\u2713" : diag[key] === "fail" ? "\u2717" : diag[key] === "run" ? "\u2026" : "\u2014" })
      ] }, key)) })
    ] }),
    tab === "about" && /* @__PURE__ */ jsx("div", { children: /* @__PURE__ */ jsxs("div", { style: S.kv, children: [
      /* @__PURE__ */ jsx("span", { style: S.kvk, children: t("about.protocol") }),
      /* @__PURE__ */ jsx("span", { children: "OpenAI Chat Completions \u517C\u5BB9 \xB7 /api/v2/chat/completions" }),
      /* @__PURE__ */ jsx("span", { style: S.kvk, children: t("about.auth") }),
      /* @__PURE__ */ jsx("span", { children: "SDK-HMAC-SHA256\uFF08AK + SK + STS\uFF09" }),
      /* @__PURE__ */ jsx("span", { style: S.kvk, children: t("about.encrypt") }),
      /* @__PURE__ */ jsx("span", { children: "P-256 ECDH \u534F\u5546 + SM4-GCM \u8F7D\u8377\u52A0\u5BC6" }),
      /* @__PURE__ */ jsx("span", { style: S.kvk, children: "Gateway" }),
      /* @__PURE__ */ jsx("span", { style: { fontFamily: "monospace", fontSize: 11 }, children: "snap-access.cn-north-4.myhuaweicloud.com" })
    ] }) })
  ] });
}

// src/client/ComposerChip.tsx
const { useCallback: useCallback2, useEffect: useEffect2, useRef, useState: useState2 } = require("react");
const { Fragment: Fragment2, jsx: jsx2, jsxs: jsxs2 } = require("react/jsx-runtime");
function fmt(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "\u2014";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}
function ComposerChip({ t }) {
  const [health, setHealth] = useState2(null);
  const [account, setAccount] = useState2(null);
  const [open, setOpen] = useState2(false);
  const [busy, setBusy] = useState2(false);
  const [steps, setSteps] = useState2(null);
  const boxRef = useRef(null);
  const refreshHealth = useCallback2(async () => {
    try {
      setHealth(await bridgeJson("/healthz"));
    } catch {
      setHealth({ ok: false, stage: "offline" });
    }
  }, []);
  const refreshAccount = useCallback2(async () => {
    try {
      setAccount(await bridgeJson("/diag/account", 2e4));
    } catch (e) {
      setAccount({ ok: false, stage: "offline", error: String(e) });
    }
  }, []);
  useEffect2(() => {
    let alive = true;
    refreshHealth();
    const timer = setInterval(() => {
      if (alive) refreshHealth();
    }, 6e4);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshHealth]);
  useEffect2(() => {
    if (open) void refreshAccount();
  }, [open, refreshAccount]);
  useEffect2(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const testAndRefresh = useCallback2(async () => {
    setBusy(true);
    setSteps(null);
    try {
      const r = await bridgeJson("/diag/test", 9e4);
      setSteps(r.steps ?? []);
      void refreshHealth();
      void refreshAccount();
    } catch (e) {
      setSteps([{ name: t("chip.test"), ok: false, detail: String(e) }]);
    } finally {
      setBusy(false);
    }
  }, [refreshAccount, refreshHealth, t]);
  const state = health?.ok ? "ready" : health ? "fail" : "idle";
  const label = state === "ready" ? t("chip.ready") : t("chip.idle");
  const credit = account?.credit;
  return /* @__PURE__ */ jsxs2("div", { ref: boxRef, style: { position: "relative", display: "inline-flex" }, children: [
    /* @__PURE__ */ jsxs2("button", { style: S2.chip(state), onClick: () => setOpen((v) => !v), title: t("meta.title"), children: [
      /* @__PURE__ */ jsx2("span", { style: S2.dot(state) }),
      label,
      credit ? /* @__PURE__ */ jsx2("span", { style: S2.mini, children: fmt(credit.remain) }) : null
    ] }),
    open && /* @__PURE__ */ jsxs2("div", { style: S2.pop, children: [
      /* @__PURE__ */ jsxs2("div", { style: S2.head, children: [
        /* @__PURE__ */ jsx2("span", { style: { fontWeight: 600 }, children: t("chip.account") }),
        /* @__PURE__ */ jsx2("span", { style: S2.badge(!!health?.ok), children: health?.ok ? t("chip.online") : t("chip.offline") })
      ] }),
      /* @__PURE__ */ jsxs2("div", { style: S2.account, children: [
        /* @__PURE__ */ jsx2("span", { style: S2.avatar, children: (account?.account ?? "?").slice(0, 1).toUpperCase() }),
        /* @__PURE__ */ jsxs2("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }, children: [
          /* @__PURE__ */ jsx2("span", { style: { fontFamily: "monospace", fontSize: 12 }, children: account?.account ?? "\u2014" }),
          account?.roles?.length ? /* @__PURE__ */ jsx2("span", { style: S2.sub, children: account.roles.join(", ") }) : null
        ] })
      ] }),
      /* @__PURE__ */ jsx2("div", { style: S2.sep }),
      /* @__PURE__ */ jsx2("div", { style: S2.head, children: /* @__PURE__ */ jsx2("span", { style: { fontWeight: 600 }, children: t("chip.credit") }) }),
      credit ? /* @__PURE__ */ jsxs2(Fragment2, { children: [
        /* @__PURE__ */ jsxs2("div", { style: S2.big, children: [
          fmt(credit.remain),
          /* @__PURE__ */ jsxs2("span", { style: S2.bigUnit, children: [
            " / ",
            fmt(credit.total)
          ] })
        ] }),
        /* @__PURE__ */ jsxs2("div", { style: S2.kv, children: [
          /* @__PURE__ */ jsx2("span", { style: S2.k, children: t("chip.used") }),
          /* @__PURE__ */ jsx2("span", { style: S2.mono, children: fmt(credit.used) }),
          credit.bonus ? /* @__PURE__ */ jsxs2(Fragment2, { children: [
            /* @__PURE__ */ jsx2("span", { style: S2.k, children: t("chip.bonus") }),
            /* @__PURE__ */ jsx2("span", { style: S2.mono, children: fmt(credit.bonus.remain) })
          ] }) : null,
          credit.basic ? /* @__PURE__ */ jsxs2(Fragment2, { children: [
            /* @__PURE__ */ jsx2("span", { style: S2.k, children: t("chip.basic") }),
            /* @__PURE__ */ jsx2("span", { style: S2.mono, children: fmt(credit.basic.remain) })
          ] }) : null
        ] })
      ] }) : /* @__PURE__ */ jsx2("div", { style: S2.hint, children: account?.error ?? t("chip.noCredit") }),
      /* @__PURE__ */ jsx2("div", { style: S2.sep }),
      /* @__PURE__ */ jsx2("button", { style: S2.testBtn(busy), disabled: busy, onClick: () => void testAndRefresh(), children: busy ? t("chip.testing") : t("chip.testRefresh") }),
      steps && /* @__PURE__ */ jsx2("div", { style: S2.steps, children: steps.map((s) => /* @__PURE__ */ jsxs2("div", { style: S2.stepRow, children: [
        /* @__PURE__ */ jsx2("span", { style: { color: s.ok ? "var(--dsh-color-success, #3fb950)" : "var(--dsh-color-danger, #f85149)" }, children: s.ok ? "\u2713" : "\u2717" }),
        /* @__PURE__ */ jsx2("span", { style: { flex: 1 }, children: s.name }),
        /* @__PURE__ */ jsx2("span", { style: S2.stepDetail, title: s.detail, children: s.detail ?? (s.ms ? `${s.ms}ms` : "") })
      ] }, s.name)) })
    ] })
  ] });
}
var S2 = {
  chip: (state) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    height: 26,
    padding: "0 9px",
    borderRadius: 13,
    border: "1px solid var(--dsh-color-border, rgba(255,255,255,.12))",
    background: "transparent",
    color: "inherit",
    fontSize: 12,
    cursor: "pointer",
    opacity: state === "idle" ? 0.6 : 1
  }),
  dot: (state) => ({
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: state === "ready" ? "var(--dsh-color-success, #3fb950)" : state === "fail" ? "var(--dsh-color-danger, #f85149)" : "var(--dsh-color-text-secondary, #8b949e)"
  }),
  mini: {
    marginLeft: 2,
    paddingLeft: 6,
    borderLeft: "1px solid var(--dsh-color-border, rgba(255,255,255,.12))",
    fontFamily: "monospace",
    fontSize: 11,
    opacity: 0.75
  },
  pop: {
    position: "absolute",
    bottom: "calc(100% + 8px)",
    right: 0,
    width: 288,
    padding: 12,
    borderRadius: 10,
    border: "1px solid var(--dsh-color-border, rgba(255,255,255,.12))",
    background: "var(--dsh-color-surface, #161b22)",
    boxShadow: "0 8px 28px rgba(0,0,0,.45)",
    color: "var(--dsh-color-text, #e6edf3)",
    fontSize: 12,
    zIndex: 50
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  badge: (ok) => ({
    fontSize: 10,
    padding: "1px 6px",
    borderRadius: 8,
    background: ok ? "rgba(63,185,80,.16)" : "rgba(248,81,73,.16)",
    color: ok ? "var(--dsh-color-success, #3fb950)" : "var(--dsh-color-danger, #f85149)"
  }),
  account: { display: "flex", alignItems: "center", gap: 8 },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: "50%",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(139,148,158,.22)",
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0
  },
  sub: { fontSize: 10, opacity: 0.5 },
  kv: { display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", alignItems: "center" },
  k: { opacity: 0.6, fontSize: 11 },
  mono: { fontFamily: "monospace", fontSize: 11 },
  big: { fontSize: 22, fontWeight: 600, fontVariantNumeric: "tabular-nums", marginBottom: 5 },
  bigUnit: { fontSize: 12, fontWeight: 400, opacity: 0.55 },
  sep: { height: 1, background: "var(--dsh-color-border, rgba(255,255,255,.12))", margin: "10px 0" },
  hint: { fontSize: 11, opacity: 0.6, lineHeight: 1.5 },
  testBtn: (busy) => ({
    width: "100%",
    height: 30,
    borderRadius: 7,
    border: "1px solid var(--dsh-color-border, rgba(255,255,255,.12))",
    background: "var(--dsh-color-surface-raised, rgba(255,255,255,.05))",
    color: "inherit",
    fontSize: 12,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1
  }),
  steps: { marginTop: 8, display: "flex", flexDirection: "column", gap: 3 },
  stepRow: { display: "flex", alignItems: "center", gap: 6, fontSize: 11 },
  stepDetail: { opacity: 0.55, fontFamily: "monospace", fontSize: 10, maxWidth: 140, textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
};

// src/client/index.ts
var name = "dsh-connect-madao-client";
var inject = ["slots", "locale"];
var zh = {
  "meta.title": "\u7801\u9053\u8FDE\u63A5\u5668",
  "meta.desc": "\u628A\u534E\u4E3A\u4E91\u7801\u9053\uFF08CodeArts Agent\uFF09\u6A21\u578B\u63A5\u5165 DSH",
  "tab.account": "\u8D26\u53F7",
  "tab.models": "\u6A21\u578B",
  "tab.diagnostics": "\u8BCA\u65AD",
  "tab.about": "\u5173\u4E8E",
  "account.title": "\u534E\u4E3A\u4E91\u51ED\u8BC1",
  "account.hint": "\u4E0D\u586B\u4E5F\u80FD\u7528\uFF1A\u88C5\u8FC7\u5E76\u767B\u5F55\u8FC7\u7801\u9053\u5BA2\u6237\u7AEF\u7684\u8BDD\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u501F\u7528\u5B83\u7684\u767B\u5F55\u6001\u3002\u586B\u4E0A\u6C38\u4E45 AK/SK \u5219\u4E00\u52B3\u6C38\u9038\uFF0C\u4E4B\u540E\u4E0D\u7528\u518D\u7BA1\u3002",
  "account.sourceTitle": "\u51ED\u8BC1\u4ECE\u54EA\u6765",
  "account.sourceDesc": "\u63D2\u4EF6\u6309\u4E0B\u9762\u7684\u987A\u5E8F\u627E\u51ED\u8BC1\uFF0C\u627E\u5230\u7B2C\u4E00\u4E2A\u80FD\u7528\u7684\u5C31\u7528\uFF0C\u4E0D\u9700\u8981\u4E09\u79CD\u90FD\u914D\u3002",
  "account.sourceEnv": "\u73AF\u5883\u53D8\u91CF MADAO_AK / MADAO_SK",
  "account.sourceFile": "\u4E0A\u9762\u586B\u5199\u7684\u6C38\u4E45 AK/SK",
  "account.sourceCodearts": "\u7801\u9053\u5BA2\u6237\u7AEF\u767B\u5F55\u6001\uFF08\u96F6\u914D\u7F6E\uFF09",
  "account.sourceActive": "\u5F53\u524D\u751F\u6548",
  "account.sourceTemp": "\u4E34\u65F6\u51ED\u8BC1\uFF0C\u5269 {n} \u5206\u949F",
  "account.sourceExpired": "\u5DF2\u8FC7\u671F \xB7 \u6253\u5F00\u4E00\u6B21\u7801\u9053\u8BA9\u5B83\u5237\u65B0\uFF0C\u518D\u70B9\u4E0A\u65B9\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D",
  "account.sourceTempSoon": "\u5373\u5C06\u8FC7\u671F\uFF0C\u5269 {n} \u5206\u949F \xB7 \u5EFA\u8BAE\u73B0\u5728\u6253\u5F00\u7801\u9053\u5237\u65B0\uFF0C\u6216\u6539\u586B\u6C38\u4E45 AK/SK",
  "account.sourceTempSec": "\u5269 {n} \u79D2\uFF0C\u5373\u5C06\u5931\u6548",
  "account.sourceTempNote": "\u4F60\u7528\u7684\u662F\u4ECE\u7801\u9053\u767B\u5F55\u6001\u501F\u6765\u7684\u4E34\u65F6\u51ED\u8BC1\uFF0C\u51E0\u5C0F\u65F6\u540E\u4F1A\u5931\u6548\u3002\u5931\u6548\u540E\uFF1A\u6253\u5F00\u4E00\u6B21\u7801\u9053\u5BA2\u6237\u7AEF\u8BA9\u5B83\u5237\u65B0\uFF0C\u518D\u70B9\u4E0A\u9762\u7684\u300C\u6D4B\u8BD5\u8FDE\u63A5\u300D\u5373\u53EF\u6062\u590D\u3002\u60F3\u514D\u53BB\u8FD9\u4E00\u6B65\uFF0C\u5C31\u586B\u4E0A\u9762\u7684\u6C38\u4E45 AK/SK \u2014\u2014 \u53EA\u914D\u4E00\u6B21\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u6362 STS \u5E76\u7EED\u671F\uFF0C\u4E4B\u540E\u4E0D\u7528\u518D\u7BA1\u3002",
  "account.sourcePermNote": "\u5F53\u524D\u7528\u7684\u662F\u6C38\u4E45\u51ED\u8BC1\uFF0C\u63D2\u4EF6\u4F1A\u81EA\u52A8\u6362\u53D6 STS \u5E76\u5728\u8FC7\u671F\u524D\u7EED\u671F\uFF0C\u65E0\u9700\u518D\u64CD\u4F5C\u3002",
  "account.howToGetAk": "\u600E\u4E48\u62FF\u5230 AK/SK",
  "account.howToGetAkSteps": "\u534E\u4E3A\u4E91\u63A7\u5236\u53F0 \u2192 \u53F3\u4E0A\u89D2\u8D26\u53F7\u540D \u2192 \u6211\u7684\u51ED\u8BC1 \u2192 \u8BBF\u95EE\u5BC6\u94A5 \u2192 \u65B0\u589E\u8BBF\u95EE\u5BC6\u94A5\u3002\u4E0B\u8F7D\u7684 credentials.csv \u91CC Access Key Id \u548C Secret Access Key \u5C31\u5BF9\u5E94\u4E0A\u9762\u4E24\u680F\uFF08Secret \u53EA\u5728\u521B\u5EFA\u65F6\u663E\u793A\u4E00\u6B21\uFF0C\u52A1\u5FC5\u4FDD\u5B58\uFF09\u3002\u4E0D\u9700\u8981\u586B STS\u3002",
  "account.howCodeartsWorks": "\u7B2C 3 \u9879\u662F\u600E\u4E48\u5DE5\u4F5C\u7684",
  "account.howCodeartsWorksDesc": '\u672C\u673A\u88C5\u8FC7\u7801\u9053\u5BA2\u6237\u7AEF\uFF08CodeArts Agent\uFF09\u5E76\u767B\u5F55\u8FC7\u7684\u8BDD\uFF0C\u63D2\u4EF6\u4F1A\u76F4\u63A5\u8BFB\u5B83\u5B58\u5728\u672C\u5730\u7684\u767B\u5F55\u6001\uFF0C\u4F60\u4EC0\u4E48\u90FD\u4E0D\u7528\u586B\u3002\u6CE8\u610F\uFF1A\u63D2\u4EF6\u81EA\u8EAB\u6CA1\u6709\u767B\u5F55\u5165\u53E3\uFF0C\u767B\u5F55\u8FD9\u4E2A\u52A8\u4F5C\u59CB\u7EC8\u5728\u7801\u9053\u5BA2\u6237\u7AEF\u91CC\u5B8C\u6210 \u2014\u2014 \u6240\u4EE5"\u4E0D\u586B\u4E5F\u80FD\u7528"\u7684\u524D\u63D0\u662F\u90A3\u53F0\u673A\u5668\u4E0A\u7801\u9053\u5DF2\u7ECF\u767B\u5F55\u8FC7\u3002',
  "account.needBoth": "Access Key ID \u548C Secret Access Key \u90FD\u8981\u586B\u3002",
  "account.saving": "\u4FDD\u5B58\u4E2D\u2026",
  "account.saveOk": "\u5DF2\u5199\u5165\u78C1\u76D8\u5E76\u7ACB\u5373\u751F\u6548\uFF08\u6765\u6E90\uFF1A{source}\uFF09",
  "account.saveFail": "\u4FDD\u5B58\u5931\u8D25",
  "account.ak": "Access Key ID",
  "account.sk": "Secret Access Key",
  "account.save": "\u4FDD\u5B58",
  "account.saved": "\u5DF2\u4FDD\u5B58",
  "account.test": "\u6D4B\u8BD5\u8FDE\u63A5",
  "account.testing": "\u6D4B\u8BD5\u4E2D\u2026",
  "account.ok": "\u8FDE\u63A5\u6B63\u5E38",
  "account.fail": "\u8FDE\u63A5\u5931\u8D25",
  "account.masked": "\u5DF2\u751F\u6548 \xB7 \u7559\u7A7A\u4FDD\u6301\u4E0D\u53D8\uFF0C\u8F93\u5165\u5373\u8986\u76D6\u65E7\u503C",
  "account.current": "\u5F53\u524D\u8FDE\u63A5",
  "account.refresh": "\u5237\u65B0",
  "account.user": "\u534E\u4E3A\u4E91\u8D26\u53F7",
  "account.credit": "\u79EF\u5206\u989D\u5EA6",
  "account.used": "\u5DF2\u7528",
  "account.noState": "\u6865\u63A5\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u7A0D\u540E\u5237\u65B0\u91CD\u8BD5",
  "account.checkin": "\u6BCF\u65E5\u7B7E\u5230",
  "checkin.done": "\u4ECA\u65E5\u5DF2\u7B7E\u5230\uFF0C+{n} \u79EF\u5206\u5DF2\u5230\u8D26",
  "checkin.available": "\u53EF\u9886\u53D6 {n} \u79EF\u5206",
  "checkin.idle": "\u6682\u65E0\u53EF\u9886\u53D6\u7684\u7B7E\u5230\u5956\u52B1",
  "checkin.claim": "\u9886\u53D6",
  "checkin.doing": "\u9886\u53D6\u4E2D\u2026",
  "checkin.unavailable": "\u7B7E\u5230\u72B6\u6001\u6682\u65F6\u67E5\u8BE2\u4E0D\u5230",
  "models.title": "\u53EF\u7528\u6A21\u578B",
  "models.hint": "\u4EE5\u4E0B\u6A21\u578B\u53D6\u81EA\u7801\u9053\u7F51\u5173\uFF0C\u5171 {n} \u4E2A\u3002",
  "models.name": "\u540D\u79F0",
  "models.context": "\u4E0A\u4E0B\u6587",
  "models.output": "\u6700\u5927\u8F93\u51FA",
  "models.ratio": "\u8BA1\u8D39\u500D\u7387",
  "models.ratioHint": "\u76F8\u5BF9\u57FA\u51C6\u4EF7\u683C\u7684\u6D88\u8017\u500D\u7387\uFF0C\u8D8A\u4F4E\u8D8A\u7701",
  "models.think": "\u601D\u8003",
  "models.thinkHint": "\u8BE5\u6A21\u578B\u5728\u7801\u9053\u4FA7\u53EF\u9009\u7684\u601D\u8003\u5F3A\u5EA6\u3002\u6CE8\u610F\uFF1A\u7F51\u5173\u7684 chat \u63A5\u53E3\u4E0D\u900F\u4F20\u5F3A\u5EA6\u53C2\u6570\uFF08\u5B9E\u6D4B\u5404\u79CD\u5B57\u6BB5\u540D\u4E0E model \u53D8\u4F53\u5747\u88AB\u5FFD\u7565\uFF09\uFF0C\u56E0\u6B64\u8FD9\u91CC\u7684\u6863\u4F4D\u76EE\u524D\u53EA\u5F71\u54CD DSH \u4FA7\u5C55\u793A\uFF0C\u4E0D\u4F1A\u6539\u53D8\u4E0A\u6E38\u884C\u4E3A\u3002",
  "models.visionHint": "\u7801\u9053\u7F51\u5173\u662F\u5426\u4E3A\u8BE5\u6A21\u578B\u5F00\u653E\u56FE\u7247\u8F93\u5165\u3002\u6CE8\u610F\uFF1A\u6865\u63A5\u76EE\u524D\u53EA\u8F6C\u53D1\u6587\u672C\uFF0C\u56FE\u7247\u4F1A\u5728\u8BF7\u6C42\u6784\u9020\u9636\u6BB5\u88AB\u4E22\u5F03\uFF0C\u56E0\u6B64\u73B0\u5728\u4E0D\u80FD\u771F\u7684\u53D1\u56FE\u3002",
  "models.visionYes": "\u7F51\u5173\u652F\u6301\u56FE\u7247\u8F93\u5165\uFF08\u6865\u63A5\u6682\u53EA\u8F6C\u53D1\u6587\u672C\uFF09",
  "models.visionNo": "\u7F51\u5173\u4E0D\u652F\u6301\u56FE\u7247\u8F93\u5165",
  "diag.title": "\u8BCA\u65AD",
  "diag.run": "\u8FD0\u884C\u81EA\u68C0",
  "diag.running": "\u81EA\u68C0\u4E2D\u2026",
  "diag.credentials": "\u51ED\u8BC1",
  "diag.sts": "STS \u6362\u53D6",
  "diag.handshake": "\u5BC6\u94A5\u534F\u5546",
  "diag.models": "\u6A21\u578B\u6E05\u5355",
  "diag.chat": "\u5BF9\u8BDD\u8FDE\u901A",
  "about.title": "\u5173\u4E8E",
  "about.protocol": "\u534F\u8BAE",
  "about.auth": "\u9274\u6743",
  "about.encrypt": "\u8F7D\u8377\u52A0\u5BC6",
  "chip.ready": "\u7801\u9053",
  "chip.idle": "\u7801\u9053\xB7\u672A\u914D\u7F6E",
  "chip.busy": "\u7801\u9053\xB7\u8BF7\u6C42\u4E2D",
  "chip.account": "\u8D26\u53F7",
  "chip.online": "\u5DF2\u8FDE\u63A5",
  "chip.offline": "\u672A\u8FDE\u63A5",
  "chip.keyId": "keyId",
  "chip.role": "\u89D2\u8272",
  "chip.credit": "\u79EF\u5206\u989D\u5EA6",
  "chip.refresh": "\u5237\u65B0",
  "chip.used": "\u5DF2\u7528",
  "chip.bonus": "\u8D60\u9001\u4F59\u989D",
  "chip.basic": "\u57FA\u7840\u4F59\u989D",
  "chip.tokens": "\u7D2F\u8BA1 token",
  "chip.noCredit": "\u989D\u5EA6\u63A5\u53E3\u672A\u8FD4\u56DE\uFF0C\u7A0D\u540E\u70B9\u5237\u65B0\u91CD\u8BD5",
  "chip.testRefresh": "\u6D4B\u8BD5\u5E76\u5237\u65B0\u989D\u5EA6",
  "chip.testing": "\u68C0\u6D4B\u4E2D\u2026"
};
var en = {
  "meta.title": "CodeArts Connector",
  "meta.desc": "Bring Huawei Cloud CodeArts Agent models into DSH",
  "tab.account": "Account",
  "tab.models": "Models",
  "tab.diagnostics": "Diagnostics",
  "tab.about": "About",
  "account.title": "Huawei Cloud credentials",
  "account.hint": "Nothing to fill in is fine: if the CodeArts client is installed and signed in, the plugin borrows its login state automatically. Entering permanent AK/SK makes it fully hands-off afterwards.",
  "account.sourceTitle": "Where the credential comes from",
  "account.sourceDesc": "The plugin tries these in order and uses the first usable one \u2014 you do not need all three.",
  "account.sourceEnv": "Environment variables MADAO_AK / MADAO_SK",
  "account.sourceFile": "Permanent AK/SK entered above",
  "account.sourceCodearts": "CodeArts client login state (zero config)",
  "account.sourceActive": "in use",
  "account.sourceTemp": "temporary, {n} min left",
  "account.sourceExpired": "expired \xB7 open CodeArts once so it refreshes, then retry the connection test",
  "account.sourceTempSoon": "expiring in {n} min \xB7 refresh CodeArts now, or use permanent AK/SK",
  "account.sourceTempSec": "{n}s left, about to expire",
  "account.sourceTempNote": 'You are using a temporary credential borrowed from the CodeArts login state; it stops working after a few hours. To recover: open the CodeArts client once so it refreshes, then click "Test connection" above. To skip this entirely, enter permanent AK/SK above \u2014 one-time setup, and the plugin keeps exchanging and renewing STS by itself.',
  "account.sourcePermNote": "Using a permanent credential. The plugin exchanges STS automatically and renews it before expiry \u2014 nothing left to do.",
  "account.howToGetAk": "How to get AK/SK",
  "account.howToGetAkSteps": 'Huawei Cloud console \u2192 account menu (top right) \u2192 My Credentials \u2192 Access Keys \u2192 Create Access Key. In the downloaded credentials.csv, "Access Key Id" and "Secret Access Key" are the two fields above (the secret is shown only once \u2014 save it). Do not fill in STS.',
  "account.howCodeartsWorks": "How option 3 works",
  "account.howCodeartsWorksDesc": 'If the CodeArts client is installed and signed in on this machine, the plugin reads its local login state directly \u2014 nothing to fill in. Note: the plugin has no login screen of its own; signing in always happens in the CodeArts client. So "works with no setup" assumes CodeArts is already signed in on that machine.',
  "account.needBoth": "Both Access Key ID and Secret Access Key are required.",
  "account.saving": "Saving\u2026",
  "account.saveOk": "Written to disk and applied immediately (source: {source})",
  "account.saveFail": "Save failed",
  "account.ak": "Access Key ID",
  "account.sk": "Secret Access Key",
  "account.save": "Save",
  "account.saved": "Saved",
  "account.test": "Test connection",
  "account.testing": "Testing\u2026",
  "account.ok": "Connected",
  "account.fail": "Connection failed",
  "account.masked": "Active \xB7 leave blank to keep, type to replace",
  "account.current": "Current connection",
  "account.refresh": "Refresh",
  "account.user": "Huawei Cloud account",
  "account.credit": "Credits",
  "account.used": "used",
  "account.noState": "Bridge not ready, try Refresh again",
  "account.checkin": "Daily check-in",
  "checkin.done": "Checked in today, +{n} credits added",
  "checkin.available": "{n} credits available",
  "checkin.idle": "Nothing to claim right now",
  "checkin.claim": "Claim",
  "checkin.doing": "Claiming\u2026",
  "checkin.unavailable": "Check-in status unavailable",
  "models.title": "Available models",
  "models.hint": "{n} models from the CodeArts gateway.",
  "models.name": "Name",
  "models.context": "Context",
  "models.output": "Max output",
  "models.ratio": "Rate",
  "models.ratioHint": "Credit multiplier vs. baseline price; lower is cheaper",
  "models.think": "Thinking",
  "models.thinkHint": "Thinking strengths offered by CodeArts. Note: the gateway chat endpoint does not forward a strength parameter (every field name and model-id variant probed was ignored), so these levels currently affect display only, not upstream behaviour.",
  "models.visionHint": "Whether the CodeArts gateway opens image input for this model. Note: the bridge forwards text only, so images are dropped when building the request.",
  "models.visionYes": "Gateway supports images (bridge forwards text only)",
  "models.visionNo": "Gateway: text only",
  "diag.title": "Diagnostics",
  "diag.run": "Run check",
  "diag.running": "Running\u2026",
  "diag.credentials": "Credentials",
  "diag.sts": "STS exchange",
  "diag.handshake": "Key exchange",
  "diag.models": "Model list",
  "diag.chat": "Chat",
  "about.title": "About",
  "about.protocol": "Protocol",
  "about.auth": "Auth",
  "about.encrypt": "Payload encryption",
  "chip.ready": "CodeArts",
  "chip.idle": "CodeArts \xB7 unset",
  "chip.busy": "CodeArts \xB7 busy",
  "chip.account": "Account",
  "chip.online": "Connected",
  "chip.offline": "Not connected",
  "chip.keyId": "keyId",
  "chip.role": "Role",
  "chip.credit": "Credits",
  "chip.refresh": "Refresh",
  "chip.used": "Used",
  "chip.bonus": "Bonus",
  "chip.basic": "Basic",
  "chip.tokens": "Total tokens",
  "chip.noCredit": "Credit endpoint unavailable, try Refresh later",
  "chip.testRefresh": "Test & refresh",
  "chip.testing": "Testing\u2026"
};
function apply(ctx) {
  const namespace = "settings.madao";
  try {
    ctx.effect(
      () => ctx.locale.register(namespace, { zh, en }),
      "dsh-connect-madao: settings copy"
    );
  } catch (err) {
    console.warn("[dsh-connect-madao] locale register failed:", err);
  }
  const t = ctx.locale.bind(namespace);
  const registerCard = (slotName) => {
    try {
      return ctx.slots.inject(
        slotName,
        () => ctx.slots.register(
          {
            name: slotName,
            key: "dsh-connect-madao",
            priority: 40,
            inject: () => ({ t })
          },
          CodeArtsPanel
        )
      );
    } catch (err) {
      console.error(`[dsh-connect-madao] slot "${slotName}" register failed:`, err);
      return void 0;
    }
  };
  registerCard("plugins.bundle.config");
  try {
    ctx.slots.inject(
      "conversation.input.right",
      () => ctx.slots.register(
        {
          name: "conversation.input.right",
          id: "dsh-connect-madao-chip",
          order: 6,
          locale: namespace,
          inject: () => ({ t })
        },
        ComposerChip
      )
    );
  } catch (err) {
    console.warn("[dsh-connect-madao] composer chip register failed:", err);
  }
}
exports.apply = apply;
exports.inject = inject;
exports.name = name;
		return module.exports;
	}
});
