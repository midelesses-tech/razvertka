# Деплой на Spaceweb (металлораскрой.рф)

## Способ 1: Node.js приложение (рекомендуется)

### Шаг 1. В панели Spaceweb
1. Зайдите в панель управления: https://cp.sweb.ru
2. Раздел **Сайты** → выберите **металлораскрой.рф**
3. **Тип сайта** → **Node.js**
4. Версия Node.js: **20+**
5. Точка входа: `server.js` (или `npm start`)

### Шаг 2. Загрузка файлов
Вариант A — через SSH:
```bash
ssh user@металлораскрой.рф
cd /var/www/металлораскрой.рф/
git clone https://github.com/midelesses-tech/razvertka.git .
bun install  # или npm install
cp .env.example .env  # отредактировать
bunx prisma db push
```

Вариант B — через FTP/файловый менеджер:
1. Скачать ZIP: `git clone https://github.com/midelesses-tech/razvertka.git && zip -r razvertka.zip razvertka/`
2. Загрузить ZIP через файловый менеджер Spaceweb
3. Распаковать

### Шаг 3. Сборка
```bash
bun run build
# или npm run build
```

### Шаг 4. .env файл
Создать `.env` на сервере:
```
DATABASE_URL=file:/var/www/металлораскрой.рф/db/custom.db
AUTH_SECRET=ваш_случайный_секрет_минимум_32_символа
DIGISELLER_SELLER_ID=ваш_id
DIGISELLER_API_TOKEN=ваш_токен
DIGISELLER_PRODUCT_MONTH=id_товара_месяц
DIGISELLER_PRODUCT_YEAR=id_товара_год
DIGISELLER_PRODUCT_LIFETIME=id_товара_навсегда
APP_URL=https://металлораскрой.рф
```

### Шаг 5. Запуск
```bash
bun run start
# или npm start
```

---

## Способ 2: Статический экспорт (проще, но без БД)

Если Spaceweb не поддерживает Node.js:
1. `bun run build` локально
2. Загрузить папку `.next/standalone/` + `public/` через FTP
3. Запустить через PM2: `pm2 start server.js`

---

## Что нужно от пользователя

1. **SSH-доступ** (хост, логин, пароль) — для деплоя
2. **Или панель Spaceweb** (логин, пароль) — для настройки через веб-интерфейс

## После деплоя настроить:
1. **SSL-сертификат** — в панели Spaceweb (Let's Encrypt, бесплатно)
2. **SMTP** — для отправки кодов на email (Spaceweb предоставляет)
3. **Digiseller** — создать 3 товара, получить ID + токен
4. **Yandex.Metrica** — создать счётчик, заменить XXXXXXXX в layout.tsx
