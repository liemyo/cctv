// Pantau web — motion watcher that runs on the live <video> itself (no camera round trip):
// background + frame difference at 10 fps, highlight boxes on an overlay canvas, and a rolling
// pre-recorder so a clip already holds the seconds before the motion started.

// thr = luma step that counts as change, cellMin = changed pixels per 6×6 cell,
// need = frames (of the last 5) with fresh movement before it counts — one frame is an OSD digit flipping.
export const LEVELS = {
  normal: { name: 'Normal', thr: 26, cellMin: 7, need: 3 },
  tinggi: { name: 'Tinggi', thr: 19, cellMin: 4, need: 2 },
  agresif: { name: 'Agresif', thr: 13, cellMin: 2, need: 2 },
};

const W = 192, CELL = 6, TICK = 100;

/** Detector. onStart(boxes) when motion begins, onEnd() after `post` quiet seconds (or `max` seconds of motion). */
export class Watcher {
  constructor(video, canvas, opt = {}) {
    this.video = video; this.canvas = canvas; this.opt = opt;
    this.work = document.createElement('canvas');
    this.ctx = this.work.getContext('2d', { willReadFrequently: true });
    this.boxes = []; this.recent = []; this.active = false; this.people = []; this.peopleAt = 0;
  }

  /** Person boxes from the person detector (person.js), drawn with a label next to the motion boxes. */
  setPeople(people) { this.people = people; this.peopleAt = performance.now(); this.draw(); }

  get level() { return LEVELS[this.opt.level] || LEVELS.agresif; }

  start() {
    if (this.timer) return;
    this.reset();
    this.timer = setInterval(() => this.tick(), TICK);
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.active) { this.active = false; this.opt.onEnd?.(); }
    this.boxes = []; this.people = []; this.draw();
  }

  /** Forget the background (new stream, PTZ move, light switch): the next frames become the reference. */
  reset() { this.bg = null; this.warm = 0; this.recent = []; }

  /** Ignore the picture for a moment (PTZ move): it is all motion, none of it interesting. */
  hold(ms = 2500) { this.holdUntil = performance.now() + ms; this.reset(); this.boxes = []; this.draw(); }

  tick() {
    const v = this.video;
    if (document.hidden || v.paused || v.readyState < 2 || !v.videoWidth) return;
    if (performance.now() < (this.holdUntil || 0)) { this.bg = null; return; }
    const H = Math.max(CELL, Math.round(W * v.videoHeight / v.videoWidth / CELL) * CELL);
    if (this.work.width !== W || this.work.height !== H) { this.work.width = W; this.work.height = H; this.reset(); }
    const f = v.getVideoPlaybackQuality?.().totalVideoFrames;
    if (f != null && f === this.lastFrame) return; // same picture as last tick
    this.lastFrame = f;
    this.ctx.drawImage(v, 0, 0, W, H);
    const px = this.ctx.getImageData(0, 0, W, H).data, n = W * H;
    const cur = this.cur?.length === n ? this.cur : (this.cur = new Float32Array(n));
    for (let i = 0, j = 0; i < n; i++, j += 4) cur[i] = px[j] * 0.299 + px[j + 1] * 0.587 + px[j + 2] * 0.114;
    const cw = W / CELL, ch = H / CELL, cells = cw * ch;
    if (!this.bg || this.bg.length !== n) {
      this.bg = cur.slice(); this.prev = cur.slice(); this.t = 0;
      this.heat = new Float32Array(cells); this.counts = new Uint16Array(cells); this.fcounts = new Uint16Array(cells);
      this.act = new Uint8Array(cells); this.moved = new Int32Array(cells).fill(-99);
      return;
    }
    const { bg, prev, heat, counts, fcounts, act, moved } = this, L = this.level, t = ++this.t;
    // exposure / auto-gain / a lamp scales the whole picture: take that gain out before thresholding
    let sc = 0, sb = 0, sp = 0;
    for (let i = 0; i < n; i++) { sc += cur[i]; sb += bg[i]; sp += prev[i]; }
    const k = sb > 0 ? Math.min(4, Math.max(0.25, sc / sb)) : 1, kp = sp > 0 ? Math.min(4, Math.max(0.25, sc / sp)) : 1;
    counts.fill(0); fcounts.fill(0);
    for (let y = 0, i = 0; y < H; y++) {
      const row = (y / CELL | 0) * cw;
      for (let x = 0; x < W; x++, i++) {
        const c = row + (x / CELL | 0);
        if (Math.abs(cur[i] - bg[i] * k) > L.thr) counts[c]++;      // differs from the learned scene
        if (Math.abs(cur[i] - prev[i] * kp) > L.thr) fcounts[c]++;  // changed since the last frame
      }
    }
    prev.set(cur);
    let lit = 0;
    const fr = this.fr?.length === cells ? this.fr : (this.fr = new Uint8Array(cells));
    for (let c = 0; c < cells; c++) {
      const a = counts[c] >= L.cellMin;
      // cells that change all the time (OSD seconds, leaves, flicker) heat up and are ignored
      heat[c] = heat[c] * 0.98 + (a ? 0.02 : 0);
      act[c] = a && heat[c] < 0.35 ? 1 : 0;
      fr[c] = act[c] && fcounts[c] >= L.cellMin ? 1 : 0;
      lit += a;
    }
    // Fresh movement counts when it forms a group (≥2 touching cells) or continues next to last frame's
    // movement. A keyframe of the H.265 stream lights up dozens of scattered cells at once: that is the codec.
    const { groups, real } = freshness(fr, cw, ch, c => t - moved[c] === 1);
    if (groups >= 8) { bg.set(cur); this.recent.push(0); this.boxes = []; this.draw(); return; }
    for (let c = 0; c < cells; c++) if (fr[c]) moved[c] = t;
    const fresh = real;
    // background follows the scene: fast where nothing differs, slow under objects
    for (let y = 0, i = 0; y < H; y++) {
      const row = (y / CELL | 0) * cw;
      for (let x = 0; x < W; x++, i++) bg[i] += (cur[i] - bg[i]) * (counts[row + (x / CELL | 0)] >= L.cellMin ? 0.02 : 0.12);
    }
    if (lit > cells * 0.5 || Math.abs(k - 1) > 0.2) { // light switched / IR mode / camera moving: relearn
      this.bg = cur.slice(); this.recent = []; this.warm = Math.min(this.warm, 30); this.boxes = []; this.draw(); return;
    }
    if (this.warm < 40) { this.warm++; return; } // 4 s to learn the scene (OSD clock cells heat up)
    // boxes = areas that differ from the scene and moved within the last second
    this.boxes = blobs(act, cw, ch, c => t - moved[c] <= 10);
    this.recent.push(fresh ? 1 : 0);
    if (this.recent.length > 5) this.recent.shift();
    const now = performance.now(), o = this.opt;
    if (this.recent.reduce((a, b) => a + b, 0) >= L.need) {
      this.lastMove = now;
      if (!this.active) { this.active = true; this.since = now; o.onStart?.(this.boxes); }
    }
    if (this.active && (now - this.lastMove > (o.post ?? 6) * 1000 || now - this.since > (o.max ?? 60) * 1000)) {
      this.active = false; o.onEnd?.();
    }
    this.draw();
  }

  /** Boxes over the moving areas, mapped onto the video as it is shown (object-fit contain / cover). */
  draw() {
    const c = this.canvas, v = this.video;
    if (!c) return;
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const cw = Math.round(r.width * dpr), chh = Math.round(r.height * dpr);
    if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, cw, chh);
    const people = performance.now() - this.peopleAt < 2500 ? this.people : [];
    // motion boxes only during an event (no stray OSD boxes)
    if (!v.videoWidth || (!people.length && (!this.active || !this.boxes.length))) return;
    const fit = getComputedStyle(v).objectFit === 'cover' ? Math.max : Math.min;
    const s = fit(cw / v.videoWidth, chh / v.videoHeight), dw = v.videoWidth * s, dh = v.videoHeight * s;
    const ox = (cw - dw) / 2, oy = (chh - dh) / 2;
    if (this.active && !people.length) paintBoxes(g, this.boxes, ox, oy, dw, dh, dpr, this.active);
    if (people.length) paintBoxes(g, personBoxes(people), ox, oy, dw, dh, dpr);
  }
}

/** Groups of fresh cells: how many, and whether any is real movement (≥2 cells, or next to last frame's). */
function freshness(fr, cw, ch, wasFresh) {
  const seen = new Uint8Array(fr.length), q = [];
  let groups = 0, real = false;
  for (let s = 0; s < fr.length; s++) {
    if (!fr[s] || seen[s]) continue;
    let k = 0, near = false;
    q.length = 0; q.push(s); seen[s] = 1;
    while (q.length) {
      const c = q.pop(), cx = c % cw, cy = (c / cw) | 0;
      k++;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const nc = ny * cw + nx;
        if (wasFresh(nc)) near = true;
        if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && fr[nc] && !seen[nc]) { seen[nc] = 1; q.push(nc); }
      }
    }
    groups++;
    if (k >= 2 || near) real = true;
  }
  return { groups, real };
}

/** Connected groups of active cells (cells up to 2 apart join) with at least one `live` cell → [{x, y, w, h}] in 0–1 of the picture. */
function blobs(act, cw, ch, live) {
  const seen = new Uint8Array(act.length), out = [], q = [];
  for (let s = 0; s < act.length; s++) {
    if (!act[s] || seen[s]) continue;
    let x0 = cw, y0 = ch, x1 = 0, y1 = 0, k = 0, on = false;
    q.length = 0; q.push(s); seen[s] = 1;
    while (q.length) {
      const c = q.pop(), cx = c % cw, cy = (c / cw) | 0;
      k++; on ||= live(c); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const nc = ny * cw + nx;
        if (act[nc] && !seen[nc]) { seen[nc] = 1; q.push(nc); }
      }
    }
    if (on) out.push({ x: x0 / cw, y: y0 / ch, w: (x1 - x0 + 1) / cw, h: (y1 - y0 + 1) / ch, k });
  }
  return out.sort((a, b) => b.k - a.k).slice(0, 8);
}

/** Person detections as labelled boxes: moving people red, standing still yellow. */
export const personBoxes = people => people.map(p => ({ ...p, col: p.moving ? '#ff3b30' : '#ffd60a', label: `Orang ${Math.round(p.score * 100)}%` }));

/** Corner-bracket boxes (optional b.col / b.label); used on the overlay and burned into saved photos. */
export function paintBoxes(g, boxes, ox, oy, dw, dh, scale = 1, hot = true) {
  g.lineWidth = 2.5 * scale;
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4 * scale;
  for (const b of boxes) {
    const col = b.col || (hot ? '#ff3b30' : '#ffd60a');
    g.strokeStyle = col; g.fillStyle = col + '22';
    const pad = 4 * scale, x = ox + b.x * dw - pad, y = oy + b.y * dh - pad, w = b.w * dw + pad * 2, h = b.h * dh + pad * 2;
    const l = Math.min(w, h) * 0.28;
    g.fillRect(x, y, w, h);
    g.beginPath();
    for (const [px, py, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
      g.moveTo(px + sx * l, py); g.lineTo(px, py); g.lineTo(px, py + sy * l);
    }
    g.stroke();
    if (b.label) {
      g.shadowBlur = 0;
      g.font = `600 ${Math.round(12 * scale)}px -apple-system, system-ui, sans-serif`;
      const tw = g.measureText(b.label).width + 10 * scale, th = 18 * scale, ty = y > th ? y - th : y;
      const lx = Math.max(0, Math.min(x, g.canvas.width - tw)); // keep the label inside the picture
      g.fillStyle = col; g.fillRect(lx, ty, tw, th);
      g.fillStyle = '#000'; g.fillText(b.label, lx + 5 * scale, ty + 13 * scale);
      g.shadowBlur = 4 * scale;
    }
  }
  g.shadowBlur = 0;
}

/** Full-size JPEG of the current picture with the boxes drawn in. */
export function snapshot(video, boxes = []) {
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  const g = c.getContext('2d');
  g.drawImage(video, 0, 0);
  if (boxes.length) paintBoxes(g, boxes, 0, 0, c.width, c.height, c.width / 960);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
}

const MIMES = {
  av: ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'],
  v: ['video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'],
};

/** Rolling pre-recorder: a new MediaRecorder starts every `pre` seconds and unused ones are dropped after
 *  1.5×pre, so there is always one running that began `pre`…2×pre seconds ago. keep() claims it for an
 *  event, finish() stops it — one ordinary video file that starts before the motion did. */
export class PreRoll {
  static supported() { const v = window.HTMLMediaElement?.prototype; return !!(window.MediaRecorder && v && (v.captureStream || v.mozCaptureStream)); }

  constructor(video, { pre = 5, bits = 2.5e6 } = {}) { this.video = video; this.pre = pre; this.bits = bits; this.recs = []; }

  start() {
    this.stop();
    try { this.stream = this.video.captureStream?.() || this.video.mozCaptureStream?.(); } catch { this.stream = null; }
    if (!this.stream || !window.MediaRecorder) return false;
    this.rotate();
    this.timer = setInterval(() => this.rotate(), this.pre * 1000);
    return true;
  }

  rotate() {
    const now = Date.now();
    for (const r of [...this.recs]) if (!r.keep && (now - r.at > this.pre * 1500 || r.dead)) this.drop(r);
    if (!this.stream.getVideoTracks().some(t => t.readyState === 'live')) return;
    const r = this.make();
    if (r) this.recs.push(r);
  }

  make() {
    const audio = this.stream.getAudioTracks().length > 0;
    const list = MIMES[audio ? 'av' : 'v'];
    for (const mimeType of list.filter(t => MediaRecorder.isTypeSupported(t))) {
      try {
        const r = { at: Date.now(), chunks: [] };
        r.m = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: this.bits });
        r.m.ondataavailable = e => e.data.size && r.chunks.push(e.data);
        r.m.onerror = () => { r.dead = true; };
        r.m.start(1000);
        return r;
      } catch {}
    }
    return null;
  }

  drop(r) {
    this.recs = this.recs.filter(x => x !== r);
    r.m.ondataavailable = null;
    try { if (r.m.state !== 'inactive') r.m.stop(); } catch {}
  }

  /** Claims the oldest running recorder (longest pre-roll) for an event. */
  keep() {
    const r = this.recs.filter(x => !x.keep && !x.dead).sort((a, b) => a.at - b.at)[0];
    if (r) { r.keep = true; r.claimed = Date.now(); }
    return r || null;
  }

  /** → {blob, mime, secs, pre} or null when nothing was recorded. */
  finish(r) {
    return new Promise(res => {
      if (!r) return res(null);
      this.recs = this.recs.filter(x => x !== r);
      const done = () => {
        const mime = r.m.mimeType.split(';')[0] || 'video/webm';
        const blob = new Blob(r.chunks, { type: mime });
        res(blob.size ? { blob, mime, secs: (Date.now() - r.at) / 1000, pre: (r.claimed - r.at) / 1000 } : null);
      };
      if (r.m.state === 'inactive') return done();
      r.m.onstop = done;
      try { r.m.stop(); } catch { done(); }
    });
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    for (const r of [...this.recs]) if (!r.keep) this.drop(r);
  }
}
