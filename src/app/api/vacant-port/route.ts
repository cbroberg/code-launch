import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull } from "drizzle-orm";

function getSystemListeningPorts(): Set<number> {
  try {
    const output = execSync("lsof -i TCP -P -n 2>/dev/null", { encoding: "utf-8" });
    const ports = new Set<number>();
    for (const line of output.split("\n")) {
      if (!line.includes("LISTEN")) continue;
      // NAME column is last — format: *:3000, 127.0.0.1:3000, [::1]:3000
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) ports.add(parseInt(match[1], 10));
    }
    return ports;
  } catch {
    return new Set();
  }
}

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
