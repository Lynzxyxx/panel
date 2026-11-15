const fs = require('fs');
const path = require('path');
const { ROOT } = require('./config');

const E = (status, msg) => Object.assign(new Error(msg), { status });
const MAX_UNZIP = (Number(process.env.MAX_UNZIP_MB) || 1024) * 1024 * 1024;

const realRoot = () => {
  fs.mkdirSync(ROOT, { recursive: true });
  return fs.realpathSync(ROOT);
};

function assertName(name) {
  if (typeof name !== 'string' || !name || name.length > 255 || /[\/\\\0]/.test(name) || name === '.' || name === '..') {
    throw E(400, 'Nama tidak valid. Jangan pakai karakter / atau \\.');
  }
  return name;
}

// ubah path dari browser menjadi path absolut yang pasti berada di dalam ROOT
function safe(rel) {
  const lex = path.resolve(ROOT, '.' + path.posix.normalize('/' + String(rel || '').replace(/\\/g, '/')));
  let cur = lex;
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  const real = fs.realpathSync(cur);
  const rr = realRoot();
  if (real !== rr && !real.startsWith(rr + path.sep)) throw E(400, 'Lokasi di luar folder server.');
  return lex;
}
const relOf = (abs) => '/' + path.relative(ROOT, abs).split(path.sep).join('/');

function list(rel) {
  const dir = safe(rel);
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    throw E(404, 'Folder tidak ditemukan.');
  }
  if (!st.isDirectory()) throw E(400, 'Ini bukan folder.');
  const items = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (d.name.endsWith('.sora-part')) continue;
    let s;
    try {
      s = fs.statSync(path.join(dir, d.name));
    } catch {
      continue;
    }
    items.push({ name: d.name, type: s.isDirectory() ? 'dir' : 'file', size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs });
  }
  items.sort((a, b) =>
    a.type === b.type ? a.name.localeCompare(b.name, 'id', { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1
  );
  return { path: relOf(dir), items };
}

function readText(rel) {
  const p = safe(rel);
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    throw E(404, 'File tidak ditemukan.');
  }
  if (!st.isFile()) throw E(400, 'Ini bukan file.');
  if (st.size > 2 * 1024 * 1024) throw E(413, 'File terlalu besar untuk diedit (maks 2 MB).');
  const b = fs.readFileSync(p);
  if (b.includes(0)) throw E(415, 'File biner tidak bisa diedit.');
  return b.toString('utf8');
}

function writeText(rel, text) {
  const p = safe(rel);
  if (fs.existsSync(p) && !fs.statSync(p).isFile()) throw E(400, 'Ini bukan file.');
  fs.writeFileSync(p + '.sora-part', String(text));
  fs.renameSync(p + '.sora-part', p);
}

function mkdir(dirRel, name) {
  assertName(name);
  const p = safe(path.posix.join(dirRel || '/', name));
  if (fs.existsSync(p)) throw E(409, 'Nama sudah dipakai.');
  fs.mkdirSync(p);
}

function create(dirRel, name) {
  assertName(name);
  const p = safe(path.posix.join(dirRel || '/', name));
  if (fs.existsSync(p)) throw E(409, 'Nama sudah dipakai.');
  fs.writeFileSync(p, '');
}

function rename(rel, to) {
  const src = safe(rel);
  if (src === path.resolve(ROOT)) throw E(400, 'Folder utama tidak bisa diganti nama.');
  assertName(to);
  const dst = path.join(path.dirname(src), to);
  safe(relOf(dst));
  if (fs.existsSync(dst)) throw E(409, 'Nama sudah dipakai.');
  fs.renameSync(src, dst);
}

function remove(rel) {
  const p = safe(rel);
  if (p === path.resolve(ROOT)) throw E(400, 'Folder utama tidak bisa dihapus.');
  fs.rmSync(p, { recursive: true, force: true });
}

function uploadTarget(dirRel, name) {
  assertName(name);
  const dir = safe(dirRel || '/');
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw E(404, 'Folder tujuan tidak ada.');
  return safe(path.posix.join(relOf(dir), name));
}

// tebak perintah mulai dari isi folder utama
function detect() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.start) return { type: 'Node.js', cmd: 'npm start' };
    return { type: 'Node.js', cmd: `node ${pkg.main || 'index.js'}` };
  } catch {}
  for (const f of ['main.py', 'bot.py', 'app.py', 'index.py', 'run.py']) {
    if (fs.existsSync(path.join(ROOT, f))) return { type: 'Python', cmd: `python3 ${f}` };
  }
  return null;
}

function unzip(rel, flatten) {
  const AdmZip = require('adm-zip');
  const file = safe(rel);
  if (!/\.zip$/i.test(file) || !fs.existsSync(file)) throw E(400, 'Pilih file berformat .zip.');
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    throw E(400, 'File ZIP rusak atau tidak bisa dibaca.');
  }
  const entries = zip.getEntries().filter((e) => !e.entryName.startsWith('__MACOSX/') && !/(^|\/)\._/.test(e.entryName));
  if (!entries.length) throw E(400, 'ZIP kosong.');
  if (entries.length > 50000) throw E(400, 'Terlalu banyak file di dalam ZIP.');
  let total = 0;
  for (const e of entries) total += e.header.size;
  if (total > MAX_UNZIP) throw E(413, 'Ukuran isi ZIP melebihi batas ekstrak.');

  const dest = path.dirname(file);
  let strip = '';
  if (flatten) {
    const tops = new Set(entries.map((e) => e.entryName.replace(/\\/g, '/').split('/')[0]));
    if (tops.size === 1) {
      const t = [...tops][0];
      if (entries.some((e) => e.entryName.replace(/\\/g, '/').startsWith(t + '/'))) strip = t + '/';
    }
  }

  const rr = realRoot();
  let count = 0;
  for (const e of entries) {
    let name = e.entryName.replace(/\\/g, '/');
    if (strip) name = name.slice(strip.length);
    if (!name || name === '/') continue;
    const target = path.resolve(dest, name);
    if (!target.startsWith(dest + path.sep)) throw E(400, 'ZIP berisi path yang tidak aman.');
    if (e.isDirectory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const realDir = fs.realpathSync(path.dirname(target));
    if (realDir !== rr && !realDir.startsWith(rr + path.sep)) throw E(400, 'ZIP mencoba menulis di luar folder server.');
    fs.writeFileSync(target, e.getData());
    const mode = (e.attr >>> 16) & 0o777;
    fs.chmodSync(target, mode & 0o100 ? 0o755 : 0o644);
    count++;
  }
  return { extracted: count, flattened: Boolean(strip) };
}

function dirSize(dir = ROOT) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return total;
}

module.exports = { safe, relOf, list, readText, writeText, mkdir, create, rename, remove, unzip, uploadTarget, assertName, detect, dirSize };
