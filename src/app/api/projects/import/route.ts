import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { z } from "zod";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { findVacantPort } from "@/lib/port-utils";
import { scanSingleDir } from "@/lib/scanner";

const schema = z.object({
  fullName: z.string().min(1),  // e.g. "cbroberg/my-app"
  localBase: z.string().min(1), // e.g. "/Users/cb/Apps/cbroberg"
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { fullName, localBase } = parsed.data;
  const repoName = fullName.split("/").pop()!;
  const localPath = `${localBase}/${repoName}`;

  // Check if dir already exists
  try {
    execSync(`test -d "${localPath}"`, { encoding: "utf-8" });
    // Dir exists — just register it
  } catch {
    // Clone it
    try {
      execSync(`git clone "https://github.com/${fullName}.git" "${localPath}"`, {
        encoding: "utf-8",
        timeout: 120_000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: `git clone failed: ${msg}` }, { status: 500 });
    }
  }

  // Check if already registered
  const [existing] = await db.select().from(apps).where(eq(apps.localPath, localPath));
  if (existing) {
    return NextResponse.json({ app: existing, alreadyRegistered: true });
  }

  const port = await findVacantPort();
  const meta = scanSingleDir(localPath);
  const now = new Date().toISOString();

  const [inserted] = await db
    .insert(apps)
    .values({
      name: repoName,
      githubName: fullName,
      githubUrl: `https://github.com/${fullName}`,
      port,
      localPath,
      packageManager: meta?.packageManager ?? null,
      framework: meta?.framework ?? null,
      runtime: meta?.runtime ?? null,
      devCommand: meta?.devCommand ?? null,
      projectType: meta?.projectType ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json({ app: inserted, port, localPath });
}
