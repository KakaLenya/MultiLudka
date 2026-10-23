'use strict';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'casino.adminToken';
const POLL_MS = 1000;
const MAX_CHIPS = 1e15;
const MOBILE = window.matchMedia('(max-width: 900px)');

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const admin = {
  token: storage.get(TOKEN_KEY),
  data: null,
  tab: 'players',
  selected: null,   // id выбранного игрока
  filter: 'all',
  massTarget: 'online',
  showPass: false,
};

const EFFECTS = [
  ['confetti', '🎊 Конфетти'],
  ['money', '💸 Денежный дождь'],
  ['shake', '📳 Тряска'],
  ['flip', '🙃 Перевернуть'],
  ['disco', '🪩 Дискотека'],
  ['scare-clown', '🤡 Скример: клоун'],
  ['scare-kraken', '🐙 Скример: Кракен'],
  ['jackpot', '💰 Мираж джекпота'],
  ['runaway', '🏃 Убегающая кнопка'],
];
const TITLE_PRESETS = ['👑 Король зала', '🤡 Клоун дня', '🐟 Лудик', '🍀 Везунчик', '💀 Банкрот', '🦈 Акула', '🎯 Снайпер', '🐌 Тормоз'];
const QUICK = [['100', 100], ['1k', 1000], ['15k', 15000], ['100k', 100000], ['1М', 1e6], ['1 млрд', 1e9]];
const PHASES = {
  betting: 'ставки', running: 'летит', crashed: 'краш', spinning: 'крутится', result: 'результат',
  lobby: 'сбор', playing: 'идёт',
  waiting: 'ждём игроков', starting: 'скоро раздача', preflop: 'префлоп', flop: 'флоп', turn: 'тёрн', river: 'ривер', showdown: 'вскрытие',
};
const KR_RIG = { fs: 'фриспины', hw: 'сундук глубин', tentacle: 'хватка Кракена', ships: 'все галеоны', lose: 'проигрыш' };
const SL_RIG = { duel: 'дуэль на закате', bullets: 'шальная пуля', lose: 'проигрыш' };
const YK_RIG = { bonus: 'ночь ста демонов', fox: 'лиса-кицунэ', foxwall: 'стена 9-хвостых лис', lose: 'проигрыш' };
const CC_RIG = { knives: 'метатель ножей', hoops: 'огненные обручи', lose: 'проигрыш' };
const DUEL_GAMES = { crash: 'Краш', roulette: 'Рулетка', wheel: 'Колесо', upgrade: 'Апгрейд', verity: 'Верити', plinko: 'Плинко' };
const fwLabel = (m) => (m === 0 ? '💀 череп' : `×${m}`);

// ---------- Мелочи ----------

// Фишки с разрядами через точку: 60000000 → 60.000.000.
function chips(n) {
  const v = Math.trunc(Number(n) || 0);
  const t = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return v < 0 ? `−${t}` : t;
}
const signed = (n) => (n > 0 ? `+${chips(n)}` : chips(n));

function fmtMs(ms) {
  const min = Math.ceil(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;
}
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Элемент: h('li', { className: 'x' }, 'текст', другойЭлемент).
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}
const li = (text, cls) => h('li', { className: cls }, text);
const emptyLi = (text) => li(text, 'empty');

// Список перестраиваем, только когда поменялось содержимое: не мигает и не сбивает наведение.
function fill(el, key, build) {
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  el.replaceChildren(...build());
}

function hue(name) {
  let x = 0;
  for (const ch of name) x = (x * 31 + ch.codePointAt(0)) % 360;
  return x;
}
function avatar(el, name) {
  el.textContent = [...name.trim()][0] || '?';
  el.style.setProperty('--h', hue(name));
  return el;
}

let toastTimer = null;
function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'admin-toast show' + (isError ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'admin-toast'; }, isError ? 4500 : 3000);
}

// ---------- Подтверждение опасных действий ----------

// ask({ title, text, ok, type }) → Promise<boolean>. type — слово, которое надо вписать.
function ask({ title, text, ok = 'Да', type = null, danger = true }) {
  const dlg = $('ask');
  if (typeof dlg.showModal !== 'function') return Promise.resolve(confirm(`${title}\n\n${text}`));
  $('ask-title').textContent = title;
  $('ask-text').textContent = text;
  $('ask-ok').textContent = ok;
  $('ask-ok').className = danger ? 'danger' : '';
  $('ask-type-box').hidden = !type;
  $('ask-type').value = '';
  $('ask-type-label').textContent = type ? `Чтобы подтвердить, впиши «${type}»` : '';
  const sync = () => { $('ask-ok').disabled = !!type && $('ask-type').value.trim().toLowerCase() !== type.toLowerCase(); };
  sync();
  $('ask-type').oninput = sync;
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer) => {
      if (done) return;
      done = true;
      if (dlg.open) dlg.close();
      resolve(answer);
    };
    const yes = () => { if (!$('ask-ok').disabled) finish(true); };
    $('ask-ok').onclick = yes;
    $('ask-type').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); yes(); } };
    $('ask-cancel').onclick = () => finish(false);
    dlg.onclick = (ev) => { if (ev.target === dlg) finish(false); };
    dlg.oncancel = (ev) => { ev.preventDefault(); finish(false); };
    dlg.onclose = () => finish(false);
    dlg.showModal();
    (type ? $('ask-type') : $('ask-cancel')).focus();
  });
}

// ---------- Сервер ----------

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
  $('tabs').hidden = true;
  $('conn').dataset.state = 'closed';
  $('conn').textContent = 'нет доступа';
}

// ---------- Разделы и адрес ----------

const TABS = ['players', 'games', 'music', 'hall', 'server'];

// #players, #players/<id>, #games, #music, #hall, #server
function readHash() {
  const [tab, id] = decodeURIComponent(location.hash.slice(1)).split('/');
  admin.tab = TABS.includes(tab) ? tab : 'players';
  const next = admin.tab === 'players' && id ? id : null;
  if (next !== admin.selected) {
    admin.selected = next;
    admin.showPass = false;
  }
  for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('on', a.dataset.tab === admin.tab);
  for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== admin.tab;
  document.body.classList.toggle('sheet-open', !!admin.selected && MOBILE.matches);
  render();
}
window.addEventListener('hashchange', readHash);
MOBILE.addEventListener('change', readHash);

function selectPlayer(id) {
  location.hash = id ? `players/${encodeURIComponent(id)}` : 'players';
}

// ---------- Игроки ----------

function selectedPlayer() {
  return admin.data && admin.data.players.find((p) => p.id === admin.selected);
}

const FILTERS = {
  all: () => true,
  online: (p) => p.online,
  lucky: (p) => p.luck > 0,
  nopass: (p) => !p.hasPassword,
  muted: (p) => p.mutedFor > 0,
};

function visiblePlayers() {
  const q = $('pl-search').value.trim().toLowerCase();
  return admin.data.players.filter((p) => FILTERS[admin.filter](p) && (!q || p.name.toLowerCase().includes(q)));
}

function renderPlayers() {
  const all = admin.data.players;
  const online = all.filter((p) => p.online).length;
  $('pl-meta').textContent = `${online} онлайн · ${all.length} всего`;
  $('mass-online').textContent = `· ${online}`;
  $('mass-all').textContent = `· ${all.length}`;

  const list = visiblePlayers();
  const key = admin.selected + '#' + list.map((p) => [p.id, p.name, p.online, p.balance, p.reserved, p.luck, p.hasPassword, p.mutedFor > 0].join(':')).join('|');
  fill($('players'), key, () => {
    if (!list.length) return [emptyLi(all.length ? 'Никого не нашлось' : 'Ещё никто не заходил')];
    return list.map((p) => {
      const tags = [
        p.luck ? h('span', { className: 'tag luck', title: 'Режим везения' }, `🍀${p.luck}%`) : null,
        p.mutedFor > 0 ? h('span', { className: 'tag', title: `Мут ещё ${fmtMs(p.mutedFor)}` }, '🤐') : null,
        !p.hasPassword ? h('span', { className: 'tag warn', title: 'Нет пароля: на новой ссылке не войдёт' }, '⚠️') : null,
      ];
      return h('li', { className: p.id === admin.selected ? 'on' : '' },
        h('button', { type: 'button', className: 'prow', onclick: () => selectPlayer(p.id === admin.selected && !MOBILE.matches ? null : p.id) },
          h('span', { className: 'avatar-wrap' }, avatar(h('span', { className: 'avatar' }), p.name), h('i', { className: p.online ? 'dot on' : 'dot' })),
          h('span', { className: 'pname' }, h('span', { className: 'pn' }, p.name), ...tags),
          h('span', { className: 'pmoney' },
            h('b', null, chips(p.capital)),
            p.reserved ? h('small', null, `в играх ${chips(p.reserved)}`) : null)));
    });
  });
}

function renderPlayerCard() {
  const p = selectedPlayer();
  $('pc-card').hidden = !p;
  $('pc-card-empty').hidden = !!p;
  $('pl-detail').classList.toggle('open', !!p);
  document.body.classList.toggle('sheet-open', !!p && MOBILE.matches);
  if (!p) {
    // Игрока удалили или ссылка на несуществующего.
    if (admin.selected && admin.data) selectPlayer(null);
    return;
  }
  // Открыли другого игрока: поля карточки начинаем с чистого листа.
  if ($('pc-card').dataset.for !== p.id) {
    $('pc-card').dataset.for = p.id;
    $('pc-rename').value = p.name;
    $('pc-password').value = '';
    $('pc-cards').value = '';
    $('pl-detail').scrollTop = 0;
  }
  avatar($('pc-avatar'), p.name);
  $('pc-name').textContent = p.name;
  const since = p.createdAt ? `с ${new Date(p.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}` : '';
  $('pc-sub').replaceChildren(h('i', { className: p.online ? 'dot on' : 'dot' }), p.online ? 'онлайн' : 'офлайн', since ? ` · в зале ${since}` : '');
  $('pc-balance').textContent = chips(p.balance);
  $('pc-reserved').textContent = p.reserved ? chips(p.reserved) : '—';
  $('pc-capital').textContent = chips(p.capital);

  const tags = [
    p.luck ? ['luck', `🍀 везение ${p.luck}%`] : null,
    p.mutedFor > 0 ? ['bad', `🤐 мут ещё ${fmtMs(p.mutedFor)}`] : null,
    p.bonusReadyIn > 0 ? ['', `⏳ пособие через ${fmtMs(p.bonusReadyIn)}`] : ['good', '🎁 пособие доступно'],
    !p.hasPassword ? ['bad', '⚠️ без пароля'] : null,
  ].filter(Boolean);
  fill($('pc-tags'), tags.map((t) => t.join(':')).join('|'), () => tags.map(([cls, text]) => h('span', { className: `tag ${cls}` }, text)));

  for (const b of $('pc-luck').children) b.classList.toggle('on', Number(b.dataset.luck) === (p.luck || 0));

  const pass = $('pc-pass');
  $('pc-pass-show').hidden = !p.password;
  $('pc-pass-copy').hidden = !p.password;
  if (!p.hasPassword) { pass.textContent = 'пароля нет — на новой ссылке не войдёт'; pass.className = 'bad'; }
  else if (!p.password) { pass.textContent = 'пароль есть, но задан раньше и не сохранён'; pass.className = ''; }
  else { pass.textContent = admin.showPass ? p.password : '•'.repeat(Math.min(12, p.password.length)); pass.className = 'secret-pass'; }
  $('pc-pass-show').textContent = admin.showPass ? 'скрыть' : 'показать';

  const titles = (admin.data && admin.data.pranks && admin.data.pranks.titles) || [];
  const title = titles.find((t) => String(t.id) === String(p.id));
  $('pc-title-now').textContent = title ? `Сейчас: ${title.text} — до ${new Date(title.until).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Титула нет';
  $('pc-title-clear').hidden = !title;
}

// ---------- Суммы ----------

// Сумма с сокращениями: 10k / 10к = 10 000, 5кк / 5м / 5m = 5 000 000, 2млрд / 2b = 2 000 000 000.
function parseChips(raw) {
  let s = String(raw).trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // «60.000.000», как показывает админка
  s = s.replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)(k|к|кк|m|м|млн|b|млрд|т|тыс)?$/.exec(s);
  if (!m) return null;
  const mult = { k: 1e3, 'к': 1e3, 'т': 1e3, 'тыс': 1e3, 'кк': 1e6, m: 1e6, 'м': 1e6, 'млн': 1e6, b: 1e9, 'млрд': 1e9 }[m[2]] || 1;
  const n = Math.floor(Number(m[1]) * mult);
  return Number.isFinite(n) ? n : null;
}

function amountHint(input) {
  const n = parseChips(input.value);
  const hint = $(`${input.id}-hint`);
  hint.textContent = n === null ? 'не понял сумму' : n > MAX_CHIPS ? 'больше квадриллиона нельзя' : `= ${chips(n)}`;
  hint.classList.toggle('bad', n === null || n > MAX_CHIPS);
}

function readAmount(input) {
  const n = parseChips(input.value);
  if (n === null || n <= 0) {
    toast('Сумма: например 1000, 5кк, 1.5м, 2млрд', true);
    input.focus();
    return null;
  }
  return Math.min(n, MAX_CHIPS);
}

for (const box of document.querySelectorAll('.quick')) {
  const input = $(box.dataset.for);
  for (const [label, value] of QUICK) {
    box.append(h('button', { type: 'button', className: 'fchip', onclick: () => { input.value = String(value); amountHint(input); } }, label));
  }
  input.addEventListener('input', () => amountHint(input));
  amountHint(input);
}

const grantText = (r) => (r.results.length
  ? (r.results.length > 3
    ? `${r.results.length} игрокам: ${signed(r.results[0].delta)}…`
    : r.results.map((x) => `${x.name} ${signed(x.delta)} → ${chips(x.balance)}`).join(', '))
  : 'Некому: никого нет');

// ---------- Действия с игроком ----------

function withPlayer(fn) {
  return (...args) => {
    const p = selectedPlayer();
    if (!p) return toast('Сначала выбери игрока', true);
    return fn(p, ...args);
  };
}

$('pc-give').addEventListener('click', withPlayer((p) => {
  const amount = readAmount($('pc-amount'));
  if (amount !== null) run('/grant', { amount, target: 'player', playerId: p.id }, grantText);
}));
$('pc-take').addEventListener('click', withPlayer((p) => {
  const amount = readAmount($('pc-amount'));
  if (amount !== null) run('/grant', { amount: -amount, target: 'player', playerId: p.id }, grantText);
}));
$('pc-take-all').addEventListener('click', withPlayer(async (p) => {
  if (!await ask({ title: `Забрать всё у ${p.name}?`, text: `Баланс ${chips(p.balance)} обнулится. Фишки в играх (${chips(p.reserved)}) останутся.`, ok: 'Забрать всё' })) return;
  run('/grant', { amount: -MAX_CHIPS, target: 'player', playerId: p.id }, grantText);
}));
$('pc-set').addEventListener('click', withPlayer((p) => {
  const n = parseChips($('pc-amount').value);
  if (n === null || n < 0) return toast('Баланс: например 1000, 5кк, 1.5м', true);
  run('/set-balance', { playerId: p.id, balance: Math.min(n, MAX_CHIPS) }, (r) => `${p.name}: баланс ровно ${chips(r.balance)}`);
}));

for (const b of $('pc-luck').children) {
  b.addEventListener('click', withPlayer((p) => {
    const percent = Number(b.dataset.luck);
    run('/luck', { playerId: p.id, percent }, percent ? `🍀 ${p.name}: везение ${percent}%` : `${p.name}: везение выключено`);
  }));
}

$('pc-pass-show').addEventListener('click', () => { admin.showPass = !admin.showPass; renderPlayerCard(); });
$('pc-pass-copy').addEventListener('click', withPlayer(async (p) => {
  const text = `Имя: ${p.name}\nПароль: ${p.password}\nЗал: ${location.origin}/`;
  try {
    await navigator.clipboard.writeText(text);
    toast('Скопировал имя, пароль и ссылку на зал');
  } catch {
    admin.showPass = true;
    renderPlayerCard();
    toast('Не получилось скопировать — пароль показан, перепиши вручную', true);
  }
}));
$('pc-password-gen').addEventListener('click', () => {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  $('pc-password').value = [...bytes].map((x) => abc[x % abc.length]).join('');
});
$('pc-password-btn').addEventListener('click', withPlayer(async (p) => {
  const password = $('pc-password').value;
  if (!password) { $('pc-password').focus(); return toast('Впиши новый пароль или нажми 🎲', true); }
  const r = await run('/set-password', { playerId: p.id, password }, `🔑 Пароль для ${p.name} задан. Скажи ему: имя «${p.name}» и этот пароль.`);
  if (r) { $('pc-password').value = ''; admin.showPass = true; }
}));

$('pc-rename-btn').addEventListener('click', withPlayer((p) => {
  run('/rename', { playerId: p.id, name: $('pc-rename').value }, (r) => `Теперь это ${r.name}`);
}));

for (const b of $('pc-mute').children) {
  b.addEventListener('click', withPlayer((p) => {
    const minutes = Number(b.dataset.mute);
    run('/mute', { playerId: p.id, minutes }, minutes ? `${p.name} в муте на ${b.textContent}` : `${p.name} снова может писать`);
  }));
}

$('pc-reset-bonus').addEventListener('click', withPlayer((p) => run('/reset-bonus', { playerId: p.id }, `${p.name}: пособие снова доступно`)));
$('pc-kick').addEventListener('click', withPlayer((p) => {
  run('/kick-table', { playerId: p.id }, (r) => (r.pending ? `${p.name} встанет после раздачи` : `${p.name} встал из-за стола`));
}));

// «as ah» → ['As', 'Ah']
const parseCards = (raw) => raw.trim().split(/\s+/).filter(Boolean).map((c) => c.slice(0, 1).toUpperCase() + c.slice(1).toLowerCase());
function rigCards(p, raw) {
  const cards = parseCards(raw);
  return run('/poker/rig', { playerId: p.id, cards }, `${p.name} получит ${cards.map(cardText).join(' ')}`);
}
$('pc-cards-btn').addEventListener('click', withPlayer((p) => rigCards(p, $('pc-cards').value)));

$('pc-delete').addEventListener('click', withPlayer(async (p) => {
  const yes = await ask({
    title: `Удалить ${p.name}?`,
    text: `Игрок пропадёт совсем, его фишки (${chips(p.capital)}) сгорят, имя освободится. Вернуть нельзя.`,
    ok: 'Удалить навсегда',
    type: p.name,
  });
  if (!yes) return;
  const r = await run('/delete-player', { playerId: p.id }, (x) => `${x.name} удалён`);
  if (r) selectPlayer(null);
}));

$('pc-close').addEventListener('click', () => selectPlayer(null));

// ---------- Всем сразу ----------

for (const b of $('mass-target').children) {
  b.addEventListener('click', () => {
    admin.massTarget = b.dataset.target;
    for (const x of $('mass-target').children) x.classList.toggle('on', x === b);
  });
}
function massCount() {
  const all = admin.data ? admin.data.players : [];
  return admin.massTarget === 'online' ? all.filter((p) => p.online).length : all.length;
}
const massWho = () => (admin.massTarget === 'online' ? 'всем онлайн' : 'ВСЕМ зарегистрированным');

async function massGrant(sign) {
  const amount = readAmount($('mass-amount'));
  if (amount === null) return;
  const n = massCount();
  if (!n) return toast('Некому: никого нет', true);
  const yes = await ask({
    title: sign > 0 ? `Дать ${chips(amount)} ${massWho()}?` : `Забрать по ${chips(amount)} ${admin.massTarget === 'online' ? 'у всех онлайн' : 'у ВСЕХ'}?`,
    text: `Это ${n} ${n === 1 ? 'игрок' : n < 5 ? 'игрока' : 'игроков'}. В чате зала появится сообщение.`,
    ok: sign > 0 ? 'Дать' : 'Забрать',
    danger: sign < 0,
  });
  if (yes) run('/grant', { amount: sign * amount, target: admin.massTarget }, grantText);
}
$('mass-give').addEventListener('click', () => massGrant(1));
$('mass-take').addEventListener('click', () => massGrant(-1));
$('mass-take-all').addEventListener('click', async () => {
  const n = massCount();
  if (!n) return toast('Некому: никого нет', true);
  const everyone = admin.massTarget === 'all';
  const yes = await ask({
    title: everyone ? 'Обнулить ВСЕХ игроков?' : 'Обнулить всех онлайн?',
    text: `Баланс ${n} игроков станет 0. Фишки в играх останутся.`,
    ok: 'Забрать всё',
    type: everyone ? 'всё' : null,
  });
  if (yes) run('/grant', { amount: -MAX_CHIPS, target: admin.massTarget }, grantText);
});

// ---------- Поиск и фильтры ----------

$('pl-search').addEventListener('input', renderPlayers);
$('pl-search').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    const list = visiblePlayers();
    if (list.length === 1) selectPlayer(list[0].id);
  } else if (ev.key === 'Escape') {
    $('pl-search').value = '';
    renderPlayers();
  }
});
for (const b of $('pl-filters').children) {
  b.addEventListener('click', () => {
    admin.filter = b.dataset.filter;
    for (const x of $('pl-filters').children) x.classList.toggle('on', x === b);
    renderPlayers();
  });
}
document.addEventListener('keydown', (ev) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (ev.key === '/' && !typing && !$('panel').hidden) {
    ev.preventDefault();
    if (admin.tab !== 'players') location.hash = 'players';
    $('pl-search').focus();
  } else if (ev.key === 'Escape' && !typing && admin.selected && !$('ask').open) {
    selectPlayer(null);
  }
});

// ---------- Игры ----------

function pill(id, text) {
  const el = $(id);
  el.textContent = text || 'честно';
  el.className = text ? 'pill rigged' : 'pill fair';
}
function seg(id, attr, value) {
  for (const b of $(id).children) b.classList.toggle('on', (b.dataset[attr] || null) === (value === null || value === undefined ? null : String(value)));
}
function feed(id, items, map, emptyText, limit = 8) {
  const list = items.slice(0, limit);
  fill($(id), JSON.stringify(list), () => (list.length ? list.map(map) : [emptyLi(emptyText)]));
}
const round = (r) => (r.round === 'current' ? 'в этом' : 'в следующем');

// Все подкрутки разом — полоска сверху раздела «Игры».
function activeRigs() {
  const d = admin.data;
  const names = new Map(d.players.map((p) => [p.id, p.name]));
  const out = [];
  if (d.crash.rigged) out.push(['g-crash', `📈 Краш на ${d.crash.rigged.toFixed(2)}×`]);
  if (d.roulette.rigged !== null) out.push(['g-roulette', `🎡 Рулетка: ${d.roulette.rigged}`]);
  if (d.wheel && d.wheel.rigged !== null) out.push(['g-wheel', `🎰 Колесо: ${fwLabel(d.wheel.rigged)}`]);
  if (d.bomb.rigged !== null) out.push(['g-bomb', `💣 Бомба при ≥ ${chips(d.bomb.rigged)}`]);
  for (const r of d.poker.rigged) out.push(['g-poker', `🃏 ${names.get(r.id) || r.id}: ${r.cards.map(cardText).join(' ')}`]);
  if (d.upgrader.rigged) out.push(['g-upgrader', `⬆️ Апгрейд: ${d.upgrader.rigged === 'win' ? 'выиграет' : 'проиграет'}`]);
  if (d.verity.rigged) out.push(['g-verity', `😊 Верити: ${d.verity.rigged === 'good' ? 'добрый' : 'злой'}`]);
  if (d.mines && d.mines.rigged) out.push(['g-mines', '💥 Мины: следующий клик — мина']);
  if (d.blackjack && d.blackjack.rigged) out.push(['g-blackjack', `🂡 Блэкджек: ${BJ_RIG[d.blackjack.rigged]}`]);
  if (d.bjTable && d.bjTable.rigged) out.push(['g-bjtable', `🪑 Стол 21: ${BJT_RIG[d.bjTable.rigged]}`]);
  if (d.plinko && d.plinko.rigged) out.push(['g-plinko', '🔺 Плинко: в край']);
  if (d.kraken && d.kraken.rigged) out.push(['g-kraken', `🐙 Кракен: ${KR_RIG[d.kraken.rigged]}`]);
  if (d.saloon && d.saloon.rigged) out.push(['g-saloon', `🤠 Салун: ${SL_RIG[d.saloon.rigged]}`]);
  if (d.yokai && d.yokai.rigged) out.push(['g-yokai', `🦊 Парад: ${YK_RIG[d.yokai.rigged] || d.yokai.rigged}`]);
  if (d.circus && d.circus.rigged) out.push(['g-circus', `🎪 Цирк: ${CC_RIG[d.circus.rigged] || d.circus.rigged}`]);
  const lucky = d.players.filter((p) => p.luck);
  if (lucky.length) out.push(['luck', `🍀 Везение: ${lucky.map((p) => `${p.name} ${p.luck}%`).join(', ')}`]);
  return out;
}

function renderRigStrip(rigs) {
  fill($('rig-strip'), JSON.stringify(rigs), () => [
    h('span', { className: 'rs-label' }, rigs.length ? 'Подкручено сейчас' : 'Всё честно'),
    ...(rigs.length
      ? rigs.map(([target, text]) => h('button', {
        type: 'button',
        className: 'fchip hot',
        onclick: () => {
          if (target === 'luck') { admin.filter = 'lucky'; for (const x of $('pl-filters').children) x.classList.toggle('on', x.dataset.filter === 'lucky'); location.hash = 'players'; return; }
          const el = $(target);
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
        },
      }, text))
      : [h('span', { className: 'rs-note' }, 'ни одной подкрутки: все игры идут по честному рандому')]),
  ]);
}

function renderCrash() {
  const c = admin.data.crash;
  $('c-phase').textContent = PHASES[c.phase] || c.phase;
  $('c-mult').textContent = `${c.multiplier.toFixed(2)}×`;
  $('c-point').textContent = `${c.crashPoint.toFixed(2)}×`;
  pill('c-pill', c.rigged ? `${c.rigged.toFixed(2)}×` : null);
  $('crash-now').disabled = c.phase !== 'running';
  feed('c-bets', c.players, (b) => li(`${b.name}: ${chips(b.amount)}${b.cashout ? ` → забрал на ${b.cashout.toFixed(2)}× (+${chips(b.payout - b.amount)})` : ''}`), 'Ставок нет', 20);
}

const ROULETTE_BETS = {
  red: 'красное', black: 'чёрное', even: 'чёт', odd: 'нечёт', low: '1-18', high: '19-36',
  dozen1: '1-12', dozen2: '13-24', dozen3: '25-36', column1: 'кол.1', column2: 'кол.2', column3: 'кол.3',
};
function renderRoulette() {
  const r = admin.data.roulette;
  $('r-phase').textContent = PHASES[r.phase] || r.phase;
  // Админ видит номер с начала вращения (до этого он ещё не выбран).
  $('r-number').textContent = r.result === null ? '—' : r.result;
  $('r-total').textContent = chips(r.players.reduce((s, p) => s + p.total, 0));
  pill('r-pill', r.rigged === null ? null : `номер ${r.rigged}`);
  const label = (b) => (b.type === 'straight' ? `№${b.number}` : ROULETTE_BETS[b.type]);
  feed('r-bets', r.players, (p) => li(`${p.name}: ${p.bets.map((b) => `${label(b)} ${chips(b.amount)}`).join(', ')}${p.won !== null ? ` → ${p.won ? `+${chips(p.won - p.total)}` : `−${chips(p.total)}`}` : ''}`), 'Ставок нет', 20);
}

function renderWheel() {
  const w = admin.data.wheel;
  $('g-wheel').hidden = !w;
  if (!w) return;
  $('fw-phase').textContent = PHASES[w.phase] || w.phase;
  $('fw-mult').textContent = w.mult === null ? '—' : fwLabel(w.mult);
  $('fw-total').textContent = chips(w.players.reduce((s, p) => s + p.total, 0));
  pill('fw-pill', w.rigged === null ? null : fwLabel(w.rigged));
  seg('fw-seg', 'fwrig', w.rigged);
  feed('fw-bets', w.players, (p) => li(`${p.name}: ${Object.entries(p.stakes).map(([m, a]) => `×${m} ${chips(a)}`).join(', ')}${p.won !== null ? ` → ${p.won ? `+${chips(p.won - p.total)}` : `−${chips(p.total)}`}` : ''}`), 'Ставок нет', 20);
}

function renderBomb() {
  const b = admin.data.bomb;
  $('bo-phase').textContent = PHASES[b.phase] || b.phase;
  $('bo-bank').textContent = chips(b.bank);
  $('bo-fuse').textContent = b.fuse === null ? '—' : chips(b.fuse);
  pill('bo-pill', b.rigged === null ? null : `≥ ${chips(b.rigged)}`);
  const status = { in: '', out: ' · сбежал', boom: ' · 💥' };
  feed('bo-players', b.players, (p) => li(`${p.id === b.turn ? '🔥 ' : ''}${p.name}: вложил ${chips(p.contributed)}${status[p.status] || ''}${p.payout ? ` → +${chips(p.payout)}` : ''}`), 'Никого', 20);
}

// «Ah» → «A♥»
function cardText(c) {
  return c[0].replace('T', '10') + ({ s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]] || c[1] || '');
}

function renderPoker() {
  const v = admin.data.poker;
  $('p-phase').textContent = PHASES[v.phase] || v.phase;
  $('p-pot').textContent = chips(v.pot);
  $('p-board').textContent = v.board.length ? v.board.map(cardText).join(' ') : '—';
  const names = new Map(admin.data.players.map((p) => [p.id, p.name]));
  pill('p-pill', v.rigged.length ? `карты: ${v.rigged.length}` : null);
  $('p-rigged').textContent = v.rigged.length
    ? `Подкручено: ${v.rigged.map((r) => `${names.get(r.id) || r.id} → ${r.cards.map(cardText).join(' ')}`).join(', ')}`
    : 'Карты на следующую раздачу любому игроку. Можно и из карточки игрока.';

  const seats = v.seats.filter(Boolean);
  feed('p-seats', seats, (s) => h('li', null,
    h('span', { className: 'name' }, `${s.name} · ${chips(s.stack)}${s.folded ? ' · пас' : ''}${s.connected ? '' : ' · нет связи'}`),
    s.hole ? h('span', { className: 'cards-text' }, s.hole.map(cardText).join(' ') + (s.hand ? ` · ${s.hand}` : '')) : null), 'За столом никого', 20);

  // Список для подкрутки: сидящие за столом сверху, дальше все остальные.
  const sel = $('p-rig-player');
  const seated = new Set(seats.map((s) => s.id));
  const opts = [...admin.data.players].sort((a, b) => seated.has(b.id) - seated.has(a.id));
  const key = opts.map((p) => `${p.id}:${p.name}:${seated.has(p.id)}`).join('|');
  if (sel.dataset.key !== key) {
    const keep = sel.value;
    sel.dataset.key = key;
    sel.replaceChildren(h('option', { value: '' }, 'Кому…'), ...opts.map((p) => h('option', { value: p.id }, `${seated.has(p.id) ? '🪑 ' : ''}${p.name}`)));
    sel.value = keep;
  }
}

function renderUpgrader() {
  const u = admin.data.upgrader;
  pill('up-pill', u.rigged === 'win' ? 'выиграет' : u.rigged === 'lose' ? 'проиграет' : null);
  seg('up-seg', 'uprig', u.rigged);
  feed('up-feed', u.feed, (e) => li(`${e.name}: ${chips(e.amount)} на ${e.chance}% → ${e.win ? '+' + chips(e.payout - e.amount) : '−' + chips(e.amount)}`), 'Пока никто не апгрейдился');
}

function renderVerity() {
  const v = admin.data.verity;
  pill('vt-pill', v.rigged === 'good' ? 'добрый 😊' : v.rigged === 'evil' ? 'злой 😈' : null);
  seg('vt-seg', 'vtrig', v.rigged);
  feed('vt-feed', v.feed, (e) => li(`${e.good ? '😊' : '😈'} ${e.name}: ${e.good ? '+' : '−'}${chips(e.amount)}`), 'Пока никого не проверял');
}

function renderMines() {
  const m = admin.data.mines;
  $('g-mines').hidden = !m;
  if (!m) return;
  pill('mn-pill', m.rigged === 'boom' ? 'мина' : null);
  seg('mn-seg', 'mnrig', m.rigged);
  const rows = [
    ...m.playing.map((g) => ({ live: true, text: `▶ ${g.name}: ставка ${chips(g.bet)}, мин ${g.mines}, открыто ${g.picks} (×${g.multiplier})` })),
    ...m.feed.slice(0, 6).map((e) => ({ text: `${e.name}: ${chips(e.bet)} → ${chips(e.payout)} (${e.mines} мин, ${e.picks} кл.)` })),
  ];
  feed('mn-list', rows, (r) => li(r.text, r.live ? 'live' : ''), 'В мины ещё никто не играл', 12);
}

const BJ_RIG = { blackjack: 'блэкджек с раздачи', win: 'выиграет', lose: 'проиграет' };
const BJ_RES = { win: 'выигрыш', blackjack: 'блэкджек', push: 'ничья', lose: 'проигрыш', bust: 'перебор' };

function renderBlackjack() {
  const b = admin.data.blackjack;
  $('g-blackjack').hidden = !b;
  if (!b) return;
  pill('bj-pill', b.rigged ? BJ_RIG[b.rigged] : null);
  seg('bj-seg', 'bjrig', b.rigged);
  $('bj-info').textContent = `В шузе ${b.shoe.left} карт из ${b.shoe.size}`;
  const rows = [
    ...b.playing.map((g) => ({ live: true, text: `▶ ${g.name}: ставка ${chips(g.bet)}, на руках ${g.hands.join(' и ')}, у дилера ${cardText(g.up)}` })),
    ...b.feed.slice(0, 6).map((e) => ({ text: `${e.name}: ${chips(e.bet)} → ${chips(e.payout)} (${e.natural ? 'блэкджек' : `${e.hands.map((h) => `${h.total} ${BJ_RES[h.result] || ''}`.trim()).join(', ')} · дилер ${e.dealer > 21 ? 'перебрал' : e.dealer}`})` })),
  ];
  feed('bj-feed', rows, (r) => li(r.text, r.live ? 'live' : ''), 'За столом блэкджека ещё никто не играл', 12);
}

const BJT_RIG = { bust: 'дилер переберёт', strong: 'дилер обыграет всех', blackjack: 'блэкджек дилеру' };
const BJT_PHASE = { idle: 'ждёт ставок', betting: 'приём ставок', dealing: 'раздача', playing: 'ходят игроки', dealer: 'ход дилера', results: 'итоги' };

function renderBjTable() {
  const t = admin.data.bjTable;
  $('g-bjtable').hidden = !t;
  if (!t) return;
  pill('bjt-pill', t.rigged ? BJT_RIG[t.rigged] : null);
  seg('bjt-seg', 'bjtrig', t.rigged);
  const seated = t.seats.filter(Boolean);
  $('bjt-info').textContent = `Раунд ${t.round}: ${BJT_PHASE[t.phase] || t.phase} · за столом ${seated.length} из 5 · в шузе ${t.shoe.left} карт`;
  const rows = [
    ...seated.map((x) => ({ live: true, text: `▶ ${x.name}${x.connected ? '' : ' (нет связи)'}: ${x.bet ? `ставка ${chips(x.bet)}` : 'без ставки'}${x.hands.length ? `, на руках ${x.hands.join(' и ')}` : ''}` })),
    ...t.feed.slice(0, 8).map((e) => ({ text: `${e.name}: ${chips(e.bet)} → ${chips(e.payout)} (${e.natural ? 'блэкджек' : `${e.hands.map((h) => `${h.total} ${BJ_RES[h.result] || ''}`.trim()).join(', ')} · дилер ${e.dealer > 21 ? 'перебрал' : e.dealer}`})` })),
  ];
  feed('bjt-feed', rows, (r) => li(r.text, r.live ? 'live' : ''), 'За общим столом ещё не играли', 14);
}

function renderPlinko() {
  const p = admin.data.plinko;
  $('g-plinko').hidden = !p;
  if (!p) return;
  pill('pk-pill', p.rigged === 'edge' ? 'в край' : null);
  seg('pk-seg', 'pkrig', p.rigged);
  $('pk-info').textContent = `В полёте шариков: ${p.inFlight}`;
  feed('pk-feed', p.feed, (e) => li(`${e.name}: ${chips(e.amount)} → ${chips(e.payout)} (×${e.multiplier}, ${e.rows} рядов)`), 'Шарики ещё никто не бросал');
}

function renderKraken() {
  const k = admin.data.kraken;
  $('g-kraken').hidden = !k;
  if (!k) return;
  pill('kr-pill', k.rigged ? KR_RIG[k.rigged] : null);
  seg('kr-seg', 'krrig', k.rigged);
  feed('kr-feed', k.feed, (e) => li(`${e.name}: ${chips(e.cost)} → ${chips(e.payout)} (×${e.mult}${e.bonus ? `, ${{ fs: 'фриспины', hw: 'сундук', both: 'сундук+фриспины' }[e.bonus]}` : ''})`), 'В Кракена ещё никто не играл');
}

function renderSaloon() {
  const s = admin.data.saloon;
  $('g-saloon').hidden = !s;
  if (!s) return;
  pill('sl-pill', s.rigged ? SL_RIG[s.rigged] : null);
  seg('sl-seg', 'slrig', s.rigged);
  feed('sl-feed', s.feed, (e) => li(`${e.name}: ${chips(e.cost)} → ${chips(e.payout)} (×${e.mult}${e.duel ? `, дуэль ${e.spins} вращ.` : ''})`), 'В Салун ещё никто не заходил');
}

function renderYokai() {
  const y = admin.data.yokai;
  $('g-yokai').hidden = !y;
  if (!y) return;
  pill('yk-pill', y.rigged ? (YK_RIG[y.rigged] || y.rigged) : null);
  seg('yk-seg', 'ykrig', y.rigged);
  feed('yk-feed', y.feed, (e) => li(`${e.name}: ${chips(e.cost)} → ${chips(e.payout)} (×${e.mult}${e.night ? ', ночь демонов' : ''}${e.mode === 'buy-bonus' ? ', купил бонус' : ''})`), 'На парад ещё никто не ходил');
}

function renderCircus() {
  const c = admin.data.circus;
  $('g-circus').hidden = !c;
  if (!c) return;
  pill('cc-pill', c.rigged ? (CC_RIG[c.rigged] || c.rigged) : null);
  seg('cc-seg', 'ccrig', c.rigged);
  feed('cc-feed', c.feed, (e) => li(`${e.name}: ${chips(e.cost)} → ${chips(e.payout)} (×${e.mult}${e.knives ? ', метатель ножей' : ''}${e.mode === 'buy-knives' ? ', купил бонус' : ''})`), 'В цирк ещё никто не заходил');
}

function renderDuels() {
  const { duel, pool } = admin.data;
  const rows = [
    ...(duel ? duel.duels.map((d) => `⚔️ ${DUEL_GAMES[d.game] || d.game}: ${d.players.map((p) => p.name).join(' vs ')} · ставка ${chips(d.stake)}${d.phase === 'over' ? ' · закончена' : ''}`) : []),
    ...(pool ? pool.matches.map((m) => `🎱 Пул: ${m.players.map((p) => p.name).join(' vs ')} · ставка ${chips(m.stake)} · удар ${m.shotNo}`) : []),
  ];
  $('g-duels').hidden = !duel && !pool;
  const invites = (duel ? duel.invites : 0) + (pool ? pool.invites : 0);
  feed('du-list', rows, (t) => li(t), invites ? `Сейчас никто не играет · приглашений: ${invites}` : 'Сейчас никто не играет', 12);
}

function renderGames(rigs) {
  renderRigStrip(rigs);
  renderCrash();
  renderRoulette();
  renderWheel();
  renderBomb();
  renderPoker();
  renderDuels();
  renderUpgrader();
  renderVerity();
  renderMines();
  renderBlackjack();
  renderBjTable();
  renderPlinko();
  renderKraken();
  renderSaloon();
  renderYokai();
  renderCircus();
}

function renderPranks() {
  const pr = admin.data.pranks;
  if (!pr) return;
  const parts = [];
  if (pr.chest) parts.push(`📦 лежит сундук на ${chips(pr.chest.amount)}`);
  if (pr.lottery) parts.push('🎟 лотерея крутится');
  if (pr.titles.length) parts.push(`👑 титулы: ${pr.titles.map((t) => `${t.name} — ${t.text}`).join(', ')}`);
  $('prank-status').textContent = parts.join(' · ') || 'Сейчас ничего не разыгрывается';
}

// ---------- Технический перерыв ----------
function renderMaintenance() {
  const m = admin.data.maintenance;
  if (!m) return;
  const until = m.on && m.until ? ` до ${new Date(m.until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : '';
  $('maint-pill').textContent = m.on ? `включён${until}` : 'выключен';
  $('maint-pill').className = m.on ? 'pill rigged' : 'pill fair';
  $('maint-on').textContent = m.on ? 'Обновить перерыв' : 'Включить перерыв';
  $('maint-off').disabled = !m.on;
  // Поля заполняем один раз, чтобы опрос не затирал то, что админ печатает.
  if (m.on && !admin.maintFilled) {
    admin.maintFilled = true;
    $('maint-text').value = m.text;
    $('maint-allow').value = m.allowNames.join(', ');
    if (m.until) $('maint-until').value = new Date(m.until).toTimeString().slice(0, 5);
  }
}

// «HH:MM» → ближайший такой момент (сегодня или завтра), мс; пусто → 0.
function nextTime(hhmm) {
  const [h, mi] = String(hhmm || '').split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(mi)) return 0;
  const d = new Date();
  d.setHours(h, mi, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

$('maint-on').addEventListener('click', () => {
  const allow = $('maint-allow').value.split(',').map((x) => x.trim()).filter(Boolean);
  admin.maintFilled = true;
  run('/maintenance', { on: true, text: $('maint-text').value, until: nextTime($('maint-until').value), allow }, 'Перерыв включён: ставки закрыты, у всех заставка');
});
$('maint-off').addEventListener('click', async () => {
  const r = await run('/maintenance', { on: false }, 'Перерыв выключен, зал снова открыт');
  if (r) {
    admin.maintFilled = false;
    $('maint-text').value = '';
    $('maint-until').value = '';
    $('maint-allow').value = '';
  }
});

// ---------- Мероприятия ----------
const leftText = (until) => {
  const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
};
function renderEvents() {
  const ev = admin.data.events;
  if (!ev) return;
  const parts = [];
  if (ev.rain) parts.push(`🌧 идёт дождь, осталось монет: ${ev.rain.left}`);
  if (ev.quiz) parts.push(`❓ «${ev.quiz.question}» → ${ev.quiz.answer}, ещё ${leftText(ev.quiz.until)}`);
  if (ev.happy) parts.push(`⚡ ×${String(ev.happy.mult).replace('.', ',')} ещё ${leftText(ev.happy.until)}, доплачено ${chips(ev.happy.paid)}`);
  if (ev.race) {
    const top = ev.race.top.slice(0, 3).map((r, i) => `${i + 1}. ${r.name} ${r.net > 0 ? '+' : ''}${chips(r.net)}`).join(', ');
    parts.push(`🏁 гонка ещё ${leftText(ev.race.until)}${top ? `: ${top}` : ', пока никто не играл'}`);
  }
  $('ev-status').textContent = parts.join(' · ') || 'Сейчас мероприятий нет';
  $('ev-quiz-cancel').hidden = !ev.quiz;
  $('ev-happy-stop').hidden = !ev.happy;
  $('ev-race-finish').hidden = !ev.race;
}

for (const id of ['ev-rain-amount', 'ev-quiz-amount', 'ev-race-amount']) $(id).addEventListener('input', () => amountHint($(id)));
$('ev-rain-btn').addEventListener('click', () => {
  const amount = readAmount($('ev-rain-amount'));
  if (amount) run('/event/rain', { amount, seconds: Number($('ev-rain-sec').value) }, (r) => `Дождь пошёл: ${r.coins} монет`);
});
$('ev-quiz-btn').addEventListener('click', async () => {
  const amount = readAmount($('ev-quiz-amount'));
  if (!amount) return;
  const r = await run('/event/quiz', { question: $('ev-quiz-q').value, answer: $('ev-quiz-a').value, amount, seconds: Number($('ev-quiz-sec').value) }, 'Вопрос ушёл в чат');
  if (r) { $('ev-quiz-q').value = ''; $('ev-quiz-a').value = ''; }
});
$('ev-quiz-cancel').addEventListener('click', () => run('/event/quiz/cancel', {}, 'Викторина отменена'));
$('ev-happy-btn').addEventListener('click', () => {
  run('/event/happy', { mult: Number($('ev-happy-mult').value), minutes: Number($('ev-happy-min').value) }, 'Счастливый час включён');
});
$('ev-happy-stop').addEventListener('click', () => run('/event/happy/stop', {}, 'Счастливый час выключен'));
$('ev-race-btn').addEventListener('click', () => {
  const amount = readAmount($('ev-race-amount'));
  if (amount) run('/event/race', { amount, minutes: Number($('ev-race-min').value) }, 'Гонка началась');
});
$('ev-race-finish').addEventListener('click', async () => {
  if (await ask({ title: 'Закончить гонку?', text: 'Призы получат те, кто сейчас в тройке и в плюсе.', ok: 'Финиш' })) {
    run('/event/race/finish', {}, 'Гонка окончена');
  }
});

for (const id of ['chest-amount', 'lottery-amount']) $(id).addEventListener('input', () => amountHint($(id)));
$('chest-btn').addEventListener('click', () => {
  const amount = readAmount($('chest-amount'));
  if (amount) run('/chest', { amount, seconds: Number($('chest-sec').value) }, `Сундук на ${chips(amount)} упал в чат`);
});
$('lottery-btn').addEventListener('click', async () => {
  const amount = readAmount($('lottery-amount'));
  if (!amount) return;
  const online = admin.data.players.filter((p) => p.online).length;
  if (await ask({ title: 'Разыграть лотерею?', text: `Приз ${chips(amount)} получит один из ${online} игроков онлайн.`, ok: 'Разыграть' })) {
    run('/lottery', { amount }, (r) => `Лотерея запущена`);
  }
});
for (const text of TITLE_PRESETS) {
  $('pc-title-presets').append(h('button', { type: 'button', className: 'ghost fx-btn', onclick: () => { $('pc-title').value = text; } }, text));
}
$('pc-title-btn').addEventListener('click', () => {
  const p = selectedPlayer();
  if (!p) return toast('Сначала выбери игрока', true);
  const text = $('pc-title').value.trim();
  if (!text) return toast('Выбери титул или впиши свой', true);
  run('/title', { playerId: p.id, text, hours: Number($('pc-title-hours').value) }, `${p.name} теперь «${text}»`);
});
$('pc-title-clear').addEventListener('click', () => {
  const p = selectedPlayer();
  if (p) run('/title/clear', { playerId: p.id }, `Титул у ${p.name} снят`);
});

$('rig-crash').addEventListener('click', () => {
  const multiplier = Number($('rig-mult').value);
  if (!$('rig-mult').value) return toast('Впиши множитель, например 1.00 или 50', true);
  run('/crash/rig', { multiplier }, (r) => `Краш на ${multiplier.toFixed(2)}× ${round(r)} раунде`);
});
$('crash-now').addEventListener('click', async () => {
  if (!await ask({ title: 'Крашнуть сейчас?', text: 'Раунд закончится прямо сейчас: кто не успел забрать, проиграет ставку.', ok: 'Крашнуть' })) return;
  run('/crash/now', {}, (r) => `Крашнули на ${r.at.toFixed(2)}×`);
});
$('rig-roulette').addEventListener('click', () => {
  if ($('rig-number').value === '') return toast('Впиши номер 0-36', true);
  const number = Number($('rig-number').value);
  run('/roulette/rig', { number }, (r) => `Выпадет ${number} ${round(r)} вращении`);
});
$('rig-bomb').addEventListener('click', () => {
  const fuse = Math.floor(Number($('rig-fuse').value));
  run('/bomb/rig', { fuse }, (r) => `Рванёт при банке ≥ ${chips(fuse)} ${round(r)} раунде`);
});
$('p-rig-btn').addEventListener('click', () => {
  const p = admin.data && admin.data.players.find((x) => x.id === $('p-rig-player').value);
  if (!p) return toast('Выбери, кому подкрутить карты', true);
  rigCards(p, $('p-rig-cards').value).then((r) => { if (r) $('p-rig-cards').value = ''; });
});

// Кнопки-переключатели подкруток: data-атрибут → маршрут и текст.
const RIGS = [
  ['fw-seg', 'fwrig', (v) => run('/wheel/rig', { mult: Number(v) }, (r) => `Выпадет ${fwLabel(Number(v))} ${round(r)} вращении`)],
  ['up-seg', 'uprig', (v) => run('/upgrader/rig', { mode: v }, v === 'win' ? 'Следующий апгрейд выиграет' : v === 'lose' ? 'Следующий апгрейд проиграет' : 'Апгрейды снова честные')],
  ['vt-seg', 'vtrig', (v) => run('/verity/rig', { mode: v }, v === 'good' ? 'Верити будет добрым' : v === 'evil' ? 'Верити будет злым' : 'Верити снова честный')],
  ['mn-seg', 'mnrig', (v) => run('/mines/rig', { mode: v }, v ? 'Следующий клик в минах — мина' : 'Мины снова честные')],
  ['bj-seg', 'bjrig', (v) => run('/blackjack/rig', { mode: v }, v ? `Следующая раздача блэкджека: ${BJ_RIG[v]}` : 'Блэкджек снова честный')],
  ['bjt-seg', 'bjtrig', (v) => run('/bjtable/rig', { mode: v }, v ? `Следующий раунд за столом: ${BJT_RIG[v]}` : 'Стол блэкджека снова честный')],
  ['pk-seg', 'pkrig', (v) => run('/plinko/rig', { mode: v }, v ? 'Следующий шарик плинко упадёт в край' : 'Плинко снова честное')],
  ['kr-seg', 'krrig', (v) => run('/kraken/rig', { mode: v }, v ? `Следующий спин Кракена: ${KR_RIG[v]}` : 'Кракен снова честный')],
  ['sl-seg', 'slrig', (v) => run('/saloon/rig', { mode: v }, v ? `Следующий спин Салуна: ${SL_RIG[v]}` : 'Салун снова честный')],
  ['yk-seg', 'ykrig', (v) => run('/yokai/rig', { mode: v }, v ? `Следующий спин Ночного парада: ${YK_RIG[v]}` : 'Ночной парад снова честный')],
  ['cc-seg', 'ccrig', (v) => run('/circus/rig', { mode: v }, v ? `Следующий спин Заброшенного цирка: ${CC_RIG[v]}` : 'Цирк снова честный')],
];
for (const [id, attr, act] of RIGS) {
  for (const b of $(id).children) b.addEventListener('click', () => act(b.dataset[attr] || null));
}

// ---------- Музыка ----------

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
  const cur = m.current;
  $('m-autoplay').textContent = m.autoplay ? '🔀 Подряд: включено' : '🔀 Случайные подряд';
  $('m-autoplay').classList.toggle('on', m.autoplay);
  $('m-now').textContent = cur ? cur.title : 'Ничего не играет';
  $('m-pos').textContent = cur ? clock(cur.offset) : '';
  $('m-dur').textContent = cur && cur.duration ? clock(cur.duration) : '';
  $('m-bar').style.width = cur && cur.duration ? `${Math.min(100, (cur.offset / cur.duration) * 100)}%` : '0%';
  $('m-count').textContent = `${m.playlist.length} в папке`;

  // Кнопки треков перестраиваем, только когда поменялся состав папки.
  const list = $('m-list');
  fill(list, m.playlist.map((s) => s.id).join('|'), () => (m.playlist.length
    ? m.playlist.map((s) => h('button', {
      type: 'button',
      className: 'ghost song',
      dataset: { id: s.id, title: s.title.toLowerCase() },
      onclick: () => run('/music/play', { id: s.id }, `Играет: ${s.title}`),
    }, h('span', { className: 'song-ico' }, '▶'), h('span', { className: 'song-title' }, s.title)))
    : [h('p', { className: 'note' }, 'Папка music пустая. Положи туда mp3, и они появятся здесь.')]));
  const q = $('m-search').value.trim().toLowerCase();
  for (const b of list.querySelectorAll('.song')) {
    b.classList.toggle('playing', !!cur && cur.id === b.dataset.id);
    b.hidden = !!q && !b.dataset.title.includes(q);
  }
}
$('m-search').addEventListener('input', () => admin.data && renderMusic());

// Заказы песен от игроков: перестраиваем, только когда список поменялся (чтобы не сбивать выбор в select).
let lastRequestCount = 0;
function renderRequests() {
  const reqs = admin.data.requests;
  const box = $('m-requests');
  $('m-req-empty').hidden = reqs.length > 0;
  $('m-req-meta').textContent = reqs.length ? `ждут: ${reqs.length}` : '';
  const key = reqs.map((r) => `${r.id}:${r.trackId}`).join('|') + '#' + admin.data.music.playlist.length;
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (reqs.length > lastRequestCount) beepAdmin();
  lastRequestCount = reqs.length;

  box.replaceChildren(...reqs.map((r) => {
    const select = h('select', { 'aria-label': 'Трек для заказа' },
      h('option', { value: '' }, 'трек не найден, выбери'),
      ...admin.data.music.playlist.map((s) => h('option', { value: s.id }, s.title)));
    select.value = r.trackId || '';
    return h('div', { className: 'request' },
      h('div', { className: 'request-who' }, avatar(h('span', { className: 'avatar' }), r.name), h('b', null, r.name), h('span', null, `«${r.text}»`)),
      h('div', { className: 'inline' },
        select,
        h('button', {
          type: 'button',
          onclick: () => {
            if (!select.value) return toast('Выбери трек для заказа', true);
            run('/requests/approve', { id: r.id, trackId: select.value }, (x) => `Играет заказ ${r.name}: ${x.track.title}`);
          },
        }, '▶ Включить'),
        h('button', { type: 'button', className: 'ghost square', title: 'Отклонить', 'aria-label': 'Отклонить', onclick: () => run('/requests/reject', { id: r.id }, `Заказ ${r.name} отклонён`) }, '✕')));
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

$('m-random').addEventListener('click', () => run('/music/play', { id: 'random' }, (r) => `Играет: ${r.track.title}`));
$('m-stop').addEventListener('click', () => run('/music/stop', {}, 'Музыка выключена'));
$('m-autoplay').addEventListener('click', () => {
  const on = !(admin.data && admin.data.music.autoplay);
  run('/music/autoplay', { on }, on ? 'Играют случайные треки подряд' : 'Режим «подряд» выключен: текущий трек доиграет и всё');
});

// ---------- Зал ----------

function renderSeason() {
  const { season, unlockedTotal } = admin.data.season;
  const day = (t) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Europe/Moscow' });
  $('se-info').textContent = `Неделя ${day(season.startedAt)} – ${day(season.endsAt - 1)} · открыто достижений у всех: ${unlockedTotal} · в зале славы недель: ${season.hall.length}`;
  const top = season.top.slice(0, 5);
  fill($('se-top'), JSON.stringify(top), () => (top.length
    ? top.map((p) => h('li', null, h('span', { className: 'name' }, p.name), h('b', { className: p.net >= 0 ? 'up' : 'down' }, signed(p.net))))
    : [emptyLi('На этой неделе ещё никто не играл')]));
}

function renderChat() {
  const log = $('a-chat');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  const msgs = admin.data.chat;
  const before = log.dataset.key;
  fill(log, msgs.length + ':' + (msgs.length ? msgs[msgs.length - 1].at : ''), () => (msgs.length
    ? msgs.map((m) => h('li', { className: m.playerId === null ? 'system' : '' },
      h('span', { className: 'time' }, new Date(m.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })),
      h('span', { className: 'author' }, m.name),
      m.text))
    : [emptyLi('Пока тихо')]));
  if (atBottom || before === undefined) log.scrollTop = log.scrollHeight;
}

$('announce-banner').addEventListener('click', () => run('/announce', { text: $('announce').value, style: 'banner' }, 'Баннер показан всем онлайн'));
$('announce-chat').addEventListener('click', () => run('/announce', { text: $('announce').value, style: 'chat' }, 'Сообщение в чате'));

for (const box of document.querySelectorAll('.fx')) {
  for (const [effect, label] of EFFECTS) {
    box.append(h('button', {
      type: 'button',
      className: 'ghost fx-btn',
      onclick: () => {
        if (box.dataset.fxTarget !== 'player') return run('/effect', { effect, target: 'all' }, `${label} у всех!`);
        const p = selectedPlayer();
        if (!p) return toast('Сначала выбери игрока', true);
        run('/effect', { effect, target: p.id }, `${label} у ${p.name}`);
      },
    }, label));
  }
}

$('chat-clear').addEventListener('click', async () => {
  if (await ask({ title: 'Очистить чат?', text: 'Сообщения пропадут у всех игроков.', ok: 'Очистить' })) run('/chat/clear', {}, 'Чат очищен');
});
$('se-end').addEventListener('click', async () => {
  if (await ask({ title: 'Подвести итоги недели?', text: 'Тройка лучших уйдёт в зал славы, недельные очки обнулятся и начнётся новая неделя.', ok: 'Подвести итоги' })) {
    run('/season/end', {}, 'Итоги недели подведены, началась новая');
  }
});

// ---------- Сервер ----------

function renderServer() {
  const d = admin.data;
  const online = d.players.filter((p) => p.online).length;
  const sum = (key) => d.players.reduce((s, p) => s + p[key], 0);
  const kpis = [
    ['Онлайн', String(online)],
    ['Игроков всего', String(d.players.length)],
    ['Фишек у всех', chips(sum('capital'))],
    ['Сейчас в играх', chips(sum('reserved'))],
    ['Подкруток', String(activeRigs().length)],
    ['Заказов песен', String(d.requests.length)],
  ];
  fill($('srv-kpis'), JSON.stringify(kpis), () => kpis.map(([k, v]) => h('div', { className: 'kpi' }, h('span', null, k), h('b', null, v))));
  $('srv-token-state').textContent = admin.token ? 'На этом устройстве сохранён токен.' : 'Токен на этом устройстве не сохранён (вход с этого компьютера).';
  $('srv-logout').hidden = !admin.token;
}

$('srv-logout').addEventListener('click', () => {
  storage.remove(TOKEN_KEY);
  admin.token = null;
  toast('Токен забыт');
  poll();
});

$('srv-shutdown').addEventListener('click', async () => {
  const online = admin.data ? admin.data.players.filter((p) => p.online).length : 0;
  const yes = await ask({
    title: 'Выключить сервер?',
    text: `Зал закроется у всех${online ? ` (сейчас онлайн: ${online})` : ''}. Включить обратно отсюда не получится — только на компьютере с сервером.`,
    ok: 'Выключить',
    type: 'выключить',
  });
  if (yes) run('/shutdown', {}, 'Сервер выключается…');
});

// ---------- Отрисовка и опрос ----------

function render() {
  if (!admin.data) return;
  const rigs = activeRigs();
  const online = admin.data.players.filter((p) => p.online).length;
  $('b-players').textContent = online ? String(online) : '';
  $('b-games').textContent = rigs.length ? String(rigs.length) : '';
  $('b-music').textContent = admin.data.requests.length ? String(admin.data.requests.length) : '';
  document.title = admin.data.requests.length ? `(${admin.data.requests.length}) Админка зала` : 'Админка зала';

  reportAdminDuration(admin.data.music.current);
  renderRequests();   // всегда: сигнал о новом заказе звучит в любом разделе
  if (admin.tab === 'players') { renderPlayers(); renderPlayerCard(); }
  else if (admin.tab === 'games') renderGames(rigs);
  else if (admin.tab === 'music') renderMusic();
  else if (admin.tab === 'hall') { renderMaintenance(); renderSeason(); renderChat(); renderPranks(); renderEvents(); }
  else if (admin.tab === 'server') renderServer();
}

async function poll() {
  try {
    admin.data = await api('/state');
    $('auth').hidden = true;
    $('panel').hidden = false;
    $('tabs').hidden = false;
    $('conn').dataset.state = 'open';
    $('conn').textContent = 'на связи';
    render();
  } catch (err) {
    if (!$('auth').hidden) return;
    $('conn').dataset.state = 'closed';
    $('conn').textContent = 'сервер не отвечает';
  }
}

$('auth-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  admin.token = $('token').value.trim();
  storage.set(TOKEN_KEY, admin.token);
  $('auth').hidden = true;
  $('auth-error').textContent = '';
  poll().then(() => { if (!$('auth').hidden) $('auth-error').textContent = 'Токен не подошёл'; });
});

readHash();
poll();
setInterval(poll, POLL_MS);

// ---------- Приложение (PWA): админка ставится на ПК отдельным окном со своей иконкой ----------
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
  });
}
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  installPrompt = ev;
  $('adm-install').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  $('adm-install').hidden = true;
  toast('Админка установлена — ищи «Админка» в меню Пуск');
});
$('adm-install').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('adm-install').hidden = true;
});
