# AI Virtual Office

Kantor virtual untuk tim AI Agent — cloud-first, mobile-first, memakai layanan gratis.

**Status: Fase 1** — website online (Cloudflare Workers + D1), login GitHub pemilik, dashboard 2D untuk ponsel, PWA.
Agent, penyedia AI, kantor 3D, dan runner coding ditambahkan di fase berikutnya.

## Struktur

```
apps/web/          React + Vite + Tailwind + PWA
apps/api/          Hono di Cloudflare Workers (auth, health, /api/me)
packages/shared/   Daftar peran agent + skema Zod bersama
db/migrations/     Migrasi D1
.github/workflows/ CI (typecheck, test, build) pada Pull Request
wrangler.jsonc     Satu Worker: API + aset statis
docs/SETUP.md      Panduan setup dan deploy
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

Panduan lengkap: [docs/SETUP.md](docs/SETUP.md).
