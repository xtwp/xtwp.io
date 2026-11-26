'use strict';
/**
 * server.js — точка входа.
 * Express (health-check + раздача клиента для локальной разработки) и Socket.io.
 * Сервер авторитетный: клиент шлёт только желаемый угол и флаг ускорения,
 * всё остальное (движение, еда, коллизии) считается здесь.
 */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game, CONFIG } = require('./gameLogic');

const PORT = process.env.PORT || 3000;
// Для продакшена можно ограничить origin: CLIENT_ORIGIN=https://username.github.io
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CLIENT_ORIGIN } });

// Клиент отдаётся с этого же сервера. Ищем папку с index.html в нескольких местах,
// чтобы всё работало при любом Root Directory на Render и при «плоской» загрузке файлов.
const fs = require('fs');
const candidates = [
  path.join(__dirname, '..', 'client'),
  path.join(__dirname, 'client'),
  path.join(process.cwd(), 'client'),
  __dirname,
];
const clientDir = candidates.find((d) => fs.existsSync(path.join(d, 'index.html')));
if (clientDir) {
  console.log('Serving client from', clientDir);
  app.use(express.static(clientDir));
} else {
  console.log('Client folder NOT found. Looked in:', candidates);
  app.get('/', (req, res) => {
    res.status(500).type('text').send(
      'Сервер работает, но не найден client/index.html.\n' +
      'Проверьте, что в репозитории есть папка client с файлами index.html, game.js и т.д.\n\n' +
      'Искал здесь:\n' + candidates.join('\n')
    );
  });
}

// Health-check (Render + внешние пингеры вроде UptimeRobot)
app.get('/health', (req, res) => {
  res.json({ ok: true, snakes: game.snakes.size, players: game.playerCount() });
});

const game = new Game();

// Когда змея умирает — сообщаем владельцу (боты игнорируются)
game.onDeath = (snake, killer) => {
  if (snake.isBot) return;
  const sock = io.sockets.sockets.get(snake.id);
  if (sock) {
    sock.emit('dead', {
      score: Math.floor(snake.mass),
      kills: snake.kills,
      killedBy: killer ? killer.name : null, // null = стена
    });
  }
};

/** Очистка имени игрока от мусора */
function sanitizeName(name) {
  const clean = String(name || '').replace(/[<>&"'`\\]/g, '').trim().slice(0, 16);
  return clean || 'Player';
}

io.on('connection', (socket) => {
  socket.emit('hello', { world: CONFIG.WORLD_SIZE, players: game.playerCount() });

  // Игрок нажал «Играть»
  socket.on('join', (data) => {
    const snake = game.addPlayer(socket.id, sanitizeName(data && data.name));
    socket.emit('joined', { id: snake.id, world: CONFIG.WORLD_SIZE });
  });

  // Ввод: a — угол (рад), b — ускорение, r — радиус обзора в мировых единицах
  socket.on('input', (d) => {
    const snake = game.snakes.get(socket.id);
    if (!snake || !d) return;
    if (typeof d.a === 'number' && Number.isFinite(d.a)) snake.targetAngle = d.a;
    snake.boost = !!d.b;
    const r = Number(d.r);
    if (Number.isFinite(r)) snake.viewR = Math.min(3000, Math.max(500, r));
  });

  socket.on('disconnect', () => game.removePlayer(socket.id));
});

/** Рассылка состояния мира каждому живому игроку (только то, что в зоне его видимости) */
function broadcast() {
  for (const snake of game.snakes.values()) {
    if (snake.isBot) continue;
    const sock = io.sockets.sockets.get(snake.id);
    if (sock) sock.volatile.emit('gameState', game.stateFor(snake));
  }
}

// Игровой цикл: симуляция 30 Гц, рассылка каждый 2-й тик (15 Гц)
let last = Date.now();
let tickCount = 0;
setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  game.tick(dt);
  if (++tickCount % 2 === 0) broadcast();
}, 1000 / CONFIG.TICK_RATE);

server.listen(PORT, () => {
  console.log(`Slither clone server listening on port ${PORT}`);
});
