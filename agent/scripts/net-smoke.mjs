/* Two-agent networking test (host on 7788, guest on 7790, LAN transport).
   Creates a multiplayer room, joins from the guest agent, attaches browser
   sockets to both, and prints the room snapshots seen by each side. */
import WebSocket from 'ws'

const HOST = 'http://127.0.0.1:7788'
const GUEST = 'http://127.0.0.1:7790'
const post = (base, path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}).then(r => r.json())
const wait = ms => new Promise(r => setTimeout(r, ms))

async function openWs(base) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/local')
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  const msgs = []
  ws.on('message', d => msgs.push(JSON.parse(d.toString())))
  return { ws, msgs }
}

const created = await post(HOST, '/api/room', { mode: 'multi', maxPlayers: 4 })
console.log('host room:', created.room?.code, created.room?.transport)
if (!created.ok) process.exit(1)

const host = await openWs(HOST)
host.ws.send(JSON.stringify({ t: 'join', id: 'h1', name: 'NOVA', lang: 'python' }))
await wait(300)

const joined = await post(GUEST, '/api/join', {
  host: '127.0.0.1', port: 7789, code: created.room.code, name: 'KAI', lang: 'csharp',
})
console.log('guest join:', joined.ok, joined.transport, joined.error || '')

const guest = await openWs(GUEST)
guest.ws.send(JSON.stringify({ t: 'join', id: 'g1', name: 'KAI', lang: 'csharp' }))
await wait(1000)

const hostRoom = host.msgs.filter(m => m.t === 'room').pop()?.room
const guestRoom = guest.msgs.filter(m => m.t === 'room').pop()?.room
const fmt = r => r?.members?.map(m => `${m.name}:${m.lang}${m.host ? ':host' : ''}`)
console.log('host sees:', fmt(hostRoom), '| count', hostRoom?.memberCount)
console.log('guest sees:', fmt(guestRoom), '| count', guestRoom?.memberCount)

const ok = hostRoom?.memberCount >= 2 && (guestRoom?.memberCount || 0) >= 2
console.log(ok ? 'NETWORK OK' : 'NETWORK FAIL')

host.ws.close(); guest.ws.close()
await post(HOST, '/api/leave', {})
await post(GUEST, '/api/leave', {})
process.exit(ok ? 0 : 1)