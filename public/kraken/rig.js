// «Кракен»: анимированные символы, нарисованные вручную (SVG-детали + живые кривые).
// Стиль: мрачная иллюстрация — тёмный контур, глубокие тени, холодный свет сверху, биолюминесценция.
// window.KrakenRig = { SYMBOLS: { id: def }, pearl(tone) -> def }.
(function (root) {
  'use strict';

  const R = root.SlotRig;
  const INK = '#05080a';
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  // Тонкая штриховка тенью — «гравюрный» объём.
  const hatch = (x0, y0, x1, y1, n, color = INK, a = 0.35, w = 1.2) => Array.from({ length: n }, (_, i) => {
    const f = i / (n - 1 || 1);
    return `<path d="M${(x0 + (x1 - x0) * f).toFixed(1)} ${y0} l${((x1 - x0) / n * 0.6).toFixed(1)} ${(y1 - y0).toFixed(1)}" stroke="${color}" stroke-opacity="${a}" stroke-width="${w}"/>`;
  }).join('');
  const wave = R.wave;
  const blip = R.blip;

  // ---------- Кракен (WILD) ----------
  // Вытянутая мантия, глаза на буграх по бокам, нависшие надбровья, горизонтальные зрачки и клюв.
  const KR_EYES = [[68, 113, 0.22], [132, 113, -0.22]];
  const krHead = svg(`
    <ellipse cx="100" cy="150" rx="66" ry="14" fill="#000" opacity=".5" filter="url(#hb)"/>
    <path d="M100 4 C140 2 160 30 157 64 C155 84 148 92 150 100 C162 108 160 126 146 136 L54 136 C40 126 38 108 50 100 C52 92 45 84 43 64 C40 30 60 6 100 4 Z" fill="url(#hg)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M146 30 C156 46 158 66 152 84" fill="none" stroke="#5fe8d8" stroke-opacity=".22" stroke-width="3" stroke-linecap="round"/>
    <path d="M58 52 C60 30 76 14 100 12" fill="none" stroke="#e0a0a0" stroke-opacity=".2" stroke-width="6" stroke-linecap="round"/>
    ${[[54, 64, 42], [62, 80, 38], [76, 92, 24]].map(([x, y, l]) => `<path d="M${x} ${y} q${l / 2} 6 ${l} 0" fill="none" stroke="${INK}" stroke-opacity=".35" stroke-width="2"/>`).join('')}
    ${[[124, 66, 30], [130, 82, 22]].map(([x, y, l]) => `<path d="M${x} ${y} q${l / 2} 6 ${l} 0" fill="none" stroke="${INK}" stroke-opacity=".35" stroke-width="2"/>`).join('')}
    ${[[74, 30, 6], [122, 24, 4], [138, 46, 7], [90, 46, 4], [112, 56, 5], [66, 44, 3], [104, 30, 3], [146, 70, 3.5], [58, 74, 4]].map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.8}" fill="#1a0308" opacity=".55"/>`).join('')}
    <path d="M86 14 C84 30 90 40 86 58 M118 18 C122 32 116 46 122 62" fill="none" stroke="#1a0308" stroke-width="1.6" opacity=".6"/>
    ${hatch(48, 70, 62, 98, 6, INK, 0.3)}${hatch(140, 70, 154, 98, 6, INK, 0.3)}
    <path d="M44 98 C56 92 84 100 92 112 C80 106 62 104 46 110 Z" fill="#1a0308"/>
    <path d="M156 98 C144 92 116 100 108 112 C120 106 138 104 154 110 Z" fill="#1a0308"/>
    ${KR_EYES.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="18" ry="13" transform="rotate(${a * 57.3} ${x} ${y})" fill="#14020a" stroke="${INK}" stroke-width="2.5"/>`).join('')}
    <path d="M44 100 C58 90 82 96 94 110" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M156 100 C142 90 118 96 106 110" fill="none" stroke="${INK}" stroke-width="5.5" stroke-linecap="round"/>
    <path d="M96 100 C98 108 98 116 96 122 M104 100 C102 108 102 116 104 122" fill="none" stroke="${INK}" stroke-opacity=".6" stroke-width="2"/>
    <path d="M88 124 C92 138 108 138 112 124 L100 146 Z" fill="#0a0204" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M94 128 L100 140" stroke="#5a4a40" stroke-opacity=".6" stroke-width="1.5"/>`,
  rad('hg', [[0, '#7a2232'], [0.45, '#3e0a14'], [1, '#120206']], 0.4, 0.22, 0.85) + blur('hb', 5));
  const krEyes = svg(`
    ${KR_EYES.map(([x, y, a]) => `<g transform="rotate(${a * 57.3} ${x} ${y})">
      <ellipse cx="${x}" cy="${y}" rx="13" ry="8.5" fill="url(#ey)" stroke="${INK}" stroke-width="2.5"/>
      <rect x="${x - 9}" y="${y - 2.2}" width="18" height="4.4" rx="2.2" fill="${INK}"/>
      <ellipse cx="${x - 4}" cy="${y - 4}" rx="3" ry="1.4" fill="#fffbe0" opacity=".75"/></g>`).join('')}`,
  rad('ey', [[0, '#ffe680'], [0.55, '#e0a020'], [1, '#5a2a04']]));
  const krLids = svg(`
    ${KR_EYES.map(([x, y, a]) => `<g transform="rotate(${a * 57.3} ${x} ${y})"><ellipse cx="${x}" cy="${y}" rx="15" ry="10.5" fill="#3a0812" stroke="${INK}" stroke-width="2.5"/><path d="M${x - 13} ${y + 2} Q${x} ${y + 6} ${x + 13} ${y + 2}" fill="none" stroke="${INK}" stroke-width="2"/></g>`).join('')}`);
  const wildRibbon = svg(`
    <path d="M24 158 H176 L166 172 L176 186 H24 L34 172 Z" fill="url(#rb)" stroke="${INK}" stroke-width="3"/>
    <path d="M30 162 H170" stroke="#c9a14a" stroke-opacity=".7" stroke-width="1.2"/><path d="M30 182 H170" stroke="#c9a14a" stroke-opacity=".7" stroke-width="1.2"/>`,
  lin('rb', [[0, '#1c140c'], [0.5, '#070504'], [1, '#1c140c']]));

  // Щупальце кракена в кадре: опорные точки колышутся, кончик закручивается.
  function krTentacle(ctx, base, dir, len, t, w, ph, width, curlDir = 1) {
    const amp = 8 + w * 14;
    const sp = 0.3 + w * 0.9;
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5;
      const sway = wave(t, sp, ph + f * 2.2) * amp * f;
      const curl = f > 0.55 ? (f - 0.55) * 70 * curlDir : 0;
      pts.push([base[0] + dir[0] * len * f + dir[1] * (sway + curl), base[1] + dir[1] * len * f - dir[0] * (sway + curl)]);
    }
    R.tentacle(ctx, pts, width, 3, { colors: ['#1a0308', '#4a0c18', '#8a2f3a'], sucker: '#a08478', suckerSide: curlDir });
  }

  const wild = {
    parts: [
      { draw: (ctx, t, w) => {
        // Свечение бездны за кракеном.
        R.glowAt(ctx, 100, 90, 98, '110, 14, 30', 0.3 + w * 0.25);
        R.glowAt(ctx, 100, 130, 70, '40, 180, 170', 0.08 + w * 0.1);
      } },
      { draw: (ctx, t, w, k) => {
        krTentacle(ctx, [56, 120], [-0.8, -0.6], 62, t, w, k, 22, 1);
        krTentacle(ctx, [144, 120], [0.8, -0.6], 62, t, w, k + 1.7, 22, -1);
        krTentacle(ctx, [56, 132], [-0.75, 0.66], 64, t, w, k + 0.9, 20, -1);
        krTentacle(ctx, [144, 132], [0.75, 0.66], 64, t, w, k + 2.6, 20, 1);
      } },
      { svg: krHead, pivot: [100, 136], anim: (t, w, k) => ({ sy: 1 + 0.02 * wave(t, 0.22, k) + w * 0.035 * wave(t, 1.8), sx: 1 - 0.012 * wave(t, 0.22, k) }) },
      { draw: (ctx, t, w, k) => {
        krTentacle(ctx, [80, 134], [-0.3, 1], 48, t, w, k + 3.3, 18, 1);
        krTentacle(ctx, [120, 134], [0.3, 1], 48, t, w, k + 4.1, 18, -1);
      } },
      { svg: krEyes, pivot: [100, 113], anim: (t, w, k) => ({ dy: 0.6 * wave(t, 0.22, k) }) },
      { svg: krLids, pivot: [100, 104], anim: (t, w, k) => {
        const b = blip(t, 4.6, 0.24, k * 1.3);
        return { sy: b, a: b > 0.03 ? 1 : 0 };
      } },
      { svg: wildRibbon },
    ],
    fx: (ctx, t, w, k) => {
      const g = 0.4 + 0.15 * wave(t, 0.5, k) + w * 0.45;
      for (const [x, y] of KR_EYES) R.glowAt(ctx, x, y, 20, '255, 190, 60', g * 0.3);
      R.bubbles(ctx, t + k, 100, 40, { n: 3, rise: 40, spread: 70, a: 0.3 });
      ctx.font = '700 22px "Cormorant SC", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tg = ctx.createLinearGradient(0, 162, 0, 182);
      tg.addColorStop(0, '#f5e2a8');
      tg.addColorStop(0.55, '#c9a14a');
      tg.addColorStop(1, '#6b4a14');
      ctx.fillStyle = 'rgba(0, 0, 0, .8)';
      ctx.fillText('WILD', 100, 173.5);
      ctx.fillStyle = tg;
      ctx.fillText('WILD', 100, 172);
    },
  };

  // ---------- Якорь ----------
  const anchorSvg = svg(`
    <g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">
      <circle cx="100" cy="28" r="15" fill="none" stroke-width="13"/>
      <circle cx="100" cy="28" r="15" fill="none" stroke="url(#br)" stroke-width="6"/>
      <path d="M34 114 Q40 170 100 176 Q160 170 166 114" fill="none" stroke-width="24"/>
      <path d="M34 114 Q40 170 100 176 Q160 170 166 114" fill="none" stroke="url(#ir)" stroke-width="14"/>
      <path d="M18 128 L32 82 L56 120 C46 116 34 118 18 128 Z" fill="url(#ir2)" stroke-width="4.5"/>
      <path d="M182 128 L168 82 L144 120 C154 116 166 118 182 128 Z" fill="url(#ir2)" stroke-width="4.5"/>
      <rect x="89" y="40" width="22" height="134" rx="8" fill="url(#ir)" stroke-width="4.5"/>
      <circle cx="100" cy="172" r="12" fill="url(#ir2)" stroke-width="4.5"/>
      <rect x="50" y="56" width="100" height="16" rx="7" fill="url(#ir2)" stroke-width="4.5"/>
    </g>
    ${[[96, 92, 9, 6], [104, 140, 7, 5], [60, 150, 10, 4], [150, 136, 8, 5], [124, 62, 8, 4]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#6a2c10" opacity=".6"/>`).join('')}
    ${[[92, 120], [108, 100], [70, 160], [140, 152], [62, 62], [138, 64], [100, 166]].map(([x, y]) => `<path d="M${x - 4} ${y + 3} L${x} ${y - 4} L${x + 4} ${y + 3} Z" fill="#a8a090" stroke="${INK}" stroke-width="1.2"/><circle cx="${x}" cy="${y}" r="1.2" fill="${INK}"/>`).join('')}
    ${[90, 104, 118, 132].map((y) => `<path d="M82 ${y} Q100 ${y + 4} 118 ${y + 10}" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M82 ${y} Q100 ${y + 4} 118 ${y + 10}" fill="none" stroke="#7a5a34" stroke-width="6" stroke-linecap="round"/><path d="M84 ${y - 1} Q100 ${y + 3} 116 ${y + 8}" fill="none" stroke="#b8945e" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/>`).join('')}
    <path d="M58 72 C56 84 60 96 54 108 M66 72 C68 86 64 98 68 112 M142 72 C146 88 140 98 144 110" fill="none" stroke="#1f3a28" stroke-width="3.5" stroke-linecap="round"/>
    <rect x="93" y="44" width="4" height="40" rx="2" fill="#c8d4d8" opacity=".35"/>
    <path d="M56 60 H124" stroke="#c8d4d8" stroke-opacity=".3" stroke-width="2.5" stroke-linecap="round"/>`,
  lin('ir', [[0, '#4a5a62'], [0.5, '#2a343a'], [1, '#12181c']], 0, 0, 1, 0)
  + lin('ir2', [[0, '#5a6a72'], [0.5, '#2c363c'], [1, '#101418']])
  + lin('br', [[0, '#c9a14a'], [0.5, '#6e5520'], [1, '#2e2008']]));
  const anchor = {
    parts: [{ svg: anchorSvg, pivot: [100, 28], anim: (t, w, k) => ({ rot: 0.05 * wave(t, 0.3, k) + w * 0.16 * wave(t, 1.1) }) }],
    fx: (ctx, t, w, k) => { R.bubbles(ctx, t + k * 2, 100, 150, { n: 2, rise: 60, spread: 20, a: 0.3 }); R.sweep(ctx, t, w); },
  };

  // ---------- Компас ----------
  const compassCase = svg(`
    <circle cx="100" cy="18" r="10" fill="none" stroke="${INK}" stroke-width="9"/><circle cx="100" cy="18" r="10" fill="none" stroke="url(#cb)" stroke-width="4"/>
    <circle cx="100" cy="106" r="80" fill="url(#cb)" stroke="${INK}" stroke-width="5"/>
    ${[[60, 60], [148, 84], [130, 160], [52, 140], [100, 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${7 + (x % 5)}" fill="#3f7a68" opacity=".75"/>`).join('')}
    <circle cx="100" cy="106" r="64" fill="url(#cf)" stroke="${INK}" stroke-width="4"/>
    ${Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI) / 16;
    const r1 = i % 4 === 0 ? 50 : 57;
    return `<line x1="${(100 + Math.sin(a) * r1).toFixed(1)}" y1="${(106 - Math.cos(a) * r1).toFixed(1)}" x2="${(100 + Math.sin(a) * 61).toFixed(1)}" y2="${(106 - Math.cos(a) * 61).toFixed(1)}" stroke="#a88a4a" stroke-opacity=".7" stroke-width="${i % 4 === 0 ? 2.5 : 1.2}"/>`;
  }).join('')}
    <path d="M100 58 L106 100 L148 106 L106 112 L100 154 L94 112 L52 106 L94 100 Z" fill="#1a2a30" stroke="#6e5a30" stroke-width="1.5"/>
    <path d="M100 58 L106 100 L100 106 Z M148 106 L106 112 L100 106 Z M100 154 L94 112 L100 106 Z M52 106 L94 100 L100 106 Z" fill="#3a4a4e" opacity=".8"/>`,
  lin('cb', [[0, '#a8884a'], [0.4, '#5e4a20'], [1, '#1e1608']], 0, 0, 1, 1) + rad('cf', [[0, '#1a2e34'], [1, '#060c0e']]));
  const compassNeedle = svg(`
    <path d="M100 50 L108 104 L100 112 L92 104 Z" fill="url(#nr)" stroke="${INK}" stroke-width="2"/>
    <path d="M100 162 L92 108 L100 100 L108 108 Z" fill="#c8c0a8" stroke="${INK}" stroke-width="2"/>
    <circle cx="100" cy="106" r="6" fill="#c9a14a" stroke="${INK}" stroke-width="2.5"/>`,
  lin('nr', [[0, '#7fffe8'], [1, '#1f8a7a']]));
  const compassGlass = svg(`<path d="M50 78 A58 58 0 0 1 104 46" fill="none" stroke="#e8fff8" stroke-opacity=".28" stroke-width="7" stroke-linecap="round"/>
    <path d="M120 64 L132 92 L110 74" fill="none" stroke="#e8fff8" stroke-opacity=".22" stroke-width="1.5"/>`);
  const compass = {
    parts: [
      { svg: compassCase },
      { svg: compassNeedle, pivot: [100, 106], anim: (t, w, k) => ({ rot: 0.18 * wave(t, 0.4, k) + 0.04 * wave(t, 2.7, k) + (w ? t * 7 * w : 0) }) },
      { svg: compassGlass },
    ],
    fx: (ctx, t, w, k) => { R.glowAt(ctx, 100, 106, 30, '80, 230, 210', 0.12 + 0.08 * wave(t, 0.7, k) + w * 0.2); },
  };

  // ---------- Штурвал ----------
  const helmSvg = svg(`<g transform="translate(100 100) scale(.92) translate(-100 -100)">
    ${Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const at = (r) => `${(100 + Math.cos(a) * r).toFixed(1)} ${(100 + Math.sin(a) * r).toFixed(1)}`;
    return `<path d="M${at(20)} L${at(74)}" stroke="${INK}" stroke-width="14" stroke-linecap="round"/>
      <path d="M${at(20)} L${at(74)}" stroke="url(#wd)" stroke-width="7" stroke-linecap="round"/>
      <path d="M${at(74)} L${at(95)}" stroke="${INK}" stroke-width="18" stroke-linecap="round"/>
      <path d="M${at(74)} L${at(95)}" stroke="#4a2a14" stroke-width="11" stroke-linecap="round"/>
      <path d="M${at(78)} L${at(92)}" stroke="#7a5030" stroke-width="3" stroke-linecap="round" opacity=".7"/>`;
  }).join('')}
    <circle cx="100" cy="100" r="60" fill="none" stroke="${INK}" stroke-width="23"/>
    <circle cx="100" cy="100" r="60" fill="none" stroke="url(#wr)" stroke-width="15"/>
    <circle cx="100" cy="100" r="60" fill="none" stroke="#0e0804" stroke-width="2" stroke-dasharray="2 12" opacity=".8"/>
    <path d="M52 70 A60 60 0 0 1 110 41" fill="none" stroke="#c89a6a" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="22" fill="url(#hb2)" stroke="${INK}" stroke-width="4"/>
    <circle cx="100" cy="100" r="8" fill="#1e1608" stroke="${INK}" stroke-width="2"/>
    <circle cx="92" cy="94" r="4" fill="#e8d8a8" opacity=".35"/>
    <path d="M140 52 C146 66 140 78 146 92 M146 50 C154 64 150 74 156 86" fill="none" stroke="#1f3a28" stroke-width="3.5" stroke-linecap="round"/></g>`,
  lin('wd', [[0, '#6a4024'], [1, '#2a160a']], 0, 0, 1, 1) + lin('wr', [[0, '#5e3a1e'], [0.5, '#3a2010'], [1, '#1a0e06']], 0, 0, 1, 1)
  + rad('hb2', [[0, '#8a7a4a'], [0.6, '#4a5a3a'], [1, '#1a2016']], 0.4, 0.35, 0.7));
  const helm = {
    parts: [{ svg: helmSvg, pivot: [100, 100], anim: (t, w, k) => ({ rot: 0.22 * wave(t, 0.12, k) + (w ? t * 2.4 * w : 0) }) }],
    fx: (ctx, t, w) => R.sweep(ctx, t, w),
  };

  // ---------- Ром ----------
  const bottlePath = 'M88 20 H112 V58 C112 70 144 84 144 110 V170 C144 179 136 184 126 184 H74 C64 184 56 179 56 170 V110 C56 84 88 70 88 58 Z';
  const rumBack = svg(`<path d="${bottlePath}" fill="url(#gl)" stroke="${INK}" stroke-width="5"/>`, lin('gl', [[0, '#1f4a36'], [0.5, '#0e2a1e'], [1, '#05120c']], 0, 0, 1, 0));
  const rumFront = svg(`
    <path d="${bottlePath}" fill="none" stroke="${INK}" stroke-width="5"/>
    <rect x="86" y="8" width="28" height="20" rx="4" fill="#5a3a1e" stroke="${INK}" stroke-width="4"/>
    <path d="M84 24 H116 V32 C116 40 108 36 106 46 C104 38 96 44 94 36 C90 42 84 38 84 32 Z" fill="#6e0f18" stroke="${INK}" stroke-width="3"/>
    <path d="M76 120 C80 112 92 108 100 110 C108 108 120 112 124 120 C120 132 112 130 108 136 C104 132 96 132 92 136 C88 130 80 132 76 120 Z" fill="#c8c0a8" opacity=".55" stroke="${INK}" stroke-width="1.5"/>
    <circle cx="92" cy="120" r="3.5" fill="${INK}" opacity=".8"/><circle cx="108" cy="120" r="3.5" fill="${INK}" opacity=".8"/>
    <path d="M86 142 L114 152 M114 142 L86 152" stroke="#c8c0a8" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    ${[[64, 156], [70, 168], [136, 150], [132, 164], [104, 176]].map(([x, y]) => `<path d="M${x - 4} ${y + 3} L${x} ${y - 4} L${x + 4} ${y + 3} Z" fill="#9a9488" stroke="${INK}" stroke-width="1"/>`).join('')}
    <path d="M66 94 C60 112 60 150 64 170" stroke="#d8fff0" stroke-opacity=".28" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M94 24 V60" stroke="#d8fff0" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>`);
  const rumPath = new Path2D(bottlePath);
  const rum = {
    parts: [
      { svg: rumBack, pivot: [100, 184], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.35, k) + w * 0.12 * wave(t, 1.4) }) },
      { pivot: [100, 184], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.35, k) + w * 0.12 * wave(t, 1.4) }), draw: (ctx, t, w, k) => {
        // Ром плещется внутри бутылки.
        ctx.save();
        ctx.clip(rumPath);
        const lvl = 118;
        const tilt = -(0.04 * wave(t, 0.35, k) + w * 0.12 * wave(t, 1.4)) * 80;
        ctx.beginPath();
        ctx.moveTo(40, 200);
        for (let x = 40; x <= 160; x += 6) ctx.lineTo(x, lvl + tilt * ((x - 100) / 60) + 2.5 * wave(t, 1.1, x / 20 + k));
        ctx.lineTo(160, 200);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, lvl, 0, 190);
        g.addColorStop(0, 'rgba(200, 110, 30, .85)');
        g.addColorStop(1, 'rgba(70, 25, 4, .95)');
        ctx.fillStyle = g;
        ctx.fill();
        R.bubbles(ctx, t + k, 100, 176, { n: 3, rise: 50, spread: 50, a: 0.4 });
        ctx.restore();
      } },
      { svg: rumFront, pivot: [100, 184], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.35, k) + w * 0.12 * wave(t, 1.4) }) },
    ],
  };

  // ---------- Медуза ----------
  const jellyBell = svg(`
    <path d="M48 104 C44 54 74 30 100 30 C126 30 156 54 152 104 C144 98 136 110 128 104 C120 112 110 102 100 108 C90 102 80 112 72 104 C64 110 56 98 48 104 Z" fill="url(#jb)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M70 92 C68 64 84 48 100 46" fill="none" stroke="#f0d8ff" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>
    <path d="M72 70 C82 82 118 82 128 70 C120 92 80 92 72 70 Z" fill="#ff7ad9" opacity=".35"/>
    ${[[86, 64], [114, 62], [100, 56]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#ffb3ee" opacity=".45"/>`).join('')}
    ${Array.from({ length: 7 }, (_, i) => `<path d="M${58 + i * 14} 102 C${60 + i * 14} 80 ${80 + i * 6} 50 100 40" fill="none" stroke="#2a0a3a" stroke-opacity=".35" stroke-width="1.5"/>`).join('')}`,
  rad('jb', [[0, '#c86ad8', 0.85], [0.5, '#5a2a8a', 0.8], [1, '#14082a', 0.9]], 0.5, 0.35, 0.75));
  const jelly = {
    parts: [
      { draw: (ctx, t, w, k) => {
        R.glowAt(ctx, 100, 80, 90, '200, 90, 220', 0.18 + 0.1 * wave(t, 0.5, k) + w * 0.25);
        // Щупальца — длинные волнистые нити.
        for (let i = 0; i < 9; i++) {
          const x0 = 58 + i * 10.5;
          ctx.beginPath();
          ctx.moveTo(x0, 102);
          for (let s = 1; s <= 12; s++) {
            const f = s / 12;
            ctx.lineTo(x0 + Math.sin(t * (1.2 + w * 2) + f * 4 + i * 0.7 + k) * 10 * f, 102 + f * (74 + (i % 3) * 8));
          }
          ctx.strokeStyle = i % 2 ? 'rgba(255, 140, 230, .55)' : 'rgba(150, 230, 255, .45)';
          ctx.lineWidth = i % 3 === 0 ? 3 : 1.8;
          ctx.lineCap = 'round';
          ctx.stroke();
        }
      } },
      { svg: jellyBell, pivot: [100, 104], anim: (t, w, k) => {
        const p = wave(t, 0.55 + w * 0.6, k);
        return { sx: 1 + 0.05 * p, sy: 1 - 0.06 * p, dy: -2 * p };
      } },
    ],
    fx: (ctx, t, w, k) => {
      R.glowAt(ctx, 100, 70, 26, '255, 160, 240', 0.3 + 0.2 * wave(t, 0.55, k) + w * 0.3);
    },
  };

  // ---------- Акула ----------
  const sharkHead = svg(`
    <path d="M90 66 L106 22 L130 66 Z" fill="url(#sk)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M20 112 C26 80 62 60 108 58 C144 56 172 72 186 96 C180 102 172 104 162 106 L132 114 C118 126 90 140 64 140 C40 138 20 128 20 112 Z" fill="url(#sk)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M30 120 C58 132 100 132 132 116 C112 136 82 144 60 140 C44 138 34 130 30 120 Z" fill="#a8b0b0" opacity=".85"/>
    <path d="M161 106 L157 114 L153 107 L149 116 L145 109 L141 117 L137 112" fill="#e8e0cc" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M40 104 C56 80 90 66 130 66" fill="none" stroke="#c8d8e0" stroke-opacity=".2" stroke-width="5" stroke-linecap="round"/>
    <circle cx="150" cy="84" r="7" fill="#1a1e20" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="148" cy="82" r="2" fill="#e8f0f0" opacity=".8"/>
    <path d="M136 74 L160 79" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    ${[100, 110, 120].map((x) => `<path d="M${x} 86 q-5 12 0 24" fill="none" stroke="#0e1416" stroke-width="2.6" stroke-linecap="round"/>`).join('')}
    <path d="M72 76 L84 98 M78 74 L92 94" stroke="#c8c0b0" stroke-opacity=".4" stroke-width="2"/>
    ${hatch(40, 92, 70, 120, 7, INK, 0.25)}`,
  lin('sk', [[0, '#5a6e7a'], [0.55, '#2a3a44'], [1, '#121a20']]));
  const sharkJaw = svg(`
    <path d="M132 114 L176 128 C164 146 114 152 76 146 C96 142 118 132 132 114 Z" fill="#2a3a44" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M132 114 L176 128 C176 120 172 112 162 108 Z" fill="#3a0a10" stroke="${INK}" stroke-width="2.5"/>
    <path d="M138 116 L143 108 L147 119 L152 111 L156 122 L161 114 L165 125 L169 118 L172 127" fill="#e8e0cc" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M86 144 C110 142 140 136 170 128" fill="none" stroke="#a8b0b0" stroke-opacity=".5" stroke-width="3"/>`);
  const shark = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 100, 90, '30, 90, 110', 0.18 + w * 0.15) },
      { svg: sharkJaw, pivot: [134, 114], anim: (t, w, k) => ({ rot: 0.08 + 0.06 * wave(t, 0.3, k) + w * 0.28 * Math.max(0, wave(t, 1.6)) }) },
      { svg: sharkHead, pivot: [100, 110], anim: (t, w, k) => ({ dx: 2 * wave(t, 0.25, k) + w * 6 * Math.max(0, wave(t, 1.6)), rot: -0.02 * wave(t, 0.25, k) }) },
    ],
    fx: (ctx, t, w, k) => R.bubbles(ctx, t + k, 160, 120, { n: 3, rise: 70, spread: 24, a: 0.35 }),
  };

  // ---------- Удильщик ----------
  const anglerBody = svg(`
    <path d="M34 112 L16 86 L18 142 Z" fill="#2a1a24" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M38 112 C38 74 70 58 104 60 C142 62 168 86 168 116 C168 120 166 124 164 126 L90 124 C70 138 40 140 38 112 Z" fill="url(#ab)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M64 66 L58 48 L76 62 M84 60 L82 40 L96 58" fill="#2a1a24" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M92 122 L96 112 L100 124 L104 110 L108 124 L112 108 L116 124 L121 109 L125 124 L130 110 L134 124 L139 112 L143 124 L148 114 L152 124 L158 116" fill="#d8d0b8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
    <circle cx="96" cy="92" r="13" fill="#d8dcc8" stroke="${INK}" stroke-width="3.5"/>
    <circle cx="99" cy="94" r="4" fill="${INK}"/>
    <path d="M78 78 L112 84" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
    <path d="M52 100 C54 86 66 76 82 72" fill="none" stroke="#c8b0c8" stroke-opacity=".18" stroke-width="4" stroke-linecap="round"/>
    ${[[60, 116], [72, 100], [128, 80], [146, 96]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#6a4a5a" opacity=".7"/>`).join('')}
    ${hatch(46, 104, 80, 130, 7, INK, 0.25)}`,
  rad('ab', [[0, '#5a3a4e'], [0.7, '#2a1626'], [1, '#120810']], 0.4, 0.35, 0.75));
  const anglerJaw = svg(`
    <path d="M90 124 L164 126 C160 152 132 168 104 166 C92 158 88 140 90 124 Z" fill="#2a1626" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M94 128 L160 128 C156 146 132 158 108 158 C98 150 94 140 94 128 Z" fill="#14040c"/>
    <path d="M100 160 L104 148 L109 160 L114 146 L119 158 L125 145 L130 156 L136 144 L141 152 L147 142 L152 148" fill="#d8d0b8" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`);
  const angler = {
    parts: [
      { draw: (ctx, t, w, k) => R.glowAt(ctx, 150, 46, 60, '140, 240, 255', 0.12 + w * 0.15) },
      { svg: anglerJaw, pivot: [92, 126], anim: (t, w, k) => ({ rot: 0.05 * wave(t, 0.4, k) + w * 0.16 * Math.max(0, wave(t, 1.3)) }) },
      { svg: anglerBody },
      { draw: (ctx, t, w, k) => {
        // Удочка: гибкий стебель со светящейся приманкой.
        const sway = wave(t, 0.5 + w, k) * (5 + w * 8);
        const tip = [150 + sway, 44 + 3 * wave(t, 0.9, k)];
        ctx.beginPath();
        ctx.moveTo(84, 66);
        ctx.quadraticCurveTo(100 + sway * 0.4, 18, tip[0], tip[1]);
        ctx.strokeStyle = '#05080a';
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.strokeStyle = '#4a3040';
        ctx.lineWidth = 3;
        ctx.stroke();
        const g = 0.5 + 0.3 * wave(t, 0.8, k) + w * 0.4;
        R.glowAt(ctx, tip[0], tip[1] + 6, 28, '150, 245, 255', g * 0.6);
        ctx.beginPath();
        ctx.arc(tip[0], tip[1] + 6, 7, 0, Math.PI * 2);
        const bg = ctx.createRadialGradient(tip[0] - 2, tip[1] + 4, 1, tip[0], tip[1] + 6, 7);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(0.5, '#9ff6ff');
        bg.addColorStop(1, '#2a8aa0');
        ctx.fillStyle = bg;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#05080a';
        ctx.stroke();
      } },
    ],
  };

  // ---------- Галеон ----------
  const shipSvg = svg(`
    <g stroke="${INK}" stroke-linejoin="round">
      <path d="M68 128 V40 M102 132 V26 M134 128 V48" stroke-width="5"/>
      <path d="M46 48 C66 54 68 74 68 92 C74 76 86 70 88 50 Z" fill="url(#sl)" stroke-width="3"/>
      <path d="M78 34 C100 40 102 68 102 96 C108 72 126 64 126 36 Z" fill="url(#sl)" stroke-width="3"/>
      <path d="M116 56 C132 60 134 76 134 92 C140 78 152 72 152 56 Z" fill="url(#sl)" stroke-width="3"/>
      <path d="M102 26 L124 32 L102 38 Z" fill="#3a0a0a" stroke-width="2.5"/>
      <path d="M34 118 L168 114 L158 146 C134 154 76 154 46 146 Z" fill="url(#hl)" stroke-width="4"/>
      <path d="M42 128 L162 124" stroke="#6e5a30" stroke-width="2.5"/>
      <path d="M152 114 L180 102 L178 110 Z" fill="#2a1a0e" stroke-width="3"/>
    </g>
    <path d="M58 62 L64 86 M92 52 L96 84 M126 64 L128 84" stroke="#000" stroke-opacity=".4" stroke-width="2"/>
    <path d="M70 70 L76 66 M96 60 L104 70" stroke="#1a1a1a" stroke-width="3"/>
    <circle cx="102" cy="58" r="8" fill="#c8c0a8" opacity=".55"/>
    <path d="M97 56 h3 M104 56 h3" stroke="${INK}" stroke-width="2.5"/>
    <path d="M94 70 L110 62 M94 62 L110 70" stroke="#c8c0a8" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round"/>`,
  lin('sl', [[0, '#3a3e3a'], [1, '#0e100e']], 0, 0, 1, 1) + lin('hl', [[0, '#4a3020'], [1, '#160c06']]));
  const ship = {
    parts: [
      { draw: (ctx, t, w, k) => {
        R.glowAt(ctx, 100, 90, 90, '60, 200, 120', 0.1 + 0.05 * wave(t, 0.4, k) + w * 0.15);
        // Далёкая молния за кораблём.
        const flash = R.blip(t, 6.5, 0.18, k * 2);
        if (flash > 0) {
          ctx.strokeStyle = `rgba(200, 230, 255, ${0.7 * flash})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(160, 0);
          ctx.lineTo(150, 30);
          ctx.lineTo(158, 32);
          ctx.lineTo(146, 64);
          ctx.stroke();
        }
      } },
      { svg: shipSvg, pivot: [100, 140], anim: (t, w, k) => ({ rot: 0.06 * wave(t, 0.28, k) + w * 0.1 * wave(t, 0.9), dy: 3 * wave(t, 0.28, k + 1.2) }) },
      { draw: (ctx, t, w, k) => {
        // Призрачные огни в иллюминаторах.
        const rock = 0.06 * wave(t, 0.28, k) + w * 0.1 * wave(t, 0.9);
        ctx.save();
        ctx.translate(100, 140 + 3 * wave(t, 0.28, k + 1.2));
        ctx.rotate(rock);
        ctx.translate(-100, -140);
        for (const x of [62, 82, 102, 122, 142]) R.glowAt(ctx, x, 136, 7, '120, 255, 160', 0.5 + 0.4 * Math.abs(wave(t, 0.7, x)));
        ctx.restore();
        // Волны спереди: гребни с пеной, края уходят вниз — без прямоугольной кромки.
        for (let layer = 0; layer < 2; layer++) {
          const base = 150 + layer * 12;
          const crest = [];
          for (let x = 12; x <= 188; x += 6) {
            const env = Math.sin(Math.PI * (x - 12) / 176);
            crest.push([x, base + (1 - env) * 34 + env * (6 * wave(t, 0.4 + layer * 0.2, x / 30 + layer + k) + 3 * wave(t, 0.9, x / 14))]);
          }
          ctx.beginPath();
          crest.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.quadraticCurveTo(100, 206, 12, crest[0][1]);
          const g = ctx.createLinearGradient(0, base - 8, 0, 196);
          g.addColorStop(0, layer ? '#0a2228' : '#123a40');
          g.addColorStop(1, '#03090b');
          ctx.fillStyle = g;
          ctx.fill();
          ctx.strokeStyle = '#05080a';
          ctx.lineWidth = 2.5;
          ctx.stroke();
          ctx.beginPath();
          crest.slice(2, -2).forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 1.5) : ctx.moveTo(x, y + 1.5)));
          ctx.strokeStyle = 'rgba(190, 235, 230, .4)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      } },
    ],
  };

  // ---------- Карта (скаттер) ----------
  const mapSvg = svg(`
    <g transform="rotate(-6 100 100)">
      <path d="M30 40 C60 30 140 50 170 38 L172 154 C140 164 60 146 28 156 Z" fill="url(#pp)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M30 40 L36 52 L30 60 M170 38 L162 48 L172 58 M28 156 L38 146" fill="none" stroke="#3a2a14" stroke-width="2"/>
      <path d="M58 70 C66 60 84 62 86 74 C90 86 72 94 64 88 C56 84 54 78 58 70 Z" fill="#2a3a28" opacity=".55" stroke="#3a2a14" stroke-width="1.5"/>
      <path d="M110 96 C124 82 150 92 146 112 C142 130 120 132 112 122 C104 114 104 104 110 96 Z" fill="#2a3a28" opacity=".55" stroke="#3a2a14" stroke-width="1.5"/>
      <circle cx="126" cy="106" r="7" fill="#3a2a14" opacity=".6"/><circle cx="123" cy="104" r="1.6" fill="#c8a870"/><circle cx="129" cy="104" r="1.6" fill="#c8a870"/>
      <path d="M70 84 C86 112 96 72 112 98 C118 108 122 110 126 112" fill="none" stroke="#6e1410" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>
      <g transform="translate(150 64)"><circle r="11" fill="none" stroke="#3a2a14" stroke-width="1.5"/><path d="M0 -13 L2.5 0 L0 13 L-2.5 0 Z M-13 0 L0 2.5 L13 0 L0 -2.5 Z" fill="#3a2a14"/></g>
      <path d="M40 140 C70 134 120 138 160 132" stroke="#3a2a14" stroke-opacity=".3" stroke-width="2"/>
    </g>
    <g stroke="${INK}" stroke-linejoin="round">
      <path d="M140 16 L150 22 L118 82 L112 78 Z" fill="url(#dg)" stroke-width="3"/>
      <rect x="138" y="8" width="20" height="8" rx="2" transform="rotate(30 148 12)" fill="#3a2a14" stroke-width="2.5"/>
      <path d="M151 2 L158 6 L154 16 L147 12 Z" fill="#5a3a1e" stroke-width="2"/>
    </g>
    <path d="M24 158 H176 L166 172 L176 186 H24 L34 172 Z" fill="url(#rb2)" stroke="${INK}" stroke-width="3"/>
    <path d="M30 162 H170 M30 182 H170" stroke="#e0a23a" stroke-opacity=".7" stroke-width="1.2"/>`,
  lin('pp', [[0, '#b8a074'], [0.6, '#8a7048'], [1, '#5a4626']], 0, 0, 1, 1) + lin('dg', [[0, '#c8d0d4'], [1, '#4a5458']], 0, 0, 1, 0)
  + lin('rb2', [[0, '#1c140c'], [0.5, '#070504'], [1, '#1c140c']]));
  const map = {
    parts: [
      { draw: (ctx, t, w, k) => R.glowAt(ctx, 100, 96, 92, '230, 160, 50', 0.16 + 0.08 * wave(t, 0.5, k) + w * 0.3) },
      { svg: mapSvg, pivot: [100, 100], anim: (t, w, k) => ({ dy: 2 * wave(t, 0.35, k), rot: 0.015 * wave(t, 0.3, k) }) },
    ],
    fx: (ctx, t, w, k) => {
      const dy = 2 * wave(t, 0.35, k);
      // Крестик клада тлеет.
      const g = 0.5 + 0.3 * wave(t, 0.9, k) + w * 0.5;
      R.glowAt(ctx, 132, 112 + dy, 18, '255, 60, 30', g * 0.6);
      ctx.save();
      ctx.translate(0, dy);
      ctx.strokeStyle = '#8a1410';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(124, 104);
      ctx.lineTo(140, 120);
      ctx.moveTo(140, 104);
      ctx.lineTo(124, 120);
      ctx.stroke();
      ctx.restore();
      ctx.font = '700 22px "Cormorant SC", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const tg = ctx.createLinearGradient(0, 162, 0, 182);
      tg.addColorStop(0, '#ffe9b0');
      tg.addColorStop(0.55, '#e0a23a');
      tg.addColorStop(1, '#7a3d0c');
      ctx.fillStyle = 'rgba(0, 0, 0, .8)';
      ctx.fillText('БОНУС', 100, 173.5);
      ctx.fillStyle = tg;
      ctx.fillText('БОНУС', 100, 172);
      R.sweep(ctx, t, w, { color: '255, 220, 150' });
    },
  };

  // ---------- Жемчуг ----------
  const TONES = {
    white: ['#ffffff', '#c8d0d8', '#5a6470'],
    gold: ['#fff4c0', '#d8a83a', '#5a3a08'],
    black: ['#b8a8e8', '#3a2a5a', '#0a0614'],
    mini: ['#d8ffe0', '#4aa86a', '#0e3a1e'],
    minor: ['#d8ecff', '#3a7ac8', '#0a1e4a'],
    major: ['#ffd8d8', '#c83a3a', '#4a0a0a'],
    grand: ['#fffbe8', '#ffb020', '#7a2a00'],
    kraken: ['#f0c8ff', '#7a2a9a', '#1a0622'],
  };
  const shellBack = svg(`
    <path d="M26 112 C20 52 64 24 100 24 C136 24 180 52 174 112 C140 100 60 100 26 112 Z" fill="url(#sb)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[34, 52, 74, 100, 126, 148, 166].map((x) => `<path d="M100 104 Q${(100 + x) / 2} 64 ${x} ${x === 100 ? 28 : 40 + Math.abs(100 - x) / 2}" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="2"/>`).join('')}
    <path d="M40 92 C50 60 80 38 104 36" fill="none" stroke="#e8d8d0" stroke-opacity=".2" stroke-width="4" stroke-linecap="round"/>`,
  lin('sb', [[0, '#5a4a52'], [0.6, '#2a2028'], [1, '#120c10']], 0, 0, 0, 1));
  const shellFront = svg(`
    <path d="M22 122 C24 160 60 186 100 186 C140 186 176 160 178 122 C150 134 50 134 22 122 Z" fill="url(#sf)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[40, 58, 78, 100, 122, 142, 160].map((x) => `<path d="M100 182 Q${(100 + x) / 2} 156 ${x} 132" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="2"/>`).join('')}
    <path d="M30 130 C60 140 140 140 170 130" fill="none" stroke="#d8c8c0" stroke-opacity=".25" stroke-width="2"/>`,
  lin('sf', [[0, '#4a3c44'], [1, '#100a0e']]));
  function pearl(tone) {
    const [hi, mid, lo] = TONES[tone];
    const ball = svg(`
      <circle cx="100" cy="100" r="54" fill="url(#pb)" stroke="${INK}" stroke-width="4"/>
      <ellipse cx="80" cy="78" rx="17" ry="10" fill="#fff" opacity=".7" transform="rotate(-25 80 78)"/>
      <path d="M62 120 C74 140 110 148 134 132" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="4"/>
      ${tone === 'kraken' ? `<path d="M58 66 C36 92 54 126 80 116 C94 110 90 96 80 100" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/><path d="M58 66 C36 92 54 126 80 116 C94 110 90 96 80 100" fill="none" stroke="#7a1a2c" stroke-width="6" stroke-linecap="round"/>` : ''}`,
    rad('pb', [[0, hi], [0.55, mid], [1, lo]], 0.38, 0.32, 0.75));
    return {
      parts: [
        { draw: (ctx, t, w, k) => R.glowAt(ctx, 100, 100, 80, '200, 220, 255', 0.12 + 0.06 * wave(t, 0.5, k) + w * 0.25) },
        { svg: shellBack, pivot: [100, 112], anim: (t, w, k) => ({ rot: 0, sy: 1 + 0.03 * wave(t, 0.35, k) + w * 0.08 }) },
        { svg: ball, pivot: [100, 100], anim: (t, w, k) => ({ dy: -1.5 * wave(t, 0.4, k) - w * 4 }) },
        { svg: shellFront },
      ],
      fx: (ctx, t, w, k) => {
        // Перелив по жемчужине.
        const a = (t * 0.6 + k) % (Math.PI * 2);
        ctx.save();
        ctx.beginPath();
        ctx.arc(100, 100 - 1.5 * wave(t, 0.4, k) - w * 4, 52, 0, Math.PI * 2);
        ctx.clip();
        ctx.globalCompositeOperation = 'lighter';
        R.glowAt(ctx, 100 + Math.cos(a) * 30, 96 + Math.sin(a) * 20, 26, '255, 255, 255', 0.18 + w * 0.2);
        ctx.restore();
      },
    };
  }

  root.KrakenRig = {
    SYMBOLS: { wild, anchor, compass, helm, rum, jelly, shark, angler, ship, map },
    pearl,
    TONES: Object.keys(TONES),
  };
})(window);
