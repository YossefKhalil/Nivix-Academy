/* Edge-case suite for the Nivix relay. Run the relay first, then: node scripts/edge.mjs */
import WebSocket from 'ws'

const BASE = process.env.RELAY || 'http://127.0.0.1:8090'
const WSURL = BASE.replace(/^http/, 'ws')
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b || {}) }).then(r => r.json())
const wait = ms => new Promise(r => setTimeout(r, ms))

let pass = 0, fail = 0
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name) }
  else { fail++; console.log('  FAIL', name, extra !== undefined ? JSON.stringify(extra) : '') }
}

function client({ code, id, name, lang = 'python' }) {
  const ws = new WebSocket(`${WSURL}/ws?code=${code}&id=${id}&name=${encodeURIComponent(name)}&lang=${lang}`)
  const msgs = []
  const ready = new Promise(res => {
    ws.on('message', d => { const m = JSON.parse(d.toString()); msgs.push(m); if (m.t === 'hello' || m.t === 'error') res(m) })
    ws.on('error', () => res({ t: 'error', error: 'ws error' }))
  })
  const last = t => [...msgs].reverse().find(m => m.t === t)
  return { ws, msgs, ready, last, room: () => last('room')?.room, send: o => { try { ws.send(JSON.stringify(o)) } catch {} }, close: () => ws.close() }
}

console.log('EDGE SUITE')

const r1 = await post('/room', { maxPlayers: 4, totalRounds: 2 })
ok('create room returns a 6-char code', /^[A-Z2-9]{6}$/.test(r1.code || ''), r1)

const a = client({ code: r1.code, id: 'a', name: 'A' }); await a.ready
const b = client({ code: r1.code, id: 'b', name: 'B', lang: 'csharp' }); await b.ready
const c = client({ code: r1.code, id: 'c', name: 'C' }); await c.ready
await wait(200)
ok('3 members joined', a.room()?.memberCount === 3, a.room())
ok('first joiner is host', a.room()?.hostId === 'a', a.room()?.hostId)

const bad = client({ code: 'ZZZZZZ', id: 'x', name: 'X' })
const badMsg = await bad.ready
ok('bad code rejected', badMsg.t === 'error', badMsg)
bad.close()

const r2 = await post('/room', { maxPlayers: 1 })
const f1 = client({ code: r2.code, id: 'f1', name: 'F1' }); await f1.ready
const f2 = client({ code: r2.code, id: 'f2', name: 'F2' })
const f2msg = await f2.ready
ok('room-full rejected', f2msg.t === 'error' && /full/.test(f2msg.error || ''), f2msg)
f2.close(); f1.close()

b.send({ t: 'start' })
await wait(300)
ok('non-host start ignored', !a.room()?.match?.active, a.room()?.match)

a.send({ t: 'start' })
await wait(300)
ok('host start -> countdown', a.room()?.match?.phase === 'countdown', a.room()?.match)
await wait(3300)
ok('countdown -> playing', a.room()?.match?.phase === 'playing', a.room()?.match)

a.send({ t: 'submit', score: 5 })
b.send({ t: 'submit', score: 9 })
await wait(200)
ok('waits for every player before resolving', a.room()?.match?.phase === 'playing', a.room()?.match?.phase)
c.send({ t: 'submit', score: 7 })
await wait(300)
const result = a.room()?.match?.result
ok('all submitted -> result', a.room()?.match?.phase === 'result', a.room()?.match?.phase)
ok('ranking sorted high->low', JSON.stringify(result?.order?.map(x => x.score)) === '[9,7,5]', result)

a.close()
await wait(500)
const afterHostExit = b.room()
ok('room survives the host leaving', afterHostExit?.memberCount === 3, afterHostExit?.memberCount)
ok('host promoted to a survivor', !!afterHostExit?.hostId && afterHostExit.hostId !== 'a', afterHostExit?.hostId)
const departed = afterHostExit?.members?.find(m => m.id === 'a')
ok('departed host marked offline', !!departed && departed.online === false, departed)

const d = client({ code: r1.code, id: 'd', name: 'D' }); await d.ready
await wait(200)
ok('late join accepted', b.room()?.memberCount === 4, b.room()?.memberCount)

b.close()
await wait(400)
ok('host migrates again when the new host leaves', c.room()?.hostId === 'c', c.room()?.hostId)
const b2 = client({ code: r1.code, id: 'b', name: 'B', lang: 'csharp' }); await b2.ready
await wait(200)
const bMember = b2.room()?.members?.find(m => m.id === 'b')
ok('reconnect with same id restores the member', !!bMember && bMember.online === true, bMember)
ok('reconnect keeps the member score', bMember?.score === 9, bMember)
ok('reconnect does not steal the host role', bMember?.host === false, bMember)

console.log(`\nRESULT ${pass} passed, ${fail} failed`)
b2.close(); c.close(); d.close()
process.exit(fail ? 1 : 0)