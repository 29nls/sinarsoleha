# Database Tests

Uji integrasi database dijalankan tanpa Docker memakai **PGlite** (PostgreSQL 18.6 dalam WASM) dan auth shim lokal.

```bash
npm run test:db
```

Harness `scripts/db-test.mjs` akan:

1. Membuat cluster PGlite baru (in-memory).
2. Membuat role `anon`, `authenticated`, `service_role`, schema `auth`, `auth.users`, dan `auth.uid()` (shim Supabase).
3. Menerapkan seluruh `supabase/migrations/*.sql` berurutan.
4. Mengisi fixture owner/kasir/gudang/nonaktif/produk.
5. Menjalankan 20 skenario RLS, RPC, constraint, provisioning, dan audit.

Hasil terakhir: **20 passed, 0 failed**.

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

## Batasan

PGlite bukan Supabase hosted. Yang **tidak** diuji di sini:

- PostgREST, GoTrue, JWT asli, dan alur login browser.
- Konkurensi multi-sesi (PGlite satu koneksi); row lock `document_counters` baru terbukti secara logika.
- Realtime Broadcast hosted.
- Apply migrasi ke project Supabase.

Untuk verifikasi hosted, gunakan project preview/disposable:

```bash
npx supabase link --project-ref <preview-ref>
npx supabase db push
npm run gen:types   # atau: npx supabase gen types typescript --linked > types/database.generated.ts
```

Lalu ulangi skenario RLS dengan akun owner, kasir, staf gudang, dan akun nonaktif. Jangan menjalankan `db push` ke produksi tanpa persetujuan dan backup.
