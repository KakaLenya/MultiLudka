'use strict';

const $ = (id) => document.getElementById(id);

const TOKEN_KEY = 'casino.token';
const NAME_KEY = 'casino.name';
const BET_KEY = 'casino.crash.bet';
const AUTO_KEY = 'casino.crash.auto';
const CRASH_GROWTH = 0.07;       // как на сервере: m(t) = exp(0.07 * t)
const CRASH_MAX_AHEAD_MS = 300;  // насколько анимация может обгонять последний пакет

// localStorage может быть недоступен (приватный режим, запрет cookies).
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const state = {
  ws: null,
  me: null,           // { playerId, token, name } после welcome
  token: storage.get(TOKEN_KEY),
  bonus: null,        // { amount, eligible, readyAt (локальное время) }
  balance: 0,
  crash: null,        // последний crash_state
  crashRecvAt: 0,     // performance.now() в момент получения
  retryMs: 1000,
};

$('name').value = storage.get(NAME_KEY) || '';
$('bet-amount').value = storage.get(BET_KEY) || 50;
$('auto-cashout').value = storage.get(AUTO_KEY) || '';

function setConn(stateName, text) {
  $('conn').dataset.state = stateName;
  $('conn').textContent = text;
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function showLogin() {
  $('lobby').hidden = true;
  $('me').hidden = true;
  $('login').hidden = false;
}

let toastTimer = null;
function toast(text, ok = false) {
  $('toast').textContent = text;
  $('toast').classList.toggle('ok', ok);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 4000);
}

function connect() {
  // Адрес берём из текущей страницы: работает и локально, и через cloudflared.
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  const ws = new WebSocket(url);
  state.ws = ws;
  setConn('connecting', 'подключение…');

  ws.addEventListener('open', () => {
    state.retryMs = 1000;
    setConn('open', 'онлайн');
    $('login-btn').disabled = false;
    // Знакомый токен: входим молча. Иначе ждём имя.
    if (state.token) send({ type: 'hello', token: state.token });
    else showLogin();
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const handler = handlers[msg.type];
    if (handler) handler(msg);
  });

  ws.addEventListener('close', () => {
    $('login-btn').disabled = true;
    setConn('closed', 'нет связи, переподключаюсь…');
    setTimeout(connect, state.retryMs);
    state.retryMs = Math.min(state.retryMs * 2, 10000);
  });
}

function formatWait(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function renderBonus() {
  const b = state.bonus;
  if (!b || !b.eligible) {
    $('bonus').hidden = true;
    return;
  }
  $('bonus').hidden = false;
  const wait = b.readyAt - Date.now();
  if (wait > 0) {
    $('bonus-text').textContent = `Следующее пособие (${b.amount} фишек) через ${formatWait(wait)}.`;
    $('bonus-btn').hidden = true;
  } else {
    $('bonus-text').textContent = `Раз в сутки можно взять пособие: ${b.amount} фишек.`;
    $('bonus-btn').hidden = false;
    $('bonus-btn').textContent = `Забрать ${b.amount}`;
  }
}
setInterval(renderBonus, 30_000);

// Кружок с первой буквой; цвет постоянный для имени.
function avatarEl(name) {
  const a = document.createElement('span');
  a.className = 'avatar';
  a.textContent = [...name.trim()][0] || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  a.style.setProperty('--h', h);
  return a;
}

function listItem(name, isSelf) {
  const li = document.createElement('li');
  li.append(avatarEl(name));
  const span = document.createElement('span');
  span.className = 'name';
  span.textContent = name;
  li.append(span);
  if (isSelf) li.classList.add('self');
  return li;
}

// ---------- Подтверждение ставок ----------

// Спрашиваем, только если игрок сам ввёл сумму в поле (не кнопками ½, ×2, «макс», не фишками)
// и она больше половины баланса. В каждой игре — один раз до перезагрузки страницы.
const BET_INPUTS = ['bet-amount', 'u-amount', 'vt-amount', 'b-amount', 'pl-stake', 'buyin', 'raise-amount', 'dv-stake', 'pk-amount', 'mn-amount', 'fw-amount'];
const confirmedGames = new Set();
let betConfirm = null;   // { resolve } — окно открыто

// Запоминаем, что в поле набрал сам игрок: кнопки меняют значение без события input.
for (const id of BET_INPUTS) $(id).addEventListener('input', () => { $(id).dataset.typed = $(id).value; });
const typedByPlayer = (input) => !!input && input.value !== '' && input.dataset.typed === input.value;

// { key, game, amount, note, input, of } -> Promise<boolean>: true — ставим.
// of: от какой суммы считать половину (по умолчанию баланс).
function confirmBet({ key, game, amount, note = '', input = null, of = state.balance }) {
  if (!(amount > 0) || confirmedGames.has(key) || !typedByPlayer(input) || amount <= of / 2) return Promise.resolve(true);
  if (betConfirm) closeBetConfirm(false);
  $('bc-game').textContent = game;
  $('bc-amount').textContent = amount.toLocaleString('ru-RU');
  $('bc-note').textContent = note;
  $('bc-note').hidden = !note;
  const share = of > 0 ? Math.round((amount / of) * 100) : 100;
  $('bc-share').textContent = amount >= of ? 'Это всё, что у тебя есть!' : `Это ${share}% твоего баланса`;
  $('bc-share').classList.add('warn');
  $('bet-confirm').hidden = false;
  $('bc-ok').focus();
  return new Promise((resolve) => {
    betConfirm = { resolve, key };
  });
}

function closeBetConfirm(ok) {
  if (!betConfirm) return;
  const { resolve, key } = betConfirm;
  betConfirm = null;
  $('bet-confirm').hidden = true;
  if (ok) confirmedGames.add(key);
  resolve(ok);
}
$('bc-ok').addEventListener('click', () => closeBetConfirm(true));
$('bc-cancel').addEventListener('click', () => closeBetConfirm(false));
$('bet-confirm').addEventListener('click', (e) => {
  if (e.target === $('bet-confirm')) closeBetConfirm(false);
});
document.addEventListener('keydown', (e) => {
  if (!betConfirm) return;
  if (e.key === 'Escape') closeBetConfirm(false);
  if (e.key === 'Enter') {
    e.preventDefault();
    closeBetConfirm(true);
  }
});

// ---------- Краш ----------

function myCrashBet() {
  const c = state.crash;
  return c && state.me ? c.players.find((p) => p.id === state.me.playerId) || null : null;
}

// Множитель для показа: сервер шлёт ~10 раз в секунду, между пакетами досчитываем сами,
// но не дальше CRASH_MAX_AHEAD_MS вперёд (исход знает только сервер).
function liveMultiplier() {
  const c = state.crash;
  if (!c || c.phase !== 'running') return c ? c.multiplier : 1;
  const ahead = Math.min(performance.now() - state.crashRecvAt, CRASH_MAX_AHEAD_MS);
  const m = Math.exp((CRASH_GROWTH * (c.elapsed + ahead)) / 1000);
  return Math.max(c.multiplier, Math.floor(m * 100) / 100);
}

function phaseTimeLeft() {
  const c = state.crash;
  if (!c || c.timeLeft === null) return 0;
  return Math.max(0, c.timeLeft - (performance.now() - state.crashRecvAt));
}

// Что делает большая кнопка: 'bet', 'cashout' или null (недоступна).
function crashAction() {
  const c = state.crash;
  const mine = myCrashBet();
  if (!c) return { mode: null, label: '…' };
  if (c.phase === 'betting') {
    return mine
      ? { mode: null, label: `Ставка ${mine.amount} принята` }
      : { mode: 'bet', label: 'Поставить' };
  }
  if (c.phase === 'running' && mine && mine.cashout === null) {
    return { mode: 'cashout', label: `Забрать ${Math.floor(mine.amount * liveMultiplier())}` };
  }
  return { mode: null, label: 'Ждём следующий раунд' };
}

function renderCrashAction() {
  const btn = $('crash-action');
  const a = crashAction();
  btn.textContent = a.label;
  btn.disabled = a.mode === null;
  btn.dataset.mode = a.mode || '';
  btn.classList.toggle('cashout', a.mode === 'cashout');
}

function renderCrash() {
  const c = state.crash;
  if (!c) return;

  $('crash-history').replaceChildren(...c.history.map((m) => {
    const span = document.createElement('span');
    span.textContent = `${m.toFixed(2)}×`;
    if (m >= 10) span.className = 'great';
    else if (m >= 2) span.className = 'good';
    return span;
  }));

  const myId = state.me && state.me.playerId;
  $('crash-bets').replaceChildren(...c.players.map((p) => {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'self';
    const name = document.createElement('td');
    name.textContent = p.name;
    const amount = document.createElement('td');
    amount.textContent = p.amount;
    const result = document.createElement('td');
    if (p.cashout !== null) {
      result.textContent = `${p.cashout.toFixed(2)}× · +${p.payout - p.amount}`;
      result.className = 'won';
    } else if (c.phase === 'crashed') {
      result.textContent = `−${p.amount}`;
      result.className = 'lost';
    } else {
      result.textContent = '…';
    }
    tr.append(name, amount, result);
    return tr;
  }));

  const mine = myCrashBet();
  const my = $('crash-my');
  if (mine && mine.cashout !== null) {
    my.textContent = `Забрал ${mine.payout} на ${mine.cashout.toFixed(2)}× (+${mine.payout - mine.amount})`;
    my.className = 'my-result win';
  } else if (mine && c.phase === 'crashed') {
    my.textContent = `Сгорело ${mine.amount}`;
    my.className = 'my-result lose';
  } else {
    my.textContent = '';
    my.className = 'my-result';
  }

  renderCrashAction();
}

const canvas = $('crash-canvas');
const ctx = canvas.getContext('2d');

function drawCrash(m) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const c = state.crash;
  if (!c) return;

  if (c.phase === 'betting') {
    // Полоска обратного отсчёта приёма ставок: с отступом от краёв, чтобы скругление сцены её не резало.
    const total = 8000;
    const bx = 24;
    const bw = w - 2 * bx;
    const by = h - 22;
    const left = Math.max(0, Math.min(1, phaseTimeLeft() / total));
    const bar = (width, color) => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, width, 6, 3);
      else ctx.rect(bx, by, width, 6);
      ctx.fillStyle = color;
      ctx.fill();
    };
    bar(bw, 'rgba(255, 255, 255, 0.06)');
    if (left > 0) bar(Math.max(6, bw * left), 'rgba(242, 193, 78, 0.55)');
    return;
  }

  // Время полёта выводим из множителя: t = ln(m) / 0.07.
  const tNow = Math.log(m) / CRASH_GROWTH;
  const tMax = Math.max(10, tNow * 1.1);
  const mMax = Math.max(2, m * 1.15);
  const pad = 34;   // ракета и свечение линии не должны упираться в скруглённые края
  const x = (t) => pad + ((w - 2 * pad) * t) / tMax;
  const y = (mult) => h - pad - ((h - 2 * pad) * (mult - 1)) / (mMax - 1);

  const color = c.phase === 'crashed' ? '229, 97, 91' : '242, 193, 78';
  ctx.beginPath();
  ctx.moveTo(x(0), y(1));
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    const t = (tNow * i) / steps;
    ctx.lineTo(x(t), y(Math.exp(CRASH_GROWTH * t)));
  }
  ctx.save();
  ctx.shadowColor = `rgba(${color}, .8)`;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = `rgb(${color})`;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
  ctx.lineTo(x(tNow), y(1));
  ctx.lineTo(x(0), y(1));
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y(m), 0, y(1));
  fill.addColorStop(0, `rgba(${color}, .35)`);
  fill.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = fill;
  ctx.fill();

  // Ракета на кончике графика (по касательной), взрыв при краше.
  const tipX = x(tNow);
  const tipY = y(m);
  const dt = Math.max(0.05, tNow * 0.02);
  const angle = Math.atan2(y(m) - y(Math.exp(CRASH_GROWTH * Math.max(0, tNow - dt))), x(tNow) - x(Math.max(0, tNow - dt)));
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.font = '30px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (c.phase === 'crashed') {
    ctx.font = '42px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText('💥', 0, 0);
  } else {
    ctx.rotate(angle + Math.PI / 4);  // эмодзи ракеты смотрит вверх-вправо
    ctx.fillText('🚀', 0, 0);
  }
  ctx.restore();
}

function crashFrame() {
  const c = state.crash;
  if (c && !$('lobby').hidden) {
    const m = liveMultiplier();
    const mult = $('crash-mult');
    mult.textContent = `${m.toFixed(2)}×`;
    mult.dataset.phase = c.phase;
    const secs = Math.ceil(phaseTimeLeft() / 1000);
    $('crash-phase').textContent =
      c.phase === 'betting' ? `Приём ставок: ${secs} с`
        : c.phase === 'running' ? 'Летим!'
          : `Краш! Новый раунд через ${secs} с`;
    drawCrash(m);
    if (c.phase === 'running') renderCrashAction();
  }
  requestAnimationFrame(crashFrame);
}
requestAnimationFrame(crashFrame);

function readBetAmount() {
  const n = Math.floor(Number($('bet-amount').value));
  return Number.isFinite(n) ? n : 0;
}

$('crash-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const mode = $('crash-action').dataset.mode;
  if (mode === 'cashout') {
    send({ type: 'crash_cashout' });
    return;
  }
  if (mode !== 'bet') return;

  const amount = readBetAmount();
  const autoRaw = $('auto-cashout').value.trim();
  const autoCashout = autoRaw === '' ? undefined : Number(autoRaw);
  storage.set(BET_KEY, String(amount));
  storage.set(AUTO_KEY, autoRaw);
  confirmBet({
    key: 'crash', game: '📈 Краш', amount, input: $('bet-amount'),
    note: autoCashout ? `Автовывод на ${autoCashout}×` : 'Без автовывода: забрать нужно самому',
  })
    .then((ok) => ok && send({ type: 'crash_bet', amount, autoCashout }));
});

document.querySelectorAll('[data-quick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = readBetAmount();
    const next = {
      half: Math.floor(v / 2),
      double: v * 2,
      max: state.balance,
    }[btn.dataset.quick];
    $('bet-amount').value = Math.max(10, Math.min(next, Math.max(10, state.balance)));
  });
});

// Пробел в Краше: поставить/забрать, если фокус не в поле ввода. Только на вкладке Краша:
// на других вкладках у пробела свои дела (в плинко он бросает шарики).
document.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Space' || ev.repeat) return;
  if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) return;
  if ($('lobby').hidden || $('crash').hidden || $('crash-action').disabled) return;
  ev.preventDefault();
  $('crash-form').requestSubmit();
});

// ---------- Вкладки ----------

const TAB_KEY = 'casino.tab';

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  for (const id of ['crash', 'roulette', 'wheel', 'upgrade', 'plinko', 'mines', 'verity', 'duel', 'bomb', 'pool', 'poker']) $(id).hidden = name !== id;
  // канвас апгрейдера создаётся ниже по файлу: рисуем на следующем кадре
  if (name === 'upgrade') requestAnimationFrame(() => drawUpgrader());
  storage.set(TAB_KEY, name);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
showTab(['roulette', 'wheel', 'upgrade', 'plinko', 'mines', 'verity', 'duel', 'bomb', 'pool', 'poker'].includes(storage.get(TAB_KEY)) ? storage.get(TAB_KEY) : 'crash');

// ---------- Звуки (WebAudio, без файлов) ----------

const SOUND_KEY = 'casino.sound';
let soundOn = storage.get(SOUND_KEY) !== 'off';
let audio = null;

function renderSoundBtn() {
  $('sound').textContent = soundOn ? '🔊' : '🔇';
}
renderSoundBtn();
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  storage.set(SOUND_KEY, soundOn ? 'on' : 'off');
  renderSoundBtn();
});

// notes: [[частота Гц, длительность с], ...]
function beep(notes, type = 'sine') {
  if (!soundOn) return;
  try {
    audio = audio || new AudioContext();
    let t = audio.currentTime;
    for (const [freq, dur] of notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch { /* без звука */ }
}

const sounds = {
  win: () => beep([[523, 0.12], [659, 0.12], [784, 0.25]], 'triangle'),
  lose: () => beep([[220, 0.25], [165, 0.35]], 'sawtooth'),
  turn: () => beep([[880, 0.08], [1175, 0.12]]),
  dice: () => beep([[300, 0.04], [420, 0.04], [360, 0.05]], 'square'),
};

// ---------- Покер (Техасский холдем) ----------

const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

// Карта: лицом (ранг и масть), рубашкой или пустой слот на столе.
function cardEl(card, { small = false, back = false, deal = false, hl = false } = {}) {
  const el = document.createElement('span');
  el.className = 'pcard' + (small ? ' small' : '') + (deal ? ' deal' : '') + (hl ? ' hl' : '');
  if (back) {
    el.classList.add('back');
    return el;
  }
  if (!card) {
    el.classList.add('slot');
    return el;
  }
  if (card[1] === 'h' || card[1] === 'd') el.classList.add('red');
  const r = document.createElement('b');
  r.textContent = card[0] === 'T' ? '10' : card[0];
  const s = document.createElement('i');
  s.textContent = SUIT_SYM[card[1]];
  el.append(r, s);
  el.title = `${r.textContent}${s.textContent}`;
  return el;
}

const poker = {
  view: null,
  recvAt: 0,
  lastResultHand: 0,
  wasMyTurn: false,
  boardShown: 0,      // сколько карт стола уже нарисовано в этой раздаче (для анимации)
  boardHand: 0,
  holeKey: '',
};

function pokerTimeLeft() {
  const v = poker.view;
  if (!v || v.timeLeft === null) return 0;
  return Math.max(0, v.timeLeft - (performance.now() - poker.recvAt));
}

function seatName(i) {
  const s = poker.view.seats[i];
  return s ? s.name : '?';
}

const PK_STREETS = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
const pkBetting = (v) => Object.hasOwn(PK_STREETS, v.phase);

function renderPokerPhase() {
  const v = poker.view;
  if (!v) return;
  const secs = Math.ceil(pokerTimeLeft() / 1000);
  let text;
  if (v.phase === 'waiting') text = 'Ждём игроков: нужно двое за столом';
  else if (v.phase === 'starting') text = `Раздача через ${secs} с`;
  else if (pkBetting(v)) text = `${PK_STREETS[v.phase]} · ходит ${v.turn !== null ? seatName(v.turn) : '…'} · ${secs} с`;
  else text = 'Итоги раздачи';
  $('poker-phase').textContent = text;
  const bar = document.querySelector('.pk-seat.turn .pk-timer i');
  if (bar) bar.style.width = `${Math.min(100, (pokerTimeLeft() / v.turnMs) * 100)}%`;
}
setInterval(renderPokerPhase, 250);

// Места по кругу стола, [left%, top%]. Своё место всегда внизу по центру.
const PK_SLOTS = [[50, 92], [9, 68], [9, 22], [50, 3], [91, 22], [91, 68]];

function renderPokerSeats() {
  const v = poker.view;
  const res = v.result;
  const shown = new Map((res ? res.hands : []).map((x) => [x.seat, x]));
  const won = new Map((res ? res.winners : []).map((w) => [w.seat, w]));
  const mySeat = v.you ? v.you.seat : 0;
  const inPlay = pkBetting(v) || v.phase === 'showdown';

  $('poker-seats').replaceChildren(...v.seats.map((s, i) => {
    const slot = (i - mySeat + 6) % 6;
    const el = document.createElement('div');
    el.className = `pk-seat slot-${slot}`;
    el.style.left = `${PK_SLOTS[slot][0]}%`;
    el.style.top = `${PK_SLOTS[slot][1]}%`;
    if (!s) {
      el.classList.add('empty');
      el.textContent = 'свободно';
      return el;
    }
    if (state.me && s.id === state.me.playerId) el.classList.add('mine');
    if (v.turn === i && pkBetting(v)) el.classList.add('turn');
    if (s.folded) el.classList.add('folded');
    if (won.has(i)) el.classList.add('winner');
    if (!s.connected) el.classList.add('offline');

    const head = document.createElement('div');
    head.className = 'pk-head';
    const name = document.createElement('span');
    name.className = 'pk-name';
    name.textContent = s.name;
    head.append(avatarEl(s.name), name);

    const stack = document.createElement('div');
    stack.className = 'pk-stack';
    stack.textContent = s.allIn && inPlay ? `${s.stack} · олл-ин` : `${s.stack}`;

    // Карты: во вскрытии лицом, во время раздачи рубашкой (свои лицом).
    const cards = document.createElement('div');
    cards.className = 'pk-cards';
    const reveal = shown.get(i);
    const mine = v.you && v.you.seat === i && v.you.hole;
    if (reveal) cards.append(...reveal.hole.map((c) => cardEl(c, { small: true })));
    else if (mine && !s.folded) cards.append(...v.you.hole.map((c) => cardEl(c, { small: true })));
    else if (s.hasCards && !s.folded && inPlay) cards.append(cardEl(null, { small: true, back: true }), cardEl(null, { small: true, back: true }));

    el.append(cards, head, stack);

    // Кнопка дилера и блайнды.
    if (inPlay || v.phase === 'starting') {
      const tags = [];
      if (v.dealer === i) tags.push(['D', 'dealer']);
      if (pkBetting(v) && v.sb === i) tags.push(['SB', 'blind']);
      if (pkBetting(v) && v.bb === i) tags.push(['BB', 'blind']);
      for (const [t, cls] of tags) {
        const b = document.createElement('span');
        b.className = `pk-tag ${cls}`;
        b.textContent = t;
        el.append(b);
      }
    }

    // Последнее действие или итог.
    const note = document.createElement('div');
    note.className = 'pk-note';
    if (won.has(i)) {
      note.textContent = `+${won.get(i).won}${won.get(i).hand ? ` · ${won.get(i).hand}` : ''}`;
      note.classList.add('won');
    } else if (reveal) {
      note.textContent = reveal.hand;
    } else if (s.leaving) {
      note.textContent = 'уходит';
    } else if (!s.connected) {
      note.textContent = 'нет связи';
    } else if (s.lastAction && inPlay) {
      note.textContent = s.lastAction;
    }
    if (note.textContent) el.append(note);

    // Ставка на этой улице: фишки перед игроком.
    if (s.committed > 0 && pkBetting(v)) {
      const bet = document.createElement('div');
      bet.className = 'pk-bet';
      bet.textContent = s.committed;
      el.append(bet);
    }

    if (v.turn === i && pkBetting(v)) {
      const timer = document.createElement('div');
      timer.className = 'pk-timer';
      timer.append(document.createElement('i'));
      el.append(timer);
    }
    return el;
  }));
}

function renderBoard() {
  const v = poker.view;
  const res = v.result;
  const board = res ? res.board : v.board;
  if (poker.boardHand !== v.handId) {
    poker.boardHand = v.handId;
    poker.boardShown = 0;
  }
  // На вскрытии подсвечиваем карты стола, из которых собрана рука победителя.
  const winnerBest = new Set();
  if (res && res.revealed && res.winners.length) {
    const w = res.hands.find((x) => x.seat === res.winners[0].seat);
    if (w) w.best.forEach((c) => winnerBest.add(c));
  }
  const prev = poker.boardShown;
  $('pk-board').replaceChildren(...[0, 1, 2, 3, 4].map((i) => cardEl(board[i] || null, {
    deal: i >= prev && !!board[i],
    hl: !!board[i] && winnerBest.has(board[i]),
  })));
  if (board.length > prev) beep([[520, 0.03], [700, 0.03]], 'triangle');
  poker.boardShown = board.length;
  $('pk-pot-center').textContent = v.pot > 0 ? `Банк ${v.pot}` : '';
}

function renderPoker() {
  const v = poker.view;
  if (!v) return;
  const you = v.you;

  $('poker-pot').textContent = v.pot;
  renderPokerPhase();
  renderBoard();
  renderPokerSeats();
  renderPokerPhase();

  // Итог раздачи.
  const res = v.result;
  if (res) {
    const winners = res.winners.map((w) => `${w.name} +${w.won}`).join(', ');
    const how = res.revealed ? (res.winners[0] && res.winners[0].hand) : 'все сбросили';
    $('poker-result').textContent = `${res.winners.length > 1 ? 'Делёж' : 'Банк'}: ${winners} · ${how}`;
    $('poker-result').hidden = false;
    if (poker.lastResultHand !== res.handId) {
      poker.lastResultHand = res.handId;
      if (you && res.winners.some((w) => w.seat === you.seat)) sounds.win();
      else if (you && res.hands.some((x) => x.seat === you.seat)) sounds.lose();
    }
  } else {
    $('poker-result').hidden = true;
  }

  // Мои карты крупно.
  $('poker-me').hidden = !(you && you.hole);
  if (you && you.hole) {
    const key = `${v.handId}:${you.hole.join('')}`;
    const fresh = key !== poker.holeKey;
    poker.holeKey = key;
    $('my-hole').replaceChildren(...you.hole.map((c) => cardEl(c, { deal: fresh })));
    $('my-hole').classList.toggle('folded', !you.inHand && pkBetting(v));
    if (fresh) beep([[440, 0.04], [560, 0.04]], 'triangle');
    const pair = you.hole[0][0] === you.hole[1][0];
    const suited = you.hole[0][1] === you.hole[1][1];
    $('my-hand-name').textContent = you.hand || (pair ? 'Карманная пара' : suited ? 'Одномастные' : '');
    $('poker-hint').textContent = you.myTurn
      ? (you.toCall > 0 ? `Твой ход: колл ${you.toCall}, рейз или фолд` : 'Твой ход: чек или ставка')
      : !you.inHand && pkBetting(v) ? 'Ты сбросил'
        : v.phase === 'showdown' ? '' : pkBetting(v) ? 'Ждём остальных' : '';
  }

  // Кнопки.
  $('poker-join').hidden = !!you;
  $('poker-leave').hidden = !you;
  $('poker-leave').textContent = you && you.leaving ? 'Встанешь после раздачи' : 'Встать из-за стола';
  $('poker-leave').disabled = !!(you && you.leaving);

  const acting = !!(you && you.myTurn);
  $('poker-actions').hidden = !acting;
  if (acting) {
    const btn = (a) => document.querySelector(`[data-act="${a}"]`);
    btn('check').hidden = !you.canCheck;
    btn('call').hidden = !you.canCall;
    btn('call').textContent = `Колл ${you.toCall}`;
    $('pk-raise').hidden = !you.canRaise;
    if (you.canRaise) {
      const slider = $('raise-slider');
      slider.min = you.minRaiseTo;
      slider.max = you.maxRaiseTo;
      const cur = Number($('raise-amount').value);
      const val = cur >= you.minRaiseTo && cur <= you.maxRaiseTo ? cur : you.minRaiseTo;
      setRaise(val);
    }
  }

  const myTurnNow = !!(you && you.myTurn);
  if (myTurnNow && !poker.wasMyTurn) sounds.turn();
  poker.wasMyTurn = myTurnNow;
  $('poker-dot').hidden = !myTurnNow;
}

// Ползунок и поле «ставка до» синхронно, текст кнопки по смыслу.
function setRaise(value) {
  const v = poker.view;
  const you = v && v.you;
  if (!you) return;
  const val = Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, Math.round(value) || you.minRaiseTo));
  $('raise-slider').value = val;
  $('raise-amount').value = val;
  const allIn = val === you.maxRaiseTo;
  $('raise-btn').textContent = allIn ? `Олл-ин ${val}` : v.currentBet === 0 ? `Бет ${val}` : `Рейз до ${val}`;
}

$('raise-slider').addEventListener('input', () => {
  setRaise(Number($('raise-slider').value));
  $('raise-amount').dataset.typed = $('raise-amount').value;   // двигал ползунок сам — своя сумма
});
$('raise-amount').addEventListener('change', () => setRaise(Number($('raise-amount').value)));
document.querySelectorAll('[data-rq]').forEach((b) => b.addEventListener('click', () => {
  const v = poker.view;
  if (!v || !v.you) return;
  const you = v.you;
  const target = {
    min: you.minRaiseTo,
    half: v.currentBet + Math.floor(v.pot / 2),
    pot: v.currentBet + v.pot,
    allin: you.maxRaiseTo,
  }[b.dataset.rq];
  setRaise(target);
}));

$('poker-join').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const buyIn = Math.floor(Number($('buyin').value));
  confirmBet({ key: 'poker', game: '🃏 Покер', amount: buyIn, input: $('buyin'), note: 'Бай-ин: фишки уходят за стол, остаток вернётся, когда встанешь' })
    .then((ok) => ok && send({ type: 'poker_join', buyIn }));
});

$('poker-leave').addEventListener('click', () => send({ type: 'poker_leave' }));

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.act;
    const msg = { type: 'poker_action', action };
    if (action === 'raise') msg.amount = Math.floor(Number($('raise-amount').value));
    const v = poker.view;
    const you = v && v.you;
    const seat = you && v.seats[you.seat];
    const put = (seat && seat.committed) || 0;
    if (action !== 'raise') return send(msg);
    confirmBet({
      key: 'poker', game: '🃏 Покер', amount: msg.amount - put, input: $('raise-amount'),
      of: seat ? seat.stack + put : state.balance, note: `Повысить до ${msg.amount}`,
    }).then((ok) => ok && send(msg));
  });
});

// ---------- Чат ----------

function chatItem(m) {
  const li = document.createElement('li');
  if (m.playerId === null) li.className = 'system';
  else if (state.me && m.playerId === state.me.playerId) li.className = 'self';
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(m.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const author = document.createElement('span');
  author.className = 'author';
  author.textContent = m.name;
  const text = document.createElement('span');
  text.textContent = m.text;
  li.append(time, author, text);
  return li;
}

function renderChat(messages, append) {
  const log = $('chat-log');
  // Прокручиваем вниз, только если человек и так был внизу (не мешаем читать историю).
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  if (!append) log.replaceChildren();
  log.querySelector('.empty')?.remove();
  log.append(...messages.map(chatItem));
  if (!log.children.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока тихо';
    log.append(li);
  }
  while (log.children.length > 50) log.firstChild.remove();
  if (atBottom || !append) log.scrollTop = log.scrollHeight;
}

$('order-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const trackId = $('order-track').value;
  if (!trackId) return toast('Выбери песню из списка');
  send({ type: 'song_request', trackId });
  $('order-track').value = '';
});

$('chat-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  $('chat-input').value = '';
});

// ---------- Рулетка ----------

const R_WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const R_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const R_STEP = (2 * Math.PI) / R_WHEEL.length;
const R_CHIPS = [10, 50, 100, 500, 1000, 5000];
const R_CHIP_KEY = 'casino.roulette.chip';
const rColor = (n) => (n === 0 ? 'green' : R_RED.has(n) ? 'red' : 'black');

// Как на сервере: какие ставки выигрывают при номере n.
const R_WINS = {
  straight: (n, num) => n === num,
  red: (n) => R_RED.has(n),
  black: (n) => n !== 0 && !R_RED.has(n),
  even: (n) => n !== 0 && n % 2 === 0,
  odd: (n) => n % 2 === 1,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19,
  dozen1: (n) => n >= 1 && n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25,
  column1: (n) => n !== 0 && n % 3 === 1,
  column2: (n) => n !== 0 && n % 3 === 2,
  column3: (n) => n !== 0 && n % 3 === 0,
};

const rl = {
  view: null,
  recvAt: 0,
  chip: Number(storage.get(R_CHIP_KEY)) || 50,
  rotation: 0,          // текущий поворот колеса
  spin: null,           // { roundId, sim, click }
  wheelW: 1.2,          // скорость колеса между вращениями, рад/с
  lastResultRound: 0,
  cells: [],            // [{ el, type, number }]
};
if (!R_CHIPS.includes(rl.chip)) rl.chip = 50;

// Чипы выбора номинала.
$('r-chips').replaceChildren(...R_CHIPS.map((v) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.v = v;
  b.textContent = v >= 1000 ? `${v / 1000}k` : v;
  b.addEventListener('click', () => {
    rl.chip = v;
    storage.set(R_CHIP_KEY, String(v));
    renderChips();
  });
  return b;
}));
function renderChips() {
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.v) === rl.chip));
}
renderChips();

// Поле: зеро, 12x3 номеров, колонки, дюжины, внешние ставки.
(function buildBoard() {
  const cells = [];
  const add = (label, type, number, col, row, cls) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cell ${cls || ''}`;
    el.style.gridColumn = col;
    el.style.gridRow = row;
    el.textContent = label;
    el.addEventListener('click', () => {
      send({ type: 'roulette_bet', betType: type, number, amount: rl.chip });
    });
    cells.push({ el, type, number });
  };
  add('0', 'straight', 0, '1', '1 / 4', 'green');
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 3; r++) {
      const n = 3 * c - (r - 1);   // верхний ряд 3,6,...,36
      add(String(n), 'straight', n, String(c + 1), String(r), rColor(n));
    }
  }
  add('2:1', 'column3', null, '14', '1');
  add('2:1', 'column2', null, '14', '2');
  add('2:1', 'column1', null, '14', '3');
  add('1-12', 'dozen1', null, '2 / 6', '4');
  add('13-24', 'dozen2', null, '6 / 10', '4');
  add('25-36', 'dozen3', null, '10 / 14', '4');
  add('1-18', 'low', null, '2 / 4', '5');
  add('Чёт', 'even', null, '4 / 6', '5');
  add('◆', 'red', null, '6 / 8', '5', 'red');
  add('◆', 'black', null, '8 / 10', '5', 'black');
  add('Нечёт', 'odd', null, '10 / 12', '5');
  add('19-36', 'high', null, '12 / 14', '5');
  $('r-board').replaceChildren(...cells.map((c) => c.el));
  rl.cells = cells;
})();

$('r-clear').addEventListener('click', () => send({ type: 'roulette_clear' }));

function myRouletteBets() {
  const v = rl.view;
  return v && state.me ? v.players.find((p) => p.id === state.me.playerId) || null : null;
}

function rouletteTimeLeft() {
  return rl.view ? Math.max(0, rl.view.timeLeft - (performance.now() - rl.recvAt)) : 0;
}

function renderRoulette() {
  const v = rl.view;
  if (!v) return;
  const mine = myRouletteBets();
  const betting = v.phase === 'betting';

  // История.
  $('r-history').replaceChildren(...v.history.map((h) => {
    const s = document.createElement('span');
    s.textContent = h.n;
    s.className = `rn ${h.color}`;
    return s;
  }));

  // Мои фишки на поле и подсветка выигравших клеток.
  const stakes = new Map();
  for (const b of (mine ? mine.bets : [])) stakes.set(`${b.type}:${b.number}`, b.amount);
  for (const c of rl.cells) {
    c.el.disabled = !betting;
    c.el.querySelector('.stake')?.remove();
    const amt = stakes.get(`${c.type}:${c.number}`);
    if (amt) {
      const s = document.createElement('span');
      s.className = 'stake';
      s.textContent = amt >= 1000 ? `${Math.round(amt / 100) / 10}k` : amt;
      c.el.append(s);
    }
    c.el.classList.toggle('win', v.phase === 'result' && R_WINS[c.type](v.result, c.number));
  }

  $('r-mytotal').textContent = mine ? `Твои ставки: ${mine.total}` : '';
  $('r-clear').disabled = !(betting && mine);

  // Итог раунда.
  const res = $('r-result');
  if (v.phase === 'result' && mine) {
    res.textContent = mine.won > 0 ? `Выигрыш ${mine.won} (+${mine.won - mine.total})` : `Мимо: −${mine.total}`;
    res.className = `r-result ${mine.won > 0 ? 'win' : 'lose'}`;
  } else {
    res.textContent = '';
    res.className = 'r-result';
  }
  if (v.phase === 'result' && rl.lastResultRound !== v.roundId) {
    rl.lastResultRound = v.roundId;
    if (mine && mine.won > 0) sounds.win();
    else if (mine) sounds.lose();
  }

  // Ставки игроков.
  $('r-bets').replaceChildren(...v.players.map((p) => {
    const tr = document.createElement('tr');
    if (state.me && p.id === state.me.playerId) tr.className = 'self';
    const name = document.createElement('td');
    name.textContent = p.name;
    const total = document.createElement('td');
    total.textContent = p.total;
    const won = document.createElement('td');
    if (p.won !== null) {
      won.textContent = p.won > 0 ? `+${p.won - p.total}` : `−${p.total}`;
      won.className = p.won > 0 ? 'won' : 'lost';
    } else {
      won.textContent = '…';
    }
    tr.append(name, total, won);
    return tr;
  }));
}

// Колесо и шарик. Колесо крутится по часовой, шарик бежит по дорожке против часовой,
// замедляется, скатывается к карманам, отскакивает по перегородкам и оседает в выпавшем номере.
// Номер выбирает сервер, анимация только красиво доводит шарик до него.
const rCanvas = $('r-wheel');
const rCtx = rCanvas.getContext('2d');
const W_SIZE = 300;
const W_C = W_SIZE / 2;
const R_DISK = 116;       // вращающийся диск
const R_NUM = 106;        // кольцо с номерами
const R_WELL = 96;        // карманы
const R_CONE = 80;        // центральный конус
const BALL_R = 6.5;

// Неподвижная часть (обод и дорожка) и вращающийся диск рисуются один раз в offscreen-канвасы
// с запасом по разрешению, а при выводе растягиваются на точный размер канваса:
// масштаб экрана (devicePixelRatio) может поменяться после загрузки страницы.
const LAYER_SCALE = Math.max(2, window.devicePixelRatio || 1);
function makeLayer(draw) {
  const cv = document.createElement('canvas');
  cv.width = W_SIZE * LAYER_SCALE;
  cv.height = W_SIZE * LAYER_SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(LAYER_SCALE, LAYER_SCALE);
  ctx.translate(W_C, W_C);
  draw(ctx);
  return cv;
}

const wheelBase = makeLayer((ctx) => {
  // Деревянный обод.
  const wood = ctx.createRadialGradient(0, 0, 130, 0, 0, 150);
  wood.addColorStop(0, '#2b140a');
  wood.addColorStop(0.35, '#7a4220');
  wood.addColorStop(0.7, '#a35f2f');
  wood.addColorStop(1, '#4a250f');
  ctx.beginPath();
  ctx.arc(0, 0, 148, 0, 2 * Math.PI);
  ctx.fillStyle = wood;
  ctx.fill();
  // Полированная дорожка шарика.
  const track = ctx.createRadialGradient(0, 0, R_DISK, 0, 0, 136);
  track.addColorStop(0, '#120b07');
  track.addColorStop(0.6, '#3a2618');
  track.addColorStop(1, '#1c120b');
  ctx.beginPath();
  ctx.arc(0, 0, 136, 0, 2 * Math.PI);
  ctx.fillStyle = track;
  ctx.fill();
  // Блик на дорожке.
  ctx.beginPath();
  ctx.arc(0, 0, 131, Math.PI * 1.1, Math.PI * 1.6);
  ctx.strokeStyle = 'rgba(255, 230, 190, .18)';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Золотые кольца.
  for (const r of [136, 147]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#d9a93c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
});

const pocketColor = (n) => (n === 0 ? '#14894a' : R_RED.has(n) ? '#c0281f' : '#151515');
const pocketFloor = (n) => (n === 0 ? '#0d5c32' : R_RED.has(n) ? '#7d1813' : '#0b0b0b');

const wheelDisk = makeLayer((ctx) => {
  // Номер i занимает сектор [i*STEP - STEP/2, i*STEP + STEP/2] от верха по часовой.
  ctx.rotate(-Math.PI / 2 - R_STEP / 2);
  R_WHEEL.forEach((n, i) => {
    const a0 = i * R_STEP;
    // Кольцо с номером.
    ctx.beginPath();
    ctx.arc(0, 0, R_DISK, a0, a0 + R_STEP);
    ctx.arc(0, 0, R_WELL, a0 + R_STEP, a0, true);
    ctx.closePath();
    ctx.fillStyle = pocketColor(n);
    ctx.fill();
    // Карман (дно потемнее).
    ctx.beginPath();
    ctx.arc(0, 0, R_WELL, a0, a0 + R_STEP);
    ctx.arc(0, 0, R_CONE, a0 + R_STEP, a0, true);
    ctx.closePath();
    ctx.fillStyle = pocketFloor(n);
    ctx.fill();
    // Перегородка.
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0) * R_CONE, Math.sin(a0) * R_CONE);
    ctx.lineTo(Math.cos(a0) * R_DISK, Math.sin(a0) * R_DISK);
    ctx.strokeStyle = '#e2b54c';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Номер.
    ctx.save();
    ctx.rotate(a0 + R_STEP / 2);
    ctx.translate(R_NUM, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  });
  for (const r of [R_DISK, R_WELL]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#e2b54c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Конус.
  const cone = ctx.createRadialGradient(-12, -14, 4, 0, 0, R_CONE);
  cone.addColorStop(0, '#d79a52');
  cone.addColorStop(0.45, '#8a4b22');
  cone.addColorStop(1, '#3d1d0b');
  ctx.beginPath();
  ctx.arc(0, 0, R_CONE, 0, 2 * Math.PI);
  ctx.fillStyle = cone;
  ctx.fill();
  // Турель: четыре золотые спицы и шишечка.
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + R_STEP / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
    ctx.strokeStyle = '#f4d27a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 46, Math.sin(a) * 46, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#f4d27a';
    ctx.fill();
  }
  const knob = ctx.createRadialGradient(-4, -4, 1, 0, 0, 14);
  knob.addColorStop(0, '#fff6d6');
  knob.addColorStop(1, '#c9962e');
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, 2 * Math.PI);
  ctx.fillStyle = knob;
  ctx.fill();
});

function drawWheel(rotation, ball) {
  const dpr = window.devicePixelRatio || 1;
  if (rCanvas.width !== W_SIZE * dpr) {
    rCanvas.width = W_SIZE * dpr;
    rCanvas.height = W_SIZE * dpr;
  }
  const ctx = rCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, rCanvas.width, rCanvas.height);
  const size = W_SIZE * dpr;
  ctx.drawImage(wheelBase, 0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(rotation);
  ctx.drawImage(wheelDisk, -size / 2, -size / 2, size, size);
  ctx.restore();
  if (!ball) return;
  // Шарик: тень и блик.
  const x = (W_C + Math.cos(ball.angle) * ball.r) * dpr;
  const y = (W_C + Math.sin(ball.angle) * ball.r) * dpr;
  ctx.beginPath();
  ctx.arc(x + 1.5 * dpr, y + 2 * dpr, BALL_R * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(0, 0, 0, .45)';
  ctx.fill();
  const g = ctx.createRadialGradient(x - 2 * dpr, y - 2.5 * dpr, 0.5 * dpr, x, y, BALL_R * dpr);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#e9e9e9');
  g.addColorStop(1, '#9a9a9a');
  ctx.beginPath();
  ctx.arc(x, y, BALL_R * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = g;
  ctx.fill();
}

// Угол кармана номера n на экране при повороте колеса rotation.
const pocketAngle = (rotation, n) => rotation - Math.PI / 2 + R_WHEEL.indexOf(n) * R_STEP;
const RPH = window.RoulettePhysics;

function rouletteFrame(now) {
  const dt = Math.min(0.1, (now - (rl.lastFrameAt || now)) / 1000);
  rl.lastFrameAt = now;
  const v = rl.view;
  if (v && !$('roulette').hidden) {
    let ball = null;
    if (v.phase === 'spinning') {
      const elapsed = (v.spinMs - rouletteTimeLeft()) / 1000;
      if (!rl.spin || rl.spin.roundId !== v.roundId) {
        // Новый бросок: случайная физика с зерном из номера раунда, у всех одинаковая.
        const sim = RPH.spin({ seed: v.roundId, rotation: rl.rotation, slot: R_WHEEL.indexOf(v.result), spinMs: v.spinMs });
        const already = elapsed * sim.scale;
        rl.spin = { roundId: v.roundId, sim, click: sim.clicks.filter((c) => c <= already).length };
      }
      const { sim } = rl.spin;
      const tSim = elapsed * sim.scale;
      const f = sim.frames[Math.min(sim.frames.length - 1, Math.floor(tSim / sim.frameDt))];
      rl.rotation = f[2];
      ball = { angle: f[0], r: f[1] };
      // Щелчки о перегородки.
      while (rl.spin.click < sim.clicks.length && sim.clicks[rl.spin.click] <= tSim) {
        rl.spin.click += 1;
        if (soundOn) beep([[1400 + Math.random() * 700, 0.014]], 'square');
      }
      rl.wheelW = sim.wheelSpeed * sim.scale;
    } else {
      // Колесо докручивается по инерции, шарик лежит в последнем выпавшем номере.
      rl.rotation += (rl.wheelW || 0) * dt;
      rl.wheelW = (rl.wheelW || 0) * (1 - 0.06 * dt);
      const last = v.phase === 'result' ? v.result : v.history.length ? v.history[0].n : null;
      if (last !== null) ball = { angle: pocketAngle(rl.rotation, last), r: RPH.R_POCKET };
    }
    drawWheel(rl.rotation, ball);

    const center = $('r-center');
    const secs = Math.ceil(rouletteTimeLeft() / 1000);
    if (v.phase === 'betting') {
      center.textContent = secs;
      center.className = 'r-center';
      $('r-phase').textContent = `Делайте ставки: ${secs} с`;
    } else if (v.phase === 'spinning') {
      center.textContent = '';
      center.className = 'r-center spinning';
      $('r-phase').textContent = 'Ставок больше нет, шарик в игре';
    } else {
      center.textContent = v.result;
      center.className = `r-center ${v.color}`;
      $('r-phase').textContent = `Выпало ${v.result}. Новый раунд через ${secs} с`;
    }
  }
  requestAnimationFrame(rouletteFrame);
}
requestAnimationFrame(rouletteFrame);

// ---------- Колесо фортуны (общее на весь зал) ----------

const FP = window.FortunePhysics;
const FW_MULTS = [2, 3, 10, 60];
const FW_COUNT = Object.fromEntries([0, ...FW_MULTS].map((m) => [m, FP.WHEEL.filter((x) => x === m).length]));
const FW_COLORS = {
  2: ['#0a5cff', '#3fb4ff'],
  3: ['#00b347', '#5dff95'],
  10: ['#c2129f', '#ff5ce0'],
  60: ['#ff8a00', '#ffe14d'],
  0: ['#2a0008', '#a3102a'],
};
const fwLabel = (m) => (m === 0 ? '💀' : `×${m}`);
const FW_FLAP_MAX = 0.55;    // на сколько радиан отгибается язычок

const fw = {
  view: null,
  recvAt: 0,
  rotation: -2.5 * FP.STEP,   // пока не знаем, где колесо стояло, — на секторе ×2
  dir: 1,
  flap: 0,
  flapV: 0,
  spin: null,                 // { roundId, sim }
  lastTickAt: 0,
  lastFrameAt: 0,
  lastResultRound: 0,
  cards: {},
};

// Колесо (вращающаяся часть) рисуется один раз с запасом по разрешению.
const FW_LAYER = 720;
const fwDisk = (() => {
  const cv = document.createElement('canvas');
  cv.width = FW_LAYER;
  cv.height = FW_LAYER;
  const ctx = cv.getContext('2d');
  const c = FW_LAYER / 2;
  const R = c - 2;
  const inner = R * 0.3;
  ctx.translate(c, c);
  FP.WHEEL.forEach((m, i) => {
    const a0 = -Math.PI / 2 + i * FP.STEP;
    const a1 = a0 + FP.STEP;
    const g = ctx.createRadialGradient(0, 0, inner, 0, 0, R);
    g.addColorStop(0, FW_COLORS[m][0]);
    g.addColorStop(0.55, FW_COLORS[m][1]);
    g.addColorStop(0.92, FW_COLORS[m][1]);
    g.addColorStop(1, FW_COLORS[m][0]);
    ctx.beginPath();
    ctx.arc(0, 0, R, a0, a1);
    ctx.arc(0, 0, inner, a1, a0, true);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    // Перегородка между секторами.
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0) * inner, Math.sin(a0) * inner);
    ctx.lineTo(Math.cos(a0) * R, Math.sin(a0) * R);
    ctx.strokeStyle = 'rgba(255, 233, 170, .55)';
    ctx.lineWidth = 2;
    ctx.stroke();
    // Подпись по радиусу.
    ctx.save();
    ctx.rotate(a0 + FP.STEP / 2);
    ctx.translate(R * 0.8, 0);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (m === 0) {
      ctx.font = '26px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.fillText('💀', 0, 0);
    } else {
      ctx.font = `800 ${m === 60 ? 26 : 24}px Unbounded, Manrope, system-ui, sans-serif`;
      ctx.rotate(-Math.PI / 2);   // цифры читаются вдоль радиуса, от центра наружу
      ctx.lineWidth = 5;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = m === 60 ? 'rgba(255, 250, 220, .7)' : 'rgba(0, 0, 0, .45)';
      ctx.strokeText(String(m), 0, 0);
      ctx.fillStyle = m === 60 ? '#4a2400' : '#fff';
      ctx.fillText(String(m), 0, 0);
    }
    ctx.restore();
    // Штырёк на ободе.
    const pr = R * 0.955;
    ctx.beginPath();
    ctx.arc(Math.cos(a0) * pr, Math.sin(a0) * pr, 5.5, 0, 2 * Math.PI);
    const pg = ctx.createRadialGradient(Math.cos(a0) * pr - 1.5, Math.sin(a0) * pr - 1.5, 0.5, Math.cos(a0) * pr, Math.sin(a0) * pr, 5.5);
    pg.addColorStop(0, '#fff6d6');
    pg.addColorStop(1, '#b8862a');
    ctx.fillStyle = pg;
    ctx.fill();
  });
  // Блик: колесо как будто покрыто лаком.
  const gloss = ctx.createRadialGradient(-R * 0.35, -R * 0.45, 0, -R * 0.2, -R * 0.25, R * 1.1);
  gloss.addColorStop(0, 'rgba(255, 255, 255, .28)');
  gloss.addColorStop(0.5, 'rgba(255, 255, 255, .06)');
  gloss.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, 2 * Math.PI);
  ctx.fillStyle = gloss;
  ctx.fill();
  // Золотые кольца и центральная ступица.
  for (const [r, w] of [[R, 4], [inner, 4]]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#e8bb55';
    ctx.lineWidth = w;
    ctx.stroke();
  }
  const hub = ctx.createRadialGradient(-inner * 0.3, -inner * 0.35, 4, 0, 0, inner);
  hub.addColorStop(0, '#2b4a38');
  hub.addColorStop(1, '#0a1c12');
  ctx.beginPath();
  ctx.arc(0, 0, inner - 2, 0, 2 * Math.PI);
  ctx.fillStyle = hub;
  ctx.fill();
  return cv;
})();

// Колесо целиком: обод с лампочками, диск, язычок, подсветка выпавшего сектора.
// opts: { lights: 'idle' | 'spin' | 'win', highlight: true, time }
function fwDraw(canvas, size, rotation, flap, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(size * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2 + size * 0.025;
  const R = size * 0.415;
  const rim = size * 0.055;
  const t = opts.time || 0;

  // Обод.
  const wood = ctx.createRadialGradient(cx, cy, R, cx, cy, R + rim);
  wood.addColorStop(0, '#2a1608');
  wood.addColorStop(0.5, '#6b3b18');
  wood.addColorStop(1, '#2a1608');
  ctx.beginPath();
  ctx.arc(cx, cy, R + rim, 0, 2 * Math.PI);
  ctx.fillStyle = wood;
  ctx.fill();
  // Лампочки: бегут, пока крутится, мигают при выигрыше, тихо дышат в ожидании.
  const BULBS = 30;
  for (let i = 0; i < BULBS; i++) {
    const a = (i / BULBS) * 2 * Math.PI;
    let on;
    if (opts.lights === 'spin') on = (i + Math.floor(t * 14)) % 3 === 0 ? 1 : 0.18;
    else if (opts.lights === 'win') on = Math.floor(t * 6) % 2 === i % 2 ? 1 : 0.2;
    else on = 0.45 + 0.35 * Math.sin(t * 2 + i * 0.7);
    const bx = cx + Math.cos(a) * (R + rim / 2);
    const by = cy + Math.sin(a) * (R + rim / 2);
    const br = Math.max(2, rim * 0.2);
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(255, 226, 140, ${on})`;
    ctx.shadowColor = 'rgba(255, 210, 90, .9)';
    ctx.shadowBlur = on > 0.6 ? br * 3 : 0;
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  // Диск.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.drawImage(fwDisk, -R, -R, 2 * R, 2 * R);
  ctx.restore();

  // Выпавший сектор под язычком светится.
  if (opts.highlight) {
    const seg = FP.segmentAt(rotation);
    const a0 = -Math.PI / 2 + rotation + seg * FP.STEP;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, a0, a0 + FP.STEP);
    ctx.closePath();
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 8);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
  }

  // Язычок: качается на оси над колесом, кончик между штырьками.
  const pivotY = cy - R - rim * 0.55;
  const len = rim * 0.55 + R * 0.12;
  ctx.save();
  ctx.translate(cx, pivotY);
  ctx.rotate(-flap * FW_FLAP_MAX);
  ctx.beginPath();
  ctx.moveTo(-size * 0.03, 0);
  ctx.lineTo(size * 0.03, 0);
  ctx.lineTo(0, len);
  ctx.closePath();
  const pg = ctx.createLinearGradient(-size * 0.03, 0, size * 0.03, 0);
  pg.addColorStop(0, '#9c1d17');
  pg.addColorStop(0.5, '#ff5a4f');
  pg.addColorStop(1, '#9c1d17');
  ctx.fillStyle = pg;
  ctx.shadowColor = 'rgba(0, 0, 0, .5)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = '#ffd27a';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.022, 0, 2 * Math.PI);
  ctx.fillStyle = '#e8bb55';
  ctx.fill();
  ctx.restore();
}

// Язычок — пружинка: тянется к тому, куда его отгибает штырёк, и дрожит, когда отпустило.
function fwFlapStep(state, rotation, dt) {
  const moved = rotation - state.prevRot;
  if (Math.abs(moved) > 1e-6) state.dir = Math.sign(moved);
  state.prevRot = rotation;
  const target = FP.flapTarget(rotation, state.dir);
  const acc = (target - state.flap) * 900 - state.flapV * 22;
  state.flapV += acc * dt;
  state.flap += state.flapV * dt;
  state.flap = Math.max(-1.2, Math.min(1.2, state.flap));
}

// Ставки: четыре цвета.
$('fw-bet-cards').replaceChildren(...FW_MULTS.map((m) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `fw-card m${m}`;
  const mult = Object.assign(document.createElement('b'), { className: 'fw-card-mult', textContent: `×${m}` });
  const chance = Object.assign(document.createElement('small'), { textContent: `${FW_COUNT[m]} из ${FP.N} секторов` });
  const pot = Object.assign(document.createElement('span'), { className: 'fw-card-pot' });
  const mine = Object.assign(document.createElement('span'), { className: 'fw-card-mine' });
  b.append(mult, chance, pot, mine);
  b.addEventListener('click', () => fwBet(m));
  fw.cards[m] = { b, pot, mine };
  return b;
}));

function fwAmount() {
  return Math.max(0, Math.floor(Number($('fw-amount').value) || 0));
}
document.querySelectorAll('[data-fq]').forEach((b) => b.addEventListener('click', () => {
  const v = Math.max(1, fwAmount() || 1);
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.fq];
  $('fw-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
}));

async function fwBet(mult) {
  const amount = fwAmount();
  if (amount < 1) return toast('Ставка — от 1 фишки', true);
  if (!await confirmBet({ key: 'wheel', game: '🎰 Колесо фортуны', amount, input: $('fw-amount'), note: `Ставка на ×${mult}` })) return;
  send({ type: 'wheel_bet', mult, amount });
}
$('fw-clear').addEventListener('click', () => send({ type: 'wheel_clear' }));

const fwTimeLeft = () => (fw.view ? Math.max(0, fw.view.timeLeft - (performance.now() - fw.recvAt)) : 0);
const fwMine = () => (fw.view && state.me ? fw.view.players.find((p) => p.id === state.me.playerId) || null : null);
const fwShort = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}М` : n >= 1e4 ? `${Math.round(n / 100) / 10}k` : String(n));

function renderWheel() {
  const v = fw.view;
  if (!v) return;
  const mine = fwMine();
  const betting = v.phase === 'betting';

  $('fw-history').replaceChildren(...v.history.map((m) => Object.assign(document.createElement('span'), { className: `fwh m${m}`, textContent: fwLabel(m) })));

  for (const m of FW_MULTS) {
    const c = fw.cards[m];
    c.b.disabled = !betting;
    const bettors = v.players.filter((p) => p.stakes[m]).length;
    c.pot.textContent = v.pots[m] ? `в банке ${fwShort(v.pots[m])} · ${bettors} ${bettors === 1 ? 'игрок' : bettors < 5 ? 'игрока' : 'игроков'}` : 'пока никто';
    const my = mine && mine.stakes[m];
    c.mine.textContent = my ? `твоя ${fwShort(my)}` : '';
    c.b.classList.toggle('has-mine', !!my);
    c.b.classList.toggle('win', v.phase === 'result' && v.mult === m);
    c.b.classList.toggle('dim', v.phase === 'result' && v.mult !== m);
  }
  $('fw-mytotal').textContent = mine ? `Твои ставки: ${mine.total.toLocaleString('ru-RU')}` : '';
  $('fw-clear').disabled = !(betting && mine);

  const res = $('fw-result');
  if (v.phase === 'result' && mine) {
    res.textContent = mine.won > 0 ? `Выигрыш ${mine.won.toLocaleString('ru-RU')} (+${(mine.won - mine.total).toLocaleString('ru-RU')})` : `Мимо: −${mine.total.toLocaleString('ru-RU')}`;
    res.className = `r-result ${mine.won > 0 ? 'win' : 'lose'}`;
  } else {
    res.textContent = '';
    res.className = 'r-result';
  }
  if (v.phase === 'result' && fw.lastResultRound !== v.roundId) {
    fw.lastResultRound = v.roundId;
    if (mine && mine.won > 0) {
      sounds.win();
      if (v.mult === 60) effects.money();
      else if (v.mult >= 10) effects.confetti();
    } else if (mine) sounds.lose();
  }

  $('fw-players').replaceChildren(...v.players.map((p) => {
    const tr = document.createElement('tr');
    if (state.me && p.id === state.me.playerId) tr.className = 'self';
    const name = Object.assign(document.createElement('td'), { textContent: p.name });
    const stakes = document.createElement('td');
    for (const m of FW_MULTS) {
      if (!p.stakes[m]) continue;
      stakes.append(Object.assign(document.createElement('span'), { className: `fw-stake m${m}`, textContent: `×${m} ${fwShort(p.stakes[m])}` }));
    }
    const won = document.createElement('td');
    if (p.won !== null) {
      won.textContent = p.won > 0 ? `+${(p.won - p.total).toLocaleString('ru-RU')}` : `−${p.total.toLocaleString('ru-RU')}`;
      won.className = p.won > 0 ? 'won' : 'lost';
    } else {
      won.textContent = '…';
    }
    tr.append(name, stakes, won);
    return tr;
  }));
}

const fwFlap = { flap: 0, flapV: 0, dir: 1, prevRot: fw.rotation };

function wheelFrame(now) {
  const dt = Math.min(0.05, (now - (fw.lastFrameAt || now)) / 1000);
  fw.lastFrameAt = now;
  const v = fw.view;
  if (v && !$('wheel').hidden) {
    let rot = fw.rotation;
    if (v.phase !== 'betting') {
      if (!fw.spin || fw.spin.roundId !== v.roundId) {
        // Новое вращение: случайная физика с зерном из номера раунда, у всех одинаковая.
        fw.spin = { roundId: v.roundId, sim: FP.spin({ seed: v.roundId * 31 + 7, rotation: fw.rotation, segment: v.result, spinMs: v.spinMs }) };
      }
      const { sim } = fw.spin;
      const elapsed = v.phase === 'spinning' ? (v.spinMs - fwTimeLeft()) / 1000 : Infinity;
      rot = sim.frames[Math.min(sim.frames.length - 1, Math.floor((elapsed * sim.scale) / sim.frameDt))];
    }
    // Щелчок, когда штырёк проскакивает язычок.
    if (FP.segmentAt(rot) !== FP.segmentAt(fw.rotation) && now - fw.lastTickAt > 28) {
      fw.lastTickAt = now;
      if (soundOn) beep([[1700 + Math.random() * 500, 0.012]], 'square');
    }
    fw.rotation = rot;
    fwFlapStep(fwFlap, rot, dt);
    const stopped = v.phase === 'result' || (v.phase === 'spinning' && fwTimeLeft() < v.spinMs * (1 - FP.SETTLE_SHARE));
    const mine = fwMine();
    fwDraw($('fw-canvas'), $('fw-canvas').clientWidth || 360, rot, fwFlap.flap, {
      time: now / 1000,
      lights: v.phase === 'spinning' && !stopped ? 'spin' : v.phase === 'result' && mine && mine.won > 0 ? 'win' : 'idle',
      highlight: stopped,
    });

    const hub = $('fw-hub');
    const secs = Math.ceil(fwTimeLeft() / 1000);
    if (v.phase === 'betting') {
      hub.textContent = secs;
      hub.className = 'fw-hub';
      $('fw-phase').textContent = `Делайте ставки: ${secs} с`;
    } else if (!stopped) {
      hub.textContent = '';
      hub.className = 'fw-hub';
      $('fw-phase').textContent = 'Ставок больше нет, колесо крутится';
    } else {
      hub.textContent = fwLabel(v.mult);
      hub.className = `fw-hub show m${v.mult}`;
      $('fw-phase').textContent = v.phase === 'result' ? `Выпало ${fwLabel(v.mult)}. Новый раунд через ${secs} с` : `Выпало ${fwLabel(v.mult)}!`;
    }
  }
  requestAnimationFrame(wheelFrame);
}
requestAnimationFrame(wheelFrame);

// ---------- Музыка (включает админ, файлы из папки music на сервере) ----------

const MUSIC_KEY = 'casino.music';
const VOLUME_KEY = 'casino.volume.pos';  // положение ползунка 0..100
const music = {
  track: null,          // { id, title, url, offset }
  recvAt: 0,
  on: storage.get(MUSIC_KEY) !== 'off',
  loadedId: null,       // какой трек сейчас в <audio>
};
const audioEl = $('music-audio');
// Слух логарифмический: при линейной громкости почти весь ход ползунка звучит одинаково,
// а у нуля звук резко пропадает. Квадрат даёт ровное «тише-громче» по всей длине.
const volumeFromSlider = (pos) => (pos / 100) ** 2;
function applyVolume() {
  audioEl.volume = volumeFromSlider(Number($('music-volume').value));
}
const savedPos = Number(storage.get(VOLUME_KEY));
$('music-volume').value = Number.isFinite(savedPos) && storage.get(VOLUME_KEY) !== null ? savedPos : 70;
applyVolume();

// iPhone/iPad не дают странице менять громкость (volume всегда 1): прячем ползунок.
(function detectFixedVolume() {
  const probe = new Audio();
  probe.volume = 0.5;
  if (probe.volume === 1) {
    $('music-volume-box').hidden = true;
    $('music-volume-hint').hidden = false;
  }
})();

// Где сейчас трек у всех: смещение от сервера + сколько прошло с получения.
function musicPosition() {
  return music.track.offset + (performance.now() - music.recvAt) / 1000;
}

function tryPlay() {
  audioEl.play().then(
    () => { $('music-start').hidden = true; },
    // Браузер не даёт играть звук, пока человек ничего не нажал на странице.
    () => { $('music-start').hidden = false; },
  );
}

function renderMusic() {
  const t = music.track;
  // Пока играет песня из зала, фоновый джаз молчит.
  if (window.Lounge) window.Lounge.setDucked(!!t && music.on);
  document.body.classList.toggle('has-music', !!t);
  $('music').hidden = !t;
  $('music').classList.toggle('off', !!t && !music.on);
  if (!t || !music.on) {
    audioEl.pause();
    audioEl.removeAttribute('src');
    music.loadedId = null;
    $('music-start').hidden = true;
    if (t) {
      $('music-title').textContent = `🎵 ${t.title}`;
      $('music-toggle').textContent = 'включить';
    }
    return;
  }
  $('music-title').textContent = `🎵 ${t.title}`;
  $('music-toggle').textContent = 'выключить у себя';
  if (music.loadedId === t.id) return;
  music.loadedId = t.id;
  audioEl.src = t.url;
  // Перематываем, когда браузер узнал длину трека.
  audioEl.onloadedmetadata = () => {
    // Сообщаем серверу длину трека: так он сам выключит песню, когда она доиграет.
    if (Number.isFinite(audioEl.duration)) send({ type: 'music_duration', id: t.id, duration: audioEl.duration });
    const pos = musicPosition();
    if (Number.isFinite(audioEl.duration) && pos >= audioEl.duration) {
      audioEl.pause();  // трек у всех уже закончился
      return;
    }
    audioEl.currentTime = pos;
    tryPlay();
  };
}

$('music-start').addEventListener('click', () => {
  if (music.track) audioEl.currentTime = musicPosition();
  tryPlay();
});

$('music-toggle').addEventListener('click', () => {
  music.on = !music.on;
  storage.set(MUSIC_KEY, music.on ? 'on' : 'off');
  renderMusic();
});

$('music-volume').addEventListener('input', () => {
  applyVolume();
  storage.set(VOLUME_KEY, $('music-volume').value);
});

// ---------- Апгрейдер ----------

const UPG_RTP = 99;  // как на сервере: множитель = 99 / шанс
const upgMult = (chance) => Math.floor((UPG_RTP / chance) * 100) / 100;

const upg = {
  start: 0,          // где начинается зелёный сектор (0..100, от верха по часовой)
  needle: 0,         // где стрелка (0..100, может уходить за 100 при вращении)
  spin: null,        // { from, to, t0, dur, result }
  awaiting: false,   // запрос отправлен, ответа ещё нет
  pendingBalance: null,
  trail: [],         // прошлые положения стрелки для шлейфа
  outcome: null,     // 'win' | 'lose' после остановки: цвет стрелки
};

const uCanvas = $('u-wheel');
const uCtx = uCanvas.getContext('2d');
const U_SIZE = 280;

function upgChance() {
  return Math.max(1, Math.min(95, Math.round(Number($('u-chance').value) || 30)));
}

function upgAmount() {
  const n = Math.floor(Number($('u-amount').value));
  return Number.isFinite(n) ? n : 0;
}

function drawUpgrader() {
  const dpr = window.devicePixelRatio || 1;
  if (uCanvas.width !== Math.round(U_SIZE * dpr)) {
    uCanvas.width = Math.round(U_SIZE * dpr);
    uCanvas.height = Math.round(U_SIZE * dpr);
  }
  const ctx = uCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, U_SIZE, U_SIZE);
  const c = U_SIZE / 2;
  const R = c - 24;   // кольцо толщиной 22, стрелка и свечение должны влезть в холст
  const toRad = (p) => (p / 100) * 2 * Math.PI - Math.PI / 2;  // 0% наверху, по часовой
  const chance = upg.spin ? upg.spin.result.chance : upgChance();

  // Кольцо.
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(255, 255, 255, .07)';
  ctx.stroke();

  // Зелёный сектор шанса.
  ctx.save();
  ctx.shadowColor = 'rgba(69, 212, 131, .6)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(c, c, R, toRad(upg.start), toRad(upg.start + chance));
  ctx.lineWidth = 22;
  const g = ctx.createLinearGradient(0, 0, U_SIZE, U_SIZE);
  g.addColorStop(0, '#8af5b6');
  g.addColorStop(1, '#1f9a55');
  ctx.strokeStyle = g;
  ctx.stroke();
  ctx.restore();
  // Чёткие края зелёной зоны: свечение не должно казаться её частью.
  for (const edge of [upg.start, upg.start + chance]) {
    const ea = toRad(edge);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(ea) * (R - 14), c + Math.sin(ea) * (R - 14));
    ctx.lineTo(c + Math.cos(ea) * (R + 14), c + Math.sin(ea) * (R + 14));
    ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Риски через каждые 5%.
  for (let p = 0; p < 100; p += 5) {
    const a = toRad(p);
    const r1 = R - 18;
    const r2 = R - (p % 25 === 0 ? 30 : 24);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    ctx.strokeStyle = 'rgba(255, 255, 255, .18)';
    ctx.lineWidth = p % 25 === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Шлейф за стрелкой, пока она быстро крутится.
  if (upg.spin) {
    upg.trail.forEach((n, i) => {
      if (Math.abs(n - upg.needle) < 0.5) return;
      const ta = toRad(n);
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(ta) * 50, c + Math.sin(ta) * 50);
      ctx.lineTo(c + Math.cos(ta) * (R + 4), c + Math.sin(ta) * (R + 4));
      ctx.strokeStyle = `rgba(255, 223, 138, ${0.22 * (1 - i / upg.trail.length)})`;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.stroke();
    });
    // Стрелка над зелёным сектором: сектор вспыхивает.
    const rel = (((upg.needle - upg.start) % 100) + 100) % 100;
    if (rel < chance) {
      ctx.save();
      ctx.shadowColor = 'rgba(138, 245, 182, .95)';
      ctx.shadowBlur = 22;
      ctx.beginPath();
      ctx.arc(c, c, R, toRad(upg.start), toRad(upg.start + chance));
      ctx.lineWidth = 22;
      ctx.strokeStyle = 'rgba(138, 245, 182, .35)';
      ctx.stroke();
      ctx.restore();
    }
  }

  // Стрелка.
  const a = toRad(upg.needle);
  const tipX = c + Math.cos(a) * (R + 6);
  const tipY = c + Math.sin(a) * (R + 6);
  ctx.save();
  ctx.shadowColor = 'rgba(242, 193, 78, .9)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(c + Math.cos(a) * 46, c + Math.sin(a) * 46);
  ctx.lineTo(tipX, tipY);
  // После остановки стрелка зелёная (попал) или красная (мимо).
  const needleColor = upg.outcome === 'win' ? '#8af5b6' : upg.outcome === 'lose' ? '#ff7b72' : '#ffdf8a';
  ctx.shadowColor = upg.outcome === 'lose' ? 'rgba(255, 90, 80, .9)' : upg.outcome === 'win' ? 'rgba(69, 212, 131, .9)' : 'rgba(242, 193, 78, .9)';
  ctx.strokeStyle = needleColor;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 6, 0, 2 * Math.PI);
  ctx.fillStyle = upg.outcome ? needleColor : '#fff6d6';
  ctx.fill();
  ctx.restore();
}

function renderUpgradeForm() {
  const chance = upgChance();
  const mult = upgMult(chance);
  $('u-chance-label').textContent = `${chance}%`;
  $('u-chance-big').textContent = `${chance}%`;
  $('u-mult-big').textContent = `×${mult.toFixed(2)}`;
  $('u-mult').textContent = `×${mult.toFixed(2)}`;
  $('u-payout').textContent = Math.floor((upgAmount() * Math.round(mult * 100)) / 100);
  document.querySelectorAll('[data-uc]').forEach((b) => b.classList.toggle('active', Number(b.dataset.uc) === chance));
  if (!upg.spin) {
    upg.outcome = null;
    drawUpgrader();
  }
}

// Баланс придерживаем, пока колесо не остановилось: иначе результат виден раньше стрелки.
function upgradeHoldsBalance(msg) {
  if (!upg.awaiting && !upg.spin) return false;
  upg.pendingBalance = msg;
  return true;
}

// extra: выплата, которую сервер начислит чуть позже (если в задержанном балансе её ещё нет).
function releaseBalance(extra = 0) {
  const msg = upg.pendingBalance;
  upg.pendingBalance = null;
  if (!msg) return;
  const before = upg.base;
  const pre = msg.balance === before - (upg.stake || 0);   // в балансе только списанная ставка
  handlers.balance(extra && pre ? { ...msg, balance: msg.balance + extra } : msg);
}

// Стрелка как настоящая вертушка: случайная раскрутка и трение, риски через 5% отнимают скорость,
// на малой скорости стрелка спотыкается и может отскочить от риски назад.
// Путь просчитывается заранее и чуть растягивается, чтобы закончиться ровно там, где решил сервер.
const UPG_DT = 1 / 240;
function upgSimulate() {
  const w0 = 400 + Math.random() * 180;          // %/с
  const a = 14 + Math.random() * 12;             // постоянное трение
  const b = 0.42 + Math.random() * 0.22;          // трение, растущее со скоростью
  const pegLoss = 1.6 + Math.random() * 1.6;
  const path = [0];
  let th = 0;
  let w = w0;
  for (let i = 0; i < 240 * 12 && w !== 0; i++) {
    const dir = Math.sign(w);
    const nw = w - dir * (a + b * Math.abs(w)) * UPG_DT;
    w = Math.sign(nw) === dir ? nw : 0;
    const before = Math.floor(th / 5);
    th += w * UPG_DT;
    if (Math.floor(th / 5) !== before) {
      const speed = Math.abs(w);
      if (speed < 7 + Math.random() * 5) {
        // Не хватило сил перевалить через риску: отскок назад.
        th = (dir > 0 ? Math.max(before, Math.floor(th / 5)) : Math.min(before, Math.floor(th / 5)) + 1) * 5 - dir * 0.01;
        w = -w * (0.35 + Math.random() * 0.25);
      } else {
        const loss = pegLoss * (1 + Math.random()) * (speed < 60 ? 2.4 : 1);
        w = dir * Math.max(4, speed - loss);
      }
    }
    path.push(th);
  }
  return path;
}

function upgradeFrame() {
  const s = upg.spin;
  if (s) {
    const p = Math.min(1, (performance.now() - s.t0) / s.dur);
    const i = Math.min(s.path.length - 1, Math.floor(p * (s.path.length - 1)));
    const prev = upg.needle;
    upg.needle = s.from + s.path[i] * s.k;
    // Шлейф за быстрой стрелкой.
    upg.trail.unshift(prev);
    if (upg.trail.length > 6) upg.trail.pop();
    // Щелчок на каждой риске, выше тон — выше скорость.
    const peg = Math.floor(upg.needle / 5);
    if (peg !== s.peg) {
      s.peg = peg;
      const t = performance.now();
      if (t - s.clickAt > 28 && soundOn) {
        s.clickAt = t;
        beep([[600 + Math.min(900, Math.abs(upg.needle - prev) * 160), 0.015]], 'square');
      }
    }
    if (!$('upgrade').hidden) drawUpgrader();
    if (p >= 1) finishUpgrade();
  }
  requestAnimationFrame(upgradeFrame);
}
requestAnimationFrame(upgradeFrame);

function finishUpgrade() {
  const r = upg.spin.result;
  upg.spin = null;
  upg.trail = [];
  upg.needle = r.landing;
  upg.outcome = r.win ? 'win' : 'lose';
  releaseBalance(r.payout);
  $('u-go').disabled = false;
  const res = $('u-result');
  if (r.win) {
    res.textContent = `Апгрейд! ${r.amount} → ${r.payout} (+${r.payout - r.amount})`;
    res.className = 'u-result win';
    sounds.win();
    if (r.multiplier >= 5) effects.confetti();
  } else {
    // Насколько стрелка не дотянула до зелёной зоны (с любой стороны).
    const after = (((r.landing - r.start - r.chance) % 100) + 100) % 100;
    const before = (((r.start - r.landing) % 100) + 100) % 100;
    const miss = Math.min(after, before);
    res.textContent = miss < 3 ? `Мимо на ${miss.toFixed(1).replace('.', ',')}%: −${r.amount}` : `Мимо: −${r.amount}`;
    res.className = 'u-result lose';
    sounds.lose();
  }
  $('upgrade').classList.toggle('won', r.win);
  drawUpgrader();
}

function startUpgradeSpin(r) {
  upg.awaiting = false;
  upg.start = r.start;
  upg.outcome = null;
  const from = upg.needle;
  const path = upgSimulate();
  const free = path[path.length - 1];
  // Сколько добавить к свободному пробегу, чтобы встать на точку сервера: от −50 до +50 %.
  let delta = (((r.landing - from - free) % 100) + 100) % 100;
  if (delta >= 50) delta -= 100;
  let total = free + delta;
  if (total < 200) total += 100;
  upg.trail = [];
  upg.spin = {
    from, path, k: total / free, t0: performance.now(),
    // Время как в симуляции (чуть медленнее для драмы), но не дольше, чем крутится колесо на сервере.
    dur: Math.min(r.spinMs - 300, Math.max(1500, path.length * UPG_DT * 1000 * 1.15)),
    result: r, peg: Math.floor(from / 5), clickAt: 0,
  };
  $('u-result').textContent = '';
  $('u-result').className = 'u-result';
  $('upgrade').classList.remove('won');
}

function renderUpgradeFeed(feed) {
  const myId = state.me && state.me.playerId;
  $('u-feed').replaceChildren(...(feed.length ? feed.map((e) => {
    const li = document.createElement('li');
    li.className = e.win ? 'win' : 'lose';
    if (e.playerId === myId) li.classList.add('self');
    li.append(avatarEl(e.name));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'u-what';
    what.textContent = e.win ? `${e.amount} → ${e.payout}` : `${e.amount} ✕`;
    const ch = document.createElement('span');
    ch.className = 'u-ch';
    ch.textContent = `${e.chance}% · ×${e.multiplier.toFixed(2)}`;
    li.append(name, what, ch);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Пока никто не апгрейдился' })]));
}

$('u-chance').addEventListener('input', renderUpgradeForm);
$('u-amount').addEventListener('input', renderUpgradeForm);
document.querySelectorAll('[data-uc]').forEach((b) => b.addEventListener('click', () => {
  $('u-chance').value = b.dataset.uc;
  renderUpgradeForm();
}));
document.querySelectorAll('[data-uq]').forEach((b) => b.addEventListener('click', () => {
  const v = upgAmount();
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.uq];
  $('u-amount').value = Math.max(10, Math.min(next, Math.max(10, state.balance)));
  renderUpgradeForm();
}));
$('u-go').addEventListener('click', async () => {
  if (upg.spin || upg.awaiting) return;
  const chance = upgChance();
  if (!await confirmBet({ key: 'upgrade', game: '⬆️ Апгрейд', amount: upgAmount(), input: $('u-amount'), note: `Шанс ${chance}%, выигрыш ×${upgMult(chance).toFixed(2)}` })) return;
  if (upg.spin || upg.awaiting) return;
  upg.awaiting = true;
  upg.base = state.balance;
  upg.stake = upgAmount();
  $('u-go').disabled = true;
  send({ type: 'upgrade_spin', amount: upg.stake, chance: upgChance() });
});
renderUpgradeForm();

// ---------- Плинко ----------

// Множители как на сервере (server/plinko.js).
const PK_TABLES = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};
const PK_ROW_MS = 170;
const PK_LAND_MS = 450;
const PK_KEY = 'casino.plinko';

const pk = {
  rows: 12,
  risk: 'medium',
  balls: [],            // { path, slot, t0, color, payout, amount, multiplier, landed, mine }
  pegHits: new Map(),   // 'ряд:номер' -> когда задет
  slotHits: new Map(),  // номер лунки -> когда упал шарик
  inFlight: 0,
  auto: null,
  history: [],
  lastTick: 0,
};
try {
  const saved = JSON.parse(storage.get(PK_KEY) || '{}');
  if (PK_TABLES[saved.rows]) pk.rows = saved.rows;
  if (['low', 'medium', 'high'].includes(saved.risk)) pk.risk = saved.risk;
} catch { /* по умолчанию */ }

// Цвет лунки: в центре золотая, к краям — красная.
function pkSlotColor(i, rows) {
  const k = Math.abs(i - rows / 2) / (rows / 2);   // 0 в центре, 1 на краю
  const hue = 48 - 48 * k;
  return `hsl(${hue}, 90%, ${58 - 8 * k}%)`;
}

// Геометрия доски для ширины w: штырьки, лунки, шаг.
function pkGeometry(rows, w) {
  const pad = 14;
  const sx = (w - 2 * pad) / (rows + 2);
  const sy = sx * 0.86;
  const top = sx * 0.9;
  const slotH = Math.max(22, sx * 0.72);
  const h = top + rows * sy + slotH + pad;
  const cx = w / 2;
  return {
    rows, w, h, sx, sy, top, cx, slotH,
    pegR: Math.max(2.2, sx * 0.09),
    ballR: Math.max(4, sx * 0.24),
    rowY: (r) => top + r * sy,
    slotY: top + rows * sy - sy * 0.2,
    slotX: (k) => cx + (k - rows / 2) * sx,
  };
}

// Где шарик в момент t (мс от броска): по рядам, с отскоком от штырька.
function pkBallPos(g, path, t) {
  const rowT = PK_ROW_MS;
  const hop = g.sy * 0.32;
  const xAfter = (r) => g.cx + (path.slice(0, r).reduce((s, b) => s + (b ? 1 : -1), 0) * g.sx) / 2;
  const yAt = (r) => g.rowY(r) - g.pegR - g.ballR;
  if (t < 0) return { x: g.cx, y: yAt(0) - g.sy, row: -1 };
  const r = Math.floor(t / rowT);
  if (r < g.rows) {
    const u = (t - r * rowT) / rowT;
    const x0 = xAfter(r);
    const x1 = xAfter(r + 1);
    const y0 = yAt(r);
    const y1 = r + 1 < g.rows ? yAt(r + 1) : g.slotY;
    return { x: x0 + (x1 - x0) * u, y: y0 + (y1 - y0) * u * u - hop * 4 * u * (1 - u), row: r };
  }
  // В лунке: пара затухающих подскоков.
  const u = Math.min(1, (t - g.rows * rowT) / PK_LAND_MS);
  const bounce = Math.abs(Math.sin(u * Math.PI * 2.5)) * (1 - u) * g.sy * 0.35;
  return { x: xAfter(g.rows), y: g.slotY + g.slotH * 0.35 - bounce, row: g.rows };
}

// Нарисовать доску и шарики. balls: [{ path, t, color }].
function pkDraw(canvas, rows, risk, balls, hits = pk) {
  const w = canvas.clientWidth;
  if (!w) return null;
  const g = pkGeometry(rows, w);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(g.h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(g.h * dpr);
    canvas.style.height = `${g.h}px`;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, g.h);
  const now = performance.now();

  // Штырьки: задетые на миг вспыхивают.
  for (let r = 0; r < rows; r++) {
    const n = r + 3;
    for (let i = 0; i < n; i++) {
      const x = g.cx + (i - (n - 1) / 2) * g.sx;
      const y = g.rowY(r);
      const hitAt = hits.pegHits.get(`${r}:${i}`);
      const glow = hitAt ? Math.max(0, 1 - (now - hitAt) / 300) : 0;
      ctx.beginPath();
      ctx.arc(x, y, g.pegR * (1 + glow * 0.6), 0, 2 * Math.PI);
      ctx.fillStyle = glow ? `rgba(255, 236, 170, ${0.55 + glow * 0.45})` : 'rgba(236, 230, 214, .55)';
      ctx.fill();
    }
  }

  // Лунки с множителями.
  const table = PK_TABLES[rows][risk];
  const fontSize = Math.max(8, Math.min(13, g.sx * 0.36));
  ctx.font = `800 ${fontSize}px Manrope, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  table.forEach((m, k) => {
    const x = g.slotX(k);
    const hitAt = hits.slotHits.get(k);
    const pop = hitAt ? Math.max(0, 1 - (now - hitAt) / 400) : 0;
    const sw = g.sx - 3;
    const sh = g.slotH * (1 - pop * 0.18);
    const y = g.slotY + (g.slotH - sh) + pop * 4;
    ctx.fillStyle = pkSlotColor(k, rows);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - sw / 2, y, sw, sh, 5);
    else ctx.rect(x - sw / 2, y, sw, sh);
    ctx.fill();
    if (pop) {
      ctx.fillStyle = `rgba(255, 255, 255, ${pop * 0.5})`;
      ctx.fill();
    }
    ctx.fillStyle = '#1b1203';
    ctx.fillText(m >= 100 ? String(m) : String(m).replace('.', ','), x, y + sh / 2);
  });

  // Шарики.
  for (const b of balls) {
    const p = pkBallPos(g, b.path, b.t);
    ctx.save();
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 10;
    const grad = ctx.createRadialGradient(p.x - g.ballR * 0.3, p.y - g.ballR * 0.35, 1, p.x, p.y, g.ballR);
    grad.addColorStop(0, '#fff');
    grad.addColorStop(1, b.color);
    ctx.beginPath();
    ctx.arc(p.x, p.y, g.ballR, 0, 2 * Math.PI);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }
  return g;
}

// Отметить штырёк, о который шарик стукнулся в ряду r, и лунку при падении.
function pkTrackHits(b, t, hits, sound) {
  const r = Math.min(b.path.length, Math.floor(t / PK_ROW_MS));
  while (b.seenRow < r) {
    b.seenRow += 1;
    const row = b.seenRow;
    if (row < b.path.length) {
      const offset = b.path.slice(0, row).reduce((s, x) => s + (x ? 1 : -1), 0) / 2;
      hits.pegHits.set(`${row}:${Math.round(offset + (row + 2) / 2)}`, performance.now());
      if (sound && soundOn && performance.now() - pk.lastTick > 30) {
        pk.lastTick = performance.now();
        beep([[700 + row * 35, 0.018]], 'sine');
      }
    } else {
      hits.slotHits.set(b.slot, performance.now());
    }
  }
}

// Ряды и риск можно менять когда угодно: уже брошенные шарики долетят и засчитаются сами.
function pkRenderControls() {
  document.querySelectorAll('[data-rows]').forEach((b) => b.classList.toggle('active', Number(b.dataset.rows) === pk.rows));
  document.querySelectorAll('[data-risk]').forEach((b) => b.classList.toggle('active', b.dataset.risk === pk.risk));
}
function pkSave() {
  storage.set(PK_KEY, JSON.stringify({ rows: pk.rows, risk: pk.risk }));
  pkRenderControls();
}
document.querySelectorAll('[data-rows]').forEach((b) => b.addEventListener('click', () => { pk.rows = Number(b.dataset.rows); pkSave(); }));
document.querySelectorAll('[data-risk]').forEach((b) => b.addEventListener('click', () => { pk.risk = b.dataset.risk; pkSave(); }));
document.querySelectorAll('[data-pq]').forEach((b) => b.addEventListener('click', () => {
  const v = Math.max(1, Math.floor(Number($('pk-amount').value) || 1));
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.pq];
  $('pk-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
}));

function pkAmount() {
  return Math.max(0, Math.floor(Number($('pk-amount').value) || 0));
}
function pkSend() {
  send({ type: 'plinko_drop', amount: pkAmount(), rows: pk.rows, risk: pk.risk });
}
$('pk-drop').addEventListener('click', async () => {
  const amount = pkAmount();
  if (amount < 1) return toast('Ставка — от 1 фишки');
  if (!await confirmBet({ key: 'plinko', game: '🔺 Плинко', amount, input: $('pk-amount'), note: `${pk.rows} рядов, риск ${{ low: 'низкий', medium: 'средний', high: 'высокий' }[pk.risk]}` })) return;
  pkSend();
});
// Пробел: нажал — шарик, зажал — поток шариков, пока держишь (каждые 0,15 с).
const PK_HOLD_MS = 150;
const PK_MAX_FLIGHT = 40;   // как на сервере
let pkHold = null;          // null | 'starting' | id интервала
const pkFlying = () => pk.balls.filter((b) => !b.landed).length;
function pkStopHold() {
  if (pkHold && pkHold !== 'starting') clearInterval(pkHold);
  pkHold = null;
}
document.addEventListener('keydown', async (e) => {
  if (e.code !== 'Space' || $('plinko').hidden || betConfirm) return;
  if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement && document.activeElement.tagName)) return;
  e.preventDefault();
  if (e.repeat || pkHold) return;
  const amount = pkAmount();
  if (amount < 1) return toast('Ставка — от 1 фишки');
  pkHold = 'starting';
  const ok = await confirmBet({ key: 'plinko', game: '🔺 Плинко', amount, input: $('pk-amount'), note: `${pk.rows} рядов, риск ${{ low: 'низкий', medium: 'средний', high: 'высокий' }[pk.risk]}` });
  if (!ok) {
    pkHold = null;
    return;
  }
  pkSend();
  if (pkHold !== 'starting') return;   // отпустил, пока подтверждал: один шарик и всё
  pkHold = setInterval(() => {
    if (state.balance < pkAmount() || $('plinko').hidden) return pkStopHold();
    if (pkFlying() < PK_MAX_FLIGHT) pkSend();
  }, PK_HOLD_MS);
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') pkStopHold();
});
window.addEventListener('blur', pkStopHold);

function pkStopAuto() {
  clearInterval(pk.auto);
  pk.auto = null;
  $('pk-auto').textContent = '▶ Автоброс';
  $('pk-auto').classList.remove('on');
}
$('pk-auto').addEventListener('click', async () => {
  if (pk.auto) return pkStopAuto();
  const amount = pkAmount();
  if (amount < 1) return toast('Ставка — от 1 фишки');
  if (!await confirmBet({ key: 'plinko', game: '🔺 Плинко · автоброс', amount, input: $('pk-amount'), note: 'Четыре шарика в секунду, пока не остановишь' })) return;
  $('pk-auto').textContent = '■ Стоп';
  $('pk-auto').classList.add('on');
  pkSend();
  pk.auto = setInterval(() => {
    if (state.balance < pkAmount() || $('plinko').hidden) return pkStopAuto();
    if (pkFlying() < PK_MAX_FLIGHT) pkSend();
  }, 250);
});

// Сервер прислал путь шарика — бросаем.
function pkAddBall(msg) {
  pk.balls.push({ ...msg, t0: performance.now(), color: '#f2c14e', seenRow: -1, mine: true, landed: false });
  pkRenderControls();
}

function pkLanded(b) {
  b.landed = true;
  const net = b.payout - b.amount;
  pk.history.unshift(b.multiplier);
  if (pk.history.length > 14) pk.history.pop();
  $('pk-strip').replaceChildren(...pk.history.map((m) => {
    const s = document.createElement('span');
    s.textContent = `×${String(m).replace('.', ',')}`;
    s.style.background = pkSlotColor(PK_TABLES[b.rows][b.risk].indexOf(m), b.rows);
    return s;
  }));
  const last = $('pk-last');
  last.textContent = net > 0 ? `×${String(b.multiplier).replace('.', ',')} · +${net}` : `×${String(b.multiplier).replace('.', ',')} · ${net}`;
  last.className = `pk-last ${net > 0 ? 'win' : 'lose'}`;
  if (b.multiplier >= 10) {
    sounds.win();
    if (b.multiplier >= 100) effects.money();
  } else {
    beep([[b.multiplier >= 1 ? 880 : 440, 0.08], [b.multiplier >= 1 ? 1175 : 330, 0.1]], 'triangle');
  }
  pkRenderControls();
}

function pkFrame() {
  if (!$('plinko').hidden) {
    const now = performance.now();
    const total = (rows) => rows * PK_ROW_MS + PK_LAND_MS;
    for (const b of pk.balls) {
      const t = now - b.t0;
      pkTrackHits(b, t, pk, true);
      if (!b.landed && t >= b.rows * PK_ROW_MS) pkLanded(b);
    }
    pk.balls = pk.balls.filter((b) => now - b.t0 < total(b.rows) + 300);
    pkDraw($('pk-canvas'), pk.rows, pk.risk, pk.balls.filter((b) => b.rows === pk.rows).map((b) => ({ path: b.path, t: now - b.t0, color: b.color })));
  } else if (pk.balls.length) {
    // Вкладка не видна: шарики «долетают» без анимации.
    const now = performance.now();
    for (const b of pk.balls) if (!b.landed && now - b.t0 >= b.rows * PK_ROW_MS) pkLanded(b);
    pk.balls = pk.balls.filter((b) => !b.landed);
  }
  requestAnimationFrame(pkFrame);
}
requestAnimationFrame(pkFrame);
pkRenderControls();

function renderPlinkoFeed(feed) {
  const myId = state.me && state.me.playerId;
  $('pk-feed').replaceChildren(...(feed.length ? feed.map((e) => {
    const li = document.createElement('li');
    li.className = e.payout > e.amount ? 'win' : 'lose';
    if (e.playerId === myId) li.classList.add('self');
    li.append(avatarEl(e.name));
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: e.name });
    const what = Object.assign(document.createElement('span'), { className: 'u-what', textContent: `${e.amount} → ${e.payout}` });
    const m = Object.assign(document.createElement('span'), { className: 'u-ch', textContent: `×${String(e.multiplier).replace('.', ',')} · ${e.rows} р.` });
    li.append(name, what, m);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Шарики ещё никто не бросал' })]));
}

// ---------- Мины ----------

const MN_TILES = 25;
const MN_KEY = 'casino.mines.count';
// Как на сервере: честная вероятность минус 1%.
function mnMult(mines, picks) {
  if (picks === 0) return 1;
  let m = 0.99;
  for (let i = 0; i < picks; i++) m *= (MN_TILES - i) / (MN_TILES - mines - i);
  return Math.floor(m * 100) / 100;
}
const mnFmt = (m) => `×${m.toFixed(2).replace('.', ',')}`;

const mn = {
  state: { active: false },
  waiting: null,     // клетка, по которой кликнули и ждём ответа сервера
  lastStatus: null,
  tiles: [],
};

// Поле: 25 клеток.
$('mn-grid').replaceChildren(...Array.from({ length: MN_TILES }, (_, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mn-tile closed';
  b.setAttribute('aria-label', `Клетка ${i + 1}`);
  b.addEventListener('click', () => mnPick(i));
  mn.tiles.push(b);
  return b;
}));

function mnCount() {
  return Math.max(1, Math.min(24, Math.round(Number($('mn-count').value) || 3)));
}
const savedCount = Number(storage.get(MN_KEY));
if (savedCount >= 1 && savedCount <= 24) $('mn-count').value = savedCount;

function mnRenderForm() {
  const s = mn.state;
  const count = s.active ? s.mines : mnCount();
  $('mn-count-label').textContent = count;
  document.querySelectorAll('[data-mc]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.mc) === count);
    b.disabled = s.active;
  });
  $('mn-count').disabled = s.active;
  $('mn-amount').disabled = s.active;
  document.querySelectorAll('[data-mq]').forEach((b) => { b.disabled = s.active; });
  const picks = s.active ? s.revealed.length : 0;
  const mult = mnMult(count, picks);
  $('mn-mult').textContent = mnFmt(mult);
  $('mn-next').textContent = picks < MN_TILES - count ? mnFmt(mnMult(count, picks + 1)) : '—';
  $('mn-payout').textContent = s.active && picks ? Math.floor(s.bet * mult + 1e-9) : '—';
  const go = $('mn-go');
  if (s.active) {
    go.textContent = picks ? `💰 Забрать ${Math.floor(s.bet * mult + 1e-9)}` : '💰 Забрать (открой клетку)';
    go.disabled = !picks || mn.waiting !== null;
  } else {
    go.textContent = '💣 Играть';
    go.disabled = false;
  }
  $('mn-random').hidden = !s.active;
  $('mines').classList.toggle('playing', !!s.active);
}

function mnRenderGrid() {
  const s = mn.state;
  const over = s.status === 'won' || s.status === 'lost';
  const minesAt = new Set(s.minesAt || []);
  mn.tiles.forEach((t, i) => {
    const revealed = (s.revealed || []).includes(i);
    let cls = 'mn-tile';
    let txt = '';
    if (mn.waiting === i) {
      cls += ' closed wait';
    } else if (revealed) {
      cls += ' gem';
      txt = '💎';
    } else if (over && s.boom === i) {
      cls += ' boom';
      txt = '💥';
    } else if (over && minesAt.has(i)) {
      cls += ' mine-dim';
      txt = '💣';
    } else if (over) {
      cls += ' gem-dim';
      txt = '💎';
    } else {
      cls += ' closed';
    }
    // Не перезапускаем анимацию у уже открытых клеток.
    if (t.className !== cls) t.className = cls;
    if (t.textContent !== txt) t.textContent = txt;
    t.disabled = !s.active || revealed || mn.waiting !== null;
  });
}

function mnRender() {
  mnRenderForm();
  mnRenderGrid();
}

function mnPick(i) {
  const s = mn.state;
  if (!s.active || mn.waiting !== null || s.revealed.includes(i)) return;
  mn.waiting = i;
  mnRender();
  send({ type: 'mines_pick', tile: i });
}

$('mn-random').addEventListener('click', () => {
  const s = mn.state;
  if (!s.active) return;
  const free = [...Array(MN_TILES).keys()].filter((i) => !s.revealed.includes(i));
  if (free.length) mnPick(free[Math.floor(Math.random() * free.length)]);
});

$('mn-go').addEventListener('click', async () => {
  const s = mn.state;
  if (s.active) {
    if (s.revealed.length) send({ type: 'mines_cashout' });
    return;
  }
  const amount = Math.max(0, Math.floor(Number($('mn-amount').value) || 0));
  if (amount < 1) return toast('Ставка — от 1 фишки');
  const count = mnCount();
  if (!await confirmBet({ key: 'mines', game: '💣 Мины', amount, input: $('mn-amount'), note: `${count} ${count === 1 ? 'мина' : count < 5 ? 'мины' : 'мин'} на поле` })) return;
  storage.set(MN_KEY, String(count));
  send({ type: 'mines_start', amount, mines: count });
});

$('mn-count').addEventListener('input', mnRenderForm);
document.querySelectorAll('[data-mc]').forEach((b) => b.addEventListener('click', () => {
  $('mn-count').value = b.dataset.mc;
  mnRenderForm();
}));
document.querySelectorAll('[data-mq]').forEach((b) => b.addEventListener('click', () => {
  const v = Math.max(1, Math.floor(Number($('mn-amount').value) || 1));
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.mq];
  $('mn-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
}));

// Ответ сервера: новое состояние игры.
function mnApply(msg) {
  const prev = mn.state;
  mn.state = msg;
  mn.waiting = null;
  const res = $('mn-result');
  if (msg.status === 'playing' && msg.picked !== undefined && msg.revealed.includes(msg.picked)) {
    // Алмаз: тон выше с каждой клеткой.
    beep([[523 * 2 ** (msg.revealed.length / 12), 0.07], [784 * 2 ** (msg.revealed.length / 12), 0.12]], 'triangle');
  }
  if (msg.status === 'playing' && (!prev.active || prev.status !== 'playing')) {
    res.textContent = '';
    res.className = 'u-result';
  }
  if (msg.status === 'lost' && mn.lastStatus === 'playing') {
    beep([[140, 0.18], [70, 0.4]], 'sawtooth');
    $('mines').classList.remove('shake');
    void $('mines').offsetWidth;
    $('mines').classList.add('shake');
    setTimeout(() => $('mines').classList.remove('shake'), 500);
    res.textContent = `💥 Мина! −${msg.bet}`;
    res.className = 'u-result lose';
  }
  if (msg.status === 'won' && mn.lastStatus === 'playing') {
    const mult = mnMult(msg.mines, msg.revealed.length);
    res.textContent = `Забрал ${msg.payout} (${mnFmt(mult)}, +${msg.payout - msg.bet})`;
    res.className = 'u-result win';
    sounds.win();
    if (mult >= 10) effects.confetti();
  }
  mn.lastStatus = msg.status || null;
  mnRender();
}

function renderMinesFeed(feed) {
  const myId = state.me && state.me.playerId;
  $('mn-feed').replaceChildren(...(feed.length ? feed.map((e) => {
    const li = document.createElement('li');
    li.className = e.payout > e.bet ? 'win' : 'lose';
    if (e.playerId === myId) li.classList.add('self');
    li.append(avatarEl(e.name));
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: e.name });
    const what = Object.assign(document.createElement('span'), { className: 'u-what', textContent: e.payout ? `${e.bet} → ${e.payout}` : `${e.bet} 💥` });
    const m = Object.assign(document.createElement('span'), { className: 'u-ch', textContent: `${e.mines} мин · ${e.payout ? mnFmt(e.multiplier) : `на ${e.picks + 1}-й`}` });
    li.append(name, what, m);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'В мины ещё никто не играл' })]));
}
mnRender();

// ---------- Верити ----------

const VT_LINES = {
  idle: [
    'Поставь — и я решу, добрый я сегодня или злой',
    'Ну что, проверим тебя?',
    'Я сегодня в настроении… наверное',
  ],
  think: ['Хм-м…', 'Проверяю тебя…', 'Добрый или злой?..', 'Сейчас решу…'],
  good: [
    'Сегодня я добрый! Держи вдвое больше 😊',
    'Ты мне нравишься — лови фишки!',
    'Проверка пройдена. Удваиваю!',
    'Дождь из фишек для хорошего человека',
    'Удваиваю, не благодари ☺️',
  ],
  evil: [
    'Ням. Было вкусно 😈',
    'Злой Верити голоден!',
    'Хрум-хрум… спасибо за ставку',
    'Проверка не пройдена. Съедено.',
    'Ещё неси, я не наелся',
  ],
};

const vt = { awaiting: false, holding: false, busy: false, pendingBalance: null, idleTimer: null, amount: 0, series: null, sentSeries: null };
const vtPick = (list) => list[Math.floor(Math.random() * list.length)];
const vtSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Квадратичная кривая Безье: t → [x, y].
const vtCurve = (x0, y0, cx, cy, x1, y1) => (t) => [
  (1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1,
  (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1,
];

// Зубы вдоль кривой: зубцы глубиной depth, обратно — по самой кривой, чтобы не залезть на лицо.
function vtTeeth(curve, n, depth, from = 0.06, to = 0.94) {
  const pts = [];
  for (let k = 0; k <= 2 * n; k++) {
    const [x, y] = curve(from + ((to - from) * k) / (2 * n));
    pts.push(`${x.toFixed(1)},${(k % 2 ? y + depth : y).toFixed(1)}`);
  }
  const back = [];
  for (let k = 2 * n; k >= 0; k -= 2) {
    const [x, y] = curve(from + ((to - from) * k) / (2 * n));
    back.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return `M${pts.join(' L')} L${back.join(' L')} Z`;
}

// sfx: суффикс id внутри SVG, чтобы на странице могло быть несколько Верити.
function verityFaceSvg(sfx = '') {
  const grinTop = vtCurve(40, 112, 100, 140, 160, 112);
  const grinBottom = vtCurve(40, 112, 100, 170, 160, 112);
  const maw = (a0, a1, cy = 128) => (t) => {
    const a = Math.PI * (a0 + (a1 - a0) * t);
    return [100 + 50 * Math.cos(a), cy + 38 * Math.sin(a)];
  };
  return `
<svg viewBox="-20 -20 240 240" aria-hidden="true">
  <defs>
    <filter id="vt-felt${sfx}" x="-15%" y="-15%" width="130%" height="130%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="3" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" result="fuzzy"/>
      <feColorMatrix in="noise" type="saturate" values="0" result="gray"/>
      <feComponentTransfer in="gray" result="grain">
        <feFuncR type="linear" slope="0.55" intercept="0.6"/>
        <feFuncG type="linear" slope="0.55" intercept="0.6"/>
        <feFuncB type="linear" slope="0.55" intercept="0.6"/>
        <feFuncA type="linear" slope="0" intercept="1"/>
      </feComponentTransfer>
      <feComposite in="grain" in2="fuzzy" operator="in" result="grainIn"/>
      <feBlend in="fuzzy" in2="grainIn" mode="multiply"/>
    </filter>
    <radialGradient id="vt-yellow${sfx}" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#fff27e"/>
      <stop offset="0.55" stop-color="#f7cf22"/>
      <stop offset="1" stop-color="#cf8e00"/>
    </radialGradient>
    <radialGradient id="vt-red${sfx}" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#ff7a52"/>
      <stop offset="0.55" stop-color="#d42a1c"/>
      <stop offset="1" stop-color="#5e0707"/>
    </radialGradient>
    <linearGradient id="vt-horn${sfx}" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#8f0f12"/>
      <stop offset="1" stop-color="#2a0405"/>
    </linearGradient>
    <clipPath id="vt-open-clip${sfx}"><path d="M48,112 Q100,196 152,112 Z"/></clipPath>
  </defs>
  <g filter="url(#vt-felt${sfx})">
    <g class="vt-horns" fill="url(#vt-horn${sfx})">
      <path d="M46,44 Q20,12 26,-14 Q46,8 72,24 Z"/>
      <path d="M154,44 Q180,12 174,-14 Q154,8 128,24 Z"/>
    </g>
    <circle cx="100" cy="100" r="92" fill="url(#vt-yellow${sfx})"/>
    <circle class="vt-redskin" cx="100" cy="100" r="92" fill="url(#vt-red${sfx})"/>

    <g class="vt-face-good">
      <g class="vt-eyes">
        <ellipse cx="70" cy="80" rx="11" ry="19"/>
        <ellipse cx="130" cy="80" rx="11" ry="19"/>
      </g>
      <g class="vt-eyes-happy" fill="none" stroke="#111" stroke-width="9" stroke-linecap="round">
        <path d="M56,88 Q70,62 84,88"/>
        <path d="M116,88 Q130,62 144,88"/>
      </g>
      <g class="vt-blush" fill="#ff6f7d">
        <ellipse cx="46" cy="118" rx="13" ry="8"/>
        <ellipse cx="154" cy="118" rx="13" ry="8"/>
      </g>
      <path class="vt-smile" d="M42,112 Q100,182 158,112 Q100,150 42,112 Z"/>
      <g class="vt-mouth-open">
        <path d="M48,112 Q100,196 152,112 Z"/>
        <ellipse cx="100" cy="152" rx="24" ry="13" fill="#e2566a" clip-path="url(#vt-open-clip${sfx})"/>
      </g>
    </g>

    <g class="vt-face-evil">
      <g class="vt-brows" fill="none" stroke="#111" stroke-width="10" stroke-linecap="round">
        <path d="M42,56 L94,80"/>
        <path d="M158,56 L106,80"/>
      </g>
      <path d="M52,76 L92,92 Q88,108 70,106 Q54,102 52,76 Z"/>
      <path d="M148,76 L108,92 Q112,108 130,106 Q146,102 148,76 Z"/>
      <g class="vt-glint" fill="#ffd23a">
        <circle cx="74" cy="96" r="4"/>
        <circle cx="126" cy="96" r="4"/>
      </g>
      <g class="vt-grin">
        <path d="M40,112 Q100,170 160,112 Q100,140 40,112 Z"/>
        <path d="${vtTeeth(grinTop, 7, 13)}" fill="#fff4d6"/>
        <path d="${vtTeeth(grinBottom, 5, -9, 0.2, 0.8)}" fill="#fff4d6"/>
      </g>
      <g class="vt-maw">
        <ellipse cx="100" cy="128" rx="50" ry="38"/>
        <ellipse cx="100" cy="146" rx="28" ry="14" fill="#7a1010"/>
        <path d="${vtTeeth(maw(1.06, 1.94), 6, 15, 0, 1)}" fill="#fff4d6"/>
        <path d="${vtTeeth(maw(0.12, 0.88), 5, -12, 0, 1)}" fill="#fff4d6"/>
      </g>
    </g>
  </g>
</svg>`;
}

const vtHero = $('vt-hero');
vtHero.innerHTML = verityFaceSvg();
vtHero.dataset.side = 'good';
const vtSvg = vtHero.querySelector('svg');

function vtAmount() {
  const n = Math.floor(Number($('vt-amount').value));
  return Number.isFinite(n) ? n : 0;
}

function vtSay(text, mood = '') {
  const b = $('vt-bubble');
  b.textContent = text;
  b.className = `vt-bubble ${mood}`;
  b.classList.remove('pop');
  void b.offsetWidth;
  b.classList.add('pop');
}

function vtIdle() {
  if (vt.busy) return;
  vtHero.className = 'vt-hero idle';
  $('verity').classList.remove('evil-mood');
  vtHero.dataset.side = 'good';
  vtSvg.style.transform = '';
  vtSay(vtPick(VT_LINES.idle));
}

// Стопка фишек ставки на столе перед Верити.
const vtChipCount = (amount) => Math.max(2, Math.min(9, Math.round(1 + Math.log10(Math.max(1, amount)) * 1.6)));

function vtChip(i, drop) {
  const c = document.createElement('span');
  c.className = 'vt-chip' + (i % 3 === 1 ? ' alt' : i % 3 === 2 ? ' alt2' : '') + (drop ? ' drop' : '');
  c.style.bottom = `${i * 6}px`;
  if (drop) c.style.animationDelay = `${i * 45}ms`;
  return c;
}

function vtSetPile(amount, { drop = false, extra = 0, mood = '' } = {}) {
  const n = amount ? vtChipCount(amount) + extra : 0;
  const pile = $('vt-pile');
  pile.getAnimations().forEach((a) => a.cancel());
  pile.replaceChildren(...Array.from({ length: n }, (_, i) => vtChip(i, drop)));
  const label = $('vt-pile-label');
  label.textContent = amount ? `${amount}` : '';
  label.className = `vt-pile-label ${mood}`;
}

function vtStagePoint(el, fx, fy) {
  const s = $('vt-stage').getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left + r.width * fx, y: r.top - s.top + r.height * fy };
}

// Подброс монетки: лицевая сторона — добрый, обратная — злой.
function vtToss(good, ms) {
  const halfTurns = (good ? 10 : 9) + 2 * Math.floor(Math.random() * 2);
  const ease = (x) => 1 - (1 - x) ** 3;
  const t0 = performance.now();
  let lastSay = 0;
  return new Promise((resolve) => {
    function frame(now) {
      const p = Math.min(1, (now - t0) / ms);
      const angle = Math.PI * halfTurns * ease(p);
      const cos = Math.cos(angle);
      vtHero.dataset.side = cos >= 0 ? 'good' : 'evil';
      const hop = Math.sin(Math.PI * Math.min(1, p * 1.15)) * 46;
      vtSvg.style.transform = `translateY(${(-hop).toFixed(1)}px) scaleX(${Math.max(0.05, Math.abs(cos)).toFixed(3)})`;
      if (now - lastSay > 900 && p < 0.8) {
        lastSay = now;
        vtSay(vtPick(VT_LINES.think), 'think');
      }
      if (p < 1) requestAnimationFrame(frame);
      else {
        vtSvg.style.transform = '';
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// Добрый: улыбается и осыпает игрока фишками.
async function vtGoodEnding(r) {
  vtHero.className = 'vt-hero happy jump';
  vtSay(vtPick(VT_LINES.good), 'good');
  beep([[784, 0.08], [988, 0.08], [1175, 0.08], [1568, 0.2]], 'triangle');

  const stage = $('vt-stage');
  const target = vtStagePoint($('vt-pile'), 0.5, 0.6);
  const sw = stage.clientWidth;
  const coins = [];
  const count = Math.min(34, 12 + vtChipCount(r.amount) * 3);
  for (let i = 0; i < count; i++) {
    const c = document.createElement('span');
    c.className = 'vt-coin';
    const x0 = Math.random() * sw;
    const y0 = -30 - Math.random() * 60;
    const x1 = target.x + (Math.random() - 0.5) * 80;
    const y1 = target.y + (Math.random() - 0.5) * 20;
    stage.append(c);
    coins.push(c);
    c.animate([
      { transform: `translate(${x0}px, ${y0}px) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${(x0 + x1) / 2}px, ${y1 - 40}px) rotate(${360 + Math.random() * 360}deg)`, opacity: 1, offset: 0.75 },
      { transform: `translate(${x1}px, ${y1}px) rotate(720deg) scale(.6)`, opacity: 0 },
    ], { duration: 650 + Math.random() * 400, delay: i * 28, easing: 'cubic-bezier(.4,.1,.6,1)', fill: 'both' });
  }
  // Стопка растёт по мере того, как падают фишки.
  for (let k = 1; k <= 4; k++) {
    await vtSleep(220);
    beep([[1200 + k * 120, 0.05]], 'triangle');
  }
  vtSetPile(r.amount * 2, { extra: 3, mood: 'good' });
  $('vt-pile').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 350 });
  sounds.win();
  if (r.amount >= 1000) effects.confetti();
  vtShowResult(true, r.amount, r);
  await vtSleep(500);
  coins.forEach((c) => c.remove());
  // Выигрыш уезжает к игроку.
  await $('vt-pile').animate([
    { transform: 'translateY(0)', opacity: 1 },
    { transform: 'translateY(70px) scale(.8)', opacity: 0 },
  ], { duration: 550, easing: 'ease-in', fill: 'forwards' }).finished;
  vtSetPile(0);
  vtHero.classList.remove('jump');
}

// Злой: раскрывает пасть и съедает ставку.
async function vtEvilEnding(r) {
  vtHero.className = 'vt-hero grin';
  $('verity').classList.add('evil-mood');
  vtSay(vtPick(VT_LINES.evil), 'evil');
  beep([[330, 0.12], [294, 0.12], [262, 0.12], [196, 0.3]], 'sawtooth');
  await vtSleep(400);
  vtHero.classList.add('eat');
  await vtSleep(220);
  vtHero.classList.add('chomp');

  const stage = $('vt-stage');
  const mouth = vtStagePoint(vtHero, 0.5, 0.6);
  const chips = [...$('vt-pile').children].reverse();
  $('vt-pile-label').classList.add('gone');
  const flights = chips.map((chip, i) => {
    const from = vtStagePoint(chip, 0, 0);
    const fly = chip.cloneNode();
    fly.classList.remove('drop');
    fly.classList.add('fly');
    fly.style.bottom = '';
    stage.append(fly);
    chip.style.visibility = 'hidden';
    const mid = { x: (from.x + mouth.x) / 2 + (Math.random() - 0.5) * 60, y: Math.min(from.y, mouth.y) - 40 };
    return fly.animate([
      { transform: `translate(${from.x}px, ${from.y}px) rotate(0)`, opacity: 1 },
      { transform: `translate(${mid.x}px, ${mid.y}px) rotate(200deg) scale(.9)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${mouth.x - 17}px, ${mouth.y - 8}px) rotate(420deg) scale(.25)`, opacity: 0 },
    ], { duration: 520, delay: i * 110, easing: 'cubic-bezier(.5,0,.7,1)', fill: 'both' }).finished.then(() => {
      fly.remove();
      beep([[95 + Math.random() * 40, 0.07]], 'square');
    });
  });
  await Promise.all(flights);
  vtSetPile(0);
  await vtSleep(260);
  vtHero.classList.remove('chomp', 'eat');
  vtHero.classList.add('burp');
  sounds.lose();
  vtShowResult(false, r.amount, r);
  await vtSleep(700);
  vtHero.classList.remove('burp');
}

function vtShowResult(good, amount, r = {}) {
  vt.holding = false;
  const msg = vt.pendingBalance;
  vt.pendingBalance = null;
  // Сервер начислит выигрыш, когда Верити объявит решение для всех; игрок видит его уже сейчас.
  const pre = msg && msg.balance === vt.base - amount;
  if (msg) handlers.balance(good && pre ? { ...msg, balance: msg.balance + 2 * amount } : msg);
  const res = $('vt-result');
  const streak = r.streak || 1;
  if (good && streak > 1) res.textContent = `🔥 Серия ×${2 ** streak}: ${r.base.toLocaleString('ru-RU')} → ${(2 * amount).toLocaleString('ru-RU')}`;
  else if (!good && streak > 1) res.textContent = `Злой Верити оборвал серию ×${2 ** (streak - 1)} и съел ${amount.toLocaleString('ru-RU')}`;
  else res.textContent = good ? `Добрый Верити: +${amount}` : `Злой Верити съел ${amount}`;
  res.className = `u-result ${good ? 'win' : 'lose'}`;
  // Серия: после победы можно поставить весь выигрыш ещё раз.
  vt.series = good ? { base: r.base || amount, streak, next: 2 * amount } : null;
  renderVtSeries();
}

const vtFmt = (n) => n.toLocaleString('ru-RU');
function renderVtSeries() {
  const s = vt.series;
  $('vt-series').hidden = !s || vt.busy || vt.awaiting;
  if (!s) return;
  const steps = Math.max(6, s.streak + 2);
  $('vt-ladder').replaceChildren(...Array.from({ length: steps }, (_, i) => {
    const k = i + 1;
    const el = document.createElement('span');
    el.textContent = `×${2 ** k}`;
    el.className = k < s.streak ? 'done' : k === s.streak ? 'now' : k === s.streak + 1 ? 'next' : '';
    return el;
  }));
  const go = $('vt-series-go');
  go.textContent = `🔥 Поставить ${vtFmt(s.next)} → ${vtFmt(2 * s.next)} (×${2 ** (s.streak + 1)})`;
  go.disabled = s.next > state.balance;
  $('vt-series-take').textContent = `Забрать ${vtFmt(s.next)}`;
}

function verityHoldsBalance(msg) {
  if (!vt.awaiting && !vt.holding) return false;
  vt.pendingBalance = msg;
  return true;
}

async function startVerity(r) {
  vt.awaiting = false;
  vt.holding = true;
  vt.busy = true;
  vt.sentSeries = null;
  renderVtSeries();
  clearTimeout(vt.idleTimer);
  $('vt-result').textContent = '';
  $('vt-result').className = 'u-result';
  vtHero.className = 'vt-hero toss';
  $('verity').classList.remove('evil-mood');
  vtSetPile(r.amount, { drop: true });
  vtSay(vtPick(VT_LINES.think), 'think');
  // Вкладка в фоне не рисует кадры — баланс всё равно не должен зависнуть.
  const guard = setTimeout(() => { if (vt.holding) vtShowResult(r.good, r.amount, r); }, r.spinMs + 4000);
  try {
    await vtToss(r.good, Math.max(1600, r.spinMs - 2700));
    if (r.good) await vtGoodEnding(r);
    else await vtEvilEnding(r);
  } finally {
    clearTimeout(guard);
    if (vt.holding) vtShowResult(r.good, r.amount, r);
    vt.busy = false;
    $('vt-go').disabled = false;
    renderVtSeries();
    if (r.good && r.streak > 1) vtSay(`Серия ×${2 ** r.streak}! Рискнёшь ещё раз? 😏`, 'good');
    vt.idleTimer = setTimeout(vtIdle, 7000);
  }
}

function vtCancelPending() {
  if (!vt.awaiting) return;
  vt.awaiting = false;
  $('vt-go').disabled = false;
  // Сервер не принял продолжение серии — серия остаётся, можно попробовать ещё.
  if (vt.sentSeries) vt.series = vt.sentSeries;
  vt.sentSeries = null;
  renderVtSeries();
  vtSetPile(0);
  const msg = vt.pendingBalance;
  vt.pendingBalance = null;
  if (msg) handlers.balance(msg);
}

function renderVerityFeed(feed) {
  const myId = state.me && state.me.playerId;
  $('vt-strip').replaceChildren(...feed.map((e) => {
    const s = document.createElement('span');
    s.className = e.good ? 'vt-g' : 'vt-e';
    s.textContent = e.good ? '😊' : '😈';
    s.title = `${e.name}: ${e.good ? '+' : '−'}${e.amount}`;
    return s;
  }));
  $('vt-feed').replaceChildren(...(feed.length ? feed.map((e) => {
    const li = document.createElement('li');
    li.className = e.good ? 'win' : 'lose';
    if (e.playerId === myId) li.classList.add('self');
    li.append(avatarEl(e.name));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'u-what';
    what.textContent = e.good ? `+${e.amount}` : `−${e.amount}`;
    const who = document.createElement('span');
    who.className = 'u-ch';
    const streak = e.streak || 1;
    who.textContent = e.good ? (streak > 1 ? `🔥 серия ×${2 ** streak}` : '😊 добрый') : (streak > 1 ? `😈 оборвал ×${2 ** (streak - 1)}` : '😈 злой');
    li.append(name, what, who);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Верити пока никого не проверял' })]));
}

document.querySelectorAll('[data-vq]').forEach((b) => b.addEventListener('click', () => {
  const v = Math.max(1, vtAmount());
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.vq];
  $('vt-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
}));
$('vt-go').addEventListener('click', async () => {
  if (vt.busy || vt.awaiting) return;
  const amount = vtAmount();
  if (amount < 1) return toast('Ставка — от 1 фишки');
  if (amount > state.balance) return toast('Не хватает фишек');
  if (!await confirmBet({ key: 'verity', game: '😊 Верити', amount, input: $('vt-amount'), note: 'Добрый удвоит, злой съест' })) return;
  if (vt.busy || vt.awaiting) return;
  vt.awaiting = true;
  vt.base = state.balance;
  vt.series = null;
  renderVtSeries();
  $('vt-go').disabled = true;
  send({ type: 'verity_play', amount });
});

$('vt-series-go').addEventListener('click', () => {
  const s = vt.series;
  if (!s || vt.busy || vt.awaiting) return;
  if (s.next > state.balance) return toast('Не хватает фишек');
  vt.awaiting = true;
  vt.base = state.balance;
  vt.sentSeries = s;
  vt.series = null;
  renderVtSeries();
  $('vt-go').disabled = true;
  send({ type: 'verity_play', series: true, amount: s.next });
});
$('vt-series-take').addEventListener('click', () => {
  if (!vt.series) return;
  const { next } = vt.series;
  vt.series = null;
  renderVtSeries();
  vtSay(`Мудро. ${vtFmt(next)} — твои 😊`, 'good');
});
renderVerityFeed([]);

// ---------- Дуэль на везение ----------

const DV_GAMES = {
  crash: { icon: '📈', name: 'Краш', rule: 'У каждого своя ракета. Чья улетит выше — тот забирает банк.' },
  roulette: { icon: '🎡', name: 'Рулетка', rule: 'У каждого своё колесо. У кого выпадет число больше — тот забирает банк.' },
  wheel: { icon: '🎰', name: 'Колесо', rule: 'У каждого своё колесо фортуны. Чей сектор дороже — тот забирает банк (череп дешевле всех).' },
  upgrade: { icon: '⬆️', name: 'Апгрейд', rule: 'Одно колесо, две стрелки. Чья встанет ближе к центру зелёной зоны — тот забирает банк.' },
  verity: { icon: '😊', name: 'Верити', rule: 'Верити проверяет обоих. Кого признает добрым, а соперника злым — тот забирает банк.' },
  plinko: { icon: '🔺', name: 'Плинко', rule: 'Два шарика на одной доске: 12 рядов, высокий риск. У чьего множитель больше — тот забирает банк.' },
};
// Как на сервере (server/duel.js).
const DV_CRASH_GROWTH = 0.18;
const DV_ROULETTE_SPIN_MS = 7000;
const DV_WHEEL_SPIN_MS = 7000;
const DV_UPGRADE_SPIN_MS = 4500;
const DV_VERITY_ROUND_MS = 2400;
const DV_REVEAL_PAD_MS = 1200;
const DV_COLORS = ['#f2c14e', '#5ec8ff'];
const DV_GAME_KEY = 'casino.duel.game';

const dv = {
  view: null,
  game: DV_GAMES[storage.get(DV_GAME_KEY)] ? storage.get(DV_GAME_KEY) : 'crash',
  watching: null,      // id дуэли на экране
  t0: new Map(),       // id дуэли -> когда (по performance.now) она началась
  stage: null,         // { id, game, ... } — построенная сцена
  seenInvites: new Set(),
  lastMine: null,
};

const dvUpgradeScore = (landing, start, chance) => {
  const d = (((landing - start) % 100) + 100) % 100;
  return d < chance ? Math.min(d, chance - d) : -Math.min(d - chance, 100 - d);
};

// Кто победил: 0 или 1 (как на сервере).
function dvWinner(d) {
  const x = d.data;
  if (d.game === 'crash') return x.crash[0] > x.crash[1] ? 0 : 1;
  if (d.game === 'roulette') return x.numbers[0] > x.numbers[1] ? 0 : 1;
  if (d.game === 'wheel') return FP.WHEEL[x.segments[0]] > FP.WHEEL[x.segments[1]] ? 0 : 1;
  if (d.game === 'upgrade') return dvUpgradeScore(x.landings[0], x.start, x.chance) > dvUpgradeScore(x.landings[1], x.start, x.chance) ? 0 : 1;
  if (d.game === 'plinko') return x.multipliers[0] > x.multipliers[1] ? 0 : 1;
  return x.rounds.at(-1)[0] ? 0 : 1;
}

const dvMyIndex = (d) => (state.me ? d.players.findIndex((p) => p.id === state.me.playerId) : -1);
const dvFind = (id) => (dv.view ? dv.view.duels.find((d) => d.id === id) : null);
const dvTime = (d) => performance.now() - dv.t0.get(d.id);
const dvAnimEnd = (d) => d.duration - DV_REVEAL_PAD_MS;

// ----- Лобби -----

function dvRenderGames() {
  document.querySelectorAll('[data-dg]').forEach((b) => b.classList.toggle('active', b.dataset.dg === dv.game));
}
document.querySelectorAll('[data-dg]').forEach((b) => b.addEventListener('click', () => {
  dv.game = b.dataset.dg;
  storage.set(DV_GAME_KEY, dv.game);
  dvRenderGames();
}));
dvRenderGames();

document.querySelectorAll('[data-dq]').forEach((b) => b.addEventListener('click', () => {
  const v = Math.max(0, Math.floor(Number($('dv-stake').value) || 0));
  const next = { half: Math.floor(v / 2), double: Math.max(10, v * 2), max: state.balance }[b.dataset.dq];
  $('dv-stake').value = Math.max(0, Math.min(next, state.balance));
}));

$('dv-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const toId = $('dv-opponent').value;
  if (!toId) return toast('Вызвать некого: никого нет онлайн');
  const stake = Math.max(0, Math.floor(Number($('dv-stake').value) || 0));
  const opp = $('dv-opponent').selectedOptions[0];
  confirmBet({
    key: 'duel', game: `⚔️ Дуэль · ${DV_GAMES[dv.game].name}`, amount: stake, input: $('dv-stake'),
    note: `Вызов ${opp ? opp.textContent : 'сопернику'}: ставка спишется, когда он примет`,
  }).then((ok) => ok && send({ type: 'duel_invite', toId, game: dv.game, stake }));
});

function dvRenderLobby() {
  const v = dv.view;
  const myId = state.me && state.me.playerId;
  const sel = $('dv-opponent');
  const cur = sel.value;
  const people = (state.onlinePlayers || []).filter((p) => p.id !== myId);
  sel.replaceChildren(...(people.length ? people.map((p) => Object.assign(document.createElement('option'), { value: p.id, textContent: p.name }))
    : [Object.assign(document.createElement('option'), { value: '', textContent: 'никого нет онлайн' })]));
  if (people.some((p) => p.id === cur)) sel.value = cur;
  if (!v) return;

  const g = (game) => `${DV_GAMES[game].icon} ${DV_GAMES[game].name}`;
  const stakeText = (s) => (s ? ` · по ${s} 🪙` : ' · без ставки');
  const out = v.inviteOut;
  $('dv-out').replaceChildren(...(out ? [plInviteRow(`Ждём ответа: ${out.toName} · ${g(out.game)}${stakeText(out.stake)}`,
    [['Отменить', 'ghost', () => send({ type: 'duel_cancel' })]])] : []));
  $('dv-in').replaceChildren(...v.invitesIn.map((i) => plInviteRow(`${i.fromName} вызывает: ${g(i.game)}${stakeText(i.stake)}`, [
    ['Принять', '', () => send({ type: 'duel_accept', inviteId: i.id })],
    ['Отказ', 'ghost', () => send({ type: 'duel_decline', inviteId: i.id })],
  ])));

  const live = v.duels.filter((d) => d.phase === 'playing');
  $('dv-live').replaceChildren(...(live.length ? live.map((d) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${d.players[0].name} ⚔️ ${d.players[1].name} · ${g(d.game)}${d.stake ? ` · ${d.stake}` : ''}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.textContent = dvMyIndex(d) >= 0 ? 'Вернуться' : 'Смотреть';
    b.addEventListener('click', () => {
      dv.watching = d.id;
      dvRender();
    });
    li.append(name, b);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Сейчас никто не дерётся' })]));

  $('dv-history').replaceChildren(...(v.history.length ? v.history.map((h) => {
    const li = document.createElement('li');
    li.append(avatarEl(h.winner.name));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${h.winner.name} обыграл ${h.loser.name}`;
    const game = document.createElement('span');
    game.className = 'dv-h-game';
    game.textContent = `${g(h.game)}${h.stake ? ` · +${h.stake}` : ''}`;
    li.append(name, game);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Дуэлей ещё не было' })]));
}

// Вызов во всплывашке — видно на любой вкладке.
function dvRenderPopup() {
  const v = dv.view;
  const inv = v.invitesIn[0];
  const busy = v.duels.some((d) => d.phase === 'playing' && dvMyIndex(d) >= 0);
  $('dv-popup').hidden = !inv || busy;
  $('duel-dot').hidden = !inv;
  if (!inv) return;
  $('dv-popup-from').textContent = inv.fromName;
  $('dv-popup-what').textContent = `${DV_GAMES[inv.game].icon} ${DV_GAMES[inv.game].name}${inv.stake ? `, по ${inv.stake} 🪙` : ', без ставки'}`;
  $('dv-popup').dataset.id = inv.id;
  if (!dv.seenInvites.has(inv.id)) {
    dv.seenInvites.add(inv.id);
    beep([[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.16]], 'square');
  }
}
$('dv-popup-accept').addEventListener('click', () => send({ type: 'duel_accept', inviteId: $('dv-popup').dataset.id }));
$('dv-popup-decline').addEventListener('click', () => send({ type: 'duel_decline', inviteId: $('dv-popup').dataset.id }));

// ----- Экран дуэли -----

function dvPlayerBox(el, d, i) {
  const p = d.players[i];
  el.style.setProperty('--pc', DV_COLORS[i]);
  const box = document.createElement('div');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = p.name;
  const tag = document.createElement('span');
  tag.className = 'dv-tag';
  tag.textContent = dvMyIndex(d) === i ? 'это ты' : '';
  box.append(name, tag);
  el.replaceChildren(avatarEl(p.name), box);
  el.classList.remove('win', 'lose');
}

function dvBuildStage(d) {
  const stage = $('dv-stage');
  stage.replaceChildren();
  const s = { id: d.id, game: d.game, done: false };
  if (d.game === 'crash') {
    s.canvas = Object.assign(document.createElement('canvas'), { className: 'dv-crash-canvas' });
    stage.append(s.canvas);
  } else if (d.game === 'roulette') {
    s.cols = d.players.map((p, i) => {
      const col = document.createElement('div');
      col.className = 'dv-col';
      col.style.setProperty('--pc', DV_COLORS[i]);
      const canvas = document.createElement('canvas');
      const num = document.createElement('div');
      num.className = `dv-num ${rColor(d.data.numbers[i])}`;
      num.textContent = d.data.numbers[i];
      const name = Object.assign(document.createElement('div'), { className: 'dv-col-name', textContent: p.name });
      col.append(name, canvas, num);
      stage.append(col);
      // Свой бросок у каждого: зерно из номера дуэли.
      const sim = RPH.spin({ seed: Number(d.id) * 7919 + i * 104729 + 1, rotation: i * 1.3, slot: R_WHEEL.indexOf(d.data.numbers[i]), spinMs: DV_ROULETTE_SPIN_MS });
      return { canvas, num, sim, rotation: i * 1.3 };
    });
  } else if (d.game === 'wheel') {
    s.cols = d.players.map((p, i) => {
      const col = document.createElement('div');
      col.className = 'dv-col';
      col.style.setProperty('--pc', DV_COLORS[i]);
      const canvas = document.createElement('canvas');
      const mult = FP.WHEEL[d.data.segments[i]];
      const num = Object.assign(document.createElement('div'), { className: `dv-num m${mult}`, textContent: fwLabel(mult) });
      const name = Object.assign(document.createElement('div'), { className: 'dv-col-name', textContent: p.name });
      col.append(name, canvas, num);
      stage.append(col);
      // Своё вращение у каждого: зерно из номера дуэли.
      const rotation = i * 1.1;
      const sim = FP.spin({ seed: Number(d.id) * 7919 + i * 104729 + 3, rotation, segment: d.data.segments[i], spinMs: DV_WHEEL_SPIN_MS });
      return { canvas, num, sim, flap: { flap: 0, flapV: 0, dir: 1, prevRot: rotation }, rotation, lastAt: 0 };
    });
  } else if (d.game === 'upgrade') {
    s.canvas = Object.assign(document.createElement('canvas'), { className: 'dv-up-canvas' });
    const legend = document.createElement('div');
    legend.className = 'dv-up-legend';
    s.legend = d.players.map((p, i) => {
      const row = document.createElement('div');
      const dot = document.createElement('i');
      dot.style.background = DV_COLORS[i];
      const name = Object.assign(document.createElement('b'), { textContent: p.name });
      const res = document.createElement('span');
      row.append(dot, name, res);
      legend.append(row);
      return res;
    });
    stage.append(s.canvas, legend);
    // Путь каждой стрелки — физика вертушки, растянутая, чтобы встать на точку сервера.
    s.needles = d.data.landings.map((landing) => {
      const path = upgSimulate();
      const free = path[path.length - 1];
      let delta = (((landing - free) % 100) + 100) % 100;
      if (delta >= 50) delta -= 100;
      let total = free + delta;
      if (total < 200) total += 100;
      return { path, k: total / free };
    });
  } else if (d.game === 'plinko') {
    s.canvas = Object.assign(document.createElement('canvas'), { className: 'dv-pk-canvas' });
    const legend = document.createElement('div');
    legend.className = 'dv-up-legend';
    s.legend = d.players.map((p, i) => {
      const row = document.createElement('div');
      const dot = document.createElement('i');
      dot.style.background = DV_COLORS[i];
      row.append(dot, Object.assign(document.createElement('b'), { textContent: p.name }));
      const res = document.createElement('span');
      row.append(res);
      legend.append(row);
      return res;
    });
    stage.append(s.canvas, legend);
    s.hits = { pegHits: new Map(), slotHits: new Map() };
    s.balls = d.data.paths.map((path, i) => ({
      path, slot: path.reduce((a, b) => a + b, 0), delay: i * 400, seenRow: -1, color: DV_COLORS[i], landed: false,
    }));
  } else {
    s.faces = d.players.map((p, i) => {
      const col = document.createElement('div');
      col.className = 'dv-col';
      col.style.setProperty('--pc', DV_COLORS[i]);
      const face = document.createElement('div');
      face.className = 'vt-hero dv-face';
      face.innerHTML = verityFaceSvg(`-dv${i}`);
      face.dataset.side = 'good';
      const rounds = document.createElement('div');
      rounds.className = 'dv-rounds';
      const name = Object.assign(document.createElement('div'), { className: 'dv-col-name', textContent: p.name });
      col.append(name, face, rounds);
      stage.append(col);
      return { face, rounds };
    });
    s.msg = Object.assign(document.createElement('div'), { className: 'dv-verity-msg' });
    stage.append(s.msg);
    s.round = -1;
    s.revealed = -1;
  }
  dv.stage = s;
}

function dvRender() {
  const v = dv.view;
  if (!v) return;
  dvRenderPopup();
  let d = dv.watching ? dvFind(dv.watching) : null;
  if (!d) dv.watching = null;
  $('dv-lobby').hidden = !!d;
  $('dv-match').hidden = !d;
  if (!d) {
    dv.stage = null;
    dvRenderLobby();
    return;
  }
  if (!dv.stage || dv.stage.id !== d.id) {
    dvPlayerBox($('dv-p0'), d, 0);
    dvPlayerBox($('dv-p1'), d, 1);
    $('dv-game-name').textContent = `${DV_GAMES[d.game].icon} ${DV_GAMES[d.game].name}`;
    $('dv-bank').textContent = d.stake ? `банк ${2 * d.stake} 🪙` : 'без ставки';
    $('dv-rule').textContent = DV_GAMES[d.game].rule;
    $('dv-result').textContent = '';
    $('dv-result').className = 'dv-result';
    $('dv-rematch').hidden = true;
    dvBuildStage(d);
  }
}

// ----- Анимации -----

function dvCanvas(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

function dvDrawCrash(s, d, t) {
  const w = s.canvas.clientWidth;
  const h = s.canvas.clientHeight;
  if (!w) return;
  const ctx = dvCanvas(s.canvas, w, h);
  const tc = d.data.crash.map((c) => Math.log(c / 100) / DV_CRASH_GROWTH);
  const tNow = Math.min(t / 1000, Math.max(...tc));
  const mNow = Math.exp(DV_CRASH_GROWTH * tNow);
  const tMax = Math.max(4, tNow * 1.1);
  const mMax = Math.max(2, mNow * 1.15);
  const pad = 34;
  const x = (tt) => pad + ((w - 2 * pad) * tt) / tMax;
  const yBase = (m) => h - pad - ((h - 2 * pad) * (m - 1)) / (mMax - 1);
  d.players.forEach((p, i) => {
    // Кривые одинаковые, поэтому ракеты летят по своим дорожкам: чуть выше и чуть ниже.
    const y = (m) => yBase(m) + (i === 0 ? -5 : 5);
    const tEnd = Math.min(tNow, tc[i]);
    const crashed = tNow >= tc[i];
    const color = DV_COLORS[i];
    ctx.beginPath();
    ctx.moveTo(x(0), y(1));
    for (let k = 1; k <= 60; k++) {
      const tt = (tEnd * k) / 60;
      ctx.lineTo(x(tt), y(Math.exp(DV_CRASH_GROWTH * tt)));
    }
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.globalAlpha = crashed && tNow > tc[i] + 0.4 ? 0.55 : 1;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();
    const m = Math.exp(DV_CRASH_GROWTH * tEnd);
    const tx = x(tEnd);
    const ty = y(m);
    ctx.font = `${crashed ? 30 : 24}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(crashed ? '💥' : '🚀', tx, ty);
    ctx.font = '700 15px Unbounded, Manrope, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = tx > w - 120 ? 'right' : 'left';
    ctx.fillText(`${p.name} ×${m.toFixed(2)}`, tx + (tx > w - 120 ? -20 : 20), ty + (i === 0 ? -18 : 18));
  });
  // Щелчок взрыва в момент краша.
  s.boomed = s.boomed || [false, false];
  tc.forEach((tt, i) => {
    if (!s.boomed[i] && tNow >= tt) {
      s.boomed[i] = true;
      if (t / 1000 - tt < 1) beep([[110, 0.25]], 'sawtooth');
    }
  });
  ctx.font = '700 40px Unbounded, Manrope, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255, 255, 255, .9)';
  ctx.fillText(`×${mNow.toFixed(2)}`, w / 2, 12);
}

// Колесо рулетки в любом холсте (те же слои, что у большой рулетки).
function dvDrawWheel(canvas, size, rotation, ball) {
  const dpr = window.devicePixelRatio || 1;
  const px = Math.round(size * dpr);
  if (canvas.width !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  ctx.drawImage(wheelBase, 0, 0, px, px);
  ctx.save();
  ctx.translate(px / 2, px / 2);
  ctx.rotate(rotation);
  ctx.drawImage(wheelDisk, -px / 2, -px / 2, px, px);
  ctx.restore();
  if (!ball) return;
  const k = px / W_SIZE;
  const bx = px / 2 + Math.cos(ball.angle) * ball.r * k;
  const by = px / 2 + Math.sin(ball.angle) * ball.r * k;
  const g = ctx.createRadialGradient(bx - 2 * k, by - 2.5 * k, 0.5 * k, bx, by, BALL_R * k);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#e9e9e9');
  g.addColorStop(1, '#9a9a9a');
  ctx.beginPath();
  ctx.arc(bx, by, BALL_R * k, 0, 2 * Math.PI);
  ctx.fillStyle = g;
  ctx.fill();
}

function dvDrawRoulette(s, d, t) {
  s.cols.forEach((c, i) => {
    const size = c.canvas.clientWidth || 200;
    const tSim = Math.min(t / 1000, DV_ROULETTE_SPIN_MS / 1000) * c.sim.scale;
    const f = c.sim.frames[Math.min(c.sim.frames.length - 1, Math.floor(tSim / c.sim.frameDt))];
    dvDrawWheel(c.canvas, size, f[2], { angle: f[0], r: f[1] });
    if (t >= DV_ROULETTE_SPIN_MS * 0.9 && !c.num.classList.contains('show')) c.num.classList.add('show');
  });
}

function dvDrawFortune(s, d, t) {
  const now = performance.now();
  const stopped = t >= DV_WHEEL_SPIN_MS * FP.SETTLE_SHARE;
  s.cols.forEach((c) => {
    const f = c.sim.frames[Math.min(c.sim.frames.length - 1, Math.floor((Math.min(t, DV_WHEEL_SPIN_MS) / 1000) * c.sim.scale / c.sim.frameDt))];
    const dt = c.lastAt ? Math.min(0.05, (now - c.lastAt) / 1000) : 0;
    c.lastAt = now;
    if (FP.segmentAt(f) !== FP.segmentAt(c.rotation) && now - fw.lastTickAt > 28) {
      fw.lastTickAt = now;
      if (soundOn) beep([[1700 + Math.random() * 500, 0.012]], 'square');
    }
    c.rotation = f;
    fwFlapStep(c.flap, f, dt);
    fwDraw(c.canvas, c.canvas.clientWidth || 200, f, c.flap.flap, { time: now / 1000, lights: stopped ? 'idle' : 'spin', highlight: stopped });
    if (stopped && !c.num.classList.contains('show')) c.num.classList.add('show');
  });
}

function dvDrawUpgrade(s, d, t) {
  const size = s.canvas.clientWidth || 280;
  const ctx = dvCanvas(s.canvas, size, size);
  const c = size / 2;
  const R = c - 24;
  const toRad = (p) => (p / 100) * 2 * Math.PI - Math.PI / 2;
  const { start, chance } = d.data;
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(255, 255, 255, .07)';
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = 'rgba(69, 212, 131, .6)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(c, c, R, toRad(start), toRad(start + chance));
  ctx.strokeStyle = '#45d483';
  ctx.stroke();
  ctx.restore();
  // Центр зелёной зоны — туда целимся.
  const mid = toRad(start + chance / 2);
  ctx.beginPath();
  ctx.moveTo(c + Math.cos(mid) * (R - 14), c + Math.sin(mid) * (R - 14));
  ctx.lineTo(c + Math.cos(mid) * (R + 14), c + Math.sin(mid) * (R + 14));
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 3;
  ctx.stroke();
  const p = Math.min(1, t / (DV_UPGRADE_SPIN_MS - 300));
  s.needles.forEach((n, i) => {
    const pos = n.path[Math.min(n.path.length - 1, Math.floor(p * (n.path.length - 1)))] * n.k;
    const a = toRad(pos);
    const len = R + (i === 0 ? 4 : -10);
    ctx.save();
    ctx.shadowColor = DV_COLORS[i];
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * 40, c + Math.sin(a) * 40);
    ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    ctx.strokeStyle = DV_COLORS[i];
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * len, c + Math.sin(a) * len, 6, 0, 2 * Math.PI);
    ctx.fillStyle = DV_COLORS[i];
    ctx.fill();
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(c, c, 34, 0, 2 * Math.PI);
  ctx.fillStyle = '#0d1a13';
  ctx.fill();
  ctx.font = '700 16px Unbounded, Manrope, sans-serif';
  ctx.fillStyle = '#45d483';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${chance}%`, c, c);
  if (p >= 1 && !s.legendShown) {
    s.legendShown = true;
    d.data.landings.forEach((l, i) => {
      const score = dvUpgradeScore(l, start, chance);
      s.legend[i].textContent = score >= 0 ? `в зоне, до края ${score.toFixed(1).replace('.', ',')}%` : `мимо на ${(-score).toFixed(1).replace('.', ',')}%`;
    });
  }
}

function dvDrawVerity(s, d, t) {
  const rounds = d.data.rounds;
  const r = Math.min(rounds.length - 1, Math.floor(t / DV_VERITY_ROUND_MS));
  const inRound = t - r * DV_VERITY_ROUND_MS;
  if (r !== s.round) {
    s.round = r;
    s.faces.forEach((f) => {
      f.face.className = 'vt-hero dv-face dv-toss';
      void f.face.offsetWidth;
    });
    s.msg.textContent = rounds.length > 1 ? `Раунд ${r + 1}: Верити проверяет…` : 'Верити проверяет…';
    beep([[300, 0.04], [420, 0.04]], 'square');
  }
  if (inRound < 1400) {
    // Пока монетка крутится, лицо мелькает.
    const side = Math.floor(inRound / 140) % 2 ? 'evil' : 'good';
    s.faces.forEach((f, i) => { f.face.dataset.side = i ? (side === 'good' ? 'evil' : 'good') : side; });
  } else if (s.revealed !== r) {
    s.revealed = r;
    const pair = rounds[r];
    s.faces.forEach((f, i) => {
      const good = pair[i];
      f.face.dataset.side = good ? 'good' : 'evil';
      f.face.className = `vt-hero dv-face ${good ? 'happy' : 'grin'}`;
      f.rounds.append(Object.assign(document.createElement('span'), { textContent: good ? '😊' : '😈' }));
    });
    if (pair[0] === pair[1]) {
      s.msg.textContent = pair[0] ? 'Оба добрые — Верити проверит ещё раз!' : 'Оба злые — Верити проверит ещё раз!';
    } else {
      s.msg.textContent = `${d.players[pair[0] ? 0 : 1].name} — добрый, ${d.players[pair[0] ? 1 : 0].name} — злой`;
    }
    beep(pair[0] === pair[1] ? [[440, 0.1], [440, 0.1]] : [[784, 0.08], [988, 0.14]], 'triangle');
  }
}

function dvDrawPlinko(s, d, t) {
  s.balls.forEach((b, i) => {
    const bt = t - b.delay;
    pkTrackHits(b, bt, s.hits, true);
    if (!b.landed && bt >= d.data.rows * PK_ROW_MS) {
      b.landed = true;
      s.legend[i].textContent = `×${String(d.data.multipliers[i]).replace('.', ',')}`;
      beep([[880, 0.08], [1175, 0.1]], 'triangle');
    }
  });
  pkDraw(s.canvas, d.data.rows, d.data.risk, s.balls.map((b) => ({ path: b.path, t: t - b.delay, color: b.color })), s.hits);
}

function dvShowResult(d) {
  const w = dvWinner(d);
  const me = dvMyIndex(d);
  $(`dv-p${w}`).classList.add('win');
  $(`dv-p${1 - w}`).classList.add('lose');
  const res = $('dv-result');
  const prize = d.stake ? ` и забирает ${2 * d.stake} 🪙` : '';
  if (me === w) {
    res.textContent = `🏆 Ты победил${prize ? `: +${d.stake} 🪙` : '!'}`;
    res.className = 'dv-result win';
    sounds.win();
    effects.confetti();
  } else if (me >= 0) {
    res.textContent = `${d.players[w].name} победил${d.stake ? `: −${d.stake} 🪙` : ''}`;
    res.className = 'dv-result lose';
    sounds.lose();
  } else {
    res.textContent = `🏆 ${d.players[w].name} побеждает${prize}`;
    res.className = 'dv-result';
  }
  $('dv-rematch').hidden = me < 0;
}

function dvFrame() {
  const s = dv.stage;
  const d = s && dvFind(s.id);
  if (d && !$('duel').hidden) {
    const t = dvTime(d);
    if (d.game === 'crash') dvDrawCrash(s, d, t);
    else if (d.game === 'roulette') dvDrawRoulette(s, d, t);
    else if (d.game === 'wheel') dvDrawFortune(s, d, t);
    else if (d.game === 'upgrade') dvDrawUpgrade(s, d, t);
    else if (d.game === 'plinko') dvDrawPlinko(s, d, t);
    else dvDrawVerity(s, d, t);
    if (!s.done && t >= dvAnimEnd(d)) {
      s.done = true;
      dvShowResult(d);
    }
  }
  requestAnimationFrame(dvFrame);
}
requestAnimationFrame(dvFrame);

$('dv-back').addEventListener('click', () => {
  dv.watching = null;
  dvRender();
});
$('dv-rematch').addEventListener('click', () => {
  const d = dv.stage && dvFind(dv.stage.id);
  if (!d) return;
  const other = d.players[1 - dvMyIndex(d)];
  send({ type: 'duel_invite', toId: other.id, game: d.game, stake: d.stake });
  dv.watching = null;
  dvRender();
});

// ---------- Пул (восьмёрка по приглашению) ----------

const PP = window.PoolPhysics;
const PL_RAIL = 40;                          // ширина борта на канвасе
const PL_W = PP.W + 2 * PL_RAIL;
const PL_H = PP.H + 2 * PL_RAIL;
const PL_COLORS = ['#f6f3ea', '#f2c230', '#1f4fd1', '#d4302b', '#6a2fb0', '#f07a1a', '#1a8a3a', '#8b1a1a', '#111111'];
const plColor = (id) => PL_COLORS[id > 8 ? id - 8 : id];

const pl = {
  view: null,
  recvAt: 0,
  watching: null,        // id матча, который показываем
  seenShot: new Map(),   // matchId -> последний анимированный удар
  anim: null,            // { matchId, frames, frameDt, t0, pocketedSeen }
  aim: null,             // точка прицела в координатах стола
  drag: null,            // { x, y, dir } при натяге
  power: 0,
  spin: 0,               // винт: -1 оттяжка … 1 накат
  placed: null,          // куда игрок поставил биток (шар с руки)
  seenInvites: new Set(),
  wasMyMatch: null,
  wasMyTurn: false,
};

const plCanvas = $('pl-canvas');
const plCtx = plCanvas.getContext('2d');

const plMatch = () => (pl.view && pl.watching ? pl.view.matches.find((m) => m.id === pl.watching) || null : null);
const plMyIndex = (m) => (m && state.me ? m.players.findIndex((p) => p.id === state.me.playerId) : -1);
const plCue = (balls) => balls.find((b) => b.id === 0);

function plMyTurnNow(m) {
  const me = plMyIndex(m);
  return !!m && m.phase === 'playing' && me >= 0 && m.turn === me && !pl.anim && plBusyLeft(m) <= 0;
}

function plBusyLeft(m) {
  return Math.max(0, m.busyLeft - (performance.now() - pl.recvAt));
}

function plTimeLeft(m) {
  return m.timeLeft === null ? 0 : Math.max(0, m.timeLeft - (performance.now() - pl.recvAt));
}

// Позиция курсора в координатах игрового поля.
function plPointer(ev) {
  const r = plCanvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * PL_W - PL_RAIL,
    y: ((ev.clientY - r.top) / r.height) * PL_H - PL_RAIL,
  };
}

// Луч от битка: где он встретит первый шар или борт.
function plRay(balls, c, d) {
  const R = PP.R;
  let best = Infinity;
  let target = null;
  for (const b of balls) {
    if (b.in || b.id === 0) continue;
    const ox = b.x - c.x;
    const oy = b.y - c.y;
    const proj = ox * d.x + oy * d.y;
    if (proj <= 0) continue;
    const perp2 = ox * ox + oy * oy - proj * proj;
    if (perp2 >= 4 * R * R) continue;
    const t = proj - Math.sqrt(4 * R * R - perp2);
    if (t > 0 && t < best) {
      best = t;
      target = b;
    }
  }
  const walls = [
    d.x > 0 ? (PP.W - R - c.x) / d.x : d.x < 0 ? (R - c.x) / d.x : Infinity,
    d.y > 0 ? (PP.H - R - c.y) / d.y : d.y < 0 ? (R - c.y) / d.y : Infinity,
  ];
  const wall = Math.min(...walls);
  if (wall < best) return { t: wall, target: null };
  return { t: best, target };
}

function plDrawBall(ctx, b, x, y, alpha = 1) {
  const R = PP.R;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x + PL_RAIL, y + PL_RAIL);
  ctx.beginPath();
  ctx.arc(1.5, 2.5, R, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(0, 0, 0, .35)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, 2 * Math.PI);
  ctx.clip();
  const stripe = b.id >= 9;
  ctx.fillStyle = stripe ? '#f6f3ea' : plColor(b.id);
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  if (stripe) {
    ctx.fillStyle = plColor(b.id);
    ctx.fillRect(-R, -R * 0.55, 2 * R, R * 1.1);
  }
  if (b.id !== 0) {
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.45, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = `700 ${b.id > 9 ? 7 : 8}px Manrope, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(b.id), 0, 0.5);
  }
  const shine = ctx.createRadialGradient(-R * 0.4, -R * 0.45, 0, -R * 0.2, -R * 0.2, R * 1.2);
  shine.addColorStop(0, 'rgba(255, 255, 255, .55)');
  shine.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
  shine.addColorStop(1, 'rgba(0, 0, 0, .3)');
  ctx.fillStyle = shine;
  ctx.fillRect(-R, -R, 2 * R, 2 * R);
  ctx.restore();
}

function plDrawTable(ctx) {
  // Борт.
  const wood = ctx.createLinearGradient(0, 0, 0, PL_H);
  wood.addColorStop(0, '#6b3a1e');
  wood.addColorStop(0.5, '#8a4b22');
  wood.addColorStop(1, '#4a250f');
  ctx.fillStyle = wood;
  ctx.beginPath();
  ctx.roundRect(0, 0, PL_W, PL_H, 22);
  ctx.fill();
  // Сукно.
  const cloth = ctx.createRadialGradient(PL_W / 2, PL_H / 2, 50, PL_W / 2, PL_H / 2, PL_W * 0.6);
  cloth.addColorStop(0, '#1f7fae');
  cloth.addColorStop(1, '#125a80');
  ctx.fillStyle = cloth;
  ctx.fillRect(PL_RAIL, PL_RAIL, PP.W, PP.H);
  ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
  ctx.lineWidth = 3;
  ctx.strokeRect(PL_RAIL, PL_RAIL, PP.W, PP.H);
  // Линия дома и точка пирамиды.
  ctx.strokeStyle = 'rgba(255, 255, 255, .18)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PL_RAIL + PP.HEAD_X, PL_RAIL);
  ctx.lineTo(PL_RAIL + PP.HEAD_X, PL_RAIL + PP.H);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, .3)';
  ctx.beginPath();
  ctx.arc(PL_RAIL + PP.FOOT.x, PL_RAIL + PP.FOOT.y, 2.5, 0, 2 * Math.PI);
  ctx.fill();
  // Ромбики на борту.
  ctx.fillStyle = '#f4d27a';
  for (let k = 1; k < 8; k++) {
    if (k === 4) continue;
    const x = PL_RAIL + (PP.W * k) / 8;
    for (const y of [PL_RAIL / 2, PL_H - PL_RAIL / 2]) {
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  // Лузы.
  for (const p of PP.POCKETS) {
    ctx.beginPath();
    ctx.arc(PL_RAIL + p.x, PL_RAIL + p.y, p.r - 2, 0, 2 * Math.PI);
    ctx.fillStyle = '#050505';
    ctx.fill();
    ctx.strokeStyle = '#2a1608';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
}

function plDraw() {
  const ctx = plCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, PL_W, PL_H);
  plDrawTable(ctx);
  const m = plMatch();
  if (!m) return;

  // Шары: кадр анимации или итог с сервера.
  let balls = m.balls;
  if (pl.anim && pl.anim.matchId === m.id) {
    const a = pl.anim;
    const i = Math.min(a.frames.length - 1, Math.floor((performance.now() - a.t0) / 1000 / a.frameDt));
    const frame = a.frames[i];
    balls = a.ids.map((id, k) => (frame[k] ? { id, x: frame[k][0], y: frame[k][1], in: false } : { id, in: true }));
    // Звук: шар упал в лузу.
    frame.forEach((pos, k) => {
      if (!pos && !a.pocketedSeen.has(k)) {
        a.pocketedSeen.add(k);
        beep([[180, 0.08], [120, 0.12]], 'sine');
      }
    });
    if (i >= a.frames.length - 1) {
      pl.anim = null;
      plRender();
    }
  }

  const myTurn = plMyTurnNow(m);
  const handPlacing = myTurn && m.ballInHand && !pl.placed;
  for (const b of balls) {
    if (b.in) continue;
    if (b.id === 0 && myTurn && m.ballInHand) continue;  // биток рисуем там, куда его ставят
    plDrawBall(ctx, b, b.x, b.y);
  }

  if (!myTurn) return;
  // Шар с руки: биток следует за курсором до клика.
  let cue = plCue(balls);
  if (m.ballInHand) {
    const pos = pl.placed || pl.aim;
    if (!pos) return;
    const okPlace = pl.placed || PP.canPlaceCue(balls, pos.x, pos.y, m.ballInHand === 'kitchen');
    plDrawBall(ctx, { id: 0 }, pos.x, pos.y, okPlace ? (handPlacing ? 0.7 : 1) : 0.35);
    if (handPlacing) {
      if (m.ballInHand === 'kitchen') {
        ctx.fillStyle = 'rgba(255, 255, 255, .06)';
        ctx.fillRect(PL_RAIL, PL_RAIL, PP.HEAD_X, PP.H);
      }
      return;
    }
    cue = { id: 0, x: pl.placed.x, y: pl.placed.y };
  }
  if (!pl.aim && !pl.drag) return;

  // Прицел: линия до первого шара, призрачный шар и куда уйдёт прицельный.
  const target = pl.drag ? null : pl.aim;
  let d = pl.drag ? pl.drag.dir : { x: target.x - cue.x, y: target.y - cue.y };
  const len = Math.hypot(d.x, d.y);
  if (len < 1) return;
  d = { x: d.x / len, y: d.y / len };
  const others = balls.filter((b) => b.id !== 0);
  const hit = plRay(others, cue, d);
  const gx = cue.x + d.x * hit.t;
  const gy = cue.y + d.y * hit.t;
  ctx.save();
  ctx.translate(PL_RAIL, PL_RAIL);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cue.x, cue.y);
  ctx.lineTo(gx, gy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(gx, gy, PP.R, 0, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
  ctx.stroke();
  if (hit.target) {
    const nx = hit.target.x - gx;
    const ny = hit.target.y - gy;
    const nl = Math.hypot(nx, ny) || 1;
    ctx.strokeStyle = 'rgba(255, 230, 120, .8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hit.target.x, hit.target.y);
    ctx.lineTo(hit.target.x + (nx / nl) * 70, hit.target.y + (ny / nl) * 70);
    ctx.stroke();
  }
  // Кий: отходит назад тем дальше, чем сильнее натяг.
  const back = PP.R + 6 + pl.power * 110;
  const sx = cue.x - d.x * back;
  const sy = cue.y - d.y * back;
  const ex = sx - d.x * 300;
  const ey = sy - d.y * 300;
  const grad = ctx.createLinearGradient(sx, sy, ex, ey);
  grad.addColorStop(0, '#f4ead2');
  grad.addColorStop(0.04, '#3a7bd5');
  grad.addColorStop(0.06, '#e9c891');
  grad.addColorStop(1, '#5a2e10');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();
  ctx.restore();
}

function plFrame() {
  if (!$('pool').hidden && pl.watching) plDraw();
  const m = plMatch();
  if (m && !$('pool').hidden) {
    $('pl-timer').style.width = m.phase === 'playing' ? `${Math.min(100, (plTimeLeft(m) / 60000) * 100)}%` : '0%';
  }
  requestAnimationFrame(plFrame);
}
requestAnimationFrame(plFrame);

// Новый удар в показываемом матче: прогоняем ту же физику и проигрываем.
function plMaybeAnimate(m) {
  if (!m || !m.lastShot) return;
  const seen = pl.seenShot.get(m.id) || 0;
  if (m.lastShot.shotNo <= seen) return;
  pl.seenShot.set(m.id, m.lastShot.shotNo);
  // Удар старше пары секунд (зашли посреди) не крутим, сразу показываем итог.
  if (m.busyLeft <= 0) return;
  const start = m.lastShot.start;
  const sim = PP.simulate(start, m.lastShot.vel, { record: true, spin: m.lastShot.spin || 0 });
  pl.anim = { matchId: m.id, ids: start.map((b) => b.id), frames: sim.frames, frameDt: sim.frameDt, t0: performance.now(), pocketedSeen: new Set() };
  beep([[90, 0.05], [260, 0.04]], 'triangle');
}

function plPlayerBox(el, m, i) {
  const p = m.players[i];
  el.replaceChildren();
  el.classList.toggle('active', m.phase === 'playing' && m.turn === i);
  el.classList.toggle('winner', m.phase === 'over' && m.winner === i);
  const head = document.createElement('div');
  head.className = 'pl-name';
  head.append(avatarEl(p.name), document.createTextNode(p.name));
  const g = m.groups[i];
  const left = g ? m.balls.filter((b) => !b.in && (g === 'solids' ? b.id >= 1 && b.id <= 7 : b.id >= 9)).map((b) => b.id) : [];
  const info = document.createElement('div');
  info.className = 'pl-group';
  info.textContent = g ? `${g === 'solids' ? 'сплошные' : 'полосатые'}${left.length ? '' : ' · бьёт восьмёрку'}` : 'стол открыт';
  const mini = document.createElement('div');
  mini.className = 'pl-mini';
  for (const id of left) {
    const s = document.createElement('span');
    s.style.setProperty('--c', plColor(id));
    s.className = id >= 9 ? 'stripe' : '';
    s.textContent = id;
    mini.append(s);
  }
  el.append(head, info, mini);
}

function plRenderLobby() {
  const v = pl.view;
  const myId = state.me && state.me.playerId;
  // Кого можно позвать: онлайн, кроме себя.
  const sel = $('pl-opponent');
  const cur = sel.value;
  const people = (state.onlinePlayers || []).filter((p) => p.id !== myId);
  sel.replaceChildren(...(people.length ? people.map((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    return o;
  }) : [Object.assign(document.createElement('option'), { value: '', textContent: 'никого нет онлайн' })]));
  if (people.some((p) => p.id === cur)) sel.value = cur;

  const out = v.inviteOut;
  $('pl-out').replaceChildren(...(out ? [plInviteRow(`Ждём ответа: ${out.toName}${out.stake ? ` · ставка ${out.stake}` : ''}`, [['Отменить', 'ghost', () => send({ type: 'pool_cancel' })]])] : []));
  $('pl-in').replaceChildren(...v.invitesIn.map((i) => plInviteRow(
    `${i.fromName} зовёт тебя${i.stake ? ` · ставка ${i.stake}` : ' · без ставки'}`,
    [['Принять', '', () => plAccept(i)], ['Отказ', 'ghost', () => send({ type: 'pool_decline', inviteId: i.id })]],
  )));

  $('pl-matches').replaceChildren(...(v.matches.length ? v.matches.map((m) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${m.players[0].name} — ${m.players[1].name}${m.stake ? ` · ${m.stake}` : ''}${m.phase === 'over' ? ' · окончен' : ''}`;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.textContent = plMyIndex(m) >= 0 && m.phase === 'playing' ? 'Вернуться' : 'Смотреть';
    b.addEventListener('click', () => {
      pl.watching = m.id;
      plRender();
    });
    li.append(name, b);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Сейчас никто не играет' })]));
}

function plInviteRow(text, buttons) {
  const d = document.createElement('div');
  d.className = 'pl-invite';
  const t = document.createElement('span');
  t.textContent = text;
  d.append(t);
  for (const [label, cls, fn] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    if (cls) b.className = cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    d.append(b);
  }
  return d;
}

function plRender() {
  const v = pl.view;
  if (!v) return;
  // Свой матч показываем всегда; чужой — если выбрали «Смотреть».
  if (v.myMatchId) pl.watching = v.myMatchId;
  const m = plMatch();
  if (pl.watching && !m) pl.watching = null;
  $('pl-lobby').hidden = !!m;
  $('pl-match').hidden = !m;
  plRenderLobby();
  plRenderPopup();

  if (!m) {
    $('pool-dot').hidden = !v.invitesIn.length;
    return;
  }
  plMaybeAnimate(m);
  const me = plMyIndex(m);
  plPlayerBox($('pl-p0'), m, 0);
  plPlayerBox($('pl-p1'), m, 1);
  const turnName = m.turn >= 0 ? m.players[m.turn].name : '';
  $('pl-status').textContent = m.phase === 'over'
    ? `🏆 ${m.players[m.winner].name}${m.stake ? ` +${2 * m.stake}` : ''}`
    : `${m.stake ? `Ставка ${m.stake} · ` : ''}бьёт ${turnName}`;
  $('pl-msg').textContent = m.message || '';
  $('pl-concede').hidden = !(me >= 0 && m.phase === 'playing');
  $('pl-back').hidden = me >= 0 && m.phase === 'playing';

  const myTurn = m.phase === 'playing' && me >= 0 && m.turn === me;
  if (!myTurn) {
    pl.placed = null;
    pl.drag = null;
    pl.power = 0;
  }
  $('pl-replace').hidden = !(myTurn && m.ballInHand && pl.placed);
  $('pl-hint').textContent = m.phase === 'over' ? (me >= 0 ? (m.winner === me ? 'Победа! 🎉' : 'Поражение') : '')
    : !myTurn ? (me >= 0 ? 'Ход соперника' : 'Ты смотришь матч')
      : m.ballInHand && !pl.placed ? (m.ballInHand === 'kitchen' ? 'Поставь биток в дом (левее линии) кликом' : 'Шар с руки: поставь биток кликом куда угодно')
        : 'Наведи на цель, зажми и потяни назад. Отпусти — удар';
  if (myTurn && !pl.wasMyTurn) sounds.turn();
  pl.wasMyTurn = myTurn;
  $('pool-dot').hidden = !(myTurn || v.invitesIn.length);
  if (m.phase === 'over' && me >= 0 && pl.wasMyMatch === m.id) {
    pl.wasMyMatch = null;
    if (m.winner === me) {
      sounds.win();
      effects.confetti();
    } else {
      sounds.lose();
    }
  }
  if (m.phase === 'playing' && me >= 0) pl.wasMyMatch = m.id;
}

// Всплывающее приглашение, видно на любой вкладке.
function plRenderPopup() {
  const inv = pl.view.invitesIn[0];
  $('pl-popup').hidden = !inv || !!pl.view.myMatchId;
  if (!inv) return;
  $('pl-popup-from').textContent = inv.fromName;
  $('pl-popup-stake').textContent = inv.stake ? `на ${inv.stake} 🪙` : 'без ставки';
  $('pl-popup').dataset.id = inv.id;
  if (!pl.seenInvites.has(inv.id)) {
    pl.seenInvites.add(inv.id);
    beep([[660, 0.1], [880, 0.1], [990, 0.15]], 'triangle');
  }
}

function plAccept(inv) {
  send({ type: 'pool_accept', inviteId: inv.id });
}
$('pl-popup-accept').addEventListener('click', () => {
  const inv = pl.view && pl.view.invitesIn.find((i) => i.id === $('pl-popup').dataset.id);
  if (inv) plAccept(inv);
  else send({ type: 'pool_accept', inviteId: $('pl-popup').dataset.id });
});
$('pl-popup-decline').addEventListener('click', () => send({ type: 'pool_decline', inviteId: $('pl-popup').dataset.id }));

$('pl-invite-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const toId = $('pl-opponent').value;
  if (!toId) return toast('Позвать некого: никого нет онлайн');
  const stake = Math.floor(Number($('pl-stake').value) || 0);
  const opp = $('pl-opponent').selectedOptions[0];
  confirmBet({ key: 'pool', game: '🎱 Пул', amount: stake, input: $('pl-stake'), note: `Позвать ${opp ? opp.textContent : 'соперника'}: ставка спишется, когда он примет` })
    .then((ok) => ok && send({ type: 'pool_invite', toId, stake }));
});
$('pl-back').addEventListener('click', () => {
  pl.watching = null;
  plRender();
});
$('pl-concede').addEventListener('click', () => {
  if (confirm('Сдаться? Ставка уйдёт сопернику.')) send({ type: 'pool_concede' });
});
$('pl-replace').addEventListener('click', () => {
  pl.placed = null;
  plRender();
});

// Управление: навести, зажать, потянуть назад, отпустить.
plCanvas.addEventListener('pointermove', (ev) => {
  const p = plPointer(ev);
  const m = plMatch();
  if (pl.drag && m) {
    const dx = p.x - pl.drag.x;
    const dy = p.y - pl.drag.y;
    pl.power = Math.max(0, Math.min(1, -(dx * pl.drag.dir.x + dy * pl.drag.dir.y) / 220));
    $('pl-power').style.width = `${pl.power * 100}%`;
    return;
  }
  pl.aim = p;
});
plCanvas.addEventListener('pointerleave', () => {
  if (!pl.drag) pl.aim = null;
});
plCanvas.addEventListener('pointerdown', (ev) => {
  const m = plMatch();
  if (!plMyTurnNow(m)) return;
  const p = plPointer(ev);
  if (ev.pointerType !== 'mouse') pl.aim = p;  // на телефоне прицел ставится касанием
  if (m.ballInHand && !pl.placed) {
    if (PP.canPlaceCue(m.balls, p.x, p.y, m.ballInHand === 'kitchen')) {
      pl.placed = { x: p.x, y: p.y };
      pl.aim = null;
      plRender();
    } else {
      toast('Сюда биток не поставить');
    }
    return;
  }
  const cue = pl.placed || plCue(m.balls);
  const target = pl.aim || p;
  const dx = target.x - cue.x;
  const dy = target.y - cue.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  pl.drag = { x: p.x, y: p.y, dir: { x: dx / len, y: dy / len } };
  pl.power = 0;
  plCanvas.setPointerCapture(ev.pointerId);
});
plCanvas.addEventListener('pointerup', () => {
  const m = plMatch();
  const drag = pl.drag;
  pl.drag = null;
  $('pl-power').style.width = '0%';
  if (!drag || !m || pl.power < 0.02) {
    pl.power = 0;
    return;
  }
  send({ type: 'pool_shoot', dir: drag.dir, power: Math.round(pl.power * 1000) / 1000, spin: pl.spin, cue: m.ballInHand ? pl.placed : undefined });
  pl.power = 0;
  pl.placed = null;
  plSetSpin(0);  // после удара винт снова по центру, чтобы не забыть про оттяжку
});

// Винт: точка удара по битку выше центра — накат, ниже — оттяжка.
function plSetSpin(v) {
  const s = Math.max(-1, Math.min(1, Math.round(v * 10) / 10));
  pl.spin = Math.abs(s) < 0.15 ? 0 : s;
  $('pl-spin-dot').style.transform = `translateY(${(-pl.spin * 15).toFixed(1)}px)`;
  $('pl-spin-name').textContent = pl.spin >= 0.6 ? 'Сильный накат' : pl.spin > 0 ? 'Накат'
    : pl.spin <= -0.6 ? 'Сильная оттяжка' : pl.spin < 0 ? 'Оттяжка' : 'Центр';
  $('pl-spin').classList.toggle('top', pl.spin > 0);
  $('pl-spin').classList.toggle('back', pl.spin < 0);
}
function plSpinFromPointer(e) {
  const r = $('pl-spin').getBoundingClientRect();
  plSetSpin(-(e.clientY - (r.top + r.height / 2)) / (r.height * 0.3));
}
$('pl-spin').addEventListener('pointerdown', (e) => {
  $('pl-spin').setPointerCapture(e.pointerId);
  plSpinFromPointer(e);
});
$('pl-spin').addEventListener('pointermove', (e) => {
  if (e.buttons) plSpinFromPointer(e);
});
$('pl-spin').addEventListener('dblclick', () => plSetSpin(0));
plSetSpin(0);

// ---------- Бомба в банке ----------

const bomb = {
  view: null,
  recvAt: 0,
  lastResultRound: 0,
  wasMyTurn: false,
  lastBank: 0,
};

function bombTimeLeft() {
  const v = bomb.view;
  return v && v.timeLeft !== null ? Math.max(0, v.timeLeft - (performance.now() - bomb.recvAt)) : 0;
}

const bombMe = () => (bomb.view && state.me ? bomb.view.players.find((p) => p.id === state.me.playerId) || null : null);

// «Накал» бомбы по тому, во сколько раз банк вырос от взносов. Фитиль игроку не известен, так что это не подсказка.
function bombHeat(v) {
  const entries = v.players.length * v.entry || 1;
  const ratio = v.bank / entries;
  return v.phase !== 'playing' ? 0 : ratio < 2 ? 1 : ratio < 4 ? 2 : 3;
}

function boomSound() {
  if (!soundOn) return;
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    const len = audio.sampleRate * 1.2;
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = audio.createBufferSource();
    src.buffer = buf;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1);
    const g = audio.createGain();
    g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(audio.destination);
    src.start(t);
  } catch { /* без звука */ }
}

function explodeFx() {
  const flash = document.createElement('div');
  flash.className = 'boom-flash';
  flash.textContent = '💥';
  document.body.append(flash);
  setTimeout(() => flash.remove(), 1300);
  bodyEffect('fx-shake', 900);
  boomSound();
}

function renderBombPhase() {
  const v = bomb.view;
  if (!v) return;
  const secs = Math.ceil(bombTimeLeft() / 1000);
  const turnName = (v.players.find((p) => p.id === v.turn) || {}).name;
  let text;
  if (v.phase === 'lobby') {
    text = v.players.length < 2
      ? `Сбор игроков: нужно минимум двое (${v.players.length}/${v.maxPlayers})`
      : `Старт через ${secs} с · игроков ${v.players.length}/${v.maxPlayers}`;
  } else if (v.phase === 'playing') {
    text = `Ходит ${turnName} · ${secs} с`;
  } else {
    text = v.result.type === 'boom' ? `💥 ${v.result.bomberName} взорвался!` : `🏆 ${v.result.winnerName} забирает банк!`;
  }
  $('b-phase').textContent = text;
  const total = v.phase === 'playing' ? v.turnMs : 15000;
  const show = v.phase === 'playing' || (v.phase === 'lobby' && v.timeLeft !== null);
  $('b-timer-bar').style.width = show ? `${Math.min(100, (bombTimeLeft() / total) * 100)}%` : '0%';
  $('b-timer-bar').classList.toggle('hurry', v.phase === 'playing' && secs <= 5);
}
setInterval(renderBombPhase, 200);

function bombPlayerCard(v, p) {
  const d = document.createElement('div');
  d.className = `b-player ${p.status}`;
  if (p.id === v.turn) d.classList.add('turn');
  if (state.me && p.id === state.me.playerId) d.classList.add('mine');
  const name = document.createElement('span');
  name.className = 'b-name';
  name.textContent = p.name;
  const sum = document.createElement('span');
  sum.className = 'b-sum';
  sum.textContent = `вложил ${p.contributed}`;
  const st = document.createElement('span');
  st.className = 'b-status';
  if (p.status === 'boom') st.textContent = '💥 взорвался';
  else if (p.status === 'out') st.textContent = `🏃 ${p.lastMove || 'сбежал'}`;
  else if (p.payout) st.textContent = `+${p.payout}`;
  else if (p.id === v.turn) st.textContent = '🔥 ходит';
  else st.textContent = p.lastMove || '';
  d.append(avatarEl(p.name), name, sum, st);
  return d;
}

function renderBomb() {
  const v = bomb.view;
  if (!v) return;
  const me = bombMe();
  const myTurn = !!(v.phase === 'playing' && me && v.turn === me.id);
  const inGame = !!(me && me.status === 'in');

  $('b-bank').textContent = v.bank;
  const el = $('b-bomb');
  el.dataset.heat = bombHeat(v);
  el.classList.toggle('lit', v.phase === 'playing');
  el.classList.toggle('exploded', v.phase === 'result' && v.result.type === 'boom');
  if (v.bank > bomb.lastBank && v.phase === 'playing') {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  bomb.lastBank = v.bank;

  $('b-history').replaceChildren(...v.history.map((h) => {
    const s = document.createElement('span');
    s.textContent = `${h.boom ? '💥' : '🏆'} ${h.fuse}`;
    s.className = h.boom ? '' : 'good';
    s.title = h.boom ? 'фитиль, на котором рвануло' : 'никто не взорвался';
    return s;
  }));

  if (v.players.length) {
    $('b-players').replaceChildren(...v.players.map((p) => bombPlayerCard(v, p)));
  } else {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Пока никого. Заходи первым!';
    $('b-players').replaceChildren(empty);
  }

  // Итог раунда.
  const r = v.result;
  if (r) {
    const mine = r.payouts.find((p) => state.me && p.id === state.me.playerId);
    $('b-result').textContent = r.type === 'boom'
      ? `Фитиль был на ${r.fuse}. Банк ${r.bank} делят: ${r.payouts.map((p) => `${p.name} +${p.amount}`).join(', ')}`
      : `Все сбежали, ${r.winnerName} забирает ${r.bank}. Фитиль был на ${r.fuse}`;
    $('b-result').className = `b-result ${mine ? 'win' : me ? 'lose' : ''}`;
    if (bomb.lastResultRound !== v.roundId) {
      bomb.lastResultRound = v.roundId;
      if (r.type === 'boom' && !$('bomb').hidden) explodeFx();
      else if (r.type === 'boom') boomSound();
      if (mine) sounds.win();
    }
  } else {
    $('b-result').textContent = '';
    $('b-result').className = 'b-result';
  }

  // Кнопки.
  $('b-join').hidden = !(v.phase === 'lobby' && !me);
  $('b-join').disabled = v.players.length >= v.maxPlayers;
  $('b-leave').hidden = !(v.phase === 'lobby' && me);
  $('b-deposit').hidden = !myTurn;
  $('b-flee').hidden = !(v.phase === 'playing' && inGame);
  if (inGame) $('b-flee').textContent = `Сбежать (+${Math.floor(me.contributed / 2)})`;
  let hint = '';
  if (v.phase === 'lobby' && me) hint = 'Ты в раунде, ждём старта';
  else if (myTurn) hint = 'Твой ход: подложи фишки или беги';
  else if (v.phase === 'playing' && inGame) hint = 'Жди своего хода. Сбежать можно в любой момент';
  else if (v.phase === 'playing' && me && me.status === 'boom') hint = 'Ты взорвался 💥';
  else if (v.phase === 'playing') hint = 'Раунд идёт, войти можно в следующий';
  $('b-hint').textContent = hint;

  if (myTurn && !bomb.wasMyTurn) sounds.turn();
  bomb.wasMyTurn = myTurn;
  $('bomb-dot').hidden = !myTurn;
  renderBombPhase();
}

bomb.onState = (msg) => {
  bomb.view = msg;
  bomb.recvAt = performance.now();
  renderBomb();
};

$('b-join').addEventListener('click', () => send({ type: 'bomb_join' }));
function bombDeposit(amount, input = null) {
  confirmBet({ key: 'bomb', game: '💣 Бомба', amount, input, note: 'Взнос в банк: если рванёт у тебя, потеряешь всё вложенное' })
    .then((ok) => ok && send({ type: 'bomb_deposit', amount }));
}
$('b-leave').addEventListener('click', () => send({ type: 'bomb_leave' }));
$('b-flee').addEventListener('click', () => send({ type: 'bomb_flee' }));
$('b-put').addEventListener('click', () => {
  bombDeposit(Math.floor(Number($('b-amount').value)), $('b-amount'));
});
document.querySelectorAll('[data-dep]').forEach((b) => {
  b.addEventListener('click', () => {
    $('b-amount').value = b.dataset.dep;
    bombDeposit(Number(b.dataset.dep));
  });
});

// ---------- Лента ставок и выигрышей ----------

const ACT_GAMES = {
  crash: { icon: '📈', name: 'Краш' },
  roulette: { icon: '🎡', name: 'Рулетка' },
  wheel: { icon: '🎰', name: 'Колесо' },
  bomb: { icon: '💣', name: 'Бомба' },
  upgrade: { icon: '⬆️', name: 'Апгрейд' },
  verity: { icon: '😊', name: 'Верити' },
  plinko: { icon: '🔺', name: 'Плинко' },
  mines: { icon: '💎', name: 'Мины' },
  poker: { icon: '🃏', name: 'Покер' },
  pool: { icon: '🎱', name: 'Пул' },
  duel: { icon: '⚔️', name: 'Дуэль' },
};
const ACT_FILTER_KEY = 'casino.activity.filter';
const act = { entries: [], filter: storage.get(ACT_FILTER_KEY) || 'all', freshId: 0 };

function actVisible(e) {
  if (act.filter === 'win') return e.kind === 'win';
  if (act.filter === 'mine') return !!state.me && e.playerId === state.me.playerId;
  return true;
}

function renderActivity() {
  document.querySelectorAll('[data-af]').forEach((b) => b.classList.toggle('active', b.dataset.af === act.filter));
  const shown = act.entries.filter(actVisible).slice(0, 30);
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'muted act-empty';
    li.textContent = act.filter === 'mine' ? 'Ты ещё ничего не ставил' : 'Пока тихо. Сделай первую ставку!';
    $('act-list').replaceChildren(li);
    return;
  }
  $('act-list').replaceChildren(...shown.map((e) => {
    const g = ACT_GAMES[e.game] || { icon: '🎲', name: e.game };
    const li = document.createElement('li');
    li.className = `act-${e.kind}`;
    if (state.me && e.playerId === state.me.playerId) li.classList.add('self');
    if (e.id === act.freshId) li.classList.add('fresh');
    const icon = document.createElement('span');
    icon.className = 'act-icon';
    icon.textContent = g.icon;
    icon.title = g.name;
    const body = document.createElement('span');
    body.className = 'act-body';
    const name = document.createElement('b');
    name.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'act-what';
    what.textContent = `${e.kind === 'bet' ? 'ставка' : e.kind === 'win' ? 'выигрыш' : 'проигрыш'} · ${g.name}${e.note ? ` · ${e.note}` : ''}`;
    body.append(name, what);
    const amount = document.createElement('span');
    amount.className = 'act-amount';
    amount.textContent = e.kind === 'win' ? `+${e.amount}` : e.kind === 'lose' ? `−${e.amount}` : `${e.amount}`;
    li.append(icon, avatarEl(e.name), body, amount);
    return li;
  }));
}

document.querySelectorAll('[data-af]').forEach((b) => b.addEventListener('click', () => {
  act.filter = b.dataset.af;
  storage.set(ACT_FILTER_KEY, act.filter);
  renderActivity();
}));

// ---------- Объявления и эффекты от админа ----------

function showBanner(text) {
  const el = document.createElement('div');
  el.className = 'banner';
  const inner = document.createElement('div');
  inner.className = 'banner-text';
  inner.textContent = text;
  el.append(inner);
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  beep([[660, 0.15], [880, 0.15], [1320, 0.3]], 'triangle');
  setTimeout(() => el.remove(), 7000);
}

// Падающие частицы: цветные бумажки или эмодзи.
function rain(symbols, count) {
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  const colors = ['#f2c14e', '#4fd18b', '#e5615b', '#6fa8ff', '#d77bff'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = symbols ? 'fx-emoji' : 'fx-confetti';
    if (symbols) p.textContent = symbols[i % symbols.length];
    else p.style.background = colors[i % colors.length];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDelay = `${Math.random() * 1.2}s`;
    p.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    p.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

function bodyEffect(cls, ms) {
  document.body.classList.remove(cls);
  void document.body.offsetWidth;  // перезапуск анимации, если эффект прислали дважды
  document.body.classList.add(cls);
  setTimeout(() => document.body.classList.remove(cls), ms);
}

const effects = {
  confetti: () => { rain(null, 140); sounds.win(); },
  money: () => { rain(['💸', '💰', '🪙', '💵'], 70); sounds.win(); },
  shake: () => { bodyEffect('fx-shake', 900); beep([[90, 0.4]], 'sawtooth'); },
  flip: () => bodyEffect('fx-flip', 6000),
  disco: () => { bodyEffect('fx-disco', 6000); beep([[523, 0.1], [659, 0.1], [523, 0.1], [784, 0.2]], 'square'); },
};

// ---------- Достижения и неделя ----------

const RANK_KEY = 'casino.rank.tab';
const ach = {
  defs: [],
  mine: {},                 // id достижения -> когда открыто
  season: null,             // { startedAt, endsAt, top, hall }
  tab: ['capital', 'week', 'hall'].includes(storage.get(RANK_KEY)) ? storage.get(RANK_KEY) : 'capital',
  queue: [],                // новые мои достижения для всплывашки
  showing: false,
  profileId: null,
};
const RARE_ACH = new Set(['jackpot', 'millionaire', 'poker_royal', 'crash_x50', 'season_champ']);

const signed = (n) => (n > 0 ? `+${n}` : String(n));
const mskDay = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
const weekLabel = (s) => `${mskDay(s.startedAt)} – ${mskDay(s.endsAt - 1)}`;

function leftLabel(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m % 60} мин`;
  return `${m % 60} мин`;
}

// Кликабельная строка игрока: открывает его достижения.
function profileLink(el, playerId) {
  el.classList.add('clickable');
  el.title = 'Достижения игрока';
  el.addEventListener('click', () => openProfile(playerId));
  return el;
}

function showRankTab(tab) {
  ach.tab = tab;
  storage.set(RANK_KEY, tab);
  $('leaderboard').hidden = tab !== 'capital';
  $('week-box').hidden = tab !== 'week';
  $('hall-box').hidden = tab !== 'hall';
  document.querySelectorAll('[data-rank]').forEach((b) => b.classList.toggle('active', b.dataset.rank === tab));
  renderSeason();
}
document.querySelectorAll('[data-rank]').forEach((b) => b.addEventListener('click', () => showRankTab(b.dataset.rank)));

const emptyLi = (text) => Object.assign(document.createElement('li'), { className: 'muted', textContent: text });

function renderSeason() {
  const s = ach.season;
  if (!s) return;
  $('week-info').textContent = `${weekLabel(s)} · до конца ${leftLabel(s.endsAt - Date.now())}`;
  const myId = state.me && state.me.playerId;
  $('week-list').replaceChildren(...(s.top.length ? s.top.map((p) => {
    const li = profileLink(listItem(p.name, p.id === myId), p.id);
    const score = document.createElement('span');
    score.className = `score ${p.net >= 0 ? 'plus' : 'minus'}`;
    score.textContent = signed(p.net);
    li.append(score);
    return li;
  }) : [emptyLi('На этой неделе ещё никто не играл')]));

  const medals = ['🥇', '🥈', '🥉'];
  $('hall-list').replaceChildren(...(s.hall.length ? s.hall.map((h) => {
    const li = document.createElement('li');
    const title = document.createElement('div');
    title.className = 'hall-week';
    title.textContent = weekLabel(h);
    li.append(title);
    h.top.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'hall-row';
      profileLink(row, p.id);
      const medal = document.createElement('span');
      medal.textContent = medals[i];
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      const net = document.createElement('span');
      net.className = `score ${p.net >= 0 ? 'plus' : 'minus'}`;
      net.textContent = signed(p.net);
      row.append(medal, name, net);
      li.append(row);
    });
    return li;
  }) : [emptyLi('Зал славы пуст: первая неделя ещё идёт')]));
}
setInterval(() => {
  if (ach.tab === 'week') renderSeason();
}, 30_000);

function renderMyAchCount() {
  $('me-ach-count').textContent = `${Object.keys(ach.mine).length}/${ach.defs.length}`;
}

function openProfile(playerId) {
  ach.profileId = playerId;
  send({ type: 'profile', playerId });
}

function closeProfile() {
  ach.profileId = null;
  $('profile').hidden = true;
}
$('profile-close').addEventListener('click', closeProfile);
$('profile').addEventListener('click', (e) => {
  if (e.target === $('profile')) closeProfile();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('profile').hidden) closeProfile();
});
$('me-ach').addEventListener('click', () => state.me && openProfile(state.me.playerId));

function renderProfile(msg) {
  if (msg.playerId !== ach.profileId) return;
  const count = Object.keys(msg.unlocked).length;
  $('prof-avatar').replaceChildren(avatarEl(msg.name));
  $('prof-name').textContent = msg.name;
  const week = msg.week.place ? `${msg.week.place}-е место в неделе (${signed(msg.week.net)})` : 'на этой неделе ещё не играл';
  $('prof-sub').textContent = `Капитал ${msg.capital} · ${week}`;
  $('prof-count').textContent = `${count} из ${ach.defs.length}`;
  $('prof-bar').style.width = `${ach.defs.length ? (count / ach.defs.length) * 100 : 0}%`;
  // Открытые первыми, остальные в обычном порядке.
  const defs = [...ach.defs].sort((x, y) => Number(!msg.unlocked[x.id]) - Number(!msg.unlocked[y.id]));
  $('prof-grid').replaceChildren(...defs.map((d) => {
    const at = msg.unlocked[d.id];
    const li = document.createElement('li');
    li.className = at ? 'got' : 'locked';
    const icon = document.createElement('span');
    icon.className = 'ach-icon';
    icon.textContent = d.icon;
    const text = document.createElement('div');
    const name = document.createElement('b');
    name.textContent = d.name;
    const desc = document.createElement('span');
    desc.textContent = d.desc;
    text.append(name, desc);
    if (at) {
      const when = document.createElement('small');
      when.textContent = new Date(at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
      text.append(when);
    }
    li.append(icon, text);
    return li;
  }));
  $('profile').hidden = false;
}

// Всплывашка «Новое достижение!» по одной за раз.
function showNextAch() {
  if (ach.showing || !ach.queue.length) return;
  const d = ach.queue.shift();
  ach.showing = true;
  $('ach-pop-icon').textContent = d.icon;
  $('ach-pop-name').textContent = d.name;
  $('ach-pop-desc').textContent = d.desc;
  const pop = $('ach-pop');
  pop.hidden = false;
  pop.classList.remove('show');
  void pop.offsetWidth;
  pop.classList.add('show');
  beep([[659, 0.1], [880, 0.1], [1047, 0.12], [1319, 0.25]], 'triangle');
  if (RARE_ACH.has(d.id)) effects.confetti();
  setTimeout(() => {
    pop.classList.remove('show');
    setTimeout(() => {
      pop.hidden = true;
      ach.showing = false;
      showNextAch();
    }, 450);
  }, 4200);
}

showRankTab(ach.tab);

// ---------- Сообщения сервера ----------

const handlers = {
  welcome(msg) {
    state.me = msg;
    state.token = msg.token;
    storage.set(TOKEN_KEY, msg.token);
    storage.set(NAME_KEY, msg.name);
    $('login').hidden = true;
    $('lobby').hidden = false;
    $('me').hidden = false;
    $('me-name').textContent = msg.name;
    $('me-balance').textContent = msg.balance;
    state.balance = msg.balance;
    // Старый аккаунт без пароля: предлагаем задать, иначе на новой ссылке не войти.
    if (!msg.hasPassword) showPasswordCard(false);
    else $('pw-card').hidden = true;
  },

  password_set() {
    if (state.me) state.me.hasPassword = true;
    $('pw-card').hidden = true;
    toast('Пароль сохранён: теперь входи по имени и паролю с любой ссылки', true);
  },

  music(msg) {
    // Новый трек от админа: снова пускаем видео, даже если тот же самый клип включили заново.
    if (msg.track && music.track && msg.track.id === music.track.id && msg.track.offset === 0) music.loadedId = null;
    music.track = msg.track;
    music.recvAt = performance.now();
    renderMusic();
  },

  activity_history(msg) {
    act.entries = msg.entries;
    renderActivity();
  },

  activity(msg) {
    act.entries.unshift(msg.entry);
    if (act.entries.length > 60) act.entries.pop();
    act.freshId = msg.entry.id;
    renderActivity();
  },

  upgrade_result(msg) {
    startUpgradeSpin(msg);
  },

  upgrade_feed(msg) {
    renderUpgradeFeed(msg.feed);
  },

  mines_state(msg) {
    mnApply(msg);
  },

  mines_feed(msg) {
    renderMinesFeed(msg.feed);
  },

  plinko_ball(msg) {
    pkAddBall(msg);
  },

  plinko_feed(msg) {
    renderPlinkoFeed(msg.feed);
  },

  verity_result(msg) {
    startVerity(msg);
  },

  verity_feed(msg) {
    renderVerityFeed(msg.feed);
  },

  duel_state(msg) {
    dv.view = msg;
    const now = performance.now();
    for (const d of msg.duels) if (!dv.t0.has(d.id)) dv.t0.set(d.id, now - d.elapsed);
    // Началась моя дуэль — сразу на вкладку дуэли.
    const mine = msg.duels.find((d) => d.phase === 'playing' && dvMyIndex(d) >= 0);
    if (mine && dv.lastMine !== mine.id) {
      dv.lastMine = mine.id;
      dv.watching = mine.id;
      showTab('duel');
      beep([[392, 0.08], [523, 0.08], [659, 0.14]], 'square');
    }
    dvRender();
  },

  pool_state(msg) {
    const before = pl.view && pl.view.myMatchId;
    pl.view = msg;
    pl.recvAt = performance.now();
    // Мой матч начался: сразу на вкладку пула.
    if (msg.myMatchId && msg.myMatchId !== before) showTab('pool');
    plRender();
  },

  bomb_state(msg) {
    bomb.onState(msg);
  },

  roulette_state(msg) {
    rl.view = msg;
    rl.recvAt = performance.now();
    renderRoulette();
  },

  wheel_state(msg) {
    fw.view = msg;
    fw.recvAt = performance.now();
    renderWheel();
  },

  notice(msg) {
    toast(msg.message, true);
  },

  music_library(msg) {
    const select = $('order-track');
    const current = select.value;
    select.replaceChildren(select.options[0], ...msg.tracks.map((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.title;
      return o;
    }));
    select.value = msg.tracks.some((t) => t.id === current) ? current : '';
    $('order-form').hidden = !msg.tracks.length;
  },

  announce(msg) {
    showBanner(msg.text);
  },

  fx(msg) {
    if (Object.hasOwn(effects, msg.effect)) effects[msg.effect]();
  },

  chat_history(msg) {
    renderChat(msg.messages, false);
  },

  chat(msg) {
    renderChat([msg.message], true);
  },

  poker_state(msg) {
    poker.view = msg;
    poker.recvAt = performance.now();
    renderPoker();
  },

  crash_state(msg) {
    // Звук на краше, если у меня была ставка, которую я не забрал.
    const prev = state.crash;
    const findMine = (s) => s && s.players.find((p) => state.me && p.id === state.me.playerId);
    const mine = findMine(msg);
    const minePrev = findMine(prev);
    if (prev && prev.phase === 'running' && msg.phase === 'crashed' && mine && mine.cashout === null) sounds.lose();
    if (mine && mine.cashout !== null && minePrev && minePrev.cashout === null) sounds.win();
    state.crash = msg;
    state.crashRecvAt = performance.now();
    renderCrash();
  },

  balance(msg) {
    if (upgradeHoldsBalance(msg) || verityHoldsBalance(msg)) return;
    state.balance = msg.balance;
    $('me-balance').textContent = msg.balance;
    state.bonus = {
      amount: msg.bonus.amount,
      eligible: msg.bonus.eligible,
      readyAt: Date.now() + msg.bonus.availableIn,
    };
    renderBonus();
  },

  online(msg) {
    state.onlinePlayers = msg.players;
    if (pl.view) plRenderLobby();
    if (dv.view && !dv.watching) dvRenderLobby();
    $('online-list').replaceChildren(...msg.players.map((p) =>
      profileLink(listItem(p.name, state.me && p.id === state.me.playerId), p.id)));
    $('online-count').textContent = msg.players.length;
  },

  achievements_defs(msg) {
    ach.defs = msg.list;
    ach.mine = msg.mine;
    renderMyAchCount();
  },

  achievement(msg) {
    if (state.me && msg.playerId === state.me.playerId) {
      ach.mine[msg.achievement.id] = Date.now();
      renderMyAchCount();
      ach.queue.push(msg.achievement);
      showNextAch();
    }
    if (ach.profileId === msg.playerId) openProfile(msg.playerId);
  },

  season(msg) {
    ach.season = msg;
    renderSeason();
  },

  profile(msg) {
    renderProfile(msg);
  },

  leaderboard(msg) {
    $('leaderboard').replaceChildren(...msg.players.map((p) => {
      const li = profileLink(listItem(p.name, state.me && p.id === state.me.playerId), p.id);
      if (!p.online) li.classList.add('offline');
      if (p.badges) {
        const badges = document.createElement('span');
        badges.className = 'badges';
        badges.textContent = `🏅${p.badges}`;
        badges.title = 'Достижений';
        li.append(badges);
      }
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = p.capital;
      li.append(score);
      return li;
    }));
  },

  error(msg) {
    if (upg.awaiting) {
      upg.awaiting = false;
      $('u-go').disabled = false;
      releaseBalance();
    }
    vtCancelPending();
    if (mn.waiting !== null) {
      mn.waiting = null;
      mnRender();
    }
    if (msg.code === 'bad_token') {
      state.token = null;
      storage.remove(TOKEN_KEY);
      showLogin();
    }
    if (state.me) toast(msg.message);
    else $('login-error').textContent = msg.message;
    console.warn('server error:', msg.message);
  },
};

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('name').value.trim();
  const password = $('password').value;
  if (!name) return;
  $('login-error').textContent = '';
  send({ type: 'hello', name, password });
});

// Пароль: задать (старым аккаунтам без пароля) или сменить (кнопка 🔑 в шапке).
function showPasswordCard(change) {
  $('pw-title').textContent = change ? '🔑 Сменить пароль' : '🔒 Задай пароль';
  $('pw-text').textContent = change
    ? 'С ним входишь в свой аккаунт с любой ссылки: имя + пароль.'
    : 'Ссылка на зал иногда меняется, и на новой ссылке браузер тебя не узнает. С паролем войдёшь в свой аккаунт откуда угодно: имя + пароль.';
  $('pw-card').hidden = false;
  $('pw-input').value = '';
  $('pw-input').focus();
}
$('me-pass').addEventListener('click', () => showPasswordCard(state.me && state.me.hasPassword));
$('pw-later').addEventListener('click', () => { $('pw-card').hidden = true; });
$('pw-card').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const password = $('pw-input').value;
  if (password.length < 4) return toast('Пароль: от 4 символов');
  send({ type: 'set_password', password });
});

$('bonus-btn').addEventListener('click', () => send({ type: 'claim_bonus' }));

$('logout').addEventListener('click', () => {
  const back = state.me && state.me.hasPassword ? 'Вернуться можно по имени и паролю.' : 'У тебя нет пароля: без этого браузера вернуться к игроку не получится. Сначала задай пароль (🔑).';
  if (!confirm(`Выйти? ${back}`)) return;
  storage.remove(TOKEN_KEY);
  location.reload();
});

connect();

// ---------- Фоновый джаз (lounge.js) ----------

(function setupLounge() {
  const L = window.Lounge;
  if (!L) return;
  // Браузер даёт звук только после действия человека: заводим фон на первый клик или клавишу.
  const unlock = () => L.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, unlock, { capture: true });

  const panel = $('lounge-panel');
  $('lounge-btn').addEventListener('click', () => { panel.hidden = !panel.hidden; });
  document.addEventListener('click', (ev) => {
    if (!$('lounge').contains(ev.target)) panel.hidden = true;
  });
  $('lounge-toggle').addEventListener('click', () => L.toggle());
  $('lounge-next').addEventListener('click', () => L.next());
  $('lounge-prev').addEventListener('click', () => L.prev());
  $('lounge-vol').addEventListener('input', () => L.setVolume($('lounge-vol').value));

  function render(s) {
    $('lounge-vol').value = s.vol;
    $('lounge-track').textContent = s.track ? `«${s.track}»` : 'Ещё не играл';
    $('lounge-toggle').textContent = s.on ? 'Выключить' : 'Включить';
    $('lounge-btn').classList.toggle('playing', s.playing && !s.ducked);
    $('lounge-btn').classList.toggle('off', !s.on);
    $('lounge-note').textContent = !s.on ? 'Фон выключен'
      : s.ducked ? 'Пауза: играет песня из зала'
        : !s.playing ? 'Заиграет после первого клика на странице' : '';
  }
  L.onChange(render);
  render(L.status());
})();
