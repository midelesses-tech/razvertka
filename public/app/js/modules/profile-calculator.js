/**
 * profile-calculator.js
 * Расчёт развёртки профилей по формулам листовой гибки.
 *
 * Ядро — три формулы (см. utils/math-utils.js):
 *   BA = (π/180) · A · (R + K·S)
 *   BD = 2·(R+S)·tan(A/2) − BA
 *   L  = A_полка + B_полка − BD
 *
 * Профиль представляется как упорядоченный список сегментов двух типов:
 *   - FLAT  { type:'flat', length }            прямой участок (полка)
 *   - BEND  { type:'bend', angle, radius }     гиб на угол A с внутр. радиусом R
 *
 * Полная развёртка = сумма длин FLAT + сумма BA по всем BEND.
 * Для стандартных профилей (L, U, G, C) сегменты генерируются из коротких
 * геометрических параметров.
 */

import {
  bendAllowance,
  bendDeduction,
  unfoldLength,
  neutralOffset,
  kFactorByMaterial,
  toRad,
  clamp,
  round,
} from '../utils/math-utils.js';
import { validateUnfoldParams } from '../utils/validators.js';

// ───────────────────────── типы сегментов ─────────────────────────

/**
 * @typedef {Object} FlatSegment
 * @property {'flat'} type
 * @property {number} length  длина прямой полки, мм
 * @property {string} [label] метка (например «полка A»)
 *
 * @typedef {Object} BendSegment
 * @property {'bend'} type
 * @property {number} angle    угол гиба, градусы (1..180)
 * @property {number} radius   внутренний радиус, мм
 * @property {number} [ba]     Bend Allowance, заполнается при расчёте
 * @property {number} [bd]     Bend Deduction, заполнается при расчёте
 * @property {number} [kfactor]
 * @property {string} [label]  метка (например «гиб 1»)
 *
 * @typedef {FlatSegment|BendSegment} Segment
 */

// ───────────────────────── стандартные профили ─────────────────────────

/**
 * Сгенерировать сегменты для стандартного профиля по габаритам.
 *
 * Соглашение о полках:
 *   - L (уголок):    2 полки A, B, один гиб 90°.
 *   - U (швеллер):   3 полки (B, A, B) — основание A, две полки B по краям, 2 гиба 90°.
 *   - G (G-профиль): 4 полки с двумя загибами краёв внутрь — упрощённо 2 гиба 90° + 2 короткие полки.
 *   - C (C-профиль): 4 полки (B, A, B, C) — основание A, полка B вверх, полка B, загиб C; 3 гиба.
 *
 * Все гибы — 90°, радиус R; толщина S задаётся отдельно (для расчёта BA/BD).
 *
 * @param {string} kind      'L' | 'U' | 'G' | 'C'
 * @param {{flangeA:number, flangeB:number, flangeC?:number}} dims
 * @returns {Segment[]}
 */
export function buildStandardProfile(kind, dims) {
  const { flangeA, flangeB, flangeC } = dims;
  const k = kind.toUpperCase();
  switch (k) {
    case 'L':
      return [
        { type: 'flat', length: flangeA, label: 'Полка A' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 1' },
        { type: 'flat', length: flangeB, label: 'Полка B' },
      ];
    case 'U':
      return [
        { type: 'flat', length: flangeB, label: 'Полка B (левая)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 1' },
        { type: 'flat', length: flangeA, label: 'Основание A' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 2' },
        { type: 'flat', length: flangeB, label: 'Полка B (правая)' },
      ];
    case 'G':
      // G-профиль: основание A, две полки B вверх, загибы flangeC внутрь
      return [
        { type: 'flat', length: flangeB, label: 'Полка B (левая)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 1' },
        { type: 'flat', length: flangeA, label: 'Основание A' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 2' },
        { type: 'flat', length: flangeB, label: 'Полка B (правая)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 3' },
        { type: 'flat', length: flangeC ?? flangeA * 0.3, label: 'Загиб C' },
      ];
    case 'C':
      // C-профиль: основание A, полка B, загиб C, симметрично
      return [
        { type: 'flat', length: flangeC ?? flangeA * 0.25, label: 'Загиб C (левый)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 1' },
        { type: 'flat', length: flangeB, label: 'Полка B (левая)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 2' },
        { type: 'flat', length: flangeA, label: 'Основание A' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 3' },
        { type: 'flat', length: flangeB, label: 'Полка B (правая)' },
        { type: 'bend', angle: 90, radius: 0, label: 'Гиб 4' },
        { type: 'flat', length: flangeC ?? flangeA * 0.25, label: 'Загиб C (правый)' },
      ];
    default:
      throw new Error(`Неизвестный тип профиля: ${kind}`);
  }
}

// ───────────────────────── расчёт развёртки ─────────────────────────

/**
 * Рассчитать развёртку по списку сегментов.
 *
 * Возвращает:
 *   - segments: копия сегментов с заполненными ba/bd для гибов;
 *   - totalLength: полная длина плоской развёртки, мм;
 *   - bendCount, flatCount;
 *   - per-bend сводка для таблиц/рендереров.
 *
 * @param {Segment[]} segments
 * @param {{thickness:number, radius:number, kfactor:number, material?:string}} params
 * @returns {{segments:Segment[], totalLength:number, bendCount:number, flatCount:number, bends:Object[], kfactor:number}}
 */
export function calculateUnfold(segments, params) {
  const { thickness: S, radius: R, kfactor: K, material } = params;
  const k = material && !params.kfactor ? kFactorByMaterial(material) : K;

  let totalLength = 0;
  const bends = [];
  const out = segments.map((seg, i) => {
    if (seg.type === 'flat') {
      totalLength += seg.length;
      return { ...seg };
    }
    // bend
    const r = seg.radius > 0 ? seg.radius : R; // локальный радиус или общий
    const ba = bendAllowance(r, S, seg.angle, k);
    const bd = bendDeduction(r, S, seg.angle, k);
    totalLength += ba;
    const enriched = { ...seg, radius: r, kfactor: k, ba: round(ba, 4), bd: round(bd, 4) };
    bends.push({ index: i, ...enriched });
    return enriched;
  });

  return {
    segments: out,
    totalLength: round(totalLength, 3),
    bendCount: bends.length,
    flatCount: out.filter((s) => s.type === 'flat').length,
    bends,
    kfactor: k,
  };
}

/**
 * Удобная обёртка: рассчитать развёртку для одного гиба двух полок
 * (классический случай из ТЗ: L = A + B − BD).
 *
 * @param {{flangeA:number, flangeB:number, thickness:number, radius:number, angle:number, kfactor?:number, material?:string}} p
 */
export function calculateSingleBend(p) {
  const v = validateUnfoldParams({
    thickness: p.thickness,
    radius: p.radius,
    angle: p.angle,
    kfactor: p.kfactor ?? kFactorByMaterial(p.material ?? 'steel'),
    flangeA: p.flangeA,
    flangeB: p.flangeB,
  });
  if (!v.ok) {
    return { ok: false, error: v.error };
  }
  const { flangeA, flangeB, thickness: S, radius: R, angle: A, kfactor: K } = v.value;
  const k = p.kfactor ?? K;

  const ba = bendAllowance(R, S, A, k);
  const bd = bendDeduction(R, S, A, k);
  const total = unfoldLength(flangeA, flangeB, R, S, A, k);

  return {
    ok: true,
    value: {
      ba: round(ba, 4),
      bd: round(bd, 4),
      totalLength: round(total, 3),
      setback: round((R + S) * Math.tan(toRad(A) / 2), 4),
      neutral: round(neutralOffset(R, k, S), 4),
      flangeA, flangeB, thickness: S, radius: R, angle: A, kfactor: k,
    },
  };
}

// ───────────────────────── позиционирование сечения ─────────────────────────

/**
 * Построить 2D-полилинию СЕЧЕНИЯ профиля (внешний контур) для отрисовки.
 *
 * Профиль идёт слева направо вдоль оси X, гибы «поднимают» последующие
 * полки. Каждый гиб поворачивает направление движения на угол (против ЧС
 * для гиба «вверх»). Радиусы аппроксимируются дугами через точку.
 *
 * Возвращает массив точек {x,y} и массив дуг {center,r,start,sweep} для
 * отрисовки скруглений. Координаты — в миллиметрах.
 *
 * @param {Segment[]} segments  сегменты с заполненными radius (после calc)
 * @param {number} thickness    толщина металла (для сдвига наружу)
 * @returns {{points:{x:number,y:number}[], arcs:Object[], bbox:Object}}
 */
export function buildSectionPolyline(segments, thickness) {
  const points = [{ x: 0, y: 0 }];
  const arcs = [];
  let pos = { x: 0, y: 0 };
  let dir = 0; // текущее направление, градусы от +X

  for (const seg of segments) {
    if (seg.type === 'flat') {
      const rad = toRad(dir);
      pos = {
        x: pos.x + seg.length * Math.cos(rad),
        y: pos.y + seg.length * Math.sin(rad),
      };
      points.push({ ...pos });
    } else {
      // bend: поворот направления на угол seg.angle (гиб «вверх» = против ЧС)
      const newDir = dir + seg.angle;
      const r = seg.radius || 0;
      if (r > 0) {
        // дуга касательна к старому и новому направлению
        const half = toRad(seg.angle) / 2;
        const tangent = r * Math.tan(half); // длина касательной от вершины
        // точка входа в дугу
        const inRad = toRad(dir);
        const entry = {
          x: pos.x + (seg._preTangent ?? tangent) * Math.cos(inRad),
          y: pos.y + (seg._preTangent ?? tangent) * Math.sin(inRad),
        };
        // центр дуги — перпендикуляр слева от направления движения (внутр. радиус)
        const perpRad = inRad + Math.PI / 2;
        const center = {
          x: entry.x + r * Math.cos(perpRad),
          y: entry.y + r * Math.sin(perpRad),
        };
        const startDeg = dir - 90; // стартовый угол дуги относительно центра
        arcs.push({ center, r, start: startDeg, sweep: seg.angle });
        pos = entry;
        points.push({ ...pos });
        // выход из дуги
        const outRad = toRad(newDir);
        const exit = {
          x: pos.x + tangent * Math.cos(outRad),
          y: pos.y + tangent * Math.sin(outRad),
        };
        pos = exit;
        points.push({ ...pos });
      } else {
        // без радиуса — просто излом в текущей точке (теоретический)
      }
      dir = newDir;
    }
  }

  // bounding box
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);

  return {
    points,
    arcs,
    bbox: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY },
  };
}

/**
 * Построить плоскую развёртку как набор прямоугольных полос,
 * разделённых линиями сгиба. Координаты — вдоль оси X от 0 до totalLength.
 *
 * @param {Segment[]} segments  сегменты с заполненными ba (после calc)
 * @param {number} thickness
 * @returns {{strips:Object[], bendLines:Object[], totalLength:number, bbox:Object}}
 */
export function buildUnfoldLayout(segments, thickness) {
  const strips = [];
  const bendLines = [];
  let x = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'flat') {
      const w = seg.length;
      strips.push({ x, y: 0, w, h: thickness, label: seg.label ?? null });
      x += w;
    } else {
      // гиб: по развёртке это «припуск» длиной BA, но визуально — линия сгиба
      // длина BA «съедается» в общей длине; рисуем полосу длиной BA с линией сгиба в центре
      const ba = seg.ba ?? 0;
      if (ba > 0) {
        strips.push({ x, y: 0, w: ba, h: thickness, isBend: true, label: seg.label ?? null });
      }
      bendLines.push({ x: x + ba / 2, angle: seg.angle, label: seg.label ?? null, ba });
      x += ba;
    }
  }

  return {
    strips,
    bendLines,
    totalLength: x,
    bbox: { minX: 0, maxX: x, minY: 0, maxY: thickness, w: x, h: thickness },
  };
}
