/**
 * main.js — точка входа приложения.
 * Импортируется из index.html как <script type="module">.
 */

import { App } from './app.js';

const boot = async () => {
  const app = new App();
  // экспонируем для отладки в консоли (необязательно)
  window.__app = app;
  try {
    await app.init();
    console.info('[Развёртка&Раскрой] приложение запущено');
  } catch (err) {
    console.error('[Развёртка&Раскрой] ошибка инициализации:', err);
    document.getElementById('status-text').textContent = 'Ошибка инициализации';
    document.getElementById('status-dot')?.classList.add('is-error');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
