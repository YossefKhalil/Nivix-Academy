#!/usr/bin/env node
/* Nivix Academy - local agent.
 *
 * Responsibilities:
 *   • serve the built UI (web/dist) and the game WebSocket
 *   • supervise the player's own HTTP server (python / csharp)
 *   • run the judge against it
 *   • open VS Code / Cursor / VSCodium
 *   • relay two peers over LAN or a ZeroTier network (host-authoritative)
 *
 * Usage: node src/index.mjs [--port 7788] [--workspace DIR] [--ui DIR] [--open]
 */
import http from 'node:http'
import { createReadStream, existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { WebSocketServer, WebSocket } from 'ws'

import { networkSummary } from './zerotier.mjs'
import { detectEditor, openEditor } from './editor.mjs'
import { ServerRunner } from './runner.mjs'
import { runRound } from './judge.mjs'
import { Room } from './room.mjs'
import { libztAvailable } from './transport.mjs'
import { ztApi } from './zerotier-api.mjs'
import { createConfig } from './config.mjs'
import { startAnnouncer, discover } from './discovery.mjs'
import { RelayClient } from './relay-client.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const AGENT_ROOT = resolvePath(here, '..')

// Load agent/.env (and a repo-level .env) if present.
try { process.loadEnvFile(join(AGENT_ROOT, '.env')) } catch { /* no agent .env */ }
try { process.loadEnvFile(join(AGENT_ROOT, '..', '.env')) } catch { /* no repo .env */ }

const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`)
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}

const PORT = Number(opt('port', 7788))
const BIND = opt('host', '0.0.0.0')
const UI_DIR = resolvePath(opt('ui', join(AGENT_ROOT, '..', 'web', 'dist')))
const WORKSPACE = resolvePath(opt('workspace', join(AGENT_ROOT, 'workspace')))

/* ── workspace starters ─────────────────────────────── */

const PY_STARTER = `from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # TODO: route GET / , /ping , /echo?msg=... etc.
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"OK")

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", 8081), Handler).serve_forever()
`

const CS_STARTER = `using System.Net;

var listener = new HttpListener();
listener.Prefixes.Add("http://localhost:8080/");
listener.Start();
Console.WriteLine("listening on :8080");

while (true)
{
    var ctx = listener.GetContext();
    // TODO: route requests
    ctx.Response.StatusCode = 200;
    ctx.Response.Close();
}
`

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net9.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`

function ensureWorkspace() {
  const py = join(WORKSPACE, 'python')
  const cs = join(WORKSPACE, 'csharp')
  mkdirSync(py, { recursive: true })
  mkdirSync(cs, { recursive: true })
  const files = [
    [join(py, 'server.py'), PY_STARTER],
    [join(cs, 'Program.cs'), CS_STARTER],
    [join(cs, 'duel.csproj'), CSPROJ],
  ]
  for (const [p, content] of files) if (!existsSync(p)) writeFileSync(p, content)
}
ensureWorkspace()

/* ── state ──────────────────────────────────────────── */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const makeCode = () => Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

const state = { startedAt: Date.now(), logs: [] }

const PEER_PORT = Number(opt('peer-port', 7789))
let libztReady = false
libztAvailable().then(v => { libztReady = v })

const config = createConfig(AGENT_ROOT)

const relay = new RelayClient({
  onMessage: msg => room.broadcastLocal({ t: 'relay', payload: { ...msg, you: relay.id } }),
  onStatus: () => room.broadcastLocal({ t: 'relay-status', status: relay.status }),
})

const room = new Room({
  stateDir: join(AGENT_ROOT, '.zt'),
  onLog: line => {
    state.logs.push(line)
    if (state.logs.length > 500) state.logs.shift()
    process.stdout.write(`  │ ${line.trimEnd()}\n`)
  },
})

const runner = new ServerRunner({
  workspace: WORKSPACE,
  onLog: line => {
    state.logs.push(line)
    if (state.logs.length > 500) state.logs.shift()
    process.stdout.write(`  │ ${line.trimEnd()}\n`)
  },
})

/* ── helpers ────────────────────────────────────────── */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type',
}

const sendJson = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS })
  res.end(JSON.stringify(data))
}

const readJson = req => new Promise(resolve => {
  let raw = ''
  req.on('data', c => { raw += c; if (raw.length > 2_000_000) req.destroy() })
  req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
  req.on('error', () => resolve({}))
})

function status() {
  const net = networkSummary()
  return {
    ok: true,
    version: '0.1.0',
    uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
    port: PORT,
    bind: BIND,
    workspace: WORKSPACE,
    uiBuilt: existsSync(join(UI_DIR, 'index.html')),
    zerotier: net.zerotier,
    lan: net.lan,
    preferred: net.preferred,
    interfaces: net.interfaces,
    editor: detectEditor(),
    server: runner.status,
    libzt: libztReady,
    relay: relay.status,
    room: room.snapshot(),
  }
}

/* ── static UI ──────────────────────────────────────── */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://local')
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  let file = resolvePath(join(UI_DIR, pathname))
  if (!file.startsWith(UI_DIR)) { res.writeHead(403); res.end('forbidden'); return }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(UI_DIR, 'index.html')
  if (!existsSync(file)) { res.writeHead(404); res.end('UI not built — run `npm run build` in web/'); return }

  const ext = extname(file).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const size = statSync(file).size

  const range = req.headers.range
  const seekable = ext === '.mp4' || ext === '.webm' || ext === '.mp3' || ext === '.ogg'
  if (range && seekable) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    let start = m && m[1] ? parseInt(m[1], 10) : 0
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1
    if (!Number.isFinite(start) || start < 0) start = 0
    if (!Number.isFinite(end) || end >= size) end = size - 1
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return }
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
    })
    createReadStream(file, { start, end }).pipe(res)
    return
  }

  res.writeHead(200, {
    'content-type': type,
    'content-length': size,
    'accept-ranges': 'bytes',
    'cache-control': (ext === '.html' || ext === '.js' || ext === '.css') ? 'no-store' : 'public, max-age=300',
  })
  createReadStream(file).pipe(res)
}

/* ── websockets ─────────────────────────────────────── */

const wss = new WebSocketServer({ noServer: true })

/* ── http ───────────────────────────────────────────── */

function aiConfig() {
  const cfg = config.read()
  return {
    key: cfg.openaiKey || process.env.OPENAI_API_KEY || '',
    base: cfg.openaiBase || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: cfg.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
  }
}
const DOC_HOSTS = ['developer.mozilla.org', 'rfc-editor.org', 'www.rfc-editor.org', 'learn.microsoft.com', 'docs.python.org', 'nodejs.org', 'httpwg.org']

/** Strip an HTML page down to readable text for the in-app reader. */
function htmlToText(html) {
  let s = String(html)
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '')
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '')
  s = s.replace(/<nav[\s\S]*?<\/nav>/gi, '')
  s = s.replace(/<header[\s\S]*?<\/header>/gi, '')
  s = s.replace(/<footer[\s\S]*?<\/footer>/gi, '')
  const art = s.match(/<article[\s\S]*?<\/article>/i)
  if (art) s = art[0]
  s = s.replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/tr)\s*\/?>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '- ')
  s = s.replace(/<[^>]+>/g, '')
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  s = s.replace(/&quot;/gi, '"').replace(/&#39;/g, "'").replace(/&mdash;/gi, '-').replace(/&ndash;/gi, '-')
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ')
  return s.trim()
}

async function resolveNetwork(requested) {
  const cfg = config.read()
  if (requested && requested !== 'auto' && requested !== 'new') return requested
  if (requested !== 'new' && cfg.ztNetwork) return cfg.ztNetwork
  if (cfg.ztToken) {
    const net = await ztApi.createNetwork(cfg.ztToken, { name: 'Nivix Academy', public: true })
    config.write({ ztNetwork: net.id, ztNetworkName: net.config?.name || 'Nivix Academy' })
    return net.id
  }
  return null
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local')

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return }

  if (url.pathname.startsWith('/api/')) {
    try {
      if (url.pathname === '/api/status') return sendJson(res, 200, status())

      if (url.pathname === '/api/vscode' && req.method === 'POST') {
        const body = await readJson(req)
        const r = await openEditor(WORKSPACE, body.file, body.prefer)
        return sendJson(res, r.ok ? 200 : 500, r)
      }

      if (url.pathname === '/api/server/start' && req.method === 'POST') {
        const body = await readJson(req)
        try {
          const st = await runner.start(body.lang === 'csharp' ? 'csharp' : 'python')
          return sendJson(res, 200, { ok: true, server: st })
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/server/stop' && req.method === 'POST') {
        return sendJson(res, 200, { ok: true, server: await runner.stop() })
      }

      if (url.pathname === '/api/judge' && req.method === 'POST') {
        const body = await readJson(req)
        const lang = body.lang === 'csharp' ? 'csharp' : 'python'
        try { await runner.start(lang) } catch { /* judge will just fail the probes */ }
        const results = await runRound({ round: Number(body.round) || 1, port: runner.port || (lang === 'python' ? 8081 : 8080), suite: body.suite || 'all' })
        return sendJson(res, 200, { ok: true, round: Number(body.round) || 1, lang, port: runner.port, results })
      }

      if (url.pathname === '/api/logs') return sendJson(res, 200, { ok: true, logs: state.logs.slice(-200) })

      if (url.pathname === '/api/room' && req.method === 'POST') {
        const body = await readJson(req)
        try {
          const snap = await room.createHost({
            mode: body.mode,
            network: body.mode === 'multi' ? await resolveNetwork(body.network) : undefined,
            maxPlayers: body.maxPlayers,
            peerPort: Number(body.peerPort) || PEER_PORT,
          })
          return sendJson(res, 200, { ok: true, room: snap })
        } catch (e) {
          return sendJson(res, 500, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/join' && req.method === 'POST') {
        const body = await readJson(req)
        const host = String(body.host || '')
        const code = String(body.code || '').toUpperCase()
        if (!host || !code) return sendJson(res, 400, { ok: false, error: 'host and code required' })
        try {
          const r = await room.joinRemote({
            network: body.network || config.read().ztNetwork || undefined,
            host,
            port: Number(body.port) || PEER_PORT,
            code,
            member: { name: body.name, lang: body.lang },
          })
          return sendJson(res, 200, { ok: true, ...r })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/leave' && req.method === 'POST') {
        await room.teardown()
        return sendJson(res, 200, { ok: true, room: room.snapshot() })
      }

      if (url.pathname === '/api/zt' && req.method === 'GET') {
        const cfg = config.read()
        return sendJson(res, 200, {
          ok: true,
          tokenSet: !!cfg.ztToken,
          network: cfg.ztNetwork || null,
          networkName: cfg.ztNetworkName || null,
        })
      }

      if (url.pathname === '/api/zt/token' && req.method === 'POST') {
        const body = await readJson(req)
        const token = String(body.token || '').trim()
        if (!token) return sendJson(res, 400, { ok: false, error: 'token required' })
        try {
          const networks = await ztApi.networks(token)
          config.write({ ztToken: token })
          return sendJson(res, 200, { ok: true, networks: Array.isArray(networks) ? networks.length : 0 })
        } catch (e) {
          return sendJson(res, 401, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/zt/network' && req.method === 'POST') {
        const cfg = config.read()
        if (!cfg.ztToken) return sendJson(res, 400, { ok: false, error: 'save a ZeroTier token first' })
        const body = await readJson(req)
        try {
          const net = await ztApi.createNetwork(cfg.ztToken, { name: body.name || 'Nivix Academy', public: body.public !== false })
          config.write({ ztNetwork: net.id, ztNetworkName: net.config?.name || 'Nivix Academy' })
          return sendJson(res, 200, { ok: true, network: { id: net.id, name: net.config?.name || 'Nivix Academy' } })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/zt/authorize' && req.method === 'POST') {
        const cfg = config.read()
        const body = await readJson(req)
        if (!cfg.ztToken || !cfg.ztNetwork || !body.memberId) {
          return sendJson(res, 400, { ok: false, error: 'token, network and memberId required' })
        }
        try {
          const member = await ztApi.authorize(cfg.ztToken, cfg.ztNetwork, String(body.memberId))
          return sendJson(res, 200, { ok: true, member })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/relay' && req.method === 'GET') {
        return sendJson(res, 200, { ok: true, relay: relay.status })
      }

      if (url.pathname === '/api/relay/room' && req.method === 'POST') {
        const body = await readJson(req)
        try {
          const r = await relay.create({
            relayUrl: body.relayUrl || config.read().relayUrl || 'http://127.0.0.1:8090',
            maxPlayers: body.maxPlayers,
            totalRounds: body.totalRounds,
            name: body.name,
            lang: body.lang,
          })
          return sendJson(res, 200, { ok: true, code: r.code, room: relay.room, relay: relay.status })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/relay/join' && req.method === 'POST') {
        const body = await readJson(req)
        const code = String(body.code || '').toUpperCase()
        if (!code) return sendJson(res, 400, { ok: false, error: 'code required' })
        try {
          await relay.join({ relayUrl: body.relayUrl || config.read().relayUrl || 'http://127.0.0.1:8090', code, name: body.name, lang: body.lang })
          return sendJson(res, 200, { ok: true, code, room: relay.room, relay: relay.status })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/relay/leave' && req.method === 'POST') {
        relay.leave()
        return sendJson(res, 200, { ok: true })
      }

      if (url.pathname === '/api/code' && req.method === 'GET') {
        const lang = url.searchParams.get('lang') === 'csharp' ? 'csharp' : 'python'
        const file = lang === 'csharp' ? join(WORKSPACE, 'csharp', 'Program.cs') : join(WORKSPACE, 'python', 'server.py')
        return sendJson(res, 200, { ok: true, lang, content: existsSync(file) ? readFileSync(file, 'utf8') : '' })
      }

      if (url.pathname === '/api/code' && req.method === 'POST') {
        const body = await readJson(req)
        const lang = body.lang === 'csharp' ? 'csharp' : 'python'
        const file = lang === 'csharp' ? join(WORKSPACE, 'csharp', 'Program.cs') : join(WORKSPACE, 'python', 'server.py')
        writeFileSync(file, String(body.content ?? ''))
        return sendJson(res, 200, { ok: true, lang })
      }

      if (url.pathname === '/api/nivix' && req.method === 'POST') {
        const body = await readJson(req)
        const question = String(body.question || '').trim()
        if (!question) return sendJson(res, 400, { ok: false, error: 'question required' })
        const { key, base: rawBase, model } = aiConfig()
        const base = rawBase.replace(/\/$/, '')
        if (!key) return sendJson(res, 503, { ok: false, error: 'NIVIX offline: set OPENAI_API_KEY in agent/.env' })
        try {
          const r = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model,
              temperature: 0.3,
              messages: [
                { role: 'system', content: 'You are NIVIX, a concise HTTP and networking tutor inside a coding game. Answer in 2-4 sentences with one concrete example. Plain text only.' },
                { role: 'user', content: question },
              ],
            }),
          })
          const j = await r.json()
          const answer = j?.choices?.[0]?.message?.content
          if (!answer) return sendJson(res, 502, { ok: false, error: j?.error?.message || 'no answer' })
          return sendJson(res, 200, { ok: true, answer })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }


      if (url.pathname === '/api/docs' && req.method === 'GET') {
        const q = (url.searchParams.get('q') || '').trim()
        if (!q) return sendJson(res, 400, { ok: false, error: 'q required' })
        const base = (config.read().docsBase || process.env.DOCS_BASE_URL || 'https://developer.mozilla.org/api/v1/search').replace(/\/$/, '')
        try {
          const u = new URL(base)
          u.searchParams.set('q', q)
          u.searchParams.set('locale', 'en-US')
          const r = await fetch(u, { headers: { accept: 'application/json' } })
          if (!r.ok) return sendJson(res, 502, { ok: false, error: 'docs backend HTTP ' + r.status })
          const j = await r.json()
          const docs = j?.documents || j?.hits || j?.results || j?.data || []
          const results = docs.slice(0, 12).map(d => {
            const raw = String(d.url || d.slug || '')
            const link = raw.startsWith('http') ? raw
              : raw.startsWith('/') ? 'https://developer.mozilla.org' + raw
                : 'https://developer.mozilla.org/en-US/docs/' + raw
            return { title: d.title || d.name || link, url: link, source: 'MDN', summary: String(d.summary || '').replace(/<[^>]+>/g, '').trim() }
          })
          return sendJson(res, 200, { ok: true, results })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/docs/read' && req.method === 'GET') {
        const target = (url.searchParams.get('url') || '').trim()
        if (!target) return sendJson(res, 400, { ok: false, error: 'url required' })
        let parsed
        try { parsed = new URL(target) } catch { return sendJson(res, 400, { ok: false, error: 'bad url' }) }
        if (!/^https?:$/.test(parsed.protocol) || !DOC_HOSTS.includes(parsed.hostname)) {
          return sendJson(res, 400, { ok: false, error: 'host not allowed' })
        }
        try {
          const r = await fetch(parsed, { headers: { 'user-agent': 'NivixAcademy/1.0', accept: 'text/html,text/plain' } })
          if (!r.ok) return sendJson(res, 502, { ok: false, error: 'page HTTP ' + r.status })
          const type = r.headers.get('content-type') || ''
          const body = await r.text()
          const text = type.includes('text/plain') ? body : htmlToText(body)
          return sendJson(res, 200, { ok: true, title: decodeURIComponent(parsed.pathname.split('/').pop() || target), text: text.slice(0, 20000) })
        } catch (e) {
          return sendJson(res, 502, { ok: false, error: String(e?.message || e) })
        }
      }

      if (url.pathname === '/api/keys' && req.method === 'GET') {
        const ai = aiConfig()
        return sendJson(res, 200, {
          ok: true,
          openaiSet: !!ai.key, openaiBase: ai.base, openaiModel: ai.model,
          relayUrl: config.read().relayUrl || '',
        })
      }

      if (url.pathname === '/api/keys' && req.method === 'POST') {
        const body = await readJson(req)
        const patch = {}
        if (typeof body.openaiKey === 'string' && body.openaiKey.trim()) patch.openaiKey = body.openaiKey.trim()
        if (typeof body.openaiBase === 'string' && body.openaiBase.trim()) patch.openaiBase = body.openaiBase.trim()
        if (typeof body.openaiModel === 'string' && body.openaiModel.trim()) patch.openaiModel = body.openaiModel.trim()
        if (typeof body.relayUrl === 'string') patch.relayUrl = body.relayUrl.trim()
        config.write(patch)
        return sendJson(res, 200, { ok: true })
      }

      return sendJson(res, 404, { ok: false, error: 'unknown endpoint' })
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: String(e?.message || e) })
    }
  }

  if (url.pathname === '/ws/local') {
    // handled in 'upgrade'
    res.writeHead(426); res.end('upgrade required'); return
  }

  serveStatic(req, res)
})

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://local')
  if (url.pathname !== '/ws/local') { socket.destroy(); return }
  wss.handleUpgrade(req, socket, head, ws => {
    ws.on('message', data => {
      let m
      try { m = JSON.parse(data.toString()) } catch { return }
      if (m?.t === 'relay-send') relay.send(m.msg)
    })
    room.joinLocal(ws)
  })
})

server.listen(PORT, BIND, () => {
  const net = networkSummary()
  const editor = detectEditor()
  const line = '─'.repeat(56)
  console.log(`\n  ${line}`)
  console.log('  NIVIX ACADEMY · local agent')
  console.log(`  UI          http://127.0.0.1:${PORT}/`)
  console.log(`  LAN / ZT    ${net.preferred ? `ws://${net.preferred}:${PORT}` : 'no external IPv4 found'}`)
  console.log(`  ZeroTier    ${net.zerotier ? `${net.zerotier.name} · ${net.zerotier.address}` : 'not detected'}`)
  console.log(`  libzt       ${libztReady ? 'available (embedded ZeroTier)' : 'not available — LAN sockets only'}`)
  console.log(`  Peer port   ${PEER_PORT}`)
  console.log(`  Editor      ${editor ? `${editor.name} (${editor.command})` : 'none found'}`)
  console.log(`  Workspace   ${WORKSPACE}`)
  console.log(`  UI build    ${existsSync(join(UI_DIR, 'index.html')) ? UI_DIR : 'MISSING — run `npm run build` in web/'}`)
  console.log(`  ${line}\n`)

  if (flag('open')) {
    const url = `http://127.0.0.1:${PORT}/`
    const cmd = process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    try { spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref() } catch { /* ignore */ }
  }
})

const shutdown = async () => {
  try { relay.leave() } catch { /* ignore */ }
  try { await room.teardown() } catch { /* ignore */ }
  try { await runner.stop() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
