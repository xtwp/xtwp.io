'use strict';
/**
 * network.js — клиентская обёртка над Socket.io.
 *
 * По умолчанию SERVER_URL пустой: клиент подключается к тому же серверу, который
 * его раздал (так работает деплой «всё в одном» на Render — ничего вписывать не нужно).
 * Заполняйте SERVER_URL ТОЛЬКО если клиент лежит отдельно (например, на GitHub Pages):
 *   const SERVER_URL = 'https://my-game.onrender.com';  // без слэша в конце
 */
const SERVER_URL = '';

const Network = (function () {
  // file:// -> локальный сервер; иначе явный SERVER_URL; иначе тот же origin, что и у страницы
  const url = location.protocol === 'file:' ? 'http://localhost:3000'
    : (SERVER_URL || location.origin);

  let socket = null;

  /** На github.io своего сервера нет — там SERVER_URL обязателен */
  function isConfigured() {
    return !!SERVER_URL || !location.hostname.endsWith('github.io');
  }

  /**
   * Подключение. handlers: onConnect, onDisconnect, onError, onHello,
   * onJoined, onState, onDead
   */
  function connect(handlers) {
    if (typeof io === 'undefined') {
      handlers.onError('Не удалось загрузить Socket.io (проверьте интернет).');
      return;
    }
    socket = io(url, { transports: ['websocket', 'polling'] });

    socket.on('connect', () => handlers.onConnect());
    socket.on('disconnect', () => handlers.onDisconnect());
    socket.on('connect_error', () => handlers.onError('Сервер недоступен, пробуем снова…'));
    socket.on('hello', (d) => handlers.onHello && handlers.onHello(d));
    socket.on('joined', (d) => handlers.onJoined(d));
    socket.on('gameState', (d) => handlers.onState(d));
    socket.on('dead', (d) => handlers.onDead(d));
  }

  function join(name) { if (socket) socket.emit('join', { name }); }

  /** Ввод игрока: a — угол, b — ускорение, r — нужный радиус обзора */
  function sendInput(input) { if (socket) socket.volatile.emit('input', input); }

  return { connect, join, sendInput, isConfigured, url };
})();
