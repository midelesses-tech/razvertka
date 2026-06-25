/**
 * landing.js — точка входа посадочной страницы.
 * - управление темой (с сохранением);
 * - плавный скролл к якорям;
 * - reveal-анимации через IntersectionObserver;
 * - лёгкое параллакс-смещение блобов под курсором (десктоп).
 */

const THEME_KEY = 'rzv:theme';

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = saved === 'light' || saved === 'dark' ? saved : (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);

  const toggle = document.getElementById('theme-toggle');
  toggle?.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
  });
}

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || id === '#') return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function initReveal() {
  const els = Array.from(document.querySelectorAll('.reveal'));
  if (!('IntersectionObserver' in window) || !els.length) {
    els.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          // лёгкая каскадная задержка по индексу внутри родителя
          const el = entry.target;
          const siblings = Array.from(el.parentElement?.children ?? [el]);
          const idx = siblings.indexOf(el);
          el.style.transitionDelay = `${Math.min(idx * 70, 280)}ms`;
          el.classList.add('is-visible');
          io.unobserve(el);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  els.forEach((el) => io.observe(el));
}

function initBlobParallax() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (window.matchMedia('(hover: none)').matches) return; // тач-устройства
  const blobs = Array.from(document.querySelectorAll('.blob'));
  if (!blobs.length) return;
  let raf = 0;
  let tx = 0, ty = 0, cx = 0, cy = 0;
  window.addEventListener('mousemove', (e) => {
    const w = window.innerWidth, h = window.innerHeight;
    tx = (e.clientX / w - 0.5) * 2;
    ty = (e.clientY / h - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(tick);
  });
  function tick() {
    cx += (tx - cx) * 0.06;
    cy += (ty - cy) * 0.06;
    blobs.forEach((b, i) => {
      const depth = (i + 1) * 14;
      b.style.translate = `${cx * depth}px ${cy * depth}px`;
    });
    if (Math.abs(tx - cx) > 0.001 || Math.abs(ty - cy) > 0.001) {
      raf = requestAnimationFrame(tick);
    } else {
      raf = 0;
    }
  }
}

function init() {
  initTheme();
  initSmoothScroll();
  initReveal();
  initBlobParallax();
  console.info('[Развёртка&Раскрой] посадочная страница готова');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
