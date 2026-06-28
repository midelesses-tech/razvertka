/**
 * export-svg.js
 * Экспорт SVG из DOM-контейнера в файл .svg.
 *
 * Берёт первый <svg> внутри контейнера, сериализует его с XML-декларацией,
 * скачивает как Blob.
 */

/**
 * Скачать Blob с заданным именем файла.
 * @param {string} content  содержимое файла
 * @param {string} filename  имя файла
 * @param {string} mime  MIME-тип
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

  // клонируем, чтобы не портить исходный DOM
  const clone = svg.cloneNode(true);
  // убедиться, что xmlns задан
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  const serializer = new XMLSerializer();
  const body = serializer.serializeToString(clone);
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${body}`;
  downloadBlob(xml, filename || 'export.svg', 'image/svg+xml;charset=utf-8');
  return true;
}

export default exportSVG;
