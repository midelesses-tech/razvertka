/**
 * app.js
 * Главный контроллер приложения.
 *
 * Ответственности на старте (Шаг 1):
 *   - инициализация роутера (вкладки «Развёртка» / «Раскрой»);
 *   - управление темой (светлая/тёмная) с сохранением выбора;
 *   - статус-бар и тосты (подписки на шину событий);
 *   - связывание кнопок действий и полей ввода с шиной событий
 *     (модули последующих шагов будут слушать эти события).
 *
 * Никакой бизнес-логики расчётов здесь нет — только оркестрация UI.
 */

import { Router } from './router.js';
import { eventBus, EVENTS } from './utils/event-bus.js';

const THEME_KEY = 'rzv:theme';

export class App {
  constructor() {
    this.router = new Router();
    /** @type {'light' | 'dark'} */
    this.theme = 'light';
  }

  /**
   * Инициализация. Должна вызываться после построения DOM.
   */
  async init() {
    this._initTheme();
    this._initRouter();
    this._initStatus();
    this._initToasts();
    this._wireInputs();
    this._wireActions();
    this._wireExportBar();

    this.setStatus('Готово', 'ok');
    eventBus.emit('app:ready', { ts: Date.now() });
  }

  // ---------- Тема ----------

  _initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    this.theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
    this._applyTheme();

    const toggle = document.getElementById('theme-toggle');
    toggle?.addEventListener('click', () => this.toggleTheme());

    // Реакция на системную смену темы, если пользователь не выбирал явно
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
      if (!localStorage.getItem(THEME_KEY)) {
        this.theme = e.matches ? 'dark' : 'light';
        this._applyTheme();
      }
    });
  }

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, this.theme);
    this._applyTheme();
    eventBus.emit(EVENTS.THEME_CHANGE, { theme: this.theme });
  }

  _applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
  }

  // ---------- Роутер ----------

  _initRouter() {
    this.router.init();
  }

  // ---------- Статус-бар ----------

  /**
   * Установить сообщение статус-бара.
   * @param {string} msg
   * @param {'ok' | 'busy' | 'error'} [kind='ok']
   */
  setStatus(msg, kind = 'ok') {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    if (dot) {
      dot.classList.remove('is-busy', 'is-error');
      if (kind === 'busy') dot.classList.add('is-busy');
      if (kind === 'error') dot.classList.add('is-error');
    }
    if (text) text.textContent = msg;
    eventBus.emit(EVENTS.STATUS_SET, { msg, kind });
  }

  _initStatus() {
    // Другие модули могут просить сменить статус
    eventBus.on(EVENTS.STATUS_SET, ({ msg, kind }) => this.setStatus(msg, kind));
  }

  // ---------- Тосты ----------

  _initToasts() {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    eventBus.on(EVENTS.TOAST_SHOW, ({ title, message, kind = 'ok', timeout = 3200 }) => {
      const el = document.createElement('div');
      el.className = `toast toast--${kind}`;
      el.innerHTML = `
        ${title ? `<div class="toast__title">${this._escape(title)}</div>` : ''}
        ${message ? `<div class="toast__msg">${this._escape(message)}</div>` : ''}
      `;
      stack.appendChild(el);
      const timer = setTimeout(() => this._dismissToast(el), timeout);
      el.addEventListener('click', () => {
        clearTimeout(timer);
        this._dismissToast(el);
      });
    });
  }

  _dismissToast(el) {
    if (!el.parentNode) return;
    el.style.transition = 'opacity .2s ease, transform .2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 200);
  }

  _escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- Поля ввода ----------

  _wireInputs() {
    // Любой [data-input] транслирует своё изменение в шину как input:change
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      const key = el.dataset.input;
      const value = el.type === 'checkbox' ? el.checked
        : el.type === 'number' ? (el.value === '' ? null : Number(el.value))
        : el.value;
      eventBus.emit(EVENTS.INPUT_CHANGE, { key, value, route: this.router.route });
    });

    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      // Для select/checkbox дополнительно шлём change
      if (el.tagName === 'SELECT' || el.type === 'checkbox') {
        const key = el.dataset.input;
        const value = el.type === 'checkbox' ? el.checked
          : el.type === 'number' ? (el.value === '' ? null : Number(el.value))
          : el.value;
        eventBus.emit(EVENTS.INPUT_CHANGE, { key, value, route: this.router.route, committed: true });
      }
    });
  }

  // ---------- Кнопки действий ----------

  _wireActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case 'calc-unfold':
          this.setStatus('Расчёт развёртки…', 'busy');
          // Шаг 2 подключит реальный калькулятор; пока заглушка-уведомление
          eventBus.emit('unfold:calc-request', {});
          setTimeout(() => {
            this.setStatus('Готово', 'ok');
            eventBus.emit(EVENTS.TOAST_SHOW, {
              title: 'Шаг 1',
              message: 'Каркас готов. Математика развёртки — на следующем шаге.',
              kind: 'warn',
            });
          }, 250);
          break;
        case 'run-nesting':
          this.setStatus('Оптимизация раскроя…', 'busy');
          eventBus.emit(EVENTS.NESTING_RUN, {});
          setTimeout(() => {
            this.setStatus('Готово', 'ok');
            eventBus.emit(EVENTS.TOAST_SHOW, {
              title: 'Шаг 1',
              message: 'Алгоритм упаковки будет реализован на шаге 5.',
              kind: 'warn',
            });
          }, 250);
          break;
        case 'add-part':
          eventBus.emit('nesting:add-part', {});
          break;
        default:
          break;
      }
    });

    // Чипы-инструменты в тулбарах (zoom-fit, toggle-bend, …)
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tool]');
      if (!chip) return;
      chip.classList.toggle('is-active');
      eventBus.emit('tool:toggle', {
        tool: chip.dataset.tool,
        active: chip.classList.contains('is-active'),
        route: this.router.route,
      });
    });
  }

  // ---------- Экспорт ----------

  _wireExportBar() {
    const bar = document.getElementById('export-bar');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn || btn.disabled) return;
      eventBus.emit(EVENTS.EXPORT_REQUEST, { format: btn.dataset.export, route: this.router.route });
      // Модули экспорта (Шаг 6) обработают запрос; пока информируем
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Экспорт',
        message: `Формат ${btn.dataset.export.toUpperCase()} будет доступен на шаге 6.`,
        kind: 'warn',
      });
    });

    // Разрешить/запретить кнопки экспорта по событию
    eventBus.on('export:availability', ({ formats }) => {
      bar.querySelectorAll('[data-export]').forEach((b) => {
        b.disabled = !formats.includes(b.dataset.export);
      });
    });
  }
}
