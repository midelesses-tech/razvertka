/**
 * app.js
 * Главный контроллер приложения.
 *
 * Ответственности:
 *   - инициализация роутера (вкладки «Развёртка» / «Раскрой»);
 *   - управление темой (светлая/тёмная) с сохранением выбора;
 *   - статус-бар и тосты (подписки на шину событий);
 *   - связывание кнопок действий и полей ввода с шиной событий;
 *   - расчёт развёртки через profile-calculator (с Шага 2);
 *   - инициализация панели разработчика и UI-гейтинга (freemium).
 */

import { Router } from './router.js';
import { eventBus, EVENTS } from './utils/event-bus.js';
import { calculateSingleBend, buildStandardProfile, calculateUnfold } from './modules/profile-calculator.js';
import { initDevPanel, applyGating } from './modules/dev-panel.js';
import { kFactorByMaterial, MATERIAL_K_FACTOR } from './utils/math-utils.js';
import { numOrDefault, validateUnfoldParams, markInvalid, clearInvalid } from './utils/validators.js';

const THEME_KEY = 'rzv:theme';

export class App {
  constructor() {
    this.router = new Router();
    /** @type {'light' | 'dark'} */
    this.theme = 'light';
    /** Текущие параметры развёртки (из левой панели). */
    this.unfoldParams = {
      profileType: 'L',
      thickness: 2,
      radius: 3,
      angle: 90,
      kfactor: 0.33,
      material: 'steel',
      flangeA: 40,
      flangeB: 40,
      flangeC: 20,
    };
    /** Результат последнего расчёта развёртки. */
    this.lastUnfold = null;
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
    this._initMaterialSync();
    this._initFlangeFields();
    this._initDevPanel();

    this.setStatus('Готово', 'ok');
    eventBus.emit('app:ready', { ts: Date.now() });

    // Подсказка про dev-панель в консоли
    console.info('%c[Dev] Панель разработчика: Ctrl+Shift+D или 5 кликов по логотипу', 'color:#f59e0b');
  }

  // ---------- Тема ----------

  _initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    this.theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
    this._applyTheme();

    const toggle = document.getElementById('theme-toggle');
    toggle?.addEventListener('click', () => this.toggleTheme());

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
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      this._handleInput(el);
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('[data-input]');
      if (!el) return;
      const r = this._handleInput(el, true);
      // при смене материала — синхронизировать K-фактор
      if (el.dataset.input === 'material') this._syncKFactorFromMaterial(r.value);
      // при смене типа профиля — перерисовать поля полок
      if (el.dataset.input === 'profile-type') this._renderFlangeFields(r.value);
    });
  }

  _handleInput(el, committed = false) {
    const key = el.dataset.input;
    const value = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? (el.value === '' ? null : Number(el.value))
      : el.value;
    // Маппинг DOM-ключей (kebab-case) → имена полей unfoldParams (camelCase).
    // Раньше 'flange-a' не совпадал с 'flangeA', и изменения полок терялись.
    const DOM_TO_PARAM = {
      'profile-type': 'profileType',
      'flange-a': 'flangeA',
      'flange-b': 'flangeB',
      'flange-c': 'flangeC',
      'thickness': 'thickness',
      'radius': 'radius',
      'angle': 'angle',
      'kfactor': 'kfactor',
      'material': 'material',
    };
    const paramName = DOM_TO_PARAM[key];
    if (paramName && paramName in this.unfoldParams) {
      this.unfoldParams[paramName] = value;
      // снимаем подсветку ошибки при исправлении
      if (el.classList.contains('is-invalid')) clearInvalid(el);
    }
    eventBus.emit(EVENTS.INPUT_CHANGE, { key, value, paramName, route: this.router.route, committed });
    return { value };
  }

  // ---------- Синхронизация материала → K-фактор ----------

  _initMaterialSync() {
    const sel = document.querySelector('[data-input="material"]');
    if (sel) this._syncKFactorFromMaterial(sel.value);
  }

  _initFlangeFields() {
    // первичная отрисовка полей под текущий профиль
    const sel = document.querySelector('[data-input="profile-type"]');
    const initial = sel?.value || 'L';
    this.unfoldParams.profileType = initial;
    this._renderFlangeFields(initial);
  }

  _syncKFactorFromMaterial(materialKey) {
    if (materialKey === 'custom') return; // пользовательский K — не трогаем
    const k = kFactorByMaterial(materialKey);
    this.unfoldParams.kfactor = k;
    this.unfoldParams.material = materialKey;
    const kInput = document.querySelector('[data-input="kfactor"]');
    if (kInput) {
      kInput.value = k;
      eventBus.emit(EVENTS.INPUT_CHANGE, { key: 'kfactor', value: k, route: this.router.route });
    }
  }

  // ---------- Динамические поля полок под тип профиля ----------

  /**
   * Конфигурация полей для каждого типа профиля.
   * Каждое поле: { param, label, placeholder, hint }
   * param — имя поля в unfoldParams (flangeA/flangeB/flangeC).
   */
  static FLANGE_CONFIG = {
    // Уголок: две полки A и B, один гиб
    L: {
      label: 'Размеры полок, мм',
      hint: 'A и B — длины двух полок уголка. Гиб один, 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      ],
    },
    // Швеллер: основание A, две одинаковые полки B, два гиба
    U: {
      label: 'Размеры швеллера, мм',
      hint: 'A — длина основания (стенки), B — длина полок (обе одинаковые). Два гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Основание A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      ],
    },
    // G-профиль: основание A, две полки B вверх, загибы C внутрь
    G: {
      label: 'Размеры G-профиля, мм',
      hint: 'A — основание, B — полки вверх, C — загибы краёв внутрь. Три гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Основание A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Загиб C', placeholder: 'C' },
      ],
    },
    // C-профиль: основание A, две полки B, загибы C на концах
    C: {
      label: 'Размеры C-профиля, мм',
      hint: 'A — основание, B — полки, C — отгибы на концах. Четыре гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Основание A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Отгиб C', placeholder: 'C' },
      ],
    },
    // Произвольный — конструктор на шаге 4, пока те же 2 поля
    custom: {
      label: 'Размеры заготовки, мм',
      hint: 'Конструктор произвольного сечения будет добавлен на шаге 4.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      ],
    },
  };

  /**
   * Отрисовать поля полок под выбранный тип профиля.
   * Сохраняет введённые значения из unfoldParams.
   * @param {string} profileType  'L' | 'U' | 'G' | 'C' | 'custom'
   */
  _renderFlangeFields(profileType) {
    const container = document.getElementById('flange-fields');
    const labelEl = document.getElementById('flange-fields-label');
    const hintEl = document.getElementById('flange-fields-hint');
    if (!container) return;

    const cfg = App.FLANGE_CONFIG[profileType] || App.FLANGE_CONFIG.L;
    if (labelEl) labelEl.textContent = cfg.label;
    if (hintEl) hintEl.textContent = cfg.hint;

    container.innerHTML = '';
    for (const f of cfg.fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      wrap.innerHTML = `
        <label class="field-label">${this._escape(f.label)}</label>
        <input class="input" type="number" min="1" step="0.1"
               value="${this.unfoldParams[f.param] ?? ''}"
               placeholder="${this._escape(f.placeholder)}"
               data-input="${f.param === 'flangeA' ? 'flange-a' : f.param === 'flangeB' ? 'flange-b' : 'flange-c'}"
               aria-label="${this._escape(f.label)}" />
      `;
      container.appendChild(wrap);
    }

    // если полей три — переключим на 3-колоночную сетку
    container.classList.toggle('field-row--3', cfg.fields.length === 3);
    container.classList.toggle('field-row', cfg.fields.length !== 3);
  }

  // ---------- Кнопки действий ----------

  _wireActions() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      switch (action) {
        case 'calc-unfold':
          this._calculateUnfold();
          break;
        case 'run-nesting':
          this.setStatus('Оптимизация раскроя…', 'busy');
          eventBus.emit(EVENTS.NESTING_RUN, {});
          setTimeout(() => {
            this.setStatus('Готово', 'ok');
            eventBus.emit(EVENTS.TOAST_SHOW, {
              title: 'Раскрой',
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

    // Чипы-инструменты в тулбарах
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

  // ---------- Расчёт развёртки (Шаг 2) ----------

  _calculateUnfold() {
    this.setStatus('Расчёт развёртки…', 'busy');
    const p = this.unfoldParams;

    // Сначала снимаем подсветку со всех полей
    document.querySelectorAll('[data-input].is-invalid').forEach(clearInvalid);

    // Валидация по полям с подсветкой
    const v = validateUnfoldParams({
      thickness: p.thickness,
      radius: p.radius,
      angle: p.angle,
      kfactor: p.kfactor,
      flangeA: p.flangeA,
      flangeB: p.flangeB,
    });
    if (!v.ok) {
      // v.error начинается с "key: сообщение" — подсветим нужное поле
      const match = /^([a-zA-Z]+):/.exec(v.error);
      if (match) {
        const keyMap = { flangeA: 'flange-a', flangeB: 'flange-b', flangeC: 'flange-c', kfactor: 'kfactor', thickness: 'thickness', radius: 'radius', angle: 'angle' };
        const sel = keyMap[match[1]] || match[1].toLowerCase();
        const fieldEl = document.querySelector(`[data-input="${sel}"]`);
        markInvalid(fieldEl, v.error);
      }
      this.setStatus('Ошибка ввода', 'error');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Не удалось рассчитать',
        message: v.error,
        kind: 'danger',
      });
      return;
    }

    // Сегментный расчёт (для стандартного профиля)
    const kind = p.profileType;
    let result;
    if (kind === 'custom') {
      // конструктор появится на шаге 4; пока считаем как single bend
      result = calculateSingleBend({
        flangeA: p.flangeA, flangeB: p.flangeB,
        thickness: p.thickness, radius: p.radius,
        angle: p.angle, kfactor: p.kfactor,
      });
    } else {
      // G и C-профили используют flangeC — провалидировать отдельно
      if ((kind === 'G' || kind === 'C') && (p.flangeC == null || p.flangeC <= 0)) {
        const cField = document.querySelector('[data-input="flange-c"]');
        markInvalid(cField, 'flangeC: полка C должна быть положительной');
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Не удалось рассчитать',
          message: 'Укажите размер полки C (загиб/отгиб)',
          kind: 'danger',
        });
        return;
      }
      const segs = buildStandardProfile(kind, {
        flangeA: p.flangeA,
        flangeB: p.flangeB,
        flangeC: p.flangeC,
        angle: p.angle,
      });
      const calc = calculateUnfold(segs, {
        thickness: p.thickness, radius: p.radius, kfactor: p.kfactor, material: p.material,
      });
      // для readout берём значения первого гиба (как репрезентативные)
      const firstBend = calc.bends[0] || {};
      result = {
        ok: true,
        value: {
          ba: firstBend.ba ?? 0,
          bd: firstBend.bd ?? 0,
          totalLength: calc.totalLength,
          bendCount: calc.bendCount,
          segments: calc.segments,
          profile: kind,
        },
      };
    }

    if (!result.ok) {
      this.setStatus('Ошибка расчёта', 'error');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Не удалось рассчитать',
        message: result.error,
        kind: 'danger',
      });
      return;
    }

    this.lastUnfold = result.value;
    this._renderUnfoldReadout(result.value);
    this.setStatus('Готово', 'ok');
    eventBus.emit(EVENTS.UNFOLD_CALCULATED, result.value);
    eventBus.emit(EVENTS.TOAST_SHOW, {
      title: 'Развёртка рассчитана',
      message: `L = ${result.value.totalLength.toFixed(2)} мм · BA = ${result.value.ba.toFixed(3)} · BD = ${result.value.bd.toFixed(3)}`,
      kind: 'ok',
    });

    // разрешить экспорт (Шаг 6 подключит реальный экспорт)
    eventBus.emit('export:availability', { formats: ['svg', 'dxf'] });
  }

  _renderUnfoldReadout(value) {
    const set = (key, text) => {
      const el = document.querySelector(`[data-out="${key}"]`);
      if (el) el.textContent = text;
    };
    set('profile', value.profile ?? '—');
    set('bend-count', String(value.bendCount ?? '—'));
    set('ba', `${value.ba.toFixed(3)} мм`);
    set('bd', `${value.bd.toFixed(3)} мм`);
    set('total-length', `${value.totalLength.toFixed(2)} мм`);
  }

  // ---------- Экспорт ----------

  _wireExportBar() {
    const bar = document.getElementById('export-bar');
    if (!bar) return;
    // Пометить платные форматы для гейтинга
    bar.querySelectorAll('[data-export]').forEach((b) => {
      const fmt = b.dataset.export;
      if (fmt === 'pdf') b.setAttribute('data-feature', 'exportPDF');
      if (fmt === 'dxf') b.setAttribute('data-feature', 'exportDXF');
      // svg — бесплатно, без data-feature
    });

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn || btn.disabled) return;
      eventBus.emit(EVENTS.EXPORT_REQUEST, { format: btn.dataset.export, route: this.router.route });
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Экспорт',
        message: `Формат ${btn.dataset.export.toUpperCase()} будет реализован на шаге 6.`,
        kind: 'warn',
      });
    });

    eventBus.on('export:availability', ({ formats }) => {
      bar.querySelectorAll('[data-export]').forEach((b) => {
        // не разблокировать платные, если гейтинг их закрыл
        if (b.classList.contains('is-locked-wrap')) return;
        if (formats.includes(b.dataset.export)) {
          b.disabled = false;
        }
      });
      applyGating();
    });
  }

  // ---------- Панель разработчика + гейтинг ----------

  _initDevPanel() {
    initDevPanel();
  }
}
