'use strict';
/**
 * game.js — основной цикл клиента: ввод, интерполяция змей, камера с зумом, HUD.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const normAngle = (a) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));

  const canvas = $('game');
  Renderer.init(canvas);

  /* ---------- Состояние ---------- */
  const state = {
    mode: 'menu',            // menu | playing | dead
    myId: null,
    world: 3000,
    snakes: new Map(),       // id -> { segs:[{x,y}], target:[x,y,...], ... } (для интерполяции)
    food: [],
    lb: [],
    online: 0,
    mass: 10,
    kills: 0,
    cam: { x: 1500, y: 1500, zoom: 0.8 },
  };
  const input = { x: window.innerWidth / 2, y: window.innerHeight / 2, boost: false, angle: 0 };

  // UI-элементы
  const menu = $('menu'), death = $('death'), hud = $('hud'), lbBox = $('leaderboard');
  const playBtn = $('playBtn'), againBtn = $('againBtn'), nameInput = $('nameInput');
  const statusEl = $('status'), boostBtn = $('boostBtn');

  try { nameInput.value = localStorage.getItem('snakeName') || ''; } catch (e) { /* ignore */ }

  /* ---------- Камера ---------- */

  /** Целевой зум: чем больше масса, тем дальше камера. Формула общая с сервером (радиус обзора). */
  function targetZoom(mass) {
    const byMass = clamp(1.1 / (1 + Math.sqrt(mass) / 25), 0.3, 1.1);
    const byScreen = clamp(Math.min(Renderer.width, Renderer.height) / 800, 0.55, 1.3);
    return byMass * byScreen;
  }

  /** Радиус обзора в мире, нужный клиенту (сообщаем серверу, чтобы слал только видимое) */
  function viewRadius() {
    return Math.hypot(Renderer.width, Renderer.height) / 2 / state.cam.zoom;
  }

  /* ---------- Сеть ---------- */
  function setStatus(text, isError) {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', !!isError);
  }

  if (!Network.isConfigured()) {
    setStatus('Укажите адрес сервера в client/network.js (SERVER_URL).', true);
  } else {
    Network.connect({
      onConnect() { playBtn.disabled = false; setStatus('Подключено. Выберите имя и играйте!'); },
      onHello(d) { state.world = d.world; setStatus(`Подключено. Игроков онлайн: ${d.players}`); },
      onDisconnect() {
        playBtn.disabled = true;
        state.mode = 'menu';
        showOnly('menu');
        setStatus('Соединение потеряно. Переподключение…', true);
      },
      onError(msg) { playBtn.disabled = true; setStatus(msg, true); },
      onJoined(d) {
        state.myId = d.id;
        state.world = d.world;
        state.snakes.clear();
        state.mode = 'playing';
        showOnly('game');
      },
      onState: applyState,
      onDead(d) {
        state.mode = 'dead';
        input.boost = false;
        $('deathInfo').textContent =
          `Длина: ${d.score} · Убийств: ${d.kills} · ` +
          (d.killedBy ? `Вас съел ${d.killedBy}` : 'Вы врезались в стену');
        showOnly('death');
      },
    });
  }

  /** Принимаем снимок мира от сервера: обновляем цели интерполяции */
  function applyState(d) {
    state.food = d.food;
    state.lb = d.lb;
    state.online = d.online;
    state.mass = d.you.m;
    state.kills = d.you.k;

    const seen = new Set();
    for (const s of d.snakes) {
      seen.add(s.id);
      let v = state.snakes.get(s.id);
      if (!v) {
        v = { id: s.id, segs: [], angle: s.a };
        state.snakes.set(s.id, v);
      }
      v.name = s.n; v.hue = s.h; v.mass = s.m; v.boost = !!s.b;
      v.targetAngle = s.a; v.target = s.s;
    }
    for (const id of state.snakes.keys()) if (!seen.has(id)) state.snakes.delete(id);
  }

  /** Сглаживание: 15 обновлений/сек от сервера -> плавные 60 FPS */
  function interpolate(dt) {
    const k = 1 - Math.exp(-dt * 20);
    for (const v of state.snakes.values()) {
      const t = v.target;
      if (!t) continue;
      const n = t.length / 2;
      while (v.segs.length < n) { const i = v.segs.length; v.segs.push({ x: t[i * 2], y: t[i * 2 + 1] }); }
      while (v.segs.length > n) v.segs.pop();
      for (let i = 0; i < n; i++) {
        const sg = v.segs[i];
        sg.x += (t[i * 2] - sg.x) * k;
        sg.y += (t[i * 2 + 1] - sg.y) * k;
      }
      v.angle = normAngle(v.angle + normAngle(v.targetAngle - v.angle) * k);
    }
  }

  /* ---------- UI ---------- */
  function showOnly(which) {
    menu.classList.toggle('hidden', which !== 'menu');
    death.classList.toggle('hidden', which !== 'death');
    const playing = which === 'game';
    hud.classList.toggle('hidden', !playing);
    lbBox.classList.toggle('hidden', !playing);
    boostBtn.classList.toggle('hidden', !playing);
  }

  function play() {
    const name = nameInput.value.trim() || 'Player';
    try { localStorage.setItem('snakeName', name); } catch (e) { /* ignore */ }
    Network.join(name);
  }
  playBtn.addEventListener('click', play);
  againBtn.addEventListener('click', play);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !playBtn.disabled) play(); });

  let hudTimer = 0;
  function updateHud(dt) {
    hudTimer -= dt;
    if (hudTimer > 0) return;
    hudTimer = 0.25;
    $('scoreVal').textContent = state.mass;
    $('killsVal').textContent = state.kills;
    $('online').textContent = `Игроков онлайн: ${state.online}`;
    const list = $('lbList');
    list.textContent = '';
    for (const e of state.lb) {
      const li = document.createElement('li');
      if (e.id === state.myId) li.className = 'me';
      const a = document.createElement('span'); a.textContent = e.n;
      const b = document.createElement('span'); b.textContent = e.m;
      li.append(a, b);
      list.append(li);
    }
  }

  /* ---------- Управление ---------- */
  window.addEventListener('pointermove', (e) => { input.x = e.clientX; input.y = e.clientY; });
  canvas.addEventListener('pointerdown', (e) => {
    input.x = e.clientX; input.y = e.clientY;
    if (e.pointerType !== 'touch' && e.button === 0) input.boost = true; // ЛКМ = ускорение
  });
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch') input.boost = false; });
  window.addEventListener('blur', () => { input.boost = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && document.activeElement !== nameInput) { input.boost = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') input.boost = false; });
  // Экранная кнопка ускорения для телефонов
  boostBtn.addEventListener('pointerdown', (e) => { input.boost = true; e.stopPropagation(); });
  boostBtn.addEventListener('pointerup', () => { input.boost = false; });
  boostBtn.addEventListener('pointercancel', () => { input.boost = false; });

  /** Отправка ввода серверу ~30 раз/сек */
  let sendTimer = 0;
  function sendInput(dt) {
    sendTimer -= dt;
    if (sendTimer > 0 || state.mode !== 'playing') return;
    sendTimer = 1 / 30;
    const me = state.snakes.get(state.myId);
    if (!me || !me.segs[0]) return;
    const cam = state.cam;
    // Экранная позиция головы -> угол к курсору
    const hx = (me.segs[0].x - cam.x) * cam.zoom + Renderer.width / 2;
    const hy = (me.segs[0].y - cam.y) * cam.zoom + Renderer.height / 2;
    const dx = input.x - hx, dy = input.y - hy;
    if (dx * dx + dy * dy > 64) input.angle = Math.atan2(dy, dx);
    Network.sendInput({ a: input.angle, b: input.boost, r: viewRadius() });
  }

  /* ---------- Главный цикл ---------- */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const cam = state.cam;

    interpolate(dt);

    const me = state.snakes.get(state.myId);
    if (state.mode === 'menu' || !me || !me.segs[0]) {
      // В меню камера медленно дрейфует над картой
      const t = now / 1000;
      cam.x += (state.world / 2 + Math.cos(t * 0.1) * 700 - cam.x) * dt;
      cam.y += (state.world / 2 + Math.sin(t * 0.13) * 700 - cam.y) * dt;
      cam.zoom += (0.6 - cam.zoom) * dt;
    } else {
      // Камера следует за головой; при росте массы плавно отдаляется
      const kp = 1 - Math.exp(-dt * 12);
      cam.x += (me.segs[0].x - cam.x) * kp;
      cam.y += (me.segs[0].y - cam.y) * kp;
      cam.zoom += (targetZoom(me.mass) - cam.zoom) * (1 - Math.exp(-dt * 2));
    }

    sendInput(dt);
    if (state.mode === 'playing') updateHud(dt);

    Renderer.draw(state, now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
