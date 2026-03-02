# Code Launcher

A developer platform for managing, starting, and monitoring development projects. Scans `~/Apps/` to discover projects, detects their tech stack, assigns ports, and lets you start/stop/restart them from a web UI — locally or remotely via a deployed web app + Mac daemon.

Runs locally on **port 4200** → [http://localhost:4200](http://localhost:4200)

---

## Features

- **Project discovery** — scans `~/Apps/` and detects framework, runtime, package manager, and dev command
- **Process manager** — start, stop, restart dev servers directly from the UI
- **Live logs** — view stdout/stderr per project in a slide-over panel
- **README preview** — render any project's README.md directly in the app
- **Launch Claude Code** — open an iTerm2/Terminal tab at the project folder and start `claude`
- **Port management** — auto-assigns vacant ports, writes them back to `package.json` / `.env`
- **Build actions** — install, build, or build + start production server
- **Auto-boot** — mark projects to start automatically when Code Launcher starts
- **Auto-start at login** — optionally launch Code Launcher itself when your Mac boots
- **GitHub auth** — secured with GitHub OAuth via NextAuth
- **Remote access** — deploy to Fly.io and control your Mac via `cl-agent` daemon over WebSocket

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (new-york/neutral) |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Auth | NextAuth v4 with GitHub OAuth |
| Process management | Node.js child_process (built-in) |
| Remote agent | `cl-agent` — Node.js daemon with WS connection to web app |
| Deploy | Fly.io (`arn` region) + Docker |

---

## Getting Started (localhost)

```bash
# 1. Install dependencies
npm install

# 2. Copy env template and fill in values
cp .env.example .env.local

# 3. Start dev server on port 4200
npm run dev
```

Then open [http://localhost:4200](http://localhost:4200) — you'll be prompted to sign in with GitHub.

### Required env vars (`.env.local`)

```env
DATABASE_URL=./sqlite.db
NEXTAUTH_SECRET=<openssl rand -hex 32>
NEXTAUTH_URL=http://localhost:4200
GITHUB_ID=<GitHub OAuth App Client ID>
GITHUB_SECRET=<GitHub OAuth App Secret>
AUTH_ALLOWED_USERS=<comma-separated GitHub usernames>
```

Create a GitHub OAuth App at [github.com/settings/developers](https://github.com/settings/developers):

| Field | Value |
|---|---|
| Homepage URL | `http://localhost:4200` |
| Authorization callback URL | `http://localhost:4200/api/auth/callback/github` |

If you also deploy to Fly.io, add a second callback URL on the same OAuth App:
```
https://cl-web.fly.dev/api/auth/callback/github
```

---

## Fly.io Deploy

The web app can be deployed to Fly.io and accessed from anywhere. The `cl-agent` daemon on your Mac connects back via WebSocket and executes commands locally.

```bash
# Create app + volume
fly apps create cl-web
fly volumes create cl_data --app cl-web --region arn --size 1 --yes

# Set secrets
fly secrets set \
  DATABASE_URL=/data/sqlite.db \
  NEXTAUTH_URL=https://cl-web.fly.dev \
  NEXTAUTH_SECRET="$(openssl rand -hex 32)" \
  GITHUB_ID=<your-client-id> \
  GITHUB_SECRET=<your-client-secret> \
  AUTH_ALLOWED_USERS=<your-github-username> \
  CL_AGENT_TOKEN="$(openssl rand -hex 32)" \
  --app cl-web

# Deploy
fly deploy
```

Update your GitHub OAuth App's callback URL to:
```
https://cl-web.fly.dev/api/auth/callback/github
```

---

## cl-agent (Mac daemon)

`cl-agent` is a small Node.js daemon that runs on your Mac and connects to the web app via WebSocket. It handles all OS-specific operations (process management, Docker, filesystem scanning) so the web app can run in the cloud.

### Install as macOS LaunchAgent (auto-start at login)

```bash
cd cl-agent

CL_WEB_URL=wss://cl-web.fly.dev/api/agent/ws \
CL_AGENT_TOKEN=<same token set in fly secrets> \
bash install.sh
```

`install.sh` will build the agent, write a LaunchAgent plist to `~/Library/LaunchAgents/`, and start it immediately.

### Manage

```bash
# View logs
tail -f ~/Library/Logs/cl-agent/stdout.log

# Status
launchctl list com.cbroberg.cl-agent

# Stop
launchctl unload ~/Library/LaunchAgents/com.cbroberg.cl-agent.plist

# Start
launchctl load ~/Library/LaunchAgents/com.cbroberg.cl-agent.plist
```

When `cl-agent` is connected, all project operations (start, stop, scan, docker, etc.) are relayed through it. The web app falls back to direct local execution when no agent is connected (localhost use).

---

## Per-project actions

Each project (card and list row) has visible buttons for the most common actions, and a `⋯` menu for the rest:

**Visible:**
- ▶ Start / ■ Stop / ↺ Restart
- ↗ Open in browser (if port set)
- `>_` View logs
- ♥ Favorite toggle

**In the `⋯` menu:**
- **Launch Claude Code** — opens iTerm2 (or Terminal) at the project folder and runs `claude`
- **Open in VS Code**
- **Open in GitHub**
- **README.md** — renders the project's README in a side panel
- **Auto-boot: on/off** — start this project when Code Launcher starts
- **Install** — runs `npm install` / `pnpm install` / `bun install`
- **Build** — runs `npm run build` / `pnpm build`
- **Build + Run** — build, then start production server
- **Edit** — edit project metadata
- **Delete** — remove from Code Launcher

Build output is streamed to the log viewer in real time.

---

## Auto-start at Mac Login

Code Launcher can automatically start in the background when you log into your Mac.

### Enable (via UI)

1. Open Code Launcher at [http://localhost:4200](http://localhost:4200)
2. Click the **`CL`** avatar button top-right
3. Click **"Auto-start: off"** → it becomes **"Auto-start: on"**

### Disable (manually)

```bash
curl -X POST http://localhost:4200/api/system/autostart \
  -H "Content-Type: application/json" \
  -d '{"action": "uninstall"}'
```

---

## REST API

Base URL: `http://localhost:4200`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/apps` | List all apps |
| `POST` | `/api/apps` | Create app manually |
| `PATCH` | `/api/apps/:id` | Update app |
| `DELETE` | `/api/apps/:id` | Remove app |
| `POST` | `/api/apps/:id/start` | Start dev server |
| `POST` | `/api/apps/:id/stop` | Stop process |
| `POST` | `/api/apps/:id/restart` | Restart process |
| `POST` | `/api/apps/:id/install` | Install dependencies |
| `POST` | `/api/apps/:id/build` | Build (body: `{"thenStart": true}` to also start) |
| `POST` | `/api/apps/:id/launch-cc` | Open project in iTerm2/Terminal with Claude Code |
| `GET` | `/api/apps/:id/readme` | Get project README.md content |
| `GET` | `/api/apps/:id/logs` | Get stored logs |
| `GET` | `/api/apps/:id/logs/stream` | SSE: stream live logs |
| `GET` | `/api/status/stream` | SSE: stream status updates for all apps |
| `GET` | `/api/vacant-port` | Get next available port |
| `POST` | `/api/scan` | Trigger filesystem scan |
| `POST` | `/api/probe` | Check which ports are listening |
| `GET` | `/api/system/autostart` | Check if auto-start LaunchAgent is installed |
| `POST` | `/api/system/autostart` | Install/uninstall auto-start |
| `GET` | `/api/github/orgs` | List GitHub organizations |
| `GET` | `/api/github/repos` | List GitHub repositories |
| `GET` | `/api/fly/apps` | List Fly.io apps |

---

## Database

SQLite file: `./sqlite.db` (local) or `/data/sqlite.db` (Fly.io volume).

```bash
sqlite3 sqlite.db ".tables"
sqlite3 sqlite.db "SELECT name, port, status FROM apps ORDER BY port;"
sqlite3 sqlite.db "SELECT agent_id, name, status, last_seen_at FROM agents;"
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── apps/[id]/
│   │   │   ├── route.ts          # PATCH / DELETE
│   │   │   ├── start/            # POST — relay to cl-agent or local
│   │   │   ├── stop/             # POST
│   │   │   ├── restart/          # POST
│   │   │   ├── install/          # POST
│   │   │   ├── build/            # POST
│   │   │   ├── launch-cc/        # POST — open in Claude Code
│   │   │   ├── readme/           # GET — relay to cl-agent or local fs
│   │   │   └── logs/             # GET + SSE stream
│   │   ├── auth/[...nextauth]/   # NextAuth OAuth handlers
│   │   ├── docker/               # Container list + start/stop
│   │   ├── fly/apps/             # Fly.io app list (GraphQL API)
│   │   ├── github/               # Orgs + repos (REST API)
│   │   ├── scan/                 # Filesystem scan (relay or local)
│   │   ├── probe/                # Port probe (relay or local)
│   │   ├── status/stream/        # SSE all-app status
│   │   ├── vacant-port/          # Next free port
│   │   └── system/autostart/     # LaunchAgent management
│   ├── login/                    # GitHub sign-in page
│   ├── page.tsx                  # Server component (main dashboard)
│   └── providers.tsx
├── components/
│   ├── app-dashboard.tsx         # Client shell (filters, grid/list, actions)
│   ├── app-card.tsx              # Grid card component
│   ├── log-viewer.tsx            # Sheet with live log tail
│   ├── readme-viewer.tsx         # Sheet with rendered README.md
│   ├── new-project-dialog.tsx    # Create GitHub repo + clone
│   └── ui/                       # shadcn primitives
├── drizzle/
│   └── schema.ts                 # apps + process_logs + agents tables
├── lib/
│   ├── auth.ts                   # NextAuth config
│   ├── agent-ws.ts               # Agent registry + WS protocol handler
│   ├── scanner.ts                # Filesystem scanner + port write-back
│   ├── process-manager.ts        # spawn/kill/build/install logic
│   ├── port-utils.ts             # lsof helpers
│   └── git-ops.ts                # git commit port changes
└── proxy.ts                      # Auth guard (Next.js 16 proxy)

cl-agent/                         # Mac daemon
├── src/
│   ├── index.ts                  # WS client + reconnect
│   ├── handlers.ts               # Command dispatcher
│   ├── process-manager.ts        # OS process control
│   ├── scanner.ts                # Filesystem scanner
│   ├── port-utils.ts             # Port detection
│   ├── git-ops.ts                # Git operations
│   └── types.ts                  # Shared WS protocol types
└── install.sh                    # macOS LaunchAgent installer

server.ts                         # Custom HTTP server (Next.js + WebSocket)
Dockerfile                        # Multi-stage Node 22 Alpine build
fly.toml                          # Fly.io config (region: arn)
```
