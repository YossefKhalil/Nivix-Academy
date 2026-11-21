import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { homedir } from 'node:os'

function onPath(name) {
  const exts = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']
  const dirs = (process.env.PATH || '').split(delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    for (const ext of exts) {
      const p = join(dir, name + ext)
      try { if (existsSync(p)) return p } catch { /* ignore */ }
    }
  }
  return null
}

/** Editors we can drive, in preference order. VS Code first, then Cursor, then VSCodium. */
function candidates() {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
  const pf = process.env.ProgramFiles || 'C:\\Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const list = []

  const cli = onPath('code')
  if (cli) list.push({ name: 'VS Code', command: cli, args: t => ['-r', t] })

  if (process.platform === 'win32') {
    const exes = [
      ['VS Code', join(local, 'Programs', 'Microsoft VS Code', 'Code.exe')],
      ['VS Code', join(pf, 'Microsoft VS Code', 'Code.exe')],
      ['VS Code', join(pf86, 'Microsoft VS Code', 'Code.exe')],
      ['Cursor', join(local, 'Programs', 'cursor', 'Cursor.exe')],
      ['VSCodium', join(local, 'Programs', 'VSCodium', 'VSCodium.exe')],
    ]
    for (const [name, exe] of exes) {
      if (existsSync(exe)) list.push({ name, command: exe, args: t => ['--reuse-window', t] })
    }
  } else {
    for (const [name, cmd] of [['Cursor', 'cursor'], ['VSCodium', 'codium']]) {
      const p = onPath(cmd)
      if (p) list.push({ name, command: p, args: t => ['-r', t] })
    }
  }
  return list
}

export function detectEditor() {
  const c = candidates()[0]
  return c ? { name: c.name, command: c.command } : null
}

function orderFor(list, prefer) {
  if (!prefer || prefer === 'auto') return list
  const want = prefer === 'vscode' ? 'VS Code' : prefer === 'cursor' ? 'Cursor' : prefer === 'codium' ? 'VSCodium' : null
  if (!want) return list
  return [...list.filter(c => c.name === want), ...list.filter(c => c.name !== want)]
}

/** Open `dir` (or a file within it); `prefer` biases the editor choice. */
export function openEditor(dir, file, prefer) {
  const list = orderFor(candidates(), prefer)
  if (!list.length) {
    return Promise.resolve({ ok: false, error: 'No VS Code / Cursor / VSCodium installation found.' })
  }
  const target = file ? join(dir, file) : dir

  const tryAt = i => new Promise(resolve => {
    const c = list[i]
    let settled = false
    const done = r => { if (!settled) { settled = true; resolve(r) } }
    try {
      const child = spawn(c.command, c.args(target), { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('spawn', () => { try { child.unref() } catch { /* ignore */ } done({ ok: true, editor: c.name, command: c.command, target }) })
      child.once('error', () => {
        if (i + 1 < list.length) tryAt(i + 1).then(done)
        else done({ ok: false, error: `Could not launch ${c.name} (${c.command})` })
      })
    } catch (e) {
      if (i + 1 < list.length) tryAt(i + 1).then(done)
      else done({ ok: false, error: String(e?.message || e) })
    }
  })

  return tryAt(0)
}