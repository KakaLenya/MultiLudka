// Блэкджек: стол на сукне, карты рисуются вёрсткой. Сервер присылает состояние раздачи (blackjack_state),
// а здесь разница доигрывается анимацией: карты летят из шуза, закрытая карта дилера переворачивается,
// дилер добирает по одной. Баланс придерживаем, пока анимация не дошла до итога.
(function () {
  'use strict';

  const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const rankText = (r) => (r === 'T' ? '10' : r);
  const BET_KEY = 'casino.blackjack.bet';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 60) : ms));
  const div = (cls, text) => Object.assign(document.createElement('div'), { className: cls }, text !== undefined ? { textContent: text } : {});
  const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls }, text !== undefined ? { textContent: text } : {});

  // Где лежат значки на числовых картах: доли ширины и высоты поля значков.
  const PIPS = {
    2: [[0.5, 0], [0.5, 1]],
    3: [[0.5, 0], [0.5, 0.5], [0.5, 1]],
    4: [[0, 0], [1, 0], [0, 1], [1, 1]],
    5: [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]],
    6: [[0, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
    7: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0, 1], [1, 1]],
    8: [[0, 0], [1, 0], [0.5, 0.25], [0, 0.5], [1, 0.5], [0.5, 0.75], [0, 1], [1, 1]],
    9: [[0, 0], [1, 0], [0, 1 / 3], [1, 1 / 3], [0.5, 0.5], [0, 2 / 3], [1, 2 / 3], [0, 1], [1, 1]],
    10: [[0, 0], [1, 0], [0.5, 1 / 6], [0, 1 / 3], [1, 1 / 3], [0, 2 / 3], [1, 2 / 3], [0.5, 5 / 6], [0, 1], [1, 1]],
  };

  const pts = (c) => (c[0] === 'A' ? 1 : 'TJQK'.includes(c[0]) ? 10 : Number(c[0]));
  function value(cards) {
    let total = 0;
    let ace = false;
    for (const c of cards) {
      total += pts(c);
      if (c[0] === 'A') ace = true;
    }
    const soft = ace && total + 10 <= 21;
    return { total: soft ? total + 10 : total, soft };
  }
  // Мягкая рука, по которой ещё решать, — «7 / 17»; у дилера и в итоге — просто сумма.
  const totalText = (cards, final) => {
    const v = value(cards);
    return v.soft && v.total < 21 && !final ? `${v.total - 10} / ${v.total}` : String(v.total);
  };

  const bj = {
    shown: null,        // что нарисовано: { id, hands: [[карта]], dealer: [карта | null] }
    state: { active: false },
    queue: Promise.resolve(),
    busy: false,        // идёт анимация
    awaiting: false,    // ждём ответа сервера
    held: null,         // придержанный баланс
    els: { dealer: [], hands: [] },
  };

  const shoeEl = $('bj-shoe');
  const dealerBox = $('bj-dealer');
  const handsBox = $('bj-hands');
  const msgEl = $('bj-msg');

  // ---------- Карты ----------

  function cardEl(card) {
    const el = div('bj-card down');
    const inner = div('bj-inner');
    inner.append(div('bj-front'), div('bj-back'));
    el.append(inner);
    if (card) paint(el, card);
    return el;
  }

  function paint(el, card) {
    const [r, s] = card;
    const front = el.querySelector('.bj-front');
    el.classList.toggle('red', s === 'h' || s === 'd');
    el.dataset.card = card;
    el.setAttribute('aria-label', `${rankText(r)}${SUIT[s]}`);
    const corner = (cls) => {
      const c = div(`bj-corner ${cls}`);
      c.append(span('bj-r', rankText(r)), span('bj-s', SUIT[s]));
      return c;
    };
    let mid;
    if (r === 'A') {
      mid = div('bj-ace', SUIT[s]);
    } else if ('JQK'.includes(r)) {
      mid = div('bj-face');
      mid.append(Object.assign(document.createElement('b'), { textContent: r }), Object.assign(document.createElement('i'), { textContent: SUIT[s] }));
    } else {
      mid = div('bj-pips');
      for (const [x, y] of PIPS[pts(card)]) {
        const p = span(`bj-pip${y > 0.5 ? ' flip' : ''}`, SUIT[s]);
        p.style.left = `${x * 100}%`;
        p.style.top = `${y * 100}%`;
        mid.append(p);
      }
    }
    front.replaceChildren(corner('tl'), mid, corner('br'));
  }

  const snap = () => beep([[1500, 0.025], [700, 0.035]], 'triangle');

  // Карта вылетает из шуза; лицом вверх переворачивается на лету.
  function flyIn(el, faceUp, from = shoeEl) {
    if (!reduced && el.animate) {
      const a = from.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      el.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(-28deg) scale(.6)`, opacity: 0 },
        { opacity: 1, offset: 0.2 },
        { transform: 'none', opacity: 1 },
      ], { duration: 440, easing: 'cubic-bezier(.17,.84,.32,1.06)' });
    }
    if (faceUp) setTimeout(() => el.classList.remove('down'), reduced ? 0 : 150);
    snap();
  }

  function flip(el, card) {
    paint(el, card);
    el.classList.remove('down');
    beep([[480, 0.04], [960, 0.06]]);
  }

  // ---------- Руки ----------

  function handBox() {
    const box = div('bj-hand');
    const cards = div('bj-cards');
    const tag = span('bj-tag');
    tag.hidden = true;
    const badge = span('bj-badge');
    badge.hidden = true;
    const bet = div('bj-bet');
    bet.append(span('bj-chip'), span('bj-bet-sum'));
    box.append(tag, cards, badge, bet);
    return { box, cards, tag, badge, bet, list: [] };
  }

  function setBadge(badge, cards, { natural = false, final = false } = {}) {
    badge.hidden = !cards.length;
    if (!cards.length) return;
    const t = value(cards).total;
    badge.textContent = natural ? 'Блэкджек' : totalText(cards, final);
    badge.className = `bj-badge${t > 21 ? ' bust' : natural ? ' bj' : t === 21 ? ' best' : ''}`;
  }

  function setBet(h, amount, doubled) {
    h.bet.querySelector('.bj-bet-sum').textContent = chips(amount);
    h.bet.classList.toggle('doubled', !!doubled);
  }

  function dealerBadge() {
    const shown = bj.els.dealer.filter((e) => e.dataset.card && !e.classList.contains('down')).map((e) => e.dataset.card);
    setBadge($('bj-dealer-total'), shown, { final: true });
  }

  function handCards(i) {
    return bj.els.hands[i].list.map((e) => e.dataset.card);
  }

  function addPlayerCard(i, card, animate) {
    const h = bj.els.hands[i];
    const el = cardEl(card);
    h.cards.append(el);
    h.list.push(el);
    if (animate) flyIn(el, true);
    else el.classList.remove('down');
    setBadge(h.badge, handCards(i));
  }

  function addDealerCard(card, animate) {
    const el = cardEl(card);
    dealerBox.append(el);
    bj.els.dealer.push(el);
    if (animate) flyIn(el, !!card);
    else if (card) el.classList.remove('down');
    if (card) setTimeout(dealerBadge, animate && !reduced ? 200 : 0);
  }

  function clearTable() {
    dealerBox.replaceChildren();
    handsBox.replaceChildren();
    bj.els = { dealer: [], hands: [] };
    $('bj-dealer-total').hidden = true;
  }

  // Старые карты уезжают в сброс.
  async function sweep() {
    const all = [...bj.els.dealer, ...bj.els.hands.flatMap((h) => h.list)];
    if (!all.length) return clearTable();
    if (!reduced) {
      all.forEach((el, k) => el.animate && el.animate([
        { transform: 'none', opacity: 1 },
        { transform: 'translate(-60vw, -40px) rotate(-40deg)', opacity: 0 },
      ], { duration: 380, delay: k * 25, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }));
      for (const h of bj.els.hands) h.bet.classList.add('gone');
      await sleep(380 + all.length * 25);
    }
    clearTable();
  }

  function setCurrent(s) {
    bj.els.hands.forEach((h, i) => h.box.classList.toggle('cur', s.active && bj.els.hands.length > 1 && s.cur === i));
  }

  // ---------- Пасхалка «сикс-севен» ----------
  // Шестёрка и сразу семёрка: сервер решает, что это первый раз у игрока (sixSeven: { hand, card }),
  // а здесь, когда семёрка легла на стол, — огромные 6 и 7 качаются, как ладони в меме, и надпись SIX SEVEN.

  function maybeSixSeven(s, hand, card) {
    const x = s.sixSeven;
    if (!x || x.hand !== hand || x.card !== card || bj.sixSevenRound === s.id) return;
    bj.sixSevenRound = s.id;
    setTimeout(sixSevenFx, reduced ? 0 : 420);
  }

  function sixSevenFx() {
    const layer = div('sixseven');
    layer.setAttribute('aria-hidden', 'true');
    // Сторона вылетает из-за края, внутри неё цифра на ладони качается вверх-вниз.
    const side = (cls, digit) => {
      const el = div(`ss-side ${cls}`);
      const bob = div('ss-bob');
      bob.append(span('ss-num', digit), span('ss-palm'));
      el.append(bob);
      return el;
    };
    const six = side('ss-left', '6');
    const seven = side('ss-right', '7');
    const title = div('ss-title');
    title.append(span('ss-w', 'SIX'), span('ss-w', 'SEVEN'));
    layer.append(div('ss-flash'), six, seven, title);
    document.body.append(layer);
    // «Сикс» — вниз, «се-вен» — вверх: три раза, как качают ладонями.
    const n = [[392, 0.11], [330, 0.09], [523, 0.16]];
    for (let k = 0; k < 3; k++) setTimeout(() => beep(n, 'square'), 420 + k * 560);
    setTimeout(() => beep([[110, 0.25]], 'sawtooth'), 120);
    if (!reduced) setTimeout(() => rain(['6️⃣', '7️⃣', '🤲'], 36), 300);
    setTimeout(() => layer.classList.add('out'), reduced ? 1600 : 2400);
    setTimeout(() => layer.remove(), reduced ? 1900 : 2800);
  }

  // ---------- Итог ----------

  const TAGS = { win: 'Выигрыш', blackjack: 'Блэкджек 3:2', push: 'Ничья', lose: 'Проигрыш', bust: 'Перебор' };

  function say(text, cls = '') {
    msgEl.textContent = text;
    msgEl.className = `bj-msg${cls ? ` ${cls}` : ''}`;
    if (cls && !reduced) {
      void msgEl.offsetWidth;
      msgEl.classList.add('pop');
    }
  }

  function resultText(s) {
    const net = s.net;
    const hands = s.hands;
    const d = s.dealer.total;
    if (hands[0].result === 'blackjack') return [`Блэкджек! +${chips(net)}`, 'win'];
    if (hands.length === 1 && hands[0].result === 'lose' && s.dealer.cards.length === 2 && d === 21) return [`У дилера блэкджек. −${chips(-net)}`, 'lose'];
    if (net > 0) return [d > 21 ? `Дилер перебрал! +${chips(net)}` : `Ты выиграл +${chips(net)}`, 'win'];
    if (net < 0) {
      if (hands.every((h) => h.result === 'bust')) return [`Перебор. −${chips(-net)}`, 'lose'];
      return [hands.some((h) => h.result === 'win') ? `Почти: −${chips(-net)}` : `Дилер сильнее. −${chips(-net)}`, 'lose'];
    }
    return ['Ничья — ставка вернулась', 'push'];
  }

  function showResult(s, quiet) {
    s.hands.forEach((h, i) => {
      const el = bj.els.hands[i];
      if (!el || !h.result) return;
      el.tag.textContent = TAGS[h.result];
      el.tag.className = `bj-tag ${h.result}`;
      el.tag.hidden = false;
      el.box.classList.toggle('lost', h.result === 'lose' || h.result === 'bust');
      setBadge(el.badge, h.cards, { natural: h.result === 'blackjack', final: true });
    });
    const [text, cls] = resultText(s);
    say(text, cls);
    if (quiet) return;
    if (s.hands[0].result === 'blackjack') effects.confetti();
    else if (cls === 'win') sounds.win();
    else if (cls === 'lose') sounds.lose();
    else beep([[440, 0.1], [440, 0.14]]);
  }

  // ---------- Проигрывание состояния ----------

  async function play(s) {
    bj.busy = true;
    renderControls();
    const sh = bj.shown;
    const animate = s.action !== undefined && !document.hidden;

    if (!s.id) {
      if (sh) await sweep();
      bj.shown = null;
      say('Сделай ставку — и карты пойдут');
      return;
    }

    if (!sh || sh.id !== s.id) {
      if (animate) await sweep();
      else clearTable();
      const h = handBox();
      handsBox.append(h.box);
      bj.els.hands.push(h);
      setBet(h, s.bet, false);
      if (animate && s.action === 'start') {
        say('Ставки сделаны');
        beep([[2200, 0.02], [2600, 0.03]], 'square');
        await sleep(220);
        // Как за столом: игроку, дилеру в открытую, игроку, дилеру рубашкой вверх.
        addPlayerCard(0, s.hands[0].cards[0], true);
        await sleep(300);
        addDealerCard(s.dealer.cards[0], true);
        await sleep(300);
        addPlayerCard(0, s.hands[0].cards[1], true);
        maybeSixSeven(s, 0, 1);
        await sleep(300);
        addDealerCard(null, true);
        await sleep(450);
        bj.shown = { id: s.id, hands: [s.hands[0].cards.slice(0, 2)], dealer: [s.dealer.cards[0], null] };
      } else {
        // Вход посреди раздачи: рисуем как есть.
        if (s.hands.length > 1) {
          const h2 = handBox();
          handsBox.append(h2.box);
          bj.els.hands.push(h2);
        }
        s.hands.forEach((hand, i) => {
          hand.cards.forEach((c) => addPlayerCard(i, c, false));
          setBet(bj.els.hands[i], hand.bet, hand.doubled);
        });
        s.dealer.cards.forEach((c) => addDealerCard(c, false));
        bj.shown = { id: s.id, hands: s.hands.map((x) => x.cards.slice()), dealer: s.dealer.cards.slice() };
        setCurrent(s);
        if (s.status === 'done') showResult(s, true);
        else say(turnText(s));
        return;
      }
    }

    const shown = bj.shown;
    // Сплит: вторая карта первой руки переезжает во вторую руку.
    if (s.hands.length > shown.hands.length) {
      const moved = bj.els.hands[0].list.pop();
      const h2 = handBox();
      handsBox.append(h2.box);
      bj.els.hands.push(h2);
      h2.cards.append(moved);
      h2.list.push(moved);
      if (!reduced && moved.animate) moved.animate([{ transform: 'translateX(-60%)', opacity: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'ease-out' });
      setBet(h2, s.hands[1].bet, false);
      setBadge(bj.els.hands[0].badge, handCards(0));
      setBadge(h2.badge, handCards(1));
      shown.hands = [shown.hands[0].slice(0, 1), [shown.hands[0][1]]];
      beep([[2200, 0.02], [2600, 0.03]], 'square');
      await sleep(360);
    }

    // Новые карты игроку.
    for (let i = 0; i < s.hands.length; i++) {
      const hand = s.hands[i];
      setBet(bj.els.hands[i], hand.bet, hand.doubled);
      for (let j = shown.hands[i].length; j < hand.cards.length; j++) {
        if (hand.doubled && j === 2) beep([[2200, 0.02], [2600, 0.03], [2400, 0.03]], 'square');
        addPlayerCard(i, hand.cards[j], animate);
        if (animate) maybeSixSeven(s, i, j);
        shown.hands[i].push(hand.cards[j]);
        if (animate) await sleep(380);
      }
      if (animate && value(hand.cards).total > 21 && s.hands.length > 1) {
        say(`Рука ${i + 1}: перебор`, 'lose');
        beep([[200, 0.15], [150, 0.2]], 'sawtooth');
        await sleep(400);
      }
    }
    setCurrent(s);

    // Ход дилера: переворот закрытой карты и добор по одной.
    if (s.dealer.cards[1] && !shown.dealer[1]) {
      if (animate) {
        say('Дилер открывает карту…');
        await sleep(420);
      }
      flip(bj.els.dealer[1], s.dealer.cards[1]);
      shown.dealer[1] = s.dealer.cards[1];
      setTimeout(dealerBadge, reduced ? 0 : 220);
      if (animate) await sleep(520);
      for (let j = 2; j < s.dealer.cards.length; j++) {
        if (animate) say('Дилер берёт…');
        addDealerCard(s.dealer.cards[j], animate);
        shown.dealer.push(s.dealer.cards[j]);
        if (animate) await sleep(620);
      }
      dealerBadge();
    }

    if (s.status === 'done') {
      setCurrent(s);
      showResult(s, !animate);
    } else {
      say(turnText(s));
    }
  }

  function turnText(s) {
    const h = s.hands[s.cur];
    const v = value(h.cards).total;
    const head = s.hands.length > 1 ? `Рука ${s.cur + 1} из ${s.hands.length}: ` : '';
    if (v <= 11) return `${head}смело бери ещё`;
    return `${head}ещё или хватит?`;
  }

  function apply(s) {
    bj.state = s;
    bj.awaiting = false;
    bj.queue = bj.queue.then(() => play(s)).catch((err) => console.error('blackjack:', err)).then(() => {
      bj.busy = false;
      renderControls();
      releaseHeld();
    });
  }

  // ---------- Кнопки ----------

  function renderControls() {
    const s = bj.state;
    const lock = bj.busy || bj.awaiting;
    // Пока дилер доигрывает, кнопки хода остаются на месте (выключенными) — ставка появится после итога.
    const playing = !!s.active || (lock && !$('bj-actions').hidden);
    $('bj-betbox').hidden = playing;
    $('bj-actions').hidden = !playing;
    $('blackjack').classList.toggle('playing', playing);
    $('bj-deal').disabled = lock;
    $('bj-amount').disabled = playing;
    $('bj-deal').textContent = s.status === 'done' ? '♠ Раздать ещё' : '♠ Раздать';
    const h = s.hands && s.hands[s.active ? s.cur : s.hands.length - 1];
    if (playing && h) {
      const a = s.actions || {};
      $('bj-hit').disabled = lock || !a.hit;
      $('bj-stand').disabled = lock || !a.stand;
      $('bj-double').disabled = lock || !a.double;
      $('bj-split').disabled = lock || !a.split;
      $('bj-double').querySelector('small').textContent = `+${chips(h.bet)} и одна карта`;
      $('bj-split').querySelector('small').textContent = `+${chips(h.bet)} на вторую руку`;
    }
    if (s.shoe) {
      $('bj-shoe-left').textContent = s.shoe.left;
      shoeEl.style.setProperty('--fill', String(Math.max(0.08, s.shoe.left / s.shoe.size)));
      shoeEl.title = `В шузе ${s.shoe.left} карт из ${s.shoe.size}: перемешаем, когда останется меньше четверти`;
    }
  }

  function act(type) {
    if (bj.busy || bj.awaiting || !bj.state.active) return;
    bj.awaiting = true;
    renderControls();
    send({ type });
  }

  async function deal() {
    if (bj.busy || bj.awaiting || bj.state.active) return;
    const amount = Math.floor(Number($('bj-amount').value) || 0);
    if (amount < 1) return toast('Ставка — от 1 фишки');
    if (amount > state.balance) return toast('Не хватает фишек');
    if (!await confirmBet({ key: 'blackjack', game: '🂡 Блэкджек', amount, input: $('bj-amount'), note: 'Удвоение и сплит попросят ещё столько же' })) return;
    storage.set(BET_KEY, String(amount));
    bj.awaiting = true;
    renderControls();
    send({ type: 'blackjack_start', amount });
  }

  $('bj-deal').addEventListener('click', deal);
  $('bj-hit').addEventListener('click', () => act('blackjack_hit'));
  $('bj-stand').addEventListener('click', () => act('blackjack_stand'));
  $('bj-double').addEventListener('click', () => act('blackjack_double'));
  $('bj-split').addEventListener('click', () => act('blackjack_split'));
  document.querySelectorAll('[data-bjq]').forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(1, Math.floor(Number($('bj-amount').value) || 1));
    const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.bjq];
    $('bj-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
  }));
  const saved = Number(storage.get(BET_KEY));
  if (saved >= 1) $('bj-amount').value = saved;

  // Клавиши: пробел или Enter — раздать, H — ещё, S — хватит, D — удвоить, P — сплит.
  document.addEventListener('keydown', (ev) => {
    if ($('blackjack').hidden || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
    if (!$('bet-confirm').hidden) return;
    const map = { KeyH: 'blackjack_hit', KeyS: 'blackjack_stand', KeyD: 'blackjack_double', KeyP: 'blackjack_split' };
    if (bj.state.active && map[ev.code]) {
      ev.preventDefault();
      act(map[ev.code]);
    } else if (!bj.state.active && (ev.code === 'Space' || ev.code === 'Enter') && document.activeElement.tagName !== 'BUTTON') {
      ev.preventDefault();
      deal();
    }
  });

  // ---------- Баланс, ошибки, лента ----------

  window.blackjackHoldsBalance = (msg) => {
    if (!bj.awaiting && !bj.busy) return false;
    bj.held = msg;
    return true;
  };
  function releaseHeld() {
    if (bj.busy || bj.awaiting) return;
    const m = bj.held;
    bj.held = null;
    if (m) handlers.balance(m);
  }

  window.blackjackOnError = (msg) => {
    if (!bj.awaiting || (msg.game && msg.game !== 'blackjack')) return;
    bj.awaiting = false;
    renderControls();
    releaseHeld();
  };

  function renderFeed(feed) {
    const myId = state.me && state.me.playerId;
    $('bj-feed').replaceChildren(...(feed.length ? feed.map((e) => {
      const li = document.createElement('li');
      li.className = e.payout > e.bet ? 'win' : e.payout === e.bet ? 'push' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: e.name });
      const what = Object.assign(document.createElement('span'), { className: 'u-what', textContent: `${chips(e.bet)} → ${chips(e.payout)}` });
      const hands = e.hands.map((h) => (h.total > 21 ? 'перебор' : `${h.total}${h.doubled ? '×2' : ''}`)).join(' · ');
      const m = Object.assign(document.createElement('span'), { className: 'u-ch', textContent: e.natural ? '🂡 блэкджек' : `${hands} vs ${e.dealer > 21 ? 'перебор' : e.dealer}` });
      li.append(name, what, m);
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'За столом ещё никто не играл' })]));
  }

  // Карты, их очки и анимации — общие с блэкджеком за столом (bjtable.js).
  window.BJCards = { cardEl, paint, value, totalText, flyIn, flip };

  handlers.blackjack_state = apply;
  handlers.blackjack_feed = (msg) => renderFeed(msg.feed);
  renderControls();
}());
