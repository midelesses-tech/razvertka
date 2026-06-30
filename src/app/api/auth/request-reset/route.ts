import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  generateResetCode,
  computeResetCodeExp,
  validateEmail,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const check = validateEmail(body.email);
  // Возвращаем 200 в любом случае — не раскрываем существование email.
  if (!check.ok) {
    return NextResponse.json({ ok: true });
  }

  const email = (body.email as string).trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });

  if (user) {
    const code = generateResetCode();
    const exp = computeResetCodeExp();
    await db.user.update({
      where: { id: user.id },
      data: { resetCode: code, resetCodeExp: exp },
    });

    // В dev возвращаем код для удобства тестирования.
    const showCode = process.env.NODE_ENV !== "production";
    return NextResponse.json({ ok: true, resetCode: showCode ? code : undefined });
  }

  return NextResponse.json({ ok: true });
}
