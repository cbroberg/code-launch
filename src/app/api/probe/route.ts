import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull, isNull, eq, and, inArray } from "drizzle-orm";
import { processMap, statusEmitter } from "@/lib/process-manager";

/** True if the port actually responds to an HTTP request within 2.5s. */
async function isHttpUp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(2500),
      redirect: "manual",
    });
    return true;
  } catch {
    return false;
  }
}

function getPidOnPort(port: number): number | null {
  try {
    const out = execSync(`lsof -ti TCP:${port} -s TCP:LISTEN 2>/dev/null`, { encoding: "utf-8" });
    const pid = parseInt(out.trim().split("\n")[0], 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function getListeningPortForPid(pid: number): number | null {
  try {
    let pidList = String(pid);
    try {
      const children = execSync(`pgrep -P ${pid} 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (children) pidList += "," + children.split("\n").filter(Boolean).join(",");
    } catch { /* no children */ }
    const out = execSync(`lsof -p ${pidList} -i TCP -P -n 2>/dev/null`, { encoding: "utf-8" });
    for (const line of out.split("\n")) {
      if (!line.includes("LISTEN")) continue;
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * POST /api/probe
 * Uses HTTP health checks (not just port listening) to determine real status.
 * A service is "running" only if it actually responds to an HTTP request.
 */
export async function POST() {
  const now = new Date().toISOString();
  const rows = await db.select().from(apps).where(isNotNull(apps.port));

  // Run HTTP checks in parallel for speed
  const results = await Promise.all(
    rows.map(async (app) => {
      if (!app.port) return null;
      // Apps managed by our process manager: trust their status, skip HTTP check
      if (processMap.has(app.id)) return null;

      const up = await isHttpUp(app.port);
      return { app, up };
    })
  );

  let updated = 0;
  for (const result of results) {
    if (!result) continue;
    const { app, up } = result;

    if (up && app.status !== "running") {
      const pid = getPidOnPort(app.port!);
      await db
        .update(apps)
        .set({ status: "running", pid, updatedAt: now })
        .where(eq(apps.id, app.id));
      statusEmitter.emit("status", { appId: app.id, status: "running", pid });
      updated++;
    } else if (!up && app.status === "running") {
      await db
        .update(apps)
        .set({ status: "stopped", pid: null, updatedAt: now })
        .where(eq(apps.id, app.id));
      statusEmitter.emit("status", { appId: app.id, status: "stopped", pid: null });
      updated++;
    }
  }

  // Detect ports for managed running apps that have a PID but no port yet
  const noportApps = await db
    .select()
    .from(apps)
    .where(and(isNull(apps.port), inArray(apps.status, ["running", "starting"])));

  for (const app of noportApps) {
    const pid = app.pid ?? (processMap.get(app.id)?.process.pid ?? null);
    if (!pid) continue;
    const detected = getListeningPortForPid(pid);
    if (detected) {
      await db.update(apps).set({ port: detected, updatedAt: now }).where(eq(apps.id, app.id));
      statusEmitter.emit("port", { appId: app.id, port: detected });
      updated++;
    }
  }

  return NextResponse.json({ probed: rows.length, updated });
}
