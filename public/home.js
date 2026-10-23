// Главная зала: три раздела — казино-игры против зала, соревнования против друзей и слоты.
// Карточки строятся из списка ниже; у слотов в окошке живёт настоящий символ из слота.
// Новая игра = строка в MENU (и вкладка в index.html + имя в TABS в client.js).
(function () {
  'use strict';

  const MENU = [
    {
      id: 'casino',
      title: 'Казино',
      note: 'Играешь против зала: ставка — и судьба решает сразу',
      games: [
        { tab: 'crash', icon: '📈', name: 'Краш', text: 'Множитель растёт — забери до взрыва', color: '#ef5b54' },
        { tab: 'roulette', icon: '🎡', name: 'Рулетка', text: 'Европейская рулетка на весь стол', color: '#d8333a' },
        { tab: 'wheel', icon: '🎰', name: 'Колесо', text: 'Одно колесо фортуны на весь зал', color: '#b46cff' },
        { tab: 'upgrade', icon: '⬆️', name: 'Апгрейд', text: 'Выбери шанс — умножь ставку', color: '#45d483' },
        { tab: 'plinko', icon: '🔺', name: 'Плинко', text: 'Шарик скачет по штырькам к множителям', color: '#ff7ab6' },
        { tab: 'mines', icon: '💎', name: 'Мины', text: 'Открывай клетки и обходи мины', color: '#3fd0e6' },
        { tab: 'blackjack', icon: '🂡', name: 'Блэкджек', text: 'Двадцать одно против дилера, блэкджек платит 3:2', color: '#ff9f43' },
        { tab: 'verity', icon: '😊', name: 'Верити', text: 'Добрый или злой? Серия удваивает выигрыш', color: '#f2c14e' },
      ],
    },
    {
      id: 'versus',
      title: 'Соревнования',
      note: 'С друзьями: друг против друга или вместе против дилера',
      games: [
        { tab: 'duel', icon: '⚔️', name: 'Дуэль', text: 'Один на один: чей бросок удачнее, тот забирает обе ставки', dot: 'duel-dot' },
        { tab: 'bomb', icon: '💣', name: 'Бомба', text: 'Подкладывай фишки в общий банк и не взорвись', dot: 'bomb-dot' },
        { tab: 'pool', icon: '🎱', name: 'Пул', text: 'Восьмёрка на двоих, победитель забирает всё', dot: 'pool-dot' },
        { tab: 'poker', icon: '🃏', name: 'Покер', text: 'Техасский холдем без лимита за общим столом', dot: 'poker-dot' },
        { tab: 'bjtable', icon: '🂡', name: 'Блэкджек: стол', text: 'Пять мест и один дилер: садитесь вместе и играйте раздачу', dot: 'bjt-dot' },
      ],
    },
    {
      id: 'slots',
      title: 'Слоты',
      note: 'Свои слоты зала: музыка, бонусы и живые символы',
      games: [
        { tab: 'kraken', name: 'Кракен', sub: 'сундук глубин', text: '20 линий, хватка Кракена, сундук жемчуга и фриспины', rig: () => window.KrakenRig && window.KrakenRig.SYMBOLS.wild },
        { tab: 'saloon', name: 'Салун', sub: 'мертвецов', text: '243 пути, Кольт-дикий и дуэль на закате', rig: () => window.SaloonRig && window.SaloonRig.SYMBOLS.colt },
        { tab: 'yokai', name: 'Ночной парад', sub: 'ста демонов', text: '1024 пути, шагающие лисы-кицунэ и ночь ста демонов', rig: () => window.YokaiRig && window.YokaiRig.fox(5) },
        { tab: 'circus', name: 'Заброшенный цирк', sub: 'шатёр открыт', text: '25 линий, барабан распорядителя и метатель ножей', rig: () => window.CircusRig && window.CircusRig.SYMBOLS.clown },
      ],
    },
  ];

  const home = document.getElementById('home');
  if (!home) return;
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text ? { textContent: text } : {});

  // ---------- Разметка ----------
  const slotCanvases = [];
  for (const sec of MENU) {
    const box = el('section', `home-sec home-${sec.id}`);
    const head = el('div', 'home-head');
    head.append(el('h2', '', sec.title), el('p', 'home-note', sec.note));
    const grid = el('div', 'home-grid');
    for (const g of sec.games) {
      const card = el('button', `home-card ${sec.id}-card`);
      card.type = 'button';
      card.dataset.go = g.tab;
      card.setAttribute('aria-label', `${g.name}${g.sub ? ` ${g.sub}` : ''}: ${g.text}`);
      if (sec.id === 'casino') {
        const chip = el('span', 'home-chip');
        chip.style.setProperty('--c', g.color);
        chip.append(el('span', 'home-chip-icon', g.icon));
        card.append(chip, el('b', 'home-name', g.name), el('span', 'home-text', g.text));
      } else if (sec.id === 'versus') {
        const art = el('span', 'home-vs');
        art.append(el('span', 'home-vs-icon', g.icon));
        const dot = el('span', 'home-call', 'зовут!');
        dot.hidden = true;
        if (g.dot) syncDot(g.dot, dot);
        card.append(art, el('b', 'home-name', g.name), el('span', 'home-text', g.text), dot);
      } else {
        const win = el('span', 'home-window');
        const cv = el('canvas', 'home-sym');
        win.append(cv);
        const words = el('span', 'home-words');
        words.append(el('b', 'home-name', g.name), el('span', 'home-sub', g.sub), el('span', 'home-text', g.text));
        card.classList.add(`slot-${g.tab}`);
        card.append(win, words, el('span', 'home-play', 'Играть'));
        slotCanvases.push({ cv, def: g.rig, rig: null, ph: slotCanvases.length * 2.3 });
      }
      grid.append(card);
    }
    box.append(head, grid);
    home.append(box);
  }
  home.addEventListener('click', (e) => {
    const card = e.target.closest('[data-go]');
    if (card && typeof window.showTab === 'function') window.showTab(card.dataset.go);
  });

  // Красная точка-приглашение во вкладке → надпись «зовут!» на карточке.
  function syncDot(id, target) {
    const src = document.getElementById(id);
    if (!src) return;
    const apply = () => { target.hidden = src.hidden; };
    new MutationObserver(apply).observe(src, { attributes: true, attributeFilter: ['hidden'] });
    apply();
  }

  // Логотип ведёт на главную.
  const logo = document.querySelector('.topbar .logo');
  if (logo) {
    logo.setAttribute('role', 'link');
    logo.tabIndex = 0;
    logo.title = 'На главную';
    const go = () => { if (!document.getElementById('lobby').hidden && typeof window.showTab === 'function') window.showTab('home'); };
    logo.addEventListener('click', go);
    logo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  // ---------- Живые символы слотов ----------
  // Рисуются, только пока главная на экране. Без анимации, если человек просит меньше движения.
  const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let running = false;
  async function ensureRigs() {
    const SR = window.SlotRig;
    if (!SR) return;
    for (const s of slotCanvases) {
      if (s.rig || s.loading) continue;
      const def = s.def();
      if (!def) continue;
      s.loading = true;
      s.rig = await SR.build(def, 256);
    }
  }
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const s of slotCanvases) {
      if (!s.rig) continue;
      const box = s.cv.getBoundingClientRect();
      const size = Math.round(box.width);
      if (!size) continue;
      const px = Math.round(size * dpr);
      if (s.cv.width !== px) {
        s.cv.width = px;
        s.cv.height = px;
      }
      const c = s.cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, size, size);
      window.SlotRig.draw(c, s.rig, size / 2, size / 2, size, still ? 2 : now / 1000, s.hover ? 1 : 0, s.ph);
    }
  }
  // Наведение на карточку слота — символ играет выигрышную анимацию.
  home.querySelectorAll('.slots-card').forEach((card, i) => {
    card.addEventListener('pointerenter', () => { if (slotCanvases[i]) slotCanvases[i].hover = true; });
    card.addEventListener('pointerleave', () => { if (slotCanvases[i]) slotCanvases[i].hover = false; });
    card.addEventListener('focus', () => { if (slotCanvases[i]) slotCanvases[i].hover = true; });
    card.addEventListener('blur', () => { if (slotCanvases[i]) slotCanvases[i].hover = false; });
  });
  window.homeShown = (on) => {
    if (on && !running) {
      running = true;
      ensureRigs().then(() => requestAnimationFrame(frame));
    } else if (!on) {
      running = false;
    }
  };
  if (!home.hidden) window.homeShown(true);
})();
