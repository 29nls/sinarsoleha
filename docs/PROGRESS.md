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

## 4 November 2026 — Phase 8 (keamanan & UAT)

Audit keamanan yang dapat diulang plus checklist UAT per peran. Tidak ada
migrasi baru: Phase 5A masih menunggu approval untuk preview, produksi tidak
disentuh.

### Yang dibuat

- `scripts/audit-bundle.mjs` + `npm run audit:bundle` — memindai
  `.output/public` dan `.output/server` untuk `sb_secret_<key>`,
  `SUPABASE_SERVICE_ROLE_KEY=<nilai>`, claim JWT `service_role`, dan JWT
  lengkap yang payload-nya `service_role`. Literal prefix milik
  `@supabase/supabase-js` tidak dilaporkan. Exit 1 bila ada temuan.
- Grup I pada `scripts/db-test.mjs` (8 tes): anon 0 grant tabel, tulis
  authenticated hanya `categories`/`units_of_measure`, RLS 24/24 +
  `document_counters` tanpa policy, 17 RPC `SECURITY DEFINER` dengan
  `search_path=""`, anon tidak bisa EXECUTE RPC/tidak punya USAGE `private`,
  helper internal tidak bisa dipanggil authenticated, panggilan langsung fungsi
  trigger ditolak, dan default privilege bersih.
- `docs/16-security-uat.md` — hasil audit, model ancaman, matriks peran,
  checklist UAT owner/kasir/gudang, skenario konkurensi, batasan, dan
  definition of done.

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `package.json` | Script `audit:bundle`. |
| `scripts/db-test.mjs` | Grup I (8 tes) dijalankan setelah tes opname. |
| `README.md` | Status Phase 8, paragraf ringkasan, baris perintah, tautan `docs/16`. |
| `supabase/tests/README.md` | Jumlah migrasi/tes dan cakupan grup I. |

### Keputusan

- Audit bundle dibuat sempit dan sadar-library supaya tidak menghasilkan alarm
  palsu; ia diuji dengan file bocor buatan dan kembali bersih setelah dihapus.
- Temuan EXECUTE bawaan pada fungsi trigger **tidak** diperbaiki lewat migrasi
  baru: dampaknya nihil (anon tanpa USAGE `private`, panggilan langsung 0A000)
  dan setiap migrasi tambahan memperbesar permukaan review. Perbaikan
  `revoke all … from public` digabung ke migrasi berikutnya yang sudah menunggu
  approval.
- Checklist UAT dipisah per peran dan memakai langkah yang bisa dibuktikan
  (URL langsung untuk 403, payload `stock_on_hand` diabaikan, CSV kosong bukan
  nol), bukan sekadar “halaman terbuka”.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **221/221 lulus** (16 file) |
| `npm run test:db` | **80/80 lulus** (8 tes keamanan baru) |
| `npm run build` | exit 0 |
| `npm run audit:bundle` | 147 berkas, **0 temuan** |

### Batasan

- UAT hosted belum dijalankan: halaman opname/inventaris menunggu migrasi 5A,
  dan Supabase CLI belum terautentikasi (`SUPABASE_ACCESS_TOKEN` tidak ada).
- Printer/scanner fisik dan gateway QRIS dinamis tidak tersedia di lingkungan
  ini; keduanya tetap dilaporkan `unavailable`, bukan disimulasikan.
- CSP/HSTS belum dipasang; harus dilakukan di lapisan hosting sebelum produksi.
- Migrasi Phase 5A **masih menunggu approval** untuk preview
  `ptbllrugrjepdhhdkzxn`; produksi tidak disentuh.

## 4 November 2026 — Phase 9 (halaman pengguna, audit log, filter & ekspor inventaris)

> Judul ini semula bertanggal 5 November 2026. Dikoreksi pada Phase 5E: commit
> `5e9df13` tercatat 4 November 2026, dan tanggal judul bukan bukti eksekusi.

Menutup sisa pekerjaan UI: administrasi profil staf, pembacaan audit log,
filter "stok rendah" yang sebelumnya ditunda, dan ekspor CSV halaman.
**Tidak ada migrasi baru** — `public.admin_upsert_profile`, policy
`profiles_select_self_or_owner` dan `audit_logs_select_owner`, serta grant
`select` pada kedua tabel sudah ada sejak Phase 2. Phase 5A tetap menunggu
approval untuk preview; produksi tidak disentuh.

### Yang dibuat

- `app/types/users.ts` — `UserRow`/`UserDraft`, `roleLabel`, `shortUserId`,
  `validateFullName` (cermin constraint 120 karakter), `isLastActiveOwner`,
  `describeUsersError` (`LAST_OWNER`, `INVALID_ROLE`, `INVALID_FULL_NAME`,
  `PROFILE_NOT_FOUND`, `USER_REQUIRED`, permission/JWT).
- `app/services/users.ts` — `listProfiles` (urut `full_name`) dan
  `adminUpsertProfile` lewat RPC `admin_upsert_profile`; peran tak dikenal
  dipetakan ke `cashier`, bukan dirender mentah.
- `app/composables/useUsers.ts` — `rows/loading/saving/error/loaded`,
  `activeCount`/`ownerCount`, `load(force)`, `save` yang mengembalikan pesan
  error, dan `lastOwner(row)`.
- `app/components/users/UserTable.vue`, `UserEditDialog.vue`,
  `app/pages/users/index.vue` — tabel, dialog nama/peran/aktif, kartu
  ringkasan, dan catatan bahwa email/kata sandi dikelola Supabase Auth.
- `app/types/audit.ts` — 20 label `action_key` nyata dari
  `private.write_audit`, `summarizeAuditData` (potong 158 karakter),
  `auditCsv`, `describeAuditError`.
- `app/services/audit.ts` — `listAuditLogs` dengan filter `action_key`,
  `entity_name`, rentang tanggal Jakarta, urutan `created_at desc, id desc`,
  dan embed `profiles` untuk nama pelaku.
- `app/composables/useAudit.ts` — filter reaktif, paginasi 25/50/100,
  request-id guard, `onScopeDispose`.
- `app/components/audit/AuditTable.vue`, `app/pages/audit/index.vue` — tabel
  audit, panel detail JSON sebelum/sesudah, ekspor satu halaman.
- `tests/users-service.test.ts` (10 tes) dan `tests/audit-service.test.ts`
  (8 tes).
- `docs/17-users-audit.md`.

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `app/utils/modules.ts` | Modul `users` (`/users`) dan `audit` (`/audit`), capability `users.manage`, phase 9, `available: true`. |
| `app/types/inventory.ts` | `STOCK_STATES` + `low`, label `Stok rendah (≤ batas)`. |
| `app/services/inventory.ts` | `toBalanceRow`, `LOW_STOCK_SCAN_PAGE = 1000`, `LOW_STOCK_SCAN_LIMIT = 5000`, `isLowStock`, `listLowStockBalances`. |
| `app/pages/inventory/index.vue` | Tombol "Ekspor halaman (CSV)" + catatan filter aktif. |
| `app/pages/inventory/discrepancies.vue` | Tombol "Ekspor halaman (CSV)". |
| `tests/inventory-queries.test.ts` | 2 tes filter/paginasi stok rendah. |
| `tests/permissions.test.ts` | 1 tes modul Phase 9 hanya untuk owner. |
| `docs/13-inventory-ui.md` | Keputusan filter rendah dan batas ekspor CSV dikoreksi. |
| `README.md` | Baris tabel Phase 9, paragraf ringkasan, tautan `docs/17`. |

### Keputusan

- **Tanpa email.** `profiles` tidak punya kolom email dan `auth.users` tidak
  terbaca klien; identitas = nama + 8 karakter id. Tidak ada kolom kosong atau
  email tebakan.
- **Tanpa pembuatan akun.** RPC hanya mengubah profil yang sudah ada; akun
  dibuat lewat dashboard Supabase. Tombol tambah pengguna tidak dibuat supaya
  tidak menjanjikan yang tidak bisa dilakukan.
- **Audit dibaca dari tabel, bukan RPC baru.** Policy owner-only dan trigger
  immutable sudah cukup; fungsi baca hanya menambah permukaan review.
- **Filter stok rendah di klien.** PostgREST tidak bisa membandingkan dua
  kolom. Service memindai katalog bertahap 1.000 baris (batas 5.000),
  memfilter `stok > 0 && stok <= batas`, lalu memotong halaman — total dan
  paginasi tetap benar. Stok `NULL` dan `0` tidak dianggap rendah karena punya
  filter sendiri.
- **CSV hanya satu halaman.** Label tombol menyatakan cakupannya; tidak ada
  ekspor senyap seluruh hasil filter.
- **Capability lama dipakai ulang.** `users.manage` sudah owner-only; tidak ada
  capability baru yang perlu disinkronkan ke RLS.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **242/242 lulus** (18 file; 21 tes baru) |
| `npm run build` | exit 0 (1,92 MB / 474 kB gzip) |
| `npm run audit:bundle` | 151 berkas, **0 temuan** |
| `npm run test:db` | tidak dijalankan ulang; tidak ada migrasi baru (terakhir 80/80) |

### Batasan

- Halaman pengguna dan audit belum dibuka dengan sesi owner nyata di hosted;
  verifikasi masih unit test bentuk query dan pemetaan baris.
- Tidak ada pembuatan akun, reset kata sandi, undangan email, filter pelaku,
  atau pencarian teks bebas di audit.
- Filter stok rendah memindai maksimal 5.000 produk; katalog saat ini 1.360,
  tetapi katalog jauh lebih besar perlu view/RPC.
- Ekspor CSV inventaris/audit hanya satu halaman, bukan seluruh hasil filter.
- Migrasi Phase 5A **masih menunggu approval** untuk preview
  `ptbllrugrjepdhhdkzxn`; UAT hosted, printer/scanner fisik, dan gateway QRIS
  dinamis tetap tidak tersedia di lingkungan ini.

## 4 November 2026 — Phase 10 (Realtime stok, POS-03 / NFR-04 / DB-16)

> Judul ini semula bertanggal 5 November 2026. Dikoreksi pada Phase 5E: commit
> `87ebb80` tercatat 4 November 2026.

Menutup celah PRD terakhir yang belum punya kode: saldo stok antar-kasir kini
tersinkron tanpa muat ulang. Realtime hanya untuk tampilan; checkout tetap
memvalidasi stok di database.

### Yang dibuat

- `supabase/migrations/20261105100000_stock_broadcast.sql` —
  `private.broadcast_product_stock()` (`security definer`, `search_path = ''`),
  trigger `products_broadcast_stock` (`after update of stock_on_hand,
  stock_version`), `realtime.send(..., 'stock_changed', 'store:stock', true)`,
  dan policy `"stock topic readable by authenticated"` pada `realtime.messages`.
- `app/utils/stock.ts` — `STOCK_TOPIC`, `STOCK_EVENT`, `parseStockBroadcast`,
  `applyStockBroadcast`, `StockPatchable`.
- `app/composables/useStockRealtime.ts` — channel private, status
  `idle/connecting/subscribed/error`, `start/stop/reconnect`, resync setelah
  subscribe kedua, `onScopeDispose`.
- `tests/stock.test.ts` (8 tes).

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `app/types/cashier.ts` | `stockVersion?` pada `CashierProduct`. |
| `app/services/cashier.ts` | `stock_version` masuk `PRODUCT_SELECT` dan `mapProduct`. |
| `app/stores/cashier.ts` | Peta `stockVersions`, `applyStockChange`, `resetStockVersions`; versi disemai saat produk masuk keranjang dan saat refetch. |
| `app/composables/useCashierSearch.ts` | `applyStock(event)` dengan pembanding versi baris. |
| `app/pages/cashier/index.vue` | `useStockRealtime` + `refreshCartStock` sebagai resync, start/stop, `reconnect()` pada `online`. |
| `app/components/cashier/CashierHeader.vue` | Prop `stockLive` + badge “Stok live”/“Stok manual”. |
| `supabase/tests/local_bootstrap.sql` | Shim schema `realtime` (`messages`, `send`, `topic`) untuk PGlite. |
| `scripts/db-test.mjs` | `runRealtimeTests()` H1–H3. |
| `tests/cashier.test.mjs` | 1 tes store: versi lama ditolak, replay tidak mundur, reset membuka guard. |
| `docs/01`, `docs/02`, `docs/03`, `docs/13`, `docs/16`, `README.md` | Status DB-16, ADR-009, angka tes, tautan `docs/18`. |

### Keputusan

- **Private broadcast, bukan publik.** Policy `realtime.messages` membatasi
  topic ke `authenticated`; anon tidak bisa berlangganan meski tahu namanya.
- **Payload minimal.** Empat kunci saja; tidak ada harga beli/pelanggan.
- **Trigger selektif.** Update nama/harga dan produk berstok `NULL` tidak
  disiarkan, sehingga 1.360 produk impor tidak membanjiri channel.
- **Version guard.** `stock_version` yang lebih lama/sama diabaikan; refetch
  me-reset guard karena hasil baca database selalu lebih baru.
- **Migrasi aman di PGlite.** Guard `to_regprocedure(...)` dan
  `to_regclass('realtime.messages')` membuat migrasi bisa diuji lokal tanpa
  schema Realtime, tanpa melemahkan hosted.
- **Tanpa Realtime di halaman inventaris.** Layar kasir yang butuh; halaman
  baca tetap manual.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **83/83 lulus** (3 tes baru H1–H3) |
| `npm test` | **251/251 lulus** (19 file; 9 tes baru) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (1,92 MB / 474 kB gzip) |
| `npm run audit:bundle` | 151 berkas, **0 temuan** |

### Penerapan ke preview (4 November 2026)

Owner menyetujui penerapan Phase 5A + Broadcast. `supabase db push --linked`
menjalankan `20261104100000` dan `20261105100000`; riwayat 3B/4A dicatat lewat
`migration repair --status applied` karena objeknya sudah ada. Hasil:

| Pemeriksaan | Hasil |
| --- | --- |
| `migration list --linked` | 16/16 sinkron |
| `gen types --linked` vs lokal | 24 tabel, nol drift kolom |
| 6 RPC opname tanpa sesi | 401 (ada & terlindungi) |
| Data impor | utuh: 1.361 baris staging, 1.360 produk impor |
| Broadcast `store:stock` | klien owner `SUBSCRIBED`, menerima `stock_changed` dengan payload 4 kunci setelah opname diposting |
| `npm run typecheck` / `npm test` / `npm run test:db` | 0 / 251 / 83 |

### Batasan

- Uji dua browser pada hosted belum dijalankan; yang terverifikasi adalah
  trigger/policy SQL, pengiriman Broadcast nyata ke satu klien, dan logika klien.
- Hanya saldo yang disinkronkan; nama/harga/status aktif baru terlihat setelah
  pencarian ulang.

## 4 November 2026 — Penerapan migrasi ke preview (Phase 5A + Realtime)

Owner menyetujui penerapan Phase 5A + Broadcast ke preview
`ptbllrugrjepdhhdkzxn`. Produksi tidak disentuh.

### Langkah

1. `supabase link --project-ref ptbllrugrjepdhhdkzxn` (CLI v2.122.0).
2. Verifikasi pra-push: `db dump`/`db pull` tidak bisa (Docker tidak tersedia),
   jadi keberadaan objek diprobe lewat REST. Tabel `product_import_runs`/
   `product_import_rows` ada dan RPC `begin_product_import`, `complete_sale`,
   `void_sale` membalas 401 → objek 3B/4A sudah ada, hanya riwayatnya belum
   tercatat. Kolom `stock_opnames.creation_key` membalas 400 `42703` → 5A
   memang belum diterapkan.
3. `migration repair --linked --status applied 20261103090000 20261103110000`
   agar SQL 3B/4A tidak dijalankan dua kali.
4. `db push --dry-run` menyisakan tepat dua migrasi, lalu `db push --linked`
   menerapkan `20261104100000_stock_opname_engine.sql` dan
   `20261105100000_stock_broadcast.sql`.

### Verifikasi pasca-push

| Pemeriksaan | Hasil |
| --- | --- |
| `migration list --linked` | 16/16 versi sinkron (remote terakhir `20261105100000`) |
| `stock_opnames?select=creation_key` | 401 (kolom ada); kontrol negatif tetap 400 `42703` |
| 6 RPC opname tanpa sesi | 401 semua (ada & terlindungi) |
| `gen types --linked` vs `types/database.generated.ts` | 24 tabel, nol drift kolom; 17 fungsi sama |
| `gen types --linked --schema realtime` | `realtime.send(...)` + `realtime.messages` ada → trigger tidak no-op |
| Data | 1.361 baris staging, 1.360 produk impor, 1.507 isu, 33 transaksi utuh |
| `npm run typecheck` | exit 0 |
| `npm test` | 251/251 (19 file) |
| `npm run test:db` | 83/83 |

### Bukti Broadcast hosted

Klien nyata dengan akun uji owner `SUBSCRIBED` ke channel privat `store:stock`,
lalu alur opname lengkap dijalankan lewat RPC (create → count `opening_balance`
→ submit → approve → post) pada produk uji `TEST-REALTIME-*`. Klien menerima
tepat satu event `stock_changed` dengan payload
`{product_id, sku, stock_on_hand, stock_version}`. Tiga sesi draft uji
dibatalkan lewat `cancel_stock_opname`; satu sesi posted dibiarkan (produk uji
nonaktif, tidak terlihat di kasir).

### Sisa prasyarat produksi

`disable_signup` di hosted, pembersihan akun/data uji preview, CSP/HSTS di
lapisan hosting, rate limit login, backup/restore teruji, dan `db push` ke
project produksi terpisah — semuanya masih terbuka.

## 4 November 2026 — Phase 11 (Koreksi stok manual, DB-03)

> Judul ini semula bertanggal 6 November 2026. Dikoreksi pada Phase 5E: commit
> `cf5392a` tercatat 4 November 2026.

Melengkapi RPC mutasi terakhir yang masih kontrak. Koreksi manual kini punya
jalur resmi: satu movement `manual_adjustment` beralasan, audit, dan idempotensi
— tanpa pernah mengizinkan klien menulis `products.stock_on_hand`.

### Yang dibuat

- `supabase/migrations/20261106100000_stock_adjustment.sql` —
  `private.adjust_stock(uuid, numeric, text, text, uuid)` + wrapper
  `public.adjust_stock(...)` (`security definer`, `search_path = ''`,
  `EXECUTE` hanya untuk `authenticated`).
- `app/components/inventory/StockAdjustDialog.vue` — dialog arah tambah/kurangi,
  pratinjau saldo, validasi presisi, alasan, catatan wajib.
- `tests/stock-adjust.test.ts` (5 tes validasi).

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `app/types/inventory.ts` | `ADJUSTMENT_REASONS`, `validateAdjustment`, `AdjustmentResult`, pesan error baru. |
| `app/services/inventory.ts` | `adjustStock(client, input)` memanggil RPC dengan kunci idempotensi. |
| `app/components/inventory/StockBalanceTable.vue` | Prop `canAdjust` + tombol “Koreksi”. |
| `app/pages/inventory/index.vue` | State dialog, kunci idempotensi per sesi, refresh setelah sukses. |
| `app/utils/permissions.ts` | Capability `stock.adjust` untuk owner dan inventory_staff. |
| `scripts/db-test.mjs` | Grup J1–J5; assertion I4 naik ke ≥18 fungsi publik. |
| `types/database.generated.ts` | Hasil `npm run gen:types` (fungsi `adjust_stock`). |
| `tests/permissions.test.ts` | Matriks `stock.adjust`. |
| `docs/02`, `docs/03`, `docs/04`, `docs/11`, `docs/13` | Status DB-03, kontrak RPC, batasan UI. |

### Keputusan

- **`opening_balance` ditolak.** Alasan itu berarti saldo belum diketahui;
  jalurnya opname saldo awal, bukan koreksi. Ini menutup pertanyaan terbuka di
  kontrak lama.
- **Saldo negatif ditolak untuk semua peran.** Kontrak lama membuka pengecualian
  owner + `input_error`; itu tidak dipakai karena saldo negatif merusak laporan
  dan sudah bisa diperbaiki lewat koreksi positif setelah opname.
- **Catatan wajib untuk semua alasan.** Constraint ledger sudah mewajibkannya
  untuk `manual_adjustment`; memvalidasi di RPC memberi pesan yang jelas.
- **Idempotensi opsional.** `p_idempotency_key` default `NULL` supaya pemanggil
  lama tetap sah; UI selalu mengirim UUID baru per dialog.
- **Tanpa edit langsung.** Tidak ada grant UPDATE pada `products`; satu-satunya
  penulis saldo tetap RPC dan trigger penjualan/opname.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **88/88 lulus** (5 tes baru J1–J5) |
| `npm test` | **257/257 lulus** (20 file; 6 tes baru) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (1,92 MB / 474 kB gzip) |
| `npm run audit:bundle` | 0 temuan |

### Penerapan ke preview (4 November 2026)

`supabase migration list --linked` menunjukkan satu-satunya selisih adalah
`20261106100000`; `db push --linked --dry-run` mengonfirmasi hanya migrasi itu
yang akan jalan, lalu `db push --linked` menerapkannya.

| Pemeriksaan | Hasil |
| --- | --- |
| `migration list --linked` | 17/17 sinkron |
| `gen types --linked` | `adjust_stock` ada; signature identik dengan lokal |
| `adjust_stock` tanpa sesi | 401 (ada & terlindungi) |
| Probe hosted (`.tmp/adjust-hosted-probe.mjs`) | **8/8 lulus** |
| Saldo produk uji | kembali ke nilai awal (0); net delta probe = 0 |
| Data impor | utuh: 1.360 produk berstok `NULL` tidak tersentuh |

Probe hosted membuktikan: kasir ditolak, staf gudang boleh menambah, retry
dengan kunci idempoten tidak menggandakan stok, catatan kosong /
`opening_balance` / `delta 0` ditolak, owner bisa mengoreksi balik, dan ledger
mencatat `manual_adjustment` dengan `transaction_id`/`stock_opname_id` NULL
plus audit `stock.adjust`.

## 4 November 2026 — UAT NFR-04 dua browser

Gate PRD terakhir yang belum pernah dijalankan sungguhan: kasir A checkout,
kasir B melihat saldo baru di layar kasir tanpa reload.

`e2e/nfr04-stock-latency.spec.mjs` membuka **dua konteks Chromium terpisah**
(storage dan sesi sendiri, setara dua till fisik), login sebagai `cashier` dan
`cashier_b`, lalu mengukur dari klik "Bayar & simpan" sampai sel stok di
browser B berubah.

| Pemeriksaan | Hasil |
| --- | --- |
| Browser B `SUBSCRIBED` ke `store:stock` | ya (`Stok live` tampil) |
| Stok terlihat berubah | 2 → 1 |
| Latensi end-to-end (termasuk round trip RPC) | **899 ms** |
| Budget NFR-04 | 2.000 ms |
| Reload / refetch manual | tidak ada; URL dan kata kunci pencarian B tetap |

Angka ini mencakup round trip `complete_sale` ke Supabase, trigger Broadcast,
dan render di browser kedua — bukan hanya waktu pengiriman pesan. Karena
checkout tetap memvalidasi stok di PostgreSQL, pesan yang terlambat tidak bisa
menyebabkan oversell; layar hanya menampilkan angka basi sampai pesan atau
refetch berikutnya.

## 4 November 2026 — Hardening grant schema `private` (Phase 12)

Temuan residual dari audit Phase 8: PostgreSQL memberi `EXECUTE` ke `PUBLIC`
pada setiap fungsi baru, termasuk 10 fungsi trigger di schema `private`.
Tidak pernah dapat dieksploitasi (`anon` tanpa USAGE, panggilan langsung
ditolak), tetapi satu grant USAGE yang salah di masa depan akan membuka
semuanya sekaligus.

Migrasi `20261106110000_private_function_grants.sql`:

- `revoke all on all functions in schema private from public`
- `grant execute on function private.has_role(text[]) to authenticated` —
  satu-satunya helper yang memang dipanggil RLS (32 policy memakainya)
- `alter default privileges in schema private revoke execute on functions from public`

Fungsi trigger tetap bekerja: PostgreSQL memeriksa privilege pemilik tabel,
bukan sesi, saat trigger menyala.

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run test:db` | **88/88** (I7 diperketat) |
| `npm test` | 257/257 |
| `npm run typecheck` | exit 0 |
| Fungsi `private` dengan EXECUTE `PUBLIC` | 0 |
| Panggilan langsung helper trigger | `42501` (sebelumnya `0A000`) |

I7 sekarang mengunci dua hal: panggilan langsung ditolak, dan nol fungsi
`private` memberi EXECUTE ke `PUBLIC`.

**Diterapkan ke preview** 4 November 2026 (`db push --linked`, dry-run lebih
dulu memperlihatkan hanya migrasi ini). Verifikasi pasca-push:

| Pemeriksaan | Hasil |
| --- | --- |
| `migration list --linked` | **18/18** sinkron |
| Probe peran (anon/owner/cashier/gudang/nonaktif) | **10/10** lulus |
| `has_role` masih dipanggil RLS | ya — owner membaca lintas staf + `audit_logs` |
| RLS tetap membatasi | cashier/gudang hanya melihat profil sendiri, `audit_logs` kosong |
| `gen types` remote vs 18 migrasi lokal | 24 tabel, kolom identik, nol beda |

Probe peran adalah bukti yang tepat untuk migrasi ini: kalau re-grant
`has_role` salah, setiap policy yang memakainya akan melempar `42501`, bukan
mengembalikan baris terbatas. Produksi tetap belum menerima migrasi apa pun.

## 4 November 2026 — Penyelesaian baris review `WAL-W1303`

### Lingkup

- Investigasi read-only atas satu-satunya baris `review` (baris 1305, `WAL-W1303`): `issue_codes = {stock_unknown, sale_below_cost}`, harga jual 9.500 < biaya 20.000.
- Bukti salah input: baris 1306 tepat setelahnya berisi angka persis tertukar (20.000/9.500); rasio 0,475; 4 produk lain dengan pasangan harga sama semuanya berorientasi benar; 0 dari 1.242 produk berkatalog punya jual < beli.
- Ditemukan dua hambatan: tidak ada RPC yang menulis `reviewed_by`/`reviewed_at`, dan run sudah `completed` sehingga `begin_product_import` menolak checksum yang sama.
- Keputusan owner: harga jual 20.000, harga beli 9.500.

### File dibuat

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261106120000_import_review_resolution.sql` |

### File dimodifikasi

- `scripts/db-test.mjs` — 5 tes baru: otorisasi owner-only, penolakan harga di bawah biaya, pembukaan ulang run + penandaan `ready`, impor dengan harga terkoreksi tanpa isu `sale_below_cost`, dan penolakan dengan alasan wajib.
- `docs/06-product-master-import.md` — §13 (temuan, kendala, migrasi, hasil preview).
- `docs/04-rpc-contracts.md` — §6 kontrak `resolve_product_import_review`.
- `README.md`, `docs/PROGRESS.md` — status 3B menjadi 1.361/1.361.

### Verifikasi

| Perintah / probe | Hasil |
| --- | --- |
| `npm run test:db` | **93/93 lulus** (sebelumnya 88) |
| `npm test` | **257/257 lulus** |
| `npm run typecheck` | exit 0 |
| `migration list --linked` | 19/19 sinkron |
| `db push --dry-run` | tepat satu migrasi |
| Probe hosted | resolve → ready; import → imported; finish → 1.361/1.361, review 0 |
| Produk `WAL-W1303` | jual 20.000 / beli 9.500, stok NULL, tanpa `sale_below_cost`, 0 movement |
| Katalog | 1.373 produk, 0 dengan jual < beli |

Tidak ada perubahan pada produksi; seluruh operasi hanya pada preview `ptbllrugrjepdhhdkzxn`.

## 4 November 2026 — Phase 5D (validasi inventaris hosted)

### Lingkup

- Audit read-only repo + preview: 20/20 migrasi sinkron (setelah 0020), 9 RPC inventaris/transaksi tersedia, 5 akun uji sesuai peran, katalog 1.373 produk dengan 1.369 stok `NULL`.
- Jejak hosted menunjukkan `opname_adjustment` 0, `stock_discrepancy_logs` 0, dan `post_conflict` 0 — jalur penyesuaian, log selisih, dan konflik versi belum pernah berjalan.
- Audit menemukan cacat mesin 5A: `stock_version_snapshot` tidak pernah di-refresh, sehingga sesi yang kena konflik tidak akan pernah bisa diposting ulang (tes F2 berhenti di `approved`).

### File dibuat

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261106130000_opname_recount_rebase.sql` (0020) |
| Suite hosted | `scripts/inventory-hosted-smoke.mjs` |
| E2E | `e2e/stock-opname.spec.mjs` |
| Dokumentasi | `docs/19-inventory-hosted-validation.md` |

### File dimodifikasi

- `scripts/db-test.mjs` — tes F3 (recount me-rebase snapshot, post berhasil, tanpa drift ledger); total 94.
- `package.json` — `test:hosted:inventory`, `test:e2e:inventory`.
- `docs/11`, `docs/12`, `docs/13`, `docs/16`, `README.md` — status, angka tes, dan temuan 5D.

### Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **94/94** |
| `npm test` | 257/257 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (18,3 detik) |
| `npm run audit:bundle` | 0 temuan |
| `npm run test:hosted:inventory` | **24/24** |
| `npm run test:e2e:inventory` | **17/17** |
| `migration list --linked` | **20/20** |
| Snapshot seluruh katalog | 1.361 item dalam 113–114 ms (dibatalkan, tidak diposting) |
| Posting paralel | `overlap=true`, `posted` + `already_posted`, satu movement, satu audit |
| Produk impor | 1.361 tetap `NULL`, 0 movement |

### Temuan tersisa

- Detail opname seluruh katalog terpotong 1.000 baris oleh PostgREST.
- Dialog recount menampilkan snapshot lama setelah konflik (meminta alasan yang dibuang server).
- Fixture `TEST-OPN-*` menumpuk di preview dan harus dibersihkan sebelum produksi.

## 4 November 2026 — Phase 5E (keandalan inventaris & kesiapan operasional)

### Lingkup

- Menutup tiga temuan Phase 5D: truncation PostgREST 1.000 baris, snapshot recount
  yang basi, dan akumulasi fixture preview.
- Menyiapkan aplikasi untuk stok opname fisik nyata tanpa membuat sesi nyata,
  tanpa mengisi jumlah fisik, dan tanpa memposting saldo awal.
- Tiga migrasi baru (**0021–0023**) ditulis dan diuji lokal, lalu diterapkan
  ke preview lewat Phase 5E.1; produksi belum.

### File dibuat

| Kelompok | File |
| --- | --- |
| Migrasi | `supabase/migrations/20261106140000_opname_detail_summary.sql` (0021) |
| Migrasi | `supabase/migrations/20261106140100_opname_item_pagination.sql` (0022) |
| Migrasi | `supabase/migrations/20261106140200_opname_item_context.sql` (0023) |
| Skrip audit | `scripts/fixture-audit.mjs` (read-only, `--json`, guard preview) |
| Dokumentasi | `docs/20-preview-fixture-inventory.md` |

### File dimodifikasi

- `app/types/opname.ts` — `OPNAME_ITEM_FILTERS`, `OPNAME_PAGE_SIZES`,
  `OpnameItemPageParams/Result`, `OpnameItemContext`, `effectiveSystemQty()`,
  counter global pada `OpnameDetail`, kode error `INVALID_FILTER` /
  `PRODUCT_NOT_FOUND`.
- `app/services/opname.ts` — `getOpnameDetail` memakai RPC summary;
  `getOpnameItemsPage` dan `getOpnameItemContext` baru; `DETAIL_SELECT` dihapus.
- `app/composables/useOpnameDetail.ts` — state halaman + filter + pencarian
  server-side, debounce 200 ms, request-id guard terpisah untuk detail dan item,
  `fetchItemContext`, `count()` mem-patch baris dari respons RPC.
- `app/pages/stock-opname/[id].vue` — filter server-side, pencarian, navigasi
  halaman, pemilih ukuran halaman, `rangeStart–rangeEnd`, dialog memuat konteks
  secara asinkron.
- `app/components/opname/OpnameCountDialog.vue` — tiga angka terpisah (snapshot,
  stok saat ini, pembanding), notice recount, validasi `effectiveSystemQty`.
- `app/components/opname/OpnameItemTable.vue` — prop `emptyMessage` + overlay
  loading.
- `app/components/opname/OpnameActionPanel.vue` — delapan metrik dari ringkasan
  global dan `readyForSubmit`.
- `types/database.generated.ts` — tiga signature RPC baru (diedit manual;
  `npm run gen:types` butuh akses remote).
- `scripts/db-test.mjs` — Grup F4–F8 (paginasi, ringkasan, konteks, filter,
  penjualan saat recount), H2–H4 (skala 1.417 item), dan I4 diubah menjadi
  allowlist eksplisit.
- `tests/opname-queries.test.ts`, `tests/opname-service.test.ts` — tes tipe,
  filter, dan mapping respons.
- `docs/12-stock-opname-ui.md` — §5 baru (paginasi, ringkasan, recount), dua
  batasan lama dihapus, batasan baru yang jujur ditambahkan.
- `README.md` — status Phase 5E dan tautan `docs/20`.

### Solusi

1. **Truncation.** `getOpnameDetail` tidak lagi mengambil item. Header dan
   counter berasal dari `get_stock_opname_summary`; tabel memakai
   `list_stock_opname_items` dengan `limit`/`offset` dan urutan
   `p.sku ASC, i.id ASC`. Ukuran halaman 50/100/250, total dan jumlah halaman
   berasal dari `count(*)` di database.
2. **Ringkasan.** Delapan angka dihitung dengan `count(*) filter (...)` atas
   seluruh sesi dalam satu query. `blocker_count` memakai predikat yang sama
   dengan `submit_stock_opname`, sehingga `ready_for_submit` tidak bisa berbeda
   dari keputusan server.
3. **Recount.** `get_stock_opname_item_context` mengembalikan snapshot dan stok
   terkini berdampingan; dialog memberi label berbeda untuk keduanya.
   `record_stock_opname_count` tetap satu-satunya yang me-rebase, dan UI
   memperbarui baris dari responsnya.

### Verifikasi lokal

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **101/101** (sebelumnya 94) |
| `npm test` | **275/275** (20 berkas; sebelumnya 257) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (12,1–15,1 detik pada tiga run; 1,92 MB / 474 kB gzip) |
| `npm run audit:bundle` | 0 temuan (151 berkas, 2.581,2–2.581,3 kB) |
| Paginasi 1.417 item | jalan penuh 151–261 ms pada tiga run, tanpa baris hilang/ganda |
| Snapshot 1.417 item | 117–190 ms |
| Ringkasan sesi | 2–4 ms |

### Temuan fixture

Audit read-only atas 48 produk `TEST-*`/`HOST-*`: **A=0, B=13, C=3, D=32**
(8 aktif, 40 nonaktif), dengan 104 movement, 39 baris transaksi, 80 baris
opname (53 terposting), 13 log selisih, dan 92 baris audit. Tidak ada kandidat
hapus fisik; rekomendasi seluruhnya pengarsipan. Rincian per produk ada di
`docs/20-preview-fixture-inventory.md`. **Belum ada perubahan hosted** — cleanup
menunggu `APPROVE PREVIEW FIXTURE CLEANUP`.

### Temuan staf kedua

Hanya ada satu akun `inventory_staff` (`a3333333-…`) dari lima profil. Akun
`INVENTORY_STAFF_B` belum ada dan harus dibuat owner lewat Supabase Auth
Dashboard, lalu profilnya diverifikasi (trigger `handle_new_user`, peran default
`cashier`, status aktif) sebelum dinaikkan ke `inventory_staff` di `/users`.
Tidak ada kredensial yang dikarang dan sign-up publik tetap dimatikan.

### Koreksi kronologi

Beberapa judul di dokumen ini bertanggal 5 dan 6 November 2026, sedangkan
seluruh commit berada pada 3–4 November 2026. Tanggal pada judul tersebut adalah
**tanggal penulisan dokumen yang keliru**, bukan tanggal eksekusi:

| Judul lama | Bukti sebenarnya |
| --- | --- |
| `5 November 2026 — Phase 9` | Commit `5e9df13`, 4 November 2026 |
| `5 November 2026 — Phase 10` | Commit `87ebb80`, 4 November 2026 |
| `6 November 2026 — Phase 11` | Commit `cf5392a`, 4 November 2026 |

Nama berkas migrasi juga memakai nomor versi berurutan
(`20261105100000`, `20261106100000`), bukan tanggal penerapan. Yang menjadi
bukti penerapan adalah riwayat migrasi remote, dan itu hanya tersedia untuk
migrasi sampai `20261106130000` (20/20). Migrasi 0021–0023 belum pernah
diterapkan ke mana pun.

### Status

Phase 5E selesai dan tiga migrasinya sudah diterapkan ke preview lewat 5E.1.
Cleanup fixture menunggu approval eksplisit, dan akun staf kedua menunggu
pembuatan oleh owner. Tidak ada stok, transaksi, atau saldo awal yang diubah.

## 4 November 2026 — Phase 5E.1 (hosted deployed, read-only verified)

### Lingkup

- Audit read-only, dry-run, dan deployment tiga migrasi 5E ke preview.
- Regresi hosted read-only 11/11 pada sesi 1.361 item; tidak ada fixture
  diarsipkan dan tidak ada stok atau saldo awal yang dibuat.
- Gate pengarsipan tetap terpisah.

### Bukti remote dan dry-run

| Item | Hasil |
| --- | --- |
| Project | `ptbllrugrjepdhhdkzxn` (preview; org `veqlhnjvckdsflpoefsu`) |
| CLI | `npx supabase` 2.122.0 |
| Riwayat remote sebelum push | 20/20 sampai `20261106130000` |
| Riwayat lokal | 23 |
| `db push --dry-run` | tepat `20261106140000`, `20261106140100`, `20261106140200` |
| Probe RPC 5E sebelum push | ketiganya `PGRST202` (belum ada) |
| `gen types --linked` | 49.112 byte; typecheck/test/build lulus |

### Hasil deployment

| Langkah | Hasil |
| --- | --- |
| `db push --linked --yes` | tiga migrasi applied, exit 0 |
| `migration list --linked` | **23/23** |
| Probe RPC sesudah push | summary/list OK; context `22023` untuk item null |

### Bukti read-only preview

- Katalog 1.409 produk; 1.374 `NULL`; 1.369 aktif.
- 1.361 produk impor tetap `NULL` (1.374 `NULL` − 13 fixture `NULL`).
- 5 profil: owner 1, inventory_staff 1, cashier 3 (1 nonaktif). Staf B belum ada.
- 48 fixture: **A=0, B=13, C=3, D=32**; 8 aktif (5 `HOST-*`, 3 `TEST-TXN-*`).
- 58 sesi opname; `OP-20261104-0018` dan `OP-20261104-0032` berstatus
  `cancelled` dengan 1.361 item — dipakai untuk uji paginasi read-only.
- 2 item `needs_recount` (`OP-20261104-0047`, `OP-20261104-0052`) untuk uji konteks.

### Verifikasi lokal

| Perintah | Hasil |
| --- | --- |
| `npm run test:db` | **101/101** |
| `npm test` | **275/275** (20 berkas) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (14,0 detik) |
| `npm run audit:bundle` | 0 temuan (151 berkas, 2.581,2 kB) |

### Verifikasi hosted

| Perintah | Hasil |
| --- | --- |
| `npm run test:hosted:opname` | **11/11** (read-only) |
| `npm run test:hosted:inventory` | belum dijalankan — suite menulis fixture/posting |
| `npm run test:e2e:inventory` | belum dijalankan — alasan sama |

### Gate

Gate migrasi sudah dijalankan dengan frasa persis. Gate arsip dijalankan
terpisah pada Phase 5E.2 di bawah.

Tidak ada gate yang boleh disimpulkan dari gate lainnya. Detail lengkap ada di
`docs/21-phase-5e-hosted-readiness.md`.

**Status: Phase 5E.1 selesai untuk deployment dan regresi read-only.**

## 4 November 2026 — Phase 5E.2 (arsip 8 fixture)

### Gate

`APPROVE ARCHIVE 8 ACTIVE PREVIEW FIXTURES`

### Eksekusi

- 8 payload `upsert_product` dibangun dari master saat ini; hanya `is_active`
  berubah menjadi `false`.
- 8/8 RPC berhasil; fixture aktif 8 → 0; total 48 tetap.
- Klasifikasi ulang: **A=0, B=13, C=0, D=35**.
- Stok/versi, 104 movement, 39 transaction item, 39 payment, 80 opname item,
  13 log selisih, dan 5 product cost tidak berubah; audit +8.
- `npm run test:hosted:opname` diulang: **11/11**.
- Tidak ada `DELETE`, `CASCADE`, saldo awal, atau posting; produksi tidak disentuh.

### Status

Phase 5F belum dimulai. Blocker yang tersisa adalah akun `INVENTORY_STAFF_B`
yang harus dibuat dan diverifikasi owner.

## 4 November 2026 — Runbook Phase 5F

Runbook eksekusi stok opname fisik nyata ditulis di
`docs/22-phase-5f-stock-opname-runbook.md`. Isinya: definisi selesai, gate
`APPROVE PHASE 5F REAL STOCK OPNAME ON PREVIEW`, langkah persiapan read-only,
urutan buat sesi → hitung → buktikan konflik versi → submit → setujui → posting,
verifikasi pasca-posting, rollback, dan daftar bukti yang harus disimpan.

Persiapan read-only §4 sudah dijalankan: migrasi 23/23, 0 fixture aktif, dan
regresi `npm run test:hosted:opname` 11/11. Baseline 4 November 2026 dicatat:
1.409 produk (1.361 aktif), 1.374 stok `NULL`, 104 movement, 58 sesi, 2.802
opname item, dan 13 `stock_discrepancy_logs`.

Verifikasi staf B disiapkan sebagai `npm run test:hosted:opname:staff-b`
(`scripts/opname-staff-b-readiness.mjs`): read-only, delapan pemeriksaan, dan
menolak jalan bila target bukan preview.

Staf B kini ada dan terverifikasi **8/8**. Akun dibuat lewat Admin API resmi
(`POST /auth/v1/admin/users` dengan `email_confirm: true`), bukan SQL langsung ke
`auth.users`, lalu profilnya diubah ke `inventory_staff` aktif lewat RPC owner
`admin_upsert_profile`. Identitas: `phase5f.staffb@sinarsoleha.com`
(`4ba5012e-7e53-4f85-892d-27524eb8071a`). Bukti: staf B bisa membaca permukaan
opname, hanya melihat profilnya sendiri, dan ditolak `approve`/`post`/`cancel`
dengan `42501` tanpa satu baris pun berubah.

Belum ada sesi opname nyata yang dibuat, belum ada posting, dan produksi tidak
disentuh. Satu-satunya blocker tersisa adalah frasa gate Phase 5F.

## 4 November 2026 — Roadmap go-live (`docs/23`)

Sisa pekerjaan dipetakan menjadi 9 langkah dalam 4 tahap. Temuan yang
mendasarinya: **0 dari 1.361 produk aktif punya saldo** — semuanya `NULL`,
sehingga kasir belum bisa menjual apa pun. Saldo hanya boleh berasal dari
hitungan fisik, jadi Tahap B (3–5 hari kerja gudang) adalah bottleneck
sebenarnya, bukan kode. Hanya ada satu project Supabase (preview), sehingga
produksi masih harus dibuat, di-`db push`, diimpor, dan diisi saldo awal.

Hardening Tahap C bisa berjalan paralel dengan Tahap B. Satu butirnya mencatat
bahwa CSP/HSTS belum bisa dikerjakan karena repo belum punya konfigurasi
platform hosting.

## 4 November 2026 — Signup publik ditutup, plus insiden yang ditemukan

`disable_signup` dinyalakan di preview lewat `supabase config push` dengan
config minimal (`.tmp/cfgpush`) yang hanya mendeklarasikan properti auth.
Pendekatan ini dipilih setelah `config diff` pada `supabase/config.toml` asli
menunjukkan bahwa push penuh akan ikut menulis ulang `site_url` dan
`additional_redirect_urls` menjadi `127.0.0.1` — itu akan mematikan aplikasi
Vercel yang sedang dipakai.

Hasil akhir, diverifikasi lewat `/auth/v1/settings`:

| Setelan | Nilai | Arti |
| --- | --- | --- |
| `disable_signup` | `true` | pendaftaran publik tertutup |
| `external.email` | `true` | login email tetap hidup |
| `mailer_autoconfirm` | `true` | tidak ada email konfirmasi (aman, karena signup tutup) |

Probe `POST /auth/v1/signup` mengembalikan `422 signup_disabled`, jadi
penutupan ini nyata, bukan sekadar setelan yang tersimpan.

**Insiden.** Percobaan pertama memakai `[auth.email] enable_signup = false`.
Properti itu ternyata bukan "pendaftaran lewat email", melainkan **ketersediaan
provider Email**. Akibatnya seluruh login email mati — owner sendiri gagal
masuk dengan `Email logins are disabled`, dan `test:hosted:opname:staff-b`
gagal total. Ini terdeteksi langsung oleh skrip readiness, lalu diperbaiki
dengan mengembalikan `[auth.email] enable_signup = true` sementara penutupan
pendaftaran tetap dipegang `[auth] enable_signup = false`.

Pelajaran: `[auth] enable_signup` menutup pendaftaran; `[auth.email]
enable_signup` menyalakan/mematikan provider login. Keduanya berbeda dan
yang kedua mudah disalahartikan.

Setelah perbaikan: `test:hosted:opname:staff-b` 8/8 dan
`test:hosted:opname` 11/11, keduanya exit 0. Diff config tersisa 0 update.
`site_url` dan empat URL redirect Vercel tetap utuh.

## 4 November 2026 — C3 selesai: CSP + HSTS

Header keamanan dipasang di `nuxt.config.ts` lewat `routeRules['/**'].headers`.
Dipilih `routeRules` alih-alih `vercel.json` karena berlaku di host mana pun dan
bisa diverifikasi terhadap server Nitro lokal — bukan sekadar ditulis lalu
diasumsikan jalan.

Enam header terverifikasi ada di response build produksi:

| Header | Nilai |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'` + origin Supabase (https + wss) |
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `X-Frame-Options` | `DENY` |
| `Permissions-Policy` | kamera, mikrofon, geolokasi, pembayaran dimatikan |

CSP bisa ketat karena tidak ada CDN, font eksternal, analytics, maupun gambar
dari Storage. `'unsafe-inline'` masih perlu untuk skrip: shell SPA memuat tiga
skrip inline (importmap, runtime config, payload Nuxt).

Dua keputusan yang sengaja diambil:

- **HSTS tanpa `includeSubDomains`.** Host preview ada di domain bersama
  `vercel.app`; memaku subdomain di domain yang bukan milik kita berisiko dan
  tidak perlu. Nyalakan setelah domain produksi sendiri ada.
- **`wss://` ikut di `connect-src`.** Tanpa itu realtime stok mati diam-diam —
  halaman tetap tampil, tapi angka stok berhenti diperbarui.

Verifikasi bukan hanya "header ada", tapi aplikasi masih hidup di bawahnya:
login staf B lewat browser, dasbor termuat, halaman Stok Opname menampilkan
58 sesi (1–20 dari 58), dan log jaringan bersih — semua request `200`/`206`,
nol pelanggaran CSP.

Dijaga `tests/security-headers.test.ts` (7 pemeriksaan). Tes diuji balik dengan
menghapus header HSTS: gagal seperti seharusnya, lalu hijau setelah
dikembalikan.

Regresi: vitest 282/282, `test:hosted:opname` 11/11,
`test:hosted:opname:staff-b` 8/8.

## C4 — Rate limit login: aktif, tanpa setelan yang bisa diubah

Ternyata tidak ada yang perlu dinyalakan. Rate limit login Supabase Auth sudah
aktif sebagai default, dan setelannya **tidak terbaca lewat CLI**:
`supabase config pull` menarik 10 properti remote, `[auth.rate_limit]` tidak
ada di dalamnya. Nilai sebenarnya hanya tersedia lewat Management API
`GET /v1/projects/{ref}/config/auth`, yang butuh personal access token — token
itu tidak ada di mesin ini (CLI memakai keyring Windows) dan sengaja tidak
dikejar demi satu angka yang bisa dibuktikan dari perilaku.

Pembuktian dari perilaku, bukan dari setelan:

- 60 login gagal beruntun ke alamat yang tidak ada: `400` ×30, lalu **`429`**
  pada percobaan ke-31. Cocok dengan bucket kapasitas 30 yang terisi ulang 30
  per 5 menit.
- Login staf B yang sah **tetap `200`** walau bucket baru saja habis, dan pulih
  dalam hitungan detik. Ini yang penting: batas ini menolak percobaan
  berikutnya, bukan mengunci kredensial yang benar.

`describeSignInError` di `app/stores/auth.ts` diekspor agar bisa diuji, dan
`tests/auth-errors.test.ts` (6 pemeriksaan) mengunci terjemahan pesan: `429`
tidak boleh muncul sebagai "kata sandi salah", karena itu membuat kasir
mengulang lebih keras justru saat ia harus berhenti. Tes diuji balik dengan
mematikan cabang rate limit — 2 tes jatuh, lalu hijau setelah dikembalikan.

Regresi: vitest 288/288 (22 file), typecheck bersih.

## C2 — Audit akun: rencana awal ternyata berbahaya

C2 semula berbunyi "hapus akun `phase*`". Sebelum mengeksekusi, saya audit
read-only (`scripts/account-audit.mjs`). Hasilnya membatalkan rencana itu:

- **Preview tidak punya akun nyata sama sekali.** Keenam akun adalah artefak
  uji, termasuk satu-satunya `owner`. Menghapus semuanya = mencabut seluruh
  akses login, termasuk akun yang dipakai semua skrip verifikasi.
- **Akun uji adalah pelaku 4.539 baris `audit_logs`.** `actor_id` memakai
  `on delete set null`, dan `audit_logs_immutable` melarang `update`/`delete`.
  Menghapus profil akan mengosongkan pelaku di seluruh riwayat, permanen dan
  tidak bisa diperbaiki — persis larangan "jangan hapus riwayat".

Yang aman dan sudah memenuhi kriteria: **0 dari 48 fixture `TEST-*`/`HOST-*`
aktif**. Skrip smoke memang menonaktifkan fixture di akhir dan memverifikasi
riwayatnya tetap ada.

Keputusan: penghapusan akun **tidak dijalankan di preview**. Kebutuhannya
dipindahkan ke `D3a` — produksi harus mulai dari database kosong, bukan salinan
preview, sehingga akun dan riwayat uji ini tidak pernah ikut.

Catatan proses: versi pertama `account-audit.mjs` melaporkan "1.000 baris audit"
karena PostgREST membatasi satu response ke 1.000 baris. Angka itu under-report
diam-diam pada justru metrik yang menentukan boleh-tidaknya hapus akun. Sudah
diperbaiki dengan paginasi; angka benar 4.539 baris, 4 akun sebagai pelaku.

Regresi: vitest 288/288, typecheck bersih.

## C5 — Migrasi terbukti reproducible; backup terkelola tidak ada

C5 menuntut "restore ke project uji menghasilkan 23/23 migrasi + data utuh".
Bagian migrasi bisa dibuktikan di mesin ini; bagian restore tidak.

### Yang terbukti

`npm run db:replay` (`scripts/migration-replay.mjs`) memutar ke-23 migrasi ke
PostgreSQL 18.6 bersih lewat PGlite — build WASM dari mesin Postgres yang sama,
tanpa Docker. Objek platform yang disediakan Supabase (role `anon`,
`authenticated`, `service_role`, skema `auth`, `auth.uid()`) dibuat lebih dulu;
kalau daftar bootstrap itu kurang, migrasi gagal keras di sini, bukan di produksi.

Hasil: **23/23 migrasi, 9/9 pemeriksaan lulus** — 24 tabel, RLS aktif di
semuanya, 38 fungsi `private`, `anon` tidak bisa mengeksekusi satu pun, trigger
`audit_logs_immutable` terpasang, `units_of_measure` terisi 8 baris, dan database
baru **nol produk, nol profil**.

Dua kegagalan nyata yang ditemukan dan diperbaiki selama penulisan:
`pg_trgm` harus didaftarkan sebagai modul PGlite (bukan tersedia otomatis), dan
`auth.users` perlu kolom `raw_user_meta_data` yang dipakai provisioning profil.
Keduanya persis jenis perbedaan yang membuat replay berguna.

Skrip diuji balik: satu baris SQL rusak disisipkan ke migrasi ke-2 → 2 migrasi
gagal dan exit code 1. Migrasi asli dipulihkan, `git diff` bersih, 23/23 lagi.

Koreksi asumsi: `categories` **tidak** di-seed migrasi (hanya
`units_of_measure`); kategori dibuat owner lewat aplikasi. Pemeriksaan diubah
menjadi menegaskan `categories` tetap kosong, yang sekaligus menangkap migrasi
yang keliru membawa data katalog demo.

### Yang tidak terbukti, dan kenapa

`supabase backups list --project-ref ptbllrugrjepdhhdkzxn`:

```
REGION                     | WALG | PITR  | EARLIEST TIMESTAMP | LATEST TIMESTAMP
Southeast Asia (Singapore) | true | false | 0                  | 0
```

`WALG: true` tetapi **`PITR: false`** dan tidak ada titik pulih sama sekali.
Dokumentasi Supabase: backup harian hanya untuk paket Pro ke atas; paket gratis
disarankan melakukan dump logis sendiri. Jadi restore tidak bisa diuji karena
**tidak ada backup untuk direstore**.

`supabase db dump --linked` juga tidak bisa dipakai: ia memerlukan Docker, gagal
dengan `docker: command not found`, namun tetap membuat file output **0 byte**
dan exit code 0. Kegagalan diam-diam ini berbahaya kalau outputnya dipercaya
sebagai backup. Tidak ada `pg_dump`/`psql` di mesin ini, jadi dump manual juga
tertutup.

### Konsekuensi

Selama produksi berjalan di paket yang sama, **tidak akan ada backup otomatis**.
Untuk data penjualan itu risiko nyata dan harus diputuskan sebelum go-live:
naik ke paket Pro (backup harian 7 hari) atau menjalankan dump logis terjadwal
dari mesin yang punya Docker.

Yang tetap menguntungkan: `db:replay` membuktikan skema produksi bisa dibangun
ulang dari repo. Itu jaminan yang lebih penting daripada satu database hidup,
dan sekarang bisa dijalankan siapa pun tanpa Docker.

Regresi: vitest 288/288, typecheck bersih.

## 4 November 2026 — Tahap 1 repo: CI, replay bersih, dokumen jujur

### Lingkup

Lima butir perbaikan repo yang tidak butuh frasa gate owner. Tidak ada
perubahan skema, tidak ada tes hosted, tidak ada sentuhan ke produksi.

### File dibuat

| File | Isi |
| --- | --- |
| `.github/workflows/ci.yml` | 9 langkah, tanpa `secrets.` dan tanpa tes hosted |
| `docs/24-production-cutover-runbook.md` | Runbook D1–D6 + D1a/D1b, prosedur akun, prosedur kata sandi, keputusan backup |
| `scripts/import-review-resolve.mjs` | Penyelesaian baris review lewat sesi owner: baca sisa review, panggil RPC, impor baris, tutup run |

### File dimodifikasi

| File | Perubahan |
| --- | --- |
| `scripts/migration-replay.mjs` | Impor `@electric-sql/pglite` + `/contrib/pg_trgm` dari paket, bukan `.tmp/pgtool/` |
| `vitest.config.ts` | Kecualikan `**/.tmp/**` supaya clone uji tidak dipindai Vitest |
| `docs/16-security-uat.md` | 101 tes DB, 288 unit/22 berkas, baris `db:replay`, CSP/HSTS aktif, rate limit terbukti |
| `docs/17-users-audit.md` | Prosedur tambah staf: `is_active=false`, Auto Confirm, `activated_at` |
| `docs/23-go-live-roadmap.md` | C1 dikoreksi, D1a/D1b ditambah, D4 1.360+1 review + `npm run import:review`, §8 diperluas |
| `docs/06-product-master-import.md` | §13 menjelaskan RPC tidak bisa dari SQL Editor + alur skrip yang benar |
| `package.json` | Script `import:review` |

### Perintah yang dijalankan

| Perintah | Hasil |
| --- | --- |
| `npm run db:replay` | 23/23 migrasi, 9/9 invarian, exit 0 |
| Uji balik SQL rusak | `99999999999999_zz_broken_probe.sql` → 23/24, exit **1**; berkas dihapus, direktori kembali 23 |
| `npm run typecheck` | exit 0 |
| `npm test` | 288/288, 22 berkas, exit 0 |
| `npm run test:db` | 101/101, exit 0 |
| `npm run build` | 1,92 MB (474 kB gzip), exit 0 |
| `npm run audit:bundle` | 151 berkas, 0 temuan |
| Rantai CI di `.tmp/clean-clone` | clone bersih → `npm ci` → 7 perintah, semuanya exit 0 |

### Temuan

`npm test` sempat gagal 3 berkas (576 tes lulus, 3 suite error) karena Vitest
memindai `.tmp/clean-clone/e2e/*.spec.mjs` — berkas Playwright, bukan Vitest.
Diperbaiki dengan menambah `**/.tmp/**` ke `exclude`; setelah itu 22 berkas /
288 tes, sama seperti yang diklaim dokumen. Tanpa perbaikan ini CI akan merah
begitu ada clone uji di dalam repo.

Angka impor yang beredar perlu dibedakan: satu kali `--apply` menghasilkan
**1.360 imported + 1 review** (`WAL-W1303`), bukan 1.361/1.361. Angka 1.361
adalah hasil akhir setelah review diselesaikan lewat
`resolve_product_import_review`. `docs/23` D4 dan `docs/24` §6.3 sudah dikoreksi.

`disable_signup` di preview tetap `true` dan probe `POST /auth/v1/signup`
menjawab `422 signup_disabled`, sementara `supabase config diff` masih melaporkan
`auth.email.enable_signup` remote `true`. Keduanya toggle berbeda; `config push`
penuh tetap dilarang karena akan menimpa `site_url` ke `127.0.0.1`.

Dua cacat ditemukan saat menulis ulang `docs/24` §6.4, keduanya akan
menggagalkan cutover bila diikuti apa adanya:

1. `resolve_product_import_review` tidak bisa dipanggil dari SQL Editor. Fungsi
   memakai `private.require_active_role` → `auth.uid()`; di SQL Editor nilainya
   `NULL` sehingga hasilnya `AUTH_REQUIRED`. Pemanggilan harus lewat sesi owner
   dengan publishable key.
2. `product-import.mjs --apply` **bukan** cara menutup baris review. Skrip itu
   men-staging ulang seluruh workbook, dan `stage_product_import_rows` menimpa
   baris yang `product_id`-nya masih `NULL`. Koreksi harga owner akan kembali
   menjadi `review` dan run tidak pernah selesai.

Karena itu ditambahkan `scripts/import-review-resolve.mjs` (`npm run
import:review`): mode tanpa argumen membaca sisa baris review, mode berargumen
memanggil RPC, mengimpor baris itu lewat `import_product_import_row`, lalu
menutup run dengan `finish_product_import` bila tidak ada sisa `ready`.
Diverifikasi di preview: login owner dikenali, target URL dicek, dan percobaan
ulang pada baris 1305 yang sudah diimpor ditolak `ROW_ALREADY_IMPORTED` — bukti
RPC benar-benar berjalan dengan `auth.uid()` terisi.

### Status

Tahap 1 (repo) selesai dan sudah di-commit (`2ae64c8`) serta di-push ke
`origin/main`. Tahap 2 selesai: owner menjawab empat butir pada 4 November 2026.

| Butir | Keputusan owner |
| --- | --- |
| a | Latihan opname kecil di preview dulu, baru hitung penuh di produksi |
| b | Backup produksi pakai paket berbayar (backup harian otomatis), bukan dump terjadwal |
| c | Ganti kata sandi lewat dashboard Supabase; tidak ada halaman in-app |
| d | Isi nota tetap seperti sekarang |

Keputusan b mengubah D1a: pilihan tertulis sudah ada, tetapi kriteria lulusnya
belum — satu restore ke project uji masih harus dibuktikan sebelum D5. Tahap 3
(gate Phase 5F) dan Tahap 4 (produksi) belum dimulai.

### Persiapan Tahap 3 (read-only)

Cakupan latihan A2 sudah dipilih: kategori `PERABOTAN MANGKUK` (id 131), 18
produk, semuanya aktif, semuanya berstok `NULL`, satu di antaranya
(`PER-M1144`) tanpa `sale_price`.

Ditemukan satu batasan yang mengubah rencana konflik versi: `complete_sale` dan
`adjust_stock` menolak produk berstok `NULL` dengan `STOCK_UNKNOWN`, jadi
`stock_version` tidak bisa dinaikkan sebelum ada saldo. Konflik versi karena itu
dipicu pada sesi **kedua** atas kategori yang sama, setelah sesi pertama
menetapkan saldo awal. `docs/22` §5.0 dan §5.3 sudah diperbarui; tidak ada baris
database yang ditulis.
