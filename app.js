// Pantau web — UI. Core API in core.js (port of the Mac app's PantauCore).
import { JFClient, PUBLIC_KEYS, CloudStore, eventLabel } from './core.js?v=1';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('pantau.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem('pantau.' + k) : localStorage.setItem('pantau.' + k, JSON.stringify(v)); } catch {} },
};

const ICON = {
  cam: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h9A2.5 2.5 0 0 1 17 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 16.5z"/><path d="m17 10 4-2.5v9L17 14"/>',
  grid: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  vol: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 6M22 9l-5 6"/>',
  shot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  rec: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  dl: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  light: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  prev: '<path d="m15 5-7 7 7 7"/>', next: '<path d="m9 5 7 7-7 7"/>',
};
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${ICON[n] || ''}</svg>`;

// ---------- state ----------

const S = {
  session: store.get('session'), // {account, token, keys}
  devices: store.get('devices', []),
  status: {},
  thumbs: store.get('thumbs', {}),
  view: 'cams',
  liveSn: null,
};
let api = new JFClient(S.session?.keys || PUBLIC_KEYS, S.session?.token || null);

function applyTheme() {
  const t = store.get('theme', 'auto');
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}
applyTheme();

let toastTimer;
function toast(msg, ms = 3200) {
  let el = $('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast glass'; document.body.append(el); }
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function handleErr(e) {
  console.warn(e);
  if ([4100, 4101, 4118].includes(e?.code)) { logout(true); toast('Sesi berakhir, silakan masuk lagi'); return; }
  toast(e?.message || String(e));
}

function devBySn(sn) { return S.devices.find(d => d.sn === sn); }

// ---------- routing ----------

const VIEWS = [
  ['cams', 'Kamera', 'cam'], ['multi', 'Multi Layar', 'grid'], ['pesan', 'Pesan', 'bell'], ['klip', 'Klip Gerak', 'film'], ['saya', 'Saya', 'user'],
];

function go(view, sn) {
  const hash = sn ? `#${view}/${sn}` : `#${view}`;
  if (location.hash !== hash) location.hash = hash; else route();
}

function route() {
  const [view, sn] = location.hash.slice(1).split('/');
  stopAllPlayers();
  if (!S.session) { renderLogin(); return; }
  S.view = VIEWS.some(v => v[0] === view) || view === 'live' ? view : 'cams';
  S.liveSn = sn || null;
  renderShell();
}
window.addEventListener('hashchange', route);

function renderShell() {
  const nav = cls => VIEWS.map(([k, label, icon]) =>
    `<button class="nav ${S.view === k || (S.view === 'live' && k === 'cams') ? 'active' : ''}" data-go="${k}">${ic(icon)}<span>${label}</span></button>`).join('');
  $('#root').innerHTML = `
    <div class="app">
      <aside class="side"><div class="glass">
        <div class="brand"><img src="icon-192.png" alt="">Pantau</div>
        ${nav()}
        <div class="foot">${esc(S.session.account)}</div>
      </div></aside>
      <main id="main"></main>
    </div>
    <nav class="tabbar glass">${nav()}</nav>`;
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  ({ cams: viewCams, live: viewLive, multi: viewMulti, pesan: viewPesan, klip: viewKlip, saya: viewSaya })[S.view]();
}

// ---------- login ----------

function renderLogin() {
  const keys = store.get('keys') || PUBLIC_KEYS;
  $('#root').innerHTML = `
    <div class="login"><form class="card glass" id="lf" autocomplete="on">
      <div class="logo"><img src="icon-192.png" alt=""><h2>Pantau</h2>
        <div class="muted small">Masuk dengan akun iCSee / XMeye yang sama.<br>Kata sandi dikirim terenkripsi langsung ke cloud iCSee.</div></div>
      <label class="field"><span>Akun (email / nama pengguna / no. HP)</span>
        <input class="input" name="account" autocomplete="username" required value="${esc(store.get('lastAccount', ''))}"></label>
      <label class="field"><span>Kata sandi</span>
        <input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div class="err" id="lerr"></div>
      <button class="btn primary" id="lbtn">Masuk</button>
      <details><summary>Kunci platform (lanjutan)</summary>
        <div style="display:grid;gap:8px;margin-top:10px">
          <input class="input" name="uuid" placeholder="UUID" value="${esc(keys.uuid)}">
          <input class="input" name="appKey" placeholder="AppKey" value="${esc(keys.appKey)}">
          <input class="input" name="appSecret" placeholder="AppSecret" value="${esc(keys.appSecret)}">
          <input class="input" name="movedCard" placeholder="MovedCard" inputmode="numeric" value="${esc(keys.movedCard)}">
          <div class="muted small">Bawaan = kunci demo publik JFTech. Kunci gratis sendiri: aops.jftech.com</div>
        </div></details>
    </form></div>`;
  $('#lf').onsubmit = async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const keys = { uuid: f.get('uuid').trim(), appKey: f.get('appKey').trim(), appSecret: f.get('appSecret').trim(), movedCard: Number(f.get('movedCard')) || 2 };
    const account = f.get('account').trim();
    $('#lbtn').disabled = true; $('#lerr').textContent = '';
    try {
      api = new JFClient(keys);
      const token = await api.login(account, f.get('password'));
      S.session = { account, token, keys };
      store.set('session', S.session); store.set('lastAccount', account); store.set('keys', keys);
      S.devices = await api.devices();
      store.set('devices', S.devices);
      go('cams');
    } catch (e) {
      $('#lerr').textContent = e?.message || 'Gagal masuk';
    } finally { const b = $('#lbtn'); if (b) b.disabled = false; }
  };
}

async function logout(silent) {
  if (!silent) await api.logout();
  S.session = null; S.devices = []; S.thumbs = {};
  store.set('session', null); store.set('devices', null); store.set('thumbs', null);
  api = new JFClient(store.get('keys') || PUBLIC_KEYS);
  location.hash = '';
  route();
}

// ---------- cameras ----------

async function refreshDevices() {
  try {
    S.devices = await api.devices();
    store.set('devices', S.devices);
  } catch (e) { handleErr(e); }
  S.status = await api.status(S.devices);
}

function camCard(d) {
  const st = S.status[d.sn] || 'unknown';
  const label = { online: 'Online', sleeping: 'Tidur', offline: 'Offline', unknown: '…' }[st];
  return `<button class="cam glass" data-sn="${esc(d.sn)}">
    <div class="thumb">${S.thumbs[d.sn] ? `<img src="${S.thumbs[d.sn]}" alt="">` : ic('cam')}
      <span class="badge"><i class="dot ${st}"></i>${label}</span></div>
    <div class="meta"><div><b>${esc(d.name)}</b><div class="sn">${esc(d.sn)}</div></div><span class="spacer"></span>${ic('right')}</div>
  </button>`;
}

async function viewCams() {
  const main = $('#main');
  const draw = () => {
    main.innerHTML = `
      <div class="top"><h1>Kamera</h1><span class="spacer"></span>
        <button class="btn" id="rf">${ic('refresh')}<span>Segarkan</span></button></div>
      ${S.devices.length ? `<div class="grid">${S.devices.map(camCard).join('')}</div>` : '<div class="empty glass">Memuat kamera…</div>'}`;
    main.querySelectorAll('.cam').forEach(c => c.onclick = () => go('live', c.dataset.sn));
    $('#rf').onclick = () => { S.thumbs = {}; load(true); };
  };
  const load = async (thumbs) => {
    draw();
    await refreshDevices();
    if (S.view !== 'cams') return;
    draw();
    for (const d of S.devices) {
      if (!thumbs && S.thumbs[d.sn]) continue;
      if (S.status[d.sn] && S.status[d.sn] !== 'online') continue;
      api.capture(d).then(blob => blobToDataURL(blob)).then(url => {
        S.thumbs[d.sn] = url; store.set('thumbs', S.thumbs);
        if (S.view === 'cams') draw();
      }).catch(() => {});
    }
  };
  load(false);
}

const blobToDataURL = blob => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(blob); });

// ---------- player ----------

const players = new Set();
function stopAllPlayers() { for (const p of [...players]) p.stop(); }

function hevcMSE() {
  const MS = window.ManagedMediaSource || window.MediaSource;
  if (!MS?.isTypeSupported) return false;
  return ['hvc1.1.6.L120.90', 'hev1.1.6.L120.90', 'hvc1.1.6.L93.B0'].some(c => MS.isTypeSupported(`video/mp4; codecs="${c}"`));
}

/** Live view for one camera. FLV (native H.265, ~2 s behind) when the browser can decode HEVC, else relay HLS (H.264, 7–9 s). */
class LivePlayer {
  constructor(video, dev, { stream = '1', muted = true, onState = () => {} } = {}) {
    this.video = video; this.dev = dev; this.stream = stream; this.muted = muted; this.onState = onState;
    this.fails = 0; this.mode = store.get('mode', 'auto') === 'hls' || !hevcMSE() || !window.mpegts ? 'hls' : 'flv';
    video.muted = muted; video.playsInline = true; video.crossOrigin = 'anonymous';
    this.onReady = () => this.kick();
    video.addEventListener('loadeddata', this.onReady);
    video.addEventListener('canplay', this.onReady);
    players.add(this);
  }

  /** Starts / resumes playback. Safari rejects play() issued before the stream has data (and never retries it),
   *  so this runs again when data arrives and from the watchdog. A real autoplay block asks for a tap. */
  kick() {
    const v = this.video;
    if (this.stopped || !v.paused || v.readyState < 2) return;
    v.play().then(() => { if (this.blocked) { this.blocked = false; autoplayHint(); } }).catch(e => {
      if (e?.name === 'NotAllowedError' && !this.stopped) { this.blocked = true; autoplayHint(); }
    });
  }

  /** Jump to the live edge when playback has fallen behind (tab in background, slow decode, stalls). */
  toEdge() {
    const v = this.video;
    if (!v.buffered.length) return;
    const end = v.buffered.end(v.buffered.length - 1);
    const max = this.mode === 'flv' ? 1.5 : 5, keep = this.mode === 'flv' ? 0.3 : 1.5;
    if (end - v.currentTime > max) v.currentTime = end - keep;
  }

  async start() {
    this.teardown();
    this.stopped = false;
    const gen = this.gen = (this.gen || 0) + 1;
    this.onState('connect', this.mode === 'flv' ? 'Menyambung (cepat)…' : 'Menyambung…');
    try {
      if (S.status[this.dev.sn] === 'sleeping') { try { await api.wakeUp(this.dev); } catch {} }
      const url = await api.liveURL(this.dev, this.mode === 'flv'
        ? { stream: this.stream, protocol: 'flv' }
        : { stream: this.stream, protocol: 'hls-ts', videoCode: 'h264' });
      if (gen !== this.gen || this.stopped) return;
      this.mode === 'flv' ? this.playFLV(url) : this.playHLS(url);
      this.watch(gen);
    } catch (e) {
      if (gen !== this.gen || this.stopped) return;
      if ([4100, 4101, 4118].includes(e?.code)) return handleErr(e);
      this.retry(e?.message || 'Gagal menyambung');
    }
  }

  playFLV(url) {
    const p = this.mp = mpegts.createPlayer({ type: 'flv', isLive: true, url, hasAudio: true, hasVideo: true }, {
      enableWorker: false, enableStashBuffer: false, stashInitialSize: 96 * 1024, lazyLoad: false,
      liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 1.6, liveBufferLatencyMinRemain: 0.4,
      liveSync: true, liveSyncMaxLatency: 1.2, liveSyncTargetLatency: 0.6, liveSyncPlaybackRate: 1.1,
      fixAudioTimestampGap: true, autoCleanupSourceBuffer: true,
    });
    p.on(mpegts.Events.ERROR, (type, detail) => { this.fails++; this.retry(`Siaran terputus (${detail || type})`); });
    p.attachMediaElement(this.video);
    p.load();
  }

  playHLS(url) {
    if (window.Hls?.isSupported()) {
      const h = this.hls = new Hls({ liveSyncDurationCount: 1, liveMaxLatencyDurationCount: 4, maxLiveSyncPlaybackRate: 1.2, lowLatencyMode: false, backBufferLength: 10 });
      h.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { this.fails++; this.retry('Siaran HLS terputus'); } });
      h.loadSource(url); h.attachMedia(this.video);
    } else {
      this.video.src = url;
    }
  }

  /** Watchdog: no picture within 14 s, or picture frozen 10 s → reconnect; FLV falls back to HLS after 2 failures. */
  watch(gen) {
    let last = -1, still = 0, started = false;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (gen !== this.gen) return;
      const v = this.video;
      if (v.paused && v.readyState >= 2) this.kick();
      this.toEdge();
      const t = v.currentTime;
      if (t > 0 && t !== last) {
        still = 0; last = t;
        if (!started) { started = true; this.fails = 0; this.onState('play'); }
        // latency readout (seconds of buffered video not yet shown)
        const b = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - t : 0;
        this.lag = b;
        this.onState('tick', b);
      } else if (this.blocked) {
        this.onState('blocked');
      } else {
        still += 1;
        if (still >= (started ? 10 : 14)) { this.fails++; this.retry(started ? 'Gambar berhenti — menyambung ulang…' : 'Kamera tidak mengirim gambar'); }
      }
    }, 1000);
  }

  retry(why) {
    if (this.stopped) return;
    if (this.mode === 'flv' && this.fails >= 2) { this.mode = 'hls'; this.fails = 0; why += ' — beralih ke mode stabil'; }
    this.onState('retry', why);
    this.teardown();
    clearTimeout(this.rt);
    this.rt = setTimeout(() => this.start(), Math.min(2000 + this.fails * 1500, 8000));
  }

  setMuted(m) { this.muted = m; this.video.muted = m; this.kick(); }

  teardown() {
    clearInterval(this.timer); clearTimeout(this.rt);
    try { this.mp?.pause(); this.mp?.unload(); this.mp?.detachMediaElement(); this.mp?.destroy(); } catch {}
    try { this.hls?.destroy(); } catch {}
    this.mp = this.hls = null;
    if (this.video.src && !this.video.src.startsWith('blob:')) { this.video.removeAttribute('src'); this.video.load(); }
  }

  stop() {
    this.stopped = true; this.gen++; this.teardown(); players.delete(this);
    this.video.removeEventListener('loadeddata', this.onReady);
    this.video.removeEventListener('canplay', this.onReady);
    if (this.blocked) { this.blocked = false; autoplayHint(); }
  }
}

/** Shown while the browser refuses to start video on its own (e.g. iPhone Low Power Mode): one tap starts all. */
function autoplayHint() {
  const need = [...players].some(p => p.blocked);
  let el = $('#tapplay');
  if (!need) { el?.remove(); return; }
  if (el) return;
  el = document.createElement('button');
  el.id = 'tapplay'; el.className = 'btn primary tapplay';
  el.innerHTML = `${ic('play')}<span>Ketuk untuk memutar video</span>`;
  el.onclick = () => {
    players.forEach(p => { p.blocked = false; p.toEdge(); p.video.play().catch(() => {}); });
    autoplayHint();
  };
  document.body.append(el);
}
document.addEventListener('pointerdown', () => players.forEach(p => p.blocked && p.kick()), true);
document.addEventListener('visibilitychange', () => { if (!document.hidden) players.forEach(p => { p.toEdge(); p.kick(); }); });

// ---------- live view ----------

const INVERT = { 0: 'Normal', 1: 'Balik semua arah', 2: 'Balik kiri ↔ kanan', 3: 'Balik atas ↕ bawah' };
function mapDir(dir, inv) {
  const flipV = inv === 1 || inv === 3, flipH = inv === 1 || inv === 2;
  if (flipV && dir === 'DirectionUp') return 'DirectionDown';
  if (flipV && dir === 'DirectionDown') return 'DirectionUp';
  if (flipH && dir === 'DirectionLeft') return 'DirectionRight';
  if (flipH && dir === 'DirectionRight') return 'DirectionLeft';
  return dir;
}
const LIGHT = { Intelligent: 'Pintar — nyala saat ada gerakan', Auto: 'Warna penuh (malam lampu nyala)', Close: 'Inframerah (lampu mati)', KeepOpen: 'Lampu selalu nyala' };

function viewLive() {
  const d = devBySn(S.liveSn);
  if (!d) return go('cams');
  const others = S.devices.filter(x => x.sn !== d.sn);
  const quality = store.get('quality', 'auto');
  const inv = store.get('invert', {})[d.sn] ?? 1;
  $('#main').innerHTML = `
    <div class="top"><button class="btn icon" id="bk" title="Kembali">${ic('back')}</button><h1>${esc(d.name)}</h1></div>
    <div class="live">
      <div>
        <div class="stage" id="stage">
          <video id="vid" playsinline muted autoplay></video>
          <div class="tl"><span class="badge" id="lb" style="position:static"><i class="dot"></i><span>…</span></span></div>
          <div class="msg" id="msg"><div><div class="spin"></div><div id="msgt">Menyambung…</div></div></div>
          <div class="hud">
            <button class="btn icon" id="snd" title="Suara">${ic('mute')}</button>
            <select id="q" title="Kualitas">
              <option value="auto">Auto</option><option value="0">Full HD</option><option value="1">SD</option>
            </select>
            <span class="spacer"></span>
            <button class="btn icon" id="shot" title="Foto">${ic('shot')}</button>
            <button class="btn icon" id="rec" title="Rekam">${ic('rec')}</button>
            <button class="btn icon" id="fill" title="Isi layar">${ic('grid')}</button>
            <button class="btn icon" id="fs" title="Layar penuh">${ic('full')}</button>
          </div>
        </div>
        ${others.length ? `<div class="chips" style="margin-top:12px">${others.map(o => `<button class="chip" data-sn="${esc(o.sn)}">${ic('cam')}${esc(o.name)}</button>`).join('')}</div>` : ''}
      </div>
      <div class="glass panel">
        <h3>Gerak kamera</h3>
        <div class="pad" id="pad">
          <span></span><button class="btn" data-dir="DirectionUp">${ic('up')}</button><span></span>
          <button class="btn" data-dir="DirectionLeft">${ic('left')}</button><span class="c">tahan</span><button class="btn" data-dir="DirectionRight">${ic('right')}</button>
          <button class="btn" data-dir="ZoomWide" title="Perkecil">${ic('minus')}</button><button class="btn" data-dir="DirectionDown">${ic('down')}</button><button class="btn" data-dir="ZoomTile" title="Perbesar">${ic('plus')}</button>
        </div>
        <select class="input" id="inv">${Object.entries(INVERT).map(([k, v]) => `<option value="${k}" ${+k === inv ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <div class="row"><h3>Favorit</h3><span class="spacer"></span><button class="btn" id="addp">${ic('star')}<span>Simpan posisi</span></button></div>
        <div id="presets" class="muted small">Memuat…</div>
        <h3>Lampu malam</h3>
        <select class="input" id="light" disabled><option>Memuat…</option></select>
        <div class="muted small" id="info"></div>
      </div>
    </div>`;
  $('#bk').onclick = () => go('cams');
  document.querySelectorAll('.chips .chip').forEach(c => c.onclick = () => go('live', c.dataset.sn));

  const video = $('#vid'), stage = $('#stage');
  const setMsg = (text, spin = true) => {
    $('#msg').hidden = !text;
    if (text) $('#msg').innerHTML = `<div>${spin ? '<div class="spin"></div>' : ''}<div>${esc(text)}</div></div>`;
  };
  let player, autoDowngrade = 0, waits = [];
  const label = () => {
    const q = player.stream === '0' ? 'Full HD' : 'SD';
    const lag = player.lag != null ? ` · jeda ${player.lag.toFixed(1)} dtk` : '';
    $('#lb').innerHTML = `<i class="dot online"></i><span>LIVE · ${q} · ${player.mode === 'flv' ? 'Cepat' : 'Stabil'}${lag}</span>`;
  };
  const startPlayer = (stream) => {
    player?.stop();
    player = new LivePlayer(video, d, {
      stream, muted: player ? player.muted : true,
      onState: (s, x) => {
        if (s === 'connect') { setMsg(x); $('#lb').innerHTML = '<i class="dot sleeping"></i><span>Menyambung</span>'; }
        if (s === 'retry') { setMsg(x); $('#lb').innerHTML = '<i class="dot offline"></i><span>Terputus</span>'; }
        if (s === 'play') { setMsg(null); label(); }
        if (s === 'tick') label();
        if (s === 'blocked') setMsg('Ketuk layar untuk memutar', false);
      },
    });
    player.start();
  };
  const q0 = quality === 'auto' ? (innerWidth < 600 ? '1' : '0') : quality;
  $('#q').value = quality;
  startPlayer(q0);
  // Auto: drop to SD when the picture keeps stalling in Full HD.
  video.addEventListener('waiting', () => {
    if ($('#q')?.value !== 'auto' || player.stream !== '0') return;
    const now = Date.now();
    waits = waits.filter(t => now - t < 30000).concat(now);
    if (waits.length >= 3 && autoDowngrade++ < 3) { waits = []; toast('Koneksi lambat — beralih ke SD'); startPlayer('1'); }
  });
  $('#q').onchange = e => {
    const v = e.target.value; store.set('quality', v);
    startPlayer(v === 'auto' ? '0' : v);
  };
  $('#snd').onclick = () => {
    player.setMuted(!player.muted);
    $('#snd').innerHTML = ic(player.muted ? 'mute' : 'vol');
    $('#snd').classList.toggle('on', !player.muted);
  };
  $('#fill').onclick = () => { stage.classList.toggle('fill'); $('#fill').classList.toggle('on'); };
  $('#fs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
    else video.webkitEnterFullscreen?.();
  };
  $('#shot').onclick = async () => {
    const name = `${d.name} ${fileStamp()}.jpg`;
    if (video.videoWidth) {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob(b => { saveBlob(b, name); toast('Foto disimpan'); }, 'image/jpeg', 0.92);
    } else {
      try { saveBlob(await api.capture(d), name); toast('Foto dari kamera disimpan'); } catch (e) { handleErr(e); }
    }
  };
  let rec;
  $('#rec').onclick = () => {
    if (rec) { rec.stop(); return; }
    const stream = video.captureStream?.() || video.mozCaptureStream?.();
    if (!stream || !window.MediaRecorder) return toast('Browser ini belum bisa merekam video live (coba Chrome/Edge)');
    const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
    const chunks = [];
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType });
      saveBlob(blob, `${d.name} ${fileStamp()}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
      rec = null; $('#rec').classList.remove('rec'); toast('Rekaman disimpan');
    };
    rec.start(1000); $('#rec').classList.add('rec'); toast('Merekam… tekan lagi untuk berhenti');
  };

  // PTZ: hold to move
  let invert = inv;
  $('#inv').onchange = e => { invert = +e.target.value; const m = store.get('invert', {}); m[d.sn] = invert; store.set('invert', m); };
  $('#pad').querySelectorAll('[data-dir]').forEach(b => {
    let active = null;
    const down = ev => {
      ev.preventDefault(); b.setPointerCapture?.(ev.pointerId);
      active = mapDir(b.dataset.dir, invert); b.classList.add('held');
      api.ptz(d, active, false).catch(handleErr);
    };
    const up = () => {
      if (!active) return;
      const dir = active; active = null; b.classList.remove('held');
      setTimeout(() => api.ptz(d, dir, true).catch(() => {}), 120);
    };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  });

  // Favourites (PTZ presets)
  const drawPresets = async () => {
    const box = $('#presets');
    try {
      const list = await api.presets(d);
      if (!$('#presets')) return;
      box.innerHTML = list.length ? list.map(p => `<div class="preset"><b>${esc(p.name)}</b>
        <button class="btn" data-go="${p.id}">Ke sini</button><button class="btn icon danger" data-del="${p.id}" title="Hapus">${ic('trash')}</button></div>`).join('')
        : 'Belum ada posisi favorit.';
      box.style.display = 'grid'; box.style.gap = '6px';
      box.querySelectorAll('[data-go]').forEach(b => b.onclick = () => api.gotoPreset(d, +b.dataset.go).then(() => toast('Menuju posisi…')).catch(handleErr));
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
        if (!confirm('Hapus posisi favorit ini?')) return;
        try { await api.deletePreset(d, +b.dataset.del); toast('Dihapus'); drawPresets(); } catch (e) { handleErr(e); }
      });
      $('#addp').onclick = async () => {
        const name = prompt('Nama posisi ini:', `Posisi ${list.length + 1}`);
        if (!name) return;
        const used = new Set(list.map(p => p.id));
        let id = 1; while (used.has(id) || id === 100) id++;
        try { await api.savePreset(d, id, name.trim()); toast('Posisi disimpan'); drawPresets(); } catch (e) { handleErr(e); }
      };
    } catch (e) { box.textContent = e?.message || 'Tidak tersedia'; }
  };
  drawPresets();

  // Night light
  (async () => {
    const sel = $('#light');
    try {
      const wl = await api.config(d, 'Camera.WhiteLight');
      if (!$('#light') || !wl?.WorkMode) throw 0;
      sel.innerHTML = Object.entries(LIGHT).map(([k, v]) => `<option value="${k}" ${wl.WorkMode === k ? 'selected' : ''}>${v}</option>`).join('');
      sel.disabled = false;
      sel.onchange = async () => {
        sel.disabled = true;
        try {
          const cur = await api.config(d, 'Camera.WhiteLight');
          cur.WorkMode = sel.value;
          await api.setConfig(d, 'Camera.WhiteLight', cur);
          toast('Mode lampu diubah');
        } catch (e) { handleErr(e); }
        sel.disabled = false;
      };
    } catch { if ($('#light')) sel.innerHTML = '<option>Tidak tersedia</option>'; }
  })();
  $('#info').textContent = `SN ${d.sn}`;
}

function fileStamp() {
  const t = new Date(), p = n => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}.${p(t.getMinutes())}.${p(t.getSeconds())}`;
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}

async function saveURL(url, name) {
  try { saveBlob(await (await fetch(url)).blob(), name); }
  catch { window.open(url, '_blank', 'noopener'); }
}

// ---------- multi view ----------

function viewMulti() {
  const n = store.get('multiN', 2);
  const cams = S.devices.slice(0, n * n);
  $('#main').innerHTML = `
    <div class="top"><h1>Multi Layar</h1><span class="spacer"></span>
      <div class="seg">${[1, 2, 3].map(k => `<button data-n="${k}" class="${k === n ? 'on' : ''}">${k === 1 ? '1' : `${k}×${k}`}</button>`).join('')}</div></div>
    <div class="multi n${n}">${cams.map(d => `
      <div class="tile" data-sn="${esc(d.sn)}"><video playsinline muted autoplay></video>
        <span class="badge"><i class="dot"></i>${esc(d.name)}</span></div>`).join('')}</div>
    <p class="muted small">Semua layar memakai kualitas SD tanpa suara. Klik satu layar untuk membuka live penuh.</p>`;
  document.querySelectorAll('.seg [data-n]').forEach(b => b.onclick = () => { store.set('multiN', +b.dataset.n); route(); });
  document.querySelectorAll('.tile').forEach(t => {
    const d = devBySn(t.dataset.sn), dot = t.querySelector('.dot');
    const p = new LivePlayer(t.querySelector('video'), d, {
      stream: n === 1 ? '0' : '1',
      onState: s => { dot.className = 'dot ' + (s === 'play' || s === 'tick' ? 'online' : s === 'retry' ? 'offline' : 'sleeping'); },
    });
    p.start();
    t.onclick = () => go('live', d.sn);
  });
}

// ---------- viewer (photos / videos) ----------

function openViewer(items, index) {
  let i = index;
  const el = document.createElement('div');
  el.className = 'viewer';
  document.body.append(el);
  const draw = async () => {
    const it = items[i];
    el.innerHTML = `
      <div class="bar"><button class="btn icon" data-a="x">${ic('x')}</button><span class="spacer"></span>
        <span class="small">${i + 1} / ${items.length}</span><span class="spacer"></span>
        <button class="btn icon" data-a="prev" ${i ? '' : 'disabled'}>${ic('prev')}</button>
        <button class="btn icon" data-a="next" ${i < items.length - 1 ? '' : 'disabled'}>${ic('next')}</button>
        <button class="btn icon" data-a="dl" title="Unduh">${ic('dl')}</button></div>
      <div class="media"><div class="spin" style="width:36px;height:36px;border-radius:50%;border:3px solid #fff3;border-top-color:#fff;animation:spin 1s linear infinite"></div></div>
      <div class="cap">${esc(it.caption || '')}</div>`;
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a));
    const src = await it.resolve();
    if (items[i] !== it) return;
    it.src = src;
    const m = el.querySelector('.media');
    m.innerHTML = !src ? '<div>Berkas tidak tersedia</div>' : it.video
      ? `<video src="${esc(src)}" controls autoplay playsinline ${it.poster ? `poster="${esc(it.poster)}"` : ''}></video>`
      : `<img src="${esc(src)}" alt="">`;
  };
  const act = a => {
    if (a === 'x') { el.remove(); document.removeEventListener('keydown', key); }
    if (a === 'prev' && i > 0) { i--; draw(); }
    if (a === 'next' && i < items.length - 1) { i++; draw(); }
    if (a === 'dl' && items[i].src) saveURL(items[i].src, items[i].file || 'pantau');
  };
  const key = e => { if (e.key === 'Escape') act('x'); if (e.key === 'ArrowLeft') act('prev'); if (e.key === 'ArrowRight') act('next'); };
  document.addEventListener('keydown', key);
  el.addEventListener('click', e => { if (e.target === el || e.target.classList.contains('media')) act('x'); });
  draw();
}

const dayLabel = t => t ? t.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Tanpa tanggal';
const timeLabel = t => t ? t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

// ---------- messages (alarms from the camera cloud) ----------

async function viewPesan() {
  const main = $('#main');
  let filter = store.get('pesanCam', 'all'), days = store.get('pesanDays', 1), shown = 60;
  let all = [], pics = {};
  const draw = () => {
    const list = all.filter(a => filter === 'all' || a.sn === filter);
    const page = list.slice(0, shown);
    let html = '', lastDay = '';
    page.forEach((a, k) => {
      const dl = dayLabel(a.time);
      if (dl !== lastDay) { html += `${lastDay ? '</div>' : ''}<div class="day">${dl}</div><div class="list">`; lastDay = dl; }
      const pic = pics[a.id];
      html += `<button class="ev glass" data-k="${k}"><div class="thumb">${pic ? `<img loading="lazy" src="${esc(pic)}" alt="">` : ic('bell')}</div>
        <div class="meta"><b>${esc(a.event)}</b><span>${esc(devBySn(a.sn)?.name || a.sn)} · ${timeLabel(a.time)}</span></div></button>`;
    });
    if (lastDay) html += '</div>';
    main.querySelector('#out').innerHTML = list.length ? html + (list.length > shown ? '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="more">Muat lagi</button></div>' : '')
      : '<div class="empty glass">Tidak ada pesan di rentang ini.</div>';
    main.querySelectorAll('.ev').forEach(b => b.onclick = () => {
      const items = page.map(a => ({
        caption: `${a.event} · ${devBySn(a.sn)?.name || ''} · ${dayLabel(a.time)} ${timeLabel(a.time)}`,
        file: `${devBySn(a.sn)?.name || a.sn} ${a.timeText.replace(/:/g, '.')}.jpg`,
        resolve: async () => pics[a.id] || null,
      }));
      openViewer(items, +b.dataset.k);
    });
    $('#more') && ($('#more').onclick = () => { shown += 60; loadPics(); draw(); });
  };
  const loadPics = async () => {
    const need = all.filter(a => (filter === 'all' || a.sn === filter) && a.hasPic && !(a.id in pics)).slice(0, shown);
    const bySn = {};
    need.forEach(a => (bySn[a.sn] ||= []).push(a.id));
    await Promise.all(Object.entries(bySn).map(async ([sn, ids]) => {
      const got = await api.alarmPictures(devBySn(sn), ids);
      ids.forEach(id => { pics[id] = got[id] || pics[id] || ''; });
      if (S.view === 'pesan') draw();
    }));
  };
  const load = async () => {
    main.querySelector('#out').innerHTML = '<div class="empty glass">Memuat pesan…</div>';
    const to = new Date(), from = new Date(Date.now() - days * 86400e3);
    const res = await Promise.all(S.devices.map(d => api.alarms(d, from, to).catch(e => { handleErr(e); return []; })));
    all = res.flat().sort((a, b) => (b.time || 0) - (a.time || 0));
    shown = 60;
    draw(); loadPics();
  };
  main.innerHTML = `
    <div class="top"><h1>Pesan</h1><span class="spacer"></span><button class="btn icon" id="rf">${ic('refresh')}</button></div>
    <div class="toolbar">
      <div class="chips" id="cf">${[['all', 'Semua'], ...S.devices.map(d => [d.sn, d.name])].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(v)}</button>`).join('')}</div>
      <span class="spacer"></span>
      <div class="seg" id="df">${[[1, '24 jam'], [3, '3 hari'], [7, '7 hari']].map(([k, v]) => `<button data-d="${k}" class="${k === days ? 'on' : ''}">${v}</button>`).join('')}</div>
    </div>
    <div id="out"></div>`;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    filter = b.dataset.f; store.set('pesanCam', filter);
    main.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b));
    shown = 60; draw(); loadPics();
  });
  main.querySelectorAll('[data-d]').forEach(b => b.onclick = () => {
    days = +b.dataset.d; store.set('pesanDays', days);
    main.querySelectorAll('[data-d]').forEach(x => x.classList.toggle('on', x === b));
    load();
  });
  $('#rf').onclick = load;
  load();
}

// ---------- motion clips (Supabase, uploaded by the Mac app's recorder) ----------

async function viewKlip() {
  const main = $('#main');
  const key = store.get('cloudKey', '');
  if (!CloudStore.isValidKey(key)) {
    main.innerHTML = `
      <div class="top"><h1>Klip Gerak</h1></div>
      <form class="glass" id="kf" style="padding:20px;display:grid;gap:12px;max-width:620px">
        <b>Hubungkan Klip Gerak</b>
        <div class="muted small">Klip video tiap gerakan direkam oleh aplikasi Pantau di Mac dan disimpan di cloud.
          Untuk melihatnya di sini, salin <b>kunci cloud</b> dari aplikasi Mac: <b>Saya › Cloud › tampilkan kunci</b> (64 huruf/angka),
          lalu tempel di bawah. Kunci hanya disimpan di browser ini.</div>
        <input class="input" name="k" placeholder="kunci cloud 64 karakter" autocomplete="off" spellcheck="false">
        <div class="err" id="kerr"></div>
        <div><button class="btn primary">Hubungkan</button></div>
      </form>`;
    $('#kf').onsubmit = async e => {
      e.preventDefault();
      const k = new FormData(e.target).get('k').trim().toLowerCase();
      if (!CloudStore.isValidKey(k)) { $('#kerr').textContent = 'Kunci harus 64 karakter hex (0-9, a-f).'; return; }
      try { await new CloudStore(k).list({ limit: 1 }); store.set('cloudKey', k); route(); }
      catch (err) { $('#kerr').textContent = err.message; }
    };
    return;
  }
  const cs = new CloudStore(key);
  let rows = [], used = 0, count = 0, thumbs = {}, filter = store.get('klipCam', 'all');
  const draw = () => {
    const list = rows.filter(r => filter === 'all' || r.sn === filter);
    let html = '', lastDay = '';
    list.forEach((r, k) => {
      const t = new Date(r.at), dl = dayLabel(t);
      if (dl !== lastDay) { html += `${lastDay ? '</div>' : ''}<div class="day">${dl}</div><div class="list">`; lastDay = dl; }
      const th = thumbs[r.alarm_photo || r.photo];
      html += `<button class="ev glass" data-k="${k}"><div class="thumb">${th ? `<img loading="lazy" src="${esc(th)}" alt="">` : ic('film')}
        ${r.video ? `<span class="play">${ic('play')}</span>` : ''}</div>
        <div class="meta"><b>${esc(eventLabel(r.event))}</b><span>${esc(r.cam || devBySn(r.sn)?.name || r.sn)} · ${timeLabel(t)}${r.secs ? ` · ${Math.round(r.secs)} dtk` : ''}</span></div></button>`;
    });
    if (lastDay) html += '</div>';
    $('#out').innerHTML = list.length ? html + (rows.length < count ? '<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" id="more">Muat lagi</button></div>' : '')
      : '<div class="empty glass">Belum ada klip.</div>';
    $('#usage').textContent = `${count} kejadian · ${(used / 1048576).toFixed(0)} MB dari 700 MB`;
    main.querySelectorAll('.ev').forEach(b => b.onclick = () => {
      const items = list.map(r => ({
        video: !!r.video, poster: thumbs[r.alarm_photo || r.photo],
        caption: `${eventLabel(r.event)} · ${r.cam || ''} · ${dayLabel(new Date(r.at))} ${timeLabel(new Date(r.at))}`,
        file: (r.video || r.photo || r.alarm_photo || 'klip').split('/').pop(),
        resolve: async () => {
          const p = r.video || r.photo || r.alarm_photo;
          if (!p) return null;
          return thumbs[p] || (await cs.signedURLs([p]))[p] || null;
        },
      }));
      openViewer(items, +b.dataset.k);
    });
    $('#more') && ($('#more').onclick = () => load(rows[rows.length - 1]?.at));
  };
  const load = async (before = null) => {
    try {
      const page = await cs.list({ before, limit: 120 });
      rows = before ? rows.concat(page.rows) : page.rows;
      used = page.used; count = page.count;
      const paths = [...new Set(page.rows.map(r => r.alarm_photo || r.photo).filter(Boolean))];
      draw();
      for (let i = 0; i < paths.length; i += 100) Object.assign(thumbs, await cs.signedURLs(paths.slice(i, i + 100)));
      if (S.view === 'klip') draw();
    } catch (e) { $('#out').innerHTML = `<div class="empty glass">${esc(e.message)}</div>`; }
  };
  main.innerHTML = `
    <div class="top"><h1>Klip Gerak</h1><span class="spacer"></span><button class="btn icon" id="rf">${ic('refresh')}</button></div>
    <div class="toolbar">
      <div class="chips">${[['all', 'Semua'], ...S.devices.map(d => [d.sn, d.name])].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(v)}</button>`).join('')}</div>
      <span class="spacer"></span><span class="muted small" id="usage"></span>
    </div>
    <div id="out"><div class="empty glass">Memuat klip…</div></div>`;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => {
    filter = b.dataset.f; store.set('klipCam', filter);
    main.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b));
    draw();
  });
  $('#rf').onclick = () => load();
  load();
}

// ---------- settings ----------

function viewSaya() {
  const theme = store.get('theme', 'auto'), mode = store.get('mode', 'auto'), key = store.get('cloudKey', '');
  const keys = S.session.keys;
  $('#main').innerHTML = `
    <div class="top"><h1>Saya</h1></div>
    <div class="settings">
      <div class="glass">
        <h3>Akun</h3>
        <div class="row"><div><b>${esc(S.session.account)}</b><div class="muted small">${S.devices.length} kamera</div></div>
          <span class="spacer"></span><button class="btn danger" id="lo">${ic('logout')}<span>Keluar</span></button></div>
      </div>
      <div class="glass">
        <h3>Tampilan</h3>
        <div class="seg" id="th">${[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, v]) => `<button data-t="${k}" class="${k === theme ? 'on' : ''}">${v}</button>`).join('')}</div>
      </div>
      <div class="glass">
        <h3>Mode live</h3>
        <div class="seg" id="md">${[['auto', 'Cepat (± 2 dtk)'], ['hls', 'Stabil (± 8 dtk)']].map(([k, v]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div class="muted small">Cepat = video H.265 asli kamera, butuh browser yang bisa memutar HEVC
          (${hevcMSE() ? '<b style="color:var(--ok)">browser ini bisa</b>' : '<b style="color:var(--warn)">browser ini tidak bisa — otomatis memakai mode Stabil</b>'}).
          Stabil = diubah ke H.264 oleh server iCSee, jalan di semua browser tetapi tertinggal beberapa detik.</div>
      </div>
      <div class="glass">
        <h3>Klip Gerak (cloud)</h3>
        ${CloudStore.isValidKey(key) ? `<div class="row"><code class="k">${key.slice(0, 8)}••••••••${key.slice(-4)}</code><span class="spacer"></span>
          <button class="btn danger" id="ck">Putuskan</button></div>` : '<div class="muted small">Belum terhubung — buka tab Klip Gerak.</div>'}
      </div>
      <div class="glass">
        <h3>Kunci platform</h3>
        <div class="muted small">AppKey <code class="k">${esc(keys.appKey.slice(0, 6))}…</code> ·
          ${keys.appKey === PUBLIC_KEYS.appKey ? 'kunci demo publik JFTech' : 'kunci sendiri'} — ubah saat masuk (Kunci platform).</div>
      </div>
      <div class="muted small">Pantau web · terhubung langsung ke cloud iCSee (rs.xmeye.net · api.jftechws.com). Tidak ada server perantara.
        Bicara/interkom & perekam latar belakang hanya ada di aplikasi Mac.</div>
    </div>`;
  $('#lo').onclick = () => { if (confirm('Keluar dari akun ini di browser ini?')) logout(false); };
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { store.set('theme', b.dataset.t); applyTheme(); route(); });
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { store.set('mode', b.dataset.m); route(); });
  $('#ck') && ($('#ck').onclick = () => { store.set('cloudKey', null); route(); });
}

// ---------- demo (?demo=1): sample data, never touches the saved session ----------

if (new URLSearchParams(location.search).has('demo')) {
  const names = ['Second Floor', 'Bedroom', 'Living Room', 'Jl. Telaga Warna No.31'];
  const devs = names.map((name, i) => ({ sn: `demo${i}0000000000`, name, username: 'admin', password: '', channelCount: 1 }));
  const t = Date.now();
  store.set = () => {};
  S.session = { account: 'demo@pantau', token: 'demo', keys: PUBLIC_KEYS };
  S.devices = devs; S.thumbs = {};
  api = Object.assign(new JFClient(), {
    devices: async () => devs,
    status: async () => Object.fromEntries(devs.map((d, i) => [d.sn, i === 3 ? 'sleeping' : 'online'])),
    capture: async () => { throw new Error('demo'); },
    presets: async () => [{ id: 1, name: 'Ruang (Dalam)' }, { id: 2, name: 'Pintu (Depan)' }],
    config: async () => ({ WorkMode: 'Intelligent' }),
    alarms: async d => Array.from({ length: 6 }, (_, k) => ({
      id: d.sn + k, sn: d.sn, timeText: '', time: new Date(t - (k * 5 + devs.indexOf(d)) * 3600e3),
      event: k % 2 ? 'Gerakan terdeteksi' : 'Manusia terdeteksi', hasPic: false })),
    alarmPictures: async () => ({}),
    liveURL: async (d, o) => {
      const u = await fetch('_test/urls.json').then(r => r.json()).catch(() => ({}));
      const k = o.protocol === 'flv' ? (o.stream === '0' ? 'flvHD' : 'flvSD') : 'hlsSD';
      const url = u[`${k}_${devs.indexOf(d)}`] || u[k];
      if (!url) throw new Error('Demo: tidak ada siaran');
      return url;
    },
    ptz: async () => {}, gotoPreset: async () => {},
  });
}

// ---------- boot ----------

window.__pantau = { S, api: () => api, LivePlayer, hevcMSE };
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations?.().then(r => r.forEach(x => x.unregister())).catch(() => {});
route();
