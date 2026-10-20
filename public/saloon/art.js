// «Салун мертвецов»: рисунки символов (SVG, 200×200), в духе Дня мёртвых на Диком Западе.
// В браузере: window.SaloonArt. Надписи (WILD, РОЗЫСК) слот дорисовывает шрифтом страницы.
(function (root) {
  'use strict';

  const INK = '#1f0e07';
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const glow = (id, sd = 6) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

  // Деревянная рамка старших символов: доска, цветная вставка, гвозди.
  function frame(p, panel) {
    return {
      defs: lin(`${p}wood`, [[0, '#c98b4e'], [0.5, '#8a5326'], [1, '#5a3014']], 1, 1)
        + rad(`${p}panel`, [[0, panel[0]], [1, panel[1]]], 0.5, 0.4, 0.75),
      back: `<rect x="8" y="8" width="184" height="184" rx="24" fill="${INK}"/>
        <rect x="12" y="12" width="176" height="176" rx="21" fill="url(#${p}wood)"/>
        ${[40, 70, 100, 130, 160].map((y) => `<path d="M16 ${y} q40 -4 84 2 q44 5 84 -1" fill="none" stroke="#5a3014" stroke-opacity=".35" stroke-width="2"/>`).join('')}
        <rect x="26" y="26" width="148" height="148" rx="14" fill="url(#${p}panel)" stroke="${INK}" stroke-width="4"/>`,
      front: `${[[20, 20], [180, 20], [20, 180], [180, 180]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#d9d2c4" stroke="${INK}" stroke-width="2"/>`).join('')}
        <path d="M34 60 Q36 36 62 34" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="5" stroke-linecap="round"/>`,
    };
  }

  // Череп (общий для бармена и шерифа): cx, cy — центр, s — масштаб.
  function skull(p, { eyes = INK, glowEyes = false } = {}) {
    return `
      <path d="M100 52 C140 52 156 80 154 108 C152 126 144 134 138 140 L136 156 C136 166 128 172 118 172 L82 172 C72 172 64 166 64 156 L62 140 C56 134 48 126 46 108 C44 80 60 52 100 52 Z" fill="url(#${p}bone)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
      ${glowEyes ? `<ellipse cx="78" cy="112" rx="18" ry="16" fill="#ff3b1f" opacity=".7" filter="url(#${p}glow)"/><ellipse cx="122" cy="112" rx="18" ry="16" fill="#ff3b1f" opacity=".7" filter="url(#${p}glow)"/>` : ''}
      <path d="M62 108 C62 96 74 92 86 96 C94 100 94 116 88 124 C80 132 64 126 62 108 Z" fill="${eyes}" stroke="${INK}" stroke-width="3"/>
      <path d="M138 108 C138 96 126 92 114 96 C106 100 106 116 112 124 C120 132 136 126 138 108 Z" fill="${eyes}" stroke="${INK}" stroke-width="3"/>
      ${glowEyes ? '<circle cx="80" cy="110" r="5" fill="#ffe08a"/><circle cx="120" cy="110" r="5" fill="#ffe08a"/>' : ''}
      <path d="M100 126 L92 140 L108 140 Z" fill="${INK}"/>
      <path d="M76 152 H124" stroke="${INK}" stroke-width="3"/>
      ${[82, 91, 100, 109, 118].map((x) => `<path d="M${x} 146 V164" stroke="${INK}" stroke-width="2.5"/>`).join('')}
      <path d="M66 84 C72 66 88 58 104 58" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="6" stroke-linecap="round"/>
      <path d="M128 64 L122 76 L130 84" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`;
  }
  const boneDefs = (p) => rad(`${p}bone`, [[0, '#fffdf4'], [0.6, '#efe3c8'], [1, '#bfa983']], 0.4, 0.35, 0.75) + glow(`${p}glow`, 6);

  // ---------- Младшие ----------

  const horseshoe = svg(`
    <circle cx="100" cy="104" r="80" fill="#ffcf5a" opacity=".18" filter="url(#hsGlow)"/>
    <path d="M52 40 C18 82 26 158 100 166 C174 158 182 82 148 40" fill="none" stroke="${INK}" stroke-width="46" stroke-linecap="butt"/>
    <path d="M52 40 C18 82 26 158 100 166 C174 158 182 82 148 40" fill="none" stroke="url(#hsIron)" stroke-width="34" stroke-linecap="butt"/>
    <path d="M52 40 C18 82 26 158 100 166 C174 158 182 82 148 40" fill="none" stroke="#fff6d0" stroke-opacity=".35" stroke-width="5" stroke-dasharray="1 0" transform="translate(-6 -4)"/>
    ${[[42, 70], [36, 106], [48, 140], [158, 70], [164, 106], [152, 140]].map(([x, y]) => `<rect x="${x - 5}" y="${y - 3}" width="10" height="6" rx="2" fill="${INK}"/>`).join('')}
    <rect x="30" y="30" width="44" height="16" rx="4" fill="url(#hsIron)" stroke="${INK}" stroke-width="4"/>
    <rect x="126" y="30" width="44" height="16" rx="4" fill="url(#hsIron)" stroke="${INK}" stroke-width="4"/>`,
  lin('hsIron', [[0, '#ffe9a0'], [0.45, '#d99a2b'], [1, '#7a4a0c']], 1, 1) + glow('hsGlow', 10));

  const whiskey = svg(`
    <path d="M86 14 H114 V48 C114 56 140 62 140 78 V172 C140 182 132 188 122 188 H78 C68 188 60 182 60 172 V78 C60 62 86 56 86 48 Z" fill="${INK}"/>
    <path d="M90 18 H110 V50 C110 58 136 64 136 78 V172 C136 179 130 184 122 184 H78 C70 184 64 179 64 172 V78 C64 64 90 58 90 50 Z" fill="url(#whGlass)"/>
    <path d="M66 112 H134 V172 C134 178 128 182 122 182 H78 C72 182 66 178 66 172 Z" fill="url(#whLiquid)" opacity=".92"/>
    <rect x="88" y="6" width="24" height="18" rx="4" fill="#a86a32" stroke="${INK}" stroke-width="4"/>
    <rect x="68" y="98" width="64" height="48" rx="4" fill="url(#whLabel)" stroke="${INK}" stroke-width="4"/>
    <circle cx="100" cy="118" r="11" fill="#fdf6e4" stroke="#7a1d12" stroke-width="3"/>
    <circle cx="96" cy="117" r="2.6" fill="#7a1d12"/><circle cx="104" cy="117" r="2.6" fill="#7a1d12"/>
    <path d="M95 125 H105" stroke="#7a1d12" stroke-width="2"/>
    <path d="M74 138 H126" stroke="#7a1d12" stroke-width="3"/>
    <path d="M72 84 C68 100 68 150 72 170" stroke="#fff" stroke-opacity=".45" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M132 150 L176 150 L170 188 L138 188 Z" fill="url(#whShot)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M135 164 L173 164 L170 186 L139 186 Z" fill="#d98a1f" opacity=".85"/>
    <path d="M140 154 L142 182" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`,
  lin('whGlass', [[0, '#c77a3a'], [0.5, '#7a3d12'], [1, '#3d1a05']], 1, 0)
  + lin('whLiquid', [[0, '#f0a63a'], [1, '#7a3d08']])
  + lin('whLabel', [[0, '#fbeccb'], [1, '#d8b77a']])
  + lin('whShot', [[0, '#e8f6ff', 0.7], [1, '#9fc4d8', 0.5]]));

  const hat = svg(`
    <ellipse cx="100" cy="150" rx="86" ry="20" fill="#000" opacity=".25"/>
    <path d="M14 128 C30 150 62 156 100 156 C138 156 170 150 186 128 C176 112 160 124 140 126 L60 126 C40 124 24 112 14 128 Z" fill="url(#htLeather)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M58 126 C56 92 62 58 78 48 C88 42 94 56 100 56 C106 56 112 42 122 48 C138 58 144 92 142 126 Z" fill="url(#htCrown)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M86 64 C92 74 108 74 114 64" fill="none" stroke="${INK}" stroke-width="3" stroke-opacity=".6"/>
    <path d="M58 106 C80 112 120 112 142 106 L142 124 C120 130 80 130 58 124 Z" fill="#2a120a" stroke="${INK}" stroke-width="3"/>
    <circle cx="100" cy="116" r="9" fill="url(#htSilver)" stroke="${INK}" stroke-width="2.5"/>
    ${[78, 122].map((x) => `<circle cx="${x}" cy="116" r="4" fill="url(#htSilver)" stroke="${INK}" stroke-width="1.5"/>`).join('')}
    <path d="M68 96 C66 76 72 62 80 56" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="6" stroke-linecap="round"/>
    <path d="M30 132 C50 144 80 146 100 146" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/>`,
  lin('htLeather', [[0, '#d29a5c'], [0.6, '#8a5326'], [1, '#4e2a10']])
  + lin('htCrown', [[0, '#c98b4e'], [1, '#6e3d18']], 1, 1)
  + rad('htSilver', [[0, '#ffffff'], [0.6, '#c9d2dc'], [1, '#6f7c8a']]));

  const boot = svg(`
    <path d="M70 18 H124 C126 50 124 90 128 118 C150 124 176 136 182 156 C184 168 176 176 164 176 H90 L88 186 H62 L60 176 C56 140 62 60 70 18 Z" fill="url(#btLeather)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M70 18 H124 L122 36 H72 Z" fill="#5a2c10" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M80 54 C90 70 104 70 114 54 M80 80 C90 96 104 96 114 80 M92 104 C100 116 112 116 118 104" fill="none" stroke="#f2c14e" stroke-width="3" stroke-linecap="round"/>
    <path d="M128 132 C146 138 164 146 172 158" fill="none" stroke="#f2c14e" stroke-width="3" stroke-dasharray="5 5"/>
    <path d="M62 168 H164" stroke="${INK}" stroke-width="3"/>
    <path d="M76 34 C72 70 70 120 72 160" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="6" stroke-linecap="round"/>
    <path d="M62 150 L34 158" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
    <path d="M62 150 L34 158" stroke="url(#btSilver)" stroke-width="4" stroke-linecap="round"/>
    <g transform="translate(28 160)">
      ${Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5;
    return `<path d="M0 0 L${(Math.cos(a) * 20).toFixed(1)} ${(Math.sin(a) * 20).toFixed(1)}" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M0 0 L${(Math.cos(a) * 19).toFixed(1)} ${(Math.sin(a) * 19).toFixed(1)}" stroke="url(#btSilver)" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join('')}
      <circle r="7" fill="url(#btSilver)" stroke="${INK}" stroke-width="3"/>
    </g>`,
  lin('btLeather', [[0, '#b0602a'], [0.5, '#7a3a14'], [1, '#4a1f08']], 1, 1)
  + lin('btSilver', [[0, '#ffffff'], [1, '#8a96a3']]));

  // ---------- Старшие ----------

  const vuF = frame('vu', ['#ffb36b', '#b8461f']);
  const vulture = svg(`${vuF.back}
    <circle cx="100" cy="70" r="30" fill="#ffd27a" opacity=".55"/>
    <path d="M40 170 C46 140 60 128 74 124 L68 112 L84 120 L82 106 L96 118 L100 104 L106 118 L118 106 L118 120 L132 112 L126 124 C140 128 154 140 160 170 Z" fill="#1d1414" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M90 124 C86 104 84 86 86 72 C88 54 104 46 118 52 C130 58 134 74 128 86 C124 94 116 100 112 108 C108 116 108 122 110 126 Z" fill="url(#vuSkin)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M126 70 C142 70 156 78 158 92 C150 88 142 88 134 90 C138 96 138 104 132 108 C130 98 126 92 120 88 Z" fill="url(#vuBeak)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <circle cx="112" cy="68" r="8" fill="#fff8d6" stroke="${INK}" stroke-width="3"/>
    <circle cx="114" cy="68" r="4" fill="${INK}"/>
    <path d="M100 58 L122 62" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M94 80 q6 4 2 10 M96 96 q6 4 2 10" fill="none" stroke="#7a1d22" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M94 62 C96 54 104 50 112 52" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
    ${vuF.front}`,
  vuF.defs + lin('vuSkin', [[0, '#ffb0a0'], [1, '#c2405a']], 1, 1) + lin('vuBeak', [[0, '#fff2b0'], [1, '#c98f22']]));

  const skF = frame('sk', ['#7ff0e0', '#137f80']);
  const bullskull = svg(`${skF.back}
    <path d="M70 72 C46 72 28 56 22 34 C20 28 28 26 30 32 C38 50 54 58 74 58 Z" fill="url(#skHorn)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M130 72 C154 72 172 56 178 34 C180 28 172 26 170 32 C162 50 146 58 126 58 Z" fill="url(#skHorn)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M100 48 C130 48 142 64 140 84 C138 98 128 108 124 122 C120 140 116 168 100 172 C84 168 80 140 76 122 C72 108 62 98 60 84 C58 64 70 48 100 48 Z" fill="url(#skBone)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M72 84 C72 76 80 72 88 74 C94 78 94 90 88 96 C80 100 72 94 72 84 Z" fill="${INK}"/>
    <path d="M128 84 C128 76 120 72 112 74 C106 78 106 90 112 96 C120 100 128 94 128 84 Z" fill="${INK}"/>
    <circle cx="82" cy="84" r="3" fill="#7ff0e0"/><circle cx="118" cy="84" r="3" fill="#7ff0e0"/>
    <path d="M92 150 C92 158 96 162 98 162 M108 150 C108 158 104 162 102 162" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <path d="M100 56 L96 70 L102 80" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
    <path d="M86 110 C90 120 110 120 114 110" fill="none" stroke="#b39a74" stroke-width="3"/>
    ${[[100, 100], [86, 130], [114, 130]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#e85a7a" stroke="${INK}" stroke-width="1.5"/>`).join('')}
    <path d="M70 66 C78 56 90 52 102 52" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>
    ${skF.front}`,
  skF.defs + rad('skBone', [[0, '#fffdf4'], [0.6, '#efe3c8'], [1, '#bfa983']], 0.4, 0.3, 0.8)
  + lin('skHorn', [[0, '#fff7e0'], [0.7, '#d8c49a'], [1, '#6b5233']], 1, 0));

  const bmF = frame('bm', ['#c48bff', '#4b1f8a']);
  const barman = svg(`${bmF.back}
    <path d="M40 176 C46 150 66 140 100 140 C134 140 154 150 160 176 Z" fill="#2a1438" stroke="${INK}" stroke-width="4"/>
    <path d="M78 140 L100 164 L122 140 Z" fill="#f4f1e8" stroke="${INK}" stroke-width="3"/>
    <path d="M100 152 L80 142 L80 166 Z M100 152 L120 142 L120 166 Z" fill="#d6322a" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="100" cy="152" r="5" fill="#a8201a" stroke="${INK}" stroke-width="2"/>
    <g transform="translate(0 -20) scale(1)">${skull('bm')}</g>
    <path d="M54 66 C58 38 86 30 102 32 C124 34 144 44 146 66 C132 54 114 50 100 56 C88 50 70 54 54 66 Z" fill="#141018" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M100 34 L98 56" stroke="#3a3040" stroke-width="3"/>
    <path d="M100 128 C90 124 74 126 64 136 C60 140 62 146 68 142 C76 136 88 134 100 134 C112 134 124 136 132 142 C138 146 140 140 136 136 C126 126 110 124 100 128 Z" fill="#1a1010" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    ${bmF.front}`,
  bmF.defs + boneDefs('bm'));

  const shF = frame('sh', ['#ffe08a', '#b0700f']);
  const sheriff = svg(`${shF.back}
    <path d="M44 176 C48 156 64 146 100 146 C136 146 152 156 156 176 Z" fill="#a8201a" stroke="${INK}" stroke-width="4"/>
    <path d="M70 150 L100 172 L130 150" fill="none" stroke="${INK}" stroke-width="3"/>
    <g transform="translate(0 -14)">${skull('sh', { eyes: '#2a0505', glowEyes: true })}</g>
    <path d="M18 70 C34 82 66 84 100 84 C134 84 166 82 182 70 C176 60 160 66 146 68 L54 68 C40 66 24 60 18 70 Z" fill="url(#shHat)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M56 68 C54 46 60 26 76 20 C86 16 92 28 100 28 C108 28 114 16 124 20 C140 26 146 46 144 68 Z" fill="url(#shCrown)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M56 58 C80 62 120 62 144 58 L144 68 C120 72 80 72 56 68 Z" fill="#2a120a"/>
    <path d="M100 34 L105 44 L116 45 L108 52 L111 63 L100 57 L89 63 L92 52 L84 45 L95 44 Z" fill="url(#shStar)" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="100" cy="49" r="3" fill="#7a4a0c"/>
    <path d="M118 138 L142 132" stroke="#e8d6b0" stroke-width="7" stroke-linecap="round"/>
    <path d="M118 138 L142 132" stroke="${INK}" stroke-width="2" stroke-dasharray="2 8"/>
    <circle cx="144" cy="131" r="4" fill="#ff7a2a" opacity=".9"/>
    ${shF.front}`,
  shF.defs + boneDefs('sh')
  + lin('shHat', [[0, '#a36a3a'], [1, '#4e2a10']])
  + lin('shCrown', [[0, '#8a5326'], [1, '#3e2008']], 1, 1)
  + lin('shStar', [[0, '#fff1b0'], [0.5, '#f2b632'], [1, '#b0700f']], 1, 1));

  // ---------- Кольт (вайлд) ----------
  const colt = svg(`
    <circle cx="100" cy="94" r="90" fill="url(#coBurst)"/>
    ${Array.from({ length: 14 }, (_, i) => {
    const a = (i * Math.PI * 2) / 14;
    const pt = (r, d) => `${(100 + Math.cos(a + d) * r).toFixed(1)} ${(94 + Math.sin(a + d) * r).toFixed(1)}`;
    return `<path d="M${pt(26, -0.09)} L${pt(94, 0)} L${pt(26, 0.09)} Z" fill="#ffd36b" opacity=".2"/>`;
  }).join('')}
    <g transform="translate(8 10) scale(.9) rotate(-14 100 104)" stroke="${INK}" stroke-width="4.5" stroke-linejoin="round">
      <path d="M52 90 L82 102 C78 126 70 148 58 166 C52 176 34 176 26 166 C20 158 22 146 28 134 C36 118 44 104 52 90 Z" fill="url(#coGrip)"/>
      <path d="M74 104 C72 122 84 128 98 120 L98 104" fill="none" stroke-width="5"/>
      <path d="M50 62 H104 V100 L84 106 H56 C50 100 48 80 50 62 Z" fill="url(#coSteel)"/>
      <path d="M100 68 H188 V86 H100 Z" fill="url(#coSteel)"/>
      <path d="M100 86 H162 V95 H100 Z" fill="url(#coSteel)"/>
      <rect x="178" y="60" width="8" height="9" fill="url(#coSteel)" stroke-width="3"/>
      <rect x="64" y="56" width="40" height="50" rx="10" fill="url(#coCyl)"/>
      ${[74, 84, 94].map((x) => `<path d="M${x} 60 V102" stroke-width="2.5" stroke-opacity=".55"/>`).join('')}
      <path d="M52 64 L38 50 L52 46 L62 58" fill="url(#coSteel)"/>
    </g>
    <g transform="translate(8 10) scale(.9) rotate(-14 100 104)">
      <path d="M106 72 C126 70 150 74 182 72" fill="none" stroke="#f2c14e" stroke-width="2.5"/>
      <path d="M108 80 c6 -6 12 6 18 0 c6 -6 12 6 18 0 c6 -6 12 6 18 0" fill="none" stroke="#f2c14e" stroke-width="2"/>
      <path d="M56 70 C70 68 88 68 100 70" fill="none" stroke="#f2c14e" stroke-width="2"/>
      <circle cx="44" cy="146" r="9" fill="#fdf6e4" stroke="${INK}" stroke-width="2.5"/>
      <circle cx="41" cy="145" r="2" fill="${INK}"/><circle cx="47" cy="145" r="2" fill="${INK}"/>
      <path d="M58 104 C52 120 44 134 36 150" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
      <path d="M104 71 H184" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linecap="round"/>
      <path d="M70 62 C76 60 92 60 98 62" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    </g>
    <circle cx="186" cy="48" r="10" fill="#e8e0d0" opacity=".5" filter="url(#coSmoke)"/>
    <circle cx="176" cy="34" r="8" fill="#e8e0d0" opacity=".4" filter="url(#coSmoke)"/>
    <g transform="translate(0 4)">
      <path d="M40 150 H160 L168 162 L160 174 H40 L32 162 Z" fill="url(#coGold)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    </g>`,
  rad('coBurst', [[0, '#c0501f', 0.95], [0.6, '#6b1f12', 0.75], [1, '#1f0805', 0]])
  + lin('coSteel', [[0, '#eef2f6'], [0.5, '#8a96a3'], [1, '#3a4450']])
  + lin('coCyl', [[0, '#d0d8e0'], [0.5, '#6f7c8a'], [1, '#2e3640']], 1, 0)
  + lin('coGrip', [[0, '#fffdf2'], [0.5, '#e6dcc4'], [1, '#a8987a']], 1, 1)
  + lin('coGold', [[0, '#fff1b0'], [0.5, '#f2b632'], [1, '#b0700f']])
  + glow('coSmoke', 4));

  // ---------- Плакат «Розыск» (скаттер) ----------
  const wanted = svg(`
    <circle cx="100" cy="100" r="86" fill="#ffd36b" opacity=".35" filter="url(#waGlow)"/>
    <path d="M30 18 L170 14 L176 182 L26 186 Z" fill="url(#waPaper)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>
    <path d="M30 18 L46 30 L36 48 L52 60 L40 80" fill="none" stroke="#8a6a3a" stroke-width="2" opacity=".6"/>
    <path d="M44 56 H156 M44 146 H156" stroke="#5a3014" stroke-width="3"/>
    <rect x="58" y="64" width="84" height="76" fill="#e8d3a2" stroke="#5a3014" stroke-width="3"/>
    <path d="M100 76 C116 76 124 88 123 100 C122 108 118 112 116 116 L115 124 C115 128 111 130 107 130 H93 C89 130 85 128 85 124 L84 116 C82 112 78 108 77 100 C76 88 84 76 100 76 Z" fill="#5a3014"/>
    <path d="M70 84 C78 86 122 86 130 84 C128 78 120 78 114 79 L86 79 C80 78 72 78 70 84 Z" fill="#3a1a08"/>
    <path d="M86 79 C86 70 92 62 100 62 C108 62 114 70 114 79 Z" fill="#3a1a08"/>
    <circle cx="92" cy="104" r="5" fill="#e8d3a2"/><circle cx="108" cy="104" r="5" fill="#e8d3a2"/>
    <circle cx="150" cy="40" r="6" fill="#2a1408"/><circle cx="150" cy="40" r="9" fill="none" stroke="#2a1408" stroke-width="1.5" stroke-dasharray="3 3"/>
    <circle cx="52" cy="160" r="5" fill="#2a1408"/>
    <circle cx="38" cy="28" r="5" fill="#9aa3ad" stroke="${INK}" stroke-width="2"/><circle cx="162" cy="24" r="5" fill="#9aa3ad" stroke="${INK}" stroke-width="2"/>`,
  lin('waPaper', [[0, '#fbeccb'], [0.6, '#e8cf96'], [1, '#c9a462']], 1, 1) + glow('waGlow', 10));

  // Дыра от пули — поверх клетки, куда попал выстрел в дуэли.
  const bulletHole = svg(`
    ${Array.from({ length: 9 }, (_, i) => {
    const a = (i * Math.PI * 2) / 9 + 0.3;
    const r = 34 + (i % 3) * 10;
    return `<path d="M100 100 L${(100 + Math.cos(a) * r).toFixed(1)} ${(100 + Math.sin(a) * r).toFixed(1)}" stroke="#fff" stroke-opacity=".7" stroke-width="2"/>`;
  }).join('')}
    <circle cx="100" cy="100" r="16" fill="#120804" stroke="#5a3014" stroke-width="4"/>
    <circle cx="96" cy="96" r="4" fill="#3a2010"/>`);

  const SYMBOL_SVG = { horseshoe, whiskey, hat, boot, vulture, skull: bullskull, barman, sheriff, colt, wanted };
  const EXTRA_SVG = { bulletHole };

  function render(svgText, px) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = px;
        cv.height = px;
        cv.getContext('2d').drawImage(img, 0, 0, px, px);
        resolve(cv);
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });
  }

  const api = { SYMBOL_SVG, EXTRA_SVG, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SaloonArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
