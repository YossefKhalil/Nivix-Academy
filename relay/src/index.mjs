/* Nivix relay — authoritative rooms + match state.
 *
 * The relay owns the room and the match, so a player (even the host) leaving
 * never kills the room: authority is promoted, and the match continues for
 * everyone still online. Peers only ever dial *out* to the relay, so it works
 * through any NAT.
 *
 * HTTP:  POST /room { maxPlayers, totalRounds } -> { code }
 *        GET  /health
 * WS:    /ws?code=&id=&name=&lang=
 *        client -> { t: start | next | submit | ready | chat | ping }
 *        server -> { t: hello | room | chat | error | pong }
 */
import http from 'node:http'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT || 8090)
const ROOM_TTL = Number(process.env.ROOM_TTL_MS || 15 * 60 * 1000)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

const rooms = new Map()

function newRoom({ maxPlayers = 8, totalRounds = 3 } = {}) {
  const room = {
    code: makeCode(),
    maxPlayers: Math.max(1, Math.min(64, maxPlayers)),
    totalRounds: Math.max(1, Math.min(9, totalRounds)),
    members: new Map(),
    emptySince: null,
    match: { active: false, round: 1, phase: 'lobby', countdown: 0, result: null },
  }
  rooms.set(room.code, room)
  return room
}

const hostId = room => [...room.members.values()].find(m => m.host)?.id || null

function snapshot(room) {
  return {
    code: room.code,
    maxPlayers: room.maxPlayers,
    totalRounds: room.totalRounds,
    memberCount: room.members.size,
    onlineCount: [...room.members.values()].filter(m => m.online).length,
    hostId: hostId(room),
    members: [...room.members.values()].map(m => ({
      id: m.id, name: m.name, lang: m.lang, host: m.host, online: m.online, ready: m.ready,
      score: m.score, submitted: m.submitted,
    })),
    match: room.match,
  }
}

function broadcast(room, msg) {
  const text = JSON.stringify(msg)
  for (const m of room.members.values()) if (m.online && m.ws) { try { m.ws.send(text) } catch { /* ignore */ } }
}
const broadcastRoom = room => broadcast(room, { t: 'room', room: snapshot(room) })

function beginRound(room) {
  room.match.phase = 'countdown'
  room.match.countdown = 3
  room.match.result = null
  for (const m of room.members.values()) { m.score = null; m.submitted = false }
  broadcastRoom(room)
  const timer = setInterval(() => {
    if (room.match.phase !== 'countdown') { clearInterval(timer); return }
    room.match.countdown -= 1
    if (room.match.countdown <= 0) { room.match.phase = 'playing'; clearInterval(timer) }
    broadcastRoom(room)
  }, 1000)
}

function startMatch(room) {
  room.match = { active: true, round: 1, phase: 'lobby', countdown: 0, result: null }
  beginRound(room)
}

function maybeResolve(room) {
  const online = [...room.members.values()].filter(m => m.online)
  if (online.length && online.every(m => m.submitted)) {
    room.match.phase = 'result'
    room.match.result = {
      round: room.match.round,
      order: online.map(m => ({ id: m.id, name: m.name, score: m.score || 0 })).sort((a, b) => b.score - a.score),
    }
    broadcastRoom(room)
  }
}

function nextRound(room) {
  if (room.match.round >= room.totalRounds) { room.match.phase = 'final'; broadcastRoom(room); return }
  room.match.round += 1
  beginRound(room)
}

/* ── http ─────────────────────────────────────────── */

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  const json = (code, data) => { res.writeHead(code, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(data)) }
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }
  if (url.pathname === '/health') return json(200, { ok: true, rooms: rooms.size })
  if (url.pathname === '/room' && req.method === 'POST') {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      let body = {}
      try { body = raw ? JSON.parse(raw) : {} } catch { /* ignore */ }
      const room = newRoom({ maxPlayers: Number(body.maxPlayers) || 8, totalRounds: Number(body.totalRounds) || 3 })
      json(200, { ok: true, code: room.code, room: snapshot(room) })
    })
    return
  }
  json(404, { ok: false, error: 'not found' })
})

/* ── ws ───────────────────────────────────────────── */

const wss = new WebSocketServer({ noServer: true })

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname !== '/ws') { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => {
    const code = (url.searchParams.get('code') || '').toUpperCase()
    const id = url.searchParams.get('id') || 'm' + Math.random().toString(36).slice(2, 8)
    const name = url.searchParams.get('name') || 'PLAYER'
    const lang = url.searchParams.get('lang') === 'csharp' ? 'csharp' : 'python'

    const room = rooms.get(code)
    const reject = error => { try { ws.send(JSON.stringify({ t: 'error', error })) } catch { /* ignore */ }; try { ws.close() } catch { /* ignore */ } }
    if (!room) return reject('room not found')

    const existing = room.members.get(id)
    if (!existing && room.members.size >= room.maxPlayers) return reject('room full')

    const member = {
      id, name, lang, ws, online: true, ready: false,
      host: existing ? existing.host : room.members.size === 0,
      score: existing ? existing.score : null,
      submitted: existing ? existing.submitted : false,
    }
    room.members.set(id, member)
    room.emptySince = null

    ws.send(JSON.stringify({ t: 'hello', room: snapshot(room), you: id }))
    broadcastRoom(room)

    ws.on('message', data => {
      let msg
      try { msg = JSON.parse(data.toString()) } catch { return }
      if (msg.t === 'ping') { try { ws.send('{"t":"pong"}') } catch { /* ignore */ }; return }
      const current = room.members.get(id)
      if (!current || current.ws !== ws) return
      if (msg.t === 'start') { if (current.host && !room.match.active) startMatch(room) }
      else if (msg.t === 'next') { if (current.host && room.match.phase === 'result') nextRound(room) }
      else if (msg.t === 'submit') { current.submitted = true; current.score = Number(msg.score) || 0; broadcastRoom(room); maybeResolve(room) }
      else if (msg.t === 'ready') { current.ready = !!msg.value; broadcastRoom(room) }
      else if (msg.t === 'chat') { broadcast(room, { t: 'chat', from: current.name, text: String(msg.text || '').slice(0, 500) }) }
    })

    const drop = () => {
      const current = room.members.get(id)
      if (!current || current.ws !== ws) return
      current.online = false
      current.ws = null
      if (current.host) {
        current.host = false
        const heir = [...room.members.values()].find(m => m.online)
        if (heir) heir.host = true
      }
      if (![...room.members.values()].some(m => m.online)) room.emptySince = Date.now()
      broadcastRoom(room)
    }
    ws.on('close', drop)
    ws.on('error', drop)
  })
})

setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.emptySince && now - room.emptySince > ROOM_TTL) rooms.delete(code)
  }
}, 30000)

server.listen(PORT, () => console.log(`nivix-relay listening on :${PORT}`))
