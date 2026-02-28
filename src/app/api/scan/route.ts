import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { scanApps, writePortToApp } from "@/lib/scanner";
import { eq, isNotNull } from "drizzle-orm";
import { getSystemListeningPorts, findVacantPort } from "@/lib/port-utils";
import { processMap, statusEmitter } from "@/lib/process-manager";
import { gitCommitPortChange } from "@/lib/git-ops";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import type { ScannedApp } from "@/lib/agent-ws";
import crypto from "crypto";

export async function POST() {
  const agent = getAgent();
  let scanned: ScannedApp[];

  if (agent) {
    const event = await sendCommand({ type: "scan", requestId: crypto.randomUUID() }, 60_000);
    if (event.type !== "scanResult") {
      return NextResponse.json({ error: "Agent scan failed" }, { status: 500 });
    }
    scanned = event.apps;
  } else {
    scanned = scanApps();
  }

  let inserted = 0;
  let updated = 0;
  const portAssigned: Array<{ name: string; port: number }> = [];

  // Track ports assigned in this scan session so we don't double-assign
  const assignedThisScan = new Set<number>();

  for (const app of scanned) {
    const now = new Date().toISOString();

    if (!app.localPath) continue;

    // Find existing by localPath
    const [existing] = await db
      .select()
      .from(apps)
      .where(eq(apps.localPath, app.localPath));

    if (existing) {
      // Only fill port if existing.port is null (preserve manual edits)
      const portToSet = existing.port ?? app.port;

      // Preserve manually-set DB values when scanner can't detect them
      const techFields = {
        packageManager: app.packageManager ?? existing.packageManager,
        framework: app.framework ?? existing.framework,
        runtime: app.runtime ?? existing.runtime,
        devCommand: app.devCommand ?? existing.devCommand,
        projectType: app.projectType ?? existing.projectType,
      };

      try {
        await db
          .update(apps)
          .set({
            name: app.name,
            githubName: app.githubName,
            githubUrl: app.githubUrl,
            port: portToSet,
            ...techFields,
            updatedAt: now,
          })
          .where(eq(apps.id, existing.id));
        updated++;
      } catch {
        // Port conflict on update — keep existing port to avoid crashing
        await db
          .update(apps)
          .set({
            name: app.name,
            githubName: app.githubName,
            githubUrl: app.githubUrl,
            ...techFields,
            updatedAt: now,
          })
          .where(eq(apps.id, existing.id));
        updated++;
      }
    } else {
      // New app — use scanner values directly (no existing to preserve)
      const techFields = {
        packageManager: app.packageManager,
        framework: app.framework,
        runtime: app.runtime,
        devCommand: app.devCommand,
        projectType: app.projectType,
      };

      // Try inserting with its detected port
      let portToInsert = app.port;

      // If no port detected, or insert will conflict, auto-assign a vacant one
      let needsAutoPort = !portToInsert;

      if (portToInsert && !needsAutoPort) {
        // Check for conflict
        const [conflict] = await db.select().from(apps).where(eq(apps.port, portToInsert));
        if (conflict) needsAutoPort = true;
      }

      if (needsAutoPort && app.localPath) {
        const newPort = await findVacantPort(assignedThisScan);
        assignedThisScan.add(newPort);
        portToInsert = newPort;

        // Write port to project files and git commit (local only — skip when relayed via agent)
        if (!agent && app.devCommand) {
          const written = writePortToApp(app.localPath, newPort);
          if (written.length > 0) {
            const git = gitCommitPortChange(app.localPath, written, newPort);
            portAssigned.push({ name: app.name, port: newPort, ...git } as typeof portAssigned[0]);
          } else {
            portAssigned.push({ name: app.name, port: newPort });
          }
        } else {
          portAssigned.push({ name: app.name, port: newPort });
        }
      }

      try {
        await db.insert(apps).values({
          name: app.name,
          githubName: app.githubName,
          githubUrl: app.githubUrl,
          port: portToInsert,
          localPath: app.localPath,
          ...techFields,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      } catch {
        // Last resort: insert without port
        try {
          await db.insert(apps).values({
            name: app.name,
            githubName: app.githubName,
            githubUrl: app.githubUrl,
            port: null,
            localPath: app.localPath,
            ...techFields,
            createdAt: now,
            updatedAt: now,
          });
          inserted++;
        } catch {
          // Skip entirely
        }
      }
    }
  }

  // Remove sub-package entries that are no longer in scan results
  // (e.g. monorepo sub-packages that got merged into root)
  const scannedPaths = new Set(scanned.map(a => a.localPath).filter(Boolean));
  const allDbApps = await db.select({ id: apps.id, localPath: apps.localPath, status: apps.status }).from(apps);
  let deleted = 0;
  for (const dbApp of allDbApps) {
    if (!dbApp.localPath || scannedPaths.has(dbApp.localPath)) continue;
    // Only delete if it's a sub-directory of a known scanned root (not a manually-added unrelated app)
    const isSubPackage = scanned.some(root => root.localPath && dbApp.localPath!.startsWith(root.localPath + "/"));
    if (isSubPackage && dbApp.status !== "running") {
      await db.delete(apps).where(eq(apps.id, dbApp.id));
      deleted++;
    }
  }

  // Probe running status
  const now2 = new Date().toISOString();
  const allApps = await db.select().from(apps).where(isNotNull(apps.port));
  let probeUpdated = 0;

  if (agent) {
    const probeApps = allApps.map((a) => ({
      id: a.id, name: a.name, port: a.port, pid: a.pid,
      localPath: a.localPath, devCommand: a.devCommand, packageManager: a.packageManager,
    }));
    const probeEvent = await sendCommand(
      { type: "probe", requestId: crypto.randomUUID(), apps: probeApps },
      15_000
    );
    if (probeEvent.type === "probeResult") {
      for (const r of probeEvent.results) {
        if (!r) continue;
        const app = allApps.find((a) => a.id === r.appId);
        if (!app) continue;
        if (r.status === "running" && app.status !== "running") {
          await db.update(apps).set({ status: "running", pid: r.pid, updatedAt: now2 }).where(eq(apps.id, r.appId));
          statusEmitter.emit("status", { appId: r.appId, status: "running", pid: r.pid });
          probeUpdated++;
        } else if (r.status === "stopped" && app.status === "running") {
          await db.update(apps).set({ status: "stopped", pid: null, updatedAt: now2 }).where(eq(apps.id, r.appId));
          statusEmitter.emit("status", { appId: r.appId, status: "stopped", pid: null });
          probeUpdated++;
        }
      }
    }
  } else {
    const listening = getSystemListeningPorts();
    for (const app of allApps) {
      if (!app.port || processMap.has(app.id)) continue;
      const isListening = listening.has(app.port);
      if (isListening && app.status !== "running") {
        await db.update(apps).set({ status: "running", updatedAt: now2 }).where(eq(apps.id, app.id));
        probeUpdated++;
      } else if (!isListening && app.status === "running") {
        await db.update(apps).set({ status: "stopped", pid: null, updatedAt: now2 }).where(eq(apps.id, app.id));
        probeUpdated++;
      }
    }
  }

  return NextResponse.json({
    discovered: scanned.length,
    inserted,
    updated,
    deleted,
    probeUpdated,
    portAssigned,
  });
}
