import { NextResponse } from "next/server";
import { execSync } from "child_process";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    execSync(`docker stop "${id}"`, { encoding: "utf-8", timeout: 15_000 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
