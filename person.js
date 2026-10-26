// Pantau web — person detector: COCO-SSD (TensorFlow.js) on the live picture itself, so it works on
// every camera without touching the camera's own settings. One shared model; the cameras on screen
// take turns (one inference at a time), and a camera with fresh pixel motion goes to the front.
// A person counts when they move: their box shifts between looks, or they newly appear.

const TF = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const SSD = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';

// score = least model confidence, shift = how far (× box height) the box must travel within ~1.5 s,
// every = ms between looks at one camera
export const PLEVELS = {
  normal: { name: 'Normal', score: 0.6, shift: 0.25, every: 1500 },
  tinggi: { name: 'Tinggi', score: 0.45, shift: 0.18, every: 1000 },
  agresif: { name: 'Agresif', score: 0.3, shift: 0.12, every: 600 },
};

const IN = 640; // detection input width (keeps far-away people while staying fast)

let modelP = null;
const script = src => new Promise((ok, no) => {
  const s = Object.assign(document.createElement('script'), { src, crossOrigin: 'anonymous' });
  s.onload = ok; s.onerror = () => { s.remove(); no(new Error('AI deteksi orang gagal dimuat')); };
  document.head.append(s);
});

/** Loads TF.js + COCO-SSD once (≈ 1.5 MB script + 5 MB model, cached by the browser afterwards). */
export function loadModel() {
  return modelP ||= (async () => {
    if (!window.tf) await script(TF);
    if (!window.cocoSsd) await script(SSD);
    try { await tf.setBackend('webgl'); } catch {}
    await tf.ready();
    const m = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
    return m;
  })().catch(e => { modelP = null; throw e; });
}

const eyes = new Set();
let running = false;

async function loop() {
  if (running) return;
  running = true;
  try {
    const model = await loadModel();
    while (eyes.size) {
      const now = performance.now();
      let pick = null;
      for (const e of eyes) if (e.ready() && now >= e.next && (!pick || e.next < pick.next)) pick = e;
      if (!pick) { await new Promise(r => setTimeout(r, 80)); continue; }
      pick.next = now + pick.level.every;
      try { await pick.look(model); } catch (err) { console.warn('person', err); }
      await new Promise(r => setTimeout(r, 30)); // let the page breathe between inferences
    }
  } catch (e) {
    eyes.forEach(x => x.opt.onError?.(e));
  } finally { running = false; }
}

/** Person detector for one video. onPeople(people, moving) after every look; people = [{x, y, w, h, score, moving}] in 0–1
 *  (everyone seen in the last 1.5 s), moving = someone moved or appeared in this look. */
export class PersonEye {
  constructor(video, opt = {}) {
    this.video = video; this.opt = opt; this.next = 0; this.tracks = [];
    this.work = document.createElement('canvas');
    this.ctx = this.work.getContext('2d', { willReadFrequently: true });
  }

  get level() { return PLEVELS[this.opt.level] || PLEVELS.agresif; }

  ready() {
    const v = this.video;
    return !document.hidden && !v.paused && v.readyState >= 2 && v.videoWidth > 0;
  }

  start() { this.tracks = []; this.warm = true; this.next = 0; eyes.add(this); loop(); }
  stop() { eyes.delete(this); this.tracks = []; this.opt.onPeople?.([], false); }
  /** Pixel motion just started here: look at this camera next. */
  urgent() { this.next = 0; }

  async look(model) {
    const v = this.video, W = IN, H = Math.round(IN * v.videoHeight / v.videoWidth);
    if (this.work.width !== W || this.work.height !== H) { this.work.width = W; this.work.height = H; }
    this.ctx.drawImage(v, 0, 0, W, H);
    const L = this.level;
    const found = (await model.detect(this.work, 20, L.score))
      .filter(p => p.class === 'person' && p.score >= L.score)
      .map(p => ({ x: p.bbox[0] / W, y: p.bbox[1] / H, w: p.bbox[2] / W, h: p.bbox[3] / H, score: p.score }))
      .filter(b => b.w * b.h < 0.8 && b.h > 0.03);
    if (!eyes.has(this)) return;
    const now = performance.now();
    // match to known people (best overlap); unmatched = someone new in the picture
    const free = new Set(this.tracks);
    for (const b of found) {
      let best = null, bo = 0.2;
      for (const t of free) { const o = iou(b, t.box); if (o > bo) { bo = o; best = t; } }
      if (best) {
        free.delete(best);
        best.hist.push({ at: now, cx: b.x + b.w / 2, cy: b.y + b.h / 2 });
        best.hist = best.hist.filter(p => now - p.at < 1600);
        const o = best.hist[0], c = best.hist[best.hist.length - 1];
        const d = Math.hypot(c.cx - o.cx, c.cy - o.cy), dh = Math.abs(b.h - best.box.h) / Math.max(b.h, 0.05);
        b.moving = d > Math.max(0.012, L.shift * b.h) || dh > 0.35;
        best.box = b; best.seen = now;
      } else {
        // a person who was not there before is movement too — but not the ones already standing
        // in the picture when watching started
        b.moving = !this.warm;
        this.tracks.push({ box: b, seen: now, hist: [{ at: now, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }] });
      }
    }
    // forget people not seen for 8 s (a missed detection or two must not make them "new" again)
    this.tracks = this.tracks.filter(t => now - t.seen < 8000);
    this.warm = false;
    // show everyone seen in the last 1.5 s: a borderline score missing one look must not blink the box
    const shown = this.tracks.filter(t => now - t.seen < 1500).map(t => t.box);
    this.opt.onPeople?.(shown, found.some(b => b.moving));
  }
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a.w * a.h + b.w * b.h - i || 1);
}
