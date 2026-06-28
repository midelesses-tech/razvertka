/**
 * middleware.ts
 * Rate limiting + security headers для всех API запросов.
 *
 * Rate limiting: in-memory (перезапускается при деплое, но достаточно для защиты).
 * - /api/auth/login: 5 попыток / 15 минут на IP
 * - /api/auth/register: 3 попытки / час на IP
 * - /api/auth/request-reset: 3 попытки / час на IP
 * - /api/auth/reset-password: 5 попыток / 15 минут на IP
 * - /api/premium/verify-payment: 5 попыток / 15 минут на IP
 * - остальные /api/*: 60 запросов / минуту на IP
 */

import { NextRequest, NextResponse } from 'next/server';

/** @type {Map<string, {count:number, resetAt:number}>} */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

/** Очистка старых записей (каждые 5 минут). */
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, val] of rateLimitStore) {
    if (val.resetAt < now) rateLimitStore.delete(key);
  }
}

/** Проверка rate limit. Возвращает true если запрос разрешён. */
function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  cleanup();
  const now = Date.now();
  const existing = rateLimitStore.get(key);
  if (!existing || existing.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= max) return false;
  existing.count++;
  return true;
}

/** Получение IP клиента. */
function getClientIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

/** Security headers для всех ответов. */
function addSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff');
  res.headers.set('X-Frame-Options', 'ALLOWALL');
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.headers.set('X-XSS-Protection', '1; mode=block');
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // CSP — разрешаем inline styles, CDN для jsPDF, self, и любые frame-ancestors (для preview-панели)
  res.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors *;"
  );
  return res;
}

/** Конфигурация rate limit для путей. */
const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  '/api/auth/login': { max: 5, windowMs: 15 * 60 * 1000 },
  '/api/auth/register': { max: 3, windowMs: 60 * 60 * 1000 },
  '/api/auth/request-reset': { max: 3, windowMs: 60 * 60 * 1000 },
  '/api/auth/reset-password': { max: 5, windowMs: 15 * 60 * 1000 },
  '/api/premium/verify-payment': { max: 5, windowMs: 15 * 60 * 1000 },
};

const DEFAULT_LIMIT = { max: 60, windowMs: 60 * 1000 };

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Security headers для всех запросов.
  // Rate limiting только для /api/
  if (!pathname.startsWith('/api/')) {
    return addSecurityHeaders(NextResponse.next());
  }

  const ip = getClientIP(req);
  const config = RATE_LIMITS[pathname] || DEFAULT_LIMIT;
  const key = `${ip}:${pathname}`;

  if (!checkRateLimit(key, config.max, config.windowMs)) {
    const res = NextResponse.json(
      { error: 'Слишком много запросов. Попробуйте позже.' },
      { status: 429 }
    );
    res.headers.set('Retry-After', String(Math.ceil(config.windowMs / 1000)));
    return addSecurityHeaders(res);
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
