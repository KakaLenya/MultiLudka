// «Салун мертвецов»: анимированные символы, нарисованные вручную (SVG-детали + живые эффекты).
// Стиль: мрачный вестерн — угольный контур, выгоревшие цвета, тёплый закатный свет справа,
// тлеющие угли в глазницах. window.SaloonRig = { SYMBOLS: { id: def } }.
(function (root) {
  'use strict';

  const R = root.SlotRig;
  const INK = '#120806';
  const RIM = '#ff8a3a';          // закатный контровой свет
  const BONE = ['#e6dcc4', '#b8aa8c', '#6e6250'];
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  const hatch = (x0, y0, x1, y1, n, color = INK, a = 0.3, w = 1.2) => Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1 || 1);
    return `<path d="M${(x0 + (x1 - x0) * f).toFixed(1)} ${y0} l${((x1 - x0) / n * 0.6).toFixed(1)} ${(y1 - y0).toFixed(1)}" stroke="${color}" stroke-opacity="${a}" stroke-width="${w}"/>`;
  }).join('');
  const shadow = (cx, cy, rx, ry = 10) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".5" filter="url(#sh)"/>`;
  const SH = blur('sh', 5);
  const wave = R.wave;
  const blip = R.blip;
  const pos = (x) => Math.max(0, x);
  const TITLE_FONT = '"Ruslan Display", Georgia, serif';

  // Угли в глазницах: неровное мерцание.
  function ember(ctx, t, x, y, r, k, w) {
    const f = 0.55 + 0.25 * wave(t, 1.7, k) + 0.15 * wave(t, 4.3, k * 2) + w * 0.35;
    R.glowAt(ctx, x, y, r * 2.6, '255, 90, 20', 0.35 * f);
    R.glowAt(ctx, x, y, r, '255, 200, 90', 0.9 * f);
  }

  // ---------- Подкова ----------
  const shoePath = 'M56 50 C44 92 44 140 68 162 C86 178 114 178 132 162 C156 140 156 92 144 50 L118 50 C126 92 126 128 114 142 C106 150 94 150 86 142 C74 128 74 92 82 50 Z';
  const horseshoeSvg = svg(`<g transform="translate(100 20) scale(1.14) translate(-100 -20)">
    <path d="M70 52 L100 20 L130 52" fill="none" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M70 52 L100 20 L130 52" fill="none" stroke="#6a4224" stroke-width="3" stroke-linejoin="round"/>
    <path d="${shoePath}" fill="url(#ir)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M54 44 H84 L82 56 H56 Z M116 44 H146 L144 56 H118 Z" fill="#1e1a18" stroke="${INK}" stroke-width="3"/>
    ${[[62, 74], [59, 100], [64, 126], [78, 150], [138, 74], [141, 100], [136, 126], [122, 150]].map(([x, y]) => `<rect x="${x - 3}" y="${y - 5}" width="6" height="10" rx="1.5" fill="${INK}" transform="rotate(${(x - 100) * -0.4} ${x} ${y})"/>`).join('')}
    ${[[52, 112, 7, 12], [96, 166, 12, 5], [146, 92, 5, 10], [70, 152, 6, 5]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#7a3a14" opacity=".65"/>`).join('')}
    <path d="M52 70 C48 100 50 132 64 152" fill="none" stroke="#d8d0c8" stroke-opacity=".22" stroke-width="3" stroke-linecap="round"/>
    <path d="M150 80 C154 110 150 140 134 160" fill="none" stroke="${RIM}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/></g>`,
  lin('ir', [[0, '#5e5852'], [0.5, '#2e2824'], [1, '#141010']], 0, 0, 1, 1));
  const nailSvg = svg(`<circle cx="100" cy="20" r="5" fill="#8a8680" stroke="${INK}" stroke-width="2.5"/><circle cx="98.5" cy="18.5" r="1.6" fill="#e8e0d8"/>`);
  const horseshoe = {
    parts: [
      { svg: horseshoeSvg, pivot: [100, 20], anim: (t, w, k) => ({ rot: 0.06 * wave(t, 0.33, k) + w * 0.22 * wave(t, 1.1) }) },
      { svg: nailSvg },
    ],
    fx: (ctx, t, w) => R.sweep(ctx, t, w, { color: '255, 190, 120' }),
  };

  // ---------- Виски ----------
  const bottlePath = 'M72 14 H96 V54 C96 62 114 70 114 90 V172 C114 180 108 184 100 184 H68 C60 184 54 180 54 172 V90 C54 70 72 62 72 54 Z';
  const glassInner = 'M121 136 H163 L158 178 H126 Z';
  const bottleBack = svg(`${shadow(110, 186, 70, 8)}<path d="${bottlePath}" fill="url(#bg)" stroke="${INK}" stroke-width="4.5"/>`, SH + lin('bg', [[0, '#3a2410'], [0.5, '#1e1008'], [1, '#0a0503']], 0, 0, 1, 0));
  const bottleFront = svg(`
    <path d="${bottlePath}" fill="none" stroke="${INK}" stroke-width="4.5"/>
    <rect x="70" y="6" width="28" height="16" rx="3" fill="#4a1410" stroke="${INK}" stroke-width="3.5"/>
    <path d="M68 18 H100 V26 C96 32 92 26 88 34 C84 28 78 34 74 28 C70 32 68 26 68 22 Z" fill="#5a1410" stroke="${INK}" stroke-width="2.5"/>
    <path d="M58 104 H110 V150 H58 Z" fill="url(#lb)" stroke="${INK}" stroke-width="2.5"/>
    <path d="M58 104 L62 110 L58 116 M110 132 L106 138 L110 144" fill="none" stroke="#3a2410" stroke-width="1.5"/>
    <text x="84" y="124" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="17" fill="#3a1408">XXX</text>
    <path d="M66 132 H102 M70 140 H98" stroke="#3a1408" stroke-opacity=".6" stroke-width="2"/>
    <path d="M62 90 C58 110 58 150 62 172" stroke="#ffe8c8" stroke-opacity=".22" stroke-width="5" stroke-linecap="round" fill="none"/>
    <path d="M108 92 C112 120 112 150 108 174" stroke="${RIM}" stroke-opacity=".5" stroke-width="2.5" stroke-linecap="round" fill="none"/>
    <path d="M78 26 V56" stroke="#ffe8c8" stroke-opacity=".2" stroke-width="3" stroke-linecap="round"/>`,
  lin('lb', [[0, '#c8b48a'], [1, '#8a7048']]));
  const glassBack = svg(`<path d="M116 130 H168 L162 184 C162 187 160 188 157 188 H127 C124 188 122 187 122 184 Z" fill="rgba(160, 190, 190, .12)" stroke="${INK}" stroke-width="3.5"/>`);
  const glassFront = svg(`
    <path d="M116 130 H168 L162 184 C162 187 160 188 157 188 H127 C124 188 122 187 122 184 Z" fill="none" stroke="${INK}" stroke-width="3.5"/>
    <path d="M124 178 H160 L159 186 H125 Z" fill="rgba(200, 220, 220, .25)"/>
    <ellipse cx="142" cy="130" rx="26" ry="3.5" fill="none" stroke="#e8f0f0" stroke-opacity=".35" stroke-width="1.5"/>
    <path d="M122 138 L126 176" stroke="#ffffff" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>
    <path d="M162 138 L158 176" stroke="${RIM}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`);
  const bottleP = new Path2D(bottlePath);
  const glassP = new Path2D(glassInner);
  const bottleAnim = (t, w, k) => ({ rot: 0.03 * wave(t, 0.3, k) + w * 0.09 * wave(t, 1.3) });
  const glassAnim = (t, w) => ({ dy: -7 * w * pos(wave(t, 1.6)) });
  function liquid(ctx, clip, lvl, x0, x1, tilt, t, k, a, bubbles) {
    ctx.save();
    ctx.clip(clip);
    ctx.beginPath();
    ctx.moveTo(x0, 200);
    for (let x = x0; x <= x1; x += 4) ctx.lineTo(x, lvl + tilt * ((x - (x0 + x1) / 2) / 40) + 1.8 * wave(t, 1.2, x / 12 + k));
    ctx.lineTo(x1, 200);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, lvl, 0, 190);
    g.addColorStop(0, `rgba(220, 130, 40, ${a})`);
    g.addColorStop(1, `rgba(90, 30, 6, ${a})`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 210, 140, .55)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    if (bubbles) R.bubbles(ctx, t + k, (x0 + x1) / 2, 180, { n: 2, rise: 40, spread: 20, a: 0.35 });
    ctx.restore();
  }
  const whiskey = {
    parts: [
      { svg: bottleBack, pivot: [84, 184], anim: bottleAnim },
      { pivot: [84, 184], anim: bottleAnim, draw: (ctx, t, w, k) => liquid(ctx, bottleP, 96, 50, 118, -bottleAnim(t, w, k).rot * 60, t, k, 0.8, true) },
      { svg: bottleFront, pivot: [84, 184], anim: bottleAnim },
      { svg: glassBack, anim: glassAnim },
      { anim: glassAnim, draw: (ctx, t, w, k) => liquid(ctx, glassP, 152 + 2 * w * wave(t, 3.2), 116, 168, 3 * wave(t, 0.6, k) + w * 6 * wave(t, 3.2), t, k + 1, 0.85, false) },
      { svg: glassFront, anim: glassAnim },
    ],
  };

  // ---------- Шляпа ----------
  const hatSvg = svg(`
    ${shadow(100, 168, 82, 10)}
    <path d="M8 116 C20 136 52 146 100 146 C148 146 180 136 192 116 C194 134 182 164 100 166 C18 164 6 134 8 116 Z" fill="url(#br)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M52 134 C50 100 56 62 70 44 C80 32 92 46 100 38 C108 46 120 32 130 44 C144 62 150 100 148 134 C128 144 72 144 52 134 Z" fill="url(#cr)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M100 40 C96 60 98 90 100 104" fill="none" stroke="${INK}" stroke-opacity=".55" stroke-width="3"/>
    <path d="M70 48 C62 66 58 96 60 122" fill="none" stroke="#c8a888" stroke-opacity=".16" stroke-width="5" stroke-linecap="round"/>
    <path d="M136 56 C144 76 146 104 144 128" fill="none" stroke="${RIM}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
    <path d="M52 118 C72 128 128 128 148 118 L148 134 C128 144 72 144 52 134 Z" fill="#4a1410" stroke="${INK}" stroke-width="3"/>
    ${[72, 100, 128].map((x) => `<circle cx="${x}" cy="${x === 100 ? 131 : 129}" r="5" fill="url(#cn)" stroke="${INK}" stroke-width="2"/>`).join('')}
    <path d="M56 124 C40 100 34 72 40 50 C48 70 54 96 60 122 Z" fill="#2a1e1a" stroke="${INK}" stroke-width="2.5"/>
    <path d="M56 122 C46 98 42 76 42 56" fill="none" stroke="#a89880" stroke-opacity=".7" stroke-width="1.2"/>
    ${[60, 70, 80, 90, 100, 110].map((y) => `<path d="M${46 + (y - 60) * 0.12} ${y} l-6 -6" stroke="${INK}" stroke-width="1"/>`).join('')}
    <circle cx="120" cy="72" r="6" fill="#050202"/><circle cx="120" cy="72" r="6" fill="none" stroke="#7a5a40" stroke-width="1.5" stroke-dasharray="2 2"/>
    <path d="M20 128 C50 140 150 140 180 128" fill="none" stroke="#c8a888" stroke-opacity=".12" stroke-width="2"/>
    <path d="M176 124 C186 128 186 140 170 150" fill="none" stroke="${RIM}" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>`,
  SH + lin('br', [[0, '#3a2a1e'], [1, '#120a06']]) + lin('cr', [[0, '#4a3424'], [0.6, '#24160e'], [1, '#100804']], 0, 0, 1, 1)
  + rad('cn', [[0, '#f0ece0'], [0.6, '#9a968a'], [1, '#3a3834']], 0.35, 0.35, 0.7));
  const hat = {
    parts: [{ svg: hatSvg, pivot: [100, 150], anim: (t, w, k) => {
      const lift = w * pos(wave(t, 0.8));
      return { dy: 1.5 * wave(t, 0.3, k) - 16 * lift, rot: 0.02 * wave(t, 0.27, k) - 0.16 * lift };
    } }],
  };

  // ---------- Сапог со шпорой ----------
  const bootSvg = svg(`
    ${shadow(96, 180, 80, 7)}
    <path d="M94 14 H148 C152 50 146 92 150 122 L156 160 H162 V178 H134 L130 168 C108 172 70 178 38 178 C22 178 14 170 20 162 C30 150 62 146 86 136 C94 108 90 58 94 14 Z" fill="url(#lt)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M94 14 C100 26 112 30 120 20 C128 30 140 26 148 14" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M96 20 L92 6 C98 4 102 8 102 16 Z M140 18 L146 6 C152 8 150 14 146 20 Z" fill="#3a2414" stroke="${INK}" stroke-width="2.5"/>
    <path d="M104 36 C114 50 132 44 138 58 C126 60 118 70 122 84 C110 74 104 82 104 96 C98 82 108 66 100 56 Z" fill="none" stroke="#c8a070" stroke-opacity=".75" stroke-width="2"/>
    <path d="M104 36 C114 50 132 44 138 58" fill="none" stroke="#2e8a80" stroke-width="2.5"/>
    <circle cx="120" cy="64" r="4" fill="#3fa898" stroke="${INK}" stroke-width="1.5"/>
    <path d="M86 136 C70 146 40 152 24 162" fill="none" stroke="#c8a070" stroke-opacity=".6" stroke-width="1.5" stroke-dasharray="3 3"/>
    <path d="M20 162 C14 170 22 178 38 178 C60 178 70 174 74 170 C56 168 34 168 20 162 Z" fill="#120a06"/>
    <path d="M130 168 L134 178 H162 V160 H156 Z" fill="#1e120a" stroke="${INK}" stroke-width="3"/>
    <path d="M100 24 C96 60 100 100 92 132" fill="none" stroke="#e8c8a0" stroke-opacity=".18" stroke-width="5" stroke-linecap="round"/>
    <path d="M146 30 C150 70 144 100 150 124" fill="none" stroke="${RIM}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    <path d="M128 142 C140 150 156 150 166 146" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M128 142 C140 150 156 150 166 146" fill="none" stroke="#5a3a24" stroke-width="4" stroke-linecap="round"/>
    <path d="M154 150 L176 146" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
    <path d="M154 150 L176 146" stroke="#a8a49a" stroke-width="3" stroke-linecap="round"/>`,
  SH + lin('lt', [[0, '#6a4026'], [0.6, '#3a2214'], [1, '#180c06']], 0, 0, 1, 1));
  const bootAnim = (t, w) => ({ rot: -0.07 * w * pos(wave(t, 1.5)) });
  const boot = {
    parts: [
      { svg: bootSvg, pivot: [150, 178], anim: bootAnim },
      { pivot: [150, 178], anim: bootAnim, draw: (ctx, t, w) => {
        // Колёсико шпоры крутится.
        const a = t * (0.5 + w * 5);
        ctx.save();
        ctx.translate(178, 145);
        ctx.rotate(a);
        ctx.beginPath();
        for (let i = 0; i < 16; i++) {
          const r = i % 2 ? 6 : 16;
          const q = (i * Math.PI) / 8;
          ctx[i ? 'lineTo' : 'moveTo'](Math.cos(q) * r, Math.sin(q) * r);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(-3, -3, 1, 0, 0, 16);
        g.addColorStop(0, '#e8e4dc');
        g.addColorStop(1, '#5a5650');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = '#2a2622';
        ctx.fill();
        ctx.restore();
        if (w) R.glowAt(ctx, 178, 145, 22, '255, 220, 160', 0.25 * pos(wave(t, 2)));
      } },
    ],
  };

  // ---------- Стервятник ----------
  const vultureBody = svg(`
    ${shadow(104, 186, 70, 6)}
    <path d="M14 178 C50 170 90 176 120 170 C150 166 176 172 194 166 L192 182 C160 186 120 184 80 188 C50 190 26 188 12 190 Z" fill="#2a1a10" stroke="${INK}" stroke-width="3.5"/>
    <path d="M150 168 L170 150 M60 176 L44 160" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M150 168 L170 150 M60 176 L44 160" stroke="#3a2416" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M62 172 C50 142 54 104 76 88 C96 74 128 76 144 94 C162 114 160 148 148 174 Z" fill="url(#vb)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    ${[[80, 110], [92, 128], [76, 140], [100, 150], [88, 160], [110, 136]].map(([x, y]) => `<path d="M${x - 8} ${y} q8 8 16 0" fill="none" stroke="#4a3a34" stroke-opacity=".7" stroke-width="2"/>`).join('')}
    <path d="M88 172 L84 182 M96 172 L94 184 M104 172 L106 182 M116 172 L112 182 M124 172 L126 184 M132 172 L134 182" stroke="#8a8478" stroke-width="3" stroke-linecap="round"/>
    <path d="M64 120 C64 104 70 96 80 90" fill="none" stroke="#c8b8a8" stroke-opacity=".15" stroke-width="4" stroke-linecap="round"/>`,
  SH + lin('vb', [[0, '#2e2420'], [1, '#0c0806']], 0, 0, 1, 1));
  const vultureWing = svg(`
    <path d="M128 86 C158 90 176 120 172 162 L164 152 L162 170 L152 156 L148 174 L140 158 L134 172 C126 140 112 110 128 86 Z" fill="url(#vw)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M134 96 C150 110 160 130 162 150 M128 104 C140 124 146 146 146 164" fill="none" stroke="#5a4a44" stroke-opacity=".7" stroke-width="2"/>
    <path d="M150 92 C166 104 174 126 172 150" fill="none" stroke="${RIM}" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/>`,
  lin('vw', [[0, '#3a2c26'], [1, '#0e0a08']], 0, 0, 1, 1));
  const vultureHead = svg(`
    <path d="M70 88 C74 80 82 74 92 74 C104 74 114 80 116 90 C108 96 80 98 70 88 Z" fill="#cfc4b0" stroke="${INK}" stroke-width="3"/>
    ${[76, 84, 92, 100, 108].map((x) => `<path d="M${x} 92 q3 -8 6 0" fill="#e8dfcc" stroke="${INK}" stroke-width="1.2"/>`).join('')}
    <path d="M92 80 C88 66 82 54 74 48" fill="none" stroke="${INK}" stroke-width="13" stroke-linecap="round"/>
    <path d="M92 80 C88 66 82 54 74 48" fill="none" stroke="#7a3a34" stroke-width="8" stroke-linecap="round"/>
    <path d="M86 40 C80 30 64 30 58 38 C54 44 56 54 64 56 C72 58 84 54 86 46 Z" fill="url(#vh)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M58 42 C48 42 40 48 38 58 C44 54 50 52 56 52 Z" fill="#d8ccb0" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M38 58 C40 52 44 50 46 50" fill="none" stroke="#2a2018" stroke-width="2.5"/>
    <path d="M64 46 C66 50 72 52 76 50" fill="none" stroke="#4a1e1a" stroke-width="1.5"/>
    <circle cx="70" cy="40" r="3.6" fill="#120404" stroke="${INK}" stroke-width="1"/>
    <circle cx="69" cy="39" r="1.1" fill="#ffb070"/>
    <path d="M78 34 C84 36 86 42 84 46" fill="none" stroke="${RIM}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`,
  rad('vh', [[0, '#b0605a'], [0.6, '#7a3430'], [1, '#3a1410']], 0.4, 0.3, 0.8));
  const vultureLid = svg(`<ellipse cx="70" cy="40" rx="4.6" ry="4.6" fill="#6a2a26" stroke="${INK}" stroke-width="1.2"/>`);
  const headAnim = (t, w, k) => {
    const jerk = w * 0.18 * Math.sign(wave(t, 0.9)) * pos(Math.abs(wave(t, 0.9)) - 0.3);
    return { rot: 0.07 * wave(t, 0.21, k) + 0.04 * blip(t, 3.1, 0.4, k) + jerk };
  };
  const vulture = {
    parts: [
      { svg: vultureBody, pivot: [104, 172], anim: (t, w, k) => ({ sy: 1 + 0.015 * wave(t, 0.3, k) }) },
      { svg: vultureHead, pivot: [94, 86], anim: headAnim },
      { svg: vultureLid, pivot: [94, 86], anim: (t, w, k) => {
        const b = blip(t, 3.7, 0.2, k * 1.7);
        return { ...headAnim(t, w, k), a: b > 0.05 ? 1 : 0 };
      } },
      { svg: vultureWing, pivot: [130, 90], anim: (t, w, k) => ({ rot: -0.02 * wave(t, 0.3, k) - w * 0.45 * (0.55 + 0.45 * wave(t, 1.2)) }) },
    ],
  };

  // ---------- Бычий череп ----------
  const skullSvg = svg(`
    <path d="M70 62 C50 64 30 58 18 40 C12 30 10 22 14 16 C18 30 28 40 44 44 C56 48 66 48 74 50 Z" fill="url(#hn)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M130 62 C150 64 170 58 182 40 C188 30 190 22 186 16 C182 30 172 40 156 44 C144 48 134 48 126 50 Z" fill="url(#hn2)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[[30, 44], [40, 48], [50, 51], [170, 44], [160, 48], [150, 51]].map(([x, y]) => `<path d="M${x} ${y - 6} l${x < 100 ? 2 : -2} 10" stroke="${INK}" stroke-opacity=".5" stroke-width="1.5"/>`).join('')}
    <path d="M100 36 C130 36 146 52 146 74 C146 92 136 104 130 116 C126 132 122 160 116 176 C112 186 88 186 84 176 C78 160 74 132 70 116 C64 104 54 92 54 74 C54 52 70 36 100 36 Z" fill="url(#bn)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M76 84 C70 78 70 70 78 68 C88 66 96 74 94 86 C92 96 84 98 76 84 Z" fill="#0a0403" stroke="${INK}" stroke-width="2"/>
    <path d="M124 84 C130 78 130 70 122 68 C112 66 104 74 106 86 C108 96 116 98 124 84 Z" fill="#0a0403" stroke="${INK}" stroke-width="2"/>
    <path d="M92 156 C88 164 90 172 96 172 C98 168 98 160 92 156 Z M108 156 C112 164 110 172 104 172 C102 168 102 160 108 156 Z" fill="#0a0403"/>
    <path d="M100 44 L106 56 L100 68 L94 56 Z" fill="#3fa898" stroke="${INK}" stroke-width="2"/>
    <path d="M100 50 L103 56 L100 62 L97 56 Z" fill="#8a1a14"/>
    ${[[84, 48], [116, 48]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="#8a1a14" stroke="${INK}" stroke-width="1.2"/>`).join('')}
    <path d="M78 104 C84 116 92 120 100 120 C108 120 116 116 122 104" fill="none" stroke="#8a1a14" stroke-opacity=".8" stroke-width="2" stroke-dasharray="2 3"/>
    <path d="M112 40 L118 58 L112 72 L120 86" fill="none" stroke="${INK}" stroke-width="1.8"/>
    <path d="M84 124 L90 140 L86 150" fill="none" stroke="${INK}" stroke-width="1.5"/>
    ${hatch(60, 80, 74, 112, 5, INK, 0.25)}${hatch(84, 128, 92, 170, 4, INK, 0.2)}
    <path d="M64 70 C64 54 76 44 92 42" fill="none" stroke="#fff8e8" stroke-opacity=".35" stroke-width="4" stroke-linecap="round"/>
    <path d="M142 80 C138 100 130 112 126 128 C122 148 120 164 116 174" fill="none" stroke="${RIM}" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>`,
  lin('bn', [[0, BONE[0]], [0.55, BONE[1]], [1, BONE[2]]], 0, 0, 0.6, 1)
  + lin('hn', [[0, '#1a120c'], [0.5, '#6a5a44'], [1, '#c8bca0']], 0, 0, 1, 0) + lin('hn2', [[0, '#c8bca0'], [0.5, '#6a5a44'], [1, '#1a120c']], 0, 0, 1, 0));
  const skull = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 90, 90, '200, 50, 10', 0.1 + w * 0.2) },
      { svg: skullSvg, pivot: [100, 110], anim: (t, w, k) => ({ rot: 0.02 * wave(t, 0.25, k) + w * 0.03 * wave(t, 2.2), dy: -w * 3 * pos(wave(t, 1.1)) }) },
    ],
    fx: (ctx, t, w, k) => {
      const dy = -w * 3 * pos(wave(t, 1.1));
      ember(ctx, t, 84, 82 + dy, 5, k, w);
      ember(ctx, t, 116, 82 + dy, 5, k + 1.3, w);
      if (w) {
        R.smoke(ctx, t, 84, 76 + dy, { n: 4, rise: 50, size: 6, color: '255, 120, 40', a: 0.35, speed: 0.6 });
        R.smoke(ctx, t + 0.4, 116, 76 + dy, { n: 4, rise: 50, size: 6, color: '255, 120, 40', a: 0.35, speed: 0.6 });
      }
    },
  };

  // ---------- Человеческий череп (для бармена и шерифа) ----------
  const humanSkull = (cx, cy, id) => `
    <path d="M${cx - 32} ${cy - 6} C${cx - 34} ${cy - 40} ${cx - 18} ${cy - 52} ${cx} ${cy - 52} C${cx + 18} ${cy - 52} ${cx + 34} ${cy - 40} ${cx + 32} ${cy - 6} C${cx + 32} ${cy + 10} ${cx + 26} ${cy + 18} ${cx + 22} ${cy + 26} L${cx + 22} ${cy + 40} C${cx + 14} ${cy + 46} ${cx - 14} ${cy + 46} ${cx - 22} ${cy + 40} L${cx - 22} ${cy + 26} C${cx - 26} ${cy + 18} ${cx - 32} ${cy + 10} ${cx - 32} ${cy - 6} Z" fill="url(#${id})" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M${cx - 24} ${cy - 2} C${cx - 26} ${cy - 14} ${cx - 8} ${cy - 16} ${cx - 6} ${cy - 4} C${cx - 4} ${cy + 8} ${cx - 22} ${cy + 10} ${cx - 24} ${cy - 2} Z" fill="#0a0403"/>
    <path d="M${cx + 24} ${cy - 2} C${cx + 26} ${cy - 14} ${cx + 8} ${cy - 16} ${cx + 6} ${cy - 4} C${cx + 4} ${cy + 8} ${cx + 22} ${cy + 10} ${cx + 24} ${cy - 2} Z" fill="#0a0403"/>
    <path d="M${cx} ${cy + 8} L${cx + 5} ${cy + 18} H${cx - 5} Z" fill="#0a0403"/>
    <path d="M${cx - 18} ${cy + 30} H${cx + 18}" stroke="${INK}" stroke-width="2"/>
    ${[-12, -6, 0, 6, 12].map((d) => `<path d="M${cx + d} ${cy + 24} V${cy + 38}" stroke="${INK}" stroke-width="1.5"/>`).join('')}
    <path d="M${cx + 20} ${cy - 40} L${cx + 14} ${cy - 30} L${cx + 20} ${cy - 22}" fill="none" stroke="${INK}" stroke-width="1.5"/>
    <path d="M${cx - 26} ${cy - 20} C${cx - 24} ${cy - 36} ${cx - 14} ${cy - 44} ${cx - 2} ${cy - 46}" fill="none" stroke="#fff8e8" stroke-opacity=".35" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M${cx + 30} ${cy - 20} C${cx + 32} ${cy} ${cx + 26} ${cy + 16} ${cx + 22} ${cy + 24}" fill="none" stroke="${RIM}" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`;
  const boneGrad = (id) => lin(id, [[0, BONE[0]], [0.6, BONE[1]], [1, BONE[2]]], 0, 0, 0.5, 1);

  // ---------- Бармен ----------
  const barmanBody = svg(`
    <path d="M18 200 C22 162 44 140 74 132 L126 132 C156 140 178 162 182 200 Z" fill="#d8ccb4" stroke="${INK}" stroke-width="4"/>
    <path d="M18 200 C22 168 34 152 50 144 L60 200 Z M182 200 C178 168 166 152 150 144 L140 200 Z" fill="#c8bca4" stroke="${INK}" stroke-width="2.5"/>
    <path d="M40 166 L56 162 M144 162 L160 166" stroke="#8a1a14" stroke-width="6" stroke-linecap="round"/>
    <path d="M62 136 L84 132 L100 170 L116 132 L138 136 L146 200 H54 Z" fill="url(#vs)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    ${[176, 188].map((y) => `<circle cx="100" cy="${y}" r="3" fill="#c9a14a" stroke="${INK}" stroke-width="1.2"/>`).join('')}
    <path d="M120 150 H134" stroke="#c9a14a" stroke-width="2"/><path d="M134 150 C138 160 132 168 128 172" fill="none" stroke="#c9a14a" stroke-width="1.2"/>
    <path d="M86 128 L100 136 L114 128 L114 144 L100 138 L86 144 Z" fill="#7a1410" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="100" cy="137" r="3.5" fill="#4a0a08" stroke="${INK}" stroke-width="1.5"/>
    <path d="M140 140 C150 150 152 170 150 200" fill="none" stroke="${RIM}" stroke-opacity=".4" stroke-width="2.5"/>`,
  lin('vs', [[0, '#2e1e18'], [1, '#100806']], 0, 0, 1, 1));
  const barmanHead = svg(`
    ${humanSkull(100, 82, 'hb')}
    <path d="M66 66 C62 40 82 24 100 26 C118 24 138 40 134 66 C128 52 114 44 102 48 L100 40 L98 48 C86 44 72 52 66 66 Z" fill="url(#hr)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M100 30 V46" stroke="#5a5a60" stroke-width="1.5"/>
    <path d="M82 36 C90 32 96 34 98 40 M118 36 C110 32 104 34 102 40" fill="none" stroke="#6a6a74" stroke-opacity=".7" stroke-width="1.5"/>`,
  boneGrad('hb') + lin('hr', [[0, '#2a2a30'], [1, '#08080a']]));
  const barmanStache = svg(`<g transform="translate(100 100) scale(1 .8) translate(-100 -105)"><path d="M100 98 C90 94 76 96 70 104 C66 110 70 116 74 112 C76 104 90 102 100 104 C110 102 124 104 126 112 C130 116 134 110 130 104 C124 96 110 94 100 98 Z" fill="#141416" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M86 99 C92 98 96 99 100 101" fill="none" stroke="#5a5a64" stroke-width="1.2"/></g>`);
  const barmanArm = svg(`
    <path d="M164 200 L170 160 L150 128" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M164 200 L170 160 L150 128" fill="none" stroke="#d8ccb4" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M136 122 C142 114 156 114 160 124 C162 132 152 138 144 134 Z" fill="#d8ccb4" stroke="${INK}" stroke-width="2.5"/>
    <path d="M132 92 H162 L158 128 H136 Z" fill="rgba(170, 200, 200, .22)" stroke="${INK}" stroke-width="3"/>
    <path d="M135 106 H159 L157 126 H137 Z" fill="#b8641e" opacity=".85"/>
    <path d="M138 96 L140 124" stroke="#fff" stroke-opacity=".4" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M128 126 C136 118 160 120 164 132 C156 142 140 144 130 138 Z" fill="#cfc4b0" stroke="${INK}" stroke-width="2"/>`);
  const barman = {
    parts: [
      { svg: barmanBody },
      { svg: barmanHead, pivot: [100, 124], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.23, k) + w * 0.08 * wave(t, 1.1) }) },
      { svg: barmanStache, pivot: [100, 124], anim: (t, w, k) => {
        const head = 0.04 * wave(t, 0.23, k) + w * 0.08 * wave(t, 1.1);
        const tw = blip(t, 2.8, 0.25, k) + w * pos(wave(t, 3));
        return { rot: head, sy: 1 - 0.12 * tw, dy: -2 * tw };
      } },
      { svg: barmanArm, pivot: [166, 196], anim: (t, w, k) => ({ rot: 0.03 * wave(t, 0.4, k) - w * 0.22 * (0.6 + 0.4 * wave(t, 1)), dx: 1.5 * wave(t, 0.8, k) }) },
    ],
    fx: (ctx, t, w, k) => {
      const head = 0.04 * wave(t, 0.23, k) + w * 0.08 * wave(t, 1.1);
      ctx.save();
      ctx.translate(100, 124);
      ctx.rotate(head);
      ctx.translate(-100, -124);
      ember(ctx, t, 85, 80, 3.5, k, w);
      ember(ctx, t, 115, 80, 3.5, k + 1, w);
      ctx.restore();
    },
  };

  // ---------- Шериф ----------
  const sheriffBody = svg(`
    <path d="M14 200 C18 160 42 138 76 132 L124 132 C158 138 182 160 186 200 Z" fill="url(#ct)" stroke="${INK}" stroke-width="4"/>
    <path d="M76 132 L92 176 L100 140 L108 176 L124 132" fill="#d8ccb4" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M76 132 L60 160 L88 200 M124 132 L140 160 L112 200" fill="none" stroke="${INK}" stroke-width="3"/>
    <path d="M86 132 L100 146 L114 132" fill="#1a1010" stroke="${INK}" stroke-width="2.5"/>
    <path d="M150 140 C164 150 176 170 180 196" fill="none" stroke="${RIM}" stroke-opacity=".4" stroke-width="3" stroke-linecap="round"/>
    ${hatch(28, 160, 56, 196, 6, INK, 0.25)}`,
  lin('ct', [[0, '#4a3020'], [0.6, '#24160e'], [1, '#0e0806']], 0, 0, 1, 1));
  const starPts = (cx, cy, r1, r2) => Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 ? r2 : r1;
    return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
  }).join(' ');
  const sheriffStar = svg(`
    <polygon points="${starPts(140, 166, 17, 8)}" fill="url(#st)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    ${Array.from({ length: 5 }, (_, i) => {
    const a = (i * 2 * Math.PI) / 5 - Math.PI / 2;
    return `<circle cx="${(140 + Math.cos(a) * 17).toFixed(1)}" cy="${(166 + Math.sin(a) * 17).toFixed(1)}" r="2.6" fill="url(#st)" stroke="${INK}" stroke-width="1.2"/>`;
  }).join('')}
    <circle cx="140" cy="166" r="5" fill="none" stroke="#5a4a20" stroke-width="1.5"/>`,
  rad('st', [[0, '#fff0b0'], [0.5, '#c9a14a'], [1, '#5a4010']], 0.35, 0.3, 0.8));
  const sheriffHead = svg(`${humanSkull(100, 96, 'hs')}`, boneGrad('hs'));
  const sheriffHat = svg(`<g transform="translate(0 -12)">
    <path d="M10 66 C24 82 56 88 100 88 C144 88 176 82 190 66 C192 80 176 100 100 102 C24 100 8 80 10 66 Z" fill="url(#hbr)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M56 82 C54 56 60 28 74 16 C84 8 92 18 100 12 C108 18 116 8 126 16 C140 28 146 56 144 82 C126 90 74 90 56 82 Z" fill="url(#hcr)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M100 14 C96 34 98 56 100 66" fill="none" stroke="${INK}" stroke-opacity=".5" stroke-width="2.5"/>
    <path d="M56 70 C74 78 126 78 144 70 L144 82 C126 90 74 90 56 82 Z" fill="#14100c" stroke="${INK}" stroke-width="2.5"/>
    <path d="M140 26 C146 42 148 60 146 76" fill="none" stroke="${RIM}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    <path d="M70 22 C62 38 60 58 62 74" fill="none" stroke="#e8c8a0" stroke-opacity=".14" stroke-width="5" stroke-linecap="round"/>
    <path d="M172 76 C184 80 186 90 172 98" fill="none" stroke="${RIM}" stroke-opacity=".45" stroke-width="2.5" stroke-linecap="round"/></g>`,
  lin('hbr', [[0, '#5a4430'], [1, '#1e140c']]) + lin('hcr', [[0, '#6a5038'], [0.6, '#3a2818'], [1, '#160e08']], 0, 0, 1, 1));
  const sheriffHeadAnim = (t, w, k) => ({ rot: 0.03 * wave(t, 0.2, k) });
  const sheriff = {
    parts: [
      { svg: sheriffBody },
      { svg: sheriffStar },
      { svg: sheriffHead, pivot: [100, 138], anim: sheriffHeadAnim },
      { pivot: [100, 138], anim: sheriffHeadAnim, draw: (ctx, t, w, k) => {
        // Сигара в зубах, тлеющий кончик.
        ctx.save();
        ctx.translate(112, 126);
        ctx.rotate(0.2 + 0.03 * wave(t, 0.5, k));
        ctx.fillStyle = INK;
        ctx.fillRect(-2, -5, 34, 10);
        ctx.fillStyle = '#6a3a1a';
        ctx.fillRect(0, -3.5, 30, 7);
        ctx.fillStyle = '#8a1a14';
        ctx.fillRect(6, -3.5, 5, 7);
        const glow = 0.6 + 0.4 * wave(t, 0.7, k) + w * 0.4;
        ctx.fillStyle = `rgba(255, ${120 + 80 * glow}, 40, 1)`;
        ctx.fillRect(28, -3.5, 4, 7);
        R.glowAt(ctx, 31, 0, 10, '255, 120, 30', 0.5 * glow);
        ctx.restore();
      } },
      { svg: sheriffHat, pivot: [100, 80], anim: (t, w, k) => {
        const tip = w * pos(wave(t, 0.7));
        return { rot: sheriffHeadAnim(t, w, k).rot + 0.03 * wave(t, 0.3, k + 1) - 0.12 * tip, dy: -10 * tip };
      } },
    ],
    fx: (ctx, t, w, k) => {
      const r = sheriffHeadAnim(t, w, k).rot;
      ctx.save();
      ctx.translate(100, 138);
      ctx.rotate(r);
      ctx.translate(-100, -138);
      ember(ctx, t, 85, 94, 4, k, w);
      ember(ctx, t, 115, 94, 4, k + 1.4, w);
      ctx.restore();
      R.smoke(ctx, t, 140, 130, { n: 5, rise: 90, drift: 22, size: 7, color: '190, 180, 170', a: 0.3 + w * 0.15, speed: 0.25 });
      if (w) {
        // Звезда шерифа поблёскивает.
        const g = pos(wave(t, 1.3));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(255, 240, 190, ${0.8 * g})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(146, 146);
        ctx.lineTo(146, 166);
        ctx.moveTo(136, 156);
        ctx.lineTo(156, 156);
        ctx.stroke();
        R.glowAt(ctx, 146, 156, 10, '255, 240, 190', 0.6 * g);
        ctx.restore();
      }
    },
  };

  // ---------- Кольт (WILD) ----------
  // Ствол влево, рукоять вправо-вниз. Барабан — живая деталь: каморы проворачиваются.
  const coltFrame = svg(`
    <g transform="rotate(-8 100 110)">
      <path d="M150 96 C160 108 172 136 176 160 C178 172 160 176 150 168 C142 150 136 126 128 112 Z" fill="url(#gp)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      ${[[150, 128], [156, 142], [160, 156]].map(([x, y]) => `<path d="M${x - 8} ${y} l14 -4" stroke="#1a0a06" stroke-opacity=".6" stroke-width="2"/>`).join('')}
      <circle cx="156" cy="140" r="6" fill="url(#cn2)" stroke="${INK}" stroke-width="1.5"/>
      <path d="M118 108 C114 126 124 136 138 130" fill="none" stroke="${INK}" stroke-width="6"/>
      <path d="M118 108 C114 126 124 136 138 130" fill="none" stroke="#8a8478" stroke-width="3"/>
      <path d="M128 108 L130 122" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
      <path d="M10 80 H104 V98 H10 Z" fill="url(#bl)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M10 98 H78 V108 H14 Z" fill="url(#bl)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
      <path d="M16 76 H22 V80 H16 Z" fill="#8a8478" stroke="${INK}" stroke-width="2"/>
      <path d="M100 74 H148 C152 76 154 84 152 96 L148 108 H100 Z" fill="url(#fr)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M14 84 H100" stroke="#ffffff" stroke-opacity=".35" stroke-width="2"/>
      <path d="M30 90 C40 86 50 94 60 90 C70 86 80 94 90 90" fill="none" stroke="#3a3a3a" stroke-opacity=".6" stroke-width="1.2"/>
      <path d="M14 96 H100" stroke="${RIM}" stroke-opacity=".35" stroke-width="1.5"/>
      <circle cx="10" cy="89" r="3" fill="#050202"/>
    </g>`,
  lin('bl', [[0, '#d8d8d0'], [0.4, '#7a7a76'], [1, '#262628']]) + lin('fr', [[0, '#b8b8b0'], [0.5, '#5a5a58'], [1, '#1e1e20']])
  + lin('gp', [[0, '#e0d4b8'], [0.5, '#a8987a'], [1, '#4a4030']], 0, 0, 1, 1) + rad('cn2', [[0, '#fff0c0'], [0.6, '#c9a14a'], [1, '#4a3410']], 0.35, 0.35, 0.7));
  const coltHammer = svg(`<g transform="rotate(-8 100 110)"><path d="M140 78 L150 60 C154 56 160 58 158 64 L150 82 Z" fill="url(#hm)" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></g>`,
    lin('hm', [[0, '#a8a8a0'], [1, '#2a2a2a']]));
  const wildRibbon = svg(`
    <path d="M24 158 H176 L166 172 L176 186 H24 L34 172 Z" fill="url(#rb)" stroke="${INK}" stroke-width="3"/>
    <path d="M30 162 H170 M30 182 H170" stroke="#c9a07a" stroke-opacity=".7" stroke-width="1.2"/>`,
  lin('rb', [[0, '#2a0e08'], [0.5, '#0e0403'], [1, '#2a0e08']]));
  const recoil = (t, w) => w * blip(t, 1.6, 0.35, 0.2);
  const coltAnim = (t, w, k) => ({ rot: 0.015 * wave(t, 0.3, k) - 0.14 * recoil(t, w), dx: 5 * recoil(t, w) });
  const colt = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 100, 90, '200, 70, 20', 0.12 + w * 0.2) },
      { svg: coltFrame, pivot: [160, 160], anim: coltAnim },
      { pivot: [160, 160], anim: coltAnim, draw: (ctx, t, w) => {
        // Барабан: каморы уходят за край — видно, как он проворачивается.
        ctx.save();
        ctx.translate(100, 110);
        ctx.rotate(-8 * Math.PI / 180);
        ctx.translate(-100, -110);
        const x0 = 104;
        const x1 = 140;
        const cy0 = 91;
        const hh = 18;
        ctx.beginPath();
        ctx.moveTo(x0 + 4, cy0 - hh);
        ctx.lineTo(x1 - 4, cy0 - hh);
        ctx.quadraticCurveTo(x1, cy0 - hh, x1, cy0 - hh + 4);
        ctx.lineTo(x1, cy0 + hh - 4);
        ctx.quadraticCurveTo(x1, cy0 + hh, x1 - 4, cy0 + hh);
        ctx.lineTo(x0 + 4, cy0 + hh);
        ctx.quadraticCurveTo(x0, cy0 + hh, x0, cy0 + hh - 4);
        ctx.lineTo(x0, cy0 - hh + 4);
        ctx.quadraticCurveTo(x0, cy0 - hh, x0 + 4, cy0 - hh);
        const g = ctx.createLinearGradient(0, cy0 - hh, 0, cy0 + hh);
        g.addColorStop(0, '#3a3a3a');
        g.addColorStop(0.35, '#c8c8c0');
        g.addColorStop(1, '#1a1a1c');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.save();
        ctx.clip();
        const ang = t * 0.4 + w * t * 9;
        for (let i = 0; i < 6; i++) {
          const a = ang + (i * Math.PI) / 3;
          const c = Math.cos(a);
          if (c < 0) continue;
          const y = cy0 + Math.sin(a) * hh;
          ctx.fillStyle = `rgba(10, 8, 8, ${0.35 + 0.5 * c})`;
          ctx.beginPath();
          ctx.ellipse((x0 + x1) / 2, y, (x1 - x0) / 2 - 3, 3 + 3 * c, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        ctx.restore();
      } },
      { svg: coltHammer, pivot: [150, 82], anim: (t, w, k) => {
        const m = coltAnim(t, w, k);
        return { ...m, rot: m.rot + 0.35 * w * pos(wave(t, 0.625, 1.6)) };
      } },
      { svg: wildRibbon },
    ],
    fx: (ctx, t, w, k) => {
      // Дымок из ствола, на выигрыше — выстрел со вспышкой.
      const f = recoil(t, w);
      const mx = 12 + 5 * f;
      const my = 80;
      R.smoke(ctx, t + k, mx, my, { n: 5, rise: 60, drift: 14, size: 6, color: '200, 190, 180', a: 0.22 + w * 0.2, speed: 0.3 });
      if (f > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        R.glowAt(ctx, mx - 4, my + 2, 30 * f, '255, 200, 90', 0.9 * f);
        ctx.fillStyle = `rgba(255, 240, 200, ${f})`;
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = Math.PI + ((i - 6) / 6) * 1.2;
          const r = i % 2 ? 6 : 22 * f + 6;
          ctx.lineTo(mx + Math.cos(a) * r, my + 2 + Math.sin(a) * r);
        }
        ctx.fill();
        ctx.restore();
      }
      ctx.font = `26px ${TITLE_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tg = ctx.createLinearGradient(0, 162, 0, 184);
      tg.addColorStop(0, '#f1e6d0');
      tg.addColorStop(0.55, '#c9a07a');
      tg.addColorStop(1, '#6e3a1a');
      ctx.fillStyle = 'rgba(0, 0, 0, .85)';
      ctx.fillText('WILD', 100, 174.5);
      ctx.fillStyle = tg;
      ctx.fillText('WILD', 100, 173);
    },
  };

  // ---------- Плакат «Розыск» (скаттер) ----------
  const posterPath = 'M30 22 L94 18 L100 24 L106 18 L170 22 L166 70 L172 110 L166 150 L170 186 L132 182 L120 190 L100 184 L60 188 L34 182 L30 140 L24 100 L32 60 Z';
  const wantedSvg = svg(`
    ${shadow(100, 190, 70, 6)}
    <path d="${posterPath}" fill="url(#pp)" stroke="#3a1a08" stroke-width="7" stroke-linejoin="round"/>
    <path d="${posterPath}" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M44 62 H156" stroke="#3a1a08" stroke-opacity=".7" stroke-width="2"/>
    <rect x="62" y="68" width="76" height="70" fill="#a89068" stroke="#3a1a08" stroke-width="2.5"/>
    <path d="M100 74 C116 74 124 86 124 98 C124 108 118 114 116 120 L116 128 C110 132 90 132 84 128 L84 120 C82 114 76 108 76 98 C76 86 84 74 100 74 Z" fill="#3a2414" opacity=".85"/>
    <path d="M70 86 C80 80 120 80 130 86 L126 80 C116 66 84 66 74 80 Z" fill="#2a180c"/>
    <path d="M60 86 C76 92 124 92 140 86" fill="none" stroke="#2a180c" stroke-width="4" stroke-linecap="round"/>
    <circle cx="91" cy="100" r="5" fill="#c8b48a"/><circle cx="109" cy="100" r="5" fill="#c8b48a"/>
    <path d="M44 146 H156 M54 156 H146" stroke="#3a1a08" stroke-opacity=".6" stroke-width="2"/>
    ${[[48, 128], [150, 52], [138, 170]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#0a0403"/><circle cx="${x}" cy="${y}" r="7" fill="none" stroke="#2a1006" stroke-opacity=".7" stroke-width="2.5"/>`).join('')}
    <path d="M166 70 L172 110 L166 150 L170 186 L132 182" fill="none" stroke="#1a0804" stroke-width="5" stroke-linejoin="round" opacity=".8"/>
    ${hatch(34, 30, 46, 180, 6, '#5a3a18', 0.18, 1)}
    <circle cx="100" cy="24" r="4.5" fill="#8a8680" stroke="${INK}" stroke-width="2"/>`,
  SH + lin('pp', [[0, '#d8c49a'], [0.6, '#b49a6a'], [1, '#7a5a34']], 0, 0, 1, 1));
  const wantedAnim = (t, w, k) => ({ rot: 0.025 * wave(t, 0.4, k) + w * 0.06 * wave(t, 1.4), sx: 1 + 0.008 * wave(t, 1.1, k) });
  const wanted = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 104, 96, '230, 120, 40', 0.12 + w * 0.25) },
      { svg: wantedSvg, pivot: [100, 24], anim: wantedAnim },
      { pivot: [100, 24], anim: wantedAnim, draw: (ctx, t, w, k) => {
        // Надписи и тлеющий край.
        ctx.font = `25px ${TITLE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#2a1006';
        ctx.fillText('РОЗЫСК', 100, 44);
        ctx.font = '700 15px Oswald, sans-serif';
        ctx.fillText('НАГРАДА', 100, 168);
        for (const [x, y, ph] of [[168, 96, 0], [170, 132, 1.7], [160, 184, 3.1], [140, 182, 4.3]]) {
          const f = 0.5 + 0.35 * wave(t, 1.3, ph + k) + w * 0.4;
          R.glowAt(ctx, x, y, 12, '255, 110, 30', 0.6 * f);
          R.glowAt(ctx, x, y, 4, '255, 220, 120', 0.8 * f);
        }
        R.smoke(ctx, t + k, 166, 120, { n: 3, rise: 60, size: 5, color: '120, 100, 90', a: 0.25, speed: 0.25 });
      } },
    ],
    fx: (ctx, t, w) => R.sweep(ctx, t, w, { color: '255, 210, 150' }),
  };

  root.SaloonRig = { SYMBOLS: { horseshoe, whiskey, hat, boot, vulture, skull, barman, sheriff, colt, wanted } };
})(window);
