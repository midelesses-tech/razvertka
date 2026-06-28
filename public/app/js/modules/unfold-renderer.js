/**
 * unfold-renderer.js
 * SVG-рендер плоской развёртки — простая полоса с разделителями гибов.
 *
 * Сверху — длины сегментов (La, Lb, Lc, Ld, Le, Li).
 * Снизу — буквенные метки сегментов (a, b, c, d, e, ...).
 * Гибы (BA) показаны как тонкие разделители с зазором BA_PX.
 */

const BA_PX = 6; // ширина «полосы» гиба в пикселях
const PADDING_X = 28;
const PADDING_Y = 28;
const STRIP_HEIGHT = 28; // высота полосы металла в px

/**
 * @typedef {Object} Segment
 * @property {'flat'|'bend'} type
 * @property {number} [length]   для flat, мм
 * @property {number} [angle]    для bend, градусы
 * @property {number} [ba]       bend allowance, мм
 * @property {number} [radius]
 * @property {string} [label]
 * @property {string} [tag]
 */

/**
 * Инициализировать рендерер развёртки.
 * @param {HTMLElement} container
 * @returns {{
 *   render: (segments: Segment[], totalLength: number) => {svg:string},
 *   clear: () => void,
 *   getSVG: () => SVGSVGElement|null,
 * }}
 */
export function initUnfoldRenderer(container) {
  if (!container) return { render() { return { svg: '' }; }, clear() {}, getSVG() { return null; } };

  function clear() { container.innerHTML = ''; }
  function getSVG() { return container.querySelector('svg.unfold-svg'); }

  /**
   * Отрисовать развёртку.
   * @param {Segment[]} segments
   * @param {number} totalLength  полная длина, мм (для масштаба)
   */
  function render(segments, totalLength) {
    // 1. Раскладываем сегменты в «полосовые» части: flat = полоса длиной schematicLen(length),
    //    bend = разделитель шириной BA_PX.
    const parts = [];
    let xPx = 0;
    let idx = 0;
    for (const seg of segments) {
      if (seg.type === 'flat') {
        const realLen = Math.max(0, seg.length || 0);
        const wPx = schematicLen(realLen, totalLength);
        parts.push({
          kind: 'flat',
          x: xPx, w: wPx,
          realLen,
          label: segLabelChar(seg.tag, idx),
        });
        xPx += wPx;
        idx++;
      } else {
        // bend — разделитель
        const realBA = seg.ba ?? 0;
        parts.push({
          kind: 'bend',
          x: xPx, w: BA_PX,
          angle: seg.angle ?? 90,
          realLen: realBA,
        });
        xPx += BA_PX;
      }
    }

    const totalPx = Math.max(200, xPx);
    const w = totalPx + PADDING_X * 2;
    const h = STRIP_HEIGHT + PADDING_Y * 2 + 40; // +40 для подписей сверху/снизу
    const stripY = (h - STRIP_HEIGHT) / 2;

    // 2. Строим SVG
    let strips = '';
    let bendLines = '';
    let topLabels = '';
    let bottomLabels = '';

    for (const p of parts) {
      const px = p.x + PADDING_X;
      if (p.kind === 'flat') {
        strips += `<rect x="${px.toFixed(2)}" y="${stripY}" width="${p.w.toFixed(2)}" height="${STRIP_HEIGHT}" class="unfold-fill" />`;
        // длина сверху
        const midX = px + p.w / 2;
        topLabels += `<text x="${midX.toFixed(2)}" y="${(stripY - 8).toFixed(2)}" class="dim-text" text-anchor="middle">${fmtLen(p.realLen)}</text>`;
        // буква снизу
        bottomLabels += `<text x="${midX.toFixed(2)}" y="${(stripY + STRIP_HEIGHT + 16).toFixed(2)}" class="seg-letter" text-anchor="middle">${escapeXml(p.label || '')}</text>`;
      } else {
        // bend — пунктирная линия сгиба
        const midX = px + p.w / 2;
        bendLines += `<line x1="${midX.toFixed(2)}" y1="${(stripY - 6).toFixed(2)}" x2="${midX.toFixed(2)}" y2="${(stripY + STRIP_HEIGHT + 6).toFixed(2)}" class="bend-line" />`;
        topLabels += `<text x="${midX.toFixed(2)}" y="${(stripY - 8).toFixed(2)}" class="bend-label" text-anchor="middle">${escapeXml(String(p.angle))}°</text>`;
      }
    }

    // Общая размерная линия снизу — полная длина L
    const dimY = stripY + STRIP_HEIGHT + 28;
    const dimLeft = PADDING_X;
    const dimRight = PADDING_X + totalPx;
    const dimLine = `
      <line x1="${dimLeft}" y1="${dimY}" x2="${dimRight}" y2="${dimY}" class="dim-line" />
      <line x1="${dimLeft}" y1="${dimY - 4}" x2="${dimLeft}" y2="${dimY + 4}" class="dim-line" />
      <line x1="${dimRight}" y1="${dimY - 4}" x2="${dimRight}" y2="${dimY + 4}" class="dim-line" />
      <text x="${((dimLeft + dimRight) / 2).toFixed(2)}" y="${(dimY - 5).toFixed(2)}" class="dim-text" text-anchor="middle" style="font-weight:700">L = ${fmtLen(totalLength)}</text>
    `;

    const svg = `
<svg class="unfold-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  ${strips}
  ${bendLines}
  ${topLabels}
  ${bottomLabels}
  ${dimLine}
</svg>`.trim();

    container.innerHTML = svg;
    return { svg };
  }

  return { render, clear, getSVG };
}

// ───────────────────────── helpers ─────────────────────────

/**
 * Схематическая длина прямой полки.
 * Линейно-логарифмическая: короткие масштабируются линейно,
 * длинные сжимаются логарифмически.
 */
function schematicLen(realLen, totalLength) {
  if (realLen <= 0) return 0;
  // если все полки короткие — линейно
  const minPx = 14;
  const totalRef = Math.max(50, totalLength || realLen);
  const t = realLen / totalRef;
  // base: 60-180 px в зависимости от доли в общей длине
  const base = 60 + Math.min(180, t * 600);
  // логарифмическое сжатие очень длинных
  if (realLen > 200) {
    return Math.min(220, base * 0.85);
  }
  return Math.max(minPx, base);
}

function segLabelChar(tag, idx) {
  const tagMap = {
    'flange-a': 'a', 'flange-b': 'b',
    'web': 'c', 'flange-c': 'c',
    'flange-d': 'd', 'flange-e': 'e',
  };
  if (tag && tagMap[tag]) return tagMap[tag];
  const letters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  return letters[idx] || '?';
}

function fmtLen(v) {
  if (v == null) return '—';
  const n = Math.round(v * 100) / 100;
  return `${n.toFixed(2)} мм`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default initUnfoldRenderer;
