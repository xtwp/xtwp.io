'use strict';
/**
 * bots.js — ИИ ботов.
 * Бот «думает» 5–12 раз в секунду и выставляет своей змее желаемый угол (targetAngle)
 * и флаг ускорения — ровно так же, как это делает игрок через сокет.
 * Приоритеты: стены > опасность (чужие тела) > еда > случайное блуждание.
 */

const BOT_NAMES = [
  'Neo', 'Trinity', 'Cipher', 'Vortex', 'Pixel', 'Glitch', 'Nova', 'Zero',
  'Echo', 'Flux', 'Byte', 'Quark', 'Volt', 'Ion', 'Rogue', 'Apex',
  'Nyx', 'Kilo', 'Orbit', 'Raze', 'Helix', 'Onyx', 'Blitz', 'Cobra',
];

class Bot {
  constructor(snake) {
    this.snake = snake;
    this.thinkTimer = Math.random() * 0.2;
    this.wander = snake.angle;                 // текущее направление блуждания
    this.vision = 350 + Math.random() * 250;   // радиус поиска еды (у ботов разный «ум»)
  }

  /** Вызывается каждый тик сервера; решения принимаются не каждый тик */
  update(game, dt) {
    this.thinkTimer -= dt;
    if (this.thinkTimer > 0) return;
    this.thinkTimer = 0.08 + Math.random() * 0.12;

    const s = this.snake;
    const h = s.head;
    const W = game.cfg.WORLD_SIZE;

    // 1) Стены: у границы разворачиваемся к центру карты
    const margin = 280;
    if (h.x < margin || h.y < margin || h.x > W - margin || h.y > W - margin) {
      s.targetAngle = Math.atan2(W / 2 - h.y, W / 2 - h.x);
      s.boost = false;
      this.wander = s.targetAngle;
      return;
    }

    // 2) Опасность: уворачиваемся от чужих тел перед носом
    const danger = this.scanDanger(game);
    if (danger) {
      s.targetAngle = danger.angle;
      s.boost = danger.urgent && s.mass > 30; // в панике — ускоряемся
      this.wander = s.targetAngle;
      return;
    }

    // 3) Еда: ищем ближайшую (с учётом «жирности») и плывём к ней
    const food = game.findBestFood(h.x, h.y, this.vision);
    if (food) {
      s.targetAngle = Math.atan2(food.y - h.y, food.x - h.x);
      s.boost = food.v >= 5 && s.mass > 50; // за крупной добычей — рывок
      this.wander = s.angle;
      return;
    }

    // 4) Блуждание
    this.wander += (Math.random() - 0.5) * 0.9;
    s.targetAngle = this.wander;
    s.boost = false;
  }

  /**
   * Сканирует сегменты других змей перед головой.
   * Возвращает { angle, urgent } — направление ухода от препятствий, или null.
   */
  scanDanger(game) {
    const s = this.snake;
    const h = s.head;
    const look = 140 + s.radius * 3;
    const fx = Math.cos(s.angle), fy = Math.sin(s.angle);
    let ax = 0, ay = 0, minD = Infinity;

    for (const o of game.snakes.values()) {
      if (o === s) continue;
      const segs = o.segments;
      const reach = look + o.radius;
      // Отсечка: вся змея слишком далеко
      const hx = segs[0].x - h.x, hy = segs[0].y - h.y;
      const far = segs.length * o.spacing + reach;
      if (hx * hx + hy * hy > far * far) continue;

      for (let i = 0; i < segs.length; i += 2) {
        const dx = segs[i].x - h.x, dy = segs[i].y - h.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach || d2 < 1) continue;
        const d = Math.sqrt(d2);
        if ((dx * fx + dy * fy) / d < -0.2) continue; // позади — не опасно
        const w = (reach - d) / reach;                // ближе = опаснее
        ax -= (dx / d) * w;
        ay -= (dy / d) * w;
        if (d < minD) minD = d;
      }
    }

    if (ax === 0 && ay === 0) return null;
    // Небольшая «вперёд»-составляющая, чтобы не разворачиваться на 180°
    return { angle: Math.atan2(ay + fy * 0.3, ax + fx * 0.3), urgent: minD < look * 0.5 };
  }
}

module.exports = { Bot, BOT_NAMES };
