import http from 'node:http'

/** Tiny HTTP probe used by the judge (status / headers / body). */
export function httpProbe({ port, host = '127.0.0.1', method = 'GET', path = '/', headers = {}, body, timeout = 4000 }) {
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

const header = (r, name) => r.headers?.[name] ?? ''

const ROUND_1 = [
  { name: 'GET / -> 200 OK', run: async p => (await httpProbe({ port: p, path: '/' })).status === 200 },
  { name: 'GET / Content-Type: text/plain', run: async p => /text\/plain/i.test(header(await httpProbe({ port: p, path: '/' }), 'content-type')) },
  { name: 'GET /ping -> "pong"', run: async p => /pong/i.test((await httpProbe({ port: p, path: '/ping' })).body || '') },
  { name: 'GET /nope -> 404', run: async p => (await httpProbe({ port: p, path: '/nope' })).status === 404 },
  { name: 'GET /echo?msg=hi -> "hi"', run: async p => ((await httpProbe({ port: p, path: '/echo?msg=hi' })).body || '').trim() === 'hi' },
  { name: 'GET /echo (no msg) -> 400', run: async p => (await httpProbe({ port: p, path: '/echo' })).status === 400 },
]

const ROUND_2 = [
  { name: 'GET /admin, no auth -> 401', run: async p => (await httpProbe({ port: p, path: '/admin' })).status === 401 },
  { name: 'GET /admin, wrong user -> 401', run: async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${Buffer.from('x:duel').toString('base64')}` } })).status === 401 },
  { name: 'GET /admin, wrong pass -> 401', run: async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${Buffer.from('nova:x').toString('base64')}` } })).status === 401 },
  { name: 'GET /admin, valid -> 200', run: async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `Basic ${Buffer.from('nova:duel').toString('base64')}` } })).status === 200 },
  { name: '401 sends WWW-Authenticate', run: async p => /basic/i.test(header(await httpProbe({ port: p, path: '/admin' }), 'www-authenticate')) },
  { name: 'POST /admin -> 405', run: async p => (await httpProbe({ port: p, method: 'POST', path: '/admin' })).status === 405 },
  { name: 'GET /other -> 404', run: async p => (await httpProbe({ port: p, path: '/other' })).status === 404 },
  { name: 'malformed base64 -> 401', run: async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: 'Basic !!!' } })).status === 401 },
  { name: 'scheme "basic" lowercase -> ok', run: async p => (await httpProbe({ port: p, path: '/admin', headers: { authorization: `basic ${Buffer.from('nova:duel').toString('base64')}` } })).status === 200 },
]

const ROUNDS = { 1: ROUND_1, 2: ROUND_2 }

export const roundTests = round => ROUNDS[round] || []

export async function runRound({ round, port }) {
  const tests = roundTests(round)
  const results = []
  for (const t of tests) {
    let pass = false
    try { pass = !!await t.run(port) } catch { pass = false }
    results.push({ name: t.name, pass })
  }
  return results
}