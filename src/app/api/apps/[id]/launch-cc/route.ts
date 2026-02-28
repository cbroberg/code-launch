import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { execFile } from "child_process";
import { getAgent, sendCommand } from "@/lib/agent-ws";
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
    const event = await sendCommand({ type: "launchTerminal", requestId: crypto.randomUUID(), path: app.localPath });
    if (event.type === "ack" && !event.ok) return NextResponse.json({ error: event.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const escapedPath = app.localPath.replace(/"/g, '\\"');
  const script = [
    'try',
    '  tell application "iTerm"',
    '    create window with default profile',
    '    tell current session of current window',
    `      write text "cd \\"${escapedPath}\\" && claude"`,
    '    end tell',
    '  end tell',
    'on error',
    '  tell application "Terminal"',
    `    do script "cd \\"${escapedPath}\\" && claude"`,
    '    activate',
    '  end tell',
    'end try',
  ].join('\n');

  execFile('osascript', ['-e', script]);
  return NextResponse.json({ ok: true });
}
