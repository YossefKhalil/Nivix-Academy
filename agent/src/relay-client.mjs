/* Agent-side client for the Nivix relay: owns a member and bridges the relay
 * to the local browser. The relay is authoritative, so the host leaving never
 * ends the room. */
import { WebSocket } from 'ws'

export class RelayClient {
  constructor({ onMessage = () => {}, onStatus = () => {} } = {}) {
    this.onMessage = onMessage
    this.onStatus = onStatus
    this.ws = null
    this.url = null
    this.room = null
    this.you = null
    this.id = 'p' + Math.random().toString(36).slice(2, 8)
  }

  get status() {
    return {
      url: this.url,
      code: this.room?.code || null,
      connected: this.ws?.readyState === 1,
      room: this.room,
    }
  }

  async create({ relayUrl, maxPlayers, totalRounds, name, lang }) {
    this.url = String(relayUrl || '').replace(/\/$/, '')
    const res = await fetch(this.url + '/room', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ maxPlayers, totalRounds }),
    })
    const data = await res.json()
    if (!data?.ok) throw new Error('relay refused to create a room')
    await this.connect(data.code, { name, lang })
    return data
  }

  async join({ relayUrl, code, name, lang }) {
    this.url = String(relayUrl || '').replace(/\/$/, '')
    await this.connect(code, { name, lang })
    return { code }
  }

  connect(code, { name = 'PLAYER', lang = 'python' } = {}) {
    return new Promise((resolve, reject) => {
      const url = `${this.url.replace(/^http/, 'ws')}/ws?code=${encodeURIComponent(code)}&id=${this.id}&name=${encodeURIComponent(name)}&lang=${lang}`
      const ws = new WebSocket(url)
      const timer = setTimeout(() => reject(new Error('relay connect timeout')), 8000)
      ws.once('open', () => { clearTimeout(timer); resolve() })
      ws.once('error', e => { clearTimeout(timer); reject(e) })
      ws.on('message', data => {
        let msg
        try { msg = JSON.parse(data.toString()) } catch { return }
        if (msg.t === 'room' || msg.t === 'hello') this.room = msg.room
        if (msg.you) this.you = msg.you
        this.onMessage({ ...msg, you: this.you })
        this.onStatus()
      })
      ws.on('close', () => { this.ws = null; this.onStatus() })
      this.ws = ws
    })
  }

  send(obj) { try { this.ws?.send(JSON.stringify(obj)) } catch { /* closed */ } }

  leave() {
    try { this.ws?.close() } catch { /* ignore */ }
    this.ws = null
    this.room = null
    this.url = null
  }
}