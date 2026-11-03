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

## 3 November 2026 — Phase 4B (UI kasir)

### Lingkup

- Audit Phase 4A.1 diulang: migrasi 4A aktif di preview, matriks otorisasi hosted terverifikasi, tetapi 0 produk berstok, 0 transaksi, dan hanya satu akun kasir. Uji konkurensi/idempotensi/void/pembayaran hosted tetap tertunda; tidak ada hasil yang difabrikasi.
- Halaman `/cashier` untuk owner dan kasir aktif dengan `capability: 'sale.create'`; gudang dan akun nonaktif ditolak middleware yang sudah ada.
- Pencarian server-side (exact SKU, prefix SKU, nama contains), debounce 150 ms, maksimal 12 hasil, tanpa fetch seluruh katalog dan tanpa harga beli.
- Tabel padat tanpa foto: SKU, nama, kategori, satuan, harga jual, stok, status, aksi. Stok `NULL` berstatus "Stok belum diopname", harga `NULL` "Harga belum tersedia", produk nonaktif dan stok habis tetap terlihat tetapi tidak bisa dimasukkan.
- Keranjang Pinia menggabungkan produk duplikat, mendukung tambah/kurang/edit/hapus/kosongkan, menghormati `decimal_scale`, dan menghitung uang dalam integer sen di UI.
- Pembayaran tunai (diterima/kembalian), QRIS manual dengan centang konfirmasi wajib, dan split dengan total tepat. Diskon selalu 0.
- Satu idempotency key per niat checkout; timeout/network error mengunci keranjang sambil mempertahankan key, payload, dan isi keranjang. Retry mengirim payload yang sama; keranjang hanya dikosongkan setelah sukses, termasuk `already_processed`.
- Nota menampilkan data RPC + snapshot database, dengan CSS ramah cetak. Tidak ada printer termal, gateway QRIS, opname, atau realtime.

### File dibuat

| Kelompok | File |
| --- | --- |
| Halaman/komponen | `app/pages/cashier/index.vue`, `app/components/cashier/CashierHeader.vue`, `ProductSearch.vue`, `ProductResultsTable.vue`, `CartTable.vue`, `PaymentPanel.vue`, `ReceiptView.vue` |
| State/layanan | `app/stores/cashier.ts`, `app/services/cashier.ts`, `app/composables/useCashierSearch.ts` |
| Tipe/util | `app/types/cashier.ts`, `app/utils/cashier.ts`, `app/utils/receipt.ts` |
| Tes/dokumentasi | `tests/cashier.test.mjs`, `docs/08-cashier-interface.md` |

### File dimodifikasi

- `app/utils/modules.ts` — modul kasir aktif.
- `app/pages/dashboard/index.vue` — status kasir lokal dan batas hosted yang jujur.
- `README.md`, `docs/PROGRESS.md`, `docs/07-transaction-engine.md` — status Phase 4B.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm test` | **66/66 lulus** (6 file; 23 tes kasir) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (26,0 dtk; run final setelah seluruh edit) |
| `npm run test:hosted:transactions` | tidak dijalankan ulang; blocker sebelumnya tetap (kasir kedua/fixture stok belum ada) |
| Browser E2E kasir | belum dijalankan |

### Batasan

- Phase 4B **belum selesai** menurut acceptance criteria: checkout hosted, pencarian/otorisasi hosted, dan browser E2E belum diverifikasi. Yang lulus adalah unit test, typecheck, dan build lokal.
- Semua 1.360 produk impor tetap `stock_on_hand NULL`; tidak ada seed atau perubahan stok yang dilakukan. Fixture stok hanya untuk produk `TEST-` di preview.
- Tidak ada gateway QRIS, printer termal, opname, adjustment, realtime, atau laporan penjualan.
- Harga di keranjang dipertahankan saat refresh stok setelah penolakan backend; database tetap menentukan total final dan dapat menolak jika harga berubah.

### Tugas berikutnya

1. Owner menjalankan fixture preview dan membuat kasir kedua.
2. Jalankan `npm run test:hosted:transactions`; catat race stok, idempotensi, void, pembayaran, dan rekonsiliasi.
3. Uji browser dua sesi kasir (login, cari, keranjang, tunai/QRIS/split, retry timeout, nota, logout, gudang ditolak).
4. Putuskan kebijakan diskon/refund/QRIS sebelum produksi; Phase 5 tetap belum dimulai.

## 3 November 2026 — Phase 4C (manajemen transaksi)

### Lingkup

- Riwayat transaksi `/cashier/transactions` dengan pagination server-side, filter tanggal/nota/status/pembayaran, sorting stabil `business_date desc, created_at desc, id desc`, state loading/kosong/error.
- Detail transaksi `/cashier/transactions/[id]` dari snapshot tersimpan (`transactions`, `transaction_items`, `payments`); tidak fetch produk terkini.
- Cetak ulang struk via `ReceiptView.vue` yang sudah ada; tidak membuat transaksi baru.
- Pembatalan transaksi owner-only melalui `public.void_sale(p_transaction_id, p_reason)`; kasir tidak bisa void; alasan 1-500 karakter; pesan sukses "Transaksi berhasil dibatalkan."
- Navigasi "Riwayat Transaksi" dengan capability `sale.read.own`.
- Tidak join `profiles` pada list/detail karena RLS membatasi akses profil.

### File dibuat

| Kelompok | File |
| --- | --- |
| Tipe | `app/types/transactions.ts` |
| Layanan | `app/services/transactions.ts` |
| Composables | `app/composables/useTransactionHistory.ts`, `useTransactionDetail.ts`, `useTransactionVoid.ts` |
| Komponen | `app/components/transactions/TransactionFilters.vue`, `TransactionTable.vue`, `VoidTransactionDialog.vue` |
| Halaman | `app/pages/cashier/transactions/index.vue`, `app/pages/cashier/transactions/[id].vue` |
| Tes | `tests/transactions.test.ts` |
| Dokumentasi | `docs/09-transaction-management.md` |

### File dimodifikasi

- `app/utils/modules.ts` — modul riwayat transaksi aktif.
- `README.md` — status Phase 4C.
- `docs/PROGRESS.md` — entri Phase 4C.
- `docs/07-transaction-engine.md` — referensi Phase 4C.
- `docs/08-cashier-interface.md` — section Phase 4C ditambahkan.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm test` | **83/83 lulus** (7 file; 17 tes transaksi baru) |
| `npm run test:db` | **42/42 lulus** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (19,3 dtk) |

### Batasan

- Acceptance hosted Phase 4A/4B masih tertunda; checkout tetap nonaktif (`hostedCheckoutEnabled = false`).
- Tidak ada migration baru; schema/RLS/RPC sudah cukup.
- Tidak ada dashboard widget, printer termal, gateway QRIS, refund, opname, atau laporan.
- Filter kasir untuk owner tidak ditampilkan di UI karena tidak ada daftar kasir yang aman dibaca.

## 3 November 2026 — Phase 4D (validasi transaksi hosted & acceptance release)

### Lingkup

- Suite transaksi hosted dijalankan ke Supabase preview (`ptbllrugrjepdhhdkzxn`) dengan fixture `TEST-TXN-RACE-001`, `TEST-TXN-IDEMPOTENCY-001`, `TEST-TXN-PAY-001` dan dua sesi kasir independen (owner, cashier_a, cashier_b dari `.tmp/phase2b-accounts.json`). Race oversell, idempotensi same-key retry, void owner/kasir, QRIS manual, split, dan `already_processed` — lulus 10/10.
- Browser E2E kasir baru (`e2e/cashier.spec.mjs`, Playwright, workers=1, `npm run test:e2e`): 10 senario end-to-end terhadap dev server lokal — redirect sesi, login invalid, pencarian + stok NULL + guard oversell, checkout tunai + nota, QRIS tanpa konfirmasi lalu sukses, retry idempotensi via UI, riwayat/detail/cetak ulang + kasir tidak bisa void, void owner (alasan wajib, stok kembali), gudang 403, logout — lulus 10/10.
- Checkout hosted diaktifkan di UI (`hostedCheckoutEnabled = true`).
- Rekonsiliasi preview: stok akhir fixture identik dengan Σ delta `stock_movements` (RACE 0, IDEMPOTENCY 1, PAY 2); void mengembalikan stok tepat satu kali; nota `SS-20261103-0001–0033` unik berurutan; tidak ada drift ledger.
- Detail lengkap: `docs/10-transaction-release-validation.md`.

### File dibuat / dimodifikasi

| Kelompok | File |
| --- | --- |
| E2E baru | `e2e/cashier.spec.mjs`, `playwright.config.mjs`, script `test:e2e` di `package.json` (`.tmp/e2e-state.json` dibuat saat run) |
| Perbaikan bug | `app/components/cashier/CartTable.vue` (reset input saat quantity ditolak — nilai tercetak kembali ke qty keranjang), `app/pages/cashier/index.vue` (aktifkan checkout, handler set-quantity + notice kode error), migrasi `20261103110000_transaction_engine.sql` (wrapper cast numeric) |
| Konfigurasi tes | `vitest.config.ts` (hexclude `e2e/**` dari vitest) |
| Dokumentasi | `docs/10-transaction-release-validation.md` baru; `README.md`, `docs/PROGRESS.md`, `docs/07-transaction-engine.md`, `docs/08-cashier-interface.md` diperbarui |

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm test` | **83/83 lulus** (vitest, e2e dikecualikan) |
| `npm run test:db` | **42/42 lulus** |
| Suite hosted `可想test:hosted:transactions` | **10/10 lulus** |
| Browser E2E `npx playwright test` | **10/10 lulus** (29,2 dtk) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |

### Batasan

- Produksi belum diterapkan; seluruh migrasi hanya di preview. Race browser E2E berjalan serial (workers=1) — jaminan konkurensi tetap dari suite hosted dan `FOR UPDATE`.
- Tidak ada perubahan stok ke 1.360 produk impor (tetap `stock_on_hand NULL`); fixture hanya produk `TEST-TXN-*`.
- Keputusan bisnis terbuka (diskon, refund, jendela void, bukti QRIS) tetap di `docs/07-transaction-engine.md` bagian 16; Phase 5 belum dimulai.

## 4 November 2026 — Phase 5A (mesin inventaris: stock opname & saldo awal)

### Lingkup

- Migrasi additive `supabase/migrations/20261104100000_stock_opname_engine.sql`:
  enam RPC opname (`create_stock_opname`, `record_stock_opname_count`,
  `submit_stock_opname`, `approve_stock_opname`, `post_stock_opname`,
  `cancel_stock_opname`) dengan pola wrapper `public` tipis + implementasi
  `private` `SECURITY DEFINER`, `SET search_path = ''`.
- `stock_opnames.creation_key` unik untuk create yang retry-safe; snapshot
  server-side (`INSERT ... SELECT`) seluruh katalog termasuk produk nonaktif,
  dengan opsi `product_ids`, `category_id`, dan `exclude_product_ids`.
- Saldo awal: `system_qty_snapshot IS NULL` → movement `opening_balance`
  (`quantity_before NULL`), tanpa log selisih. Constraint
  `stock_movements_delta_nonzero` diganti agar delta 0 sah **hanya** untuk
  opening balance nol; tipe movement lain tetap ditolak.
- Konflik versi mengembalikan JSON `version_conflict` (bukan exception) sehingga
  item `needs_recount`, sesi kembali `counting`, dan approval yang dibersihkan
  ikut ter-commit; tidak ada posting sebagian.
- Constraint `stock_opnames_submitted_consistency` dilonggarkan untuk status
  `cancelled` — sebelumnya sesi `counting` tidak bisa dibatalkan.
- Dua indeks parsial untuk layar penghitungan dan pencarian item belum dihitung.

### File dibuat / dimodifikasi

| Kelompok | File |
| --- | --- |
| Migrasi baru | `supabase/migrations/20261104100000_stock_opname_engine.sql` |
| Tes | `scripts/db-test.mjs` (helper opname + 30 tes grup A–H) |
| Dokumentasi | `docs/11-inventory-engine.md` baru; `docs/04-rpc-contracts.md`, `docs/03-database-implementation.md`, `README.md`, `docs/PROGRESS.md` diperbarui |

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **72/72 lulus** (42 lama + 30 baru) |
| `npm test` | **83/83 lulus** |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |

### Batasan

- Migrasi **belum** diterapkan ke preview (`ptbllrugrjepdhhdkzxn`); menunggu
  approval eksplisit. Produksi tidak disentuh.
- UI opname (Phase 5B) belum dibuat saat Phase 5A selesai; `adjust_stock` masih kontrak.
- Tidak ada stok 1.360 produk impor yang diubah dan tidak ada saldo awal nyata
  yang diposting; seluruh tes memakai produk sintetis `OPN-*`/`TEST-TXN-*`.
- Konkurensi multi-sesi nyata (PostgREST) belum diuji; jaminan berasal dari
  `FOR UPDATE` + perbandingan `stock_version` yang diuji secara logis di PGlite.

## 4 November 2026 — Phase 5B (UI stok opname)

### Lingkup

- Halaman `/stock-opname` (daftar + pembuatan sesi) dan `/stock-opname/:id`
  (detail, hitung, submit, setujui, posting, batal). Navigasi muncul untuk owner
  dan inventory_staff lewat `availableModules`; kasir ditolak middleware.
- Tipe domain `app/types/opname.ts`: label status/alasan, `validateCount` yang
  mencerminkan guard RPC (presisi `decimal_scale`, alasan wajib saat selisih,
  `opening_balance` + catatan untuk stok `NULL`), `describeOpnameError`.
- Layanan `app/services/opname.ts`: enam wrapper RPC dengan mapping
  snake_case → camelCase, plus `listOpnames`/`getOpnameDetail` yang membaca
  langsung dari tabel (RLS staff) tanpa RPC baca baru.
- Composable `useOpnameList` (debounce 200 ms, pagination, request-id guard) dan
  `useOpnameDetail` (`opnameId` reaktif, ringkasan item, `conflicts`,
  `postResult`).
- Enam komponen `app/components/opname/*`: tabel daftar, dialog buat, tabel
  item, dialog hitung, panel tindakan, panel konflik.
- Konflik versi ditampilkan sebagai panel recount + highlight baris, bukan toast
  error, karena RPC sengaja mengembalikan JSON agar penandaan `needs_recount`
  ter-commit.
- `app/utils/modules.ts`: entri `stock-opname` menjadi `available: true`.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **136/136 lulus** (10 file; 49 tes opname baru) |
| `npm run build` | exit 0 |
| `npm run test:db` | 72/72 (tidak berubah; tidak ada migrasi baru di 5B) |

### Batasan

- Migrasi Phase 5A **masih menunggu approval** untuk diterapkan ke preview
  `ptbllrugrjepdhhdkzxn`; halaman belum dapat dipakai di hosted. Produksi tidak
  disentuh.
- E2E hosted opname belum ada; butuh migrasi di preview dan Supabase CLI
  terautentikasi.
- Tanpa Realtime: operator lain tidak melihat hitungan sampai muat ulang.
- Posting final, belum ada reversal; belum ada ekspor hasil opname.

## 4 November 2026 — Phase 5C (UI inventaris)

Halaman baca-saja untuk INV-01 dan INV-09. Tidak ada RPC atau migrasi baru;
hanya membaca tabel yang sudah ada dengan policy staff.

### Yang dibuat

- `app/types/inventory.ts` — tipe baris saldo/movement/discrepancy, label jenis
  movement, filter kosong, `describeInventoryError`, batas hari Jakarta.
- `app/services/inventory.ts` — `listStockBalances` (filter unknown/negatif/
  kosong + pencarian SKU/nama), `listStockMovements` dan
  `listStockDiscrepancies` (filter produk via relasi, jenis/alasan, tanggal,
  pagination). Nama aktor memakai embed `profiles`; bila RLS menolak (staf),
  UI memakai `Anda` atau `Staf <8 id>`.
- `app/composables/useInventory.ts` — `usePagedList` internal (debounce 200 ms,
  request-id guard, `clampPage`, `pageCount`, `onScopeDispose`) lalu
  `useStockBalances`, `useStockMovements`, `useStockDiscrepancies`.
- Komponen `app/components/inventory/`: `InventoryTabs`, `StockBalanceFilters`,
  `StockBalanceTable`, `MovementTable`, `DiscrepancyTable`.
- Halaman `app/pages/inventory/index.vue`, `movements.vue`,
  `discrepancies.vue`; semuanya `capability: inventory.read`.
- `app/utils/modules.ts`: entri `inventory` menjadi `available: true`.

### Keputusan

- Tiga rute terpisah dengan tab bar, bukan satu halaman bertiga query.
- Saldo `NULL` tetap `—` dan diberi tag "Belum diketahui"; tidak pernah `0`.
- Filter "stok rendah" tidak bisa dilakukan PostgREST (perbandingan dua
  kolom); baris rendah tetap di-highlight, filter server terbatas pada
  unknown/negatif/kosong.
- Rentang tanggal diperluas ke `+07:00` agar inklusif satu hari.
- Pencarian produk memakai `or(..., { referencedTable: 'products' })` dengan
  nilai di-escape dan di-quote.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **161/161 lulus** (12 file; 22 tes inventaris baru) |
| `npm run build` | exit 0 (14,6 dtk; 1,91 MB / 473 kB gzip) |

### Batasan

- Migrasi Phase 5A **masih menunggu approval** untuk diterapkan ke preview
  `ptbllrugrjepdhhdkzxn`; ketiga halaman belum bisa dipakai di hosted.
  Produksi tidak disentuh.
- Belum ada ekspor, grafik tren, atau Realtime di halaman inventaris.
- Nama staf selain diri sendiri tampil sebagai id pendek sampai ada RPC
  daftar staf khusus owner.

## 4 November 2026 — Phase 6 (laporan penjualan, per produk, exception data)

Laporan baca-saja untuk RPT-01, RPT-02, RPT-03, dan RPT-06. Tidak ada RPC,
view, atau migrasi baru: baris dibaca dengan RLS yang sudah ada lalu diringkas
di klien. RPT-04/RPT-05 tetap di halaman inventaris Phase 5C.

### Yang dibuat

- `app/types/reports.ts` — tipe baris/result, label kategori exception, preset
  dan normalisasi rentang Jakarta, `summarizeSales`, `salesTotals`,
  `roundMoney`, `roundQuantity`, `describeReportError`, `toCsv`,
  `csvFileName`.
- `app/services/reports.ts` — `reportPaymentMethod` (menandai pembayaran
  campuran sebagai `split`), `loadSalesReport` (RPT-01/02),
  `loadProductSalesReport` (RPT-03, pengelompokan `product_id` dengan fallback
  `sku:<snapshot>`), `loadExceptionReport` (RPT-06: katalog + transaksi
  `reconciliation_status != 'matched'`).
- `app/composables/useReports.ts` — rentang bersama lewat `useState`,
  preset/custom, request-id guard per loader, `refresh` sesuai `autoLoad`
  halaman sehingga tab exception tidak menarik transaksi.
- `app/utils/download.ts` — `downloadCsv` via Blob + BOM UTF-8.
- Komponen `app/components/reports/`: `ReportsTabs`, `ReportRangePicker`,
  `SalesSummaryTable`, `SalesDetailTable`, `ProductSalesTable`,
  `ExceptionTable`.
- Halaman `app/pages/reports/index.vue`, `products.vue`, `exceptions.vue`;
  semuanya `capability: report.sales`.
- `app/utils/modules.ts`: entri `reports` menjadi `available: true`.
- `tests/reports.test.ts` (13) dan `tests/reports-queries.test.ts` (13).

### Keputusan

- Agregasi di klien karena PostgREST tidak mendukung `GROUP BY`; tidak membuat
  view agar definisi penjualan bersih tetap satu, yaitu `transactions`.
- Batas `REPORT_ROW_LIMIT = 5000` per periode, dengan `count: 'exact'` dan
  penanda `truncated`; UI meminta periode dipersempit, bukan menyajikan total
  parsial sebagai lengkap.
- Laporan penjualan default `status = completed`; opsi `all`/`voided` hanya di
  service untuk audit.
- Komposisi tunai/QRIS/lainnya memakai `grand_total` per nota sehingga
  jumlahnya sama dengan penjualan bersih; pembayaran campuran menjadi `split`.
- Per produk memakai snapshot baris transaksi, bukan katalog saat ini; baris
  legacy tanpa mapping tetap dihitung lewat SKU snapshot.
- Margin/laba kotor tidak dihitung atau ditampilkan (PRD §5.5: 119 harga beli
  kosong, tidak ada histori biaya per tanggal).
- CSV dibuat di browser; nilai `null` menjadi sel kosong, bukan nol.
- Rentang tanggal memakai zona Asia/Jakarta; state rentang dibagi antar-tab.
- `startOfJakartaDay`/`endOfJakartaDay` tidak diduplikasi di modul laporan;
  sumber tunggalnya tetap `app/types/inventory.ts`, sehingga peringatan
  duplikasi auto-import Nuxt hilang.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0, tanpa peringatan duplikasi |
| `npm test` | **187/187 lulus** (14 file; 26 tes laporan baru) |
| `npm run build` | exit 0 (15,5 dtk; 1,92 MB / 474 kB gzip) |

### Batasan

- Belum diuji terhadap data hosted; angka baru diverifikasi lewat unit test
  bentuk query dan agregasi.
- Tanpa pagination lanjutan, filter kasir, atau grafik tren.
- Exception katalog dibaca maksimal 5000 produk; katalog saat ini 1.360.
- Migrasi Phase 5A **masih menunggu approval** untuk diterapkan ke preview
  `ptbllrugrjepdhhdkzxn`; produksi tidak disentuh.

## 4 November 2026 — Phase 7 (plugin opsional & halaman pengaturan)

Tiga integrasi opsional dari PRD §10 di balik satu kontrak adapter. Tidak ada
migrasi baru: `feature_flags` dan RPC owner-only `set_feature_flag` sudah ada
sejak Phase 2. Semua plugin default nonaktif; POS inti tetap bekerja saat
adapter mati, tidak tersedia, atau gagal.

### Yang dibuat

- `app/adapters/contracts.ts` — `PluginAdapter`, `AdapterStatus`,
  `statusFor`, `statusLabel`. `statusFor` memaksa `off` saat flag mati.
- `app/adapters/printer.ts` — `PrinterAdapter.print()` dengan transport dialog
  browser; opsi bridge dilaporkan `unavailable` (belum terpasang), kegagalan
  cetak tidak pernah membatalkan checkout.
- `app/adapters/scanner.ts` — `createScanBuffer()` keyboard-wedge (jeda
  maksimum 60 ms, panjang minimum, suffix Enter/Tab, abaikan modifier) dan
  `createScannerAdapter()`.
- `app/adapters/qris.ts` — adapter gateway yang selalu `unavailable` di build
  SPA; `charge()` tidak pernah memanggil jaringan dan tidak menyimpan secret.
- `app/adapters/registry.ts` — `createPluginRegistry(flags)`, `flagConfig`,
  `flagEnabled`, `defaultFlags`.
- `app/types/plugins.ts` — definisi tiga plugin, `sanitizePublicConfig`
  (buang key rahasia/asing, validasi select/angka/panjang), `parseFeatureFlag`.
- `app/services/settings.ts` — `loadFeatureFlags` (key tak dikenal diabaikan,
  baris hilang = OFF), `saveFeatureFlag` lewat RPC, `describeSettingsError`.
- `app/composables/usePlugins.ts` — state flag via `useState`, `load`/`save`,
  registry reaktif, error tidak fatal.
- `app/pages/settings/index.vue` + `app/components/settings/PluginCard.vue` —
  halaman owner-only dengan toggle dan editor `public_config`.
- `tests/plugins.test.ts` (24) dan `tests/settings-service.test.ts` (10).
- `docs/15-plugins-settings.md`.

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `app/pages/cashier/index.vue` | Muat flag saat mount, catatan gateway QRIS, `scanBuffer`/`scannerEnabled` ke `ProductSearch`, `handleScan`, adapter printer ke `ReceiptView`. |
| `app/components/cashier/ProductSearch.vue` | Listener scan di window hanya saat adapter `ready`; abaikan input/tombol/interaktif; label `Scanner`. |
| `app/components/cashier/ReceiptView.vue` | `printReceipt()` memakai adapter bila `ready`, fallback `window.print()`; pesan hasil cetak. |
| `app/pages/cashier/transactions/[id].vue` | Cetak ulang memakai adapter printer yang sama. |
| `app/utils/modules.ts` | Entri `settings` menjadi `available: true`. |
| `README.md` | Status Phase 7 dan tautan `docs/15`. |

### Keputusan

- Satu kontrak `enabled/available/initialize/healthCheck/describe` untuk semua
  plugin; halaman kasir dan pengaturan hanya menyentuh registry.
- QRIS dinamis ditolak secara eksplisit, bukan diimplementasikan setengah:
  aplikasi ini SPA tanpa Nitro, sehingga tidak ada tempat aman untuk secret
  provider maupun webhook.
- `public_config` disanitasi dua arah (baca dan sebelum RPC), sehingga field
  rahasia tidak pernah dikirim dari browser meski form dimanipulasi.
- Kegagalan memuat flag tidak memblokir kasir: semua adapter menjadi OFF dan
  jalur manual tetap dipakai.
- `settings` memakai desain yang ada (`.panel`, `.field`, `.tag`, `.notice`,
  `.btn`); tidak ada token atau komponen gaya baru.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **221/221 lulus** (16 file; 34 tes baru) |
| `npm run build` | exit 0 (14,6 dtk; 1,92 MB / 474 kB gzip) |

### Batasan

- Belum diuji dengan printer/scanner fisik; bridge printer dan gateway QRIS
  dinamis sengaja belum dibuat.
- Toggle flag memerlukan koneksi Supabase; kegagalan hanya ditampilkan sebagai
  pesan, tidak ada antrean offline.
- Migrasi Phase 5A **masih menunggu approval** untuk preview
  `ptbllrugrjepdhhdkzxn`; produksi tidak disentuh.
