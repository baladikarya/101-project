# Kriteria Penerimaan

Status tiap fase terhadap kriteria "selesai bila" di spesifikasi. Bukti diambil dari uji nyata di ponsel pemilik dan dari CI.

| Fase | Kriteria | Bukti | Status |
|---|---|---|---|
| 1 | Website online lewat HTTPS, login GitHub pemilik, kartu Status sistem menunjukkan API dan Database jalan | Diakses dari ponsel di `*.workers.dev`, login berhasil | Terpenuhi |
| 2 | Satu tugas dari ponsel benar-benar dikerjakan agent dan tetap terlihat setelah browser ditutup; token dari respons asli; Pause/Resume/Retry | Tugas "Selesai" dengan token nyata, Pause/Resume/Retry diuji | Terpenuhi |
| 3 | Minimal satu alur Analyst → Architect → Developer → QA berjalan sampai selesai | Alur standar 4/4 langkah "Selesai", 11.409 token | Terpenuhi |
| 4 | Kantor 3D mulus di ponsel dan menampilkan status agent asli dari database; Low Graphics dan fallback 2D | Diuji di ponsel, lancar | Terpenuhi |
| 5 | Agent membuat Pull Request asli yang lolos tes dan menunggu persetujuan pemilik | PR dari `101-project-agent[bot]`, CI `test` hijau, merge oleh pemilik; ruleset `protect-main` aktif | Terpenuhi |
| 6 | Rate limiting | `p6_rate_limits`, 429 + `Retry-After`; tes otomatis | Terpenuhi (CI) |
| 6 | Audit log lengkap | `p6_audit_log`, `GET /api/audit`; terverifikasi di ponsel; tes otomatis | Terpenuhi (CI + ponsel) |
| 6 | Pembersihan data | `GET /api/maintenance`, `lastCleanup` terisi; tes otomatis | Terpenuhi (CI + ponsel) |
| 6 | Uji keamanan | `security.test.ts`, `hardening.test.ts` hijau di CI | Terpenuhi (CI) |
| 6 | Penyempurnaan dokumentasi | README, SETUP, SECURITY, dokumen ini | Terpenuhi setelah PR ini di-merge |

## Cek akhir di ponsel (oleh pemilik)

- [ ] Buka aplikasi, login, kirim satu tugas sampai "Selesai".
- [ ] `/api/audit` menampilkan baris `POST /api/tasks` dengan user Anda.
- [ ] `/api/maintenance` menampilkan `lastCleanup` terisi.
- [ ] Buka `/api/audit` tanpa login (jendela penyamaran) → `{"error":"unauthorized"}`.
- [ ] Setelah semua lancar: ubah repo ke **Private** (Settings → Danger Zone).
