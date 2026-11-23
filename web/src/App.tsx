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
import { getAgentStatus, openInEditor, judgeRound, getCode, saveCode, nivixAsk, wikiSearch, getKeys, saveKeys, discoverRoom, type AgentStatus } from './agent'
import { useLiveRoom, createRoom, joinRoom, leaveRoom, getZt, setZtToken, createZtNetwork, relayCreate, relayJoin, relayLeave, type RoomMember } from './room'

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
    <div className="inline-flex items-center gap-0.5 p-0.5" style={{ background: 'color-mix(in oklab, var(--surface) 90%, black)', border: '1px solid var(--border)' }}>
      {items.map(it => {
        const active = value === it.id
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className="font-mono text-[9px] tracking-[0.14em] px-2.5 py-1 cursor-pointer transition-colors"
            style={{
              color: active ? 'var(--color-primary)' : 'var(--text-muted)',
              background: active ? 'color-mix(in oklab, var(--color-primary) 14%, transparent)' : 'transparent',
              borderRadius: 3,
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.color = 'var(--text-secondary)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.color = 'var(--text-muted)' }}
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

  const send = useCallback((a: Action) => { dispatch(a) }, [])

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

type ScoreRow = { id: string; name: string; lang: 'python' | 'csharp'; score?: number | null; stage?: number; host?: boolean; connected?: boolean; me?: boolean }

function ScoreCard({ row, you, total }: { row: ScoreRow; you?: boolean; total: number }) {
  const derived = row.score == null ? 0 : Math.max(0, Math.min(4, Math.ceil((row.score / Math.max(1, total)) * 4)))
  const stage = row.stage != null ? Math.max(0, Math.min(4, row.stage)) : derived
  const tone = 'var(--color-primary)'
  return (
    <span
      className="relative flex items-center gap-2.5 px-3 h-[34px] min-w-[160px] max-w-[230px]"
      style={{
        background: 'linear-gradient(180deg, color-mix(in oklab, var(--surface-raised) 92%, black), var(--surface))',
        boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 32%, transparent), 0 0 12px color-mix(in oklab, var(--color-primary) 10%, transparent)',
        clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 11px), calc(100% - 11px) 100%, 0 100%)',
      }}
    >
      <span className="font-orbitron text-[12px] tracking-[0.08em] truncate" style={{ color: 'var(--color-primary)' }}>{row.name}</span>
      <LangIcon lang={row.lang} size={12} />
      <span className="flex items-center gap-[3px] ml-auto" title={`stage ${stage}/4`}>
        {[1, 2, 3, 4].map(i => (
          <i
            key={i}
            style={{
              display: 'block', width: 7, height: 13,
              background: i <= stage ? tone : 'color-mix(in oklab, var(--border) 85%, transparent)',
              clipPath: 'polygon(36% 0, 100% 0, 64% 100%, 0 100%)',
              boxShadow: i <= stage ? `0 0 9px ${tone}` : undefined,
              transition: 'background 0.3s ease, box-shadow 0.3s ease',
            }}
          />
        ))}
      </span>
      <span className="font-mono text-[12px]" style={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>{row.score ?? '-'}<span style={{ color: 'var(--text-muted)' }}>/{total}</span></span>
    </span>
  )
}

function ScoreDropdown({ roster }: { roster: ScoreRow[] }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  const ranked = [...roster].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  return (
    <span className="relative" onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(o => !o)} className="micro">{open ? '▲' : '▼'} SCORES</button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-[60] w-[250px] p-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          {ranked.length === 0 && <div className="font-mono text-[9px] px-2 py-1" style={{ color: 'var(--text-muted)' }}>no players</div>}
          {ranked.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1 font-mono text-[10px]">
              <span style={{ color: 'var(--text-muted)' }}>{i + 1}</span>
              <span className="flex-1 truncate" style={{ color: p.connected === false ? 'var(--text-muted)' : 'var(--text-secondary)' }}>{p.name}{p.host ? ' ★' : ''}</span>
              <LangIcon lang={p.lang} size={11} />
              <span style={{ color: 'var(--color-primary)' }}>{p.score ?? '-'}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

function Hud({ s, onSettings, roster, multiplayer }: { s: State; onSettings: () => void; roster: ScoreRow[]; multiplayer: boolean }) {
  const total = ROUNDS[s.round - 1].tests.length
  const me = roster.find(p => p.me) || roster[0] || { id: 'me', name: s.me.name || 'YOU', lang: s.me.lang, score: s.me.score, me: true }
  const meRow = { ...me, score: s.me.score ?? me.score, stage: s.me.stage }
  const others = roster.filter(p => p.id !== me.id)
  const opponent = others[0]
  const extra = others.length - 1
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

      {/* left - identity + you */}
      <div className="flex items-center justify-between gap-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-orbitron font-bold text-[13px] tracking-[0.18em]" style={{ color: 'var(--color-primary)', textShadow: 'var(--text-glow-green)' }}>◈ NIVIX ACADEMY</span>
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          <span className="font-orbitron text-[11px] tracking-[0.18em]" style={{ color: 'var(--text-secondary)' }}>ROUND {s.round}<span style={{ color: 'var(--text-muted)' }}>/{s.totalRounds}</span></span>
        </div>
        <ScoreCard row={meRow} you total={total} />
      </div>

      {/* centre - VS (fixed slot keeps the grid balanced) */}
      {multiplayer ? (
        <span
          className="grid place-items-center w-[40px] h-[28px] font-orbitron font-bold text-[11px] tracking-[0.16em]"
          style={{
            color: 'var(--color-primary)',
            background: 'linear-gradient(135deg, color-mix(in oklab, var(--color-primary) 22%, transparent), color-mix(in oklab, var(--color-primary) 6%, transparent))',
            boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 45%, transparent), 0 0 14px color-mix(in oklab, var(--color-primary) 18%, transparent)',
            clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)',
          }}
        >
          VS
        </span>
      ) : (
        <span aria-hidden className="w-[40px] h-[28px]" />
      )}

      {/* right - opponent + vitals */}
      <div className="flex items-center justify-between gap-4 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {multiplayer && (opponent
            ? <ScoreCard row={opponent} total={total} />
            : <span className="font-orbitron text-[10px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>WAITING...</span>)}
          {extra > 0 && (
            <span className="grid place-items-center h-[24px] px-2 font-mono text-[9px]" style={{ color: 'var(--color-primary)', background: 'color-mix(in oklab, var(--color-primary) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--color-primary) 35%, transparent)' }}>+{extra}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <EnergyGauge value={s.energy} />
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          <span className="font-mono text-[13px] tracking-[0.06em]" style={{ fontVariantNumeric: 'tabular-nums', minWidth: 52, textAlign: 'right' }}>{fmt(s.elapsed)}</span>
          <span className="h-3.5 w-px" style={{ background: 'var(--border)' }} />
          {multiplayer && <ScoreDropdown roster={roster} />}
          <button onClick={onSettings} title="settings" className="relative cursor-pointer bg-transparent border-0 text-[13px] leading-none" style={{ color: 'var(--text-secondary)' }}>⚙</button>
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

function Lobby({ s, send, agent, onSettings, live }: { s: State; send: Send; agent: AgentStatus | null; onSettings: () => void; live: ReturnType<typeof useLiveRoom> }) {
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

  const [joinCode, setJoinCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [netMode, setNetMode] = useState<'online' | 'lan'>('online')

  useEffect(() => {
    if (!live.connected) return
    let id = ''
    try {
      id = localStorage.getItem('duel.playerId') || ''
      if (!id) { id = 'p' + Date.now().toString(36); localStorage.setItem('duel.playerId', id) }
    } catch { id = 'p' + Date.now().toString(36) }
    live.send({ t: 'join', id, name: s.me.name || 'PLAYER', lang: s.me.lang })
  }, [live.connected, s.me.name, s.me.lang, live.room?.code]) // eslint-disable-line react-hooks/exhaustive-deps

  const room = live.room
  const members = room?.members || []
  const inRoom = !!room?.code || !!s.role
  const isHost = room ? room.role === 'host' : s.role === 'host'
  const canStart = members.length >= 1

  const doSolo = async () => {
    setNote(null)
    send({ type: 'START_SOLO' })
  }

  const doHost = async () => {
    setNote(null); setBusy(true)
    try {
      if (agent && live.connected) {
        const r = netMode === 'lan'
          ? await createRoom({ mode: 'multi', maxPlayers: 8 })
          : await relayCreate({ maxPlayers: 8, name: s.me.name || 'HOST', lang: s.me.lang })
        if (!r?.ok) { setNote(r?.error || 'could not create room'); return }
      }
      send({ type: 'CREATE_ROOM' })
    } finally { setBusy(false) }
  }

  const doJoin = async () => {
    if (!joinCode) return
    setNote(null); setBusy(true)
    try {
      if (agent && live.connected) {
        let r
        if (netMode === 'lan') {
          const d = await discoverRoom(joinCode)
          if (!d?.ok || !d.host) { setNote('LAN: room not found on this network'); return }
          r = await joinRoom({ host: d.host.host, port: d.host.port, code: joinCode, name: s.me.name || 'PLAYER', lang: s.me.lang })
        } else {
          r = await relayJoin({ code: joinCode, name: s.me.name || 'PLAYER', lang: s.me.lang })
        }
        if (!r?.ok) { setNote(r?.error || 'could not join'); return }
      }
      send({ type: 'JOIN_ROOM' })
    } finally { setBusy(false) }
  }

  const doLeave = async () => {
    try { await relayLeave() } catch { /* ignore */ }
    await leaveRoom()
    send({ type: 'LEAVE' })
    setJoinCode('')
  }

  const memberCard = (m: RoomMember) => (
    <div key={m.id} className="flex items-center gap-2 px-3 py-2" style={{ border: '1px solid var(--border)', background: 'color-mix(in oklab, var(--surface-raised) 55%, transparent)' }}>
      <span className="font-orbitron text-[13px] tracking-[0.08em]">{m.name}</span>
      <LangIcon lang={m.lang} size={12} />
      {m.host && <Chip>HOST</Chip>}
      <span className="flex-1" />
      {!m.connected && <span className="font-mono text-[8px]" style={{ color: 'var(--color-amber)' }}>OFFLINE</span>}
      <ReadyMark ready={m.ready} />
    </div>
  )

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
      <LobbyBackdrop />
      <div className="relative z-10 flex-1 overflow-auto flex justify-center">
        <div className="w-[min(820px,92vw)] flex flex-col gap-5 py-8">
          <div className="flex justify-end -mb-2">
            <button onClick={onSettings} className="micro">⚙ SETTINGS</button>
          </div>
          <div className="text-center">
            <div className="font-orbitron font-bold text-[26px] tracking-[0.22em] text-primary" style={{ textShadow: '0 0 34px color-mix(in oklab, var(--color-primary) 40%, transparent)' }}>NIVIX ACADEMY</div>
            <div className="font-mono text-[9px] tracking-[0.3em] mt-1.5" style={{ color: 'var(--text-muted)' }}>HTTP DUEL · PYTHON VS C#</div>
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

          {!inRoom ? (
            <>
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>MULTIPLAYER</span>
                {(['online', 'lan'] as const).map(m => (
                  <button key={m} onClick={() => setNetMode(m)} className="micro" style={{ color: netMode === m ? 'var(--color-primary)' : undefined, boxShadow: netMode === m ? 'inset 0 0 0 1px var(--color-primary)' : undefined }}>{m === 'online' ? 'ONLINE' : 'LAN'}</button>
                ))}
                <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>{netMode === 'online' ? 'via relay - any network' : 'same network only'}</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <GameCard bodyClassName="p-5 flex flex-col gap-3 h-full">
                  <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>PLAY SOLO</span>
                  <p className="font-roboto text-[13px] leading-6" style={{ color: 'var(--text-muted)' }}>Practise alone. Judge your server, keep your score.</p>
                  <div className="mt-auto"><Button shape="flat" className="!mb-0 !px-5 !py-1.5" disabled={busy} onClick={doSolo}>START SOLO</Button></div>
                </GameCard>

                <GameCard bodyClassName="p-5 flex flex-col gap-3 h-full">
                  <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>HOST ROOM</span>
                  <p className="font-roboto text-[13px] leading-6" style={{ color: 'var(--text-muted)' }}>Open a room and share the 6-character code.</p>
                  <div className="mt-auto"><Button shape="flat" className="!mb-0 !px-5 !py-1.5" disabled={busy} onClick={doHost}>{busy ? 'WORKING…' : 'CREATE ROOM'}</Button></div>
                </GameCard>

                <GameCard bodyClassName="p-5 flex flex-col gap-3 h-full">
                  <span className="font-mono text-[10px] tracking-[0.16em]" style={{ color: 'var(--color-accent)' }}>JOIN ROOM</span>
                  <input
                    value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter' && joinCode) doJoin() }}
                    placeholder="CODE" maxLength={6}
                    className="font-mono text-[18px] tracking-[0.3em] text-center uppercase px-3 py-2 border bg-transparent outline-none"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  />
                  <div className="mt-auto"><Button shape="flat" variant="secondary" className="!mb-0 !px-5 !py-1.5" disabled={busy || joinCode.length < 4} onClick={doJoin}>JOIN</Button></div>
                </GameCard>
              </div>

              {note && <div className="text-center font-mono text-[9px]" style={{ color: 'var(--color-amber)' }}>{note}</div>}
            </>
          ) : (
            <>
              <GameCard bodyClassName="p-4 grid grid-cols-[auto_1fr_auto] gap-x-5 gap-y-1.5 items-center">
                <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>ROOM</span>
                <span className="font-orbitron text-[26px] tracking-[0.24em] text-primary">{room?.code || s.room.code}</span>
                <button
                  onClick={() => { try { navigator.clipboard.writeText(room?.code || s.room.code); setNote('code copied') } catch { /* ignore */ } }}
                  className="micro"
                >COPY</button>
                <span className="font-mono text-[9px] tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>PLAYERS</span>
                <span className="font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>{members.length}/{room?.maxPlayers || 8}{room?.transport ? ` · ${room.transport}` : ''}</span>
              </GameCard>

              <div className="flex flex-col gap-2">
                {members.length > 0 ? members.map(memberCard) : (
                  <div className="flex items-center gap-4">
                    <GameCard className="flex-1" bodyClassName="flex items-center gap-3 p-4">
                      <span className="font-orbitron text-[15px] tracking-[0.1em]">{s.me.name || 'NOVA'}</span>
                      <LangIcon lang={s.me.lang} size={13} />
                      <ReadyMark ready={s.me.ready} />
                    </GameCard>
                    <span className="font-orbitron text-[10px]" style={{ color: 'var(--text-muted)' }}>VS</span>
                    <GameCard className="flex-1" bodyClassName="flex items-center gap-3 p-4">
                      <span className="font-orbitron text-[15px] tracking-[0.1em]" style={{ color: 'var(--text-muted)' }}>WAITING...</span>
                    </GameCard>
                  </div>
                )}
              </div>

              <div className="flex justify-center items-center gap-2">
                {isHost
                  ? <Button shape="flat" className="!mb-0 !px-5 !py-1.5" disabled={!canStart || busy} onClick={() => send({ type: 'START' })}>START MATCH</Button>
                  : <span className="font-mono text-[10px] tracking-[0.12em]" style={{ color: 'var(--text-muted)' }}>WAITING FOR HOST TO START</span>}
                <Button shape="flat" variant="secondary" className="!mb-0 !px-5 !py-1.5" onClick={doLeave}>LEAVE</Button>
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

function VideoSlice({ video }: { video: { id: string; start: number; end: number; label?: string; src?: string } }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<any>(null)
  const seekRef = useRef<HTMLDivElement | null>(null)
  const [started, setStarted] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const [current, setCurrent] = useState(video.start)

  const span = Math.max(1, video.end - video.start)
  const clock = (s: number) => {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
  }

  const ensureApi = (cb: () => void) => {
    const w = window as any
    if (w.YT && w.YT.Player) { cb(); return }
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script')
      s.id = 'yt-iframe-api'
      s.src = 'https://www.youtube.com/iframe_api'
      document.body.appendChild(s)
    }
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { if (prev) prev(); cb() }
  }

  const begin = () => {
    setStarted(true)
    ensureApi(() => {
      if (!hostRef.current || playerRef.current) return
      const w = window as any
      playerRef.current = new w.YT.Player(hostRef.current, {
        videoId: video.id,
        playerVars: { start: video.start, end: video.end, controls: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: { onReady: (e: any) => { setReady(true); e.target.seekTo(video.start, true) } },
      })
    })
  }

  useEffect(() => {
    if (!started || !ready) return
    const id = window.setInterval(() => {
      const p = playerRef.current
      if (!p || typeof p.getCurrentTime !== 'function') return
      const t = p.getCurrentTime()
      setCurrent(t)
      setProgress(Math.max(0, Math.min(1, (t - video.start) / span)))
    }, 300)
    return () => window.clearInterval(id)
  }, [started, ready, video.start, span])

  const seekTo = (clientX: number) => {
    const el = seekRef.current
    const p = playerRef.current
    if (!el || !p) return
    const r = el.getBoundingClientRect()
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)))
    p.seekTo(video.start + frac * span, true)
    setProgress(frac)
    setCurrent(video.start + frac * span)
  }

  const restart = () => {
    const p = playerRef.current
    if (!p) return
    p.seekTo(video.start, true)
    p.playVideo()
  }

  if (video.src) {
    return (
      <div className="w-full overflow-hidden" style={{ border: '1px solid var(--border)', background: '#000' }}>
        <video src={video.src} controls playsInline style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', background: '#000' }} />
      </div>
    )
  }

  if (!started) {
    return (
      <button onClick={begin} className="relative block w-full overflow-hidden cursor-pointer bg-transparent p-0" style={{ aspectRatio: '16 / 9', border: '1px solid var(--border)' }} title={video.label || 'Play lesson clip'}>
        <img src={`https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ opacity: 0.6 }} />
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: 'linear-gradient(180deg, rgba(4,7,12,0.15), rgba(4,7,12,0.78))' }}>
          <span className="flex items-center justify-center w-12 h-12 rounded-full" style={{ background: 'color-mix(in oklab, var(--color-primary) 90%, transparent)', color: '#04070c', fontSize: 16, boxShadow: '0 0 24px color-mix(in oklab, var(--color-primary) 45%, transparent)' }}>▶</span>
          <span className="font-mono text-[9px] tracking-[0.14em] px-2 text-center" style={{ color: 'var(--text-secondary)' }}>WATCH · {video.label || 'LESSON CLIP'}</span>
          <span className="font-mono text-[8px]" style={{ color: 'var(--text-muted)' }}>{clock(video.start)} - {clock(video.end)}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="relative">
      <span aria-hidden style={{ position: 'absolute', top: -1, left: -1, width: 12, height: 12, borderTop: '1px solid var(--color-primary)', borderLeft: '1px solid var(--color-primary)', filter: 'drop-shadow(0 0 6px color-mix(in oklab, var(--color-primary) 45%, transparent))' }} />
      <span aria-hidden style={{ position: 'absolute', top: -1, right: -1, width: 12, height: 12, borderTop: '1px solid var(--color-primary)', borderRight: '1px solid var(--color-primary)' }} />
      <span aria-hidden style={{ position: 'absolute', bottom: -1, left: -1, width: 12, height: 12, borderBottom: '1px solid var(--color-primary)', borderLeft: '1px solid var(--color-primary)' }} />
      <span aria-hidden style={{ position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderBottom: '1px solid var(--color-primary)', borderRight: '1px solid var(--color-primary)' }} />
      <div className="flex flex-col" style={{ border: '1px solid color-mix(in oklab, var(--color-primary) 30%, transparent)' }}>
        <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' }}>
          <div ref={hostRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
        </div>
        <div className="px-2.5 pt-2 pb-2 flex flex-col gap-2" style={{ background: 'color-mix(in oklab, var(--surface-raised) 92%, black)', borderTop: '1px solid var(--border)' }}>
          <div
            ref={seekRef}
            className="relative h-[4px] cursor-pointer"
            style={{ background: 'color-mix(in oklab, var(--border) 80%, transparent)' }}
            onPointerDown={e => { e.stopPropagation(); seekTo(e.clientX) }}
            onPointerMove={e => { if (e.buttons === 1) seekTo(e.clientX) }}
            title="seek within the slice"
          >
            <span className="absolute inset-y-0 left-0" style={{ width: `${progress * 100}%`, background: 'var(--color-primary)', boxShadow: '0 0 8px color-mix(in oklab, var(--color-primary) 55%, transparent)' }} />
            <span className="absolute top-1/2 -translate-y-1/2 w-[9px] h-[9px] rounded-full" style={{ left: `calc(${progress * 100}% - 4px)`, background: 'var(--color-primary)', boxShadow: '0 0 8px color-mix(in oklab, var(--color-primary) 60%, transparent)' }} />
          </div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[9px] tracking-[0.14em] shrink-0" style={{ color: 'var(--color-primary)' }}>CH</span>
            <span className="font-mono text-[10px] tracking-[0.04em] truncate min-w-0" style={{ color: 'var(--text-secondary)' }}>{video.label || 'LESSON CLIP'}</span>
            <span className="flex-1" />
            <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{clock(Math.max(video.start, Math.min(video.end, current)))} <span style={{ color: 'var(--text-muted)' }}>/ {clock(video.end)}</span></span>
            <button onClick={restart} className="font-mono text-[9px] tracking-[0.12em] px-2 py-[3px] cursor-pointer shrink-0 transition-colors" style={{ color: 'var(--color-primary)', border: '1px solid color-mix(in oklab, var(--color-primary) 35%, transparent)', background: 'transparent' }}>RESTART</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Brief({ s, send }: { s: State; send: Send }) {
  const R = ROUNDS[s.round - 1]
  return (
    <div className="cosmic-panel h-full flex flex-col min-h-0 anim-in">
      <PanelHead title="BRIEF" />
      <div className="flex-1 overflow-auto px-5 py-4">
        <Animator key={s.round}>
          <Text as="h1" manager="decipher" className="font-orbitron text-[17px] tracking-[0.06em] mb-3 block">{R.title}</Text>
        {R.video && <div className="mb-4"><VideoSlice video={R.video} /></div>}
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
  const docs: [string, string][] = []
  const canAsk = s.energy >= COST_AI
  const [wikiQ, setWikiQ] = useState('')
  const [wikiResults, setWikiResults] = useState<{ title: string; url: string; source: string }[] | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const submitAsk = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = ask.trim()
    if (!q || !canAsk) return
    setAsk('')
    setNote(null)
    const r = await nivixAsk(q)
    if (r?.ok && r.answer) send({ type: 'AI_ANSWER', value: q, answer: r.answer })
    else setNote(r?.error || 'NIVIX offline: set OPENAI_API_KEY in agent/.env')
  }

  const submitWiki = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = wikiQ.trim()
    if (!q) return
    setNote(null)
    const r = await wikiSearch(q)
    if (r?.ok) { setWikiResults(r.results || []); }
    else setNote(r?.error || 'Context7 offline: set CONTEXT7_API_KEY in agent/.env')
  }

  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead title="SUPPORT" right={<SegTabs value={s.leftTab} onChange={v => send({ type: 'LEFT_TAB', value: v })} items={[{ id: 'comms', label: 'CHAT' }, { id: 'wiki', label: 'WIKI' }, { id: 'ai', label: 'NIVIX AI' }]} />} />

      {s.leftTab === 'comms' && (
        <>
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="w-1 h-3 shrink-0" style={{ background: 'var(--color-primary)', boxShadow: '0 0 8px color-mix(in oklab, var(--color-primary) 60%, transparent)' }} />
            <span className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>LIVE CHANNEL</span>
            <span className="flex-1" />
            <span className="font-mono text-[9px]" style={{ color: 'var(--color-green)' }}>{s.chat.length} MSG</span>
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
            {s.chat.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6">
                <span className="font-orbitron text-[22px]" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>◌</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>no traffic yet - say hi</span>
              </div>
            )}
            {s.chat.map((m, i) => m.sys
              ? <div key={i} className="flex items-center gap-2 py-0.5">
                <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg, transparent, var(--border))' }} />
                <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{m.text}</span>
                <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg, var(--border), transparent)' }} />
              </div>
              : m.me
                ? <div key={i} className="self-end max-w-[85%] flex flex-col items-end gap-1">
                  <span className="font-mono text-[9px]" style={{ color: 'var(--color-primary)' }}>{m.who}</span>
                  <div className="px-3 py-1.5 font-roboto text-[12px]" style={{ background: 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 20%, transparent), color-mix(in oklab, var(--color-primary) 8%, transparent))', border: '1px solid color-mix(in oklab, var(--color-primary) 35%, transparent)', color: 'var(--text-secondary)', borderRadius: 4, clipPath: 'polygon(0 0, 100% 0, 100% 100%, 6px 100%, 0 calc(100% - 6px))' }}>{m.text}</div>
                </div>
                : <div key={i} className="self-start max-w-[85%] flex gap-2">
                  <span className="w-6 h-6 flex items-center justify-center font-orbitron text-[10px] shrink-0" style={{ background: 'color-mix(in oklab, var(--surface-raised) 90%, black)', border: '1px solid color-mix(in oklab, var(--accent-secondary) 40%, transparent)', color: 'var(--accent-secondary)' }}>{m.who?.slice(0, 1)}</span>
                  <div className="flex flex-col gap-1">
                    <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{m.who}</span>
                    <div className="px-3 py-1.5 font-roboto text-[12px]" style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4 }}>{m.text}</div>
                  </div>
                </div>
            )}
          </div>
          <form onSubmit={e => { e.preventDefault(); if (chat.trim()) { send({ type: 'SEND_CHAT', value: chat.trim() }); setChat('') } }} style={{ borderTop: '1px solid var(--border)' }}>
            <div className="p-2">
              <div className="inputgroup">
                <span className="font-mono text-[12px]" style={{ color: 'var(--color-primary)' }}>›</span>
                <input value={chat} onChange={e => setChat(e.target.value)} placeholder="message..." className="flex-1 bg-transparent outline-none font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }} />
                <button type="submit" className="micro">SEND</button>
              </div>
            </div>
          </form>
        </>
      )}

      {s.leftTab === 'wiki' && (
        <>
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="w-1 h-3 shrink-0" style={{ background: 'var(--accent-secondary)', boxShadow: '0 0 8px color-mix(in oklab, var(--accent-secondary) 60%, transparent)' }} />
            <span className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>CURATED DOCS · context7</span>
            <span className="flex-1" />
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{docs.length}</span>
          </div>
          <form onSubmit={submitWiki} className="px-3 pt-1 pb-2 shrink-0">
            <div className="inputgroup">
              <span className="font-mono text-[11px]" style={{ color: 'var(--color-primary)' }}>⌕</span>
              <input value={wikiQ} onChange={e => setWikiQ(e.target.value)} placeholder="search docs..." className="flex-1 bg-transparent outline-none font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }} />
              <button type="submit" className="micro">SEARCH</button>
            </div>
            {note && <div className="font-mono text-[8px] mt-1.5" style={{ color: 'var(--color-amber)' }}>{note}</div>}
          </form>
          <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-1.5">
            {wikiResults && wikiResults.map((d, i) => (
              <a key={i} href={d.url || '#'} target="_blank" rel="noreferrer" className="group text-left flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors" style={{ background: 'color-mix(in oklab, var(--surface-raised) 55%, transparent)', border: '1px solid var(--border)', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 8px 100%, 0 calc(100% - 8px))' }}>
                <span className="font-orbitron text-[13px] shrink-0" style={{ color: 'color-mix(in oklab, var(--accent-secondary) 80%, transparent)' }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="flex-1 flex flex-col gap-1 min-w-0">
                  <span className="font-roboto text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>{d.title}</span>
                  <span className="font-mono text-[9px] px-1.5 py-0.5 self-start" style={{ color: 'var(--text-muted)', background: 'color-mix(in oklab, var(--accent-secondary) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--accent-secondary) 28%, transparent)' }}>{d.source}</span>
                </span>
                <span className="font-mono text-[12px] transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--accent-secondary)' }}>↗</span>
              </a>
            ))}
            {!wikiResults && docs.map((d, i) => (
              <button key={d[0]} className="group text-left flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors" style={{ background: 'color-mix(in oklab, var(--surface-raised) 55%, transparent)', border: '1px solid var(--border)', clipPath: 'polygon(0 0, 100% 0, 100% 100%, 8px 100%, 0 calc(100% - 8px))' }}>
                <span className="font-orbitron text-[13px] shrink-0" style={{ color: 'color-mix(in oklab, var(--accent-secondary) 80%, transparent)' }}>{String(i + 1).padStart(2, '0')}</span>
                <span className="flex-1 flex flex-col gap-1 min-w-0">
                  <span className="font-roboto text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>{d[0]}</span>
                  <span className="font-mono text-[9px] px-1.5 py-0.5 self-start" style={{ color: 'var(--text-muted)', background: 'color-mix(in oklab, var(--accent-secondary) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--accent-secondary) 28%, transparent)' }}>{d[1]}</span>
                </span>
                <span className="font-mono text-[12px] transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--accent-secondary)' }}>↗</span>
              </button>
            ))}
          </div>
        </>
      )}

      {s.leftTab === 'ai' && (
        <>
          <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 shrink-0">
            <span className="w-1 h-3 shrink-0" style={{ background: 'var(--color-primary)', boxShadow: '0 0 8px color-mix(in oklab, var(--color-primary) 60%, transparent)' }} />
            <span className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>NIVIX · ASSISTANT</span>
            <span className="flex-1" />
            <EnergyGauge value={s.energy} />
          </div>
          <div className="flex-1 overflow-auto px-3 py-2 flex flex-col gap-2">
            {s.wiki.length === 0 && (
              <>
                <p className="font-roboto text-[12px] leading-5" style={{ color: 'var(--text-muted)' }}>Ask about headers, status codes, base64, JSON. Each answer costs {COST_AI} charges · +1 every {RECHARGE_SEC}s.</p>
                <div className="flex flex-wrap gap-1.5">
                  {['401 + WWW-Authenticate', 'base64 decode', 'JSON body', '404 routing'].map(q => (
                    <button key={q} onClick={() => setAsk(q)} className="font-mono text-[9px] px-2.5 py-1 cursor-pointer transition-colors" style={{ border: '1px solid color-mix(in oklab, var(--color-primary) 30%, transparent)', background: 'color-mix(in oklab, var(--color-primary) 6%, transparent)', color: 'var(--color-primary)', clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%)' }}>{q}</button>
                  ))}
                </div>
              </>
            )}

            {s.wiki.map((w, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="self-end max-w-[90%] px-3 py-1.5 font-roboto text-[11px]" style={{ background: 'linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 20%, transparent), color-mix(in oklab, var(--color-primary) 8%, transparent))', border: '1px solid color-mix(in oklab, var(--color-primary) 32%, transparent)', color: 'var(--text-secondary)', borderRadius: 4 }}>{w.q}</div>
                <div className="flex gap-2">
                  <span className="w-6 h-6 flex items-center justify-center font-orbitron text-[10px] shrink-0" style={{ background: 'color-mix(in oklab, var(--surface-raised) 90%, black)', border: '1px solid color-mix(in oklab, var(--color-primary) 45%, transparent)', color: 'var(--color-primary)' }}>N</span>
                  <div className={cn(PROSE, 'text-[11px] leading-5 flex-1 px-3 py-2')} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border)', borderRadius: 4, borderLeft: '2px solid color-mix(in oklab, var(--color-primary) 55%, transparent)' }} dangerouslySetInnerHTML={{ __html: w.a }} />
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={submitAsk} style={{ borderTop: '1px solid var(--border)' }}>
            <div className="p-2">
              <div className="inputgroup">
                <span className="font-mono text-[11px]" style={{ color: canAsk ? 'var(--color-green)' : 'var(--color-red)' }}>⚡</span>
                <input value={ask} onChange={e => setAsk(e.target.value)} placeholder={`ask nivix - ${COST_AI}⚡`} className="flex-1 bg-transparent outline-none font-roboto text-[12px]" style={{ color: 'var(--text-secondary)' }} />
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

/* ── IDE editor (VS Code Dark+ colours) ────────────── */

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const PY_CTRL = new Set(['if', 'elif', 'else', 'for', 'while', 'return', 'try', 'except', 'finally', 'with', 'break', 'continue'])
const PY_KW = new Set(['def', 'class', 'import', 'from', 'as', 'pass', 'global', 'nonlocal', 'assert', 'del', 'raise', 'lambda', 'yield', 'await', 'async', 'in', 'is', 'not', 'and', 'or', 'True', 'False', 'None'])
const CS_CTRL = new Set(['if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'try', 'catch', 'finally', 'throw'])
const CS_KW = new Set(['using', 'namespace', 'class', 'struct', 'interface', 'enum', 'static', 'public', 'private', 'protected', 'internal', 'void', 'var', 'new', 'const', 'readonly', 'async', 'await', 'in', 'is', 'not', 'true', 'false', 'null', 'this', 'base', 'override', 'virtual', 'abstract', 'sealed'])
const CS_TYPE = new Set(['int', 'string', 'bool', 'double', 'float', 'long', 'byte', 'char', 'object', 'Task', 'List', 'Dictionary', 'Console', 'HttpListener', 'HttpClient', 'HttpListenerContext', 'Encoding', 'WebRequest', 'JsonDocument', 'JsonSerializer'])

function highlight(src: string, lang: 'python' | 'csharp'): string {
  const out: string[] = []
  const push = (color: string, text: string) => out.push(`<span style="color:${color}">${escapeHtml(text)}</span>`)
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (lang === 'python' && rest[0] === '#') {
      const nl = rest.indexOf('\n'); const tok = nl < 0 ? rest : rest.slice(0, nl)
      push('#6A9955', tok); i += tok.length; continue
    }
    if (lang === 'csharp' && rest.startsWith('//')) {
      const nl = rest.indexOf('\n'); const tok = nl < 0 ? rest : rest.slice(0, nl)
      push('#6A9955', tok); i += tok.length; continue
    }
    if (rest[0] === '"' || rest[0] === "'") {
      const quote = (lang === 'python' && (rest.startsWith('"""') || rest.startsWith("'''"))) ? rest.slice(0, 3) : rest[0]
      let j = quote.length
      while (j < rest.length) {
        if (rest[j] === '\\') { j += 2; continue }
        if (rest.slice(j, j + quote.length) === quote) { j += quote.length; break }
        j++
      }
      const tok = rest.slice(0, j)
      push('#CE9178', tok); i += tok.length; continue
    }
    const num = /^\d+(\.\d+)?/.exec(rest)
    if (num) { push('#B5CEA8', num[0]); i += num[0].length; continue }
    const id = /^[A-Za-z_]\w*/.exec(rest)
    if (id) {
      const word = id[0]
      const after = rest.slice(word.length)
      if (lang === 'python') {
        if (PY_CTRL.has(word)) push('#C586C0', word)
        else if (PY_KW.has(word) || word === 'self') push('#569CD6', word)
        else if (/^\s*\(/.test(after)) push('#DCDCAA', word)
        else if (/^[A-Z]/.test(word)) push('#4EC9B0', word)
        else push('#9CDCFE', word)
      } else {
        if (CS_CTRL.has(word)) push('#C586C0', word)
        else if (CS_KW.has(word) || CS_TYPE.has(word)) push('#569CD6', word)
        else if (/^[A-Z]/.test(word)) push('#4EC9B0', word)
        else if (/^\s*\(/.test(after)) push('#DCDCAA', word)
        else push('#9CDCFE', word)
      }
      i += word.length; continue
    }
    push('#D4D4D4', rest[0]); i++
  }
  return out.join('')
}

function CodeEditor({ value, onChange, onBlur, lang }: { value: string; onChange: (v: string) => void; onBlur: () => void; lang: 'python' | 'csharp' }) {
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const preRef = useRef<HTMLPreElement | null>(null)
  const sync = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }
  return (
    <div className="relative flex-1 min-h-0" style={{ background: '#1e1e1e' }}>
      <pre
        ref={preRef}
        aria-hidden
        className="absolute inset-0 m-0 overflow-auto px-4 py-3 font-mono text-[13px] leading-[1.65] pointer-events-none"
        style={{ color: '#D4D4D4', whiteSpace: 'pre', tabSize: 4 }}
        dangerouslySetInnerHTML={{ __html: highlight(value, lang) + '\n' }}
      />
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        onScroll={sync}
        spellCheck={false}
        wrap="off"
        className="ide-editor absolute inset-0 w-full h-full resize-none outline-none px-4 py-3 font-mono text-[13px] leading-[1.65]"
        style={{ color: 'transparent', caretColor: '#AEAFAD', background: 'transparent', whiteSpace: 'pre', tabSize: 4, border: 0 }}
      />
    </div>
  )
}

function Workspace({ s, send }: { s: State; send: Send }) {
  const [code, setCode] = useState<string | null>(null)
  const [saved, setSaved] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    getCode(s.me.lang).then(c => {
      if (alive) setCode(c ?? (s.me.lang === 'python' ? PY_CODE : CS_CODE))
    })
    return () => { alive = false }
  }, [s.me.lang])

  const save = async () => {
    if (code == null) return
    const ok = await saveCode(s.me.lang, code)
    setSaved(ok)
  }

  const openWorkspace = async () => {
    const file = s.me.lang === 'python' ? 'python/server.py' : 'csharp/Program.cs'
    let prefer = 'auto'
    try { prefer = localStorage.getItem('duel.editor') || 'auto' } catch { /* ignore */ }
    const r = await openInEditor(file, prefer)
    if (r === null) send({ type: 'VSCODE' })
    else if (r.ok) send({ type: 'SYS_NOTE', value: `OPENED IN ${(r.editor || 'EDITOR').toUpperCase()}` })
    else send({ type: 'SYS_NOTE', value: `EDITOR: ${r.error || 'could not open'}` })
  }

  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead
        title="WORKSPACE"
        right={
          <span className="flex items-center gap-2">
            <span className="font-mono text-[8px] tracking-[0.12em]" style={{ color: saved === false ? 'var(--color-amber)' : 'var(--text-muted)' }}>
              {saved === null ? 'LOCAL FILE' : saved ? 'SAVED' : 'SAVE FAILED'}
            </span>
            <button onClick={openWorkspace} className="micro vscode inline-flex items-center gap-1.5"><VscodeIcon size={12} />OPEN IN VS CODE</button>
          </span>
        }
      />

      <CodeEditor value={code ?? ''} onChange={v => { setCode(v); setSaved(null) }} onBlur={save} lang={s.me.lang} />
    </div>
  )
}

/* ── match: tester ─────────────────────────────────── */

function Tester({ s, send }: { s: State; send: Send }) {
  const R = ROUNDS[s.round - 1]
  const results = s.testResults
  const shown = results
    ? R.tests.map((t, i) => results[i] ? { name: results[i]!.name, pass: results[i]!.pass, i } : null).filter((x): x is { name: string; pass: boolean; i: number } => !!x)
    : []
  const passed = shown.filter(t => t.pass).length
  const failed = shown.length - passed
  const score = s.me.score != null ? `${s.me.score}/${R.tests.length}` : '-'

  const runTests = async () => {
    const r = await judgeRound(s.round, s.me.lang, 'visible')
    if (r?.results) send({ type: 'TESTS_RESULT', results: r.results })
  }
  const submit = async () => {
    if (s.me.submitted) return
    const haveVisible = Array.isArray(s.testResults) && s.testResults.some(Boolean)
    const r = await judgeRound(s.round, s.me.lang, haveVisible ? 'hidden' : 'all')
    if (r?.results) send({ type: 'TESTS_RESULT', results: r.results })
    send({ type: 'SUBMIT' })
  }

  return (
    <div className="cosmic-panel flex flex-col min-h-0 anim-in">
      <PanelHead
        title="TESTER"
        left={
          <>
            <span className="font-orbitron text-[15px] leading-none" style={{ color: 'var(--text-secondary)' }}>{score}</span>
            <span className="flex items-end gap-[3px] h-[14px]" title="per-test status">
              {R.tests.map((t, i) => {
                const r = results?.[i]
                const on = !!r
                const c = !on ? 'var(--border)' : r.pass ? 'var(--color-green)' : 'var(--color-red)'
                return <i key={i} className="block w-[5px] h-[14px]" style={{ background: c, opacity: on ? 1 : 0.5, boxShadow: on ? `0 0 6px ${c}` : undefined }} />
              })}
            </span>
            <span className="font-mono text-[9px]" style={{ color: 'var(--color-green)' }}>✓{passed}</span>
            <span className="font-mono text-[9px]" style={{ color: 'var(--color-red)' }}>✕{failed}</span>
          </>
        }
        right={
          <span className="microgroup">
            <button onClick={runTests} className="micro"><span className="mr-1 opacity-80">▶</span>RUN</button>
            <span style={{ width: 1, background: 'color-mix(in oklab, var(--color-primary) 25%, transparent)' }} />
            <button onClick={submit} disabled={s.me.submitted} className="micro primary">SUBMIT</button>
          </span>
        }
      />

      <div className="flex-1 overflow-auto px-2 py-1 flex flex-col gap-1">
        {!shown.length && (
          <div className="flex items-center justify-center py-2">
            <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>RUN visible tests - SUBMIT for the hidden suite</span>
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

function Match({ s, send, onSettings, roster, multiplayer }: { s: State; send: Send; onSettings: () => void; roster: ScoreRow[]; multiplayer: boolean }) {
  return (
    <>
      <Hud s={s} onSettings={onSettings} roster={roster} multiplayer={multiplayer} />
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
        <span className="font-orbitron font-bold tracking-[0.14em] text-primary text-[12px]">◈ NIVIX ACADEMY</span>
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

/* ── settings ──────────────────────────────────────── */

function Settings({ onClose }: { onClose: () => void }) {
  const { muted, setMuted, volume, setVolume } = useAudio()
  const [editor, setEditor] = useState(() => {
    try { return localStorage.getItem('duel.editor') || 'auto' } catch { return 'auto' }
  })
  const chooseEditor = (v: string) => {
    setEditor(v)
    try { localStorage.setItem('duel.editor', v) } catch { /* ignore */ }
  }

  const [keys, setKeys] = useState<{ openaiSet: boolean; openaiBase: string; openaiModel: string; context7Set: boolean; relayUrl?: string } | null>(null)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiBase, setOpenaiBase] = useState('')
  const [openaiModel, setOpenaiModel] = useState('')
  const [context7Key, setContext7Key] = useState('')
  const [relayUrl, setRelayUrl] = useState('')
  const [keyNote, setKeyNote] = useState<string | null>(null)
  useEffect(() => { getKeys().then(k => { if (k) { setKeys(k); setOpenaiBase(k.openaiBase || ''); setOpenaiModel(k.openaiModel || ''); setRelayUrl(k.relayUrl || '') } }) }, [])
  const saveKeysNow = async () => {
    const r = await saveKeys({ openaiKey, openaiBase, openaiModel, context7Key, relayUrl })
    if (r?.ok) { setOpenaiKey(''); setContext7Key(''); setKeys(await getKeys()); setKeyNote('saved') }
    else setKeyNote(r?.error || 'could not save')
  }

  const EditorOption = ({ id, label, sub }: { id: string; label: string; sub?: string }) => {
    const active = editor === id
    return (
      <button
        onClick={() => chooseEditor(id)}
        className="text-left px-3 py-2 cursor-pointer"
        style={{
          border: '1px solid ' + (active ? 'var(--color-primary)' : 'var(--border)'),
          background: active ? 'color-mix(in oklab, var(--color-primary) 10%, transparent)' : 'transparent',
          color: active ? 'var(--color-primary)' : 'var(--text-secondary)',
        }}
      >
        <div className="font-mono text-[10px] tracking-[0.12em]">{label}</div>
        {sub && <div className="font-mono text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</div>}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overlay-in" style={{ background: 'rgba(4,7,12,0.78)' }} onClick={onClose}>
      <Panel notch="md" className="cosmic-panel w-[min(540px,92vw)] flex flex-col" onClick={e => e.stopPropagation()}>
        <PanelHead title="SETTINGS" right={<button onClick={onClose} className="micro">CLOSE</button>} />
        <div className="p-5 flex flex-col gap-6">
          <section className="flex flex-col gap-2">
            <div className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>OPEN CODE IN</div>
            <div className="grid grid-cols-4 gap-2">
              <EditorOption id="auto" label="AUTO" sub="VS Code → Cursor" />
              <EditorOption id="vscode" label="VS CODE" />
              <EditorOption id="cursor" label="CURSOR" />
              <EditorOption id="codium" label="VSCODIUM" />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>API KEYS</span>
              <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>NIVIX {keys?.openaiSet ? 'ON' : 'OFF'} · WIKI {keys?.context7Set ? 'ON' : 'OFF'}</span>
            </div>
            <input value={openaiKey} onChange={e => setOpenaiKey(e.target.value)} type="password" placeholder={keys?.openaiSet ? 'OpenAI key (saved)' : 'OpenAI-compatible API key'} className="font-mono text-[10px] px-2 py-1.5 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
            <div className="grid grid-cols-2 gap-2">
              <input value={openaiBase} onChange={e => setOpenaiBase(e.target.value)} placeholder="base URL" className="font-mono text-[10px] px-2 py-1.5 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
              <input value={openaiModel} onChange={e => setOpenaiModel(e.target.value)} placeholder="model" className="font-mono text-[10px] px-2 py-1.5 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
            </div>
            <input value={context7Key} onChange={e => setContext7Key(e.target.value)} type="password" placeholder={keys?.context7Set ? 'Context7 key (saved)' : 'Context7 API key'} className="font-mono text-[10px] px-2 py-1.5 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
            <input value={relayUrl} onChange={e => setRelayUrl(e.target.value)} placeholder="relay URL (online mode)" className="font-mono text-[10px] px-2 py-1.5 border bg-transparent outline-none" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }} />
            <div className="flex items-center gap-2">
              <button onClick={saveKeysNow} className="micro">SAVE KEYS</button>
              {keyNote && <span className="font-mono text-[8px]" style={{ color: 'var(--color-amber)' }}>{keyNote}</span>}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] tracking-[0.16em]" style={{ color: 'var(--text-muted)' }}>AUDIO</span>
              <button onClick={() => setMuted(!muted)} className="micro" style={{ color: muted ? 'var(--text-muted)' : 'var(--color-primary)' }}>{muted ? 'MUTED' : 'ON'}</button>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>VOL</span>
              <input
                type="range" min={0} max={100} value={Math.round(volume * 100)}
                onChange={e => setVolume(Number(e.target.value) / 100)}
                className="flex-1" style={{ accentColor: 'var(--color-primary)' }} disabled={muted}
              />
              <span className="font-mono text-[10px] w-8 text-right" style={{ color: 'var(--text-secondary)' }}>{Math.round(volume * 100)}</span>
            </div>
          </section>

          <p className="font-mono text-[8px] leading-4" style={{ color: 'var(--text-muted)' }}>Stored locally in your browser. The editor preference is sent to the local agent when you press OPEN IN VS CODE.</p>
        </div>
      </Panel>
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
  const live = useLiveRoom()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const meId = live.room?.meId || null
  const roster: ScoreRow[] = live.room?.members?.length
    ? live.room.members.map(m => ({ id: m.id, name: m.name, lang: m.lang, score: m.score ?? null, host: m.host, connected: m.connected, me: m.id === meId }))
    : [
        { id: 'me', name: s.me.name || 'YOU', lang: s.me.lang, score: s.me.score, stage: s.me.stage, host: true, connected: true, me: true },
        ...(s.opp.joined ? [{ id: 'opp', name: s.opp.name, lang: s.opp.lang, score: s.opp.score, stage: s.opp.stage, host: false, connected: s.opp.connected, me: false }] : []),
      ]
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
          {s.screen === 'lobby' && <Lobby s={s} send={send} agent={agent} onSettings={() => setSettingsOpen(true)} live={live} />}
          {s.screen === 'match' && <Match s={s} send={send} onSettings={() => setSettingsOpen(true)} roster={roster} multiplayer={!!live.room?.code} />}
          {s.screen === 'matchResult' && <Final s={s} send={send} />}
          {s.screen === 'countdown' && <Countdown s={s} />}
          {s.screen === 'roundResult' && <RoundResult s={s} send={send} />}
        </div>

        <ScreenFade screen={s.screen} />
        {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      </div>
    </Animator>
  )
}
