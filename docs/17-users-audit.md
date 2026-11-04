# 17 — Halaman Pengguna & Audit Log (Phase 9)

Dua halaman administrasi owner-only untuk menutup sisa PRD: kelola profil staf
(`/users`) dan baca jejak perubahan (`/audit`). Tidak ada RPC baru dan **tidak
ada migrasi baru**: `public.admin_upsert_profile`, policy
`profiles_select_self_or_owner`, policy `audit_logs_select_owner`, dan grant
`select` pada kedua tabel sudah ada sejak Phase 2.

## Rute

| Rute | Isi |
| --- | --- |
| `/users` | Daftar profil: nama, peran, status aktif, waktu aktivasi, waktu ubah. |
| `/audit` | Audit log append-only: waktu, pelaku, aksi, entitas, alasan, snapshot JSON. |

Keduanya memakai `definePageMeta({ capability: 'users.manage' })` — capability
yang sudah ada dan hanya dimiliki owner. Kasir dan `inventory_staff` ditolak
middleware sebelum halaman dimuat, dan RLS tetap menolak bila URL dibuka
langsung dengan sesi non-owner.

## Keputusan desain

- **Tidak ada email di layar.** `profiles` tidak menyimpan email dan
  `auth.users` tidak dapat dibaca klien. Identitas karena itu adalah nama plus
  8 karakter pertama `id`. Tidak ada kolom email kosong atau tebakan
  `nama@toko`; halaman menyatakan bahwa email dan kata sandi dikelola Supabase
  Auth.
- **Halaman ini tidak membuat akun.** `admin_upsert_profile` hanya mengubah
  profil yang sudah ada (nama, peran, status aktif) dan menolak
  `PROFILE_NOT_FOUND`. Pembuatan akun tetap lewat dashboard Supabase; setelah
  trigger provisioning berjalan, profilnya muncul di daftar. Tombol "Tambah
  pengguna" sengaja tidak dibuat supaya tidak menjanjikan hal yang tidak bisa
  dilakukan RPC.
- **Guard owner terakhir ditampilkan lebih awal.** `isLastActiveOwner`
  menghitung dari seluruh daftar (bukan dari baris yang sedang diedit) dan
  memunculkan peringatan di dialog. RPC tetap penentu akhir: ia mengunci baris
  `FOR UPDATE`, memeriksa owner aktif lain, dan mengembalikan `LAST_OWNER`.
  UI tidak pernah "menyelamatkan" permintaan yang ditolak server.
- **Audit dibaca langsung dari tabel, tanpa RPC.** Policy
  `audit_logs_select_owner` sudah membatasi baris ke owner aktif, dan tabelnya
  immutable (trigger menolak UPDATE/DELETE). Menambah fungsi baca hanya akan
  memperluas permukaan review tanpa menambah keamanan.
- **Filter memakai kolom terindeks.** `created_at`, `action_key`, dan
  `entity_name` — tiga kolom yang punya indeks — plus urutan
  `created_at desc, id desc` agar paginasi stabil saat banyak baris memiliki
  timestamp sama. Tanggal diperluas ke `+07:00` (Asia/Jakarta) sehingga rentang
  satu hari tetap inklusif.
- **Label aksi berasal dari kunci nyata.** `AUDIT_ACTION_LABELS` memuat 20
  `action_key` yang benar-benar ditulis `private.write_audit` (profil, fitur,
  kategori, produk, biaya, impor, opname, penjualan). Kunci baru yang belum
  dipetakan tetap tampil apa adanya, bukan disembunyikan.
- **Ekspor CSV hanya satu halaman.** Tombol berbunyi "Ekspor halaman (CSV)"
  dan memuat baris yang sedang tampil beserta filter aktifnya. Audit log bisa
  sangat panjang; mengekspor seluruh hasil diam-diam akan menghasilkan berkas
  raksasa dan menyiratkan cakupan yang tidak diperiksa.
- **Tidak ada tombol ubah/hapus di audit.** Tabel append-only; satu-satunya
  aksi adalah membuka detail JSON sebelum/sesudah.

## Peta berkas

| Berkas | Peran |
| --- | --- |
| `app/types/users.ts` | `UserRow`/`UserDraft`, label peran, `shortUserId`, validasi nama, `isLastActiveOwner`, pemetaan error RPC. |
| `app/services/users.ts` | `listProfiles` (urut nama), `adminUpsertProfile` (arg `p_user_id`, `p_full_name`, `p_role`, `p_is_active`). |
| `app/composables/useUsers.ts` | State daftar, `activeCount`/`ownerCount`, `load(force)`, `save`, `lastOwner`. |
| `app/components/users/UserTable.vue` | Tabel profil + status aktif/nonaktif. |
| `app/components/users/UserEditDialog.vue` | Form nama/peran/aktif, validasi klien, peringatan owner terakhir. |
| `app/pages/users/index.vue` | Halaman pengguna + kartu ringkasan. |
| `app/types/audit.ts` | `AUDIT_ACTION_LABELS`, `summarizeAuditData`, `auditCsv`, `describeAuditError`. |
| `app/services/audit.ts` | `listAuditLogs` dengan embed `profiles` untuk nama pelaku. |
| `app/composables/useAudit.ts` | Filter reaktif, paginasi, request-id guard. |
| `app/components/audit/AuditTable.vue` | Tabel audit + panel detail JSON. |
| `app/pages/audit/index.vue` | Halaman audit + filter + ekspor halaman. |
| `tests/users-service.test.ts` | 10 tes: urutan query, fallback peran, RPC, guard owner, error. |
| `tests/audit-service.test.ts` | 8 tes: filter, paginasi, pelaku yatim, CSV, error. |

## Perilaku penting

- Nama di-trim sebelum dikirim; nama kosong atau lebih dari 120 karakter
  ditolak di klien dengan pesan yang sama seperti constraint database.
- Setelah simpan berhasil, baris diperbarui di tempat dan daftar diurutkan
  ulang menurut nama — tanpa memuat ulang seluruh tabel.
- `save` mengembalikan pesan error (bukan melempar) sehingga dialog tetap
  terbuka dan pengguna bisa memperbaiki input.
- Peran yang tidak dikenal (schema drift) dipetakan ke `cashier` di service,
  tidak pernah dirender sebagai nilai bebas.
- Pelaku audit yang profilnya sudah tidak ada tetap teridentifikasi:
  `Staf <8 id>`, atau `Sistem` bila `actor_id` null.
- Snapshot JSON dipotong 158 karakter + elipsis di kolom tabel; JSON penuh
  hanya dimuat saat baris dibuka, supaya tabel tetap ringan.
- Semua elemen memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, dan
  `.notice` dari `app/assets/css/main.css`; tidak ada gaya baru.

## Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **242/242 lulus** (18 file; 18 tes baru Phase 9) |
| `npm run build` | exit 0 (1,92 MB / 474 kB gzip) |
| `npm run audit:bundle` | 151 berkas, **0 temuan** |

## Batasan

- Belum diuji terhadap data hosted. `audit_logs` di preview masih berisi baris
  dari Phase 2–4, tetapi halaman ini belum dibuka dengan sesi owner nyata.
- Tidak ada pembuatan akun, reset kata sandi, atau undangan lewat email; itu
  wewenang Supabase Auth di dashboard.
- Tidak ada filter pelaku, pencarian teks bebas, atau ekspor seluruh hasil.
- Audit log tidak menampilkan `before_data` di CSV (hanya `after_data`) agar
  satu baris tetap satu record; snapshot sebelum tetap ada di detail layar.
- Migrasi Phase 5A **sudah diterapkan** ke preview `ptbllrugrjepdhhdkzxn`
  (4 November 2026); produksi tidak disentuh.

## Menambah staf inventaris kedua (Phase 5E)

Phase 5D hanya memakai satu akun `inventory_staff`
(`a3333333-3333-4333-8333-333333333333`). Rencana awal mensyaratkan dua akun
agar dua orang bisa menghitung rak berbeda dan menguji konflik versi secara
nyata. Per 4 November 2026 akun `INVENTORY_STAFF_B` **belum ada**: dari lima
profil, hanya satu yang berperan `inventory_staff`.

Aplikasi tidak punya dan tidak akan punya jalur pembuatan akun sendiri —
sign-up publik dimatikan di `supabase/config.toml`, dan peran tidak pernah
dibaca dari `user_metadata`. Akun harus dibuat owner di Supabase Auth Dashboard:

1. Buka **Authentication → Users → Add user** pada project preview.
2. Isi email staf dan kata sandi awal yang kuat; **jangan** aktifkan
   "Auto Confirm User" bila email belum diverifikasi, dan jangan bagikan
   kredensial lewat dokumen ini.
3. Simpan. Trigger `private.handle_new_user` membuat baris `profiles` dengan
   peran default `cashier` dan `is_active = true`.
4. Login sekali sebagai staf tersebut, lalu sebagai owner buka `/users` dan
   ubah perannya menjadi `inventory_staff`.
5. Verifikasi: `profiles.role = 'inventory_staff'`, `is_active = true`, dan akun
   bisa membuka `/stock-opname` tetapi tetap ditolak di `/users`.

Yang tidak boleh dilakukan: menaikkan peran lewat `user_metadata` atau
`raw_user_meta_data`, memakai akun bersama, atau menyalakan sign-up publik
sebagai jalan pintas.
