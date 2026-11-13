import { useCallback, useEffect, useRef, useState } from 'react'

import { bridgeJson, type HealthPayload } from './bridge.ts'

/**
 * 码道状态胶囊。
 *
 * 折叠态：绿点 + 「码道」+ 剩余积分，尽量不占输入框空间。
 * 展开态：只展示**账号**与**额度**两件事。
 *
 * AK / STS / keyId 这类凭证细节刻意不放在这里 ——
 * 它们属于插件设置页的「账号」标签，浮层保持干净。
 *
 * 只读组件：数据来自桥接服务的 /diag/account 与 /diag/test。
 */

export interface ChipProps {
  t: (key: string) => string
}

interface PkgCredit {
  amount: number
  used: number
  remain: number
}

interface AccountInfo {
  ok: boolean
  stage?: string
  error?: string
  account?: string
  userId?: string
  roles?: string[]
  credit?: {
    total: number
    used: number
    remain: number
    basic?: PkgCredit
    bonus?: PkgCredit
    onDemand?: PkgCredit
    totalTokens?: number
  }
}

interface TestStep {
  name: string
  ok: boolean
  detail?: string
  ms?: number
}

function fmt(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export function ComposerChip({ t }: ChipProps) {
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<TestStep[] | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await bridgeJson<HealthPayload>('/healthz'))
    } catch {
      setHealth({ ok: false, stage: 'offline' })
    }
  }, [])

  const refreshAccount = useCallback(async () => {
    try {
      setAccount(await bridgeJson<AccountInfo>('/diag/account', 20_000))
    } catch (e) {
      setAccount({ ok: false, stage: 'offline', error: String(e) })
    }
  }, [])

  useEffect(() => {
    let alive = true
    refreshHealth()
    const timer = setInterval(() => {
      if (alive) refreshHealth()
    }, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [refreshHealth])

  // 展开时才查额度，避免每分钟都打额度接口
  useEffect(() => {
    if (open) void refreshAccount()
  }, [open, refreshAccount])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /**
   * 唯一按钮：测账号 + 刷额度。
   *
   * 走 /diag/test 全链路（STS → 协商 → 模型 → 额度），
   * 它顺便把额度重新读了一遍，所以不需要第二个「刷新」按钮。
   */
  const testAndRefresh = useCallback(async () => {
    setBusy(true)
    setSteps(null)
    try {
      const r = await bridgeJson<{ ok: boolean; steps: TestStep[] }>('/diag/test', 90_000)
      setSteps(r.steps ?? [])
      void refreshHealth()
      void refreshAccount()
    } catch (e) {
      setSteps([{ name: t('chip.test'), ok: false, detail: String(e) }])
    } finally {
      setBusy(false)
    }
  }, [refreshAccount, refreshHealth, t])

  const state = health?.ok ? 'ready' : health ? 'fail' : 'idle'
  const label = state === 'ready' ? t('chip.ready') : t('chip.idle')
  const credit = account?.credit

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button style={S.chip(state)} onClick={() => setOpen((v) => !v)} title={t('meta.title')}>
        <span style={S.dot(state)} />
        {label}
        {credit ? <span style={S.mini}>{fmt(credit.remain)}</span> : null}
      </button>

      {open && (
        <div style={S.pop}>
          {/* ── 账号 ───────────────────────────── */}
          <div style={S.head}>
            <span style={{ fontWeight: 600 }}>{t('chip.account')}</span>
            <span style={S.badge(!!health?.ok)}>{health?.ok ? t('chip.online') : t('chip.offline')}</span>
          </div>
          <div style={S.account}>
            <span style={S.avatar}>{(account?.account ?? '?').slice(0, 1).toUpperCase()}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{account?.account ?? '—'}</span>
              {account?.roles?.length ? <span style={S.sub}>{account.roles.join(', ')}</span> : null}
            </div>
          </div>

          <div style={S.sep} />

          {/* ── 额度 ───────────────────────────── */}
          <div style={S.head}>
            <span style={{ fontWeight: 600 }}>{t('chip.credit')}</span>
          </div>
          {credit ? (
            <>
              <div style={S.big}>
                {fmt(credit.remain)}
                <span style={S.bigUnit}> / {fmt(credit.total)}</span>
              </div>
              <div style={S.kv}>
                <span style={S.k}>{t('chip.used')}</span>
                <span style={S.mono}>{fmt(credit.used)}</span>
                {credit.bonus ? (
                  <>
                    <span style={S.k}>{t('chip.bonus')}</span>
                    <span style={S.mono}>{fmt(credit.bonus.remain)}</span>
                  </>
                ) : null}
                {credit.basic ? (
                  <>
                    <span style={S.k}>{t('chip.basic')}</span>
                    <span style={S.mono}>{fmt(credit.basic.remain)}</span>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <div style={S.hint}>{account?.error ?? t('chip.noCredit')}</div>
          )}

          <div style={S.sep} />

          <button style={S.testBtn(busy)} disabled={busy} onClick={() => void testAndRefresh()}>
            {busy ? t('chip.testing') : t('chip.testRefresh')}
          </button>

          {steps && (
            <div style={S.steps}>
              {steps.map((s) => (
                <div key={s.name} style={S.stepRow}>
                  <span style={{ color: s.ok ? 'var(--dsh-color-success, #3fb950)' : 'var(--dsh-color-danger, #f85149)' }}>
                    {s.ok ? '✓' : '✗'}
                  </span>
                  <span style={{ flex: 1 }}>{s.name}</span>
                  <span style={S.stepDetail} title={s.detail}>
                    {s.detail ?? (s.ms ? `${s.ms}ms` : '')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const S = {
  chip: (state: string) =>
    ({
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      height: 26,
      padding: '0 9px',
      borderRadius: 13,
      border: '1px solid var(--dsh-color-border, rgba(255,255,255,.12))',
      background: 'transparent',
      color: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
      opacity: state === 'idle' ? 0.6 : 1,
    }) as React.CSSProperties,
  dot: (state: string) =>
    ({
      width: 6,
      height: 6,
      borderRadius: '50%',
      background:
        state === 'ready'
          ? 'var(--dsh-color-success, #3fb950)'
          : state === 'fail'
            ? 'var(--dsh-color-danger, #f85149)'
            : 'var(--dsh-color-text-secondary, #8b949e)',
    }) as React.CSSProperties,
  mini: {
    marginLeft: 2,
    paddingLeft: 6,
    borderLeft: '1px solid var(--dsh-color-border, rgba(255,255,255,.12))',
    fontFamily: 'monospace',
    fontSize: 11,
    opacity: 0.75,
  } as React.CSSProperties,
  pop: {
    position: 'absolute',
    bottom: 'calc(100% + 8px)',
    right: 0,
    width: 288,
    padding: 12,
    borderRadius: 10,
    border: '1px solid var(--dsh-color-border, rgba(255,255,255,.12))',
    background: 'var(--dsh-color-surface, #161b22)',
    boxShadow: '0 8px 28px rgba(0,0,0,.45)',
    color: 'var(--dsh-color-text, #e6edf3)',
    fontSize: 12,
    zIndex: 50,
  } as React.CSSProperties,
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 } as React.CSSProperties,
  badge: (ok: boolean) =>
    ({
      fontSize: 10,
      padding: '1px 6px',
      borderRadius: 8,
      background: ok ? 'rgba(63,185,80,.16)' : 'rgba(248,81,73,.16)',
      color: ok ? 'var(--dsh-color-success, #3fb950)' : 'var(--dsh-color-danger, #f85149)',
    }) as React.CSSProperties,
  account: { display: 'flex', alignItems: 'center', gap: 8 } as React.CSSProperties,
  avatar: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(139,148,158,.22)',
    fontSize: 12,
    fontWeight: 600,
    flexShrink: 0,
  } as React.CSSProperties,
  sub: { fontSize: 10, opacity: 0.5 } as React.CSSProperties,
  kv: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', alignItems: 'center' } as React.CSSProperties,
  k: { opacity: 0.6, fontSize: 11 } as React.CSSProperties,
  mono: { fontFamily: 'monospace', fontSize: 11 } as React.CSSProperties,
  big: { fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginBottom: 5 } as React.CSSProperties,
  bigUnit: { fontSize: 12, fontWeight: 400, opacity: 0.55 } as React.CSSProperties,
  sep: { height: 1, background: 'var(--dsh-color-border, rgba(255,255,255,.12))', margin: '10px 0' } as React.CSSProperties,
  hint: { fontSize: 11, opacity: 0.6, lineHeight: 1.5 } as React.CSSProperties,
  testBtn: (busy: boolean) =>
    ({
      width: '100%',
      height: 30,
      borderRadius: 7,
      border: '1px solid var(--dsh-color-border, rgba(255,255,255,.12))',
      background: 'var(--dsh-color-surface-raised, rgba(255,255,255,.05))',
      color: 'inherit',
      fontSize: 12,
      cursor: busy ? 'default' : 'pointer',
      opacity: busy ? 0.6 : 1,
    }) as React.CSSProperties,
  steps: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 3 } as React.CSSProperties,
  stepRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 } as React.CSSProperties,
  stepDetail: { opacity: 0.55, fontFamily: 'monospace', fontSize: 10, maxWidth: 140, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as React.CSSProperties,
}
