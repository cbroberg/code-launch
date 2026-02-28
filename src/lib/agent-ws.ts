import WebSocket from "ws";
import type { IncomingMessage } from "http";
import crypto from "crypto";
import { parse } from "url";
import { db } from "@/drizzle";
import { agents, apps, processLogs } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { statusEmitter, logEmitter } from "@/lib/process-manager";

// ---------------------------------------------------------------------------
// Global state — survives Next.js HMR
// ---------------------------------------------------------------------------

const g = globalThis as typeof globalThis & {
  __agentConnections?: Map<string, AgentConn>;
};

if (!g.__agentConnections) g.__agentConnections = new Map();

export const agentConnections: Map<string, AgentConn> = g.__agentConnections;

interface AgentConn {
  ws: WebSocket;
  agentId: string;
  name: string;
  platform: string;
  version: string;
  scanRoot: string;
  /** Pending request resolvers keyed by requestId */
  pending: Map<string, (ev: AgentEvent) => void>;
}

// ---------------------------------------------------------------------------
// Protocol types (mirrors cl-agent/src/types.ts)
// ---------------------------------------------------------------------------

export interface AppConfig {
  id: number;
  name: string;
  localPath: string;
  devCommand: string | null;
  port: number | null;
  packageManager: string | null;
}

export interface ProbeableApp {
  id: number;
  name: string;
  port: number | null;
  pid: number | null;
  localPath: string | null;
  devCommand: string | null;
  packageManager: string | null;
}

export interface ProbeResult {
  appId: number;
  status: "running" | "stopped";
  pid: number | null;
}

export interface ScannedApp {
  name: string;
  localPath: string;
  port: number | null;
  githubName: string | null;
  githubUrl: string | null;
  packageManager: string | null;
  framework: string | null;
  runtime: string | null;
  devCommand: string | null;
  projectType: string | null;
}

export interface DockerContainer {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageName: string;
  state: string;
  status: string;
  runningFor: string;
  ports: Array<{ hostPort: number; containerPort: number; protocol: string }>;
  isKubernetes: boolean;
  isMcp: boolean;
}

export type AgentCommand =
  | { type: "ping" }
  | { type: "start"; requestId: string; app: AppConfig }
  | { type: "stop"; requestId: string; app: AppConfig }
  | { type: "restart"; requestId: string; app: AppConfig }
  | { type: "install"; requestId: string; app: AppConfig; force?: boolean }
  | { type: "build"; requestId: string; app: AppConfig; thenStart?: boolean }
  | { type: "scan"; requestId: string }
  | { type: "probe"; requestId: string; apps: ProbeableApp[] }
  | { type: "reconcile"; requestId: string; runningApps: ProbeableApp[] }
  | { type: "readFile"; requestId: string; path: string }
  | { type: "docker:list"; requestId: string }
  | { type: "docker:start"; requestId: string; containerId: string }
  | { type: "docker:stop"; requestId: string; containerId: string }
  | { type: "launchTerminal"; requestId: string; path: string }
  | { type: "vacantPort"; requestId: string; usedPorts?: number[] };

export type AgentEvent =
  | { type: "pong" }
  | { type: "hello"; agentId: string; name: string; scanRoot: string; version: string; platform: string }
  | { type: "log"; appId: number; stream: "stdout" | "stderr" | "system"; message: string; createdAt: string }
  | { type: "status"; appId: number; status: string; pid: number | null }
  | { type: "port"; appId: number; port: number }
  | { type: "ack"; requestId: string; ok: boolean; error?: string }
  | { type: "scanResult"; requestId: string; apps: ScannedApp[] }
  | { type: "probeResult"; requestId: string; results: ProbeResult[] }
  | { type: "reconcileResult"; requestId: string; statuses: ProbeResult[] }
  | { type: "fileContent"; requestId: string; content: string }
  | { type: "docker:containers"; requestId: string; containers: DockerContainer[] }
  | { type: "vacantPort"; requestId: string; port: number };

// ---------------------------------------------------------------------------
// Token validation
// ---------------------------------------------------------------------------

function validateToken(provided: string): boolean {
  const expected = process.env.CL_AGENT_TOKEN ?? "";
  if (!expected || !provided) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event handler — translates agent events into DB updates + emitter signals
// ---------------------------------------------------------------------------

async function handleEvent(conn: AgentConn, event: AgentEvent): Promise<void> {
  const now = new Date().toISOString();

  switch (event.type) {
    case "pong":
      // Heartbeat — update lastSeenAt
      await db
        .update(agents)
        .set({ lastSeenAt: now, updatedAt: now })
        .where(eq(agents.agentId, conn.agentId));
      break;

    case "hello":
      // Upsert agent record
      await db
        .insert(agents)
        .values({
          agentId: event.agentId,
          name: event.name,
          platform: event.platform,
          version: event.version,
          scanRoot: event.scanRoot,
          status: "online",
          connectedAt: now,
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: agents.agentId,
          set: {
            name: event.name,
            platform: event.platform,
            version: event.version,
            scanRoot: event.scanRoot,
            status: "online",
            connectedAt: now,
            lastSeenAt: now,
            updatedAt: now,
          },
        });
      break;

    case "status":
      await db
        .update(apps)
        .set({ status: event.status, pid: event.pid, updatedAt: now })
        .where(eq(apps.id, event.appId));
      statusEmitter.emit("status", { appId: event.appId, status: event.status, pid: event.pid });
      break;

    case "port":
      await db
        .update(apps)
        .set({ port: event.port, updatedAt: now })
        .where(eq(apps.id, event.appId));
      statusEmitter.emit("port", { appId: event.appId, port: event.port });
      break;

    case "log":
      await db.insert(processLogs).values({
        appId: event.appId,
        stream: event.stream,
        message: event.message,
        createdAt: event.createdAt,
      });
      logEmitter.emit(`log:${event.appId}`, {
        stream: event.stream,
        message: event.message,
        createdAt: event.createdAt,
      });
      break;

    default:
      // ack, scanResult, probeResult, reconcileResult, fileContent, docker:containers, vacantPort
      if ("requestId" in event) {
        const resolve = conn.pending.get(event.requestId);
        if (resolve) {
          conn.pending.delete(event.requestId);
          resolve(event);
        }
      }
  }
}

// ---------------------------------------------------------------------------
// Public: handle a new WebSocket upgrade from the HTTP server
// ---------------------------------------------------------------------------

export function handleAgentConnection(ws: WebSocket, req: IncomingMessage): void {
  const { query } = parse(req.url ?? "", true);
  const token = Array.isArray(query.token) ? query.token[0] : (query.token ?? "");

  if (!validateToken(token)) {
    ws.close(4001, "Unauthorized");
    return;
  }

  const conn: AgentConn = {
    ws,
    agentId: "unknown",
    name: "unknown",
    platform: "unknown",
    version: "unknown",
    scanRoot: "",
    pending: new Map(),
  };

  ws.on("message", (data: WebSocket.RawData) => {
    let event: AgentEvent;
    try {
      event = JSON.parse(data.toString()) as AgentEvent;
    } catch {
      console.warn("[agent-ws] Non-JSON message from agent");
      return;
    }

    // Update conn identity on hello before handing off to handleEvent
    if (event.type === "hello") {
      conn.agentId = event.agentId;
      conn.name = event.name;
      conn.platform = event.platform;
      conn.version = event.version;
      conn.scanRoot = event.scanRoot;
      agentConnections.set(conn.agentId, conn);
      console.log(`[agent-ws] "${conn.name}" (${conn.agentId}) connected`);
    }

    handleEvent(conn, event).catch((err) =>
      console.error("[agent-ws] Event handler error:", err)
    );
  });

  ws.on("close", () => {
    agentConnections.delete(conn.agentId);
    console.log(`[agent-ws] "${conn.name}" (${conn.agentId}) disconnected`);
    const now = new Date().toISOString();
    db.update(agents)
      .set({ status: "offline", lastSeenAt: now, updatedAt: now })
      .where(eq(agents.agentId, conn.agentId))
      .catch(console.error);
  });

  ws.on("error", (err) => {
    console.error(`[agent-ws] Error from "${conn.name}":`, err.message);
  });
}

// ---------------------------------------------------------------------------
// Public: send commands to the connected agent
// ---------------------------------------------------------------------------

/** Returns the first connected agent, or null if none. */
export function getAgent(): AgentConn | null {
  for (const conn of agentConnections.values()) return conn;
  return null;
}

/** Returns true if at least one agent is connected. */
export function hasAgent(): boolean {
  return agentConnections.size > 0;
}

/** Sends a command to the connected agent and resolves with the response event. */
export function sendCommand(
  cmd: AgentCommand & { requestId: string },
  timeoutMs = 30_000
): Promise<AgentEvent> {
  return new Promise((resolve, reject) => {
    const agent = getAgent();
    if (!agent || agent.ws.readyState !== WebSocket.OPEN) {
      return reject(new Error("No agent connected"));
    }

    const timer = setTimeout(() => {
      agent.pending.delete(cmd.requestId);
      reject(new Error(`Agent command timed out: ${cmd.type}`));
    }, timeoutMs);

    agent.pending.set(cmd.requestId, (ev) => {
      clearTimeout(timer);
      resolve(ev);
    });

    agent.ws.send(JSON.stringify(cmd));
  });
}

/** Fire-and-forget: sends a command without waiting for a response. */
export function sendToAgent(cmd: AgentCommand): void {
  const agent = getAgent();
  if (!agent || agent.ws.readyState !== WebSocket.OPEN) return;
  agent.ws.send(JSON.stringify(cmd));
}

/** Converts a DB app record to the AppConfig shape expected by the agent. */
export function toAppConfig(app: {
  id: number;
  name: string;
  localPath: string | null;
  devCommand: string | null;
  port: number | null;
  packageManager: string | null;
}): AppConfig {
  return {
    id: app.id,
    name: app.name,
    localPath: app.localPath ?? "",
    devCommand: app.devCommand,
    port: app.port,
    packageManager: app.packageManager,
  };
}
