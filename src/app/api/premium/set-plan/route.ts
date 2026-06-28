import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  toPublicUser,
  checkPremiumStatus,
  computePremiumUntil,
  type Plan,
} from "@/lib/auth";
import {
  PLANS,
  isDigisellerConfigured,
  buildPaymentUrl,
} from "@/lib/digiseller";

export const runtime = "nodejs";

const VALID_PLANS: Plan[] = ["month", "year", "lifetime"];

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  if (!user.emailVerified) {
    return NextResponse.json(
      { error: "Email не подтверждён" },
      { status: 403 }
    );
  }

  let body: { plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const plan = body.plan as Plan;
  if (!VALID_PLANS.includes(plan)) {
    return NextResponse.json({ error: "Неверный тариф" }, { status: 400 });
  }

  const config = PLANS[plan];

  // Демо-режим: активируем сразу без платежа.
  if (!isDigisellerConfigured()) {
    const premiumUntil = computePremiumUntil(plan);
    const updated = await db.user.update({
      where: { id: user.id },
      data: { plan, premiumUntil },
    });

    await db.payment.create({
      data: {
        userId: user.id,
        plan,
        amount: config.price,
        productId: config.productId || "demo",
        status: "paid",
        paidAt: new Date(),
      },
    });

    const status = checkPremiumStatus(updated);
    return NextResponse.json({ demo: true, user: toPublicUser(updated, status) });
  }

  // Боевой режим: создаём pending-платёж и возвращаем ссылку.
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      plan,
      amount: config.price,
      productId: config.productId,
      status: "pending",
    },
  });

  const paymentUrl = buildPaymentUrl(plan, user.email, payment.id);
  return NextResponse.json({ paymentId: payment.id, paymentUrl });
}
