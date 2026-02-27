# Code Launcher

A local developer platform for managing, starting, and monitoring development projects. Scans `~/Apps/` to discover projects, detects their tech stack, assigns ports, and lets you start/stop/restart them from a web UI.

Runs on **port 4200** → [http://localhost:4200](http://localhost:4200)

---

## Features

- **Project discovery** — scans `~/Apps/` and detects framework, runtime, package manager, and dev command
- **Process manager** — start, stop, restart dev servers directly from the UI
- **Live logs** — view stdout/stderr per project
- **Port management** — auto-assigns vacant ports, writes them back to `package.json` / `.env`
- **Build actions** — install deps, build, or build + start production server
- **Auto-boot** — mark projects to start automatically when Code Launcher starts
- **Auto-start at login** — optionally launch Code Launcher itself when your Mac boots

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Styling | Tailwind CSS + shadcn/ui (new-york/neutral) |
| Database | SQLite via better-sqlite3 + Drizzle ORM |
| Process management | Node.js child_process (built-in) |

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start dev server on port 4200
npm run dev
```

Open [http://localhost:4200](http://localhost:4200), then click **Scan** to discover your projects.

---

## Auto-start at Mac Login

Code Launcher can automatically start in the background when you log into your Mac. Once running, open [http://localhost:4200](http://localhost:4200) to see all your managed projects.

### Enable auto-start (via UI)

1. Open Code Launcher at [http://localhost:4200](http://localhost:4200)
2. Click the **"Auto-start off"** button in the top-right toolbar
3. It turns into **"Auto-start on"** — Code Launcher will launch automatically at **next login** (not immediately, to avoid conflicts with the currently running instance)

### Enable auto-start (manually)

```bash
# The button in the UI calls this API endpoint:
curl -X POST http://localhost:4200/api/system/autostart \
  -H "Content-Type: application/json" \
  -d '{"action": "install"}'
```

This creates a macOS LaunchAgent at:
```
~/Library/LaunchAgents/com.cbroberg.code-launcher.plist
```

Inspect it:
```bash
cat ~/Library/LaunchAgents/com.cbroberg.code-launcher.plist
```

Logs are written to:
```
~/Library/Logs/code-launcher/stdout.log
~/Library/Logs/code-launcher/stderr.log
```

### Disable auto-start (via UI)

1. Click the **"Auto-start on"** button in the toolbar
2. It toggles back to **"Auto-start off"** — the LaunchAgent is unloaded and removed

### Disable auto-start (manually)

```bash
# Via the API:
curl -X POST http://localhost:4200/api/system/autostart \
  -H "Content-Type: application/json" \
  -d '{"action": "uninstall"}'

# Or directly via launchctl:
launchctl unload ~/Library/LaunchAgents/com.cbroberg.code-launcher.plist
rm ~/Library/LaunchAgents/com.cbroberg.code-launcher.plist
```

---

## Build Actions

Each project card and list row has a **hammer icon** with a dropdown:

| Action | Command run |
|---|---|
| **Install deps** | `npm install` / `pnpm install` / `bun install` |
| **Build** | `npm run build` / `pnpm build` |
| **Build + Run** | Build, then start production server (`npm start`) |

Build output is streamed to the project's log viewer in real time.

---

## REST API

Base URL: `http://localhost:4200`

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/apps` | List all apps |
| `POST` | `/api/apps` | Create app manually |
| `PATCH` | `/api/apps/:id` | Update app (port write-back) |
| `DELETE` | `/api/apps/:id` | Remove app |
| `POST` | `/api/apps/:id/start` | Start dev server |
| `POST` | `/api/apps/:id/stop` | Stop process |
| `POST` | `/api/apps/:id/restart` | Restart process |
| `POST` | `/api/apps/:id/install` | Install dependencies |
| `POST` | `/api/apps/:id/build` | Build (body: `{"thenStart": true}` to also start) |
| `GET` | `/api/apps/:id/logs` | Get stored logs |
| `GET` | `/api/apps/:id/logs/stream` | SSE: stream live logs |
| `GET` | `/api/status/stream` | SSE: stream status updates for all apps |
| `GET` | `/api/vacant-port` | Get next available port |
| `POST` | `/api/scan` | Trigger filesystem scan |
| `POST` | `/api/probe` | Check which ports are listening |
| `GET` | `/api/system/autostart` | Check if auto-start LaunchAgent is installed |
| `POST` | `/api/system/autostart` | Install/uninstall auto-start (body: `{"action": "install" \| "uninstall"}`) |

---

## Database

SQLite file: `./sqlite.db` (gitignored).

Direct inspection:

```bash
sqlite3 sqlite.db ".tables"
sqlite3 sqlite.db "SELECT name, port, status FROM apps ORDER BY port;"
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── apps/[id]/
│   │   │   ├── route.ts       # PATCH / DELETE
│   │   │   ├── start/         # POST start
│   │   │   ├── stop/          # POST stop
│   │   │   ├── restart/       # POST restart
│   │   │   ├── install/       # POST install deps
│   │   │   ├── build/         # POST build (+ optional start)
│   │   │   └── logs/          # GET logs + SSE stream
│   │   ├── scan/              # POST filesystem scan
│   │   ├── probe/             # POST port probe
│   │   ├── status/stream/     # SSE all-app status
│   │   ├── vacant-port/       # GET next free port
│   │   └── system/autostart/  # GET/POST LaunchAgent management
│   ├── page.tsx               # Server component (main dashboard)
│   └── providers.tsx
├── components/
│   ├── app-dashboard.tsx      # Client shell (filters, grid/list, actions)
│   ├── app-card.tsx           # Grid card component
│   ├── log-viewer.tsx         # Sheet with live log tail
│   ├── new-project-dialog.tsx # Create GitHub repo + clone
│   └── ui/                    # shadcn primitives
├── drizzle/
│   └── schema.ts              # apps + process_logs tables
└── lib/
    ├── scanner.ts             # Filesystem scanner + port write-back
    ├── process-manager.ts     # spawn/kill/build/install logic
    ├── port-utils.ts          # lsof helpers
    └── git-ops.ts             # git commit port changes
```
