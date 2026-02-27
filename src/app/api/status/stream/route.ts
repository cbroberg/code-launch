import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { statusEmitter } from "@/lib/process-manager";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Send current statuses as initial snapshot
  const snapshot = await db
    .select({ id: apps.id, status: apps.status, pid: apps.pid, port: apps.port })
    .from(apps);

  const encoder = new TextEncoder();

  function sse(data: object) {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  const stream = new ReadableStream({
    start(controller) {
      // Initial snapshot
      for (const row of snapshot) {
        controller.enqueue(sse({ type: "snapshot", appId: row.id, status: row.status, pid: row.pid, port: row.port }));
      }

      function onStatus(data: { appId: number; status: string; pid: number | null }) {
        try {
          controller.enqueue(sse({ type: "update", ...data }));
        } catch { /* closed */ }
      }

      function onPort(data: { appId: number; port: number }) {
        try {
          controller.enqueue(sse({ type: "port", ...data }));
        } catch { /* closed */ }
      }

      statusEmitter.on("status", onStatus);
      statusEmitter.on("port", onPort);

      req.signal.addEventListener("abort", () => {
        statusEmitter.off("status", onStatus);
        statusEmitter.off("port", onPort);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
