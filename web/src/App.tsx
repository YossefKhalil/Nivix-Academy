import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import {
  ROUNDS, SECTOR, ENERGY_MAX, COST_HINT, COST_AI, RECHARGE_SEC,
  PY_CODE, CS_CODE, initial, reduce, fmt,
  type State, type Action, type Player,
} from './duel'
import { Button } from '@/components/ui/button'
import { Frame, parsePaths } from '@/components/ui/frame'
import { FrameCorners } from '@arwes/react-frames'
import { Animator, Dots, Text, useBleeps } from '@arwes/react'
import { Panel } from '@/components/ui/panel'
import { cn } from '@/lib/utils'
import { useAudio, useSfx, SOUND_PACKS, type Sfx, type SfxName } from './sfx'
import { getAgentStatus, openInEditor, type AgentStatus } from './agent'

type Send = (a: Action) => void
const borderA = (c: string) => `color-mix(in oklab, ${c} 50%, transparent)`

/* ── atoms ─────────────────────────────────────────── */

function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'accent' }) {
  const c = tone === 'warn' ? 'var(--color-amber)' : tone === 'accent' ? 'var(--color-green)' : 'var(--text-muted)'
  return (
    <span className="font-mono text-[9px] tracking-[0.1em] px-1.5 py-0.5 border" style={{ color: c, borderColor: borderA(c) }}>
      {children}
    </span>
  )
}

function SegTabs({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { id: string; label: string }[] }) {
  return (
    <div className="inline-flex items-stretch overflow-hidden" style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'color-mix(in oklab, var(--surface) 85%, transparent)' }}>
      {items.map((it, i) => {
        const active = value === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="relative font-mono text-[10px] tracking-[0.16em] px-3 py-1.5 bg-transparent cursor-pointer transition-colors"
            style={{
              color: active ? 'var(--color-primary)' : 'var(--text-secondary)',
              background: active ? 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 22%, transparent), color-mix(in oklab, var(--color-primary) 6%, transparent))' : 'transparent',
              borderLeft: i ? '1px solid var(--border)' : undefined,
              boxShadow: active ? 'inset 0 0 14px color-mix(in oklab, var(--color-primary) 16%, transparent)' : undefined,
            }}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── window header (shared by BRIEF / SUPPORT / WORKSPACE / TESTER) ── */

function PanelHead({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 h-[32px] px-3 shrink-0"
      style={{
        borderBottom: '1px solid var(--border)',
        background: 'color-mix(in oklab, var(--surface-raised) 45%, transparent)',
      }}
    >
      <span className="font-orbitron font-bold uppercase text-[12px] tracking-[0.24em]" style={{ color: 'var(--color-primary)', textShadow: '0 0 14px color-mix(in oklab, var(--color-primary) 30%, transparent)' }}>{title}</span>
      {left}
      <span className="flex-1" />
      {right}
    </div>
  )
}

function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" opacity={0.35} />
      <path d="M8 12.4l2.7 2.7L16.2 9.6" />
    </svg>
  )
}

function StandbyIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" strokeDasharray="3 3" opacity={0.7} />
      <path d="M12 7.6V12l3 1.8" />
    </svg>
  )
}

/** Ready / standby tell shown for both players in the lobby. */
function ReadyMark({ ready, opponent }: { ready: boolean; opponent?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 font-mono text-[9px] tracking-[0.14em]"
      style={{ color: ready ? 'var(--color-green)' : opponent ? 'var(--color-amber)' : 'var(--text-muted)' }}
      title={ready ? 'ready' : 'not ready'}
    >
      {ready ? <CheckIcon /> : <StandbyIcon />}
      {ready ? 'READY' : 'STANDBY'}
    </span>
  )
}

const PY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><linearGradient id="python-original-a" gradientUnits="userSpaceOnUse" x1="70.252" y1="1237.476" x2="170.659" y2="1151.089" gradientTransform="matrix(.563 0 0 -.568 -29.215 707.817)"><stop offset="0" stop-color="#5A9FD4"/><stop offset="1" stop-color="#306998"/></linearGradient><linearGradient id="python-original-b" gradientUnits="userSpaceOnUse" x1="209.474" y1="1098.811" x2="173.62" y2="1149.537" gradientTransform="matrix(.563 0 0 -.568 -29.215 707.817)"><stop offset="0" stop-color="#FFD43B"/><stop offset="1" stop-color="#FFE873"/></linearGradient><path fill="url(#python-original-a)" d="M63.391 1.988c-4.222.02-8.252.379-11.8 1.007-10.45 1.846-12.346 5.71-12.346 12.837v9.411h24.693v3.137H29.977c-7.176 0-13.46 4.313-15.426 12.521-2.268 9.405-2.368 15.275 0 25.096 1.755 7.311 5.947 12.519 13.124 12.519h8.491V67.234c0-8.151 7.051-15.34 15.426-15.34h24.665c6.866 0 12.346-5.654 12.346-12.548V15.833c0-6.693-5.646-11.72-12.346-12.837-4.244-.706-8.645-1.027-12.866-1.008zM50.037 9.557c2.55 0 4.634 2.117 4.634 4.721 0 2.593-2.083 4.69-4.634 4.69-2.56 0-4.633-2.097-4.633-4.69-.001-2.604 2.073-4.721 4.633-4.721z" transform="translate(0 10.26)"/><path fill="url(#python-original-b)" d="M91.682 28.38v10.966c0 8.5-7.208 15.655-15.426 15.655H51.591c-6.756 0-12.346 5.783-12.346 12.549v23.515c0 6.691 5.818 10.628 12.346 12.547 7.816 2.297 15.312 2.713 24.665 0 6.216-1.801 12.346-5.423 12.346-12.547v-9.412H63.938v-3.138h37.012c7.176 0 9.852-5.005 12.348-12.519 2.578-7.735 2.467-15.174 0-25.096-1.774-7.145-5.161-12.521-12.348-12.521h-9.268zM77.809 87.927c2.561 0 4.634 2.097 4.634 4.692 0 2.602-2.074 4.719-4.634 4.719-2.55 0-4.633-2.117-4.633-4.719 0-2.595 2.083-4.692 4.633-4.692z" transform="translate(0 10.26)"/><radialGradient id="python-original-c" cx="1825.678" cy="444.45" r="26.743" gradientTransform="matrix(0 -.24 -1.055 0 532.979 557.576)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#B8B8B8" stop-opacity=".498"/><stop offset="1" stop-color="#7F7F7F" stop-opacity="0"/></radialGradient><path opacity=".444" fill="url(#python-original-c)" d="M97.309 119.597c0 3.543-14.816 6.416-33.091 6.416-18.276 0-33.092-2.873-33.092-6.416 0-3.544 14.815-6.417 33.092-6.417 18.275 0 33.091 2.872 33.091 6.417z"/></svg>`

const CS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><path fill="#9B4F96" d="M115.4 30.7L67.1 2.9c-.8-.5-1.9-.7-3.1-.7-1.2 0-2.3.3-3.1.7l-48 27.9c-1.7 1-2.9 3.5-2.9 5.4v55.7c0 1.1.2 2.4 1 3.5l106.8-62c-.6-1.2-1.5-2.1-2.4-2.7z"/><path fill="#68217A" d="M10.7 95.3c.5.8 1.2 1.5 1.9 1.9l48.2 27.9c.8.5 1.9.7 3.1.7 1.2 0 2.3-.3 3.1-.7l48-27.9c1.7-1 2.9-3.5 2.9-5.4V36.1c0-.9-.1-1.9-.6-2.8l-106.6 62z"/><path fill="#fff" d="M85.3 76.1C81.1 83.5 73.1 88.5 64 88.5c-13.5 0-24.5-11-24.5-24.5s11-24.5 24.5-24.5c9.1 0 17.1 5 21.3 12.5l13-7.5c-6.8-11.9-19.6-20-34.3-20-21.8 0-39.5 17.7-39.5 39.5s17.7 39.5 39.5 39.5c14.6 0 27.4-8 34.2-19.8l-12.9-7.6zM97 66.2l.9-4.3h-4.2v-4.7h5.1L100 51h4.9l-1.2 6.1h3.8l1.2-6.1h4.8l-1.2 6.1h2.4v4.7h-3.3l-.9 4.3h4.2v4.7h-5.1l-1.2 6h-4.9l1.2-6h-3.8l-1.2 6h-4.8l1.2-6h-2.4v-4.7H97zm4.8 0h3.8l.9-4.3h-3.8l-.9 4.3z"/></svg>`

function PythonIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, display: 'inline-block', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: PY_SVG.replace('<svg ', `<svg width="${size}" height="${size}" `) }}
    />
  )
}

function CSharpIcon({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, display: 'inline-block', flexShrink: 0 }}
      dangerouslySetInnerHTML={{ __html: CS_SVG.replace('<svg ', `<svg width="${size}" height="${size}" `) }}
    />
  )
}

function VscodeIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#22A7F0" aria-hidden="true">
      <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </svg>
  )
}

function LangIcon({ lang, size = 12 }: { lang: 'python' | 'csharp'; size?: number }) {
  return lang === 'python' ? <PythonIcon size={size} /> : <CSharpIcon size={size} />
}

function Stage({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-[3px]" title={`stage ${n}/4`}>
      {[1, 2, 3, 4].map(i => {
        const on = i <= n
        const current = i === n
        return (
          <i
            key={i}
            className="block w-[11px] h-[8px]"
            style={{
              background: on ? 'var(--color-primary)' : 'color-mix(in oklab, var(--border) 80%, transparent)',
              clipPath: 'polygon(34% 0, 100% 0, 66% 100%, 0 100%)',
              boxShadow: current
                ? '0 0 10px color-mix(in oklab, var(--color-primary) 60%, transparent)'
                : on ? '0 0 5px color-mix(in oklab, var(--color-primary) 35%, transparent)' : undefined,
              transition: 'background 0.3s ease, box-shadow 0.3s ease',
            }}
          />
        )
      })}
    </span>
  )
}

function EnergyGauge({ value, big }: { value: number; big?: boolean }) {
  const max = ENERGY_MAX
  const c = value <= 2 ? 'var(--color-red)' : value <= 5 ? 'var(--color-amber)' : 'var(--color-green)'
  const segW = big ? 7 : 4
  const segH = big ? 14 : 9
  const gap = big ? 3 : 2
  return (
    <span className="inline-flex items-center gap-1.5" title={`${value}/${max} charges · +1 every ${RECHARGE_SEC}s`}>
      <span style={{ color: c, fontSize: big ? 14 : 11, lineHeight: 1 }}>⚡</span>
      <span className="inline-flex items-center">
        <span
          className="inline-flex items-center"
          style={{ gap, padding: 2, height: segH + 4, border: `1px solid color-mix(in oklab, ${c} 40%, transparent)`, borderRadius: 3, background: `color-mix(in oklab, ${c} 6%, transparent)` }}
        >
          {Array.from({ length: max }).map((_, i) => {
            const on = i < value
            return (
              <i
                key={i}
                style={{
                  display: 'block',
                  width: segW,
                  height: segH,
                  borderRadius: 1,
                  background: on ? c : 'color-mix(in oklab, var(--border) 75%, transparent)',
                  boxShadow: on ? `0 0 6px color-mix(in oklab, ${c} 55%, transparent)` : undefined,
                  transition: 'background 0.25s ease, box-shadow 0.25s ease',
                }}
              />
            )
          })}
        </span>
        <span style={{ display: 'block', width: 3, height: big ? 8 : 6, marginLeft: 1, borderRadius: '0 2px 2px 0', background: `color-mix(in oklab, ${c} 55%, transparent)` }} />
      </span>
      <span className="font-mono" style={{ color: c, fontSize: big ? 12 : 11 }}>{value}</span>
    </span>
  )
}

function Pcard({ p, total, connection }: { p: Player; total?: number; connection?: boolean }) {
  return (
    <span
      className="relative flex items-center gap-2 h-[30px] px-3"
      style={{
        '--arwes-frames-line-color': 'color-mix(in oklab, var(--color-primary) 45%, transparent)',
        '--arwes-frames-bg-color': 'transparent',
      } as CSSProperties}
    >
      <FrameCorners animated={false} strokeWidth={1} cornerLength={8} padding={2} style={{ pointerEvents: 'none' }} />
      {connection === false && (
        <span className="relative font-mono text-[8px] tracking-[0.12em]" title="reconnecting" style={{ color: 'var(--color-amber)' }}>RECONNECTING</span>
      )}
      <span className="relative font-orbitron text-[12px] tracking-[0.06em]">{p.name || 'YOU'}</span>
      <LangIcon lang={p.lang} size={12} />
      <Stage n={p.stage} />
      {p.score != null && total != null && (
        <span className="relative font-mono text-[10px] tracking-[0.04em]" style={{ color: 'var(--color-green)' }}>{p.score}<span style={{ color: 'var(--text-muted)' }}>/{total}</span></span>
      )}
      {p.submitted && <span className="relative font-mono text-[8px] tracking-[0.1em]" style={{ color: 'var(--color-amber)' }}>SUBMITTED</span>}
    </span>
  )
}

/* ── timing / dispatch ─────────────────────────────── */

function useDuel(): [State, Send] {
  const [s, dispatch] = useReducer(reduce, undefined, initial)
  const ref = useRef(s)
  ref.current = s

  const send = useCallback((a: Action) => {
    dispatch(a)
    if (a.type === 'CREATE_ROOM' || a.type === 'JOIN_ROOM') {
      setTimeout(() => dispatch({ type: 'OPP_JOIN' }), 1200)
      setTimeout(() => dispatch({ type: 'OPP_READY' }), 2600)
    }
    if (a.type === 'SEND_CHAT') setTimeout(() => dispatch({ type: 'OPP_CHAT' }), 1200 + Math.random() * 1200)
  }, [])

  useEffect(() => {
    let acc = { boot: 0, count: 0, tick: 0 }
    let last = ref.current.screen
    const id = setInterval(() => {
      const st = ref.current
      if (st.screen !== last) { last = st.screen; acc = { boot: 0, count: 0, tick: 0 } }
      if (st.screen === 'boot') { acc.boot += 250; if (acc.boot >= 600) { acc.boot = 0; dispatch({ type: 'BOOT' }) } }
      else if (st.screen === 'countdown') { acc.count += 250; if (acc.count >= 800) { acc.count = 0; dispatch({ type: st.countdown > 0 ? 'COUNT' : 'MATCH_BEGIN' }) } }
      else if (st.screen === 'match') { acc.tick += 250; if (acc.tick >= 1000) { acc.tick = 0; dispatch({ type: 'TICK' }) } }
    }, 250)
    return () => clearInterval(id)
  }, [])

  return [s, send]
}

/* ── sound reactions ───────────────────────────────── */

// Turn state transitions into bleeps (round start, submit, results).
function useSoundReactions(s: State, sfx: Sfx) {
  const prev = useRef(s)
  useEffect(() => {
    const p = prev.current
    if (s.screen !== p.screen) {
      if (s.screen === 'countdown') sfx.open()
      else if (s.screen === 'roundResult') {
        const r = s.rounds[s.rounds.length - 1]
        r && r.me >= r.opp ? sfx.confirm() : sfx.close()
      } else if (s.screen === 'matchResult') {
        const me = s.rounds.reduce((a, r) => a + r.me, 0)
        const opp = s.rounds.reduce((a, r) => a + r.opp, 0)
        me >= opp ? sfx.win() : sfx.close()
      } else if (s.screen === 'lobby') sfx.close()
    }
    if (s.screen === 'countdown' && s.countdown !== p.countdown) (s.countdown > 0 ? sfx.tick() : sfx.go())
    if (s.ranTests && !p.ranTests) sfx.type()
    if (s.me.submitted && !p.me.submitted) sfx.confirm()
    if (s.opp.submitted && !p.opp.submitted) sfx.notify()
    const latest = s.chat[s.chat.length - 1]
    if (s.chat.length > p.chat.length && latest && !latest.sys && !latest.me) sfx.notify()
    prev.current = s
  })
}

// A bleep for every button press (kept quiet; no hover chatter).
function useGlobalSfx(sfx: Sfx) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('button')) sfx.click()
    }
    window.addEventListener('click', onClick, true)
    return () => window.removeEventListener('click', onClick, true)
  }, [sfx])
}

/* ── agent presence ────────────────────────────────── */

function useAgent() {
  const [status, setStatus] = useState<AgentStatus | null>(null)
  useEffect(() => {
    let alive = true
    const probe = async () => {
      const st = await getAgentStatus()
      if (alive) setStatus(st)
    }
    probe()
    const id = window.setInterval(probe, 15000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  return status
}

/* ── HUD ───────────────────────────────────────────── */

function MuteButton() {
  const { muted, setMuted } = useAudio()
  const bleeps = useBleeps<SfxName>()
  const onToggle = () => {
    const next = !muted
    setMuted(next)
    if (next) { try { bleeps.toggle?.play() } catch { /* gesture gate */ } }
  }
  return (
    <button
      onClick={onToggle}
      title={muted ? 'sound off' : 'sound on'}
      className="relative font-mono text-[9px] tracking-[0.14em] cursor-pointer bg-transparent border-0 inline-flex items-center gap-1"
      style={{ color: muted ? 'var(--text-muted)' : 'var(--color-primary)' }}
    >
      <span style={{ fontSize: 11, lineHeight: 1 }}>{muted ? '🔇' : '🔊'}</span>
      {muted ? 'OFF' : 'ON'}
    </button>
  )
}

function Hud({ s }: { s: State }) {
  const total = ROUNDS[s.round - 1].tests.length
  return (
    <header
      className="relative shrink-0 grid items-center gap-4 h-[48px] px-4 whitespace-nowrap"
      style={{
        gridTemplateColumns: '1fr auto 1fr',
        background: 'linear-gradient(180deg, color-mix(in oklab, var(--surface-raised) 92%, black), var(--surface))',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-primary) 55%, transparent), transparent)' }} />

      {/* left — identity + you */}
      <div className="flex items-center justify-between gap-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-orbitron font-bold text-[13px] tracking-[0.18em]" style={{ color: 'var(--color-primary)', textShadow: 'var(--text-glow-green)' }}>◈ HTTP DUEL</span>
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          <span className="font-orbitron text-[11px] tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>ROUND {s.round}<span style={{ color: 'var(--text-muted)' }}>/{s.totalRounds}</span></span>
        </div>
        <Pcard p={s.me} total={total} />
      </div>

      {/* centre — VS (own column, so it stays centred) */}
      <span
        className="grid place-items-center w-[36px] h-[26px] font-orbitron font-bold text-[10px] tracking-[0.16em]"
        style={{
          color: 'var(--color-primary)',
          background: 'color-mix(in oklab, var(--color-primary) 10%, transparent)',
          boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 38%, transparent)',
          clipPath: 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
        }}
      >
        VS
      </span>

      {/* right — opponent + vitals */}
      <div className="flex items-center justify-between gap-4 min-w-0">
        <Pcard p={s.opp} total={total} connection={s.opp.connected} />
        <div className="flex items-center gap-3">
          <EnergyGauge value={s.energy} />
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          <span className="font-mono text-[13px] tracking-[0.06em]" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>{fmt(s.elapsed)}</span>
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          <MuteButton />
        </div>
      </div>
    </header>
  )
}

/* ── boot ──────────────────────────────────────────── */

function Boot({ s, send }: { s: State; send: Send }) {
  const L = ['SYS:ONLINE', 'MOUNTING ' + SECTOR, 'LINK ESTABLISHED']
  return (
    <div className="flex-1 flex items-center px-16 cursor-pointer" onClick={() => send({ type: 'SKIP_BOOT' })}>
      <div className="font-mono text-primary text-[15px] leading-[2.1]">
        {L.slice(0, s.bootLine + 1).map(x => <div key={x}>&gt; {x}</div>)}
        <div className="pulse-glow">█</div>
        <div className="mt-4 text-[10px] tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>click to skip</div>
      </div>
    </div>
  )
}

/* ── lobby ─────────────────────────────────────────── */

const CARD_PATHS = '[{"show":true,"style":{"strokeWidth":"1","stroke":"var(--color-frame-1-stroke)","fill":"var(--color-frame-1-fill)"},"path":[["M","16","0"],["L","100% - 54","0"],["L","100% - 44","10"],["L","100% - 0","10"],["L","100% - 0","100% - 18"],["L","100% - 18","100% - 0"],["L","0","100% - 0"],["L","0","16"],["L","16","0"]]},{"show":true,"style":{"strokeWidth":"1","stroke":"var(--color-frame-2-stroke)","fill":"var(--color-frame-2-fill)"},"path":[["M","100% - 40","3"],["L","100% - 20","3"],["L","100% - 16","7"],["L","100% - 36","7"],["L","100% - 40","3"]]}]'

function GameCard({ className, bodyClassName, children }: { className?: string; bodyClassName?: string; children: ReactNode }) {
  return (
    <div
      className={cn('relative', className)}
      style={{
        '--color-frame-1-stroke': 'color-mix(in oklab, var(--color-primary) 55%, transparent)',
        '--color-frame-1-fill': 'var(--surface)',
        '--color-frame-2-stroke': 'var(--color-accent)',
        '--color-frame-2-fill': 'color-mix(in oklab, var(--color-accent) 85%, transparent)',
      } as CSSProperties}
    >
      <Frame paths={parsePaths(CARD_PATHS)} />
      <div className={cn('relative z-[1] h-full', bodyClassName)}>{children}</div>
    </div>
  )
}

/* ── lobby live backdrop (server room) ─────────────── */

function LobbyBackdrop() {
  const { muted } = useAudio()
  const ref = useRef<HTMLVideoElement>(null)
  const gainRef = useRef(0)

  useEffect(() => {
    const v = ref.current
    if (!v) return

    const TARGET = 0.14    // ambient level
    const FADE_IN = 3      // seconds to fade in after sound is enabled
    const LOOP_FADE = 1.8  // seconds to fade across the loop seam

    if (muted) {
      gainRef.current = 0
      v.muted = true
      v.volume = 0
      return
    }

    v.muted = false
    v.volume = 0

    // Envelope: quiet at the loop seam so the restart is inaudible.
    const seam = () => {
      const d = v.duration || 0
      if (!d) return 1
      const t = v.currentTime
      return Math.max(0, Math.min(1, t / LOOP_FADE, (d - t) / LOOP_FADE))
    }
    const apply = () => { v.volume = TARGET * gainRef.current * seam() }

    const started = Date.now()
    const ramp = window.setInterval(() => {
      gainRef.current = Math.min(1, (Date.now() - started) / (FADE_IN * 1000))
      apply()
      if (gainRef.current >= 1) window.clearInterval(ramp)
    }, 60)

    v.addEventListener('timeupdate', apply)
    apply()

    return () => {
      window.clearInterval(ramp)
      v.removeEventListener('timeupdate', apply)
    }
  }, [muted])

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <video
        ref={ref}
        className="lobby-video"
        src="/media/server-room.mp4"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
      />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, color-mix(in oklab, var(--background) 50%, transparent), color-mix(in oklab, var(--background) 92%, transparent))' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 8%, transparent 20%, var(--background) 96%)' }} />
    </div>
  )
}

function Lobby({ s, send, agent }: { s: State; send: Send; agent: AgentStatus | null }) {
  const seg = (l: 'python' | 'csharp', label: string, i: number) => {
    const active = s.me.lang === l
    return (
      <button
        key={l}
        onClick={() => send({ type: 'SET_LANG', value: l })}
        className="relative font-mono text-[11px] tracking-[0.12em] px-4 py-2 cursor-pointer inline-flex items-center gap-2"
        style={{
          color: active ? 'var(--color-primary)' : 'var(--text-muted)',
          background: active
            ? 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 22%, transparent), color-mix(in oklab, var(--color-primary) 6%, transparent))'
            : 'transparent',
          borderLeft: i ? '1px solid var(--border)' : undefined,
          boxShadow: active ? 'inset 0 0 16px color-mix(in oklab, var(--color-primary) 18%, transparent)' : undefined,
        }}
      >
        <LangIcon lang={l} size={14} />
        {label}
      </button>
    )
  }

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      <LobbyBackdrop />
      <div className="relative z-10 flex-1 overflow-auto flex justify-center">
        <div className="w-[min(820px,92vw)] flex flex-col gap-5 py-8">
          <div className="text-center">
            <div className="font-orbitron font-bold text-[26px] tracking-[0.22em] text-primary" style={{ textShadow: '0 0 34px color-mix(in oklab, var(--color-primary) 40%, transparent)' }}>HTTP DUEL</div>
            <div className="font-mono text-[9px] tracking-[0.3em] mt-1.5" style={{ color: 'var(--text-muted)' }}>PROTOCOL COMBAT · PYTHON VS C#</div>
          </div>

          <div className="flex items-center justify-center gap-2 font-mono text-[9px] tracking-[0.14em]">
            {agent ? (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-green)', boxShadow: 'var(--glow-green)' }} />
                <span style={{ color: 'var(--color-green)' }}>AGENT ONLINE</span>
                {agent.zerotier
                  ? <span style={{ color: 'var(--text-muted)' }}>· ZT {agent.zerotier.address}</span>
                  : agent.lan ? <span style={{ color: 'var(--text-muted)' }}>· LAN {agent.lan.address}</span> : null}
                {agent.editor ? <span style={{ color: 'var(--text-muted)' }}>· {agent.editor.name.toUpperCase()}</span> : null}
              </>
            ) : (
              <>
                <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>MOCK MODE · no agent</span>
              </>
            )}
          </div>

          <GameCard bodyClassName="flex gap-6 items-end p-5">
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>DISPLAY NAME</label>
              <input
                value={s.me.name}
                onChange={e => send({ type: 'SET_NAME', value: e.target.value })}
                placeholder="NOVA"
                className="font-mono text-[14px] tracking-[0.1em] px-3 py-2 border bg-transparent outline-none min-w-[230px]"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>LANGUAGE</label>
              <div className="inline-flex items-stretch overflow-hidden self-start" style={{ border: '1px solid var(--border)', borderRadius: 3, background: 'color-mix(in oklab, var(--surface-raised) 60%, transparent)' }}>
                {seg('python', 'PYTHON', 0)}
                {seg('csharp', 'C#', 1)}
              </div>
            </div>
          </GameCard>

          {!s.role ? (
            <div className="grid grid-cols-2 gap-4">
              <GameCard bodyClassName="p-5 flex flex-col gap-3 h-full">
                <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>HOST MATCH</span>
                <p className="font-roboto text-[13px] leading-6" style={{ color: 'var(--text-muted)' }}>Create a room and share the code or join link.</p>
                <div className="mt-auto"><Button shape="flat" className="!mb-0 !px-5 !py-1.5" onClick={() => send({ type: 'CREATE_ROOM' })}>CREATE ROOM</Button></div>
              </GameCard>
              <GameCard bodyClassName="p-5 flex flex-col gap-3 h-full">
                <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>JOIN MATCH</span>
                <p className="font-roboto text-[13px] leading-6" style={{ color: 'var(--text-muted)' }}>Enter a room code (same LAN) or paste a join link.</p>
                <input placeholder="7F3K" className="font-mono tracking-[0.16em] uppercase px-3 py-2 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
                <div className="mt-auto"><Button shape="flat" variant="secondary" className="!mb-0 !px-5 !py-1.5" onClick={() => send({ type: 'JOIN_ROOM' })}>JOIN ROOM</Button></div>
              </GameCard>
            </div>
          ) : (
            <>
              <GameCard bodyClassName="p-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 items-center">
                <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>ROOM</span>
                <span className="font-orbitron text-[26px] tracking-[0.24em] text-primary">{s.room.code}</span>
                <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>LINK</span>
                <span className="font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>{s.room.link}</span>
              </GameCard>

              <div className="flex items-center gap-4">
                <GameCard className="flex-1" bodyClassName="flex items-center gap-3 p-4">
                  <span className="font-orbitron text-[15px] tracking-[0.1em]">{s.me.name || 'NOVA'}</span>
                  <LangIcon lang={s.me.lang} size={13} />
                  <ReadyMark ready={s.me.ready} />
                  <span className="flex-1" />
                  <Button shape="flat" className="!mb-0 !px-5 !py-1.5" onClick={() => send({ type: 'TOGGLE_READY' })}>{s.me.ready ? 'UNREADY' : 'READY'}</Button>
                </GameCard>
                <span className="font-orbitron text-[10px]" style={{ color: 'var(--text-muted)' }}>VS</span>
                <GameCard className="flex-1" bodyClassName="flex items-center gap-3 p-4">
                  <span className="font-orbitron text-[15px] tracking-[0.1em]" style={{ color: s.opp.joined ? undefined : 'var(--text-muted)' }}>{s.opp.joined ? s.opp.name : 'WAITING…'}</span>
                  {s.opp.joined && <LangIcon lang={s.opp.lang} size={13} />}
                  {s.opp.joined && <ReadyMark ready={s.opp.ready} opponent />}
                </GameCard>
              </div>

              <div className="flex justify-center">
                {s.role === 'host'
                  ? <Button shape="flat" className="!mb-0 !px-5 !py-1.5" disabled={!(s.me.ready && s.opp.ready)} onClick={() => send({ type: 'START' })}>START MATCH</Button>
                  : <span className="font-mono text-[10px] tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>WAITING FOR HOST TO START</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── match: brief ──────────────────────────────────── */

const PROSE = 'font-roboto text-[13px] leading-7 text-[var(--text-secondary)] [&_p]:my-3 [&_p]:text-[var(--text-muted)] [&_ul]:pl-5 [&_ul]:list-disc [&_li]:my-1.5 [&_li]:text-[var(--text-muted)] [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-primary [&_code]:px-1 [&_code]:bg-[rgba(111,159,245,0.10)]'

function Brief({ s, send }: { s: State; send: Send }) {
  const R = ROUNDS[s.round - 1]
  return (
    <div className="cosmic-panel h-full flex flex-col min-h-0 anim-in">
      <PanelHead title="BRIEF" />
      <div className="flex-1 overflow-auto px-5 py-4">
        <Animator key={s.round}>
          <Text as="h1" manager="decipher" className="font-orbitron text-[17px] tracking-[0.06em] mb-3 block">{R.title}</Text>
        </Animator>
        <div className={PROSE} dangerouslySetInnerHTML={{ __html: R.brief }} />
        <button
          onClick={() => send({ type: 'TOGGLE_HINTS' })}
          className="mt-5 pt-3 w-full flex items-center gap-2 font-mono text-[10px] tracking-[0.12em] bg-transparent border-0 border-t border-dashed cursor-pointer"
          style={{ borderTopColor: 'var(--border)', color: 'var(--accent-secondary)' }}
        >
          HINTS <span>{s.hintsOpen ? '▾' : '▸'}</span>
          {!s.hintsPaid && <span style={{ color: 'var(--color-amber)' }}>−{COST_HINT}⚡</span>}
        </button>
        {s.hintsOpen && (
          <div className={cn(PROSE, 'mt-2 px-3 py-2 border-l-2')} style={{ borderLeftColor: 'var(--accent-secondary)', background: 'color-mix(in oklab, var(--accent-secondary) 6%, transparent)' }} dangerouslySetInnerHTML={{ __html: R.hints }} />
        )}
      </div>
    </div>
  )
}

/* ── match: console (comms / wiki / nivix) ─────────── */

function LeftTabs({ s, send }: { s: State; send: Send }) {
  const [chat, setChat] = useState('')
  const [ask, setAsk] = useState('')
  const docs = [
    ['Python · http.server.BaseHTTPRequestHandler', 'context7'],
    ['HTTP Authorization header / Basic scheme', 'MDN'],
    ['base64 — encode & decode', 'Python docs'],
    ['C# · System.Net.HttpListener', 'learn.microsoft.com'],
    ['401 / 405 / 415 responses', 'RFC 9110'],
  ]
  const canAsk = s.energy >= COST_AI

  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead title="SUPPORT" right={<SegTabs value={s.leftTab} onChange={v => send({ type: 'LEFT_TAB', value: v })} items={[{ id: 'comms', label: 'CHAT' }, { id: 'wiki', label: 'WIKI' }, { id: 'ai', label: 'NIVIX AI' }]} />} />

      {s.leftTab === 'comms' && (
        <>
          <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
            {s.chat.length === 0 && <div className="font-mono text-[10px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>no traffic yet</div>}
            {s.chat.map((m, i) => m.sys
              ? <div key={i} className="flex items-center gap-2 py-0.5">
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
                <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{m.text}</span>
                <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
              </div>
              : m.me
                ? <div key={i} className="self-end max-w-[85%] flex flex-col items-end gap-0.5">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--color-green)' }}>{m.who}</span>
                  <div className="px-2.5 py-1.5 font-roboto text-[12px]" style={{ background: 'color-mix(in oklab, var(--color-primary) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--color-primary) 30%, transparent)', color: 'var(--text-secondary)', borderRadius: 3 }}>{m.text}</div>
                </div>
                : <div key={i} className="self-start max-w-[85%] flex gap-1.5">
                  <span className="w-5 h-5 flex items-center justify-center font-mono text-[9px] shrink-0" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--color-primary)' }}>{m.who?.slice(0, 1)}</span>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{m.who}</span>
                    <div className="px-2.5 py-1.5 font-roboto text-[12px]" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 3 }}>{m.text}</div>
                  </div>
                </div>
            )}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (chat.trim()) { send({ type: 'SEND_CHAT', value: chat.trim() }); setChat('') } }} style={{ borderTop: '1px solid var(--border)' }}>
            <div className="p-2">
              <div className="inputgroup">
                <span className="font-mono text-[12px]" style={{ color: 'var(--color-green)' }}>›</span>
                <input value={chat} onChange={e => setChat(e.target.value)} placeholder="message..." className="flex-1 bg-transparent outline-none font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }} />
                <button type="submit" className="micro">SEND</button>
              </div>
            </div>
          </form>
        </>
      )}

      {s.leftTab === 'wiki' && (
        <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-1.5">
          {docs.map(d => (
            <button key={d[0]} className="text-left flex items-center gap-2 px-2.5 py-2 border-l-2 bg-transparent cursor-pointer" style={{ borderLeftColor: 'color-mix(in oklab, var(--accent-secondary) 50%, transparent)', background: 'color-mix(in oklab, var(--surface-raised) 55%, transparent)' }}>
              <span className="flex-1 flex flex-col gap-0.5">
                <span className="font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }}>{d[0]}</span>
                <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{d[1]}</span>
              </span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>↗</span>
            </button>
          ))}
        </div>
      )}

      {s.leftTab === 'ai' && (
        <>
          <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <EnergyGauge value={s.energy} big />
              <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>+1 / {RECHARGE_SEC}s</span>
            </div>

            {s.wiki.length === 0 && (
              <>
                <p className="font-roboto text-[12px] leading-5" style={{ color: 'var(--text-muted)' }}>Ask about headers, status codes, base64, JSON. Each answer costs {COST_AI} charges. Recharges +1 every {RECHARGE_SEC}s.</p>
                <div className="flex flex-wrap gap-1.5">
                  {['401 + WWW-Authenticate', 'base64 decode', 'JSON body', '404 routing'].map(q => (
                    <button key={q} onClick={() => setAsk(q)} className="font-mono text-[9px] px-2 py-1 border bg-transparent cursor-pointer" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{q}</button>
                  ))}
                </div>
              </>
            )}

            {s.wiki.map((w, i) => (
              <div key={i} className="flex flex-col gap-1">
                <div className="self-end max-w-[90%] px-2.5 py-1.5 font-roboto text-[11px]" style={{ background: 'color-mix(in oklab, var(--color-primary) 10%, transparent)', border: '1px solid color-mix(in oklab, var(--color-primary) 28%, transparent)', color: 'var(--text-secondary)', borderRadius: 3 }}>{w.q}</div>
                <div className="flex gap-1.5">
                  <span className="w-5 h-5 flex items-center justify-center font-mono text-[9px] shrink-0" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--color-primary)' }}>N</span>
                  <div className={cn(PROSE, 'text-[11px] leading-5 flex-1 px-2.5 py-1.5')} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 3 }} dangerouslySetInnerHTML={{ __html: w.a }} />
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (ask.trim()) { send({ type: 'ASK', value: ask.trim() }); setAsk('') } }} style={{ borderTop: '1px solid var(--border)' }}>
            <div className="p-2">
              <div className="inputgroup">
                <span className="font-mono text-[11px]" style={{ color: canAsk ? 'var(--color-green)' : 'var(--color-red)' }}>⚡</span>
                <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={`ask nivix — ${COST_AI}⚡`} className="flex-1 bg-transparent outline-none font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }} />
                <button type="submit" disabled={!canAsk} className="micro">ASK</button>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  )
}

/* ── match: workspace ──────────────────────────────── */

function Workspace({ s, send }: { s: State; send: Send }) {
  const openWorkspace = async () => {
    const file = s.me.lang === 'python' ? 'python/server.py' : 'csharp/Program.cs'
    const r = await openInEditor(file)
    if (r === null) send({ type: 'VSCODE' })
    else if (r.ok) send({ type: 'SYS_NOTE', value: `OPENED IN ${(r.editor || 'EDITOR').toUpperCase()}` })
    else send({ type: 'SYS_NOTE', value: `EDITOR: ${r.error || 'could not open'}` })
  }
  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead
        title="WORKSPACE"
        right={<button onClick={openWorkspace} className="micro vscode inline-flex items-center gap-1.5"><VscodeIcon size={12} />OPEN IN VS CODE</button>}
      />

      <textarea
        key={s.me.lang}
        defaultValue={s.me.lang === 'python' ? PY_CODE : CS_CODE}
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none outline-none px-4 py-3 font-mono text-[13px] leading-[1.65]"
        style={{ background: 'var(--background)', color: 'var(--text-secondary)', border: 0 }}
      />
    </div>
  )
}

/* ── match: tester ─────────────────────────────────── */

function Tester({ s, send }: { s: State; send: Send }) {
  const R = ROUNDS[s.round - 1]
  const revealed = s.ranTests || s.final
  const shown = revealed ? R.tests.filter(t => t.visible || s.final) : []
  const passed = shown.filter(t => t.pass).length
  const failed = shown.length - passed
  const score = s.me.score != null ? `${s.me.score}/${R.tests.length}` : '—'
  const revealedSet = new Set(shown)

  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead
        title="TESTER"
        left={
          <>
            <span className="font-orbitron text-[15px] leading-none" style={{ color: 'var(--text-secondary)' }}>{score}</span>
            <span className="flex items-end gap-[3px] h-[14px]" title="per-test status">
              {R.tests.map((t, i) => {
                const on = revealedSet.has(t)
                const c = !on ? 'var(--border)' : t.pass ? 'var(--color-green)' : 'var(--color-red)'
                return <i key={i} className="block w-[5px] h-[14px]" style={{ background: c, opacity: on ? 1 : 0.5, boxShadow: on ? `0 0 6px ${c}` : undefined }} />
              })}
            </span>
            <span className="font-mono text-[9px]" style={{ color: 'var(--color-green)' }}>✓{passed}</span>
            <span className="font-mono text-[9px]" style={{ color: 'var(--color-red)' }}>✕{failed}</span>
          </>
        }
        right={
          <span className="microgroup">
            <button onClick={() => send({ type: 'RUN_TESTS' })} className="micro"><span className="mr-1 opacity-80">▶</span>RUN</button>
            <span style={{ width: 1, background: 'color-mix(in oklab, var(--color-primary) 25%, transparent)' }} />
            <button onClick={() => send({ type: 'SUBMIT' })} disabled={s.me.submitted} className="micro primary">SUBMIT</button>
          </span>
        }
      />

      <div className="flex-1 overflow-auto px-2 py-1 flex flex-col gap-1">
        {!shown.length && (
          <div className="flex items-center justify-center py-2">
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>RUN TESTS to probe the visible suite</span>
          </div>
        )}
        {shown.map((t, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-0.5 font-mono text-[10px]" style={{ borderLeft: `2px solid ${t.pass ? 'var(--color-green)' : 'var(--color-red)'}`, background: 'color-mix(in oklab, var(--surface) 55%, transparent)' }}>
            <span className="w-3 text-center" style={{ color: t.pass ? 'var(--color-green)' : 'var(--color-red)' }}>{t.pass ? '✓' : '✗'}</span>
            <span className="flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Match({ s, send }: { s: State; send: Send }) {
  return (
    <>
      <Hud s={s} />
      <div className="flex-1 grid min-h-0 gap-2 p-2" style={{ gridTemplateColumns: '44% 1fr' }}>
        <section className="grid min-h-0 gap-2" style={{ gridTemplateRows: '1fr 260px' }}>
          <Brief key={`b${s.round}`} s={s} send={send} />
          <LeftTabs key={`l${s.round}`} s={s} send={send} />
        </section>
        <section className="grid min-h-0 gap-2" style={{ gridTemplateRows: '1fr 260px' }}>
          <Workspace key={`w${s.round}`} s={s} send={send} />
          <Tester key={`t${s.round}`} s={s} send={send} />
        </section>
      </div>
    </>
  )
}

/* ── overlays ──────────────────────────────────────── */

function Countdown({ s }: { s: State }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overlay-in" style={{ background: 'rgba(9,12,17,0.94)' }}>
      <div key={s.countdown} className="count-pop font-orbitron font-bold text-[140px] text-primary" style={{ textShadow: '0 0 60px rgba(111,159,245,0.5)' }}>{s.countdown > 0 ? s.countdown : 'GO'}</div>
      <div className="mt-3 font-mono text-[12px] tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>ROUND {s.round} · {ROUNDS[s.round - 1].tag}</div>
    </div>
  )
}

function RoundResult({ s, send }: { s: State; send: Send }) {
  const r = s.rounds[s.rounds.length - 1]
  const v = r.me > r.opp ? 'ROUND WON' : r.me < r.opp ? 'ROUND LOST' : 'ROUND DRAWN'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overlay-in" style={{ background: 'rgba(9,12,17,0.94)' }}>
      <Panel notch="md" className="cosmic-panel flex flex-col items-center gap-4 px-10 py-7 min-w-[420px] anim-in">
        <span className="font-mono text-[10px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>ROUND {r.round} RESULT</span>
        <div className="flex items-center gap-8">
          <div className="text-center"><div className="font-orbitron text-[12px]">YOU</div><div className="font-orbitron text-[52px]" style={{ color: r.me >= r.opp ? 'var(--color-green)' : 'var(--text-muted)' }}>{r.me}</div></div>
          <span className="font-orbitron text-[11px]" style={{ color: 'var(--text-muted)' }}>VS</span>
          <div className="text-center"><div className="font-orbitron text-[12px]">{s.opp.name}</div><div className="font-orbitron text-[52px]" style={{ color: r.opp >= r.me ? 'var(--color-green)' : 'var(--text-muted)' }}>{r.opp}</div></div>
        </div>
        <div className="font-orbitron text-[18px] tracking-[0.16em]" style={{ color: 'var(--color-amber)' }}>{v}</div>
        <Button shape="flat" className="!mb-0 !px-5 !py-1.5" onClick={() => send({ type: 'NEXT' })}>{s.round < s.totalRounds ? 'NEXT ROUND' : 'SEE FINAL'}</Button>
      </Panel>
    </div>
  )
}

function Final({ s, send }: { s: State; send: Send }) {
  const me = s.rounds.reduce((a, r) => a + r.me, 0)
  const opp = s.rounds.reduce((a, r) => a + r.opp, 0)
  const v = me > opp ? 'MATCH WON' : me < opp ? 'MATCH LOST' : 'MATCH DRAWN'
  return (
    <>
      <header className="flex items-center gap-3 px-4 py-2" style={{ borderBottom: '1px solid var(--border)', background: 'color-mix(in oklab, var(--surface-raised) 60%, transparent)' }}>
        <span className="font-orbitron font-bold tracking-[0.14em] text-primary text-[12px]">◈ HTTP DUEL</span>
        <span style={{ color: 'var(--border)' }}>|</span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>MATCH COMPLETE</span>
        <span className="flex-1" />
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{s.opp.name}</span>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <Panel notch="md" className="cosmic-panel flex flex-col items-center gap-4 px-10 py-7 min-w-[440px] anim-in">
          <span className="font-mono text-[10px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>FINAL</span>
          <div className="font-orbitron text-[18px] tracking-[0.16em]" style={{ color: 'var(--color-amber)' }}>{v}</div>
          <div className="flex gap-10 font-orbitron text-[15px]">
            <span>YOU <b className="text-[26px]" style={{ color: 'var(--color-green)' }}>{me}</b></span>
            <span>{s.opp.name} <b className="text-[26px]" style={{ color: 'var(--text-muted)' }}>{opp}</b></span>
          </div>
          <table className="font-mono text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {s.rounds.map(r => (
                <tr key={r.round}>
                  <td className="px-4 py-1" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>ROUND {r.round}</td>
                  <td className="px-4 py-1" style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>{ROUNDS[r.round - 1].tag}</td>
                  <td className="px-4 py-1" style={{ borderBottom: '1px solid var(--border)', color: 'var(--color-green)' }}>{r.me}</td>
                  <td className="px-4 py-1" style={{ borderBottom: '1px solid var(--border)', color: 'var(--color-red)' }}>{r.opp}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>SEASON 0W / 0L (mock)</span>
          <Button shape="flat" className="!mb-0 !px-5 !py-1.5" onClick={() => send({ type: 'REMATCH' })}>REMATCH</Button>
        </Panel>
      </div>
    </>
  )
}

/* ── mock controls ─────────────────────────────────── */

function MockControls({ s, send }: { s: State; send: Send }) {
  const { pack, setPack, muted, setMuted } = useAudio()
  const b = (label: string, action: string, tone?: string) => (
    <button onClick={() => send({ type: action })} className="font-mono text-[10px] tracking-[0.08em] px-2 py-1 border bg-transparent cursor-pointer" style={{ borderColor: borderA(tone || 'var(--text-muted)'), color: tone || 'var(--text-muted)' }}>{label}</button>
  )
  return (
    <div className="fixed right-3 bottom-9 z-[80] w-[320px] font-mono text-[10px]" style={{ border: '1px dashed color-mix(in oklab, var(--color-amber) 55%, transparent)', background: 'rgba(9,12,17,0.96)' }}>
      <div onClick={() => send({ type: 'MOCK_TOGGLE' })} className="flex justify-between px-2.5 py-2 cursor-pointer tracking-[0.15em]" style={{ color: 'var(--color-amber)' }}>
        MOCK CONTROLS / drive the opponent <span>{s.mockOpen ? '▾' : '▸'}</span>
      </div>
      {s.mockOpen && (
        <div className="flex flex-wrap gap-1.5 p-2.5" style={{ borderTop: '1px dashed color-mix(in oklab, var(--color-amber) 30%, transparent)' }}>
          {b('OPP JOIN', 'OPP_JOIN')}
          {b('OPP READY', 'OPP_READY')}
          {b('STAGE +1', 'OPP_STAGE')}
          {b('OPP SUBMIT', 'OPP_SUBMIT')}
          {b('OPP CHAT', 'OPP_CHAT')}
          {b('TOGGLE CONN', 'TOGGLE_CONN')}
          {b('SKIP TO MATCH', 'SKIP')}
          {b('RESET', 'RESET', 'var(--color-red)')}

          <div className="w-full flex items-center gap-1.5 pt-2 mt-0.5" style={{ borderTop: '1px dashed color-mix(in oklab, var(--color-amber) 30%, transparent)' }}>
            <span style={{ color: 'var(--text-muted)' }}>SOUND</span>
            {SOUND_PACKS.map(p => (
              <button key={p} onClick={() => setPack(p)} className="font-mono text-[10px] tracking-[0.08em] px-2 py-1 border bg-transparent cursor-pointer" style={{ borderColor: pack === p ? 'var(--color-primary)' : borderA('var(--text-muted)'), color: pack === p ? 'var(--color-primary)' : 'var(--text-muted)' }}>{p.toUpperCase()}</button>
            ))}
            <button onClick={() => setMuted(!muted)} className="font-mono text-[10px] tracking-[0.08em] px-2 py-1 border bg-transparent cursor-pointer" style={{ borderColor: borderA('var(--text-muted)'), color: muted ? 'var(--text-muted)' : 'var(--color-primary)' }}>{muted ? 'MUTED' : 'ON'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── backdrop (ported from the Arwes docs Background) ───────── */

function Backdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        overflow: 'hidden',
        background: 'radial-gradient(50% 50% at 50% 50%, #16202e 0%, #0e141c 0.01%, #090c11 100%)',
      }}
    >
      <Animator duration={{ enter: 1 }}>
        <Dots color="hsla(215, 30%, 72%, 0.14)" size={2} distance={40} originInverted />
      </Animator>
    </div>
  )
}

/* ── screen transition fade ────────────────────────── */

function ScreenFade({ screen }: { screen: string }) {
  return <div key={screen} className="screen-fade" aria-hidden />
}

/* ── app ───────────────────────────────────────────── */

export default function App() {
  const [s, send] = useDuel()
  const sfx = useSfx()
  const agent = useAgent()
  useSoundReactions(s, sfx)
  useGlobalSfx(sfx)

  return (
    <Animator root>
      <div
        data-theme="holo"
        className="relative h-screen flex flex-col"
        style={{
          background: 'var(--background)',
          color: 'var(--text-secondary)',
          '--arwes-frames-line-color': 'rgba(138, 180, 240, 0.5)',
          '--arwes-frames-deco-color': 'rgba(230, 185, 128, 0.75)',
          '--arwes-frames-bg-color': 'rgba(111, 159, 245, 0.10)',
        } as CSSProperties}
      >
        <Backdrop />

        <div className="relative z-10 flex-1 min-h-0 flex flex-col">
          {s.screen === 'boot' && <Boot s={s} send={send} />}
          {s.screen === 'lobby' && <Lobby s={s} send={send} agent={agent} />}
          {s.screen === 'match' && <Match s={s} send={send} />}
          {s.screen === 'matchResult' && <Final s={s} send={send} />}
          {s.screen === 'countdown' && <Countdown s={s} />}
          {s.screen === 'roundResult' && <RoundResult s={s} send={send} />}

          <div className="flex-none h-[24px] flex items-center px-3 font-mono text-[9px] tracking-[0.08em]" style={{ color: 'var(--color-amber)', borderTop: '1px dashed color-mix(in oklab, var(--color-amber) 30%, transparent)', background: 'rgba(20,14,4,0.5)' }}>
            PROTOTYPE · UI: Cosmic UI + scificn/ui + Arwes NEXT · fake data, no backend · MOCK CONTROLS ↑
          </div>
        </div>

        <ScreenFade screen={s.screen} />
        <MockControls s={s} send={send} />
      </div>
    </Animator>
  )
}