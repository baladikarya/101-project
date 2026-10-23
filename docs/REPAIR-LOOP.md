# Fase 7e — Loop perbaikan

Alur `build`: Analyst → Architect → Developer (buka PR) → QA (cek CI). Bila CI gagal, QA tidak langsung gagal:

1. Baca log job yang gagal (GitHub Actions, izin `actions: read`).
2. Developer AI menulis perbaikan sekecil mungkin dari log + isi file PR.
3. Agent commit ke **branch PR yang sama** (`agent/*`, tidak pernah `main`) dan menulis komentar di PR.
4. CI dicek lagi, hanya untuk commit perbaikan itu.

## Batas

| Batas | Nilai | Atur lewat |
| --- | --- | --- |
| Perbaikan per alur | 2 (tetap) | — |
| Token perbaikan per alur | 30000 | variabel `MAX_REPAIR_TOKENS_PER_RUN` |
| Panggilan/token harian | batas Fase 3 | `MAX_AI_CALLS_PER_DAY`, `MAX_TOKENS_PER_DAY` |
| File konteks | maks 3 file, tiap file maks 12000 karakter | — |

Habis salah satu → berhenti: komentar laporan di PR, status alur `failed` dengan alasan. Retry hanya mengecek CI lagi
(tidak ada perbaikan baru bila batas sudah habis).

## Keamanan

- Log CI dan isi file diperlakukan sebagai data, bukan instruksi.
- Perbaikan memakai aturan path proyek eksternal: tidak boleh menyentuh `.github/`, `package.json`, `wrangler.jsonc`, `.env*`.
- Token perbaikan dicatat dari angka penyedia (`p3_usage_logs`, agent `developer-fix`), termasuk bila jawaban tidak valid.
- Free Tier Only tetap berlaku.

## Uji coba terkontrol

Set variabel Cloudflare `REPAIR_DRILL=true`, jalankan alur `build`. Setelah PR dibuka, agent **sekali** menambah
`<a href="repair-drill-missing.html">` ke HTML pertama di branch PR, CI gagal, lalu perbaikan otomatis harus menghapusnya.
Setelah uji selesai, hapus variabel itu.
