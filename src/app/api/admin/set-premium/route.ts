/**
 * POST /api/admin/set-premium
 * Ручная установка тарифа пользователю (админ).
 * Body: { userId, plan }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser, computePremiumUntil, toPublicUser, checkPremiumStatus, type Plan } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const admin = await db.user.findUnique({ where: { id: session.id } });
  if (!admin || admin.role !== 'admin') {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  let body: { userId?: string; plan?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  const { userId, plan } = body;
  if (!userId || !plan) {
    return NextResponse.json({ error: 'userId и plan обязательны' }, { status: 400 });
  }

  const validPlans: Plan[] = ['none', 'month', 'year', 'lifetime'];
  if (!validPlans.includes(plan as Plan)) {
    return NextResponse.json({ error: 'Неверный тариф' }, { status: 400 });
  }

  const target = await db.user.findUnique({ where: { id: userId } });
  if (!target) {
    return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
  }

  const premiumUntil = computePremiumUntil(plan as Plan);
  const updated = await db.user.update({
    where: { id: userId },
    data: { plan, premiumUntil },
  });

  const status = checkPremiumStatus(updated);
  return NextResponse.json({ user: toPublicUser(updated, status) });
}
