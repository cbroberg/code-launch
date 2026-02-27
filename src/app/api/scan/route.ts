import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { scanApps, writePortToApp } from "@/lib/scanner";
import { eq, isNotNull } from "drizzle-orm";
import { getSystemListeningPorts, findVacantPort } from "@/lib/port-utils";
import { processMap } from "@/lib/process-manager";
import { gitCommitPortChange } from "@/lib/git-ops";

export async function POST() {
  const scanned = scanApps();

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

    const techFields = {
      packageManager: app.packageManager,
      framework: app.framework,
      runtime: app.runtime,
      devCommand: app.devCommand,
      projectType: app.projectType,
    };

    if (existing) {
      // Only fill port if existing.port is null (preserve manual edits)
      const portToSet = existing.port ?? app.port;

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
      // New app — try inserting with its detected port
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

        // Write port to project files and git commit
        if (app.devCommand) {
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

  // Probe listening ports to detect externally running processes
  const listening = getSystemListeningPorts();
  const now2 = new Date().toISOString();
  const allApps = await db.select().from(apps).where(isNotNull(apps.port));
  let probeUpdated = 0;

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

  return NextResponse.json({
    discovered: scanned.length,
    inserted,
    updated,
    probeUpdated,
    portAssigned,
  });
}
