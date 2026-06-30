import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser, generateVerificationCode } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const code = generateVerificationCode();
  await db.user.update({
    where: { id: user.id },
    data: { verificationCode: code },
  });

  // В dev возвращаем код для удобства тестирования.
  const showCode = process.env.NODE_ENV !== "production";
  return NextResponse.json({ ok: true, verificationCode: showCode ? code : undefined });
}
