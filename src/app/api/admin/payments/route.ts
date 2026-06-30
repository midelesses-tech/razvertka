/**
 * GET /api/admin/payments
 * Список всех платежей (только для админа).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 20)));
  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    db.payment.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { email: true },
        },
      },
    }),
    db.payment.count(),
  ]);

  return NextResponse.json({
    payments,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
}
