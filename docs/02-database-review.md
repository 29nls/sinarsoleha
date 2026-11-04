# Review Database — Starter Schema

**File yang direview:** `supabase/supabase_schema_pos_toko_sinar_soleha.sql` (22.182 byte)
**Kesimpulan:** struktur relasional baik dan sesuai PRD, tetapi **belum layak produksi**. Starter ini adalah referensi, bukan migration. Jangan dijalankan apa adanya.

## 1. Yang Sudah Benar

- UUID untuk entitas bisnis, identity untuk ledger/log.
- `numeric(14,2)` uang dan `numeric(14,3)` kuantitas.
- `stock_on_hand` nullable — stok tidak diketahui tidak dipaksa nol.
- `product_costs` dipisah agar kasir tidak menerima harga beli.
- `stock_movements` append-only dengan `quantity_before/after`.
- `stock_version` untuk optimistic lock opname.
- Snapshot SKU/nama/satuan/harga pada `transaction_items`.
- `idempotency_key` unik pada transaksi.
- RLS aktif pada 17 tabel dan grant dimulai dari least privilege.
- `private.has_role` memakai `security definer` + `search_path = ''`.

## 2. Temuan

### P0 — memblokir modul berikutnya

**DB-01. Katalog tidak dapat dikelola lewat API.**
`products` hanya punya grant SELECT; tidak ada grant INSERT/UPDATE/DELETE dan tidak ada RPC. Owner tidak bisa membuat atau mengubah produk.
*Perbaikan:* RPC `private.upsert_product(...)` (owner) yang memvalidasi unit/kategori/harga/SKU, menulis audit log, dan tidak menyentuh `stock_on_hand`. Alternatif: grant kolom terbatas untuk owner + policy. Keputusan: RPC, agar validasi konsisten.

**DB-02. User Auth baru tidak memiliki profil.**
Tidak ada trigger pada `auth.users` dan tidak ada policy INSERT `profiles`. Setiap user baru gagal di `private.has_role`, sehingga semua policy menolak.
*Perbaikan:* trigger `auth.users` → insert `profiles` dengan role default `cashier` dan `is_active=false` (wajib diaktifkan owner), atau fungsi admin `private.provision_user`. Jangan izinkan sign-up publik.

**DB-03. Belum ada RPC mutasi.** (sebagian selesai)
Saat audit, `complete_sale`, `void_sale`, `post_stock_opname`, `adjust_stock`, dan `provision_profile` belum ada.
*Perbaikan:* `complete_sale`/`void_sale` selesai Phase 4A, `post_stock_opname` selesai Phase 5A, dan `adjust_stock` selesai Phase 11 — semuanya dengan lock, validasi, ledger, dan audit. Status rinci ada di `docs/03-database-implementation.md` §5.

### P1 — harus diperbaiki sebelum migrasi di-freeze

**DB-04. `updated_at` tidak pernah berubah.**
Tidak ada trigger. Semua tabel dengan `updated_at` akan menampilkan waktu pembuatan.
*Perbaikan:* satu fungsi `private.set_updated_at()` + trigger per tabel.

**DB-05. Total pembayaran tidak dijamin sama dengan total nota.**
Constraint hanya per baris payment. Nota bisa tersimpan dengan pembayaran kurang/lebih.
*Perbaikan:* `CONSTRAINT TRIGGER` deferred pada `payments`/`transactions` yang memeriksa Σ`amount_applied` = `grand_total` saat commit, plus validasi di RPC. Deferred diperlukan karena payment diinsert setelah header.

**DB-06. Ledger tidak menjaga aritmetika.**
Tidak ada check `quantity_before + quantity_delta = quantity_after`; movement tanpa referensi transaksi/opname diperbolehkan untuk semua tipe.
*Perbaikan:* CHECK aritmetika (kecuali `quantity_before` NULL), dan aturan tipe:
- `sale_out`, `void_reversal` → `transaction_id` wajib
- `opname_adjustment`, `opening_balance` → `stock_opname_id` wajib
- `manual_adjustment` → `reason_code` + `reason_note` wajib

**DB-07. SKU case-sensitive.**
`unique (sku)` mengizinkan `ELE-K001` dan `ele-k001`.
*Perbaikan:* `unique (upper(btrim(sku)))` atau kolom `sku_normalized` generated + unique. Snapshot nota tetap memakai SKU asli.

**DB-08. Satu kolom status tidak cukup untuk banyak masalah data.**
`import_review_status` hanya satu nilai, padahal satu SKU bisa tanpa stok, tanpa harga, dan negatif sekaligus.
*Perbaikan:* tabel `product_data_issues(product_id, issue_code, detail, resolved_at, resolved_by)` dengan unique `(product_id, issue_code)`, atau flag boolean terpisah. `import_review_status` dipertahankan sebagai ringkasan.

**DB-09. Tidak ada staging impor legacy.**
PRD §12 membutuhkan staging header/baris, confidence, dan status review. Saat ini hanya `legacy_transaction_id` di tabel final.
*Perbaikan:* `legacy_transactions_raw`, `legacy_transaction_items_raw` (string asli, hasil parse, kandidat SKU, confidence, match_status, reviewer), dan `legacy_import_runs` (file hash, waktu, pelaku).

**DB-10. Penomoran nota tidak aman.**
Tidak ada sequence/counter. Generator di aplikasi akan bentrok saat dua kasir checkout bersamaan.
*Perbaikan:* tabel `document_counters(scope, business_date, last_value)` + `SELECT ... FOR UPDATE` di dalam RPC, atau sequence per hari. Format `SS-YYYYMMDD-NNNN`.

**DB-11. Opname tidak punya status per item dan tidak immutable setelah posted.**
Kegagalan versi hanya berarti "posting ditolak", tetapi tidak ada cara menandai item mana yang perlu recount. `stock_opname_items` juga dapat diubah setelah sesi posted.
*Perbaikan:* kolom `count_status` (`pending`, `counted`, `needs_recount`, `posted`), riwayat hitung di tabel terpisah atau audit, dan trigger yang menolak perubahan item/sesi saat `posted`/`cancelled`.

**DB-12. `reason_code` tidak dibatasi.**
Nilai bebas pada opname dan discrepancy; typo akan lolos.
*Perbaikan:* CHECK sesuai daftar PRD: `broken_damaged`, `missing`, `input_error`, `unrecorded_out`, `unrecorded_in`, `unit_conversion`, `opening_balance`, `other`.

**DB-13. Risiko default privileges Supabase.**
`revoke all on all tables` hanya berlaku untuk tabel yang sudah ada. Tabel baru di migrasi berikutnya dapat mewarisi grant default ke `anon`/`authenticated`.
*Perbaikan:* `alter default privileges ... revoke ...` dan revoke eksplisit di setiap migrasi; aktifkan RLS sebelum grant.

### P2 — perbaikan sebelum go-live

**DB-14. Indeks audit kurang.** Tambah `audit_logs(entity_name, entity_id)`, `audit_logs(created_at desc)`, `audit_logs(actor_id, created_at desc)`.

**DB-15. `stock_movements.actor_id` nullable.** Mutasi tanpa pelaku tidak dapat diaudit. Jadikan NOT NULL untuk movement baru; nilai NULL hanya diizinkan untuk backfill migrasi.

**DB-16. Realtime belum ada.** *Selesai di kode:* trigger `products_broadcast_stock` memanggil `realtime.send` ke topic `store:stock` (private) setelah update `products.stock_on_hand`/`stock_version`, payload `{product_id, sku, stock_on_hand, stock_version}`, plus policy `realtime.messages` untuk `authenticated`. Migrasi `20261105100000_stock_broadcast.sql` sudah diterapkan ke preview (4 November 2026) dan Broadcast privat terverifikasi hosted — lihat `docs/18-realtime-stock.md`.

**DB-17. Delete user Auth gagal.** `profiles` direferensikan `on delete restrict` oleh transaksi. Offboarding harus `is_active=false`; dokumentasikan dan jangan sediakan tombol hapus user.

### Catatan tambahan

- `stock_opname_items.difference_qty` generated dari `physical_qty - system_qty_snapshot`; untuk snapshot NULL hasilnya NULL (benar), tetapi jangan membuat discrepancy log dengan `system_qty` NULL.
- `stock_discrepancy_logs.stock_opname_item_id` unik permanen; jika item dihitung ulang setelah ditolak, log lama harus tetap ada. Pertimbangkan unique `(stock_opname_item_id, revision)`.
- `transactions` tidak punya kolom `total_paid`/`change_due` agregat. Tidak wajib, tetapi mempermudah rekonsiliasi laporan.
- `payments` check `cash_received >= amount_applied` mengasumsikan kembalian hanya pada komponen tunai. Aturan split perlu dikonfirmasi owner; default: kembalian dihitung dari komponen tunai saja.
- `product_price_tiers` belum dipakai; biarkan tidak aktif sampai owner menyetujui aturan grosir.
- `stock_opnames` belum punya `cancelled_at/by/reason`.
- `transaction_items.line_subtotal` perlu definisi tegas: `quantity × unit_price` sebelum diskon baris; `line_total = line_subtotal − line_discount_amount`. MVP tidak memakai diskon baris.

## 3. Rencana Migrasi (Phase 2)

> **Realisasi:** Fase 2 memakai 11 migrasi timestamp, dan Phase 3A menambahkan 1 migrasi RPC kategori (12 total) di `supabase/migrations/`; RPC penjualan/opname ditunda ke Fase 4/5 dengan kontrak di `docs/04-rpc-contracts.md`. Detail di `docs/03-database-implementation.md`.

Urutan yang menghindari dependensi mundur:

1. `0001_extensions_and_helpers.sql` — schema `private`, `set_updated_at`, `has_role`, revoke default privileges.
2. `0002_reference_data.sql` — categories, units, seed 8 satuan.
3. `0003_profiles_and_provisioning.sql` — profiles, trigger auth.users, kebijakan aktivasi owner.
4. `0004_catalog.sql` — products (SKU case-insensitive, issues), costs, aliases, price tiers.
5. `0005_sales.sql` — transactions, items, payments, deferred balance trigger, document counters.
6. `0006_inventory.sql` — stock_opnames (+status item), stock_movements (checks), discrepancy logs.
7. `0007_legacy_import.sql` — staging, runs, mapping.
8. `0008_settings_audit.sql` — feature flags, audit logs + indeks.
9. `0009_rls_policies.sql` — grant + policy per peran.
10. `0010_rpc_sale.sql`, `0011_rpc_opname.sql`, `0012_rpc_catalog.sql` — RPC `SECURITY DEFINER`.

Setiap file: transaksional, idempotent bila memungkinkan, dan diakhiri revoke eksplisit untuk tabel baru.

## 4. Rencana Pengujian Database

Dijalankan lokal dengan PGlite (PostgreSQL 18.6): 22/22 lulus setelah migrasi kategori. Preview hosted juga tervalidasi 22/22 (Auth/RLS/RPC/katalog) pada 2 November 2026; pengujian checkout/opname menunggu Fase 4/5. Produksi belum diterapkan:

1. **RLS allow/deny** per peran untuk SELECT/INSERT/UPDATE/DELETE pada setiap tabel terekspos.
2. **Profil nonaktif** ditolak semua operasi.
3. **Checkout**: stok kurang, harga NULL, produk nonaktif, diskon melebihi limit, payment tidak balance, idempotency ganda.
4. **Konkurensi**: dua checkout SKU sama bersamaan → satu sukses, satu gagal bersih.
5. **Opname**: versi basi ditolak; selisih tanpa alasan ditolak; posting ganda ditolak.
6. **Rekonsiliasi**: saldo = opening + Σ movement; Σ payment = grand_total untuk semua nota.
7. **Impor**: SKU duplikat ditolak; 245 stok NULL tetap NULL; 37 negatif tersimpan dengan flag.
