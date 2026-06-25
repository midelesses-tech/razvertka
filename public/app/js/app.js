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
      flangeC: 40,
      flangeD: 15,
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
      'flange-d': 'flangeD',
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
   * Конфигурация полей для каждого типа профиля + мини-схема сечения.
   * Соглашение о размерах (внешние габариты):
   *   L: A, B — две полки.
   *   U: A — полка левая, B — полка правая (разнополочный!), C — высота (стенка).
   *   G: A, B — полки, C — высота (стенка), D — загиб края внутрь.
   *   C: A, B — полки, C — высота (стенка), D — отгиб края наружу.
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
      hint: 'A, B — полки, C — высота стенки, D — загиб края внутрь. Четыре гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Высота C', placeholder: 'C' },
        { param: 'flangeD', label: 'Загиб D', placeholder: 'D' },
      ],
      schema: 'G',
    },
    C: {
      label: 'Размеры C-профиля, мм',
      hint: 'A, B — полки, C — высота стенки, D — отгиб края наружу. Четыре гиба 90°.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
        { param: 'flangeC', label: 'Высота C', placeholder: 'C' },
        { param: 'flangeD', label: 'Отгиб D', placeholder: 'D' },
      ],
      schema: 'C',
    },
    custom: {
      label: 'Размеры заготовки, мм',
      hint: 'Конструктор произвольного сечения будет добавлен на шаге 4.',
      fields: [
        { param: 'flangeA', label: 'Полка A', placeholder: 'A' },
        { param: 'flangeB', label: 'Полка B', placeholder: 'B' },
      ],
      schema: 'L',
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
        // G-профиль: стенка C сверху, полки A/B вниз, загибы D внутрь
        return `<svg viewBox="0 0 160 110" class="profile-schema">
          <path d="M30 20 L130 20 L130 70 L110 70 M30 20 L30 70 L50 70" ${pathAttrs}/>
          <text x="80" y="12" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">C</text>
          <text x="20" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 20 48)">A</text>
          <text x="140" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(90 140 48)">B</text>
          <text x="80" y="82" fill="${txt}" style="${fontMono}" text-anchor="middle">D ↤  ↦ D</text>
        </svg>`;
      case 'C':
        // C-профиль: стенка C сверху, полки A/B вниз, отгибы D наружу
        return `<svg viewBox="0 0 160 110" class="profile-schema">
          <path d="M10 70 L30 70 L30 20 L130 20 L130 70 L150 70" ${pathAttrs}/>
          <text x="80" y="12" fill="${txtAcc}" style="${fontMono}" text-anchor="middle">C</text>
          <text x="24" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(-90 24 48)">A</text>
          <text x="136" y="48" fill="${txtAcc}" style="${fontMono}" text-anchor="middle" transform="rotate(90 136 48)">B</text>
          <text x="6" y="62" fill="${txt}" style="${fontMono}" text-anchor="middle">D↤</text>
          <text x="154" y="62" fill="${txt}" style="${fontMono}" text-anchor="middle">↦D</text>
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
    if (schemaEl) schemaEl.innerHTML = this._profileSchemaSVG(cfg.schema);

    container.innerHTML = '';
    for (const f of cfg.fields) {
      const wrap = document.createElement('div');
      wrap.className = 'field-group';
      const dataKey = f.param === 'flangeA' ? 'flange-a'
        : f.param === 'flangeB' ? 'flange-b'
        : f.param === 'flangeC' ? 'flange-c' : 'flange-d';
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

    // сетка: 2 поля — 2 колонки, 3 — 3, 4 — 2×2
    const n = cfg.fields.length;
    container.classList.remove('field-row', 'field-row--3');
    if (n === 3) container.classList.add('field-row--3');
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
      // U/G/C требуют flangeC (высота стенки); G/C требуют flangeD (загиб/отгиб)
      const needsC = ['U', 'G', 'C'].includes(kind);
      const needsD = ['G', 'C'].includes(kind);
      if (needsC && (p.flangeC == null || p.flangeC <= 0)) {
        const cField = document.querySelector('[data-input="flange-c"]');
        markInvalid(cField, 'flangeC: высота C должна быть положительной');
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Не удалось рассчитать', message: 'Укажите высоту стенки C', kind: 'danger',
        });
        return;
      }
      if (needsD && (p.flangeD == null || p.flangeD <= 0)) {
        const dField = document.querySelector('[data-input="flange-d"]');
        markInvalid(dField, 'flangeD: размер D должен быть положительным');
        this.setStatus('Ошибка ввода', 'error');
        eventBus.emit(EVENTS.TOAST_SHOW, {
          title: 'Не удалось рассчитать', message: 'Укажите размер загиба/отгиба D', kind: 'danger',
        });
        return;
      }
      const segs = buildStandardProfile(kind, {
        flangeA: p.flangeA,
        flangeB: p.flangeB,
        flangeC: p.flangeC,
        flangeD: p.flangeD,
        angle: p.angle,
        thickness: p.thickness,
        radius: p.radius,
      });
      const calc = calculateUnfold(segs, {
        thickness: p.thickness, radius: p.radius, kfactor: p.kfactor, material: p.material,
      });
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
          // прямые участки и дуга — для детального readout
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
