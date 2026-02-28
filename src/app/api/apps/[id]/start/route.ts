import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { startProcess } from "@/lib/process-manager";
import { getAgent, sendCommand, toAppConfig } from "@/lib/agent-ws";
import crypto from "crypto";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const agent = getAgent();
  if (agent) {
    const [app] = await db.select().from(apps).where(eq(apps.id, appId));
    if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const event = await sendCommand({ type: "start", requestId: crypto.randomUUID(), app: toAppConfig(app) });
    if (event.type === "ack" && !event.ok) return NextResponse.json({ error: event.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  try {
    await startProcess(appId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start" }, { status: 500 });
  }
}
