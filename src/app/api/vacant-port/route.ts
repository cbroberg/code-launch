import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull } from "drizzle-orm";
import { getSystemListeningPorts } from "@/lib/port-utils";

export async function GET() {
  const rows = await db
    .select({ port: apps.port })
    .from(apps)
    .where(isNotNull(apps.port));

  const dbPorts = new Set(rows.map((r) => r.port as number));
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
