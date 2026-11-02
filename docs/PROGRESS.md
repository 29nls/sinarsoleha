# Log Pengembangan

## 2 November 2026 — Phase 2 (sebagian)

### Lingkup

- 11 migrasi PostgreSQL berurutan: helper, referensi, profil/provisioning, katalog, penjualan, inventaris, staging legacy, setting/audit, RLS, RPC katalog, RPC admin.
- RLS pada 22 tabel; 23 policy; `anon` tanpa grant tabel; default privileges dicabut.
- RPC katalog owner-only yang tidak menyentuh stok; provisioning profil dari `auth.users`; bootstrap owner sekali; RPC aktivasi/role dengan last-owner guard; feature flag owner-only.
- Ledger stok dan audit append-only; constraint trigger pembayaran deferred; nomor nota `SS-YYYYMMDD-NNNN`; SKU case-insensitive.
- Tipe database hasil `supabase gen types`; auth store memakai tipe generated dan validasi role.
- Uji database lokal dengan PGlite PostgreSQL 18.6 dan auth shim Supabase.

**Status: PARTIALLY COMPLETED.** Belum diterapkan ke project Supabase hosted dan login/PostgREST/GoTrue belum diuji. `complete_sale`, `void_sale`, `post_stock_opname`, dan `adjust_stock` baru berupa kontrak.

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
