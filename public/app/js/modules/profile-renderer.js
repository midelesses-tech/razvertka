/**
 * profile-renderer.js
 * SVG-рендер сечения профиля (внешний контур с дугами гибов).
 *
 * Профиль идёт слева направо вдоль оси X. Каждый гиб поворачивает
 * направление движения на угол (против часовой — «вверх»). Радиусы
 * аппроксимируются дугами через точку.
 *
 * Метки сегментов (a, b, c, d, e) центрируются на середине прямого участка
 * с перпендикулярным смещением внутрь сечения. В вершинах (изломах) —
 * маленькие точки (vertex-dot) для визуальной ясности.
 *
 * Схематическое масштабирование: длины сегментов ограничиваются
 * [MIN_FLAT_PX, MAX_FLAT_PX] с логарифмическим сжатием, чтобы
 * длинные и короткие полки оставались различимы.
 */

import { toRad, round } from '../utils/math-utils.js';

// Схематическое масштабирование (в пикселях SVG-координат)
const MIN_FLAT_PX = 30;
const MAX_FLAT_PX = 140;

// Внутренние отступы внутри viewBox
const PADDING_X = 24;
const PADDING_Y = 24;

/**
 * @typedef {Object} RenderResult
 * @property {string} svg       сериализованный SVG (innerHTML)
 * @property {{width:number,height:number}} viewBox
 */

/**
 * @typedef {Object} Segment
 * @property {'flat'|'bend'} type
 * @property {number} [length]  для flat, мм
 * @property {number} [angle]   для bend, градусы
 * @property {number} [radius]  для bend, мм
 * @property {number} [ba]      bend allowance (для расчёта)
 * @property {string} [label]   опционально
 * @property {string} [tag]     опционально: 'flange-a','flange-b','web'...
 */

/**
 * Инициализировать рендерер сечения.
 * @param {HTMLElement} container  контейнер .stage__canvas
 * @returns {{
 *   render: (segments: Segment[], thickness: number) => RenderResult,
 *   clear: () => void,
 *   getSVG: () => SVGSVGElement|null,
 * }}
 */
export function initProfileRenderer(container) {
  if (!container) return { render() { return { svg: '', viewBox: { width: 0, height: 0 } }; }, clear() {}, getSVG() { return null; } };

  function clear() {
    container.innerHTML = '';
  }

  function getSVG() {
    return container.querySelector('svg.section-svg');
  }

  /**
   * Рассчитать геометрию сечения: массив точек и дуг.
   * @param {Segment[]} segments
   * @param {number} thickness
   */
  function computeGeometry(segments, thickness) {
    const S = Math.max(0.5, thickness || 1);
    const pts = [{ x: 0, y: 0 }];
    /** @type {Array<{center:{x,y},r:number,start:number,sweep:number}>} */
    const arcs = [];
    /** @type {Array<{mid:{x,y},dir:number,label:string}>} */
    const segLabels = [];

    let pos = { x: 0, y: 0 };
    let dir = 0; // градусов от +X

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === 'flat') {
        const realLen = Math.max(0, seg.length || 0);
        const pxLen = schematicLen(realLen);
        const rad = toRad(dir);
        const next = {
          x: pos.x + pxLen * Math.cos(rad),
          y: pos.y + pxLen * Math.sin(rad),
        };
        // метка в середине прямого участка, смещённая перпендикулярно
        const mid = {
          x: pos.x + (pxLen / 2) * Math.cos(rad),
          y: pos.y + (pxLen / 2) * Math.sin(rad),
        };
        const perp = dir + 90; // перпендикуляр «наружу»
        const offset = 9; // пиксели
        const labelPos = {
          x: mid.x + offset * Math.cos(toRad(perp)),
          y: mid.y + offset * Math.sin(toRad(perp)),
        };
        const labelChar = segLabelChar(i, segments.length, seg.tag);
        segLabels.push({ mid: labelPos, dir, label: labelChar });
        pos = next;
        pts.push({ ...pos });
      } else if (seg.type === 'bend') {
        const ang = seg.angle || 90;
        const newDir = dir + ang;
        const r = Math.max(0, seg.radius || 0);
        if (r > 0) {
          // дуга касательна к старому и новому направлению
          const half = toRad(ang) / 2;
          const tanLen = schematicLen(r * Math.tan(half) * 2) / 2; // схематическая касательная
          const inRad = toRad(dir);
          const entry = {
            x: pos.x + tanLen * Math.cos(inRad),
            y: pos.y + tanLen * Math.sin(inRad),
          };
          // центр дуги — перпендикуляр слева от направления движения (внутр. радиус)
          const perpRad = inRad + Math.PI / 2;
          const center = {
            x: entry.x + r * Math.cos(perpRad),
            y: entry.y + r * Math.sin(perpRad),
          };
          const startDeg = dir - 90;
          arcs.push({ center, r, start: startDeg, sweep: ang });
          pts.push({ ...entry });
          // выход из дуги
          const outRad = toRad(newDir);
          const exit = {
            x: entry.x + tanLen * Math.cos(outRad),
            y: entry.y + tanLen * Math.sin(outRad),
          };
          pos = exit;
          pts.push({ ...pos });
        } else {
          // без радиуса — просто излом (точка вершины добавится ниже)
        }
        dir = newDir;
      }
    }

    // bounding box
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    return {
      points: pts,
      arcs,
      segLabels,
      bbox: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY },
    };
  }

  /**
   * Отрисовать сечение.
   * @param {Segment[]} segments
   * @param {number} thickness
   */
  function render(segments, thickness) {
    const geom = computeGeometry(segments, thickness);
    const w = Math.max(200, geom.bbox.w + PADDING_X * 2);
    const h = Math.max(160, geom.bbox.h + PADDING_Y * 2 + 30);
    const offX = PADDING_X - geom.bbox.minX;
    const offY = PADDING_Y - geom.bbox.minY + 20;

    // строим path с M/L/A командами
    let d = '';
    if (geom.points.length > 0) {
      const p0 = geom.points[0];
      d += `M ${(p0.x + offX).toFixed(2)} ${(p0.y + offY).toFixed(2)} `;
      let segIdx = 0; // индекс сегмента в исходном массиве
      let pointIdx = 1;
      for (let i = 1; i < segments.length; i++) {
        const seg = segments[i];
        if (seg.type === 'flat') {
          const p = geom.points[pointIdx];
          d += `L ${(p.x + offX).toFixed(2)} ${(p.y + offY).toFixed(2)} `;
          pointIdx++;
        } else if (seg.type === 'bend') {
          const arc = geom.arcs[segIdx];
          segIdx++;
          if (arc) {
            // точка входа уже добавлена, рисуем A-команду к точке выхода
            // arc.start, arc.sweep в градусах
            const exitPt = geom.points[pointIdx];
            pointIdx++;
            const r = Math.max(0.1, arc.r);
            // sweep-flag = 1 (по часовой) для гиба «вверх» в нашей системе координат
            d += `A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${(exitPt.x + offX).toFixed(2)} ${(exitPt.y + offY).toFixed(2)} `;
          }
        }
      }
    }

    // вершины (vertex-dot) — каждая точка излома/угла
    const vertexDots = geom.points.map((p) =>
      `<circle cx="${(p.x + offX).toFixed(2)}" cy="${(p.y + offY).toFixed(2)}" r="2.4" class="center-mark"/>`
    ).join('');

    // метки сегментов
    const labels = geom.segLabels.map((sl) => {
      const ch = sl.label || '';
      if (!ch) return '';
      return `<text x="${(sl.mid.x + offX).toFixed(2)}" y="${(sl.mid.y + offY).toFixed(2)}" class="seg-letter" text-anchor="middle" dominant-baseline="middle">${escapeXml(ch)}</text>`;
    }).join('');

    const svg = `
<svg class="section-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <path d="${d.trim()}" class="profile-fill" />
  ${vertexDots}
  ${labels}
</svg>`.trim();

    container.innerHTML = svg;
    return { svg, viewBox: { width: w, height: h } };
  }

  return { render, clear, getSVG };
}

// ───────────────────────── helpers ─────────────────────────

/**
 * Схематическая длина для отображения в SVG.
 * Логарифмическое сжатие, чтобы короткие и длинные полки оставались видны.
 * @param {number} realLen  реальная длина, мм
 */
function schematicLen(realLen) {
  if (realLen <= 0) return 0;
  // линейно до MIN_FLAT_PX, логарифмически дальше
  if (realLen <= 10) return MIN_FLAT_PX * (realLen / 10);
  // логарифм: log10(realLen) * scale + offset, ограничено MAX_FLAT_PX
  const logVal = Math.log10(Math.max(10, realLen));
  const minLog = Math.log10(10); // = 1
  const maxLog = Math.log10(2000); // ~3.30
  const t = Math.max(0, Math.min(1, (logVal - minLog) / (maxLog - minLog)));
  return MIN_FLAT_PX + t * (MAX_FLAT_PX - MIN_FLAT_PX);
}

/** Выбор буквенной метки для сегмента по индексу. */
function segLabelChar(idx, total, tag) {
  // tag-ориентированные: flange-a → a, flange-b → b, web → c, ...
  const tagMap = {
    'flange-a': 'a',
    'flange-b': 'b',
    'web': 'c',
    'flange-c': 'c',
    'flange-d': 'd',
    'flange-e': 'e',
  };
  if (tag && tagMap[tag]) return tagMap[tag];
  // по порядку: a, b, c, d, e, ...
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  return letters[idx] || '?';
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default initProfileRenderer;
