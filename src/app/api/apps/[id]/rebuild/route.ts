import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { installDeps } from "@/lib/process-manager";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const [app] = await db.select().from(apps).where(eq(apps.id, appId));
  if (!app?.localPath) return NextResponse.json({ error: "No local path" }, { status: 404 });

  // Fire and forget — streams output to log viewer
  installDeps(appId, true).catch(() => {});

  return NextResponse.json({ ok: true });
}
