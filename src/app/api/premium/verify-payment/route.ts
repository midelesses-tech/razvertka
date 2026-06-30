import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  getSessionUser,
  toPublicUser,
  checkPremiumStatus,
  computePremiumUntil,
} from "@/lib/auth";
import { verifyUniqueCode, PLANS, isDigisellerConfigured } from "@/lib/digiseller";

export const runtime = "nodejs";

/**
 * Проверяет уникальный код покупки через Digiseller API.
 *
 * Шаги:
 *  1. Если боевой режим (Digiseller настроен) — запрос к API.
 *     retval=0 → код валиден. По полю `id_goods` (productId) сопоставляем тариф.
 *  2. Защита от повторного использования: если платёж с этим кодом уже paid — ошибка.
 *  3. Активируем премиум, обновляем платёж, POST на /api/purchases/.../deliver.
 *
 * В демо-режиме API недоступен — возвращаем ошибку (требуется бэк).
 */
export async function POST(req: Request) {
  let body: { uniqueCode?: unknown; paymentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const uniqueCode =
    typeof body.uniqueCode === "string" ? body.uniqueCode.trim() : "";

  if (!/^\d{16}$/.test(uniqueCode)) {
    return NextResponse.json(
      { error: "Код должен состоять из 16 цифр" },
      { status: 400 }
    );
  }

  if (!isDigisellerConfigured()) {
    return NextResponse.json(
      { error: "Интеграция с платёжной системой не настроена (демо-режим)" },
      { status: 503 }
    );
  }

  // Защита от повторного использования кода.
  const usedAlready = await db.payment.findFirst({
    where: { uniqueCode, status: "paid" },
  });
  if (usedAlready) {
    return NextResponse.json(
      { error: "Этот код уже был использован" },
      { status: 409 }
    );
  }

  const data = await verifyUniqueCode(uniqueCode);
  if (!data) {
    return NextResponse.json(
      { error: "Не удалось связаться с платёжной системой" },
      { status: 502 }
    );
  }

  if (data.retval !== 0) {
    return NextResponse.json(
      { error: "Код недействителен или не оплачен" },
      { status: 400 }
    );
  }

  // Сопоставляем productId с тарифом.
  const productId = String(
    (data as { id_goods?: unknown }).id_goods || ""
  );
  let plan: "month" | "year" | "lifetime" | null = null;
  if (productId && PLANS.month.productId === productId) plan = "month";
  else if (productId && PLANS.year.productId === productId) plan = "year";
  else if (productId && PLANS.lifetime.productId === productId) plan = "lifetime";

  if (!plan) {
    return NextResponse.json(
      { error: "ProductId не сопоставлен ни с одним тарифом" },
      { status: 400 }
    );
  }

  // Опционально: привязка к существующему pending-платежу по paymentId.
  const paymentId =
    typeof body.paymentId === "string" ? body.paymentId : null;

  // Текущий пользователь (если есть сессия — активируем ему).
  const sessionUser = await getSessionUser();

  // Тренировочный сценарий: если есть paymentId — берём ownerId из платежа.
  let userId = sessionUser?.id;
  if (paymentId) {
    const p = await db.payment.findUnique({ where: { id: paymentId } });
    if (p) userId = p.userId;
  }

  if (!userId) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }

  const premiumUntil = computePremiumUntil(plan);
  const updated = await db.user.update({
    where: { id: userId },
    data: { plan, premiumUntil },
  });

  // Обновляем платёж (по paymentId или создаём новый с этим кодом).
  if (paymentId) {
    await db.payment.update({
      where: { id: paymentId },
      data: { uniqueCode, status: "paid", paidAt: new Date() },
    });
  } else {
    await db.payment.create({
      data: {
        userId,
        plan,
        amount: PLANS[plan].price,
        productId: PLANS[plan].productId,
        uniqueCode,
        status: "paid",
        paidAt: new Date(),
      },
    });
  }

  // Уведомляем Digiseller о доставке (best-effort).
  try {
    await fetch(
      `https://api.digiseller.com/api/purchases/${uniqueCode}/deliver?token=${process.env.DIGISELLER_API_TOKEN || ""}`,
      { method: "POST" }
    );
  } catch {
    // Игнорируем — премиум уже активирован.
  }

  const status = checkPremiumStatus(updated);
  return NextResponse.json({ ok: true, user: toPublicUser(updated, status) });
}
