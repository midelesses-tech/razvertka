/**
 * bin-packer.js
 * Упаковка прямоугольных деталей на лист — алгоритм MaxRects-BSSF
 * (Best Short Side Fit).
 *
 * Концепция:
 *   - Свободное пространство листа представлено списком «maximal rectangles»
 *     (непересекающихся свободных прямоугольников, на которые мы можем класть).
 *   - Для каждой новой детали ищем лучшее свободное место по эвристике BSSF
 *     (минимум короткой оставшейся стороны). Если allowRotation — пробуем
 *     повёрнутую ориентацию.
 *   - После размещения деталь «вычитается» из свободных прямоугольников:
 *     каждый затронутый free-rect разбивается на 1–4 новых.
 *   - Kerf (припуск на рез) добавляется к габаритам детали при упаковке.
 *   - Margin (отступ от края листа) задаёт эффективную рабочую область.
 */

/**
 * @typedef {Object} BinOptions
 * @property {number} width   ширина листа (X), мм
 * @property {number} height  высота листа (Y), мм
 * @property {number} kerf    припуск на рез между деталями, мм
 * @property {number} margin  отступ от края листа, мм
 * @property {boolean} allowRotation  разрешить поворот детали на 90°
 */

/**
 * @typedef {Object} Part
 * @property {number} w   ширина детали, мм
 * @property {number} h   высота детали, мм
 * @property {number} qty количество (для разворачивания в плоский список)
 * @property {string} [id]
 * @property {string} [label]
 * @property {number} [index]  порядковый номер экземпляра
 */

/**
 * @typedef {Object} PlacedPart
 * @property {number} x       левый-нижний угол, мм
 * @property {number} y
 * @property {number} w       итоговая ширина (с учётом поворота)
 * @property {number} h       итоговая высота (с учётом поворота)
 * @property {boolean} rotated
 * @property {string} [id]
 * @property {string} [label]
 * @property {number} [index]
 */

/** Допуск при сравнении координат, мм. */
const EPS = 1e-6;

export class BinPacker {
  /**
   * @param {BinOptions} opts
   */
  constructor(opts) {
    this.width = Math.max(0, opts.width || 0);
    this.height = Math.max(0, opts.height || 0);
    this.kerf = Math.max(0, opts.kerf || 0);
    this.margin = Math.max(0, opts.margin || 0);
    this.allowRotation = opts.allowRotation !== false;

    // Эффективная рабочая область (с учётом margin).
    const mx = this.margin, my = this.margin;
    this._free = [{
      x: mx,
      y: my,
      w: Math.max(0, this.width - 2 * mx),
      h: Math.max(0, this.height - 2 * my),
    }];
    /** @type {PlacedPart[]} */
    this._placed = [];
  }

  /**
   * Вставить одну деталь (один экземпляр).
   * @param {{w:number,h:number,id?:string,label?:string,index?:number}} part
   * @returns {PlacedPart|null} размещение или null, если не поместилось
   */
  insertOne(part) {
    const fw = (part.w || 0) + this.kerf;
    const fh = (part.h || 0) + this.kerf;

    // ищем лучшее место по BSSF
    const best = this._findBestBSSF(fw, fh, this.allowRotation);
    if (!best) return null;

    const placed = {
      x: best.rect.x,
      y: best.rect.y,
      w: best.rotated ? part.h : part.w,
      h: best.rotated ? part.w : part.h,
      rotated: best.rotated,
    };
    if (part.id != null) placed.id = part.id;
    if (part.label != null) placed.label = part.label;
    if (part.index != null) placed.index = part.index;

    // вычитаем занятый прямоугольник из свободных
    // занятая область = placed + kerf-«облако» справа и сверху
    const usedRect = {
      x: best.rect.x,
      y: best.rect.y,
      w: fw,
      h: fh,
    };
    this._placeRect(usedRect);

    this._placed.push(placed);
    return placed;
  }

  /**
   * Вставить много деталей с разворачиванием qty в плоский список.
   * @param {Part[]} parts  каждый элемент { w, h, qty, id, label }
   * @returns {{placed:PlacedPart[], unplaced:Part[]}}
   */
  insertMany(parts) {
    /** @type {PlacedPart[]} */
    const placed = [];
    /** @type {Part[]} */
    const unplaced = [];

    for (const p of parts || []) {
      const qty = Math.max(0, Math.floor(p.qty || 0));
      for (let i = 0; i < qty; i++) {
        const single = { w: p.w, h: p.h, id: p.id, label: p.label, index: i + 1 };
        const res = this.insertOne(single);
        if (res) placed.push(res);
        else unplaced.push({ ...p, qty: 1 });
      }
    }
    return { placed, unplaced };
  }

  /**
   * Вставить много деталей БЕЗ разворачивания qty — каждый элемент
   * считается одной деталью (полезно, когда список уже «плоский»).
   * @param {Array<{w:number,h:number,id?:string,label?:string,index?:number}>} parts
   * @returns {{placed:PlacedPart[], unplaced:object[]}}
   */
  insertManyNoQty(parts) {
    const placed = [];
    const unplaced = [];
    for (const p of parts || []) {
      const res = this.insertOne(p);
      if (res) placed.push(res);
      else unplaced.push(p);
    }
    return { placed, unplaced };
  }

  /** Все размещённые детали. */
  getPlaced() {
    return this._placed.slice();
  }

  /**
   * Текущие свободные прямоугольники (для подсветки отходов).
   * @returns {Array<{x:number,y:number,w:number,h:number}>}
   */
  getFreeRects() {
    return this._free.map((r) => ({ ...r }));
  }

  /**
   * Коэффициент использования листа, %.
   */
  getUtilization() {
    const used = this._placed.reduce((s, p) => s + p.w * p.h, 0);
    const total = (this.width - 2 * this.margin) * (this.height - 2 * this.margin);
    if (total <= EPS) return 0;
    return Math.max(0, Math.min(100, (used / total) * 100));
  }

  // ───────────────────────── MaxRects-BSSF internals ─────────────────────────

  /**
   * Найти лучший свободный прямоугольник под деталь (fw, fh)
   * по эвристике Best Short Side Fit.
   * @returns {{rect:{x,y,w,h}, rotated:boolean}|null}
   */
  _findBestBSSF(fw, fh, allowRotation) {
    let best = null;
    let bestShort = Infinity;
    let bestLong = Infinity;

    for (const r of this._free) {
      // Пробуем нормальную ориентацию
      if (r.w >= fw - EPS && r.h >= fh - EPS) {
        const leftoverW = r.w - fw;
        const leftoverH = r.h - fh;
        const short = Math.min(leftoverW, leftoverH);
        const long = Math.max(leftoverW, leftoverH);
        if (short < bestShort - EPS || (Math.abs(short - bestShort) < EPS && long < bestLong - EPS)) {
          bestShort = short;
          bestLong = long;
          best = { rect: r, rotated: false };
        }
      }
      // Пробуем повёрнутую ориентацию (даже если нормальная влезает — поворот может быть лучше)
      if (allowRotation && r.w >= fh - EPS && r.h >= fw - EPS) {
        const leftoverW = r.w - fh;
        const leftoverH = r.h - fw;
        const short = Math.min(leftoverW, leftoverH);
        const long = Math.max(leftoverW, leftoverH);
        if (short < bestShort - EPS || (Math.abs(short - bestShort) < EPS && long < bestLong - EPS)) {
          bestShort = short;
          bestLong = long;
          best = { rect: r, rotated: true };
        }
      }
    }
    return best;
  }

  /**
   * Вычесть занятый прямоугольник из всех свободных:
   * каждый free-rect, пересекающийся с used, разбивается на 1–4 новых.
   * Затем удаляем дубликаты и «вкладыванные» прямоугольники.
   */
  _placeRect(used) {
    const next = [];
    for (const f of this._free) {
      const inter = _intersect(f, used);
      if (!inter) {
        next.push(f);
        continue;
      }
      // разрезаем f на до 4 непересекающихся областей
      if (inter.x > f.x + EPS) {
        next.push({ x: f.x, y: f.y, w: inter.x - f.x, h: f.h });
      }
      if (inter.x + inter.w < f.x + f.w - EPS) {
        next.push({ x: inter.x + inter.w, y: f.y, w: f.x + f.w - (inter.x + inter.w), h: f.h });
      }
      if (inter.y > f.y + EPS) {
        next.push({ x: f.x, y: f.y, w: f.w, h: inter.y - f.y });
      }
      if (inter.y + inter.h < f.y + f.h - EPS) {
        next.push({ x: f.x, y: inter.y + inter.h, w: f.w, h: f.y + f.h - (inter.y + inter.h) });
      }
    }
    // отбрасываем нулевые/отрицательные
    this._free = next.filter((r) => r.w > EPS && r.h > EPS);
    // убираем дубликаты и полностью вложенные прямоугольники
    this._pruneFree();
  }

  /**
   * Удалить прямоугольники, полностью содержащиеся в других.
   * Уменьшает количество свободных прямоугольников со временем.
   */
  _pruneFree() {
    const keep = [];
    const list = this._free;
    for (let i = 0; i < list.length; i++) {
      let contained = false;
      for (let j = 0; j < list.length; j++) {
        if (i === j) continue;
        if (_contains(list[j], list[i])) {
          contained = true;
          break;
        }
      }
      if (!contained) keep.push(list[i]);
    }
    this._free = keep;
  }
}

// ───────────────────────── helpers ─────────────────────────

/** Пересечение двух прямоугольников (или null). */
function _intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  if (x2 <= x + EPS || y2 <= y + EPS) return null;
  return { x, y, w: x2 - x, h: y2 - y };
}

/** Содержится ли b полностью внутри a (с допуском). */
function _contains(a, b) {
  return (
    b.x >= a.x - EPS &&
    b.y >= a.y - EPS &&
    b.x + b.w <= a.x + a.w + EPS &&
    b.y + b.h <= a.y + a.h + EPS
  );
}

export default BinPacker;
