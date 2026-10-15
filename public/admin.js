'use strict';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'casino.adminToken';
const POLL_MS = 1000;

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const admin = {
  token: storage.get(TOKEN_KEY),
  data: null,
  selected: null,   // id выбранного игрока
};

const EFFECTS = [
  ['confetti', '🎊 Конфетти'],
  ['money', '💸 Денежный дождь'],
  ['shake', '📳 Тряска'],
  ['flip', '🙃 Перевернуть'],
  ['disco', '🪩 Дискотека'],
];
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const PHASES = {
  betting: 'ставки', running: 'летит', crashed: 'краш',
  waiting: 'ждём игроков', starting: 'скоро раздача', bet1: 'ставки 1', reroll: 'перебросок', bet2: 'ставки 2', showdown: 'вскрытие',
};

let toastTimer = null;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'admin-toast show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'admin-toast'; }, 3000);
}

async function api(path, body) {
  const headers = { 'content-type': 'application/json' };
  if (admin.token) headers['x-admin-token'] = admin.token;
  const res = await fetch(`/admin/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 403) {
    showAuth();
    throw new Error(data.error || 'Нет доступа');
  }
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

// Команда + сообщение об успехе + мгновенное обновление данных.
async function run(path, body, okText) {
  try {
    const result = await api(path, body);
    toast(typeof okText === 'function' ? okText(result) : okText);
    poll();
    return result;
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

function showAuth() {
  $('auth').hidden = false;
  $('panel').hidden = true;
  $('conn').dataset.state = 'closed';
  $('conn').textContent = 'нет доступа';
}

function selectedPlayer() {
  return admin.data && admin.data.players.find((p) => p.id === admin.selected);
}

function fmtMs(ms) {
  const min = Math.ceil(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;
}

function li(text, cls) {
  const el = document.createElement('li');
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

// ---------- Отрисовка ----------

function renderPlayers() {
  const players = admin.data.players;
  $('online-count').textContent = `${players.filter((p) => p.online).length} онлайн`;
  $('players').replaceChildren(...players.map((p) => {
    const tr = document.createElement('tr');
    if (p.id === admin.selected) tr.className = 'selected';
    const cells = [
      () => { const d = document.createElement('span'); d.className = p.online ? 'dot-online' : 'dot-offline'; return d; },
      () => {
        const frag = document.createDocumentFragment();
        frag.append(p.name);
        if (p.mutedFor > 0) {
          const m = document.createElement('span');
          m.className = 'muted-tag';
          m.textContent = '🤐';
          frag.append(m);
        }
        return frag;
      },
      () => String(p.balance),
      () => (p.reserved ? String(p.reserved) : '—'),
      () => String(p.capital),
    ];
    for (const make of cells) {
      const td = document.createElement('td');
      td.append(make());
      tr.append(td);
    }
    tr.addEventListener('click', () => {
      admin.selected = p.id;
      $('rename').value = p.name;
      render();
    });
    return tr;
  }));
}

function renderSelected() {
  const p = selectedPlayer();
  $('sel-box').hidden = !p;
  $('sel-name').textContent = p ? p.name : 'Игрок не выбран';
  if (!p) return;
  const parts = [
    p.online ? 'онлайн' : 'офлайн',
    `баланс ${p.balance}`,
    p.reserved ? `в играх ${p.reserved}` : null,
    p.mutedFor > 0 ? `мут ещё ${fmtMs(p.mutedFor)}` : null,
    p.bonusReadyIn > 0 ? `пособие через ${fmtMs(p.bonusReadyIn)}` : 'пособие доступно',
  ];
  $('sel-info').textContent = parts.filter(Boolean).join(' · ');
}

function renderCrash() {
  const c = admin.data.crash;
  $('c-phase').textContent = PHASES[c.phase] || c.phase;
  $('c-mult').textContent = `${c.multiplier.toFixed(2)}×`;
  $('c-point').textContent = `${c.crashPoint.toFixed(2)}×`;
  $('c-rigged').textContent = c.rigged ? `Следующий раунд подкручен на ${c.rigged.toFixed(2)}×` : '';
  $('c-bets').replaceChildren(...(c.players.length
    ? c.players.map((b) => li(`${b.name}: ${b.amount}${b.cashout ? ` → забрал на ${b.cashout.toFixed(2)}× (+${b.payout - b.amount})` : ''}`))
    : [li('Ставок нет', 'muted')]));
}

function renderMusic() {
  const m = admin.data.music;
  $('m-now').textContent = m.current
    ? `Сейчас играет: ${m.current.title} (${Math.floor(m.current.offset / 60)}:${String(m.current.offset % 60).padStart(2, '0')})`
    : 'Ничего не играет';
  // Кнопки треков перестраиваем, только когда поменялся состав папки.
  const list = $('m-list');
  const key = m.playlist.map((s) => s.id).join('|');
  if (list.dataset.key !== key) {
    list.dataset.key = key;
    list.replaceChildren();
    if (!m.playlist.length) {
      const empty = document.createElement('p');
      empty.className = 'muted small';
      empty.textContent = 'Папка music пустая. Положи туда mp3, и они появятся здесь.';
      list.append(empty);
    }
    for (const s of m.playlist) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ghost song';
      b.dataset.id = s.id;
      const title = document.createElement('span');
      title.textContent = `▶ ${s.title}`;
      b.append(title);
      b.addEventListener('click', () => run('/music/play', { id: s.id }, `Играет: ${s.title}`));
      list.append(b);
    }
  }
  for (const b of list.querySelectorAll('.song')) b.classList.toggle('playing', !!m.current && m.current.id === b.dataset.id);
}

function renderRoulette() {
  const r = admin.data.roulette;
  $('r-phase').textContent = { betting: 'ставки', spinning: 'крутится', result: 'результат' }[r.phase] || r.phase;
  // Админ видит номер с начала вращения (до этого он ещё не выбран).
  $('r-number').textContent = r.result === null ? '—' : r.result;
  $('r-total').textContent = r.players.reduce((s, p) => s + p.total, 0);
  $('r-rigged').textContent = r.rigged === null ? '' : `Следующее вращение подкручено на ${r.rigged}`;
  const label = (b) => (b.type === 'straight' ? `№${b.number}` : {
    red: 'красное', black: 'чёрное', even: 'чёт', odd: 'нечёт', low: '1-18', high: '19-36',
    dozen1: '1-12', dozen2: '13-24', dozen3: '25-36', column1: 'кол.1', column2: 'кол.2', column3: 'кол.3',
  }[b.type]);
  $('r-bets').replaceChildren(...(r.players.length
    ? r.players.map((p) => li(`${p.name}: ${p.bets.map((b) => `${label(b)} ${b.amount}`).join(', ')}${p.won !== null ? ` → ${p.won ? `+${p.won - p.total}` : `−${p.total}`}` : ''}`))
    : [li('Ставок нет', 'muted')]));
}

function renderPoker() {
  const v = admin.data.poker;
  $('p-phase').textContent = PHASES[v.phase] || v.phase;
  $('p-pot').textContent = v.pot;
  const seats = v.seats.filter(Boolean);
  $('p-seats').replaceChildren(...(seats.length ? seats.map((s) => {
    const el = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${s.name} · ${s.stack}${s.folded ? ' · пас' : ''}${s.connected ? '' : ' · нет связи'}`;
    el.append(name);
    if (s.dice) {
      const d = document.createElement('span');
      d.className = 'dice-text';
      d.title = s.hand;
      d.textContent = s.dice.map((x) => DICE[x]).join('');
      el.append(d);
    }
    return el;
  }) : [li('За столом никого', 'muted')]));
  const names = new Map(admin.data.players.map((p) => [p.id, p.name]));
  $('p-rigged').textContent = v.rigged.length
    ? `Подкручено: ${v.rigged.map((r) => `${names.get(r.id) || r.id} → ${r.dice.join('')}`).join(', ')}`
    : '';
}

function renderChat() {
  const log = $('a-chat');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  log.replaceChildren(...admin.data.chat.map((m) => {
    const el = document.createElement('li');
    if (m.playerId === null) el.className = 'system';
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = new Date(m.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    const author = document.createElement('span');
    author.className = 'author';
    author.textContent = m.name;
    el.append(time, author, m.text);
    return el;
  }));
  if (!admin.data.chat.length) log.append(li('Пока тихо', 'empty'));
  if (atBottom) log.scrollTop = log.scrollHeight;
}

function render() {
  if (!admin.data) return;
  renderPlayers();
  renderSelected();
  renderMusic();
  renderCrash();
  renderRoulette();
  renderPoker();
  renderChat();
}

async function poll() {
  try {
    admin.data = await api('/state');
    $('auth').hidden = true;
    $('panel').hidden = false;
    $('conn').dataset.state = 'open';
    $('conn').textContent = 'на связи';
    render();
  } catch (err) {
    if (!$('auth').hidden) return;
    $('conn').dataset.state = 'closed';
    $('conn').textContent = 'сервер не отвечает';
  }
}

// ---------- Действия ----------

function needSelected() {
  const p = selectedPlayer();
  if (!p) toast('Сначала выбери игрока в таблице', true);
  return p;
}

function readAmount() {
  const n = Math.floor(Number($('amount').value));
  if (!Number.isFinite(n) || n <= 0) {
    toast('Сумма должна быть больше 0', true);
    return null;
  }
  return n;
}

function grant(sign) {
  const amount = readAmount();
  if (amount === null) return;
  const target = $('grant-target').value;
  const body = { amount: sign * amount, target };
  if (target === 'player') {
    const p = needSelected();
    if (!p) return;
    body.playerId = p.id;
  }
  run('/grant', body, (r) => (r.results.length
    ? r.results.map((x) => `${x.name} ${x.delta >= 0 ? '+' : ''}${x.delta} → ${x.balance}`).join(', ')
    : 'Некому: никого нет'));
}

$('give').addEventListener('click', () => grant(1));
$('take').addEventListener('click', () => grant(-1));
document.querySelectorAll('[data-amount]').forEach((b) => {
  b.addEventListener('click', () => { $('amount').value = b.dataset.amount; });
});

$('set-balance').addEventListener('click', () => {
  const p = needSelected();
  const n = Math.floor(Number($('amount').value));
  if (!p) return;
  if (!Number.isFinite(n) || n < 0) return toast('Баланс должен быть от 0', true);
  run('/set-balance', { playerId: p.id, balance: n }, (r) => `${p.name}: баланс ${r.balance}`);
});

$('rename-btn').addEventListener('click', () => {
  const p = needSelected();
  if (p) run('/rename', { playerId: p.id, name: $('rename').value }, (r) => `Теперь это ${r.name}`);
});

document.querySelectorAll('[data-mute]').forEach((b) => {
  b.addEventListener('click', () => {
    const p = needSelected();
    const minutes = Number(b.dataset.mute);
    if (p) run('/mute', { playerId: p.id, minutes }, minutes ? `${p.name} в муте` : `${p.name} снова может писать`);
  });
});

$('reset-bonus').addEventListener('click', () => {
  const p = needSelected();
  if (p) run('/reset-bonus', { playerId: p.id }, `${p.name}: пособие снова доступно`);
});

$('kick-table').addEventListener('click', () => {
  const p = needSelected();
  if (p) run('/kick-table', { playerId: p.id }, (r) => (r.pending ? `${p.name} встанет после раздачи` : `${p.name} встал из-за стола`));
});

$('delete-player').addEventListener('click', async () => {
  const p = needSelected();
  if (!p) return;
  if (!confirm(`Удалить ${p.name} совсем? Его фишки (${p.capital}) пропадут, имя освободится.`)) return;
  const r = await run('/delete-player', { playerId: p.id }, (x) => `${x.name} удалён`);
  if (r) admin.selected = null;
});

$('rig-dice-btn').addEventListener('click', () => {
  const p = needSelected();
  const dice = [...$('rig-dice').value.trim()].map(Number);
  if (p) run('/poker/rig', { playerId: p.id, dice }, `${p.name} получит ${dice.join('')}`);
});

$('announce-banner').addEventListener('click', () => {
  run('/announce', { text: $('announce').value, style: 'banner' }, 'Баннер показан всем онлайн');
});
$('announce-chat').addEventListener('click', () => {
  run('/announce', { text: $('announce').value, style: 'chat' }, 'Сообщение в чате');
});

document.querySelectorAll('.fx-buttons').forEach((box) => {
  for (const [effect, label] of EFFECTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.textContent = label;
    b.addEventListener('click', () => {
      let target = 'all';
      if (box.dataset.fxTarget === 'player') {
        const p = needSelected();
        if (!p) return;
        target = p.id;
      }
      run('/effect', { effect, target }, `${label}!`);
    });
    box.append(b);
  }
});

$('rig-crash').addEventListener('click', () => {
  const multiplier = Number($('rig-mult').value);
  run('/crash/rig', { multiplier }, (r) => `Краш на ${multiplier.toFixed(2)}× в ${r.round === 'current' ? 'этом' : 'следующем'} раунде`);
});
$('m-random').addEventListener('click', () => run('/music/play', { id: 'random' }, (r) => `Играет: ${r.track.title}`));
$('m-stop').addEventListener('click', () => run('/music/stop', {}, 'Музыка выключена'));
$('chat-clear').addEventListener('click', () => {
  if (confirm('Очистить чат у всех?')) run('/chat/clear', {}, 'Чат очищен');
});

$('rig-roulette').addEventListener('click', () => {
  const number = Number($('rig-number').value);
  run('/roulette/rig', { number }, (r) => `Выпадет ${number} ${r.round === 'current' ? 'в этом' : 'в следующем'} вращении`);
});

$('crash-now').addEventListener('click', () => {
  run('/crash/now', {}, (r) => `Крашнули на ${r.at.toFixed(2)}×`);
});

$('auth-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  admin.token = $('token').value.trim();
  storage.set(TOKEN_KEY, admin.token);
  $('auth').hidden = true;
  $('auth-error').textContent = '';
  poll().then(() => { if (!$('auth').hidden) $('auth-error').textContent = 'Токен не подошёл'; });
});

poll();
setInterval(poll, POLL_MS);
