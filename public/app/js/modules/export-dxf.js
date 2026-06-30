/**
 * export-dxf.js
 * Простой генератор DXF (AutoCAD R12/ASCII) — LWPOLYLINE, LINE, TEXT.
 *
 * Слои: 0 (общий), BEND (линии сгиба), SHEET (граница листа),
 * PART_N (контур N-й детали). Координаты — в миллиметрах, начало —
 * левый-нижний угол (Y вверх).
 *
 * Это минимальный, но совместимый с AutoCAD/Компас подмножество DXF.
 */

import { downloadBlob } from './export-svg.js';

/**
 * Построить DXF из массива сущностей.
 * @param {Array<Entity>} entities
 * @returns {string}  DXF-текст
 *
 * @typedef {Object} Entity
 * @property {'lwpolyline'|'line'|'text'} type
 * @property {string} layer  имя слоя
 * @property {Array<[number,number]>} [points]  для lwpolyline/line
 * @property {boolean} [closed]  для lwpolyline
 * @property {string} [text]  для text
 * @property {[number,number]} [position]  для text
 * @property {number} [height]  для text
 * @property {number} [rotation]  для text
 */
export function buildDXF(entities) {
  const L = [];
  // заголовок секции
  L.push('0', 'SECTION', '2', 'HEADER');
  L.push('9', '$ACADVER', '1', 'AC1009'); // R12
  L.push('9', '$INSBASE', '10', '0.0', '20', '0.0', '30', '0.0');
  L.push('0', 'ENDSEC');

  // таблица слоёв
  L.push('0', 'SECTION', '2', 'TABLES');
  L.push('0', 'TABLE', '2', 'LAYER', '70', '4');
  for (const lyr of ['0', 'BEND', 'SHEET', 'PARTS', 'TEXT']) {
    L.push('0', 'LAYER', '2', lyr, '70', '0', '62', _layerColor(lyr), '6', 'CONTINUOUS');
  }
  L.push('0', 'ENDTAB', '0', 'ENDSEC');

  // сущности
  L.push('0', 'SECTION', '2', 'ENTITIES');
  for (const e of entities) {
    if (e.type === 'lwpolyline') L.push(...lwpolyline(e.points, e.layer, e.closed));
    else if (e.type === 'line') L.push(...line(e.points[0], e.points[1], e.layer));
    else if (e.type === 'text') L.push(...text(e.text, e.position, e.height || 5, e.rotation || 0, e.layer));
  }
  L.push('0', 'ENDSEC');

  L.push('0', 'EOF');
  return L.join('\n');
}

function _layerColor(name) {
  switch (name) {
    case 'BEND': return 1;   // красный
    case 'SHEET': return 7;  // белый/чёрный
    case 'PARTS': return 5;  // синий
    case 'TEXT': return 2;   // жёлтый
    default: return 7;
  }
}

/**
 * LWPOLYLINE — лёгкая полилиния.
 * @param {Array<[number,number]>} pts
 * @param {string} layer
 * @param {boolean} closed
 */
export function lwpolyline(pts, layer = '0', closed = false) {
  const out = ['0', 'LWPOLYLINE', '8', layer, '90', String(pts.length), '70', closed ? '1' : '0'];
  for (const [x, y] of pts) {
    out.push('10', _fmt(x), '20', _fmt(y));
  }
  return out;
}

/**
 * LINE — отрезок.
 * @param {[number,number]} p1
 * @param {[number,number]} p2
 * @param {string} layer
 */
export function line(p1, p2, layer = '0') {
  return ['0', 'LINE', '8', layer, '10', _fmt(p1[0]), '20', _fmt(p1[1]), '11', _fmt(p2[0]), '21', _fmt(p2[1])];
}

/**
 * TEXT — однострочный текст.
 * @param {string} txt
 * @param {[number,number]} position
 * @param {number} height
 * @param {number} rotation  градусов
 * @param {string} layer
 */
export function text(txt, position, height = 5, rotation = 0, layer = 'TEXT') {
  return [
    '0', 'TEXT', '8', layer,
    '10', _fmt(position[0]), '20', _fmt(position[1]),
    '40', _fmt(height),
    '1', String(txt),
    '50', _fmt(rotation),
  ];
}

/**
 * Сгенерировать DXF для развёртки.
 * @param {{
 *   segments: Array<{type:'flat'|'bend',length?:number,ba?:number,angle?:number,label?:string,tag?:string}>,
 *   totalLength: number,
 *   thickness: number,
 *   profile: string,
 * }} data
 * @returns {string} DXF-текст
 */
export function generateUnfoldDXF(data) {
  /** @type {Entity[]} */
  const ents = [];
  // развёртка — один длинный прямоугольник высотой = толщина,
  // длиной = totalLength. Координаты: (0,0) — левый-нижний.
  const S = data.thickness || 2;
  const L = data.totalLength || 0;
  ents.push({
    type: 'lwpolyline',
    layer: '0',
    closed: true,
    points: [[0, 0], [L, 0], [L, S], [0, S]],
  });

  // линии сгиба — вертикальные на тех X, где гибы
  let x = 0;
  for (const seg of data.segments || []) {
    if (seg.type === 'flat') {
      x += seg.length || 0;
    } else {
      const ba = seg.ba || 0;
      const bendX = x + ba / 2;
      ents.push({
        type: 'line',
        layer: 'BEND',
        points: [[bendX, 0], [bendX, S]],
      });
      // метка угла гиба
      ents.push({
        type: 'text',
        layer: 'TEXT',
        text: `${seg.angle || 90}°`,
        position: [bendX, S + 3],
        height: 5,
        rotation: 0,
      });
      x += ba;
    }
  }

  // общая длина
  ents.push({
    type: 'text',
    layer: 'TEXT',
    text: `L = ${_fmt(L)} mm`,
    position: [L / 2, -8],
    height: 6,
  });

  return buildDXF(ents);
}

/**
 * Сгенерировать DXF для раскроя.
 * @param {{sheets: Array<{width:number,height:number,placed:Array<{x,y,w,h,rotated}>,utilization:number}>}} result
 * @returns {string} DXF-текст
 */
export function generateNestingDXF(result) {
  /** @type {Entity[]} */
  const ents = [];
  const sheets = (result && Array.isArray(result.sheets)) ? result.sheets : [];
  let yOffset = 0;
  for (const sheet of sheets) {
    // граница листа
    ents.push({
      type: 'lwpolyline',
      layer: 'SHEET',
      closed: true,
      points: [
        [0, yOffset],
        [sheet.width, yOffset],
        [sheet.width, yOffset + sheet.height],
        [0, yOffset + sheet.height],
      ],
    });
    // детали
    for (let i = 0; i < sheet.placed.length; i++) {
      const p = sheet.placed[i];
      const x0 = p.x, y0 = yOffset + p.y;
      const x1 = x0 + p.w, y1 = y0 + p.h;
      ents.push({
        type: 'lwpolyline',
        layer: 'PARTS',
        closed: true,
        points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
      });
      // метка номера
      ents.push({
        type: 'text',
        layer: 'TEXT',
        text: String(i + 1),
        position: [(x0 + x1) / 2, (y0 + y1) / 2],
        height: Math.min(p.w, p.h) * 0.3,
      });
    }
    // метка листа
    ents.push({
      type: 'text',
      layer: 'TEXT',
      text: `Sheet ${sheet.index} - ${sheet.utilization.toFixed(1)}%`,
      position: [10, yOffset + sheet.height + 10],
      height: 10,
    });
    yOffset += sheet.height + 30;
  }
  return buildDXF(ents);
}

/**
 * Скачать DXF-файл.
 * @param {string} dxfText  содержимое
 * @param {string} filename  имя файла
 */
export function downloadDXF(dxfText, filename) {
  downloadBlob(dxfText, filename || 'export.dxf', 'application/dxf;charset=utf-8');
}

// ───────────────────────── helpers ─────────────────────────

function _fmt(v) {
  if (!Number.isFinite(v)) return '0.0';
  return (Math.round(v * 1000) / 1000).toString();
}

export default { buildDXF, lwpolyline, line, text, generateUnfoldDXF, generateNestingDXF, downloadDXF };
