import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(process.env.DATABASE_URL || "./sqlite.db");

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Auto-create tables if they don't exist (handles fresh volumes on Fly.io)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS apps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    github_name TEXT,
    github_url TEXT,
    port INTEGER UNIQUE,
    local_path TEXT,
    package_manager TEXT,
    framework TEXT,
    runtime TEXT,
    dev_command TEXT,
    project_type TEXT,
    favorite INTEGER DEFAULT 0,
    auto_boot INTEGER DEFAULT 0,
    status TEXT DEFAULT 'stopped',
    pid INTEGER,
    last_started_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS process_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    platform TEXT,
    version TEXT,
    scan_root TEXT,
    status TEXT NOT NULL DEFAULT 'offline',
    connected_at TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

export const db = drizzle(sqlite, { schema });
