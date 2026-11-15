const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const ROOT = path.join(DATA_DIR, 'server'); // folder script bot (halaman File)
const FILE = path.join(DATA_DIR, 'config.json');

const DEFAULTS = { name: 'Bot Telegram', startup: '', env: {}, autoRestart: true, autoStart: true, memLimitMB: 0 };
let cfg = { ...DEFAULTS };

function load() {
  fs.mkdirSync(ROOT, { recursive: true });
  try {
    cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {}
  return cfg;
}
const get = () => cfg;
function update(patch) {
  cfg = { ...cfg, ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE + '.tmp', JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(FILE + '.tmp', FILE);
  return cfg;
}

function parseEnv(text) {
  const env = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return env;
}
const envToText = (env) => Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');

module.exports = { DATA_DIR, ROOT, load, get, update, parseEnv, envToText };
