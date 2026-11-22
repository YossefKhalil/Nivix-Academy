/* Live room client — talks to the local agent over /ws/local and the room API. */
import { useEffect, useRef, useState } from 'react'

export interface RoomMember {
  id: string
  name: string
  lang: 'python' | 'csharp'
  ready: boolean
  host: boolean
  connected: boolean
  score?: number | null
  via?: string
}

export interface RoomState {
  code: string | null
  mode: 'single' | 'multi'
  network: string | null
  maxPlayers: number
  role: 'host' | 'guest' | null
  hostId: string | null
  started: boolean
  round: number
  memberCount: number
  members: RoomMember[]
  transport: string | null
  address: string | null
}

const BASE = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? ''
const api = (p: string) => `${BASE}${p}`

async function post(path: string, body?: unknown) {
  try {
    const r = await fetch(api(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    return await r.json()
  } catch { return null }
}
async function get(path: string) {
  try { return await (await fetch(api(path))).json() } catch { return null }
}

export const createRoom = (opts: { mode: string; maxPlayers?: number; network?: string }) => post('/api/room', opts)
export const joinRoom = (opts: { network?: string; host: string; port?: number; code: string; name?: string; lang?: string }) => post('/api/join', opts)
export const leaveRoom = () => post('/api/leave')

export const getZt = () => get('/api/zt')
export const setZtToken = (token: string) => post('/api/zt/token', { token })
export const createZtNetwork = (opts?: { name?: string; public?: boolean }) => post('/api/zt/network', opts)

export const relayCreate = (opts: { relayUrl: string; maxPlayers?: number; name?: string; lang?: string }) => post('/api/relay/room', opts)
export const relayJoin = (opts: { relayUrl: string; code: string; name?: string; lang?: string }) => post('/api/relay/join', opts)
export const relayLeave = () => post('/api/relay/leave')

function normalizeRelay(r: any, you?: string): RoomState {
  return {
    code: r.code, mode: 'multi', network: null, maxPlayers: r.maxPlayers || 8,
    role: you && r.hostId === you ? 'host' : 'guest', hostId: r.hostId || null,
    started: !!r.match?.active, round: r.match?.round || 1,
    memberCount: r.memberCount || (r.members?.length ?? 0), transport: 'relay', address: null,
    members: (r.members || []).map((m: any) => ({
      id: m.id, name: m.name, lang: m.lang, ready: !!m.ready, host: !!m.host, connected: m.online !== false, score: m.score ?? null,
    })),
  }
}

function wsUrl() {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws/local'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/local`
}

export function useLiveRoom() {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const sourceRef = useRef<'none' | 'local' | 'relay'>('none')

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: number | undefined
    let closed = false

    const connect = () => {
      try { ws = new WebSocket(wsUrl()) } catch { return }
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = ev => {
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.t === 'relay' && msg.payload?.t === 'room' && msg.payload.room) {
          sourceRef.current = 'relay'
          setRoom(normalizeRelay(msg.payload.room, msg.payload.you))
        } else if (msg.t === 'relay-status') {
          if (!msg.status?.connected) sourceRef.current = 'none'
        } else if ((msg.t === 'room' || msg.t === 'hello') && msg.room && sourceRef.current !== 'relay') {
          setRoom(msg.room as RoomState)
        }
      }
      ws.onclose = () => {
        setConnected(false)
        if (!closed) retry = window.setTimeout(connect, 2000)
      }
      ws.onerror = () => {}
    }
    connect()
    return () => { closed = true; if (retry) clearTimeout(retry); ws?.close() }
  }, [])

  const send = (msg: unknown) => { try { wsRef.current?.send(JSON.stringify(msg)) } catch { /* closed */ } }
  return { room, connected, send }
}