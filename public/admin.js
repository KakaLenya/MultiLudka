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
const PHASES = {
  betting: 'ставки', running: 'летит', crashed: 'краш',
  waiting: 'ждём игроков', starting: 'скоро раздача', preflop: 'префлоп', flop: 'флоп', turn: 'тёрн', river: 'ривер', showdown: 'вскрытие',
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
        if (p.luck) {
          const l = document.createElement('span');
          l.className = 'muted-tag';
          l.textContent = `🍀${p.luck}%`;
          l.title = 'Режим везения';
          frag.append(l);
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
    p.luck ? `🍀 везение ${p.luck}%` : null,
    p.hasPassword ? '🔑 пароль есть' : '⚠️ пароля нет — на новой ссылке не войдёт',
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

// Длину трека админка узнаёт сама и сообщает серверу (на случай, если у игроков звук выключен).
let durationAsked = null;
function reportAdminDuration(track) {
  if (!track || track.duration !== null || durationAsked === track.id) return;
  durationAsked = track.id;
  const a = new Audio();
  a.preload = 'metadata';
  a.onloadedmetadata = () => {
    if (Number.isFinite(a.duration)) api('/music/duration', { id: track.id, duration: a.duration }).catch(() => {});
    a.removeAttribute('src');
  };
  a.src = track.url;
}

function renderMusic() {
  const m = admin.data.music;
  reportAdminDuration(m.current);
  $('m-autoplay').textContent = m.autoplay ? '🔀 Подряд: включено' : '🔀 Случайные подряд';
  $('m-autoplay').classList.toggle('on', m.autoplay);
  $('m-now').textContent = m.current
    ? `Сейчас играет: ${m.current.title} (${Math.floor(m.current.offset / 60)}:${String(m.current.offset % 60).padStart(2, '0')}${m.current.duration ? ` из ${Math.floor(m.current.duration / 60)}:${String(Math.round(m.current.duration % 60)).padStart(2, '0')}` : ''})`
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

// Заказы песен от игроков: перестраиваем, только когда список поменялся (чтобы не сбивать выбор в select).
let lastRequestCount = 0;
function renderRequests() {
  const reqs = admin.data.requests;
  const box = $('m-requests');
  const key = reqs.map((r) => `${r.id}:${r.trackId}`).join('|') + '#' + admin.data.music.playlist.length;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (reqs.length > lastRequestCount) beepAdmin();
  lastRequestCount = reqs.length;

  box.replaceChildren(...reqs.map((r) => {
    const row = document.createElement('div');
    row.className = 'request';
    const who = document.createElement('div');
    who.className = 'request-who';
    const name = document.createElement('b');
    name.textContent = r.name;
    who.append('🎵 ', name, `: «${r.text}»`);

    const select = document.createElement('select');
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'трек не найден, выбери';
    select.append(none);
    for (const s of admin.data.music.playlist) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.title;
      select.append(o);
    }
    select.value = r.trackId || '';

    const play = document.createElement('button');
    play.type = 'button';
    play.textContent = '▶ Включить';
    play.addEventListener('click', () => {
      if (!select.value) return toast('Выбери трек для заказа', true);
      run('/requests/approve', { id: r.id, trackId: select.value }, (x) => `Играет заказ ${r.name}: ${x.track.title}`);
    });
    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'ghost';
    no.textContent = '✕';
    no.title = 'Отклонить';
    no.addEventListener('click', () => run('/requests/reject', { id: r.id }, `Заказ ${r.name} отклонён`));

    const actions = document.createElement('div');
    actions.className = 'row';
    actions.append(select, play, no);
    row.append(who, actions);
    return row;
  }));
}

// Короткий сигнал о новом заказе (если вкладка админки открыта).
let adminAudio = null;
function beepAdmin() {
  try {
    adminAudio = adminAudio || new AudioContext();
    const o = adminAudio.createOscillator();
    const g = adminAudio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.1, adminAudio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, adminAudio.currentTime + 0.3);
    o.connect(g).connect(adminAudio.destination);
    o.start();
    o.stop(adminAudio.currentTime + 0.3);
  } catch { /* без звука */ }
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

function renderUpgraderAdmin() {
  const u = admin.data.upgrader;
  $('up-rigged').textContent = u.rigged === 'win' ? 'Следующий апгрейд (любого игрока): выиграет'
    : u.rigged === 'lose' ? 'Следующий апгрейд (любого игрока): проиграет' : 'Следующий апгрейд: честно';
  $('up-feed').replaceChildren(...(u.feed.length
    ? u.feed.slice(0, 8).map((e) => li(`${e.name}: ${e.amount} на ${e.chance}% → ${e.win ? '+' + (e.payout - e.amount) : '−' + e.amount}`))
    : [li('Пока никто не апгрейдился', 'muted')]));
}

function renderSeasonAdmin() {
  const { season, unlockedTotal } = admin.data.season;
  const day = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  $('se-info').textContent = `Неделя ${day(season.startedAt)} – ${day(season.endsAt - 1)} · открыто достижений у всех: ${unlockedTotal} · в зале славы недель: ${season.hall.length}`;
  $('se-top').replaceChildren(...(season.top.length
    ? season.top.slice(0, 5).map((p, i) => li(`${i + 1}. ${p.name}: ${p.net > 0 ? '+' : ''}${p.net}`))
    : [li('На этой неделе ещё никто не играл', 'muted')]));
}

function renderMinesAdmin() {
  const m = admin.data.mines;
  if (!m) return;
  $('mn-admin-info').textContent = m.rigged === 'boom' ? 'Следующий клик любого игрока попадёт на мину' : 'Честно';
  const rows = [
    ...m.playing.map((g) => li(`▶ ${g.name}: ставка ${g.bet}, мин ${g.mines}, открыто ${g.picks} (×${g.multiplier})`)),
    ...m.feed.slice(0, 6).map((e) => li(`${e.name}: ${e.bet} → ${e.payout} (${e.mines} мин, ${e.picks} кл.)`)),
  ];
  $('mn-admin-list').replaceChildren(...(rows.length ? rows : [li('В мины ещё никто не играл', 'muted')]));
}

function renderPlinkoAdmin() {
  const p = admin.data.plinko;
  if (!p) return;
  $('pk-admin-info').textContent = `${p.rigged === 'edge' ? 'Следующий шарик (любого игрока) упадёт в крайнюю лунку' : 'Честно'} · в полёте шариков: ${p.inFlight}`;
  $('pk-admin-feed').replaceChildren(...(p.feed.length
    ? p.feed.slice(0, 8).map((e) => li(`${e.name}: ${e.amount} → ${e.payout} (×${e.multiplier}, ${e.rows} рядов)`))
    : [li('Шарики ещё никто не бросал', 'muted')]));
}

function renderVerityAdmin() {
  const v = admin.data.verity;
  $('vt-rigged').textContent = v.rigged === 'good' ? 'Следующий раз (любой игрок): добрый 😊'
    : v.rigged === 'evil' ? 'Следующий раз (любой игрок): злой 😈' : 'Следующий раз: честно';
  $('vt-feed').replaceChildren(...(v.feed.length
    ? v.feed.slice(0, 8).map((e) => li(`${e.good ? '😊' : '😈'} ${e.name}: ${e.good ? '+' : '−'}${e.amount}`))
    : [li('Пока никого не проверял', 'muted')]));
}

function renderBombAdmin() {
  const b = admin.data.bomb;
  $('bo-phase').textContent = { lobby: 'сбор', playing: 'идёт', result: 'итог' }[b.phase] || b.phase;
  $('bo-bank').textContent = b.bank;
  $('bo-fuse').textContent = b.fuse === null ? '—' : b.fuse;
  $('bo-rigged').textContent = b.rigged === null ? '' : `Следующий раунд подкручен: рванёт при банке ≥ ${b.rigged}`;
  const status = { in: '', out: ' · сбежал', boom: ' · 💥' };
  $('bo-players').replaceChildren(...(b.players.length
    ? b.players.map((p) => li(`${p.id === b.turn ? '🔥 ' : ''}${p.name}: вложил ${p.contributed}${status[p.status]}${p.payout ? ` → +${p.payout}` : ''}`))
    : [li('Никого', 'muted')]));
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
    if (s.hole) {
      const d = document.createElement('span');
      d.className = 'cards-text';
      d.textContent = s.hole.map(cardText).join(' ') + (s.hand ? ` · ${s.hand}` : '');
      el.append(d);
    }
    return el;
  }) : [li('За столом никого', 'muted')]));
  const names = new Map(admin.data.players.map((p) => [p.id, p.name]));
  const boardText = v.board.length ? `Стол: ${v.board.map(cardText).join(' ')}. ` : '';
  $('p-rigged').textContent = boardText + (v.rigged.length
    ? `Подкручено: ${v.rigged.map((r) => `${names.get(r.id) || r.id} → ${r.cards.map(cardText).join(' ')}`).join(', ')}`
    : '');
}

// «Ah» -> «A♥»
function cardText(c) {
  return c[0].replace('T', '10') + ({ s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]] || c[1]);
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
  renderRequests();
  renderCrash();
  renderRoulette();
  renderUpgraderAdmin();
  renderVerityAdmin();
  renderPlinkoAdmin();
  renderMinesAdmin();
  renderSeasonAdmin();
  renderBombAdmin();
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

$('rig-cards-btn').addEventListener('click', () => {
  const p = needSelected();
  // «as ah» -> ['As', 'Ah']
  const cards = $('rig-cards').value.trim().split(/\s+/).map((c) => c.slice(0, 1).toUpperCase() + c.slice(1).toLowerCase());
  if (p) run('/poker/rig', { playerId: p.id, cards }, `${p.name} получит ${cards.join(' ')}`);
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
$('m-autoplay').addEventListener('click', () => {
  const on = !(admin.data && admin.data.music.autoplay);
  run('/music/autoplay', { on }, on ? 'Играют случайные треки подряд' : 'Режим «подряд» выключен: текущий трек доиграет и всё');
});
$('chat-clear').addEventListener('click', () => {
  if (confirm('Очистить чат у всех?')) run('/chat/clear', {}, 'Чат очищен');
});

document.querySelectorAll('[data-uprig]').forEach((b) => b.addEventListener('click', () => {
  const mode = b.dataset.uprig === 'fair' ? null : b.dataset.uprig;
  run('/upgrader/rig', { mode }, mode === 'win' ? 'Следующий апгрейд выиграет' : mode === 'lose' ? 'Следующий апгрейд проиграет' : 'Апгрейды снова честные');
}));

$('sel-password-btn').addEventListener('click', () => {
  const p = selectedPlayer();
  const password = $('sel-password').value;
  if (!p || !password) return;
  run('/set-password', { playerId: p.id, password }, `🔑 Пароль для ${p.name} задан. Скажи ему: имя «${p.name}» и этот пароль.`);
  $('sel-password').value = '';
});

document.querySelectorAll('[data-luck]').forEach((b) => b.addEventListener('click', () => {
  const p = selectedPlayer();
  if (!p) return;
  const percent = Number(b.dataset.luck);
  run('/luck', { playerId: p.id, percent }, percent ? `🍀 ${p.name}: везение ${percent}%` : `${p.name}: везение выключено`);
}));

$('mn-rig-boom').addEventListener('click', () => run('/mines/rig', { mode: 'boom' }, 'Следующий клик в минах — мина'));
$('mn-rig-off').addEventListener('click', () => run('/mines/rig', { mode: null }, 'Мины снова честные'));
$('pk-rig-edge').addEventListener('click', () => run('/plinko/rig', { mode: 'edge' }, 'Следующий шарик плинко упадёт в край'));
$('pk-rig-off').addEventListener('click', () => run('/plinko/rig', { mode: null }, 'Плинко снова честное'));

$('se-end').addEventListener('click', () => {
  if (confirm('Подвести итоги недели прямо сейчас? Тройка лучших уйдёт в зал славы, очки обнулятся.')) {
    run('/season/end', {}, 'Итоги недели подведены, началась новая');
  }
});

document.querySelectorAll('[data-vtrig]').forEach((b) => b.addEventListener('click', () => {
  const mode = b.dataset.vtrig === 'fair' ? null : b.dataset.vtrig;
  run('/verity/rig', { mode }, mode === 'good' ? 'Верити будет добрым' : mode === 'evil' ? 'Верити будет злым' : 'Верити снова честный');
}));

$('rig-bomb').addEventListener('click', () => {
  const fuse = Math.floor(Number($('rig-fuse').value));
  run('/bomb/rig', { fuse }, (r) => `Рванёт при банке ≥ ${fuse} ${r.round === 'current' ? 'в этом' : 'в следующем'} раунде`);
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
