import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, validatePassword } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown; code?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim() : "";

  const passCheck = validatePassword(body.newPassword);
  if (!passCheck.ok) {
    return NextResponse.json({ error: passCheck.error }, { status: 400 });
  }

  if (!email || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: "Email и 6-значный код обязательны" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.resetCode || !user.resetCodeExp) {
    return NextResponse.json({ error: "Неверный код" }, { status: 400 });
  }

  if (user.resetCode !== code) {
    return NextResponse.json({ error: "Неверный код" }, { status: 400 });
  }

  if (new Date(user.resetCodeExp).getTime() < Date.now()) {
    return NextResponse.json({ error: "Код истёк" }, { status: 400 });
  }

  const hash = await hashPassword(body.newPassword as string);
  await db.user.update({
    where: { id: user.id },
    data: {
      password: hash,
      resetCode: null,
      resetCodeExp: null,
    },
  });

  return NextResponse.json({ ok: true });
}
