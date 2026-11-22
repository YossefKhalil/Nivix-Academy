/* Room manager — host-authoritative, supports single-player and N-player rooms.
 *
 * Host agent owns the member list and relays game actions to every browser and
 * peer agent. Guest agents forward their local member's intents to the host and
 * mirror the host's room snapshot to their own browsers.
 */
import { createPeerListener, connectPeer, jsonLineSocket } from './transport.mjs'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')
const makeId = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)

export class Room {
  constructor({ stateDir, onLog = () => {} }) {
    this.stateDir = stateDir
    this.onLog = onLog
    this.code = null
    this.mode = 'single'
    this.network = null
    this.maxPlayers = 8
    this.role = null
    this.hostId = null
    this.members = new Map()
    this.locals = new Set()
    this.peers = new Map()
    this.listener = null
    this.outgoing = null
    this.started = false
    this.round = 1
  }

  snapshot() {
    return {
      code: this.code,
      mode: this.mode,
      network: this.network,
      maxPlayers: this.maxPlayers,
      role: this.role,
      hostId: this.hostId,
      started: this.started,
      round: this.round,
      memberCount: this.members.size,
      members: [...this.members.values()],
      transport: this.listener?.kind || this.outgoing?.kind || (this.role ? 'none' : null),
      address: this.listener?.address || null,
    }
  }

  sendLocal(ws, obj) { try { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) } catch { /* closed */ } }
  broadcastLocal(obj) { for (const ws of this.locals) this.sendLocal(ws, obj) }
  sendPeers(obj) { for (const p of this.peers.values()) p.pipe.send(obj) }

  broadcastRoom() {
    const msg = { t: 'room', room: this.snapshot() }
    this.broadcastLocal(msg)
    if (this.role === 'host') this.sendPeers(msg)
  }

  upsertMember({ id, name, lang, host, via }) {
    const mid = id || makeId()
    const cur = this.members.get(mid) || {}
    const member = {
      ...cur,
      id: mid,
      name: name || cur.name || 'PLAYER',
      lang: lang === 'csharp' ? 'csharp' : 'python',
      ready: cur.ready ?? false,
      host: host ?? cur.host ?? false,
      via: via || cur.via || 'local',
      connected: true,
      score: cur.score ?? null,
    }
    this.members.set(mid, member)
    return member
  }

  async createHost({ mode, network, maxPlayers, peerPort }) {
    await this.teardown()
    this.role = 'host'
    this.mode = mode === 'multi' ? 'multi' : 'single'
    this.network = network || null
    this.maxPlayers = Math.max(1, Math.min(32, Number(maxPlayers) || 8))
    this.code = makeCode()
    this.members.clear()
    this.hostId = null

    if (this.mode === 'multi') {
      this.listener = await createPeerListener({
        port: peerPort,
        network: this.network,
        stateDir: `${this.stateDir}/host`,
        onConnection: (sock, kind) => this.attachPeerSocket(sock, kind),
      })
      this.onLog(`[room] hosted on ${this.listener.kind}${this.listener.address ? ` ${this.listener.address}` : ''}:${peerPort}`)
    }
    this.broadcastRoom()
    return this.snapshot()
  }

  async joinRemote({ network, host, port, code, member }) {
    await this.teardown()
    this.role = 'guest'
    this.mode = 'multi'
    this.network = network || null
    this.code = String(code || '').toUpperCase()
    this.members.clear()

    const conn = await connectPeer({ host, port, network: this.network, stateDir: `${this.stateDir}/guest` })
    this.outgoing = conn
    const pipe = jsonLineSocket(conn.socket, msg => this.onPeerMessage('out', msg))
    this.peers.set('out', { pipe, memberId: null, via: conn.kind })
    pipe.send({ t: 'hello', code: this.code })

    // Mirror the host's room into our own members map for local display.
    return { ok: true, transport: conn.kind, room: this.snapshot() }
  }

  attachPeerSocket(sock, kind) {
    const key = 'in' + makeId()
    const pipe = jsonLineSocket(sock, msg => this.onPeerMessage(key, msg))
    this.peers.set(key, { pipe, memberId: null, via: kind })

    const drop = () => {
      const p = this.peers.get(key)
      if (p?.memberId) {
        const m = this.members.get(p.memberId)
        if (m) m.connected = false
      }
      this.peers.delete(key)
      this.broadcastRoom()
    }
    sock.on('close', drop)
    sock.on('error', drop)
    pipe.send({ t: 'welcome', room: this.snapshot() })
  }

  onPeerMessage(key, msg) {
    const p = this.peers.get(key)
    if (!p) return

    if (msg.t === 'join') {
      if (this.role === 'host' && msg.code && String(msg.code).toUpperCase() !== this.code) { p.pipe.close(); return }
      const m = this.upsertMember({ id: msg.member?.id, name: msg.member?.name, lang: msg.member?.lang, host: false, via: p.via })
      p.memberId = m.id
      this.broadcastRoom()
      return
    }

    if (msg.t === 'room') {
      // guest: adopt the host's authoritative snapshot
      if (this.role === 'guest' && msg.room) {
        this.code = msg.room.code
        this.mode = msg.room.mode
        this.maxPlayers = msg.room.maxPlayers
        this.hostId = msg.room.hostId
        this.started = msg.room.started
        this.round = msg.room.round
        this.members = new Map((msg.room.members || []).map(m => [m.id, m]))
      }
      this.broadcastLocal({ t: 'room', room: this.snapshot() })
      return
    }

    if (msg.t === 'action') {
      this.broadcastLocal({ t: 'action', action: msg.action, from: msg.from || p.memberId })
      if (this.role === 'host') {
        for (const [k, other] of this.peers) if (k !== key) other.pipe.send({ t: 'action', action: msg.action, from: msg.from || p.memberId })
      }
    }
  }

  joinLocal(ws) {
    this.locals.add(ws)
    let member = null

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw.toString()) } catch { return }

      if (msg.t === 'ping') { this.sendLocal(ws, { t: 'pong' }); return }

      if (msg.t === 'join') {
        const isHost = (this.role === 'host') && !this.hostId
        member = this.upsertMember({ id: msg.id, name: msg.name, lang: msg.lang, host: isHost, via: 'local' })
        if (isHost) this.hostId = member.id

        if (this.role === 'guest') {
          // forward to the host; it owns the member list
          for (const p of this.peers.values()) p.pipe.send({ t: 'join', code: this.code, member: { id: member.id, name: member.name, lang: member.lang } })
        } else {
          this.broadcastRoom()
        }
        return
      }

      if (msg.t === 'action') {
        this.broadcastLocal({ t: 'action', action: msg.action, from: member?.id || null })
        if (this.role === 'host') this.sendPeers({ t: 'action', action: msg.action, from: member?.id || null })
        else for (const p of this.peers.values()) p.pipe.send({ t: 'action', action: msg.action, from: member?.id || null })
        return
      }

      if (msg.t === 'ready') {
        if (member) {
          member.ready = !!msg.value
          if (this.role === 'host') this.broadcastRoom()
          else for (const p of this.peers.values()) p.pipe.send({ t: 'ready', memberId: member.id, value: !!msg.value })
        }
      }
    })

    const drop = () => {
      this.locals.delete(ws)
      if (member) {
        this.members.delete(member.id)
        if (this.role === 'guest') for (const p of this.peers.values()) p.pipe.send({ t: 'leave', memberId: member.id })
        else this.broadcastRoom()
      }
    }
    ws.on('close', drop)
    ws.on('error', drop)

    this.sendLocal(ws, { t: 'hello', room: this.snapshot() })
    this.broadcastRoom()
  }

  async teardown() {
    try { this.listener?.close() } catch { /* ignore */ }
    try { this.outgoing?.socket?.destroy?.() } catch { /* ignore */ }
    for (const p of this.peers.values()) p.pipe.close()
    this.listener = null
    this.outgoing = null
    this.peers.clear()
    this.members.clear()
    this.hostId = null
    this.started = false
    this.round = 1
    this.code = null
    this.role = null
  }
}