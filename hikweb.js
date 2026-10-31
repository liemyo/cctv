// Hik-Connect part of the site (own menu, separate from iCSee). Hik-Connect's cloud has no browser API,
// so everything goes through the small relay on the Mac (hik-relay/), reached over a Cloudflare quick tunnel.
// The relay's address sits in the CCTV cloud folder; the access key is derived from the Klip Gerak key.
import { sha256Hex } from './core.js?v=8';

export function installHik(x) {
  const { $, esc, ic, topbar, store, toast, go, route, LivePlayer, within, fileStamp, saveBlob, openViewer, dayLabel, timeLabel, S, cloud, ensureCloudKey } = x;

  // ---------- relay connection ----------

  const R = { base: null, key: null, hello: null, err: null, devices: store.get('hikDevices', []), t: 0 };
  let finding = null;

  async function relayKey() {
    await ensureCloudKey().catch(() => false);
    const k = store.get('cloudKey', '');
    if (!/^[0-9a-f]{64}$/.test(k)) throw new Error('Kunci cloud CCTV belum terbuka — masuk iCSee dulu');
    return R.key ||= await sha256Hex('hik-relay|' + k);
  }

  async function find(force = false) {
    if (R.base && !force) return R.base;
    finding ||= (async () => {
      const key = await relayKey();
      const over = new URLSearchParams(location.search).get('relay') || store.get('hikRelayOver', null);
      const cand = [];
      if (over) cand.push(over.replace(/\/$/, ''));
      const cached = store.get('hikRelay', null);
      if (cached?.url && !force) cand.push(cached.url);
      const cs = cloud();
      let doc = null;
      if (cs) { doc = await cs.getDoc('hik-relay').catch(() => null); if (doc?.url) { cand.push(doc.url); store.raw('hikRelay', { url: doc.url, t: doc.t }); } }
      for (const u of [...new Set(cand)]) {
        try {
          const r = await fetch(`${u}/api/hello`, { headers: { 'x-hik-key': key }, signal: AbortSignal.timeout(9000) });
          if (r.status === 401) throw new Error('kunci');
          const j = await r.json();
          if (j.ok) { R.base = u; R.hello = j; R.err = null; return u; }
        } catch {}
      }
      R.base = null;
      R.err = !doc ? 'Relay Hik-Connect belum pernah aktif di Mac.' : `Relay di Mac tidak bisa dihubungi (Mac mati, tidur, atau tanpa internet). Terakhir aktif ${new Date(doc.t).toLocaleString('id-ID')}.`;
      throw new Error(R.err);
    })().finally(() => { finding = null; });
    return finding;
  }

  async function req(path, { method = 'GET', body, timeout = 30000, retry = true } = {}) {
    const base = await find();
    try {
      const r = await fetch(base + path, {
        method, signal: AbortSignal.timeout(timeout),
        headers: { 'x-hik-key': R.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || j.message || `Relay ${r.status}`), { code: j.code, status: r.status });
      return j;
    } catch (e) {
      if (retry && (e.name === 'TypeError' || e.name === 'TimeoutError') && !e.status) { R.base = null; return req(path, { method, body, timeout, retry: false }); }
      throw e;
    }
  }

  const qs = o => new URLSearchParams(o).toString();
  const api = {
    devices: async (force) => {
      const j = await req(`/api/devices${force ? '?force=1' : ''}`);
      R.devices = j.devices; R.t = Date.now();
      store.raw('hikDevices', j.devices);
      return j.devices;
    },
    open: (sn, ch, q) => req(`/api/open?${qs({ sn, ch, q })}`, { timeout: 40000 }),
    // video goes over wss: the quick tunnel holds back streamed HTTP bodies but passes WebSocket frames through
    liveURL: (sn, ch, q) => `${R.base.replace(/^http/, 'ws')}/live.ws?${qs({ sn, ch, q, k: R.key })}`,
    playURL: (sn, ch, begin, end) => `${R.base.replace(/^http/, 'ws')}/play.ws?${qs({ sn, ch, begin, end, k: R.key })}`,
    snapURL: (sn, ch, max = 60) => `${R.base}/snap.jpg?${qs({ sn, ch, max, k: R.key })}`,
    ptz: (sn, ch, cmd, action, speed = 4) => req('/api/ptz', { method: 'POST', body: { sn, ch, cmd, action, speed } }),
    setKey: (sn, code) => req('/api/key', { method: 'POST', body: { sn, code } }),
    messages: (o) => req(`/api/messages?${qs(o)}`),
    records: (sn, ch, start, stop) => req(`/api/records?${qs({ sn, ch, start, stop })}`),
    status: () => req('/api/status'),
  };

  const dev = sn => R.devices.find(d => d.sn === sn);
  const parseId = id => { const [sn, ch] = String(id || '').split('.'); return { sn, ch: Number(ch) || 1 }; };
  const chName = (d, ch) => d?.channels.find(c => c.ch === ch)?.name || `Kamera ${ch}`;
  const allCams = () => R.devices.flatMap(d => d.channels.map(c => ({ d, c })));

  // ---------- player (relay FLV; never falls back to the iCSee HLS relay) ----------

  class HikPlayer extends LivePlayer {
    constructor(video, sn, ch, opts) {
      super(video, { sn: `${sn}.${ch}`, name: chName(dev(sn), ch) }, opts);
      Object.assign(this, { hsn: sn, hch: ch, mode: 'flv', flvOnly: true, edgeMax: 6, edgeKeep: 1.2, stillMax: 9 });
    }
    async start() {
      this.teardown();
      this.stopped = false; this.alive = Date.now();
      const gen = this.gen = (this.gen || 0) + 1;
      this.onState('connect', 'Menyambung ke Hik-Connect…');
      try {
        const r = await within(api.open(this.hsn, this.hch, this.stream === '0' ? 'main' : 'sub'), 45000, 'Relay tidak menjawab');
        if (gen !== this.gen || this.stopped) return;
        if (!r.ok) {
          if (r.code === 'KEY') { this.stopped = true; this.onState('key', r.message); return; }
          // a numeric code is the video server refusing this camera (offline, unplugged): retrying won't help
          if (typeof r.code === 'number' && r.code !== 10001) { this.stopped = true; this.onState('off', r.message); return; }
          throw new Error(r.message || 'Kamera tidak mengirim gambar');
        }
        this.info = r;
        this.playFLV(api.liveURL(this.hsn, this.hch, this.stream === '0' ? 'main' : 'sub'));
        this.watch(gen);
      } catch (e) {
        if (gen !== this.gen || this.stopped) return;
        this.fails++;
        this.retry(e?.message || 'Gagal menyambung');
      }
    }
    playFLV(url) {
      const p = this.mp = mpegts.createPlayer({ type: 'flv', isLive: true, url, hasAudio: false, hasVideo: true }, {
        enableWorker: false, enableStashBuffer: false, lazyLoad: false, liveBufferLatencyChasing: false, liveSync: false,
        autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 30, autoCleanupMinBackwardDuration: 15,
      });
      p.on(mpegts.Events.ERROR, (type, detail) => { this.fails++; this.retry(`Siaran terputus (${detail || type})`); });
      p.attachMediaElement(this.video);
      p.load();
    }
  }

  // ---------- pages ----------

  const relayBox = (msg) => `<div class="empty glass hrelay">${ic('cam')}<div><b>Hik-Connect belum tersambung</b>
    <div class="muted small">${esc(msg || R.err || 'Mencari relay…')}</div>
    <div class="muted small">Relay berjalan otomatis di MacBook (hik-relay). Pastikan MacBook menyala & online.</div>
    <button class="btn" id="hretry">${ic('refresh')}<span>Coba lagi</span></button></div></div>`;
  const bindRetry = () => { const b = $('#hretry'); if (b) b.onclick = () => { R.base = null; route(); }; };

  const thumbs = new Map(); // id → {url, t}
  let thumbQ = [], thumbBusy = 0;
  function thumb(img) {
    const id = img.dataset.thumb, have = thumbs.get(id);
    if (have) img.src = have.url;
    if (have && Date.now() - have.t < 120e3) return;
    thumbQ.push(img); pump();
  }
  function pump() {
    while (thumbBusy < 4 && thumbQ.length) {
      const img = thumbQ.shift(), id = img.dataset.thumb, { sn, ch } = parseId(id);
      if (!img.isConnected) continue;
      thumbBusy++;
      fetch(api.snapURL(sn, ch), { signal: AbortSignal.timeout(30000) }).then(r => r.ok ? r.blob() : null).then(b => {
        if (!b) return;
        const old = thumbs.get(id); if (old) URL.revokeObjectURL(old.url);
        const url = URL.createObjectURL(b);
        thumbs.set(id, { url, t: Date.now() });
        document.querySelectorAll(`img[data-thumb="${CSS.escape(id)}"]`).forEach(i => { i.src = url; i.closest('.thumb')?.classList.add('has'); });
      }).catch(() => {}).finally(() => { thumbBusy--; pump(); });
    }
  }
  // observe the card's .thumb box: an <img> without src is display:none and never intersects
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); const i = e.target.querySelector('img[data-thumb]'); if (i) thumb(i); } }), { rootMargin: '200px' });

  function chCard(d, c) {
    const id = `${d.sn}.${c.ch}`, off = !d.online || c.online === false;
    return `<button class="cam glass" data-hid="${esc(id)}">
      <div class="thumb">${ic('cam')}<img data-thumb="${esc(id)}" alt="" ${thumbs.get(id) ? `src="${thumbs.get(id).url}"` : ''}>
        <span class="badge"><i class="dot ${off ? 'offline' : 'online'}"></i>${off ? 'Offline' : 'Online'}</span>
        ${c.locked ? '<span class="badge lock">Terkunci</span>' : ''}</div>
      <div class="meta"><div><b>${esc(c.name)}</b><div class="sn">CH ${c.ch}</div></div><span class="spacer"></span>${ic('right')}</div>
    </button>`;
  }

  async function viewDevices() {
    const main = $('#main');
    let open = store.get('hikOpen', {});
    const draw = () => {
      main.innerHTML = `
        ${topbar('Hik-Connect', `${R.hello ? `<span class="chip on hc">${ic('user')}${esc(R.hello.account || '')}</span>` : ''}
          <button class="btn lbl" id="rf" title="Segarkan">${ic('refresh')}<span>Segarkan</span></button>`)}
        ${R.base || R.devices.length ? `<div class="hdevs">${R.devices.map(d => `
          <section class="glass hdev ${open[d.sn] === false ? 'shut' : ''}" data-sn="${esc(d.sn)}">
            <header>
              <button class="htog" data-tog="${esc(d.sn)}">${ic('down')}</button>
              <div class="hname"><b>${esc(d.name)}</b><span class="muted small"><i class="dot ${d.online ? 'online' : 'offline'}"></i>
                ${d.online ? 'Online' : 'Offline'} · ${esc(d.model || 'NVR')} · ${d.channels.length} kamera · ${esc(d.sn)}</span></div>
              <span class="spacer"></span>
              <button class="btn lbl" data-multi="${esc(d.sn)}">${ic('grid')}<span>Multi</span></button>
              <button class="btn lbl" data-play="${esc(d.sn)}">${ic('film')}<span>Putar ulang</span></button>
            </header>
            <div class="grid">${d.channels.map(c => chCard(d, c)).join('') || '<div class="muted small">Tidak ada kamera.</div>'}</div>
          </section>`).join('')}</div>` : ''}
        ${!R.base ? relayBox() : !R.devices.length ? `<div class="empty glass">${esc(R.devErr || 'Memuat perangkat Hik-Connect…')}</div>` : ''}`;
      bindRetry();
      main.querySelectorAll('[data-hid]').forEach(b => b.onclick = () => go('hiklive', b.dataset.hid));
      main.querySelectorAll('[data-multi]').forEach(b => b.onclick = () => { store.set('hikMultiSn', b.dataset.multi); go('hikmulti'); });
      main.querySelectorAll('[data-play]').forEach(b => b.onclick = () => go('hikplay', `${b.dataset.play}.${dev(b.dataset.play)?.channels[0]?.ch || 1}`));
      main.querySelectorAll('[data-tog]').forEach(b => b.onclick = () => {
        const sec = b.closest('.hdev'), shut = !sec.classList.contains('shut');
        sec.classList.toggle('shut', shut); open[b.dataset.tog] = !shut; store.set('hikOpen', open);
      });
      main.querySelectorAll('img[data-thumb]').forEach(i => { i.onerror = () => i.removeAttribute('src'); if (R.base) io.observe(i.closest('.thumb') || i); });
      $('#rf').onclick = () => { thumbs.forEach(t => t.t = 0); load(true); };
    };
    const load = async (force) => {
      draw();
      R.devErr = null;
      try { await api.devices(force); } catch (e) { R.devErr = e.message; if (!R.base) return draw(); toast(e.message); }
      if (S.view === 'hik') draw();
    };
    load(false);
    S.tick = setInterval(() => { if (!document.hidden && S.view === 'hik') main.querySelectorAll('img[data-thumb]').forEach(thumb); }, 120e3);
  }

  // live view of one channel

  const PTZ = { up: 'UP', down: 'DOWN', left: 'LEFT', right: 'RIGHT', in: 'ZOOMIN', out: 'ZOOMOUT' };

  function viewLive() {
    const { sn, ch } = parseId(S.liveSn);
    const d = dev(sn);
    if (!d) return go('hik');
    const cams = d.channels, idx = cams.findIndex(c => c.ch === ch);
    const q0 = store.get('hikQuality', 'sub');
    const pad = `<div class="pad">
      <span></span><button class="btn" data-ptz="up">${ic('up')}</button><span></span>
      <button class="btn" data-ptz="left">${ic('left')}</button><span class="c">tahan</span><button class="btn" data-ptz="right">${ic('right')}</button>
      <button class="btn" data-ptz="out" title="Perkecil">${ic('minus')}</button><button class="btn" data-ptz="down">${ic('down')}</button><button class="btn" data-ptz="in" title="Perbesar">${ic('plus')}</button>
    </div>`;
    $('#main').innerHTML = `
      ${topbar(`${esc(chName(d, ch))} <span class="muted small">· ${esc(d.name)}</span>`, `
        <button class="btn icon ${store.get('panelOff', false) ? '' : 'on'}" id="pt" title="Panel">${ic('sliders')}</button>`,
        `<button class="btn icon" id="bk" title="Kembali">${ic('back')}</button>`)}
      <div class="live ${store.get('panelOff', false) ? 'nopanel' : ''}" id="live">
        <div class="stage" id="stage">
          <video id="vid" playsinline muted autoplay></video>
          <div class="tl"><button class="btn icon lback" id="bk2" title="Kembali">${ic('back')}</button>
            <span class="badge" id="lb"><i class="dot"></i><span>…</span></span></div>
          <div class="msg" id="msg"><div><div class="spin"></div><div>Menyambung…</div></div></div>
          <div class="opad">${pad}</div>
          <div class="hud">
            <button class="btn icon" id="pv" title="Kamera sebelumnya" ${cams.length < 2 ? 'disabled' : ''}>${ic('prev')}</button>
            <button class="btn icon" id="nx" title="Kamera berikutnya" ${cams.length < 2 ? 'disabled' : ''}>${ic('next')}</button>
            <select id="q" title="Kualitas"><option value="main">HD</option><option value="sub">SD</option></select>
            <span class="spacer"></span>
            <button class="btn icon ptzb" id="ptzb" title="Gerak kamera (PTZ)">${ic('move')}</button>
            <button class="btn icon" id="pb" title="Putar ulang">${ic('film')}</button>
            <button class="btn icon" id="shot" title="Foto">${ic('shot')}</button>
            <button class="btn icon" id="rec" title="Rekam">${ic('rec')}</button>
            <button class="btn icon" id="fill" title="Isi layar">${ic('grid')}</button>
            <button class="btn icon" id="fs" title="Layar penuh">${ic('full')}</button>
          </div>
        </div>
        <div class="glass panel">
          <h3 class="pt-title">${esc(d.name)}</h3>
          <div class="hchs">${cams.map(c => `<button class="hch ${c.ch === ch ? 'on' : ''}" data-hid="${esc(sn)}.${c.ch}">
            <span class="hcth">${ic('cam')}<img data-thumb="${esc(sn)}.${c.ch}" alt=""></span><span>${esc(c.name)}</span></button>`).join('')}</div>
          <details ${innerWidth > 820 ? 'open' : ''}><summary>Gerak kamera (PTZ)</summary><div class="ptz">${pad}</div>
            <div class="muted small">Hanya untuk kamera PTZ / speed dome.</div></details>
          <div id="keybox"></div>
          <div class="muted small" id="info">SN ${esc(sn)} · CH ${ch}</div>
        </div>
      </div>`;
    $('#bk').onclick = $('#bk2').onclick = () => go('hik');
    $('#pt').onclick = () => {
      const off = !$('#live').classList.contains('nopanel');
      $('#live').classList.toggle('nopanel', off); $('#pt').classList.toggle('on', !off); store.set('panelOff', off);
    };
    document.querySelectorAll('.hch').forEach(b => b.onclick = () => go('hiklive', b.dataset.hid));
    document.querySelectorAll('.hch img[data-thumb]').forEach(i => { i.onerror = () => i.removeAttribute('src'); io.observe(i.closest('.hthumb, .thumb') || i.parentElement || i); });
    const step = k => go('hiklive', `${sn}.${cams[(idx + k + cams.length) % cams.length].ch}`);
    $('#pv').onclick = () => step(-1); $('#nx').onclick = () => step(1);
    $('#pb').onclick = () => go('hikplay', `${sn}.${ch}`);

    const video = $('#vid'), stage = $('#stage');
    const setMsg = (text, spin = true, html = '') => {
      $('#msg').hidden = !text && !html;
      if (text || html) $('#msg').innerHTML = `<div>${spin ? '<div class="spin"></div>' : ''}<div>${esc(text || '')}</div>${html}</div>`;
    };
    let player;
    const label = () => {
      const i = player.info || {};
      $('#lb').innerHTML = `<i class="dot online"></i><span>LIVE · ${player.stream === '0' ? 'HD' : 'SD'}${i.codec ? ` · ${i.codec === 'hevc' ? 'H.265' : 'H.264'}` : ''}${player.lag != null ? ` · jeda ${player.lag.toFixed(1)} dtk` : ''}</span>`;
    };
    const keyForm = msg => {
      setMsg(null, false, `<div class="hkey">${ic('light')}<b>${esc(msg)}</b>
        <input class="input" id="kc" placeholder="Kode verifikasi (6 huruf)" maxlength="16" autocapitalize="characters">
        <button class="btn primary" id="ks">Simpan & putar</button></div>`);
      $('#ks').onclick = async () => {
        try { await api.setKey(sn, $('#kc').value); toast('Kode disimpan di relay'); start(player.stream); } catch (e) { toast(e.message); }
      };
    };
    const start = stream => {
      player?.stop();
      player = new HikPlayer(video, sn, ch, {
        stream, onState: (s, v) => {
          stage.classList.toggle('wait', s === 'connect' || s === 'retry');
          if (s === 'connect') { setMsg(v); $('#lb').innerHTML = '<i class="dot sleeping"></i><span>Menyambung</span>'; }
          if (s === 'retry') { setMsg(v); $('#lb').innerHTML = '<i class="dot offline"></i><span>Terputus</span>'; }
          if (s === 'play') { setMsg(null); label(); }
          if (s === 'tick') label();
          if (s === 'blocked') setMsg('Ketuk layar untuk memutar', false);
          if (s === 'key') { keyForm(v); $('#lb').innerHTML = '<i class="dot offline"></i><span>Terkunci</span>'; }
          if (s === 'off') { setMsg(v); $('#lb').innerHTML = '<i class="dot offline"></i><span>Offline</span>'; }
        },
      });
      player.start();
    };
    $('#q').value = q0;
    start(q0 === 'main' ? '0' : '1');
    $('#q').onchange = e => { store.set('hikQuality', e.target.value); start(e.target.value === 'main' ? '0' : '1'); };
    $('#fill').onclick = () => { stage.classList.toggle('fill'); $('#fill').classList.toggle('on'); };
    $('#ptzb').onclick = () => { stage.classList.toggle('ptz'); $('#ptzb').classList.toggle('on'); };
    $('#fs').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => video.webkitEnterFullscreen?.());
      else video.webkitEnterFullscreen?.();
    };
    stage.addEventListener('click', e => { if (!e.target.closest('button, select, input, .opad, .hkey')) stage.classList.toggle('hud-off'); });
    $('#shot').onclick = async () => {
      const name = `${d.name} ${chName(d, ch)} ${fileStamp()}.jpg`;
      if (video.videoWidth) {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        c.toBlob(b => { saveBlob(b, name); toast('Foto disimpan'); }, 'image/jpeg', 0.92);
      } else {
        try { saveBlob(await (await fetch(api.snapURL(sn, ch, 1))).blob(), name); toast('Foto dari cloud disimpan'); } catch (e) { toast(e.message); }
      }
    };
    let rec;
    $('#rec').onclick = () => {
      if (rec) { rec.stop(); return; }
      const stream = video.captureStream?.() || video.mozCaptureStream?.();
      if (!stream || !window.MediaRecorder) return toast('Browser ini belum bisa merekam video live (coba Chrome/Edge)');
      const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
      const chunks = [];
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        saveBlob(new Blob(chunks, { type: rec.mimeType }), `${d.name} ${chName(d, ch)} ${fileStamp()}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
        rec = null; $('#rec')?.classList.remove('rec'); toast('Rekaman disimpan');
      };
      rec.start(1000); $('#rec').classList.add('rec'); toast('Merekam… tekan lagi untuk berhenti');
    };
    document.querySelectorAll('.pad [data-ptz]').forEach(b => {
      let on = false;
      const cmd = PTZ[b.dataset.ptz];
      const down = ev => { ev.preventDefault(); b.setPointerCapture?.(ev.pointerId); on = true; b.classList.add('held'); api.ptz(sn, ch, cmd, 'START').catch(e => toast(e.message)); };
      const up = () => { if (!on) return; on = false; b.classList.remove('held'); setTimeout(() => api.ptz(sn, ch, cmd, 'STOP').catch(() => {}), 120); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
    });
  }

  // multi view

  function viewMulti() {
    const n = store.get('hikMultiN', 2), cover = store.get('multiCover', false);
    const only = store.get('hikMultiSn', 'all');
    // cameras that need a verification code go last: they cannot play until it is entered
    const list = allCams().filter(x => only === 'all' || x.d.sn === only).sort((a, b) => a.c.locked - b.c.locked);
    const per = n * n, pages = Math.max(1, Math.ceil(list.length / per));
    let page = Math.min(store.get('hikMultiPage', 0), pages - 1);
    const cams = list.slice(page * per, page * per + per);
    const cols = n === 1 ? 1 : Math.min(n, Math.ceil(Math.sqrt(cams.length))), rows = Math.ceil(cams.length / cols) || 1;
    $('#main').innerHTML = `
      ${topbar('Multi Layar · Hik', `
        <div class="scroller">${[['all', 'Semua'], ...R.devices.map(d => [d.sn, d.name])].map(([k, v]) => `<button class="chip ${only === k ? 'on' : ''}" data-ms="${esc(k)}">${esc(v)}</button>`).join('')}</div>
        ${pages > 1 ? `<button class="btn icon" id="pp" title="Halaman sebelumnya">${ic('prev')}</button><span class="small muted">${page + 1}/${pages}</span><button class="btn icon" id="np" title="Halaman berikutnya">${ic('next')}</button>` : ''}
        <button class="btn icon ${cover ? 'on' : ''}" id="mc" title="Isi penuh (potong tepi)">${ic('full')}</button>
        <div class="seg">${[1, 2, 3, 4].map(k => `<button data-n="${k}" class="${k === n ? 'on' : ''}">${k === 1 ? '1' : `${k}×${k}`}</button>`).join('')}</div>`)}
      ${!R.base && !R.devices.length ? relayBox() : ''}
      <div class="multi ${cover ? 'cover' : ''}" style="--mcols:repeat(${cols},minmax(0,1fr));--mrows:repeat(${rows},minmax(0,1fr));--pcols:repeat(${n === 1 ? 1 : 2},minmax(0,1fr))">${cams.map(({ d, c }) => `
        <div class="tile" data-hid="${esc(d.sn)}.${c.ch}" ${c.locked ? 'data-locked' : ''}><video playsinline muted autoplay></video>
          ${c.locked ? `<div class="tlock">${ic('lock')}<span>Terkunci · isi kode verifikasi ${esc(d.name)} di Saya</span></div>` : ''}
          <span class="badge"><i class="dot ${c.locked ? 'offline' : ''}"></i>${esc(c.name)}</span></div>`).join('')}</div>
      <button class="btn icon mexit" title="Tutup">${ic('x')}</button>`;
    bindRetry();
    document.querySelectorAll('.seg [data-n]').forEach(b => b.onclick = () => { store.set('hikMultiN', +b.dataset.n); store.set('hikMultiPage', 0); route(); });
    document.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { store.set('hikMultiSn', b.dataset.ms); store.set('hikMultiPage', 0); route(); });
    $('#pp') && ($('#pp').onclick = () => { store.set('hikMultiPage', (page - 1 + pages) % pages); route(); });
    $('#np') && ($('#np').onclick = () => { store.set('hikMultiPage', (page + 1) % pages); route(); });
    $('#mc').onclick = () => { const on = !$('.multi').classList.contains('cover'); $('.multi').classList.toggle('cover', on); $('#mc').classList.toggle('on', on); store.set('multiCover', on); };
    $('.mexit').onclick = () => go('hik');
    document.querySelectorAll('.tile').forEach(t => {
      const { sn, ch } = parseId(t.dataset.hid), dot = t.querySelector('.dot');
      t.onclick = () => go('hiklive', t.dataset.hid);
      if (t.hasAttribute('data-locked')) return;
      const p = new HikPlayer(t.querySelector('video'), sn, ch, {
        stream: n === 1 ? '0' : '1',
        onState: (s, v) => {
          if (s === 'off' || s === 'key') t.insertAdjacentHTML('beforeend', `<div class="tlock">${ic(s === 'key' ? 'lock' : 'cam')}<span>${esc(v)}</span></div>`);
          dot.className = 'dot ' + (s === 'play' || s === 'tick' ? 'online' : s === 'retry' || s === 'key' || s === 'off' ? 'offline' : 'sleeping');
          t.classList.toggle('wait', s === 'connect' || s === 'retry');
        },
      });
      p.start();
      t.onclick = () => go('hiklive', t.dataset.hid);
    });
  }

  // playback from the NVR's disk

  const pad2 = v => String(v).padStart(2, '0');
  const ymd = t => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  const vtmTime = t => `${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}T${pad2(t.getHours())}${pad2(t.getMinutes())}${pad2(t.getSeconds())}Z`;
  const apiTime = t => `${ymd(t)} ${pad2(t.getHours())}:${pad2(t.getMinutes())}:${pad2(t.getSeconds())}`;

  function viewPlay() {
    const { sn, ch } = parseId(S.liveSn || `${store.get('hikPlayId', '')}`);
    const d = dev(sn) || R.devices[0];
    if (!d) return R.base ? go('hik') : ($('#main').innerHTML = topbar('Putar Ulang') + relayBox(), bindRetry());
    const c = d.channels.find(x => x.ch === ch) || d.channels[0];
    store.set('hikPlayId', `${d.sn}.${c.ch}`);
    let day = new Date(store.get('hikPlayDay', ymd(new Date())) + 'T00:00:00');
    if (isNaN(day)) day = new Date(ymd(new Date()) + 'T00:00:00');
    $('#main').innerHTML = `
      ${topbar('Putar Ulang · Hik', `
        <select class="input" id="pcam">${R.devices.map(x => `<optgroup label="${esc(x.name)}">${x.channels.map(k => `<option value="${esc(x.sn)}.${k.ch}" ${x.sn === d.sn && k.ch === c.ch ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}</optgroup>`).join('')}</select>
        <input class="input" type="date" id="pday" value="${ymd(day)}" max="${ymd(new Date())}">`)}
      <div class="hplay">
        <div class="stage" id="stage"><video id="vid" playsinline muted autoplay controls></video>
          <div class="msg" id="msg"><div><div>Pilih jam di garis waktu.</div></div></div></div>
        <div class="glass htl">
          <div class="row"><b id="ptitle">${esc(c.name)} · ${dayLabel(day)}</b><span class="spacer"></span>
            <button class="btn icon" id="dprev" title="Hari sebelumnya">${ic('prev')}</button><button class="btn icon" id="dnext" title="Hari berikutnya">${ic('next')}</button></div>
          <div class="tlbar" id="tl"><div class="tlseg" id="segs"></div><div class="tlcur" id="cur"></div></div>
          <div class="tlticks">${Array.from({ length: 9 }, (_, i) => `<span>${pad2(i * 3)}:00</span>`).join('')}</div>
          <div class="muted small" id="pinfo">Memuat rekaman…</div>
          <div class="hsegs" id="list"></div>
        </div>
      </div>`;
    const video = $('#vid');
    let player = null, segs = [];
    const setMsg = (t, spin) => { $('#msg').hidden = !t; if (t) $('#msg').innerHTML = `<div>${spin ? '<div class="spin"></div>' : ''}<div>${esc(t)}</div></div>`; };
    const play = from => {
      const seg = segs.find(s => s.end > from) || null;
      const begin = seg && seg.start > from ? seg.start : from;
      const end = new Date(Math.min(day.getTime() + 86400e3 - 1000, begin.getTime() + 2 * 3600e3));
      try { player?.destroy(); } catch {}
      setMsg(`Memutar ${timeLabel(begin)}…`, true);
      $('#cur').style.left = `${(begin - day) / 864e5 * 100}%`;
      const p = player = mpegts.createPlayer({ type: 'flv', isLive: true, url: api.playURL(d.sn, c.ch, vtmTime(begin), vtmTime(end)), hasAudio: false }, { enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: false });
      p.on(mpegts.Events.ERROR, () => setMsg('Rekaman tidak bisa diputar'));
      p.attachMediaElement(video); p.load();
      video.onplaying = () => setMsg(null);
      video.ontimeupdate = () => { $('#cur').style.left = `${(begin - day + video.currentTime * 1000) / 864e5 * 100}%`; };
      video.play().catch(() => {});
    };
    const stop = () => { try { player?.destroy(); } catch {} player = null; };
    x.onLeave = stop;
    const load = async () => {
      $('#segs').innerHTML = ''; $('#list').innerHTML = ''; $('#pinfo').textContent = 'Memuat rekaman…';
      try {
        const j = await api.records(d.sn, c.ch, apiTime(day), apiTime(new Date(day.getTime() + 86400e3 - 1000)));
        const rows = j.records || j.data || j.files || [];
        // begin/end are NVR wall-clock ("2026-10-31T09:11:30"); a segment can start the day before
        const dayEnd = new Date(day.getTime() + 86400e3 - 1000);
        segs = rows.map(r => ({ start: new Date(r.begin || r.startTime), end: new Date(r.end || r.stopTime), type: r.type || '' }))
          .filter(s => !isNaN(s.start) && !isNaN(s.end))
          .map(s => ({ ...s, start: s.start < day ? day : s.start, end: s.end > dayEnd ? dayEnd : s.end }))
          .filter(s => s.end > s.start).sort((a, b) => a.start - b.start);
        $('#segs').innerHTML = segs.map(s => `<i style="left:${(s.start - day) / 864e5 * 100}%;width:${Math.max(0.15, (s.end - s.start) / 864e5 * 100)}%"></i>`).join('');
        $('#pinfo').textContent = segs.length ? `${segs.length} potongan rekaman · ketuk garis waktu untuk memutar` : 'Tidak ada rekaman di hari ini.';
        $('#list').innerHTML = segs.slice(-60).reverse().map((s, i) => `<button class="chip" data-s="${s.start.getTime()}">${timeLabel(s.start).slice(0, 5)}–${timeLabel(s.end).slice(0, 5)}</button>`).join('');
        $('#list').querySelectorAll('[data-s]').forEach(b => b.onclick = () => play(new Date(+b.dataset.s)));
      } catch (e) { $('#pinfo').textContent = e.message; }
    };
    $('#tl').onclick = e => {
      const r = e.currentTarget.getBoundingClientRect();
      play(new Date(day.getTime() + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 864e5));
    };
    $('#pcam').onchange = e => { stop(); go('hikplay', e.target.value); };
    const setDay = t => { store.set('hikPlayDay', ymd(t)); stop(); route(); };
    $('#pday').onchange = e => setDay(new Date(e.target.value + 'T00:00:00'));
    $('#dprev').onclick = () => setDay(new Date(day.getTime() - 86400e3));
    $('#dnext').onclick = () => { if (ymd(day) !== ymd(new Date())) setDay(new Date(day.getTime() + 86400e3)); };
    load();
  }

  // messages (alarms)

  async function viewPesan() {
    const main = $('#main');
    let filter = store.get('hikPesanSn', 'all');
    main.innerHTML = `
      ${topbar('Pesan · Hik', `<button class="btn icon" id="rf" title="Segarkan">${ic('refresh')}</button>`)}
      <div class="toolbar"><div class="chips">${[['all', 'Semua'], ...R.devices.map(d => [d.sn, d.name])].map(([k, v]) => `<button class="chip ${filter === k ? 'on' : ''}" data-f="${esc(k)}">${esc(v)}</button>`).join('')}</div></div>
      <div id="out"><div class="empty glass">Memuat pesan…</div></div>`;
    main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { store.set('hikPesanSn', b.dataset.f); route(); });
    $('#rf').onclick = () => route();
    try {
      const j = await api.messages({ sn: filter === 'all' ? '' : filter, limit: 60 });
      const rows = (j.message || j.messages || j.alarms || j.data || []).map(m => ({
        id: m.msgId || m.alarmId || m.id,
        sn: m.deviceSerial || m.subSerial || m.serial,
        ch: Number(m.channelNo || m.channel || 1),
        title: m.title || m.detail || m.alarmName || m.msgTypeName || m.contentName || 'Alarm',
        time: new Date(m.timeStr ? m.timeStr.replace(' ', 'T') : Number(m.time || m.alarmStartTime || m.createTime) || m.alarmTime),
        pic: (m.ext?.pics || m.pic || m.alarmPicUrl || m.picUrl || '').split(';')[0] || null,
        name: m.deviceName || m.channelName || '',
      })).filter(m => !isNaN(m.time));
      if (S.view !== 'hikpesan') return;
      let html = '', lastDay = '';
      rows.forEach((a, k) => {
        const dl = dayLabel(a.time);
        if (dl !== lastDay) { html += `${lastDay ? '</div>' : ''}<div class="day">${dl}</div><div class="list">`; lastDay = dl; }
        const cam = dev(a.sn);
        html += `<button class="ev glass" data-k="${k}"><div class="thumb">${a.pic ? `<img loading="lazy" src="${esc(a.pic)}" alt="" onerror="this.remove()">` : ''}${ic('bell')}</div>
          <div class="meta"><b>${esc(a.title)}</b><span>${esc(cam ? `${cam.name} · ${chName(cam, a.ch)}` : a.name || a.sn)} · ${timeLabel(a.time)}</span></div></button>`;
      });
      if (lastDay) html += '</div>';
      $('#out').innerHTML = rows.length ? html : '<div class="empty glass">Tidak ada pesan.</div>';
      main.querySelectorAll('.ev').forEach(b => b.onclick = () => {
        const a = rows[+b.dataset.k];
        if (!a.pic) return go('hikplay', `${a.sn}.${a.ch}`);
        openViewer(rows.filter(r => r.pic).map(r => ({ caption: `${r.title} · ${timeLabel(r.time)}`, file: `${r.sn} ${fileStamp(r.time)}.jpg`, resolve: async () => r.pic })), rows.filter(r => r.pic).indexOf(a));
      });
    } catch (e) {
      $('#out').innerHTML = R.base ? `<div class="empty glass">${esc(e.message)}</div>` : relayBox(e.message);
      bindRetry();
    }
  }

  // settings card on the Saya page

  function sayaCard() {
    return `<div class="glass" id="hiks">
      <h3>Hik-Connect</h3>
      <div class="muted small" id="hst">Memeriksa relay…</div>
      <div id="hkeys"></div>
    </div>`;
  }
  async function sayaBind() {
    try {
      await find(true);
      if (!$('#hst')) return;
      const st = await api.status().catch(() => ({}));
      $('#hst').innerHTML = `Terhubung · akun <b>${esc(R.hello.account || '')}</b> · relay ${esc(R.hello.version)} di MacBook
        ${st.channels?.length ? ` · ${st.channels.length} siaran aktif` : ''}<br>Video Hik-Connect lewat relay di MacBook (tidak ada server lain); MacBook harus menyala & online.`;
      const devs = R.devices.length ? R.devices : await api.devices().catch(() => []);
      $('#hkeys').innerHTML = `<details><summary>Kode verifikasi perangkat (untuk video terenkripsi)</summary><div style="display:grid;gap:8px;margin-top:8px">
        ${devs.map(d => `<div class="row"><span>${esc(d.name)}${d.hasKey ? ' · <b>tersimpan</b>' : ''}</span><span class="spacer"></span>
          <input class="input" style="max-width:140px" data-kc="${esc(d.sn)}" placeholder="ABCDEF" maxlength="16"><button class="btn" data-ks="${esc(d.sn)}">Simpan</button></div>`).join('')}
        <div class="muted small">Kode 6 huruf ada di label NVR. Kosongkan lalu Simpan untuk menghapus.</div></div></details>`;
      document.querySelectorAll('[data-ks]').forEach(b => b.onclick = async () => {
        try { await api.setKey(b.dataset.ks, document.querySelector(`[data-kc="${CSS.escape(b.dataset.ks)}"]`).value); toast('Disimpan'); api.devices(true).then(sayaBind); } catch (e) { toast(e.message); }
      });
    } catch (e) { if ($('#hst')) $('#hst').textContent = e.message; }
  }

  // warm up: find the relay in the background so the first Hik page opens quickly
  setTimeout(() => find().then(() => api.devices()).catch(() => {}), 1500);

  return {
    views: { hik: viewDevices, hiklive: viewLive, hikmulti: viewMulti, hikplay: viewPlay, hikpesan: viewPesan },
    nav: [['hik', 'Perangkat', 'cam'], ['hikmulti', 'Multi Layar', 'grid'], ['hikplay', 'Putar Ulang', 'film'], ['hikpesan', 'Pesan', 'bell']],
    sayaCard, sayaBind,
  };
}
