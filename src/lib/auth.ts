import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/lib/db";

/**
 * Библиотека аутентификации.
 *
 * Использует:
 *  - bcryptjs для хэширования паролей (10 раундов)
 *  - jose для подписи JWT (HS256, 30 дней)
 *  - cookies из next/headers для httpOnly-куки
 */

// ---------------------------------------------------------------------------
// Константы
// ---------------------------------------------------------------------------

export const AUTH_COOKIE = "rzv-auth";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 дней в секундах

/** TTL кода восстановления пароля — 15 минут */
export const RESET_CODE_TTL = 15 * 60 * 1000;

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "dev-insecure-secret-change-me"
);

const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------

export type Plan = "none" | "month" | "year" | "lifetime";

export interface PremiumStatus {
  active: boolean;
  plan: Plan;
  expired: boolean;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string | null;
  plan: Plan;
  premium: boolean;
  premiumUntil: string | null;
  emailVerified: boolean;
}

// ---------------------------------------------------------------------------
// Тарифы
// ---------------------------------------------------------------------------

export const PLAN_DURATIONS: Record<Exclude<Plan, "none">, number | null> = {
  month: 30,
  year: 365,
  lifetime: null,
};

export const PLAN_LABELS: Record<Plan, string> = {
  none: "Нет подписки",
  month: "1 месяц",
  year: "1 год",
  lifetime: "Навсегда",
};

/**
 * Возвращает дату окончания подписки для данного тарифа.
 * month → +30 дней, year → +365 дней, lifetime → null (бессрочно).
 */
export function computePremiumUntil(
  plan: Exclude<Plan, "none">,
  from: Date = new Date()
): Date | null {
  const days = PLAN_DURATIONS[plan];
  if (days === null) return null; // lifetime — бессрочно
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------------------------------------------------------------------------
// Валидация
// ---------------------------------------------------------------------------

/**
 * Валидация email.
 *
 * Правила:
 *  - обычный формат email;
 *  - TLD (последний сегмент после точки) обязан быть 'ru';
 *  - блокируем gmail.com, ru.com, mail.ru.com, .рф, кириллицу в домене.
 */
export function validateEmail(email: unknown): { ok: boolean; error?: string } {
  if (typeof email !== "string" || !email) {
    return { ok: false, error: "Email не указан" };
  }
  const value = email.trim().toLowerCase();

  // Базовый формат.
  const emailRe = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
  if (!emailRe.test(value)) {
    return { ok: false, error: "Некорректный формат email" };
  }

  // Кириллица запрещена (в т.ч. .рф).
  if (/[а-яё]/i.test(value)) {
    return { ok: false, error: "Кириллические домены не поддерживаются" };
  }

  const domain = value.split("@")[1] || "";
  const segments = domain.split(".");
  const tld = segments[segments.length - 1];

  if (tld !== "ru") {
    return { ok: false, error: "Допускаются только домены в зоне .ru" };
  }

  // Блокировка конкретных доменов.
  if (domain === "gmail.com" || domain === "ru.com" || domain === "mail.ru.com") {
    return { ok: false, error: "Этот домен запрещён" };
  }

  return { ok: true };
}

/**
 * Валидация пароля: минимум 6 символов.
 */
export function validatePassword(
  password: unknown
): { ok: boolean; error?: string } {
  if (typeof password !== "string" || password.length < 6) {
    return { ok: false, error: "Пароль должен быть не короче 6 символов" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Пароли
// ---------------------------------------------------------------------------

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export async function createToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${COOKIE_MAX_AGE}s`)
    .sign(SECRET);
}

export async function verifyToken(
  token: string
): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Куки
// ---------------------------------------------------------------------------

export async function setAuthCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearAuthCookie(): Promise<void> {
  const store = await cookies();
  store.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// Коды подтверждения / восстановления
// ---------------------------------------------------------------------------

/** 6-значный код подтверждения email. */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** 6-значный код восстановления пароля. */
export function generateResetCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Срок действия кода восстановления: теперь + 15 минут. */
export function computeResetCodeExp(from: Date = new Date()): Date {
  return new Date(from.getTime() + RESET_CODE_TTL);
}

// ---------------------------------------------------------------------------
// Премиум
// ---------------------------------------------------------------------------

/**
 * Проверка статуса подписки.
 * lifetime — активна всегда; для остальных сравниваем premiumUntil с now.
 */
export function checkPremiumStatus(user: {
  plan: string;
  premiumUntil: Date | string | null;
}): PremiumStatus {
  const plan = (user.plan as Plan) || "none";
  if (plan === "none") {
    return { active: false, plan: "none", expired: false };
  }
  if (plan === "lifetime") {
    return { active: true, plan: "lifetime", expired: false };
  }
  if (!user.premiumUntil) {
    return { active: false, plan, expired: true };
  }
  const until = new Date(user.premiumUntil);
  const now = new Date();
  if (until.getTime() < now.getTime()) {
    return { active: false, plan, expired: true };
  }
  return { active: true, plan, expired: false };
}

/**
 * Если подписка истекла — сбрасываем план в БД в "none".
 * Возвращает обновлённого пользователя (или исходного, если сброс не требуется).
 */
export async function syncExpiredPremium(user: {
  id: string;
  plan: string;
  premiumUntil: Date | string | null;
}) {
  const status = checkPremiumStatus(user);
  if (status.expired && user.plan !== "none") {
    const updated = await db.user.update({
      where: { id: user.id },
      data: { plan: "none", premiumUntil: null },
    });
    return updated;
  }
  return user;
}

// ---------------------------------------------------------------------------
// Сессия
// ---------------------------------------------------------------------------

/**
 * Читает куку, верифицирует JWT, возвращает пользователя из БД.
 * Автоматически сбрасывает истёкший премиум через syncExpiredPremium.
 */
export async function getSessionUser() {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const user = await db.user.findUnique({ where: { id: payload.sub } });
  if (!user) return null;

  const synced = await syncExpiredPremium(user);
  return synced;
}

// ---------------------------------------------------------------------------
// Публичное представление пользователя
// ---------------------------------------------------------------------------

export function toPublicUser(
  user: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    premiumUntil: Date | string | null;
    emailVerified: Date | null;
  },
  status?: PremiumStatus
): PublicUser {
  const s = status ?? checkPremiumStatus(user);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: s.plan,
    premium: s.active,
    premiumUntil: user.premiumUntil
      ? new Date(user.premiumUntil).toISOString()
      : null,
    emailVerified: !!user.emailVerified,
  };
}
