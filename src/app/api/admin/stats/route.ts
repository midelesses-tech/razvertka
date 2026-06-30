/**
 * GET /api/admin/stats
 * Статистика для админ-панели.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json({ error: 'Не авторизован' }, { status: 401 });
  }

  const user = await db.user.findUnique({ where: { id: session.id } });
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
  }

  const [
    totalUsers,
    verifiedUsers,
    premiumUsers,
    totalPayments,
    paidPayments,
    totalRevenue,
    totalProjects,
  ] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { emailVerified: { not: null } } }),
    db.user.count({ where: { plan: { not: 'none' } } }),
    db.payment.count(),
    db.payment.count({ where: { status: 'paid' } }),
    db.payment.aggregate({ where: { status: 'paid' }, _sum: { amount: true } }),
    db.project.count(),
  ]);

  return NextResponse.json({
    users: {
      total: totalUsers,
      verified: verifiedUsers,
      premium: premiumUsers,
    },
    payments: {
      total: totalPayments,
      paid: paidPayments,
      revenue: totalRevenue._sum.amount || 0,
    },
    projects: totalProjects,
  });
}
