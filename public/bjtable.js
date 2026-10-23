// Блэкджек за общим столом: пять мест по дуге, дилер наверху, общий шуз. Сервер рассылает одно состояние
// на всех (bjt_state); здесь разница доигрывается анимацией: раздача по кругу, карты по ходу игроков,
// переворот закрытой карты и добор дилера. Карты рисует blackjack.js (window.BJCards).
(function () {
  'use strict';

  const C = window.BJCards;
  const SEATS = 5;
  const BET_KEY = 'casino.bjtable.bet';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? Math.min(ms, 60) : ms));
  const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text !== undefined ? { textContent: text } : {});

  const bt = {
    view: null,
    recvAt: 0,
    shown: { round: 0, seats: Array.from({ length: SEATS }, () => []), dealer: [] },
    pending: null,       // последнее состояние, которое ещё не нарисовано
    running: false,
    sent: false,         // ждём ответа на действие
    lastTurn: null,
    resultShown: 0,      // раунд, итог которого уже показан
  };
  const shoeEl = $('bjt-shoe');
  const dealerBox = $('bjt-dealer');
  const me = () => state.me && state.me.playerId;
  const mySeat = (v) => (v ? v.seats.findIndex((s) => s && s.playerId === me()) : -1);

  // ---------- Места ----------

  const seatEls = [];
  for (let i = 0; i < SEATS; i++) {
    const box = mk('div', `bjt-seat s${i}`);
    const hands = mk('div', 'bjt-hands');
    const plate = mk('div', 'bjt-plate');
    const name = mk('span', 'bjt-name');
    const bet = mk('span', 'bjt-betline');
    plate.append(name, bet);
    const sit = mk('button', 'ghost bjt-sit', 'Сесть');
    sit.type = 'button';
    sit.addEventListener('click', () => send({ type: 'bjt_sit', seat: i }));
    box.append(hands, plate, sit);
    $('bjt-seats').append(box);
    seatEls.push({ box, hands, plate, name, bet, sit, list: [] });
  }

  function handBox(i) {
    const h = { box: mk('div', 'bjt-hand'), cards: mk('div', 'bj-cards'), badge: mk('span', 'bj-badge'), tag: mk('span', 'bj-tag'), list: [] };
    h.badge.hidden = true;
    h.tag.hidden = true;
    h.box.append(h.tag, h.cards, h.badge);
    seatEls[i].hands.append(h.box);
    seatEls[i].list.push(h);
    return h;
  }

  function setBadge(badge, cards, { natural = false, final = false } = {}) {
    badge.hidden = !cards.length;
    if (!cards.length) return;
    const t = C.value(cards).total;
    badge.textContent = natural ? 'Блэкджек' : C.totalText(cards, final);
    badge.className = `bj-badge${t > 21 ? ' bust' : natural ? ' bj' : t === 21 ? ' best' : ''}`;
  }

  const handCards = (h) => h.list.map((e) => e.dataset.card);

  function addSeatCard(i, k, card, animate) {
    const seat = seatEls[i];
    const h = seat.list[k] || handBox(i);
    const el = C.cardEl(card);
    h.cards.append(el);
    h.list.push(el);
    if (animate) C.flyIn(el, true, shoeEl);
    else el.classList.remove('down');
    setBadge(h.badge, handCards(h));
  }

  const dealerEls = [];
  function addDealerCard(card, animate) {
    const el = C.cardEl(card);
    dealerBox.append(el);
    dealerEls.push(el);
    if (animate) C.flyIn(el, !!card, shoeEl);
    else if (card) el.classList.remove('down');
    dealerBadge();
  }
  function dealerBadge() {
    const open = dealerEls.filter((e) => e.dataset.card && !e.classList.contains('down')).map((e) => e.dataset.card);
    setBadge($('bjt-dealer-total'), open, { final: true });
  }

  function clearCards() {
    dealerBox.replaceChildren();
    dealerEls.length = 0;
    $('bjt-dealer-total').hidden = true;
    for (const s of seatEls) {
      s.hands.replaceChildren();
      s.list = [];
      s.box.classList.remove('won', 'lost');
    }
    bt.shown = { round: bt.shown.round, seats: Array.from({ length: SEATS }, () => []), dealer: [] };
  }

  async function sweep(animate) {
    const all = [...dealerEls, ...seatEls.flatMap((s) => s.list.flatMap((h) => h.list))];
    if (animate && all.length && !reduced) {
      all.forEach((el, k) => el.animate && el.animate([
        { transform: 'none', opacity: 1 },
        { transform: 'translate(-50vw, -60px) rotate(-40deg)', opacity: 0 },
      ], { duration: 360, delay: k * 18, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' }));
      await sleep(360 + all.length * 18);
    }
    clearCards();
  }

  // Нарисовать всё как есть, без анимации (вход посреди раунда, вкладка в фоне).
  function drawStatic(v) {
    clearCards();
    bt.shown.round = v.round;
    v.seats.forEach((s, i) => {
      if (!s) return;
      s.hands.forEach((h, k) => {
        handBox(i);
        h.cards.forEach((c) => addSeatCard(i, k, c, false));
      });
      bt.shown.seats[i] = s.hands.map((h) => h.cards.slice());
    });
    v.dealer.cards.forEach((c) => addDealerCard(c, false));
    bt.shown.dealer = v.dealer.cards.slice();
  }

  // ---------- Проигрывание состояния ----------

  async function sync(v) {
    const animate = !document.hidden && !$('bjtable').hidden;
    const sh = bt.shown;
    const hasCards = v.dealer.cards.length > 0;

    if (!hasCards) {
      if (sh.dealer.length) await sweep(animate);
      bt.shown.round = v.round;
      return;
    }

    if (v.round !== sh.round) {
      await sweep(animate && sh.dealer.length > 0);
      bt.shown.round = v.round;
      if (animate && v.phase === 'dealing') {
        // Раздача по кругу: всем по карте, дилеру, всем по второй, дилеру рубашкой.
        const order = v.seats.map((s, i) => (s && s.hands.length ? i : -1)).filter((i) => i >= 0);
        beep([[2200, 0.02], [2600, 0.03]], 'square');
        for (let k = 0; k < 2; k++) {
          for (const i of order) {
            addSeatCard(i, 0, v.seats[i].hands[0].cards[k], true);
            bt.shown.seats[i][0] = (bt.shown.seats[i][0] || []).concat(v.seats[i].hands[0].cards[k]);
            await sleep(280);
          }
          addDealerCard(k === 0 ? v.dealer.cards[0] : null, true);
          bt.shown.dealer.push(k === 0 ? v.dealer.cards[0] : null);
          await sleep(280);
        }
      } else {
        drawStatic(v);
        return;
      }
    }

    // Карты игроков по ходу раунда.
    for (let i = 0; i < SEATS; i++) {
      const s = v.seats[i];
      const shown = bt.shown.seats[i];
      if (!s || !s.hands.length) {
        if (shown.length) {
          seatEls[i].hands.replaceChildren();
          seatEls[i].list = [];
          bt.shown.seats[i] = [];
        }
        continue;
      }
      // Сплит: вторая карта переезжает во вторую руку.
      if (s.hands.length === 2 && shown.length === 1 && shown[0].length === 2) {
        const first = seatEls[i].list[0];
        const moved = first.list.pop();
        const h2 = handBox(i);
        h2.cards.append(moved);
        h2.list.push(moved);
        setBadge(first.badge, handCards(first));
        setBadge(h2.badge, handCards(h2));
        bt.shown.seats[i] = [[shown[0][0]], [shown[0][1]]];
        if (animate) {
          beep([[2200, 0.02], [2600, 0.03]], 'square');
          await sleep(300);
        }
      }
      const cur = bt.shown.seats[i];
      if (s.hands.length !== cur.length || s.hands.some((h, k) => cur[k].some((c, j) => h.cards[j] !== c))) {
        drawStatic(v);   // что-то разошлось — рисуем как есть
        break;
      }
      for (let k = 0; k < s.hands.length; k++) {
        for (let j = cur[k].length; j < s.hands[k].cards.length; j++) {
          addSeatCard(i, k, s.hands[k].cards[j], animate);
          cur[k].push(s.hands[k].cards[j]);
          if (animate) await sleep(320);
        }
      }
    }

    // Дилер: переворот и добор по одной.
    const d = v.dealer.cards;
    if (d[1] && !bt.shown.dealer[1]) {
      if (animate) {
        say('Дилер открывает карту…');
        await sleep(380);
      }
      if (dealerEls[1]) C.flip(dealerEls[1], d[1]);
      bt.shown.dealer[1] = d[1];
      setTimeout(dealerBadge, animate && !reduced ? 220 : 0);
      if (animate) await sleep(520);
      for (let j = 2; j < d.length; j++) {
        if (animate) say('Дилер берёт…');
        addDealerCard(d[j], animate);
        bt.shown.dealer.push(d[j]);
        if (animate) await sleep(600);
      }
      dealerBadge();
    }
  }

  async function pump() {
    if (bt.running) return;
    bt.running = true;
    try {
      while (bt.pending) {
        const v = bt.pending;
        bt.pending = null;
        await sync(v);
        renderSeats(v, true);
      }
    } catch (err) {
      console.error('bjtable:', err);
      if (bt.view) drawStatic(bt.view);
    } finally {
      bt.running = false;
      if (bt.view) renderSeats(bt.view, true);
      renderStatus();
    }
  }

  // ---------- Таблички мест, итоги ----------

  const TAGS = { win: 'Выигрыш', blackjack: 'Блэкджек 3:2', push: 'Ничья', lose: 'Проигрыш', bust: 'Перебор' };

  // after: карты уже долетели — можно показывать итоги.
  function renderSeats(v, after) {
    const mine = mySeat(v);
    const showResults = after && (v.phase === 'dealer' || v.phase === 'results') && bt.shown.dealer.length === v.dealer.cards.length;
    v.seats.forEach((s, i) => {
      const el = seatEls[i];
      el.box.classList.toggle('empty', !s);
      el.box.classList.toggle('me', !!s && s.playerId === me());
      el.box.classList.toggle('turn', v.phase === 'playing' && v.turn === i);
      el.box.classList.toggle('away', !!s && !s.connected);
      const between = v.phase === 'idle' || v.phase === 'betting';
      el.sit.hidden = !!s || (mine >= 0 && (!between || v.seats[mine].bet > 0));
      el.sit.textContent = mine >= 0 ? 'Пересесть' : 'Сесть';
      if (!s) {
        el.name.replaceChildren(mk('span', 'bjt-free', 'свободно'));
        el.bet.textContent = '';
        return;
      }
      el.name.replaceChildren(avatarEl(s.name), mk('span', 'bjt-nick', s.name));
      const tag = window.titleTag && window.titleTag(s.playerId);
      if (tag) el.name.append(tag);
      const stake = s.hands.length ? s.hands.reduce((x, h) => x + h.bet, 0) : s.bet;
      el.bet.replaceChildren();
      if (showResults && s.net !== null && s.paid) {
        el.bet.append(mk('b', s.net > 0 ? 'up' : s.net < 0 ? 'down' : 'even', s.net > 0 ? `+${chips(s.net)}` : s.net < 0 ? `−${chips(-s.net)}` : 'ставка назад'));
      } else if (stake) {
        el.bet.append(mk('span', 'bj-chip'), mk('span', '', chips(stake)));
      } else {
        el.bet.append(mk('span', 'bjt-wait', s.leaving ? 'уходит' : !s.connected ? 'нет связи' : v.phase === 'idle' || v.phase === 'betting' ? 'думает…' : 'смотрит'));
      }
      // Подсветка текущей руки и итоги рук.
      el.list.forEach((h, k) => {
        const hv = s.hands[k];
        h.box.classList.toggle('cur', v.phase === 'playing' && v.turn === i && s.hands.length > 1 && s.cur === k);
        if (showResults && hv && hv.result) {
          h.tag.textContent = TAGS[hv.result];
          h.tag.className = `bj-tag ${hv.result}`;
          h.tag.hidden = false;
          h.box.classList.toggle('lost', hv.result === 'lose' || hv.result === 'bust');
          setBadge(h.badge, hv.cards, { natural: hv.result === 'blackjack', final: true });
        } else {
          h.tag.hidden = true;
          h.box.classList.remove('lost');
        }
      });
    });
    if (showResults && v.phase === 'results' && bt.resultShown !== v.round) {
      bt.resultShown = v.round;
      const s = v.seats[mine];
      if (s && s.paid && s.net !== null) {
        if (s.natural && s.net > 0) effects.confetti();
        else if (s.net > 0) sounds.win();
        else if (s.net < 0) sounds.lose();
        else beep([[440, 0.1], [440, 0.14]]);
      }
    }
  }

  function say(text, cls = '') {
    const el = $('bjt-msg');
    if (el.textContent === text && el.className === `bj-msg${cls ? ` ${cls}` : ''}`) return;
    el.textContent = text;
    el.className = `bj-msg${cls ? ` ${cls}` : ''}`;
    if (cls && !reduced) {
      void el.offsetWidth;
      el.classList.add('pop');
    }
  }

  const timeLeft = () => (bt.view && bt.view.timeLeft !== null ? Math.max(0, bt.view.timeLeft - (performance.now() - bt.recvAt)) : 0);
  const secs = () => Math.ceil(timeLeft() / 1000);

  // Строка над местами, таймер, подсказка и кнопки — сразу по состоянию, без очереди анимаций.
  function renderStatus() {
    const v = bt.view;
    if (!v) return;
    const mine = mySeat(v);
    const s = mine >= 0 ? v.seats[mine] : null;
    const seated = v.seats.filter(Boolean).length;
    const animating = bt.running;

    // Сообщение на столе.
    if (!animating) {
      if (v.phase === 'idle') say(seated ? 'Делайте ставки' : 'Садись за стол — места свободны');
      else if (v.phase === 'betting') say(`Ставки: ${secs()} с`);
      else if (v.phase === 'dealing') say('Раздача…');
      else if (v.phase === 'playing') {
        const t = v.seats[v.turn];
        if (v.turn === mine) {
          const h = t.hands[t.cur];
          const head = t.hands.length > 1 ? `Рука ${t.cur + 1} из 2: ` : '';
          say(`${head}твой ход — ${C.value(h.cards).total <= 11 ? 'смело бери ещё' : 'ещё или хватит?'}`);
        } else say(`Ходит ${t ? t.name : '…'}`);
      } else if (v.phase === 'dealer') say('Дилер открывает карту…');
      else if (v.phase === 'results') {
        const d = v.dealer;
        if (s && s.paid && s.net !== null) {
          if (s.natural && s.net > 0) say(`Блэкджек! +${chips(s.net)}`, 'win');
          else if (s.net > 0) say(d.total > 21 ? `Дилер перебрал! +${chips(s.net)}` : `Ты выиграл +${chips(s.net)}`, 'win');
          else if (s.net < 0) say(d.natural ? `У дилера блэкджек. −${chips(-s.net)}` : `Дилер сильнее. −${chips(-s.net)}`, 'lose');
          else say('Ничья — ставка вернулась', 'push');
        } else {
          say(d.natural ? 'У дилера блэкджек' : d.total > 21 ? 'Дилер перебрал!' : `У дилера ${d.total}`, d.total > 21 ? 'win' : '');
        }
      }
    }

    // Таймер: ставки и ход.
    const total = v.phase === 'betting' ? v.timings.betMs : v.phase === 'playing' ? v.timings.turnMs : 0;
    $('bjt-timer').hidden = !total || animating;
    if (total) {
      const frac = Math.min(1, timeLeft() / total);
      $('bjt-timer').firstElementChild.style.transform = `scaleX(${frac})`;
      $('bjt-timer').classList.toggle('hurry', timeLeft() < 5000);
    }

    // Подсказка и кнопки.
    const myTurn = v.phase === 'playing' && v.turn === mine && !animating;
    const canBet = !!s && !s.bet && !s.hands.length && (v.phase === 'idle' || v.phase === 'betting');
    let hint = '';
    if (!s) hint = seated >= SEATS ? 'Все места заняты — смотри игру, место освободится' : 'Нажми «Сесть» на свободном месте';
    else if (canBet) hint = v.phase === 'betting' ? `Раздача через ${secs()} с — ставь!` : 'Поставь — раунд начнётся, остальным дадим 12 секунд';
    else if (s.bet && !s.hands.length) hint = `Ставка ${chips(s.bet)} принята — ждём остальных`;
    else if (myTurn) hint = '';
    else if (s.hands.length && !s.paid && (v.phase === 'playing' || v.phase === 'dealing')) hint = 'Ждём своей очереди';
    else if (!s.hands.length && v.phase !== 'idle' && v.phase !== 'betting') hint = 'Ставки — в следующем раунде';
    $('bjt-hint').textContent = hint;
    $('bjt-hint').hidden = !hint;
    $('bjt-betbox').hidden = !canBet;
    $('bjt-actions').hidden = !myTurn;
    $('bjt-unbet').hidden = !(s && s.bet && !s.hands.length && v.phase === 'betting');
    $('bjt-leave').hidden = !s;
    $('bjt-leave').textContent = s && s.hands.length && !s.paid ? 'Встать (руки постоят)' : 'Встать из-за стола';
    if (myTurn) {
      const a = s.actions || {};
      const h = s.hands[s.cur];
      $('bjt-hit').disabled = bt.sent || !a.hit;
      $('bjt-stand').disabled = bt.sent;
      $('bjt-double').disabled = bt.sent || !a.double;
      $('bjt-split').disabled = bt.sent || !a.split;
      $('bjt-double').querySelector('small').textContent = `+${chips(h.bet)} и одна карта`;
      $('bjt-split').querySelector('small').textContent = `+${chips(h.bet)} на вторую руку`;
    }
    $('bjt-bet').disabled = bt.sent;
    if (s && v.turn === mine && v.phase === 'playing' && bt.lastTurn !== `${v.round}:${s.cur}`) {
      bt.lastTurn = `${v.round}:${s.cur}`;
      sounds.turn();
    }

    // Точка «зовут»: идут ставки, а ты не в игре.
    $('bjt-dot').hidden = !(v.phase === 'betting' && !(s && s.bet));
    $('bjt-shoe-left').textContent = v.shoe.left;
    shoeEl.style.setProperty('--fill', String(Math.max(0.08, v.shoe.left / v.shoe.size)));
  }
  setInterval(() => { if (bt.view && !$('bjtable').hidden) renderStatus(); }, 250);

  // ---------- Кнопки ----------

  function act(action) {
    const v = bt.view;
    if (!v || v.phase !== 'playing' || v.turn !== mySeat(v) || bt.sent || bt.running) return;
    bt.sent = true;
    renderStatus();
    send({ type: 'bjt_act', action });
  }

  async function placeBet() {
    const v = bt.view;
    const mine = mySeat(v);
    if (mine < 0 || bt.sent) return;
    const amount = Math.floor(Number($('bjt-amount').value) || 0);
    if (amount < 1) return toast('Ставка — от 1 фишки');
    if (amount > state.balance) return toast('Не хватает фишек');
    if (!await confirmBet({ key: 'bjtable', game: '🂡 Блэкджек: стол', amount, input: $('bjt-amount'), note: 'Удвоение и сплит попросят ещё столько же' })) return;
    storage.set(BET_KEY, String(amount));
    bt.sent = true;
    renderStatus();
    send({ type: 'bjt_bet', amount });
  }

  $('bjt-bet').addEventListener('click', placeBet);
  $('bjt-hit').addEventListener('click', () => act('hit'));
  $('bjt-stand').addEventListener('click', () => act('stand'));
  $('bjt-double').addEventListener('click', () => act('double'));
  $('bjt-split').addEventListener('click', () => act('split'));
  $('bjt-unbet').addEventListener('click', () => send({ type: 'bjt_unbet' }));
  $('bjt-leave').addEventListener('click', () => send({ type: 'bjt_leave' }));
  document.querySelectorAll('[data-bjtq]').forEach((b) => b.addEventListener('click', () => {
    const v = Math.max(1, Math.floor(Number($('bjt-amount').value) || 1));
    const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.bjtq];
    $('bjt-amount').value = Math.max(1, Math.min(next, Math.max(1, state.balance)));
  }));
  const saved = Number(storage.get(BET_KEY));
  if (saved >= 1) $('bjt-amount').value = saved;

  // Клавиши: H — ещё, S — хватит, D — удвоить, P — сплит; пробел или Enter — поставить.
  document.addEventListener('keydown', (ev) => {
    if ($('bjtable').hidden || ev.repeat || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || !$('bet-confirm').hidden) return;
    const map = { KeyH: 'hit', KeyS: 'stand', KeyD: 'double', KeyP: 'split' };
    if (!$('bjt-actions').hidden && map[ev.code]) {
      ev.preventDefault();
      act(map[ev.code]);
    } else if (!$('bjt-betbox').hidden && (ev.code === 'Space' || ev.code === 'Enter') && document.activeElement.tagName !== 'BUTTON') {
      ev.preventDefault();
      placeBet();
    }
  });

  // ---------- Сообщения сервера ----------

  handlers.bjt_state = (msg) => {
    bt.view = msg;
    bt.recvAt = performance.now();
    bt.sent = false;
    bt.pending = msg;
    renderSeats(msg, false);
    renderStatus();
    pump();
  };

  handlers.bjt_feed = (msg) => {
    const myId = me();
    $('bjt-feed').replaceChildren(...(msg.feed.length ? msg.feed.map((e) => {
      const li = document.createElement('li');
      li.className = e.payout > e.bet ? 'win' : e.payout === e.bet ? 'push' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      const name = mk('span', 'name', e.name);
      const what = mk('span', 'u-what', `${chips(e.bet)} → ${chips(e.payout)}`);
      const hands = e.hands.map((h) => (h.total > 21 ? 'перебор' : `${h.total}${h.doubled ? '×2' : ''}`)).join(' · ');
      li.append(name, what, mk('span', 'u-ch', e.natural ? '🂡 блэкджек' : `${hands} vs ${e.dealer > 21 ? 'перебор' : e.dealer}`));
      return li;
    }) : [mk('li', 'muted', 'За общим столом ещё не играли')]));
  };

  // Ошибка на действие — кнопки снова доступны.
  const prevError = handlers.error;
  handlers.error = (msg) => {
    if (bt.sent) {
      bt.sent = false;
      renderStatus();
    }
    prevError(msg);
  };
}());
