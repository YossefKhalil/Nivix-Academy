/* Verifies the agent -> relay bridge: agent A creates a relay room, agent B
   joins by code, and both local browsers see the same authoritative roster. */
import WebSocket from 'ws'

const A = 'http://127.0.0.1:7788'
const B = 'http://127.0.0.1:7790'
const RELAY = 'http://127.0.0.1:8090'
const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json())
const wait = ms => new Promise(r => setTimeout(r, ms))

async function openWs(base) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws/local')
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
  const msgs = []
  ws.on('message', d => msgs.push(JSON.parse(d.toString())))
  return { ws, msgs }
}
const relayRooms = m => m.filter(x => x.t === 'relay' && x.payload?.t === 'room').map(x => x.payload.room)
const fmt = r => r?.members?.map(x => `${x.name}${x.host ? ':host' : ''}`)

const created = await post(A, '/api/relay/room', { relayUrl: RELAY, maxPlayers: 4, name: 'NOVA', lang: 'python' })
console.log('create:', created.ok, created.code || created.error)

const a = await openWs(A)
const b = await openWs(B)
await wait(300)

const joined = await post(B, '/api/relay/join', { relayUrl: RELAY, code: created.code, name: 'KAI', lang: 'csharp' })
console.log('join:', joined.ok, joined.error || '')
await wait(700)

const roomA = relayRooms(a.msgs).pop()
const roomB = relayRooms(b.msgs).pop()
console.log('A browser sees:', fmt(roomA), '| count', roomA?.memberCount)
console.log('B browser sees:', fmt(roomB), '| count', roomB?.memberCount)
console.log(roomA?.memberCount >= 2 && roomB?.memberCount >= 2 ? 'RELAY OK' : 'RELAY FAIL')

a.ws.close(); b.ws.close()
await post(A, '/api/relay/leave', {})
await post(B, '/api/relay/leave', {})
process.exit(0)