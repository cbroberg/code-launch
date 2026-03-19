import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq, or } from "drizzle-orm";

/**
 * POST /api/apps/report-port
 * Called by CC sessions to register which port an app is running on.
 * Auth: Bearer token (CL_API_TOKEN env var)
 *
 * Body: { localPath?: string, name?: string, port: number }
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expected = process.env.CL_API_TOKEN ?? "";

  if (!expected || !token || token !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { localPath?: string; name?: string; port?: number; https?: boolean };
  const { localPath, name, port, https: useHttps } = body;

  if (!port || typeof port !== "number") {
    return NextResponse.json({ error: "port (number) required" }, { status: 400 });
  }
  if (!localPath && !name) {
    return NextResponse.json({ error: "localPath or name required" }, { status: 400 });
  }

  const conditions = [];
  if (localPath) conditions.push(eq(apps.localPath, localPath));
  if (name) conditions.push(eq(apps.name, name));

  const [app] = await db.select({ id: apps.id, name: apps.name })
    .from(apps)
    .where(conditions.length === 2 ? or(...conditions) : conditions[0]);

  if (!app) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { port, updatedAt: now };
  if (typeof useHttps === "boolean") updates.https = useHttps;
  await db.update(apps).set(updates).where(eq(apps.id, app.id));

  return NextResponse.json({ ok: true, appId: app.id, name: app.name, port, https: useHttps ?? false });
}
