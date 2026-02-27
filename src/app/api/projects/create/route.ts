import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { z } from "zod";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { findVacantPort } from "@/lib/port-utils";
import { scanSingleDir } from "@/lib/scanner";

const schema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Name must be lowercase letters, numbers and hyphens"),
  githubOrg: z.string().min(1),  // GitHub org/user login
  localBase: z.string().min(1),  // local parent directory
  private: z.boolean().optional().default(false),
  readme: z.boolean().optional().default(true),
  gitignore: z.string().optional().default(""),
  license: z.string().optional().default(""),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { name, githubOrg, localBase, private: isPrivate, readme, gitignore, license } = parsed.data;
  const localPath = `${localBase}/${name}`;
  const githubRepo = `${githubOrg}/${name}`;

  // Check if dir already exists
  try {
    execSync(`test -d "${localPath}"`, { encoding: "utf-8" });
    return NextResponse.json({ error: `Directory already exists: ${localPath}` }, { status: 409 });
  } catch { /* Good — dir doesn't exist */ }

  // Check if app already registered in DB
  const [existingApp] = await db.select().from(apps).where(eq(apps.localPath, localPath));
  if (existingApp) {
    return NextResponse.json({ error: `Already registered: ${localPath}` }, { status: 409 });
  }

  // Build gh repo create flags
  const flags = [
    isPrivate ? "--private" : "--public",
    readme ? "--add-readme" : "",
    gitignore ? `--gitignore "${gitignore}"` : "",
    license ? `--license "${license}"` : "",
  ].filter(Boolean).join(" ");

  // Create on GitHub (no --clone flag — we clone separately so we control the path)
  try {
    execSync(`gh repo create "${githubRepo}" ${flags}`, {
      encoding: "utf-8",
      timeout: 30_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `gh repo create failed: ${msg}` }, { status: 500 });
  }

  // Clone to local path
  try {
    execSync(`git clone "https://github.com/${githubRepo}.git" "${localPath}"`, {
      encoding: "utf-8",
      timeout: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `git clone failed: ${msg}` }, { status: 500 });
  }

  // Auto-assign a vacant port
  const port = await findVacantPort();

  // Scan the directory for tech metadata
  const meta = scanSingleDir(localPath);

  const now = new Date().toISOString();
  const githubUrl = `https://github.com/${githubRepo}`;

  const [inserted] = await db
    .insert(apps)
    .values({
      name,
      githubName: githubRepo,
      githubUrl,
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

  return NextResponse.json({ app: inserted, githubUrl, localPath, port });
}
