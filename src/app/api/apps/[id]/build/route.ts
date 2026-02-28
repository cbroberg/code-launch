import { NextRequest, NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { buildApp } from "@/lib/process-manager";
import { getAgent, sendToAgent, toAppConfig } from "@/lib/agent-ws";
import crypto from "crypto";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { thenStart } = await req.json().catch(() => ({ thenStart: false }));

  const agent = getAgent();
  if (agent) {
    const [app] = await db.select().from(apps).where(eq(apps.id, appId));
    if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
    sendToAgent({ type: "build", requestId: crypto.randomUUID(), app: toAppConfig(app), thenStart: thenStart === true });
    return NextResponse.json({ ok: true, thenStart: thenStart === true });
  }

  buildApp(appId, thenStart === true).catch(() => {});
  return NextResponse.json({ ok: true, thenStart: thenStart === true });
}
