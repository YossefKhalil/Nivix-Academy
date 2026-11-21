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
| `POST /api/room` | create a room code (host) |
| `POST /api/join` | `{ host, port, code }` — join a host over LAN/ZeroTier |
| `GET /api/logs` | recent server output |

### WebSockets

- `/ws/local` — browser ⇄ agent. The agent relays messages to the peer and wraps
  incoming peer messages as `{ t: "peer", msg }`.
- `/ws/peer?room=CODE` — agent ⇄ agent.

## ZeroTier

Join both machines to the same ZeroTier network. The agent auto-detects the
ZeroTier interface, shows its address in `/api/status`, and binds `0.0.0.0` so
the other peer can reach `ws://<zerotier-ip>:7788` — no relay, no port
forwarding. ZT handles NAT traversal and encryption.

## Status

- ✅ Frontend (full match flow, CRT/sci-fi UI, sound, animation)
- ✅ Agent: UI serving, server supervision, judge (rounds 1–2), editor launch, ZeroTier detection, peer relay
- ⏳ Frontend networked state sync against the agent
- ⏳ Phase 3: study material, content pipeline, seasons/replay