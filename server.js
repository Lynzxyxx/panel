require('dotenv').config();
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const express = require('express');
const { WebSocketServer } = require('ws');

const cfgm = require('./lib/config');
cfgm.load();
const auth = require('./lib/auth');
const mgr = require('./lib/manager');
const files = require('./lib/fsapi');
const tgctl = require('./lib/tgctl');

if (!process.env.ADMIN_PASSWORD) {
  console.error('ADMIN_PASSWORD belum diisi. Salin .env.example menjadi .env lalu isi password-nya.');
  process.exit(1);
}

const PUBLIC = path.join(__dirname, 'public');
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 200) * 1024 * 1024;
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'",
  });
  next();
});

// ---------------------------------------------------------------- helpers
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    if (!res.headersSent) res.status(e.status || 500).json({ ok: false, error: e.message || 'Terjadi kesalahan.' });
  });

const needAuth = (req, res, next) => (auth.isAuthed(req) ? next() : res.status(401).json({ ok: false, error: 'Sesi berakhir. Masuk lagi.' }));
const sameOrigin = (req, res, next) => {
  const o = req.headers.origin;
  if (o) {
    try {
      if (new URL(o).host !== req.headers.host) return res.status(403).json({ ok: false, error: 'Origin tidak diizinkan.' });
    } catch {
      return res.status(403).json({ ok: false, error: 'Origin tidak valid.' });
    }
  }
  next();
};
const guard = [needAuth, sameOrigin];

// ---------------------------------------------------------------- halaman
app.use('/assets', express.static(path.join(PUBLIC, 'assets'), { maxAge: '1h' }));
app.get('/', (req, res) => res.sendFile(path.join(PUBLIC, auth.isAuthed(req) ? 'app.html' : 'login.html')));
app.get('/login', (req, res) => res.redirect('/'));

// ---------------------------------------------------------------- auth
app.post('/api/login', sameOrigin, express.json({ limit: '2kb' }), wrap(async (req, res) => {
  if (auth.locked(req.ip)) return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi 10 menit lagi.' });
  const { username, password } = req.body || {};
  if (!auth.checkLogin(username, password)) {
    auth.fail(req.ip);
    await new Promise((r) => setTimeout(r, 700));
    return res.status(401).json({ ok: false, error: 'Username atau password salah.' });
  }
  auth.clear(req.ip);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `sora_session=${encodeURIComponent(auth.makeToken())}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secure ? '; Secure' : ''}`);
  res.json({ ok: true });
}));
app.post('/api/logout', sameOrigin, (req, res) => {
  res.setHeader('Set-Cookie', 'sora_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

// ---------------------------------------------------------------- kontrol server
app.post('/api/power', guard, express.json({ limit: '2kb' }), wrap(async (req, res) => {
  const a = (req.body || {}).action;
  if (a === 'start') await mgr.start();
  else if (a === 'install') await mgr.install();
  else if (a === 'stop') mgr.stop().catch(() => {});
  else if (a === 'restart') mgr.restart().catch((e) => mgr.sys(e.message));
  else if (a === 'kill') mgr.kill();
  else return res.status(400).json({ ok: false, error: 'Aksi tidak dikenal.' });
  res.json({ ok: true });
}));

app.get('/api/config', guard, (req, res) => {
  const c = cfgm.get();
  res.json({ ok: true, name: c.name, startup: c.startup, envText: cfgm.envToText(c.env), autoRestart: c.autoRestart, autoStart: c.autoStart, memLimitMB: c.memLimitMB });
});

app.put('/api/config', guard, express.json({ limit: '64kb' }), wrap(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name ?? '').trim().slice(0, 40) || 'Bot Telegram';
  const startup = String(b.startup ?? '').trim();
  if (startup.length > 500) return res.status(400).json({ ok: false, error: 'Perintah mulai terlalu panjang (maks 500 karakter).' });
  const mem = Math.floor(Number(b.memLimitMB) || 0);
  if (mem < 0 || mem > 65536) return res.status(400).json({ ok: false, error: 'Batas RAM harus 0 sampai 65536 MB.' });
  cfgm.update({ name, startup, env: cfgm.parseEnv(b.envText), autoRestart: Boolean(b.autoRestart), autoStart: Boolean(b.autoStart), memLimitMB: mem });
  bcast({ t: 'config', d: { name } });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- file
app.get('/api/files', guard, wrap(async (req, res) => res.json({ ok: true, ...files.list(req.query.path) })));
app.get('/api/files/content', guard, wrap(async (req, res) => res.json({ ok: true, content: files.readText(req.query.path) })));
app.put('/api/files/content', guard, express.text({ type: '*/*', limit: '3mb' }), wrap(async (req, res) => {
  files.writeText(req.query.path, typeof req.body === 'string' ? req.body : '');
  diskDirty = true;
  res.json({ ok: true });
}));
app.post('/api/files/mkdir', guard, express.json({ limit: '4kb' }), wrap(async (req, res) => {
  files.mkdir(req.body.path, req.body.name);
  res.json({ ok: true });
}));
app.post('/api/files/create', guard, express.json({ limit: '4kb' }), wrap(async (req, res) => {
  files.create(req.body.path, req.body.name);
  res.json({ ok: true });
}));
app.post('/api/files/rename', guard, express.json({ limit: '4kb' }), wrap(async (req, res) => {
  files.rename(req.body.path, req.body.to);
  res.json({ ok: true });
}));
app.post('/api/files/delete', guard, express.json({ limit: '4kb' }), wrap(async (req, res) => {
  files.remove(req.body.path);
  diskDirty = true;
  res.json({ ok: true });
}));
app.post('/api/files/unzip', guard, express.json({ limit: '4kb' }), wrap(async (req, res) => {
  const r = files.unzip(req.body.path, req.body.flatten !== false);
  const hint = files.detect();
  let applied = false;
  if (hint && !String(cfgm.get().startup || '').trim()) {
    cfgm.update({ startup: hint.cmd });
    applied = true;
  }
  diskDirty = true;
  res.json({ ok: true, ...r, hint, applied });
}));
app.get('/api/files/download', guard, wrap(async (req, res) => {
  const p = files.safe(req.query.path);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return res.status(404).json({ ok: false, error: 'File tidak ditemukan.' });
  res.download(p);
}));

app.put('/api/files/upload', guard, wrap(async (req, res) => {
  const target = files.uploadTarget(req.query.path, req.query.name);
  const tmp = target + '.sora-part';
  let size = 0;
  const limiter = new Transform({
    transform(chunk, enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD) return cb(Object.assign(new Error(`File melebihi batas ${Math.round(MAX_UPLOAD / 1048576)} MB.`), { status: 413 }));
      cb(null, chunk);
    },
  });
  try {
    await pipeline(req, limiter, fs.createWriteStream(tmp));
    fs.renameSync(tmp, target);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    res.setHeader('Connection', 'close');
    throw e;
  }
  diskDirty = true;
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Endpoint tidak ditemukan.' }));

// ---------------------------------------------------------------- websocket
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
let disk = 0;
let diskDirty = true;

server.on('upgrade', (req, socket, head) => {
  let originOk = true;
  if (req.headers.origin) {
    try {
      originOk = new URL(req.headers.origin).host === req.headers.host;
    } catch {
      originOk = false;
    }
  }
  if (!req.url.startsWith('/ws') || !originOk || !auth.isAuthed(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

const bcast = (obj) => {
  const s = JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.send(JSON.stringify({
    t: 'init', state: mgr.info(), stats: mgr.stats, disk, config: { name: cfgm.get().name }, memLimitMB: cfgm.get().memLimitMB, backlog: mgr.buf.join(''),
  }));
  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    if (m.t === 'cmd' && typeof m.d === 'string' && m.d.length <= 2000) mgr.sendInput(m.d);
  });
});
setInterval(() => {
  for (const c of wss.clients) {
    if (!c.isAlive) {
      c.terminate();
      continue;
    }
    c.isAlive = false;
    c.ping();
  }
}, 30000).unref();

// gabungkan output yang datang beruntun supaya tidak membanjiri browser
let pending = '';
let flushTimer = null;
mgr.on('log', (d) => {
  pending += d;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      bcast({ t: 'log', d: pending });
      pending = '';
      flushTimer = null;
    }, 40);
  }
});
mgr.on('state', (s) => bcast({ t: 'state', d: s }));
mgr.on('stats', (s) => bcast({ t: 'stats', d: s }));

setInterval(() => {
  if (!diskDirty && disk) return;
  diskDirty = false;
  disk = files.dirSize();
  bcast({ t: 'disk', d: disk });
}, 20000).unref();
disk = files.dirSize();

// ---------------------------------------------------------------- jalan
const PORT = Number(process.env.PORT) || 8080;
server.listen(PORT, () => {
  console.log(`Sora Panel berjalan di http://localhost:${PORT}`);
  const c = cfgm.get();
  if (c.autoStart && String(c.startup || '').trim()) setTimeout(() => mgr.start().catch((e) => console.error('Auto start gagal:', e.message)), 1000);
  tgctl.start();
});

const shutdown = async () => {
  try {
    await Promise.race([mgr.stop(), new Promise((r) => setTimeout(r, 12000))]);
  } catch {}
  process.exit(0);
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.on('exit', () => mgr.killSync());
