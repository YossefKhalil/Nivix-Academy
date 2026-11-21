/* Sound layer for HTTP DUEL — built on Arwes' bleeps manager.

   Default pack is the ARWES demo set (next.arwes.dev): click, hover, type,
   assemble, info, error, intro — same bleeps the Arwes docs site uses.
   A CC0 Kenney "Interface Sounds" pack is bundled as a comparison toggle.

   Every bleep lists multiple sources; the browser plays the first it supports. */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { BleepsProvider, useBleeps } from '@arwes/react'
import type { BleepsManagerProps } from '@arwes/bleeps'

export type SoundPack = 'arwes' | 'kenney'
export const SOUND_PACKS: SoundPack[] = ['arwes', 'kenney']

export type SfxName =
  | 'click' | 'hover' | 'select' | 'toggle' | 'tick' | 'go' | 'confirm' | 'win' | 'error'
  | 'open' | 'close' | 'expand' | 'notify' | 'type'

type Source = { src: string; type: string }

const A = (name: string, ...exts: string[]): Source[] =>
  exts.map(ext => ({ src: `/sounds/arwes/${name}.${ext}`, type: ext === 'webm' ? 'audio/webm' : 'audio/mpeg' }))
const K = (name: string): Source[] => [
  { src: `/sounds/kenney/${name}.ogg`, type: 'audio/ogg' },
  { src: `/sounds/kenney/${name}.mp3`, type: 'audio/mpeg' },
]

// Dedicated countdown beep (tonal, gentle) — shared by both packs.
const TICK: Source[] = [
  { src: '/sounds/tick.ogg', type: 'audio/ogg' },
  { src: '/sounds/tick.mp3', type: 'audio/mpeg' },
]

// Arwes demo bleeps (next.arwes.dev), with its clicks swapped for the Kenney ones.
const ARWES_SOURCES: Record<SfxName, Source[]> = {
  click: K('click'),
  hover: A('hover', 'webm'),
  select: K('click'),
  toggle: K('click'),
  tick: TICK,
  go: A('intro', 'mp3'),
  confirm: A('info', 'mp3'),
  win: K('win'),
  error: A('error', 'mp3'),
  notify: A('info', 'mp3'),
  open: A('assemble', 'webm'),
  close: A('info', 'mp3'),
  expand: A('assemble', 'webm'),
  type: A('type', 'mp3', 'webm'),
}

const KENNEY_SOURCES = (name: SfxName): Source[] => {
  if (name === 'tick') return TICK
  if (name === 'go') return K('win')
  return [
    { src: `/sounds/kenney/${name}.ogg`, type: 'audio/ogg' },
    { src: `/sounds/kenney/${name}.mp3`, type: 'audio/mpeg' },
  ]
}

const VOLUME: Record<SfxName, number> = {
  click: 0.3, hover: 0.16, select: 0.28, toggle: 0.3, tick: 0.3, go: 0.42,
  confirm: 0.36, win: 0.34, error: 0.34, notify: 0.3,
  open: 0.36, close: 0.3, expand: 0.36, type: 0.26,
}

const CATEGORY: Record<SfxName, 'interaction' | 'notification' | 'transition'> = {
  click: 'interaction', hover: 'interaction', select: 'interaction', toggle: 'interaction', tick: 'interaction',
  go: 'notification', confirm: 'notification', win: 'notification', error: 'notification', notify: 'notification',
  open: 'transition', close: 'transition', expand: 'transition', type: 'transition',
}

function buildBleeps(pack: SoundPack): BleepsManagerProps<SfxName>['bleeps'] {
  const sources = pack === 'arwes' ? ARWES_SOURCES : KENNEY_SOURCES
  const out = {} as BleepsManagerProps<SfxName>['bleeps']
  for (const name of Object.keys(VOLUME) as SfxName[]) {
    out[name] = {
      category: CATEGORY[name],
      volume: VOLUME[name],
      sources: typeof sources === 'function' ? sources(name) : sources[name],
    }
  }
  return out
}

interface AudioState {
  muted: boolean
  toggle: () => void
  setMuted: (v: boolean) => void
  volume: number
  setVolume: (v: number) => void
  pack: SoundPack
  setPack: (p: SoundPack) => void
}

const AudioContext = createContext<AudioState>({
  muted: false, toggle: () => {}, setMuted: () => {}, volume: 0.45, setVolume: () => {}, pack: 'arwes', setPack: () => {},
})

export const useAudio = () => useContext(AudioContext)

const readStoredMute = () => {
  try { return localStorage.getItem('duel.muted') === '1' } catch { return false }
}
const readStoredVolume = () => {
  try {
    const v = Number(localStorage.getItem('duel.volume'))
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.45
  } catch { return 0.45 }
}
const readStoredPack = (): SoundPack => {
  try { return localStorage.getItem('duel.pack') === 'kenney' ? 'kenney' : 'arwes' } catch { return 'arwes' }
}

export function SfxProvider({ children }: { children: ReactNode }) {
  const [muted, setMutedState] = useState(readStoredMute)
  const [volume, setVolumeState] = useState(readStoredVolume)
  const [pack, setPackState] = useState<SoundPack>(readStoredPack)

  const setMuted = useCallback((v: boolean) => {
    setMutedState(v)
    try { localStorage.setItem('duel.muted', v ? '1' : '0') } catch { /* ignore */ }
  }, [])
  const toggle = useCallback(() => setMuted(!muted), [muted, setMuted])
  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v))
    setVolumeState(clamped)
    try { localStorage.setItem('duel.volume', String(clamped)) } catch { /* ignore */ }
  }, [])
  const setPack = useCallback((p: SoundPack) => {
    setPackState(p)
    try { localStorage.setItem('duel.pack', p) } catch { /* ignore */ }
  }, [])

  const value = useMemo(
    () => ({ muted, toggle, setMuted, volume, setVolume, pack, setPack }),
    [muted, toggle, setMuted, volume, setVolume, pack, setPack],
  )

  return (
    <AudioContext.Provider value={value}>
      {/* keyed by pack so the bleeps manager is rebuilt with the new sources */}
      <BleepsProvider
        key={pack}
        master={{ volume }}
        categories={{
          background: { volume: 0.25, muteOnWindowBlur: true },
          interaction: { volume: 0.9 },
          notification: { volume: 1 },
          transition: { volume: 0.9 },
        }}
        common={{ preload: true, asyncLoad: true }}
        bleeps={buildBleeps(pack)}
      >
        {children}
      </BleepsProvider>
    </AudioContext.Provider>
  )
}

export type Sfx = Record<SfxName, () => void>

/** Play functions for every bleep; all no-op while muted. */
export function useSfx(): Sfx {
  const bleeps = useBleeps<SfxName>()
  const { muted } = useAudio()

  return useMemo(() => {
    const out = {} as Sfx
    for (const name of Object.keys(VOLUME) as SfxName[]) {
      out[name] = () => {
        if (muted) return
        try { bleeps[name]?.play() } catch { /* autoplay blocked until first gesture */ }
      }
    }
    return out
  }, [bleeps, muted])
}
