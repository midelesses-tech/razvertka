/**
 * feature-flags.js
 * Единый источник правды о том, какие функции бесплатны, а какие — в премиуме.
 *
 * План-разделение (согласовано с заказчиком):
 *   FREE:  стандартные профили, ручной K-фактор, базовые материалы,
 *          1 лист, до 10 деталей, SVG-экспорт, DXF-экспорт (с ограничениями),
 *          1–3 проекта в localStorage.
 *   PAID:  конструктор произвольных сечений, библиотека материалов,
 *          несколько листов, безлимит деталей, блокировка поворота (grain),
 *          PDF-экспорт, безлимит проектов, импорт CSV.
 *
 * Гейтинг:
 *   - флаг isPremium хранится в localStorage (rzv:premium) и управляется
 *     панелью разработчика (Ctrl+Shift+D). В production это место займёт
 *     реальная система лицензий.
 *   - UI слушает события 'flags:change' и обновляет замочки/доступность.
 */

import { eventBus } from '../utils/event-bus.js';

const PREMIUM_KEY = 'rzv:premium';

/**
 * Карта возможностей. Каждая запись:
 *   { tier: 'free' | 'paid', limit?: число|функция, label: описание }
 *
 * tier === 'paid'  → функция доступна только в премиуме.
 * tier === 'free'  → функция доступна всем, но может иметь limit.
 */
export const FEATURES = Object.freeze({
  // развёртка
  standardProfiles: { tier: 'free', label: 'Стандартные профили (L, U, G, C)' },
  customProfile:    { tier: 'paid', label: 'Конструктор произвольных сечений' },
  materialLibrary:  { tier: 'paid', label: 'Библиотека материалов и K-факторов' },
  manualKFactor:    { tier: 'free', label: 'Ручной ввод K-фактора' },

  // раскрой
  nestingSheets:    { tier: 'paid', limit: 1, label: 'Несколько листов' },
  nestingParts:     { tier: 'free', limit: 10, label: 'Детали в раскрое' },
  grainLock:        { tier: 'paid', label: 'Блокировка поворота (grain)' },
  nestingMaxRects:  { tier: 'paid', label: 'Приоритетный MaxRects-BSSF' },

  // экспорт
  exportSVG:        { tier: 'free', label: 'Экспорт в SVG' },
  exportDXF:        { tier: 'free', limit: 20, label: 'Экспорт в DXF (демо: ≤ 20 деталей)' },
  exportDXFFull:    { tier: 'paid', label: 'DXF без ограничений' },
  exportPDF:        { tier: 'paid', label: 'Экспорт в PDF' },

  // сохранение
  projectsLimit:    { tier: 'free', limit: 3, label: 'Проектов в localStorage' },
  csvImport:        { tier: 'paid', label: 'Импорт деталей из CSV' },
});

/**
 * Состояние премиума. По умолчанию false.
 * Меняется только через setPremium() — шлёт событие 'flags:change'.
 */
let _isPremium = (() => {
  try {
    return localStorage.getItem(PREMIUM_KEY) === '1';
  } catch {
    return false;
  }
})();

/** Текущее состояние премиума. */
export function isPremium() {
  return _isPremium;
}

/**
 * Установить состояние премиума и оповестить UI.
 * @param {boolean} value
 */
export function setPremium(value) {
  const next = Boolean(value);
  if (next === _isPremium) return;
  _isPremium = next;
  try { localStorage.setItem(PREMIUM_KEY, _isPremium ? '1' : '0'); } catch { /* noop */ }
  eventBus.emit('flags:change', { premium: _isPremium });
}

/**
 * Доступна ли функция пользователю.
 * @param {keyof typeof FEATURES} key
 * @returns {boolean}
 */
export function canUse(key) {
  const f = FEATURES[key];
  if (!f) return false;
  if (f.tier === 'free') return true;
  return _isPremium;
}

/**
 * Проверить лимит для функции и вернуть {allowed, used, limit, premium}.
 * @param {keyof typeof FEATURES} key
 * @param {number} used  сколько уже использовано
 * @returns {{allowed:boolean, limit?:number, premium:boolean}}
 */
export function checkLimit(key, used) {
  const f = FEATURES[key];
  if (!f) return { allowed: false };
  if (f.tier === 'paid' && !_isPremium) return { allowed: false, premium: false };
  if (f.limit !== undefined && used >= f.limit) {
    return { allowed: false, limit: f.limit, premium: _isPremium };
  }
  return { allowed: true, limit: f.limit, premium: _isPremium };
}

/**
 * Описание причины недоступности — для модалки «купите премиум».
 * @param {keyof typeof FEATURES} key
 */
export function whyLocked(key) {
  const f = FEATURES[key];
  if (!f) return 'Неизвестная функция';
  if (f.tier === 'paid') {
    return `«${f.label}» доступно в премиуме. Попробуйте в режиме разработчика или оформите подписку.`;
  }
  if (f.limit !== undefined) {
    return `Достигнут бесплатный лимит: ${f.limit}. Для большего объёма — премиум.`;
  }
  return 'Функция недоступна';
}
