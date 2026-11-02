# Toko Sinar Soleha POS

Aplikasi point of sale berbasis web untuk toko perabotan rumah tangga. Nuxt 4 + TypeScript + Pinia + Tailwind CSS, dengan Supabase PostgreSQL sebagai backend (Auth, RLS, RPC, Realtime).

## Status

| Fase | Isi | Status |
| --- | --- | --- |
| 0 | Audit dokumen, database, arsitektur | Selesai — lihat `docs/00-phase-0-audit.md` |
| 1 | Fondasi aplikasi, layout, navigasi, auth | Selesai |
| 2 | Migrasi database, RLS, RPC katalog | **Sebagian** — 11 migrasi + 20 uji DB lokal lulus; belum diterapkan ke Supabase hosted |
| 3–8 | Katalog, kasir, inventaris, laporan, plugin, UAT | Belum |

Modul bisnis belum diimplementasikan. Dasbor menampilkan status nyata, bukan data contoh. Status Fase 2 dan langkah apply hosted ada di `docs/03-database-implementation.md`.

## Menjalankan

```bash
npm install
cp .env.example .env   # isi SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY
npm run dev
```

Tanpa kredensial Supabase, aplikasi tetap berjalan tetapi halaman login menampilkan instruksi konfigurasi dan tidak mengirim permintaan apa pun.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Server pengembangan |
| `npm run build` | Build produksi |
| `npm run typecheck` | Type check (`vue-tsc`) |
| `npm test` | Unit test (Vitest) |
| `npm run test:db` | Uji migrasi, RLS, dan RPC di PostgreSQL lokal (PGlite) |
| `npm run gen:types` | Regenerasi `types/database.generated.ts` dari schema |

## Struktur

```
app/            halaman, layout, komponen, store, composable, util
docs/           audit, arsitektur, review database, kontrak RPC, log progres
scripts/        harness uji database dan generator tipe
supabase/       starter schema (referensi), migrations/, tests/
tests/          unit test
types/          tipe database hasil generate
```

## Prinsip

- Otorisasi final di PostgreSQL (RLS + RPC); state klien hanya mengatur tampilan.
- Nilai tidak diketahui (stok/harga/biaya) tetap `NULL`, tidak pernah menjadi nol.
- Uang `numeric(14,2)`, kuantitas `numeric(14,3)`; total dihitung ulang di database.
- Ledger stok append-only; setiap perubahan punya pelaku dan alasan.
- Tidak ada foto produk, pengiriman, atau mode offline.

## Dokumentasi

- `docs/00-phase-0-audit.md` — audit dokumen, data, database, requirement, risiko
- `docs/01-architecture.md` — ADR dan batas modul
- `docs/02-database-review.md` — temuan schema dan rencana migrasi
- `docs/03-database-implementation.md` — migrasi, RLS, hasil uji, status temuan
- `docs/04-rpc-contracts.md` — kontrak RPC mutasi Fase 4/5
- `docs/PROGRESS.md` — log pengembangan
