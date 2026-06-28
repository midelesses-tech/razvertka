/**
 * bin-packer.js
 * Упаковка прямоугольных деталей на лист — Skyline-BL (Bottom-Left).
 *
 * Алгоритм:
 *   1. "Горизонт" (skyline) — массив высот по X.
 *   2. Для каждой детали (сортировка по убыванию max(w,h)):
 *      - Ищем позицию с минимальной Y (как можно ниже).
 *      - При равных Y — минимальный X (как можно левее).
 *      - Проверяем что деталь помещается по высоте листа.
 *      - Если разрешён поворот — пробуем обе ориентации, выбираем лучшую.
 *   3. Обновляем skyline.
 *
 * Простой, быстрый, не создаёт наложений.
 */

const EPS = 1e-6;

export class BinPacker {
  constructor(opts) {
    this.width = Math.max(0, opts.width || 0);
    this.height = Math.max(0, opts.height || 0);
    this.kerf = Math.max(0, opts.kerf || 0);
    this.margin = Math.max(0, opts.margin || 0);
    this.allowRotation = opts.allowRotation !== false;
    this._placed = [];
    this._free = [];

    // Эффективная рабочая область
    this._ew = this.width - 2 * this.margin;
    this._eh = this.height - 2 * this.margin;

    // Skyline: массив сегментов {x, y, w} — начальная высота = margin
    this._skyline = [{ x: this.margin, y: this.margin, w: this._ew }];
  }

  insertManyNoQty(parts) {
    // Сортируем по max(w,h) убывание
    const sorted = parts.slice().sort((a, b) => {
      return Math.max(b.w, b.h) - Math.max(a.w, a.h);
    });

    const placed = [];
    const unplaced = [];

    for (const p of sorted) {
      const result = this._findPosition(p);
      if (result) {
        placed.push(result);
      } else {
        unplaced.push(p);
      }
    }

    this._placed = placed;
    this._free = [];
    return { placed, unplaced, free: [] };
  }

  insertOne(part) {
    const result = this.insertManyNoQty([part]);
    return result.placed[0] || null;
  }

  insertMany(parts) {
    const flat = [];
    for (const p of parts || []) {
      const qty = Math.max(0, Math.floor(p.qty || 0));
      for (let i = 0; i < qty; i++) {
        flat.push({ w: p.w, h: p.h, id: p.id, label: p.label, index: i + 1 });
      }
    }
    return this.insertManyNoQty(flat);
  }

  getPlaced() { return this._placed.slice(); }
  getFreeRects() { return this._free || []; }

  getUtilization() {
    const used = this._placed.reduce((s, p) => s + p.w * p.h, 0);
    const total = this._ew * this._eh;
    if (total <= EPS) return 0;
    return Math.max(0, Math.min(100, (used / total) * 100));
  }

  /**
   * Найти позицию для детали (Bottom-Left по skyline).
   * Пробует обе ориентации, выбирает лучшую.
   */
  _findPosition(part) {
    const k = this.kerf;
    const candidates = [];

    // Нормальная ориентация
    const w1 = part.w + k;
    const h1 = part.h + k;
    const pos1 = this._findBL(w1, h1);
    if (pos1) candidates.push({ ...pos1, w: part.w, h: part.h, rotated: false });

    // Поворот
    if (this.allowRotation && part.w !== part.h) {
      const w2 = part.h + k;
      const h2 = part.w + k;
      const pos2 = this._findBL(w2, h2);
      if (pos2) candidates.push({ ...pos2, w: part.h, h: part.w, rotated: true });
    }

    if (candidates.length === 0) return null;

    // Выбираем: минимальный Y, потом минимальный X
    candidates.sort((a, b) => {
      if (Math.abs(a.y - b.y) > EPS) return a.y - b.y;
      return a.x - b.x;
    });

    const best = candidates[0];
    const placed = {
      x: best.x,
      y: best.y,
      w: best.w,
      h: best.h,
      rotated: best.rotated,
      id: part.id,
      label: part.label,
      index: part.index,
    };
    this._placed.push(placed);
    this._updateSkyline(best.x, best.y, best.w + k, best.h + k);
    return placed;
  }

  /**
   * Найти позицию Bottom-Left для детали размером fw×fh.
   * Сканируем skyline, ищем минимальный Y где деталь помещается.
   */
  _findBL(fw, fh) {
    let bestX = -1;
    let bestY = Infinity;
    let bestSeg = -1;

    for (let i = 0; i < this._skyline.length; i++) {
      const seg = this._skyline[i];
      // Не помещается по ширине в этот сегмент
      if (seg.w < fw - EPS) continue;

      // Y = высота этого сегмента
      const y = seg.y;

      // Проверяем, не вылезает ли деталь по высоте листа
      if (y + fh > this.margin + this._eh + EPS) continue;

      // Проверяем, что на протяжении fw высота skyline не больше y + fh
      // (иначе деталь налезет на уже размещённые)
      let fits = true;
      let remainingW = fw;
      let j = i;
      while (remainingW > EPS && j < this._skyline.length) {
        const s = this._skyline[j];
        if (s.y > y + EPS) {
          // Этот сегмент выше — деталь не помещается
          fits = false;
          break;
        }
        remainingW -= s.w;
        j++;
      }
      if (remainingW > EPS) fits = false; // не хватило ширины

      if (!fits) continue;

      // Кандидат
      if (y < bestY - EPS) {
        bestY = y;
        bestX = seg.x;
        bestSeg = i;
      }
    }

    if (bestX < 0) return null;
    return { x: bestX, y: bestY, seg: bestSeg };
  }

  /**
   * Обновить skyline после размещения детали.
   * Размещённая область: (px, py, pw, ph).
   */
  _updateSkyline(px, py, pw, ph) {
    const newSegs = [];
    const topY = py + ph;
    const rightX = px + pw;

    for (const seg of this._skyline) {
      const segRight = seg.x + seg.w;

      // Сегмент полностью левее размещённой области
      if (segRight <= px + EPS) {
        newSegs.push(seg);
        continue;
      }
      // Сегмент полностью правее размещённой области
      if (seg.x >= rightX - EPS) {
        newSegs.push(seg);
        continue;
      }
      // Сегмент пересекается с размещённой областью

      // Левая часть сегмента (до px)
      if (seg.x < px - EPS) {
        newSegs.push({ x: seg.x, y: seg.y, w: px - seg.x });
      }
      // Правая часть сегмента (после rightX)
      if (segRight > rightX + EPS) {
        newSegs.push({ x: rightX, y: seg.y, w: segRight - rightX });
      }
      // Средняя часть поднимается до topY — добавим после цикла
    }

    // Добавляем новый сегмент (размещённая область поднята)
    newSegs.push({ x: px, y: topY, w: pw });

    // Сортируем по X
    newSegs.sort((a, b) => a.x - b.x);

    // Объединяем соседние сегменты с одинаковой высотой
    const merged = [];
    for (const seg of newSegs) {
      const last = merged[merged.length - 1];
      if (last && Math.abs(last.y - seg.y) < EPS && Math.abs(last.x + last.w - seg.x) < EPS) {
        last.w += seg.w;
      } else {
        merged.push({ ...seg });
      }
    }

    this._skyline = merged;
  }
}

export default BinPacker;
