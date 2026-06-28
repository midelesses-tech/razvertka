/**
 * export-pdf.js
 * Экспорт в PDF через jsPDF (динамическая загрузка с CDN).
 *
 * ВАЖНО: jsPDF со стандартными шрифтами НЕ поддерживает кириллицу.
 * Все текстовые подписи — на английском.
 *
 * Unfold PDF: сечение профиля (схема) + плоская развёртка + данные.
 * Nesting PDF: лист с деталями (правильные координаты из результата).
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

/**
 * Экспорт развёртки в PDF.
 * @param {object} data — результат расчёта (segments, totalLength, thickness, profile, flats, ba, bd, bendCount)
 * @param {string} filename
 */
export async function exportUnfoldPDF(data, filename = 'unfold.pdf') {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  // === Заголовок ===
  const profileNames = { L: 'Angle (L)', U: 'Channel (U)', G: 'G-profile', C: 'C-profile', custom: 'Custom' };
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Flat Pattern — ' + (profileNames[data.profile] || data.profile || ''), margin, 16);

  // === Данные ===
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let yText = 26;
  doc.text(`Thickness S: ${data.thickness ?? '—'} mm`, margin, yText); yText += 6;
  doc.text(`Total length L: ${(data.totalLength ?? 0).toFixed(2)} mm`, margin, yText); yText += 6;
  doc.text(`Bends: ${data.bendCount ?? 0}`, margin, yText); yText += 6;
  doc.text(`Arc length (BA): ${(data.ba ?? 0).toFixed(3)} mm`, margin, yText); yText += 6;

  // Длины прямых участков
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

  // Длины до центров гибов
  const bendDists = [];
  let cum = 0;
  for (const seg of data.segments || []) {
    if (seg.type === 'flat') cum += seg.length || 0;
    else if (seg.type === 'bend') { bendDists.push(cum + (seg.ba || 0) / 2); cum += seg.ba || 0; }
  }
  if (bendDists.length) {
    doc.text(`Bend centers: ${bendDists.map((d, i) => `L${i+1}=${d.toFixed(1)}`).join('  ')} mm`, margin, yText); yText += 6;
  }

  // === Сечение профиля (схематично) ===
  yText += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Profile Section', margin, yText); yText += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  // Рисуем сечение схематично: L-профиль как пример
  const secTopY = yText;
  const secW = 60;
  const secH = 50;
  const secX = margin;
  const S = data.thickness || 2;

  // Простая схема: рисуем полки как линии
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.5);
  // Для разных профилей — разная схема, но рисуем упрощённо
  // Используем segments для построения
  const segs = data.segments || [];
  let drawX = secX;
  let drawY = secTopY + 5;
  let dir = 0; // 0=right, 90=down, 180=left, 270=up

  // Масштаб сечения
  const maxLen = Math.max(...segs.filter(s => s.type === 'flat').map(s => s.length || 0), 10);
  const secScale = Math.min(secW, secH) / (maxLen * 2);

  for (const seg of segs) {
    if (seg.type === 'flat') {
      const len = (seg.length || 0) * secScale;
      const rad = dir * Math.PI / 180;
      const nx = drawX + len * Math.cos(rad);
      const ny = drawY + len * Math.sin(rad);
      doc.line(drawX, drawY, nx, ny);
      drawX = nx;
      drawY = ny;
    } else if (seg.type === 'bend') {
      const sign = seg.sign ?? -1;
      dir = dir + sign * (seg.angle || 90);
      if (dir < 0) dir += 360;
      if (dir >= 360) dir -= 360;
    }
  }

  yText = secTopY + secH + 5;

  // === Плоская развёртка ===
  yText += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Flat Pattern', margin, yText); yText += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);

  const L = data.totalLength || 0;
  const maxDrawW = pageW - margin * 2;
  const scaleX = Math.min(1, maxDrawW / Math.max(1, L));
  const drawW = Math.max(20, L * scaleX);
  const drawH = Math.max(3, Math.min(12, (data.thickness || 2) * 5));
  const stripY = yText;
  const stripX = margin + (maxDrawW - drawW) / 2;

  // Контур развёртки
  doc.setDrawColor(217, 119, 6);
  doc.setFillColor(254, 243, 199);
  doc.setLineWidth(0.4);
  doc.rect(stripX, stripY, drawW, drawH, 'FD');

  // Штрихпунктирная средняя линия
  doc.setDrawColor(120, 113, 108);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([4, 1.5, 0.5, 1.5], 0);
  doc.line(stripX, stripY + drawH / 2, stripX + drawW, stripY + drawH / 2);
  doc.setLineDashPattern([], 0);

  // Линии гибов
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.3);
  let x = 0;
  for (const seg of segs) {
    if (seg.type === 'flat') {
      x += (seg.length || 0) * scaleX;
    } else {
      const ba = (seg.ba || 0) * scaleX;
      const bendX = stripX + x + ba / 2;
      doc.setLineDashPattern([2, 1.5], 0);
      doc.line(bendX, stripY - 3, bendX, stripY + drawH + 3);
      doc.setLineDashPattern([], 0);
      doc.setFontSize(7);
      doc.text(`${seg.angle || 90}°`, bendX, stripY - 4, { align: 'center' });
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
  doc.text('Generated by razvertka.ru — K-factor by R/S table', margin, pageH - 8);

  doc.save(filename);
}

/**
 * Экспорт раскроя в PDF.
 * @param {object} result — результат optimizeNesting
 * @param {string} filename
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
    const util = typeof sheet.utilization === 'number' ? sheet.utilization : (sheet.utilization || 0);
    doc.text(`Utilization: ${(util * 100).toFixed(1)}%`, margin, 26);
    doc.text(`Parts placed: ${sheet.placed.length}`, margin, 32);

    // Область рисования
    const drawAreaY = 40;
    const drawAreaH = pageH - drawAreaY - 16;
    const drawAreaW = pageW - margin * 2;

    // Масштаб: вписываем лист в область
    const scaleX = drawAreaW / sheet.width;
    const scaleY = drawAreaH / sheet.height;
    const scale = Math.min(scaleX, scaleY);

    const sheetDrawW = sheet.width * scale;
    const sheetDrawH = sheet.height * scale;
    const sheetX = margin + (drawAreaW - sheetDrawW) / 2;
    const sheetY = drawAreaY + (drawAreaH - sheetDrawH) / 2;

    // Лист (контур)
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.setFillColor(247, 246, 244);
    doc.rect(sheetX, sheetY, sheetDrawW, sheetDrawH, 'FD');

    // Размеры листа
    doc.setFontSize(8);
    doc.setTextColor(217, 119, 6);
    doc.text(`${sheet.width} mm`, sheetX + sheetDrawW / 2, sheetY + sheetDrawH + 4, { align: 'center' });
    doc.text(`${sheet.height} mm`, sheetX - 4, sheetY + sheetDrawH / 2, { align: 'center', angle: 90 });
    doc.setTextColor(0, 0, 0);

    // Детали — используем правильные координаты из placed
    doc.setDrawColor(217, 119, 6);
    doc.setFillColor(254, 243, 199);
    doc.setLineWidth(0.3);

    for (let i = 0; i < sheet.placed.length; i++) {
      const p = sheet.placed[i];

      // Координаты детали: p.x, p.y — левый-нижний угол в системе листа (Y снизу)
      // В PDF Y сверху → инвертируем
      const pxW = (p.w || 0) * scale;
      const pxH = (p.h || 0) * scale;
      // p.x — от левого края, p.y — от нижнего края
      // PDF: x = sheetX + p.x * scale
      //      y = sheetY + sheetDrawH - (p.y + p.h) * scale  (инвертируем Y)
      const px = sheetX + (p.x || 0) * scale;
      const py = sheetY + sheetDrawH - ((p.y || 0) + (p.h || 0)) * scale;

      doc.rect(px, py, pxW, pxH, 'FD');

      // Номер детали
      const fs = Math.max(5, Math.min(10, Math.min(pxW, pxH) * 0.35));
      doc.setFontSize(fs);
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
    doc.text('Generated by razvertka.ru', margin, pageH - 6);
  }

  doc.save(filename);
}

export default { exportUnfoldPDF, exportNestingPDF };
