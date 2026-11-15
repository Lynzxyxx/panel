const mgr = require('./manager');
const cfgm = require('./config');

const STATE_TEXT = {
  offline: 'Mati', starting: 'Memulai', running: 'Berjalan', stopping: 'Menghentikan',
  installing: 'Memasang dependensi', crashed: 'Berhenti tak terduga',
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');
const KB = {
  inline_keyboard: [
    [{ text: 'Mulai', callback_data: 'p:start' }, { text: 'Mulai ulang', callback_data: 'p:restart' }, { text: 'Hentikan', callback_data: 'p:stop' }],
    [{ text: 'Status', callback_data: 'status' }, { text: 'Log terakhir', callback_data: 'logs' }],
  ],
};

function start() {
  const token = process.env.PANEL_BOT_TOKEN;
  if (!token) return;
  const admins = (process.env.PANEL_ADMIN_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!admins.length) {
    console.warn('[tgctl] PANEL_ADMIN_IDS kosong, kontrol lewat Telegram dinonaktifkan.');
    return;
  }

  const api = async (method, payload = {}) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'Telegram error');
    return j.result;
  };
  const send = (chat, text, extra = {}) => api('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', ...extra }).catch(() => {});

  const statusText = () => {
    const i = mgr.info();
    const c = cfgm.get();
    const up = i.startedAt ? Math.floor((Date.now() - i.startedAt) / 60000) + ' menit' : '-';
    return `<b>${esc(c.name)}</b>\nStatus: <b>${STATE_TEXT[i.state] || i.state}</b>\nAktif: ${up}\nCPU: ${mgr.stats.cpu}%  RAM: ${(mgr.stats.mem / 1048576).toFixed(0)} MB`;
  };
  const logsText = () => {
    const lines = stripAnsi(mgr.buf.join('')).split('\n').filter((l) => l.trim()).slice(-30).join('\n');
    return '<pre>' + esc(lines.slice(-3300) || '(log kosong)') + '</pre>';
  };

  async function act(chat, action) {
    try {
      if (action === 'start') await mgr.start();
      else if (action === 'stop') await mgr.stop();
      else if (action === 'restart') await mgr.restart();
      await send(chat, statusText(), { reply_markup: KB });
    } catch (e) {
      await send(chat, 'Gagal: ' + esc(e.message));
    }
  }

  let offset = 0;
  (async function loop() {
    for (;;) {
      try {
        const ups = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
        for (const u of ups) {
          offset = u.update_id + 1;
          const from = (u.message && u.message.from) || (u.callback_query && u.callback_query.from);
          const chat = u.message ? u.message.chat.id : u.callback_query && u.callback_query.message && u.callback_query.message.chat.id;
          if (!from || !chat) continue;
          if (!admins.includes(String(from.id))) {
            if (u.message) await send(chat, 'Kamu tidak punya akses ke panel ini.');
            continue;
          }
          if (u.callback_query) {
            api('answerCallbackQuery', { callback_query_id: u.callback_query.id }).catch(() => {});
            const d = u.callback_query.data || '';
            if (d.startsWith('p:')) await act(chat, d.slice(2));
            else if (d === 'status') await send(chat, statusText(), { reply_markup: KB });
            else if (d === 'logs') await send(chat, logsText());
          } else {
            const cmd = ((u.message.text || '').split(/[\s@]/)[0] || '').toLowerCase();
            if (cmd === '/logs') await send(chat, logsText());
            else if (cmd === '/on') await act(chat, 'start');
            else if (cmd === '/off') await act(chat, 'stop');
            else if (cmd === '/restart') await act(chat, 'restart');
            else await send(chat, '<b>Sora Panel</b>\n' + statusText() + '\n\nPerintah: /on /off /restart /logs', { reply_markup: KB });
          }
        }
      } catch (e) {
        console.error('[tgctl]', e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
  console.log('[tgctl] kontrol Telegram aktif untuk', admins.length, 'admin');
}

module.exports = { start };
