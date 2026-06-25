# Worklog — Онлайн Раскрой и Развёртка металлопроката

Архитектура: чистый JavaScript (ES6-модули, без фреймворков) размещён в
`public/app/` и загружается через `<iframe src="/app/index.html">` в
`src/app/page.tsx`. Таким образом требования Next.js (роут `/`) и
требование пользователя (чистый JS, многофайловой проект) согласованы.

---
Task ID: 1
Agent: main (Senior Frontend)
Task: Шаг 1 — базовый HTML/CSS layout, app.js, router.js (вкладки «Развёртка» / «Раскрой»), event-bus.js.

Work Log:
- Изучена структура Next.js-проекта; решено размещать статическое приложение в `public/app/`.
- Создан `public/app/index.html` с шапкой (логотип, заголовок, переключатель вкладок, переключатель темы), левой панелью ввода, центральной областью визуализации и «прилипающим» футером.
- Созданы CSS: `main.css` (инженерный минимализм, CSS-переменные, светлая/тёмная темы, акцент — янтарный), `layout.css` (CSS Grid: header / sidebar / main / footer, адаптив), `canvas.css` (стили canvas/svg, сетка, линии сгиба).
- Создан `js/utils/event-bus.js` — легковесная шина событий (`on/off/once/emit/clear`) + синглтон `eventBus`.
- Создан `js/router.js` — переключение вкладок `unfold` / `nesting` с публикацией событий `route:change`, синхронизация левой панели и центральной области, поддержка хеш-навигации.
- Создан `js/app.js` — главный контроллер: инициализация роутера, темы, статус-бара; подписки на события.
- Создан `js/main.js` — точка входа (ESM-модуль).
- Обновлён `src/app/page.tsx` — полноэкранный `<iframe>` на `/app/index.html`.

Stage Summary:
- Шаг 1 завершён: каркас приложения работает, вкладки переключаются, тема переключается и сохраняется, футер «прилипает» к низу.
- Готовы точки расширения (event bus, DOM-слоты `[data-view]`, `[data-panel]`) для последующих шагов.

---
Task ID: 1.5
Agent: main (Senior Frontend)
Task: Редизайн — посадочная страница с glassmorphism + перенос рабочего приложения в app.html.

Work Log:
- Перенёс рабочее приложение из index.html → app.html (без изменений в логике).
- Расширил main.css glass-переменными для обеих тем (--glass-bg, --glass-border, --blob-*, --landing-bg).
- Добавил glass-утилиты: .glass, .glass--strong, .blobs/.blob (3 анимированных цветных блоба), .grain (зернистость), .gradient-border (маска-обводка), .reveal (IntersectionObserver-анимация).
- Создал css/landing.css — стили посадочной: стеклянная шапка, hero с декоративной CAD-сеткой и мини-превью развёртки (inline SVG), сетка возможностей (bento), секция математики с формулами BA/BD/L, workflow-шаги, статистика, финальный CTA, подвал.
- Переписал index.html в посадочную страницу (тёмная тема по умолчанию) с описанием возможностей и кнопками «Открыть приложение» → app.html.
- Создал js/landing.js — тема с сохранением, плавный скролл к якорям, reveal-каскад, параллакс блобов под курсором (десктоп, с учётом prefers-reduced-motion).
- Верифицировал в браузере: обе темы, переход CTA→app.html (app-shell грузится), reveal-анимации (9/20 после скролла), мобильная адаптация (nav скрыт, карточки span 12), sticky-footer в app.html (gapBelowFooter:0), ошибок в консоли и dev.log нет.

Stage Summary:
- Разделение: index.html — посадочная (glassmorphism, тёмная по умолчанию), app.html — рабочее приложение из Шага 1.
- Дизайн: инженерный glassmorphism — полупрозрачные панели поверх тёмного градиента с цветными блобами (янтарный/красный/зелёный), моноширинные цифры, янтарный акцент (без blue/indigo), зернистость против «пластика».
- Точки расширения сохранены: app.html и его модули (router/event-bus/app) не изменены — Шаги 2–6 продолжаются в app.html.

---
Task ID: 2
Agent: main (Senior Frontend)
Task: Шаг 2 — утилиты (math-utils.js, validators.js), feature-flags.js, storage.js, profile-calculator.js (BA/BD/K-фактор), панель разработчика и UI-гейтинг freemium.

Work Log:
- Создан js/utils/math-utils.js: константы, скаляры (clamp/lerp/deg↔rad), 2D-векторы (vec/sub/dot/cross/rotate/perp), сегменты и пересечения, дуги/окружности, формулы гибки (bendAllowance/bendDeduction/unfoldLength/neutralOffset), прямоугольники (rect/maxrectsFreeRects), форматирование чисел.
- Создан js/utils/validators.js: Result-тип ({ok,value}|{ok,error}), валидаторы для толщины/радиуса/угла/K-фактора/длин/kerf/margin, validateUnfoldParams/validateNestingParams, markInvalid/clearInvalid для подсветки полей.
- Создан js/modules/feature-flags.js: карта FEATURES (tier free/paid + limit), isPremium/setPremium (localStorage), canUse/checkLimit/whyLocked, событие 'flags:change'. Модель: FREE — стандартные профили, 1 лист/10 деталей, SVG+DXF(демо ≤20), 3 проекта; PAID — конструктор сечений, библиотека материалов, несколько листов, grain-lock, PDF, безлимит, CSV.
- Создан js/modules/storage.js: проекты (list/save/delete/canSaveProject с учётом лимита), настройки UI, произвольные ключи.
- Создан js/modules/profile-calculator.js: типы сегментов (FLAT/BEND), buildStandardProfile (L/U/G/C), calculateUnfold (Σflat+Σba), calculateSingleBend (L=A+B−BD), buildSectionPolyline (2D-контур с дугами), buildUnfoldLayout (полосы + линии сгиба).
- Создан js/modules/dev-panel.js: открытие по Ctrl+Shift+D или 5 кликам по логотипу, тумблер премиума, очистка проектов, applyGating() — замочки на [data-feature], модалка «Премиум».
- Расширены CSS (main.css): .is-locked-wrap/.lock-badge/.limit-hint/.is-invalid, .dev-panel (glassmorphism), .toggle, .modal-overlay/.modal (glassmorphism).
- В app.html добавлена разметка dev-panel и premium-modal.
- Переписан js/app.js: импорт калькулятора/dev-panel/feature-flags, реальный расчёт развёртки с выводом BA/BD/L в readout, синхронизация материала→K-фактор, подсветка невалидных полей, пометка data-feature на кнопках экспорта (PDF=paid, DXF=free с лимитом).
- Верификация в браузере (app.html напрямую): расчёт L-профиля даёт BA=5.749, BD=4.251, L=85.75 (совпадает с ручным расчётом); смена материала steel→aluminum обновляет K 0.33→0.40 и перерасчёт BA=5.969; валидация thickness=0 → is-invalid + тост «Не удалось рассчитать»; dev-панель открывается Ctrl+Shift+D, тумблер премиума блокирует/разблокирует PDF (замочек + модалка); кнопка «Попробовать (Dev)» включает премиум; мобильная адаптация сохранена; lint чист, dev.log без ошибок.

Stage Summary:
- Математика развёртки полностью работает по формулам листовой гибки с K-фактором.
- Freemium-гейтинг заложен архитектурно: feature-flags — единый источник правды, UI-гейтинг автоматический, переключение free/paid — одной строкой в setPremium.
- Панель разработчика позволяет тестировать обе стороны: FREE (замочки, лимиты, модалка) и PREMIUM (полный доступ).
- Точки расширения для Шага 3: событие UNFOLD_CALCULATED несёт segments+totalLength — рендереры будут слушать его.
