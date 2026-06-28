/**
 * Главная страница — server-rendered лендинг для SEO.
 * Поисковики видят полный HTML-контент (h1/h2/section, JSON-LD).
 * Кнопка «Начать» ведёт на /app/app.html — рабочее приложение.
 */

export const dynamic = 'force-static';

export default function Home() {
  return (
    <>
      {/* SEO-контент для поисковых систем + пользователи видят лендинг */}
      <style>{`
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:system-ui,-apple-system,sans-serif;background:#0f0d0b;color:#f4f1ec;overflow-x:hidden}
        a{text-decoration:none;color:inherit}
        .landing{min-height:100vh;position:relative}
        .landing-bg{position:fixed;inset:0;background:radial-gradient(ellipse at 20% 0%,rgba(217,119,6,.15),transparent 50%),radial-gradient(ellipse at 80% 100%,rgba(220,38,38,.1),transparent 50%),linear-gradient(180deg,#0f0d0b,#1a1714);z-index:-1}
        .container{max-width:1200px;margin:0 auto;padding:0 24px}
        /* Header */
        .header{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;padding:16px 24px;margin:12px;border-radius:16px;background:rgba(255,255,255,.05);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.08)}
        .brand{display:flex;align-items:center;gap:12px}
        .brand-mark{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#d97706,#f97316);display:flex;align-items:center;justify-content:center;flex-shrink:0}
        .brand-mark svg{color:#fff}
        .brand-text{display:flex;flex-direction:column;line-height:1.2}
        .brand-title{font-size:16px;font-weight:800}
        .brand-subtitle{font-size:11px;color:#a8a29e}
        .nav{display:flex;gap:4px}
        .nav a{padding:8px 14px;border-radius:10px;color:#a8a29e;font-size:13px;font-weight:600;transition:all .15s}
        .nav a:hover{color:#f4f1ec;background:rgba(255,255,255,.05)}
        .btn{display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;font-weight:700;font-size:14px;transition:all .15s;cursor:pointer;border:none}
        .btn-primary{background:linear-gradient(135deg,#d97706,#f97316);color:#fff}
        .btn-primary:hover{transform:translateY(-1px);box-shadow:0 8px 24px rgba(217,119,6,.3)}
        .btn-ghost{background:transparent;color:#a8a29e;border:1px solid rgba(255,255,255,.1)}
        .btn-ghost:hover{color:#f4f1ec;border-color:#d97706}
        .header-actions{display:flex;align-items:center;gap:8px}
        @media(max-width:768px){.nav{display:none}}
        /* Hero */
        .hero{padding:80px 24px 60px;text-align:center;max-width:900px;margin:0 auto}
        .hero h1{font-size:clamp(32px,5vw,56px);font-weight:900;line-height:1.1;margin-bottom:24px}
        .hero h1 .accent{background:linear-gradient(135deg,#d97706,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .hero p{font-size:16px;line-height:1.7;color:#a8a29e;margin-bottom:32px}
        .hero-cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
        /* Features */
        .section{padding:60px 24px}
        .section-head{text-align:center;margin-bottom:40px}
        .section-kicker{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#d97706;margin-bottom:8px}
        .section-title{font-size:clamp(24px,3vw,36px);font-weight:800}
        .section-lead{font-size:15px;color:#a8a29e;max-width:600px;margin:12px auto 0}
        .features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
        .feature{padding:24px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);backdrop-filter:blur(10px)}
        .feature h3{font-size:17px;font-weight:700;margin-bottom:8px;color:#f4f1ec}
        .feature p{font-size:14px;color:#a8a29e;line-height:1.6}
        .feature-icon{width:40px;height:40px;border-radius:10px;background:rgba(217,119,6,.15);color:#d97706;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
        /* Math */
        .math-card{max-width:800px;margin:0 auto;padding:32px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
        .math-card h3{font-size:18px;font-weight:700;margin-bottom:12px;color:#d97706}
        .formula{font-family:monospace;font-size:15px;background:rgba(0,0,0,.3);padding:12px 16px;border-radius:8px;margin:8px 0;color:#f4f1ec}
        /* Workflow */
        .steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;max-width:900px;margin:0 auto}
        .step{padding:20px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);text-align:center}
        .step-num{width:32px;height:32px;border-radius:50%;background:#d97706;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
        .step h4{font-size:15px;font-weight:700;margin-bottom:6px}
        .step p{font-size:13px;color:#a8a29e}
        /* FAQ */
        .faq{max-width:760px;margin:0 auto}
        .faq-item{padding:16px 20px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);margin-bottom:10px}
        .faq-item summary{font-size:15px;font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;align-items:center}
        .faq-item summary::-webkit-details-marker{display:none}
        .faq-item summary::after{content:'+';font-size:20px;color:#d97706;transition:transform .2s}
        .faq-item[open] summary::after{transform:rotate(45deg)}
        .faq-item p{margin-top:10px;font-size:14px;color:#a8a29e;line-height:1.6}
        /* CTA */
        .cta{padding:60px 24px;text-align:center}
        .cta-box{max-width:600px;margin:0 auto;padding:40px;border-radius:20px;background:linear-gradient(135deg,rgba(217,119,6,.15),rgba(220,38,38,.05));border:1px solid rgba(217,119,6,.2)}
        .cta-box h2{font-size:28px;font-weight:800;margin-bottom:12px}
        .cta-box p{color:#a8a29e;margin-bottom:24px}
        /* Footer */
        .footer{padding:24px;text-align:center;color:#78716c;font-size:13px;border-top:1px solid rgba(255,255,255,.05)}
        .footer a{color:#d97706}
        /* Hide iframe app */
        .app-frame{position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;display:none}
      `}</style>

      <div className="landing">
        <div className="landing-bg" />

        {/* Header */}
        <header className="header">
          <a href="/" className="brand">
            <span className="brand-mark">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M3 14h7v7H3z"/><path d="M14 14h7v7h-7z"/></svg>
            </span>
            <span className="brand-text">
              <span className="brand-title">Развёртка & Раскрой</span>
              <span className="brand-subtitle">листовой металл · онлайн</span>
            </span>
          </a>
          <nav className="nav">
            <a href="#features">Возможности</a>
            <a href="#math">Математика</a>
            <a href="#workflow">Как это работает</a>
            <a href="#faq">Вопросы</a>
          </nav>
          <div className="header-actions">
            <a className="btn btn-primary" href="/app/app.html">Начать →</a>
          </div>
        </header>

        {/* Hero */}
        <section className="hero">
          <h1>
            Развёртка и раскрой<br />
            металлопроката <span className="accent">в браузере</span>
          </h1>
          <p>
            Считайте плоские развёртки профилей по нейтральной оси с автоматическим K-фактором
            по таблице R/S. Оптимизируйте раскрой листа алгоритмом MaxRects. Считайте вес и
            длину металлопроката. Экспортируйте в DXF, SVG и PDF — для ЧПУ, Компаса и AutoCAD.
          </p>
          <div className="hero-cta">
            <a className="btn btn-primary" href="/app/app.html">Начать →</a>
            <a className="btn btn-ghost" href="#math">Как считается развёртка</a>
          </div>
        </section>

        {/* Features */}
        <section className="section" id="features">
          <div className="section-head">
            <div className="section-kicker">Возможности</div>
            <h2 className="section-title">Два режима — один инструмент</h2>
            <p className="section-lead">Расчёт развёртки, оптимизация раскроя и металлокалькулятор в одном приложении.</p>
          </div>
          <div className="features">
            <div className="feature">
              <div className="feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v6l9 4 9-4V7"/></svg>
              </div>
              <h3>Развёртка профилей</h3>
              <p>Уголок, швеллер, G-профиль, C-профиль и произвольный. Расчёт по нейтральной оси с автоматическим K-фактором по таблице R/S. Длины прямых участков и расстояния до центров гибов.</p>
            </div>
            <div className="feature">
              <div className="feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h11V3"/><path d="M14 21V9h7"/></svg>
              </div>
              <h3>Оптимизация раскроя (nesting)</h3>
              <p>Алгоритм MaxRects-BSSF для раскроя листа. Несколько листов, поворот деталей, отступы и kerf. Визуализация с размерами листа, легендой и переключением между листами.</p>
            </div>
            <div className="feature">
              <div className="feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h2M14 10h2M8 14h2M14 14h2M8 18h8"/></svg>
              </div>
              <h3>Металлокалькулятор</h3>
              <p>13 типов профиля: арматура, балка, квадрат, круг, лента, лист, отвод, труба круглая и профильная, уголок, фланец, швеллер, шестигранник. 7 материалов. Расчёт веса и длины.</p>
            </div>
            <div className="feature">
              <div className="feature-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              </div>
              <h3>Экспорт в CAD</h3>
              <p>Экспорт развёртки и раскроя в DXF (для ЧПУ, Компаса, AutoCAD), SVG (векторная графика) и PDF (печать). Метки гибов, координаты деталей, размерные линии.</p>
            </div>
          </div>
        </section>

        {/* Math */}
        <section className="section" id="math">
          <div className="section-head">
            <div className="section-kicker">Математика</div>
            <h2 className="section-title">Точный расчёт по нейтральной оси</h2>
            <p className="section-lead">Формулы листовой гибки с автоматическим K-фактором.</p>
          </div>
          <div className="math-card">
            <h3>Длина дуги (Bend Allowance)</h3>
            <div className="formula">BA = (π / 180) · A · (R + K · S)</div>
            <h3>Вычет на гиб (Bend Deduction)</h3>
            <div className="formula">BD = 2 · (R + S) · tan(A / 2) − BA</div>
            <h3>Полная длина развёртки</h3>
            <div className="formula">L = Σ(прямые участки) + n · BA</div>
            <p style={{ marginTop: 16, fontSize: 14, color: '#a8a29e' }}>
              где A — угол гиба, R — внутренний радиус, S — толщина, K — фактор положения
              нейтральной оси. K определяется автоматически по таблице R/S: при R/S &lt; 1.5 → K=0.408,
              при R/S ≥ 1.5 → K=0.470, при R/S ≥ 5 → K=0.5.
            </p>
          </div>
        </section>

        {/* Workflow */}
        <section className="section" id="workflow">
          <div className="section-head">
            <div className="section-kicker">Как это работает</div>
            <h2 className="section-title">Четыре шага до ЧПУ-файла</h2>
          </div>
          <div className="steps">
            <div className="step">
              <div className="step-num">1</div>
              <h4>Выберите профиль</h4>
              <p>Уголок, швеллер, G/C-профиль или произвольный. Введите размеры полок, толщину и радиус.</p>
            </div>
            <div className="step">
              <div className="step-num">2</div>
              <h4>Рассчитайте развёртку</h4>
              <p>Получите длину L, размеры прямых участков и расстояния до центров гибов.</p>
            </div>
            <div className="step">
              <div className="step-num">3</div>
              <h4>Оптимизируйте раскрой</h4>
              <p>Введите размеры листа и деталей. Получите оптимальную раскладку с минимизацией отходов.</p>
            </div>
            <div className="step">
              <div className="step-num">4</div>
              <h4>Экспортируйте</h4>
              <p>Скачайте DXF для ЧПУ, SVG для графики или PDF для печати.</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="section" id="faq">
          <div className="section-head">
            <div className="section-kicker">Вопросы и ответы</div>
            <h2 className="section-title">Частые вопросы</h2>
          </div>
          <div className="faq">
            <details className="faq-item">
              <summary>Как рассчитать развёртку уголка?</summary>
              <p>Выберите тип профиля «Уголок (L)», введите размеры полок A и B, толщину S и радиус R. Программа автоматически рассчитает длину развёртки по формуле L = (A − setback) + (B − setback) + BA, где BA = (π/180)·A·(R + K·S), а K-фактор определяется по таблице R/S.</p>
            </details>
            <details className="faq-item">
              <summary>Что такое K-фактор и зачем он нужен?</summary>
              <p>K-фактор — отношение положения нейтральной оси к толщине материала. Зависит от отношения R/S: при R/S &lt; 1.5 K = 0.408, при R/S ≥ 1.5 K = 0.470, при R/S ≥ 5 K = 0.5. Используется для расчёта длины дуги (BA) при гибке.</p>
            </details>
            <details className="faq-item">
              <summary>Можно ли экспортировать результат в DXF?</summary>
              <p>Да, поддерживается экспорт в DXF (для CAD/CAM-станков), SVG (для векторной графики) и PDF (для печати). DXF и SVG доступны бесплатно, PDF-экспорт — в премиум-подписке.</p>
            </details>
            <details className="faq-item">
              <summary>Какие типы профиля поддерживает металлокалькулятор?</summary>
              <p>Калькулятор рассчитывает вес 13 типов: арматура, балка/двутавр, квадрат, круг/пруток, лента, лист/плита, отвод, труба круглая, труба профильная, уголок, фланец плоский, швеллер, шестигранник. 7 материалов: чёрная сталь, нержавейка, алюминий, медь, латунь, бронза, титан.</p>
            </details>
            <details className="faq-item">
              <summary>Нужна ли регистрация?</summary>
              <p>Базовые функции (развёртка, раскрой, калькулятор) доступны без регистрации. Регистрация по email (только домены .ru) нужна для сохранения проектов в БД и премиум-подписки (PDF-экспорт, конструктор сечений, несколько листов раскроя).</p>
            </details>
          </div>
        </section>

        {/* CTA */}
        <section className="cta">
          <div className="cta-box">
            <h2>Готовы рассчитать первую развёртку?</h2>
            <p>Откройте инструмент и начните — всё считается прямо в браузере.</p>
            <a className="btn btn-primary" href="/app/app.html" style={{ fontSize: 16, padding: '14px 32px' }}>Начать →</a>
          </div>
        </section>

        {/* Footer */}
        <footer className="footer">
          <p>© 2025 · Развёртка & Раскрой — расчёт металлопроката онлайн · <a href="/app/app.html">Приложение</a> · <a href="/sitemap.xml">Sitemap</a></p>
        </footer>
      </div>

      {/* JSON-LD: WebApplication */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebApplication",
            name: "Развёртка и Раскрой металлопроката",
            url: "https://металлораскрой.рф/",
            description: "Онлайн-инструмент: расчёт развёртки профилей по нейтральной оси с K-фактором, оптимизация раскроя листа, металлокалькулятор веса. Экспорт в DXF, SVG, PDF.",
            applicationCategory: "EngineeringApplication",
            operatingSystem: "Web",
            inLanguage: "ru-RU",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "RUB",
            },
            featureList: [
              "Расчёт развёртки уголка, швеллера, G/C-профилей",
              "K-фактор по таблице R/S",
              "Оптимизация раскроя листа (MaxRects-BSSF)",
              "Металлокалькулятор веса 13 типов профиля",
              "Экспорт в DXF, SVG, PDF",
              "Конструктор произвольных сечений",
              "Сохранение проектов в БД",
            ],
          }),
        }}
      />

      {/* JSON-LD: FAQPage */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: [
              {
                "@type": "Question",
                name: "Как рассчитать развёртку уголка?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Выберите тип профиля «Уголок (L)», введите размеры полок A и B, толщину S и радиус R. Программа автоматически рассчитает длину развёртки по формуле L = (A − setback) + (B − setback) + BA, где BA = (π/180)·A·(R + K·S).",
                },
              },
              {
                "@type": "Question",
                name: "Что такое K-фактор?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "K-фактор — отношение положения нейтральной оси к толщине материала. При R/S < 1.5 K = 0.408, при R/S ≥ 1.5 K = 0.470, при R/S ≥ 5 K = 0.5.",
                },
              },
              {
                "@type": "Question",
                name: "Можно ли экспортировать в DXF?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Да, поддерживается DXF (для CAD/CAM), SVG и PDF. DXF и SVG бесплатно, PDF — в премиуме.",
                },
              },
              {
                "@type": "Question",
                name: "Какие типы профиля в калькуляторе?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "13 типов: арматура, балка, квадрат, круг, лента, лист, отвод, труба круглая, труба профильная, уголок, фланец, швеллер, шестигранник. 7 материалов.",
                },
              },
            ],
          }),
        }}
      />
    </>
  );
}
