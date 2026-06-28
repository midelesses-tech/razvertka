import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_DATA_BYTES = 200 * 1024; // 200 KB

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  return NextResponse.json({
    id: project.id,
    name: project.name,
    data: project.data,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }

  let body: { name?: unknown; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if (typeof body.data !== "undefined") {
    const dataStr =
      typeof body.data === "string" ? body.data : JSON.stringify(body.data);
    if (Buffer.byteLength(dataStr, "utf8") > MAX_DATA_BYTES) {
      return NextResponse.json(
        { error: "Размер данных проекта превышает 200KB" },
        { status: 413 }
      );
    }
    data.data = dataStr;
  }

  const updated = await db.project.update({ where: { id }, data });
  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const project = await db.project.findUnique({ where: { id } });
  if (!project || project.userId !== user.id) {
    return NextResponse.json({ error: "Проект не найден" }, { status: 404 });
  }
  await db.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
