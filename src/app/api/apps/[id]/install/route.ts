import { NextRequest, NextResponse } from "next/server";
import { installDeps } from "@/lib/process-manager";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    await installDeps(appId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Install failed" }, { status: 500 });
  }
}
