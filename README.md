# Toko Sinar Soleha POS

Aplikasi point of sale berbasis web untuk toko perabotan rumah tangga. Nuxt 4 + TypeScript + Pinia + Tailwind CSS, dengan Supabase PostgreSQL sebagai backend (Auth, RLS, RPC, Realtime).

## Status

| Fase | Isi | Status |
| --- | --- | --- |
| 0 | Audit dokumen, database, arsitektur | Selesai — lihat `docs/00-phase-0-audit.md` |
| 1 | Fondasi aplikasi, layout, navigasi, auth | Selesai |
| 2 | Migrasi database, RLS, RPC katalog | **Selesai (preview hosted tervalidasi)** — 20/20 lokal + 20/20 hosted; produksi belum diterapkan |
| 3 | Katalog produk (3A), impor massal (3B) | **3A & 3B selesai (preview); 1 baris review** |
| 4 | Mesin transaksi (4A), UI kasir (4B), riwayat/void (4C), validasi hosted & E2E (4D) | **4A–4D selesai (preview); checkout aktif; produksi belum diterapkan** |
| 5–8 | Inventaris, laporan, plugin, UAT | Belum |

Katalog produk dan UI kasir sudah aktif secara lokal. Mesin transaksi database (`complete_sale`, `void_sale`) selesai dan diuji lokal serta hosted; UI kasir memanggil RPC tersebut tanpa menulis stok langsung. Verifikasi hosted untuk konkurensi, idempotensi, void, dan pembayaran **lulus** pada Phase 4D (suite hosted 10/10, browser E2E 10/10, rekonsiliasi seimbang) — lihat `docs/10-transaction-release-validation.md`. Produksi belum diterapkan.

Impor master Phase 3B sudah dijalankan ke preview pada 3 November 2026: 1.360 produk masuk dengan stok `NULL`, 1 baris review (`WAL-W1303`), 0 ditolak. Rekonsiliasi dan sisa pekerjaan ada di `docs/06-product-master-import.md`.

Phase 4A menambah `complete_sale` dan `void_sale` dengan penguncian produk, idempotensi, snapshot harga, dan ledger stok; 42/42 tes database lulus. Migrasi sudah aktif di preview dan matriks otorisasi hosted terverifikasi; uji konkurensi, idempotensi, void, dan pembayaran hosted menunggu fixture stok dan akun kasir kedua — lihat `docs/07-transaction-engine.md`.

Phase 4B menambah `/cashier` untuk owner dan kasir aktif: pencarian server-side, tabel tanpa foto, keranjang yang menggabungkan produk duplikat, pembayaran tunai/QRIS manual/split, idempotensi retry, dan nota ramah cetak. Submit checkout telah diaktifkan pada Phase 4D setelah gate validasi hosted lulus. Stok `NULL` tetap tidak dapat dijual — lihat `docs/08-cashier-interface.md`. Browser E2E kasir dapat dijalankan dengan `npm run test:e2e` (dev server lokal) — lihat `docs/10-transaction-release-validation.md`.

Phase 4C menambah riwayat transaksi (`/cashier/transactions`), detail transaksi dari snapshot tersimpan, cetak ulang struk via `ReceiptView`, dan pembatalan transaksi owner-only via `void_sale`. Pagination server-side, filter tanggal/nota/status/pembayaran, sorting stabil. Tidak join `profiles`, tidak fetch produk terkini. Lihat `docs/09-transaction-management.md`.

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
| `npm run test:hosted` | Uji Auth/RLS/RPC ke project preview (butuh akun uji lokal) |
| `npm run test:hosted:transactions` | Uji transaksi Phase 4A di preview (butuh fixture stok dan kasir kedua) |
| `npm run gen:types` | Regenerasi `types/database.generated.ts` dari schema |
| `npm run import:products` | Dry-run impor master produk; `--apply` hanya setelah persetujuan owner |

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
- `docs/05-product-catalog.md` — arsitektur, izin, dan batasan katalog Phase 3A
- `docs/06-product-master-import.md` — staging, RPC, impor, dan rekonsiliasi Phase 3B
- `docs/07-transaction-engine.md` — mesin transaksi, idempotensi, penguncian, dan void Phase 4A
- `docs/08-cashier-interface.md` — UI kasir, pembayaran, idempotensi klien, dan batas verifikasi Phase 4B
- `docs/09-transaction-management.md` — riwayat, detail, cetak ulang, dan pembatalan transaksi Phase 4C
- `docs/PROGRESS.md` — log pengembangan
