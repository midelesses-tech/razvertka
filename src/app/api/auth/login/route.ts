import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  verifyPassword,
  createToken,
  setAuthCookie,
  syncExpiredPremium,
  toPublicUser,
  checkPremiumStatus,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email и пароль обязательны" },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "Неверный email или пароль" },
      { status: 401 }
    );
  }

  const ok = await verifyPassword(password, user.password);
  if (!ok) {
    return NextResponse.json(
      { error: "Неверный email или пароль" },
      { status: 401 }
    );
  }

  if (!user.emailVerified) {
    return NextResponse.json(
      {
        error: "Email не подтверждён",
        needVerification: true,
        email: user.email,
      },
      { status: 403 }
    );
  }

  const synced = await syncExpiredPremium(user);
  const token = await createToken(synced.id);
  await setAuthCookie(token);

  const status = checkPremiumStatus(synced);
  return NextResponse.json({ user: toPublicUser(synced, status) });
}
