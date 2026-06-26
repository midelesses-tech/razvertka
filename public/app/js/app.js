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
      flangeA: 40,
      flangeB: 40,
      flangeC: 40,
      flangeD: 15,
      flangeE: 40,
    };
    /** Сегменты произвольного профиля (для конструктора custom). */
    this.customSegments = [
      { length: 40, angle: 90 },
      { length: 40, angle: 0 },
    ];
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
    this._initFlangeFields();
    this._initCustomEditor();
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
      // при смене типа профиля — перерисовать поля полок / конструктор
      if (el.dataset.input === 'profile-type') {
        this._renderFlangeFields(r.value);
        this._toggleCustomEditor(r.value);
      }
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
      'flange-d': 'flangeD',
      'flange-e': 'flangeE',
      'thickness': 'thickness',
      'radius': 'radius',
      'angle': 'angle',
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

  // ---------- Поля полок + конструктор произвольного профиля ----------

  _initFlangeFields() {
    const sel = document.querySelector('[data-input="profile-type"]');
    const initial = sel?.value || 'L';
    this.unfoldParams.profileType = initial;
    this._renderFlangeFields(initial);
    this._toggleCustomEditor(initial);
  }

  _initCustomEditor() {
    // кнопка добавления сегмента в конструкторе
    document.getElementById('custom-add-segment')?.addEventListener('click', () => {
      // новый сегмент — без гиба после него (angle=0); пользователь сам задаст угол
      this.customSegments.push({ length: 20, angle: 0 });
      this._renderCustomEditor();
    });
    // делегированная обработка изменений сегментов и удаления
    document.getElementById('custom-segments')?.addEventListener('input', (e) => {
      const row = e.target.closest('[data-seg-index]');
      if (!row) return;
      const idx = Number(row.dataset.segIndex);
      const field = e.target.dataset.segField;
      if (field === 'length') this.customSegments[idx].length = Number(e.target.value) || 0;
      if (field === 'angle') this.customSegments[idx].angle = Number(e.target.value) || 0;
    });
    document.getElementById('custom-segments')?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-seg-del]');
      if (!del) return;
      const idx = Number(del.dataset.segDel);
      this.customSegments.splice(idx, 1);
      this._renderCustomEditor();
    });
  }

  _toggleCustomEditor(profileType) {
    const editor = document.getElementById('custom-editor');
    const stdFields = document.getElementById('flange-fields-group');
    if (!editor || !stdFields) return;
    if (profileType === 'custom') {
      editor.classList.remove('is-hidden');
      stdFields.classList.add('is-hidden');
      this._renderCustomEditor();
    } else {
      editor.classList.add('is-hidden');
      stdFields.classList.remove('is-hidden');
    }
  }

  _renderCustomEditor() {
    const list = document.getElementById('custom-segments');
    if (!list) return;
    list.innerHTML = '';
    this.customSegments.forEach((seg, i) => {
      const row = document.createElement('div');
      row.className = 'seg-row';
      row.dataset.segIndex = i;
      row.innerHTML = `
        <div class="seg-row__num mono">${i + 1}</div>
        <div class="field-group">
          <label class="field-label">Длина, мм</label>
          <input class="input" type="number" min="0" step="0.1" value="${seg.length}" data-seg-field="length" aria-label="Длина сегмента ${i + 1}" />
        </div>
        <div class="field-group">
          <label class="field-label">Угол гиба, °</label>
          <input class="input" type="number" min="0" max="180" step="1" value="${seg.angle}" data-seg-field="angle" aria-label="Угол гиба после сегмента ${i + 1}" />
        </div>
        <button class="icon-btn seg-row__del" data-seg-del="${i}" title="Удалить сегмент" aria-label="Удалить сегмент ${i + 1}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      `;
      list.appendChild(row);
    });
  }

  // ---------- Динамические поля полок под тип профиля ----------

  /**
   * Конфигурация полей для каждого типа профиля + мини-схема сечения.
   * Соглашение о размерах (внешние габариты):
   *   L: A, B — 2 полки, 1 гиб.
   *   U: A, B — полки (разнополочный), C — стенка. 2 гиба.
   *   G: A, B — полки, C — стенка, D — отгиб края. 3 гиба (швеллер + 1 загиб).
   *   C: A, B, C, D, E — 5 полок, Z-образный. 4 гиба.
   *   custom: конструктор сегментов (длина + угол).
   */
  static FLANGE_CONFIG = {
    L: {
      label: 'Размеры уголка, мм',
      hint: 'A и B — внешние длины полок. Один гиб 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      ],
      schema: 'L',
    },
    U: {
      label: 'Размеры швеллера, мм',
      hint: 'A — полка левая, B — полка правая (могут различаться), C — высота стенки. Два гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Высота C', placeholder: 'C' },
      ],
      schema: 'U',
    },
    G: {
      label: 'Размеры G-профиля, мм',
      hint: '4 полки: A, D — крайние (1 гиб), B, C — промежуточные (2 гиба). Три гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Стенка C', placeholder: 'C' },
        { param: 'flangeD', label: 'Отгиб D', placeholder: 'D' },
      ],
      schema: 'G',
    },
    C: {
      label: 'Размеры C-профиля, мм',
      hint: 'Z-образный профиль: A, E — крайние полки, B, C, D — промежуточные. Четыре гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Стенка C', placeholder: 'C' },
        { param: 'flangeD', label: 'Полка D', placeholder: 'D' },
        { param: 'flangeE', label: 'Полка E', placeholder: 'E' },
      ],
      schema: 'C',
    },
    custom: {
      label: 'Произвольный профиль',
      hint: 'Конструктор: добавляйте сегменты с длиной и углом гиба.',
      fields: [],
      schema: null,
    },
  };

  /**
   * Мини-SVG схема сечения для каждого профиля — с подписанными размерами A/B/C/D.
   * Показывает, какой отрезок за что отвечает.
   * @param {string} schema  'L' | 'U' | 'G' | 'C'
   * @returns {string} inline SVG
   */
  _profileSchemaSVG(schema) {
    const stroke = 'var(--accent)';
    const fill = 'var(--accent-soft)';
    const txt = 'var(--text-muted)';
    const txtAcc = 'var(--accent)';
    const fontMono = 'font-family: var(--font-mono); font-size: 11px; font-weight: 700;';
    const pathAttrs = `fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"`;

    switch (schema) {
      case 'L':
        // уголок L: A снизу, B слева вверх
        return `<svg viewBox="0 0 120 120" class="profile-schema">
          <path d="M20 20 L20 90 L100 90" ${pathAttrs}/>
          <text x="58" y="108" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">A</text>
          <text x="8" y="58" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 8 58)">B</text>
          <circle cx="20" cy="90" r="3" fill="${stroke}"/>
        </svg>`;
      case 'U':
        // швеллер U: A слева, B справа, C сверху (стенка)
        return `<svg viewBox="0 0 140 110" class="profile-schema">
          <path d="M20 20 L120 20 L120 90 M20 20 L20 90" ${pathAttrs}/>
          <text x="70" y="12" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">C (стенка)</text>
          <text x="12" y="58" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 12 58)">A</text>
          <text x="128" y="58" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(90 128 58)">B</text>
        </svg>`;
      case 'G':
        // G-профиль: 4 полки A,B,C,D, 3 гиба. A,D — крайние, B,C — промежуточные.
        // Форма: A (вниз) → B (стенка) → C (полка) → D (загиб)
        return `<svg viewBox="0 0 170 110" class="profile-schema">
          <path d="M20 90 L20 50 L70 50 L70 20 L150 20" ${pathAttrs}/>
          <text x="12" y="72" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 12 72)">A</text>
          <text x="45" y="44" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">B</text>
          <text x="110" y="14" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">C</text>
          <text x="142" y="36" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(90 142 36)">D</text>
        </svg>`;
      case 'C':
        // C-профиль: Z-образный, 5 полок A,B,C,D,E, 4 гиба.
        // ступенчатая форма: A (вниз) → B (вправо) → C (вверх) → D (вправо) → E (вниз)
        return `<svg viewBox="0 0 180 110" class="profile-schema">
          <path d="M15 90 L15 55 L65 55 L65 25 L115 25 L115 55 L165 55 L165 90" ${pathAttrs}/>
          <text x="8" y="74" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 8 74)">A</text>
          <text x="40" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">B</text>
          <text x="90" y="18" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">C</text>
          <text x="140" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">D</text>
          <text x="172" y="74" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(90 172 74)">E</text>
        </svg>`;
      default:
        return '';
    }
  }

  /**
   * Отрисовать поля полок + мини-схему под выбранный тип профиля.
   * Сохраняет введённые значения из unfoldParams.
   * @param {string} profileType  'L' | 'U' | 'G' | 'C' | 'custom'
   */
  _renderFlangeFields(profileType) {
    const container = document.getElementById('flange-fields');
    const labelEl = document.getElementById('flange-fields-label');
    const hintEl = document.getElementById('flange-fields-hint');
    const schemaEl = document.getElementById('profile-schema');
    if (!container) return;

    const cfg = App.FLANGE_CONFIG[profileType] || App.FLANGE_CONFIG.L;
    if (labelEl) labelEl.textContent = cfg.label;
    if (hintEl) hintEl.textContent = cfg.hint;
    if (schemaEl) schemaEl.innerHTML = cfg.schema ? this._profileSchemaSVG(cfg.schema) : '';

    container.innerHTML = '';
    for (const f of cfg.fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      const dataKey = f.param === 'flangeA' ? 'flange-a'
        : f.param === 'flangeB' ? 'flange-b'
        : f.param === 'flangeC' ? 'flange-c'
        : f.param === 'flangeD' ? 'flange-d' : 'flange-e';
      wrap.innerHTML = `
        <label class="field-label">${this._escape(f.label)}</label>
        <input class="input" type="number" min="1" step="0.1"
               value="${this.unfoldParams[f.param] ?? ''}"
               placeholder="${this._escape(f.placeholder)}"
               data-input="${dataKey}"
               aria-label="${this._escape(f.label)}" />
      `;
      container.appendChild(wrap);
    }

    // сетка под число полей
    const n = cfg.fields.length;
    container.classList.remove('field-row', 'field-row--3');
    if (n >= 4) container.classList.add('field-row');
    else if (n === 3) container.classList.add('field-row--3');
    else container.classList.add('field-row');
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
    document.querySelectorAll('[data-seg-field].is-invalid').forEach(clearInvalid);

    // Базовая валидация (толщина, радиус, угол) — K-фактор считается автоматически по R/S
    const v = validateUnfoldParams({
      thickness: p.thickness,
      radius: p.radius,
      angle: p.angle,
      kfactor: 0.5, // заглушка для валидатора (не используется, K считается по таблице)
      flangeA: p.flangeA,
      flangeB: p.flangeB,
    });
    if (!v.ok) {
      const match = /^([a-zA-Z]+):/.exec(v.error);
      if (match) {
        const keyMap = { flangeA: 'flange-a', flangeB: 'flange-b', flangeC: 'flange-c', flangeD: 'flange-d', flangeE: 'flange-e', thickness: 'thickness', radius: 'radius', angle: 'angle' };
        const sel = keyMap[match[1]] || match[1].toLowerCase();
        const fieldEl = document.querySelector(`[data-input="${sel}"]`);
        markInvalid(fieldEl, v.error);
      }
      this.setStatus('Ошибка ввода', 'error');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Не удалось рассчитать', message: v.error, kind: 'danger',
      });
      return;
    }

    const kind = p.profileType;
    let result;

    if (kind === 'custom') {
      // Конструктор произвольного профиля: сегменты {length, angle}
      if (this.customSegments.length === 0) {
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Не удалось рассчитать', message: 'Добавьте хотя бы один сегмент', kind: 'danger',
        });
        return;
      }
      // Построить сегменты: flat(length) + bend(angle) для каждого, кроме последнего (угол 0 = нет гиба)
      const segs = [];
      for (let i = 0; i < this.customSegments.length; i++) {
        const s = this.customSegments[i];
        if (s.length == null || s.length <= 0) {
          const el = document.querySelector(`[data-seg-index="${i}"] [data-seg-field="length"]`);
          markInvalid(el, 'Длина должна быть положительной');
          this.setStatus('Ошибка ввода', 'error');
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Не удалось рассчитать', message: `Сегмент ${i + 1}: длина должна быть положительной`, kind: 'danger',
          });
          return;
        }
        segs.push({ type: 'flat', length: s.length, label: `Сегмент ${i + 1}`, tag: `seg-${i}` });
        if (s.angle > 0) segs.push({ type: 'bend', angle: s.angle, radius: p.radius, label: `Гиб ${i + 1}` });
      }
      const calc = calculateUnfold(segs, { thickness: p.thickness, radius: p.radius });
      const firstBend = calc.bends[0] || {};
      result = {
        ok: true,
        value: {
          ba: firstBend.ba ?? 0,
          bd: firstBend.bd ?? 0,
          totalLength: calc.totalLength,
          bendCount: calc.bendCount,
          segments: calc.segments,
          profile: 'custom',
          flats: calc.flats,
          li: calc.li,
          setback: calc.setback,
        },
      };
    } else {
      // Стандартный профиль: валидация нужных полок
      const needsC = ['U', 'G', 'C'].includes(kind);
      const needsD = ['G', 'C'].includes(kind);
      const needsE = kind === 'C';
      const fail = (sel, msg) => {
        markInvalid(document.querySelector(`[data-input="${sel}"]`), msg);
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Не удалось рассчитать', message: msg, kind: 'danger' });
      };
      if (needsC && (p.flangeC == null || p.flangeC <= 0)) { fail('flange-c', 'Высота C должна быть положительной'); return; }
      if (needsD && (p.flangeD == null || p.flangeD <= 0)) { fail('flange-d', 'Размер D должен быть положительным'); return; }
      if (needsE && (p.flangeE == null || p.flangeE <= 0)) { fail('flange-e', 'Размер E должен быть положительным'); return; }

      const segs = buildStandardProfile(kind, {
        flangeA: p.flangeA, flangeB: p.flangeB,
        flangeC: p.flangeC, flangeD: p.flangeD, flangeE: p.flangeE,
        angle: p.angle, thickness: p.thickness, radius: p.radius,
      });
      const calc = calculateUnfold(segs, { thickness: p.thickness, radius: p.radius });
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
          flats: calc.flats,
          li: calc.li,
          setback: calc.setback,
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
    const f = value.flats || {};
    const fmt = (v) => (v != null && v !== 0 ? `${v.toFixed(2)} мм` : '—');
    set('profile', value.profile ?? '—');
    set('bend-count', String(value.bendCount ?? '—'));
    set('la', fmt(f.La));
    set('lb', fmt(f.Lb));
    set('lc', fmt(f.Lc));
    set('ld', fmt(f.Ld));
    set('le', fmt(f.Le));
    set('li', value.li ? `${value.li.toFixed(3)} мм` : '—');
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
