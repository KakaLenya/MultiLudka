// «Заброшенный цирк»: анимированные символы, нарисованные вручную (SVG-детали + живые эффекты).
// Стиль: выцветшая цирковая афиша — пыльный кармин, горчица, кремовая бумага, облезлая бирюза,
// трещины краски, тёплый свет лампочек и болезненно-зелёное свечение гадалки.
// window.CircusRig = { SYMBOLS: { id: def } }.
(function (root) {
  'use strict';

  const R = root.SlotRig;
  const INK = '#120a08';
  const CRIMSON = '#7a1e22';
  const RED = '#a8323a';
  const MUSTARD = '#c9962e';
  const CREAM = '#e8dcc0';
  const TEAL = '#2f6f6a';
  const BULB = '255, 205, 120';
  const SICK = '160, 230, 120';
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  const shadow = (cx, cy, rx, ry = 8) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".55" filter="url(#sh)"/>`;
  const SH = blur('sh', 5);
  // Трещины облезлой краски.
  const cracks = (pts, a = 0.45) => pts.map(([x, y, l, ang]) => {
    const dx = Math.cos(ang) * l;
    const dy = Math.sin(ang) * l;
    return `<path d="M${x} ${y} l${(dx * 0.5).toFixed(1)} ${(dy * 0.5 + 2).toFixed(1)} l${(dx * 0.5).toFixed(1)} ${(dy * 0.5 - 3).toFixed(1)}" fill="none" stroke="${INK}" stroke-opacity="${a}" stroke-width="1.2" stroke-linecap="round"/>`;
  }).join('');
  const wave = R.wave;
  const blip = R.blip;
  const pos = (x) => Math.max(0, x);
  const LABEL_FONT = '400 21px "Kelly Slab", Georgia, serif';

  function label(ctx, text, metal) {
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const g = ctx.createLinearGradient(0, 162, 0, 182);
    g.addColorStop(0, metal[0]);
    g.addColorStop(0.55, metal[1]);
    g.addColorStop(1, metal[2]);
    ctx.fillStyle = 'rgba(0, 0, 0, .85)';
    ctx.fillText(text, 100, 173.5);
    ctx.fillStyle = g;
    ctx.fillText(text, 100, 172);
  }
  // Лента-растяжка с лампочками по краю.
  const ribbon = (id) => svg(`
    <path d="M18 158 H182 L170 172 L182 186 H18 L30 172 Z" fill="url(#${id})" stroke="${INK}" stroke-width="3"/>
    <path d="M26 162 H174 M26 182 H174" stroke="${MUSTARD}" stroke-opacity=".75" stroke-width="1.2"/>`,
  lin(id, [[0, '#3a0c10'], [0.5, '#16060a'], [1, '#3a0c10']]));
  // Лампочки на ленте мигают бегущей волной.
  function bulbs(ctx, t, w) {
    for (let i = 0; i < 9; i++) {
      const x = 36 + i * 16;
      const on = 0.35 + 0.65 * pos(Math.sin(t * (2 + w * 4) - i * 0.9));
      R.glowAt(ctx, x, 158, 6, BULB, 0.6 * on);
      R.glowAt(ctx, x, 186, 6, BULB, 0.6 * (1 - on * 0.6));
    }
  }

  // ---------- Билет ----------
  const ticketSvg = svg(`
    ${shadow(100, 160, 70, 8)}
    <g transform="rotate(-12 100 100)">
      <path d="M30 60 H170 C170 70 178 72 182 72 V128 C178 128 170 130 170 140 H30 C30 130 22 128 18 128 V72 C22 72 30 70 30 60 Z" fill="url(#tk)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M38 68 H162 V132 H38 Z" fill="none" stroke="${CRIMSON}" stroke-width="3"/>
      <path d="M44 74 H156 V126 H44 Z" fill="none" stroke="${CRIMSON}" stroke-opacity=".5" stroke-width="1.2" stroke-dasharray="3 3"/>
      <path d="M132 64 V136" stroke="${INK}" stroke-opacity=".6" stroke-width="2" stroke-dasharray="4 4"/>
      <text x="86" y="104" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="22" fill="${CRIMSON}" letter-spacing="2">ВХОД</text>
      <text x="86" y="122" text-anchor="middle" font-family="Georgia, serif" font-size="11" fill="${INK}" fill-opacity=".7">№ 0013</text>
      <path d="M147 88 l3 8 l8 0 l-6 5 l2 8 l-7 -5 l-7 5 l2 -8 l-6 -5 l8 0 Z" fill="${MUSTARD}" stroke="${INK}" stroke-width="1.5"/>
      <ellipse cx="62" cy="82" rx="12" ry="7" fill="#8a6a3a" opacity=".35"/>
      <ellipse cx="150" cy="124" rx="8" ry="5" fill="#5a3a1a" opacity=".3"/>
      <path d="M30 60 H170" stroke="#fff4dc" stroke-opacity=".35" stroke-width="2"/>
    </g>`,
  SH + lin('tk', [[0, '#efe2c4'], [0.6, '#d8c49a'], [1, '#a88e62']], 0, 0, 1, 1));
  const ticket = {
    parts: [{ svg: ticketSvg, pivot: [100, 100], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.35, k) + w * 0.12 * wave(t, 1.6), sy: 1 + 0.015 * wave(t, 0.7, k) - w * 0.06 * pos(wave(t, 1.6)) }) }],
    fx: (ctx, t, w) => R.sweep(ctx, t, w, { color: '255, 230, 180' }),
  };

  // ---------- Попкорн ----------
  const puff = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#pc)" stroke="${INK}" stroke-width="2"/><circle cx="${x - r * 0.3}" cy="${y - r * 0.3}" r="${r * 0.35}" fill="#fffaf0" opacity=".7"/>`;
  const popcornSvg = svg(`
    ${shadow(100, 184, 50, 6)}
    ${[[70, 70, 14], [92, 60, 15], [116, 64, 14], [134, 74, 12], [80, 52, 12], [106, 46, 13], [124, 50, 11], [60, 82, 11], [142, 86, 10], [98, 74, 13]].map(([x, y, r]) => puff(x, y, r)).join('')}
    <path d="M52 84 H148 L134 182 H66 Z" fill="${CREAM}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[0, 1, 2, 3, 4].map((i) => `<path d="M${58 + i * 19.2} 84 H${67.6 + i * 19.2} L${74.5 + i * 13.6 - 4} 182 H${66 + i * 13.6} Z" fill="${RED}"/>`).join('')}
    <path d="M52 84 H148 L134 182 H66 Z" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M48 80 H152 V92 H48 Z" fill="${MUSTARD}" stroke="${INK}" stroke-width="3"/>
    <text x="100" y="140" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="16" fill="${CREAM}" stroke="${INK}" stroke-width="3" paint-order="stroke">POP</text>
    ${cracks([[70, 110, 14, 0.4], [120, 150, 12, 2.6], [90, 170, 10, -0.3]])}
    <path d="M140 92 L128 178" stroke="#fff" stroke-opacity=".18" stroke-width="5"/>`,
  SH + rad('pc', [[0, '#fff6dc'], [0.7, '#f0d68a'], [1, '#c99a3a']], 0.4, 0.35, 0.7));
  const popcorn = {
    parts: [
      { svg: popcornSvg, pivot: [100, 182], anim: (t, w, k) => ({ sy: 1 + 0.02 * pos(wave(t, 0.8, k)) + w * 0.05 * pos(wave(t, 2.4)), rot: w * 0.05 * wave(t, 1.2) }) },
      { draw: (ctx, t, w, k) => {
        // Зёрна выскакивают и падают обратно.
        const n = w ? 6 : 2;
        for (let i = 0; i < n; i++) {
          const u = (t * (w ? 0.9 : 0.45) + i / n + k * 0.13) % 1;
          const x = 70 + ((i * 37 + Math.floor(t * 0.45 + i / n) * 23) % 60);
          const y = 56 - Math.sin(u * Math.PI) * (36 + (i % 3) * 10);
          ctx.beginPath();
          ctx.arc(x + (u - 0.5) * 18 * (i % 2 ? 1 : -1), y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#f6e6b4';
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = INK;
          ctx.stroke();
        }
      } },
    ],
  };

  // ---------- Булавы ----------
  const PIN = new Path2D('M0 -34 C6 -34 7 -26 5 -20 C11 -10 13 6 9 20 C7 28 4 32 4 36 H-4 C-4 32 -7 28 -9 20 C-13 6 -11 -10 -5 -20 C-7 -26 -6 -34 0 -34 Z');
  const PIN_COLORS = [[CREAM, RED], [CREAM, TEAL], [CREAM, MUSTARD]];
  const pins = {
    parts: [
      { draw: (ctx, t, w, k) => {
        R.glowAt(ctx, 100, 100, 70, BULB, 0.1 + w * 0.15);
        // Три булавы летят по дуге жонглёра, каждая крутится.
        const sp = 0.35 + w * 0.6;
        for (let i = 0; i < 3; i++) {
          const ph = t * sp + i / 3 + k * 0.1;
          const u = ph % 1;
          const x = 100 + Math.cos(u * Math.PI * 2) * 50;
          const y = 104 - Math.abs(Math.sin(u * Math.PI)) * 58 + (1 - Math.abs(Math.sin(u * Math.PI))) * 30;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(ph * Math.PI * 4);
          ctx.fillStyle = PIN_COLORS[i][0];
          ctx.fill(PIN);
          ctx.save();
          ctx.clip(PIN);
          ctx.fillStyle = PIN_COLORS[i][1];
          ctx.fillRect(-14, -4, 28, 9);
          ctx.fillRect(-14, 28, 28, 10);
          ctx.restore();
          ctx.lineWidth = 3;
          ctx.strokeStyle = INK;
          ctx.stroke(PIN);
          ctx.restore();
        }
        // Руки жонглёра внизу.
        for (const [x, s] of [[58, 1], [142, -1]]) {
          ctx.beginPath();
          ctx.ellipse(x, 168, 16, 10, s * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = '#e8c8a8';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.fillStyle = CREAM;
          ctx.fillRect(x - 14, 176, 28, 24);
          ctx.strokeRect(x - 14, 176, 28, 24);
        }
      } },
    ],
  };

  // ---------- Цилиндр ----------
  const tophatSvg = svg(`
    ${shadow(100, 176, 76, 9)}
    <path d="M60 60 C60 52 140 52 140 60 L136 142 C136 150 64 150 64 142 Z" fill="url(#th)" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="100" cy="60" rx="40" ry="9" fill="#1a1010" stroke="${INK}" stroke-width="3"/>
    <path d="M64 118 C80 124 120 124 136 118 L135 136 C120 142 80 142 65 136 Z" fill="${CRIMSON}" stroke="${INK}" stroke-width="3"/>
    <path d="M18 148 C20 136 60 138 100 138 C140 138 180 136 182 148 C180 162 140 168 100 168 C60 168 20 162 18 148 Z" fill="url(#th2)" stroke="${INK}" stroke-width="4"/>
    <g transform="rotate(14 128 112)"><rect x="118" y="88" width="22" height="32" rx="3" fill="${CREAM}" stroke="${INK}" stroke-width="2.5"/><path d="M129 98 l4 6 l-4 6 l-4 -6 Z" fill="${RED}"/></g>
    <path d="M72 66 C70 90 70 112 72 132" stroke="#c8b8c8" stroke-opacity=".22" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M132 70 C134 92 134 116 132 132" stroke="${MUSTARD}" stroke-opacity=".35" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    ${cracks([[90, 80, 12, 1.2], [110, 100, 10, 2.2]], 0.3)}`,
  SH + lin('th', [[0, '#2a2020'], [0.5, '#141010'], [1, '#060404']], 0, 0, 1, 0) + lin('th2', [[0, '#2a2020'], [1, '#080606']]));
  const rabbitSvg = svg(`
    <path d="M86 70 C80 40 82 14 90 10 C98 14 98 40 96 70 Z" fill="#e8e2d8" stroke="${INK}" stroke-width="3"/>
    <path d="M104 70 C106 40 112 16 120 14 C126 20 120 46 112 72 Z" fill="#e8e2d8" stroke="${INK}" stroke-width="3"/>
    <path d="M88 64 C86 44 88 26 90 20 M108 66 C110 46 114 30 118 22" stroke="#c88a8a" stroke-width="3" fill="none"/>
    <path d="M76 76 C76 56 124 56 124 76 L124 86 H76 Z" fill="#e8e2d8" stroke="${INK}" stroke-width="3"/>
    <circle cx="90" cy="72" r="4" fill="#c01818"/><circle cx="110" cy="72" r="4" fill="#c01818"/>`);
  const tophat = {
    parts: [
      { svg: rabbitSvg, pivot: [100, 90], anim: (t, w, k) => {
        const peek = w * pos(wave(t, 0.6)) + 0.35 * blip(t, 7, 1.4, k);
        return { dy: 40 - 44 * peek, a: peek > 0.05 ? 1 : 0 };
      } },
      { svg: tophatSvg, pivot: [100, 160], anim: (t, w, k) => ({ rot: 0.03 * wave(t, 0.3, k) + w * 0.06 * wave(t, 1.2), dy: -w * 6 * pos(wave(t, 0.6)) }) },
    ],
    fx: (ctx, t, w) => {
      if (!w) return;
      const g = pos(wave(t, 0.6));
      R.glowAt(ctx, 90, 72 - 4 * g, 8, '255, 40, 40', 0.6 * g);
      R.glowAt(ctx, 110, 72 - 4 * g, 8, '255, 40, 40', 0.6 * g);
    },
  };

  // ---------- Медведь на шаре ----------
  const bearSvg = svg(`
    <ellipse cx="72" cy="40" rx="12" ry="12" fill="#5a3a24" stroke="${INK}" stroke-width="3"/>
    <ellipse cx="128" cy="40" rx="12" ry="12" fill="#5a3a24" stroke="${INK}" stroke-width="3"/>
    <path d="M60 116 C54 80 70 58 100 58 C130 58 146 80 140 116 C134 132 66 132 60 116 Z" fill="url(#br)" stroke="${INK}" stroke-width="4"/>
    <path d="M66 70 C66 38 134 38 134 70 C134 90 66 90 66 70 Z" fill="url(#br)" stroke="${INK}" stroke-width="4"/>
    <ellipse cx="100" cy="76" rx="16" ry="11" fill="#c8a07a" stroke="${INK}" stroke-width="2.5"/>
    <ellipse cx="100" cy="70" rx="6" ry="4.5" fill="${INK}"/>
    <path d="M100 76 V82 M94 84 Q100 88 106 84" stroke="${INK}" stroke-width="2" fill="none"/>
    <circle cx="86" cy="60" r="4" fill="${INK}"/><circle cx="114" cy="60" r="4" fill="${INK}"/>
    <circle cx="85" cy="59" r="1.3" fill="#fff"/><circle cx="113" cy="59" r="1.3" fill="#fff"/>
    <path d="M86 38 L94 22 H106 L114 38 Z" fill="${RED}" stroke="${INK}" stroke-width="3"/>
    <path d="M100 22 C106 14 112 18 110 24" stroke="${MUSTARD}" stroke-width="2.5" fill="none"/>
    <path d="M62 96 C48 92 40 80 44 70" stroke="${INK}" stroke-width="12" stroke-linecap="round" fill="none"/>
    <path d="M62 96 C48 92 40 80 44 70" stroke="#5a3a24" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M138 96 C152 92 160 80 156 70" stroke="${INK}" stroke-width="12" stroke-linecap="round" fill="none"/>
    <path d="M138 96 C152 92 160 80 156 70" stroke="#5a3a24" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M84 126 V140 M116 126 V140" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
    <path d="M84 126 V140 M116 126 V140" stroke="#4a2e1c" stroke-width="8" stroke-linecap="round"/>
    <path d="M70 98 C76 110 124 110 130 98" stroke="${CREAM}" stroke-width="5" fill="none" stroke-opacity=".7"/>
    <path d="M72 64 C70 80 72 100 78 112" stroke="#c89a7a" stroke-opacity=".2" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  rad('br', [[0, '#8a5a38'], [0.7, '#5a3a24'], [1, '#2a180e']], 0.4, 0.3, 0.8));
  const bear = {
    parts: [
      { draw: (ctx, t, w, k) => {
        // Шар катится: полосы бегут по кругу.
        const roll = t * (0.4 + w * 1.5) + k;
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 164, 30, 0, Math.PI * 2);
        ctx.fillStyle = CREAM;
        ctx.fill();
        ctx.clip();
        for (let i = 0; i < 6; i++) {
          const a = roll + (i * Math.PI) / 3;
          ctx.fillStyle = i % 2 ? TEAL : RED;
          ctx.beginPath();
          ctx.moveTo(100, 164);
          ctx.arc(100, 164, 32, a, a + Math.PI / 6);
          ctx.fill();
        }
        const g = ctx.createRadialGradient(90, 152, 2, 100, 164, 32);
        g.addColorStop(0, 'rgba(255, 255, 255, .35)');
        g.addColorStop(1, 'rgba(0, 0, 0, .45)');
        ctx.fillStyle = g;
        ctx.fillRect(68, 132, 64, 64);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(100, 164, 30, 0, Math.PI * 2);
        ctx.lineWidth = 4;
        ctx.strokeStyle = INK;
        ctx.stroke();
      } },
      { svg: bearSvg, pivot: [100, 140], anim: (t, w, k) => ({ rot: 0.07 * wave(t, 0.5, k) + w * 0.12 * wave(t, 1.4), dx: 3 * wave(t, 0.5, k + 1) }) },
    ],
  };

  // ---------- Силач ----------
  const strongBody = svg(`
    ${shadow(100, 190, 56, 6)}
    <path d="M56 194 C58 150 70 126 100 124 C130 126 142 150 144 194 Z" fill="url(#lb)" stroke="${INK}" stroke-width="4"/>
    ${[0, 1, 2, 3].map((i) => `<path d="M${64 + i * 4} ${150 + i * 12} H${136 - i * 4}" stroke="${CREAM}" stroke-width="5" stroke-opacity=".8"/>`).join('')}
    <path d="M78 124 L100 160 L122 124" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M70 104 C70 72 130 72 130 104 C130 124 116 132 100 132 C84 132 70 124 70 104 Z" fill="#d8a888" stroke="${INK}" stroke-width="4"/>
    <circle cx="88" cy="100" r="3.5" fill="${INK}"/><circle cx="112" cy="100" r="3.5" fill="${INK}"/>
    <path d="M82 92 L94 95 M118 92 L106 95" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M100 112 C88 110 76 114 72 122 C80 118 92 118 100 116 C108 118 120 118 128 122 C124 114 112 110 100 112 Z" fill="#1a0e08" stroke="${INK}" stroke-width="1.5"/>
    <path d="M90 124 Q100 128 110 124" stroke="${INK}" stroke-width="2" fill="none"/>
    <path d="M76 86 C80 76 96 72 104 74" stroke="#fff" stroke-opacity=".3" stroke-width="3" stroke-linecap="round" fill="none"/>`,
  lin('lb', [[0, RED], [1, '#3a0a0e']]));
  const strongArms = svg(`
    <path d="M62 140 C46 120 44 96 52 70" stroke="${INK}" stroke-width="22" stroke-linecap="round" fill="none"/>
    <path d="M62 140 C46 120 44 96 52 70" stroke="#d8a888" stroke-width="15" stroke-linecap="round" fill="none"/>
    <path d="M138 140 C154 120 156 96 148 70" stroke="${INK}" stroke-width="22" stroke-linecap="round" fill="none"/>
    <path d="M138 140 C154 120 156 96 148 70" stroke="#d8a888" stroke-width="15" stroke-linecap="round" fill="none"/>
    <rect x="20" y="58" width="160" height="8" rx="3" fill="#6a6a6a" stroke="${INK}" stroke-width="3"/>
    ${[[14, 34], [186, 34]].map(([x]) => `<circle cx="${x}" cy="62" r="20" fill="url(#bb)" stroke="${INK}" stroke-width="4"/><text x="${x}" y="67" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="13" fill="${CREAM}">500</text>`).join('')}`,
  rad('bb', [[0, '#4a4a4a'], [1, '#0a0a0a']], 0.4, 0.35, 0.7));
  const strongman = {
    parts: [
      { svg: strongBody, pivot: [100, 190], anim: (t, w, k) => ({ sy: 1 - w * 0.03 * pos(wave(t, 0.9)) }) },
      { svg: strongArms, pivot: [100, 140], anim: (t, w, k) => {
        const lift = 0.5 + 0.5 * wave(t, 0.35 + w * 0.55, k);
        return { dy: 18 - 18 * lift, rot: 0.03 * wave(t, 0.9, k) };
      } },
    ],
    fx: (ctx, t, w) => {
      if (!w) return;
      // Капли пота.
      for (let i = 0; i < 2; i++) {
        const u = (t * 0.9 + i / 2) % 1;
        ctx.beginPath();
        ctx.arc(70 + i * 60, 90 + u * 30, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200, 230, 255, ${0.8 * (1 - u)})`;
        ctx.fill();
      }
    },
  };

  // ---------- Гадалка ----------
  const tellerSvg = svg(`
    ${shadow(100, 192, 66, 6)}
    <path d="M30 196 C30 120 52 60 100 50 C148 60 170 120 170 196 Z" fill="url(#cl)" stroke="${INK}" stroke-width="4"/>
    <path d="M62 100 C62 60 138 60 138 100 C138 130 122 142 100 142 C78 142 62 130 62 100 Z" fill="#0c0610"/>
    <path d="M74 104 C74 84 126 84 126 104 C126 124 114 134 100 134 C86 134 74 124 74 104 Z" fill="#b89a8a" stroke="${INK}" stroke-width="3"/>
    <path d="M78 96 C86 92 94 94 96 98 M104 98 C106 94 114 92 122 96" stroke="${INK}" stroke-width="2.5" fill="none"/>
    <path d="M94 120 Q100 124 106 120" stroke="#5a1a2a" stroke-width="2.5" fill="none"/>
    <path d="M70 60 C80 44 120 44 130 60" stroke="${MUSTARD}" stroke-width="3" fill="none"/>
    ${[78, 92, 108, 122].map((x, i) => `<circle cx="${x}" cy="${54 + (i % 2) * -4}" r="3" fill="${MUSTARD}" stroke="${INK}" stroke-width="1"/>`).join('')}
    <circle cx="64" cy="122" r="6" fill="${MUSTARD}" stroke="${INK}" stroke-width="2"/><circle cx="136" cy="122" r="6" fill="${MUSTARD}" stroke="${INK}" stroke-width="2"/>
    <path d="M48 176 C58 160 72 156 78 160 M152 176 C142 160 128 156 122 160" stroke="#b89a8a" stroke-width="10" stroke-linecap="round" fill="none"/>
    <rect x="70" y="182" width="60" height="12" rx="3" fill="#3a2a1a" stroke="${INK}" stroke-width="3"/>
    <path d="M40 150 C46 120 60 90 80 72" stroke="#c8a8d8" stroke-opacity=".16" stroke-width="5" fill="none"/>`,
  lin('cl', [[0, '#3a1a4a'], [0.6, '#1e0c28'], [1, '#0a040e']]));
  const teller = {
    parts: [
      { svg: tellerSvg, pivot: [100, 196], anim: (t, w, k) => ({ sy: 1 + 0.01 * wave(t, 0.3, k) }) },
      { draw: (ctx, t, w, k) => {
        // Хрустальный шар: внутри клубится зелёный туман.
        const cx = 100;
        const cy = 160;
        R.glowAt(ctx, cx, cy, 52, SICK, 0.25 + 0.15 * wave(t, 0.6, k) + w * 0.35);
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        const g = ctx.createRadialGradient(cx - 8, cy - 10, 2, cx, cy, 26);
        g.addColorStop(0, 'rgba(220, 255, 220, .9)');
        g.addColorStop(0.5, 'rgba(90, 160, 110, .7)');
        g.addColorStop(1, 'rgba(10, 30, 20, .9)');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.clip();
        for (let i = 0; i < 4; i++) {
          const a = t * (0.6 + w) + i * 1.6 + k;
          R.glowAt(ctx, cx + Math.cos(a) * 12, cy + Math.sin(a * 1.3) * 10, 14, SICK, 0.45);
        }
        ctx.restore();
        ctx.beginPath();
        ctx.arc(cx, cy, 26, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx - 9, cy - 12, 7, 4, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, .55)';
        ctx.fill();
        // Глаза светятся, когда шар что-то видит.
        if (w) {
          const e = 0.5 + 0.5 * wave(t, 1.2);
          R.glowAt(ctx, 86, 98, 8, SICK, 0.7 * e);
          R.glowAt(ctx, 114, 98, 8, SICK, 0.7 * e);
        }
      } },
    ],
  };

  // ---------- Акробатка на трапеции ----------
  const acrobatSvg = svg(`
    <path d="M62 0 L76 82 M138 0 L124 82" stroke="${INK}" stroke-width="5"/>
    <path d="M62 0 L76 82 M138 0 L124 82" stroke="#b8a888" stroke-width="2.5"/>
    <rect x="66" y="80" width="68" height="8" rx="4" fill="${MUSTARD}" stroke="${INK}" stroke-width="3"/>
    <path d="M86 84 L92 108 M114 84 L108 108" stroke="${INK}" stroke-width="10" stroke-linecap="round"/>
    <path d="M86 84 L92 108 M114 84 L108 108" stroke="#e8c8a8" stroke-width="6" stroke-linecap="round"/>
    <circle cx="100" cy="122" r="15" fill="#e8c8a8" stroke="${INK}" stroke-width="3"/>
    <path d="M85 118 C86 104 114 104 115 118 C110 112 90 112 85 118 Z" fill="#2a1410" stroke="${INK}" stroke-width="2"/>
    <circle cx="94" cy="124" r="2" fill="${INK}"/><circle cx="106" cy="124" r="2" fill="${INK}"/>
    <path d="M96 130 Q100 132 104 130" stroke="${RED}" stroke-width="2" fill="none"/>
    <path d="M86 136 C84 150 86 162 90 172 L110 172 C114 162 116 150 114 136 Z" fill="url(#ac)" stroke="${INK}" stroke-width="3"/>
    <path d="M84 168 C80 174 78 184 84 192 L96 176 Z M116 168 C120 174 122 184 116 192 L104 176 Z" fill="${RED}" stroke="${INK}" stroke-width="3"/>
    ${[[92, 148], [100, 156], [108, 148], [100, 140]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="${MUSTARD}"/>`).join('')}
    <path d="M90 174 L82 198 M110 174 L118 198" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M90 174 L82 198 M110 174 L118 198" stroke="#e8c8a8" stroke-width="5" stroke-linecap="round"/>`,
  lin('ac', [[0, '#c03848'], [1, '#5a0e18']]));
  const acrobat = {
    parts: [{ svg: acrobatSvg, pivot: [100, 0], anim: (t, w, k) => ({ rot: 0.16 * wave(t, 0.28, k) + w * 0.18 * wave(t, 0.7) }) }],
    fx: (ctx, t, w) => R.sweep(ctx, t, w, { color: '255, 220, 180' }),
  };

  // ---------- Клоун ----------
  const clownHead = svg(`
    ${[[44, 76, 22], [36, 98, 18], [46, 118, 16], [156, 76, 22], [164, 98, 18], [154, 118, 16]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#hr)" stroke="${INK}" stroke-width="3"/>`).join('')}
    <path d="M100 30 C142 30 160 64 158 104 C156 144 132 170 100 170 C68 170 44 144 42 104 C40 64 58 30 100 30 Z" fill="url(#cf)" stroke="${INK}" stroke-width="4.5"/>
    ${cracks([[70, 60, 16, 0.6], [128, 56, 14, 2.4], [60, 120, 12, 1.0], [136, 126, 14, 2.0], [100, 44, 10, 1.5], [84, 150, 12, 0.2]])}
    <path d="M62 84 L76 64 L90 84 L76 104 Z" fill="#2a4a8a" stroke="${INK}" stroke-width="2.5"/>
    <path d="M110 84 L124 64 L138 84 L124 104 Z" fill="#2a4a8a" stroke="${INK}" stroke-width="2.5"/>
    <path d="M62 132 C74 152 126 152 138 132 C132 160 68 160 62 132 Z" fill="#8a0e18" stroke="${INK}" stroke-width="3"/>
    <path d="M56 126 C70 156 130 156 144 126" fill="none" stroke="#c0202a" stroke-width="6" stroke-linecap="round"/>
    <path d="M74 140 L78 148 M86 144 L88 152 M100 145 V153 M112 144 L110 152 M124 140 L120 148" stroke="#e8e0c8" stroke-width="3"/>
    <path d="M78 22 L100 2 L122 22 Z" fill="${TEAL}" stroke="${INK}" stroke-width="3"/>
    <circle cx="100" cy="4" r="5" fill="${MUSTARD}" stroke="${INK}" stroke-width="2"/>
    <path d="M56 70 C58 50 74 38 92 36" stroke="#fff" stroke-opacity=".4" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  rad('cf', [[0, '#f4ecdc'], [0.75, '#d8ccb4'], [1, '#9a8e78']], 0.45, 0.35, 0.75) + rad('hr', [[0, '#ff9a4a'], [1, '#a8400e']], 0.4, 0.35, 0.7));
  const clownEyes = svg(`
    <circle cx="76" cy="84" r="7" fill="#f4f0e4" stroke="${INK}" stroke-width="2"/><circle cx="124" cy="84" r="7" fill="#f4f0e4" stroke="${INK}" stroke-width="2"/>
    <circle cx="77" cy="85" r="3.5" fill="${INK}"/><circle cx="125" cy="85" r="3.5" fill="${INK}"/>`);
  const clownLids = svg(`<circle cx="76" cy="84" r="8" fill="#2a4a8a" stroke="${INK}" stroke-width="2"/><circle cx="124" cy="84" r="8" fill="#2a4a8a" stroke="${INK}" stroke-width="2"/>`);
  const headAnim = (t, w, k) => ({ rot: 0.04 * wave(t, 0.25, k) + w * 0.12 * wave(t, 0.9), dy: -w * 4 * pos(wave(t, 1.8)) });
  const clown = {
    parts: [
      { svg: clownHead, pivot: [100, 170], anim: headAnim },
      { svg: clownEyes, pivot: [100, 170], anim: headAnim },
      { svg: clownLids, pivot: [100, 170], anim: (t, w, k) => ({ ...headAnim(t, w, k), a: blip(t, 3.9, 0.22, k * 1.4) > 0.05 ? 1 : 0 }) },
      { pivot: [100, 170], anim: headAnim, draw: (ctx, t, w, k) => {
        // Красный нос — светится, на выигрыше мигает.
        const g = 0.45 + 0.2 * wave(t, 0.8, k) + w * 0.5 * pos(wave(t, 2.2));
        R.glowAt(ctx, 100, 112, 26, '255, 60, 50', g * 0.6);
        ctx.beginPath();
        ctx.arc(100, 112, 13, 0, Math.PI * 2);
        const n = ctx.createRadialGradient(95, 107, 2, 100, 112, 13);
        n.addColorStop(0, '#ff8a7a');
        n.addColorStop(0.6, '#d0202a');
        n.addColorStop(1, '#6a0810');
        ctx.fillStyle = n;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = INK;
        ctx.stroke();
      } },
    ],
  };

  // ---------- Огненный обруч (WILD) ----------
  const hoopSvg = svg(`<circle cx="100" cy="82" r="58" fill="none" stroke="${INK}" stroke-width="14"/><circle cx="100" cy="82" r="58" fill="none" stroke="url(#hp)" stroke-width="8"/>
    <circle cx="100" cy="82" r="58" fill="none" stroke="${CREAM}" stroke-width="2" stroke-dasharray="10 14" stroke-opacity=".6"/>
    <path d="M100 140 L100 156" stroke="${INK}" stroke-width="10"/><path d="M100 140 L100 156" stroke="#6a6a6a" stroke-width="5"/>`,
  lin('hp', [[0, '#e8e2d8'], [0.5, '#8a8a8a'], [1, '#3a3a3a']], 0, 0, 1, 1));
  function flames(ctx, t, w, k) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const fl = 0.7 + 0.3 * wave(t, 2.6, i * 1.7 + k) + w * 0.4;
      const len = (26 + 16 * pos(wave(t, 1.9, i * 2.3 + k))) * fl;
      const bx = 100 + Math.cos(a) * 58;
      const by = 82 + Math.sin(a) * 58;
      // Пламя тянется вверх, а не только наружу.
      const ox = Math.cos(a) * len * 0.6;
      const oy = Math.sin(a) * len * 0.6 - len * 0.8;
      const grad = ctx.createLinearGradient(bx, by, bx + ox, by + oy);
      grad.addColorStop(0, 'rgba(255, 230, 140, .95)');
      grad.addColorStop(0.5, 'rgba(255, 120, 30, .85)');
      grad.addColorStop(1, 'rgba(160, 20, 10, 0)');
      ctx.beginPath();
      ctx.moveTo(bx - Math.sin(a) * 9, by + Math.cos(a) * 9);
      ctx.quadraticCurveTo(bx + ox * 0.5 + Math.sin(a) * 5, by + oy * 0.5, bx + ox, by + oy);
      ctx.quadraticCurveTo(bx + ox * 0.5 - Math.sin(a) * 5, by + oy * 0.5, bx + Math.sin(a) * 9, by - Math.cos(a) * 9);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }
  }
  const hoop = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 82, 96, '255, 120, 40', 0.25 + w * 0.25) },
      { svg: hoopSvg },
      { draw: (ctx, t, w, k) => {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        flames(ctx, t, w, k);
        ctx.restore();
      } },
      { draw: (ctx, t, w, k) => {
        // Сквозь обруч мелькает силуэт прыгающего льва.
        const u = (t * (0.18 + w * 0.5) + k * 0.1) % 1;
        if (u > 0.5) return;
        const x = 30 + u * 2 * 140;
        ctx.save();
        ctx.globalAlpha = Math.sin(u * 2 * Math.PI) * 0.7;
        ctx.fillStyle = '#1a0c06';
        ctx.beginPath();
        ctx.ellipse(x, 84 - Math.sin(u * 2 * Math.PI) * 10, 22, 9, -0.15, 0, Math.PI * 2);
        ctx.ellipse(x + 20, 78 - Math.sin(u * 2 * Math.PI) * 10, 11, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } },
      { svg: ribbon('rbw') },
    ],
    fx: (ctx, t, w, k) => {
      bulbs(ctx, t, w);
      label(ctx, 'WILD', ['#ffe9b0', '#ff9a3a', '#8a2a08']);
    },
  };

  // ---------- Мишень (скаттер) ----------
  const targetSvg = svg(`
    <circle cx="100" cy="80" r="62" fill="url(#tg)" stroke="${INK}" stroke-width="5"/>
    ${[50, 38, 26, 14].map((r, i) => `<circle cx="100" cy="80" r="${r}" fill="${i % 2 ? CREAM : RED}" stroke="${INK}" stroke-width="2"/>`).join('')}
    <circle cx="100" cy="80" r="5" fill="${INK}"/>
    ${Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    return `<path d="M${(100 + Math.cos(a) * 52).toFixed(1)} ${(80 + Math.sin(a) * 52).toFixed(1)} L${(100 + Math.cos(a) * 62).toFixed(1)} ${(80 + Math.sin(a) * 62).toFixed(1)}" stroke="${INK}" stroke-opacity=".5" stroke-width="1.5"/>`;
  }).join('')}
    ${cracks([[70, 50, 14, 0.5], [130, 104, 12, 2.6]], 0.35)}`,
  rad('tg', [[0, '#6a4a2a'], [1, '#2a1a0c']]));
  const KNIFE = (x, y, a) => `<g transform="translate(${x} ${y}) rotate(${a})"><path d="M0 0 L-4 -30 L0 -38 L4 -30 Z" fill="#d8dce0" stroke="${INK}" stroke-width="2"/><rect x="-4" y="0" width="8" height="18" rx="2" fill="#3a2010" stroke="${INK}" stroke-width="2"/></g>`;
  const knivesSvg = svg(`${KNIFE(78, 52, 30)}${KNIFE(130, 70, -60)}${KNIFE(92, 112, 200)}`);
  const target = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 80, 92, BULB, 0.18 + w * 0.3) },
      { svg: targetSvg, pivot: [100, 80], anim: (t, w, k) => ({ rot: t * (0.3 + w * 2.5) + k }) },
      { svg: knivesSvg, pivot: [100, 80], anim: (t, w, k) => ({ rot: t * (0.3 + w * 2.5) + k }) },
      { svg: ribbon('rbt') },
    ],
    fx: (ctx, t, w) => {
      bulbs(ctx, t, w);
      label(ctx, 'МИШЕНЬ', ['#fff0c8', '#e0a23a', '#7a3d0c']);
    },
  };

  root.CircusRig = { SYMBOLS: { ticket, popcorn, pins, tophat, bear, strongman, teller, acrobat, clown, hoop, target } };
})(window);
