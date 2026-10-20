// «Кракен»: рисунки символов (SVG, 200×200). Рисуются один раз в картинки нужного размера.
// В браузере: window.KrakenArt. Все id градиентов с префиксом символа, чтобы не пересекались.
(function (root) {
  'use strict';

  const INK = '#0d1b2a';      // общий контур
  const svg = (body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs>${defs}</defs>${body}</svg>`;
  const lin = (id, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`;
  const rad = (id, stops, cx = 0.5, cy = 0.5, r = 0.5, fx = cx, fy = cy) => `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}" fx="${fx}" fy="${fy}">${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`;
  const glow = (id, sd = 6) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

  // Медальон для старших символов: кольцо, тёмная вода внутри.
  function medallion(p, ring, water) {
    return {
      defs: lin(`${p}ring`, [[0, ring[0]], [0.5, ring[1]], [1, ring[2]]], 1, 1)
        + rad(`${p}water`, [[0, water[0]], [1, water[1]]], 0.45, 0.35, 0.7),
      back: `<circle cx="100" cy="100" r="92" fill="${INK}"/><circle cx="100" cy="100" r="88" fill="url(#${p}ring)"/>
        <circle cx="100" cy="100" r="76" fill="url(#${p}water)" stroke="${INK}" stroke-width="3"/>`,
      front: `<path d="M38 70 A70 70 0 0 1 120 30" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>`,
    };
  }

  // ---------- Младшие ----------

  const anchor = svg(`
    <g stroke="${INK}" stroke-linejoin="round" stroke-linecap="round">
      <circle cx="100" cy="30" r="17" fill="none" stroke-width="16"/>
      <circle cx="100" cy="30" r="17" fill="none" stroke="url(#anGold)" stroke-width="8"/>
      <path d="M36 112 Q42 172 100 176 Q158 172 164 112" fill="none" stroke-width="26"/>
      <path d="M36 112 Q42 172 100 176 Q158 172 164 112" fill="none" stroke="url(#anSteelH)" stroke-width="16"/>
      <path d="M20 128 L34 82 L58 120 C48 116 36 118 20 128 Z" fill="url(#anSteel)" stroke-width="5"/>
      <path d="M180 128 L166 82 L142 120 C152 116 164 118 180 128 Z" fill="url(#anSteel)" stroke-width="5"/>
      <rect x="88" y="44" width="24" height="132" rx="10" fill="url(#anSteelH)" stroke-width="5"/>
      <circle cx="100" cy="174" r="13" fill="url(#anSteel)" stroke-width="5"/>
      <rect x="50" y="58" width="100" height="18" rx="9" fill="url(#anSteel)" stroke-width="5"/>
      <circle cx="50" cy="67" r="12" fill="url(#anGold)" stroke-width="5"/>
      <circle cx="150" cy="67" r="12" fill="url(#anGold)" stroke-width="5"/>
    </g>
    ${[90, 104, 118, 132].map((y) => `<path d="M82 ${y} Q100 ${y + 4} 118 ${y + 10}" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M82 ${y} Q100 ${y + 4} 118 ${y + 10}" fill="none" stroke="url(#anRope)" stroke-width="7" stroke-linecap="round"/>`).join('')}
    <path d="M118 142 C130 150 126 162 136 168" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>
    <path d="M118 142 C130 150 126 162 136 168" fill="none" stroke="url(#anRope)" stroke-width="6" stroke-linecap="round"/>
    <rect x="93" y="48" width="5" height="36" rx="2.5" fill="#fff" opacity=".5"/>
    <path d="M58 62 H124" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>
    <path d="M30 92 L40 112" stroke="#fff" stroke-opacity=".5" stroke-width="3" stroke-linecap="round"/>`,
  lin('anSteel', [[0, '#d8eef7'], [0.45, '#77a2b8'], [1, '#2a4658']])
  + lin('anSteelH', [[0, '#a6cadb'], [0.5, '#5b8399'], [1, '#2a4658']], 1, 0)
  + lin('anGold', [[0, '#fff1b0'], [0.5, '#f2b632'], [1, '#9a5d0a']])
  + lin('anRope', [[0, '#e8b77a'], [1, '#8a5524']]));

  const compass = svg(`
    <circle cx="100" cy="20" r="11" fill="none" stroke="${INK}" stroke-width="10"/>
    <circle cx="100" cy="20" r="11" fill="none" stroke="url(#coBrass)" stroke-width="5"/>
    <circle cx="100" cy="106" r="80" fill="url(#coBrass)" stroke="${INK}" stroke-width="5"/>
    <circle cx="100" cy="106" r="66" fill="url(#coFace)" stroke="${INK}" stroke-width="4"/>
    ${Array.from({ length: 32 }, (_, i) => {
    const a = (i * Math.PI) / 16;
    const r1 = i % 4 === 0 ? 52 : 58;
    return `<line x1="${(100 + Math.sin(a) * r1).toFixed(1)}" y1="${(106 - Math.cos(a) * r1).toFixed(1)}" x2="${(100 + Math.sin(a) * 63).toFixed(1)}" y2="${(106 - Math.cos(a) * 63).toFixed(1)}" stroke="#6b4b20" stroke-width="${i % 4 === 0 ? 3 : 1.5}"/>`;
  }).join('')}
    <g stroke="${INK}" stroke-width="2.5" stroke-linejoin="round">
      <path d="M100 66 L108 98 L140 106 L108 114 L100 146 L92 114 L60 106 L92 98 Z" fill="#1f3a5a"/>
      <path d="M100 66 L108 98 L100 106 Z M140 106 L108 114 L100 106 Z M100 146 L92 114 L100 106 Z M60 106 L92 98 L100 106 Z" fill="#e9eef5"/>
      <path d="M100 52 L109 100 L100 106 L91 100 Z" fill="#d6322a"/>
      <path d="M100 160 L91 112 L100 106 L109 112 Z" fill="#f4f1e8"/>
    </g>
    <circle cx="100" cy="106" r="7" fill="url(#coBrass)" stroke="${INK}" stroke-width="3"/>
    <path d="M52 78 A58 58 0 0 1 104 46" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="7" stroke-linecap="round"/>`,
  lin('coBrass', [[0, '#fff0b8'], [0.4, '#e3a93a'], [1, '#7a4a0c']], 1, 1)
  + rad('coFace', [[0, '#fff8e2'], [1, '#d9bd84']]));

  const helm = svg(`<g transform="translate(100 100) scale(.9) translate(-100 -100)">
    ${Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const at = (r) => `${(100 + c * r).toFixed(1)} ${(100 + s * r).toFixed(1)}`;
    return `<path d="M${at(20)} L${at(74)}" stroke="${INK}" stroke-width="15" stroke-linecap="round"/>
      <path d="M${at(20)} L${at(74)}" stroke="url(#heWood)" stroke-width="8" stroke-linecap="round"/>
      <path d="M${at(74)} L${at(94)}" stroke="${INK}" stroke-width="19" stroke-linecap="round"/>
      <path d="M${at(74)} L${at(94)}" stroke="#8a4f22" stroke-width="12" stroke-linecap="round"/>
      <path d="M${at(77)} L${at(90)}" stroke="#d9944f" stroke-width="4" stroke-linecap="round"/>`;
  }).join('')}
    <circle cx="100" cy="100" r="60" fill="none" stroke="${INK}" stroke-width="24"/>
    <circle cx="100" cy="100" r="60" fill="none" stroke="url(#heRim)" stroke-width="16"/>
    <circle cx="100" cy="100" r="60" fill="none" stroke="#3a1f0b" stroke-width="2" stroke-dasharray="3 14"/>
    <path d="M52 70 A60 60 0 0 1 110 41" fill="none" stroke="#ffd9a6" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>
    <circle cx="100" cy="100" r="24" fill="url(#heBrass)" stroke="${INK}" stroke-width="4"/>
    <circle cx="100" cy="100" r="9" fill="#7a4a0c" stroke="${INK}" stroke-width="2.5"/>
    <circle cx="94" cy="93" r="5" fill="#fff" opacity=".6"/></g>`,
  lin('heWood', [[0, '#e3a462'], [1, '#7a3f15']], 1, 1)
  + lin('heRim', [[0, '#d79250'], [0.5, '#9a5524'], [1, '#5c2c0c']], 1, 1)
  + lin('heBrass', [[0, '#fff0b8'], [0.5, '#e3a93a'], [1, '#7a4a0c']], 1, 1));

  const rum = svg(`
    <path d="M84 16 H116 V58 C116 70 150 84 150 112 V170 C150 182 140 188 128 188 H72 C60 188 50 182 50 170 V112 C50 84 84 70 84 58 Z" fill="${INK}"/>
    <path d="M88 20 H112 V60 C112 72 146 86 146 112 V170 C146 179 138 184 128 184 H72 C62 184 54 179 54 170 V112 C54 86 88 72 88 60 Z" fill="url(#ruGlass)"/>
    <path d="M58 132 H142 V170 C142 177 136 180 128 180 H72 C64 180 58 177 58 170 Z" fill="url(#ruLiquid)" opacity=".9"/>
    <rect x="86" y="8" width="28" height="22" rx="5" fill="#a86a32" stroke="${INK}" stroke-width="4"/>
    <path d="M84 26 H116 V34 C116 40 108 38 106 44 C104 38 96 42 94 36 C90 40 84 38 84 34 Z" fill="#c4232b" stroke="${INK}" stroke-width="3"/>
    <path d="M60 104 H140 L136 150 H64 Z" fill="url(#ruLabel)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <text x="100" y="138" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="30" fill="#7a1d12">XXX</text>
    <path d="M68 112 H132" stroke="#7a1d12" stroke-width="2"/>
    <path d="M70 92 C64 110 64 150 68 172" stroke="#fff" stroke-opacity=".5" stroke-width="7" stroke-linecap="round" fill="none"/>
    <path d="M94 26 V60" stroke="#fff" stroke-opacity=".45" stroke-width="4" stroke-linecap="round"/>`,
  lin('ruGlass', [[0, '#5fd08f'], [0.5, '#1e7a4c'], [1, '#0b3d26']], 1, 0)
  + lin('ruLiquid', [[0, '#f0a63a'], [1, '#7a3d08']])
  + lin('ruLabel', [[0, '#fbeccb'], [1, '#d8b77a']]));

  // ---------- Старшие (в медальонах) ----------

  const jellyM = medallion('je', ['#c8fff5', '#2bb7a6', '#0b5a55'], ['#1c4f7a', '#071a33']);
  const jelly = svg(`${jellyM.back}
    <g opacity=".9">
      ${[66, 82, 100, 118, 134].map((x, i) => `<path d="M${x} 112 C${x - 10} 130 ${x + 12} 146 ${x - 4} 168" fill="none" stroke="url(#jeTent)" stroke-width="${i % 2 ? 5 : 7}" stroke-linecap="round"/>`).join('')}
    </g>
    <circle cx="100" cy="88" r="52" fill="#ff7ad9" opacity=".35" filter="url(#jeGlow)"/>
    <path d="M52 108 C48 60 76 40 100 40 C124 40 152 60 148 108 C140 104 134 114 126 108 C118 116 110 106 100 112 C90 106 82 116 74 108 C66 114 60 104 52 108 Z" fill="url(#jeBell)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    <path d="M66 96 C64 70 82 54 100 54" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="6" stroke-linecap="round"/>
    <ellipse cx="86" cy="86" rx="7" ry="9" fill="${INK}"/><ellipse cx="114" cy="86" rx="7" ry="9" fill="${INK}"/>
    <circle cx="88" cy="83" r="2.6" fill="#fff"/><circle cx="116" cy="83" r="2.6" fill="#fff"/>
    <path d="M92 100 Q100 106 108 100" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>
    ${[[76, 64], [124, 66], [100, 50], [134, 92]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" fill="#fff" opacity=".7"/>`).join('')}
    ${jellyM.front}`,
  jellyM.defs + rad('jeBell', [[0, '#ffe3f7'], [0.55, '#ff6fd0'], [1, '#9b1f8a']], 0.4, 0.3, 0.75)
  + lin('jeTent', [[0, '#ff9be3'], [1, '#ff9be3', 0]]) + glow('jeGlow', 9));

  const sharkM = medallion('sh', ['#d6ecff', '#3d8fd6', '#123d6e'], ['#1e5f8f', '#06203b']);
  const shark = svg(`${sharkM.back}
    <g stroke="${INK}" stroke-width="4" stroke-linejoin="round">
      <path d="M92 64 L108 22 L132 64 Z" fill="url(#shSkin)"/>
      <path d="M24 112 C30 82 64 62 108 60 C142 58 170 72 184 94 C178 100 170 103 160 104 L134 112 L174 128 C160 146 110 154 72 148 C46 144 24 130 24 112 Z" fill="url(#shSkin)"/>
      <path d="M160 104 L134 112 L174 128 C176 118 172 108 160 104 Z" fill="#6e0c18"/>
      <path d="M36 124 C62 144 124 148 172 128 C156 146 104 156 68 148 C52 144 40 136 36 124 Z" fill="#f2f6fa" stroke-width="3"/>
      <path d="M86 132 L66 166 L112 138 Z" fill="url(#shSkin)"/>
    </g>
    <path d="M159 105 L155 113 L151 106 L147 115 L143 108 L139 116 L136 111" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M138 114 L143 106 L147 117 L152 109 L156 120 L161 112 L165 123 L169 116 L172 126" fill="#fff" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M42 106 C56 82 88 68 128 68" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>
    <circle cx="150" cy="84" r="9" fill="#fff" stroke="${INK}" stroke-width="3"/>
    <circle cx="152" cy="85" r="5" fill="${INK}"/>
    <path d="M136 72 L162 80" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    ${[100, 110, 120].map((x) => `<path d="M${x} 86 q-5 12 0 24" fill="none" stroke="#1a3550" stroke-width="3" stroke-linecap="round"/>`).join('')}
    ${sharkM.front}`,
  sharkM.defs + lin('shSkin', [[0, '#c4dcec'], [0.55, '#5f87a8'], [1, '#2b4a66']]));

  const anglerM = medallion('ag', ['#ead6ff', '#8b55d6', '#3a1670'], ['#211245', '#05030f']);
  const angler = svg(`${anglerM.back}
    <circle cx="150" cy="54" r="26" fill="#fff6a8" opacity=".55" filter="url(#agGlow)"/>
    <path d="M86 70 C92 40 128 26 150 46" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>
    <path d="M86 70 C92 40 128 26 150 46" fill="none" stroke="#7d5a8f" stroke-width="4" stroke-linecap="round"/>
    <circle cx="152" cy="52" r="11" fill="url(#agLure)" stroke="${INK}" stroke-width="3"/>
    <g stroke="${INK}" stroke-width="4" stroke-linejoin="round">
      <path d="M36 112 L22 90 L22 140 Z" fill="#5b3a78"/>
      <path d="M40 112 C40 78 70 62 104 64 C140 66 166 90 166 118 C166 150 138 170 102 170 C66 170 40 148 40 112 Z" fill="url(#agSkin)"/>
      <path d="M86 124 C104 108 146 106 164 118 C160 146 134 160 106 158 C94 150 88 138 86 124 Z" fill="#2a0a1e"/>
    </g>
    <path d="M90 124 L96 136 L101 121 L107 137 L113 119 L119 136 L125 118 L131 134 L137 117 L143 132 L149 118 L155 130 L160 120" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <path d="M100 156 L104 146 L110 157 L116 145 L122 156 L128 144 L134 154 L140 143 L146 151" fill="#fff" stroke="${INK}" stroke-width="2"/>
    <circle cx="94" cy="96" r="15" fill="#fffbe6" stroke="${INK}" stroke-width="4"/>
    <circle cx="97" cy="98" r="5" fill="${INK}"/>
    <path d="M74 80 L110 86" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
    <path d="M56 104 C58 88 70 78 86 74" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>
    ${anglerM.front}`,
  anglerM.defs + rad('agSkin', [[0, '#9a6cb8'], [0.7, '#4b2a66'], [1, '#26123a']], 0.4, 0.35, 0.7)
  + rad('agLure', [[0, '#ffffff'], [0.5, '#fff27a'], [1, '#f2a91f']]) + glow('agGlow', 8));

  const shipM = medallion('sp', ['#fff1b0', '#e8a92c', '#7a4a0c'], ['#4fa6d6', '#0b2f56']);
  const ship = svg(`${shipM.back}
    <clipPath id="spClip"><circle cx="100" cy="100" r="75"/></clipPath>
    <g clip-path="url(#spClip)">
      <circle cx="60" cy="58" r="16" fill="#fff4c4" opacity=".8"/>
      <g stroke="${INK}" stroke-width="3" stroke-linejoin="round">
        <path d="M70 120 V36 M104 124 V24 M136 120 V46" stroke-width="5"/>
        <path d="M50 46 C68 52 70 70 70 86 C76 72 88 66 90 48 Z" fill="url(#spSail)"/>
        <path d="M80 34 C102 40 104 66 104 92 C110 70 128 62 128 34 Z" fill="url(#spSail)"/>
        <path d="M118 54 C134 58 136 74 136 90 C142 76 154 70 154 54 Z" fill="url(#spSail)"/>
        <path d="M104 24 L126 30 L104 36 Z" fill="#c4232b"/>
        <path d="M36 112 L164 108 L154 142 C130 150 76 150 48 142 Z" fill="url(#spHull)"/>
        <path d="M44 122 L160 118" stroke="#f2c14e" stroke-width="3"/>
        <path d="M150 108 L176 96 L174 104 Z" fill="#7a3f15"/>
      </g>
      <circle cx="104" cy="62" r="9" fill="#f4f1e8"/>
      <path d="M99 60 h3 M106 60 h3" stroke="${INK}" stroke-width="3"/>
      <path d="M96 74 L112 66 M96 66 L112 74" stroke="#f4f1e8" stroke-width="3" stroke-linecap="round"/>
      ${[64, 84, 104, 124, 144].map((x) => `<circle cx="${x}" cy="130" r="3.5" fill="${INK}"/>`).join('')}
      <path d="M20 146 C40 136 56 152 76 142 C96 132 112 152 132 142 C152 132 168 150 188 140 V190 H20 Z" fill="url(#spSea)" stroke="${INK}" stroke-width="3"/>
      <path d="M30 150 C44 144 54 154 68 148 M96 148 C108 142 120 154 134 148 M150 150 C160 144 170 152 182 146" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
    </g>
    ${shipM.front}`,
  shipM.defs + lin('spSail', [[0, '#5a5a66'], [1, '#15151d']], 1, 1)
  + lin('spHull', [[0, '#b0703a'], [1, '#4e2408']])
  + lin('spSea', [[0, '#2f9bd6'], [1, '#0a3c6e']]));

  // ---------- Кракен (вайлд) ----------

  const sucker = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#ffc2b8" stroke="${INK}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="${(r * 0.45).toFixed(1)}" fill="#e0727e"/>`;
  const wild = svg(`
    <circle cx="100" cy="96" r="92" fill="url(#wiBurst)"/>
    ${Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8;
    const p = (r, d) => `${(100 + Math.cos(a + d) * r).toFixed(1)} ${(96 + Math.sin(a + d) * r).toFixed(1)}`;
    return `<path d="M${p(30, -0.08)} L${p(96, 0)} L${p(30, 0.08)} Z" fill="#ffd36b" opacity=".18"/>`;
  }).join('')}
    <g stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
      <path d="M58 120 C30 126 14 150 24 172 C30 184 46 182 46 170 C46 160 36 162 38 154 C42 140 60 140 72 132 Z" fill="url(#wiSkin)"/>
      <path d="M142 120 C170 126 186 150 176 172 C170 184 154 182 154 170 C154 160 164 162 162 154 C158 140 140 140 128 132 Z" fill="url(#wiSkin)"/>
      <path d="M78 136 C70 160 74 182 92 186 C102 188 104 176 96 172 C88 166 92 152 96 140 Z" fill="url(#wiSkin)"/>
      <path d="M122 136 C130 160 126 182 108 186 C98 188 96 176 104 172 C112 166 108 152 104 140 Z" fill="url(#wiSkin)"/>
      <path d="M46 110 C20 100 8 76 22 62 C30 54 42 60 38 70 C34 80 46 86 56 92 Z" fill="url(#wiSkin)"/>
      <path d="M154 110 C180 100 192 76 178 62 C170 54 158 60 162 70 C166 80 154 86 144 92 Z" fill="url(#wiSkin)"/>
      <path d="M100 18 C146 18 160 56 156 92 C152 122 130 140 100 140 C70 140 48 122 44 92 C40 56 54 18 100 18 Z" fill="url(#wiHead)"/>
    </g>
    ${sucker(30, 164, 4)}${sucker(170, 164, 4)}${sucker(40, 152, 3.5)}${sucker(160, 152, 3.5)}${sucker(88, 176, 3.5)}${sucker(112, 176, 3.5)}${sucker(26, 72, 3.5)}${sucker(174, 72, 3.5)}
    <path d="M66 46 C74 30 92 24 108 26" fill="none" stroke="#ffd0e0" stroke-opacity=".6" stroke-width="7" stroke-linecap="round"/>
    ${[[80, 40], [126, 44], [138, 62], [62, 66]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="#ff8fa8" opacity=".55"/>`).join('')}
    <g stroke="${INK}" stroke-width="4">
      <ellipse cx="78" cy="88" rx="16" ry="14" fill="url(#wiEye)"/>
      <ellipse cx="122" cy="88" rx="16" ry="14" fill="url(#wiEye)"/>
    </g>
    <ellipse cx="78" cy="89" rx="3.5" ry="11" fill="${INK}"/><ellipse cx="122" cy="89" rx="3.5" ry="11" fill="${INK}"/>
    <circle cx="73" cy="83" r="3" fill="#fff"/><circle cx="117" cy="83" r="3" fill="#fff"/>
    <path d="M58 72 L94 80 M142 72 L106 80" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>
    <path d="M84 116 C92 110 108 110 116 116" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
    <g transform="translate(0 4)">
      <path d="M40 150 H160 L168 162 L160 174 H40 L32 162 Z" fill="url(#wiGold)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    </g>`,
  rad('wiBurst', [[0, '#7a1650', 0.95], [0.6, '#3b0b3a', 0.75], [1, '#14051c', 0]])
  + rad('wiHead', [[0, '#ff7a8c'], [0.55, '#c0234a'], [1, '#5a0a2c']], 0.4, 0.3, 0.75)
  + lin('wiSkin', [[0, '#e8475f'], [1, '#6e0f33']])
  + rad('wiEye', [[0, '#fffbd0'], [0.6, '#ffd23a'], [1, '#e08a00']])
  + lin('wiGold', [[0, '#fff1b0'], [0.5, '#f2b632'], [1, '#b0700f']]));

  // ---------- Карта сокровищ (скаттер) ----------

  const map = svg(`
    <circle cx="100" cy="100" r="84" fill="#ffd36b" opacity=".35" filter="url(#mpGlow)"/>
    <g stroke="${INK}" stroke-width="4" stroke-linejoin="round">
      <path d="M30 40 C60 30 140 50 170 40 L170 156 C140 166 60 146 30 156 Z" fill="url(#mpPaper)"/>
      <path d="M24 34 C24 26 36 26 36 34 L36 162 C36 170 24 170 24 162 Z" fill="#c99a5a"/>
      <path d="M164 34 C164 26 176 26 176 34 L176 162 C176 170 164 170 164 162 Z" fill="#c99a5a"/>
    </g>
    <path d="M52 70 C60 60 76 62 78 72 C82 84 66 92 58 86 C50 82 48 76 52 70 Z" fill="#8fbf6a" stroke="#6b4b20" stroke-width="2"/>
    <path d="M120 112 C132 100 150 108 148 122 C146 134 128 138 120 130 C114 124 116 116 120 112 Z" fill="#8fbf6a" stroke="#6b4b20" stroke-width="2"/>
    <path d="M64 80 C80 110 96 70 112 96 C122 112 126 116 132 118" fill="none" stroke="#a0281e" stroke-width="4" stroke-dasharray="7 6" stroke-linecap="round"/>
    <path d="M124 110 L144 130 M144 110 L124 130" stroke="#c4232b" stroke-width="8" stroke-linecap="round"/>
    <path d="M124 110 L144 130 M144 110 L124 130" stroke="#ff6b5e" stroke-width="3" stroke-linecap="round"/>
    <g transform="translate(150 66)"><circle r="12" fill="none" stroke="#6b4b20" stroke-width="2"/><path d="M0 -14 L3 0 L0 14 L-3 0 Z M-14 0 L0 3 L14 0 L0 -3 Z" fill="#6b4b20"/></g>
    <g transform="translate(0 6)">
      <path d="M36 150 H164 L172 162 L164 174 H36 L28 162 Z" fill="url(#mpRed)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
    </g>`,
  lin('mpPaper', [[0, '#fbebc4'], [0.6, '#e8cf96'], [1, '#c9a462']], 1, 1)
  + lin('mpRed', [[0, '#ff6b5e'], [1, '#8a1410']]) + glow('mpGlow', 10));

  // ---------- Жемчужины ----------
  // tone: white | gold | black | mini | minor | major | grand | kraken. Число рисует слот поверх.
  const PEARL_TONES = {
    white: ['#ffffff', '#e8eef7', '#9fb0c8'],
    gold: ['#fffbe0', '#ffd45c', '#b07a10'],
    black: ['#9aa7ff', '#3b2f6b', '#0e0a22'],
    mini: ['#e8fff0', '#5fd68a', '#1d7a43'],
    minor: ['#e6f2ff', '#5aa8ff', '#1a4f9c'],
    major: ['#ffe6e6', '#ff5a5a', '#8a1414'],
    grand: ['#fffbe0', '#ffd45c', '#b07a10'],
    kraken: ['#ffd6f2', '#c03aa6', '#4a0a44'],
  };
  function pearl(tone) {
    const [hi, mid, lo] = PEARL_TONES[tone];
    const p = `pe${tone}`;
    const kraken = tone === 'kraken';
    // Раскрытая раковина: верхняя створка за жемчужиной, нижняя — перед ней.
    const back = kraken ? '' : `<path d="M26 112 C20 52 64 22 100 22 C136 22 180 52 174 112 C140 100 60 100 26 112 Z" fill="url(#${p}shellB)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
      ${[34, 52, 74, 100, 126, 148, 166].map((x) => `<path d="M100 104 Q${(100 + x) / 2} 64 ${x} ${x === 100 ? 26 : 40 + Math.abs(100 - x) / 2}" fill="none" stroke="#c97b70" stroke-width="2.5" opacity=".7"/>`).join('')}`;
    const front = kraken
      ? `<path d="M40 128 C30 158 56 184 100 184 C144 184 170 158 160 128 Z" fill="url(#${p}skin)" stroke="${INK}" stroke-width="4"/>
         ${sucker(62, 156, 5)}${sucker(84, 166, 5)}${sucker(116, 166, 5)}${sucker(138, 156, 5)}`
      : `<path d="M22 122 C24 160 60 186 100 186 C140 186 176 160 178 122 C150 134 50 134 22 122 Z" fill="url(#${p}shell)" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
         ${[40, 58, 78, 100, 122, 142, 160].map((x) => `<path d="M100 182 Q${(100 + x) / 2} 156 ${x} 132" fill="none" stroke="#c96f6f" stroke-width="2.5" opacity=".7"/>`).join('')}`;
    const curl = kraken
      ? `<path d="M56 66 C34 90 52 124 78 114 C92 108 88 94 78 98" fill="none" stroke="${INK}" stroke-width="11" stroke-linecap="round"/>
         <path d="M56 66 C34 90 52 124 78 114 C92 108 88 94 78 98" fill="none" stroke="#e8475f" stroke-width="6" stroke-linecap="round"/>`
      : '';
    return svg(`
      <circle cx="100" cy="100" r="76" fill="${mid}" opacity=".35" filter="url(#${p}glow)"/>
      ${back}
      <circle cx="100" cy="100" r="56" fill="url(#${p}pearl)" stroke="${INK}" stroke-width="4"/>
      <ellipse cx="80" cy="78" rx="19" ry="12" fill="#fff" opacity=".8" transform="rotate(-25 80 78)"/>
      <circle cx="128" cy="124" r="5" fill="#fff" opacity=".45"/>
      ${front}
      ${curl}`,
    rad(`${p}pearl`, [[0, hi], [0.55, mid], [1, lo]], 0.38, 0.32, 0.75)
    + lin(`${p}shell`, [[0, '#ffd8cc'], [1, '#d9786a']])
    + lin(`${p}shellB`, [[0, '#ffe6dc'], [1, '#e89a8c']])
    + lin(`${p}skin`, [[0, '#e8475f'], [1, '#6e0f33']])
    + glow(`${p}glow`, 10));
  }

  const SYMBOL_SVG = { anchor, compass, helm, rum, jelly, shark, angler, ship, wild, map };
  const PEARL_SVG = Object.fromEntries(Object.keys(PEARL_TONES).map((t) => [t, pearl(t)]));

  // Картинка символа заданного размера (в пикселях): Promise<HTMLCanvasElement>.
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

  const api = { SYMBOL_SVG, PEARL_SVG, PEARL_TONES, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KrakenArt = api;
})(typeof window !== 'undefined' ? window : globalThis);
