import http from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Course content is the single source of truth for lesson order, ports and
   test names. The probes below implement those named tests. */
const here = fileURLToPath(new URL('.', import.meta.url))
const CONTENT = join(here, '..', '..', 'content', 'lessons.json')
let lessons = []
try { lessons = JSON.parse(readFileSync(CONTENT, 'utf8')).lessons || [] } catch { lessons = [] }
const coding = lessons.filter(l => l.kind === 'code')

/** Tiny HTTP probe (status / headers / body). */
export function httpProbe({ port, host = '127.0.0.1', method = 'GET', path = '/', headers = {}, body, timeout = 5000 }) {
  return new Promise(resolve => {
    const req = http.request({ host, port, method, path, headers, timeout }, res => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', c => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }))
    })
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }) })
    req.on('error', e => resolve({ error: e.message || String(e) }))
    if (body != null) req.write(body)
    req.end()
  })
}
const h = (r, n) => r.headers?.[n] ?? ''
const b64 = s => Buffer.from(s).toString('base64')

/* lesson id -> array of probes, in the same order as the content tests. */
const PROBES = {
  85: [
    async p => (await httpProbe({ port: p, path: '/' })).status === 200,
    async p => /text\/plain/i.test(h(await httpProbe({ port: p, path: '/' }), 'content-type')),
    async p => /UP/.test((await httpProbe({ port: p, path: '/health' })).body || ''),
    async p => (await httpProbe({ port: p, path: '/health' })).status === 200,
    async p => (await httpProbe({ port: p, path: '/nope' })).status === 404,
  ],
  86: [
    async p => /pong/i.test((await httpProbe({ port: p, path: '/ping' })).body || ''),
    async p => ((await httpProbe({ port: p, path: '/echo?msg=hi' })).body || '').trim() === 'hi',
    async p => (await httpProbe({ port: p, path: '/echo' })).status === 400,
    async p => (await httpProbe({ port: p, path: '/nope' })).status === 404,
    async p => ((await httpProbe({ port: p, path: '/echo?msg=a%20b' })).body || '').trim() === 'a b',
    async p => (await httpProbe({ port: p, path: '/ping' })).status === 200,
  ],
  87: [
    async p => ((await httpProbe({ port: p, path: '/sum?a=2&b=3' })).body || '').trim() === '5',
    async p => (await httpProbe({ port: p, path: '/sum?a=x&b=3' })).status === 400,
    async p => { const b = (await httpProbe({ port: p, path: '/routes' })).body || ''; return b.includes('/sum') && b.includes('/routes') },
    async p => (await httpProbe({ port: p, path: '/' })).status === 200,
    async p => (await httpProbe({ port: p, path: '/sum?a=2' })).status === 400,
  ],
  88: [
    async p => (await httpProbe({ port: p, path: '/admin' })).status === 401,
    async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${b64('nova:duel')}` } })).status === 200,
    async p => /basic/i.test(h(await httpProbe({ port: p, path: '/admin' }), 'www-authenticate')),
    async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${b64('other:duel')}` } })).status === 401,
    async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${b64('nova:wrong')}` } })).status === 401,
    async p => (await httpProbe({ port: p, method: 'POST', path: '/admin' })).status === 405,
    async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: 'Basic !!!notb64' } })).status === 401,
    async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `basic ${b64('nova:duel')}` } })).status === 200,
  ],
  89: [
    async p => (await httpProbe({ port: p, path: '/data' })).status === 401,
    async p => (await httpProbe({ port: p, path: '/data', headers: { authorization: 'Bearer nivix-secret' } })).status === 200,
    async p => /bearer/i.test(h(await httpProbe({ port: p, path: '/data' }), 'www-authenticate')),
    async p => (await httpProbe({ port: p, path: '/data', headers: { authorization: 'Bearer nope' } })).status === 401,
    async p => (await httpProbe({ port: p, path: '/data', headers: { authorization: `Basic ${b64('nova:duel')}` } })).status === 401,
    async p => /application\/json/i.test(h(await httpProbe({ port: p, path: '/data', headers: { authorization: 'Bearer nivix-secret' } }), 'content-type')),
  ],
  90: [
    async p => ((await httpProbe({ port: p, path: `/fetch?url=${encodeURIComponent(`http://127.0.0.1:${p}/ping`)}` })).body || '').trim().toLowerCase().includes('pong'),
    async p => (await httpProbe({ port: p, path: '/fetch' })).status === 400,
    async p => (await httpProbe({ port: p, path: '/ping' })).status === 200,
    async p => (await httpProbe({ port: p, path: `/fetch?url=${encodeURIComponent('http://127.0.0.1:1/nope')}` })).status === 502,
  ],
  91: [
    async p => (await httpProbe({ port: p, method: 'POST', path: '/submit', headers: { 'content-type': 'application/json' }, body: '{"name":"nova","score":7}' })).status === 200,
    async p => (await httpProbe({ port: p, method: 'POST', path: '/submit', headers: { 'content-type': 'application/json' }, body: '{bad json' })).status === 400,
    async p => (await httpProbe({ port: p, method: 'POST', path: '/submit', headers: { 'content-type': 'application/json' }, body: '{"name":"nova"}' })).status === 400,
    async p => (await httpProbe({ port: p, method: 'POST', path: '/submit', headers: { 'content-type': 'text/plain' }, body: 'nope' })).status === 415,
    async p => (await httpProbe({ port: p, path: '/submit' })).status === 405,
  ],
}

/** Run the suite for a round (1-based index into the coding lessons). */
export async function runRound({ round, port }) {
  const lesson = coding[(Number(round) || 1) - 1]
  if (!lesson) return []
  const probes = PROBES[lesson.id] || []
  const results = []
  for (let i = 0; i < lesson.tests.length; i++) {
    const probe = probes[i]
    let pass = false
    try { pass = probe ? !!await probe(port) : false } catch { pass = false }
    results.push({ name: lesson.tests[i].name, pass })
  }
  return results
}