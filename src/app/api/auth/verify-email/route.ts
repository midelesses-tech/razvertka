import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, toPublicUser, checkPremiumStatus } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const code =
    typeof body.code === "string" ? body.code.trim() : "";

  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Код должен состоять из 6 цифр" },
      { status: 400 }
    );
  }

  const fresh = await db.user.findUnique({ where: { id: session.id } });
  if (!fresh) {
    return NextResponse.json({ error: "Пользователь не найден" }, { status: 404 });
  }

  if (fresh.emailVerified) {
    return NextResponse.json({ error: "Email уже подтверждён" }, { status: 400 });
  }

  if (fresh.verificationCode !== code) {
    return NextResponse.json({ error: "Неверный код" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: fresh.id },
    data: { emailVerified: new Date(), verificationCode: null },
  });

  const status = checkPremiumStatus(updated);
  return NextResponse.json({ user: toPublicUser(updated, status) });
}
