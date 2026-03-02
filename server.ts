/**
 * Custom HTTP server that wraps Next.js and adds WebSocket support for the
 * CL Agent protocol at /api/agent/ws.
 *
 * Dev:        npm run dev   → tsx server.ts
 * Production: npm start     → node server.js  (after next build + tsc/tsx compile)
 */

import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";

const port = parseInt(process.env.PORT || "4200", 10);
const dev = process.env.NODE_ENV !== "production";

async function main() {
  const app = next({ dev });
  const handle = app.getRequestHandler();

  await app.prepare();

  // Import agent WS handler after Next.js is prepared (so @/ aliases resolve)
  const { handleAgentConnection } = await import("./src/lib/agent-ws");

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "");
    if (pathname === "/api/agent/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleAgentConnection(ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost";
  server.listen(port, host, () => {
    console.log(`> Ready on http://${host}:${port}`);
  });
}

main().catch((err) => {
  console.error("Server startup error:", err);
  process.exit(1);
});
