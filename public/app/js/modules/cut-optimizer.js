/**
 * cut-optimizer.js
 * Оптимизация раскроя: распределяет детали по листам, используя BinPacker
 * (MaxRects-BSSF). Сортирует детали по площади (убывание) для лучшей плотности.
 *
 * Стратегия:
 *   1. Разворачиваем qty в плоский список деталей (каждый экземпляр отдельно).
 *   2. Сортируем по площади (убывание) — крупные детали первыми.
 *   3. Для каждого листа (до maxSheets) создаём BinPacker и пытаемся упаковать
 *      оставшиеся детали. Если что-то не влезло — открываем следующий лист.
 *   4. Возвращаем: sheets[] (с placed и free rects + utilization),
 *      unplaced[] (детали, которые не влезли ни на один лист),
 *      totalParts, placedParts, avgUtilization.
 */

import { BinPacker } from './bin-packer.js';

/**
 * @typedef {Object} SheetOptions
 * @property {number} width       ширина листа, мм
 * @property {number} height      высота листа, мм
 * @property {number} kerf        припуск на рез, мм
 * @property {number} margin      отступ от края, мм
 * @property {boolean} allowRotation  разрешить поворот деталей
 * @property {number} [maxSheets] максимум листов (по умолчанию 50)
 */

/**
 * @typedef {Object} NestingPart
 * @property {number} w
 * @property {number} h
 * @property {number} qty
 * @property {string} [id]
 * @property {string} [label]
 */

/**
 * Оптимизировать раскрой.
 * @param {SheetOptions} sheetOpts
 * @param {NestingPart[]} parts
 * @returns {{
 *   sheets: Array<{
 *     index: number,
 *     width: number, height: number,
 *     placed: Array<object>,
 *     free: Array<object>,
 *     utilization: number,
 *   }>,
 *   unplaced: Array<object>,
 *   totalParts: number,
 *   placedParts: number,
 *   avgUtilization: number,
 * }}
 */
export function optimizeNesting(sheetOpts, parts) {
  const opts = sheetOpts || {};
  const maxSheets = Math.max(1, opts.maxSheets ?? 50);

  // 1. Разворачиваем qty в плоский список
  /** @type {Array<{w:number,h:number,id?:string,label?:string,index:number}>} */
  const flat = [];
  for (const p of parts || []) {
    const qty = Math.max(0, Math.floor(p.qty || 0));
    for (let i = 0; i < qty; i++) {
      flat.push({
        w: p.w,
        h: p.h,
        id: p.id,
        label: p.label,
        index: i + 1,
      });
    }
  }

  // 2. Сортируем по площади (убывание). Крупные первыми.
  const sorted = flat.slice().sort((a, b) => (b.w * b.h) - (a.w * a.h));

  const sheets = [];
  const unplaced = [];
  let remaining = sorted.slice();
  let totalPlaced = 0;

  // 3. Упаковываем по листам, пока есть детали или не достигнут maxSheets
  while (remaining.length > 0 && sheets.length < maxSheets) {
    const packer = new BinPacker({
      width: opts.width,
      height: opts.height,
      kerf: opts.kerf,
      margin: opts.margin,
      allowRotation: opts.allowRotation !== false,
    });

    const { placed, unplaced: notThis } = packer.insertManyNoQty(remaining);

    if (placed.length === 0) {
      // ни одна деталь не влезла — иначе зациклимся. Считаем их неразмещёнными.
      for (const r of remaining) unplaced.push(r);
      break;
    }

    sheets.push({
      index: sheets.length + 1,
      width: opts.width,
      height: opts.height,
      placed,
      free: packer.getFreeRects(),
      utilization: packer.getUtilization(),
    });

    totalPlaced += placed.length;
    remaining = notThis;
  }

  // 4. Оставшиеся детали — неразмещённые
  for (const r of remaining) unplaced.push(r);

  const avgUtilization = sheets.length > 0
    ? sheets.reduce((s, sh) => s + sh.utilization, 0) / sheets.length
    : 0;

  return {
    sheets,
    unplaced,
    totalParts: flat.length,
    placedParts: totalPlaced,
    avgUtilization,
  };
}

export default optimizeNesting;
