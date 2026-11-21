# Nivix Academy — HTTP DUEL

A local-first, two-player game for learning HTTP & networking. You write a real
HTTP server in **Python**, your friend writes one in **C#**, and you duel through
protocol rounds (routing, Basic auth, JSON bodies…). No cloud, no accounts —
just two machines (same LAN or a ZeroTier network).

## Layout

| Path | What it is |
| --- | --- |
| `web/` | React 19 + Vite UI (Cosmic UI, scificn/ui, Arwes NEXT). |
| `agent/` | Local Node agent: serves the UI, supervises your server, judges rounds, opens your editor, relays both peers. |
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
node src/index.mjs [--port 7788] [--workspace DIR] [--ui DIR] [--open]
```

- **Serves the UI** and the game WebSocket (`/ws/local`).
- **Supervises your server** — `python server.py` on `:8081`, or `dotnet run` on `:8080`
  (scaffolded into `agent/workspace/` on first run).
- **Judges rounds** — real HTTP probes against your server (`/api/judge`).
- **Opens your editor** — VS Code, Cursor or VSCodium, whichever is installed (`/api/vscode`).
- **Relays two peers** — host creates a room, guest joins over the LAN/ZeroTier address
  (`/api/room`, `/api/join`). The host is authoritative.

### HTTP API

| Method & path | Purpose |
| --- | --- |
| `GET /api/status` | agent info, ZeroTier/LAN address, detected editor, server state |
| `POST /api/vscode` | `{ file? }` — open the workspace (or a file) in the editor |
| `POST /api/server/start` | `{ lang: "python" \| "csharp" }` |
| `POST /api/server/stop` | stop the player's server |
| `POST /api/judge` | `{ round, lang }` — run the round's test suite |
| `POST /api/room` | `{ mode: "single" \| "multi", network?, maxPlayers? }` — host a room |
| `POST /api/join` | `{ network?, host, port, code, name, lang }` — join over libzt/LAN |
| `POST /api/leave` | tear the room down |
| `GET /api/logs` | recent server output |

### WebSockets

- `/ws/local` — browser ⇄ agent. Send `{ t: "join", name, lang }`, `{ t: "action", action }`,
  or `{ t: "ready", value }`; receive `{ t: "room", room }` and `{ t: "action", … }`.
- Peers connect agent ⇄ agent over the **libzt** transport (newline-JSON TCP), not HTTP.

### Rooms

The host chooses **single-player** (`mode: "single"`) or a **multiplayer room** with up
to `maxPlayers`. The host agent is authoritative: it owns the member list and relays
actions to every browser and peer agent. Guests mirror the host's room snapshot.

## ZeroTier (libzt)

Both agents join the same ZeroTier network in **userspace** via `libzt` — no system
ZeroTier install, no admin, no virtual adapter. The host listens for peers on the
libzt socket; guests dial the host's libzt address. If libzt is unavailable the
transport falls back to plain TCP on the LAN.

## Status

- ✅ Frontend (full match flow, CRT/sci-fi UI, sound, animation)
- ✅ Agent: UI serving, server supervision, judge (rounds 1–2), editor launch, ZeroTier detection, peer relay
- ⏳ Frontend networked state sync against the agent
- ⏳ Phase 3: study material, content pipeline, seasons/replay