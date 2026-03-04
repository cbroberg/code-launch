import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

const schema = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Name must be lowercase letters, numbers and hyphens"),
  githubOrg: z.string().min(1),
  localBase: z.string().min(1),
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

  const agent = getAgent();
  if (!agent) {
    return NextResponse.json(
      { error: "No agent connected — make sure cl-agent is running on your Mac" },
      { status: 503 }
    );
  }

  const { name, githubOrg, localBase, private: isPrivate, readme, gitignore, license } = parsed.data;
  const localPath = `${localBase}/${name}`;
  const githubRepo = `${githubOrg}/${name}`;

  // Check if already in DB
  const [existingApp] = await db.select().from(apps).where(eq(apps.localPath, localPath));
  if (existingApp) {
    return NextResponse.json({ error: `Already registered: ${localPath}` }, { status: 409 });
  }

  // Build gh flags
  const flags = [
    isPrivate ? "--private" : "--public",
    readme ? "--add-readme" : "",
    gitignore ? `--gitignore "${gitignore}"` : "",
    license ? `--license "${license}"` : "",
  ].filter(Boolean);

  // Pass DB-registered ports so the agent can pick a non-conflicting port
  const portRows = await db.select({ port: apps.port }).from(apps).where(isNotNull(apps.port));
  const usedPorts = portRows.map(r => r.port as number);

  try {
    const event = await sendCommand(
      { type: "createProject", requestId: crypto.randomUUID(), githubRepo, localPath, flags, usedPorts },
      90_000
    );

    if (event.type !== "createProjectResult") {
      return NextResponse.json({ error: "Unexpected agent response" }, { status: 502 });
    }
    if (!event.ok) {
      return NextResponse.json({ error: event.error || "Create failed" }, { status: 500 });
    }

    const now = new Date().toISOString();
    const [inserted] = await db
      .insert(apps)
      .values({
        name,
        githubName: githubRepo,
        githubUrl: event.githubUrl,
        port: event.port ?? null,
        localPath,
        packageManager: event.packageManager ?? null,
        framework: event.framework ?? null,
        runtime: event.runtime ?? null,
        devCommand: event.devCommand ?? null,
        projectType: event.projectType ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ app: inserted, githubUrl: event.githubUrl, localPath, port: event.port });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent error" },
      { status: 502 }
    );
  }
}
