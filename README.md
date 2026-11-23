# Nivix Academy

A local-first, two-player game for learning HTTP & networking. You write a real
HTTP server in **Python**, your friend writes one in **C#**, and you duel through
protocol rounds (routing, Basic auth, JSON bodies...). No cloud, no accounts -
just two machines on the same LAN (or online through a relay).

## Layout

| Path | What it is |
| --- | --- |
| `web/` | React 19 + Vite UI (Cosmic UI, scificn/ui, Arwes NEXT). |
| `agent/` | Local Node agent: serves the UI, supervises your server, judges rounds, opens your editor, relays both peers. |
| `relay/` | Room relay for online play (Node server + Cloudflare Worker). |
| `content/` | Shared lesson content (`lessons.json`) read by the UI and the judge. |
| `prototype/` | Original single-file UX mock (reference). |

## Run it

```bash
# 1. build the UI once
cd web
npm install
npm run build          # emits web/dist, which the agent serves

# 2. start the agent (UI + WS + judge on http://127.0.0.1:7788)
cd ../agent
npm install
npm start
```

Then open **http://127.0.0.1:7788**.

For UI development, run `npm run dev` in `web/` and point the app at the agent
with `VITE_AGENT_URL=http://127.0.0.1:7788`.

## The agent

```
node src/index.mjs [--port 7788] [--workspace DIR] [--ui DIR] [--open | --no-open]
```

- **Serves the UI** and the game WebSocket (`/ws/local`).
- **Supervises your server** - `python server.py` on `:8081`, or `dotnet run` on `:8080`
  (scaffolded into `agent/workspace/` on first run).
- **Judges rounds** - real HTTP probes against your server (`/api/judge`).
- **Opens your editor** - VS Code, Cursor or VSCodium, whichever is installed (`/api/vscode`).
- **Relays two peers** - host creates a room, guest joins over the LAN address
  (`/api/room`, `/api/join`). The host is authoritative.

### HTTP API

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | agent info, LAN address, detected editor, server state |
| `POST /api/vscode` | `{ file? }` - open the workspace (or a file) in the editor |
| `POST /api/server/start` | `{ lang: "python" \| "csharp" }` |
| `POST /api/server/stop` | stop the player's server |
| `POST /api/judge` | `{ round, lang, suite }` - run the round's test suite |
| `POST /api/room` | `{ mode: "single" \| "multi", maxPlayers? }` - host a room |
| `POST /api/join` | `{ host, port, code, name, lang }` - join over the LAN |
| `POST /api/leave` | tear the room down |
| `GET /api/discover?code=` | find a host on the LAN over UDP |
| `GET /api/logs` | recent server output |

### WebSockets

- `/ws/local` - browser to agent. Send `{ t: "join", name, lang }`, `{ t: "action", action }`,
  or `{ t: "ready", value }`; receive `{ t: "room", room }` and `{ t: "action", ... }`.
- Peers connect agent to agent over plain TCP on the LAN (newline-delimited JSON), not HTTP.

### Rooms

The host chooses **single-player** (`mode: "single"`) or a **multiplayer room** with up
to `maxPlayers`. The host agent is authoritative: it owns the member list and relays
actions to every browser and peer agent. Guests mirror the host's room snapshot.

## Multiplayer transports

- **LAN** - the host listens on TCP `:7789` and announces the room over UDP; guests find
  it with `/api/discover` (or enter the IP directly) and connect on the LAN.
- **Online** - both agents connect to the relay in `relay/` (set its URL in Settings).

## Status

- Frontend (full match flow, CRT/sci-fi UI, sound, animation)
- Agent: UI serving, server supervision, judge, editor launch, LAN peer relay, relay rooms
- Frontend networked state sync against the agent
- Phase 3: study material, content pipeline, seasons/replay

## Build a standalone executable

Requirements: Node 22+ and an internet connection (pkg downloads a base Node binary).

```
# 1. build the UI
cd web && npm run build && cd ..

# 2. bundle the agent to a single CommonJS file
cd agent
npx esbuild src/index.mjs --bundle --platform=node --format=cjs --target=node20 `
  --outfile=build/agent.cjs --external:bufferutil --external:utf-8-validate
cd ..

# 3. package the exe (run from the repo root so assets resolve)
node agent/node_modules/@yao-pkg/pkg/lib-es5/bin.js agent/build/agent.cjs `
  -c pkg.config.json --targets node24-win-x64 --fallback-to-source --output dist/NivixAcademy.exe
```

`dist/NivixAcademy.exe` embeds the UI (`web/dist`) and the lesson content
(`content/lessons.json`). On first run it creates `workspace/` and `.nivix/` next to
the exe, serves the app at http://127.0.0.1:7788 and opens it in a dedicated app
window (Edge/Chrome app mode). Pass `--no-open` to skip the window, or
`--ui <dir>` / `--port <n>` to override defaults.