#!/bin/bash
# Создаёт ZIP-архив всех ключевых файлов проекта
# Запуск: bash backup.sh
# Результат: /home/z/my-project/download/project-backup-YYYY-MM-DD-HHMM.zip

DATE=$(date +%Y-%m-%d-%H%M)
ZIP="/home/z/my-project/download/project-backup-$DATE.zip"

cd /home/z/my-project

# Создаём архив
zip -r "$ZIP" \
  prisma/schema.prisma \
  src/lib/ \
  src/app/api/ \
  src/app/layout.tsx \
  src/app/page.tsx \
  src/app/globals.css \
  public/app/ \
  public/robots.txt \
  public/sitemap.xml \
  public/logo.svg \
  package.json \
  .env \
  start-dev.sh \
  worklog.md \
  -x "node_modules/*" ".next/*" "db/*.db" 2>/dev/null

echo ""
echo "✅ Архив создан: $ZIP"
echo "📁 Размер: $(du -h "$ZIP" | cut -f1)"
echo ""
echo "Скачайте файл через панель файлов или:"
echo "  cp $ZIP /tmp/ && echo 'Скопировано в /tmp/'"
