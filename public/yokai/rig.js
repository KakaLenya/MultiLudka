// «Ночной парад ста демонов»: анимированные символы, нарисованные вручную (SVG-детали + живые эффекты).
// Стиль: ночная гравюра укиё-э — густой тушевой контур, индиго ночи, киноварь, бумага васи, сусальное
// золото и холодный призрачный свет лисьих огней. window.YokaiRig = { SYMBOLS: { id: def }, fox(tails) }.
(function (root) {
  'use strict';

  const R = root.SlotRig;
  const INK = '#0a0812';
  const VERM = '#c23b22';
  const WASHI = '#e8dcc0';
  const GOLD = '#c9a14a';
  const GHOST = '127, 224, 208';
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x1 = 0, y1 = 0, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const blur = (id, sd) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  const shadow = (cx, cy, rx, ry = 8) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".55" filter="url(#sh)"/>`;
  const SH = blur('sh', 5);
  // Штрихи тушью: короткие изогнутые мазки по краю — «гравюрный» объём.
  const strokes = (pts, color = INK, a = 0.35, w = 1.4) => pts.map(([x, y, dx, dy]) => `<path d="M${x} ${y} q${dx / 2} ${dy / 2 - 3} ${dx} ${dy}" fill="none" stroke="${color}" stroke-opacity="${a}" stroke-width="${w}" stroke-linecap="round"/>`).join('');
  const wave = R.wave;
  const blip = R.blip;
  const pos = (x) => Math.max(0, x);
  const LABEL_FONT = '700 22px "Cormorant SC", Georgia, serif';

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
  const ribbon = (id, edge) => svg(`
    <path d="M22 158 H178 L168 172 L178 186 H22 L32 172 Z" fill="url(#${id})" stroke="${INK}" stroke-width="3"/>
    <path d="M28 162 H172 M28 182 H172" stroke="${edge}" stroke-opacity=".75" stroke-width="1.2"/>`,
  lin(id, [[0, '#1a0c10'], [0.5, '#06040a'], [1, '#1a0c10']]));

  // ---------- Чаша сакэ ----------
  const sakeBack = svg(`
    ${shadow(104, 182, 70, 7)}
    <path d="M44 40 C40 30 56 22 62 34 C66 44 60 50 64 62 C78 80 84 112 80 140 C78 160 64 170 50 170 C36 170 22 160 20 140 C16 112 24 80 38 62 C42 52 36 46 44 40 Z" fill="url(#bt)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M30 98 C40 92 62 92 72 98 M28 118 C40 112 62 112 74 118" fill="none" stroke="#1a2a5a" stroke-width="3"/>
    ${[[38, 128], [52, 132], [64, 126], [44, 146], [60, 148]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="none" stroke="#1a2a5a" stroke-width="2"/>`).join('')}
    <path d="M30 80 C28 100 30 130 36 150" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="4" stroke-linecap="round"/>
    <path d="M44 38 C50 34 58 36 60 42" fill="none" stroke="${INK}" stroke-width="2"/>`,
  SH + lin('bt', [[0, '#efe6d2'], [0.6, '#cbbf9e'], [1, '#8a7e64']], 0, 0, 1, 0));
  const cupPath = 'M74 120 C76 150 104 166 130 166 C156 166 184 150 186 120 Z';
  const sakeCup = svg(`
    <path d="M110 166 L150 166 L156 180 L104 180 Z" fill="#5a0e0a" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="${cupPath}" fill="url(#cp)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <ellipse cx="130" cy="120" rx="56" ry="11" fill="#2a0604" stroke="${INK}" stroke-width="3.5"/>
    <ellipse cx="130" cy="120" rx="56" ry="11" fill="none" stroke="${GOLD}" stroke-width="2"/>
    <path d="M86 132 C96 152 118 160 140 160" fill="none" stroke="#ff9a7a" stroke-opacity=".3" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="150" cy="144" r="9" fill="none" stroke="${GOLD}" stroke-width="2"/><path d="M144 144 H156 M150 138 V150" stroke="${GOLD}" stroke-width="1.6"/>`,
  lin('cp', [[0, '#d8402a'], [0.6, '#8a1810'], [1, '#3a0604']]));
  const sake = {
    parts: [
      { svg: sakeBack, pivot: [50, 170], anim: (t, w, k) => ({ rot: 0.03 * wave(t, 0.3, k) + w * 0.08 * wave(t, 1.2) }) },
      { svg: sakeCup, pivot: [130, 178], anim: (t, w) => ({ rot: -0.12 * w * pos(wave(t, 0.8)), dy: -4 * w * pos(wave(t, 0.8)) }) },
      { pivot: [130, 178], anim: (t, w) => ({ rot: -0.12 * w * pos(wave(t, 0.8)), dy: -4 * w * pos(wave(t, 0.8)) }), draw: (ctx, t, w, k) => {
        // Сакэ в чаше: блик луны и расходящиеся круги.
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(130, 120, 52, 9, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#d8c89a';
        ctx.globalAlpha = 0.55;
        ctx.fillRect(74, 108, 112, 24);
        ctx.globalAlpha = 1;
        for (let i = 0; i < 3; i++) {
          const u = (t * (0.35 + w * 0.6) + i / 3 + k * 0.1) % 1;
          ctx.strokeStyle = `rgba(255, 250, 230, ${0.55 * (1 - u)})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.ellipse(122, 120, 6 + u * 44, 1.5 + u * 8, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        R.glowAt(ctx, 146, 118, 10, '255, 250, 220', 0.6);
        ctx.restore();
      } },
    ],
  };

  // ---------- Гэта ----------
  const getaOne = (x, y, hue) => `
    <path d="M${x} ${y} L${x + 92} ${y - 8} C${x + 104} ${y - 9} ${x + 108} ${y + 4} ${x + 98} ${y + 10} L${x + 6} ${y + 18} C${x - 4} ${y + 18} ${x - 8} ${y + 4} ${x} ${y} Z" fill="url(#wd)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M${x + 14} ${y + 16} L${x + 16} ${y + 36} L${x + 30} ${y + 35} L${x + 28} ${y + 15} Z M${x + 70} ${y + 11} L${x + 72} ${y + 31} L${x + 86} ${y + 30} L${x + 84} ${y + 10} Z" fill="#3a2414" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M${x + 20} ${y + 6} C${x + 40} ${y - 26} ${x + 60} ${y - 26} ${x + 78} ${y - 2} M${x + 50} ${y - 16} L${x + 48} ${y + 2}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M${x + 20} ${y + 6} C${x + 40} ${y - 26} ${x + 60} ${y - 26} ${x + 78} ${y - 2} M${x + 50} ${y - 16} L${x + 48} ${y + 2}" fill="none" stroke="${hue}" stroke-width="4" stroke-linecap="round"/>
    <path d="M${x + 6} ${y + 2} L${x + 92} ${y - 6}" stroke="#e8c8a0" stroke-opacity=".3" stroke-width="2"/>`;
  const getaBack = svg(`<g transform="translate(100 100) scale(1.28) translate(-100 -100)">${shadow(94, 120, 60, 6)}${getaOne(40, 82, VERM)}</g>`, SH + lin('wd', [[0, '#a87848'], [1, '#4a2c14']]));
  const getaFront = svg(`<g transform="translate(100 100) scale(1.28) translate(-100 -100)">${shadow(104, 176, 62, 6)}${getaOne(56, 136, '#1a3a7a')}</g>`, SH + lin('wd', [[0, '#b88a58'], [1, '#5a3418']]));
  const geta = {
    parts: [
      { svg: getaBack, pivot: [90, 123], anim: (t, w, k) => {
        const tap = blip(t, 2.4, 0.3, k) + w * pos(wave(t, 1.6));
        return { rot: -0.18 * tap, dy: -10 * tap };
      } },
      { svg: getaFront, pivot: [151, 190], anim: (t, w, k) => {
        const tap = blip(t + 1.2, 2.4, 0.3, k) + w * pos(wave(t + 0.3, 1.6));
        return { rot: -0.14 * tap, dy: -8 * tap };
      } },
    ],
    fx: (ctx, t, w, k) => {
      // Щелчок дерева — пылинки при ударе.
      const hit = blip(t + 0.32, 2.4, 0.12, k);
      if (hit > 0.2) R.glowAt(ctx, 70, 122, 16, '255, 230, 190', 0.25 * hit);
    },
  };

  // ---------- Веер ----------
  const fan = {
    parts: [
      { svg: svg(`${shadow(100, 178, 56, 6)}`, SH) },
      { pivot: [100, 160], anim: (t, w, k) => ({ rot: 0.04 * wave(t, 0.3, k) }), draw: (ctx, t, w, k) => {
        // Пластины веера раскрываются: раскрытие дышит, на выигрыше — распахивается до конца.
        const open = 0.78 + 0.06 * wave(t, 0.35, k) + w * 0.2 * (0.6 + 0.4 * wave(t, 1.3));
        const span = Math.PI * open;
        const a0 = -Math.PI / 2 - span / 2;
        const N = 14;
        const cx = 100;
        const cy = 160;
        const rOut = 118;
        const rIn = 36;
        ctx.lineJoin = 'round';
        // Бумага.
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const a = a0 + (span * i) / N;
          const zig = i % 2 ? 0.96 : 1;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rOut * zig, cy + Math.sin(a) * rOut * zig);
        }
        for (let i = N; i >= 0; i--) {
          const a = a0 + (span * i) / N;
          ctx.lineTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(cx, cy, rIn, cx, cy, rOut);
        g.addColorStop(0, '#e8dcc0');
        g.addColorStop(0.7, '#d8c49a');
        g.addColorStop(1, '#a88a5a');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // Узор: волны сэйгаиха индиго по нижней дуге и красное солнце.
        ctx.save();
        ctx.clip();
        ctx.strokeStyle = 'rgba(26, 42, 100, .75)';
        ctx.lineWidth = 2.4;
        for (let row = 0; row < 3; row++) {
          const rr = rOut - 10 - row * 13;
          for (let i = 0; i < 9; i++) {
            const a = a0 + span * ((i + (row % 2) * 0.5) / 8.5);
            ctx.beginPath();
            ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 9, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.fillStyle = VERM;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(-Math.PI / 2 - 0.25) * 74, cy + Math.sin(-Math.PI / 2 - 0.25) * 74, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Пластины.
        ctx.strokeStyle = 'rgba(40, 20, 8, .7)';
        ctx.lineWidth = 1.4;
        for (let i = 1; i < N; i++) {
          const a = a0 + (span * i) / N;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
          ctx.lineTo(cx + Math.cos(a) * rOut * (i % 2 ? 0.96 : 1), cy + Math.sin(a) * rOut * (i % 2 ? 0.96 : 1));
          ctx.stroke();
        }
        // Рукоять из чёрного лака с золотой заклёпкой.
        for (const a of [a0, a0 + span]) {
          ctx.strokeStyle = INK;
          ctx.lineWidth = 9;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
          ctx.stroke();
          ctx.strokeStyle = '#2a1a14';
          ctx.lineWidth = 5;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = GOLD;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // Кисточка.
        const sw = 6 * wave(t, 0.6, k);
        ctx.strokeStyle = VERM;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 6);
        ctx.quadraticCurveTo(cx + sw * 0.5, cy + 20, cx + sw, cy + 32);
        ctx.stroke();
      } },
    ],
    fx: (ctx, t, w) => R.sweep(ctx, t, w, { color: '255, 230, 180' }),
  };

  // ---------- Офуда ----------
  const ofudaSvg = svg(`
    <path d="M100 6 L100 24" stroke="${INK}" stroke-width="2"/>
    <path d="M70 22 H130 L128 178 C116 184 84 184 72 178 Z" fill="url(#pp)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M72 178 L66 192 M86 182 L84 196 M114 182 L116 196 M128 178 L134 192" stroke="#cbbf9e" stroke-width="3" stroke-linecap="round"/>
    <rect x="76" y="30" width="48" height="10" fill="${VERM}" opacity=".85"/>
    <path d="M88 52 h24 M100 46 v22 M86 64 l28 0 M92 74 q8 10 16 0 M100 76 v16 M86 96 h28 M90 104 l20 12 M110 104 l-20 12 M100 120 v20 M88 132 q12 -8 24 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <circle cx="100" cy="156" r="11" fill="none" stroke="${VERM}" stroke-width="3"/>
    <path d="M94 156 h12 M100 150 v12" stroke="${VERM}" stroke-width="2.5"/>
    <path d="M76 40 C74 80 74 130 78 170" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="3"/>`,
  lin('pp', [[0, '#efe4c8'], [1, '#c8b88e']]));
  const ofuda = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 100, 90, GHOST, 0.08 + w * 0.25) },
      { svg: ofudaSvg, pivot: [100, 10], anim: (t, w, k) => ({ rot: 0.05 * wave(t, 0.45, k) + 0.02 * wave(t, 1.3, k) + w * 0.12 * wave(t, 2.1), sx: 1 + 0.03 * wave(t, 0.9, k + 1) }) },
    ],
    fx: (ctx, t, w, k) => {
      if (!w) return;
      for (let i = 0; i < 4; i++) {
        const u = (t * 0.7 + i / 4) % 1;
        R.glowAt(ctx, 70 + i * 20 + 6 * wave(t, 1, i), 170 - u * 150, 7, GHOST, 0.7 * (1 - u));
      }
    },
  };

  // ---------- Каса-обакэ (зонт на одной ноге) ----------
  const umbrellaBody = svg(`
    <path d="M100 12 L100 22" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M100 18 C78 40 62 96 56 140 C76 150 124 150 144 140 C138 96 122 40 100 18 Z" fill="url(#um)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[66, 80, 92, 108, 120, 134].map((x) => `<path d="M100 22 C${(100 + x) / 2} 60 ${x} 110 ${x} 144" fill="none" stroke="${INK}" stroke-opacity=".45" stroke-width="2"/>`).join('')}
    <path d="M60 128 L70 138 L58 142 Z M136 120 L146 132 L132 138 Z M110 136 L118 146 L106 146 Z" fill="${INK}" opacity=".7"/>
    <path d="M72 90 C74 70 84 46 96 30" fill="none" stroke="#fff4d8" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="100" cy="78" rx="19" ry="21" fill="#f4ecd8" stroke="${INK}" stroke-width="3.5"/>
    <path d="M80 64 C90 56 112 56 122 66" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M86 116 C94 124 108 124 116 114 C110 132 92 132 86 116 Z" fill="#2a0404" stroke="${INK}" stroke-width="3"/>`,
  lin('um', [[0, '#d84a30'], [0.55, '#a02818'], [1, '#4a0a06']], 0, 0, 1, 0));
  const umbrellaEye = svg(`<circle cx="102" cy="80" r="11" fill="#1a0a04"/><circle cx="102" cy="80" r="5" fill="${INK}"/><circle cx="98" cy="76" r="3" fill="#fff"/>`);
  const umbrellaLid = svg(`<ellipse cx="100" cy="78" rx="20" ry="22" fill="#c23b22" stroke="${INK}" stroke-width="3"/><path d="M82 80 Q100 88 118 80" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  const umbrellaLeg = svg(`
    <path d="M100 146 L100 178" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>
    <path d="M100 146 L100 176" stroke="#d8c8a8" stroke-width="5" stroke-linecap="round"/>
    <path d="M82 180 H120 L118 188 H84 Z" fill="#7a5030" stroke="${INK}" stroke-width="3"/>
    <path d="M94 180 L100 170 L106 180" fill="none" stroke="${VERM}" stroke-width="3"/>`);
  const hop = (t, w, k) => {
    const h = pos(wave(t, 0.9 + w * 0.6, k));
    return h * h * (10 + w * 12);
  };
  const umbAnim = (t, w, k) => {
    const h = hop(t, w, k);
    return { dy: -h, sy: 1 - 0.03 * (1 - h / 10), sx: 1 + 0.02 * (1 - h / 10), rot: 0.05 * wave(t, 0.45, k) };
  };
  const umbrella = {
    parts: [
      { svg: svg(shadow(100, 188, 40, 5), SH), anim: (t, w, k) => ({ sx: 1 - hop(t, w, k) / 40 }) },
      { svg: umbrellaLeg, pivot: [100, 188], anim: (t, w, k) => ({ dy: -hop(t, w, k) }) },
      { svg: umbrellaBody, pivot: [100, 146], anim: umbAnim },
      { pivot: [100, 146], anim: umbAnim, draw: (ctx, t, w, k) => {
        // Длинный язык болтается.
        const sw = 10 * wave(t, 0.8 + w, k) + w * 8 * wave(t, 3);
        ctx.beginPath();
        ctx.moveTo(94, 122);
        ctx.quadraticCurveTo(96 + sw * 0.4, 146, 98 + sw, 162);
        ctx.quadraticCurveTo(106 + sw, 168, 108 + sw * 0.8, 158);
        ctx.quadraticCurveTo(106 + sw * 0.4, 142, 106, 122);
        ctx.closePath();
        ctx.fillStyle = '#d84a5a';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
      } },
      { svg: umbrellaEye, pivot: [100, 146], anim: (t, w, k) => {
        const m = umbAnim(t, w, k);
        return { ...m, dx: 2 * wave(t, 0.4, k) };
      } },
      { svg: umbrellaLid, pivot: [100, 146], anim: (t, w, k) => {
        const b = blip(t, 3.3, 0.22, k);
        return { ...umbAnim(t, w, k), a: b > 0.3 ? 1 : 0 };
      } },
    ],
  };

  // ---------- Тётин-обакэ (фонарь) ----------
  const lanternBody = svg(`
    <path d="M100 4 V18" stroke="${INK}" stroke-width="3"/>
    <rect x="72" y="16" width="56" height="12" rx="3" fill="#1a1010" stroke="${INK}" stroke-width="3"/>
    <rect x="72" y="166" width="56" height="12" rx="3" fill="#1a1010" stroke="${INK}" stroke-width="3"/>
    <path d="M76 28 C40 50 36 146 76 166 L124 166 C164 146 160 50 124 28 Z" fill="url(#ln)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    ${[44, 58, 72, 86, 100, 114, 128, 142, 154].map((y) => `<path d="M${y < 100 ? 52 - (100 - y) * 0.1 : 50} ${y} C80 ${y + 6} 120 ${y + 6} ${y < 100 ? 148 + (100 - y) * 0.1 : 150} ${y}" fill="none" stroke="${INK}" stroke-opacity=".4" stroke-width="1.6"/>`).join('')}
    <path d="M120 38 C140 50 150 66 150 80 L136 74 Z" fill="${INK}" opacity=".55"/>
    <path d="M60 60 C56 90 58 120 66 146" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="5" stroke-linecap="round"/>
    <ellipse cx="88" cy="74" rx="17" ry="13" fill="#fffae8" stroke="${INK}" stroke-width="3"/>
    <path d="M70 60 C80 54 96 56 104 62" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M64 112 C80 104 128 104 140 116 C132 136 114 140 100 136 C86 138 70 130 64 112 Z" fill="#1a0404" stroke="${INK}" stroke-width="3.5"/>
    <path d="M70 114 L76 122 L82 112 L88 120 L94 110 M112 110 L118 120 L124 112 L130 122 L136 116" fill="none" stroke="#efe6d2" stroke-width="2.5" stroke-linejoin="round"/>`,
  rad('ln', [[0, '#ffe8a8'], [0.45, '#f0a040'], [1, '#a0401a']], 0.5, 0.45, 0.65));
  const lanternEye = svg(`<circle cx="90" cy="75" r="8" fill="#1a0a04"/><circle cx="90" cy="75" r="3.5" fill="${INK}"/><circle cx="87" cy="72" r="2.2" fill="#fff"/>`);
  const lanternLid = svg(`<ellipse cx="88" cy="74" rx="18" ry="14" fill="#e88a30" stroke="${INK}" stroke-width="3"/><path d="M71 76 Q88 84 105 76" fill="none" stroke="${INK}" stroke-width="2.5"/>`);
  const lanternSway = (t, w, k) => ({ rot: 0.05 * wave(t, 0.33, k) + w * 0.12 * wave(t, 1.4) });
  const lantern = {
    parts: [
      { draw: (ctx, t, w, k) => R.glowAt(ctx, 100, 96, 96, '255, 170, 60', 0.22 + 0.1 * wave(t, 2.3, k) * wave(t, 0.7, k) + w * 0.25) },
      { svg: lanternBody, pivot: [100, 6], anim: lanternSway },
      { pivot: [100, 6], anim: lanternSway, draw: (ctx, t, w, k) => {
        // Свеча внутри дрожит — бумага светится неровно.
        const f = 0.5 + 0.25 * wave(t, 3.1, k) + 0.15 * wave(t, 7.3, k * 2) + w * 0.3;
        R.glowAt(ctx, 104, 96, 46, '255, 240, 180', 0.35 * f);
        // Язык вываливается изо рта и болтается.
        const sw = 9 * wave(t, 0.7 + w * 1.2, k + 0.5);
        ctx.beginPath();
        ctx.moveTo(92, 128);
        ctx.quadraticCurveTo(94 + sw * 0.3, 160, 100 + sw, 182);
        ctx.quadraticCurveTo(110 + sw, 188, 112 + sw * 0.8, 176);
        ctx.quadraticCurveTo(112 + sw * 0.3, 152, 112, 128);
        ctx.closePath();
        ctx.fillStyle = '#d84a5a';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = INK;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(102, 136);
        ctx.quadraticCurveTo(102 + sw * 0.5, 160, 106 + sw * 0.8, 176);
        ctx.strokeStyle = 'rgba(90, 10, 20, .6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } },
      { svg: lanternEye, pivot: [100, 6], anim: (t, w, k) => ({ ...lanternSway(t, w, k), dx: 2.5 * wave(t, 0.25, k), dy: 1.5 * wave(t, 0.4, k) }) },
      { svg: lanternLid, pivot: [100, 6], anim: (t, w, k) => {
        const b = blip(t, 3.9, 0.24, k * 1.4);
        return { ...lanternSway(t, w, k), a: b > 0.3 ? 1 : 0 };
      } },
    ],
  };

  // ---------- Гасадокуро (великан-скелет) ----------
  const boneG = (id) => lin(id, [[0, '#efe6d0'], [0.6, '#b8aa8a'], [1, '#5a5040']], 0, 0, 0.6, 1);
  const skullSvg = svg(`
    <path d="M100 10 C146 10 172 42 168 84 C166 104 156 116 146 124 L142 140 C126 148 74 148 58 140 L54 124 C44 116 34 104 32 84 C28 42 54 10 100 10 Z" fill="url(#bn)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M60 82 C56 62 72 56 88 64 C98 70 96 92 84 98 C72 104 62 98 60 82 Z" fill="#06040a" stroke="${INK}" stroke-width="2"/>
    <path d="M140 82 C144 62 128 56 112 64 C102 70 104 92 116 98 C128 104 138 98 140 82 Z" fill="#06040a" stroke="${INK}" stroke-width="2"/>
    <path d="M100 100 L108 118 H92 Z" fill="#06040a"/>
    <path d="M118 16 L112 34 L122 46 L114 58" fill="none" stroke="${INK}" stroke-width="2"/>
    <path d="M44 60 C46 38 64 22 88 18" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>
    ${strokes([[150, 60, 10, 30], [154, 92, 4, 22], [40, 96, 6, 20]], INK, 0.35, 2)}
    <path d="M62 126 H138" stroke="${INK}" stroke-width="2.5"/>
    ${[70, 80, 90, 100, 110, 120, 130].map((x) => `<path d="M${x} 124 V140" stroke="${INK}" stroke-width="2"/>`).join('')}`,
  boneG('bn'));
  const jawSvg = svg(`
    <path d="M58 140 C62 168 82 182 100 182 C118 182 138 168 142 140 C126 150 74 150 58 140 Z" fill="url(#bj)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M62 144 H138" stroke="${INK}" stroke-width="2.5"/>
    ${[70, 80, 90, 100, 110, 120, 130].map((x) => `<path d="M${x} 144 V156" stroke="${INK}" stroke-width="2"/>`).join('')}`,
  boneG('bj'));
  const handSvg = svg(`
    ${[[30, 196, 22, 120], [40, 198, 40, 112], [50, 196, 58, 118], [58, 192, 72, 132]].map(([x0, y0, x1, y1]) => `<path d="M${x0} ${y0} L${(x0 + x1) / 2 - 4} ${(y0 + y1) / 2} L${x1} ${y1}" fill="none" stroke="${INK}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x0} ${y0} L${(x0 + x1) / 2 - 4} ${(y0 + y1) / 2} L${x1} ${y1}" fill="none" stroke="#d8ccb0" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}`);
  const skeleton = {
    parts: [
      { draw: (ctx, t, w) => R.glowAt(ctx, 100, 90, 96, GHOST, 0.1 + w * 0.2) },
      { svg: handSvg, pivot: [40, 196], anim: (t, w, k) => ({ rot: 0.06 * wave(t, 0.25, k) - w * 0.15 * pos(wave(t, 1.2)), dy: -3 * wave(t, 0.25, k) }) },
      { svg: jawSvg, pivot: [100, 140], anim: (t, w, k) => {
        const ch = blip(t, 2.8, 0.5, k) * (0.6 + 0.4 * Math.abs(wave(t, 9))) + w * pos(wave(t, 3.5));
        return { dy: 9 * ch, rot: 0.03 * ch };
      } },
      { svg: skullSvg, pivot: [100, 140], anim: (t, w, k) => ({ rot: 0.02 * wave(t, 0.2, k), dy: -w * 4 * pos(wave(t, 1.75)) }) },
    ],
    fx: (ctx, t, w, k) => {
      const dy = -w * 4 * pos(wave(t, 1.75));
      for (const [x, ph] of [[76, 0], [124, 1.3]]) {
        const f = 0.5 + 0.3 * wave(t, 1.3, k + ph) + w * 0.5;
        R.glowAt(ctx, x, 82 + dy, 22, GHOST, 0.45 * f);
        R.glowAt(ctx, x, 82 + dy, 6, '230, 255, 250', 0.9 * f);
      }
    },
  };

  // ---------- Маска они ----------
  const oniSvg = svg(`
    <path d="M52 52 C40 30 40 12 52 4 C56 22 66 34 78 40 Z" fill="url(#hr)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M148 52 C160 30 160 12 148 4 C144 22 134 34 122 40 Z" fill="url(#hr)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M100 28 C150 28 176 64 170 110 C166 146 136 180 100 182 C64 180 34 146 30 110 C24 64 50 28 100 28 Z" fill="url(#mk)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round"/>
    <path d="M44 64 C60 50 80 52 92 66 C80 62 62 64 48 76 Z M156 64 C140 50 120 52 108 66 C120 62 138 64 152 76 Z" fill="${INK}"/>
    <path d="M56 84 C64 72 84 72 90 86 C84 98 62 98 56 84 Z" fill="#1a0404" stroke="${INK}" stroke-width="3"/>
    <path d="M144 84 C136 72 116 72 110 86 C116 98 138 98 144 84 Z" fill="#1a0404" stroke="${INK}" stroke-width="3"/>
    <path d="M92 96 C94 112 106 112 108 96 C112 108 112 120 100 122 C88 120 88 108 92 96 Z" fill="#7a1408" stroke="${INK}" stroke-width="3"/>
    <path d="M58 132 C72 120 128 120 142 132 C136 160 118 168 100 168 C82 168 64 160 58 132 Z" fill="#1a0404" stroke="${INK}" stroke-width="3.5"/>
    <path d="M66 134 L72 156 L80 136 M134 134 L128 156 L120 136" fill="#f4ead0" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M84 134 H116" stroke="#f4ead0" stroke-width="5"/>
    ${strokes([[40, 100, 8, 30], [160, 100, -8, 30], [70, 40, 20, -2], [110, 38, 20, 4]], INK, 0.4, 2)}
    <path d="M44 90 C42 70 54 46 76 38" fill="none" stroke="#ffb090" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>
    <path d="M100 176 C130 172 160 146 166 112" fill="none" stroke="${GOLD}" stroke-opacity=".35" stroke-width="3" stroke-linecap="round"/>`,
  rad('mk', [[0, '#e05a3a'], [0.6, '#a0200e'], [1, '#3a0604']], 0.42, 0.35, 0.8) + lin('hr', [[0, '#f0e6c8'], [1, '#8a7a54']]));
  const oniShake = (t, w, k) => ({ rot: 0.025 * wave(t, 0.22, k) + w * 0.05 * wave(t, 6), dy: 1.5 * wave(t, 0.3, k) });
  const oni = {
    parts: [
      { draw: (ctx, t, w, k) => R.glowAt(ctx, 100, 100, 96, '200, 40, 20', 0.16 + 0.06 * wave(t, 0.5, k) + w * 0.25) },
      { svg: oniSvg, pivot: [100, 110], anim: oniShake },
    ],
    fx: (ctx, t, w, k) => {
      // Глаза тлеют золотом, на выигрыше вспыхивают.
      const m = oniShake(t, w, k);
      ctx.save();
      ctx.translate(100, 110 + m.dy);
      ctx.rotate(m.rot);
      ctx.translate(-100, -110);
      for (const [x, ph] of [[74, 0], [126, 1.1]]) {
        const f = 0.55 + 0.25 * wave(t, 1.6, k + ph) + 0.15 * wave(t, 4.7, k * 2 + ph) + w * 0.5;
        R.glowAt(ctx, x, 86, 24, '255, 150, 30', 0.4 * f);
        R.glowAt(ctx, x, 86, 6, '255, 240, 160', f);
      }
      ctx.restore();
    },
  };

  // ---------- Цутигумо (паук-великан с лицом демона) ----------
  const spiderBelly = svg(`
    ${shadow(100, 186, 70, 7)}
    <ellipse cx="100" cy="142" rx="54" ry="42" fill="url(#sb)" stroke="${INK}" stroke-width="4.5"/>
    <path d="M52 134 C70 120 130 120 148 134 C130 128 70 128 52 134 Z M56 152 C72 140 128 140 144 152 C128 146 72 146 56 152 Z M66 168 C80 160 120 160 134 168 C120 164 80 164 66 168 Z" fill="${GOLD}" opacity=".85"/>
    <path d="M60 128 C74 116 126 116 140 128 M58 146 C74 134 126 134 142 146 M64 162 C78 152 122 152 136 162" fill="none" stroke="${VERM}" stroke-width="3"/>
    <path d="M100 104 V182" stroke="${INK}" stroke-opacity=".5" stroke-width="2.5"/>
    ${strokes([[48, 140, -6, 4], [50, 160, -6, 6], [152, 140, 6, 4], [150, 160, 6, 6], [70, 180, -4, 6], [130, 180, 4, 6]], INK, 0.7, 2)}
    <path d="M60 120 C70 108 88 102 104 102" fill="none" stroke="#e0b0ff" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/>`,
  SH + rad('sb', [[0, '#3a1c44'], [0.6, '#1a0c22'], [1, '#08040c']], 0.45, 0.3, 0.8));
  const spiderHead = svg(`
    <path d="M78 52 L70 32 L86 46 Z M122 52 L130 32 L114 46 Z" fill="#e8dcc0" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <path d="M62 86 C60 58 78 44 100 44 C122 44 140 58 138 86 C136 106 120 118 100 118 C80 118 64 106 62 86 Z" fill="url(#sh2)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M66 72 C76 64 88 66 96 74 M134 72 C124 64 112 66 104 74" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    ${[[86, 80, 10, 7], [114, 80, 10, 7], [76, 64, 5, 4], [124, 64, 5, 4], [91, 62, 4, 3.4], [109, 62, 4, 3.4]].map(([x, y, rx, ry]) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#1a0204" stroke="${INK}" stroke-width="2"/>`).join('')}
    <path d="M84 100 C92 106 108 106 116 100 C112 112 88 112 84 100 Z" fill="#1a0204" stroke="${INK}" stroke-width="2.5"/>
    ${strokes([[64, 92, -4, 8], [136, 92, 4, 8], [72, 108, -2, 8], [128, 108, 2, 8]], INK, 0.6, 2)}
    <path d="M70 70 C72 56 84 48 98 47" fill="none" stroke="#ffb0a0" stroke-opacity=".3" stroke-width="3.5" stroke-linecap="round"/>`,
  rad('sh2', [[0, '#a03040'], [0.6, '#5a1426'], [1, '#22060e']], 0.45, 0.35, 0.8));
  const fang = (s) => svg(`<path d="M${100 + s * 6} 104 C${100 + s * 16} 112 ${100 + s * 18} 128 ${100 + s * 8} 140 C${100 + s * 10} 128 ${100 + s * 6} 118 ${100 + s * 2} 112 Z" fill="url(#fg)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`,
    lin('fg', [[0, '#3a1c22'], [0.6, '#8a6a5a'], [1, '#efe6d0']]));
  const fangL = fang(-1);
  const fangR = fang(1);
  // Лапа: бедро вверх-наружу, голень вниз; щетинки и красный сустав.
  function spiderLeg(ctx, hip, knee, foot) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(hip[0], hip[1]);
    ctx.lineTo(knee[0], knee[1]);
    ctx.lineTo(foot[0], foot[1]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 10;
    ctx.stroke();
    ctx.strokeStyle = '#2a1430';
    ctx.lineWidth = 5.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(10, 8, 18, .8)';
    ctx.lineWidth = 1.2;
    for (const [a, b] of [[hip, knee], [knee, foot]]) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      for (let f = 0.2; f < 0.95; f += 0.18) {
        const x = a[0] + dx * f;
        const y = a[1] + dy * f;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - (dy / l) * 6 + (dx / l) * 3, y + (dx / l) * 6 + (dy / l) * 3);
        ctx.stroke();
      }
    }
    ctx.beginPath();
    ctx.arc(knee[0], knee[1], 3.4, 0, Math.PI * 2);
    ctx.fillStyle = VERM;
    ctx.fill();
  }
  const spiderRear = (t, w) => w * pos(wave(t, 1.1));
  const spider = {
    parts: [
      { draw: (ctx, t, w, k) => {
        // Паутина за спиной: лучи и спираль, поблёскивает.
        const a = 0.18 + 0.06 * wave(t, 0.4, k) + w * 0.3;
        ctx.strokeStyle = `rgba(220, 230, 255, ${a})`;
        ctx.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
          const ang = (i * Math.PI) / 6 + 0.1;
          ctx.beginPath();
          ctx.moveTo(100, 90);
          ctx.lineTo(100 + Math.cos(ang) * 104, 90 + Math.sin(ang) * 104);
          ctx.stroke();
        }
        for (let r = 22; r < 104; r += 14) {
          ctx.beginPath();
          for (let i = 0; i <= 12; i++) {
            const ang = (i * Math.PI) / 6 + 0.1;
            const rr = r + 3 * Math.sin(i * 2 + r);
            ctx[i ? 'lineTo' : 'moveTo'](100 + Math.cos(ang) * rr, 90 + Math.sin(ang) * rr);
          }
          ctx.stroke();
        }
        R.glowAt(ctx, 100, 100, 96, '150, 60, 200', 0.12 + w * 0.22);
      } },
      { draw: (ctx, t, w, k) => {
        // Восемь лап перебирают по паутине; на выигрыше паук встаёт на дыбы.
        const rear = spiderRear(t, w);
        for (let i = 0; i < 4; i++) {
          for (const s of [-1, 1]) {
            const ph = k + i * 0.8 + (s > 0 ? 1.6 : 0);
            const step = wave(t, 0.45 + w * 0.8, ph);
            const hip = [100 + s * 16, 96 + i * 8];
            const lift = (i < 2 ? 26 : 10) * rear;
            const knee = [hip[0] + s * (40 + i * 3), hip[1] - 32 + i * 18 + 6 * step - lift];
            const foot = [knee[0] + s * (24 - i * 3), knee[1] + 46 - i * 8 + 3 * pos(step) - lift * 0.6];
            spiderLeg(ctx, hip, knee, foot);
          }
        }
      } },
      { svg: spiderBelly, pivot: [100, 120], anim: (t, w, k) => ({ sy: 1 + 0.025 * wave(t, 0.35, k), sx: 1 - 0.015 * wave(t, 0.35, k), dy: 4 * spiderRear(t, w) }) },
      { svg: fangL, pivot: [94, 106], anim: (t, w, k) => {
        const c = blip(t, 2.2, 0.35, k) + w * pos(wave(t, 3.2));
        return { rot: 0.35 * c, dy: -10 * spiderRear(t, w) };
      } },
      { svg: fangR, pivot: [106, 106], anim: (t, w, k) => {
        const c = blip(t, 2.2, 0.35, k) + w * pos(wave(t, 3.2));
        return { rot: -0.35 * c, dy: -10 * spiderRear(t, w) };
      } },
      { svg: spiderHead, pivot: [100, 116], anim: (t, w, k) => ({ rot: 0.03 * wave(t, 0.25, k), dy: -10 * spiderRear(t, w) }) },
    ],
    fx: (ctx, t, w, k) => {
      // Шесть глаз горят красным и моргают по очереди.
      const dy = -10 * spiderRear(t, w);
      const eyes = [[86, 80, 8], [114, 80, 8], [76, 64, 4], [124, 64, 4], [91, 62, 3.2], [109, 62, 3.2]];
      eyes.forEach(([x, y, r], i) => {
        const shut = blip(t + i * 0.37, 3.6, 0.2, k);
        if (shut > 0.4) return;
        const f = 0.6 + 0.25 * wave(t, 1.4, k + i) + w * 0.4;
        R.glowAt(ctx, x, y + dy, r * 2.6, '255, 40, 40', 0.35 * f);
        R.glowAt(ctx, x, y + dy, r, '255, 200, 160', 0.9 * f);
      });
    },
  };

  // ---------- Кицунэ (WILD, хвосты = множитель) ----------
  const foxBody = svg(`
    ${shadow(100, 156, 52, 7)}
    <path d="M62 150 C56 120 66 92 84 82 L116 82 C134 92 144 120 138 150 C120 158 80 158 62 150 Z" fill="url(#fb)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M84 96 C92 112 108 112 116 96 C114 120 106 140 100 146 C94 140 86 120 84 96 Z" fill="#fffaf0" opacity=".85"/>
    <path d="M74 150 C74 138 80 132 86 136 C88 142 86 150 82 152 Z M126 150 C126 138 120 132 114 136 C112 142 114 150 118 152 Z" fill="#f4ecdc" stroke="${INK}" stroke-width="2.5"/>
    <path d="M80 100 C84 92 92 90 96 92" fill="none" stroke="${VERM}" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M90 80 L110 80 L106 92 L94 92 Z" fill="${VERM}" stroke="${INK}" stroke-width="2"/>
    <circle cx="100" cy="98" r="6" fill="${GOLD}" stroke="${INK}" stroke-width="2"/>`,
  lin('fb', [[0, '#fbf6ea'], [0.6, '#e2d8c2'], [1, '#a89c84']], 0, 0, 1, 1));
  const foxHead = svg(`
    <path d="M64 58 L56 10 L86 40 Z" fill="#f4ecdc" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M136 58 L144 10 L114 40 Z" fill="#f4ecdc" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M66 50 L61 24 L78 41 Z M134 50 L139 24 L122 41 Z" fill="${VERM}" opacity=".85"/>
    <path d="M60 58 C62 38 82 30 100 30 C118 30 138 38 140 58 C142 72 128 80 116 88 L104 100 C102 102 98 102 96 100 L84 88 C72 80 58 72 60 58 Z" fill="url(#fh)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M100 30 L100 44 M92 34 L96 46 M108 34 L104 46" stroke="${VERM}" stroke-width="3" stroke-linecap="round"/>
    <path d="M70 56 C76 50 86 50 92 56 C86 62 76 62 70 56 Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M130 56 C124 50 114 50 108 56 C114 62 124 62 130 56 Z" fill="${GOLD}" stroke="${INK}" stroke-width="2.5"/>
    <path d="M81 52 V60 M119 52 V60" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    <path d="M66 52 C72 46 84 44 94 50 M134 52 C128 46 116 44 106 50" fill="none" stroke="${VERM}" stroke-width="3" stroke-linecap="round"/>
    <path d="M94 92 C96 96 104 96 106 92 L100 100 Z" fill="${INK}"/>
    <path d="M86 84 C92 90 98 92 100 92 C102 92 108 90 114 84" fill="none" stroke="${INK}" stroke-opacity=".5" stroke-width="2"/>
    <path d="M66 46 C70 38 80 34 90 34" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`,
  lin('fh', [[0, '#fffaf0'], [0.7, '#ece2cc'], [1, '#bcae94']], 0, 0, 0, 1));
  const foxEyesGlow = (ctx, t, w, k, dy) => {
    const f = 0.5 + 0.2 * wave(t, 1.1, k) + w * 0.4;
    for (const x of [81, 119]) R.glowAt(ctx, x, 56 + dy, 14, '255, 200, 90', 0.45 * f);
  };
  function drawTail(ctx, a, len, w0, t, sp, ph) {
    // Хвост — изогнутая кисть: широкий у основания, сужается к белому кончику с голубым огнём.
    const bx = 100;
    const by = 140;
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const f = i / 10;
      const sway = wave(t, sp, ph + f * 1.8) * 0.22 * f;
      const ang = a + sway + f * f * 0.35 * (Math.cos(a) >= 0 ? 1 : -1);
      pts.push([bx + Math.cos(ang) * len * f, by + Math.sin(ang) * len * f]);
    }
    const L = [];
    const Rr = [];
    for (let i = 0; i <= 10; i++) {
      const p = pts[i];
      const q = pts[Math.min(10, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      let nx = -(q[1] - o[1]);
      let ny = q[0] - o[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const f = i / 10;
      const hw = w0 * (0.55 + Math.sin(f * Math.PI) * 0.75) * (1 - f * 0.55);
      L.push([p[0] + nx * hw, p[1] + ny * hw]);
      Rr.push([p[0] - nx * hw, p[1] - ny * hw]);
    }
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (const p of L) ctx.lineTo(p[0], p[1]);
    const tip = pts[10];
    ctx.quadraticCurveTo(tip[0] + (tip[0] - pts[9][0]) * 2, tip[1] + (tip[1] - pts[9][1]) * 2, Rr[10][0], Rr[10][1]);
    for (let i = 10; i >= 0; i--) ctx.lineTo(Rr[i][0], Rr[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(bx, by, tip[0], tip[1]);
    g.addColorStop(0, '#e2d8c2');
    g.addColorStop(0.6, '#fbf6ea');
    g.addColorStop(1, '#d8fff6');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.stroke();
    // Красная полоска и мазки шерсти.
    ctx.beginPath();
    for (let i = 3; i <= 7; i++) ctx[i === 3 ? 'moveTo' : 'lineTo'](pts[i][0], pts[i][1]);
    ctx.strokeStyle = 'rgba(194, 59, 34, .55)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    return tip;
  }
  const foxCache = {};
  function fox(tails) {
    const n = Math.max(1, Math.min(12, tails | 0));
    if (foxCache[n]) return foxCache[n];
    // Хвосты веером за спиной: раскрытие зависит от числа.
    const spread = Math.min(Math.PI * 0.92, 1.5 + n * 0.12);
    const angles = Array.from({ length: n }, (_, i) => -Math.PI / 2 + (n === 1 ? 0.75 : -spread / 2 + (spread * i) / (n - 1)));
    const len = n > 6 ? 88 : 94;
    const width = n > 6 ? 12 : 16;
    const def = {
      parts: [
        { draw: (ctx, t, w) => {
          R.glowAt(ctx, 100, 96, 98, GHOST, 0.14 + w * 0.22);
        } },
        { draw: (ctx, t, w, k) => {
          const tips = angles.map((a, i) => drawTail(ctx, a, len, width, t, 0.35 + w * 0.9, k + i * 0.9));
          // Лисьи огни на кончиках хвостов.
          tips.forEach(([x, y], i) => {
            const f = 0.45 + 0.3 * wave(t, 1.2, k + i) + w * 0.4;
            R.glowAt(ctx, x, y, 14, GHOST, 0.5 * f);
          });
        } },
        { svg: foxBody, pivot: [100, 150], anim: (t, w, k) => ({ sy: 1 + 0.015 * wave(t, 0.3, k) }) },
        { svg: foxHead, pivot: [100, 90], anim: (t, w, k) => ({ rot: 0.05 * wave(t, 0.23, k) + w * 0.08 * wave(t, 1.3), dy: -w * 3 * pos(wave(t, 1.3)) }) },
        { svg: ribbon('rbf', GOLD) },
      ],
      fx: (ctx, t, w, k) => {
        foxEyesGlow(ctx, t, w, k, -w * 3 * pos(wave(t, 1.3)));
        // Кицунэ-би: огоньки кружат вокруг.
        for (let i = 0; i < 3; i++) {
          const a = t * (0.6 + w * 0.8) + (i * Math.PI * 2) / 3 + k;
          R.glowAt(ctx, 100 + Math.cos(a) * 66, 92 + Math.sin(a) * 30, 9, GHOST, 0.55 + w * 0.3);
          R.glowAt(ctx, 100 + Math.cos(a) * 66, 92 + Math.sin(a) * 30, 3, '230, 255, 250', 0.9);
        }
        label(ctx, n > 1 ? `WILD ×${n}` : 'WILD', ['#f5e2a8', '#c9a14a', '#6b4a14']);
      },
    };
    foxCache[n] = def;
    return def;
  }

  // ---------- Тории (скаттер) ----------
  const toriiSvg = svg(`
    <path d="M14 28 C60 40 140 40 186 28 L182 44 C140 52 60 52 18 44 Z" fill="#1a0c0c" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M24 46 C64 54 136 54 176 46 L174 58 C136 64 64 64 26 58 Z" fill="url(#vm)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <rect x="34" y="78" width="132" height="12" fill="url(#vm)" stroke="${INK}" stroke-width="3.5"/>
    <rect x="90" y="58" width="20" height="20" fill="#1a0c0c" stroke="${INK}" stroke-width="3"/>
    <path d="M94 64 h12 M94 70 h12" stroke="${GOLD}" stroke-width="2"/>
    <path d="M52 58 L46 156 H66 L68 58 Z M148 58 L154 156 H134 L132 58 Z" fill="url(#vp)" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M42 150 H70 V158 H42 Z M130 150 H158 V158 H130 Z" fill="#1a0c0c" stroke="${INK}" stroke-width="3"/>
    <path d="M54 64 L50 148 M146 64 L150 148" stroke="#ffb090" stroke-opacity=".3" stroke-width="2.5"/>`,
  lin('vm', [[0, '#e0503a'], [1, '#7a160a']]) + lin('vp', [[0, '#d0402a'], [0.5, '#a02818'], [1, '#5a0c06']], 0, 0, 1, 0));
  const torii = {
    parts: [
      { draw: (ctx, t, w, k) => {
        // За воротами — лунный свет и туман: портал в ночь.
        const g = ctx.createRadialGradient(100, 112, 4, 100, 112, 50);
        g.addColorStop(0, `rgba(230, 250, 255, ${0.75 + 0.15 * wave(t, 0.4, k) + w * 0.2})`);
        g.addColorStop(0.5, `rgba(${GHOST}, .35)`);
        g.addColorStop(1, `rgba(${GHOST}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(48, 60, 104, 100);
        R.glowAt(ctx, 100, 104, 96, '220, 60, 30', 0.15 + 0.06 * wave(t, 0.6, k) + w * 0.3);
      } },
      { svg: toriiSvg, pivot: [100, 156], anim: (t, w) => ({ sy: 1 + w * 0.04 * pos(wave(t, 1.2)) }) },
      { svg: ribbon('rbt', '#e0503a') },
    ],
    fx: (ctx, t, w, k) => {
      // Падающие лепестки и огоньки за воротами.
      for (let i = 0; i < 4; i++) {
        const u = (t * 0.25 + i / 4 + k * 0.13) % 1;
        const x = 60 + i * 26 + 10 * wave(t, 0.5, i);
        const y = 60 + u * 96;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 2 + i);
        ctx.fillStyle = `rgba(255, 190, 200, ${0.8 * (1 - u)})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, 4, 2.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (w) R.sweep(ctx, t, w, { color: '255, 200, 160' });
      label(ctx, 'БОНУС', ['#ffe9b0', '#e0603a', '#7a1a0c']);
    },
  };

  root.YokaiRig = { SYMBOLS: { sake, geta, fan, ofuda, umbrella, lantern, skeleton, oni, spider, torii }, fox };
})(window);
