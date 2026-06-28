/**
 * export-svg.js
 * Экспорт SVG из DOM-контейнера в файл .svg.
 *
 * Клонирует SVG из DOM, инлайнит стили из CSS (чтобы файл был автономным),
 * сериализует с XML-декларацией и скачивает.
 */

/**
 * Скачать Blob с заданным именем файла.
 */
export function downloadBlob(content, filename, mime = 'image/svg+xml') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Инлайн CSS-стили для всех элементов в SVG. */
function inlineStyles(clone) {
  // Маппинг классов → стили (из canvas.css)
  const styleMap = {
    'sheet-rect': 'fill:#f7f6f4;stroke:#d97706;stroke-width:1.5;',
    'sheet-grid': 'stroke:#e7e5e4;stroke-width:0.5;',
    'part-rect': 'fill:#fef3c7;stroke:#d97706;stroke-width:1.2;',
    'part-label': 'fill:#1c1917;font-family:monospace;font-size:12px;font-weight:700;text-anchor:middle;dominant-baseline:central;',
    'part-dim': 'fill:#78716c;font-family:monospace;font-size:9px;text-anchor:middle;',
    'waste-region': 'fill:rgba(220,38,38,0.1);stroke:rgba(220,38,38,0.3);stroke-width:0.5;',
    'sheet-dim': 'fill:#d97706;font-family:monospace;font-size:13px;font-weight:700;text-anchor:middle;',
    'bend-line': 'stroke:#d97706;stroke-width:1.6;stroke-dasharray:6 4;',
    'centerline': 'fill:none;stroke:#78716c;stroke-width:1;stroke-dasharray:8 3 1 3;opacity:0.8;',
    'dim-line': 'stroke:#a8a29e;stroke-width:0.8;',
    'dim-text': 'fill:#78716c;font-family:monospace;font-size:11px;text-anchor:middle;',
    'dim-label': 'fill:#a8a29e;font-family:monospace;font-size:9px;text-anchor:middle;',
    'unfold-fill': 'fill:#fef3c7;stroke:#d97706;stroke-width:1.5;',
    'seg-letter': 'fill:#1c1917;font-family:monospace;font-size:13px;font-weight:700;text-anchor:middle;dominant-baseline:central;',
    'vertex-dot': 'fill:#d97706;stroke:#fff;stroke-width:1.5;',
    'profile-fill': 'fill:none;stroke:#d97706;stroke-width:2;stroke-linejoin:round;stroke-linecap:round;',
  };

  // Применяем стили по классам
  clone.querySelectorAll('*').forEach((el) => {
    const cls = el.getAttribute('class');
    if (cls && styleMap[cls]) {
      el.setAttribute('style', styleMap[cls]);
      el.removeAttribute('class');
    }
  });

  // Также применяем computed styles как fallback
  return clone;
}

/**
 * Экспортировать SVG из DOM-контейнера в файл.
 * @param {string} containerId  id контейнера с SVG
 * @param {string} filename     имя файла (.svg)
 * @returns {boolean} успешно ли
 */
export function exportSVG(containerId, filename) {
  const container = document.getElementById(containerId);
  if (!container) return false;
  const svg = container.querySelector('svg');
  if (!svg) return false;

  // Клонируем
  const clone = svg.cloneNode(true);

  // Устанавливаем xmlns
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  // Убираем class-ы и инлайним стили
  inlineStyles(clone);

  // Сериализуем
  const serializer = new XMLSerializer();
  const body = serializer.serializeToString(clone);
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${body}`;
  downloadBlob(xml, filename || 'export.svg', 'image/svg+xml;charset=utf-8');
  return true;
}

export default exportSVG;
