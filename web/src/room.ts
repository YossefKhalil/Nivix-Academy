/* Live room client — talks to the local agent over /ws/local and the room API. */
import { useEffect, useRef, useState } from 'react'

export interface RoomMember {
  id: string
  name: string
  lang: 'python' | 'csharp'
  ready: boolean
  host: boolean
  connected: boolean
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

function wsUrl() {
  if (BASE) return BASE.replace(/^http/, 'ws') + '/ws/local'
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws/local`
}

export function useLiveRoom() {
  const [room, setRoom] = useState<RoomState | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry: number | undefined
    let closed = false

    const connect = () => {
      try { ws = new WebSocket(wsUrl()) } catch { return }
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onmessage = ev => {
        let msg: { t?: string; room?: RoomState }
        try { msg = JSON.parse(ev.data) } catch { return }
        if ((msg.t === 'room' || msg.t === 'hello') && msg.room) setRoom(msg.room)
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