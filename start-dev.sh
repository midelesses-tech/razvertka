#!/bin/bash
# Запуск dev-сервера Next.js в фоне.
cd /home/z/my-project
pkill -9 -f next-server 2>/dev/null
sleep 1
nohup ./node_modules/.bin/next dev -p 3000 > dev.log 2>&1 &
echo "Dev server started on http://127.0.0.1:3000 (pid=$!)"
