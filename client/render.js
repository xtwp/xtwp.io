'use strict';
/**
 * render.js — вся отрисовка на Canvas.
 * Ничего не знает о сети: получает готовое состояние (state) и рисует его.
 */
const Renderer = (function () {
  const TAU = Math.PI * 2;
  let canvas, ctx;
  let dpr = 1, width = 0, height = 0;
  const foodSprites = {}; // кэш спрайтов свечения еды по оттенку
  let quality = 1;        // масштаб разрешения: падает автоматически, если FPS низкий
  let perfFrames = 0, perfTime = 0, lastTime = 0;

  function init(c) {
    canvas = c;
    ctx = c.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }

  /** Радиус сегмента — должен совпадать с серверной формулой */
  function radiusOf(mass) { return 9 + Math.sqrt(mass) * 0.55; }

  /** Предрендеренный спрайт кружка еды */
  function foodSprite(hue) {
    const key = (Math.round(hue / 10) * 10) % 360;
    if (foodSprites[key]) return foodSprites[key];
    const size = 64;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${key},100%,60%)`;
    g.beginPath();
    g.arc(32, 32, 31, 0, Math.PI * 2);
    g.fill();
    foodSprites[key] = c;
    return c;
  }

  /** Автоснижение разрешения, если средний FPS ниже ~40 */
  function adaptQuality(time) {
    if (lastTime) { perfTime += time - lastTime; perfFrames++; }
    lastTime = time;
    if (perfFrames >= 60) {
      const fps = perfFrames / perfTime;
      if (fps < 40 && quality > 0.5) { quality = Math.max(0.5, quality - 0.15); resize(); }
      perfFrames = 0; perfTime = 0;
    }
  }

  /** Неоновая сетка Tron + граница мира */
  function drawGrid(cam, view, world) {
    const step = 80;
    // Внутренность мира чуть светлее фона
    ctx.fillStyle = '#050818';
    ctx.fillRect(0, 0, world, world);

    const x0 = Math.max(0, Math.floor(view.x0 / step) * step);
    const x1 = Math.min(world, Math.ceil(view.x1 / step) * step);
    const y0 = Math.max(0, Math.floor(view.y0 / step) * step);
    const y1 = Math.min(world, Math.ceil(view.y1 / step) * step);

    // Обычные линии
    ctx.lineWidth = 1 / cam.zoom;
    ctx.strokeStyle = 'rgba(25, 243, 255, 0.10)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) if (x % (step * 5)) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) if (y % (step * 5)) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();

    // Яркие линии каждые 5 клеток
    ctx.lineWidth = 2 / cam.zoom;
    ctx.strokeStyle = 'rgba(25, 243, 255, 0.24)';
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) if (!(x % (step * 5))) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) if (!(y % (step * 5))) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();

    // Граница мира
    ctx.strokeStyle = '#ff2bd6';
    ctx.lineWidth = 5 / Math.max(cam.zoom, 0.5);
    ctx.strokeRect(0, 0, world, world);
  }

  function drawFood(food, view, time) {
    for (let i = 0; i < food.length; i += 4) {
      const x = food[i], y = food[i + 1];
      if (x < view.x0 - 30 || x > view.x1 + 30 || y < view.y0 - 30 || y > view.y1 + 30) continue;
      const pulse = 1 + 0.12 * Math.sin(time * 3 + i);
      const core = (3.5 + Math.sqrt(food[i + 2]) * 1.6) * pulse;
      const d = core * 2;
      ctx.drawImage(foodSprite(food[i + 3]), x - d / 2, y - d / 2, d, d);
    }
  }

  /** Змея: все круги одного прохода — в одном path (одна заливка, одно свечение) */
  function drawSnake(s, zoom, view) {
    const n = s.segs.length;
    if (!n) return;
    const r = radiusOf(s.mass);
    const m = r + 6;
    const hue = s.hue;
    const vis = (p) => p.x > view.x0 - m && p.x < view.x1 + m && p.y > view.y0 - m && p.y < view.y1 + m;

    // Проход 1: основное тело
    ctx.fillStyle = `hsl(${hue},100%,42%)`;
    ctx.beginPath();
    for (let i = n - 1; i >= 0; i--) {
      const p = s.segs[i];
      if (!vis(p)) continue;
      ctx.moveTo(p.x + r, p.y);
      ctx.arc(p.x, p.y, r, 0, TAU);
    }
    ctx.fill();

    // Проход 2: яркая сердцевина
    ctx.fillStyle = `hsl(${hue},100%,58%)`;
    ctx.beginPath();
    for (let i = n - 1; i >= 0; i--) {
      const p = s.segs[i];
      if (!vis(p)) continue;
      ctx.moveTo(p.x + r * 0.72, p.y);
      ctx.arc(p.x, p.y, r * 0.72, 0, TAU);
    }
    ctx.fill();

    // Проход 3: светлые точки каждый третий сегмент (узор)
    ctx.fillStyle = `hsl(${hue},100%,84%)`;
    ctx.beginPath();
    for (let i = n - 1; i >= 1; i--) {
      if (i % 3) continue;
      const p = s.segs[i];
      if (!vis(p)) continue;
      ctx.moveTo(p.x + r * 0.35, p.y);
      ctx.arc(p.x, p.y, r * 0.35, 0, TAU);
    }
    ctx.fill();

    // Глаза
    const h = s.segs[0];
    const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
    for (const side of [-1, 1]) {
      const ex = h.x + ca * r * 0.45 - sa * r * 0.55 * side;
      const ey = h.y + sa * r * 0.45 + ca * r * 0.55 * side;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(ex, ey, r * 0.32, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(ex + ca * r * 0.1, ey + sa * r * 0.1, r * 0.16, 0, TAU); ctx.fill();
    }

    // Имя над головой (размер на экране не зависит от зума)
    const fs = Math.min(40, Math.max(12, 14 / zoom));
    ctx.font = `600 ${fs}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(230,252,255,0.9)';
    ctx.fillText(s.name, h.x, h.y - r - fs * 0.6);
  }

  /**
   * Главная функция отрисовки кадра.
   * state: { cam:{x,y,zoom}, world, snakes:Map, food:[], myId }
   */
  function draw(state, time) {
    adaptQuality(time);
    const cam = state.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Мировые координаты -> экран: камера в центре экрана, учитывается зум
    const z = cam.zoom * dpr;
    ctx.setTransform(z, 0, 0, z, dpr * width / 2 - cam.x * z, dpr * height / 2 - cam.y * z);

    const view = {
      x0: cam.x - width / 2 / cam.zoom, x1: cam.x + width / 2 / cam.zoom,
      y0: cam.y - height / 2 / cam.zoom, y1: cam.y + height / 2 / cam.zoom,
    };

    drawGrid(cam, view, state.world);
    drawFood(state.food, view, time);

    // Свою змею рисуем последней — поверх остальных
    let mine = null;
    for (const s of state.snakes.values()) {
      if (s.id === state.myId) { mine = s; continue; }
      drawSnake(s, cam.zoom, view);
    }
    if (mine) drawSnake(mine, cam.zoom, view);
  }

  return {
    init, draw, radiusOf,
    get width() { return width; },
    get height() { return height; },
  };
})();
