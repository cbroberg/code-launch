import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq, isNotNull } from "drizzle-orm";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

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

  const agent = getAgent();
  if (!agent) {
    return NextResponse.json(
      { error: "No agent connected — make sure cl-agent is running on your Mac" },
      { status: 503 }
    );
  }

  const { fullName, localBase } = parsed.data;
  const repoName = fullName.split("/").pop()!;
  const localPath = `${localBase}/${repoName}`;
  const githubUrl = `https://github.com/${fullName}`;

  // Check if already registered in DB
  const [existing] = await db.select().from(apps).where(eq(apps.localPath, localPath));
  if (existing) {
    return NextResponse.json({ app: existing, alreadyRegistered: true });
  }

  // Pass DB-registered ports so the agent can pick a non-conflicting port
  const portRows = await db.select({ port: apps.port }).from(apps).where(isNotNull(apps.port));
  const usedPorts = portRows.map(r => r.port as number);

  try {
    const event = await sendCommand(
      { type: "importProject", requestId: crypto.randomUUID(), githubUrl, localPath, usedPorts },
      120_000
    );

    if (event.type !== "importProjectResult") {
      return NextResponse.json({ error: "Unexpected agent response" }, { status: 502 });
    }
    if (!event.ok) {
      return NextResponse.json({ error: event.error || "Import failed" }, { status: 500 });
    }

    const now = new Date().toISOString();
    const [inserted] = await db
      .insert(apps)
      .values({
        name: repoName,
        githubName: fullName,
        githubUrl,
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

    return NextResponse.json({ app: inserted, port: event.port, localPath });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent error" },
      { status: 502 }
    );
  }
}
