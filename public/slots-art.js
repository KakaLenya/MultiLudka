// Общее для графики слотов: загрузка картинок (текстуры) и размытие символа на скорости барабана.
// window.SlotArt.
(function (root) {
  'use strict';

  const cache = new Map();
  function loadImage(src) {
    if (!cache.has(src)) {
      cache.set(src, new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }));
    }
    return cache.get(src);
  }

  // Размытая по вертикали копия — для быстро крутящихся барабанов.
  function motionBlur(src) {
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const c = cv.getContext('2d');
    const step = src.height * 0.05;
    for (let i = -3; i <= 3; i++) {
      c.globalAlpha = 0.22 - Math.abs(i) * 0.04;
      c.drawImage(src, 0, i * step);
    }
    return cv;
  }

  root.SlotArt = { loadImage, motionBlur };
})(window);
