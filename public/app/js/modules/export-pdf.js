/**
 * export-pdf.js
 * Экспорт в PDF через jsPDF (динамическая загрузка с CDN).
 *
 * Две функции: exportUnfoldPDF (развёртка), exportNestingPDF (раскрой).
 * Формат A4 landscape, единицы — мм.
 */

const JSPDF_CDN = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

let _jspdfPromise = null;

/** Динамически загрузить jsPDF (один раз). */
function loadJsPDF() {
  if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (_jspdfPromise) return _jspdfPromise;
  _jspdfPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = JSPDF_CDN;
    script.onload = () => {
      if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jsPDF не загрузился'));
    };
    script.onerror = () => reject(new Error('Не удалось загрузить jsPDF с CDN'));
    document.head.appendChild(script);
  });
  return _jspdfPromise;
}

/**
 * Экспорт развёртки в PDF.
 * @param {{
 *   segments: Array,
 *   totalLength: number,
 *   thickness: number,
 *   profile: string,
 *   kfactor?: number,
 *   ba?: number, bd?: number,
 * }} data
 * @param {string} filename
 */
export async function exportUnfoldPDF(data, filename = 'unfold.pdf') {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // заголовок
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Развёртка профиля', 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Профиль: ${data.profile || '—'}`, 14, 24);
  doc.text(`Толщина S: ${data.thickness ?? '—'} мм`, 14, 30);
  doc.text(`Полная длина L: ${(data.totalLength ?? 0).toFixed(2)} мм`, 14, 36);
  if (data.ba != null) doc.text(`BA: ${data.ba.toFixed(3)} мм`, 14, 42);
  if (data.bd != null) doc.text(`BD: ${data.bd.toFixed(3)} мм`, 14, 48);

  // схема развёртки — длинный прямоугольник
  const L = data.totalLength || 0;
  const S = data.thickness || 2;
  const margin = 14;
  const maxW = pageW - margin * 2;
  const maxH = pageH - 80;
  const scaleX = Math.min(1, maxW / Math.max(1, L));
  const drawW = Math.max(20, L * scaleX);
  const drawH = Math.max(2, Math.min(maxH, S * 4)); // толщину «утолщаем» для видимости
  const topY = 70;
  const leftX = margin;

  // контур развёртки
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.4);
  doc.rect(leftX, topY, drawW, drawH);

  // линии сгиба
  doc.setDrawColor(217, 119, 6);
  doc.setLineWidth(0.3);
  let x = 0;
  for (const seg of data.segments || []) {
    if (seg.type === 'flat') {
      x += (seg.length || 0) * scaleX;
    } else {
      const ba = (seg.ba || 0) * scaleX;
      const bendX = leftX + x + ba / 2;
      doc.setLineDashPattern([2, 1.5], 0);
      doc.line(bendX, topY - 2, bendX, topY + drawH + 2);
      doc.setLineDashPattern([], 0);
      // метка угла
      doc.setFontSize(8);
      doc.text(`${seg.angle || 90}°`, bendX, topY - 4, { align: 'center' });
      x += ba;
    }
  }

  // размерная линия снизу
  const dimY = topY + drawH + 12;
  doc.setLineWidth(0.2);
  doc.setDrawColor(120, 120, 120);
  doc.line(leftX, dimY, leftX + drawW, dimY);
  doc.line(leftX, dimY - 2, leftX, dimY + 2);
  doc.line(leftX + drawW, dimY - 2, leftX + drawW, dimY + 2);
  doc.setFontSize(9);
  doc.text(`L = ${L.toFixed(2)} мм`, leftX + drawW / 2, dimY - 2, { align: 'center' });

  // сноска
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text('K-фактор определяется автоматически по таблице R/S', 14, pageH - 10);

  doc.save(filename);
}

/**
 * Экспорт раскроя в PDF.
 * @param {{sheets: Array<{index,width,height,placed:Array<{x,y,w,h,rotated}>,utilization:number}>}} result
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
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(`Раскрой — Лист ${sheet.index}`, margin, 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(`Размер листа: ${sheet.width} × ${sheet.height} мм`, margin, 24);
    doc.text(`Использование: ${sheet.utilization.toFixed(1)}%`, margin, 30);
    doc.text(`Деталей: ${sheet.placed.length}`, margin, 36);

    // отрисовка листа
    const availW = pageW - margin * 2;
    const availH = pageH - 80;
    const scale = Math.min(availW / sheet.width, availH / sheet.height);
    const topY = 50;
    const leftX = margin + (availW - sheet.width * scale) / 2;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.4);
    doc.rect(leftX, topY, sheet.width * scale, sheet.height * scale);

    // детали
    doc.setDrawColor(217, 119, 6);
    doc.setFillColor(254, 243, 199);
    doc.setLineWidth(0.3);
    for (let i = 0; i < sheet.placed.length; i++) {
      const p = sheet.placed[i];
      const px = leftX + p.x * scale;
      const py = topY + (sheet.height - p.y - p.h) * scale;
      doc.rect(px, py, p.w * scale, p.h * scale, 'FD');
      // номер детали
      const fs = Math.max(5, Math.min(12, Math.min(p.w, p.h) * scale * 0.4));
      doc.setFontSize(fs);
      doc.setTextColor(0, 0, 0);
      doc.text(String(i + 1), px + (p.w * scale) / 2, py + (p.h * scale) / 2, { align: 'center' });
    }

    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text('Сгенерировано онлайн-инструментом «Развёртка & Раскрой»', 14, pageH - 10);
  }

  doc.save(filename);
}

export default { exportUnfoldPDF, exportNestingPDF };
