/* Smoke test for the local agent: status, room create, WS join, judge wiring.
   Usage: node scripts/smoke.mjs [base]   (agent must be running) */
import WebSocket from 'ws'

const base = process.argv[2] || 'http://127.0.0.1:7788'
const post = (path, body) => fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
}).then(r => r.json())
const get = path => fetch(base + path).then(r => r.json())
const wait = ms => new Promise(r => setTimeout(r, ms))

const status = await get('/api/status')
console.log('status:', { ok: status.ok, lan: status.lan?.address, editor: status.editor?.name })

const created = await post('/api/room', { mode: 'single' })
console.log('room:', { ok: created.ok, code: created.room?.code, mode: created.room?.mode, count: created.room?.memberCount })

const ws = new WebSocket(base.replace('http', 'ws') + '/ws/local')
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
const messages = []
ws.on('message', d => messages.push(JSON.parse(d.toString())))
ws.send(JSON.stringify({ t: 'join', name: 'NOVA', lang: 'python' }))
await wait(400)

const roomMsg = messages.filter(m => m.t === 'room').pop()
console.log('ws room:', { members: roomMsg?.room?.members?.map(m => `${m.name}:${m.lang}${m.host ? ':host' : ''}`), mode: roomMsg?.room?.mode })
ws.close()

await post('/api/leave', {})
console.log('done')
process.exit(0)