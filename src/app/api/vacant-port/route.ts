import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull } from "drizzle-orm";
import { getSystemListeningPorts } from "@/lib/port-utils";
import { getAgent, sendCommand } from "@/lib/agent-ws";
import crypto from "crypto";

export async function GET() {
  // Always include DB-registered ports in the used set
  const rows = await db.select({ port: apps.port }).from(apps).where(isNotNull(apps.port));
  const dbPorts = rows.map((r) => r.port as number);

  const agent = getAgent();
  if (agent) {
    const event = await sendCommand({
      type: "vacantPort",
      requestId: crypto.randomUUID(),
      usedPorts: dbPorts,
    });
    if (event.type === "vacantPort") {
      return NextResponse.json({ port: event.port, ports: [event.port] });
    }
    return NextResponse.json({ error: "Agent error" }, { status: 500 });
  }

  const systemPorts = getSystemListeningPorts();
  const usedPorts = new Set([...dbPorts, ...systemPorts]);

  const ports: number[] = [];
  let candidate = 3000;
  while (ports.length < 5) {
    if (!usedPorts.has(candidate)) ports.push(candidate);
    candidate++;
  }

  return NextResponse.json({ port: ports[0], ports });
}
