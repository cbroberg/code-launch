import { NextRequest, NextResponse } from "next/server";
import { buildApp } from "@/lib/process-manager";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const { thenStart } = await req.json().catch(() => ({ thenStart: false }));

  try {
    // Build is async — fire and forget so the client gets an immediate response
    // Logs stream to process_logs which the log viewer can tail
    buildApp(appId, thenStart === true).catch(() => {});
    return NextResponse.json({ ok: true, thenStart: thenStart === true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Build failed" }, { status: 500 });
  }
}
