const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const f = path.join(DATA_DIR, 'secret.key');
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(f, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const DAY = 86400e3;

function checkLogin(user, pass) {
  const a = crypto.timingSafeEqual(sha(user || ''), sha(process.env.ADMIN_USER || 'admin'));
  const b = crypto.timingSafeEqual(sha(pass || ''), sha(process.env.ADMIN_PASSWORD || ''));
  return a && b;
}

function makeToken() {
  const v = String(Date.now() + 7 * DAY);
  return `${v}.${sign(v)}`;
}
function verifyToken(t) {
  if (!t) return false;
  const [v, sig] = String(t).split('.');
  if (!v || !sig) return false;
  const good = sign(v);
  if (sig.length !== good.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
  return Number(v) > Date.now();
}

function parseCookies(h) {
  const o = {};
  String(h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) {
      try {
        o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
      } catch {}
    }
  });
  return o;
}
const isAuthed = (req) => verifyToken(parseCookies(req.headers.cookie).sora_session);

// batas percobaan login per IP
const fails = new Map();
const WINDOW = 10 * 60 * 1000;
function locked(ip) {
  const f = fails.get(ip);
  return Boolean(f && f.n >= 8 && Date.now() - f.t < WINDOW);
}
function fail(ip) {
  const f = fails.get(ip);
  fails.set(ip, { n: (f && Date.now() - f.t < WINDOW ? f.n : 0) + 1, t: Date.now() });
}
const clear = (ip) => fails.delete(ip);

module.exports = { checkLogin, makeToken, isAuthed, locked, fail, clear, DAY };
