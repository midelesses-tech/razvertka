/**
 * auth.js
 * Клиентский модуль аутентификации и подписки.
 *
 * Связывается с API-роутами Next.js и хранит текущего пользователя
 * в памяти. При изменении состояния публикует событие 'auth:change'.
 *
 * Авторизация через httpOnly-cookie (JWT), credentials: 'same-origin'.
 */

import { eventBus } from '../utils/event-bus.js';

/**
 * @typedef {Object} AuthUser
 * @property {string} id
 * @property {string} email
 * @property {boolean} premium
 * @property {string} plan — none | month | year | lifetime
 * @property {string|null} premiumUntil
 * @property {string|null} emailVerified
 * @property {string|null} name
 */

/** @type {AuthUser|null} */
let currentUser = null;
let initialized = false;

/** Низкоуровневый fetch-обёртка с credentials и JSON-парсингом. */
async function api(path, opts = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(opts.headers || {}),
  };
  let res;
  try {
    res = await fetch(path, { ...opts, headers, credentials: 'same-origin' });
  } catch (e) {
    return { ok: false, error: 'Не удалось связаться с сервером.' };
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (!res.ok) {
    return { ok: false, error: (data && (data.error || data.message)) || `HTTP ${res.status}`, status: res.status, data };
  }
  return { ok: true, data, status: res.status };
}

// ============ ОСНОВНЫЕ ОПЕРАЦИИ ============

/** Загружает текущего пользователя с сервера (по httpOnly-cookie). */
export async function fetchMe() {
  const r = await api('/api/auth/me');
  if (r.ok && r.data && r.data.user) {
    currentUser = r.data.user;
    return currentUser;
  }
  currentUser = null;
  return null;
}

/** Регистрация. Возвращает {ok, user, verificationCode?} или {ok:false, error}. */
export async function register(email, password) {
  const r = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  currentUser = r.data.user;
  eventBus.emit('auth:change', { user: currentUser });
  return { ok: true, user: currentUser, verificationCode: r.data.verificationCode };
}

/** Вход. Возвращает {ok, user} или {ok:false, error, needVerification?}. */
export async function login(email, password) {
  const r = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) return { ok: false, error: r.error, needVerification: r.data?.needVerification };
  currentUser = r.data.user;
  eventBus.emit('auth:change', { user: currentUser });
  return { ok: true, user: currentUser };
}

/** Выход. */
export async function logout() {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* noop */ }
  currentUser = null;
  eventBus.emit('auth:change', { user: null });
  return { ok: true };
}

// ============ ПОДТВЕРЖДЕНИЕ EMAIL ============

/** Подтверждение email по 6-значному коду. */
export async function verifyEmail(code) {
  const r = await api('/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  currentUser = r.data.user;
  eventBus.emit('auth:change', { user: currentUser });
  return { ok: true, user: currentUser };
}

/** Повторная отправка кода подтверждения. */
export async function resendCode() {
  const r = await api('/api/auth/resend-code', { method: 'POST' });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, code: r.data.verificationCode };
}

// ============ ВОССТАНОВЛЕНИЕ ПАРОЛЯ ============

/** Запрос кода восстановления пароля по email. */
export async function requestReset(email) {
  const r = await api('/api/auth/request-reset', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, code: r.data.resetCode };
}

/** Сброс пароля по коду. */
export async function resetPassword(email, code, newPassword) {
  const r = await api('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email, code, newPassword }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

// ============ ПРЕМИУМ-ПОДПИСКА ============

/**
 * Создание заказа на тариф.
 * Демо-режим: активирует сразу (возвращает {ok, user, demo:true}).
 * Боевой режим: возвращает {ok, paymentUrl, paymentId, demo:false}.
 */
export async function setPlan(plan) {
  const r = await api('/api/premium/set-plan', {
    method: 'POST',
    body: JSON.stringify({ plan }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  const data = r.data;
  if (data.demo) {
    currentUser = data.user;
    eventBus.emit('auth:change', { user: currentUser });
    return { ok: true, user: currentUser, demo: true };
  }
  return { ok: true, paymentUrl: data.paymentUrl, paymentId: data.paymentId, demo: false };
}

/** Проверка 16-значного кода оплаты и активация тарифа. */
export async function verifyPayment(uniqueCode, paymentId) {
  const r = await api('/api/premium/verify-payment', {
    method: 'POST',
    body: JSON.stringify({ uniqueCode, paymentId }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  currentUser = r.data.user;
  eventBus.emit('auth:change', { user: currentUser });
  return { ok: true, user: currentUser };
}

/** Проверка статуса платежа. */
export async function checkPaymentStatus(paymentId) {
  const r = await api(`/api/premium/payment-status?paymentId=${encodeURIComponent(paymentId)}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, status: r.data.status };
}

// ============ ПРОЕКТЫ ============

/** Список проектов пользователя. */
export async function listProjects() {
  const r = await api('/api/projects');
  if (!r.ok) return { ok: false, error: r.error, projects: [] };
  return { ok: true, projects: r.data.projects || [] };
}

/** Создать проект. data — объект (будет сериализован в JSON на сервер). */
export async function createProject(name, data) {
  const r = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, data: JSON.stringify(data) }),
  });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, project: r.data.project };
}

/** Загрузить проект (с данными). */
export async function getProject(id) {
  const r = await api(`/api/projects/${id}`);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, project: r.data.project };
}

/** Удалить проект. */
export async function deleteProject(id) {
  const r = await api(`/api/projects/${id}`, { method: 'DELETE' });
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true };
}

// ============ ХЕЛПЕРЫ ============

/** Текущий пользователь (без обращения к серверу). */
export function getUser() {
  return currentUser;
}

/** Залогинен ли пользователь. */
export function isLoggedIn() {
  return currentUser !== null;
}

/**
 * Инициализация: подтягивает пользователя с сервера один раз.
 */
export async function initAuth() {
  if (initialized) return currentUser;
  initialized = true;
  await fetchMe();
  eventBus.emit('auth:change', { user: currentUser });
  return currentUser;
}
