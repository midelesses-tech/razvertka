/**
 * event-bus.js
 * Легковесная шина событий для связи модулей UI и рендереров
 * без глобальных переменных.
 *
 * Соглашение об именах событий: <domain>:<action>
 *   route:change, profile:updated, unfold:calculated, nesting:done,
 *   theme:change, toast:show, status:set, export:done …
 */

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
    /** Лог последних событий для отладки (ограничен по размеру) */
    this._history = [];
    this._historyLimit = 50;
  }

  /**
   * Подписка на событие.
   * @param {string} event
   * @param {Function} handler
   * @returns {() => void} функция отписки
   */
  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
  }

  /**
   * Подписка, срабатывающая один раз.
   */
  once(event, handler) {
    const off = this.on(event, (payload, meta) => {
      off();
      handler(payload, meta);
    });
    return off;
  }

  /**
   * Отписка.
   */
  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) {
      if (handler) set.delete(handler);
      else set.clear();
      if (set.size === 0) this._listeners.delete(event);
    }
  }

  /**
   * Публикация события.
   * @param {string} event
   * @param {*} [payload]
   * @param {{source?: string}} [meta]
   */
  emit(event, payload, meta = {}) {
    this._pushHistory(event, payload);
    const set = this._listeners.get(event);
    if (!set) return;
    // Копируем, чтобы обработчик мог отписаться во время emit
    const handlers = Array.from(set);
    for (const h of handlers) {
      try {
        h(payload, { ...meta, event, timestamp: Date.now() });
      } catch (err) {
        // Не даём одному обработчику обрушить цепочку
        console.error(`[EventBus] handler error for "${event}":`, err);
      }
    }
  }

  /**
   * Очистка всех подписок (используется в тестах/HMR).
   */
  clear() {
    this._listeners.clear();
  }

  /** Список активных событий (для отладки). */
  get activeEvents() {
    return Array.from(this._listeners.keys());
  }

  _pushHistory(event, payload) {
    this._history.push({ event, payload, t: Date.now() });
    if (this._history.length > this._historyLimit) this._history.shift();
  }
}

/** Синглтон шины событий, используемый всеми модулями. */
export const eventBus = new EventBus();

/** Доменные имена событий — в одном месте, чтобы не опечататься. */
export const EVENTS = Object.freeze({
  ROUTE_CHANGE: 'route:change',
  THEME_CHANGE: 'theme:change',
  PROFILE_UPDATED: 'profile:updated',
  UNFOLD_CALCULATED: 'unfold:calculated',
  NESTING_DONE: 'nesting:done',
  NESTING_RUN: 'nesting:run',
  STATUS_SET: 'status:set',
  TOAST_SHOW: 'toast:show',
  EXPORT_DONE: 'export:done',
  EXPORT_REQUEST: 'export:request',
  INPUT_CHANGE: 'input:change',
});
