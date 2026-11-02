# Implementasi Database

**Status: Phase 2 COMPLETED untuk preview hosted; Phase 3A katalog selesai untuk preview (2 November 2026).**
Seluruh 11 migrasi Phase 2 dan 1 migrasi kategori Phase 3A telah diverifikasi terhadap project preview `ptbllrugrjepdhhdkzxn` (PostgreSQL 17.11). Auth nyata, PostgREST, RLS per peran, RPC katalog/admin/kategori, audit, dan locking nomor nota telah diuji. **Produksi belum diterapkan**; beberapa prasyarat konfigurasi produksi masih terbuka dan dicatat di bagian 7.

## 1. Migrasi

Semua file berada di `supabase/migrations/` dan dijalankan berurutan. Starter SQL di `supabase/supabase_schema_pos_toko_sinar_soleha.sql` tetap referensi dan **tidak** diterapkan apa adanya.

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
| `20261102091100_rpc_category.sql` | `upsert_category` owner-only, validasi duplikat, audit, tanpa hard delete |

### Bukti schema hosted

Schema Phase 2 sudah ada di preview sebelum Phase 2B karena diterapkan lewat SQL Editor, sehingga `supabase_migrations.schema_migrations` belum ada. Setelah schema dibandingkan dengan hasil 11 migrasi lokal, migrasi kategori Phase 3A ditambahkan dan diuji:

| Objek | Hasil |
| --- | --- |
| Tabel / kolom | 22 tabel, 223 kolom; hash tabel+kolom identik |
| Policy | 23; hash policy identik |
| Trigger | 17 trigger publik; hash identik |
| Fungsi | Phase 2: 23 signature (`19 private` + `4 public`); Phase 3A menambah 2 signature kategori |
| Constraint | 158 (79 CHECK, 40 FK, 22 PK, 15 UNIQUE, 2 constraint trigger); selisih hitungan lokal murni karena PostgreSQL 18 mencatat 139 NOT NULL sebagai constraint |
| Index | 59; nama dan jumlah sama |

Riwayat migrasi kemudian dibuat dengan format resmi CLI (`version`, `statements`, `name`) dan diisi 11 versi Phase 2. Versi `20261102091100` ditambahkan untuk RPC kategori Phase 3A; `list_migrations` menampilkan 12 entri yang konsisten. Perbaikan Phase 2 **tidak** menjalankan ulang SQL; schema sudah identik dan telah diverifikasi sebelum repair. `db push` tidak dijalankan karena CLI tidak memiliki access token/DB password pada sesi ini; migrasi kategori diterapkan melalui SQL terkontrol dan dicatat di riwayat.

## 2. Objek Database

- **22 tabel** di schema `public`; seluruhnya RLS aktif.
- **23 policy**: self/owner untuk profil; baca katalog untuk staf aktif; biaya hanya owner; transaksi hanya kasir pemilik atau owner; inventaris hanya owner/staf gudang; staging legacy dan audit hanya owner.
- **20 fungsi `private`**: helper peran, provisioning, nomor dokumen, pengecekan pembayaran, guard opname/ledger/audit, katalog, admin, kategori.
- **5 wrapper `public`** untuk PostgREST: `upsert_product`, `set_product_cost`, `admin_upsert_profile`, `set_feature_flag`, `upsert_category`.
- **Trigger**: `updated_at`, provisioning `auth.users`, deferred payment balance, transisi & immutability opname, immutability ledger/audit.
- **Tidak ada** grant tabel untuk `anon`; `document_counters` tidak punya grant/policy sama sekali.

### Aturan keamanan yang diterapkan

- `SECURITY DEFINER` selalu `set search_path = ''` dan memakai nama tabel fully qualified.
- `require_active_role` memeriksa `auth.uid()`, `profiles.is_active`, dan `profiles.role`; bukan `user_metadata`.
- Katalog RPC tidak pernah membaca atau menulis `stock_on_hand`/`stock_version`; RPC kategori tidak melakukan hard delete.
- `stock_movements` menolak UPDATE/DELETE; koreksi harus movement baru.
- Pembayaran diperiksa saat COMMIT: Σ `amount_applied` (confirmed) = `grand_total`.
- SKU memakai `sku_normalized = upper(btrim(sku))` yang unik; spasi di tepi ditolak.
- Nomor nota `SS-YYYYMMDD-NNNN` berasal dari `document_counters` dengan row lock.
- Default privileges mencabut akses `anon`/`authenticated` untuk tabel, sequence, dan function baru.
- `service_role` tidak pernah dipetakan ke `runtimeConfig.public` dan tidak ada di source/bundle.

## 3. Provisioning dan Bootstrap Owner

1. Public sign-up **belum dimatikan di hosted**: `/auth/v1/settings` melaporkan `disable_signup: false`, `mailer_autoconfirm: false`. `supabase/config.toml` hanya berlaku untuk stack lokal. Sebelum produksi, matikan **Authentication → Providers → Email → Enable sign-ups**.
2. Trigger `on_auth_user_created` membuat profil `cashier` dengan `is_active = false`; `full_name` disalin dari metadata/email. Metadata tidak pernah menentukan role.
3. Owner pertama dipilih sekali lewat SQL:

```sql
select private.bootstrap_owner('<auth-user-uuid>');
```

Fungsi menolak jika sudah ada owner aktif, menulis audit, dan tidak memberikan EXECUTE kepada `anon`/`authenticated`.
4. Aktivasi/role berikutnya lewat RPC owner:

```sql
select public.admin_upsert_profile('<uuid>', 'Nama Lengkap', 'cashier', true);
```

Fungsi menolak menonaktifkan/menurunkan owner aktif terakhir. Offboarding = `is_active = false`; jangan menghapus `auth.users` karena FK transaksi bersifat restrict (DB-17).

### Akun uji Phase 2B

Percobaan signup publik gagal sebelum membuat user: domain `example.com` ditolak (`email_address_invalid`) dan permintaan berikutnya terkena `over_email_send_rate_limit`. Empat akun uji preview kemudian dibuat secara administratif melalui `auth.users` + `auth.identities` dengan bcrypt hash; trigger provisioning tetap diuji dan berjalan. Akun: owner, kasir, staf gudang (`inventory_staff`), dan nonaktif. Password hanya berada di `.tmp/phase2b-accounts.json` yang gitignored dan tidak pernah dicetak. Akun/tes data ini harus dihapus atau project preview di-reset sebelum produksi.

## 4. Pengujian yang Dieksekusi

### Lokal

Perintah: `npm run test:db` — PGlite PostgreSQL 18.6, in-process, tanpa Docker.
Hasil terakhir: **22/22 lulus**, setelah 12 migrasi diterapkan bersih.

Cakupan: anon ditolak; user tanpa profil/nonaktif ditolak; kasir tidak dapat menulis produk/stok; gudang tidak dapat menaikkan role; owner mengelola produk via RPC tanpa mengubah stok; harga `NULL` tetap `NULL`; duplikat SKU ditolak; owner mengelola kategori via RPC dengan proteksi duplikat dan audit; kasir tidak dapat memanggil RPC kategori; `user_metadata` tidak menaikkan privilege; aritmetika ledger; pembayaran harus balance saat COMMIT; SKU case/space; opname posted immutable; nomor dokumen berurutan; provisioning; bootstrap owner; aktivasi + last-owner; feature flag; biaya owner-only; default privilege; audit append-only.

### Hosted preview

Perintah: `npm run test:hosted` — Supabase JS dengan publishable key dan sesi user nyata; tanpa `service_role`.
Hasil: **22 passed, 0 failed, 1 skipped**.

| Area | Bukti |
| --- | --- |
| Anon | SELECT produk dan RPC katalog ditolak |
| Login owner | Sesi GoTrue nyata; profil owner aktif |
| Provisioning | Empat user membuat profil `cashier` nonaktif; metadata `role: owner` pada kasir tidak mengubah role |
| Bootstrap | `private.bootstrap_owner` mengaktifkan owner pertama |
| Aktivasi | Owner mengaktifkan kasir dan `inventory_staff` lewat `admin_upsert_profile` |
| Last owner | Owner terakhir tidak dapat dinonaktifkan |
| Katalog RPC | Create/update produk, biaya, feature flag berhasil; `stock_on_hand`/`stock_version` tidak berubah dari payload |
| Kategori RPC | Create/rename/activate/deactivate berhasil; duplikat nama ditolak; audit `category.create` tercatat |
| Query katalog | Join kategori/satuan dan pencarian SKU exact pada halaman `/products` berhasil |
| Validasi RPC | SKU kosong, unit/kategori tidak valid, dan nama kosong ditolak |
| Audit | `product.create` dan `product.update` tercatat |
| Kasir | Baca produk; biaya kosong; INSERT/UPDATE produk dan stok ditolak; RPC owner ditolak meski metadata berisi `owner` |
| Gudang | Baca produk; biaya kosong; update role sendiri ditolak; RPC owner ditolak |
| Nonaktif | Login Auth berhasil; profil sendiri terbaca; produk/biaya kosong; RPC ditolak |
| Auth | Password salah ditolak; refresh session, restore session, dan logout diuji |
| Expiry | **Tidak dieksekusi**; memerlukan penantian TTL atau token terkontrol |
| Concurrency | 4 request PostgREST paralel memakai wrapper sementara: nomor unik `SS-20991231-0017`–`0020`, waktu 1,3 / 2,3 / 3,3 / 4,3 detik; wrapper dan counter uji dihapus |
| Tipe | `generate_typescript_types` hosted berhasil; schema hosted identik dengan tipe yang ada |

### Build dan pemeriksaan lain

- `npm run typecheck` — exit 0
- `npm test` — 4 file, 28/28 lulus
- `npm run build` — exit 0
- `grep -rl "service_role" .output` — tidak ada hasil
- `git diff --check` — exit 0

## 4A. Phase 3A — Katalog

- Route `/products` memakai `catalog.read`; kasir dan gudang mendapat tampilan baca-saja. Aksi pengelolaan memakai `catalog.manage` (owner).
- Produk dibaca lewat PostgREST dengan join kategori/satuan, filter server-side, dan pagination 25/50/100. Harga beli dan `product_data_issues` hanya diminta untuk owner; RLS tetap menolak peran lain.
- Create/edit/nonaktifkan memakai `public.upsert_product(jsonb)`. Payload tidak memuat field stok. `import_review_status` dikirim kembali saat edit agar status review tidak ter-reset diam-diam.
- Harga beli memakai `public.set_product_cost(uuid, numeric)`; nilai `NULL` dipertahankan.
- Kategori memakai `public.upsert_category(jsonb)` dari migrasi `20261102091100_rpc_category.sql`: owner-only, `search_path = ''`, duplikat nama ditolak, audit `category.create`/`category.update`, dan tidak ada hard delete.
- Tes UI/unit: 4 file, 28/28; tes database 22/22; hosted 22/22 dengan 1 skip. Detail arsitektur ada di `docs/05-product-catalog.md`.
- Impor master 1.361 produk adalah Phase 3B dan belum dijalankan. Target pencarian P95 < 300 ms belum diukur pada dataset penuh.

## 5. Status Temuan DB-01…DB-17

| ID | Status | Bukti / catatan |
| --- | --- | --- |
| DB-01 | Selesai | `public.upsert_product` + `set_product_cost`, owner-only, stok tidak disentuh |
| DB-02 | Selesai | trigger provisioning + `bootstrap_owner` + `admin_upsert_profile` |
| DB-03 | Parsial (sesuai lingkup) | kontrak `complete_sale`, `void_sale`, `post_stock_opname`, `adjust_stock` di `docs/04-rpc-contracts.md`; implementasi Fase 4/5 |
| DB-04 | Selesai | trigger `updated_at` |
| DB-05 | Selesai | constraint trigger deferred pada `payments`/`transactions` |
| DB-06 | Selesai | CHECK aritmetika + aturan referensi movement |
| DB-07 | Selesai | `sku_normalized` unik + CHECK tanpa spasi tepi |
| DB-08 | Selesai | `product_data_issues` multi-baris |
| DB-09 | Selesai (schema) | staging legacy; pipeline impor belum |
| DB-10 | Selesai | `document_counters` + row lock; diuji lewat 4 request paralel |
| DB-11 | Sebagian | status/immutability ada; riwayat hitung per item belum tabel tersendiri |
| DB-12 | Selesai | CHECK 8 reason code |
| DB-13 | Selesai | `alter default privileges` + revoke eksplisit |
| DB-14 | Selesai | indeks entity/created_at/actor |
| DB-15 | Selesai | `stock_movements.actor_id NOT NULL` |
| DB-16 | Ditunda | Realtime Broadcast menunggu mutasi stok Fase 5 |
| DB-17 | Terdokumentasi | offboarding via `is_active = false` |

## 6. Apply ke Hosted

Schema preview sudah tervalidasi; **produksi belum**. Untuk produksi gunakan project terpisah dan backup:

```bash
npx supabase link --project-ref <production-ref>
npx supabase migration list --linked
npx supabase db push --dry-run
npx supabase db push
npx supabase gen types typescript --linked > types/database.generated.ts
```

Jangan menjalankan `db push` ke produksi tanpa persetujuan owner. CLI sesi ini tidak terautentikasi; repair riwayat preview dilakukan setelah verifikasi hash schema, bukan dengan mengulang SQL. Migrasi kategori Phase 3A sudah diterapkan ke preview dan dicatat sebagai versi `20261102091100`; produksi tetap belum menerima migrasi apa pun.

## 7. Batasan dan Prasyarat Produksi

- **Expired access token** belum diuji; refresh, restore, invalid credentials, dan logout sudah.
- **UI browser owner** sudah diuji pada preview: login, `/products`, pencarian, validasi form, kategori, biaya, edit, dan logout. Tampilan baca-saja kasir/gudang belum diuji browser; Auth/PostgREST dan RLS-nya diuji lewat SDK/HTTP.
- **P95 pencarian** belum diukur pada 1.361 produk; pagination dan query server-side sudah diuji secara fungsional.
- **Sign-up hosted masih aktif**; wajib dimatikan sebelum produksi.
- **Akun dan data uji** masih ada di preview; hapus/reset sebelum produksi.
- `public.rls_auto_enable()` adalah fungsi event trigger platform yang dilaporkan advisor; bukan bagian migrasi ini. Tinjau sebelum produksi.
- Fungsi `private` masih mewarisi EXECUTE dari `PUBLIC`; schema `private` tidak diekspos PostgREST, tetapi hardening grant dapat menjadi migrasi lanjutan.
- `types/database.generated.ts` dihasilkan dari schema lokal; hasil generation hosted identik pada tingkat schema. Regenerasi file dari CLI hosted setelah akses CLI tersedia.
- PGlite bukan Supabase; perbedaan perilaku PostgREST/GoTrue/Realtime tetap harus diuji pada project hosted (sudah dilakukan untuk Auth/RLS/RPC, bukan Realtime).
