/* Client for the local Nivix Academy agent.
   When the UI is served by the agent it's same-origin; during `vite dev`
   set VITE_AGENT_URL=http://127.0.0.1:7788. */

const BASE = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? ''
const url = (p: string) => `${BASE}${p}`

export interface AgentStatus {
  ok: boolean
  version: string
  port: number
  preferred: string | null
  zerotier: { name: string; address: string } | null
  lan: { name: string; address: string } | null
  editor: { name: string; command: string } | null
  server: { running: boolean; lang: string | null; port: number | null }
  role: 'host' | 'guest' | null
  room: string | null
}

export interface EditorResult {
  ok: boolean
  editor?: string
  command?: string
  target?: string
  error?: string
}

export async function getAgentStatus(timeoutMs = 1200): Promise<AgentStatus | null> {
  try {
    const r = await fetch(url('/api/status'), { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    return (await r.json()) as AgentStatus
  } catch {
    return null
  }
}

/** Returns null when no agent is reachable (caller should fall back to mock). */
export async function openInEditor(file?: string, prefer?: string): Promise<EditorResult | null> {
  try {
    const r = await fetch(url('/api/vscode'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, prefer }),
      signal: AbortSignal.timeout(20000),
    })
    return (await r.json()) as EditorResult
  } catch {
    return null
  }
}

export async function judgeRound(round: number, lang: 'python' | 'csharp', suite: 'visible' | 'hidden' | 'all' = 'all') {
  try {
    const r = await fetch(url('/api/judge'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ round, lang, suite }),
    })
    return await r.json()
  } catch {
    return null
  }
}

export async function getCode(lang: 'python' | 'csharp'): Promise<string | null> {
  try {
    const r = await fetch(url(`/api/code?lang=${lang}`))
    if (!r.ok) return null
    const j = await r.json()
    return typeof j?.content === 'string' ? j.content : null
  } catch { return null }
}

export async function saveCode(lang: 'python' | 'csharp', content: string): Promise<boolean> {
  try {
    const r = await fetch(url('/api/code'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lang, content }),
    })
    return r.ok
  } catch { return false }
}

export async function nivixAsk(question: string): Promise<{ ok: boolean; answer?: string; error?: string } | null> {
  try {
    const r = await fetch(url('/api/nivix'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(30000),
    })
    return await r.json()
  } catch { return null }
}

export interface DocResult { title: string; url: string; source: string; summary?: string }

/** Online docs search (proxied by the agent; default backend is the MDN search API). */
export async function docsSearch(q: string): Promise<{ ok: boolean; results?: DocResult[]; error?: string } | null> {
  try {
    return await (await fetch(url(`/api/docs?q=${encodeURIComponent(q)}`))).json()
  } catch { return null }
}

/** Fetch a doc page and return it as readable text for the in-app reader. */
export async function docsRead(page: string): Promise<{ ok: boolean; title?: string; text?: string; error?: string } | null> {
  try {
    return await (await fetch(url(`/api/docs/read?url=${encodeURIComponent(page)}`))).json()
  } catch { return null }
}

export interface KeyStatus {
  ok: boolean
  openaiSet: boolean
  openaiBase: string
  openaiModel: string
  relayUrl?: string
}

export async function getKeys(): Promise<KeyStatus | null> {
  try { return await (await fetch(url('/api/keys'))).json() } catch { return null }
}

export async function saveKeys(keys: { openaiKey?: string; openaiBase?: string; openaiModel?: string; relayUrl?: string }) {
  try {
    return await (await fetch(url('/api/keys'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(keys),
    })).json()
  } catch { return null }
}

export async function discoverRoom(code: string): Promise<{ ok: boolean; host?: { host: string; port: number; network: string | null; code: string } | null } | null> {
  try { return await (await fetch(url(`/api/discover?code=${encodeURIComponent(code)}`))).json() } catch { return null }
}