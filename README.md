# AI Virtual Office

Kantor virtual untuk tim AI Agent — cloud-first, mobile-first, memakai layanan gratis.

**Status: Fase 6 (hardening)** — semua fase berjalan:

1. Website online (Cloudflare Workers + D1), login GitHub pemilik, PWA untuk ponsel.
2. AI Manager (Groq) lewat Cloudflare Workflows, token dicatat dari respons asli.
3. Tim multi-agent: alur berurutan dengan dependensi dan persetujuan.
4. Kantor 3D (React Three Fiber) dengan status agent asli, mode Low Graphics, fallback 2D.
5. Agent coding: branch terpisah, build + tes otomatis, Pull Request, merge hanya oleh pemilik.
6. Hardening: rate limiting, audit log, retensi data, uji keamanan, dokumentasi.

## Struktur

```
apps/web/          React + Vite + Tailwind + PWA
apps/api/          Hono di Cloudflare Workers (src/phase2..phase6, test/)
packages/shared/   Daftar peran agent + skema Zod bersama
db/migrations/     Migrasi D1 (0001 .. 0600), idempoten
.github/workflows/ CI (typecheck, test, build) dan apply-patch
wrangler.jsonc     Satu Worker: API + aset statis
docs/SETUP.md      Panduan setup dan deploy per fase
docs/SECURITY.md   Kontrol keamanan, retensi data, batas yang diketahui
docs/ACCEPTANCE.md Status kriteria penerimaan tiap fase
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm ci` | Pasang dependensi |
| `npm run typecheck` | Cek tipe semua paket |
| `npm test` | Unit test |
| `npm run build` | Build web ke `apps/web/dist` |
| `npm run db:migrate:local` | Terapkan migrasi ke D1 lokal |
| `npm run dev:api` | Jalankan Worker lokal (butuh build web dulu) |

Panduan lengkap: [docs/SETUP.md](docs/SETUP.md). Keamanan: [docs/SECURITY.md](docs/SECURITY.md). Kriteria penerimaan: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
