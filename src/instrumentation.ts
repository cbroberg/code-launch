export async function register() {
  // Only run in the Node.js runtime (not edge)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { reconcileProcesses, startProcess } = await import("@/lib/process-manager");
  const { db } = await import("@/drizzle");
  const { apps } = await import("@/drizzle/schema");
  const { eq, and } = await import("drizzle-orm");
  const { getSystemListeningPorts } = await import("@/lib/port-utils");

  // Mark dead "running" entries as stopped
  await reconcileProcesses();

  // Snapshot of ports already in use (includes this server's own port)
  const listening = getSystemListeningPorts();

  // Our own port — we're the server, so we know we're running
  const ownPort = parseInt(process.env.PORT || "4200", 10);

  // Start all autoBoot apps that have a devCommand
  const bootApps = await db
    .select()
    .from(apps)
    .where(and(eq(apps.autoBoot, true)));

  for (const app of bootApps) {
    if (!app.devCommand || !app.localPath) continue;

    if (app.port && listening.has(app.port)) {
      // Own port: server is us, mark running immediately (HTTP not available yet)
      if (app.port === ownPort) {
        await db
          .update(apps)
          .set({ status: "running", updatedAt: new Date().toISOString() })
          .where(eq(apps.id, app.id));
        console.log(`[auto-boot] "${app.name}" is this server — marked running`);
        continue;
      }

      // Other ports: HTTP-verify to avoid false positives
      let up = false;
      try {
        await fetch(`http://127.0.0.1:${app.port}/`, {
          signal: AbortSignal.timeout(2500),
          redirect: "manual",
        });
        up = true;
      } catch { /* not responding */ }

      if (up) {
        await db
          .update(apps)
          .set({ status: "running", updatedAt: new Date().toISOString() })
          .where(eq(apps.id, app.id));
        console.log(`[auto-boot] "${app.name}" verified on port ${app.port} — marked running`);
      } else {
        console.log(`[auto-boot] "${app.name}" port ${app.port} not responding — starting fresh`);
        // Fall through to startProcess below
        await new Promise(r => setTimeout(r, 500));
        startProcess(app.id).catch(err => {
          console.error(`[auto-boot] Failed to start "${app.name}":`, err.message);
        });
      }
      continue;
    }

    // Port not in use — start it
    await new Promise(r => setTimeout(r, 500));
    startProcess(app.id).catch(err => {
      console.error(`[auto-boot] Failed to start "${app.name}":`, err.message);
    });
  }

  // Delayed probe: after server is fully ready, fix any remaining incorrect statuses
  setTimeout(async () => {
    try {
      await fetch(`http://127.0.0.1:${ownPort}/api/probe`, { method: "POST" });
      console.log("[auto-boot] Post-startup probe complete");
    } catch { /* ignore */ }
  }, 8000);
}
