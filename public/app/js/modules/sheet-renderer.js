/**
 * sheet-renderer.js
 * SVG-рендер листа с деталями: сетка, размещённые детали, отходы, метки.
 *
 * Поддерживает:
 *   - несколько листов (переключение ‹ ›);
 *   - легенду с размерами деталей;
 *   - масштабируемый шрифт (зависит от размера детали в пикселях);
 *   - подсветку свободных областей (отходов) — по тулбару.
 */

const PADDING = 24;
const SHEET_RATIO_MAX = 0.92; // лист занимает до 92% ширины/высоты viewport

/**
 * @typedef {Object} SheetData
 * @property {number} index
 * @property {number} width    ширина листа, мм
 * @property {number} height   высота листа, мм
 * @property {Array<{x:number,y:number,w:number,h:number,rotated:boolean,id?:string,label?:string,index?:number}>} placed
 * @property {Array<{x:number,y:number,w:number,h:number}>} free
 * @property {number} utilization  %
 */

/**
 * @typedef {Object} RendererState
 * @property {SheetData[]} sheets
 * @property {number} currentIndex
 * @property {boolean} showWaste
 * @property {boolean} showLabels
 */

/**
 * Инициализировать рендерер листа.
 * @param {HTMLElement} container
 * @returns {{
 *   render: (result: {sheets:SheetData[]}) => void,
 *   setSheet: (i: number) => void,
 *   nextSheet: () => void,
 *   prevSheet: () => void,
 *   toggleWaste: () => void,
 *   toggleLabels: () => void,
 *   clear: () => void,
 *   getSVG: () => SVGSVGElement|null,
 *   getCurrentIndex: () => number,
 *   getSheetCount: () => number,
 * }}
 */
export function initSheetRenderer(container) {
  if (!container) return _noop();

  /** @type {RendererState} */
  const state = {
    sheets: [],
    currentIndex: 0,
    showWaste: false,
    showLabels: true,
  };

  function clear() { container.innerHTML = ''; }
  function getSVG() { return container.querySelector('svg.sheet-svg'); }
  function getCurrentIndex() { return state.currentIndex; }
  function getSheetCount() { return state.sheets.length; }

  function setSheet(i) {
    if (state.sheets.length === 0) return;
    state.currentIndex = Math.max(0, Math.min(state.sheets.length - 1, i));
    _draw();
  }
  function nextSheet() { setSheet(state.currentIndex + 1); }
  function prevSheet() { setSheet(state.currentIndex - 1); }
  function toggleWaste() { state.showWaste = !state.showWaste; _draw(); }
  function toggleLabels() { state.showLabels = !state.showLabels; _draw(); }

  /**
   * Отрисовать результат раскроя.
   * @param {{sheets: SheetData[]}} result
   */
  function render(result) {
    state.sheets = (result && Array.isArray(result.sheets)) ? result.sheets : [];
    state.currentIndex = 0;
    _draw();
  }

  function _draw() {
    if (state.sheets.length === 0) {
      container.innerHTML = `<div class="placeholder"><span>Раскладка появится здесь</span></div>`;
      return;
    }
    const sheet = state.sheets[state.currentIndex];
    if (!sheet) return;

    const { width: vw, height: vh } = _computeViewport(sheet.width, sheet.height);
    const scale = Math.min((vw - PADDING * 2) / sheet.width, (vh - PADDING * 2 - 80) / sheet.height);
    const sx = (x) => PADDING + x * scale;
    const sy = (y) => PADDING + (sheet.height - y) * scale; // инвертируем Y: 0 снизу
    const sw = (w) => w * scale;
    const sh = (h) => h * scale;

    // фон листа
    const sheetRect = `<rect x="${sx(0)}" y="${sy(sheet.height)}" width="${sw(sheet.width)}" height="${sh(sheet.height)}" class="sheet-rect" />`;

    // сетка — лёгкие линии каждые 100 мм
    let grid = '';
    const step = 100;
    for (let gx = step; gx < sheet.width; gx += step) {
      grid += `<line x1="${sx(gx)}" y1="${sy(sheet.height)}" x2="${sx(gx)}" y2="${sy(0)}" class="sheet-grid" />`;
    }
    for (let gy = step; gy < sheet.height; gy += step) {
      grid += `<line x1="${sx(0)}" y1="${sy(gy)}" x2="${sx(sheet.width)}" y2="${sy(gy)}" class="sheet-grid" />`;
    }

    // отходы (свободные прямоугольники) — полупрозрачные
    let waste = '';
    if (state.showWaste) {
      for (const f of sheet.free) {
        waste += `<rect x="${sx(f.x)}" y="${sy(f.y + f.h)}" width="${sw(f.w)}" height="${sh(f.h)}" class="waste-region" />`;
      }
    }

    // детали
    let parts = '';
    let labels = '';
    /** @type {Map<string, {w:number,h:number,count:number}>} */
    const legend = new Map();
    for (let i = 0; i < sheet.placed.length; i++) {
      const p = sheet.placed[i];
      const px = sx(p.x), py = sy(p.y + p.h), pw = sw(p.w), ph = sh(p.h);
      parts += `<rect x="${px.toFixed(2)}" y="${py.toFixed(2)}" width="${pw.toFixed(2)}" height="${ph.toFixed(2)}" class="part-rect" />`;
      // номер детали — масштабируемый шрифт
      if (state.showLabels) {
        const fontSize = Math.max(9, Math.min(14, Math.min(pw, ph) * 0.32));
        const cx = px + pw / 2;
        const cy = py + ph / 2;
        labels += `<text x="${cx.toFixed(2)}" y="${cy.toFixed(2)}" class="part-label" font-size="${fontSize.toFixed(1)}">${i + 1}</text>`;
        // размеры детали — мелким шрифтом снизу
        const dimFontSize = Math.max(7, fontSize * 0.6);
        labels += `<text x="${cx.toFixed(2)}" y="${(cy + fontSize + 2).toFixed(2)}" class="part-dim" font-size="${dimFontSize.toFixed(1)}">${Math.round(p.w)}×${Math.round(p.h)}${p.rotated ? ' ↻' : ''}</text>`;
      }
      // легенда
      const key = `${p.w}x${p.h}`;
      const le = legend.get(key) || { w: p.w, h: p.h, count: 0 };
      le.count++;
      legend.set(key, le);
    }

    // панель переключения листов
    const switcher = state.sheets.length > 1
      ? `<div class="sheet-switcher">
          <button class="chip" data-sheet-prev ${state.currentIndex === 0 ? 'disabled' : ''}>‹</button>
          <span class="sheet-switcher__info">Лист ${state.currentIndex + 1} / ${state.sheets.length} · ${sheet.utilization.toFixed(1)}%</span>
          <button class="chip" data-sheet-next ${state.currentIndex === state.sheets.length - 1 ? 'disabled' : ''}>›</button>
        </div>`
      : '';

    // легенда деталей
    const legendItems = Array.from(legend.entries()).map(([k, le], i) => {
      return `<div class="legend-item"><span class="legend-item__num">${i + 1}</span><span class="legend-item__dim mono">${le.w.toFixed(0)}×${le.h.toFixed(0)}</span><span class="legend-item__count">×${le.count}</span></div>`;
    }).join('');
    const legendHtml = legendItems ? `<div class="sheet-legend">${legendItems}</div>` : '';

    const totalW = vw;
    const totalH = vh;
    const svg = `
<svg class="sheet-svg" viewBox="0 0 ${totalW.toFixed(0)} ${totalH.toFixed(0)}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  ${sheetRect}
  ${grid}
  ${waste}
  ${parts}
  ${labels}
</svg>`.trim();

    container.innerHTML = `
      <div class="sheet-stage">
        ${switcher}
        <div class="sheet-stage__svg">${svg}</div>
        ${legendHtml}
      </div>
    `;

    // привязка кнопок переключения
    container.querySelector('[data-sheet-prev]')?.addEventListener('click', prevSheet);
    container.querySelector('[data-sheet-next]')?.addEventListener('click', nextSheet);
  }

  function _computeViewport(mmW, mmH) {
    // Горизонтальная ориентация — лист всегда в landscape
    const maxW = 1600, maxH = 700;
    const aspect = mmW / mmH;
    let vw = maxW, vh = maxW / aspect;
    if (vh > maxH) { vh = maxH; vw = maxH * aspect; }
    return { width: vw, height: vh };
  }

  return { render, setSheet, nextSheet, prevSheet, toggleWaste, toggleLabels, clear, getSVG, getCurrentIndex, getSheetCount };
}

function _noop() {
  return {
    render() {}, setSheet() {}, nextSheet() {}, prevSheet() {},
    toggleWaste() {}, toggleLabels() {}, clear() {}, getSVG() { return null; },
    getCurrentIndex() { return 0; }, getSheetCount() { return 0; },
  };
}

export default initSheetRenderer;
