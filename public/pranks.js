// Приколы зала от админа — клиентская часть: скримеры (клоун из цирка, Кракен), мираж джекпота,
// убегающая кнопка, сундук в чате, лотерея среди онлайн и титул дня рядом с ником.
// Пользуется общими штуками из client.js: effects, handlers, state, send, chips, toast, rain.
(function () {
  'use strict';

  const fmt = (n) => chips(Math.floor(n));
  const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text !== undefined ? { textContent: text } : {});

  // ---------- Звук ----------
  let ac = null;
  function audio() {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state !== 'running') ac.resume();
      return ac;
    } catch { return null; }
  }
  function noiseBuf(a) {
    const b = a.createBuffer(1, a.sampleRate, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // Визг скримера: шум с воем вниз и удар.
  function screamSound() {
    const a = audio();
    if (!a || (typeof soundOn !== 'undefined' && !soundOn)) return;
    const t = a.currentTime;
    const out = a.createGain();
    out.gain.value = 0.35;
    out.connect(a.destination);
    for (const [f0, f1, type] of [[1400, 300, 'sawtooth'], [1900, 420, 'square'], [980, 220, 'sawtooth']]) {
      const o = a.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.9);
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.25, t + 0.02);
      g.gain.setTargetAtTime(0.0001, t + 0.6, 0.15);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.4);
    }
    const n = a.createBufferSource();
    n.buffer = noiseBuf(a);
    const ng = a.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.setTargetAtTime(0.0001, t + 0.05, 0.2);
    n.connect(ng).connect(out);
    n.start(t);
    n.stop(t + 1);
    const k = a.createOscillator();
    k.frequency.setValueAtTime(120, t);
    k.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    const kg = a.createGain();
    kg.gain.setValueAtTime(0.9, t);
    kg.gain.setTargetAtTime(0.0001, t + 0.05, 0.15);
    k.connect(kg).connect(out);
    k.start(t);
    k.stop(t + 0.8);
  }
  function chime(notes, type = 'triangle', vol = 0.18) {
    const a = audio();
    if (!a || (typeof soundOn !== 'undefined' && !soundOn)) return;
    let t = a.currentTime;
    for (const [f, d] of notes) {
      const o = a.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.01);
      g.gain.setTargetAtTime(0.0001, t + d * 0.7, d * 0.3);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + d * 2);
      t += d;
    }
  }

  // ---------- Скример ----------
  // Модель из слота вылетает на весь экран: рывок, тряска, визг — и исчезает.
  const rigCache = {};
  async function scare(kind) {
    const def = kind === 'kraken' ? window.KrakenRig && window.KrakenRig.SYMBOLS.wild : window.CircusRig && window.CircusRig.SYMBOLS.clown;
    if (!def || !window.SlotRig) return;
    rigCache[kind] ||= await window.SlotRig.build(def, 512);
    const rig = rigCache[kind];
    const cv = mk('canvas', 'prank-scare');
    document.body.append(cv);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const t0 = performance.now();
    screamSound();
    document.body.classList.add('fx-shake');
    setTimeout(() => document.body.classList.remove('fx-shake'), 900);
    const frame = (now) => {
      const k = (now - t0) / 1000;
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (cv.width !== Math.round(w * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const fade = k > 1.5 ? Math.max(0, 1 - (k - 1.5) / 0.4) : 1;
      c.fillStyle = `rgba(0, 0, 0, ${0.88 * fade})`;
      c.fillRect(0, 0, w, h);
      const grow = Math.min(1, k / 0.18);
      const size = Math.min(w, h) * (0.3 + 0.95 * (1 - (1 - grow) ** 3));
      const jitter = k < 1 ? (Math.random() - 0.5) * 24 : 0;
      c.globalAlpha = fade;
      window.SlotRig.draw(c, rig, w / 2 + jitter, h / 2 + jitter, size, now / 1000, 1, 0);
      if (k < 1.9) requestAnimationFrame(frame);
      else cv.remove();
    };
    requestAnimationFrame(frame);
  }

  // ---------- Мираж джекпота ----------
  function jackpotMirage() {
    const box = mk('div', 'prank-jackpot');
    const title = mk('div', 'pj-title', 'ДЖЕКПОТ!');
    const sum = mk('div', 'pj-sum', `+${fmt(Math.max(10_000, (state.balance || 1000) * 10))}`);
    const sub = mk('div', 'pj-sub', '×10 000 — невероятно!');
    box.append(title, sum, sub);
    document.body.append(box);
    if (typeof rain === 'function') rain(['💰', '🪙', '💸', '💎'], 90);
    chime([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.5]], 'square', 0.12);
    setTimeout(() => {
      box.classList.add('joke');
      title.textContent = '…шутка 🤡';
      sum.textContent = `${fmt(state.balance || 0)}`;
      sub.textContent = 'баланс на месте. Удачи в следующий раз!';
      chime([[392, 0.25], [370, 0.25], [349, 0.25], [330, 0.7]], 'sawtooth', 0.08);
    }, 3200);
    setTimeout(() => box.remove(), 5600);
  }

  // ---------- Убегающая кнопка ----------
  // 15 секунд главные кнопки игр уворачиваются от курсора (нажать всё равно можно, если догонишь).
  const RUN_SEL = '.kr-spin, button.action, #crash-action';
  function runaway() {
    const until = performance.now() + 15_000;
    const moved = new Set();
    const onMove = (e) => {
      if (performance.now() > until) return stop();
      for (const b of document.querySelectorAll(RUN_SEL)) {
        if (!b.offsetParent) continue;
        const r = b.getBoundingClientRect();
        const bx = r.left + r.width / 2;
        const by = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - bx, e.clientY - by);
        if (d > Math.max(r.width, r.height) / 2 + 60) continue;
        const cur = b.__run || [0, 0];
        const ang = Math.atan2(by - e.clientY, bx - e.clientX) + (Math.random() - 0.5);
        let nx = cur[0] + Math.cos(ang) * 90;
        let ny = cur[1] + Math.sin(ang) * 90;
        // Не убегать за край экрана.
        nx = Math.max(-r.left + 10 + cur[0], Math.min(window.innerWidth - r.right - 10 + cur[0], nx));
        ny = Math.max(-r.top + 70 + cur[1], Math.min(window.innerHeight - r.bottom - 10 + cur[1], ny));
        b.__run = [nx, ny];
        b.style.transition = 'transform .16s cubic-bezier(.3, 1.6, .5, 1)';
        b.style.transform = `translate(${nx}px, ${ny}px)`;
        moved.add(b);
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', onMove);
      for (const b of moved) {
        b.style.transform = '';
        b.__run = null;
        setTimeout(() => { b.style.transition = ''; }, 300);
      }
    };
    window.addEventListener('pointermove', onMove);
    setTimeout(stop, 15_000);
  }

  Object.assign(effects, {
    'scare-clown': () => scare('clown'),
    'scare-kraken': () => scare('kraken'),
    jackpot: jackpotMirage,
    runaway,
  });

  // ---------- Сундук в чате ----------
  let chestBox = null;
  function showChest(msg) {
    hideChest();
    chestBox = mk('div', 'prank-chest');
    chestBox.dataset.id = msg.id;
    const lid = mk('div', 'pc-icon', '📦');
    const text = mk('div', 'pc-text');
    text.append(mk('b', '', `Сундук: ${fmt(msg.amount)} фишек`), mk('span', 'pc-timer', ''));
    const btn = mk('button', 'pc-grab', 'Забрать!');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      send({ type: 'chest_claim', id: msg.id });
      setTimeout(() => { btn.disabled = false; }, 1500);
    });
    chestBox.append(lid, text, btn);
    document.body.append(chestBox);
    chime([[784, 0.08], [988, 0.08], [1175, 0.2]]);
    const tick = () => {
      if (!chestBox || chestBox.dataset.id !== String(msg.id) || chestBox.matches('.won, .lost')) return;
      const left = Math.max(0, Math.ceil((msg.until - Date.now()) / 1000));
      chestBox.querySelector('.pc-timer').textContent = `исчезнет через ${left} с`;
      if (left > 0) setTimeout(tick, 500);
    };
    tick();
  }
  function hideChest() {
    if (chestBox) chestBox.remove();
    chestBox = null;
  }
  handlers.chest = showChest;
  handlers.chest_gone = (msg) => { if (chestBox && chestBox.dataset.id === String(msg.id)) hideChest(); };
  handlers.chest_claimed = (msg) => {
    if (!chestBox || chestBox.dataset.id !== String(msg.id)) return;
    const mine = state.me && msg.name === state.me.name;
    chestBox.classList.add(mine ? 'won' : 'lost');
    chestBox.querySelector('.pc-icon').textContent = mine ? '🎉' : '💨';
    chestBox.querySelector('.pc-text').replaceChildren(mk('b', '', mine ? `Твой! +${fmt(msg.amount)}` : `Схватил ${msg.name}`), mk('span', 'pc-timer', mine ? 'быстрее всех' : 'в следующий раз быстрее'));
    chestBox.querySelector('.pc-grab').remove();
    if (mine && typeof rain === 'function') rain(['🪙', '💰'], 50);
    setTimeout(hideChest, 3500);
  };

  // ---------- Лотерея ----------
  // Лента имён проносится и тормозит на победителе; приз сервер начислит, когда она встанет.
  handlers.lottery = (msg) => {
    const box = mk('div', 'prank-lottery');
    const card = mk('div', 'pl-card');
    card.append(mk('div', 'pl-title', '🎟 ЛОТЕРЕЯ'), mk('div', 'pl-prize', `приз ${fmt(msg.amount)} фишек`));
    const win = mk('div', 'pl-window');
    const strip = mk('div', 'pl-strip');
    const ROW = 54;
    const rounds = 6;
    const names = [];
    for (let i = 0; i < rounds; i++) names.push(...msg.names.slice().sort(() => Math.random() - 0.5));
    names.push(msg.winner);
    for (const n of names) strip.append(mk('div', 'pl-name', n));
    win.append(strip);
    const result = mk('div', 'pl-result', '');
    card.append(win, result);
    box.append(card);
    document.body.append(box);
    const target = (names.length - 1) * ROW;
    const t0 = performance.now();
    const dur = msg.spinMs - 600;
    let lastRow = -1;
    const frame = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const y = target * (1 - (1 - k) ** 4);
      strip.style.transform = `translateY(${-y}px)`;
      const row = Math.floor(y / ROW);
      if (row !== lastRow) {
        lastRow = row;
        chime([[600 + (row % 5) * 40, 0.03]], 'square', 0.04);
      }
      if (k < 1) return requestAnimationFrame(frame);
      const mine = state.me && msg.winner === state.me.name;
      result.textContent = mine ? `Это ты! +${fmt(msg.amount)}` : `Выиграл ${msg.winner}`;
      card.classList.add(mine ? 'won' : 'done');
      chime(mine ? [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.5]] : [[523, 0.15], [659, 0.3]], 'triangle', 0.15);
      if (typeof rain === 'function') rain(mine ? ['🪙', '💰', '🎉'] : null, mine ? 90 : 60);
      setTimeout(() => box.classList.add('out'), 2600);
      setTimeout(() => box.remove(), 3100);
    };
    requestAnimationFrame(frame);
  };

  // ---------- Титул дня ----------
  state.titles = {};
  window.titleTag = (playerId) => {
    const t = playerId != null && state.titles[playerId];
    if (!t) return null;
    return mk('span', 'title-tag', t);
  };
  handlers.titles = (msg) => {
    state.titles = msg.titles || {};
    // Перерисовать списки, где видны ники.
    if (state.lastOnline && handlers.online) handlers.online(state.lastOnline);
    if (state.lastLeaderboard && handlers.leaderboard) handlers.leaderboard(state.lastLeaderboard);
  };
})();
