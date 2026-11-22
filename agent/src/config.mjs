import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Tiny JSON config store under agent/.nivix/config.json (gitignored). */
export function createConfig(agentRoot) {
  const file = join(agentRoot, '.nivix', 'config.json')
  const read = () => {
    try { return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {} } catch { return {} }
  }
  const write = patch => {
    mkdirSync(dirname(file), { recursive: true })
    const next = { ...read(), ...patch }
    writeFileSync(file, JSON.stringify(next, null, 2))
    return next
  }
  return { file, read, write }
}