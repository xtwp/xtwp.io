'use strict';
/**
 * gameLogic.js — вся авторитетная игровая логика:
 *  - класс Snake (движение, рост, ускорение)
 *  - класс Game (еда на пространственной сетке, коллизии, смерть, боты, сериализация состояния)
 */
const { Bot, BOT_NAMES } = require('./bots');

const CONFIG = {
  WORLD_SIZE: 3000,
  TICK_RATE: 30,
  BASE_SPEED: 170,       // px/сек
  BOOST_SPEED: 320,      // px/сек при ускорении
  TURN_RATE: 4.2,        // рад/сек (большие змеи поворачивают медленнее)
  START_MASS: 10,
  MIN_BOOST_MASS: 14,    // ниже этой массы ускориться нельзя
  BOOST_COST: 5,         // масса/сек при ускорении
  FOOD_TARGET: 650,      // сколько еды поддерживаем на карте
  FOOD_CELL: 150,        // размер ячейки пространственной сетки
  BOT_COUNT: Math.max(15, parseInt(process.env.BOT_COUNT, 10) || 15), // минимум 15 ботов
  DEATH_FOOD_RATIO: 0.8, // какая доля массы превращается в еду после смерти
  MAX_SEGMENTS: 260,
};

const GRID_N = Math.ceil(CONFIG.WORLD_SIZE / CONFIG.FOOD_CELL);
const FOOD_HUES = [0, 30, 60, 120, 160, 190, 220, 270, 300, 330];
const TAU = Math.PI * 2;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Нормализация угла в диапазон [-PI, PI) */
const normAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

/* ------------------------------------------------------------------ */
/*  Snake                                                              */
/* ------------------------------------------------------------------ */
class Snake {
  constructor(id, name, x, y, isBot) {
    this.id = id;
    this.name = name;
    this.isBot = isBot;
    this.hue = Math.floor(rand(0, 360));
    this.angle = rand(0, TAU);
    this.targetAngle = this.angle;
    this.boost = false;      // игрок/бот хочет ускориться
    this.boosting = false;   // реально ускоряется (хватает массы)
    this.dropAcc = 0;
    this.mass = CONFIG.START_MASS;
    this.kills = 0;
    this.alive = true;
    this.viewR = 900;        // радиус обзора, приходит от клиента
    this.segments = [];
    const n = this.targetSegments;
    for (let i = 0; i < n; i++) {
      this.segments.push({
        x: x - Math.cos(this.angle) * i * this.spacing,
        y: y - Math.sin(this.angle) * i * this.spacing,
      });
    }
  }

  get head() { return this.segments[0]; }
  get radius() { return 9 + Math.sqrt(this.mass) * 0.55; }
  get spacing() { return this.radius * 0.6; }
  get targetSegments() {
    return Math.min(CONFIG.MAX_SEGMENTS, Math.floor(10 + this.mass * 0.3));
  }

  /** Один шаг симуляции */
  update(dt, game) {
    // Плавный поворот к желаемому углу
    const diff = normAngle(this.targetAngle - this.angle);
    const maxTurn = (CONFIG.TURN_RATE / (1 + this.mass / 1500)) * dt;
    this.angle = normAngle(this.angle + clamp(diff, -maxTurn, maxTurn));

    // Ускорение тратит массу и роняет капли еды из хвоста
    this.boosting = this.boost && this.mass > CONFIG.MIN_BOOST_MASS;
    const speed = this.boosting ? CONFIG.BOOST_SPEED : CONFIG.BASE_SPEED;
    if (this.boosting) {
      const loss = CONFIG.BOOST_COST * dt;
      this.mass -= loss;
      this.dropAcc += loss;
      if (this.dropAcc >= 1.5) {
        this.dropAcc -= 1.5;
        const tail = this.segments[this.segments.length - 1];
        game.addFood(tail.x + rand(-6, 6), tail.y + rand(-6, 6), 1, this.hue);
      }
    }

    // Голова двигается вперёд
    const head = this.segments[0];
    head.x += Math.cos(this.angle) * speed * dt;
    head.y += Math.sin(this.angle) * speed * dt;

    // Каждый сегмент подтягивается к предыдущему (follow-the-leader)
    const sp = this.spacing;
    for (let i = 1; i < this.segments.length; i++) {
      const prev = this.segments[i - 1];
      const seg = this.segments[i];
      const dx = prev.x - seg.x;
      const dy = prev.y - seg.y;
      const d = Math.hypot(dx, dy);
      if (d > sp) {
        const k = (d - sp) / d;
        seg.x += dx * k;
        seg.y += dy * k;
      }
    }

    // Длина тела соответствует массе
    const target = this.targetSegments;
    while (this.segments.length < target) {
      const t = this.segments[this.segments.length - 1];
      this.segments.push({ x: t.x, y: t.y });
    }
    while (this.segments.length > target) this.segments.pop();
  }
}

/* ------------------------------------------------------------------ */
/*  Game                                                               */
/* ------------------------------------------------------------------ */
class Game {
  constructor() {
    this.cfg = CONFIG;
    this.snakes = new Map();   // id -> Snake (игроки и боты)
    this.bots = new Map();     // id -> Bot
    this.grid = Array.from({ length: GRID_N * GRID_N }, () => new Set()); // сетка еды
    this.foodCount = 0;
    this.botSeq = 0;
    this.onDeath = null;       // callback(snake, killer)
    this.leaderboard = [];
    this.online = 0;
    this.lbTimer = 0;

    for (let i = 0; i < CONFIG.FOOD_TARGET; i++) this.spawnRandomFood();
    this.refreshLeaderboard();
  }

  /* ---------- Игроки и боты ---------- */

  addPlayer(id, name) {
    const existing = this.snakes.get(id);
    if (existing) return existing; // двойной join игнорируем
    const pos = this.spawnPosition();
    const snake = new Snake(id, name, pos.x, pos.y, false);
    this.snakes.set(id, snake);
    return snake;
  }

  removePlayer(id) {
    const snake = this.snakes.get(id);
    if (!snake) return;
    this.killSnake(snake, null, true);
  }

  addBot() {
    const id = 'bot' + ++this.botSeq;
    const pos = this.spawnPosition();
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
    const snake = new Snake(id, name, pos.x, pos.y, true);
    // Боты стартуют чуть крупнее, чтобы не умирать мгновенно
    snake.mass = CONFIG.START_MASS + Math.random() * 25;
    this.snakes.set(id, snake);
    this.bots.set(id, new Bot(snake));
  }

  playerCount() {
    let n = 0;
    for (const s of this.snakes.values()) if (!s.isBot) n++;
    return n;
  }

  /** Случайная точка спавна подальше от стен и других змей */
  spawnPosition() {
    const m = 400;
    let best = null;
    for (let t = 0; t < 8; t++) {
      const p = { x: rand(m, CONFIG.WORLD_SIZE - m), y: rand(m, CONFIG.WORLD_SIZE - m) };
      let free = true;
      for (const s of this.snakes.values()) {
        if (Math.hypot(s.head.x - p.x, s.head.y - p.y) < 300) { free = false; break; }
      }
      best = p;
      if (free) break;
    }
    return best;
  }

  /* ---------- Еда (пространственная сетка) ---------- */

  addFood(x, y, v, hue) {
    x = clamp(x, 10, CONFIG.WORLD_SIZE - 10);
    y = clamp(y, 10, CONFIG.WORLD_SIZE - 10);
    const cx = clamp(Math.floor(x / CONFIG.FOOD_CELL), 0, GRID_N - 1);
    const cy = clamp(Math.floor(y / CONFIG.FOOD_CELL), 0, GRID_N - 1);
    const f = { x, y, v, hue, cell: cy * GRID_N + cx };
    this.grid[f.cell].add(f);
    this.foodCount++;
  }

  removeFood(f) {
    this.grid[f.cell].delete(f);
    this.foodCount--;
  }

  spawnRandomFood() {
    const v = Math.round((0.8 + Math.random() * 1.2) * 10) / 10;
    this.addFood(
      rand(20, CONFIG.WORLD_SIZE - 20),
      rand(20, CONFIG.WORLD_SIZE - 20),
      v,
      FOOD_HUES[Math.floor(Math.random() * FOOD_HUES.length)]
    );
  }

  /** Вызывает cb для каждой еды в круге радиуса r */
  queryFood(x, y, r, cb) {
    const C = CONFIG.FOOD_CELL;
    const x0 = clamp(Math.floor((x - r) / C), 0, GRID_N - 1);
    const x1 = clamp(Math.floor((x + r) / C), 0, GRID_N - 1);
    const y0 = clamp(Math.floor((y - r) / C), 0, GRID_N - 1);
    const y1 = clamp(Math.floor((y + r) / C), 0, GRID_N - 1);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (const f of this.grid[cy * GRID_N + cx]) {
          const dx = f.x - x, dy = f.y - y;
          if (dx * dx + dy * dy <= r2) cb(f);
        }
      }
    }
  }

  /** Лучшая еда рядом: ближе и «жирнее» — лучше. Используется ботами. */
  findBestFood(x, y, r) {
    let best = null, bestScore = Infinity;
    this.queryFood(x, y, r, (f) => {
      const dx = f.x - x, dy = f.y - y;
      const score = (dx * dx + dy * dy) / (0.5 + f.v);
      if (score < bestScore) { bestScore = score; best = f; }
    });
    return best;
  }

  /* ---------- Тик ---------- */

  tick(dt) {
    for (const bot of this.bots.values()) bot.update(this, dt);
    for (const s of this.snakes.values()) s.update(dt, this);
    this.eatFood();
    this.checkCollisions();
    this.maintain();

    this.lbTimer -= dt;
    if (this.lbTimer <= 0) { this.lbTimer = 0.5; this.refreshLeaderboard(); }
  }

  /** Сервер сам определяет, кто что съел, и увеличивает массу */
  eatFood() {
    for (const s of this.snakes.values()) {
      const h = s.head;
      this.queryFood(h.x, h.y, s.radius + 14, (f) => {
        s.mass += f.v;
        this.removeFood(f);
      });
    }
  }

  /** Стена или чужое тело = смерть. Голова в голову — гибнут обе. */
  checkCollisions() {
    const W = CONFIG.WORLD_SIZE;
    const dead = [];
    for (const a of this.snakes.values()) {
      const h = a.head;
      if (h.x < 0 || h.y < 0 || h.x > W || h.y > W) { dead.push([a, null]); continue; }

      const ra = a.radius * 0.8;
      let killer = null;
      for (const b of this.snakes.values()) {
        if (a === b) continue;
        const limit = ra + b.radius * 0.8;
        const segs = b.segments;
        // Быстрая отсечка: голова слишком далеко от всей змеи b
        const reach = segs.length * b.spacing + limit;
        const hx = segs[0].x - h.x, hy = segs[0].y - h.y;
        if (hx * hx + hy * hy > reach * reach) continue;

        const lim2 = limit * limit;
        for (let i = 0; i < segs.length; i++) {
          const dx = segs[i].x - h.x, dy = segs[i].y - h.y;
          if (dx * dx + dy * dy < lim2) { killer = b; break; }
        }
        if (killer) break;
      }
      if (killer) dead.push([a, killer]);
    }
    for (const [snake, killer] of dead) this.killSnake(snake, killer);
  }

  /** Смерть: змея распадается на еду */
  killSnake(snake, killer, silent) {
    if (!snake.alive) return;
    snake.alive = false;
    this.snakes.delete(snake.id);
    this.bots.delete(snake.id);
    if (killer) killer.kills++;

    const segs = snake.segments;
    const stride = Math.max(1, Math.ceil(segs.length / 60));
    const pieces = Math.ceil(segs.length / stride);
    const value = Math.max(0.5, (snake.mass * CONFIG.DEATH_FOOD_RATIO) / pieces);
    const r = snake.radius;
    for (let i = 0; i < segs.length; i += stride) {
      this.addFood(
        segs[i].x + rand(-r, r),
        segs[i].y + rand(-r, r),
        Math.round(value * 10) / 10,
        snake.hue
      );
    }
    if (!silent && this.onDeath) this.onDeath(snake, killer);
  }

  /** Поддерживаем количество еды и минимум 15 ботов */
  maintain() {
    for (let i = 0; i < 10 && this.foodCount < CONFIG.FOOD_TARGET; i++) this.spawnRandomFood();
    while (this.bots.size < CONFIG.BOT_COUNT) this.addBot();
  }

  /* ---------- Состояние для клиентов ---------- */

  refreshLeaderboard() {
    const all = [...this.snakes.values()].sort((a, b) => b.mass - a.mass);
    this.leaderboard = all.slice(0, 10).map((s) => ({ id: s.id, n: s.name, m: Math.floor(s.mass) }));
    this.online = this.playerCount();
  }

  /** Видна ли змея в квадрате вокруг (cx, cy) со стороной 2r */
  isVisible(s, cx, cy, r) {
    const segs = s.segments;
    for (let i = 0; i < segs.length; i += 3) {
      if (Math.abs(segs[i].x - cx) < r && Math.abs(segs[i].y - cy) < r) return true;
    }
    const t = segs[segs.length - 1];
    return Math.abs(t.x - cx) < r && Math.abs(t.y - cy) < r;
  }

  /** Компактное состояние мира для конкретного игрока (только его зона видимости) */
  stateFor(player) {
    const h = player.head;
    const r = player.viewR + 150;
    const snakes = [];
    for (const s of this.snakes.values()) {
      if (!this.isVisible(s, h.x, h.y, r)) continue;
      const flat = new Array(s.segments.length * 2);
      for (let i = 0; i < s.segments.length; i++) {
        flat[i * 2] = Math.round(s.segments[i].x);
        flat[i * 2 + 1] = Math.round(s.segments[i].y);
      }
      snakes.push({
        id: s.id, n: s.name, h: s.hue, m: Math.floor(s.mass),
        b: s.boosting ? 1 : 0, a: Math.round(s.angle * 100) / 100, s: flat,
      });
    }
    const food = [];
    this.queryFood(h.x, h.y, r, (f) => {
      food.push(Math.round(f.x), Math.round(f.y), f.v, f.hue);
    });
    return {
      you: { m: Math.floor(player.mass), k: player.kills },
      snakes, food, lb: this.leaderboard, online: this.online,
    };
  }
}

module.exports = { Game, Snake, CONFIG };
