import { spawn } from 'node:child_process'
import net from 'node:net'
import { join } from 'node:path'

const PY_CANDIDATES = process.platform === 'win32'
  ? [['python', ['server.py']], ['py', ['-3', 'server.py']]]
  : [['python3', ['server.py']], ['python', ['server.py']]]

export const PORTS = { python: 8081, csharp: 8080 }

export function waitForPort(port, host = '127.0.0.1', timeoutMs = 25000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const s = net.connect({ port, host })
      s.once('connect', () => { s.destroy(); resolve(true) })
      s.once('error', () => {
        s.destroy()
        if (Date.now() - start > timeoutMs) reject(new Error(`server did not open port ${port}`))
        else setTimeout(attempt, 250)
      })
    }
    attempt()
  })
}

function killTree(pid) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    else process.kill(-pid, 'SIGTERM')
  } catch { /* ignore */ }
}

/** Supervises the player's own server process. */
export class ServerRunner {
  constructor({ workspace, onLog = () => {} }) {
    this.workspace = workspace
    this.onLog = onLog
    this.proc = null
    this.lang = null
    this.port = null
    this.command = null
    this.starting = null
  }

  get status() {
    return {
      running: !!this.proc,
      pid: this.proc?.pid ?? null,
      lang: this.lang,
      port: this.port,
      command: this.command,
    }
  }

  start(lang = 'python') {
    if (this.proc) return Promise.resolve(this.status)
    if (this.starting) return this.starting
    this.starting = this._start(lang).finally(() => { this.starting = null })
    return this.starting
  }

  async _start(lang) {
    this.lang = lang === 'csharp' ? 'csharp' : 'python'
    this.port = PORTS[this.lang] || 8081
    const cwd = join(this.workspace, this.lang)

    const attempts = this.lang === 'python'
      ? PY_CANDIDATES.map(([c, a]) => [c, a, cwd])
      : [['dotnet', ['run', '--project', cwd, '-v', 'q'], cwd]]

    let lastErr = null
    for (const [cmd, args, dir] of attempts) {
      try {
        const proc = spawn(cmd, args, {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        })
        await new Promise((resolve, reject) => {
          proc.once('spawn', resolve)
          proc.once('error', reject)
        })
        this.proc = proc
        this.command = `${cmd} ${args.join(' ')}`
        proc.stdout.on('data', d => this.onLog(d.toString()))
        proc.stderr.on('data', d => this.onLog(d.toString()))
        proc.once('exit', () => { if (this.proc === proc) this.proc = null })
        await waitForPort(this.port)
        this.onLog(`[agent] ${this.lang} server ready on :${this.port}`)
        return this.status
      } catch (e) {
        lastErr = e
        if (this.proc) { killTree(this.proc.pid); this.proc = null }
      }
    }
    throw new Error(`failed to start ${this.lang}: ${lastErr?.message || lastErr}`)
  }

  async stop() {
    const pid = this.proc?.pid
    if (pid) killTree(pid)
    await new Promise(r => setTimeout(r, 300))
    this.proc = null
    return this.status
  }
}