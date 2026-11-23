/* Nivix relay on Cloudflare Workers + Durable Objects.
 *
 * One Durable Object per room holds members and match state, so online play works
 * globally with no server to run. Deploy with `wrangler deploy` (see wrangler.toml).
 *
 *   POST /room { maxPlayers, totalRounds } -> { code }
 *   GET  /ws?code=&id=&name=&lang=          (WebSocket)
 *   GET  /health
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

export class Room {
  constructor(state) {
    this.state = state
    this.members = new Map()
    this.code = null
    this.maxPlayers = 8
    this.totalRounds = 3
    this.match = { active: false, round: 1, phase: 'lobby', countdown: 0, result: null }
  }

  snapshot() {
    return {
      code: this.code,
      maxPlayers: this.maxPlayers,
      totalRounds: this.totalRounds,
      memberCount: this.members.size,
      onlineCount: [...this.members.values()].filter(m => m.online).length,
      hostId: [...this.members.values()].find(m => m.host)?.id || null,
      members: [...this.members.values()].map(m => ({ id: m.id, name: m.name, lang: m.lang, host: m.host, online: m.online, ready: m.ready, score: m.score, submitted: m.submitted })),
      match: this.match,
    }
  }

  broadcast(obj, exceptWs) {
    const text = JSON.stringify(obj)
    for (const m of this.members.values()) {
      if (m.online && m.ws && m.ws !== exceptWs) { try { m.ws.send(text) } catch { /* closed */ } }
    }
  }
  broadcastRoom() { this.broadcast({ t: 'room', room: this.snapshot() }) }

  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/init') {
      const body = await req.json().catch(() => ({}))
      this.code = body.code
      this.maxPlayers = Math.max(1, Math.min(64, Number(body.maxPlayers) || 8))
      this.totalRounds = Math.max(1, Math.min(9, Number(body.totalRounds) || 3))
      return new Response('ok')
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })

    const id = url.searchParams.get('id') || 'p' + Math.random().toString(36).slice(2, 8)
    const name = url.searchParams.get('name') || 'PLAYER'
    const lang = url.searchParams.get('lang') === 'csharp' ? 'csharp' : 'python'
    const existing = this.members.get(id)

    const pair = new WebSocketPair()
    const ws = pair[1]
    this.state.acceptWebSocket(ws)

    if (!existing && this.members.size >= this.maxPlayers) {
      ws.send(JSON.stringify({ t: 'error', error: 'room full' }))
      try { ws.close() } catch { /* ignore */ }
      return new Response(null, { status: 101, webSocket: pair[0] })
    }

    const member = {
      id, name, lang, ws, online: true, ready: false,
      host: existing ? existing.host : this.members.size === 0,
      score: existing ? existing.score : null,
      submitted: existing ? existing.submitted : false,
    }
    this.members.set(id, member)
    ws.send(JSON.stringify({ t: 'hello', room: this.snapshot(), you: id }))
    this.broadcastRoom()
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  async webSocketMessage(ws, message) {
    const entry = [...this.members.entries()].find(([, m]) => m.ws === ws)
    if (!entry) return
    const [, member] = entry
    let msg
    try { msg = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)) } catch { return }
    if (msg.t === 'ping') { try { ws.send('{"t":"pong"}') } catch { /* ignore */ } return }
    if (msg.t === 'start') { if (member.host && !this.match.active) this.startMatch() }
    else if (msg.t === 'next') { if (member.host && this.match.phase === 'result') this.nextRound() }
    else if (msg.t === 'submit') { member.submitted = true; member.score = Number(msg.score) || 0; this.broadcastRoom(); this.maybeResolve() }
    else if (msg.t === 'ready') { member.ready = !!msg.value; this.broadcastRoom() }
    else if (msg.t === 'chat') { this.broadcast({ t: 'chat', from: member.name, text: String(msg.text || '').slice(0, 500) }, ws) }
  }

  async webSocketClose(ws) {
    const entry = [...this.members.entries()].find(([, m]) => m.ws === ws)
    if (!entry) return
    const [, member] = entry
    member.online = false
    member.ws = null
    if (member.host) {
      member.host = false
      const heir = [...this.members.values()].find(m => m.online)
      if (heir) heir.host = true
    }
    this.broadcastRoom()
  }

  startMatch() {
    this.match = { active: true, round: 1, phase: 'playing', countdown: 0, result: null }
    for (const m of this.members.values()) { m.score = null; m.submitted = false }
    this.broadcastRoom()
  }
  maybeResolve() {
    const online = [...this.members.values()].filter(m => m.online)
    if (online.length && online.every(m => m.submitted)) {
      this.match.phase = 'result'
      this.match.result = { round: this.match.round, order: online.map(m => ({ id: m.id, name: m.name, score: m.score || 0 })).sort((a, b) => b.score - a.score) }
      this.broadcastRoom()
    }
  }
  nextRound() {
    if (this.match.round >= this.totalRounds) { this.match.phase = 'final'; this.broadcastRoom(); return }
    this.match.round += 1
    this.match.phase = 'playing'
    this.match.result = null
    for (const m of this.members.values()) { m.score = null; m.submitted = false }
    this.broadcastRoom()
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' }
    const json = (code, data) => new Response(JSON.stringify(data), { status: code, headers: { 'content-type': 'application/json', ...cors } })
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (url.pathname === '/health') return json(200, { ok: true })
    if (url.pathname === '/room' && req.method === 'POST') {
      const body = await req.json().catch(() => ({}))
      const code = makeCode()
      await env.ROOMS.get(env.ROOMS.idFromName(code)).fetch('https://do/init', { method: 'POST', body: JSON.stringify({ code, maxPlayers: body.maxPlayers, totalRounds: body.totalRounds }) })
      return json(200, { ok: true, code })
    }
    if (url.pathname === '/ws') {
      const code = (url.searchParams.get('code') || '').toUpperCase()
      if (!code) return json(400, { ok: false, error: 'code required' })
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req)
    }
    return json(404, { ok: false, error: 'not found' })
  },
}