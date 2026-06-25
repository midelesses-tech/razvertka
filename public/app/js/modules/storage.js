/**
 * storage.js
 * Работа с localStorage. Хранит проекты (развёртки и раскладки),
 * настройки UI (тема, последний маршрут) и состояние премиума.
 *
 * Учитывает feature-flags: бесплатные пользователи ограничены лимитом
 * проектов (FEATURES.projectsLimit.limit = 3).
 */

import { FEATURES, isPremium, checkLimit } from './feature-flags.js';

const NS = 'rzv:';
const PROJECTS_KEY = `${NS}projects`;
const SETTINGS_KEY = `${NS}settings`;

/** Префикс ключа для произвольных данных приложения. */
export const keys = {
  theme: `${NS}theme`,
  premium: `${NS}premium`,
  route: `${NS}route`,
  projects: PROJECTS_KEY,
  settings: SETTINGS_KEY,
};

// ───────────────────────── низкоуровневые ─────────────────────────

function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function remove(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

// ───────────────────────── проекты ─────────────────────────

/**
 * Список сохранённых проектов.
 * @returns {Array<{id:string,name:string,type:'unfold'|'nesting',data:Object,updatedAt:number}>}
 */
export function listProjects() {
  const arr = read(PROJECTS_KEY, []);
  return Array.isArray(arr) ? arr : [];
}

/**
 * Можно ли сохранить ещё один проект (учитывая лимит free).
 * @returns {{allowed:boolean, limit:number, used:number, premium:boolean}}
 */
export function canSaveProject() {
  const used = listProjects().length;
  const r = checkLimit('projectsLimit', used);
  // у платных нет лимита — фактически безлимит
  if (isPremium()) return { allowed: true, limit: Infinity, used, premium: true };
  return {
    allowed: r.allowed,
    limit: FEATURES.projectsLimit.limit,
    used,
    premium: false,
  };
}

/**
 * Сохранить (или обновить) проект. Возвращает сохранённый объект
 * или {error} при превышении лимита.
 * @param {{id?:string, name:string, type:'unfold'|'nesting', data:Object}} project
 */
export function saveProject(project) {
  const list = listProjects();
  const now = Date.now();

  // обновление существующего
  if (project.id) {
    const idx = list.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...project, updatedAt: now };
      write(PROJECTS_KEY, list);
      return list[idx];
    }
  }

  // новый проект — проверить лимит
  const cap = canSaveProject();
  if (!cap.allowed) {
    return { error: `Достигнут лимит проектов (${cap.limit}) для бесплатной версии` };
  }

  const rec = {
    id: project.id ?? genId(),
    name: project.name || `Проект ${list.length + 1}`,
    type: project.type,
    data: project.data,
    createdAt: now,
    updatedAt: now,
  };
  list.push(rec);
  write(PROJECTS_KEY, list);
  return rec;
}

/**
 * Удалить проект по id.
 */
export function deleteProject(id) {
  const list = listProjects().filter((p) => p.id !== id);
  write(PROJECTS_KEY, list);
  return list;
}

/**
 * Получить проект по id.
 */
export function getProject(id) {
  return listProjects().find((p) => p.id === id) ?? null;
}

/**
 * Очистить все проекты (для панели разработчика).
 */
export function clearProjects() {
  remove(PROJECTS_KEY);
}

// ───────────────────────── настройки UI ─────────────────────────

/**
 * Сохранить настройки UI (последний маршрут, опции тулбара и т.д.).
 * @param {Object} patch  объединяется с текущими настройками
 */
export function saveSettings(patch) {
  const cur = read(SETTINGS_KEY, {});
  const next = { ...cur, ...patch };
  write(SETTINGS_KEY, next);
  return next;
}

export function loadSettings() {
  return read(SETTINGS_KEY, {});
}

// ───────────────────────── общие ─────────────────────────

/** Сохранить произвольное значение по ключу (с JSON-сериализацией). */
export const setItem = (key, value) => write(NS + key, value);
/** Прочитать произвольное значение. */
export const getItem = (key, fallback = null) => read(NS + key, fallback);

/** Простой id-генератор (без зависимостей). */
function genId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
