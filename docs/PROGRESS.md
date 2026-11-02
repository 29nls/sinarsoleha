# Log Pengembangan

## 1 November 2026 — Phase 0 & Phase 1

### Lingkup

- Audit dokumen, data workbook, workspace, dan starter schema.
- Fondasi Nuxt 4 SPA: TypeScript strict, Tailwind CSS, Pinia, Supabase JS.
- Layout, navigasi sadar-peran, halaman login Supabase Auth, guard sesi, halaman error.
- Unit test untuk matriks peran dan formatter.

### File dibuat

| Kelompok | File |
| --- | --- |
| Konfigurasi | `package.json`, `nuxt.config.ts`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md` |
| Tipe | `app/types/database.ts`, `app/types/nuxt.d.ts` |
| Util | `app/utils/permissions.ts`, `app/utils/modules.ts`, `app/utils/format.ts` |
| Data & auth | `app/composables/useSupabase.ts`, `app/stores/auth.ts`, `app/middleware/auth.global.ts` |
| UI | `app/app.vue`, `app/assets/css/main.css`, `app/layouts/default.vue`, `app/layouts/auth.vue`, `app/components/layout/AppNav.vue` |
| Halaman | `app/pages/login.vue`, `app/pages/index.vue`, `app/pages/dashboard/index.vue`, `app/error.vue` |
| Test | `tests/permissions.test.ts`, `tests/format.test.ts` |
| Dokumentasi | `docs/00-phase-0-audit.md`, `docs/01-architecture.md`, `docs/02-database-review.md`, `docs/PROGRESS.md`, `README.md` |

### File dimodifikasi

Tidak ada file sumber lama; repositori sebelumnya hanya berisi dokumen. Tidak ada data workbook atau starter SQL yang diubah.

### Perintah yang dijalankan

| Perintah | Hasil |
| --- | --- |
| `npm install` | Sukses; `nuxt prepare` menghasilkan `.nuxt` |
| `npm run typecheck` (`nuxt typecheck`) | Exit 0, tanpa error |
| `npx vitest run` | 2 file, 8 test lulus |
| `npm run build` | Exit 0; output `.output` |
| `npm run dev -- --port 3010` | Siap; `GET /login` → HTTP 200 |
| Browser buka `/login` tanpa env | Login dirender dengan notice "Supabase belum dikonfigurasi"; form nonaktif; tanpa error konsol |
| Dev server dijalankan ulang setelah `.env` lokal terisi | Siap dalam 7,7 detik; formulir login aktif (email, kata sandi, tombol), notice konfigurasi hilang |

### Yang belum diverifikasi (jujur)

- **Login nyata belum diuji**: konfigurasi Supabase terbaca dan form aktif, tetapi tidak ada akun staf/kata sandi uji pada sesi ini. Alur sign-in, pemuatan profil, dan RLS belum diuji.
- **Migrasi database belum ada dan belum diuji**: tidak ada Docker/psql/Supabase CLI. Phase 2 tidak dapat dinyatakan selesai tanpa apply migrasi dan uji allow/deny pada project Supabase.
- **Tipe Supabase** masih minimal (hanya `profiles`) dengan satu cast terdokumentasi di `app/stores/auth.ts`; diganti hasil `supabase gen types` di Phase 2.
- **Belum ada uji performa**; angka P95 PRD adalah target, bukan hasil ukur.

### Catatan repositori

- Dua workbook sumber dan PRD masih tercatat di commit `ae8fe16`, tetapi tidak ada di working tree (PRD disalin ke `docs/`, SQL ke `supabase/`). Workbook dipulihkan sementara dari Git untuk audit lalu dihapus dari scratch.
- `.env` lokal (gitignored) berisi kredensial Supabase dan tidak dibuat oleh agen ini. Nilainya tidak dibaca atau dicetak; hanya nama variabel dan status terisi yang diperiksa.
- `git status` menunjukkan penghapusan file lama dan penambahan `docs/`, `supabase/`; belum ada commit baru.

### Tugas berikutnya

Phase 2 — Database & Authentication:

1. Tulis migrasi `0001`–`0012` sesuai `docs/02-database-review.md`.
2. Provision project Supabase (butuh URL + publishable key; service role hanya untuk CI/admin).
3. Terapkan migrasi, jalankan uji RLS allow/deny per peran dan uji RPC `complete_sale`.
4. Ganti `app/types/database.ts` dengan tipe hasil generate.
5. Uji login end-to-end dengan akun owner, kasir, dan staf gudang.
