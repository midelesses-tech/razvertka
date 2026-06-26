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
  kFactorByRS,
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
 * Соглашение о размерах (внешние габариты сечения):
 *
 *   L (уголок):  A, B — 2 полки.                              1 гиб.
 *   U (швеллер): A — полка левая, B — полка правая,           2 гиба.
 *                C — высота (стенка).
 *   G (профиль): A — полка, B — полка, C — стенка, D — отгиб. 3 гиба.
 *                (швеллер + один загнутый край)
 *   C (профиль): A, B, C, D, E — 5 полок, Z-образный.         4 гиба.
 *                (A крайняя левая, E крайняя правая; B, C, D между гибами)
 *
 * Модель расчёта (как у onlinerazvertka.ru):
 *   A, B, C, D, E — внешние габариты. Для каждого гиба вычисляется
 *   setback = (R + S) · tan(угол/2). Крайние полки (один гиб) = габарит − setback,
 *   промежуточные полки (два гиба) = габарит − 2·setback.
 *   Полная развёртка L = Σ(прямые участки) + n · Li, где Li = BA.
 *
 * K-фактор всегда 0.5 (средняя линия) — по решению заказчика.
 *
 * @param {string} kind  'L' | 'U' | 'G' | 'C'
 * @param {{flangeA:number, flangeB:number, flangeC?:number, flangeD?:number, flangeE?:number, angle:number, thickness:number, radius:number}} dims
 * @returns {Segment[]}  сегменты с ПРЯМЫМИ участками (уже с вычетом setback)
 */
export function buildStandardProfile(kind, dims) {
  const { flangeA: A, flangeB: B, flangeC: C, flangeD: D, flangeE: E } = dims;
  const angle = dims.angle;
  const S = dims.thickness;
  const R = dims.radius;
  const sb = (R + S) * Math.tan(toRad(angle) / 2); // setback на один гиб
  const k = kind.toUpperCase();

  const flat = (length, label, tag) => ({
    type: 'flat', length: Math.max(0, length), label, tag,
  });
  const bend = (label, n) => ({
    type: 'bend', angle, radius: R, label, index: n,
  });

  switch (k) {
    case 'L': {
      // [полка A] [гиб] [полка B]
      return [
        flat(A - sb, 'Полка A (La)', 'flange-a'),
        bend('Гиб 1', 1),
        flat(B - sb, 'Полка B (Lb)', 'flange-b'),
      ];
    }
    case 'U': {
      // [полка A] [гиб] [стенка C] [гиб] [полка B]  — разнополочный П-профиль
      return [
        flat(A - sb, 'Полка A (La)', 'flange-a'),
        bend('Гиб 1', 1),
        flat(C - 2 * sb, 'Стенка C (Lc)', 'web'),
        bend('Гиб 2', 2),
        flat(B - sb, 'Полка B (Lb)', 'flange-b'),
      ];
    }
    case 'G': {
      // [полка A] [гиб] [полка B] [гиб] [стенка C] [гиб] [отгиб D]
      // 4 прямых участка, 3 гиба. A,D — крайние (1 гиб), B,C — промежуточные (2 гиба).
      return [
        flat(A - sb, 'Полка A (La)', 'flange-a'),
        bend('Гиб 1', 1),
        flat(B - 2 * sb, 'Полка B (Lb)', 'flange-b'),
        bend('Гиб 2', 2),
        flat(C - 2 * sb, 'Стенка C (Lc)', 'web'),
        bend('Гиб 3', 3),
        flat(D - sb, 'Отгиб D (Ld)', 'flange-d'),
      ];
    }
    case 'C': {
      // Z-образный профиль: [A] [гиб] [B] [гиб] [C] [гиб] [D] [гиб] [E]
      // 5 прямых участков, 4 гиба. A и E — крайние, B/C/D — промежуточные.
      return [
        flat(A - sb, 'Полка A (La)', 'flange-a'),
        bend('Гиб 1', 1),
        flat(B - 2 * sb, 'Полка B (Lb)', 'flange-b'),
        bend('Гиб 2', 2),
        flat(C - 2 * sb, 'Стенка C (Lc)', 'web'),
        bend('Гиб 3', 3),
        flat(D - 2 * sb, 'Полка D (Ld)', 'flange-d'),
        bend('Гиб 4', 4),
        flat(E - sb, 'Полка E (Le)', 'flange-e'),
      ];
    }
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
 *   - bends: per-bend сводка;
 *   - flats: прямые участки по тегам { flangeA, flangeB, web, flangeD } —
 *     для readout (La, Lb, Lc, Ld);
 *   - li: длина дуги одного гиба (BA) — для readout;
 *   - setback: внешний setback (R+S)·tan(A/2).
 *
 * @param {Segment[]} segments
 * @param {{thickness:number, radius:number, kfactor:number, material?:string}} params
 */
export function calculateUnfold(segments, params) {
  const { thickness: S, radius: R } = params;
  // K-фактор определяется автоматически по таблице R/S (как onlinerazvertka.ru).
  // При R/S→∞ K стремится к 0.5 (средняя линия); при малом R/S — к 0.33.
  const k = kFactorByRS(R, S);

  let totalLength = 0;
  const bends = [];
  /** Прямые участки по тегам: { 'flange-a': La, ..., 'flange-e': Le, 'web': Lc } */
  const flatByTag = {};
  const out = segments.map((seg, i) => {
    if (seg.type === 'flat') {
      totalLength += seg.length;
      if (seg.tag) {
        if (!(seg.tag in flatByTag)) flatByTag[seg.tag] = seg.length;
      }
      return { ...seg };
    }
    // bend
    const r = seg.radius > 0 ? seg.radius : R;
    const ba = bendAllowance(r, S, seg.angle, k);
    const bd = bendDeduction(r, S, seg.angle, k);
    totalLength += ba;
    const enriched = { ...seg, radius: r, kfactor: k, ba: round(ba, 4), bd: round(bd, 4) };
    bends.push({ index: i, ...enriched });
    return enriched;
  });

  const sb = (R + S) * Math.tan(toRad(bends[0]?.angle ?? 90) / 2);

  return {
    segments: out,
    totalLength: round(totalLength, 3),
    bendCount: bends.length,
    flatCount: out.filter((s) => s.type === 'flat').length,
    bends,
    kfactor: k,
    flats: {
      La: flatByTag['flange-a'] ?? 0,
      Lb: flatByTag['flange-b'] ?? 0,
      Lc: flatByTag['web'] ?? 0,
      Ld: flatByTag['flange-d'] ?? 0,
      Le: flatByTag['flange-e'] ?? 0,
    },
    li: bends[0]?.ba ?? 0,
    setback: round(sb, 4),
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
