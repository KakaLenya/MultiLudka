// Музыка в зале: админ включает официальный клип с YouTube, у всех онлайн он играет во встроенном плеере.
// Аудио мы не храним и не раздаём: только ID видео с официального канала исполнителя.

// Артур Пирожков, официальный канал «Александр Ревва» (youtube.com/@aleksandrrevva).
// Порядок: по просмотрам на октябрь 2026. Встраивание у всех разрешено (проверено через oEmbed).
const PLAYLIST = [
  { id: '47JI4G-qYmc', title: 'Алкоголичка', views: '449 млн' },
  { id: 'XQYNUwYHV1c', title: 'Зацепила', views: '343 млн' },
  { id: 'LOHDnKI1U8A', title: 'Чика', views: '289 млн' },
  { id: 'sW4srCj0bvY', title: 'туДЫМ-сюДЫМ', views: '68 млн' },
  { id: '2YzJTleWMjQ', title: '#КакЧелентано', views: '54 млн' },
  { id: 'c-eBWR_Mzbo', title: 'Само собой', views: '24 млн' },
  { id: 'snxQS_kPSck', title: 'МЁД (с Хабибом)', views: '22 млн' },
  { id: 'P52H7f0U0GA', title: 'Плачь, детка!', views: '21 млн' },
  { id: 'cDmS8jtkfhI', title: 'Летом на фиесте (с Dieter Bohlen)', views: '10 млн' },
  { id: '0Z6yDbKh2yQ', title: 'Деньги', views: '10 млн' },
  { id: 'g5-ZloV9D-U', title: 'Пэрэдайс', views: '9 млн' },
  { id: 'PhkoFTV8Ji4', title: 'Я - звезда', views: '8 млн' },
  { id: 'R87RfdlyxdM', title: 'Делай всё', views: '5 млн' },
  { id: 'sCofwWgAKtA', title: 'Я твой мужчина', views: '5 млн' },
  { id: 'd2BtdKiY6d8', title: 'Любовь', views: '4 млн' },
  { id: 'QAhujNoB7ds', title: 'Запутался', views: '4 млн' },
  { id: 'zQAKtKhms4o', title: 'Перетанцуй меня', views: '3 млн' },
];

const ARTIST = 'Артур Пирожков';

// onChange(track | null): разослать всем.
function createMusic({ onChange = () => {}, now = Date.now } = {}) {
  let current = null;  // { id, title, artist, startedAt }

  // Что играет сейчас: offset — сколько секунд уже прошло (чтобы зашедшие позже попали в такт).
  function state() {
    if (!current) return null;
    return { ...current, offset: Math.floor((now() - current.startedAt) / 1000) };
  }

  function play(id) {
    const song = id === 'random'
      ? PLAYLIST[Math.floor(Math.random() * PLAYLIST.length)]
      : PLAYLIST.find((s) => s.id === id);
    if (!song) return { error: 'Такой песни нет в списке' };
    current = { id: song.id, title: song.title, artist: ARTIST, startedAt: now() };
    onChange(state());
    return { ok: true, track: state() };
  }

  function stop() {
    current = null;
    onChange(null);
    return { ok: true };
  }

  return { play, stop, state, playlist: () => PLAYLIST };
}

module.exports = { createMusic, PLAYLIST };
