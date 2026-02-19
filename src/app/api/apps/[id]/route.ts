import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { updateAppSchema } from "@/lib/validations";
import { writePortToApp } from "@/lib/scanner";
import { eq } from "drizzle-orm";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);

  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = updateAppSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Fetch existing record so we can detect port changes and get localPath
  const [existing] = await db.select().from(apps).where(eq(apps.id, numId));
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check port conflict (if port is being changed)
  if (data.port !== undefined && data.port !== null) {
    const conflict = await db
      .select()
      .from(apps)
      .where(eq(apps.port, data.port));
    if (conflict.length > 0 && conflict[0].id !== numId) {
      return NextResponse.json(
        { error: `Port ${data.port} is already taken by "${conflict[0].name}"` },
        { status: 409 }
      );
    }
  }

  const [updated] = await db
    .update(apps)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(apps.id, numId))
    .returning();

  // Write port back to underlying project files if port changed and localPath is known
  let writtenFiles: string[] = [];
  const portChanged = data.port !== undefined && data.port !== existing.port;
  if (portChanged && data.port && existing.localPath) {
    writtenFiles = writePortToApp(existing.localPath, data.port);
  }

  return NextResponse.json({ ...updated, writtenFiles });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const numId = parseInt(id, 10);

  if (isNaN(numId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [deleted] = await db.delete(apps).where(eq(apps.id, numId)).returning();

  if (!deleted) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
