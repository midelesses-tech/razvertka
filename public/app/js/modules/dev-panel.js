/**
 * dev-panel.js
 * Панель разработчика для тестирования платных функций.
 *
 * Открытие:
 *   - сочетание Ctrl+Shift+D
 *   - 5 быстрых кликов по логотипу в шапке
 *
 * Функции:
 *   - тумблер «Премиум-режим» (setPremium из feature-flags)
 *   - очистка сохранённых проектов
 *   - индикатор текущего состояния (FREE / PREMIUM)
 *
 * UI-гейтинг:
 *   - applyGating() расставляет замочки на [data-feature] элементах
 *     в зависимости от canUse(). При клике на заблокированный элемент
 *     показывается модалка «Премиум».
 *   - подписка на 'flags:change' обновляет гейтинг без перезагрузки.
 */

import { eventBus, EVENTS } from '../utils/event-bus.js';
import { isPremium, setPremium, canUse, whyLocked } from './feature-flags.js';
import { clearProjects } from './storage.js';

const DEV_OPEN_KEY = 'rzv:dev-panel-open';

let _devOpen = false;

/**
 * Инициализация панели разработчика и UI-гейтинга.
 */
export function initDevPanel() {
  _bindOpenTriggers();
  _bindPanelControls();
  _bindPremiumModal();
  applyGating();

  // обновлять гейтинг при смене премиума
  eventBus.on('flags:change', () => applyGating());
  // и при смене маршрута (на каждой вкладке свой набор кнопок)
  eventBus.on(EVENTS.ROUTE_CHANGE, () => setTimeout(applyGating, 0));
}

/** Применить гейтинг ко всем [data-feature] элементам. */
export function applyGating() {
  document.querySelectorAll('[data-feature]').forEach((el) => {
    const feature = el.dataset.feature;
    const allowed = canUse(feature);
    if (allowed) {
      _unlock(el);
    } else {
      _lock(el, feature);
    }
  });
}

// ───────────────────────── открытие/закрытие ─────────────────────────

function _bindOpenTriggers() {
  // Ctrl+Shift+D
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.key === 'В' || e.key === 'в')) {
      e.preventDefault();
      toggleDevPanel();
    }
  });

  // 5 быстрых кликов по логотипу
  let clicks = 0;
  let lastClick = 0;
  const brand = document.querySelector('.brand__mark');
  brand?.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastClick > 600) clicks = 0;
    clicks++;
    lastClick = now;
    if (clicks >= 5) {
      clicks = 0;
      toggleDevPanel();
    }
  });

  // восстановить состояние из localStorage (для удобства разработки)
  try {
    if (localStorage.getItem(DEV_OPEN_KEY) === '1') {
      _open();
    }
  } catch { /* noop */ }
}

function toggleDevPanel() {
  if (_devOpen) _close();
  else _open();
}

function _open() {
  _devOpen = true;
  const panel = document.getElementById('dev-panel');
  panel?.classList.add('is-open');
  panel?.setAttribute('aria-hidden', 'false');
  try { localStorage.setItem(DEV_OPEN_KEY, '1'); } catch { /* noop */ }
  _syncPanelState();
}

function _close() {
  _devOpen = false;
  const panel = document.getElementById('dev-panel');
  panel?.classList.remove('is-open');
  panel?.setAttribute('aria-hidden', 'true');
  try { localStorage.setItem(DEV_OPEN_KEY, '0'); } catch { /* noop */ }
}

function _bindPanelControls() {
  document.getElementById('dev-close')?.addEventListener('click', _close);

  const toggle = document.getElementById('dev-premium-toggle');
  toggle?.addEventListener('click', () => {
    setPremium(!isPremium());
    _syncPanelState();
  });

  document.getElementById('dev-clear-projects')?.addEventListener('click', () => {
    clearProjects();
    eventBus.emit(EVENTS.TOAST_SHOW, {
      title: 'Проекты очищены',
      message: 'Все сохранённые проекты удалены из localStorage.',
      kind: 'ok',
    });
  });
}

function _syncPanelState() {
  const toggle = document.getElementById('dev-premium-toggle');
  const badge = document.getElementById('dev-premium-badge');
  const premium = isPremium();
  if (toggle) {
    toggle.classList.toggle('is-on', premium);
    toggle.setAttribute('aria-checked', String(premium));
  }
  if (badge) {
    badge.textContent = premium ? 'PREMIUM' : 'FREE';
    badge.classList.toggle('is-off', !premium);
  }
}

// ───────────────────────── гейтинг элементов ─────────────────────────

function _lock(el, feature) {
  el.classList.add('is-locked-wrap');
  // если замочка ещё нет — добавить
  if (!el.querySelector('.lock-badge')) {
    const badge = document.createElement('span');
    badge.className = 'lock-badge';
    badge.title = whyLocked(feature);
    badge.setAttribute('aria-label', 'Функция в премиуме');
    badge.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showPremiumModal(feature);
    });
    el.appendChild(badge);
  }
  // клик по заблокированному элементу → модалка
  el.addEventListener('click', _lockedClickHandler, true);
}

function _unlock(el) {
  el.classList.remove('is-locked-wrap');
  el.querySelector('.lock-badge')?.remove();
  el.removeEventListener('click', _lockedClickHandler, true);
}

function _lockedClickHandler(e) {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  const feature = el.dataset.feature;
  showPremiumModal(feature);
}

// ───────────────────────── модалка «Премиум» ─────────────────────────

function _bindPremiumModal() {
  const overlay = document.getElementById('premium-modal');
  document.getElementById('premium-close')?.addEventListener('click', hidePremiumModal);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) hidePremiumModal();
  });
  document.getElementById('premium-try')?.addEventListener('click', () => {
    setPremium(true);
    _syncPanelState();
    hidePremiumModal();
    _open(); // открыть панель, чтобы видеть состояние
    eventBus.emit(EVENTS.TOAST_SHOW, {
      title: 'Премиум включён',
      message: 'Все функции разблокированы для тестирования.',
      kind: 'ok',
    });
  });
  // Escape
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hidePremiumModal();
  });
}

export function showPremiumModal(feature) {
  const overlay = document.getElementById('premium-modal');
  const text = document.getElementById('premium-text');
  if (text) text.textContent = whyLocked(feature) || 'Эта возможность доступна в премиум-подписке.';
  overlay?.classList.add('is-open');
  overlay?.setAttribute('aria-hidden', 'false');
}

export function hidePremiumModal() {
  const overlay = document.getElementById('premium-modal');
  overlay?.classList.remove('is-open');
  overlay?.setAttribute('aria-hidden', 'true');
}
