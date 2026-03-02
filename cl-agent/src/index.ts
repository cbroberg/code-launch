import WebSocket from "ws";
import { handleCommand } from "./handlers";
import { setEventSender, getManagedApps } from "./process-manager";
import { getScanRoot } from "./scanner";
import type { AgentCommand, AgentEvent } from "./types";

// ---------------------------------------------------------------------------
// Configuration (from environment variables)
// ---------------------------------------------------------------------------

const CL_WEB_URL = process.env.CL_WEB_URL || "ws://localhost:4200/api/agent/ws";
const CL_AGENT_TOKEN = process.env.CL_AGENT_TOKEN || "";
const AGENT_NAME = process.env.AGENT_NAME || require("os").hostname();
const AGENT_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// Reconnect loop with exponential backoff
// ---------------------------------------------------------------------------

let reconnectDelay = 1_000;
const MAX_RECONNECT_DELAY = 30_000;
let pingInterval: ReturnType<typeof setInterval> | null = null;

function connect(): void {
  const url = `${CL_WEB_URL}?token=${encodeURIComponent(CL_AGENT_TOKEN)}`;
  console.log(`[agent] Connecting to ${CL_WEB_URL} …`);

  const ws = new WebSocket(url, {
    handshakeTimeout: 10_000,
  });

  function send(event: AgentEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(event));
    }
  }

  ws.on("open", () => {
    console.log("[agent] Connected");
    reconnectDelay = 1_000; // reset backoff

    // Register event sender for process-manager
    setEventSender(send);

    // Send hello
    const managed = getManagedApps();
    send({
      type: "hello",
      agentId: CL_AGENT_TOKEN.slice(0, 8) || "local",
      name: AGENT_NAME,
      scanRoot: getScanRoot(),
      version: AGENT_VERSION,
      platform: process.platform,
    });

    // If we have managed processes, report their status
    for (const { appId, pid } of managed) {
      send({ type: "status", appId, status: "running", pid });
    }

    // Heartbeat: application-level ping + WS-level ping every 25s
    // (Fly.io drops idle connections after ~75s without activity)
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 25_000);
  });

  ws.on("message", (data: WebSocket.RawData) => {
    let msg: AgentCommand;
    try {
      msg = JSON.parse(data.toString()) as AgentCommand;
    } catch {
      console.warn("[agent] Invalid JSON:", data.toString().slice(0, 100));
      return;
    }

    handleCommand(msg, send).catch((err) => {
      console.error("[agent] Handler error:", err);
    });
  });

  ws.on("close", (code, reason) => {
    console.log(`[agent] Disconnected (${code}: ${reason.toString()})`);
    setEventSender(null);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    // Reconnect with backoff
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
    console.log(`[agent] Reconnecting in ${delay}ms …`);
    setTimeout(connect, delay);
  });

  ws.on("error", (err) => {
    console.error("[agent] WS error:", err.message);
    // close event will fire after error, triggering reconnect
  });
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

console.log(`[agent] CL Agent v${AGENT_VERSION} starting`);
console.log(`[agent] Name: ${AGENT_NAME}`);
console.log(`[agent] Scan root: ${getScanRoot()}`);
console.log(`[agent] Target: ${CL_WEB_URL}`);

connect();

// Keep the process alive
process.on("SIGTERM", () => {
  console.log("[agent] SIGTERM received, shutting down");
  setEventSender(null);
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("[agent] SIGINT received, shutting down");
  setEventSender(null);
  process.exit(0);
});
