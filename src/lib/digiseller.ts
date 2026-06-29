/**
 * Интеграция с Digiseller.
 *
 * Хранит тарифные планы, формирует платёжную ссылку и предоставляет
 * утилиту проверки уникального кода покупки через API Digiseller.
 */

export interface PlanConfig {
  /** Идентификатор тарифа в нашей системе: 'month' | 'year' | 'lifetime' */
  id: "month" | "year" | "lifetime";
  /** Человекочитаемое название. */
  label: string;
  /** Цена в рублях. */
  price: number;
  /** Product ID в Digiseller. */
  productId: string;
  /** Длительность подписки в днях; null = бессрочно (lifetime). */
  durationDays: number | null;
}

/**
 * Карта тарифов. Product ID берётся из env-переменных.
 * Если env не задан — поле остаётся пустой строкой, и интеграция считается
 * не настроенной (см. isDigisellerConfigured).
 */
export const PLANS: Record<"month" | "year" | "lifetime", PlanConfig> = {
  month: {
    id: "month",
    label: "1 месяц",
    price: 100,
    productId: process.env.DIGISELLER_PRODUCT_MONTH || "",
    durationDays: 30,
  },
  year: {
    id: "year",
    label: "1 год",
    price: 1000,
    productId: process.env.DIGISELLER_PRODUCT_YEAR || "",
    durationDays: 365,
  },
  lifetime: {
    id: "lifetime",
    label: "Навсегда",
    price: 2999,
    productId: process.env.DIGISELLER_PRODUCT_LIFETIME || "",
    durationDays: null,
  },
};

export const SELLER_ID = process.env.DIGISELLER_SELLER_ID || "";
export const API_TOKEN = process.env.DIGISELLER_API_TOKEN || "";
export const APP_URL = process.env.APP_URL || "https://гибка-раскрой.рф";

/**
 * Интеграция считается настроенной, если заданы seller id, api token
 * и хотя бы productId для месячного тарифа.
 */
export function isDigisellerConfigured(): boolean {
  return !!(SELLER_ID && API_TOKEN && PLANS.month.productId);
}

/**
 * Формирует платёжную ссылку Digiseller.
 *
 * После оплаты покупатель будет возвращён на
 * `${APP_URL}/?payment=<paymentId>` — фронтенд по этому параметру
 * запрашивает статус платежа.
 */
export function buildPaymentUrl(
  planId: "month" | "year" | "lifetime",
  email: string,
  paymentId: string
): string {
  const plan = PLANS[planId];
  const params = new URLSearchParams({
    idd: plan.productId,
    email,
    return_url: `${APP_URL}/?payment=${paymentId}`,
  });
  return `https://shop.digiseller.ru/external/default.asp?${params.toString()}`;
}

/**
 * Проверяет уникальный 16-значный код покупки через Digiseller API.
 * Возвращает распарсенный ответ или null при сетевой ошибке.
 *
 * retval=0 → код валиден (оплачено).
 */
export async function verifyUniqueCode(
  code: string
): Promise<{ retval: number; [k: string]: unknown } | null> {
  try {
    const res = await fetch(
      `https://api.digiseller.com/api/purchases/unique-code/${encodeURIComponent(
        code
      )}?token=${encodeURIComponent(API_TOKEN)}`,
      { method: "GET" }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { retval?: number } & Record<
      string,
      unknown
    >;
    return { retval: typeof data.retval === "number" ? data.retval : -1, ...data };
  } catch {
    return null;
  }
}
