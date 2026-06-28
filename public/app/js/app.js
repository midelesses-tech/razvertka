/**
 * app.js
 * Главный контроллер приложения.
 *
 * Ответственности:
 *   - инициализация роутера (3 вкладки: Развёртка / Раскрой / Калькулятор);
 *   - управление темой (светлая/тёмная) с сохранением выбора;
 *   - статус-бар и тосты;
 *   - расчёт развёртки (через profile-calculator);
 *   - рендер сечения и плоской развёртки (через renderers);
 *   - раскрой (через cut-optimizer / bin-packer);
 *   - экспорт SVG/DXF/PDF;
 *   - аутентификация, тарифы, проекты;
 *   - калькулятор металлопроката (POST /api/metal-calc);
 *   - панель разработчика и UI-гейтинг freemium.
 */

import { Router } from './router.js';
import { eventBus, EVENTS } from './utils/event-bus.js';
import {
  calculateSingleBend, buildStandardProfile,
  calculateUnfold,
} from './modules/profile-calculator.js';
import { initProfileRenderer } from './modules/profile-renderer.js';
import { initUnfoldRenderer } from './modules/unfold-renderer.js';
import { initSheetRenderer } from './modules/sheet-renderer.js';
import { optimizeNesting } from './modules/cut-optimizer.js';
import { exportSVG, downloadBlob } from './modules/export-svg.js';
import {
  generateUnfoldDXF, generateNestingDXF, downloadDXF,
} from './modules/export-dxf.js';
import { exportUnfoldPDF, exportNestingPDF } from './modules/export-pdf.js';
import { initDevPanel, applyGating, showPremiumModal } from './modules/dev-panel.js';
import { numOrDefault, validateUnfoldParams, markInvalid, clearInvalid } from './utils/validators.js';
import {
  initAuth, login, register, logout, getUser, verifyEmail, resendCode,
  setPlan, verifyPayment, checkPaymentStatus,
  listProjects, createProject, getProject, deleteProject,
  requestReset, resetPassword,
} from './modules/auth.js';

const THEME_KEY = 'rzv:theme';

// ───────────────────────── конфигурация полок под профиль ─────────────────────────

const FLANGE_CONFIG = {
  L: {
    label: 'Размеры уголка, мм',
    hint: 'A и B — внешние длины полок. Один гиб.',
    fields: [
      { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
      { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
    ],
    schema: 'L',
  },
  U: {
    label: 'Размеры швеллера, мм',
    hint: 'A — полка левая, B — полка правая (могут различаться), C — высота стенки. Два гиба.',
    fields: [
      { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
      { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      { param: 'flangeC', label: 'Высота C', placeholder: 'C' },
    ],
    schema: 'U',
  },
  G: {
    label: 'Размеры G-профиля, мм',
    hint: '4 полки: A, D — крайние (1 гиб), B, C — промежуточные (2 гиба). Три гиба.',
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
    hint: 'Z-образный профиль: A, E — крайние полки, B, C, D — промежуточные. Четыре гиба.',
    fields: [
      { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
      { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      { param: 'flangeC', label: 'Стенка C', placeholder: 'C' },
      { param: 'flangeD', label: 'Полка D', placeholder: 'D' },
      { param: 'flangeE', label: 'Полка E', placeholder: 'E' },
    ],
    schema: 'C',
  },
  clamp: {
    label: 'Размеры хомута, мм',
    hint: 'Замкнутый хомут: A, B, C. Сплющенный овал.',
    fields: [
      { param: 'flangeA', label: 'Ширина A', placeholder: 'A' },
      { param: 'flangeB', label: 'Высота B', placeholder: 'B' },
      { param: 'flangeC', label: 'Длина C', placeholder: 'C' },
    ],
    schema: 'U',
  },
  custom: {
    label: 'Произвольный профиль',
    hint: 'Конструктор: добавляйте сегменты с длиной и углом гиба.',
    fields: [],
    schema: null,
  },
};

/** Дефолтные размеры для каждого профиля. */
const PROFILE_DEFAULTS = {
  L: { flangeA: 50, flangeB: 50 },
  U: { flangeA: 40, flangeB: 40, flangeC: 40 },
  G: { flangeA: 10, flangeB: 40, flangeC: 90, flangeD: 10 },
  C: { flangeA: 10, flangeB: 40, flangeC: 90, flangeD: 40, flangeE: 10 },
  clamp: { flangeA: 100, flangeB: 100, flangeC: 120 },
};

// ───────────────────────── металлокалькулятор ─────────────────────────

/** Поля размеров для каждого типа профиля в калькуляторе. */
const MC_PROFILE_FIELDS = {
  round:    [{ key: 'd',    label: 'Диаметр D, мм' }],
  pipe:     [{ key: 'd', label: 'Диаметр D, мм' }, { key: 's', label: 'Стенка S, мм' }],
  square:   [{ key: 'a',    label: 'Сторона A, мм' }],
  rect:     [{ key: 'a', label: 'Сторона A, мм' }, { key: 'b', label: 'Сторона B, мм' }],
  square_pipe: [{ key: 'a', label: 'Сторона A, мм' }, { key: 's', label: 'Стенка S, мм' }],
  rect_pipe: [{ key: 'a', label: 'A, мм' }, { key: 'b', label: 'B, мм' }, { key: 's', label: 'S, мм' }],
  angle:    [{ key: 'a', label: 'Полка A, мм' }, { key: 'b', label: 'Полка B, мм' }, { key: 's', label: 'Толщина S, мм' }],
  channel:  [{ key: 'h', label: 'Высота H, мм' }, { key: 'b', label: 'Полка B, мм' }, { key: 's', label: 'Стенка S, мм' }],
  ibeam:    [{ key: 'h', label: 'Высота H, мм' }, { key: 'b', label: 'Полка B, мм' }, { key: 's', label: 'Стенка S, мм' }],
  flat:     [{ key: 'b', label: 'Ширина B, мм' }, { key: 's', label: 'Толщина S, мм' }],
  sheet:    [{ key: 's', label: 'Толщина S, мм' }],
  hex:      [{ key: 'd', label: 'Диаметр впис. D, мм' }],
  strip:    [{ key: 'b', label: 'Ширина B, мм' }, { key: 's', label: 'Толщина S, мм' }],
};

const MC_DENSITIES = {
  steel: 7850,
  aluminum: 2700,
  stainless: 7900,
  copper: 8940,
  brass: 8500,
  bronze: 8800,
  zinc: 7140,
};

const MC_PROFILE_LABELS = {
  round: 'Круг',
  pipe: 'Труба круглая',
  square: 'Квадрат',
  rect: 'Полоса (прямоугольник)',
  square_pipe: 'Труба квадратная',
  rect_pipe: 'Труба прямоугольная',
  angle: 'Уголок',
  channel: 'Швеллер',
  ibeam: 'Двутавр',
  flat: 'Полоса',
  sheet: 'Лист',
  hex: 'Шестигранник',
  strip: 'Лента',
};

const MC_MATERIAL_LABELS = {
  steel: 'Сталь',
  aluminum: 'Алюминий',
  stainless: 'Нержавейка',
  copper: 'Медь',
  brass: 'Латунь',
  bronze: 'Бронза',
  zinc: 'Цинк',
};

// ───────────────────────── класс App ─────────────────────────

export class App {
  constructor() {
    this.router = new Router();
    /** @type {'light' | 'dark'} */
    this.theme = 'light';

    // Параметры развёртки (из левой панели)
    this.unfoldParams = {
      profileType: 'L',
      thickness: 2,
      radius: 3,
      angle: 90,
      arcRadius: 120,
      flangeA: 50,
      flangeB: 50,
      flangeC: 40,
      flangeD: 10,
      flangeE: 10,
    };
    this.profileDefaults = PROFILE_DEFAULTS;
    this.customSegments = [
      { length: 40, angle: 90 },
      { length: 40, angle: 0 },
    ];

    // Раскрой
    this.nestingParts = [{ w: 300, h: 500, qty: 8 }];
    this.nestingOpts = {
      sheetWidth: 1000,
      sheetHeight: 2000,
      kerf: 2,
      margin: 10,
      allowRotation: true,
      maxSheets: 50,
    };

    // Металлокалькулятор
    this.mcMode = 'weight'; // weight | length
    this.mcProfile = 'round';
    this.mcMaterial = 'steel';
    this.mcDims = { d: 20, s: 2, a: 20, b: 40, h: 50 };

    // Кэш последних результатов
    this.lastUnfold = null;
    this.lastNesting = null;

    // Рендереры (инициализируются в _initRenderers)
    this._profileRenderer = null;
    this._unfoldRenderer = null;
    this._sheetRenderer = null;

    // Состояние модалок
    this._authTab = 'login';
    this._resetStep = 'email';
    this._pendingPaymentId = null;
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
    this._initRenderers();
    this._initNestingParts();
    this._initAuth();
    this._initMetalCalc();
    this._wireAllModalClosers();

    this.setStatus('Готово', 'ok');
    eventBus.emit('app:ready', { ts: Date.now() });

    // Проверить возврат с платёжной страницы (?payment=ID)
    this._checkPaymentReturn();

    console.info('%c[Dev] Панель разработчика: Ctrl+Shift+D или 5 кликов по логотипу', 'color:#f59e0b');
  }

  // ───────────────────────── Тема ─────────────────────────

  _initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    this.theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
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

  // ───────────────────────── Роутер ─────────────────────────

  _initRouter() {
    this.router.init();
    eventBus.on(EVENTS.ROUTE_CHANGE, ({ route }) => {
      // перерисовать гейтинг при смене вкладки
      setTimeout(applyGating, 0);
      // обновить readout при переключении на калькулятор
      if (route === 'calc') this._updateMcReadout();
    });
  }

  // ───────────────────────── Статус-бар ─────────────────────────

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
    // Примечание: setStatus() сам публикует STATUS_SET — здесь нет подписки,
    // иначе получается бесконечная рекурсия (emit → listener → emit …).
    // Статус-бар обновляется напрямую из setStatus().
  }

  // ───────────────────────── Тосты ─────────────────────────

  _initToasts() {
    const stack = document.getElementById('toast-stack');
    if (!stack) return;
    eventBus.on(EVENTS.TOAST_SHOW, ({ title, message, kind = 'ok', timeout = 3200 }) => {
      const el = document.createElement('div');
      el.className = `toast toast--${kind}`;
      el.innerHTML = `
        ${title ? `<div class="toast__title">${this._escapeHtml(title)}</div>` : ''}
        ${message ? `<div class="toast__msg">${this._escapeHtml(message)}</div>` : ''}
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

  _escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ───────────────────────── Поля ввода ─────────────────────────

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
      if (el.dataset.input === 'mc-profile') {
        this._renderMcDims();
        this._updateMcValueLabel();
      }
      if (el.dataset.input === 'mc-material') {
        this._updateMcValueLabel();
      }
    });
  }

  _handleInput(el, committed = false) {
    const key = el.dataset.input;
    const value = el.type === 'checkbox' ? el.checked
      : el.type === 'number' ? (el.value === '' ? null : Number(el.value))
      : el.value;
    // Маппинг DOM-ключей → имена полей unfoldParams.
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
      'arc-radius': 'arcRadius',
    };
    const paramName = DOM_TO_PARAM[key];
    if (paramName && paramName in this.unfoldParams) {
      this.unfoldParams[paramName] = value;
      if (el.classList.contains('is-invalid')) clearInvalid(el);
    }
    // Параметры раскроя
    const NEST_MAP = {
      'sheet-length': 'sheetHeight',
      'sheet-width': 'sheetWidth',
      'kerf': 'kerf',
      'margin': 'margin',
      'lock-rotation': 'allowRotation',
    };
    if (key === 'lock-rotation') {
      // lock-rotation = true → allowRotation = false
      this.nestingOpts.allowRotation = !value;
    } else if (NEST_MAP[key]) {
      this.nestingOpts[NEST_MAP[key]] = value;
    }

    // Поля металлокалькулятора
    if (key === 'mc-mode') {
      this.mcMode = value;
      this._updateMcValueLabel();
    } else if (key === 'mc-profile') {
      this.mcProfile = value;
    } else if (key === 'mc-material') {
      this.mcMaterial = value;
    } else if (key && key.startsWith('mc-dim-')) {
      const dimKey = key.slice('mc-dim-'.length);
      this.mcDims[dimKey] = value;
    }

    eventBus.emit(EVENTS.INPUT_CHANGE, { key, value, paramName, route: this.router.route, committed });
    return { value };
  }

  // ───────────────────────── Поля полок + конструктор ─────────────────────────

  _initFlangeFields() {
    const sel = document.querySelector('[data-input="profile-type"]');
    const initial = sel?.value || 'L';
    this.unfoldParams.profileType = initial;
    this._renderFlangeFields(initial);
    this._toggleCustomEditor(initial);
  }

  _initCustomEditor() {
    document.getElementById('custom-add-segment')?.addEventListener('click', () => {
      this.customSegments.push({ length: 20, angle: 0 });
      this._renderCustomEditor();
    });
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

  // ───────────────────────── Мини-схема сечения ─────────────────────────

  _profileSchemaSVG(schema) {
    const stroke = 'var(--accent)';
    const fill = 'var(--accent-soft)';
    const txtAcc = 'var(--accent)';
    const fontMono = 'font-family: var(--font-mono); font-size: 11px; font-weight: 700;';
    const pathAttrs = `fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"`;
    const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="2.5" fill="${stroke}"/>`;
    const lbl = (x, y, t, rot) => `<text x="${x}" y="${y}" fill="${txtAcc}" style="${fontMono}" text-anchor="middle"${rot ? ` transform="rotate(${rot} ${x} ${y})"` : ''}>${t}</text>`;

    switch (schema) {
      case 'L':
        // L: A→ (вправо), B↑ (вверх) — уголок └
        return `<svg viewBox="0 0 120 120" class="profile-schema">
          <path d="M15 95 L105 95 L105 20" ${pathAttrs}/>
          ${dot(105, 95)}
          ${lbl(60, 110, 'A', 0)}
          ${lbl(115, 58, 'B', 90)}
        </svg>`;
      case 'U':
        // U: A↓ (вниз), B→ (вправо), C↑ (вверх) — ⊂
        return `<svg viewBox="0 0 140 110" class="profile-schema">
          <path d="M20 15 L20 90 L120 90 L120 15" ${pathAttrs}/>
          ${dot(20, 90)}
          ${dot(120, 90)}
          ${lbl(12, 52, 'A', -90)}
          ${lbl(70, 102, 'B', 0)}
          ${lbl(128, 52, 'C', 90)}
        </svg>`;
      case 'G':
        // G: A→ (вправо), B↑ (вверх), C← (влево), D↓ (вниз) — G-профиль
        return `<svg viewBox="0 0 160 120" class="profile-schema">
          <path d="M15 55 L15 100 L90 100 L90 25 L145 25 L145 60" ${pathAttrs}/>
          ${dot(15, 100)}
          ${dot(90, 100)}
          ${dot(90, 25)}
          ${dot(145, 25)}
          ${lbl(8, 78, 'A', -90)}
          ${lbl(52, 110, 'B', 0)}
          ${lbl(117, 18, 'C', 0)}
          ${lbl(153, 42, 'D', 90)}
        </svg>`;
      case 'C':
        // C: A← (влево), B↓ (вниз), C→ (вправо), D↑ (вверх), E← (влево) — буква С
        return `<svg viewBox="0 0 180 120" class="profile-schema">
          <path d="M165 20 L25 20 L25 100 L165 100 L165 70" ${pathAttrs}/>
          ${dot(25, 20)}
          ${dot(25, 100)}
          ${dot(165, 100)}
          ${dot(165, 70)}
          ${lbl(95, 12, 'B', 0)}
          ${lbl(15, 60, 'A', -90)}
          ${lbl(95, 112, 'C', 0)}
          ${lbl(175, 85, 'D', 90)}
          ${lbl(155, 50, 'E', -90)}
        </svg>`;
      default:
        return '';
    }
  }

  _renderFlangeFields(profileType) {
    const container = document.getElementById('flange-fields');
    const labelEl = document.getElementById('flange-fields-label');
    const hintEl = document.getElementById('flange-fields-hint');
    const schemaEl = document.getElementById('profile-schema');
    if (!container) return;

    const cfg = FLANGE_CONFIG[profileType] || FLANGE_CONFIG.L;
    if (labelEl) labelEl.textContent = cfg.label;
    if (hintEl) hintEl.textContent = cfg.hint;
    if (schemaEl) schemaEl.innerHTML = cfg.schema ? this._profileSchemaSVG(cfg.schema) : '';

    container.innerHTML = '';
    for (const f of cfg.fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      const dataKey = f.param.replace('flange', 'flange-').toLowerCase();
      wrap.innerHTML = `
        <label class="field-label">${this._escapeHtml(f.label)}</label>
        <input class="input" type="number" min="1" step="0.1"
               value="${this.unfoldParams[f.param] ?? ''}"
               placeholder="${this._escapeHtml(f.placeholder)}"
               data-input="${dataKey}"
               aria-label="${this._escapeHtml(f.label)}" />
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

  // ───────────────────────── Кнопки действий ─────────────────────────

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
          this._runNesting();
          break;
        case 'add-part':
          this._addNestingPart();
          break;
        case 'run-metal-calc':
          this._runMetalCalc();
          break;
        case 'open-auth':
          this._openAuthModal('login');
          break;
        case 'open-plans':
          this._openPlansModal();
          break;
        case 'open-projects':
          this._openProjectsModal();
          break;
        case 'logout':
          this._handleLogout();
          break;
        case 'switch-auth-tab':
          this._switchAuthTab(btn.dataset.tab || 'login');
          break;
        case 'auth-submit':
          this._handleAuthSubmit();
          break;
        case 'verify-submit':
          this._handleVerify();
          break;
        case 'resend-code':
          this._handleResend();
          break;
        case 'reset-request':
          this._handleResetRequest();
          break;
        case 'reset-password':
          this._handleResetPassword();
          break;
        case 'open-reset':
          this._closeAuthModal();
          this._openResetModal();
          break;
        case 'set-plan':
          this._handleSetPlan(btn.dataset.plan || 'demo');
          break;
        case 'payment-verify':
          this._handleVerifyPayment();
          break;
        case 'project-save':
          this._handleSaveProject();
          break;
        case 'acct-toggle':
          this._toggleAcctMenu();
          break;
        default:
          break;
      }
    });

    // клик вне меню аккаунта — закрыть
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('acct-menu');
      const btn = document.getElementById('account-btn');
      if (!menu || !btn) return;
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        this._closeAcctMenu();
      }
    });

    // Чипы-инструменты в тулбарах
    document.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-tool]');
      if (!chip) return;
      const tool = chip.dataset.tool;
      chip.classList.toggle('is-active');
      if (tool === 'toggle-waste') this._sheetRenderer?.toggleWaste();
      if (tool === 'toggle-labels') this._sheetRenderer?.toggleLabels();
      eventBus.emit('tool:toggle', {
        tool,
        active: chip.classList.contains('is-active'),
        route: this.router.route,
      });
    });

    // Escape — закрыть любую модалку
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.is-open').forEach((m) => {
          m.classList.remove('is-open');
          m.setAttribute('aria-hidden', 'true');
        });
        this._closeAcctMenu();
      }
    });
  }

  // ───────────────────────── Рендереры ─────────────────────────

  _initRenderers() {
    const sectionEl = document.getElementById('stage-section');
    const unfoldEl = document.getElementById('stage-unfold');
    const sheetEl = document.getElementById('stage-sheet');
    this._profileRenderer = initProfileRenderer(sectionEl);
    this._unfoldRenderer = initUnfoldRenderer(unfoldEl);
    this._sheetRenderer = initSheetRenderer(sheetEl);
  }

  // ───────────────────────── Расчёт развёртки ─────────────────────────

  _calculateUnfold() {
    this.setStatus('Расчёт развёртки…', 'busy');
    const p = this.unfoldParams;

    // Снять подсветку со всех полей
    document.querySelectorAll('[data-input].is-invalid').forEach(clearInvalid);
    document.querySelectorAll('[data-seg-field].is-invalid').forEach(clearInvalid);

    const v = validateUnfoldParams({
      thickness: p.thickness,
      radius: p.radius,
      angle: p.angle,
      kfactor: 0.5,
      flangeA: p.flangeA,
      flangeB: p.flangeB,
    });
    if (!v.ok) {
      const match = /^([a-zA-Z]+):/.exec(v.error);
      if (match) {
        const keyMap = {
          flangeA: 'flange-a', flangeB: 'flange-b', flangeC: 'flange-c',
          flangeD: 'flange-d', flangeE: 'flange-e',
          thickness: 'thickness', radius: 'radius', angle: 'angle',
        };
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
      if (this.customSegments.length === 0) {
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Не удалось рассчитать', message: 'Добавьте хотя бы один сегмент', kind: 'danger',
        });
        return;
      }
      const segs = [];
      for (let i = 0; i < this.customSegments.length; i++) {
        const s = this.customSegments[i];
        if (s.length == null || s.length <= 0) {
          const el = document.querySelector(`[data-seg-index="${i}"] [data-seg-field="length"]`);
          markInvalid(el, 'Длина должна быть положительной');
          this.setStatus('Ошибка ввода', 'error');
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Не удалось рассчитать',
            message: `Сегмент ${i + 1}: длина должна быть положительной`,
            kind: 'danger',
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
          startDir: 0,
          profile: 'custom',
          flats: calc.flats,
          li: calc.li,
          setback: calc.setback,
          thickness: p.thickness,
        },
      };
    } else if (kind === 'clamp') {
      // хомут — упрощённо: длина = 2A + 2B + C
      const A = p.flangeA || 0, B = p.flangeB || 0, C = p.flangeC || 0;
      const segs = [
        { type: 'flat', length: A, label: 'Полка A', tag: 'flange-a' },
        { type: 'bend', angle: 90, radius: p.radius, label: 'Гиб 1' },
        { type: 'flat', length: B, label: 'Полка B', tag: 'flange-b' },
        { type: 'bend', angle: 90, radius: p.radius, label: 'Гиб 2' },
        { type: 'flat', length: C, label: 'Стенка C', tag: 'web' },
        { type: 'bend', angle: 90, radius: p.radius, label: 'Гиб 3' },
        { type: 'flat', length: B, label: 'Полка B2', tag: 'flange-b' },
        { type: 'bend', angle: 90, radius: p.radius, label: 'Гиб 4' },
        { type: 'flat', length: A, label: 'Полка A2', tag: 'flange-a' },
      ];
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
          profile: 'clamp',
          flats: calc.flats,
          li: calc.li,
          setback: calc.setback,
          thickness: p.thickness,
        },
      };
    } else {
      // Стандартный профиль
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

      // Защита от невозможной геометрии: проверяем, что setback < минимальной полки.
      const sb = (p.radius + p.thickness) * Math.tan((p.angle * Math.PI / 180) / 2);
      const minFlange = Math.min(p.flangeA, p.flangeB, ...(needsC ? [p.flangeC] : []), ...(needsD ? [p.flangeD] : []), ...(needsE ? [p.flangeE] : []));
      if (sb >= minFlange) {
        fail('thickness', `Невозможная геометрия: setback (${sb.toFixed(1)} мм) ≥ минимальной полки (${minFlange} мм). Уменьшите толщину, радиус или угол, либо увеличьте полки.`);
        return;
      }
      // Для промежуточных полок setback вычитается дважды
      if (needsC && sb * 2 >= p.flangeC) {
        fail('flange-c', `Невозможная геометрия: 2×setback (${(sb * 2).toFixed(1)} мм) ≥ стенки C (${p.flangeC} мм). Увеличьте C или уменьшите R/S.`);
        return;
      }

      const built = buildStandardProfile(kind, {
        flangeA: p.flangeA, flangeB: p.flangeB,
        flangeC: p.flangeC, flangeD: p.flangeD, flangeE: p.flangeE,
        angle: p.angle, thickness: p.thickness, radius: p.radius,
      });
      const segs = built.segments;
      const startDir = built.startDir;
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
          startDir: startDir,
          profile: kind,
          flats: calc.flats,
          li: calc.li,
          setback: calc.setback,
          thickness: p.thickness,
        },
      };
    }

    this.lastUnfold = result.value;
    this._renderUnfoldReadout(result.value);
    this._showCalcResult(result.value);

    // Отрисовать сечение и развёртку
    if (this._profileRenderer) {
      this._profileRenderer.render(result.value.segments, result.value.thickness || p.thickness, result.value.startDir || 0);
    }
    if (this._unfoldRenderer) {
      this._unfoldRenderer.render(result.value.segments, result.value.totalLength);
    }

    this.setStatus('Готово', 'ok');
    eventBus.emit(EVENTS.UNFOLD_CALCULATED, result.value);

    // разрешить экспорт
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

  _showCalcResult(value) {
    const box = document.getElementById('calc-result');
    if (!box) return;
    const f = value.flats || {};
    const row = (label, v) => `<div class="calc-result__row"><span>${this._escapeHtml(label)}</span><span class="mono">${this._escapeHtml(v)}</span></div>`;

    // Расстояния до центров гибов
    const bendDists = this._calcBendCenterDistances(value);

    box.innerHTML = `
      <div class="calc-result__box glass">
        <div class="calc-result__success">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          Развёртка рассчитана — L = <b>${(value.totalLength ?? 0).toFixed(2)}</b> мм
        </div>
        <div class="calc-result__head">Профиль ${this._escapeHtml(value.profile || '—')} · ${value.bendCount ?? 0} гиб(ов)</div>
        <div class="calc-result__section">
          <div class="calc-result__section-title">Прямые участки</div>
          ${row('La — прямая A', (f.La ?? 0).toFixed(2) + ' мм')}
          ${row('Lb — прямая B', (f.Lb ?? 0).toFixed(2) + ' мм')}
          ${row('Lc — прямая C', (f.Lc ?? 0).toFixed(2) + ' мм')}
          ${row('Ld — прямая D', (f.Ld ?? 0).toFixed(2) + ' мм')}
          ${row('Le — прямая E', (f.Le ?? 0).toFixed(2) + ' мм')}
        </div>
        <div class="calc-result__section">
          <div class="calc-result__section-title">Расстояния до центров гибов</div>
          ${bendDists.map((d, i) => row(`L${i + 1} — до гиба ${i + 1}`, d.toFixed(2) + ' мм')).join('')}
        </div>
        <div class="calc-result__section">
          <div class="calc-result__section-title">Параметры гиба</div>
          ${row('Li — длина дуги', (value.li ?? 0).toFixed(3) + ' мм')}
          ${row('Σ Li — все дуги', ((value.li ?? 0) * (value.bendCount ?? 0)).toFixed(3) + ' мм')}
          ${row('BA (один гиб)', (value.ba ?? 0).toFixed(3) + ' мм')}
          ${row('BD (один гиб)', (value.bd ?? 0).toFixed(3) + ' мм')}
        </div>
        <div class="calc-result__total">Длина L = <b>${(value.totalLength ?? 0).toFixed(2)}</b> мм</div>
        <div class="calc-result__legend">
          <b>Легенда:</b> La, Lb, Lc, Ld, Le — длины прямых участков полок;
          Li — длина дуги гиба (BA); L1, L2… — расстояния от начала развёртки до центра соответствующего гиба.
        </div>
      </div>
    `;
    box.classList.remove('is-hidden');
  }

  /** Расчёт расстояний от начала развёртки до центра каждого гиба. */
  _calcBendCenterDistances(value) {
    const segs = value.segments || [];
    const dists = [];
    let cum = 0;
    for (const seg of segs) {
      if (seg.type === 'flat') {
        cum += seg.length || 0;
      } else if (seg.type === 'bend') {
        const ba = seg.ba || 0;
        dists.push(cum + ba / 2);
        cum += ba;
      }
    }
    return dists;
  }

  // ───────────────────────── Раскрой: детали ─────────────────────────

  _initNestingParts() {
    this._renderNestingParts();
    // делегирование изменений и удалений в списке деталей
    const list = document.getElementById('nest-parts');
    if (list) {
      list.addEventListener('input', (e) => {
        const row = e.target.closest('[data-part-index]');
        if (!row) return;
        const idx = Number(row.dataset.partIndex);
        const field = e.target.dataset.partField;
        if (!field) return;
        const v = e.target.value === '' ? 0 : Number(e.target.value);
        this.nestingParts[idx][field] = v;
      });
      list.addEventListener('click', (e) => {
        const del = e.target.closest('[data-part-del]');
        if (!del) return;
        const idx = Number(del.dataset.partDel);
        this.nestingParts.splice(idx, 1);
        this._renderNestingParts();
      });
    }
  }

  _addNestingPart() {
    this.nestingParts.push({ w: 200, h: 300, qty: 1 });
    this._renderNestingParts();
  }

  _renderNestingParts() {
    const list = document.getElementById('nest-parts');
    if (!list) return;
    list.innerHTML = '';
    this.nestingParts.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'nest-part-row';
      row.dataset.partIndex = i;
      row.innerHTML = `
        <div class="nest-part-row__num mono">${i + 1}</div>
        <input class="input" type="number" min="1" value="${p.w}" data-part-field="w" aria-label="Ширина детали ${i + 1}" />
        <span class="nest-part-row__sep">×</span>
        <input class="input" type="number" min="1" value="${p.h}" data-part-field="h" aria-label="Длина детали ${i + 1}" />
        <span class="nest-part-row__sep">×</span>
        <input class="input" type="number" min="1" value="${p.qty}" data-part-field="qty" aria-label="Количество детали ${i + 1}" />
        <button class="icon-btn nest-part-row__del" data-part-del="${i}" aria-label="Удалить деталь ${i + 1}" title="Удалить">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      `;
      list.appendChild(row);
    });
  }

  _runNesting() {
    this.setStatus('Оптимизация раскроя…', 'busy');

    // проверить негабарит
    const o = this.nestingOpts;
    const effectiveW = Math.max(0, (o.sheetWidth || 0) - 2 * (o.margin || 0));
    const effectiveH = Math.max(0, (o.sheetHeight || 0) - 2 * (o.margin || 0));
    const oversized = [];
    for (let i = 0; i < this.nestingParts.length; i++) {
      const p = this.nestingParts[i];
      const w = p.w || 0, h = p.h || 0;
      const fitsNormal = w <= effectiveW && h <= effectiveH;
      const fitsRotated = o.allowRotation && h <= effectiveW && w <= effectiveH;
      if (!fitsNormal && !fitsRotated) {
        oversized.push({ i: i + 1, w, h });
      }
    }

    const warnEl = document.getElementById('nest-warn');
    if (warnEl) {
      if (oversized.length > 0) {
        warnEl.classList.remove('is-hidden');
        warnEl.innerHTML = `<strong>Негабаритные детали:</strong> ${oversized.map((x) => `№${x.i} (${x.w}×${x.h} мм)`).join(', ')}.
        Эффективная область листа ${effectiveW.toFixed(0)}×${effectiveH.toFixed(0)} мм (с учётом отступа ${o.margin} мм).`;
        this.setStatus('Негабарит', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Раскрой невозможен',
          message: 'Некоторые детали больше эффективной области листа.',
          kind: 'danger',
        });
        return;
      } else {
        warnEl.classList.add('is-hidden');
      }
    }

    const parts = this.nestingParts.map((p, i) => ({
      w: p.w, h: p.h, qty: p.qty,
      id: `p${i + 1}`, label: `Деталь ${i + 1}`,
    }));

    const result = optimizeNesting({
      width: o.sheetWidth,
      height: o.sheetHeight,
      kerf: o.kerf,
      margin: o.margin,
      allowRotation: o.allowRotation,
      maxSheets: o.maxSheets,
    }, parts);

    this.lastNesting = result;
    this._renderNestingReadout(result);
    if (this._sheetRenderer) {
      this._sheetRenderer.render(result);
    }

    this.setStatus('Готово', 'ok');
    eventBus.emit(EVENTS.NESTING_DONE, result);
    eventBus.emit(EVENTS.TOAST_SHOW, {
      title: 'Раскрой оптимизирован',
      message: `${result.placedParts} из ${result.totalParts} деталей · ${result.sheets.length} лист(ов) · ${result.avgUtilization.toFixed(1)}% использование`,
      kind: 'ok',
    });

    eventBus.emit('export:availability', { formats: ['svg', 'dxf'] });
  }

  _renderNestingReadout(result) {
    const set = (key, text) => {
      const el = document.querySelector(`[data-out="${key}"]`);
      if (el) el.textContent = text;
    };
    set('sheet-count', String(result.sheets.length));
    set('utilization', `${result.avgUtilization.toFixed(1)}%`);
    set('placed', `${result.placedParts} / ${result.totalParts}`);
    set('unplaced', String(result.unplaced.length));

    // таблица деталей
    const table = document.getElementById('nesting-table');
    if (table) {
      const rows = result.sheets.flatMap((sheet, si) =>
        sheet.placed.map((p, pi) => {
          return `<tr>
            <td class="mono">${si + 1}.${pi + 1}</td>
            <td class="mono">${p.w.toFixed(0)}×${p.h.toFixed(0)}</td>
            <td class="mono">${p.x.toFixed(0)}, ${p.y.toFixed(0)}</td>
            <td class="mono">${p.rotated ? '90°' : '—'}</td>
          </tr>`;
        })
      );
      table.innerHTML = `
        <thead><tr><th>№</th><th>Размер</th><th>X, Y</th><th>Поворот</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      `;
    }
  }

  // ───────────────────────── Экспорт ─────────────────────────

  _wireExportBar() {
    const bar = document.getElementById('export-bar');
    if (!bar) return;
    bar.querySelectorAll('[data-export]').forEach((b) => {
      const fmt = b.dataset.export;
      if (fmt === 'pdf') b.setAttribute('data-feature', 'exportPDF');
      if (fmt === 'dxf') b.setAttribute('data-feature', 'exportDXF');
    });

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-export]');
      if (!btn || btn.disabled) return;
      if (btn.classList.contains('is-locked-wrap')) {
        showPremiumModal(btn.dataset.feature);
        return;
      }
      const fmt = btn.dataset.export;
      const route = this.router.route;
      this._doExport(fmt, route);
    });

    eventBus.on('export:availability', ({ formats }) => {
      bar.querySelectorAll('[data-export]').forEach((b) => {
        if (b.classList.contains('is-locked-wrap')) return;
        if (formats.includes(b.dataset.export)) {
          b.disabled = false;
        }
      });
      applyGating();
    });
  }

  _doExport(format, route) {
    try {
      if (route === 'unfold') {
        if (!this.lastUnfold) {
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Нет данных',
            message: 'Сначала рассчитайте развёртку',
            kind: 'warn',
          });
          return;
        }
        if (format === 'svg') {
          // экспортируем развёртку (stage-unfold)
          exportSVG('stage-unfold', `unfold_${this.lastUnfold.profile || 'profile'}.svg`);
        } else if (format === 'dxf') {
          const dxf = generateUnfoldDXF(this.lastUnfold);
          downloadDXF(dxf, `unfold_${this.lastUnfold.profile || 'profile'}.dxf`);
        } else if (format === 'pdf') {
          exportUnfoldPDF(this.lastUnfold, `unfold_${this.lastUnfold.profile || 'profile'}.pdf`);
        }
      } else if (route === 'nesting') {
        if (!this.lastNesting) {
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Нет данных',
            message: 'Сначала оптимизируйте раскрой',
            kind: 'warn',
          });
          return;
        }
        if (format === 'svg') {
          exportSVG('stage-sheet', 'nesting.svg');
        } else if (format === 'dxf') {
          const dxf = generateNestingDXF(this.lastNesting);
          downloadDXF(dxf, 'nesting.dxf');
        } else if (format === 'pdf') {
          exportNestingPDF(this.lastNesting, 'nesting.pdf');
        }
      } else {
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Экспорт недоступен',
          message: 'На вкладке «Калькулятор» нет экспорта',
          kind: 'warn',
        });
        return;
      }
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Экспорт выполнен',
        message: `Файл .${format} сохранён`,
        kind: 'ok',
      });
    } catch (err) {
      console.error('[Export] error:', err);
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Ошибка экспорта',
        message: err?.message || String(err),
        kind: 'danger',
      });
    }
  }

  // ───────────────────────── Панель разработчика + гейтинг ─────────────────────────

  _initDevPanel() {
    initDevPanel();
  }

  // ───────────────────────── Аутентификация ─────────────────────────

  _initAuth() {
    // подписка на изменения авторизации
    eventBus.on('auth:change', () => this._onAuthChange());

    // инициализируем модуль auth (восстановление сессии)
    initAuth().then(() => {
      this._updateAccountUI();
      this._checkPaymentReturn();
    });

    // кнопки в шапке
    document.getElementById('account-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (getUser()) {
        this._toggleAcctMenu();
      } else {
        this._openAuthModal('login');
      }
    });
    document.getElementById('projects-btn')?.addEventListener('click', () => {
      if (getUser()) {
        this._openProjectsModal();
      } else {
        this._openAuthModal('login');
      }
    });

    // закрытие модалок по клику на overlay и кнопкам закрытия
    this._wireModalClose('auth-modal', 'auth-close', () => this._closeAuthModal());
    this._wireModalClose('verify-modal', 'verify-close', () => this._closeVerifyModal());
    this._wireModalClose('reset-modal', 'reset-close', () => this._closeResetModal());
    this._wireModalClose('plans-modal', 'plans-close', () => this._closePlansModal());
    this._wireModalClose('payment-code-modal', 'payment-code-close', () => this._closePaymentCodeModal());
    this._wireModalClose('projects-modal', 'projects-close', () => this._closeProjectsModal());
  }

  _onAuthChange() {
    this._updateAccountUI();
  }

  _updateAccountUI() {
    const u = getUser();
    const btn = document.getElementById('account-btn');
    const label = document.getElementById('acct-label');
    const badge = document.getElementById('acct-plan');
    const iconOut = document.querySelector('.acct-btn__icon-out');
    const iconIn = document.querySelector('.acct-btn__icon-in');
    if (btn && label) {
      if (u) {
        btn.classList.add('is-logged');
        label.textContent = u.email || 'Профиль';
        if (iconOut) iconOut.style.display = 'none';
        if (iconIn) iconIn.style.display = 'inline';
        btn.title = `${u.email} — нажмите для меню`;
      } else {
        btn.classList.remove('is-logged');
        label.textContent = 'Войти';
        if (iconOut) iconOut.style.display = 'inline';
        if (iconIn) iconIn.style.display = 'none';
        btn.title = 'Войти или зарегистрироваться';
      }
    }
    if (badge) {
      const isPaid = u && u.premium;
      if (isPaid) {
        badge.textContent = u.plan === 'lifetime' ? '∞' : 'PRO';
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    }
    this._updateAcctMenu();
  }

  _toggleAcctMenu() {
    const menu = document.getElementById('acct-menu');
    if (!menu) return;
    const open = menu.classList.toggle('is-open');
    menu.setAttribute('aria-hidden', String(!open));
  }

  _closeAcctMenu() {
    const menu = document.getElementById('acct-menu');
    if (!menu) return;
    menu.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
  }

  _updateAcctMenu() {
    const u = getUser();
    const logoutItem = document.getElementById('acct-logout');
    const plansItem = document.getElementById('acct-plans');
    if (logoutItem) logoutItem.style.display = u ? '' : 'none';
    if (plansItem) plansItem.style.display = u ? '' : 'none';
  }

  _handleLogout() {
    logout().then(() => {
      this._closeAcctMenu();
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Вы вышли',
        kind: 'ok',
      });
    });
  }

  // ─── Auth modal ───

  _openAuthModal(tab = 'login') {
    const overlay = document.getElementById('auth-modal');
    if (!overlay) return;
    this._switchAuthTab(tab);
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }
  _closeAuthModal() {
    const overlay = document.getElementById('auth-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    // очистить ошибки
    document.querySelectorAll('.auth-form__error').forEach((e) => e.textContent = '');
  }

  _switchAuthTab(tab) {
    this._authTab = tab;
    document.querySelectorAll('.auth-tab').forEach((t) => {
      const active = t.dataset.tab === tab;
      t.classList.toggle('is-active', active);
      t.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.auth-form').forEach((f) => {
      f.classList.toggle('is-hidden', f.dataset.tab !== tab);
    });
    const title = document.getElementById('auth-modal-title');
    if (title) title.textContent = tab === 'login' ? 'Вход' : 'Регистрация';
    const submit = document.getElementById('auth-submit-label');
    if (submit) submit.textContent = tab === 'login' ? 'Войти' : 'Зарегистрироваться';
  }

  _handleAuthSubmit() {
    const emailEl = document.getElementById('auth-email');
    const passEl = document.getElementById('auth-password');
    const errEl = document.querySelector('#auth-modal .auth-form__error');
    const email = emailEl?.value?.trim() || '';
    const password = passEl?.value || '';

    if (!email || !password) {
      if (errEl) errEl.textContent = 'Заполните email и пароль';
      return;
    }
    // проверка TLD .ru
    if (!/\.ru$/i.test(email)) {
      if (errEl) errEl.textContent = 'Допускаются только email-адреса в домене .ru';
      return;
    }

    if (this._authTab === 'login') {
      login(email, password).then((r) => {
        if (r.ok) {
          this._closeAuthModal();
          eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Вход выполнен', kind: 'ok' });
        } else if (r.needVerification) {
          this._closeAuthModal();
          this._openVerifyModal();
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Требуется подтверждение',
            message: 'Введите код подтверждения из письма',
            kind: 'warn',
          });
        } else {
          if (errEl) errEl.textContent = r.error || 'Ошибка входа';
        }
      }).catch((e) => {
        if (errEl) errEl.textContent = e?.message || 'Ошибка';
      });
    } else {
      register(email, password).then((r) => {
        if (r.ok) {
          this._closeAuthModal();
          if (r.verificationCode) {
            eventBus.emit(EVENTS.TOAST_SHOW, {
              title: 'Код подтверждения',
              message: `Ваш код: ${r.verificationCode} (демо-режим)`,
              kind: 'warn',
              timeout: 8000,
            });
          }
          this._openVerifyModal();
        } else {
          if (errEl) errEl.textContent = r.error || 'Ошибка регистрации';
        }
      }).catch((e) => {
        if (errEl) errEl.textContent = e?.message || 'Ошибка';
      });
    }
  }

  // ─── Verify modal ───

  _openVerifyModal() {
    const overlay = document.getElementById('verify-modal');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('verify-code')?.focus();
  }
  _closeVerifyModal() {
    const overlay = document.getElementById('verify-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    const errEl = document.getElementById('verify-error');
    if (errEl) errEl.textContent = '';
    const codeEl = document.getElementById('verify-code');
    if (codeEl) codeEl.value = '';
  }

  _handleVerify() {
    const codeEl = document.getElementById('verify-code');
    const errEl = document.getElementById('verify-error');
    const code = (codeEl?.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
      if (errEl) errEl.textContent = 'Код должен состоять из 6 цифр';
      return;
    }
    verifyEmail(code).then((r) => {
      if (r.ok) {
        this._closeVerifyModal();
        eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Email подтверждён', kind: 'ok' });
      } else {
        if (errEl) errEl.textContent = r.error || 'Неверный код';
      }
    });
  }

  _handleResend() {
    resendCode().then((r) => {
      if (r.ok) {
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Код выслан повторно',
          message: r.code ? `Код: ${r.code} (демо)` : undefined,
          kind: 'ok',
        });
      } else {
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Ошибка', message: r.error || 'Не удалось выслать код', kind: 'danger',
        });
      }
    });
  }

  // ─── Reset modal ───

  _openResetModal() {
    const overlay = document.getElementById('reset-modal');
    if (!overlay) return;
    this._showResetStep('email');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }
  _closeResetModal() {
    const overlay = document.getElementById('reset-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    ['reset-email', 'reset-code', 'reset-password'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const errEl = document.getElementById('reset-error');
    if (errEl) errEl.textContent = '';
  }

  _showResetStep(step) {
    this._resetStep = step;
    const emailStep = document.getElementById('reset-step-email');
    const passStep = document.getElementById('reset-step-password');
    if (emailStep) emailStep.classList.toggle('is-hidden', step !== 'email');
    if (passStep) passStep.classList.toggle('is-hidden', step !== 'password');
  }

  _handleResetRequest() {
    const emailEl = document.getElementById('reset-email');
    const errEl = document.getElementById('reset-error');
    const email = (emailEl?.value || '').trim();
    if (!email) {
      if (errEl) errEl.textContent = 'Введите email';
      return;
    }
    if (!/\.ru$/i.test(email)) {
      if (errEl) errEl.textContent = 'Допускаются только .ru-адреса';
      return;
    }
    requestReset(email).then((r) => {
      if (r.ok) {
        if (r.code) {
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Код сброса',
            message: `Код: ${r.code} (демо)`,
            kind: 'warn',
            timeout: 8000,
          });
        }
        this._showResetStep('password');
      } else {
        if (errEl) errEl.textContent = r.error || 'Ошибка';
      }
    });
  }

  _handleResetPassword() {
    const emailEl = document.getElementById('reset-email');
    const codeEl = document.getElementById('reset-code');
    const passEl = document.getElementById('reset-password');
    const errEl = document.getElementById('reset-error');
    const email = (emailEl?.value || '').trim();
    const code = (codeEl?.value || '').trim();
    const newPassword = passEl?.value || '';
    if (!/^\d{6}$/.test(code)) {
      if (errEl) errEl.textContent = 'Код должен состоять из 6 цифр';
      return;
    }
    if (newPassword.length < 6) {
      if (errEl) errEl.textContent = 'Пароль не короче 6 символов';
      return;
    }
    resetPassword(email, code, newPassword).then((r) => {
      if (r.ok) {
        this._closeResetModal();
        eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Пароль сброшен', kind: 'ok' });
      } else {
        if (errEl) errEl.textContent = r.error || 'Ошибка';
      }
    });
  }

  // ─── Plans modal ───

  _openPlansModal() {
    const overlay = document.getElementById('plans-modal');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }
  _closePlansModal() {
    const overlay = document.getElementById('plans-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  _handleSetPlan(plan) {
    if (!getUser()) {
      this._closePlansModal();
      this._openAuthModal('login');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Войдите в аккаунт',
        message: 'Для оформления тарифа нужно войти',
        kind: 'warn',
      });
      return;
    }
    setPlan(plan).then((r) => {
      if (r.ok) {
        if (r.demo) {
          this._closePlansModal();
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Демо-режим активирован',
            message: 'Премиум-функции доступны на 24 часа',
            kind: 'ok',
          });
        } else if (r.paymentUrl) {
          // боевой режим — редирект на платёжку
          this._pendingPaymentId = r.paymentId;
          window.open(r.paymentUrl, '_blank');
          this._closePlansModal();
          this._openPaymentCodeModal();
        } else {
          this._closePlansModal();
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Тариф активирован',
            message: `Тариф: ${plan}`,
            kind: 'ok',
          });
        }
      } else {
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Ошибка',
          message: r.error || 'Не удалось активировать тариф',
          kind: 'danger',
        });
      }
    });
  }

  // ─── Payment code modal ───

  _openPaymentCodeModal() {
    const overlay = document.getElementById('payment-code-modal');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('payment-code')?.focus();
  }
  _closePaymentCodeModal() {
    const overlay = document.getElementById('payment-code-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    const codeEl = document.getElementById('payment-code');
    if (codeEl) codeEl.value = '';
    const errEl = document.getElementById('payment-code-error');
    if (errEl) errEl.textContent = '';
  }

  _handleVerifyPayment() {
    const codeEl = document.getElementById('payment-code');
    const errEl = document.getElementById('payment-code-error');
    const code = (codeEl?.value || '').replace(/\s+/g, '');
    if (!/^\d{16}$/.test(code)) {
      if (errEl) errEl.textContent = 'Код должен состоять из 16 цифр';
      return;
    }
    const pid = this._pendingPaymentId;
    if (!pid) {
      if (errEl) errEl.textContent = 'Нет активного платежа';
      return;
    }
    verifyPayment(code, pid).then((r) => {
      if (r.ok) {
        this._closePaymentCodeModal();
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Платёж подтверждён',
          message: 'Тариф активирован',
          kind: 'ok',
        });
      } else {
        if (errEl) errEl.textContent = r.error || 'Неверный код';
      }
    });
  }

  _checkPaymentReturn() {
    const params = new URLSearchParams(window.location.search);
    const pid = params.get('payment');
    if (pid) {
      // очистим URL
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      } catch { /* noop */ }
      this._pendingPaymentId = pid;
      checkPaymentStatus(pid).then((r) => {
        if (r.ok && r.status === 'paid') {
          eventBus.emit(EVENTS.TOAST_SHOW, {
            title: 'Оплата получена',
            message: 'Тариф активирован',
            kind: 'ok',
          });
        } else if (r.ok) {
          // платёж ещё не подтвердился — попросить код
          this._openPaymentCodeModal();
        } else {
          this._openPaymentCodeModal();
        }
      });
    }
  }

  // ─── Projects modal ───

  _openProjectsModal() {
    const overlay = document.getElementById('projects-modal');
    if (!overlay) return;
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    this._loadProjectsList();
  }
  _closeProjectsModal() {
    const overlay = document.getElementById('projects-modal');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  async _loadProjectsList() {
    const listEl = document.getElementById('projects-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="projects-loading">Загрузка…</div>';
    const r = await listProjects();
    if (!r.ok) {
      listEl.innerHTML = `<div class="projects-empty">${this._escapeHtml(r.error || 'Ошибка')}</div>`;
      return;
    }
    const projects = r.projects || [];
    if (projects.length === 0) {
      listEl.innerHTML = '<div class="projects-empty">Нет сохранённых проектов</div>';
      return;
    }
    listEl.innerHTML = projects.map((p) => `
      <div class="project-item" data-project-id="${this._escapeHtml(p.id)}">
        <div class="project-item__main">
          <div class="project-item__name">${this._escapeHtml(p.name)}</div>
          <div class="project-item__meta">Тип: ${this._escapeHtml(p.type || '—')} · ${new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleString('ru-RU')}</div>
        </div>
        <button class="icon-btn" data-project-load="${this._escapeHtml(p.id)}" title="Открыть">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
        </button>
        <button class="icon-btn" data-project-del-id="${this._escapeHtml(p.id)}" title="Удалить">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    `).join('');

    // привязка кнопок
    listEl.querySelectorAll('[data-project-load]').forEach((b) => {
      b.addEventListener('click', () => this._handleLoadProject(b.dataset.projectLoad));
    });
    listEl.querySelectorAll('[data-project-del-id]').forEach((b) => {
      b.addEventListener('click', () => this._handleDeleteProject(b.dataset.projectDelId));
    });
  }

  async _handleSaveProject() {
    const nameEl = document.getElementById('project-name');
    const typeEl = document.getElementById('project-type');
    const errEl = document.getElementById('projects-error');
    const name = (nameEl?.value || '').trim() || `Проект ${new Date().toLocaleString('ru-RU')}`;
    const type = typeEl?.value || 'unfold';
    const route = this.router.route;
    const data = route === 'nesting'
      ? { parts: this.nestingParts, opts: this.nestingOpts, result: this.lastNesting }
      : { unfold: this.unfoldParams, custom: this.customSegments, result: this.lastUnfold };
    const r = await createProject(name, { type: route, ...data });
    if (r.ok) {
      if (nameEl) nameEl.value = '';
      eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Проект сохранён', kind: 'ok' });
      this._loadProjectsList();
    } else {
      if (errEl) errEl.textContent = r.error || 'Ошибка';
    }
  }

  async _handleLoadProject(id) {
    const errEl = document.getElementById('projects-error');
    const r = await getProject(id);
    if (!r.ok) {
      if (errEl) errEl.textContent = r.error || 'Ошибка';
      return;
    }
    const p = r.project;
    if (!p || !p.data) {
      if (errEl) errEl.textContent = 'Пустой проект';
      return;
    }
    // синхронизировать данные проекта с UI
    this._syncInputsFromParams(p.data);
    this._closeProjectsModal();
    eventBus.emit(EVENTS.TOAST_SHOW, {
      title: 'Проект загружен',
      message: p.name,
      kind: 'ok',
    });
  }

  async _handleDeleteProject(id) {
    const r = await deleteProject(id);
    if (r.ok) {
      this._loadProjectsList();
      eventBus.emit(EVENTS.TOAST_SHOW, { title: 'Проект удалён', kind: 'ok' });
    }
  }

  _syncInputsFromParams(data) {
    if (!data) return;
    const route = data.type || 'unfold';
    this.router.navigate(route);
    if (route === 'nesting') {
      if (data.parts) {
        this.nestingParts = data.parts;
        this._renderNestingParts();
      }
      if (data.opts) {
        this.nestingOpts = { ...this.nestingOpts, ...data.opts };
        // обновить поля UI
        const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        set('ns-sheet-len', this.nestingOpts.sheetHeight);
        set('ns-sheet-wid', this.nestingOpts.sheetWidth);
        set('ns-kerf', this.nestingOpts.kerf);
        set('ns-margin', this.nestingOpts.margin);
        const lock = document.querySelector('[data-input="lock-rotation"]');
        if (lock) lock.checked = !this.nestingOpts.allowRotation;
      }
      if (data.result) {
        this.lastNesting = data.result;
        this._renderNestingReadout(data.result);
        if (this._sheetRenderer) this._sheetRenderer.render(data.result);
      }
    } else {
      if (data.unfold) {
        this.unfoldParams = { ...this.unfoldParams, ...data.unfold };
        const set = (sel, v) => { const el = document.querySelector(`[data-input="${sel}"]`); if (el) el.value = v; };
        set('thickness', this.unfoldParams.thickness);
        set('radius', this.unfoldParams.radius);
        set('angle', this.unfoldParams.angle);
        set('profile-type', this.unfoldParams.profileType);
        this._renderFlangeFields(this.unfoldParams.profileType);
        this._toggleCustomEditor(this.unfoldParams.profileType);
      }
      if (data.custom) {
        this.customSegments = data.custom;
        this._renderCustomEditor();
      }
      if (data.result) {
        this.lastUnfold = data.result;
        this._renderUnfoldReadout(data.result);
        this._showCalcResult(data.result);
        if (this._profileRenderer) this._profileRenderer.render(data.result.segments, data.result.thickness);
        if (this._unfoldRenderer) this._unfoldRenderer.render(data.result.segments, data.result.totalLength);
      }
    }
  }

  // ───────────────────────── Металлокалькулятор ─────────────────────────

  _initMetalCalc() {
    this._renderMcDims();
    this._updateMcValueLabel();
    this._updateMcReadout();
  }

  _renderMcDims() {
    const container = document.getElementById('mc-dims');
    if (!container) return;
    const fields = MC_PROFILE_FIELDS[this.mcProfile] || [];
    container.innerHTML = '';
    container.className = 'field-row';
    fields.forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      wrap.innerHTML = `
        <label class="field-label">${this._escapeHtml(f.label)}</label>
        <input class="input" type="number" min="0.1" step="0.1"
               value="${this.mcDims[f.key] ?? ''}"
               data-input="mc-dim-${f.key}"
               aria-label="${this._escapeHtml(f.label)}" />
      `;
      container.appendChild(wrap);
    });
    // 1 поле → 1 колонка; 2 — две; 3 — три
    const n = fields.length;
    container.classList.remove('field-row--3');
    if (n === 3) container.classList.add('field-row--3');
    if (n === 1) container.style.gridTemplateColumns = '1fr';
  }

  _updateMcValueLabel() {
    const lbl = document.getElementById('mc-value-label');
    const qtyLbl = document.getElementById('mc-qty-label');
    if (lbl) {
      lbl.textContent = this.mcMode === 'weight' ? 'Длина, м' : 'Вес, кг';
    }
    if (qtyLbl) {
      qtyLbl.textContent = 'Количество, шт';
    }
  }

  async _runMetalCalc() {
    this.setStatus('Расчёт металлопроката…', 'busy');
    const payload = {
      profile: this.mcProfile,
      material: this.mcMaterial,
      dims: { ...this.mcDims },
      mode: this.mcMode,
      value: Number(document.getElementById('mc-value')?.value || 0),
      qty: Number(document.getElementById('mc-qty')?.value || 1),
    };
    try {
      const res = await fetch('/api/metal-calc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        this.setStatus('Ошибка', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Ошибка расчёта',
          message: data?.error || `HTTP ${res.status}`,
          kind: 'danger',
        });
        return;
      }
      this._renderMcResult(data);
      this.setStatus('Готово', 'ok');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Расчёт выполнен',
        kind: 'ok',
      });
    } catch (e) {
      this.setStatus('Ошибка сети', 'error');
      eventBus.emit(EVENTS.TOAST_SHOW, {
        title: 'Сеть недоступна',
        message: e?.message || 'Не удалось связаться с сервером',
        kind: 'danger',
      });
    }
  }

  _renderMcResult(data) {
    const stage = document.getElementById('mc-result-stage');
    const mainVal = this.mcMode === 'weight' ? (data.weight ?? 0) : (data.length ?? 0);
    const mainUnit = this.mcMode === 'weight' ? 'кг' : 'м';
    const mainLabel = this.mcMode === 'weight' ? 'Общий вес' : 'Общая длина';
    const density = MC_DENSITIES[this.mcMaterial] || 0;

    if (stage) {
      stage.innerHTML = `
        <div class="mc-result-card glass">
          <div class="mc-result-main">
            <div class="mc-result-main__label">${this._escapeHtml(mainLabel)}</div>
            <div class="mc-result-main__value mono">${this._fmt(mainVal, 3)} <span class="mc-result-main__unit">${mainUnit}</span></div>
          </div>
          <div class="mc-result-sub">
            <div class="mc-result-sub__item">
              <div class="mc-result-sub__k">Вес 1м</div>
              <div class="mc-result-sub__v mono">${this._fmt(data.weightPerMeter ?? 0, 3)} кг</div>
            </div>
            <div class="mc-result-sub__item">
              <div class="mc-result-sub__k">Площадь</div>
              <div class="mc-result-sub__v mono">${this._fmt(data.area ?? 0, 1)} мм²</div>
            </div>
            <div class="mc-result-sub__item">
              <div class="mc-result-sub__k">Плотность</div>
              <div class="mc-result-sub__v mono">${density} кг/м³</div>
            </div>
            <div class="mc-result-sub__item">
              <div class="mc-result-sub__k">${this.mcMode === 'weight' ? 'Длина' : 'Вес'}</div>
              <div class="mc-result-sub__v mono">${this._fmt(this.mcMode === 'weight' ? (data.length ?? 0) : (data.weight ?? 0), 3)} ${this.mcMode === 'weight' ? 'м' : 'кг'}</div>
            </div>
          </div>
        </div>
      `;
    }

    // readout
    const set = (k, v) => {
      const el = document.querySelector(`[data-out="${k}"]`);
      if (el) el.textContent = v;
    };
    set('mc-weight-1m', `${this._fmt(data.weightPerMeter ?? 0, 3)} кг`);
    set('mc-area', `${this._fmt(data.area ?? 0, 1)} мм²`);
    set('mc-density', `${density} кг/м³`);
    set('mc-total-weight', `${this._fmt(data.weight ?? 0, 3)} кг`);
    set('mc-total-length', `${this._fmt(data.length ?? 0, 3)} м`);
    set('mc-qty', String(data.qty ?? 1));
  }

  _updateMcReadout() {
    // пустой ререндер readout
  }

  _clearMetalCalc() {
    const stage = document.getElementById('mc-result-stage');
    if (stage) stage.innerHTML = `<div class="mc-result-empty">Введите параметры и нажмите «Рассчитать»</div>`;
  }

  _fmt(n, frac = 2) {
    if (!Number.isFinite(n)) return '0';
    const f = Math.pow(10, frac);
    return (Math.round(n * f) / f).toFixed(frac);
  }

  // ───────────────────────── общие модалки ─────────────────────────

  _wireModalClose(modalId, closeBtnId, onClose) {
    const overlay = document.getElementById(modalId);
    const closeBtn = document.getElementById(closeBtnId);
    overlay?.addEventListener('click', (e) => {
      if (e.target === overlay) onClose();
    });
    closeBtn?.addEventListener('click', onClose);
  }

  _wireAllModalClosers() {
    // клик по overlay любой модалки закрывает её
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.remove('is-open');
          overlay.setAttribute('aria-hidden', 'true');
        }
      });
    });
  }
}
