const test = require('node:test');
const assert = require('node:assert/strict');
const { createSongRequests, bestMatch, normalize, COOLDOWN_MS } = require('../server/requests');

const PLAYLIST = [
  'Arthur Pirozhkov #Alkogolichka', 'Arthur Pirozhkov #Kakchelentano', 'Arthur Pirozhkov Chika',
  'Arthur Pirozhkov Zacepila', 'Arthur Pirozhkov Zaputalsja', 'Артур Пирожков Девочка Хочет',
  'Артур Пирожков Само Собой', 'Костюшкин Стас Женщина, Я Не Танцую',
].map((title) => ({ id: `${title}.mp3`, title }));

const find = (text) => (bestMatch(text, PLAYLIST) || {}).title || null;

test('нормализация: кириллица и латиница сходятся', () => {
  assert.equal(normalize('Запутался'), normalize('Zaputalsja'));
  assert.equal(normalize('Zaputalsya'), normalize('Zaputalsja'));
  assert.equal(normalize('Хочет'), normalize('Khochet'));
});

test('поиск трека по тому, как пишут игроки', () => {
  assert.equal(find('зацепила'), 'Arthur Pirozhkov Zacepila');
  assert.equal(find('Включи ЗАЦЕПИЛА пж'), 'Arthur Pirozhkov Zacepila');
  assert.equal(find('пирожков запутался'), 'Arthur Pirozhkov Zaputalsja');
  assert.equal(find('как челентано'), 'Arthur Pirozhkov #Kakchelentano');
  assert.equal(find('алкоголичку'), 'Arthur Pirozhkov #Alkogolichka');
  assert.equal(find('чика'), 'Arthur Pirozhkov Chika');
  assert.equal(find('девочка хочет'), 'Артур Пирожков Девочка Хочет');
  assert.equal(find('само собой'), 'Артур Пирожков Само Собой');
  assert.equal(find('женщина я не танцую'), 'Костюшкин Стас Женщина, Я Не Танцую');
  assert.equal(find('Пирожков'), null, 'только исполнитель: непонятно, что включать');
  assert.equal(find('руки вверх крошка моя'), null);
});

function setup() {
  let t = 0;
  const played = [];
  const r = createSongRequests({
    playlist: () => PLAYLIST,
    play: (id) => {
      const song = PLAYLIST.find((s) => s.id === id);
      if (!song) return { error: 'нет' };
      played.push(song.title);
      return { ok: true, track: { id, title: song.title } };
    },
    now: () => t,
  });
  return { r, played, tick: (ms) => { t += ms; } };
}

const ann = { id: '1', name: 'Аня' };
const borya = { id: '2', name: 'Боря' };

test('заказ, подтверждение: играет сразу, заказ уходит из списка', () => {
  const { r, played } = setup();
  const res = r.request(ann, { text: 'зацепила' });
  assert.equal(res.track.title, 'Arthur Pirozhkov Zacepila');
  assert.equal(r.list().length, 1);
  assert.equal(r.list()[0].trackTitle, 'Arthur Pirozhkov Zacepila');
  const ok = r.approve(res.request.id);
  assert.equal(ok.track.title, 'Arthur Pirozhkov Zacepila');
  assert.deepEqual(played, ['Arthur Pirozhkov Zacepila']);
  assert.equal(r.list().length, 0);
  assert.ok(r.approve(res.request.id).error, 'второй раз не включить');
});

test('выбор из списка, ручная замена трека, отклонение', () => {
  const { r, played } = setup();
  const a = r.request(ann, { trackId: 'Arthur Pirozhkov Chika.mp3' });
  assert.equal(a.request.text, 'Arthur Pirozhkov Chika');
  assert.ok(r.request(borya, { trackId: '../../data/players.json' }).error);
  const b = r.request(borya, { text: 'что-нибудь весёлое' });
  assert.equal(b.track, null);
  assert.match(r.approve(b.request.id).error, /вручную/);
  assert.ok(r.approve(b.request.id, 'Arthur Pirozhkov Zaputalsja.mp3').ok);
  assert.ok(r.reject(a.request.id).ok);
  assert.deepEqual(played, ['Arthur Pirozhkov Zaputalsja']);
  assert.equal(r.list().length, 0);
});

test('антиспам: один заказ в ожидании и пауза между заказами', () => {
  const { r, tick } = setup();
  const a = r.request(ann, { text: 'чика' });
  assert.match(r.request(ann, { text: 'зацепила' }).error, /уже ждёт/);
  r.reject(a.request.id);
  assert.match(r.request(ann, { text: 'зацепила' }).error, /через/);
  tick(COOLDOWN_MS);
  assert.ok(r.request(ann, { text: 'зацепила' }).ok);
  assert.ok(r.request(borya, { text: '' }).error);
  assert.ok(r.request(borya, { text: 42 }).error);
});
