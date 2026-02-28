import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app?.localPath) return NextResponse.json({ error: "No local path" }, { status: 404 });

  const readmePath = path.join(app.localPath, "README.md");

  const agent = getAgent();
  if (agent) {
    const event = await sendCommand({ type: "readFile", requestId: crypto.randomUUID(), path: readmePath });
    if (event.type === "ack") return NextResponse.json({ error: "No README.md found" }, { status: 404 });
    if (event.type === "fileContent") return NextResponse.json({ content: event.content, name: app.name });
    return NextResponse.json({ error: "Unexpected agent response" }, { status: 500 });
  }

  if (!fs.existsSync(readmePath)) {
    return NextResponse.json({ error: "No README.md found" }, { status: 404 });
  }

  const content = fs.readFileSync(readmePath, "utf-8");
  return NextResponse.json({ content, name: app.name });
}
