import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { scanApps } from "@/lib/scanner";
import { eq } from "drizzle-orm";

export async function POST() {
  const scanned = scanApps();

  let inserted = 0;
  let updated = 0;

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

      await db
        .update(apps)
        .set({
          name: app.name,
          githubName: app.githubName,
          githubUrl: app.githubUrl,
          port: portToSet,
          updatedAt: now,
        })
        .where(eq(apps.id, existing.id));
      updated++;
    } else {
      try {
        await db.insert(apps).values({
          name: app.name,
          githubName: app.githubName,
          githubUrl: app.githubUrl,
          port: app.port,
          localPath: app.localPath,
          createdAt: now,
          updatedAt: now,
        });
        inserted++;
      } catch {
        // Skip on unique constraint violations (duplicate port)
      }
    }
  }

  return NextResponse.json({
    discovered: scanned.length,
    inserted,
    updated,
  });
}
