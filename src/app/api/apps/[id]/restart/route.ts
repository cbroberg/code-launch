import { NextResponse } from "next/server";
import { restartProcess } from "@/lib/process-manager";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const appId = parseInt(id, 10);
  if (isNaN(appId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    await restartProcess(appId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to restart" },
      { status: 500 }
    );
  }
}
