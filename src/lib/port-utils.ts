import { execSync } from "child_process";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { isNotNull } from "drizzle-orm";

/**
 * Returns the first TCP port >= startPort that is not in `usedPorts`.
 */
export function findVacantPortSync(usedPorts: Set<number>, startPort = 3000): number {
  let p = startPort;
  while (usedPorts.has(p)) p++;
  return p;
}

/**
 * Async version: queries DB + system for used ports, then finds next free one.
 */
export async function findVacantPort(
  extra: Set<number> = new Set(),
  startPort = 3000
): Promise<number> {
  const rows = await db.select({ port: apps.port }).from(apps).where(isNotNull(apps.port));
  const system = getSystemListeningPorts();
  const used = new Set([...rows.map(r => r.port as number), ...system, ...extra]);
  return findVacantPortSync(used, startPort);
}

/**
 * Returns the set of TCP ports currently in LISTEN state on this machine.
 * Uses lsof — fast and available on macOS without extra dependencies.
 */
export function getSystemListeningPorts(): Set<number> {
  try {
    const output = execSync("lsof -i TCP -P -n 2>/dev/null", { encoding: "utf-8" });
    const ports = new Set<number>();
    for (const line of output.split("\n")) {
      if (!line.includes("LISTEN")) continue;
      const match = line.match(/:(\d+)\s+\(LISTEN\)/);
      if (match) ports.add(parseInt(match[1], 10));
    }
    return ports;
  } catch {
    return new Set();
  }
}
