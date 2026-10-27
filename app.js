// Pantau web — UI. Core API in core.js (port of the Mac app's PantauCore).
import { JFClient, PUBLIC_KEYS, CloudStore, eventLabel, SENS } from './core.js?v=4';
import { Watcher, PreRoll, LEVELS, snapshot, personBoxes } from './watch.js?v=6';
import { PersonEye, PLEVELS } from './person.js?v=2';

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = b => b >= 1073741824 ? `${(b / 1073741824).toFixed(1).replace('.', ',')} GB` : `${(b / 1048576).toFixed(0)} MB`;
// Settings in SYNC are also saved to the cloud (with the Klip Gerak key) so every browser gets them.
const SYNC = ['theme', 'skin', 'glass', 'mode', 'quality', 'invert', 'panelOff', 'sideOff', 'multiN', 'multiCover', 'klipCam', 'pesanCam', 'pesanDays', 'watch'];
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('pantau.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  raw(k, v) { try { v == null ? localStorage.removeItem('pantau.' + k) : localStorage.setItem('pantau.' + k, JSON.stringify(v)); } catch {} },
  set(k, v) { store.raw(k, v); if (SYNC.includes(k)) { store.raw('prefsT', Date.now()); prefsPush(); } },
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
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
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

// Liquid-glass skins: [blob1, blob2, blob3, accent, accent text] for light and dark.
const SKINS = {
  kaca: { name: 'Kaca', light: ['#8ec5ff', '#ffc6e0', '#b8f0d8', '#0a84ff'], dark: ['#1d4f91', '#5a1f4f', '#0f5a46', '#0a84ff'] },
  aurora: { name: 'Aurora', light: ['#a7f3d0', '#c4b5fd', '#93c5fd', '#7c3aed'], dark: ['#065f46', '#4c1d95', '#1e3a8a', '#8b5cf6'] },
  laut: { name: 'Laut', light: ['#7dd3fc', '#99f6e4', '#bfdbfe', '#0e7490'], dark: ['#0c4a6e', '#134e4a', '#1e3a8a', '#22d3ee', '#04222b'] },
  senja: { name: 'Senja', light: ['#fdba74', '#f9a8d4', '#fde68a', '#c2410c'], dark: ['#7c2d12', '#831843', '#713f12', '#fb923c', '#2a1204'] },
  hutan: { name: 'Hutan', light: ['#bbf7d0', '#d9f99d', '#a7f3d0', '#15803d'], dark: ['#14532d', '#365314', '#064e3b', '#22c55e', '#04210f'] },
  mono: { name: 'Mono', light: ['#e5e7eb', '#cbd5e1', '#f8fafc', '#111827'], dark: ['#3f3f46', '#27272a', '#52525b', '#e5e7eb', '#111111'] },
};
const BLUR = { halus: '14px', sedang: '26px', kuat: '42px' };
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const t = store.get('theme', 'auto'), skin = SKINS[store.get('skin', 'kaca')] || SKINS.kaca;
  const dark = t === 'dark' || (t === 'auto' && darkMQ.matches);
  const r = document.documentElement;
  r.dataset.theme = dark ? 'dark' : 'light';
  const [b1, b2, b3, acc, accInk = '#fff'] = skin[dark ? 'dark' : 'light'];
  for (const [k, v] of Object.entries({ '--blob1': b1, '--blob2': b2, '--blob3': b3, '--accent': acc, '--accent-ink': accInk, '--blur': BLUR[store.get('glass', 'sedang')] || BLUR.sedang }))
    r.style.setProperty(k, v);
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1018' : '#e9eef5');
}
darkMQ.addEventListener?.('change', applyTheme);
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

// screen order for the slide direction: further right = slides in from the right
const DEPTH = { cams: 0, live: 0.5, multi: 1, pesan: 2, klip: 3, saya: 4 };

function route() {
  const [view, sn] = location.hash.slice(1).split('/');
  const next = !S.session ? 'login' : VIEWS.some(v => v[0] === view) || view === 'live' ? view : 'cams';
  const dir = next === S.view ? 'same' : (DEPTH[next] ?? -1) > (DEPTH[S.view] ?? -1) ? 'fwd' : 'back';
  smooth(() => {
    stopAllPlayers();
    clearInterval(S.tick);
    if (!S.session) { S.view = 'login'; renderLogin(); return; }
    S.view = next;
    S.liveSn = sn || null;
    renderShell();
  }, dir);
}

/** Swaps the screen with a short slide + fade: View Transitions where the browser has them
 *  (the old picture, live video included, glides out while the new one comes in), else a CSS entrance. */
function smooth(update, dir) {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches || !S.view || document.hidden;
  const root = document.documentElement;
  if (!calm && document.startViewTransition) {
    root.dataset.nav = dir;
    // the browser runs the update only after painting the old screen; a window that paints no frames
    // (covered, minimised pane) would leave the page empty, so render without animation after 400 ms
    let done = false;
    const run = () => { if (!done) { done = true; update(); } };
    const t = document.startViewTransition(run);
    setTimeout(() => { if (!done) { t.skipTransition(); run(); } }, 400);
    t.ready.catch(() => {});
    t.updateCallbackDone?.catch(() => {});
    t.finished.finally(() => { if (root.dataset.nav === dir) delete root.dataset.nav; });
    return;
  }
  update();
  const m = $('#main') || $('#root');
  if (calm || !m) return;
  m.dataset.nav = dir;
  m.classList.add('enter');
  m.addEventListener('animationend', () => m.classList.remove('enter'), { once: true });
}
window.addEventListener('hashchange', route);

function renderShell() {
  document.body.dataset.view = S.view;
  const nav = cls => VIEWS.map(([k, label, icon]) =>
    `<button class="nav ${S.view === k || (S.view === 'live' && k === 'cams') ? 'active' : ''}" data-go="${k}">${ic(icon)}<span>${label}</span></button>`).join('');
  $('#root').innerHTML = `
    <div class="app ${store.get('sideOff', false) ? 'side-off' : ''}">
      <aside class="side"><div class="glass">
        <div class="brand"><img src="icon-192.png" alt="">Pantau<button class="btn icon" data-side title="Sembunyikan menu ( \\ )">${ic('sidebar')}</button></div>
        ${nav()}
        <div class="foot">${esc(S.session.account)}</div>
      </div></aside>
      <main id="main"></main>
    </div>
    <nav class="tabbar glass">${nav()}</nav>`;
  document.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  ({ cams: viewCams, live: viewLive, multi: viewMulti, pesan: viewPesan, klip: viewKlip, saya: viewSaya })[S.view]();
}

/** Page header. The sidebar button only shows while the sidebar is hidden (desktop). */
const topbar = (title, right = '', left = '') =>
  `<div class="top"><button class="btn icon sbt" data-side title="Tampilkan menu ( \\ )">${ic('sidebar')}</button>${left}<h1>${title}</h1><span class="spacer"></span>${right}</div>`;

function toggleSide() {
  const app = $('.app');
  if (!app) return;
  const off = !app.classList.contains('side-off');
  app.classList.toggle('side-off', off);
  store.set('sideOff', off);
}
document.addEventListener('click', e => { if (e.target.closest('[data-side]')) toggleSide(); });
document.addEventListener('keydown', e => {
  if (e.key === '\\' && !e.metaKey && !e.ctrlKey && !e.target.closest('input, select, textarea')) toggleSide();
});

// ---------- cloud key + settings sync ----------

// The Klip Gerak cloud key, sealed once per camera (AES-GCM, key = PBKDF2 of the camera serial number).
// Only someone signed in to the iCSee account that owns these cameras can open it, so this public
// source never contains the key itself. Re-seal with the Mac app's key when cameras change.
const SEALED = [{"id":"10b25c7277b3","iv":"Dds0WFXClhGOZ/3W","ct":"Sr6jjuqUe/JUnku56No1Hue1uCBaGK/gMpKIe89MWlY+eWGVYIxyfUSjUkCIgmFOKuknzKfE9R8Z8jxwoj5xH2bPpB02WvlY8UYUL8paFuw="},{"id":"d6b0ade218b6","iv":"lTioKc6ZneNTCldA","ct":"qP5kpgrcv/t6FTVrjlQzfFTyaMWeH9/a5xoXEBOZ8ydXvm4SqO4NxGvTrcqbgUTM4J9gLQ3qNlM9PRPh3nyw7oyend9FKlEaho/bK6rqPb8="},{"id":"22beab695f8b","iv":"v4trtODFeiKBAalm","ct":"z12Dvzlz3qxvMMtgVwOjBuekljyyCw5P3SYOBoxoMULzDhTK4hF5V+lJMDKvxSdGA0xO5Y11HO/yHHsYztssSYRCuFwf6CmTQqL3Ew6O+Ng="},{"id":"82d59529dba9","iv":"X5tdCvvB4V5snDRh","ct":"qPlnSvz5vJiGOxba96TBWpwM7IUnhqmTHfmazEh2p+2WO+4udKB+/3PmKNtiDrDc05z3cQg0hhNQgiolx48UV+Yh0+SqrqdFSNpbxNU3PrA="}];

let unsealing = null;
async function ensureCloudKey() {
  if (CloudStore.isValidKey(store.get('cloudKey', ''))) return true;
  if (store.get('cloudOff', false) || !S.devices.length) return false;
  unsealing ||= CloudStore.unseal(SEALED, S.devices.map(d => d.sn)).finally(() => { unsealing = null; });
  const key = await unsealing;
  if (key) store.raw('cloudKey', key);
  return !!key;
}

const cloud = () => { const k = store.get('cloudKey', ''); return CloudStore.isValidKey(k) ? new CloudStore(k) : null; };
const prefsNow = () => ({ t: store.get('prefsT', 0) || Date.now(), v: Object.fromEntries(SYNC.map(k => [k, store.get(k)]).filter(([, v]) => v != null)) });
let prefsTimer = null, prefsOld = [], prefsState = '';

function prefsPush(now = false) {
  clearTimeout(prefsTimer);
  prefsTimer = null;
  const cs = cloud();
  if (!cs) return;
  const send = () => {
    prefsTimer = null;
    const p = prefsNow(), old = prefsOld; prefsOld = [];
    cs.putPrefs(p, { keepalive: now, old }).then(() => { prefsState = 'ok'; store.raw('prefsSent', p.t); })
      .catch(e => { prefsState = 'err'; prefsOld = old; console.warn('prefs', e); });
  };
  if (now) send(); else prefsTimer = setTimeout(send, 1200);
}
addEventListener('pagehide', () => { if (prefsTimer) prefsPush(true); });

/** Pull the newest saved settings; apply them if they are newer than this browser's, else upload ours. */
async function prefsSync() {
  const cs = cloud();
  if (!cs || prefsTimer) return;
  let remote;
  try { remote = await cs.getPrefs(); } catch (e) { prefsState = 'err'; console.warn('prefs', e); return; }
  prefsState = 'ok';
  prefsOld = remote?.old || [];
  const localT = store.get('prefsT', 0);
  if (remote?.t > localT && remote.v) {
    const changed = SYNC.filter(k => JSON.stringify(store.get(k)) !== JSON.stringify(remote.v[k] ?? null));
    for (const k of SYNC) store.raw(k, remote.v[k] ?? null);
    store.raw('prefsT', remote.t); store.raw('prefsSent', remote.t);
    if (changed.length) {
      applyTheme();
      $('.app')?.classList.toggle('side-off', !!store.get('sideOff', false));
      if (S.view !== 'live' && S.view !== 'multi') route();
    }
  } else if (!remote ? SYNC.some(k => store.get(k) != null) : localT > remote.t) {
    if (!localT) store.raw('prefsT', Date.now());
    prefsPush(true);
  }
}

async function cloudReady() {
  if (await ensureCloudKey()) await prefsSync();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.session) prefsSync(); });

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
      cloudReady();
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
      ${topbar('Kamera', `<button class="btn lbl" id="rf" title="Segarkan">${ic('refresh')}<span>Segarkan</span></button>`)}
      ${S.devices.length ? `<div class="grid">${S.devices.map(camCard).join('')}</div>` : '<div class="empty glass">Memuat kamera…</div>'}`;
    main.querySelectorAll('.cam').forEach(c => c.onclick = () => go('live', c.dataset.sn));
    $('#rf').onclick = () => { S.thumbs = {}; load(true); };
  };
  const snap = all => {
    for (const d of S.devices) {
      if (!all && S.thumbs[d.sn]) continue;
      if (S.status[d.sn] && S.status[d.sn] !== 'online') continue;
      api.capture(d).then(blob => blobToDataURL(blob)).then(url => {
        S.thumbs[d.sn] = url; store.set('thumbs', S.thumbs);
        if (S.view === 'cams') draw();
      }).catch(() => {});
    }
  };
  const load = async (thumbs) => {
    draw();
    await refreshDevices();
    if (S.view !== 'cams') return;
    draw();
    snap(thumbs);
  };
  load(false);
  // keep the preview pictures fresh while this page is open
  S.tick = setInterval(() => { if (!document.hidden && S.view === 'cams') snap(true); }, 45000);
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

// Safari and every iPhone/iPad browser (CriOS, FxiOS, EdgiOS carry no "Chrome/" token) run on WebKit.
const isWebKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\/|Android/.test(navigator.userAgent);

/** auto: FLV where it plays smoothly; WebKit decodes the cameras' H.265 FLV for a few seconds and then
 *  freezes on the last frame (measured), so it gets the H.264 HLS relay instead. */
function liveMode() {
  const m = store.get('mode', 'auto');
  if (m === 'hls' || !hevcMSE() || !window.mpegts) return 'hls';
  if (m === 'flv') return 'flv';
  return isWebKit || S.flvFrozen ? 'hls' : 'flv';
}

/** Live view for one camera. FLV (native H.265, ~1–2 s behind) when the browser plays it well, else relay HLS (H.264, 3–8 s). */
/** Rejects when a request hangs (dead connection after sleep / network switch) instead of waiting forever. */
const within = (p, ms, why) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(why)), ms))]);

class LivePlayer {
  constructor(video, dev, { stream = '1', muted = true, onState = () => {} } = {}) {
    this.video = video; this.dev = dev; this.stream = stream; this.muted = muted; this.onState = onState;
    this.fails = 0; this.mode = liveMode(); this.alive = Date.now();
    video.muted = muted; video.playsInline = true; video.crossOrigin = 'anonymous';
    this.onReady = () => this.kick();
    video.addEventListener('loadeddata', this.onReady);
    video.addEventListener('canplay', this.onReady);
    players.add(this);
  }

  /** Frames the decoder has produced. currentTime keeps moving on a frozen picture (and jumps on seeks); this doesn't. */
  frameCount() {
    const v = this.video, q = v.getVideoPlaybackQuality?.();
    return q ? q.totalVideoFrames : v.webkitDecodedFrameCount ?? null;
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

  /** Jump to the live edge when playback has fallen behind (tab in background, slow decode, stalls).
   *  Never while paused: WebKit drops back to HAVE_METADATA on every seek and then never starts playing. */
  toEdge() {
    const v = this.video;
    if (v.paused || v.seeking || !v.buffered.length) return;
    const end = v.buffered.end(v.buffered.length - 1);
    const max = this.mode === 'flv' ? 1.5 : 5, keep = this.mode === 'flv' ? 0.3 : 1.5;
    if (end - v.currentTime > max) v.currentTime = end - keep;
    else if (this.hls?.latency > 9 && this.hls.liveSyncPosition) v.currentTime = this.hls.liveSyncPosition;
  }

  /** Playback sits still although newer video is buffered (gap in the buffer, decoder hiccup): step over it. */
  nudge() {
    const v = this.video;
    if (v.seeking || !v.buffered.length) return;
    const end = v.buffered.end(v.buffered.length - 1);
    if (end - v.currentTime > 0.25) v.currentTime = Math.max(v.currentTime, end - (this.mode === 'flv' ? 0.3 : 1));
    if (v.paused && v.readyState >= 2) this.kick();
  }

  /** Tiny fingerprint of the picture. A live feed never repeats exactly (sensor noise, OSD clock);
   *  the same fingerprint for a long time means the image is frozen even if frames are still counted. */
  picPrint() {
    const v = this.video;
    if (this.noPrint || !v.videoWidth) return null;
    try {
      const c = this.pc ||= Object.assign(document.createElement('canvas'), { width: 128, height: 72 });
      const x = this.px ||= c.getContext('2d', { willReadFrequently: true });
      x.imageSmoothingQuality = 'high';
      x.drawImage(v, 0, 0, 128, 72);
      const d = x.getImageData(0, 0, 128, 72).data;
      let h = 0, lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
        if (d[i + 1] < lo) lo = d[i + 1]; if (d[i + 1] > hi) hi = d[i + 1];
      }
      // a flat sample is a blank draw (Safari can't always paint HLS video to a canvas), not a picture
      return hi - lo < 3 ? null : h;
    } catch { this.noPrint = true; return null; } // tainted (cross-origin native HLS): rely on frame counts
  }

  /** Keep the last picture on screen (dimmed by the caller) while reconnecting instead of going black. */
  keepFrame() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    try {
      const c = document.createElement('canvas'), w = Math.min(640, v.videoWidth);
      c.width = w; c.height = Math.round(w * v.videoHeight / v.videoWidth);
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      v.poster = c.toDataURL('image/jpeg', 0.7);
    } catch {}
  }

  async start() {
    this.teardown();
    this.stopped = false; this.alive = Date.now();
    const gen = this.gen = (this.gen || 0) + 1;
    this.onState('connect', this.mode === 'flv' ? 'Menyambung (cepat)…' : 'Menyambung…');
    try {
      if (S.status[this.dev.sn] === 'sleeping') { try { await within(api.wakeUp(this.dev), 8000, 'bangun'); } catch {} }
      const url = await within(api.liveURL(this.dev, this.mode === 'flv'
        ? { stream: this.stream, protocol: 'flv' }
        : { stream: this.stream, protocol: 'hls-ts', videoCode: 'h264' }), 15000, 'Server kamera tidak menjawab');
      if (gen !== this.gen || this.stopped) return;
      this.mode === 'flv' ? this.playFLV(url) : this.playHLS(url);
      this.watch(gen);
    } catch (e) {
      if (gen !== this.gen || this.stopped) return;
      if ([4100, 4101, 4118].includes(e?.code)) return handleErr(e);
      this.fails++;
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

  /** Watchdog: no picture within 14 s, or no new frame for 5 s (FLV) / 9 s (HLS) → reconnect; after 2 s
   *  still it first tries to step to newer buffered video. The same picture for 20 s while frames are
   *  still counted (frozen image) also reconnects. A frozen FLV picture in auto mode switches to HLS at once. */
  watch(gen) {
    let lastF = -1, lastT = -1, still = 0, started = false, print = null, same = 0, n = 0;
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (gen !== this.gen) return;
      const v = this.video;
      if (document.hidden) { still = 0; same = 0; return; }
      if (v.paused && v.readyState >= 2) this.kick();
      this.toEdge();
      const f = this.frameCount(), t = v.currentTime;
      const moving = !v.paused && (f != null ? f > 0 && f !== lastF : t > 0 && t !== lastT);
      lastF = f; lastT = t;
      if (moving && started && ++n % 2 === 0) {
        const h = this.picPrint();
        same = h != null && h === print ? same + 2 : 0;
        print = h;
        if (same >= 20) { this.fails++; return this.retry('Gambar membeku — menyambung ulang…'); }
      }
      if (moving) {
        still = 0; this.alive = Date.now();
        if (!started) { started = true; this.fails = 0; this.onState('play'); this.watcher?.restart(); }
        // latency readout (seconds of buffered video not yet shown)
        const b = v.buffered.length ? v.buffered.end(v.buffered.length - 1) - t : 0;
        this.lag = b;
        this.onState('tick', b);
      } else if (this.blocked) {
        this.alive = Date.now();
        this.onState('blocked');
      } else {
        still += 1;
        if (started && (still === 2 || still === 4)) this.nudge();
        if (started && still === 2) this.onState('stall');
        if (still < (!started ? 14 : this.mode === 'flv' ? 5 : 9)) return;
        if (started && this.mode === 'flv' && store.get('mode', 'auto') === 'auto') {
          S.flvFrozen = true; this.fails = 2;
          this.retry('Gambar macet');
        } else {
          this.fails++;
          this.retry(started ? 'Gambar berhenti — menyambung ulang…' : 'Kamera tidak mengirim gambar');
        }
      }
    }, 1000);
  }

  retry(why) {
    if (this.stopped) return;
    this.watcher?.pause();
    if (this.mode === 'flv' && this.fails >= 2 && store.get('mode', 'auto') !== 'flv') { this.mode = 'hls'; this.fails = 0; why += ' — beralih ke mode stabil'; }
    this.onState('retry', why);
    this.keepFrame();
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
    this.stopped = true; this.gen++; this.watcher?.stop(); this.teardown(); players.delete(this);
    this.video.removeAttribute('poster');
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
// Phones suspend the page (and drop the stream) in the background: after a longer absence reconnect instead of resuming a dead stream.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt && Date.now() - hiddenAt > 8000;
  players.forEach(p => { p.alive = Date.now(); if (away) p.start(); else { p.toEdge(); p.kick(); } });
});
// Supervisor above every player's own watchdog: whatever got stuck (a hung request, a timer that never
// fired, a stream that neither plays nor errors), 25 s on screen without a moving picture → start over.
setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  players.forEach(p => {
    if (p.stopped || p.blocked || now - p.alive < 25000) return;
    p.alive = now; p.fails++;
    p.retry('Siaran macet — memuat ulang…');
  });
}, 5000);
window.addEventListener('pageshow', e => { if (e.persisted) players.forEach(p => p.start()); });
window.addEventListener('online', () => players.forEach(p => p.start()));

// ---------- motion watcher (detector + pre-roll in watch.js) ----------

// level: 'off' | LEVELS key (pixel motion). orang: 'off' | PLEVELS key (person detector, person.js) — both
// on by default on every camera shown. foto/vid = save a photo / clip per event, pre = seconds recorded
// before it (always PRE; the whole clip is at most CLIP_MAX), cloud = upload to Klip Gerak (photo + mp4), dl = also download to this device.
const PRE = 3, CLIP_MAX = 20000;
const WATCH0 = { level: 'agresif', last: 'agresif', orang: 'agresif', lastO: 'agresif', foto: true, vid: true, pre: PRE, cloud: true, dl: false };
// saved settings from older versions carry pre 1–10 s; the clip now always starts PRE s before the motion
const watchCfg = () => ({ ...WATCH0, ...store.get('watch', {}), pre: PRE });
S.caps = []; // this visit's captures, newest first: {id, sn, cam, at, photo, video, secs, pre} (object URLs)
const capHooks = new Set();
let cloudWarned = false;

async function cloudSave(cap, kind, blob, mime, secs) {
  const cs = cloud();
  if (!cs) return;
  try {
    const path = await cs.path(cap.sn, `${cap.id}.${kind === 'video' ? 'mp4' : 'jpg'}`);
    await cs.upload(path, blob, mime);
    const ev = { sn: cap.sn, cam: cap.cam, event: cap.person ? 'HumanDetect' : 'VideoMotion', alarm_id: cap.id, at: cap.at.toISOString(), bytes: blob.size, [kind]: path };
    if (secs) ev.secs = secs;
    await cs.put(ev);
    cap.cloud = true;
    capHooks.forEach(f => f(cap));
  } catch (e) {
    console.warn('cloud', e);
    if (!cloudWarned) { cloudWarned = true; toast(`Klip Gerak cloud gagal: ${e.message}`); }
  }
}

let personWarned = false;

/** Runs the motion + person detectors on a player's video. onMotion(on, person) for the red frame / badge.
 *  An event starts on pixel motion or on a moving person and ends 6 s after both went quiet; its clip (pre-roll
 *  included) is at most CLIP_MAX long. */
function attachWatch(player, overlay, { onMotion = () => {} } = {}) {
  const dev = player.dev, video = player.video;
  let cfg = watchCfg(), ev = null, live = false, people = [], personAt = 0, endT = null;
  const POST = 6000;
  const w = new Watcher(video, overlay, {
    level: cfg.level, post: 6, max: CLIP_MAX / 1000,
    onStart: boxes => { eye.urgent(); if (!ev) begin(boxes, false); }, onEnd: () => maybeEnd(),
  });
  const eye = new PersonEye(video, {
    level: cfg.orang,
    onPeople: (list, moving) => {
      people = list; w.setPeople(list);
      if (!moving || !live) return;
      personAt = performance.now();
      if (!ev) begin(personBoxes(list), true);
      // motion event that just began turns out to be a person: label it so (photo waits for this)
      else if (!ev.cap.person && personAt - ev.since < 1600) { ev.cap.person = true; onMotion(true, true); }
    },
    onError: e => { if (!personWarned) { personWarned = true; toast(e.message); } },
  });
  const pre = new PreRoll(video, { pre: cfg.pre, bits: player.stream === '0' ? 3e6 : 1.2e6 });
  const on = () => cfg.level !== 'off', onP = () => cfg.orang !== 'off';

  const maybeEnd = () => {
    if (!ev) return;
    const now = performance.now();
    if (now - ev.since > CLIP_MAX - ev.pre || (!w.active && now - personAt > POST)) end();
  };
  const begin = async (boxes, person) => {
    const at = new Date(), cap = { id: `web-${at.getTime()}`, sn: dev.sn, cam: dev.name, at, person };
    const rec = cfg.vid ? pre.keep() : null;
    const e = ev = { cap, rec, since: performance.now(), pre: rec ? Date.now() - rec.at : 0 };
    onMotion(true, person);
    clearInterval(endT); endT = setInterval(maybeEnd, 200);
    if (!cfg.foto && !e.rec) return;
    S.caps.unshift(cap);
    for (const old of S.caps.splice(120)) { URL.revokeObjectURL(old.photo); URL.revokeObjectURL(old.video); }
    // pixel motion: give the person detector a moment to say whether it is a person
    if (!person && onP()) for (let k = 0; k < 15 && !cap.person && ev === e; k++) await new Promise(r => setTimeout(r, 100));
    if (cap.person) boxes = personBoxes(people.length ? people : []);
    if (cfg.foto) {
      const blob = await snapshot(video, boxes).catch(() => null);
      if (blob) {
        cap.photo = URL.createObjectURL(blob);
        if (cfg.dl) saveBlob(blob, `${dev.name} ${cap.person ? 'orang' : 'gerak'} ${fileStamp(at)}.jpg`);
        if (cfg.cloud) cloudSave(cap, 'photo', blob, 'image/jpeg');
      }
    }
    capHooks.forEach(f => f(cap));
  };
  const end = async () => {
    onMotion(false, false);
    clearInterval(endT);
    const e = ev; ev = null;
    if (!e?.rec) return;
    const clip = await pre.finish(e.rec);
    if (!clip) return;
    Object.assign(e.cap, { video: URL.createObjectURL(clip.blob), mime: clip.mime, secs: clip.secs, pre: clip.pre });
    capHooks.forEach(f => f(e.cap));
    if (cfg.dl) saveBlob(clip.blob, `${dev.name} ${e.cap.person ? 'orang' : 'gerak'} ${fileStamp(e.cap.at)}.${clip.mime === 'video/mp4' ? 'mp4' : 'webm'}`);
    if (cfg.cloud && clip.mime === 'video/mp4') cloudSave(e.cap, 'video', clip.blob, 'video/mp4', clip.secs);
  };

  const ctl = {
    watcher: w, eye,
    /** New stream is playing: fresh background, fresh recorders. */
    restart() {
      ctl.pause(); live = true;
      if (on()) { w.opt.level = cfg.level; w.start(); }
      if (onP()) { eye.opt.level = cfg.orang; eye.start(); }
      if ((on() || onP()) && cfg.vid) { pre.pre = cfg.pre; pre.start(); }
    },
    pause() { live = false; if (ev) end(); w.stop(); eye.stop(); pre.stop(); },
    stop() { ctl.pause(); onMotion(false, false); },
    reload() { cfg = watchCfg(); if (live) ctl.restart(); },
  };
  player.watcher = ctl;
  return ctl;
}

function setWatch(patch) {
  const c = { ...watchCfg(), ...patch };
  if (patch.level && patch.level !== 'off') c.last = patch.level;
  if (patch.orang && patch.orang !== 'off') c.lastO = patch.orang;
  store.set('watch', c);
  players.forEach(p => p.watcher?.reload());
}

/** Thumbnails of this visit's captures; opens them in the viewer. */
function drawCaps(box, sn) {
  if (!box) return;
  const list = S.caps.filter(c => !sn || c.sn === sn);
  box.innerHTML = list.length ? list.slice(0, 24).map((c, k) => `<button class="capt" data-k="${k}" title="${esc(c.cam)} · ${timeLabel(c.at)}">
      ${c.photo ? `<img src="${c.photo}" alt="">` : ic('film')}
      ${c.video ? `<span class="play">${ic('play')}</span>` : ''}<span class="t">${timeLabel(c.at)}${c.cloud ? ' ☁' : ''}</span></button>`).join('')
    : '<div class="muted small">Belum ada tangkapan. Gerakan berikutnya langsung difoto & direkam di sini.</div>';
  box.querySelectorAll('.capt').forEach(b => b.onclick = () => openViewer(list.map(c => ({
    video: !!c.video, poster: c.photo,
    caption: `${c.person ? 'Orang' : 'Gerak'} · ${c.cam} · ${timeLabel(c.at)}${c.video ? ` · ${Math.round(c.secs)} dtk (mulai ${Math.round(c.pre)} dtk sebelum gerak)` : ''}`,
    file: `${c.cam} gerak ${fileStamp(c.at)}.${c.video ? (c.mime === 'video/webm' ? 'webm' : 'mp4') : 'jpg'}`,
    resolve: async () => c.video || c.photo,
  })), +b.dataset.k));
}

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
  const wc = watchCfg();
  const pad = `<div class="pad">
      <span></span><button class="btn" data-dir="DirectionUp">${ic('up')}</button><span></span>
      <button class="btn" data-dir="DirectionLeft">${ic('left')}</button><span class="c">tahan</span><button class="btn" data-dir="DirectionRight">${ic('right')}</button>
      <button class="btn" data-dir="ZoomWide" title="Perkecil">${ic('minus')}</button><button class="btn" data-dir="DirectionDown">${ic('down')}</button><button class="btn" data-dir="ZoomTile" title="Perbesar">${ic('plus')}</button>
    </div>`;
  $('#main').innerHTML = `
    ${topbar(esc(d.name), `
      ${others.length ? `<div class="scroller">${others.map(o => `<button class="chip" data-sn="${esc(o.sn)}">${ic('cam')}${esc(o.name)}</button>`).join('')}</div>` : ''}
      <button class="btn icon ${store.get('panelOff', false) ? '' : 'on'}" id="pt" title="Panel kontrol">${ic('sliders')}</button>`,
      `<button class="btn icon" id="bk" title="Kembali">${ic('back')}</button>`)}
    <div class="live ${store.get('panelOff', false) ? 'nopanel' : ''}" id="live">
      <div class="stage" id="stage">
        <video id="vid" playsinline muted autoplay></video>
        <canvas class="ov" id="ov"></canvas>
        <div class="tl"><button class="btn icon lback" id="bk2" title="Kembali">${ic('back')}</button>
          <span class="badge" id="lb"><i class="dot"></i><span>…</span></span></div>
        <div class="msg" id="msg"><div><div class="spin"></div><div id="msgt">Menyambung…</div></div></div>
        <div class="opad">${pad}</div>
        <div class="hud">
          <button class="btn icon" id="snd" title="Suara">${ic('mute')}</button>
          <select id="q" title="Kualitas">
            <option value="auto">Auto</option><option value="0">HD</option><option value="1">SD</option>
          </select>
          <span class="spacer"></span>
          <button class="btn icon ptzb" id="ptzb" title="Gerak kamera">${ic('move')}</button>
          <button class="btn icon ${wc.level !== 'off' ? 'on' : ''}" id="wt" title="Deteksi gerak (sorot, foto & video otomatis)">${ic('radar')}</button>
          <button class="btn icon" id="shot" title="Foto">${ic('shot')}</button>
          <button class="btn icon" id="rec" title="Rekam">${ic('rec')}</button>
          <button class="btn icon" id="fill" title="Isi layar">${ic('grid')}</button>
          <button class="btn icon" id="fs" title="Layar penuh">${ic('full')}</button>
        </div>
      </div>
      <div class="glass panel">
        <h3 class="pt-title">Gerak kamera</h3>
        <div class="ptz">${pad}</div>
        <label class="field"><span>Arah kontrol</span>
          <select class="input" id="inv">${Object.entries(INVERT).map(([k, v]) => `<option value="${k}" ${+k === inv ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Lampu malam</span>
          <select class="input" id="light" disabled><option>Memuat…</option></select></label>
        <details id="wd" open><summary>Deteksi gerak</summary>
          <div class="wset">
            <div class="muted small">Gerakan (piksel)</div>
            <div class="seg" id="wl">${[['off', 'Mati'], ...Object.entries(LEVELS).map(([k, v]) => [k, v.name])].map(([k, v]) => `<button data-wl="${k}" class="${wc.level === k ? 'on' : ''}">${v}</button>`).join('')}</div>
            <div class="muted small">Orang bergerak (AI di browser, semua kamera)</div>
            <div class="seg" id="po">${[['off', 'Mati'], ...Object.entries(PLEVELS).map(([k, v]) => [k, v.name])].map(([k, v]) => `<button data-po="${k}" class="${wc.orang === k ? 'on' : ''}">${v}</button>`).join('')}</div>
            <label class="tog"><input type="checkbox" data-w="foto" ${wc.foto ? 'checked' : ''}><span>Foto otomatis + kotak sorot</span></label>
            <label class="tog"><input type="checkbox" data-w="vid" ${wc.vid && PreRoll.supported() ? 'checked' : ''} ${PreRoll.supported() ? '' : 'disabled'}><span>Video otomatis, mulai
              ${PRE} dtk sebelum gerak, maks. ${CLIP_MAX / 1000} dtk${PreRoll.supported() ? '' : ' (tidak didukung browser ini)'}</span></label>
            <label class="tog"><input type="checkbox" data-w="cloud" ${wc.cloud ? 'checked' : ''}><span>Simpan ke Klip Gerak (cloud)</span></label>
            <label class="tog"><input type="checkbox" data-w="dl" ${wc.dl ? 'checked' : ''}><span>Unduh otomatis ke perangkat ini</span></label>
            <div class="caps" id="caps"></div>
          </div></details>
        <details id="sensd" ${innerWidth > 820 ? 'open' : ''}><summary>Sensor kamera</summary>
          <div class="wset">
            <div class="seg" id="sens">${Object.entries(SENS).map(([k, v]) => `<button data-sens="${k}" disabled>${v.name}</button>`).join('')}</div>
            <div class="muted small" id="sensinfo">Memuat…</div>
            <button class="btn" id="sensall">${ic('radar')}<span>Agresif di semua kamera</span></button>
          </div></details>
        <details id="favd" ${innerWidth > 820 ? 'open' : ''}><summary>Posisi favorit</summary>
          <div style="display:grid;gap:6px">
            <button class="btn" id="addp">${ic('star')}<span>Simpan posisi ini</span></button>
            <div id="presets" class="muted small">Memuat…</div>
          </div></details>
        <div class="muted small" id="info"></div>
      </div>
    </div>`;
  $('#bk').onclick = $('#bk2').onclick = () => go('cams');
  document.querySelectorAll('.top .chip').forEach(c => c.onclick = () => go('live', c.dataset.sn));
  $('#pt').onclick = () => {
    const off = !$('#live').classList.contains('nopanel');
    $('#live').classList.toggle('nopanel', off); $('#pt').classList.toggle('on', !off); store.set('panelOff', off);
  };

  const video = $('#vid'), stage = $('#stage');
  const setMsg = (text, spin = true) => {
    $('#msg').hidden = !text;
    if (text) $('#msg').innerHTML = `<div>${spin ? '<div class="spin"></div>' : ''}<div>${esc(text)}</div></div>`;
  };
  let player, autoDowngrade = 0, waits = [];
  const label = () => {
    const q = player.stream === '0' ? 'Full HD' : 'SD';
    const lag = player.lag != null ? ` · jeda ${player.lag.toFixed(1)} dtk` : '';
    const mo = stage.classList.contains('person') ? '<b class="mo">● ORANG</b>' : stage.classList.contains('motion') ? '<b class="mo">● GERAK</b>' : '';
    $('#lb').innerHTML = `<i class="dot online"></i><span>LIVE · ${q} · ${player.mode === 'flv' ? 'Cepat' : 'Stabil'}${lag}</span>${mo}`;
  };
  const startPlayer = (stream) => {
    player?.stop();
    player = new LivePlayer(video, d, {
      stream, muted: player ? player.muted : true,
      onState: (s, x) => {
        stage.classList.toggle('wait', s === 'connect' || s === 'retry');
        if (s === 'connect') { setMsg(x); $('#lb').innerHTML = '<i class="dot sleeping"></i><span>Menyambung</span>'; }
        if (s === 'retry') { setMsg(x); $('#lb').innerHTML = '<i class="dot offline"></i><span>Terputus</span>'; }
        if (s === 'play') { setMsg(null); label(); }
        if (s === 'tick') label();
        if (s === 'blocked') setMsg('Ketuk layar untuk memutar', false);
      },
    });
    attachWatch(player, $('#ov'), { onMotion: (m, pp) => { stage.classList.toggle('motion', m); stage.classList.toggle('person', !!(m && pp)); label(); } });
    player.start();
  };
  const q0 = quality === 'auto' ? (Math.min(innerWidth, innerHeight) < 600 ? '1' : '0') : quality;
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
  $('#ptzb').onclick = () => { stage.classList.toggle('ptz'); $('#ptzb').classList.toggle('on'); };
  $('#fs').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => video.webkitEnterFullscreen?.());
    else video.webkitEnterFullscreen?.();
  };
  // tap the picture to hide / show the controls
  stage.addEventListener('click', e => { if (!e.target.closest('button, select, .opad')) stage.classList.toggle('hud-off'); });
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
  document.querySelectorAll('.pad [data-dir]').forEach(b => {
    let active = null;
    const down = ev => {
      ev.preventDefault(); b.setPointerCapture?.(ev.pointerId);
      active = mapDir(b.dataset.dir, invert); b.classList.add('held');
      player.watcher?.watcher.hold(60000);
      api.ptz(d, active, false).catch(handleErr);
    };
    const up = () => {
      if (!active) return;
      const dir = active; active = null; b.classList.remove('held');
      setTimeout(() => api.ptz(d, dir, true).catch(() => {}), 120);
      player.watcher?.watcher.hold(2500);
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
  // Motion watcher settings + captures
  const wt = () => { const c = watchCfg(); $('#wt').classList.toggle('on', c.level !== 'off'); document.querySelectorAll('[data-wl]').forEach(b => b.classList.toggle('on', b.dataset.wl === c.level)); };
  $('#wt').onclick = () => { const c = watchCfg(); setWatch({ level: c.level === 'off' ? c.last || 'agresif' : 'off' }); wt(); toast(watchCfg().level === 'off' ? 'Deteksi gerak dimatikan' : `Deteksi gerak: ${LEVELS[watchCfg().level].name}`); };
  document.querySelectorAll('[data-wl]').forEach(b => b.onclick = () => { setWatch({ level: b.dataset.wl }); wt(); });
  document.querySelectorAll('[data-po]').forEach(b => b.onclick = () => {
    setWatch({ orang: b.dataset.po });
    document.querySelectorAll('[data-po]').forEach(x => x.classList.toggle('on', x === b));
  });
  document.querySelectorAll('input[data-w]').forEach(i => i.onchange = () => setWatch({ [i.dataset.w]: i.checked }));
  const capsBox = $('#caps'), onCap = c => { if (!$('#caps')) return capHooks.delete(onCap); if (c.sn === d.sn) drawCaps(capsBox, d.sn); };
  capHooks.add(onCap);
  drawCaps(capsBox, d.sn);

  // Camera's own detectors (cloud config)
  const sensDraw = s => {
    if (!$('#sens')) return;
    document.querySelectorAll('[data-sens]').forEach(b => { b.disabled = false; b.classList.toggle('on', b.dataset.sens === s.preset); });
    const hum = ['rendah', 'sedang', 'tinggi'][s.human];
    $('#sensinfo').innerHTML = !s.on ? 'Deteksi gerak kamera <b>mati</b>.' : `Gerak level <b>${s.level}/6</b> · jeda alarm ${s.latch ?? '?'} dtk`
      + `${hum ? ` · manusia ${hum}` : ''}${s.box ? ' · kotak manusia di video' : ''}${s.track != null ? ` · ikuti objek ${s.tracking ? 'nyala' : 'mati'}` : ''}`;
  };
  api.sensitivity(d).then(sensDraw).catch(() => { if ($('#sensinfo')) $('#sensinfo').textContent = 'Tidak tersedia untuk kamera ini'; });
  document.querySelectorAll('[data-sens]').forEach(b => b.onclick = async () => {
    document.querySelectorAll('[data-sens]').forEach(x => x.disabled = true);
    try { sensDraw(await api.setSensitivity(d, b.dataset.sens)); toast(`Sensor kamera: ${SENS[b.dataset.sens].name}`); }
    catch (e) { handleErr(e); document.querySelectorAll('[data-sens]').forEach(x => x.disabled = false); }
  });
  $('#sensall').onclick = async () => {
    const btn = $('#sensall'); btn.disabled = true;
    let ok = 0;
    for (const x of S.devices) {
      btn.querySelector('span').textContent = `Mengatur ${x.name}…`;
      try { const s = await api.setSensitivity(x, 'agresif'); ok++; if (x.sn === d.sn) sensDraw(s); } catch (e) { console.warn(e); }
    }
    if (!$('#sensall')) return;
    btn.disabled = false; btn.querySelector('span').textContent = 'Agresif di semua kamera';
    toast(`Sensor Agresif aktif di ${ok} dari ${S.devices.length} kamera`);
  };
  $('#info').textContent = `SN ${d.sn}`;
}

function fileStamp(t = new Date()) {
  const p = n => String(n).padStart(2, '0');
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
  const n = store.get('multiN', 2), cover = store.get('multiCover', false);
  const cams = S.devices.slice(0, n * n);
  // fill the screen: columns/rows from the cameras actually shown, phones in portrait scroll 1–2 columns
  const cols = n === 1 ? 1 : Math.min(n, Math.ceil(Math.sqrt(cams.length))), rows = Math.ceil(cams.length / cols) || 1;
  $('#main').innerHTML = `
    ${topbar('Multi Layar', `
      <button class="btn icon ${watchCfg().orang !== 'off' ? 'on' : ''}" id="mo" title="Deteksi orang bergerak (AI) di semua layar">${ic('user')}</button>
      <button class="btn icon ${watchCfg().level !== 'off' ? 'on' : ''}" id="mw" title="Deteksi gerak di semua layar">${ic('radar')}</button>
      <button class="btn icon ${cover ? 'on' : ''}" id="mc" title="Isi penuh (potong tepi)">${ic('full')}</button>
      <div class="seg">${[1, 2, 3].map(k => `<button data-n="${k}" class="${k === n ? 'on' : ''}">${k === 1 ? '1' : `${k}×${k}`}</button>`).join('')}</div>`)}
    <div class="multi ${cover ? 'cover' : ''}" style="--mcols:repeat(${cols},minmax(0,1fr));--mrows:repeat(${rows},minmax(0,1fr));--pcols:repeat(${n === 1 ? 1 : 2},minmax(0,1fr))">${cams.map(d => `
      <div class="tile" data-sn="${esc(d.sn)}"><video playsinline muted autoplay></video><canvas class="ov"></canvas>
        <span class="badge"><i class="dot"></i>${esc(d.name)}</span></div>`).join('')}</div>
    <button class="btn icon mexit" data-go="cams" title="Tutup">${ic('x')}</button>`;
  document.querySelectorAll('.seg [data-n]').forEach(b => b.onclick = () => { store.set('multiN', +b.dataset.n); route(); });
  $('#mc').onclick = () => { const on = !$('.multi').classList.contains('cover'); $('.multi').classList.toggle('cover', on); $('#mc').classList.toggle('on', on); store.set('multiCover', on); };
  $('.mexit').onclick = () => go('cams');
  $('#mo').onclick = () => {
    const c = watchCfg();
    setWatch({ orang: c.orang === 'off' ? c.lastO || 'agresif' : 'off' });
    $('#mo').classList.toggle('on', watchCfg().orang !== 'off');
    toast(watchCfg().orang === 'off' ? 'Deteksi orang dimatikan' : `Deteksi orang ${PLEVELS[watchCfg().orang].name} di semua layar`);
  };
  $('#mw').onclick = () => {
    const c = watchCfg();
    setWatch({ level: c.level === 'off' ? c.last || 'agresif' : 'off' });
    $('#mw').classList.toggle('on', watchCfg().level !== 'off');
    toast(watchCfg().level === 'off' ? 'Deteksi gerak dimatikan' : `Deteksi gerak ${LEVELS[watchCfg().level].name} di semua layar`);
  };
  document.querySelectorAll('.tile').forEach(t => {
    const d = devBySn(t.dataset.sn), dot = t.querySelector('.dot');
    const p = new LivePlayer(t.querySelector('video'), d, {
      stream: n === 1 ? '0' : '1',
      onState: s => {
        dot.className = 'dot ' + (s === 'play' || s === 'tick' ? 'online' : s === 'retry' ? 'offline' : 'sleeping');
        t.classList.toggle('wait', s === 'connect' || s === 'retry');
      },
    });
    attachWatch(p, t.querySelector('.ov'), { onMotion: (m, pp) => { t.classList.toggle('motion', m); t.classList.toggle('person', !!(m && pp)); } });
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
    if (a === 'x') {
      document.removeEventListener('keydown', key);
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }
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
    ${topbar('Pesan', `<div class="seg" id="df">${[[1, '24 jam'], [3, '3 hari'], [7, '7 hari']].map(([k, v]) => `<button data-d="${k}" class="${k === days ? 'on' : ''}">${v}</button>`).join('')}</div>
      <button class="btn icon" id="rf" title="Segarkan">${ic('refresh')}</button>`)}
    <div class="toolbar">
      <div class="chips" id="cf">${[['all', 'Semua'], ...S.devices.map(d => [d.sn, d.name])].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(v)}</button>`).join('')}</div>
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
  if (!CloudStore.isValidKey(store.get('cloudKey', ''))) {
    main.innerHTML = `${topbar('Klip Gerak')}<div class="empty glass">Membuka Klip Gerak…</div>`;
    if (!S.devices.length) await refreshDevices();
    if (await ensureCloudKey()) { prefsSync(); if (S.view === 'klip') route(); return; }
    if (S.view !== 'klip') return;
  }
  const key = store.get('cloudKey', '');
  if (!CloudStore.isValidKey(key)) {
    main.innerHTML = `
      ${topbar('Klip Gerak')}
      <form class="glass" id="kf" style="padding:20px;display:grid;gap:12px;max-width:620px">
        <b>Hubungkan Klip Gerak</b>
        <div class="muted small">Klip video tiap gerakan direkam oleh aplikasi Pantau di Mac dan disimpan di cloud.
          Untuk melihatnya di sini, salin <b>kunci cloud</b> dari aplikasi Mac: <b>Saya › Cloud › tampilkan kunci</b> (64 huruf/angka),
          lalu tempel di bawah. Kunci bawaan akun ini terbuka otomatis setelah masuk.</div>
        <input class="input" name="k" placeholder="kunci cloud 64 karakter" autocomplete="off" spellcheck="false">
        <div class="err" id="kerr"></div>
        <div class="row"><button class="btn primary">Hubungkan</button>
          ${store.get('cloudOff', false) ? '<button class="btn" type="button" id="kauto">Pakai kunci bawaan</button>' : ''}</div>
      </form>`;
    $('#kf').onsubmit = async e => {
      e.preventDefault();
      const k = new FormData(e.target).get('k').trim().toLowerCase();
      if (!CloudStore.isValidKey(k)) { $('#kerr').textContent = 'Kunci harus 64 karakter hex (0-9, a-f).'; return; }
      try { await new CloudStore(k).list({ limit: 1 }); store.set('cloudKey', k); store.raw('cloudOff', null); route(); prefsSync(); }
      catch (err) { $('#kerr').textContent = err.message; }
    };
    $('#kauto') && ($('#kauto').onclick = () => { store.raw('cloudOff', null); route(); });
    return;
  }
  const cs = new CloudStore(key);
  let rows = [], used = 0, quota = 0, count = 0, thumbs = {}, filter = store.get('klipCam', 'all');
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
    $('#usage').textContent = `${count} kejadian · ${fmtBytes(used)} dari ${fmtBytes(quota)}`;
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
      if (!before) { used = page.used; quota = page.quota; } count = page.count;
      const paths = [...new Set(page.rows.map(r => r.alarm_photo || r.photo).filter(Boolean))];
      draw();
      for (let i = 0; i < paths.length; i += 100) Object.assign(thumbs, await cs.signedURLs(paths.slice(i, i + 100)));
      if (S.view === 'klip') draw();
    } catch (e) { $('#out').innerHTML = `<div class="empty glass">${esc(e.message)}</div>`; }
  };
  main.innerHTML = `
    ${topbar('Klip Gerak', `<button class="btn icon" id="rf" title="Segarkan">${ic('refresh')}</button>`)}
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
  const theme = store.get('theme', 'auto'), skin = store.get('skin', 'kaca'), glass = store.get('glass', 'sedang');
  const mode = store.get('mode', 'auto'), key = store.get('cloudKey', '');
  const keys = S.session.keys, dark = document.documentElement.dataset.theme === 'dark';
  const swatch = c => `radial-gradient(70% 90% at 15% 25%, ${c[0]}, transparent 70%), radial-gradient(60% 90% at 85% 15%, ${c[1]}, transparent 70%),
    radial-gradient(70% 90% at 60% 110%, ${c[2]}, transparent 70%), linear-gradient(${c[3]}22, ${c[3]}22), ${dark ? '#0b1018' : '#eef2f7'}`;
  const auto = mode === 'auto' ? (liveMode() === 'flv' ? 'sekarang: Cepat' : 'sekarang: Stabil') : '';
  $('#main').innerHTML = `
    ${topbar('Saya')}
    <div class="settings">
      <div class="glass">
        <h3>Akun</h3>
        <div class="row"><div><b>${esc(S.session.account)}</b><div class="muted small">${S.devices.length} kamera</div></div>
          <span class="spacer"></span><button class="btn danger" id="lo">${ic('logout')}<span>Keluar</span></button></div>
      </div>
      <div class="glass">
        <h3>Tema Liquid Glass</h3>
        <div class="seg" id="th">${[['auto', 'Otomatis'], ['light', 'Terang'], ['dark', 'Gelap']].map(([k, v]) => `<button data-t="${k}" class="${k === theme ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div class="skins">${Object.entries(SKINS).map(([k, s]) => `<button class="skin ${k === skin ? 'on' : ''}" data-skin="${k}">
          <i style="background:${swatch(s[dark ? 'dark' : 'light'])}"></i><span>${s.name}</span></button>`).join('')}</div>
        <div class="row"><span class="small muted">Efek kaca</span>
          <div class="seg" id="gl">${[['halus', 'Halus'], ['sedang', 'Sedang'], ['kuat', 'Kuat']].map(([k, v]) => `<button data-g="${k}" class="${k === glass ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      </div>
      <div class="glass">
        <h3>Mode live</h3>
        <div class="seg" id="md">${[['auto', 'Otomatis'], ['flv', 'Cepat ± 2 dtk'], ['hls', 'Stabil ± 5 dtk']].map(([k, v]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${v}</button>`).join('')}</div>
        <div class="muted small">${auto ? `<b>${auto}.</b> ` : ''}Cepat = video H.265 asli kamera (Chrome / Edge di komputer & Android${hevcMSE() ? '' : '; <b style="color:var(--warn)">browser ini tidak bisa</b>'}).
          Stabil = diubah ke H.264 oleh server iCSee, lancar di semua browser termasuk iPhone/iPad & Safari, tertinggal beberapa detik.
          ${isWebKit ? '<br>Browser ini memakai mesin Safari: mode Cepat sering macet di sini, jadi Otomatis memakai Stabil.' : ''}</div>
      </div>
      <div class="glass">
        <h3>Klip Gerak (cloud)</h3>
        ${CloudStore.isValidKey(key) ? `<div class="row"><code class="k">${key.slice(0, 8)}••••••••${key.slice(-4)}</code><span class="spacer"></span>
          <button class="btn danger" id="ck">Putuskan</button></div>
          <div class="muted small">Semua setelan di situs ini tersimpan otomatis ke cloud dan ikut di browser / perangkat lain${prefsState === 'err' ? ' — <b style="color:var(--warn)">gagal sinkron, dicoba lagi saat ada perubahan</b>' : ''}.</div>`
          : '<div class="muted small">Belum terhubung — buka tab Klip Gerak.</div>'}
      </div>
      <div class="glass">
        <h3>Kunci platform</h3>
        <div class="muted small">AppKey <code class="k">${esc(keys.appKey.slice(0, 6))}…</code> ·
          ${keys.appKey === PUBLIC_KEYS.appKey ? 'kunci demo publik JFTech' : 'kunci sendiri'} — ubah saat masuk (Kunci platform).</div>
      </div>
      <div class="muted small">Pantau web · terhubung langsung ke cloud iCSee (rs.xmeye.net · api.jftechws.com). Tidak ada server perantara.
        Bicara/interkom & perekam latar belakang hanya ada di aplikasi Mac. Tekan <b>\\</b> untuk menyembunyikan / membuka menu samping.</div>
    </div>`;
  document.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { store.set('skin', b.dataset.skin); applyTheme(); route(); });
  document.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { store.set('glass', b.dataset.g); applyTheme(); route(); });
  $('#lo').onclick = () => { if (confirm('Keluar dari akun ini di browser ini?')) logout(false); };
  document.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { store.set('theme', b.dataset.t); applyTheme(); route(); });
  document.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { store.set('mode', b.dataset.m); route(); });
  $('#ck') && ($('#ck').onclick = () => { store.raw('cloudKey', null); store.raw('cloudOff', true); route(); });
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
    sensitivity: async () => ({ on: true, level: 6, latch: 0, human: 2, box: true, track: 2, tracking: false, preset: 'agresif' }),
    setSensitivity: async (d, k) => ({ on: true, level: SENS[k].level, latch: SENS[k].latch, human: SENS[k].human, box: SENS[k].box, track: SENS[k].track, tracking: false, preset: k }),
  });
}

// ---------- boot ----------

window.__pantau = { S, api: () => api, LivePlayer, players, hevcMSE, ensureCloudKey, prefsSync, store };
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistrations?.().then(r => r.forEach(x => x.unregister())).catch(() => {});
route();
if (S.session && S.session.token !== 'demo') cloudReady();
