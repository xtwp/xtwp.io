# Neon Snakes — клон Slither.io

Node.js + Express + Socket.io (сервер) и Vanilla JS + Canvas (клиент).
Один сервер раздаёт и игру, и мультиплеер, поэтому деплой — одна кнопка.

## Запуск локально
    npm install
    npm start
Откройте http://localhost:3000

## Деплой онлайн (Render, бесплатно)
1. Залейте папку проекта в новый репозиторий на GitHub.
2. render.com → New + → Blueprint → выберите репозиторий → Apply
   (или New + → Web Service: Build `npm install`, Start `npm start`, Root Directory пустой).
3. Через пару минут откройте выданную ссылку `https://....onrender.com` — игра работает, ничего вписывать не нужно.

Бесплатный Render засыпает без посетителей — первый заход может грузиться до минуты.
Опционально: пингуйте `/health` через UptimeRobot каждые 10 минут.

Клиент отдельно на GitHub Pages (необязательно): впишите адрес Render в `SERVER_URL` в `client/network.js`.
