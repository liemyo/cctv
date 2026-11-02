// Pantau web core — REST client for the JFTech / XMeye cloud (the same account system iCSee uses).
// Port of pantau/Sources/PantauCore/{JFCrypto,JFClient,CloudStore}.swift. Runs in the browser and in Node ≥ 20.

export const PUBLIC_KEYS = {
  uuid: 'e0534f3240274897821a126be19b6d46',
  appKey: '0621ef206a1d4cafbe0c5545c3882ea8',
  appSecret: '90f8bc17be2a425db6068c749dee4f5d',
  movedCard: 2,
};
const RS = 'https://rs.xmeye.net';
const GWP = 'https://api.jftechws.com/gwp/v3/rtc';
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

// ---------- crypto ----------

/* MD5 (RFC 1321) over a byte array → lowercase hex. */
export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const len = bytes.length, total = ((len + 8) >>> 6) + 1 << 6;
  const m = new Uint8Array(total);
  m.set(bytes); m[len] = 0x80;
  const bits = len * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, bits >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bits / 2 ** 32), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let off = 0; off < total; off += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const s = S[(i >> 4) * 4 + (i % 4)];
      const x = (a + f + K[i] + dv.getUint32(off + g * 4, true)) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((x << s) | (x >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((v, i) => out.setUint32(i * 4, v, true));
  return [...new Uint8Array(out.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
}

let counter = 0;
/** 7-digit rolling counter + epoch milliseconds. */
export function timeMillis() {
  counter = counter >= 9999999 ? 1 : counter + 1;
  return String(counter).padStart(7, '0') + String(Date.now());
}

function change(input, mc) {
  const b = input.slice(), n = b.length, m = Math.max(mc, 1);
  for (let i = 0; i < n; i++) {
    const t = (i % m) > ((n - i) % m) ? b[i] : b[n - (i + 1)];
    b[i] = b[n - (i + 1)];
    b[n - (i + 1)] = t;
  }
  return b;
}

export function signature(k, tm) {
  const src = enc.encode(k.uuid + k.appKey + k.appSecret + tm);
  const changed = change(src, k.movedCard);
  const n = src.length, merged = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) { merged[i] = src[i]; merged[2 * n - 1 - i] = changed[i]; }
  return md5(merged);
}

export function aesKey(tm, appSecret) {
  let key = tm.slice(Math.floor(tm.length / 2)) + appSecret;
  if (key.length > 16) key = key.slice(0, 16);
  else for (let i = 0, need = 16 - key.length; i < need; i++) key += String(i);
  return key;
}

/** AES-128-ECB / PKCS7 → uppercase hex. WebCrypto has no ECB, so each block is CBC with a zero IV. */
export async function encryptHex(plain, key) {
  const k = await subtle.importKey('raw', enc.encode(key).slice(0, 16), 'AES-CBC', false, ['encrypt']);
  const p = enc.encode(plain), pad = 16 - (p.length % 16);
  const buf = new Uint8Array(p.length + pad);
  buf.set(p); buf.fill(pad, p.length);
  let hex = '';
  for (let i = 0; i < buf.length; i += 16) {
    const c = new Uint8Array(await subtle.encrypt({ name: 'AES-CBC', iv: new Uint8Array(16) }, k, buf.slice(i, i + 16)));
    hex += [...c.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return hex.toUpperCase();
}

export async function sha256Hex(s) {
  const h = await subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ---------- errors ----------

export class JFError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function jfError(code, msg, data) {
  if (msg === 'DEV_NOTEXIT' || msg === 'DEVICE_NOT_EXIST') return new JFError(code, `Kamera tidak dikenali untuk akun/kunci ini (${msg}) — coba masuk ulang`);
  if (msg === 'DEV_OFFLINE' || msg === 'DEVICE_OFFLINE') return new JFError(code, 'Kamera offline');
  if (code === 4000) return new JFError(code, 'Akun atau kata sandi salah');
  if (code === 5004) return new JFError(code, 'Kunci aplikasi (AppKey) ditolak server — periksa Kunci Platform');
  if ([4100, 4101, 4118].includes(code)) return new JFError(code, 'Sesi berakhir, silakan masuk lagi');
  const detail = typeof data === 'string' ? data.replace(/\+/g, ' ') : '';
  return new JFError(code, detail || msg || `Kesalahan server ${code}`);
}

function deviceError(ret, msg) {
  if ([203, 206, 137, -11301, -11318].includes(ret)) return new JFError(ret, 'Kata sandi perangkat salah');
  if ([106, -10005].includes(ret)) return new JFError(ret, 'Perangkat offline / tidak merespons');
  if (ret === 515) return new JFError(ret, 'Perangkat sedang tidur — bangunkan dulu');
  return new JFError(ret, msg || `Perangkat menolak permintaan (kode ${ret})`);
}

const first = (o, ...keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== '') return o[k]; };

export function parseDevice(j) {
  const sn = first(j, 'uuid', 'devId', 'sn', 'deviceNo', 'devSn', 'serialNumber');
  if (!sn) return null;
  const raw = String(first(j, 'devName', 'deviceName', 'nickname', 'nickName', 'name') ?? sn);
  let name = raw.replace(/\+/g, ' ');
  try { name = decodeURIComponent(name); } catch {}
  return {
    sn: String(sn), name,
    username: first(j, 'username', 'devUserName', 'devUsername', 'userName', 'loginName') ?? 'admin',
    password: first(j, 'password', 'devPassWord', 'devPassword', 'passWord', 'pwd') ?? '',
    channelCount: Math.max(1, Number(first(j, 'channelNum', 'chnNum', 'nChannelNum') ?? 1)),
  };
}

const EVENTS = {
  VideoMotion: 'Gerakan terdeteksi', MotionDetect: 'Gerakan terdeteksi',
  appEventMotionDetectAlarm: 'Gerakan terdeteksi', appEventVideoMotion: 'Gerakan terdeteksi',
  HumanDetect: 'Manusia terdeteksi', HumanDetection: 'Manusia terdeteksi',
  appEventHumanDetectAlarm: 'Manusia terdeteksi', appEventHumanDetect: 'Manusia terdeteksi',
  appEventCarDetectAlarm: 'Kendaraan terdeteksi', CarShapeDetect: 'Kendaraan terdeteksi',
  appEventPetDetectAlarm: 'Hewan terdeteksi', PetDetect: 'Hewan terdeteksi',
  appEventCryDetectAlarm: 'Tangisan terdeteksi', BabyCry: 'Tangisan terdeteksi',
  VideoBlind: 'Kamera tertutup',
};
// Camera-side detector presets (Detect.MotionDetect Level 1–6, EventLatch = seconds between alarms,
// HumanDetection Sensitivity 0–2 + ShowTrack box drawn by the camera, DetectTrack Sensitivity 0–2).
export const SENS = {
  normal: { name: 'Normal', level: 3, latch: 2, human: 1, track: 1, box: false, push: 3000 },
  tinggi: { name: 'Tinggi', level: 5, latch: 1, human: 2, track: 1, box: false, push: 2000 },
  agresif: { name: 'Agresif', level: 6, latch: 0, human: 2, track: 2, box: true, push: 1000 },
};

export const eventLabel = raw => { const e = String(raw || '').split(':')[0]; return EVENTS[e] || e || 'Alarm'; };

export function parseStamp(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-?(\d\d)-?(\d\d)[ T]?(\d\d):?(\d\d):?(\d\d)/);
  if (m) return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const n = Number(s);
  return isFinite(n) ? new Date(n > 1e12 ? n : n * 1000) : null;
}

export function stamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------- client ----------

export class JFClient {
  constructor(keys = PUBLIC_KEYS, accessToken = null) {
    this.keys = keys;
    this.accessToken = accessToken;
    this.tokens = new Map();   // sn → {token, at}
    this.loggedIn = new Map(); // sn → at
  }

  async login(account, password) {
    const tm = timeMillis();
    const key = aesKey(tm, this.keys.appSecret);
    const form = { account: await encryptHex(account, key), pass: await encryptHex(password, key) };
    const j = await this.rsPost('/login/va1', form, tm, false);
    const token = first(j.data || {}, 'accessToken', 'token');
    if (!token) throw new JFError(-1, 'Login berhasil tetapi token tidak ada');
    this.accessToken = token;
    this.tokens.clear(); this.loggedIn.clear();
    return token;
  }

  async devices() {
    const j = await this.rsPost('/mdlist/v1', {});
    let data = j.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
    const list = Array.isArray(data) ? data : (first(data || {}, 'devList', 'deviceList', 'list', 'data') || []);
    return list.map(parseDevice).filter(Boolean);
  }

  async logout() {
    try { await this.rsPost('/logout/v1', {}); } catch {}
    this.accessToken = null;
  }

  async rsPost(path, form, tm = timeMillis(), auth = true) {
    const sig = signature(this.keys, tm);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', uuid: this.keys.uuid, appKey: this.keys.appKey };
    if (auth) {
      if (!this.accessToken) throw new JFError(4100, 'Belum masuk');
      headers.Authorization = this.accessToken;
    }
    const r = await fetch(`${RS}${path}/${tm}/${sig}.rs`, { method: 'POST', headers, body: new URLSearchParams(form).toString() });
    const text = await r.text();
    let j;
    try { j = JSON.parse(decodeURIComponent(text)); } catch { try { j = JSON.parse(text); } catch {} }
    if (!j) throw new JFError(-2, 'Balasan server tidak terbaca');
    if (j.code !== 2000) throw jfError(j.code ?? -1, j.msg, j.data);
    return j;
  }

  async gwpPost(path, body = {}) {
    const tm = timeMillis();
    const headers = {
      'Content-Type': 'application/json; charset=UTF-8', uuid: this.keys.uuid, appKey: this.keys.appKey,
      timeMillis: tm, signature: signature(this.keys, tm),
    };
    if (this.accessToken) headers.Authorization = this.accessToken;
    const r = await fetch(GWP + path, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); } catch { throw new JFError(-2, 'Balasan relay tidak terbaca: ' + text.slice(0, 160)); }
    if (j.code !== 2000) {
      if (j.code === 4000) throw new JFError(4000, `Permintaan ditolak relay (${j.msg || 'PARAM_ERROR'})`);
      throw jfError(j.code ?? -1, j.msg, j.data);
    }
    return j.data;
  }

  async deviceToken(sn) {
    const c = this.tokens.get(sn);
    if (c && Date.now() - c.at < 3000e3) return c.token;
    const body = { sns: [sn] };
    if (this.accessToken) body.accessToken = this.accessToken;
    const data = await this.gwpPost('/device/token', body);
    const hit = (Array.isArray(data) ? data : []).find(x => x.sn === sn) || (data && data[0]);
    if (!hit?.token) throw new JFError(-3, `Token perangkat ${sn} tidak diberikan`);
    this.tokens.set(sn, { token: hit.token, at: Date.now() });
    return hit.token;
  }

  async deviceCall(op, dev, body) {
    const token = await this.deviceToken(dev.sn);
    const data = await this.gwpPost(`/device/${op}/${token}`, body);
    if (data && typeof data.Ret === 'number' && data.Ret !== 100) throw deviceError(data.Ret, data.retMsg);
    return data;
  }

  async status(devs) {
    const bySn = {};
    const tokens = {};
    for (const d of devs) { try { tokens[await this.deviceToken(d.sn)] = d.sn; } catch {} }
    if (!Object.keys(tokens).length) return bySn;
    let data;
    try { data = await this.gwpPost('/device/status', { deviceTokenList: Object.keys(tokens) }); } catch { return bySn; }
    for (const it of data || []) {
      const sn = first(it, 'uuid', 'sn') || '';
      const s = String(it.status || '').toLowerCase(), wake = String(it.wakeUpStatus || '').toLowerCase();
      if (s === 'online') bySn[sn] = (wake === '0' || wake === 'sleep') ? 'sleeping' : 'online';
      else if (s === 'notconnected' || s === 'sleep' || wake === '0') bySn[sn] = 'sleeping';
      else if (s) bySn[sn] = 'offline';
    }
    return bySn;
  }

  async wakeUp(dev) {
    const token = await this.deviceToken(dev.sn);
    await this.gwpPost(`/device/wakeup/${token}`, {});
  }

  async deviceLogin(dev, force = false) {
    const at = this.loggedIn.get(dev.sn);
    if (!force && at && Date.now() - at < 240e3) return;
    await this.deviceCall('login', dev, {
      UserName: dev.username, PassWord: dev.password, Name: 'generalinfo',
      EncryptType: 'DISABLE', LoginType: 'DVRIP-Web', KeepaliveTime: 300,
    });
    this.loggedIn.set(dev.sn, Date.now());
  }

  /** stream '0' = HD, '1' = SD. protocol 'flv' (native H.265, ~2 s) or 'hls-ts' (+ videoCode h264, 7–9 s behind). */
  async liveURL(dev, { stream = '1', protocol = 'flv', videoCode = null, channel = 0 } = {}) {
    const body = {
      channel: String(channel), stream, protocol,
      username: dev.username, devPwd: dev.password, password: dev.password,
      expireTime: String(Date.now() + 3600e3),
    };
    if (videoCode) body.videoCode = videoCode;
    const data = await this.deviceCall('livestream', dev, body);
    const url = first(data || {}, 'url', 'Url');
    if (!url) throw new JFError(-4, 'Alamat siaran kosong');
    return url;
  }

  async closeLive(dev, stream, channel = 0) {
    try {
      await this.deviceCall('closeLivestream', dev, { channel: String(channel), stream, username: dev.username, password: dev.password });
    } catch {}
  }

  /** Snapshot → Blob (cloud returns base64 or a URL). */
  async capture(dev, channel = 0) {
    await this.deviceLogin(dev);
    const data = await this.deviceCall('capture', dev, { Name: 'OPSNAP', OPSNAP: { Channel: channel, PicType: 1 } });
    const img = first(data || {}, 'image', 'Image', 'url');
    if (!img) throw new JFError(-5, 'Gambar kosong');
    if (/^https?:/.test(img)) return await (await fetch(img)).blob();
    const b64 = img.split('base64,').pop();
    const bin = atob(b64.replace(/\s/g, ''));
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/jpeg' });
  }

  async ptzCommand(dev, command, preset, { name, channel = 0, speed = 5 } = {}) {
    await this.deviceLogin(dev);
    const param = {
      Channel: channel, Preset: preset, Step: speed, Tour: 0,
      AUX: { Number: 0, Status: 'On' }, MenuOpts: 'Enter', Pattern: 'SetBegin',
      POINT: { bottom: 0, left: 0, right: 0, top: 0 },
    };
    if (name) param.PresetName = name;
    await this.deviceCall('opdev', dev, { Name: 'OPPTZControl', OPPTZControl: { Command: command, Parameter: param } });
  }

  /** dir: DirectionUp|DirectionDown|DirectionLeft|DirectionRight|ZoomTile|ZoomWide */
  ptz(dev, dir, stop) { return this.ptzCommand(dev, dir, stop ? -1 : 65535); }

  async config(dev, name) {
    await this.deviceLogin(dev);
    const data = await this.deviceCall('getconfig', dev, { Name: name });
    return data?.[name] ?? data;
  }

  async setConfig(dev, name, value) {
    await this.deviceLogin(dev);
    await this.deviceCall('setconfig', dev, { Name: name, [name]: value });
  }

  async presets(dev, channel = 0) {
    const j = await this.config(dev, 'Uart.PTZPreset');
    const list = Array.isArray(j?.[channel]) ? j[channel] : (Array.isArray(j) ? j : []);
    return list.map(p => ({ id: Number(p.Id), name: p.PresetName || `Posisi ${p.Id}` }))
      .filter(p => isFinite(p.id) && p.id !== 100).sort((a, b) => a.id - b.id);
  }

  gotoPreset(dev, id) { return this.ptzCommand(dev, 'GotoPreset', id); }
  async savePreset(dev, id, name) {
    await this.ptzCommand(dev, 'SetPreset', id, { name });
    try {
      const list = await this.config(dev, 'Uart.PTZPreset');
      const rows = list?.[0];
      const row = Array.isArray(rows) && rows.find(r => r.Id === id);
      if (row && row.PresetName !== name) { row.PresetName = name; await this.setConfig(dev, 'Uart.PTZPreset', [rows]); }
    } catch {}
  }
  deletePreset(dev, id) { return this.ptzCommand(dev, 'ClearPreset', id); }

  /** The camera's own detectors: motion Level 1–6, alarm interval (EventLatch s), human Sensitivity 0–2, tracking Sensitivity 0–2. */
  async sensitivity(dev) {
    const m = await this.config(dev, 'Detect.MotionDetect.[0]');
    const h = await this.config(dev, 'Detect.HumanDetection.[0]').catch(() => null);
    const t = await this.config(dev, 'Detect.DetectTrack').catch(() => null);
    const s = {
      on: !!m?.Enable, level: m?.Level ?? 3, latch: m?.EventHandler?.EventLatch ?? null,
      human: h?.Enable ? h.Sensitivity : null, box: !!h?.ShowTrack, push: h?.PushInterval ?? null,
      track: t ? t.Sensitivity : null, tracking: !!t?.Enable,
    };
    s.preset = Object.keys(SENS).reverse().find(k => s.on && s.level >= SENS[k].level && (s.human == null || s.human >= SENS[k].human)) || 'custom';
    return s;
  }

  /** Read-modify-write of the three detector configs to a SENS preset. Tracking stays on/off as it was (it moves the camera). */
  async setSensitivity(dev, key) {
    const p = SENS[key];
    const m = await this.config(dev, 'Detect.MotionDetect.[0]');
    m.Enable = true; m.Level = p.level;
    m.EventHandler = { ...m.EventHandler, EventLatch: p.latch, Dejitter: 0, MessageEnable: true, SnapEnable: true };
    if (key === 'agresif' && Array.isArray(m.Region)) m.Region = m.Region.map(() => '0xFFFFFFFF'); // whole picture
    await this.setConfig(dev, 'Detect.MotionDetect.[0]', m);
    const h = await this.config(dev, 'Detect.HumanDetection.[0]').catch(() => null);
    if (h) {
      Object.assign(h, { Enable: true, Sensitivity: p.human, ShowTrack: p.box });
      try { await this.setConfig(dev, 'Detect.HumanDetection.[0]', { ...h, PushInterval: p.push }); }
      catch { await this.setConfig(dev, 'Detect.HumanDetection.[0]', h).catch(() => {}); }
    }
    const t = await this.config(dev, 'Detect.DetectTrack').catch(() => null);
    if (t) { t.Sensitivity = p.track; await this.setConfig(dev, 'Detect.DetectTrack', t).catch(() => {}); }
    return this.sensitivity(dev);
  }

  async info(dev, name = 'SystemInfo') {
    await this.deviceLogin(dev);
    const data = await this.deviceCall('getinfo', dev, { Name: name });
    return data?.[name] ?? data;
  }

  async alarms(dev, from, to) {
    const data = await this.deviceCall('getDeviceAlarmList', dev, { sn: dev.sn, startTime: stamp(from), endTime: stamp(to) });
    const list = Array.isArray(data?.AlarmArray) && data.AlarmArray.length ? data.AlarmArray : (Array.isArray(data) ? data : []);
    return list.map(j => {
      const t = first(j, 'alarmTime', 'AlarmTime', 'StartTime', 'startTime', 'time', 'createTime') || '';
      const ev = first(j, 'alarmEvent', 'AlarmEvent', 'Event', 'event', 'msgType', 'type') || '';
      return {
        id: String(first(j, 'alarmId', 'AlarmId', 'ID', 'id', 'msgId') || `${dev.sn}-${t}-${ev}`),
        sn: dev.sn, timeText: t, time: parseStamp(t), event: eventLabel(ev),
        pic: first(j, 'picUrl', 'PicUrl', 'pic', 'picture', 'imgUrl', 'thumbUrl', 'url') || null,
        hasPic: !!(first(j, 'picUrl', 'PicUrl') || j.PicInfo),
      };
    }).sort((a, b) => (b.time || 0) - (a.time || 0));
  }

  /** Signed picture URLs for alarm ids, batched by 30. */
  async alarmPictures(dev, ids) {
    const out = {};
    for (let i = 0; i < ids.length; i += 30) {
      let pics;
      try { pics = await this.deviceCall('getPicUrl', dev, { sn: dev.sn, alarmIds: ids.slice(i, i + 30) }); } catch { continue; }
      const urls = Array.isArray(pics) ? pics : (first(pics || {}, 'urls', 'list') || []);
      for (const u of urls) {
        const id = first(u, 'id', 'alarmId', 'AlarmId'), url = first(u, 'url', 'picUrl');
        if (id && url) out[id] = url;
      }
    }
    return out;
  }
}

// ---------- Supabase motion clips (same backend the Mac app uploads to) ----------

export const CLOUD = {
  // 2026-10-28: own Supabase project "cctv" on the account lyctusking@gmail.com (SQL in pantau/supabase-pantau.sql).
  base: 'https://oazanptfzembkdtvfjui.supabase.co',
  anon: 'sb_publishable_OfZssnE8Q76nfQrW1PoAsQ_O6WJuvgY',
  bucket: 'pantau',
  // Backblaze B2 is no longer used (null). The b2 code paths stay so stray <owner>/b2/… paths are skipped safely.
  b2: null,
  supaQuota: 943718400,
};
export const isB2Path = p => typeof p === 'string' && p.split('/')[1] === 'b2';
// Klip videos in Google Drive (2026-11-02): row path <owner>/gd/<Drive file id>; photos stay in Supabase.
export const isGdPath = p => typeof p === 'string' && p.split('/')[1] === 'gd';
export const GDRIVE = {
  fn: 'https://bbptcxpzzvgpxqylkrmw.supabase.co/functions/v1/pantau-drive', // pantau/drive/supabase/functions/pantau-drive
  quota: 5 * 2 ** 30, // rolling limit for the videos in the Drive folder "Pantau Klip"
  reserve: 32 * 2 ** 20,
};

export class CloudStore {
  constructor(key) { this.key = key; }
  /** One Drive client per cloud key, shared by every CloudStore made for it (token + usage caches). */
  get drive() { return drives.get(this.key) || drives.set(this.key, new DriveStore(this.key)).get(this.key); }
  static isValidKey(k) { return /^[0-9a-f]{64}$/.test(k || ''); }

  headers(extra = {}) {
    return { apikey: CLOUD.anon, Authorization: `Bearer ${CLOUD.anon}`, 'x-pantau-key': this.key, ...extra };
  }

  async rpc(fn, args) {
    const r = await fetch(`${CLOUD.base}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ...args, p_key: this.key }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new JFError(r.status, `Cloud ${r.status}: ${j?.message || 'gagal'}`);
    if (!j?.ok) throw new JFError(-7, `Cloud menolak (${j?.err || '?'})`);
    return j;
  }

  async b2(path, init = {}) {
    const r = await fetch(CLOUD.b2 + path, { ...init, headers: { 'x-pantau-key': this.key, ...(init.headers || {}) } });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new JFError(r.status, `Cloud B2 ${r.status}: ${j?.error || 'gagal'}`);
    return j;
  }

  /** Klip events, newest first. With Google Drive connected they live there (DriveStore events; used = 0 Supabase
   *  bytes); else in Supabase: used = Supabase + B2 bytes, quota = B2 quota when B2 is on. */
  async list({ before = null, limit = 120, sn = null } = {}) {
    if (await this.drive.connected()) return this.drive.events(this, { before, limit, sn });
    const args = { p_limit: limit };
    if (before) args.p_before = before;
    if (sn) args.p_sn = sn;
    const [j, u] = await Promise.all([this.rpc('pantau_list', args), CLOUD.b2 && !before ? this.b2('/usage') : null]);
    return { rows: j.rows || [], used: (j.used || 0) + (u?.used || 0), count: j.count || 0, quota: u?.quota || CLOUD.supaQuota };
  }

  async signedURLs(paths, expires = 3600) {
    paths = paths.filter(p => !isGdPath(p));
    if (!paths.length) return {};
    if (!CLOUD.b2) paths = paths.filter(p => !isB2Path(p));
    if (!paths.length) return {};
    const b2 = paths.filter(isB2Path);
    if (b2.length) {
      const [a, b] = await Promise.all([
        this.b2('/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: b2, expires }) }),
        this.signedURLs(paths.filter(p => !isB2Path(p)), expires)]);
      return { ...b, ...a };
    }
    const r = await fetch(`${CLOUD.base}/storage/v1/object/sign/${CLOUD.bucket}`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ expiresIn: expires, paths }),
    });
    if (!r.ok) throw new JFError(r.status, `Cloud ${r.status}`);
    const out = {};
    for (const it of await r.json()) if (it.path && it.signedURL) out[it.path] = `${CLOUD.base}/storage/v1${it.signedURL}`;
    return out;
  }

  // Web settings live as small JSON files in the owner's folder (bucket only takes jpg/mp4, so they are
  // labelled image/jpeg). Each save is a new file named by its timestamp; the newest one wins.
  async owner() { return this._owner ||= await sha256Hex(this.key); }

  async getPrefs() { return this.getDoc('web-prefs'); }
  async putPrefs(prefs, opts) { return this.putDoc('web-prefs', prefs, opts); }

  /** Web settings / the Hik-Connect relay address: in Google Drive when it is connected, else the newest JSON file in
   *  <owner>/<name>/ of the Supabase bucket. */
  async getDoc(name) {
    if (await this.drive.connected()) return this.drive.getDoc(name);
    const dir = `${await this.owner()}/${name}/`;
    const r = await fetch(`${CLOUD.base}/storage/v1/object/list/${CLOUD.bucket}`, {
      method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefix: dir, limit: 20, sortBy: { column: 'name', order: 'desc' } }),
    });
    if (!r.ok) throw new JFError(r.status, `Cloud ${r.status}`);
    const names = (await r.json()).map(x => x.name).filter(n => /^\d+\.jpg$/.test(n)).sort((a, b) => parseInt(b) - parseInt(a));
    if (!names.length) return null;
    const g = await fetch(`${CLOUD.base}/storage/v1/object/authenticated/${CLOUD.bucket}/${dir}${names[0]}?t=${Date.now()}`, { headers: this.headers(), cache: 'no-store' });
    if (!g.ok) throw new JFError(g.status, `Cloud ${g.status}`);
    const j = await g.json();
    j.old = names.slice(1).map(n => dir + n);
    return j;
  }

  async putDoc(name, doc, { keepalive = false, old = [] } = {}) {
    if (await this.drive.connected()) return this.drive.putDoc(name, doc, { keepalive });
    const dir = `${await this.owner()}/${name}/`;
    const r = await fetch(`${CLOUD.base}/storage/v1/object/${CLOUD.bucket}/${dir}${doc.t}.jpg`, {
      method: 'POST', keepalive, body: JSON.stringify(doc),
      headers: this.headers({ 'Content-Type': 'image/jpeg', 'cache-control': 'max-age=0' }),
    });
    if (!r.ok && r.status !== 409) throw new JFError(r.status, `Cloud ${r.status}`);
    if (old.length) await this.removePaths(old).catch(() => {});
  }

  async removePaths(prefixes) {
    const gd = prefixes.filter(isGdPath);
    if (gd.length) await this.drive.remove(gd.map(p => p.split('/')[2]));
    prefixes = prefixes.filter(p => !isGdPath(p));
    const b2 = prefixes.filter(isB2Path);
    if (b2.length && CLOUD.b2) await this.b2('/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: b2 }) });
    prefixes = prefixes.filter(p => !isB2Path(p));
    if (!prefixes.length) return;
    await fetch(`${CLOUD.base}/storage/v1/object/${CLOUD.bucket}`, {
      method: 'DELETE', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ prefixes }),
    });
  }

  /** Opens a cloud key sealed under one of the account's camera serial numbers (AES-GCM, PBKDF2 key). */
  static async unseal(sealed, serials) {
    const b = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    for (const sn of serials) {
      const id = (await sha256Hex('pantau-cam|' + sn)).slice(0, 12), it = sealed.find(x => x.id === id);
      if (!it) continue;
      try {
        const base = await subtle.importKey('raw', enc.encode('pantau-cloud|' + sn), 'PBKDF2', false, ['deriveKey']);
        const k = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('pantau-web-v1'), iterations: 250000 },
          base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const key = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: b(it.iv) }, k, b(it.ct)));
        if (CloudStore.isValidKey(key)) return key;
      } catch {}
    }
    return null;
  }

  async path(sn, name) { return `${await this.owner()}/${CLOUD.b2 ? 'b2/' : ''}${sn}/${name}`; }

  async upload(path, blob, mime) {
    if (isB2Path(path)) {
      const r = await fetch(`${CLOUD.b2}/o/${path}`, { method: 'PUT', body: blob, headers: { 'x-pantau-key': this.key, 'Content-Type': mime } });
      if (!r.ok && r.status !== 409) throw new JFError(r.status, `Cloud B2 ${r.status}: ${(await r.json().catch(() => null))?.error || 'gagal'}`);
      return;
    }
    const r = await fetch(`${CLOUD.base}/storage/v1/object/${CLOUD.bucket}/${path}`, {
      method: 'POST', body: blob, headers: this.headers({ 'Content-Type': mime, 'cache-control': 'max-age=31536000' }),
    });
    if (!r.ok && r.status !== 409) throw new JFError(r.status, `Cloud ${r.status}`);
  }

  /** Insert / merge one event (same sn + alarm_id merges photo, video and secs). */
  async put(ev) {
    if (await this.drive.connected()) return this.drive.putEvent(this, ev);
    return (await this.rpc('pantau_put', { p_ev: ev })).id;
  }

  /** Deletes events and their files; returns how many files went. */
  async remove(ids) {
    if (await this.drive.connected()) return this.drive.removeEvents(this, ids);
    const j = await this.rpc('pantau_del', { p_ids: ids });
    const paths = j.paths || [];
    if (paths.length) await this.removePaths(paths);
    return paths.length;
  }
}

// ---------- Google Drive (Klip Gerak videos) ----------

const drives = new Map();

/** Videos in the "Pantau Klip" folder of the connected Google Drive. The Edge Function pantau-drive keeps the
 *  refresh token and hands out 1-hour access tokens for the cloud key, so no device needs a Google login. */
export class DriveStore {
  constructor(key) { this.key = key; this.tok = null; this.state = null; this.usage = null; }

  async fn(route, body = {}) {
    const r = await fetch(GDRIVE.fn + route, {
      method: 'POST', headers: { 'x-pantau-key': this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new JFError(r.status, j.error === 'belum' ? 'Google Drive belum disambungkan' : `Drive ${r.status}: ${j.error || 'gagal'}`);
    return j;
  }

  /** {connected, email}; cached for 5 min (null = unknown / no answer). */
  async status(fresh = false) {
    if (!fresh && this.state && Date.now() - this.state.at < 300000) return this.state;
    try { this.state = { ...(await this.fn('/status')), at: Date.now() }; }
    catch { if (!this.state) return { connected: false, email: '', error: true }; }
    return this.state;
  }
  async connected() { return (await this.status()).connected; }

  /** Google consent page; it comes back to `back` with ?drive=ok (or ?drive=<error>). */
  async startURL(back) { return (await this.fn('/start', { back })).url; }
  async disconnect() { await this.fn('/off'); this.tok = null; this.usage = null; this.state = { connected: false, email: '', at: Date.now() }; }

  async token() {
    if (this.tok && this.tok.exp > Date.now()) return this.tok;
    this.tokP ||= this.fn('/token').then(t => (this.tok = t)).catch(e => {
      if (e.code === 404) this.state = { connected: false, email: '', at: Date.now() };
      throw e;
    }).finally(() => { this.tokP = null; });
    return this.tokP;
  }

  async api(url, init = {}) {
    const t = await this.token();
    const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${t.token}`, ...(init.headers || {}) } });
    if (r.status === 401) this.tok = null;
    if (!r.ok && !(init.method === 'DELETE' && r.status === 404)) {
      const j = await r.json().catch(() => null);
      throw new JFError(r.status, `Drive ${r.status}: ${j?.error?.message || 'gagal'}`);
    }
    return r;
  }

  /** Bytes used by the folder + size and thumbnail link of each file (cached 10 min; uploads / deletes keep it current).
   *  Thumbnail links (lh3.googleusercontent.com, valid for hours) open without a token, so they work as <img src>. */
  async used(fresh = false) {
    if (!fresh && this.usage && Date.now() - this.usage.at < 600000) return this.usage;
    const { folder } = await this.token(), sizes = new Map(), thumbs = new Map(), events = new Map();
    let page = '';
    do {
      const q = new URLSearchParams({ q: `'${folder}' in parents and trashed = false`, fields: 'nextPageToken,files(id,size,thumbnailLink,appProperties)', pageSize: '1000', ...(page ? { pageToken: page } : {}) });
      const j = await (await this.api(`https://www.googleapis.com/drive/v3/files?${q}`)).json();
      for (const f of j.files || []) {
        sizes.set(f.id, +f.size || 0);
        if (f.thumbnailLink) thumbs.set(f.id, f.thumbnailLink);
        if (f.appProperties?.k === 'ev') events.set(f.id, f.appProperties);
      }
      page = j.nextPageToken || '';
    } while (page);
    let bytes = 0;
    for (const v of sizes.values()) bytes += v;
    return (this.usage = { bytes, sizes, thumbs, events, at: Date.now() });
  }

  /** Uploads one file into the folder → Drive file id. */
  async upload(name, blob, mime, meta = {}) {
    const { folder } = await this.token();
    const b = 'pantau' + Math.random().toString(36).slice(2);
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [folder], mimeType: mime, ...meta })}\r\n`,
      `--${b}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${b}--`]);
    const r = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,size', {
      method: 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    });
    const f = await r.json();
    if (this.usage) { this.usage.sizes.set(f.id, +f.size || blob.size); this.usage.bytes += +f.size || blob.size; }
    return f.id;
  }

  async blob(id) { return (await this.api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).blob(); }

  /** Object URL of a Drive file, kept for this visit (photos, clips opened again). */
  async objectURL(id) {
    this.urls ||= new Map();
    if (!this.urls.has(id)) this.urls.set(id, this.blob(id).then(b => URL.createObjectURL(b)).catch(e => { this.urls.delete(id); throw e; }));
    return this.urls.get(id);
  }

  /** Picture URLs for row paths (<owner>/gd/<id>): Drive's thumbnail (size px), else — for photos, not for videos
   *  (`videos`) — the file itself (Drive makes thumbnails a little after the upload). */
  async thumbURLs(paths, { size = 400, videos = new Set() } = {}) {
    const out = {}, u = await this.used(); // events() just refreshed the listing
    await Promise.all(paths.map(async p => {
      const id = p.split('/')[2], t = u.thumbs.get(id);
      out[p] = t ? t.replace(/=s\d+$/, '') + `=s${size}` : videos.has(p) ? null : await this.objectURL(id).catch(() => null);
    }));
    return out;
  }

  // Small JSON documents (web settings, the Hik-Connect relay address) as "pantau-<name>.json" in the folder,
  // updated in place.
  async docFile(name) {
    this.docs ||= new Map();
    if (this.docs.has(name)) return this.docs.get(name);
    const { folder } = await this.token();
    const q = new URLSearchParams({ q: `'${folder}' in parents and name = 'pantau-${name}.json' and trashed = false`, fields: 'files(id)', orderBy: 'modifiedTime desc' });
    const id = (await (await this.api(`https://www.googleapis.com/drive/v3/files?${q}`)).json()).files?.[0]?.id || null;
    if (id) this.docs.set(name, id);
    return id;
  }
  async getDoc(name) {
    const id = await this.docFile(name);
    if (!id) return null;
    const r = await this.api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&t=${Date.now()}`, { cache: 'no-store' });
    return { ...(await r.json()), old: [] };
  }
  async putDoc(name, doc, { keepalive = false } = {}) {
    const id = await this.docFile(name), body = JSON.stringify(doc);
    if (id) {
      await this.api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', keepalive, body, headers: { 'Content-Type': 'application/json' } });
      return;
    }
    this.docs.set(name, await this.upload(`pantau-${name}.json`, new Blob([body], { type: 'application/json' }), 'application/json'));
  }

  async remove(ids) {
    for (const id of ids) {
      await this.api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' });
      if (this.usage?.sizes.has(id)) { this.usage.bytes -= this.usage.sizes.get(id); this.usage.sizes.delete(id); }
    }
  }

  /** Rolling storage: deletes the OLDEST Klip events that have Drive files until `incoming` more bytes fit in
   *  GDRIVE.quota. Returns how many events were removed. */
  async makeRoom(cs, incoming) {
    const u = await this.used();
    const room = GDRIVE.quota - GDRIVE.reserve;
    if (u.bytes + incoming <= room) return 0;
    const rows = this.rows(await cs.owner()).reverse(); // oldest first
    let left = u.bytes;
    const ids = [];
    for (const r of rows) {
      if (left + incoming <= room) break;
      const files = [r.video, r.photo, r.alarm_photo].filter(isGdPath);
      if (!files.length) continue;
      ids.push(r.id);
      for (const p of files) left -= u.sizes.get(p.split('/')[2]) || 0;
    }
    if (ids.length) await this.removeEvents(cs, ids);
    return ids.length;
  }

  // ---- Klip events ----
  // One empty marker file per event, named "ev <cam> <time>", carrying the event in appProperties (key+value ≤ 124
  // bytes each): k='ev', sn, c (camera), e (event), a (alarm id), t (ISO time), s (seconds), and the files v / p / ap
  // (video, live photo, camera alarm photo) as Drive ids — or "/<sn>/<name>" for a file that fell back to Supabase.
  // The folder listing (used) brings every marker along, so listing, counting and rolling need no extra requests.

  static PROPS = { video: 'v', photo: 'p', alarm_photo: 'ap' };

  /** All events as rows, newest first (from the cached folder listing). */
  rows(owner) {
    const toPath = v => !v ? null : v.startsWith('/') ? owner + v : `${owner}/gd/${v}`;
    return [...(this.usage?.events || new Map())].map(([id, a]) => ({
      id, sn: a.sn || '', cam: a.c || '', event: a.e || '', alarm_id: a.a || '', at: a.t, secs: a.s ? +a.s : null, bytes: 0,
      video: toPath(a.v), photo: toPath(a.p), alarm_photo: toPath(a.ap),
    })).sort((x, y) => (y.at > x.at) - (y.at < x.at));
  }

  /** Page of events like the Supabase list: newest first, older than `before`, optionally one camera. */
  async events(cs, { before = null, limit = 120, sn = null } = {}) {
    await this.used(!before);
    const all = this.rows(await cs.owner());
    const b = before && new Date(before).toISOString();
    const rows = all.filter(r => (!sn || r.sn === sn) && (!b || r.at < b)).slice(0, limit);
    return { rows, used: 0, count: all.length, quota: GDRIVE.quota };
  }

  async putEvent(cs, ev) {
    const owner = await cs.owner();
    const val = p => isGdPath(p) ? p.split('/')[2] : p.startsWith(owner + '/') ? p.slice(owner.length) : null;
    const props = { k: 'ev', sn: String(ev.sn || '').slice(0, 40), a: String(ev.alarm_id || '').slice(0, 80) };
    if (ev.cam) props.c = String(ev.cam).slice(0, 100);
    if (ev.event) props.e = String(ev.event).slice(0, 100);
    if (ev.at) props.t = new Date(ev.at).toISOString();
    if (ev.secs != null) props.s = String(Math.round(ev.secs * 1000) / 1000);
    for (const [f, k] of Object.entries(DriveStore.PROPS)) if (ev[f]) props[k] = val(ev[f]);
    // one marker per sn + alarm id; concurrent puts of one event (photo, then video) wait for each other
    const key = `${props.sn}|${props.a}`;
    this.evLock ||= new Map();
    const run = (this.evLock.get(key) || Promise.resolve()).catch(() => {}).then(() => this.writeEvent(key, props));
    this.evLock.set(key, run);
    return run;
  }

  async writeEvent(key, props) {
    const { folder } = await this.token();
    this.evIds ||= new Map();
    let id = this.evIds.get(key);
    if (!id) {
      const q = new URLSearchParams({ q: `'${folder}' in parents and trashed = false and appProperties has { key='a' and value='${props.a.replace(/'/g, "\\'")}' }`, fields: 'files(id,appProperties)' });
      const f = (await (await this.api(`https://www.googleapis.com/drive/v3/files?${q}`)).json()).files?.find(x => x.appProperties?.sn === props.sn);
      id = f?.id;
    }
    if (id) {
      await this.api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ appProperties: props }), headers: { 'Content-Type': 'application/json' } });
    } else {
      const name = `ev ${props.c || props.sn} ${(props.t || new Date().toISOString()).slice(0, 19)}`;
      id = await this.upload(name, new Blob(['{}'], { type: 'application/json' }), 'application/json', { appProperties: props });
    }
    this.evIds.set(key, id);
    if (this.usage) this.usage.events.set(id, { ...(this.usage.events.get(id) || {}), ...props });
    return id;
  }

  /** Deletes events (marker ids) with their files; returns how many files went. */
  async removeEvents(cs, ids) {
    const u = await this.used(), owner = await cs.owner(), sb = [];
    let n = 0;
    for (const id of ids) {
      let a = u.events.get(id);
      if (!a) a = (await (await this.api(`https://www.googleapis.com/drive/v3/files/${id}?fields=appProperties`)).json()).appProperties || {};
      const files = [a.v, a.p, a.ap].filter(Boolean);
      sb.push(...files.filter(v => v.startsWith('/')).map(v => owner + v));
      await this.remove([...files.filter(v => !v.startsWith('/')), id]);
      u.events.delete(id);
      for (const [k, v] of this.evIds || []) if (v === id) this.evIds.delete(k);
      n += files.length;
    }
    if (sb.length) await cs.removePaths(sb);
    return n;
  }

  /** Stores a clip video or photo: room first, then the upload → row path <owner>/gd/<id>. */
  async put(cs, name, blob, mime) {
    await this.makeRoom(cs, blob.size);
    return `${await cs.owner()}/gd/${await this.upload(name, blob, mime)}`;
  }
}
