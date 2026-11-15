(() => {
  const f = document.getElementById('f');
  const err = document.getElementById('err');
  const go = document.getElementById('go');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    go.disabled = true;
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: f.username.value, password: f.password.value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || 'Gagal masuk.');
      location.reload();
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
      go.disabled = false;
      f.password.select();
    }
  });
})();
