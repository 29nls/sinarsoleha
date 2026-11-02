# Implementasi Database — Fase 2

**Status: PARTIALLY COMPLETED.**
Migrasi, RLS, RPC katalog, provisioning profil, dan audit telah diimplementasikan dan dieksekusi terhadap PostgreSQL 18.6 lokal (PGlite). **Belum diterapkan ke project Supabase hosted**, dan login/PostgREST/GoTrue belum diuji terhadap backend nyata. Kriteria keluar Fase 2 mensyaratkan apply ke database disposable/preview dan uji Auth; karena itu fase ini tidak dilaporkan sebagai selesai penuh.

## 1. Migrasi

Semua file berada di `supabase/migrations/` dan dijalankan berurutan. Starter SQL di `supabase/supabase_schema_pos_toko_sinar_soleha.sql` tetap menjadi referensi dan **tidak** diterapkan apa adanya.

| File | Isi |
| --- | --- |
| `20261102090000_extensions_and_helpers.sql` | schema `extensions`/`private`, `pg_trgm`, `set_updated_at`, revoke default privileges |
| `20261102090100_reference_data.sql` | `categories`, `units_of_measure`, seed 8 satuan |
| `20261102090200_profiles_and_provisioning.sql` | `profiles`, trigger `auth.users`, backfill user lama, `has_role`, `require_active_role` |
| `20261102090300_catalog.sql` | `products` (SKU case-insensitive), biaya, alias, tier, `product_data_issues`, `customers` |
| `20261102090400_sales.sql` | transaksi, item, pembayaran, deferred balance trigger, `document_counters` |
| `20261102090500_inventory.sql` | opname + status item, ledger immutable, discrepancy berversi |
| `20261102090600_legacy_import.sql` | run, header mentah, item mentah, confidence, match status |
| `20261102090700_settings_audit.sql` | feature flags, audit log, indeks, audit writer |
| `20261102090800_rls_policies.sql` | RLS 22 tabel, grant least privilege, 23 policy |
| `20261102090900_rpc_catalog.sql` | `upsert_product`, `set_product_cost` |
| `20261102091000_rpc_admin.sql` | aktivasi/role user, bootstrap owner, feature flag RPC |

## 2. Objek Database

- **22 tabel** di schema `public`; seluruhnya RLS aktif.
- **23 policy**: self/owner untuk profil; baca katalog untuk staf aktif; biaya hanya owner; transaksi hanya kasir pemilik atau owner; inventaris hanya owner/staf gudang; staging legacy dan audit hanya owner.
- **19 fungsi `private`**: helper peran, provisioning, nomor dokumen, pengecekan pembayaran, guard opname/ledger/audit, katalog, admin.
- **4 wrapper `public`** untuk PostgREST: `upsert_product`, `set_product_cost`, `admin_upsert_profile`, `set_feature_flag`.
- **Trigger**: `updated_at`, provisioning `auth.users`, deferred payment balance, transisi & immutability opname, immutability ledger/audit.
- **Tidak ada** grant tabel untuk `anon`; `document_counters` tidak punya grant/policy sama sekali.

### Aturan keamanan yang diterapkan

- `SECURITY DEFINER` selalu `set search_path = ''` dan memakai nama tabel fully qualified.
- `require_active_role` memeriksa `auth.uid()`, `profiles.is_active`, dan `profiles.role`; bukan `user_metadata`.
- Katalog RPC tidak pernah membaca atau menulis `stock_on_hand`/`stock_version`.
- `stock_movements` menolak UPDATE/DELETE; koreksi harus movement baru.
- Pembayaran diperiksa saat COMMIT: Σ `amount_applied` (confirmed) = `grand_total`.
- SKU memakai `sku_normalized = upper(btrim(sku))` yang unik; spasi di tepi ditolak.
- Nomor nota `SS-YYYYMMDD-NNNN` berasal dari `document_counters` dengan row lock.
- Default privileges mencabut akses `anon`/`authenticated` untuk tabel, sequence, dan function baru.
- `service_role` tidak pernah dipetakan ke `runtimeConfig.public` dan tidak ada di source aplikasi.

## 3. Provisioning dan Bootstrap Owner

1. Public sign-up dimatikan: `supabase/config.toml` → `[auth] enable_signup = false` dan `[auth.email] enable_signup = false`. Di project hosted, pastikan juga **Authentication → Providers → Email → Enable sign-ups = OFF**; config lokal tidak mengubah project hosted.
2. Owner membuat user lewat Dashboard/Auth Admin API. Trigger `on_auth_user_created` membuat profil `cashier` dengan `is_active = false` dan `full_name` dari metadata/email. Metadata tidak pernah menentukan role.
3. Owner pertama dipilih sekali lewat SQL editor (bukan route aplikasi):

```sql
select private.bootstrap_owner('<auth-user-uuid>');
```

Fungsi menolak jika sudah ada owner aktif, menulis audit, dan tidak memberikan EXECUTE kepada `anon`/`authenticated`.
4. Aktivasi/role berikutnya lewat RPC owner:

```sql
select public.admin_upsert_profile('<uuid>', 'Nama Lengkap', 'cashier', true);
```

Fungsi menolak menonaktifkan/menurunkan owner aktif terakhir. Offboarding = `is_active = false`; jangan menghapus `auth.users` karena FK transaksi bersifat restrict (DB-17).

## 4. Pengujian yang Dieksekusi

Perintah: `npm run test:db` — PGlite PostgreSQL 18.6, in-process, tanpa Docker.

Hasil terakhir: **20/20 lulus** (exit 0), setelah 11 migrasi diterapkan bersih.

Cakupan: anon ditolak; user tanpa profil ditolak; akun nonaktif ditolak tetapi dapat membaca profilnya sendiri; kasir tidak dapat membuat/mengubah produk atau stok; staf gudang tidak dapat menaikkan role; owner mengelola produk lewat RPC tanpa mengubah stok; `user_metadata` tidak menaikkan privilege; aritmetika ledger; pembayaran tidak balance ditolak saat COMMIT; SKU case/space; opname posted tidak dapat diubah; nomor dokumen berurutan; provisioning; bootstrap owner; aktivasi user + last-owner guard; feature flag; biaya hanya owner; default privilege; audit append-only.

File: `scripts/db-test.mjs`, `supabase/tests/local_bootstrap.sql`, `supabase/tests/README.md`.

### Yang belum diuji

- PostgREST, GoTrue, JWT nyata, dan alur login end-to-end (butuh project Supabase).
- Uji multi-sesi/konkurensi nyata (PGlite satu koneksi); row lock `document_counters` belum diuji paralel.
- Realtime Broadcast hosted (DB-16).
- Apply migrasi ke project hosted/preview.

## 5. Status Temuan DB-01…DB-17

| ID | Status | Bukti / catatan |
| --- | --- | --- |
| DB-01 | Selesai | `public.upsert_product` + `set_product_cost`, owner-only, stok tidak disentuh |
| DB-02 | Selesai | trigger provisioning + `bootstrap_owner` + `admin_upsert_profile` |
| DB-03 | Parsial (sesuai lingkup) | kontrak `complete_sale`, `void_sale`, `post_stock_opname`, `adjust_stock` di `docs/04-rpc-contracts.md`; implementasi di Fase 4/5 |
| DB-04 | Selesai | trigger `updated_at` pada tabel yang memilikinya |
| DB-05 | Selesai | constraint trigger deferred pada `payments` dan `transactions` |
| DB-06 | Selesai | CHECK aritmetika + aturan referensi per `movement_type` |
| DB-07 | Selesai | `sku_normalized` unik + CHECK tanpa spasi tepi |
| DB-08 | Selesai | `product_data_issues` multi-baris per produk |
| DB-09 | Selesai (schema) | `legacy_import_runs`, header/item mentah, confidence, match status; pipeline impor belum |
| DB-10 | Selesai | `document_counters` + `next_document_number` dengan row lock |
| DB-11 | Sebagian | `count_status`, transisi status, immutability posted/cancelled; riwayat hitung per item belum berupa tabel tersendiri |
| DB-12 | Selesai | CHECK 8 nilai reason code di opname, discrepancy, movement |
| DB-13 | Selesai | `alter default privileges` + revoke eksplisit |
| DB-14 | Selesai | indeks entity, created_at, actor |
| DB-15 | Selesai | `stock_movements.actor_id NOT NULL` |
| DB-16 | Ditunda | Realtime Broadcast memerlukan project hosted dan mutasi stok Fase 5; kontrak payload ada di ADR-009 |
| DB-17 | Terdokumentasi | offboarding lewat `is_active = false`; tidak ada tombol hapus user |

## 6. Langkah Apply ke Hosted (Belum Dieksekusi)

Gunakan project **disposable/preview**, bukan produksi:

```bash
npx supabase link --project-ref <preview-ref>
npx supabase db push
npx supabase gen types typescript --linked > types/database.generated.ts
```

Setelah apply: uji login owner/kasir/gudang, RLS allow/deny, provisioning user baru, RPC katalog, dan constraint pembayaran. Jangan menjalankan `db push` ke produksi tanpa persetujuan owner dan backup.

## 7. Batasan Teknis

- Tipe hasil generate menampilkan `profiles.role` sebagai `string`; aplikasi mempersempitnya dengan `isRole()` di store, bukan cast buta.
- `types/database.generated.ts` dihasilkan dari schema lokal; regenerasi setelah setiap migrasi.
- PGlite adalah PostgreSQL asli, tetapi bukan Supabase: perbedaan perilaku PostgREST/GoTrue/Realtime tetap harus diuji di project hosted.
