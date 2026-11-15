const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const cfgm = require('./config');

const MAX_BUF = 300 * 1024;
const CLK = 100; // tick per detik
const PAGE = 4096;
const SECRET_ENV = ['ADMIN_USER', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'PANEL_BOT_TOKEN', 'PANEL_ADMIN_IDS'];

// total CPU tick + RSS semua proses dalam satu sesi (proses bot + anak-anaknya)
function readSession(sid) {
  let ticks = 0;
  let rss = 0;
  let entries;
  try {
    entries = fs.readdirSync('/proc');
  } catch {
    return null;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const s = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      const f = s.slice(s.lastIndexOf(')') + 2).split(' ');
      if (Number(f[3]) !== sid) continue;
      ticks += Number(f[11]) + Number(f[12]);
      rss += Number(f[21]) * PAGE;
    } catch {}
  }
  return { ticks, rss };
}

class Manager extends EventEmitter {
  constructor() {
    super();
    this.state = 'offline';
    this.child = null;
    this.pid = null;
    this.startedAt = null;
    this.mode = null;
    this.stopping = false;
    this.buf = [];
    this.bufSize = 0;
    this.stats = { cpu: 0, mem: 0 };
    this.crashes = [];
    this.lastTicks = null;
    this.lastT = 0;
  }

  info() {
    return { state: this.state, pid: this.pid, startedAt: this.startedAt };
  }
  set(state) {
    this.state = state;
    this.emit('state', this.info());
  }
  log(text) {
    this.buf.push(text);
    this.bufSize += text.length;
    while (this.bufSize > MAX_BUF && this.buf.length > 1) this.bufSize -= this.buf.shift().length;
    this.emit('log', text);
  }
  sys(msg) {
    this.log(`\x1b[33m[sora]\x1b[0m ${msg}\r\n`);
  }

  childEnv() {
    const e = { ...process.env };
    for (const k of SECRET_ENV) delete e[k];
    return { ...e, PYTHONUNBUFFERED: '1', FORCE_COLOR: '1', ...cfgm.get().env };
  }

  _spawn(cmd, mode) {
    const child = spawn('sh', ['-c', cmd], {
      cwd: cfgm.ROOT,
      env: this.childEnv(),
      detached: true, // grup proses sendiri, supaya bisa dihentikan beserta anak-anaknya
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.pid = child.pid;
    this.startedAt = Date.now();
    this.mode = mode;
    this.stopping = false;
    this.lastTicks = null;
    this.limitHit = false;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => this.log(d));
    child.stderr.on('data', (d) => this.log(d));
    child.stdin.on('error', () => {});
    child.on('error', (e) => {
      this.sys(`Gagal menjalankan: ${e.message}`);
      this._finalize(child, 1, null, mode);
    });
    child.on('exit', (code, signal) => {
      setTimeout(() => this._finalize(child, code, signal, mode), 500); // beri waktu output terakhir
    });
    child.on('close', (code, signal) => this._finalize(child, code, signal, mode));

    this._startStats();
    this.emit('state', this.info());
    return child;
  }

  async start() {
    if (!['offline', 'crashed'].includes(this.state)) throw new Error('Server sedang tidak bisa dimulai (status: ' + this.state + ').');
    const cmd = String(cfgm.get().startup || '').trim();
    if (!cmd) throw new Error('Isi perintah mulai di halaman Startup dulu.');
    clearTimeout(this.restartTimer);
    this.sys(`Menjalankan: ${cmd}`);
    this.set('starting');
    const child = this._spawn(cmd, 'run');
    setTimeout(() => {
      if (this.child === child && this.state === 'starting') this.set('running');
    }, 1500);
  }

  async install() {
    if (!['offline', 'crashed'].includes(this.state)) throw new Error('Hentikan server dulu sebelum memasang dependensi.');
    const cmds = [];
    if (fs.existsSync(path.join(cfgm.ROOT, 'package.json'))) cmds.push('npm install --no-audit --no-fund');
    if (fs.existsSync(path.join(cfgm.ROOT, 'requirements.txt'))) cmds.push('pip install -r requirements.txt');
    if (!cmds.length) throw new Error('package.json atau requirements.txt tidak ditemukan di halaman File.');
    clearTimeout(this.restartTimer);
    const cmd = cmds.join(' && ');
    this.sys(`Memasang dependensi: ${cmd}`);
    this.set('installing');
    this._spawn(cmd, 'install');
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.child) {
        clearTimeout(this.restartTimer);
        if (this.state === 'crashed') this.set('offline');
        return resolve();
      }
      this.once('stopped', resolve);
      if (this.stopping) return;
      this.stopping = true;
      this.set('stopping');
      this.sys('Menghentikan server...');
      const pid = this.child.pid;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {}
      clearTimeout(this.killTimer);
      this.killTimer = setTimeout(() => {
        if (this.child && this.child.pid === pid) {
          this.sys('Tidak merespons, dipaksa berhenti.');
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {}
        }
      }, 10000);
    });
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  kill() {
    if (!this.child) return;
    this.stopping = true;
    try {
      process.kill(-this.child.pid, 'SIGKILL');
    } catch {}
  }

  sendInput(text) {
    if (!this.child || this.mode !== 'run') return false;
    this.log(`\x1b[2m› ${text}\x1b[0m\r\n`);
    try {
      this.child.stdin.write(text + '\n');
    } catch {}
    return true;
  }

  _finalize(child, code, signal, mode) {
    if (child._done) return;
    child._done = true;
    if (this.child !== child) return;
    try {
      process.kill(-child.pid, 'SIGKILL'); // bersihkan sisa proses di grup
    } catch {}
    clearTimeout(this.killTimer);
    this._stopStats();
    this.child = null;
    this.pid = null;
    this.startedAt = null;
    this.stats = { cpu: 0, mem: 0 };
    this.emit('stats', this.stats);
    const wasStopping = this.stopping;
    this.stopping = false;

    if (mode === 'install') {
      this.sys(wasStopping ? 'Instalasi dibatalkan.' : code === 0 ? 'Instalasi selesai.' : `Instalasi gagal (kode ${code}).`);
      this.set('offline');
      this.emit('stopped');
      return;
    }
    if (wasStopping) {
      this.sys('Server dihentikan.');
      this.set('offline');
      this.emit('stopped');
      return;
    }

    const abnormal = code !== 0;
    this.sys(signal ? `Proses berhenti (sinyal ${signal}).` : `Proses berhenti (kode ${code}).`);
    if (abnormal) {
      this.set('crashed');
      if (cfgm.get().autoRestart && this._canRestart()) {
        this.sys('Mulai ulang otomatis dalam 3 detik...');
        this.restartTimer = setTimeout(() => {
          if (this.state === 'crashed') this.start().catch((e) => this.sys(e.message));
        }, 3000);
      }
    } else {
      this.set('offline');
    }
    this.emit('stopped');
  }

  _canRestart() {
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < 60000);
    this.crashes.push(now);
    if (this.crashes.length > 5) {
      this.sys('Terlalu sering berhenti dalam 1 menit, mulai ulang otomatis dihentikan. Periksa error di atas.');
      return false;
    }
    return true;
  }

  _startStats() {
    this._stopStats();
    this.statTimer = setInterval(() => this._sample(), 2000);
    this.statTimer.unref();
  }
  _stopStats() {
    clearInterval(this.statTimer);
  }
  _sample() {
    if (!this.pid) return;
    const s = readSession(this.pid);
    if (!s) return;
    const now = Date.now();
    let cpu = 0;
    if (this.lastTicks != null) {
      const dt = (now - this.lastT) / 1000;
      cpu = Math.max(0, ((s.ticks - this.lastTicks) / CLK / dt) * 100);
    }
    this.lastTicks = s.ticks;
    this.lastT = now;
    this.stats = { cpu: Math.round(cpu * 10) / 10, mem: s.rss };
    this.emit('stats', this.stats);

    const lim = Number(cfgm.get().memLimitMB) * 1024 * 1024;
    if (lim > 0 && s.rss > lim && this.mode === 'run' && !this.limitHit && !this.stopping) {
      this.limitHit = true;
      this.sys('Batas RAM terlampaui, server dihentikan paksa.');
      try {
        process.kill(-this.pid, 'SIGKILL');
      } catch {}
    }
  }

  killSync() {
    if (this.child) {
      try {
        process.kill(-this.child.pid, 'SIGKILL');
      } catch {}
    }
  }
}

module.exports = new Manager();
