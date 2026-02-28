import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull, isNull, eq, and, inArray } from "drizzle-orm";
import { processMap, statusEmitter } from "@/lib/process-manager";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

async function isHttpUp(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2500), redirect: "manual" });
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

export async function POST() {
  const now = new Date().toISOString();
  const rows = await db.select().from(apps).where(isNotNull(apps.port));
  let updated = 0;

  const agent = getAgent();

  if (agent) {
    // Relay probe to agent
    const probeApps = rows.map((a) => ({
      id: a.id,
      name: a.name,
      port: a.port,
      pid: a.pid,
      localPath: a.localPath,
      devCommand: a.devCommand,
      packageManager: a.packageManager,
    }));

    const event = await sendCommand(
      { type: "probe", requestId: crypto.randomUUID(), apps: probeApps },
      15_000
    );

    if (event.type === "probeResult") {
      for (const r of event.results) {
        if (!r) continue;
        const app = rows.find((a) => a.id === r.appId);
        if (!app) continue;
        if (r.status === "running" && app.status !== "running") {
          await db.update(apps).set({ status: "running", pid: r.pid, updatedAt: now }).where(eq(apps.id, r.appId));
          statusEmitter.emit("status", { appId: r.appId, status: "running", pid: r.pid });
          updated++;
        } else if (r.status === "stopped" && app.status === "running") {
          await db.update(apps).set({ status: "stopped", pid: null, updatedAt: now }).where(eq(apps.id, r.appId));
          statusEmitter.emit("status", { appId: r.appId, status: "stopped", pid: null });
          updated++;
        }
      }
    }

    return NextResponse.json({ probed: rows.length, updated });
  }

  // Local path: HTTP checks
  const results = await Promise.all(
    rows.map(async (app) => {
      if (!app.port) return null;
      if (processMap.has(app.id)) return null;
      const up = await isHttpUp(app.port);
      return { app, up };
    })
  );

  for (const result of results) {
    if (!result) continue;
    const { app, up } = result;
    if (up && app.status !== "running") {
      const pid = getPidOnPort(app.port!);
      await db.update(apps).set({ status: "running", pid, updatedAt: now }).where(eq(apps.id, app.id));
      statusEmitter.emit("status", { appId: app.id, status: "running", pid });
      updated++;
    } else if (!up && app.status === "running") {
      await db.update(apps).set({ status: "stopped", pid: null, updatedAt: now }).where(eq(apps.id, app.id));
      statusEmitter.emit("status", { appId: app.id, status: "stopped", pid: null });
      updated++;
    }
  }

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
