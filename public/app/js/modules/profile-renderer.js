/**
 * profile-renderer.js
 * SVG-рендер сечения профиля (прямые углы, без дуг).
 *
 * Профиль строится из сегментов: FLAT (прямая полка) и BEND (гиб).
 * Каждый сегмент имеет направление (dir, градусы от +X).
 * BEND меняет направление: newDir = dir + sign * angle.
 *
 * Буквенные метки (a, b, c, d, e) размещаются в ЦЕНТРЕ прямого участка
 * с перпендикулярным смещением НА ВНЕШНЮЮ сторону сечения.
 * В вершинах (изломах) — маленькие точки.
 *
 * Схематическое масштабирование: логарифмическое сжатие длин, чтобы
 * короткие и длинные полки оставались различимы.
 */

import { toRad } from '../utils/math-utils.js';

const MIN_FLAT_PX = 30;
const MAX_FLAT_PX = 140;
const PADDING_X = 30;
const PADDING_Y = 30;
const LABEL_OFFSET = 14; // смещение буквы от центра сегмента

export function initProfileRenderer(container) {
  if (!container) return { render() { return { svg: '', viewBox: { width: 0, height: 0 } }; }, clear() {}, getSVG() { return null; } };

  function clear() { container.innerHTML = ''; }
  function getSVG() { return container.querySelector('svg.section-svg'); }

  /**
   * Отрисовать сечение.
   * @param {Array} segments
   * @param {number} thickness
   * @param {number} startDir — стартовое направление, градусы
   */
  function render(segments, thickness, startDir = 0) {
    const S = Math.max(0.5, thickness || 1);
    let pos = { x: 0, y: 0 };
    let dir = startDir;
    const pts = [{ x: 0, y: 0 }];
    /** @type {Array<{x:number,y:number,dir:number,label:string}>} */
    const segLabels = [];

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
        // Центр сегмента
        const mid = {
          x: pos.x + (pxLen / 2) * Math.cos(rad),
          y: pos.y + (pxLen / 2) * Math.sin(rad),
        };
        // Смещение буквы перпендикулярно, на ВНЕШНЮЮ сторону
        // Профиль загибается sign=-1 (против часовой в SVG = «вверх»),
        // внешняя сторона = перпендикуляр ВПРАВО от направления (dir + 90)
        const perpRad = toRad(dir + 90);
        const labelPos = {
          x: mid.x + LABEL_OFFSET * Math.cos(perpRad),
          y: mid.y + LABEL_OFFSET * Math.sin(perpRad),
        };
        const labelChar = segLabelChar(seg.tag, i);
        segLabels.push({ x: labelPos.x, y: labelPos.y, label: labelChar });
        pos = next;
        pts.push({ ...pos });
      } else if (seg.type === 'bend') {
        const sign = seg.sign ?? -1;
        dir = dir + sign * (seg.angle || 90);
      }
    }

    // Bounding box
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(200, maxX - minX + PADDING_X * 2);
    const h = Math.max(160, maxY - minY + PADDING_Y * 2);
    const offX = PADDING_X - minX;
    const offY = PADDING_Y - minY;

    // Path: M + L для каждой точки
    let d = '';
    pts.forEach((p, i) => {
      const cmd = i === 0 ? 'M' : 'L';
      d += `${cmd} ${(p.x + offX).toFixed(2)} ${(p.y + offY).toFixed(2)} `;
    });

    // Точки в вершинах (маленькие)
    const vertexDots = pts.map((p) =>
      `<circle cx="${(p.x + offX).toFixed(2)}" cy="${(p.y + offY).toFixed(2)}" r="2.5" class="vertex-dot"/>`
    ).join('');

    // Буквенные метки
    const labels = segLabels.map((sl) => {
      if (!sl.label) return '';
      return `<text x="${(sl.x + offX).toFixed(2)}" y="${(sl.y + offY).toFixed(2)}" class="seg-letter" text-anchor="middle" dominant-baseline="central">${escapeXml(sl.label)}</text>`;
    }).join('');

    const svg = `
<svg class="section-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <path d="${d.trim()}" class="profile-fill" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
  ${vertexDots}
  ${labels}
</svg>`.trim();

    container.innerHTML = svg;
    return { svg, viewBox: { width: w, height: h } };
  }

  return { render, clear, getSVG };
}

/** Схематическая длина: логарифмическое сжатие. */
function schematicLen(realLen) {
  if (realLen <= 0) return 0;
  if (realLen <= 10) return MIN_FLAT_PX * (realLen / 10);
  const logVal = Math.log10(Math.max(10, realLen));
  const minLog = Math.log10(10);
  const maxLog = Math.log10(2000);
  const t = Math.max(0, Math.min(1, (logVal - minLog) / (maxLog - minLog)));
  return MIN_FLAT_PX + t * (MAX_FLAT_PX - MIN_FLAT_PX);
}

function segLabelChar(tag, idx) {
  const tagMap = {
    'flange-a': 'a', 'flange-b': 'b',
    'web': 'c', 'flange-c': 'c',
    'flange-d': 'd', 'flange-e': 'e',
  };
  if (tag && tagMap[tag]) return tagMap[tag];
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  return letters[idx] || '';
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default initProfileRenderer;
