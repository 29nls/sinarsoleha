# Database Tests

Uji integrasi database dijalankan tanpa Docker memakai **PGlite** (PostgreSQL 18.6 dalam WASM) dan auth shim lokal.

```bash
npm run test:db
```

Harness `scripts/db-test.mjs` akan:

1. Membuat cluster PGlite baru (in-memory).
2. Membuat role `anon`, `authenticated`, `service_role`, schema `auth`, `auth.users`, dan `auth.uid()` (shim Supabase).
3. Menerapkan seluruh `supabase/migrations/*.sql` berurutan (15 migrasi).
4. Mengisi fixture owner/kasir/gudang/nonaktif/produk.
5. Menjalankan 80 skenario RLS, RPC, constraint, provisioning, audit, opname, dan hak akses.

Hasil terakhir: **80 passed, 0 failed**.

## Hosted smoke test

```bash
npm run test:hosted
```

`scripts/hosted-smoke.mjs` menguji project preview memakai publishable key dan sesi user nyata (tanpa `service_role`): login owner, provisioning, aktivasi lewat RPC, RLS kasir/gudang/nonaktif, RPC katalog, RPC kategori, query halaman dengan join, audit, refresh/restore/logout. Hasil 2 November 2026: **22 passed, 0 failed, 1 skipped** (expired token belum diuji).

Skrip membutuhkan `.env` dan `.tmp/phase2b-accounts.json` berisi akun uji preview; file akun gitignored dan tidak boleh dipakai di produksi. Skrip membuat satu kategori dan satu produk uji.

## Cakupan

- anon tidak punya akses tabel maupun RPC.
- User tanpa profil dan akun nonaktif ditolak; akun nonaktif tetap dapat membaca profilnya sendiri.
- Kasir tidak dapat menulis produk/stok langsung; staf gudang tidak dapat menaikkan role.
- Owner mengelola produk lewat RPC; payload `stock_on_hand` diabaikan.
- `user_metadata` tidak memengaruhi otorisasi.
- Aritmetika ledger, SKU case-insensitive, pembayaran harus balance saat COMMIT.
- Opname posted tidak dapat diubah; nomor dokumen berurutan.
- Provisioning membuat kasir nonaktif; bootstrap owner hanya sekali.
- Aktivasi user, last-owner guard, feature flag owner-only.
- Biaya hanya owner; default privilege tabel baru; audit append-only.
- Owner membuat/mengubah/menonaktifkan kategori lewat RPC; duplikat nama ditolak; kasir tidak dapat memanggil RPC kategori.
- Grup I (Phase 8): anon 0 grant tabel; tulis authenticated hanya `categories`/`units_of_measure`; RLS aktif di 24/24 tabel dan `document_counters` tanpa policy; 17 RPC `SECURITY DEFINER` dengan `search_path=""`; helper internal tidak bisa dieksekusi klien; panggilan langsung fungsi trigger ditolak; default privilege tidak memberi grant baru.

## Batasan

PGlite bukan Supabase hosted. Uji lokal **tidak** mencakup:

- PostgREST, GoTrue, JWT asli, dan alur login browser.
- Konkurensi multi-sesi (PGlite satu koneksi); row lock `document_counters` baru terbukti secara logika.
- Realtime Broadcast hosted.
- Apply migrasi ke project Supabase.

Untuk project preview baru, gunakan project disposable:

```bash
npx supabase link --project-ref <preview-ref>
npx supabase db push
npm run gen:types   # atau: npx supabase gen types typescript --linked > types/database.generated.ts
```

Lalu ulangi skenario RLS dengan akun owner, kasir, staf gudang, dan akun nonaktif. Jangan menjalankan `db push` ke produksi tanpa persetujuan dan backup. Pada Phase 2B, schema preview diverifikasi dan riwayat migrasi direpair setelah hash schema cocok; `db push` tidak dijalankan karena CLI tidak terautentikasi. Detail di `docs/03-database-implementation.md`.
