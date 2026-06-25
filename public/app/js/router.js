/**
 * router.js
 * Переключение между режимами «Развёртка» и «Раскрой».
 *
 * Связывает DOM-атрибуты:
 *   [data-route]   — кнопки вкладок в шапке
 *   [data-panel]   — секции левой панели
 *   [data-view]    — центральные области визуализации
 *
 * Публикует событие EVENTS.ROUTE_CHANGE.
 * Поддерживает хеш-навигацию (#unfold / #nesting) и History API.
 */

import { eventBus, EVENTS } from './utils/event-bus.js';

export class Router {
  constructor() {
    /** @type {'unfold' | 'nesting'} */
    this.current = 'unfold';
    this._tabButtons = [];
    this._panels = [];
    this._views = [];
    this._bound = false;
  }

  /**
   * Привязка к DOM. Безопасно вызывать многократно.
   */
  init() {
    if (this._bound) return;
    this._bound = true;

    this._tabButtons = Array.from(document.querySelectorAll('[data-route]'));
    this._panels = Array.from(document.querySelectorAll('[data-panel]'));
    this._views = Array.from(document.querySelectorAll('[data-view]'));

    this._tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.navigate(btn.dataset.route, { source: 'tab' });
      });
    });

    // Хеш-навигация (deep-link + кнопки назад/вперёд)
    window.addEventListener('hashchange', () => this._syncFromHash());

    // Стрелки влево/вправо переключают вкладки (Ctrl/Cmd + ←/→)
    window.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.navigate(this.current === 'nesting' ? 'unfold' : 'unfold');
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.navigate(this.current === 'unfold' ? 'nesting' : 'nesting');
      }
    });

    this._syncFromHash();
  }

  /**
   * Перейти к маршруту.
   * @param {'unfold' | 'nesting'} route
   * @param {{source?: string}} [opts]
   */
  navigate(route, opts = {}) {
    if (route !== 'unfold' && route !== 'nesting') {
      console.warn(`[Router] unknown route "${route}"`);
      return;
    }
    if (route === this.current && opts.source !== 'init') return;

    this.current = route;
    this._apply();
    this._updateHash(route);
    eventBus.emit(EVENTS.ROUTE_CHANGE, { route }, { source: opts.source ?? 'navigate' });
  }

  /** Возвращает текущий маршрут. */
  get route() {
    return this.current;
  }

  // ---------- внутреннее ----------

  _apply() {
    this._tabButtons.forEach((btn) => {
      const active = btn.dataset.route === this.current;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    this._panels.forEach((p) => {
      p.classList.toggle('is-hidden', p.dataset.panel !== this.current);
    });
    this._views.forEach((v) => {
      v.classList.toggle('is-active', v.dataset.view === this.current);
    });
  }

  _updateHash(route) {
    const desired = `#${route}`;
    if (window.location.hash !== desired) {
      // replace, чтобы не плодить лишних записей в истории
      window.history.replaceState(null, '', desired);
    }
  }

  _syncFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash === 'unfold' || hash === 'nesting') {
      this.navigate(hash, { source: 'hash' });
    } else {
      this._apply();
    }
  }
}
