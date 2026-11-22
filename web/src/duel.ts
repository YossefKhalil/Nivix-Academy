/* HTTP DUEL - mock state machine.
   Ported from http-duel/prototype/duel-ux-mock.html.
   Pure logic only; the React layer lives in App.tsx. */

export type Lang = 'python' | 'csharp'
export interface Test { name: string; visible?: boolean; pass?: boolean }
export interface RoundDef { tag: string; title: string; brief: string; hints: string; tests: Test[]; id?: number; port?: number; video?: { id: string; start: number; end: number; label?: string; src?: string } }

export const SECTOR = 'HTTP & NETWORKING'
export const ENERGY_MAX = 10
export const COST_HINT = 1
export const COST_AI = 6
export const RECHARGE_SEC = 8

/* Course content (briefs, starters, tests) comes from the shared content file. */
import { ROUNDS, PY_CODE, CS_CODE, LESSONS } from './content'
export { ROUNDS, PY_CODE, CS_CODE, LESSONS }

const OPP_LINES = ['ready when you are', 'this one is tricky', 'my server is up', 'good luck :)', 'submitted, beat that', '401 everywhere lol']

export interface Player { name: string; lang: Lang; ready: boolean; submitted: boolean; score: number | null; stage: number }
export interface Opp extends Player { joined: boolean; connected: boolean }
export interface Msg { who?: string; text: string; me?: boolean; sys?: boolean }
export interface WikiEntry { q: string; a: string }
export interface RoundScore { round: number; me: number; opp: number }

export type Screen = 'boot' | 'lobby' | 'countdown' | 'match' | 'roundResult' | 'matchResult'

export interface State {
  screen: Screen
  bootLine: number
  me: Player
  opp: Opp
  role: 'host' | 'guest' | null
  lobbyTab: 'host' | 'join'
  room: { code: string; link: string }
  round: number; totalRounds: number; seed: number; sector: string
  elapsed: number
  leftTab: 'comms' | 'wiki' | 'ai'
  hintsOpen: boolean; energy: number; hintsPaid: boolean
  chat: Msg[]; wiki: WikiEntry[]
  ranTests: boolean; final: boolean; oppTick: number
  testResults: { name: string; pass: boolean }[] | null
  rounds: RoundScore[]
  countdown: number; mockOpen: boolean
}

export type Action = { type: string; value?: string; results?: { name: string; pass: boolean }[] }

export function initial(): State {
  return {
    screen: 'boot', bootLine: 0,
    me: { name: 'NOVA', lang: 'python', ready: false, submitted: false, score: null, stage: 0 },
    opp: { name: 'KAI', lang: 'csharp', ready: false, submitted: false, score: null, stage: 0, joined: false, connected: true },
    role: null, lobbyTab: 'host', room: { code: '7F3K', link: 'http://100.101.102.103:4318/7F3K' },
    round: 1, totalRounds: ROUNDS.length, seed: 4821, sector: SECTOR,
    elapsed: 0,
    leftTab: 'comms',
    hintsOpen: false, energy: ENERGY_MAX, hintsPaid: false,
    chat: [], wiki: [],
    ranTests: false, final: false, oppTick: 0, testResults: null,
    rounds: [], countdown: 3, mockOpen: true,
  }
}

export const fmt = (t: number) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')

function sys(chat: Msg[], text: string) { chat.push({ sys: true, text }) }

function startRound(s: State) {
  s.screen = 'match'; s.elapsed = 0; s.ranTests = false; s.final = false; s.hintsOpen = false; s.hintsPaid = false; s.testResults = null
  s.me.submitted = false; s.me.score = null; s.me.stage = 0
  s.opp.submitted = false; s.opp.score = null; s.opp.stage = 0; s.oppTick = 0
  s.chat = []; sys(s.chat, 'ROUND ' + s.round + ' STARTED - ' + ROUNDS[s.round - 1].tag)
}
const mePass = (s: State) => s.testResults ? s.testResults.filter(t => t.pass).length : ROUNDS[s.round - 1].tests.filter(t => t.pass).length
const oppPass = (s: State) => {
  const tot = ROUNDS[s.round - 1].tests.length
  const sc = [0, 0.4, 0.65, 0.85, 1][s.opp.stage] || 0
  return Math.round(tot * sc)
}
function runTests(s: State) {
  const R = ROUNDS[s.round - 1]; s.ranTests = true
  const v = R.tests.filter(t => t.visible), p = v.filter(t => t.pass).length
  s.me.stage = Math.max(1, Math.min(3, 1 + Math.floor(3 * p / v.length)))
}
function submit(s: State) {
  if (s.me.submitted) return
  s.me.submitted = true; s.me.stage = 4; s.final = true; s.ranTests = true; s.me.score = mePass(s)
  sys(s.chat, 'YOU SUBMITTED')
  if (!s.opp.joined) {
    s.rounds.push({ round: s.round, me: s.me.score as number, opp: 0 })
    s.screen = 'roundResult'
  } else {
    maybeResolve(s)
  }
}
function maybeResolve(s: State) {
  if (s.screen === 'match' && s.me.submitted && s.opp.submitted) {
    s.opp.score = oppPass(s)
    s.rounds.push({ round: s.round, me: s.me.score as number, opp: s.opp.score })
    sys(s.chat, 'ROUND ' + s.round + ' - YOU ' + s.me.score + ' / ' + s.opp.name + ' ' + s.opp.score)
    s.screen = 'roundResult'
  }
}
function tick(s: State) {
  if (s.screen !== 'match') return
  s.elapsed++
  if (s.elapsed % RECHARGE_SEC === 0) s.energy = Math.min(ENERGY_MAX, s.energy + 1)
  if (!s.opp.submitted && s.opp.connected) {
    s.oppTick++
    if (s.oppTick % 30 === 0) {
      if (s.opp.stage < 4) { s.opp.stage++; sys(s.chat, s.opp.name + ' REACHED STAGE ' + s.opp.stage + '/4') }
      else { s.opp.submitted = true; sys(s.chat, s.opp.name + ' SUBMITTED') }
    }
  }
  maybeResolve(s)
}
export function aiAnswer(q: string) {
  const t = q.toLowerCase()
  if (t.includes('www-authenticate') || t.includes('401')) return 'Send <code>401</code> with <code>WWW-Authenticate: Basic realm="admin"</code> on every rejected request - clients need the challenge to retry.'
  if (t.includes('base64')) return 'Decode after stripping the <code>Basic </code> prefix, then split on the first colon: <code>base64.b64decode(v).split(b":",1)</code>.'
  if (t.includes('json') || t.includes('post')) return 'Read <code>Content-Length</code>, read exactly that many bytes, then parse. Malformed &rarr; <code>400</code>, wrong content-type &rarr; <code>415</code>.'
  if (t.includes('404') || t.includes('route')) return 'Match the request path exactly; anything unknown returns <code>404</code>. Keep routing in one place.'
  return 'Round tip: every bullet in the spec maps to a visible or hidden test. (mock nivix answer)'
}

export function reduce(s0: State, a: Action): State {
  if (a.type === 'RESET') return initial()
  if (a.type === 'REMATCH') { const n = initial(); n.screen = 'lobby'; return n }
  const s: State = structuredClone(s0)
  switch (a.type) {
    case 'BOOT': if (s.bootLine >= 2) s.screen = 'lobby'; else s.bootLine++; break
    case 'SKIP_BOOT': s.screen = 'lobby'; break
    case 'SET_LANG': s.me.lang = a.value as Lang; break
    case 'SET_NAME': s.me.name = a.value as string; break
    case 'LOBBY_TAB': s.lobbyTab = a.value as State['lobbyTab']; break
    case 'CREATE_ROOM': s.role = 'host'; sys(s.chat, 'ROOM ' + s.room.code + ' CREATED'); break
    case 'JOIN_ROOM': s.role = 'guest'; sys(s.chat, 'JOINED ROOM ' + s.room.code); break
    case 'OPP_JOIN': s.opp.joined = true; sys(s.chat, s.opp.name + ' JOINED'); break
    case 'TOGGLE_READY': s.me.ready = !s.me.ready; sys(s.chat, 'YOU ' + (s.me.ready ? 'READY' : 'STOOD DOWN')); break
    case 'OPP_READY': s.opp.ready = true; sys(s.chat, s.opp.name + ' READY'); break
    case 'START': s.screen = 'countdown'; s.countdown = 3; break
    case 'LEAVE': s.role = null; s.screen = 'lobby'; break
    case 'COUNT': s.countdown = Math.max(0, s.countdown - 1); break
    case 'MATCH_BEGIN': startRound(s); break
    case 'TICK': tick(s); break
    case 'TOGGLE_HINTS':
      if (!s.hintsOpen && !s.hintsPaid && s.energy >= COST_HINT) { s.energy -= COST_HINT; s.hintsPaid = true }
      s.hintsOpen = !s.hintsOpen; break
    case 'LEFT_TAB': s.leftTab = a.value as State['leftTab']; break
    case 'ASK':
      if (s.energy < COST_AI) { s.wiki.push({ q: a.value as string, a: 'Not enough energy - ' + s.energy + ' left, ' + COST_AI + ' needed.' }); break }
      s.energy -= COST_AI; s.wiki.push({ q: a.value as string, a: aiAnswer(a.value as string) }); break
    case 'VSCODE': sys(s.chat, 'WORKSPACE OPENED IN VS CODE'); break
    case 'SYS_NOTE': sys(s.chat, a.value as string); break
    case 'RUN_TESTS': runTests(s); break
    case 'TESTS_RESULT': {
      s.ranTests = true
      s.testResults = a.results || []
      s.me.score = s.testResults.filter(t => t.pass).length
      s.me.stage = Math.max(1, Math.min(3, 1 + Math.floor((3 * s.me.score) / Math.max(1, s.testResults.length))))
      break
    }
    case 'SUBMIT': submit(s); break
    case 'NEXT': if (s.round < s.totalRounds) { s.round++; s.screen = 'countdown'; s.countdown = 3 } else { s.screen = 'matchResult' } break
    case 'SEND_CHAT': s.chat.push({ who: s.me.name || 'YOU', text: a.value as string, me: true }); break
    case 'OPP_CHAT': s.chat.push({ who: s.opp.name, text: OPP_LINES[Math.floor(Math.random() * OPP_LINES.length)] }); break
    case 'OPP_STAGE': s.opp.stage = Math.min(4, s.opp.stage + 1); sys(s.chat, s.opp.name + ' STAGE ' + s.opp.stage + '/4'); break
    case 'OPP_SUBMIT': if (!s.opp.submitted) { s.opp.submitted = true; s.opp.stage = 4; sys(s.chat, s.opp.name + ' SUBMITTED'); maybeResolve(s) } break
    case 'TOGGLE_CONN': s.opp.connected = !s.opp.connected; sys(s.chat, s.opp.connected ? s.opp.name + ' RECONNECTED' : s.opp.name + ' DISCONNECTED - RECONNECTING'); break
    case 'SKIP': s.me.name = s.me.name || 'NOVA'; s.role = s.role || 'host'; startRound(s); break
    case 'MOCK_TOGGLE': s.mockOpen = !s.mockOpen; break
  }
  return s
}
