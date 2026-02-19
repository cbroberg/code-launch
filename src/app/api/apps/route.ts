import { NextResponse } from "next/server";
import { db } from "@/drizzle";
import { apps } from "@/drizzle/schema";
import { createAppSchema } from "@/lib/validations";
import { eq } from "drizzle-orm";

export async function GET() {
  const all = await db.select().from(apps).orderBy(apps.port);
  return NextResponse.json(all);
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createAppSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  // Check port conflict
  if (data.port) {
    const existing = await db.select().from(apps).where(eq(apps.port, data.port));
    if (existing.length > 0) {
      return NextResponse.json(
        { error: `Port ${data.port} is already taken by "${existing[0].name}"` },
        { status: 409 }
      );
    }
  }

  const now = new Date().toISOString();
  const [created] = await db
    .insert(apps)
    .values({
      name: data.name,
      githubName: data.githubName ?? null,
      githubUrl: data.githubUrl ?? null,
      port: data.port ?? null,
      localPath: data.localPath ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
