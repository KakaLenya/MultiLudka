// Мероприятия от админа — клиентская часть: дождь из фишек, викторина, счастливый час, гонка.
// Пользуется общими штуками из client.js: handlers, state, send, chips, rain.
(function () {
  'use strict';

  const fmt = (n) => chips(Math.floor(n));
  const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text !== undefined ? { textContent: text } : {});
  const isMe = (name) => state.me && name === state.me.name;
  const multText = (m) => `×${String(m).replace('.', ',')}`;
  const leftText = (until) => {
    const s = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // ---------- Звук ----------
  let ac = null;
  function chime(notes, type = 'triangle', vol = 0.12) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      let t = ac.currentTime;
      for (const [f, d] of notes) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = type;
        o.frequency.value = f;
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + d);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + d);
        t += d * 0.8;
      }
    } catch { /* без звука */ }
  }

  // Колонка плашек слева сверху: счастливый час, гонка, викторина.
  const stack = mk('div', 'ev-stack');
  document.body.append(stack);

  // Всплывающая надпись «+сумма» в точке.
  function floater(x, y, text, cls = '') {
    const f = mk('div', `ev-float ${cls}`, text);
    f.style.left = `${x}px`;
    f.style.top = `${y}px`;
    document.body.append(f);
    setTimeout(() => f.remove(), 1200);
  }

  // ---------- Дождь из фишек ----------
  let rainBox = null;   // { id, layer, coins: Map(coinId -> el), banner, mine }
  handlers.rain = (msg) => {
    if (rainBox) rainBox.layer.remove();
    const layer = mk('div', 'ev-rain');
    const banner = mk('div', 'ev-rain-banner', '🌧 Дождь из фишек! Лови монетки');
    layer.append(banner);
    document.body.append(layer);
    rainBox = { id: msg.id, layer, coins: new Map(), banner, mine: 0 };
    const box = rainBox;
    const t0 = Date.now() + msg.startIn;
    let last = 0;
    for (const c of msg.coins) {
      const el = mk('button', 'ev-coin');
      el.type = 'button';
      el.append(mk('span', 'ev-coin-i', '🪙'));
      el.style.left = `calc(${(c.x * 100).toFixed(2)}% - 24px)`;
      el.style.animationDuration = `${msg.fallMs}ms`;
      el.style.animationDelay = `${t0 + c.at - Date.now()}ms`;
      el.title = `${fmt(c.value)} фишек`;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (el.classList.contains('got')) return;
        el.classList.add('got');
        send({ type: 'rain_catch', id: box.id, coin: c.id });
      });
      el.addEventListener('animationend', () => el.remove());
      layer.append(el);
      box.coins.set(c.id, el);
      last = Math.max(last, c.at);
    }
    chime([[660, 0.08], [880, 0.08], [1100, 0.16]]);
    setTimeout(() => {
      if (rainBox !== box) return;
      box.banner.textContent = box.mine ? `🌧 Дождь кончился — ты наловил ${fmt(box.mine)}` : '🌧 Дождь кончился';
      box.banner.classList.add('done');
      setTimeout(() => { if (rainBox === box) { layer.remove(); rainBox = null; } }, 3000);
    }, Math.max(0, t0 + last + msg.fallMs - Date.now()));
  };
  handlers.rain_caught = (msg) => {
    if (!rainBox || rainBox.id !== msg.id) return;
    const el = rainBox.coins.get(msg.coin);
    if (!el) return;
    if (isMe(msg.name)) {
      const r = el.getBoundingClientRect();
      floater(r.left + r.width / 2, r.top, `+${fmt(msg.value)}`);
      rainBox.mine += msg.value;
      rainBox.banner.textContent = `🌧 Дождь из фишек! Поймал ${fmt(rainBox.mine)}`;
      chime([[1200 + Math.random() * 300, 0.06]], 'square', 0.05);
    }
    el.classList.add(isMe(msg.name) ? 'got' : 'gone');
    rainBox.coins.delete(msg.coin);
  };

  // ---------- Счастливый час ----------
  let happyEl = null;
  let happyTimer = null;
  handlers.happy = (msg) => {
    clearInterval(happyTimer);
    if (happyEl) happyEl.remove();
    happyEl = null;
    if (!(msg.mult > 1) || msg.until <= Date.now()) return;
    happyEl = mk('div', 'ev-happy');
    const left = mk('span', 'ev-left');
    happyEl.append(mk('b', '', `⚡ Счастливый час ${multText(msg.mult)}`), left);
    stack.prepend(happyEl);
    const tick = () => {
      left.textContent = leftText(msg.until);
      if (msg.until <= Date.now()) handlers.happy({ mult: 1 });
    };
    tick();
    happyTimer = setInterval(tick, 1000);
    chime([[523, 0.1], [784, 0.1], [1047, 0.25]]);
  };
  handlers.happy_bonus = (msg) => {
    floater(window.innerWidth / 2, 90, `⚡ +${fmt(msg.bonus)} сверху`, 'happy');
  };

  // ---------- Гонка ----------
  let raceEl = null;
  let raceTimer = null;
  const medals = ['🥇', '🥈', '🥉'];
  handlers.race = (msg) => {
    if (!raceEl) {
      raceEl = mk('div', 'ev-race');
      stack.append(raceEl);
      chime([[392, 0.12], [392, 0.12], [392, 0.12], [784, 0.35]], 'square', 0.06);
    }
    raceEl.dataset.id = msg.id;
    const head = mk('div', 'ev-race-head');
    const left = mk('span', 'ev-left');
    head.append(mk('b', '', '🏁 Гонка'), left);
    const list = mk('ol', 'ev-race-top');
    msg.top.slice(0, 3).forEach((r, i) => {
      const li = mk('li', isMe(r.name) ? 'me' : '');
      li.append(mk('span', '', `${medals[i]} ${r.name}`), mk('span', r.net >= 0 ? 'plus' : 'minus', `${r.net > 0 ? '+' : ''}${fmt(r.net)}`));
      list.append(li);
    });
    if (!msg.top.length) list.append(mk('li', 'empty', 'Пока никто не играл — начни первым'));
    const myPlace = msg.top.findIndex((r) => isMe(r.name));
    const foot = mk('div', 'ev-race-foot', myPlace >= 3 ? `ты ${myPlace + 1}-й` : `призы: ${msg.prizes.map(fmt).join(' / ')}`);
    raceEl.replaceChildren(head, list, foot);
    clearInterval(raceTimer);
    const tick = () => { left.textContent = leftText(msg.until); };
    tick();
    raceTimer = setInterval(tick, 1000);
  };
  handlers.race_end = (msg) => {
    clearInterval(raceTimer);
    if (!raceEl) {
      raceEl = mk('div', 'ev-race');
      stack.append(raceEl);
    }
    const head = mk('div', 'ev-race-head');
    head.append(mk('b', '', '🏁 Финиш!'));
    const list = mk('ol', 'ev-race-top');
    msg.results.forEach((r, i) => {
      const li = mk('li', isMe(r.name) ? 'me' : '');
      li.append(mk('span', '', `${medals[i]} ${r.name}`), mk('span', 'plus', `+${fmt(r.prize)}`));
      list.append(li);
    });
    if (!msg.results.length) list.append(mk('li', 'empty', 'Никто не вышел в плюс'));
    raceEl.replaceChildren(head, list);
    raceEl.classList.add('done');
    const won = msg.results.some((r) => isMe(r.name));
    if (won && typeof rain === 'function') rain(['🏆', '🪙', '💰'], 80);
    chime(won ? [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.5]] : [[523, 0.15], [392, 0.3]]);
    const el = raceEl;
    raceEl = null;
    setTimeout(() => el.remove(), 8000);
  };

  // ---------- Викторина ----------
  let quizEl = null;
  let quizTimer = null;
  handlers.quiz = (msg) => {
    if (quizEl) quizEl.remove();
    clearInterval(quizTimer);
    quizEl = mk('div', 'ev-quiz');
    quizEl.dataset.id = msg.id;
    const head = mk('div', 'ev-quiz-head');
    const left = mk('span', 'ev-left');
    head.append(mk('b', '', `❓ Викторина · ${fmt(msg.prize)}`), left);
    const form = mk('form', 'ev-quiz-form');
    const input = mk('input');
    input.maxLength = 200;
    input.placeholder = 'Твой ответ';
    input.autocomplete = 'off';
    const btn = mk('button', '', 'Ответить');
    btn.type = 'submit';
    form.append(input, btn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send({ type: 'chat', text });
      input.value = '';
    });
    quizEl.append(head, mk('div', 'ev-quiz-q', msg.question), form);
    stack.append(quizEl);
    const tick = () => { left.textContent = leftText(msg.until); };
    tick();
    quizTimer = setInterval(tick, 1000);
    chime([[880, 0.1], [660, 0.1], [880, 0.2]]);
  };
  handlers.quiz_end = (msg) => {
    if (!quizEl || quizEl.dataset.id !== String(msg.id)) return;
    clearInterval(quizTimer);
    const el = quizEl;
    quizEl = null;
    const mine = msg.winner && isMe(msg.winner);
    const text = msg.cancelled ? 'Викторину отменили'
      : mine ? `Верно! +${fmt(msg.prize)}`
        : msg.winner ? `${msg.winner} ответил первым: «${msg.answer}»`
          : `Никто не угадал. Ответ: «${msg.answer}»`;
    el.querySelector('.ev-quiz-form').replaceWith(mk('div', `ev-quiz-res${mine ? ' won' : ''}`, text));
    el.querySelector('.ev-left').textContent = '';
    if (mine && typeof rain === 'function') rain(['🪙', '💰', '🎉'], 60);
    if (mine) chime([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.4]]);
    setTimeout(() => el.remove(), msg.cancelled ? 2500 : 6000);
  };
})();
