import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const paymentId = url.searchParams.get("paymentId");
  if (!paymentId) {
    return NextResponse.json(
      { error: "paymentId обязательный параметр" },
      { status: 400 }
    );
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.userId !== user.id) {
    return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
  }

  return NextResponse.json({
    id: payment.id,
    plan: payment.plan,
    amount: payment.amount,
    status: payment.status,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
  });
}
