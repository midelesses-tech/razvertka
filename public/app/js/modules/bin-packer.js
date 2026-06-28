/**
 * bin-packer.js
 * Упаковка прямоугольных деталей на лист.
 *
 * Два алгоритма, выбирается лучший результат:
 *   1. Shelf (полочный) — детали сортируются по высоте, кладутся рядами
 *   2. MaxRects-BSSF — классический MaxRects с Best Short Side Fit
 *
 * Результат: тот, что разместил больше деталей или дал лучшее использование.
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
  }

  /**
   * Вставить список деталей (уже плоский, без qty).
   * Пробует Shelf и MaxRects, возвращает лучший результат.
   */
  insertManyNoQty(parts) {
    const shelfResult = this._packShelf(parts);
    const maxRectsResult = this._packMaxRects(parts);

    // Выбираем лучший: больше деталей или лучше использование
    const shelfScore = shelfResult.placed.length * 10000 + this._calcUtilization(shelfResult.placed);
    const mrScore = maxRectsResult.placed.length * 10000 + this._calcUtilization(maxRectsResult.placed);

    const best = shelfScore >= mrScore ? shelfResult : maxRectsResult;
    this._placed = best.placed;
    this._free = best.free || [];
    return best;
  }

  /** Одинарная вставка (для совместимости). */
  insertOne(part) {
    const result = this.insertManyNoQty([part]);
    return result.placed[0] || null;
  }

  /** Разворачивает qty (для совместимости). */
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

  getFreeRects() {
    return (this._free || []).map(r => ({ ...r }));
  }

  getUtilization() {
    return this._calcUtilization(this._placed);
  }

  _calcUtilization(placed) {
    const used = placed.reduce((s, p) => s + p.w * p.h, 0);
    const ew = this.width - 2 * this.margin;
    const eh = this.height - 2 * this.margin;
    const total = ew * eh;
    if (total <= EPS) return 0;
    return Math.max(0, Math.min(100, (used / total) * 100));
  }

  // ─────────────── Shelf-алгоритм ───────────────
  // Сортируем по высоте (убывание). Кладём рядами слева-направо,
  // сверху-вниз. Высота ряда = высота первой детали в ряду.
  // Поворот: если повёрнутая деталь лучше вписывается — поворачиваем.

  _packShelf(parts) {
    const mx = this.margin;
    const my = this.margin;
    const ew = this.width - 2 * mx;
    const eh = this.height - 2 * my;
    const k = this.kerf;

    // Копируем и сортируем по высоте (убывание). Для поворота —
    // ориентируем так, чтобы h <= w (landscape) для лучшей упаковки.
    const sorted = parts.map(p => {
      let w = p.w, h = p.h;
      // Если разрешён поворот и деталь "высокая" — поворачиваем в landscape
      if (this.allowRotation && h > w) { [w, h] = [h, w]; }
      return { ...p, w, h, origW: p.w, origH: p.h };
    }).sort((a, b) => b.h - a.h);

    const placed = [];
    const unplaced = [];
    let curY = my;
    let curRowH = 0;

    for (const p of sorted) {
      const pw = p.w + k;
      const ph = p.h + k;

      // Помещается ли в текущий ряд?
      let curX = mx;
      // Считаем ширину, занятую в текущем ряду
      let rowW = 0;
      for (const pl of placed) {
        if (Math.abs(pl.y - curY) < EPS) {
          rowW = Math.max(rowW, pl.x + pl.w + k - mx);
        }
      }
      curX = mx + rowW;

      if (curX + pw <= mx + ew + EPS && curY + ph <= my + eh + EPS) {
        // Помещается в текущий ряд
        placed.push({
          x: curX, y: curY,
          w: p.w, h: p.h,
          rotated: (p.w !== p.origW),
          id: p.id, label: p.label, index: p.index,
        });
        curRowH = Math.max(curRowH, ph);
      } else {
        // Не помещается в текущий ряд — пробуем новый ряд
        const newY = curY + curRowH;
        if (newY + ph <= my + eh + EPS && pw <= ew + EPS) {
          curY = newY;
          curRowH = ph;
          placed.push({
            x: mx, y: curY,
            w: p.w, h: p.h,
            rotated: (p.w !== p.origW),
            id: p.id, label: p.label, index: p.index,
          });
        } else {
          // Совсем не помещается — пробуем поворот
          if (this.allowRotation) {
            const rw = p.h + k;
            const rh = p.w + k;
            // Пробуем в новый ряд
            const newY2 = curY + curRowH;
            if (newY2 + rh <= my + eh + EPS && rw <= ew + EPS) {
              curY = newY2;
              curRowH = rh;
              placed.push({
                x: mx, y: curY,
                w: p.h, h: p.w,
                rotated: true,
                id: p.id, label: p.label, index: p.index,
              });
              continue;
            }
          }
          unplaced.push(p);
        }
      }
    }

    return { placed, unplaced, free: [] };
  }

  // ─────────────── MaxRects-BSSF ───────────────
  // Классический MaxRects с Best Short Side Fit.
  // Поворот пробуется только если деталь не влезает нормально.

  _packMaxRects(parts) {
    const mx = this.margin;
    const my = this.margin;
    const ew = this.width - 2 * mx;
    const eh = this.height - 2 * my;

    let free = [{ x: mx, y: my, w: Math.max(0, ew), h: Math.max(0, eh) }];
    const placed = [];
    const unplaced = [];

    // Сортируем по max(w,h) убывание
    const sorted = parts.slice().sort((a, b) => {
      return Math.max(b.w, b.h) - Math.max(a.w, a.h);
    });

    for (const p of sorted) {
      const fw = (p.w || 0) + this.kerf;
      const fh = (p.h || 0) + this.kerf;

      const best = this._findBestBSSF(free, fw, fh, this.allowRotation);
      if (!best) {
        unplaced.push(p);
        continue;
      }

      const placedPart = {
        x: best.rect.x,
        y: best.rect.y,
        w: best.rotated ? p.h : p.w,
        h: best.rotated ? p.w : p.h,
        rotated: best.rotated,
        id: p.id, label: p.label, index: p.index,
      };
      placed.push(placedPart);

      // Вычитаем занятый прямоугольник
      const used = { x: best.rect.x, y: best.rect.y, w: fw, h: fh };
      free = this._splitFree(free, used);
      free = this._pruneFree(free);
    }

    return { placed, unplaced, free };
  }

  _findBestBSSF(freeList, fw, fh, allowRotation) {
    let best = null;
    let bestShort = Infinity;
    let bestLong = Infinity;

    for (const r of freeList) {
      // Нормальная ориентация
      if (r.w >= fw - EPS && r.h >= fh - EPS) {
        const lw = r.w - fw;
        const lh = r.h - fh;
        const short = Math.min(lw, lh);
        const long = Math.max(lw, lh);
        if (short < bestShort - EPS || (Math.abs(short - bestShort) < EPS && long < bestLong - EPS)) {
          bestShort = short;
          bestLong = long;
          best = { rect: r, rotated: false };
        }
        continue;
      }
      // Поворот
      if (allowRotation && r.w >= fh - EPS && r.h >= fw - EPS) {
        const lw = r.w - fh;
        const lh = r.h - fw;
        const short = Math.min(lw, lh);
        const long = Math.max(lw, lh);
        if (short < bestShort - EPS || (Math.abs(short - bestShort) < EPS && long < bestLong - EPS)) {
          bestShort = short;
          bestLong = long;
          best = { rect: r, rotated: true };
        }
      }
    }
    return best;
  }

  _splitFree(freeList, used) {
    const next = [];
    for (const f of freeList) {
      const inter = _intersect(f, used);
      if (!inter) { next.push(f); continue; }
      if (inter.x > f.x + EPS) next.push({ x: f.x, y: f.y, w: inter.x - f.x, h: f.h });
      if (inter.x + inter.w < f.x + f.w - EPS) next.push({ x: inter.x + inter.w, y: f.y, w: f.x + f.w - (inter.x + inter.w), h: f.h });
      if (inter.y > f.y + EPS) next.push({ x: f.x, y: f.y, w: f.w, h: inter.y - f.y });
      if (inter.y + inter.h < f.y + f.h - EPS) next.push({ x: f.x, y: inter.y + inter.h, w: f.w, h: f.y + f.h - (inter.y + inter.h) });
    }
    return next.filter(r => r.w > EPS && r.h > EPS);
  }

  _pruneFree(list) {
    const keep = [];
    for (let i = 0; i < list.length; i++) {
      let contained = false;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        if (_contains(list[j], list[i])) { contained = true; break; }
      }
      if (!contained) keep.push(list[i]);
    }
    return keep;
  }
}

function _intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x + EPS || y2 <= y + EPS) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

function _contains(a, b) {
  return b.x >= a.x - EPS && b.y >= a.y - EPS &&
    b.x + b.w <= a.x + a.w + EPS && b.y + b.h <= a.y + a.h + EPS;
}

export default BinPacker;
