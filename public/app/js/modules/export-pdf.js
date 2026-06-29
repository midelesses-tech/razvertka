/**
 * export-pdf.js
 * Экспорт в PDF через jsPDF (динамическая загрузка с CDN).
 *
 * ВАЖНО: jsPDF со стандартными шрифтами НЕ поддерживает кириллицу.
 * Все текстовые подписи — на английском.
 */

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

let _jspdfPromise = null;

function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfPromise) return _jspdfPromise;
  _jspdfPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSPDF_CDN;
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF not loaded'));
    };
    script.onerror = () => reject(new Error('jsPDF CDN failed'));
    document.head.appendChild(script);
  });
  return _jspdfPromise;
}

const SITE_NAME = 'гибка-раскрой.рф';
const PROFILE_NAMES = { L: 'Angle (L)', U: 'Channel (U)', G: 'G-profile', C: 'C-profile', custom: 'Custom' };

/**
 * Экспорт развёртки в PDF.
 */
export async function exportUnfoldPDF(data, filename = 'unfold.pdf') {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const centerX = pageW / 2;

  // === Заголовок ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Flat Pattern — ' + (PROFILE_NAMES[data.profile] || data.profile || ''), margin, 16);

  // === Данные (слева вверху) ===
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let yText = 26;
  doc.text(`Thickness S: ${data.thickness ?? '—'} mm`, margin, yText); yText += 6;
  doc.text(`Total length L: ${(data.totalLength ?? 0).toFixed(2)} mm`, margin, yText); yText += 6;
  doc.text(`Bends: ${data.bendCount ?? 0}`, margin, yText); yText += 6;
  doc.text(`Arc length (BA): ${(data.ba ?? 0).toFixed(3)} mm`, margin, yText); yText += 6;

  const f = data.flats || {};
  const flatsArr = [];
  if (f.La) flatsArr.push(`La=${f.La.toFixed(1)}`);
  if (f.Lb) flatsArr.push(`Lb=${f.Lb.toFixed(1)}`);
  if (f.Lc) flatsArr.push(`Lc=${f.Lc.toFixed(1)}`);
  if (f.Ld) flatsArr.push(`Ld=${f.Ld.toFixed(1)}`);
  if (f.Le) flatsArr.push(`Le=${f.Le.toFixed(1)}`);
  if (flatsArr.length) {
    doc.text(`Flats: ${flatsArr.join('  ')} mm`, margin, yText); yText += 6;
  }

  const bendDists = [];
  let cum = 0;
  for (const seg of data.segments || []) {
    if (seg.type === 'flat') cum += seg.length || 0;
    else if (seg.type === 'bend') { bendDists.push(cum + (seg.ba || 0) / 2); cum += seg.ba || 0; }
  }
  if (bendDists.length) {
    doc.text(`Bend centers: ${bendDists.map((d, i) => `L${i+1}=${d.toFixed(1)}`).join('  ')} mm`, margin, yText); yText += 6;
  }

  // === Сечение профиля (по центру, ниже данных) ===
  const secTopY = yText + 8;
  const secAreaW = pageW - margin * 2;
  const secAreaH = 60;
  const secCenterX = centerX;
  const secCenterY = secTopY + secAreaH / 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Profile Section', margin, secTopY - 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Рисуем сечение по segments, центрируя
  const segs = data.segments || [];
  const flatSegs = segs.filter(s => s.type === 'flat');
  const maxLen = Math.max(...flatSegs.map(s => s.length || 0), 10);
  const totalLen = flatSegs.reduce((a, s) => a + (s.length || 0), 0);
  const secScale = Math.min(secAreaW / (totalLen * 1.2), secAreaH / (maxLen * 1.5));

  // Сначала вычисляем все точки, потом сдвигаем чтобы центрировать
  // ВАЖНО: итерируем ВСЕ segments (включая bends) для отслеживания направления
  const startDir = data.startDir || 0;
  let drawX = 0, drawY = 0, dir = startDir;
  const points = [{ x: 0, y: 0 }];
  const labelPoints = [];
  let flatIdx = 0;
  const letters = ['a','b','c','d','e','f','g','h'];

  for (const seg of segs) {
    if (seg.type === 'flat') {
      const len = (seg.length || 0) * secScale;
      const rad = dir * Math.PI / 180;
      const nx = drawX + len * Math.cos(rad);
      const ny = drawY + len * Math.sin(rad);
      // Метка буквы в середине сегмента
      const midX = drawX + (len / 2) * Math.cos(rad);
      const midY = drawY + (len / 2) * Math.sin(rad);
      const perpRad = (dir + 90) * Math.PI / 180;
      const lblX = midX + 5 * Math.cos(perpRad);
      const lblY = midY + 5 * Math.sin(perpRad);
      labelPoints.push({ x: lblX, y: lblY, letter: letters[flatIdx] || '?' });
      drawX = nx; drawY = ny;
      points.push({ x: drawX, y: drawY });
      flatIdx++;
    } else if (seg.type === 'bend') {
      // Меняем направление (sign=-1 = против часовой = "вверх" в SVG/PDF)
      const sign = seg.sign ?? -1;
      dir = dir + sign * (seg.angle || 90);
    }
  }

  // Находим bounding box
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const offX = secCenterX - (Math.min(...xs) + Math.max(...xs)) / 2;
  const offY = secCenterY - (Math.min(...ys) + Math.max(...ys)) / 2;

  // Рисуем линии сечения
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.6);
  for (let i = 1; i < points.length; i++) {
    doc.line(
      points[i-1].x + offX, points[i-1].y + offY,
      points[i].x + offX, points[i].y + offY
    );
  }

  // Точки в вершинах
  doc.setFillColor(217, 119, 6);
  for (const p of points) {
    doc.circle(p.x + offX, p.y + offY, 0.8, 'F');
  }

  // Буквы на сегментах
  doc.setFontSize(8);
  doc.setTextColor(30, 25, 23);
  for (const lp of labelPoints) {
    doc.text(lp.letter, lp.x + offX, lp.y + offY, { align: 'center' });
  }

  // === Плоская развёртка (по центру, ниже сечения) ===
  const stripTopY = secTopY + secAreaH + 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Flat Pattern', margin, stripTopY - 2);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const L = data.totalLength || 0;
  const maxDrawW = pageW - margin * 2;
  const scaleX = Math.min(1, maxDrawW / Math.max(1, L));
  const drawW = Math.max(20, L * scaleX);
  const drawH = Math.max(3, Math.min(10, (data.thickness || 2) * 5));
  const stripX = margin + (maxDrawW - drawW) / 2;
  const stripY = stripTopY + 4;

  // Контур развёртки
  doc.setDrawColor(217, 119, 6);
  doc.setFillColor(254, 243, 199);
  doc.setLineWidth(0.4);
  doc.rect(stripX, stripY, drawW, drawH, 'FD');

  // Средняя линия
  doc.setDrawColor(120, 113, 108);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([4, 1.5, 0.5, 1.5], 0);
  doc.line(stripX, stripY + drawH / 2, stripX + drawW, stripY + drawH / 2);
  doc.setLineDashPattern([], 0);

  // Линии гибов + буквы
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.3);
  let x = 0;
  let unfoldFlatIdx = 0;
  const unfoldLetters = ['a','b','c','d','e','f','g','h'];
  for (const seg of segs) {
    if (seg.type === 'flat') {
      // Буква в середине
      const midX = stripX + x + (seg.length || 0) * scaleX / 2;
      doc.setFontSize(7);
      doc.setTextColor(30, 25, 23);
      doc.text(unfoldLetters[unfoldFlatIdx] || '?', midX, stripY - 2, { align: 'center' });
      x += (seg.length || 0) * scaleX;
      unfoldFlatIdx++;
    } else {
      const ba = (seg.ba || 0) * scaleX;
      const bendX = stripX + x + ba / 2;
      doc.setLineDashPattern([2, 1.5], 0);
      doc.line(bendX, stripY - 2, bendX, stripY + drawH + 2);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(7);
      doc.text(`${seg.angle || 90}°`, bendX, stripY + drawH + 4, { align: 'center' });
      x += ba;
    }
  }

  // Размерная линия L
  const dimY = stripY + drawH + 10;
  doc.setLineWidth(0.2);
  doc.setDrawColor(120, 113, 108);
  doc.line(stripX, dimY, stripX + drawW, dimY);
  doc.line(stripX, dimY - 2, stripX, dimY + 2);
  doc.line(stripX + drawW, dimY - 2, stripX + drawW, dimY + 2);
  doc.setFontSize(9);
  doc.text(`L = ${L.toFixed(2)} mm`, stripX + drawW / 2, dimY - 2, { align: 'center' });

  // === Подвал ===
  doc.setFontSize(7);
  doc.setTextColor(120, 113, 108);
  doc.text(SITE_NAME, margin, pageH - 8);

  doc.save(filename);
}

/**
 * Экспорт раскроя в PDF.
 */
export async function exportNestingPDF(result, filename = 'nesting.pdf') {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  const sheets = (result && Array.isArray(result.sheets)) ? result.sheets : [];

  for (let si = 0; si < sheets.length; si++) {
    if (si > 0) doc.addPage();
    const sheet = sheets[si];

    // Заголовок
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`Nesting — Sheet ${si + 1} / ${sheets.length}`, margin, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Sheet: ${sheet.width} x ${sheet.height} mm`, margin, 20);
    const util = typeof sheet.utilization === 'number' ? sheet.utilization : 0;
    doc.text(`Utilization: ${(util * 100).toFixed(1)}%`, margin, 26);
    doc.text(`Parts placed: ${sheet.placed.length}`, margin, 32);

    // Область рисования
    const drawAreaY = 40;
    const drawAreaH = pageH - drawAreaY - 16;
    const drawAreaW = pageW - margin * 2;

    const scale = Math.min(drawAreaW / sheet.width, drawAreaH / sheet.height);
    const sheetDrawW = sheet.width * scale;
    const sheetDrawH = sheet.height * scale;
    const sheetX = margin + (drawAreaW - sheetDrawW) / 2;
    const sheetY = drawAreaY + (drawAreaH - sheetDrawH) / 2;

    // Лист (контур + заливка)
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.setFillColor(247, 246, 244);
    doc.rect(sheetX, sheetY, sheetDrawW, sheetDrawH, 'FD');

    // Размеры листа
    doc.setFontSize(8);
    doc.setTextColor(217, 119, 6);
    doc.text(`${sheet.width} mm`, sheetX + sheetDrawW / 2, sheetY + sheetDrawH + 4, { align: 'center' });
    doc.text(`${sheet.height} mm`, sheetX - 4, sheetY + sheetDrawH / 2, { align: 'center', angle: 90 });

    // Детали — ВАЖНО: setFillColor перед каждым rect (jsPDF сбрасывает после text)
    for (let i = 0; i < sheet.placed.length; i++) {
      const p = sheet.placed[i];
      const pxW = (p.w || 0) * scale;
      const pxH = (p.h || 0) * scale;
      const px = sheetX + (p.x || 0) * scale;
      const py = sheetY + sheetDrawH - ((p.y || 0) + (p.h || 0)) * scale;

      // Заливка и контур детали — ПЕРЕД каждым rect
      doc.setDrawColor(217, 119, 6);
      doc.setFillColor(254, 243, 199);
      doc.setLineWidth(0.3);
      doc.rect(px, py, pxW, pxH, 'FD');

      // Номер детали
      const fs = Math.max(5, Math.min(10, Math.min(pxW, pxH) * 0.35));
      doc.setFontSize(fs);
      doc.setTextColor(0, 0, 0);
      doc.text(String(i + 1), px + pxW / 2, py + pxH / 2, { align: 'center' });

      // Размер детали
      if (pxW > 15 && pxH > 8) {
        doc.setFontSize(Math.max(5, fs * 0.7));
        doc.text(`${Math.round(p.w)}x${Math.round(p.h)}`, px + pxW / 2, py + pxH / 2 + fs + 1, { align: 'center' });
      }
    }

    // Подвал
    doc.setFontSize(7);
    doc.setTextColor(120, 113, 108);
    doc.text(SITE_NAME, margin, pageH - 6);
  }

  doc.save(filename);
}

export default { exportUnfoldPDF, exportNestingPDF };
