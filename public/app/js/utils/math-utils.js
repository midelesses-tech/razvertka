/**
 * math-utils.js
 * Геометрические и математические утилиты для расчёта развёрток и раскроя.
 *
 * Все линейные размеры — в миллиметрах, углы — в градусах, если не указано иное.
 * Функции чистые (без побочных эффектов) и типизированы через JSDoc.
 */

// ───────────────────────── константы ─────────────────────────

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const TAU = Math.PI * 2;
export const EPS = 1e-6; /** допуск на сравнение чисел с плавающей точкой, мм */

/** Материалы и их типовые K-факторы (медианные значения из справочников). */
export const MATERIAL_K_FACTOR = Object.freeze({
  steel: 0.33,        // Сталь конструкционная
  aluminum: 0.40,     // Алюминий
  stainless: 0.44,    // Нержавеющая сталь
  brass: 0.39,        // Латунь
  copper: 0.37,       // Медь
  bronze: 0.35,       // Бронза
  custom: 0.33,       // переопределяется пользователем
});

// ───────────────────────── скаляры ─────────────────────────

/** Ограничить значение диапазоном [min, max]. */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/** Линейная интерполяция a→b при t∈[0,1]. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Приближённое сравнение с допуском EPS. */
export const approx = (a, b, eps = EPS) => Math.abs(a - b) < eps;

/** Нормализовать угол в градусах в диапазон [0, 360). */
export function normalizeDeg(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** Нормализовать угол в радианах в диапазон [0, TAU). */
export function normalizeRad(rad) {
  let r = rad % TAU;
  if (r < 0) r += TAU;
  return r;
}

/** Градусы → радианы. */
export const toRad = (deg) => deg * DEG2RAD;
/** Радианы → градусы. */
export const toDeg = (rad) => rad * RAD2DEG;

/** Округление до n знаков после запятой (без проблем с 1.005). */
export function round(v, n = 2) {
  const f = Math.pow(10, n);
  return Math.round((v + Number.EPSILON) * f) / f;
}

/** Безопасный тангенс: на 90° возвращает Infinity вместо большой ошибки. */
export function safeTan(deg) {
  const mod = ((deg % 180) + 180) % 180;
  if (Math.abs(mod - 90) < EPS) return Infinity;
  return Math.tan(toRad(deg));
}

// ───────────────────────── 2D-векторы ─────────────────────────

/**
 * Создать вектор. Везде используется объектная нотация {x, y},
 * чтобы код оставался читаемым и устойчивым к扩展 до 3D.
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
export const vec = (x = 0, y = 0) => ({ x, y });

export const vecAdd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vecSub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vecScale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vecDot = (a, b) => a.x * b.x + a.y * b.y;
/** Скалярный крест 2D (z-компонента 3D-креста). */
export const vecCross = (a, b) => a.x * b.y - a.y * b.x;
export const vecLen = (a) => Math.hypot(a.x, a.y);
export const vecDist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Нормализовать вектор (нуль-вектор остаётся нулём). */
export function vecNorm(a) {
  const l = vecLen(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/**
 * Повернуть вектор a на угол в радианах (положительный = против часовой).
 */
export function vecRotate(a, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}
/** Повернуть вектор на угол в градусах. */
export const vecRotateDeg = (a, deg) => vecRotate(a, toRad(deg));

/**
 * Угол вектора относительно +X, в радианах, диапазон (-π, π].
 */
export const vecAngle = (a) => Math.atan2(a.y, a.x);
/** То же — в градусах [0, 360). */
export const vecAngleDeg = (a) => normalizeDeg(toDeg(vecAngle(a)));

/** Перпендикуляр к вектору (поворот на +90° против часовой). */
export const vecPerp = (a) => ({ x: -a.y, y: a.x });

/**
 * Линейная интерполяция между векторами.
 */
export const vecLerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

// ───────────────────────── сегменты и прямые ─────────────────────────

/** Длина отрезка [p1, p2]. */
export const segLen = (p1, p2) => vecDist(p1, p2);

/** Точка на отрезке [p1,p2] при параметре t∈[0,1]. */
export const pointOnSeg = (p1, p2, t) => vecLerp(p1, p2, t);

/**
 * Расстояние от точки p до отрезка [a,b] + ближайшая точка.
 * @returns {{dist:number, point:{x:number,y:number}}}
 */
export function pointToSegment(p, a, b) {
  const ab = vecSub(b, a);
  const abLen2 = vecDot(ab, ab);
  if (abLen2 < EPS) return { dist: vecDist(p, a), point: { ...a } };
  let t = vecDot(vecSub(p, a), ab) / abLen2;
  t = clamp(t, 0, 1);
  const point = pointOnSeg(a, b, t);
  return { dist: vecDist(p, point), point };
}

/**
 * Пересечение двух отрезков [p1,p2]×[p3,p4].
 * @returns {{point:{x:number,y:number}, t:number}|null} t — параметр на первом отрезке
 */
export function segSegIntersect(p1, p2, p3, p4) {
  const r = vecSub(p2, p1);
  const s = vecSub(p4, p3);
  const denom = vecCross(r, s);
  if (Math.abs(denom) < EPS) return null; // параллельны/коллинеарны
  const qp = vecSub(p3, p1);
  const t = vecCross(qp, s) / denom;
  const u = vecCross(qp, r) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { point: vecAdd(p1, vecScale(r, t)), t: clamp(t, 0, 1) };
}

// ───────────────────────── дуги и окружности ─────────────────────────

/**
 * Длина дуги окружности.
 * @param {number} radius радиус
 * @param {number} angleDeg угол дуги в градусах
 */
export const arcLength = (radius, angleDeg) => radius * toRad(angleDeg);

/**
 * Центральный угол дуги по её длине.
 */
export const arcAngleByLength = (radius, length) => toDeg(length / radius);

/**
 * Точка на дуге окружности с центром c, радиусом r, стартовым углом startAngleDeg,
 * при параметре t∈[0,1] вдоль дуги длиной sweepDeg.
 */
export function pointOnArc(c, r, startAngleDeg, sweepDeg, t) {
  const ang = toRad(startAngleDeg + sweepDeg * t);
  return { x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) };
}

/**
 * Точки пересечения двух окружностей.
 * @returns {Array<{x:number,y:number}>} 0, 1 или 2 точки
 */
export function circleCircleIntersect(c1, r1, c2, r2) {
  const d = vecDist(c1, c2);
  if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS || d < EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const dir = vecNorm(vecSub(c2, c1));
  const mid = vecAdd(c1, vecScale(dir, a));
  const perp = vecPerp(dir);
  if (h < EPS) return [mid];
  return [
    vecAdd(mid, vecScale(perp, h)),
    vecSub(mid, vecScale(perp, h)),
  ];
}

// ───────────────────────── формулы листовой гибки ─────────────────────────

/**
 * Bend Allowance — припуск на гиб.
 * Длина дуги нейтрального слоя при гибке.
 *
 *   BA = (π/180) · A · (R + K·S)
 *
 * @param {number} R     внутренний радиус гиба, мм
 * @param {number} S     толщина металла, мм
 * @param {number} A     угол гиба, градусы (0..180)
 * @param {number} K     K-фактор (0..0.5)
 * @returns {number} BA в мм
 */
export function bendAllowance(R, S, A, K) {
  return toRad(A) * (R + K * S);
}

/**
 * Bend Deduction — вычет на гиб.
 *
 *   BD = 2·(R+S)·tan(A/2) − BA
 *
 * @param {number} R
 * @param {number} S
 * @param {number} A
 * @param {number} K
 * @returns {number} BD в мм
 */
export function bendDeduction(R, S, A, K) {
  const ba = bendAllowance(R, S, A, K);
  const outerSetback = (R + S) * Math.tan(toRad(A) / 2);
  return 2 * outerSetback - ba;
}

/** внешний setback (расстояние от касательной до вершины гиба). */
export const setback = (R, S, A) => (R + S) * Math.tan(toRad(A) / 2);

/**
 * Полная длина плоской развёртки для двух полок A и B, соединённых одним гибом.
 *
 *   L = A + B − BD
 *
 * Здесь A, B — длины полок (по внешним габаритам), BD — вычет на гиб.
 * @param {number} flangeA  длина первой полки, мм
 * @param {number} flangeB  длина второй полки, мм
 * @param {number} R        внутренний радиус
 * @param {number} S        толщина
 * @param {number} A        угол гиба, градусы
 * @param {number} K        K-фактор
 */
export function unfoldLength(flangeA, flangeB, R, S, A, K) {
  const bd = bendDeduction(R, S, A, K);
  return flangeA + flangeB - bd;
}

/**
 * Положение нейтрального слоя от внутренней поверхности.
 *   t_n = R + K·S
 * Используется для отрисовки нейтральной оси в сечении.
 */
export const neutralOffset = (R, K, S) => R + K * S;

/**
 * Рекомендуемый K-фактор по материалу (без учёта толщины/радиуса).
 * @param {string} materialKey  ключ из MATERIAL_K_FACTOR
 */
export function kFactorByMaterial(materialKey) {
  return MATERIAL_K_FACTOR[materialKey] ?? MATERIAL_K_FACTOR.steel;
}

/**
 * Таблица K-фактора по отношению R/S (внутренний радиус к толщине).
 * Стандартная инженерная таблица (DIN 6935 / аналоги), используемая
 * онлайн-калькуляторами развёртки. K растёт с ростом R/S: при малом
 * радиусе нейтральная ось смещена к внутренней поверхности (K≈0.33),
 * при большом — стремится к средней линии (K→0.5).
 *
 * Возвращает интерполированное значение для произвольного R/S.
 *
 * @param {number} R  внутренний радиус гиба, мм
 * @param {number} S  толщина металла, мм
 * @returns {number}  K-фактор в диапазоне [0.33, 0.5]
 */
export function kFactorByRS(R, S) {
  if (S <= 0) return 0.5;
  const rs = R / S;
  // таблица: [R/S, K] — калибрована под onlinerazvertka.ru
  const table = [
    [0.00, 0.33],
    [0.10, 0.34],
    [0.20, 0.35],
    [0.30, 0.36],
    [0.40, 0.37],
    [0.50, 0.38],
    [0.75, 0.40],
    [1.00, 0.408],
    [1.30, 0.42],
    [1.60, 0.43],
    [2.00, 0.44],
    [2.50, 0.45],
    [3.00, 0.46],
    [4.00, 0.47],
    [5.00, 0.50],
  ];
  // линейная интерполяция
  if (rs <= table[0][0]) return table[0][1];
  if (rs >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 1; i < table.length; i++) {
    if (rs <= table[i][0]) {
      const [x0, y0] = table[i - 1];
      const [x1, y1] = table[i];
      return y0 + (y1 - y0) * (rs - x0) / (x1 - x0);
    }
  }
  return 0.5;
}

// ───────────────────────── прямоугольники (для раскроя) ─────────────────────────

/**
 * AABB — axis-aligned bounding box.
 * @typedef {{x:number,y:number,w:number,h:number}} Rect
 */

/** Создать прямоугольник по левому-нижнему углу и размерам. */
export const rect = (x, y, w, h) => ({ x, y, w, h });

/** Площадь прямоугольника. */
export const rectArea = (r) => Math.max(0, r.w) * Math.max(0, r.h);

/** Пересечение двух AABB (может быть пустым). */
export function rectIntersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x + EPS || y2 <= y + EPS) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}
export const rectsOverlap = (a, b) => rectIntersect(a, b) !== null;

/** Содержится ли прямоугольник b полностью внутри a (с допуском). */
export function rectContains(a, b) {
  return (
    b.x >= a.x - EPS &&
    b.y >= a.y - EPS &&
    b.x + b.w <= a.x + a.w + EPS &&
    b.y + b.h <= a.y + a.h + EPS
  );
}

/** Повернуть прямоугольник на 90° (обмен w↔h), позиция угла сохраняется. */
export const rectRotate90 = (r) => ({ x: r.x, y: r.y, w: r.h, h: r.w });

/**
 * Вычислить «свободные» прямоугольники внутри листа `bin`, не занятые `used`.
 * Используется алгоритмом MaxRects для поддержки подсветки отходов.
 * @param {Rect} bin
 * @param {Rect[]} used
 * @returns {Rect[]} массив свободных прямоугольников (может содержать пересечения до очистки)
 */
export function maxrectsFreeRects(bin, used) {
  let free = [bin];
  for (const u of used) {
    const next = [];
    for (const f of free) {
      const inter = rectIntersect(f, u);
      if (!inter) { next.push(f); continue; }
      // разделяем f на до 4 непересекающихся подобластей
      if (inter.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: inter.x - f.x, h: f.h });
      if (inter.x + inter.w < f.x + f.w - EPS) next.push({ x: inter.x + inter.w, y: f.y, w: f.x + f.w - (inter.x + inter.w), h: f.h });
      if (inter.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: inter.y - f.y });
      if (inter.y + inter.h < f.y + f.h - EPS) next.push({ x: f.x, y: inter.y + inter.h, w: f.w, h: f.y + f.h - (inter.y + inter.h) });
    }
    free = next;
  }
  return free;
}

// ───────────────────────── полезные мелочи ─────────────────────────

/** Сумма массива чисел. */
export const sum = (arr) => arr.reduce((acc, v) => acc + v, 0);

/** Среднее массива чисел (0 для пустого). */
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);

/** Отформатировать число как «1234.5» (без локали, для CAD). */
export function fmtNum(v, n = 2) {
  if (!Number.isFinite(v)) return '0';
  return round(v, n).toFixed(n);
}

/** Отформатировать миллиметры в человекочитаемый вид «1 234.5 мм». */
export function fmtMm(v, n = 1) {
  return `${fmtNum(v, n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u202F')} мм`;
}

/** Процент использования (0..100), защита от деления на ноль. */
export function pct(part, whole) {
  if (whole < EPS) return 0;
  return clamp((part / whole) * 100, 0, 100);
}
