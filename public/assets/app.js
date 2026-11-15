(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const enc = encodeURIComponent;

  // ------------------------------------------------------------ util
  async function api(url, opt = {}) {
    const r = await fetch(url, { credentials: 'same-origin', ...opt });
    if (r.status === 401) {
      location.reload();
      throw new Error('Sesi berakhir. Masuk lagi.');
    }
    const j = await r.json().catch(() => ({ ok: false, error: 'Respons server tidak valid.' }));
    if (!j.ok) throw new Error(j.error || 'Terjadi kesalahan.');
    return j;
  }
  const post = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const nf = (n, d = 1) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: d });
  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return nf(b / 1024) + ' KB';
    if (b < 1073741824) return nf(b / 1048576) + ' MB';
    return nf(b / 1073741824, 2) + ' GB';
  }
  function fmtUp(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    if (d) return `${d}h ${h}j`;
    if (h) return `${h}j ${m}m`;
    if (m) return `${m}m ${x}d`;
    return `${x}d`;
  }
  const fmtTime = (t) => new Date(t).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  function toast(msg, o = {}) {
    const t = el('div', 'toast' + (o.type === 'err' ? ' err' : ''));
    t.append(el('span', '', msg));
    if (o.action) {
      const b = el('button', '', o.action.label);
      b.type = 'button';
      b.onclick = () => { o.action.fn(); t.remove(); };
      t.append(b);
    }
    $('#toasts').append(t);
    setTimeout(() => t.remove(), o.ms || (o.action ? 9000 : 4500));
  }

  // ------------------------------------------------------------ dialog
  function openDialog({ title, ok = 'OK', danger = false, build }) {
    return new Promise((resolve) => {
      const dlg = $('#dlg'), body = $('#dlg-body');
      $('#dlg-title').textContent = title;
      body.replaceChildren();
      const get = build(body) || (() => true);
      const okBtn = $('#dlg-ok');
      okBtn.textContent = ok;
      okBtn.className = 'key ' + (danger ? 'stop primary' : 'primary');
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        if (dlg.open) dlg.close();
        resolve(v);
      };
      $('#dlg-form').onsubmit = (e) => { e.preventDefault(); finish(get()); };
      $('#dlg-cancel').onclick = () => finish(null);
      dlg.onclose = () => finish(null);
      dlg.showModal();
      const f = body.querySelector('input:not([type=checkbox]),textarea');
      if (f) { f.focus(); f.select(); }
    });
  }
  const promptText = (title, label, value = '', ok = 'Simpan') =>
    openDialog({
      title, ok,
      build(body) {
        const l = el('p', '', label);
        const i = el('input');
        i.type = 'text'; i.value = value; i.maxLength = 255; i.spellcheck = false; i.setAttribute('aria-label', label);
        body.append(l, i);
        return () => i.value.trim() || null;
      },
    });
  const confirmBox = (title, text, ok, danger = true) =>
    openDialog({ title, ok, danger, build(body) { body.append(el('p', '', text)); return () => true; } });

  // ------------------------------------------------------------ terminal
  const Term = (() => {
    const root = $('#log'), jump = $('#jump');
    const PAL = { 30: '#5E7482', 31: '#F2777A', 32: '#7FD6A0', 33: '#E9D66B', 34: '#7FB2F0', 35: '#C79BF0', 36: '#6FD3D9', 37: '#D9E6EB',
      90: '#7F97A5', 91: '#FF9A9C', 92: '#A3E8BD', 93: '#F5E58C', 94: '#A3C9F7', 95: '#DDB9F6', 96: '#9AE4E8', 97: '#FFFFFF' };
    let cur, cr = false, style = {}, carry = '', queue = '', raf = 0, count = 0, pinned = true;

    function newLine() {
      const d = el('div', 'ln');
      root.append(d);
      if (++count > 2500) while (count > 2000) { root.firstChild.remove(); count--; }
      return d;
    }
    function c256(n) {
      if (n < 8) return PAL[30 + n];
      if (n < 16) return PAL[90 + n - 8];
      if (n < 232) { const k = n - 16, v = (x) => (x ? x * 40 + 55 : 0); return `rgb(${v(Math.floor(k / 36))},${v(Math.floor(k / 6) % 6)},${v(k % 6)})`; }
      const g = 8 + (n - 232) * 10;
      return `rgb(${g},${g},${g})`;
    }
    function sgr(params) {
      const p = params === '' ? [0] : params.split(';').map((x) => Number(x) || 0);
      for (let i = 0; i < p.length; i++) {
        const c = p[i];
        if (c === 0) style = {};
        else if (c === 1) style.bold = true;
        else if (c === 2) style.dim = true;
        else if (c === 3) style.italic = true;
        else if (c === 4) style.ul = true;
        else if (c === 22) { style.bold = false; style.dim = false; }
        else if (c === 23) style.italic = false;
        else if (c === 24) style.ul = false;
        else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style.fg = PAL[c];
        else if (c === 39) delete style.fg;
        else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) style.bg = PAL[c >= 100 ? c - 10 : c - 10];
        else if (c === 49) delete style.bg;
        else if (c === 38 || c === 48) {
          let col = null;
          if (p[i + 1] === 5) { col = c256(p[i + 2] || 0); i += 2; }
          else if (p[i + 1] === 2) { col = `rgb(${p[i + 2] || 0},${p[i + 3] || 0},${p[i + 4] || 0})`; i += 4; }
          if (col) style[c === 38 ? 'fg' : 'bg'] = col;
        }
      }
    }
    function text(s) {
      s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1a\x7f]/g, '');
      if (!s) return;
      if (cr) { cur.replaceChildren(); cr = false; }
      const sp = el('span', '', s);
      if (style.fg) sp.style.color = style.fg;
      if (style.bg) sp.style.background = style.bg;
      if (style.bold) sp.style.fontWeight = '700';
      if (style.dim) sp.style.opacity = '.6';
      if (style.italic) sp.style.fontStyle = 'italic';
      if (style.ul) sp.style.textDecoration = 'underline';
      cur.append(sp);
    }
    function feed(chunk) {
      chunk = carry + chunk;
      carry = '';
      const m = chunk.match(/\x1b(\[[0-9;?]*)?$/);
      if (m) { carry = m[0]; chunk = chunk.slice(0, -m[0].length); }
      for (const tok of chunk.split(/(\x1b\[[0-9;?]*[A-Za-z]|\r\n|\n|\r)/)) {
        if (tok === '\n' || tok === '\r\n') { cr = false; cur = newLine(); }
        else if (tok === '\r') cr = true;
        else if (tok.startsWith('\x1b[')) {
          const f = tok.slice(-1);
          if (f === 'm') sgr(tok.slice(2, -1));
          else if (f === 'K') cur.replaceChildren();
        } else if (tok) text(tok);
      }
    }
    function flush() {
      raf = 0;
      const atBottom = pinned;
      feed(queue);
      queue = '';
      if (atBottom) root.scrollTop = root.scrollHeight;
      else jump.hidden = false;
    }
    root.addEventListener('scroll', () => {
      pinned = root.scrollTop + root.clientHeight >= root.scrollHeight - 30;
      if (pinned) jump.hidden = true;
    });
    jump.onclick = () => { root.scrollTop = root.scrollHeight; };
    function clear() {
      root.replaceChildren();
      count = 0; style = {}; carry = ''; cr = false; queue = '';
      cur = newLine();
      pinned = true; jump.hidden = true;
    }
    function write(s) {
      queue += s;
      if (!raf) raf = requestAnimationFrame(flush);
    }
    clear();
    return { write, clear };
  })();

  // ------------------------------------------------------------ status & statistik
  const STATES = {
    offline: 'Mati', starting: 'Memulai', running: 'Berjalan', stopping: 'Menghentikan',
    installing: 'Memasang dependensi', crashed: 'Berhenti tak terduga',
  };
  let S = { state: 'offline', pid: null, startedAt: null };
  let serverName = 'Bot Telegram';
  let memLimit = 0;
  const hist = { cpu: [], mem: [] };

  function setName(n) {
    serverName = n || 'Bot Telegram';
    $('#srvname').textContent = serverName;
    document.title = 'Sora Panel - ' + serverName;
  }
  function setState(s) {
    S = s;
    $('#led').dataset.s = s.state;
    $('#stateword').textContent = STATES[s.state] || s.state;
    $('#f-pid').textContent = s.pid || '-';
    const idle = s.state === 'offline' || s.state === 'crashed';
    $('#p-start').disabled = !idle;
    $('#p-restart').disabled = !['running', 'starting', 'crashed'].includes(s.state);
    $('#p-stop').disabled = !['running', 'starting', 'installing', 'crashed'].includes(s.state);
    $('#btn-install').disabled = !idle;
    const cmd = $('#cmd'), live = s.state === 'running' || s.state === 'starting';
    cmd.disabled = !live;
    cmd.placeholder = live ? 'Ketik perintah lalu Enter' : 'Mulai server untuk mengirim perintah';
    tickUp();
    if (!live) { hist.cpu = []; hist.mem = []; showStats({ cpu: 0, mem: 0 }); }
  }
  function tickUp() {
    $('#f-up').textContent = S.startedAt && S.state !== 'offline' ? fmtUp(Date.now() - S.startedAt) : '-';
  }
  setInterval(tickUp, 1000);

  function spark(canvas, data, max) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    c.strokeStyle = cssVar('--garis-tebal');
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, h - 0.5); c.lineTo(w, h - 0.5); c.stroke();
    if (data.length < 2) return;
    const N = 60, step = w / (N - 1);
    const pts = data.map((v, i) => [w - (data.length - 1 - i) * step, h - 3 - (Math.min(v, max) / max) * (h - 8)]);
    c.beginPath(); c.moveTo(pts[0][0], h);
    pts.forEach((p) => c.lineTo(p[0], p[1]));
    c.lineTo(pts[pts.length - 1][0], h); c.closePath();
    c.fillStyle = 'rgba(21,34,44,.10)'; c.fill();
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.strokeStyle = cssVar('--tinta'); c.lineWidth = 1.5; c.lineJoin = 'round'; c.stroke();
  }
  function drawCharts() {
    const cmax = Math.max(100, Math.ceil(Math.max(...hist.cpu, 0) / 100) * 100);
    spark($('#c-cpu'), hist.cpu, cmax);
    const mmax = memLimit > 0 ? memLimit * 1048576 : Math.max(64 * 1048576, Math.max(...hist.mem, 0) * 1.25);
    spark($('#c-mem'), hist.mem, mmax);
  }
  function showStats(s) {
    $('#v-cpu').textContent = nf(s.cpu) + '%';
    $('#v-mem').textContent = fmtBytes(s.mem);
    drawCharts();
  }
  function pushStats(s) {
    hist.cpu.push(s.cpu); hist.mem.push(s.mem);
    if (hist.cpu.length > 60) { hist.cpu.shift(); hist.mem.shift(); }
    showStats(s);
  }
  const setDisk = (b) => ($('#v-disk').textContent = fmtBytes(b));
  const setMemLimit = (mb) => {
    memLimit = Number(mb) || 0;
    $('#v-memlim').textContent = memLimit ? `Batas ${fmtBytes(memLimit * 1048576)}` : 'Tanpa batas';
  };
  window.addEventListener('resize', drawCharts);

  // ------------------------------------------------------------ websocket
  let ws, retry = 0;
  function setConn(on) {
    const c = $('#conn');
    c.dataset.on = on ? '1' : '0';
    c.textContent = on ? 'Terhubung' : 'Menyambung ulang';
  }
  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { retry = 0; setConn(true); };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'init') {
        Term.clear();
        Term.write(m.backlog || '');
        setName(m.config.name);
        setMemLimit(m.memLimitMB);
        setDisk(m.disk);
        setState(m.state);
        if (m.stats && m.state.state !== 'offline') pushStats(m.stats);
      } else if (m.t === 'log') Term.write(m.d);
      else if (m.t === 'state') setState(m.d);
      else if (m.t === 'stats') { if (S.state !== 'offline') pushStats(m.d); }
      else if (m.t === 'disk') setDisk(m.d);
      else if (m.t === 'config') setName(m.d.name);
    };
    ws.onclose = () => {
      setConn(false);
      fetch('/api/config', { credentials: 'same-origin' }).then((r) => { if (r.status === 401) location.reload(); }).catch(() => {});
      setTimeout(connect, Math.min(1000 * 2 ** retry++, 8000));
    };
  }

  // ------------------------------------------------------------ kontrol
  $$('.power .key').forEach((b) =>
    b.addEventListener('click', async () => {
      try { await post('/api/power', { action: b.dataset.act }); }
      catch (e) { toast(e.message, { type: 'err' }); }
    })
  );
  $('#btn-install').onclick = async () => {
    try { await post('/api/power', { action: 'install' }); } catch (e) { toast(e.message, { type: 'err' }); }
  };
  $('#btn-clear').onclick = () => Term.clear();
  $('#logout').onclick = async () => { try { await post('/api/logout', {}); } finally { location.reload(); } };

  const history = [];
  let hi = 0;
  $('#cmdform').addEventListener('submit', (e) => {
    e.preventDefault();
    const i = $('#cmd'), v = i.value;
    if (!v || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ t: 'cmd', d: v }));
    history.push(v); hi = history.length;
    i.value = '';
  });
  $('#cmd').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && history.length) { hi = Math.max(0, hi - 1); e.target.value = history[hi]; e.preventDefault(); }
    else if (e.key === 'ArrowDown') { hi = Math.min(history.length, hi + 1); e.target.value = history[hi] || ''; e.preventDefault(); }
  });

  // ------------------------------------------------------------ file
  let cwd = '/';
  const joinPath = (d, n) => (d === '/' ? '/' + n : d + '/' + n);
  const TEXT_EXT = new Set(['js', 'mjs', 'cjs', 'json', 'py', 'txt', 'md', 'env', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf', 'html', 'css', 'sh', 'ts', 'log', 'csv', 'xml', 'sql', 'gitignore', 'lock']);
  const isText = (n) => { const i = n.lastIndexOf('.'); return i <= 0 || TEXT_EXT.has(n.slice(i + 1).toLowerCase()); };

  function renderCrumbs() {
    const box = $('#crumbs');
    box.replaceChildren();
    const parts = cwd.split('/').filter(Boolean);
    const add = (label, path, here) => {
      const b = el('button', here ? 'here' : '', label);
      b.type = 'button';
      if (here) b.setAttribute('aria-current', 'page'); else b.onclick = () => { cwd = path; loadFiles(); };
      box.append(b);
    };
    add('server', '/', !parts.length);
    parts.forEach((p, i) => {
      box.append(el('span', 'sep', '/'));
      add(p, '/' + parts.slice(0, i + 1).join('/'), i === parts.length - 1);
    });
  }

  function actionLink(label, fn, danger) {
    const b = el('button', 'link' + (danger ? ' danger' : ''), label);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }

  function renderFiles(items) {
    const body = $('#fbody');
    body.replaceChildren();
    if (!items.length) {
      const e = el('div', 'empty');
      e.append(el('strong', '', 'Folder ini kosong'), el('span', '', 'Unggah script bot kamu (misalnya file .zip), lalu ekstrak di sini.'));
      body.append(e);
      return;
    }
    for (const it of items) {
      const row = el('div', 'frow');
      let name;
      if (it.type === 'dir') {
        name = el('button', 'fname dir', it.name + '/');
        name.type = 'button';
        name.onclick = () => { cwd = joinPath(cwd, it.name); loadFiles(); };
      } else name = el('span', 'fname', it.name);
      name.title = it.name;
      const act = el('div', 'fact');
      const p = joinPath(cwd, it.name);
      if (it.type === 'file') {
        if (isText(it.name)) act.append(actionLink('Edit', () => openEditor(p)));
        if (/\.zip$/i.test(it.name)) act.append(actionLink('Ekstrak', () => unzipFile(it.name)));
        const a = el('a', 'link', 'Unduh');
        a.href = '/api/files/download?path=' + enc(p);
        act.append(a);
      }
      act.append(
        actionLink('Ganti nama', async () => {
          const to = await promptText('Ganti nama', 'Nama baru untuk ' + it.name, it.name);
          if (!to || to === it.name) return;
          try { await post('/api/files/rename', { path: p, to }); loadFiles(); } catch (e) { toast(e.message, { type: 'err' }); }
        }),
        actionLink('Hapus', async () => {
          const ok = await confirmBox('Hapus ' + it.name + '?', it.type === 'dir' ? 'Folder beserta seluruh isinya akan dihapus dan tidak bisa dikembalikan.' : 'File akan dihapus dan tidak bisa dikembalikan.', 'Hapus');
          if (!ok) return;
          try { await post('/api/files/delete', { path: p }); loadFiles(); } catch (e) { toast(e.message, { type: 'err' }); }
        }, true)
      );
      row.append(name, el('span', 'fsize', it.type === 'dir' ? '' : fmtBytes(it.size)), el('span', 'ftime', fmtTime(it.mtime)), act);
      body.append(row);
    }
  }

  async function loadFiles() {
    try {
      const j = await api('/api/files?path=' + enc(cwd));
      cwd = j.path;
      renderCrumbs();
      renderFiles(j.items);
    } catch (e) {
      toast(e.message, { type: 'err' });
      if (cwd !== '/') { cwd = '/'; loadFiles(); }
    }
  }

  $('#f-mkdir').onclick = async () => {
    const n = await promptText('Folder baru', 'Nama folder', '', 'Buat');
    if (!n) return;
    try { await post('/api/files/mkdir', { path: cwd, name: n }); loadFiles(); } catch (e) { toast(e.message, { type: 'err' }); }
  };
  $('#f-new').onclick = async () => {
    const n = await promptText('File baru', 'Nama file, misalnya index.js', '', 'Buat');
    if (!n) return;
    try { await post('/api/files/create', { path: cwd, name: n }); await loadFiles(); openEditor(joinPath(cwd, n)); } catch (e) { toast(e.message, { type: 'err' }); }
  };

  async function unzipFile(name) {
    const r = await openDialog({
      title: 'Ekstrak ' + name, ok: 'Ekstrak',
      build(body) {
        body.append(el('p', '', 'Isi ZIP akan diekstrak ke folder ini. File dengan nama sama akan ditimpa.'));
        const l = el('label', 'check'), c = el('input');
        c.type = 'checkbox'; c.checked = true;
        l.append(c, document.createTextNode(' Ratakan jika isinya hanya satu folder'));
        body.append(l);
        return () => ({ flatten: c.checked });
      },
    });
    if (!r) return;
    const t = el('div', 'toast', 'Mengekstrak...');
    $('#toasts').append(t);
    try {
      const j = await post('/api/files/unzip', { path: joinPath(cwd, name), flatten: r.flatten });
      t.remove();
      const msg = `${j.extracted} file diekstrak.` + (j.applied ? ` Perintah mulai diisi: ${j.hint.cmd}.` : j.hint ? ` Terdeteksi ${j.hint.type}.` : '');
      toast(msg, { action: j.hint ? { label: 'Buka Startup', fn: () => { location.hash = '#startup'; } } : null });
      loadFiles();
    } catch (e) {
      t.remove();
      toast(e.message, { type: 'err' });
    }
  }

  // unggah
  function uploadOne(file) {
    const row = el('div', 'up');
    const bar = el('progress'), pct = el('span', '', '0%');
    bar.max = 100; bar.value = 0;
    row.append(el('span', '', file.name), bar, pct);
    $('#uploads').append(row);
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/files/upload?path=${enc(cwd)}&name=${enc(file.name)}`);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const v = Math.round((e.loaded / e.total) * 100);
      bar.value = v; pct.textContent = v + '%';
    };
    xhr.onload = () => {
      let j = {};
      try { j = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 401) return location.reload();
      if (j.ok) {
        pct.textContent = 'Selesai';
        setTimeout(() => row.remove(), 900);
        loadFiles();
        if (/\.zip$/i.test(file.name)) toast(file.name + ' terunggah.', { action: { label: 'Ekstrak', fn: () => unzipFile(file.name) } });
      } else {
        row.remove();
        toast(`${file.name}: ${j.error || 'unggah gagal'}`, { type: 'err' });
      }
    };
    xhr.onerror = () => { row.remove(); toast(file.name + ': koneksi terputus saat mengunggah.', { type: 'err' }); };
    xhr.send(file);
  }
  const uploadAll = (list) => [...list].forEach(uploadOne);
  $('#f-upload').onclick = () => $('#f-input').click();
  $('#f-input').onchange = (e) => { uploadAll(e.target.files); e.target.value = ''; };

  let dragDepth = 0;
  const filesView = () => !$('#v-file').hidden;
  window.addEventListener('dragenter', (e) => { if (filesView() && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop').hidden = true; } });
  window.addEventListener('dragover', (e) => { if (filesView()) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!filesView()) return;
    e.preventDefault();
    dragDepth = 0; $('#drop').hidden = true;
    if (e.dataTransfer && e.dataTransfer.files.length) uploadAll(e.dataTransfer.files);
  });

  // editor
  let edPath = null, edDirty = false;
  const ed = $('#editor'), edText = $('#ed-text');
  async function openEditor(p) {
    try {
      const j = await api('/api/files/content?path=' + enc(p));
      edPath = p; edText.value = j.content; setDirty(false);
      $('#ed-path').textContent = p;
      ed.showModal();
      edText.focus();
      edText.setSelectionRange(0, 0);
      edText.scrollTop = 0;
    } catch (e) { toast(e.message, { type: 'err' }); }
  }
  function setDirty(d) { edDirty = d; $('#ed-dirty').hidden = !d; }
  async function saveEditor() {
    try {
      await api('/api/files/content?path=' + enc(edPath), { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: edText.value });
      setDirty(false);
      toast('Tersimpan.');
    } catch (e) { toast(e.message, { type: 'err' }); }
  }
  async function closeEditor() {
    if (edDirty) {
      const ok = await confirmBox('Tutup tanpa menyimpan?', 'Perubahan yang belum disimpan akan hilang.', 'Tutup');
      if (!ok) return;
    }
    ed.close();
  }
  edText.addEventListener('input', () => setDirty(true));
  edText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveEditor(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const s = edText.selectionStart;
      edText.setRangeText('  ', s, edText.selectionEnd, 'end');
      setDirty(true);
    }
  });
  $('#ed-save').onclick = saveEditor;
  $('#ed-close').onclick = closeEditor;
  ed.addEventListener('cancel', (e) => { if (edDirty) { e.preventDefault(); closeEditor(); } });

  // ------------------------------------------------------------ startup
  async function loadConfig() {
    try {
      const c = await api('/api/config');
      $('#s-name').value = c.name;
      $('#s-startup').value = c.startup;
      $('#s-env').value = c.envText;
      $('#s-restart').checked = c.autoRestart;
      $('#s-auto').checked = c.autoStart;
      $('#s-mem').value = c.memLimitMB;
    } catch (e) { toast(e.message, { type: 'err' }); }
  }
  $$('.chip').forEach((c) => (c.onclick = () => { $('#s-startup').value = c.dataset.cmd; $('#s-startup').focus(); }));
  $('#sform').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: $('#s-name').value, startup: $('#s-startup').value, envText: $('#s-env').value,
          autoRestart: $('#s-restart').checked, autoStart: $('#s-auto').checked, memLimitMB: $('#s-mem').value,
        }),
      });
      setMemLimit($('#s-mem').value);
      toast('Pengaturan disimpan. Berlaku saat server dimulai berikutnya.');
    } catch (x) { toast(x.message, { type: 'err' }); }
  });
  $('#s-install').onclick = async () => {
    try { await post('/api/power', { action: 'install' }); location.hash = '#konsol'; } catch (e) { toast(e.message, { type: 'err' }); }
  };

  // ------------------------------------------------------------ router
  function route() {
    const v = (location.hash || '#konsol').slice(1);
    const view = ['konsol', 'file', 'startup'].includes(v) ? v : 'konsol';
    $$('.view').forEach((s) => (s.hidden = s.id !== 'v-' + view));
    $$('.menu a').forEach((a) => {
      const on = a.dataset.view === view;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (view === 'file') loadFiles();
    else if (view === 'startup') loadConfig();
    else requestAnimationFrame(drawCharts);
  }
  window.addEventListener('hashchange', route);

  setState(S);
  route();
  connect();
})();
