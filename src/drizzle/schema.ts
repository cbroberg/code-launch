import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const apps = sqliteTable("apps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  githubName: text("github_name"),
  githubUrl: text("github_url"),
  port: integer("port").unique(),
  localPath: text("local_path"),
  // Tech stack metadata
  packageManager: text("package_manager"), // "npm" | "pnpm" | "bun" | "yarn"
  framework: text("framework"), // "nextjs" | "hono" | "express" | "vite" | "remix" | "sveltekit" | "astro"
  runtime: text("runtime"), // "node" | "bun" | "deno"
  devCommand: text("dev_command"),
  projectType: text("project_type"), // "web-app" | "api-server" | "monorepo" | "library" | "docker" | "batch"
  // Process management
  favorite: integer("favorite", { mode: "boolean" }).default(false),
  autoBoot: integer("auto_boot", { mode: "boolean" }).default(false),
  manualStop: integer("manual_stop", { mode: "boolean" }).default(false),
  status: text("status").default("stopped"), // "stopped" | "starting" | "running" | "error"
  pid: integer("pid"),
  lastStartedAt: text("last_started_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
  updatedAt: text("updated_at").notNull().default(new Date().toISOString()),
});

export const processLogs = sqliteTable("process_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  appId: integer("app_id")
    .notNull()
    .references(() => apps.id, { onDelete: "cascade" }),
  stream: text("stream").notNull(), // "stdout" | "stderr" | "system"
  message: text("message").notNull(),
  createdAt: text("created_at").notNull().default(new Date().toISOString()),
});

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull().unique(), // first 8 chars of token (human-readable id)
  name: text("name").notNull(), // hostname
  platform: text("platform"),
  version: text("version"),
  scanRoot: text("scan_root"),
  status: text("status").notNull().default("offline"), // "online" | "offline"
  connectedAt: text("connected_at"),
  lastSeenAt: text("last_seen_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type App = typeof apps.$inferSelect;
export type NewApp = typeof apps.$inferInsert;
export type ProcessLog = typeof processLogs.$inferSelect;
export type Agent = typeof agents.$inferSelect;
