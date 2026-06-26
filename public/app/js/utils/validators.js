/**
 * validators.js
 * Валидация пользовательского ввода. Возвращает либо {ok, value},
 * либо {ok:false, error}. Используется во всех формах приложения.
 */

/** Успешный результат. */
const ok = (value) => ({ ok: true, value });
/** Ошибка. */
const err = (error) => ({ ok: false, error });

/**
 * Разобрать числовой ввод.
 * @param {string|number} raw
 * @returns {{ok:true,value:number}|{ok:false,error:string}}
 */
export function asNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return err('пустое значение');
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return err('не число');
  return ok(n);
}

/** Число в диапазоне [min, max]. max может быть undefined (без верхней границы). */
export function asRange(raw, min, max, name = 'значение') {
  const r = asNumber(raw);
  if (!r.ok) return r;
  if (r.value < min) return err(`${name}: меньше ${min}`);
  if (max !== undefined && r.value > max) return err(`${name}: больше ${max}`);
  return ok(r.value);
}

/** Положительное число (> 0). */
export function asPositive(raw, name = 'значение') {
  const r = asNumber(raw);
  if (!r.ok) return r;
  if (r.value <= 0) return err(`${name}: должно быть положительным`);
  return ok(r.value);
}

/** Неотрицательное число (>= 0). */
export function asNonNegative(raw, name = 'значение') {
  const r = asNumber(raw);
  if (!r.ok) return r;
  if (r.value < 0) return err(`${name}: не может быть отрицательным`);
  return ok(r.value);
}

/** Целое положительное (для количеств). */
export function asPositiveInt(raw, name = 'количество') {
  const r = asNumber(raw);
  if (!r.ok) return r;
  if (!Number.isInteger(r.value)) return err(`${name}: должно быть целым`);
  if (r.value <= 0) return err(`${name}: должно быть положительным`);
  return ok(r.value);
}

/**
 * Угол гиба в градусах: (0, 180]. 0 не имеет смысла (нет гиба),
 * 180 — «плоский» гиб (теоретически).
 */
export function asBendAngle(raw) {
  return asRange(raw, 0.0001, 180, 'угол гиба');
}

/** K-фактор: [0, 1]. На практике 0..0.5, но допускаем до 1. */
export function asKFactor(raw) {
  return asRange(raw, 0, 1, 'K-фактор');
}

/** Толщина металла: (0, 50] мм. */
export function asThickness(raw) {
  return asRange(raw, 0.01, 50, 'толщина');
}

/** Внутренний радиус: [0, 200] мм. */
export function asRadius(raw) {
  return asRange(raw, 0, 200, 'радиус');
}

/** Длина полки/детали/листа: (0, 100000] мм. */
export function asLength(raw, name = 'длина') {
  return asRange(raw, 0.01, 100000, name);
}

/** Kerf (припуск на рез): [0, 50] мм. */
export function asKerf(raw) {
  return asRange(raw, 0, 50, 'kerf');
}

/** Отступ от края листа: [0, 1000] мм. */
export function asMargin(raw) {
  return asRange(raw, 0, 1000, 'отступ');
}

/**
 * Валидировать полный набор параметров развёртки.
 * @param {{thickness:number,radius:number,angle:number,kfactor:number,flangeA:number,flangeB:number}} p
 * @returns {{ok:true,value:object}|{ok:false,error:string}}
 */
export function validateUnfoldParams(p) {
  const checks = [
    ['thickness', asThickness(p.thickness)],
    ['radius', asRadius(p.radius)],
    ['angle', asBendAngle(p.angle)],
    ['kfactor', asKFactor(p.kfactor)],
    ['flangeA', asLength(p.flangeA, 'полка A')],
    ['flangeB', asLength(p.flangeB, 'полка B')],
  ];
  for (const [key, r] of checks) {
    if (!r.ok) return err(`${key}: ${r.error}`);
  }
  return ok({
    thickness: p.thickness,
    radius: p.radius,
    angle: p.angle,
    kfactor: p.kfactor,
    flangeA: p.flangeA,
    flangeB: p.flangeB,
  });
}

/**
 * Валидировать параметры раскроя.
 * @param {{sheetLength:number,sheetWidth:number,kerf:number,margin:number}} p
 */
export function validateNestingParams(p) {
  const checks = [
    ['sheetLength', asLength(p.sheetLength, 'длина листа')],
    ['sheetWidth', asLength(p.sheetWidth, 'ширина листа')],
    ['kerf', asKerf(p.kerf)],
    ['margin', asMargin(p.margin)],
  ];
  for (const [key, r] of checks) {
    if (!r.ok) return err(`${key}: ${r.error}`);
  }
  return ok({ ...p });
}

/**
 * Безопасно достать число из input, с дефолтом при ошибке.
 * Удобно для UI: не нужно вручную разбирать каждый Result.
 */
export function numOrDefault(raw, def) {
  const r = asNumber(raw);
  return r.ok ? r.value : def;
}

/**
 * Подсветить поле с ошибкой (добавить класс is-invalid) и снять подсветку.
 * Вспомогательные функции для UI-форм.
 */
export function markInvalid(inputEl, message) {
  if (!inputEl) return;
  inputEl.classList.add('is-invalid');
  inputEl.setAttribute('title', message ?? '');
}
export function clearInvalid(inputEl) {
  if (!inputEl) return;
  inputEl.classList.remove('is-invalid');
  inputEl.removeAttribute('title');
}
