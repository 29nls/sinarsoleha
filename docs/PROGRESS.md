# Log Pengembangan

## 2 November 2026 — Phase 2 (sebagian)

### Lingkup

- 11 migrasi PostgreSQL berurutan: helper, referensi, profil/provisioning, katalog, penjualan, inventaris, staging legacy, setting/audit, RLS, RPC katalog, RPC admin.
- RLS pada 22 tabel; 23 policy; `anon` tanpa grant tabel; default privileges dicabut.
- RPC katalog owner-only yang tidak menyentuh stok; provisioning profil dari `auth.users`; bootstrap owner sekali; RPC aktivasi/role dengan last-owner guard; feature flag owner-only.
- Ledger stok dan audit append-only; constraint trigger pembayaran deferred; nomor nota `SS-YYYYMMDD-NNNN`; SKU case-insensitive.
- Tipe database hasil `supabase gen types`; auth store memakai tipe generated dan validasi role.
- Uji database lokal dengan PGlite PostgreSQL 18.6 dan auth shim Supabase.

**Status: COMPLETED (hosted preview tervalidasi 2 November 2026).** Schema 22 tabel/23 policy diverifikasi pada project preview `ptbllrugrjepdhhdkzxn`; Auth, PostgREST, RLS, RPC katalog/admin, dan locking nomor nota diuji. Produksi belum diterapkan. `complete_sale`, `void_sale`, `post_stock_opname`, dan `adjust_stock` tetap kontrak untuk Fase 4/5.

### File dibuat

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261102090000_extensions_and_helpers.sql` s.d. `20261102091000_rpc_admin.sql` (11 file) |
| Uji DB | `supabase/tests/local_bootstrap.sql`, `supabase/tests/README.md`, `scripts/db-test.mjs` |
| Tipe | `types/database.generated.ts` (37.070 byte), `scripts/gen-types.mjs` |
| Dokumentasi | `docs/03-database-implementation.md`, `docs/04-rpc-contracts.md` |
| Konfigurasi | `supabase/config.toml` (dari `supabase init`; sign-up publik dimatikan) |

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `app/types/database.ts` | Re-export tipe generated, union `Role`, `isRole`, alias profil |
| `app/stores/auth.ts` | Tipe generated, validasi role, penanganan sesi kedaluwarsa |
| `app/middleware/auth.global.ts` | Sign-out sesi kedaluwarsa + redirect `?reason=expired` |
| `app/pages/login.vue` | Notice sesi kedaluwarsa |
| `package.json`, `package-lock.json` | Script `test:db`, `gen:types`; PGlite + pglite-socket; hapus `embedded-postgres`/`pg` |
| `.gitignore` | Abaikan `.tmp` |
| `README.md`, `docs/00-phase-0-audit.md`, `docs/PROGRESS.md` | Status dan dokumentasi Fase 2 |

`supabase/supabase_schema_pos_toko_sinar_soleha.sql` tidak diubah dan tidak diterapkan apa adanya.

### Perintah yang dijalankan

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | 11 migrasi apply bersih; **20 passed, 0 failed** |
| `npm run gen:types` | `types/database.generated.ts` 37.070 byte |
| `npm run typecheck` | Exit 0 |
| `npm test` | 2 file, **8/8** test lulus |
| `npm run build` | Exit 0; selesai 23,0 detik |
| `grep -rl "service_role" .output` | Tidak ada hasil (exit 1) — hanya publishable key di bundle |

Cakupan uji DB: anon ditolak; user tanpa profil/nonaktif ditolak; kasir tidak dapat menulis produk/stok; gudang tidak dapat menaikkan role; owner mengelola produk via RPC tanpa mengubah stok; `user_metadata` tidak menaikkan privilege; aritmetika ledger; pembayaran harus balance saat COMMIT; SKU case/space; opname posted immutable; nomor dokumen berurutan; provisioning; bootstrap owner; aktivasi + last-owner; feature flag; biaya owner-only; default privilege; audit append-only.

### Yang belum diverifikasi (jujur)

- **Belum diterapkan ke Supabase hosted/preview**: tidak ada kredensial project. PostgREST, GoTrue, JWT, login end-to-end, dan RLS pada backend nyata belum diuji.
- **Konkurensi nyata belum diuji**: PGlite satu koneksi; row lock `document_counters` baru benar secara logika, bukan uji paralel.
- **Realtime DB-16 ditunda** ke Fase 5 karena belum ada mutasi stok dan butuh project hosted.
- **`complete_sale`/`void_sale`/`post_stock_opname`/`adjust_stock` belum ada**; kontrak ada di `docs/04-rpc-contracts.md`.
- **Sign-up hosted** harus dimatikan manual di Dashboard; `supabase/config.toml` hanya berlaku untuk stack lokal.
- **Riwayat hitung opname per item** belum berupa tabel tersendiri; status dan immutability sudah ada.

### Catatan teknis

- PGlite dipakai karena `postgres.exe` menolak berjalan di akun Windows dengan hak administrator dan Docker/psql/Supabase CLI DB stack tidak tersedia.
- Fungsi `SECURITY DEFINER` memakai `search_path = ''`; peran diperiksa dari `profiles`, bukan `user_metadata`.
- `profiles.role` tergenerate sebagai `string`; store mempersempit dengan `isRole()`.
- File generated dipindah dari `app/types/` ke `types/` untuk menghilangkan peringatan auto-import ganda Nuxt.
- `.env` tidak diubah dan nilainya tidak dibaca; `.env` tetap gitignored.

### Tugas berikutnya

1. Apply migrasi ke project preview/disposable, lalu uji login owner/kasir/gudang, provisioning, RLS allow/deny, dan RPC katalog.
2. Regenerasi tipe dari project hosted dan ulangi typecheck/build.
3. Phase 3 — katalog dan impor; Phase 4 — RPC `complete_sale`; Phase 5 — opname dan Realtime.

## 2 November 2026 — Phase 3A (katalog produk)

### Lingkup selesai

- Halaman `/products` untuk owner, kasir, dan staf gudang. Kasir/gudang hanya membaca; owner mendapat aksi tambah/edit/nonaktifkan, harga beli, masalah data, dan kategori.
- Tabel padat tanpa gambar: SKU, nama, kategori, satuan, harga jual, stok, status, dan aksi. Kolom harga beli serta masalah data hanya untuk owner.
- Pencarian server-side SKU exact/prefix dan nama contains, debounce 150 ms, filter kategori/satuan/status/harga kosong/stok unknown/stok negatif/review, pagination 25/50/100 dengan total count.
- Form create/edit memakai `public.upsert_product(jsonb)`, mempertahankan `NULL` harga dan `import_review_status`, dan tidak pernah mengirim field stok.
- Harga beli owner-only memakai `public.set_product_cost`; nilai kosong tetap `NULL`.
- Migrasi `20261102091100_rpc_category.sql` menambah `public.upsert_category(jsonb)` owner-only, validasi duplikat, audit, dan tanpa hard delete. Migrasi diterapkan ke preview dan dicatat di riwayat.

### File dibuat

- `app/pages/products/index.vue`
- `app/composables/useProductCatalog.ts`
- `app/services/catalog.ts`
- `app/utils/catalog.ts`
- `app/types/catalog.ts`
- `app/components/catalog/ProductTable.vue`, `ProductFilters.vue`, `ProductFormDialog.vue`, `ProductCostDialog.vue`, `CategoryManagerDialog.vue`, `ProductStatus.vue`, `ProductIssueList.vue`
- `supabase/migrations/20261102091100_rpc_category.sql`
- `docs/05-product-catalog.md`, `tests/catalog.test.ts`, `tests/catalog-table.test.ts`, `vitest.config.ts`

### File dimodifikasi

- `app/utils/modules.ts` (Produk aktif, capability `catalog.read`)
- `app/pages/dashboard/index.vue`, `app/assets/css/main.css`
- `types/database.generated.ts` (regenerasi dari schema lokal)
- `package.json`, `package-lock.json` (plugin Vue untuk tes SFC)
- `scripts/db-test.mjs`, `scripts/hosted-smoke.mjs`
- `README.md`, `docs/00-phase-0-audit.md`, `docs/02-database-review.md`, `docs/03-database-implementation.md`, `docs/04-rpc-contracts.md`, `supabase/tests/README.md`

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm test` | 4 file, **28/28** lulus |
| `npm run test:db` | 12 migrasi apply bersih; **22/22** lulus |
| `npm run test:hosted` | **22 passed, 0 failed, 1 skipped** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `grep -rl "service_role" .output` | tidak ada hasil |

Browser owner pada preview juga diuji: `/products` memuat produk nyata, pencarian SKU exact menyaring hasil, validasi form kosong tampil, dialog kategori/biaya/edit terbuka, dan logout kembali ke login tanpa error console.

Tes katalog mencakup render tabel loading/empty, `NULL` harga/stok, stok negatif, kolom owner vs non-owner, validasi form, payload tanpa stok, debounce, pagination, duplikat SKU/kategori, RPC kategori, audit, dan RLS kasir/gudang.

### Batasan

- Impor 1.361 produk (Phase 3B) dijalankan ke preview pada 3 November 2026; tidak ada seed data palsu.
- P95 pencarian belum diukur pada dataset penuh.
- Alur browser owner sudah diuji; tampilan baca-saja kasir/gudang belum diuji browser, tetapi RLS dan API-nya diuji hosted.
- Expired token tetap 1 tes yang di-skip.
- Migrasi kategori diterapkan ke preview lewat SQL terkontrol; `db push` produksi belum dijalankan.

## 2 November 2026 — Phase 2B (hosted validation)

### Hasil

- Project preview `ptbllrugrjepdhhdkzxn` (PostgreSQL 17.11) dikonfirmasi sebagai target disposable sebelum operasi tulis.
- Schema hosted sudah berisi 22 tabel/223 kolom, 23 policy, 17 trigger, dan 23 signature fungsi; hash tabel/kolom, policy, trigger, dan fungsi identik dengan 11 migrasi lokal.
- `supabase_migrations.schema_migrations` belum ada karena schema diterapkan lewat SQL Editor. Riwayat dibuat dengan format CLI dan diisi 11 versi; `list_migrations` kini konsisten.
- Empat akun uji preview (owner, kasir, gudang, nonaktif) dibuat secara administratif lewat `auth.users`/`auth.identities` karena signup publik kena validasi domain dan rate limit email. Trigger provisioning tetap berjalan dan menghasilkan kasir nonaktif.
- `private.bootstrap_owner` mengaktifkan owner pertama; metadata `role: owner` pada kasir tidak menaikkan privilege.
- `scripts/hosted-smoke.mjs` dijalankan: **20 passed, 0 failed, 1 skipped** (expired token belum diuji).
- Concurrency: 4 request PostgREST paralel memakai wrapper sementara memperoleh nomor unik `SS-20991231-0017`–`0020` dengan waktu 1,3 / 2,3 / 3,3 / 4,3 detik; wrapper dan counter uji dihapus.
- `generate_typescript_types` hosted berhasil; schema identik dengan tipe yang ada.
- `npm run test:db` 20/20, `npm test` 8/8, `npm run typecheck` exit 0, `npm run build` exit 0, tidak ada `service_role` di `.output`.

### File dibuat/dimodifikasi

- Dibuat: `scripts/hosted-smoke.mjs`.
- Dimodifikasi: `package.json` (`test:hosted`), `README.md`, `docs/03-database-implementation.md`, `docs/00-phase-0-audit.md`, `docs/02-database-review.md`, `supabase/tests/README.md`, `docs/PROGRESS.md`.

### Batasan dan prasyarat produksi

- Sign-up hosted masih aktif (`disable_signup: false`); wajib dimatikan di Dashboard sebelum produksi.
- Akun dan data uji masih berada di preview; hapus/reset sebelum produksi. Password hanya di `.tmp/phase2b-accounts.json` (gitignored) dan tidak pernah dicetak.
- Expired access token dan login UI browser belum diuji; Auth/PostgREST diuji lewat SDK/HTTP nyata.
- `public.rls_auto_enable()` adalah fungsi event trigger platform, bukan bagian migrasi; tinjau advisor sebelum produksi.
- `db push` ke produksi belum dijalankan dan memerlukan persetujuan owner, backup, serta CLI yang terautentikasi.

### Tugas berikutnya

1. Matikan sign-up hosted, hapus akun/data uji, dan review advisor keamanan.
2. Siapkan alur `db push` produksi dengan backup dan persetujuan owner.
3. Phase 3 — katalog dan impor; Phase 4 — RPC `complete_sale`; Phase 5 — opname dan Realtime.

## 3 November 2026 — Phase 3B (impor preview)

### Lingkup

- Audit awal: tidak ada implementasi 3B sebelumnya (tidak ada tabel `product_import_*`, script, RPC, tes, atau laporan). Staging transaksi legacy tidak dipakai ulang. Working tree bersih di `main` sebelum perubahan.
- Workbook `PART MASTER` diprofilkan ulang: 1.361 baris, SHA-256 `48f8b5938ccc0fbe9b10ce78b2e09978791dbfecffe02c3b6d585a46f0643396`, 204 label kategori, 10 ejaan satuan, formula stok merujuk `STOCK MASTER` yang hilang.
- Pipeline dry-run menghasilkan lima laporan gitignored di `.tmp/`: 1.360 baris siap, 1 review (`WAL-W1303` baris 1305, harga jual 9.500 < biaya 20.000), 0 rejected.
- Migrasi staging owner-only dan empat RPC impor ditambahkan; tidak ada RPC yang menyentuh stok.
- Owner menerapkan migrasi ke preview dan menjalankan `--apply` pada 3 November 2026 07:46–07:48 UTC; run `530bafe6…` selesai: 1.360 produk, 1 review, 0 ditolak, stok tidak tersentuh.

### File dibuat

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261103090000_product_import.sql` |
| Script | `scripts/product-import.mjs`, `scripts/product-import-rules.mjs` |
| Tes | `tests/product-import.test.mjs` |
| Dokumentasi | `docs/06-product-master-import.md` |
| Laporan (gitignored) | `.tmp/product-import-preview.json`, `product-import-summary.md`, `product-import-errors.csv`, `product-category-map.csv`, `product-unit-map.csv` |

### File dimodifikasi

- `scripts/db-test.mjs` — 9 tes impor: otorisasi owner-only, satu run per checksum, staging idempoten, resolusi satuan, produk stok `NULL`, biaya, isu, impor ulang, baris review/rejected, SKU lama, rollback + retry, run parsial, resume, dan verifikasi stok.
- `types/database.generated.ts` — regenerasi dari schema lokal (43.143 byte).
- `package.json` — script `import:products`.
- `README.md`, `docs/05-product-catalog.md`, `docs/PROGRESS.md` — status 3B.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `node scripts/product-import.mjs --dry-run` | 1.361 baris; 1.360 ready, 1 review, 0 rejected; 5 laporan dibuat |
| `npm run test:db` | 12 migrasi apply bersih; **32/32 lulus** |
| `npx vitest run tests/product-import.test.mjs` | **15/15 lulus** |
| `npm test` | 5 file, **43/43 lulus** |
| `npm run gen:types` | 43.143 byte |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| Verifikasi hosted read-only | 1 run `completed`; 1.365 produk (1.360 impor + 5 uji `HOST-*`), semua stok `NULL`; 0 movement/opname; 1.360 audit `product.import` |

### Batasan

- Baris 1305 (`WAL-W1303`) masih review tanpa produk; perlu keputusan harga owner.
- 5 produk uji `HOST-*` dan 5 kategori `Phase 2B …` masih ada di preview; bukan bagian impor dan harus dibersihkan sebelum produksi.
- Semua stok masih `NULL`; saldo awal menunggu opname fisik Phase 5.
- Verifikasi hosted hanya read-only (select + probe RPC), bukan suite penuh; `npm run test:hosted` tidak dijalankan ulang karena menulis data uji.

### Tugas berikutnya

1. Putuskan harga baris 1305, lalu impor baris itu bila sudah benar.
2. Bersihkan 5 produk `HOST-*` dan 5 kategori uji Phase 2B, lalu tinjau 1.507 isu harga/stok.
3. Phase 5 — opname dan Realtime.

## 3 November 2026 — Phase 4A (mesin transaksi)

### Lingkup

- `private.complete_sale` dan `private.void_sale` diimplementasikan, dengan wrapper `public` hanya untuk `authenticated`.
- Harga, diskon, total, nomor nota, stok, dan kasir ditentukan database; payload browser hanya item, quantity, pembayaran, tanggal, dan idempotency key.
- Semua produk dikunci `FOR UPDATE` urut `product_id` sebelum tulisan pertama; stok tidak pernah negatif.
- Idempotensi memakai `transactions.idempotency_key` + fingerprint `request_fingerprint`; kunci sama dengan keranjang berbeda ditolak.
- Diskon > 0 ditolak sampai owner menetapkan kebijakan; pembayaran cash/QRIS manual/split divalidasi terhadap total.
- Void owner-only memulihkan stok satu kali lewat `void_reversal`, tanpa menghapus header, item, pembayaran, atau audit.

### File dibuat/dimodifikasi

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261103110000_transaction_engine.sql` |
| Tes | `scripts/db-test.mjs` — 10 tes transaksi baru |
| Tipe | `types/database.generated.ts` — 43.464 byte |
| Dokumentasi | `docs/07-transaction-engine.md`, `docs/04-rpc-contracts.md`, `docs/03-database-implementation.md`, `README.md` |

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | 14 migrasi apply bersih; **42/42 lulus** (32 lama + 10 transaksi) |
| `npm test` | 5 file, **43/43 lulus** |
| `npm run gen:types` | 43.464 byte |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (14,9 dtk) |

### Batasan

- Migrasi 4A sudah aktif di preview; riwayat migrasi CLI belum terverifikasi karena tidak ada access token.
- Uji konkurensi dua sesi belum dijalankan: PGlite memakai satu koneksi, jadi hanya oversell sekuensial yang teruji. Jaminan paralel baru berasal dari desain `FOR UPDATE`.
- Tes hosted belum dijalankan; produk berstok harus di-seed lewat SQL karena belum ada RPC opname/adjustment.
- Diskon, refund, jendela void, jam tutup toko, dan bukti QRIS masih keputusan bisnis terbuka.

### Tugas berikutnya

1. Jalankan fixture SQL preview dan aktifkan kasir kedua.
2. Jalankan uji konkurensi dua sesi dan tes hosted transaksi, lalu perbarui hasilnya.
3. Phase 4B — UI kasir; Phase 5 — opname dan Realtime.

## 3 November 2026 — Phase 4A.1 (validasi hosted, tertunda)

### Hasil audit hosted

- Target `ptbllrugrjepdhhdkzxn` (preview). Migrasi 4A ternyata sudah aktif: `transactions.request_fingerprint` ada dan `complete_sale`/`void_sale` merespons validasi, bukan `PGRST202`.
- Riwayat migrasi remote tidak dapat dibaca: CLI tidak punya access token dan project belum di-link. Status disimpulkan dari objek schema, bukan dari `schema_migrations`.
- Matriks otorisasi hosted: anon `42501`, gudang `42501`, akun nonaktif `42501`, kasir mencapai fungsi (`P0002` untuk produk acak), kasir void `42501`, owner void mencapai fungsi (`P0002`). Tidak ada tulisan yang dibuat oleh probe.
- Preview belum punya produk berstok: 0 produk dengan `stock_on_hand` tidak `NULL`, 0 transaksi. Lima produk `HOST-*` dan produk impor tetap `NULL`.
- Hanya ada satu akun kasir, sehingga syarat dua sesi kasir independen belum terpenuhi.

### Artefak dibuat

| File | Isi |
| --- | --- |
| `supabase/tests/phase4a_preview_fixtures.sql` | Tiga produk `TEST-TXN-*`, opname opening balance, movement dengan aritmetika benar |
| `scripts/transaction-hosted-smoke.mjs` | Suite hosted: dua sesi kasir, race stok 1, idempotensi, void, pembayaran, otorisasi, rekonsiliasi |
| `package.json` | Script `test:hosted:transactions` |

### Verifikasi yang dijalankan

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **42/42 lulus** (tidak berubah) |
| `npm test` | **43/43 lulus** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |
| `node --check scripts/transaction-hosted-smoke.mjs` | exit 0 |
| `npm run test:hosted:transactions` | **BLOCKED** — akun kasir kedua belum ada |

### Batasan

- Uji konkurensi, idempotensi hosted, void hosted, dan pembayaran hosted belum dijalankan; Phase 4A tetap parsial.
- Fixture SQL memerlukan SQL Editor owner karena tidak ada RPC yang boleh menulis stok.
- Riwayat migrasi hosted belum terverifikasi lewat CLI.

### Tugas berikutnya

1. Owner menjalankan `supabase/tests/phase4a_preview_fixtures.sql` di preview dan membuat kasir kedua.
2. Jalankan `npm run test:hosted:transactions`, lalu catat hasil race dan rekonsiliasi.
3. Phase 4B — UI kasir; Phase 5 — opname dan Realtime.
