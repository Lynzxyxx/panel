# Sora Panel

Panel web untuk menjalankan script bot Telegram di server sendiri: konsol langsung,
manajer file (unggah ZIP lalu ekstrak), dan tombol Mulai / Mulai ulang / Hentikan.

## Cara kerja singkat
1. Masuk ke panel.
2. Buka **File**, unggah script bot (`.zip`), klik **Ekstrak**.
3. Buka **Startup**: cek perintah mulai (terisi otomatis untuk Node.js / Python), isi `BOT_TOKEN` di variabel lingkungan, simpan.
4. Klik **Pasang dependensi** (menjalankan `npm install` / `pip install -r requirements.txt`).
5. Kembali ke **Konsol**, klik **Mulai**. Output bot tampil langsung, dan kamu bisa mengetik perintah ke stdin.

Mendukung bot Node.js dan Python. Perintah mulai bebas, misalnya `node index.js`, `npm start`, `python3 main.py`.

## Fitur
- Konsol langsung (WebSocket), warna ANSI, riwayat 300 KB, input perintah dengan riwayat panah atas/bawah
- Indikator status, PID, lama aktif, grafik CPU dan RAM, ukuran disk
- Mulai / Mulai ulang / Hentikan (SIGTERM, dipaksa SIGKILL setelah 10 detik; seluruh proses anak ikut berhenti)
- Mulai ulang otomatis saat crash (maks 5 kali per menit), mulai otomatis saat panel menyala, batas RAM
- File: unggah (seret-lepas, hingga 200 MB), edit, ekstrak ZIP, unduh, ganti nama, hapus
- Variabel lingkungan disimpan di panel; rahasia panel tidak diteruskan ke script
- Opsional: kontrol lewat Telegram (`/on`, `/off`, `/restart`, `/logs`, tombol inline)

## Instalasi — Docker (disarankan)
```bash
cp .env.example .env        # isi ADMIN_PASSWORD
docker compose up -d --build
```
Buka `http://IP-SERVER:8080`. Data tersimpan di volume `sora-data`.

## Instalasi — Manual (Linux)
Butuh Node.js 20+, dan Python 3 jika bot kamu Python.
```bash
npm install
cp .env.example .env        # isi ADMIN_PASSWORD
npm start
# agar tidak mati:
npm i -g pm2 && pm2 start server.js --name sora-panel && pm2 save && pm2 startup
```
Panel membutuhkan **Linux** (membaca `/proc` untuk statistik CPU/RAM).

## Kontrol lewat Telegram (opsional)
Buat bot baru di @BotFather khusus panel (jangan pakai token bot yang dijalankan di panel), lalu isi di `.env`:
```
PANEL_BOT_TOKEN=...
PANEL_ADMIN_IDS=123456789
```
Kirim `/start` ke bot itu: ada tombol Mulai, Mulai ulang, Hentikan, Status, dan Log terakhir.
Hanya ID di `PANEL_ADMIN_IDS` yang diizinkan.

## Keamanan — baca ini
- Panel menjalankan kode yang kamu unggah, jadi siapa pun yang bisa masuk bisa menjalankan perintah di server. Pakai password yang kuat.
- Pasang di belakang **HTTPS** (Caddy atau Nginx + Let's Encrypt) agar password dan cookie tidak lewat HTTP polos.
- Batasi percobaan login: 8 kali gagal per IP, lalu dikunci 10 menit.
- Di Docker, script berjalan sebagai user biasa (bukan root) di dalam container.
- Font dimuat dari Google Fonts; jika tidak ada internet di browser, tampilan memakai font bawaan sistem.

## Variabel `.env`
| Nama | Fungsi |
|---|---|
| `ADMIN_USER` | username login (default `admin`) |
| `ADMIN_PASSWORD` | password login (wajib) |
| `PORT` | port panel (default 8080) |
| `MAX_UPLOAD_MB` / `MAX_UNZIP_MB` | batas unggah / hasil ekstrak |
| `PANEL_BOT_TOKEN` / `PANEL_ADMIN_IDS` | kontrol lewat Telegram |

## Masalah umum
| Gejala | Solusi |
|---|---|
| Panel langsung berhenti saat start | Isi `ADMIN_PASSWORD` di `.env` |
| "Isi perintah mulai di halaman Startup dulu" | Isi perintah mulai, simpan |
| `Cannot find module ...` di konsol | Klik **Pasang dependensi** |
| Bot Telegram error 409 | Bot yang sama sedang jalan di tempat lain |
| Unggahan gagal untuk file besar | Naikkan `MAX_UPLOAD_MB`; jika di belakang Nginx, naikkan `client_max_body_size` |
