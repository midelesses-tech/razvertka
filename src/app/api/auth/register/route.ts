import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  validateEmail,
  validatePassword,
  hashPassword,
  generateVerificationCode,
  createToken,
  setAuthCookie,
  toPublicUser,
  checkPremiumStatus,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const emailCheck = validateEmail(body.email);
  if (!emailCheck.ok) {
    return NextResponse.json({ error: emailCheck.error }, { status: 400 });
  }

  const passCheck = validatePassword(body.password);
  if (!passCheck.ok) {
    return NextResponse.json({ error: passCheck.error }, { status: 400 });
  }

  const email = (body.email as string).trim().toLowerCase();
  const name = typeof body.name === "string" ? body.name.trim() : null;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "Пользователь с таким email уже существует" },
      { status: 409 }
    );
  }

  const passwordHash = await hashPassword(body.password as string);
  const code = generateVerificationCode();

  const user = await db.user.create({
    data: {
      email,
      password: passwordHash,
      name,
      verificationCode: code,
    },
  });

  const token = await createToken(user.id);
  await setAuthCookie(token);

  const status = checkPremiumStatus(user);
  const pub = toPublicUser(user, status);

  // В dev возвращаем код подтверждения для удобства тестирования.
  const showCode = process.env.NODE_ENV !== "production";
  return NextResponse.json(
    { user: pub, verificationCode: showCode ? code : undefined },
    { status: 201 }
  );
}
