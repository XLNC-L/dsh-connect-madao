/**
 * 码道设置面板。
 *
 * 形态对齐 dsh-connect-workbuddy：顶部区域切换 + 多 tab（账号 / 模型 / 诊断 / 关于）。
 * 纯 React，不依赖宿主 UI 库，样式内联，避免版本差异导致渲染失败。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import { bridgeJson, bridgePost, type HealthPayload } from './bridge.ts'
import {
  getAutoCheckinState,
  getSettings,
  loadSettings,
  saveSettings,
  subscribeSettings,
  type AutoCheckinState,
  type SettingsPayload,
} from './settings.ts'

/** 与 server.ts 的 KNOWN_MODELS 保持一致；前端只做展示，真实清单从 /v1/models 拉。 */
const FALLBACK_MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', context: 1048576, maxOutput: 65536, ratio: '0.18x' },
  { id: 'deepseek-v4.1-flash-1017', name: 'DeepSeek-V4.1-Flash-1017', context: 1048576, maxOutput: 65536, ratio: '0.18x' },
  { id: 'glm-5.3', name: 'GLM-5.3', context: 1048576, maxOutput: 65536, ratio: '0.79x' },
  { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', context: 1048576, maxOutput: 65536, ratio: '0.08x' },
  { id: 'GLM-5.2', name: 'GLM-5.2', context: 202752, maxOutput: 65536, ratio: '0.7x' },
  { id: 'glm-5.2-sft-harmony', name: 'GLM-5.2-ArkTS-SPARK', context: 202752, maxOutput: 65535, ratio: '0.7x' },
  { id: 'kimi-k3', name: 'Kimi-K3', context: 1048576, maxOutput: 65536, ratio: '2.38x' },
  { id: 'kimi-k3.1-pro', name: 'Kimi-K3.1-Pro', context: 1048576, maxOutput: 65536, ratio: '1.63x' },
  { id: 'openpangu-2.0-pro', name: 'OpenPangu-2.0-Pro', context: 524288, maxOutput: 65535, ratio: '0.7x' },
  { id: 'openpangu-2.0-flash', name: 'OpenPangu-2.0-Flash', context: 524288, maxOutput: 65535, ratio: '0.32x' },
  { id: 'speed', name: '智速模式', context: 1048576, maxOutput: 65536, ratio: '0.18x' },
] as Array<{ id: string; name: string; context: number; maxOutput: number; ratio?: string }>

const S = {
  root: {
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
    borderRadius: 10,
    padding: 16,
    fontFamily: 'inherit',
    fontSize: 13,
    color: 'var(--dsw-alias-label-primary, #0f1115)',
  } as const,
  // 账号详情区块
  section: {
    marginTop: 16,
    paddingTop: 14,
    borderTop: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
  } as const,
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    fontWeight: 600,
    fontSize: 12,
    marginBottom: 8,
  } as const,
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '5px 14px',
    alignItems: 'center',
  } as const,
  detailKey: { fontSize: 11, color: 'var(--dsw-alias-label-secondary, #61666b)' } as const,
  detailVal: { fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' } as const,
  miniBtn: {
    background: 'none',
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
    borderRadius: 5,
    color: 'var(--dsw-alias-label-primary, #0f1115)',
    fontSize: 11,
    padding: '1px 8px',
    cursor: 'pointer',
  } as const,
  header: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 } as const,
  logo: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: 'linear-gradient(135deg,#c7000b,#ff6a00)',
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
  } as const,
  title: { fontSize: 15, fontWeight: 600, margin: 0, color: 'var(--dsw-alias-label-primary, #0f1115)' } as const,
  sub: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #61666b)', margin: '3px 0 0' } as const,
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))', marginBottom: 14 } as const,
  tab: (active: boolean) =>
    ({
      padding: '7px 12px',
      cursor: 'pointer',
      background: 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid #c7000b' : '2px solid transparent',
      color: active ? 'var(--dsw-alias-label-primary, #0f1115)' : 'var(--dsw-alias-label-secondary, #61666b)',
      fontWeight: active ? 600 : 400,
      fontSize: 13,
      fontFamily: 'inherit',
    }) as const,
  field: { marginBottom: 12 } as const,
  label: { display: 'block', marginBottom: 5, fontSize: 12, color: 'var(--dsw-alias-label-secondary, #61666b)' } as const,
  input: {
    width: '100%',
    padding: '7px 9px',
    borderRadius: 6,
    border: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
    background: 'var(--dsw-alias-bg-layer-2, #f4f5f7)',
    color: 'var(--dsw-alias-label-primary, #0f1115)',
    fontFamily: 'monospace',
    fontSize: 12,
    boxSizing: 'border-box',
  } as const,
  row: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 } as const,
  btn: (primary: boolean) =>
    ({
      padding: '7px 14px',
      borderRadius: 6,
      cursor: 'pointer',
      border: primary ? 'none' : '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
      background: primary ? '#c7000b' : 'transparent',
      color: primary ? '#fff' : 'var(--dsw-alias-label-primary, #0f1115)',
      fontSize: 12,
      fontFamily: 'inherit',
    }) as const,
  hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary, #61666b)', lineHeight: 1.6, margin: '0 0 14px' } as const,
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  th: { textAlign: 'left' as const, padding: '7px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))', color: 'var(--dsw-alias-label-secondary, #61666b)', fontWeight: 500 },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))' },
  step: (state: string) =>
    ({
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 0',
      fontSize: 12,
    }) as const,
  dot: (state: string) =>
    ({
      width: 7,
      height: 7,
      borderRadius: '50%',
      flex: '0 0 auto',
      background:
        state === 'ok'
          ? 'var(--dsw-alias-state-success-primary, #2ea043)'
          : state === 'fail'
            ? 'var(--dsw-alias-state-error-primary, #d1242f)'
            : state === 'run'
              ? 'var(--dsw-alias-state-warn-primary, #d29922)'
              : 'var(--dsw-alias-label-tertiary, #81858c)',
    }) as const,
  kv: { display: 'grid', gridTemplateColumns: '110px 1fr', gap: '6px 12px', fontSize: 12, lineHeight: 1.7 } as const,
  kvk: { color: 'var(--dsw-alias-label-secondary, #61666b)' } as const,
  // 开关行：文字在左、开关在右
  uiRow: { display: 'flex', alignItems: 'center', gap: 12 } as const,
  switch: (on: boolean, busy: boolean) =>
    ({
      flex: '0 0 auto',
      position: 'relative',
      width: 38,
      height: 22,
      padding: 0,
      borderRadius: 11,
      border: 'none',
      cursor: busy ? 'default' : 'pointer',
      opacity: busy ? 0.6 : 1,
      background: on
        ? 'var(--dsw-alias-state-success-primary, #2ea043)'
        : 'var(--dsw-alias-label-tertiary, #81858c)',
      transition: 'background .15s ease',
    }) as const,
  knob: (on: boolean) =>
    ({
      position: 'absolute',
      top: 3,
      left: on ? 19 : 3,
      width: 16,
      height: 16,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,.35)',
      transition: 'left .15s ease',
    }) as const,
}

type Tab = 'account' | 'interface' | 'models' | 'diagnostics' | 'about'

export interface PanelProps {
  t: (key: string, vars?: Record<string, unknown>) => string
}

export function CodeArtsPanel({ t }: PanelProps) {
  const [tab, setTab] = useState<Tab>('account')

  const [ak, setAk] = useState('')
  const [sk, setSk] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const [models, setModels] = useState(FALLBACK_MODELS)

  const [diag, setDiag] = useState<Record<string, string>>({})
  const [diagRunning, setDiagRunning] = useState(false)

  /** 账号详情：AK / STS / keyId / 额度。凭证细节只在这里出现，不进输入框浮层。 */
  const [acct, setAcct] = useState<any>(null)
  /** 每日签到状态（GET 只查不领） */
  const [checkin, setCheckin] = useState<any>(null)
  const [checkinBusy, setCheckinBusy] = useState(false)

  /** 界面设置（胶囊显隐、自动签到）。宿主是权威源，这里只是镜像。 */
  const [uiSettings, setUiSettings] = useState<SettingsPayload>(getSettings())
  const [uiSaving, setUiSaving] = useState(false)
  const [uiError, setUiError] = useState<string | null>(null)
  const [autoState, setAutoState] = useState<AutoCheckinState | null>(getAutoCheckinState())
  const [autoBusy, setAutoBusy] = useState(false)

  // 与胶囊共用同一个 store：任一组件改动都会广播到这里。
  useEffect(() => {
    const stop = subscribeSettings((next) => {
      setUiSettings(next)
      setAutoState(getAutoCheckinState())
    })
    void loadSettings()
    return stop
  }, [])

  // 自动签到开着时，每 30 秒问一次运行状态，让「上次：…」能自己更新。
  useEffect(() => {
    if (!uiSettings.autoCheckin) return
    const timer = setInterval(() => {
      void loadSettings()
    }, 30_000)
    return () => clearInterval(timer)
  }, [uiSettings.autoCheckin])

  const toggleComposerChip = useCallback(async (next: boolean) => {
    setUiSaving(true)
    setUiError(null)
    setUiSettings({ ...getSettings(), composerChip: next })
    try {
      await saveSettings({ composerChip: next })
    } catch (e) {
      setUiSettings({ ...getSettings(), composerChip: !next })
      setUiError(String((e as Error)?.message ?? e))
    } finally {
      setUiSaving(false)
    }
  }, [])

  const toggleAutoCheckin = useCallback(async (next: boolean) => {
    setAutoBusy(true)
    setUiError(null)
    setUiSettings({ ...getSettings(), autoCheckin: next })
    try {
      await saveSettings({ autoCheckin: next })
      setAutoState(getAutoCheckinState())
      if (next) {
        // 打开后宿主会立刻跑一轮；稍等一下再取，用户能马上看到结果。
        setTimeout(() => {
          void loadSettings()
        }, 1_500)
      }
    } catch (e) {
      setUiSettings({ ...getSettings(), autoCheckin: !next })
      setUiError(String((e as Error)?.message ?? e))
    } finally {
      setAutoBusy(false)
    }
  }, [])

  const loadCheckin = useCallback(async () => {
    try {
      setCheckin(await bridgeJson<any>('/diag/checkin', 30_000))
    } catch {
      setCheckin(null)
    }
  }, [])

  const loadAccount = useCallback(async () => {
    try {
      setAcct(await bridgeJson<any>('/diag/account', 20_000))
    } catch {
      setAcct(null)
    }
  }, [])

  /** 只有用户点了才领 —— 一天一次，绝不自动触发。定义在 loadAccount 之后，避免 TDZ。 */
  const doCheckin = useCallback(async () => {
    if (checkinBusy) return
    setCheckinBusy(true)
    try {
      const r = await bridgePost<any>('/diag/checkin', {}, 60_000)
      setCheckin(r)
      void loadAccount()
    } catch (e) {
      setCheckin({ ok: false, reason: String((e as Error)?.message ?? e) })
    } finally {
      setCheckinBusy(false)
    }
  }, [checkinBusy, loadAccount])

  /**
   * 领全部可领的签到类活动（含 claim 后的 confirm）。
   *
   * 与 doCheckin 分开：那个的语义是「签今天的到」，这个才会把
   * 「创新赛签到礼」之类限时活动的额度也一起领掉。仍然只在用户点击时发。
   */
  const doClaimAll = useCallback(async () => {
    if (checkinBusy) return
    setCheckinBusy(true)
    try {
      const r = await bridgePost<any>('/diag/checkin/all', {}, 90_000)
      const got = Array.isArray(r?.claimed) ? r.claimed.length : 0
      setCheckin({
        ok: true,
        available: true,
        claimAll: r,
        reason: got > 0 ? t('checkin.allGot', { n: got }) : t('checkin.allNone'),
      })
      void loadAccount()
      void loadCheckin()
    } catch (e) {
      setCheckin({ ok: false, reason: String((e as Error)?.message ?? e) })
    } finally {
      setCheckinBusy(false)
    }
  }, [checkinBusy, loadAccount, loadCheckin, t])

  useEffect(() => {
    void loadAccount()
    void loadCheckin()
  }, [loadAccount, loadCheckin])

  /**
   * 真正把 AK/SK 写盘（POST /diag/credentials）。
   *
   * 旧实现只有一句 setSaved(true) —— 界面显示「已保存」，但 credentials.json
   * 一个字都没写，重启后还是旧凭证。这里是补上的真实持久化。
   */
  const saveCredentials = useCallback(async () => {
    if (saving) return
    if (!ak.trim() || !sk.trim()) {
      setTestResult({ ok: false, message: t('account.needBoth') })
      return
    }
    setSaving(true)
    try {
      const r = await bridgePost<{ ok: boolean; source?: string; warning?: string }>(
        '/diag/credentials',
        { ak: ak.trim(), sk: sk.trim() },
        30_000,
      )
      setSaved(true)
      // 存完清空输入框，回落到占位符（"已生效 · 留空保持不变，输入即覆盖旧值"）
      setAk('')
      setSk('')
      setTestResult(
        r.warning
          ? { ok: false, message: r.warning }
          : { ok: true, message: t('account.saveOk', { source: r.source ?? 'file' }) },
      )
      void loadAccount()
    } catch (e) {
      setTestResult({ ok: false, message: `${t('account.saveFail')} · ${String((e as Error)?.message ?? e)}` })
    } finally {
      setSaving(false)
    }
  }, [ak, sk, saving, loadAccount, t])

  // 面板打开时读一次状态
  useEffect(() => {
    let cancelled = false
    bridgeJson<any>('/v1/models')
      .then((j) => {
        if (cancelled || !j?.data) return
        setModels(
          j.data.map((m: any) => ({
            id: m.id,
            name: m.name ?? m.id,
            context: m.context_window ?? 0,
            maxOutput: m.max_output_tokens ?? 0,
            ratio: m.ratio,
            supportsImages: m.supports_images === true,
            strengths: m.strengths ?? [],
            description: undefined,
          })),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * 诊断：跑一次全链路自检，用**真实步骤结果**填表。
   *
   * 旧实现只读 /healthz 然后推断五项状态 —— 比如 chat 那一项永远是
   * ok 或 idle，从来没真正测过对话，等于摆设。现在改用 /diag/test，
   * 它对每一步都返回 ok/detail/ms。
   */
  const runDiag = useCallback(async () => {
    setDiagRunning(true)
    setDiag({ credentials: 'run', sts: 'run', handshake: 'run', models: 'run', chat: 'run' })
    try {
      const j = await bridgeJson<{ ok: boolean; steps: { name: string; ok: boolean; detail?: string }[] }>(
        '/diag/test',
        90_000,
      )
      const byName = (kw: string) => j.steps?.find((s) => s.name.includes(kw))
      const map = (kw: string): string => {
        const s = byName(kw)
        return s ? (s.ok ? 'ok' : 'fail') : 'fail'
      }
      setDiag({
        credentials: map('凭证'),
        sts: map('凭证'), // 凭证一步已包含 STS 换取
        handshake: map('协商'),
        models: map('模型'),
        chat: j.ok ? 'ok' : 'fail',
      })
      // 顺手把每一步的 detail 记进日志，方便用户复制反馈
      if (!j.ok) {
        console.warn('[dsh-connect-madao] diag steps', j.steps)
      }
    } catch (e) {
      setDiag({ credentials: 'fail', sts: 'fail', handshake: 'fail', models: 'fail', chat: 'fail' })
      console.warn('[dsh-connect-madao] diag failed', e)
    } finally {
      setDiagRunning(false)
    }
  }, [])

  /**
   * 设置页的「测试连接」：同样走 /diag/test 全链路，并把每一步结果拼成一行。
   * 只用 /healthz 的话，模型和额度那两步根本没测。
   */
  const testConnection = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const j = await bridgeJson<{ ok: boolean; steps: { name: string; ok: boolean; detail?: string }[] }>(
        '/diag/test',
        90_000,
      )
      const steps = j.steps ?? []
      if (j.ok) {
        setTestResult({ ok: true, message: `${t('account.ok')} · ${steps.length} 步全通` })
      } else {
        const bad = steps.find((s) => !s.ok)
        setTestResult({
          ok: false,
          message: `${t('account.fail')} · ${bad ? `${bad.name}：${bad.detail ?? ''}` : '未知步骤'}`,
        })
      }
    } catch (err) {
      setTestResult({ ok: false, message: `${t('account.fail')} · ${String(err)}` })
    } finally {
      setTesting(false)
    }
  }, [t])

  const tabBtn = (id: Tab, label: string) => (
    <button key={id} style={S.tab(tab === id)} onClick={() => setTab(id)}>
      {label}
    </button>
  )

  return (
    <div style={S.root}>
      <div style={S.header}>
        <div style={S.logo}>码</div>
        <div style={{ flex: 1 }}>
          <h3 style={S.title}>{t('meta.title')}</h3>
          <p style={S.sub}>{t('meta.desc')}</p>
        </div>
      </div>

      <div style={S.tabs}>
        {tabBtn('account', t('tab.account'))}
        {tabBtn('interface', t('tab.interface'))}
        {tabBtn('models', t('tab.models'))}
        {tabBtn('diagnostics', t('tab.diagnostics'))}
        {tabBtn('about', t('tab.about'))}
      </div>

      {tab === 'account' && (
        <div>
          {/* 凭证来源：用户最需要先知道的就是"到底要不要填"，所以放最上面 */}
          <div style={S.section}>
            <div style={S.sectionTitle}>{t('account.sourceTitle')}</div>
            <p style={{ ...S.hint, marginTop: 0 }}>{t('account.sourceDesc')}</p>
            {(() => {
              const src = acct?.source as string | undefined
              const temp = acct?.temporary === true
              const exp = typeof acct?.expiresAtMs === 'number' ? acct.expiresAtMs : null
              const leftMs = exp ? exp - Date.now() : null
              const leftMin = leftMs !== null ? Math.round(leftMs / 60000) : null
              const expired = temp && leftMs !== null && leftMs <= 0
              // 不足 10 分钟就转红 —— 等到真过期才提示，用户已经被打断了
              const urgent = temp && !expired && leftMs !== null && leftMs <= 10 * 60_000

              const rows: Array<{ key: string; label: string; extra?: string; active: boolean }> = [
                { key: 'env', label: t('account.sourceEnv'), active: src === 'env' },
                { key: 'file', label: t('account.sourceFile'), active: src === 'file' },
                {
                  key: 'codearts',
                  label: t('account.sourceCodearts'),
                  extra: temp
                    ? expired
                      ? t('account.sourceExpired')
                      : leftMs !== null
                        ? leftMs < 60_000
                          ? t('account.sourceTempSec', { n: Math.max(0, Math.round(leftMs / 1000)) })
                          : urgent
                            ? t('account.sourceTempSoon', { n: leftMin ?? 0 })
                            : t('account.sourceTemp', { n: leftMin ?? 0 })
                        : undefined
                    : undefined,
                  active: src === 'codearts',
                },
              ]

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {rows.map((r, i) => (
                    <div
                      key={r.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: r.active ? 'rgba(46,160,67,0.10)' : 'transparent',
                        border: r.active ? '1px solid rgba(46,160,67,0.35)' : '1px solid transparent',
                        color: r.active ? 'var(--dsw-alias-label-primary, #0f1115)' : 'var(--dsw-alias-label-secondary, #61666b)',
                      }}
                    >
                      <span style={{ color: 'var(--dsw-alias-label-secondary, #61666b)', minWidth: 14 }}>{i + 1}.</span>
                      <span style={{ flex: 1 }}>{r.label}</span>
                      {r.extra && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: expired || urgent ? 600 : 400,
                            color:
                              expired || urgent
                                ? 'var(--dsw-alias-state-error-primary, #d1242f)'
                                : 'var(--dsw-alias-state-warn-primary, #d29922)',
                          }}
                        >
                          {r.extra}
                        </span>
                      )}
                      {r.active && (
                        <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-success-primary, #2ea043)', fontWeight: 600 }}>
                          {t('account.sourceActive')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )
            })()}
            <p style={{ ...S.hint, marginBottom: 0 }}>
              {acct?.temporary === true ? t('account.sourceTempNote') : t('account.sourcePermNote')}
            </p>

            {/* 两段常被问到的说明：AK/SK 从哪弄、第 3 项到底怎么工作的 */}
            <details style={{ marginTop: 10 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary, #61666b)' }}>
                {t('account.howToGetAk')}
              </summary>
              <p style={{ ...S.hint, marginTop: 6, marginBottom: 0 }}>{t('account.howToGetAkSteps')}</p>
            </details>

            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 12, cursor: 'pointer', color: 'var(--dsw-alias-label-secondary, #61666b)' }}>
                {t('account.howCodeartsWorks')}
              </summary>
              <p style={{ ...S.hint, marginTop: 6, marginBottom: 0 }}>{t('account.howCodeartsWorksDesc')}</p>
            </details>
          </div>

          <p style={S.hint}>{t('account.hint')}</p>
          <div style={S.field}>
            <label style={S.label}>{t('account.ak')}</label>
            <input
              style={S.input}
              value={ak}
              placeholder={saved ? t('account.masked') : 'HPUA…'}
              onChange={(e) => setAk(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div style={S.field}>
            <label style={S.label}>{t('account.sk')}</label>
            <input
              style={S.input}
              type="password"
              value={sk}
              placeholder={saved ? t('account.masked') : '••••••••'}
              onChange={(e) => setSk(e.target.value)}
              spellCheck={false}
            />
          </div>
          <div style={S.row}>
            <button style={S.btn(true)} onClick={saveCredentials} disabled={saving}>
              {saving ? t('account.saving') : saved ? t('account.saved') : t('account.save')}
            </button>
            <button style={S.btn(false)} onClick={testConnection} disabled={testing}>
              {testing ? t('account.testing') : t('account.test')}
            </button>
            {testResult && (
              <span
                style={{
                  fontSize: 12,
                  color: testResult.ok
                    ? 'var(--dsw-alias-state-success-primary, #2ea043)'
                    : 'var(--dsw-alias-state-error-primary, #d1242f)',
                }}
              >
                {testResult.message}
              </span>
            )}
          </div>

          {/* 当前连接状态：凭证细节放这里，不放输入框浮层 */}
          <div style={S.section}>
            <div style={S.sectionTitle}>
              {t('account.current')}
              <button style={S.miniBtn} onClick={() => void loadAccount()}>
                {t('account.refresh')}
              </button>
            </div>
            {acct ? (
              <div style={S.detailGrid}>
                <span style={S.detailKey}>{t('account.user')}</span>
                <span style={S.detailVal}>{acct.account ?? '—'}</span>

                <span style={S.detailKey}>AK</span>
                <span style={S.detailVal}>{acct.ak ?? '—'}</span>

                <span style={S.detailKey}>SK</span>
                <span style={S.detailVal}>{acct.sk ?? '—'}</span>

                <span style={S.detailKey}>STS</span>
                <span style={S.detailVal}>
                  {acct.sts && typeof acct.sts === 'object'
                    ? `${new Date(acct.sts.expiresAt).toLocaleString()} · 剩 ${acct.sts.ttlSec}s`
                    : (acct.sts ?? '—')}
                </span>

                <span style={S.detailKey}>keyId</span>
                <span style={S.detailVal}>{acct.sessionKey?.keyId ?? '—'}</span>

                {acct.credit ? (
                  <>
                    <span style={S.detailKey}>{t('account.credit')}</span>
                    <span style={S.detailVal}>
                      {acct.credit.remain} / {acct.credit.total}（{t('account.used')} {acct.credit.used}）
                    </span>
                  </>
                ) : null}

                {/* 积分到期预警：上游按批次清零，不提醒就只会某天突然发现少了。
                    level 由 credit-expiry.ts 算好（urgent/warn/info），这里只上色。 */}
                {acct.creditExpiry ? (
                  <>
                    <span style={S.detailKey}>{t('checkin.expiring')}</span>
                    <span
                      style={{
                        ...S.detailVal,
                        color:
                          acct.creditExpiry.level === 'urgent' || acct.creditExpiry.level === 'warn'
                            ? 'var(--dsw-alias-state-error-primary, #d1242f)'
                            : 'var(--dsw-alias-state-warn-primary, #d29922)',
                      }}
                    >
                      {acct.creditExpiry.message}
                    </span>
                  </>
                ) : null}
              </div>
            ) : (
              <div style={S.hint}>{t('account.noState')}</div>
            )}
          </div>

          {/* 每日签到：真实接口（POST /v1/ops/claim），只在用户点击时领取 */}
          <div style={S.section}>
            <div style={S.sectionTitle}>{t("account.checkin")}</div>
            {checkin && checkin.available !== false ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ flex: 1, fontSize: 12 }}>
                  {/*
                    上游四态：ELIGIBLE → CLAIMED → CONFIRMED → CONSUMED。
                    后三者都表示「今天签过了」，只是阶段不同：
                      CLAIMED   已领取（还没 confirm，积分已到账）
                      CONFIRMED 已到账
                      CONSUMED  补贴已用完（当天用过码道就会变成这个）
                    0.9.2 之前只认前两个，导致当天用过码道后面板显示
                    「暂无可领取的签到奖励」，看起来像没签到 —— 实测踩到。
                  */}
                  {checkin.status === "CLAIMED" || checkin.status === "CONFIRMED" || checkin.status === "CONSUMED"
                    ? t("checkin.done", { n: checkin.amount ?? 100 })
                    : checkin.claimable
                      ? t("checkin.available", { n: checkin.pendingAmount ?? 100 })
                      : t("checkin.idle")}
                </span>
                {checkin.claimable ? (
                  <button style={S.btn(true)} onClick={() => void doCheckin()} disabled={checkinBusy}>
                    {checkinBusy ? t("checkin.doing") : t("checkin.claim")}
                  </button>
                ) : null}
                {/* 「领全部」：把限时签到活动（如创新赛签到礼）的额度也一起领掉，
                    与上面的「领取」区分 —— 那个只签今天的到。 */}
                <button style={S.btn(false)} onClick={() => void doClaimAll()} disabled={checkinBusy}>
                  {checkinBusy ? t("checkin.allDoing") : t("checkin.all")}
                </button>
              </div>
            ) : (
              <div style={S.hint}>{checkin?.reason ?? t("checkin.unavailable")}</div>
            )}

            {/* 自动签到：默认关闭，打开后由宿主侧调度器每分钟检查一次。
                放在签到区里而不是另开一页 —— 用户看到「领取」按钮的同时
                就能决定要不要让它自动跑。 */}
            <div
              style={{
                ...S.uiRow,
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1))',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12 }}>{t('checkin.auto')}</div>
                <div style={{ ...S.hint, margin: '2px 0 0', fontSize: 11 }}>{t('checkin.autoHint')}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={uiSettings.autoCheckin ? 'true' : 'false'}
                aria-label={t('checkin.auto')}
                style={S.switch(uiSettings.autoCheckin, autoBusy)}
                disabled={autoBusy}
                onClick={() => void toggleAutoCheckin(!uiSettings.autoCheckin)}
              >
                <span style={S.knob(uiSettings.autoCheckin)} />
              </button>
            </div>
            {uiSettings.autoCheckin && (
              <div style={{ ...S.hint, margin: '8px 0 0', fontSize: 11 }}>
                {autoState?.lastMessage
                  ? `${t('checkin.autoLast')}${autoState.lastMessage}`
                  : t('checkin.autoIdle')}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'interface' && (
        <div>
          <p style={{ ...S.hint, marginTop: 0 }}>{t('ui.hint')}</p>

          <div style={S.section}>
            <div style={S.sectionTitle}>{t('ui.chipSection')}</div>
            <div style={S.uiRow}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12 }}>{t('ui.composerChip')}</div>
                <div style={{ ...S.hint, margin: '2px 0 0', fontSize: 11 }}>{t('ui.composerChipHint')}</div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={uiSettings.composerChip ? 'true' : 'false'}
                aria-label={t('ui.composerChip')}
                style={S.switch(uiSettings.composerChip, uiSaving)}
                disabled={uiSaving}
                onClick={() => void toggleComposerChip(!uiSettings.composerChip)}
              >
                <span style={S.knob(uiSettings.composerChip)} />
              </button>
            </div>
            {uiError && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--dsw-alias-state-error-primary, #d1242f)' }}>
                {t('ui.saveFail')} · {uiError}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'models' && (
        <div>
          <p style={S.hint}>{t('models.hint', { n: models.length })}</p>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>{t('models.name')}</th>
                <th style={S.th}>model_id</th>
                <th style={S.th}>{t('models.context')}</th>
                <th style={S.th}>{t('models.output')}</th>
                <th style={S.th} title={t('models.ratioHint')}>{t('models.ratio')}</th>
                <th style={S.th} title={t('models.visionHint')}>👁</th>
                <th style={S.th} title={t('models.thinkHint')}>{t('models.think')}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m: any) => (
                <tr key={m.id}>
                  <td style={S.td} title={m.description ?? undefined}>{m.name}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace', color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: 11 }}>
                    {m.id}
                  </td>
                  <td style={S.td}>{(m.context ?? m.context_window ?? 0).toLocaleString()}</td>
                  <td style={S.td}>{(m.maxOutput ?? m.max_output_tokens ?? 0).toLocaleString()}</td>
                  <td style={{ ...S.td, fontFamily: 'monospace' }}>{m.ratio ?? '—'}</td>
                  <td style={S.td} title={(m.supportsImages ?? m.supports_images) ? t('models.visionYes') : t('models.visionNo')}>
                    {(m.supportsImages ?? m.supports_images) ? (
                      '👁'
                    ) : (
                      <span style={{ color: 'var(--dsw-alias-label-secondary, #61666b)' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...S.td, fontSize: 11, opacity: m.strengths?.length ? 1 : 0.25 }}>
                    {m.strengths?.length ? m.strengths.join(' / ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'diagnostics' && (
        <div>
          <div style={S.row}>
            <button style={S.btn(true)} onClick={runDiag} disabled={diagRunning}>
              {diagRunning ? t('diag.running') : t('diag.run')}
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            {(
              [
                ['credentials', t('diag.credentials')],
                ['sts', t('diag.sts')],
                ['handshake', t('diag.handshake')],
                ['models', t('diag.models')],
                ['chat', t('diag.chat')],
              ] as Array<[string, string]>
            ).map(([key, label]) => (
              <div key={key} style={S.step(diag[key] ?? 'idle')}>
                <span style={S.dot(diag[key] ?? 'idle')} />
                <span style={{ flex: 1 }}>{label}</span>
                <span style={{ color: 'var(--dsw-alias-label-secondary, #61666b)', fontSize: 11 }}>
                  {diag[key] === 'ok' ? '✓' : diag[key] === 'fail' ? '✗' : diag[key] === 'run' ? '…' : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'about' && (
        <div>
          <div style={S.kv}>
            <span style={S.kvk}>{t('about.protocol')}</span>
            <span>OpenAI Chat Completions 兼容 · /api/v2/chat/completions</span>
            <span style={S.kvk}>{t('about.auth')}</span>
            <span>SDK-HMAC-SHA256（AK + SK + STS）</span>
            <span style={S.kvk}>{t('about.encrypt')}</span>
            <span>P-256 ECDH 协商 + SM4-GCM 载荷加密</span>
            <span style={S.kvk}>Gateway</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>snap-access.cn-north-4.myhuaweicloud.com</span>
          </div>
        </div>
      )}
    </div>
  )
}




