#!/usr/bin/env node
/* HTTP DUEL — local agent.
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
import { createReadStream, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
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

const here = fileURLToPath(new URL('.', import.meta.url))
const AGENT_ROOT = resolvePath(here, '..')

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
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
  })
  createReadStream(file).pipe(res)
}

/* ── websockets ─────────────────────────────────────── */

const wss = new WebSocketServer({ noServer: true })

/* ── http ───────────────────────────────────────────── */

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
        const results = await runRound({ round: Number(body.round) || 1, port: runner.port || (lang === 'python' ? 8081 : 8080) })
        return sendJson(res, 200, { ok: true, round: Number(body.round) || 1, lang, port: runner.port, results })
      }

      if (url.pathname === '/api/logs') return sendJson(res, 200, { ok: true, logs: state.logs.slice(-200) })

      if (url.pathname === '/api/room' && req.method === 'POST') {
        const body = await readJson(req)
        try {
          const snap = await room.createHost({
            mode: body.mode,
            network: body.network,
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
            network: body.network,
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
  wss.handleUpgrade(req, socket, head, ws => room.joinLocal(ws))
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
  try { await room.teardown() } catch { /* ignore */ }
  try { await runner.stop() } catch { /* ignore */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)