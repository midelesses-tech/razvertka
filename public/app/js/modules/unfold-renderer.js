/**
 * unfold-renderer.js
 * SVG-рендер плоской развёртки.
 *
 * Концепция:
 *   - Горизонтальная полоса металла с разделителями гибов.
 *   - Штрихпунктирная линия по центру (средняя линия / нейтральная ось).
 *   - Сверху: буквенные метки сегментов (a, b, c, d, e) по центру.
 *   - Снизу: размеры от начала до ЦЕНТРА каждого гиба
 *     (прямой участок + половина BA).
 *   - Адаптивный шрифт: размер уменьшается если сегментов много.
 */

const BA_PX = 8;
const PADDING_X = 30;
const PADDING_Y = 30;
const STRIP_HEIGHT = 24;
const MIN_SEG_PX = 20;
const MAX_SEG_PX = 160;

export function initUnfoldRenderer(container) {
  if (!container) return { render() { return { svg: '' }; }, clear() {}, getSVG() { return null; } };

  function clear() { container.innerHTML = ''; }
  function getSVG() { return container.querySelector('svg.unfold-svg'); }

  /**
   * @param {Array} segments
   * @param {number} totalLength
   */
  function render(segments, totalLength) {
    // Раскладываем сегменты в полосовые части.
    const parts = [];
    let xPx = 0;
    let flatIdx = 0;
    const totalFlat = segments.filter((s) => s.type === 'flat').reduce((a, s) => a + Math.max(0, s.length || 0), 0);

    for (const seg of segments) {
      if (seg.type === 'flat') {
        const realLen = Math.max(0, seg.length || 0);
        const wPx = schematicLen(realLen, totalFlat, segments.filter((s) => s.type === 'flat').length);
        parts.push({
          kind: 'flat',
          x: xPx, w: wPx,
          realLen,
          label: segLabelChar(seg.tag, flatIdx),
        });
        xPx += wPx;
        flatIdx++;
      } else {
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
    const h = STRIP_HEIGHT + PADDING_Y * 2 + 50;
    const stripY = PADDING_Y + 20;
    const stripH = STRIP_HEIGHT;

    // Адаптивный шрифт
    const numFlats = parts.filter((p) => p.kind === 'flat').length;
    const fontSize = numFlats > 5 ? 9 : numFlats > 3 ? 10 : 11;

    // Строим SVG элементы
    let strips = '';
    let centerline = '';
    let bendLines = '';
    let topLabels = '';
    let bottomDims = '';

    // 1. Полосы металла (прямые участки)
    for (const p of parts) {
      const px = p.x + PADDING_X;
      if (p.kind === 'flat') {
        strips += `<rect x="${px.toFixed(2)}" y="${stripY}" width="${p.w.toFixed(2)}" height="${stripH}" class="unfold-fill" />`;
        // Буква сверху по центру
        const midX = px + p.w / 2;
        topLabels += `<text x="${midX.toFixed(2)}" y="${(stripY - 10).toFixed(2)}" class="seg-letter" text-anchor="middle" style="font-size:${fontSize}px;font-weight:700">${escapeXml(p.label || '')}</text>`;
      }
    }

    // 2. Штрихпунктирная средняя линия
    const clY = stripY + stripH / 2;
    centerline = `<line x1="${PADDING_X}" y1="${clY}" x2="${(PADDING_X + totalPx).toFixed(2)}" y2="${clY}" class="centerline" />`;

    // 3. Линии гибов (пунктирные вертикальные) + размерные отметки снизу
    let cumRealLen = 0; // накопленная реальная длина от начала
    let bendCount = 0;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const px = p.x + PADDING_X;

      if (p.kind === 'flat') {
        cumRealLen += p.realLen;
      } else {
        // Гиб — пунктирная линия
        const midX = px + p.w / 2;
        bendLines += `<line x1="${midX.toFixed(2)}" y1="${(stripY - 4).toFixed(2)}" x2="${midX.toFixed(2)}" y2="${(stripY + stripH + 4).toFixed(2)}" class="bend-line" />`;

        // Размер до ЦЕНТРА гиба = накопленная длина + половина BA
        const distToCenter = cumRealLen + (p.realLen || 0) / 2;
        bendCount++;
        const dimLabel = `L${bendCount}`;
        const dimY = stripY + stripH + 18;
        bottomDims += `<text x="${midX.toFixed(2)}" y="${dimY.toFixed(2)}" class="dim-text" text-anchor="middle" style="font-size:${fontSize}px">${fmtLen(distToCenter)}</text>`;
        bottomDims += `<text x="${midX.toFixed(2)}" y="${(dimY + 12).toFixed(2)}" class="dim-label" text-anchor="middle" style="font-size:${Math.max(8, fontSize - 1)}px;fill:var(--text-faint)">${dimLabel}</text>`;

        cumRealLen += p.realLen || 0;
      }
    }

    // 4. Общая размерная линия снизу — полная длина L
    const dimY2 = stripY + stripH + 40;
    const dimLeft = PADDING_X;
    const dimRight = PADDING_X + totalPx;
    const totalDim = `
      <line x1="${dimLeft}" y1="${dimY2}" x2="${dimRight}" y2="${dimY2}" class="dim-line" />
      <line x1="${dimLeft}" y1="${dimY2 - 4}" x2="${dimLeft}" y2="${dimY2 + 4}" class="dim-line" />
      <line x1="${dimRight}" y1="${dimY2 - 4}" x2="${dimRight}" y2="${dimY2 + 4}" class="dim-line" />
      <text x="${((dimLeft + dimRight) / 2).toFixed(2)}" y="${(dimY2 - 5).toFixed(2)}" class="dim-text" text-anchor="middle" style="font-weight:700;font-size:${fontSize + 1}px">L = ${fmtLen(totalLength)}</text>
    `;

    const svg = `
<svg class="unfold-svg" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  ${strips}
  ${centerline}
  ${bendLines}
  ${topLabels}
  ${bottomDims}
  ${totalDim}
</svg>`.trim();

    container.innerHTML = svg;
    return { svg };
  }

  return { render, clear, getSVG };
}

/** Схематическая длина: пропорциональная с логарифмическим сжатием. */
function schematicLen(realLen, totalFlat, numFlats) {
  if (realLen <= 0) return MIN_SEG_PX;
  const ref = Math.max(50, totalFlat || realLen);
  const t = realLen / ref;
  const base = MIN_SEG_PX + Math.min(MAX_SEG_PX - MIN_SEG_PX, t * MAX_SEG_PX * 2);
  // Логарифмическое сжатие для больших
  if (realLen > 200) {
    return Math.min(MAX_SEG_PX, base * 0.8);
  }
  return Math.max(MIN_SEG_PX, Math.min(MAX_SEG_PX, base));
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

function fmtLen(v) {
  if (v == null || isNaN(v)) return '—';
  const n = Math.round(v * 100) / 100;
  return `${n.toFixed(1)} мм`;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export default initUnfoldRenderer;
