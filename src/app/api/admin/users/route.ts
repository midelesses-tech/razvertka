/**
 * GET /api/admin/users
 * Список всех пользователей (только для админа).
 * Поддержка пагинации: ?page=1&limit=20
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser, toPublicUser, checkPremiumStatus } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  // Проверка роли админа
  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  const page = Math.max(1, Number(req.nextUrl.searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get('limit') || 20)));
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    db.user.findMany({
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerified: true,
        plan: true,
        premiumUntil: true,
        createdAt: true,
      },
    }),
    db.user.count(),
  ]);

  const usersWithStatus = users.map((u) => {
    const status = checkPremiumStatus(u);
    return { ...u, premium: status.active, plan: status.plan };
  });

  return NextResponse.json({
    users: usersWithStatus,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  });
}
