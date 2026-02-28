import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { installDeps } from "@/lib/process-manager";
import { getAgent, sendToAgent, toAppConfig } from "@/lib/agent-ws";
import crypto from "crypto";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app?.localPath) return NextResponse.json({ error: "No local path" }, { status: 404 });

  const agent = getAgent();
  if (agent) {
    sendToAgent({ type: "install", requestId: crypto.randomUUID(), app: toAppConfig(app), force: true });
    return NextResponse.json({ ok: true });
  }

  installDeps(appId, true).catch(() => {});
  return NextResponse.json({ ok: true });
}
