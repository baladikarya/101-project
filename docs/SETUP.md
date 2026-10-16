# Setup dan Deploy — Fase 1

Target: website online di `https://ai-virtual-office.<subdomain-kamu>.workers.dev`, bisa dibuka dari HP, login GitHub, terhubung ke D1.

Semua layanan di panduan ini memakai paket gratis. Tidak perlu kartu kredit. Biarkan akun Cloudflare tetap di **Workers Free**: kalau kuota habis, layanan hanya berhenti sementara, tidak ada tagihan.

## 1. Buat repository GitHub

1. GitHub → **New repository** → nama `ai-virtual-office` → **Private**.
2. Unggah seluruh isi folder proyek ini ke branch `main`.
   - Dari PC: ekstrak zip, lalu `git init`, `git add .`, `git commit`, `git remote add origin ...`, `git push -u origin main`; atau drag-and-drop di web GitHub (**Add file → Upload files**).
   - `node_modules/` dan `dist/` memang tidak ikut; keduanya dibuat saat build.

## 2. Buat database D1

1. Dashboard Cloudflare → **Storage & databases → D1 SQL database → Create database**.
2. Nama: `ai-virtual-office-db`. Salin **Database ID**.
3. Buka tab **Console** database itu, tempel seluruh isi `db/migrations/0001_init.sql`, jalankan. Migrasi ini aman dijalankan berulang.

## 3. Isi konfigurasi di repo

Edit `wrangler.jsonc` (bisa langsung di web GitHub, ikon pensil), lalu commit ke `main`:

- `database_id` → Database ID dari langkah 2.
- `OWNER_GITHUB_LOGIN` → username GitHub kamu. Hanya akun ini yang bisa login.

## 4. Hubungkan GitHub ke Cloudflare

1. Dashboard Cloudflare → **Workers & Pages → Create → Import a repository** → pilih `ai-virtual-office`.
2. Nama Worker harus sama dengan `name` di `wrangler.jsonc`: `ai-virtual-office`.
3. Build command: `npm run build`. Deploy command: `npx wrangler deploy`. Root directory: `/`.
4. Simpan dan deploy. Setelah selesai, Cloudflare menampilkan alamat `workers.dev`.

Setiap perubahan di `main` otomatis dibangun dan di-deploy. Branch lain tidak masuk produksi.

## 5. Buat OAuth App GitHub (untuk login)

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL: alamat `workers.dev` dari langkah 4.
3. Authorization callback URL: `<alamat workers.dev>/api/auth/github/callback`.
4. Setelah dibuat, salin **Client ID** dan buat **Client secret**.

## 6. Simpan secret di Cloudflare

Worker `ai-virtual-office` → **Settings → Variables and Secrets** → tambahkan dengan tipe **Secret**:

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

Simpan dan deploy ulang. Secret tidak pernah masuk ke repo atau ke frontend.

## 7. Buka dari smartphone

1. Buka alamat `workers.dev` di Chrome (Android) atau Safari (iPhone).
2. Tekan **Masuk dengan GitHub**.
3. Pasang ke layar utama: Android lewat menu ⋮ → **Pasang aplikasi**; iPhone lewat **Bagikan → Tambah ke Layar Utama**.

Kriteria Fase 1 selesai: halaman terbuka lewat HTTPS, login berhasil, kartu **Status sistem** menunjukkan API dan Database berjalan.

## 8. Masalah umum

| Gejala | Penyebab dan solusi |
|---|---|
| Build Cloudflare gagal di `wrangler deploy`: ID database tidak valid | `database_id` di `wrangler.jsonc` masih placeholder. Isi dengan ID dari langkah 2. |
| Login kembali ke halaman masuk dengan pesan "bukan pemilik" | `OWNER_GITHUB_LOGIN` salah ketik, atau sudah ada pemilik lain di tabel `users`. |
| Pesan "GitHub tidak merespons" | Client ID/secret salah, atau callback URL di OAuth App tidak persis sama dengan alamat Worker. |
| Kartu Database menunjukkan gangguan | Migrasi belum dijalankan (langkah 2.3) atau `database_id` salah. |
| Halaman lama masih tampil setelah deploy | Tutup lalu buka lagi aplikasi; service worker memperbarui diri pada kunjungan berikutnya. |

Log runtime: Worker → **Logs** di dashboard Cloudflare.

## 9. Menjalankan lokal (opsional, butuh PC)

```bash
npm ci
npm test
npm run build
cp .dev.vars.example .dev.vars      # isi dengan OAuth App khusus lokal
npm run db:migrate:local
npm run dev:api                     # http://localhost:8787
```

OAuth App lokal memakai callback `http://localhost:8787/api/auth/github/callback`. Untuk uji lokal, ganti sementara `OWNER_GITHUB_LOGIN` di `wrangler.jsonc` bila perlu; jangan commit `.dev.vars`.

## Catatan keamanan Fase 1

- Single Owner Mode: akun pertama yang cocok dengan `OWNER_GITHUB_LOGIN` menjadi pemilik; akun lain ditolak dan dicatat di `audit_logs`.
- Sesi: token acak 256-bit, hanya hash SHA-256 yang disimpan di D1; cookie `HttpOnly`, `SameSite=Lax`, `Secure` di HTTPS, masa berlaku 30 hari.
- CSRF: request yang mengubah data wajib berasal dari origin yang sama.
- Belum ada rate limiting; itu bagian Fase 6.
