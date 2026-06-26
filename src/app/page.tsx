/**
 * Статическое приложение (чистый JS / ES6-модули) живёт в `public/app/`.
 * Эта страница — полноэкранный контейнер, который показывает его на роуте `/`.
 */

export default function Home() {
  return (
    <iframe
      src="/app/index.html"
      title="Онлайн Раскрой и Развёртка металлопроката"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        border: 'none',
        display: 'block',
      }}
      allow="clipboard-write"
    />
  )
}
