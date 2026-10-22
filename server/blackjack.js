// Блэкджек: один на один с дилером. Шуз из 6 колод на весь зал, перемешивается, когда в нём меньше четверти.
// Блэкджек платит 3:2, дилер добирает до 17 (на мягких 17 стоит). Удвоить можно на первых двух картах,
// разделить пару — один раз (тузы после сплита получают по одной карте). Страховки нет.
// Дилер с тузом или десяткой в открытую сразу проверяет блэкджек: если он есть, раздача кончается.
const { randomInt } = require('./rng');

const DECKS = 6;
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const SHOE_SIZE = DECKS * 52;
const RESHUFFLE_AT = SHOE_SIZE / 4;     // меньше четверти шуза — новый шуз
const MIN_BET = 1;
const FEED_SIZE = 20;
const SEARCH_LIMIT = 50_000;            // предел перебора добора дилера при подкрутке
// Сколько у игрока длится анимация до итога: раздача, переворот закрытой карты, каждая карта дилера.
const REVEAL_MS = { deal: 1600, step: 400, flip: 950, card: 620 };

// Очки карты: туз — 1 (мягкие 11 считает handValue), картинки — 10.
const pointsOf = (card) => (card[0] === 'A' ? 1 : 'TJQK'.includes(card[0]) ? 10 : Number(card[0]));

function totalOfPoints(points) {
  let total = 0;
  let ace = false;
  for (const p of points) {
    total += p;
    if (p === 1) ace = true;
  }
  const soft = ace && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

// { total, soft }: soft — туз считается за 11.
const handValue = (cards) => totalOfPoints(cards.map(pointsOf));
const isNatural = (cards) => cards.length === 2 && handValue(cards).total === 21;
// Открытая карта и закрытая вместе дали бы блэкджек.
const makesNatural = (a, b) => (pointsOf(a) === 1 && pointsOf(b) === 10) || (pointsOf(a) === 10 && pointsOf(b) === 1);

// Выплата руки (вместе со ставкой) против итога дилера; dealerTotal > 21 — дилер перебрал.
function handPayout(hand, dealerTotal) {
  const t = handValue(hand.cards).total;
  if (t > 21) return { result: 'bust', payout: 0 };
  if (dealerTotal > 21 || t > dealerTotal) return { result: 'win', payout: hand.bet * 2 };
  if (t === dealerTotal) return { result: 'push', payout: hand.bet };
  return { result: 'lose', payout: 0 };
}

// Блэкджек 3:2: ставка + полторы ставки (вниз до целого).
const naturalPayout = (bet) => bet + Math.floor((bet * 3) / 2);

function createBlackjack({
  store,
  onEvent = () => {},
  onFeed = () => {},
  now = Date.now,
  randInt = (n) => randomInt(0, n - 1),
  lucky = () => false,
  schedule = (fn, ms) => setTimeout(fn, ms),
  revealMs = REVEAL_MS,
}) {
  const games = new Map();   // playerId -> раздача
  const announcing = new Set();   // объявления итогов, которые ждут конца анимации у игрока
  const feed = [];
  let shoe = [];             // карты берутся с конца
  let rigged = null;         // админ: 'win' | 'lose' | 'blackjack' для следующей раздачи любого игрока
  let seq = 0;

  function newShoe() {
    shoe = [];
    for (let d = 0; d < DECKS; d++) for (const r of RANKS) for (const s of SUITS) shoe.push(r + s);
    for (let i = shoe.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
    }
  }
  newShoe();

  const draw = () => shoe.pop();
  // Верхняя карта шуза, подходящая под условие (для подкрутки и везения); нет такой — просто верхняя.
  function drawWhere(ok) {
    for (let i = shoe.length - 1; i >= 0; i--) {
      if (ok(shoe[i])) return shoe.splice(i, 1)[0];
    }
    return draw();
  }
  // Случайная карта с нужными очками.
  function pullPoints(p) {
    const at = [];
    for (let i = 0; i < shoe.length; i++) if (pointsOf(shoe[i]) === p) at.push(i);
    return shoe.splice(at[randInt(at.length)], 1)[0];
  }

  const value = (h) => handValue(h.cards).total;
  const current = (g) => g.hands[g.cur];
  const staked = (g) => g.hands.reduce((s, h) => s + h.bet, 0);

  function view(player) {
    const g = games.get(player.id);
    if (!g) return { active: false, shoe: { left: shoe.length, size: SHOE_SIZE } };
    const playing = g.status === 'playing';
    const h = playing ? current(g) : null;
    const dealerCards = g.hideHole ? [g.dealer[0], null] : g.dealer.slice();
    const dv = handValue(dealerCards.filter(Boolean));
    const canAfford = h && player.balance >= h.bet;
    return {
      active: playing,
      id: g.id,
      status: g.status,
      bet: g.bet,
      cur: playing ? g.cur : null,
      hands: g.hands.map((x) => ({
        cards: x.cards.slice(),
        bet: x.bet,
        total: value(x),
        soft: handValue(x.cards).soft,
        doubled: x.doubled,
        done: x.done,
        result: x.result,
        payout: x.payout,
      })),
      dealer: { cards: dealerCards, total: dv.total, soft: dv.soft },
      actions: {
        hit: !!h && !h.splitAces,
        stand: !!h,
        double: !!h && h.cards.length === 2 && !h.splitAces && canAfford,
        split: !!h && g.hands.length === 1 && h.cards.length === 2 && pointsOf(h.cards[0]) === pointsOf(h.cards[1]) && canAfford,
      },
      payout: g.payout,
      net: playing ? null : g.payout - staked(g),
      shoe: { left: shoe.length, size: SHOE_SIZE },
    };
  }

  function start(player, amount) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    const cur = games.get(player.id);
    if (cur && cur.status === 'playing') return { error: 'Сначала доиграй раздачу' };
    if (cur && cur.announce) cur.announce();   // новая раздача раньше конца анимации: итог прошлой — сразу
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    if (shoe.length < 20) newShoe();

    let mode = rigged;
    rigged = null;
    if (!mode && lucky(player)) mode = 'win';
    // Подкрутка выбрала все тузы из шуза — новый шуз, иначе блэкджек не собрать.
    if (mode === 'blackjack' && !shoe.some((c) => c[0] === 'A')) newShoe();

    // Раздача как за столом: игроку, дилеру в открытую, игроку, дилеру в закрытую.
    let p1;
    let p2;
    if (mode === 'blackjack') {
      const aceFirst = randInt(2) === 0;
      p1 = drawWhere((c) => (aceFirst ? pointsOf(c) === 1 : pointsOf(c) === 10));
      p2 = drawWhere((c) => (aceFirst ? pointsOf(c) === 10 : pointsOf(c) === 1));
    } else {
      p1 = draw();
    }
    const up = draw();
    if (mode !== 'blackjack') p2 = mode === 'lose' ? drawWhere((c) => !makesNatural(p1, c)) : draw();
    const hole = mode === 'win' || mode === 'blackjack' ? drawWhere((c) => !makesNatural(up, c)) : draw();

    const g = {
      id: ++seq,
      bet: amount,
      mode,
      status: 'playing',
      hands: [{ cards: [p1, p2], bet: amount, doubled: false, done: false, splitAces: false, result: null, payout: 0 }],
      cur: 0,
      dealer: [up, hole],
      hideHole: true,
      payout: 0,
      natural: false,
      startedAt: now(),
    };
    games.set(player.id, g);   // сначала раздача, потом списание: капитал в рассылке уже верный
    store.adjust(player, -amount);

    const playerBJ = isNatural(g.hands[0].cards);
    const peek = [1, 10].includes(pointsOf(up));
    const dealerBJ = peek && isNatural(g.dealer);
    if (playerBJ || dealerBJ) {
      const h = g.hands[0];
      h.done = true;
      g.natural = playerBJ;
      if (playerBJ && dealerBJ) Object.assign(h, { result: 'push', payout: h.bet });
      else if (playerBJ) Object.assign(h, { result: 'blackjack', payout: naturalPayout(h.bet) });
      else Object.assign(h, { result: 'lose', payout: 0 });
      g.dealerNatural = dealerBJ;
      g.dealtNow = true;
      finish(player, g);
    }
    return { ok: true, state: view(player) };
  }

  // Карта игроку: при подкрутке на выигрыш (и везении) — без перебора, если такая есть.
  function drawFor(g, hand) {
    if (g.mode === 'win') return drawWhere((c) => handValue([...hand.cards, c]).total <= 21);
    return draw();
  }

  // Рука доиграна — к следующей; все доиграны — ход дилера.
  function advance(player, g) {
    while (g.cur < g.hands.length && g.hands[g.cur].done) g.cur++;
    if (g.cur < g.hands.length) return;
    g.cur = g.hands.length - 1;
    dealerTurn(g);
    finish(player, g);
  }

  function markDone(h) {
    if (value(h) >= 21) h.done = true;
  }

  function act(player, fn) {
    const g = games.get(player.id);
    if (!g || g.status !== 'playing') return { error: 'Раздача не начата' };
    const err = fn(g, current(g));
    if (err) return { error: err };
    advance(player, g);
    return { ok: true, state: view(player) };
  }

  const hit = (player) => act(player, (g, h) => {
    if (h.splitAces) return 'На тузах после сплита — только одна карта';
    h.cards.push(drawFor(g, h));
    markDone(h);
    return null;
  });

  const stand = (player) => act(player, (g, h) => {
    h.done = true;
    return null;
  });

  const double = (player) => act(player, (g, h) => {
    if (h.cards.length !== 2 || h.splitAces) return 'Удвоить можно только на первых двух картах';
    if (player.balance < h.bet) return 'Не хватает фишек на удвоение';
    const add = h.bet;
    h.bet += add;              // сначала ставка в руке, потом списание: капитал не скачет
    h.doubled = true;
    store.adjust(player, -add);
    h.cards.push(drawFor(g, h));
    h.done = true;
    return null;
  });

  const split = (player) => act(player, (g, h) => {
    if (g.hands.length > 1) return 'Разделить можно только один раз';
    if (h.cards.length !== 2 || pointsOf(h.cards[0]) !== pointsOf(h.cards[1])) return 'Разделить можно только пару';
    if (player.balance < h.bet) return 'Не хватает фишек на сплит';
    const aces = pointsOf(h.cards[0]) === 1;
    const second = { cards: [h.cards.pop()], bet: h.bet, doubled: false, done: false, splitAces: aces, result: null, payout: 0 };
    h.splitAces = aces;
    g.hands.push(second);
    store.adjust(player, -second.bet);
    for (const x of g.hands) {
      x.cards.push(drawFor(g, x));
      if (aces) x.done = true;
      else markDone(x);
    }
    return null;
  });

  // Дилер открывает закрытую карту и добирает до 17. Если все руки перебрали — не добирает.
  function dealerTurn(g) {
    g.hideHole = false;
    if (g.hands.every((h) => value(h) > 21)) return;
    if (g.mode === 'win' || g.mode === 'lose') steerDealer(g, g.mode);
    while (handValue(g.dealer).total < 17) g.dealer.push(draw());
  }

  // Подкрутка: какие карты пришли бы дилеру, выбираем перебором по тому, что лежит в шузе.
  // Закрытую карту тоже — её ещё никто не видел (но блэкджека у дилера быть не может: он уже проверял).
  function steerDealer(g, goal) {
    shoe.splice(randInt(shoe.length + 1), 0, g.dealer.pop());
    const upP = pointsOf(g.dealer[0]);
    const counts = Array(11).fill(0);
    for (const c of shoe) counts[pointsOf(c)]++;
    const live = g.hands.filter((h) => value(h) <= 21);
    const score = (d) => {
      const paid = live.reduce((s, h) => s + handPayout(h, d).payout, 0);
      return goal === 'win' ? paid : -paid;
    };
    const target = goal === 'win' ? live.reduce((s, h) => s + h.bet * 2, 0) : 0;
    let best = null;
    let bestScore = -Infinity;
    let nodes = 0;
    const order = () => {
      const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      for (let i = a.length - 1; i > 0; i--) {
        const j = randInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const search = (pts) => {
      nodes++;
      const t = pts.length >= 2 ? totalOfPoints(pts).total : 0;
      if (pts.length >= 2 && t >= 17) {
        const s = score(t);
        if (s > bestScore) {
          bestScore = s;
          best = pts.slice();
        }
        return s >= target;
      }
      if (nodes > SEARCH_LIMIT) return true;
      for (const p of order()) {
        if (!counts[p]) continue;
        if (pts.length === 1 && ((upP === 1 && p === 10) || (upP === 10 && p === 1))) continue;
        counts[p]--;
        pts.push(p);
        const stop = search(pts);
        pts.pop();
        counts[p]++;
        if (stop) return true;
      }
      return false;
    };
    search([upP]);
    if (!best) {
      g.dealer.push(drawWhere((c) => !makesNatural(g.dealer[0], c)));
      return;
    }
    for (const p of best.slice(1)) g.dealer.push(pullPoints(p));
  }

  function finish(player, g) {
    g.hideHole = false;
    const d = handValue(g.dealer).total;
    if (!g.hands[0].result) {
      for (const h of g.hands) {
        h.done = true;
        Object.assign(h, handPayout(h, d));
      }
    }
    g.status = 'done';
    g.payout = g.hands.reduce((s, h) => s + h.payout, 0);
    if (shoe.length < RESHUFFLE_AT) newShoe();

    const stake = staked(g);
    const net = g.payout - stake;
    const entry = {
      id: g.id,
      playerId: player.id,
      name: player.name,
      bet: stake,
      payout: g.payout,
      hands: g.hands.map((h) => ({ total: value(h), result: h.result, doubled: h.doubled })),
      dealer: d,
      natural: g.natural,
      at: now(),
    };
    // Выплата, лента и достижения — когда у игрока карты долетят до итога: иначе рейтинг и всплывашки
    // выдадут исход раньше. До тех пор ставка числится «в игре», капитал не скачет.
    const announce = () => {
      if (g.announce !== announce) return;
      g.announce = null;
      announcing.delete(announce);
      if (g.payout > 0) store.adjust(player, g.payout);
      else store.notify(player);
      feed.unshift(entry);
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      if (net === 0) return;
      const hands = g.hands.map((h) => (value(h) > 21 ? 'перебор' : String(value(h)))).join(' и ');
      onEvent({
        game: 'blackjack',
        kind: net > 0 ? 'win' : 'lose',
        player,
        amount: Math.abs(net),
        note: g.natural ? 'блэкджек 3:2' : g.dealerNatural ? 'у дилера блэкджек' : `${hands} против ${d > 21 ? 'перебора' : d}`,
        meta: {
          stake,
          natural: g.natural,
          doubledWin: g.hands.some((h) => h.doubled && h.result === 'win'),
          splitWin: g.hands.length > 1 && g.hands.every((h) => h.result === 'win'),
        },
      });
    };
    g.announce = announce;
    announcing.add(announce);
    const ms = (g.dealtNow ? revealMs.deal : revealMs.step) + revealMs.flip + revealMs.card * Math.max(0, g.dealer.length - 2);
    schedule(announce, ms);
  }

  // Админ: исход следующей раздачи любого игрока. null = честно.
  function rig(mode) {
    if (!['win', 'lose', 'blackjack', null].includes(mode)) return { error: 'Режим: win, lose, blackjack или null' };
    rigged = mode;
    return { ok: true };
  }

  // Сервер останавливается: недоигранные руки стоят, дилер добирает, раздача рассчитывается.
  function settleAll() {
    for (const [id, g] of games) {
      if (g.status !== 'playing') continue;
      const player = store.get(id);
      if (!player) continue;
      for (const h of g.hands) h.done = true;
      dealerTurn(g);
      finish(player, g);
    }
    for (const announce of [...announcing]) announce();
  }

  return {
    start,
    hit,
    stand,
    double,
    split,
    rig,
    view,
    settleAll,
    forget: (playerId) => {
      const g = games.get(playerId);
      if (g && g.announce) {
        announcing.delete(g.announce);
        g.announce = null;
      }
      games.delete(playerId);
    },
    reserved: (player) => {
      const g = games.get(player.id);
      return g && (g.status === 'playing' || g.announce) ? staked(g) : 0;
    },
    feed: () => feed.slice(),
    adminState: () => ({
      rigged,
      shoe: { left: shoe.length, size: SHOE_SIZE },
      playing: [...games.entries()].filter(([, g]) => g.status === 'playing').map(([id, g]) => ({
        id,
        name: (store.get(id) || {}).name,
        bet: staked(g),
        hands: g.hands.map((h) => value(h)),
        up: g.dealer[0],
      })),
      feed: feed.slice(),
    }),
    // Для тестов: положить карты на верх шуза (первая в списке придёт первой).
    _stack: (cards) => { shoe.push(...cards.slice().reverse()); },
    _shoeSize: () => shoe.length,
  };
}

module.exports = { createBlackjack, handValue, isNatural, handPayout, naturalPayout, pointsOf, SHOE_SIZE, RESHUFFLE_AT };
