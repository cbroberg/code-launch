# App Ports DB

A local developer tool that scans your `~/Apps/` directory for development projects, detects which ports they use, and stores them in a SQLite database. It exposes a web UI for managing the registry and a REST API so external tools can programmatically request a vacant port number.

Runs on **port 4200**.

---

## Table of Contents

- [Why](#why)
- [Stack](#stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Using the UI](#using-the-ui)
- [REST API](#rest-api)
- [Scanner Behaviour](#scanner-behaviour)
- [Port Write-Back](#port-write-back)
- [Database](#database)
- [Project Structure](#project-structure)

---

## Why

When you have dozens of local projects each running on a different dev server, port collisions become a constant annoyance. This tool maintains a single source of truth:

- Know at a glance which ports are taken.
- Ask the API for the next free port before starting a new project.
- Edit port assignments and have the change written back to `package.json` / `.env` / `docker-compose.yml` automatically.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui (new-york) |
| Database | SQLite via **better-sqlite3** |
| ORM | Drizzle ORM |
| Validation | Zod |

---

## Prerequisites

- Node.js 20+
- npm 9+

---

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Push the database schema (creates sqlite.db)
npm run db:push

# 3. Start the dev server on port 4200
npm run dev
```

Open [http://localhost:4200](http://localhost:4200).

On first launch the database is empty. Click **Scan Apps** to populate it automatically.

---

## Using the UI

### Dashboard

The main page shows three stat cards at the top:

| Card | Meaning |
|---|---|
| **Total Apps** | All apps in the registry |
| **With Port** | Apps that have a port assigned |
| **On GitHub** | Apps where a GitHub remote was detected |

The **Next available** badge (top right) shows the lowest port >= 3000 not currently in the database. It updates live without a page reload.

---

### Scanning for Projects

Click **Scan Apps** to run the filesystem scanner. It walks `/Users/cb/Apps/` up to 3 directories deep and upserts any project it finds into the database.

A toast notification reports the result:

> *"Scan complete: 5 added, 12 updated (34 discovered)"*

The scan preserves manually assigned ports — it only fills the port field when it is currently empty.

---

### Filtering the Table

The table defaults to **showing only apps with a port assigned**, hiding unidentified projects to keep the view focused.

Use the **Filter** button above the table to toggle between:

- **Showing with port only** — the default; hides apps with no port.
- **Show all** — includes every app in the registry.

A counter shows how many apps are currently hidden.

---

### Editing an App

Click the pencil icon on any row to open the **Edit App** dialog. You can update:

| Field | Notes |
|---|---|
| **Name** | Display name |
| **Port** | Leave empty to unassign the port |
| **GitHub (owner/repo)** | e.g. `cbroberg/my-app` |
| **Local Path** | Absolute path on disk |

After saving, the DB is updated. If the port changed **and** the app has a `localPath`, the new port is also written back to the project files on disk (see [Port Write-Back](#port-write-back)).

The toast confirms exactly what happened:

> *"App updated — also wrote package.json on disk"*

---

### Deleting an App

Click the trash icon on any row. A confirmation prompt appears before the record is removed.

---

## REST API

The API is also documented as a static OpenAPI 3.1 spec at:

```
http://localhost:4200/openapi.yaml
```

### Endpoints

#### `GET /api/apps`

Returns all apps ordered by port number.

```bash
curl http://localhost:4200/api/apps
```

```json
[
  {
    "id": 1,
    "name": "senti-messages",
    "githubName": "cbroberg/senti-messages",
    "githubUrl": "https://github.com/cbroberg/senti-messages",
    "port": 3000,
    "localPath": "/Users/cb/Apps/cbroberg/senti-messages",
    "createdAt": "2026-02-19T20:00:00.000Z",
    "updatedAt": "2026-02-19T20:00:00.000Z"
  }
]
```

---

#### `POST /api/apps`

Create a new app manually.

```bash
curl -X POST http://localhost:4200/api/apps \
  -H "Content-Type: application/json" \
  -d '{ "name": "my-new-app", "port": 3100 }'
```

**Body** (all fields except `name` are optional):

```json
{
  "name": "my-new-app",
  "port": 3100,
  "githubName": "cbroberg/my-new-app",
  "githubUrl": "https://github.com/cbroberg/my-new-app",
  "localPath": "/Users/cb/Apps/cbroberg/my-new-app"
}
```

Returns `201` with the created record, or `409` if the port is already taken.

---

#### `PATCH /api/apps/:id`

Update any fields on an existing app. Only include the fields you want to change.

```bash
curl -X PATCH http://localhost:4200/api/apps/1 \
  -H "Content-Type: application/json" \
  -d '{ "port": 3001 }'
```

Returns the updated record plus a `writtenFiles` array listing any project config files that were updated on disk:

```json
{
  "id": 1,
  "name": "senti-messages",
  "port": 3001,
  "writtenFiles": ["package.json"]
}
```

Returns `409` if the target port is already taken by another app.

---

#### `DELETE /api/apps/:id`

Remove an app from the registry (does not touch any files on disk).

```bash
curl -X DELETE http://localhost:4200/api/apps/1
```

```json
{ "ok": true }
```

---

#### `GET /api/vacant-port`

Returns the first port >= 3000 that is not assigned to any app in the database. Use this before bootstrapping a new project.

```bash
curl http://localhost:4200/api/vacant-port
```

```json
{ "port": 3002 }
```

**Typical usage in a new project setup script:**

```bash
PORT=$(curl -s http://localhost:4200/api/vacant-port | python3 -c "import sys,json; print(json.load(sys.stdin)['port'])")
echo "Starting on port $PORT"
```

---

#### `POST /api/scan`

Trigger the filesystem scanner manually (same as clicking **Scan Apps** in the UI).

```bash
curl -X POST http://localhost:4200/api/scan
```

```json
{
  "discovered": 34,
  "inserted": 2,
  "updated": 12
}
```

| Field | Meaning |
|---|---|
| `discovered` | Total projects found on disk |
| `inserted` | New rows added to the database |
| `updated` | Existing rows refreshed |

---

## Scanner Behaviour

The scanner walks `/Users/cb/Apps/` with a max depth of 3. A directory is treated as a **project root** when it contains a `package.json` or `docker-compose.yml`.

The scanner stops descending when it hits a project root, so nested `node_modules` and similar directories are never traversed.

### Port Detection (priority order)

1. `--port NUMBER` in any `package.json` script value
2. `PORT=NUMBER` at the start of a line in `.env`, `.env.local`, or `.env.development`
3. First host port in a `docker-compose.yml` port mapping (e.g. `"3000:8080"`)

### GitHub Detection

Reads `.git/config` and matches the remote origin URL in both formats:

- HTTPS: `https://github.com/owner/repo.git`
- SSH: `git@github.com:owner/repo.git`

### Upsert Key

The stable natural key is `localPath`. If a record with the same path already exists, the scanner updates its name and GitHub fields, and fills the port only if it is currently `null` (manual assignments are never overwritten by a scan).

### Ignored Directories

`node_modules`, `.git`, `.next`, `dist`, `build`, `.cache`, `coverage`, `__pycache__`, `.venv`, `vendor`

---

## Port Write-Back

When you edit an app's port in the UI (or via `PATCH /api/apps/:id`), and the app has a `localPath`, the new port is written back to the project's own config files — the same files the scanner reads from.

The write-back checks each mechanism in order and updates the **first match** it finds:

| File | Pattern replaced |
|---|---|
| `package.json` | `--port 3000` in any script |
| `.env` / `.env.local` / `.env.development` | `PORT=3000` line |
| `docker-compose.yml` / `.yaml` | Host side of first port mapping |

If none of these files contain a recognisable port pattern, only the database is updated and `writtenFiles` is returned as an empty array.

---

## Database

SQLite database file: `./sqlite.db` (gitignored).

### Schema

```sql
CREATE TABLE apps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  github_name TEXT,
  github_url  TEXT,
  port        INTEGER UNIQUE,
  local_path  TEXT,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
```

### Commands

```bash
# Push schema changes to the database
npm run db:push

# Open Drizzle Studio (browser-based DB viewer)
npm run db:studio
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   ├── apps/
│   │   │   ├── route.ts          # GET list, POST create
│   │   │   └── [id]/route.ts     # PATCH update, DELETE + port write-back
│   │   ├── vacant-port/route.ts  # GET first free port >= 3000
│   │   └── scan/route.ts         # POST trigger filesystem scan
│   ├── globals.css
│   ├── layout.tsx
│   ├── page.tsx                  # Server component — main dashboard
│   └── providers.tsx             # ThemeProvider + Toaster
├── components/
│   ├── ui/                       # shadcn primitives
│   ├── apps-table.tsx            # Table with filter, edit, delete
│   ├── edit-app-dialog.tsx       # Edit modal with port write-back toast
│   ├── scan-button.tsx           # Triggers POST /api/scan
│   └── vacant-port-badge.tsx     # Live next-available port badge
├── drizzle/
│   ├── index.ts                  # DB singleton (WAL mode)
│   └── schema.ts                 # apps table definition
└── lib/
    ├── scanner.ts                # Filesystem scanner + writePortToApp()
    ├── utils.ts                  # cn() helper
    └── validations.ts            # Zod schemas
public/
└── openapi.yaml                  # OpenAPI 3.1 spec (served statically)
```
