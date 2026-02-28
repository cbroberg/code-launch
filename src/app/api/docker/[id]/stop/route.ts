import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const agent = getAgent();
  if (agent) {
    const event = await sendCommand({ type: "docker:stop", requestId: crypto.randomUUID(), containerId: id });
    if (event.type === "ack" && !event.ok) return NextResponse.json({ error: event.error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  try {
    execSync(`docker stop "${id}"`, { encoding: "utf-8", timeout: 15_000 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
