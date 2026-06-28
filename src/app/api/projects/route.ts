import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, checkPremiumStatus } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_PROJECTS_FREE = 5;
const MAX_PROJECTS_PREMIUM = 100;
const MAX_DATA_BYTES = 200 * 1024; // 200 KB

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const projects = await db.project.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ projects });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { name?: unknown; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Имя проекта обязательно" }, { status: 400 });
  }

  const data =
    typeof body.data === "string"
      ? body.data
      : JSON.stringify(body.data ?? {});

  if (Buffer.byteLength(data, "utf8") > MAX_DATA_BYTES) {
    return NextResponse.json(
      { error: "Размер данных проекта превышает 200KB" },
      { status: 413 }
    );
  }

  // Лимит проектов по тарифу.
  const status = checkPremiumStatus(user);
  const limit = status.active ? MAX_PROJECTS_PREMIUM : MAX_PROJECTS_FREE;
  const count = await db.project.count({ where: { userId: user.id } });
  if (count >= limit) {
    return NextResponse.json(
      {
        error: `Достигнут лимит проектов (${limit}). ${
          status.active ? "" : "Оформите премиум для увеличения лимита."
        }`,
      },
      { status: 403 }
    );
  }

  const project = await db.project.create({
    data: { userId: user.id, name, data },
  });

  return NextResponse.json(
    {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    { status: 201 }
  );
}
