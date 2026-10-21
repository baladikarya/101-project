# Keamanan

Ringkasan kontrol keamanan AI Virtual Office dan cara memeriksanya. Semua berjalan di paket gratis Cloudflare dan GitHub.

## Model akses

- **Single Owner Mode.** Hanya akun GitHub yang cocok dengan `OWNER_GITHUB_LOGIN` yang bisa masuk. Akun lain ditolak dan dicatat di `audit_logs` (`login_denied`).
- **Sesi.** Token acak 256-bit. Yang disimpan di D1 hanya hash SHA-256. Cookie `HttpOnly`, `SameSite=Lax`, `Secure` di HTTPS, berlaku 30 hari. Sesi kedaluwarsa dihapus otomatis.
- **Semua API selain `/api/health` dan `/api/auth/*` butuh sesi.** Tanpa sesi: `401`.
- **CSRF.** Request POST/PUT/PATCH/DELETE wajib berasal dari origin yang sama; lainnya `403 forbidden_origin`.
- **Header keamanan** dipasang di semua `/api/*` (`secureHeaders` Hono).

## Rate limiting (Fase 6)

Per IP (`CF-Connecting-IP`), jendela tetap 60 detik, penghitung di D1 (`p6_rate_limits`).

| Cakupan | Batas per menit |
|---|---|
| `/api/auth/*` | 30 |
| Semua `/api/*` | 300 |
| Tulis (POST/PUT/PATCH/DELETE) | 20 |

Lewat batas: `429` dengan header `Retry-After`. Bila D1 gagal, pembatas melonggarkan diri (API tetap hidup) dan error ditulis ke log.

## Audit log (Fase 6)

Tabel `p6_audit_log` mencatat: waktu, user, IP, metode, path, status, durasi. Yang dicatat: semua perubahan data, semua `/api/auth/*`, dan semua penolakan (401, 403, 429).

- **Isi request tidak pernah disimpan**: tidak ada body, tidak ada query string. Secret tidak bisa bocor lewat audit.
- Penolakan 429 berulang dari klien yang sama dalam satu jendela hanya dicatat sekali (mencegah banjir tulis D1).
- Pemilik membaca lewat `GET /api/audit?limit=50&before=<id>` (maksimum 200 baris).
- `audit_logs` (Fase 1) tetap mencatat login, penolakan login, dan logout.

## Retensi dan pembersihan data (Fase 6)

Pembersihan berjalan malas: dipicu request tulis, di latar belakang, paling sering sekali per 12 jam, tanpa Cron. Status: `GET /api/maintenance`.

| Data | Disimpan |
|---|---|
| `p6_rate_limits` | 1 jam |
| `p6_audit_log`, `audit_logs` | 90 hari |
| `p2_task_events`, `p3_events` | 30 hari |
| `p2_usage_logs`, `p3_usage_logs` | 90 hari |
| `sessions` | sampai kedaluwarsa |

Tidak pernah dihapus otomatis: `users`, `p2_tasks`, `p3_runs`, `p3_steps`, `p5_code_tasks`.

## Secret

Semua secret (`GITHUB_CLIENT_SECRET`, `GROQ_API_KEY`, kunci GitHub App) disimpan sebagai **Secret** di Cloudflare. Tidak ada di repo, frontend, atau audit log.

## Agent dan kode

- Agent coding tidak pernah push ke `main`. Perubahan masuk lewat branch `agent/*` dan Pull Request.
- GitHub App `101-project-agent` memakai izin minimum: contents (write), pull requests (write), actions (read), metadata (read).
- Ruleset `protect-main`: PR wajib, check `test` wajib lulus, tanpa force push dan penghapusan branch.
- Merge hanya oleh pemilik setelah CI hijau.
- Free Tier Only Mode: batas tugas harian (`MAX_TASKS_PER_DAY`), angka token hanya dari respons penyedia AI.

## Pengujian

`npm test` menjalankan uji otomatis di CI pada setiap PR, termasuk:

- `apps/api/test/hardening.test.ts`: app asli dengan D1 palsu. Akses tanpa login ditolak di semua rute pemilik, sesi kedaluwarsa ditolak, CSRF, rate limit, audit tanpa body/query, pembersihan data.
- `apps/api/src/phase6/security.test.ts`: CSRF, perbandingan waktu tetap, rate limit, audit.

## Batas yang diketahui

- Rate limit per IP di D1 menambah satu tulis per request. Serangan dari banyak IP tetap bisa menghabiskan kuota tulis D1 gratis. Lapisan luar yang disarankan: aturan WAF/rate limiting Cloudflare di tingkat domain.
- Request tanpa login yang ditolak (401) tetap tercatat, sampai 300 baris per menit per IP.
- Uji alur OAuth GitHub dengan GitHub asli tidak otomatis; diuji manual dari ponsel.
- Pembersihan malas hanya berjalan bila ada request tulis. Untuk instalasi pemilik tunggal ini cukup; data lama menumpuk paling lama sampai tugas berikutnya dikirim.

## Melaporkan masalah

Proyek pribadi pemilik tunggal. Temuan keamanan: buka Issue privat di repo, atau hubungi pemilik langsung.
