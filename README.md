# Toko Sinar Soleha POS

Aplikasi point of sale berbasis web untuk toko perabotan rumah tangga. Nuxt 4 + TypeScript + Pinia + Tailwind CSS, dengan Supabase PostgreSQL sebagai backend (Auth, RLS, RPC, Realtime).

## Status

| Fase | Isi | Status |
| --- | --- | --- |
| 0 | Audit dokumen, database, arsitektur | Selesai — lihat `docs/00-phase-0-audit.md` |
| 1 | Fondasi aplikasi, layout, navigasi, auth | Selesai |
| 2 | Migrasi database, RLS, RPC katalog | **Selesai (preview hosted tervalidasi)** — 23/23 migrasi tersinkron; produksi belum diterapkan |
| 3 | Katalog produk (3A), impor massal (3B) | **3A & 3B selesai (preview); 1.361/1.361 baris impor masuk** |
| 4 | Mesin transaksi (4A), UI kasir (4B), riwayat/void (4C), validasi hosted & E2E (4D) | **4A–4D selesai (preview); checkout aktif; produksi belum diterapkan** |
| 5 | Mesin inventaris (5A), UI opname (5B), UI inventaris (5C), validasi hosted (5D), keandalan inventaris (5E), kesiapan hosted (5E.1) | **5A–5D selesai & diuji hosted; 5E.1 selesai: 23/23 migrasi dan regresi read-only 11/11; pengarsipan fixture + staf B menunggu** |
| 6 | Laporan penjualan, per produk, exception data, ekspor CSV | **Selesai & diuji lokal** |
| 7 | Plugin opsional: printer, scanner, gateway QRIS, halaman pengaturan | **Selesai & diuji lokal** |
| 8 | Keamanan & UAT | **Audit selesai; UAT hosted siap dijalankan di preview** — lihat `docs/16-security-uat.md` |
| 9 | Halaman pengguna, audit log, filter stok rendah, ekspor CSV | **Selesai & diuji lokal** — lihat `docs/17-users-audit.md` |
| 10 | Realtime stok (POS-03, NFR-04, DB-16) | **Selesai & sudah di preview (Broadcast terverifikasi hosted)** — lihat `docs/18-realtime-stock.md` |
| 11 | Koreksi stok manual (DB-03) | **Selesai, migrasi di preview & probe hosted 8/8 lulus** |

Katalog produk dan UI kasir sudah aktif secara lokal. Mesin transaksi database (`complete_sale`, `void_sale`) selesai dan diuji lokal serta hosted; UI kasir memanggil RPC tersebut tanpa menulis stok langsung. Verifikasi hosted untuk konkurensi, idempotensi, void, dan pembayaran **lulus** pada Phase 4D (suite hosted 10/10, browser E2E 10/10, rekonsiliasi seimbang) — lihat `docs/10-transaction-release-validation.md`. Produksi belum diterapkan.

Impor master Phase 3B sudah dijalankan ke preview pada 3 November 2026: 1.360 produk masuk dengan stok `NULL`, 1 baris review (`WAL-W1303`), 0 ditolak. Baris review itu diselesaikan pada 4 November 2026 lewat RPC `resolve_product_import_review` (migrasi `20261106120000`): harga jual/beli yang tertukar dikoreksi menjadi 20.000/9.500, sehingga run kini **1.361/1.361 imported, 0 review**. Rekonsiliasi dan sisa pekerjaan ada di `docs/06-product-master-import.md`.

Phase 4A menambah `complete_sale` dan `void_sale` dengan penguncian produk, idempotensi, snapshot harga, dan ledger stok; 42/42 tes database lulus. Migrasi sudah aktif di preview, matriks otorisasi hosted terverifikasi, dan pada Phase 4D uji konkurensi, idempotensi, void, serta pembayaran hosted lulus 10/10 — lihat `docs/07-transaction-engine.md`.

Phase 4B menambah `/cashier` untuk owner dan kasir aktif: pencarian server-side, tabel tanpa foto, keranjang yang menggabungkan produk duplikat, pembayaran tunai/QRIS manual/split, idempotensi retry, dan nota ramah cetak. Submit checkout telah diaktifkan pada Phase 4D setelah gate validasi hosted lulus. Stok `NULL` tetap tidak dapat dijual — lihat `docs/08-cashier-interface.md`. Browser E2E kasir dapat dijalankan dengan `npm run test:e2e` (dev server lokal) — lihat `docs/10-transaction-release-validation.md`.

Phase 4C menambah riwayat transaksi (`/cashier/transactions`), detail transaksi dari snapshot tersimpan, cetak ulang struk via `ReceiptView`, dan pembatalan transaksi owner-only via `void_sale`. Pagination server-side, filter tanggal/nota/status/pembayaran, sorting stabil. Tidak join `profiles`, tidak fetch produk terkini. Lihat `docs/09-transaction-management.md`.

Phase 5A menambah mesin inventaris di database: enam RPC opname (`create_stock_opname`, `record_stock_opname_count`, `submit_stock_opname`, `approve_stock_opname`, `post_stock_opname`, `cancel_stock_opname`), snapshot stok/versi server-side untuk seluruh katalog, saldo awal (`opening_balance`) termasuk kasus nol, log selisih immutable, serta penanganan konflik versi yang mengembalikan sesi ke `counting` tanpa memposting apa pun. Tes database 72/72 (30 tes opname grup A–H, termasuk snapshot 1.406 produk dalam satu statement) — lihat `docs/11-inventory-engine.md`.

Phase 5B menambah UI opname di `/stock-opname`: daftar sesi dengan filter status dan pencarian nomor, dialog pembuatan sesi (seluruh katalog / kategori / produk terpilih), halaman detail dengan tabel item dan highlight item yang perlu dihitung ulang, form hitung yang memvalidasi presisi serta alasan saldo awal di klien, alur submit → setujui → posting dengan konfirmasi owner, dan pembatalan beralasan. Konflik versi ditampilkan sebagai panel recount, bukan error. Migrasi 5A **sudah** diterapkan ke preview (4 November 2026), jadi halaman ini bisa dipakai di hosted — lihat `docs/12-stock-opname-ui.md`.

Phase 5C menambah halaman inventaris baca-saja di `/inventory`: saldo stok per produk dengan filter saldo belum diketahui/negatif/kosong, histori pergerakan stok (`/inventory/movements`) dengan filter jenis dan rentang tanggal, serta laporan selisih opname (`/inventory/discrepancies`) dengan filter alasan. Ketiganya memakai `capability: inventory.read`, tidak menambah RPC atau migrasi, dan menampilkan saldo `NULL` sebagai “—” (bukan nol). Rincian ada di `docs/13-inventory-ui.md`.

Phase 5D memvalidasi mesin dan UI inventaris pada project preview: suite hosted 24/24 (saldo awal positif dan nol, no-change/naik/turun, penegakan alasan, konflik versi, posting paralel dua klien owner, Broadcast Realtime, snapshot 1.361 item dalam 113 ms) dan E2E browser 17/17 dengan tiga konteks terpisah. Audit menemukan cacat nyata: setelah konflik versi, snapshot tidak pernah di-refresh sehingga sesi tidak akan pernah bisa diposting ulang. Migrasi `20261106130000` memperbaikinya dengan me-rebase snapshot saat recount. 1.361 produk impor tetap berstok `NULL` dan tidak menerima satu movement pun — lihat `docs/19-inventory-hosted-validation.md`.

Phase 5E menutup tiga temuan 5D. Detail opname tidak lagi dimuat sekaligus: header dan delapan counter global berasal dari RPC agregat `get_stock_opname_summary`, sedangkan tabel memakai `list_stock_opname_items` dengan `limit`/`offset` dan urutan deterministik `sku ASC, id ASC`, sehingga sesi 1.361 item utuh dan filter/pencarian berlaku untuk seluruh sesi. Dialog hitung ulang membaca `get_stock_opname_item_context` untuk menampilkan snapshot, stok sistem saat ini, dan hitungan baru sebagai tiga angka terpisah; `record_stock_opname_count` tetap satu-satunya yang me-rebase di dalam transaksinya. Audit read-only 48 produk uji menemukan **A=0, B=13, C=3, D=32** — tidak ada kandidat hapus fisik, seluruh rekomendasi berupa pengarsipan. Hasil lokal: 101/101 tes DB, 275/275 unit, typecheck dan build lulus. Tiga migrasi baru (0021–0023) sudah diterapkan ke preview 4 November 2026 dan diuji read-only 11/11; cleanup fixture menunggu approval owner — lihat `docs/20-preview-fixture-inventory.md`.

Phase 5E.1 menerapkan tiga migrasi 5E ke preview setelah approval eksplisit: remote kini 23/23, tipe digenerate ulang dari `--linked`, dan regresi read-only 11/11 lulus pada sesi `cancelled` berisi 1.361 item (ringkasan, paginasi 50/100/250, pencarian, filter, konteks recount, otorisasi peran). Tidak ada stok, movement, sesi, atau fixture yang berubah. Pengarsipan delapan fixture dan pembuatan staf B masih menunggu langkah terpisah — lihat `docs/21-phase-5e-hosted-readiness.md`.

Phase 7 menambahkan tiga integrasi opsional di balik satu kontrak adapter: printer thermal (fallback dialog browser), barcode scanner keyboard-wedge, dan gateway QRIS yang secara jujur dilaporkan tidak tersedia pada build SPA ini. Halaman `/settings` (owner-only) mengatur flag dan `public_config` non-rahasia lewat RPC yang sudah ada; tidak ada migrasi baru. Semua plugin default nonaktif dan checkout, pencarian manual, serta QRIS manual tetap berjalan tanpa perangkat apa pun — lihat `docs/15-plugins-settings.md`.

Phase 8 menutup dengan audit keamanan yang dapat diulang dan checklist UAT per peran: `npm run audit:bundle` memindai output build untuk service-role/secret key, dan grup I pada `npm run test:db` mengunci grant tabel, RLS 24/24, `SECURITY DEFINER` + `search_path=""`, serta default privilege. Temuan residual EXECUTE bawaan pada fungsi trigger kini dicabut oleh migrasi `20261106110000_private_function_grants.sql`, yang sudah diterapkan ke preview dan diverifikasi dengan 10 probe peran (23/23 migrasi sinkron). UAT hosted sudah dijalankan: NFR-04 terukur **899 ms** untuk dua browser (budget 2.000 ms) lewat `e2e/nfr04-stock-latency.spec.mjs` — lihat `docs/16-security-uat.md`.

Phase 6 menambah halaman laporan owner-only: ringkasan harian dan rincian pendapatan per nota (`/reports`), penjualan per produk dari snapshot baris transaksi (`/reports/products`), serta exception data katalog dan transaksi legacy (`/reports/exceptions`). Tidak ada tabel agregat, RPC, atau migrasi baru — baris dibaca dengan RLS lalu diringkas di klien, dibatasi 5000 baris per periode dan ditandai bila terpotong. CSV dibuat di browser dengan BOM UTF-8. Margin/laba kotor tidak disajikan karena harga beli historis belum lengkap (PRD §5.5). Rincian ada di `docs/14-reports.md`.

Phase 9 menambah dua halaman administrasi owner-only: `/users` untuk mengubah nama, peran, dan status aktif profil staf lewat RPC `admin_upsert_profile` (dengan peringatan owner aktif terakhir), dan `/audit` untuk membaca audit log append-only dengan filter aksi/entitas/tanggal. Email tidak ditampilkan karena `profiles` tidak menyimpannya dan `auth.users` tidak terbaca klien; halaman ini juga tidak membuat akun. Phase 9 sekaligus menutup dua sisa Phase 5C/6: filter “stok rendah” (`stok > 0 && stok ≤ batas`) yang dihitung di klien karena PostgREST tidak bisa membandingkan dua kolom, serta ekspor CSV satu halaman di inventaris, selisih stok, dan audit. Tidak ada migrasi baru — lihat `docs/17-users-audit.md`.

Phase 10 menambahkan Realtime stok (POS-03, NFR-04, DB-16): trigger `after update of stock_on_hand, stock_version` mengirim Broadcast **private** ke topic `store:stock` dengan payload minimal `{product_id, sku, stock_on_hand, stock_version}`, dan policy `realtime.messages` membatasinya ke sesi `authenticated`. Di kasir, `useStockRealtime` memperbarui saldo di keranjang dan hasil pencarian tanpa muat ulang, menolak pesan dengan `stock_version` lama, serta refetch + resubscribe setelah reconnect. Checkout tetap memvalidasi stok di database. Produk berstok `NULL` dan update nama/harga tidak disiarkan. Migrasi `20261105100000_stock_broadcast.sql` sudah diterapkan ke preview dan Broadcast-nya terverifikasi hosted — lihat `docs/18-realtime-stock.md`.

Phase 11 menutup RPC mutasi terakhir: `adjust_stock` (migrasi `20261106100000_stock_adjustment.sql`) memungkinkan owner dan staf gudang mengoreksi saldo dengan satu movement `manual_adjustment` beralasan. Alasan dan catatan wajib, presisi mengikuti satuan, hasil negatif ditolak, setiap koreksi menulis audit `stock.adjust`, dan kunci idempotensi mencegah double submit. Halaman `/inventory` mendapat tombol **Koreksi** dengan dialog pratinjau saldo; produk berstok `NULL` tetap harus lewat opname saldo awal. Migrasi sudah diterapkan ke preview dan diuji hosted (8/8 probe), dengan 88/88 tes DB lokal.

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
| `npm run audit:bundle` | Pindai output build untuk service-role/secret key (jalankan setelah `npm run build`) |
| `npm run test:hosted` | Uji Auth/RLS/RPC ke project preview (butuh akun uji lokal) |
| `npm run test:hosted:transactions` | Uji transaksi Phase 4A di preview (butuh fixture stok dan kasir kedua) |
| `npm run test:hosted:inventory` | Uji opname Phase 5D di preview (fixture `TEST-OPN-*`, konkurensi, Realtime) |
| `npm run test:hosted:opname` | Regresi read-only RPC baca opname di preview (tanpa menulis) |
| `npm run test:e2e:inventory` | E2E browser stok opname (owner, staf, kasir dalam konteks terpisah) |
| `npm run gen:types` | Regenerasi `types/database.generated.ts` dari schema |
| `node scripts/fixture-audit.mjs` | Audit read-only produk uji preview; `--json` untuk laporan |
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
- `docs/10-transaction-release-validation.md` — validasi hosted & E2E Phase 4D
- `docs/11-inventory-engine.md` — mesin opname, saldo awal, log selisih, konflik versi Phase 5A
- `docs/12-stock-opname-ui.md` — UI opname, alur tindakan, validasi klien, batasan Phase 5B
- `docs/13-inventory-ui.md` — UI inventaris baca-saja: saldo, pergerakan, selisih (Phase 5C)
- `docs/14-reports.md` — laporan penjualan, per produk, exception data, ekspor CSV (Phase 6)
- `docs/15-plugins-settings.md` — kontrak adapter, printer/scanner/QRIS, sanitasi konfigurasi publik, halaman pengaturan (Phase 7)
- `docs/16-security-uat.md` — audit keamanan, model ancaman, matriks peran, checklist UAT (Phase 8)
- `docs/17-users-audit.md` — halaman pengguna, audit log, filter stok rendah, ekspor CSV (Phase 9)
- `docs/18-realtime-stock.md` — Broadcast stok private, version guard, reconnect, tes grup H (Phase 10)
- `docs/19-inventory-hosted-validation.md` — validasi hosted & E2E inventaris Phase 5D
- `docs/20-preview-fixture-inventory.md` — inventaris read-only 48 produk uji, klasifikasi A–D, rencana pengarsipan Phase 5E
- `docs/PROGRESS.md` — log pengembangan (termasuk Phase 11 `adjust_stock`)
