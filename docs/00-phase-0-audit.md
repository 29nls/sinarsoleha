# Phase 0 — Audit, Arsitektur, dan Roadmap

**Proyek:** POS Toko Sinar Soleha
**Tanggal audit:** 1 November 2026
**Status:** Phase 0 selesai, Phase 1 (fondasi) diimplementasikan pada repo ini.
**Keputusan:** belum ada modul bisnis yang boleh diimplementasikan sebelum migrasi database divalidasi.

---

## 1. Audit Dokumen

### 1.1 Dokumen yang dibaca

| Dokumen | Lokasi | Ukuran | Isi yang dipakai |
| --- | --- | --- | --- |
| PRD versi 1.0 (2 November 2026) | `docs/PRD_POS_Toko_Sinar_Soleha.md` | 65.847 byte | 15 bagian: tujuan, analisis workbook, peran, CAT/POS/INV/RPT, arsitektur, RLS, plugin, NFR, migrasi, roadmap, risiko |
| Starter schema SQL | `supabase/supabase_schema_pos_toko_sinar_soleha.sql` | 22.182 byte | 17 tabel, indeks, helper `private.has_role`, policy RLS, seed unit & feature flag |
| Workbook stok | `Stok Opname Toko Sinar Soleha - PART MASTER.xlsx` (blob `832298f` di commit `ae8fe16`) | 367.616 byte | Sheet `PART MASTER`, header baris 2, 1.361 record |
| Workbook transaksi | `TRANSAKSI DATA PENJUALAN TOKO SINAR SOLEHA - Transaksi.xlsx` (blob `f45de79`) | 2.981.925 byte | Sheet `Transaksi`, 145 header dan 238 segmen detail |

Kedua workbook tidak ada di working tree saat audit dimulai (hanya tersisa di commit pertama). Keduanya dipulihkan dari Git ke direktori scratch, diprofilkan, lalu scratch dihapus. Tidak ada data sumber yang diubah.

### 1.2 Angka PRD yang diverifikasi ulang

Dihitung langsung dari workbook, bukan disalin dari PRD:

| Metrik | PRD | Hasil audit | Status |
| --- | --- | --- | --- |
| Record produk | 1.361 | 1.361 | cocok |
| SKU unik | 1.361 | 1.361 | cocok |
| Stok terisi | 1.116 | 1.116 | cocok |
| Stok kosong (NULL) | 245 | 245 | cocok |
| Stok negatif | 37 | 37 | cocok |
| Stok nol | 0 | 0 | cocok |
| Harga jual kosong | 28 | 28 | cocok |
| Harga beli kosong | 119 | 119 | cocok |
| Kategori mentah → setelah trim | 204 → 203 | 204 → 203 | cocok |
| Representasi satuan | 10 | 10 (`Karung`, `LUSIN`, `Lusin`, `Meter`, `Pack`, `Pax`, `Pcs`, `Pcs `, `Roll`, `Set`) | cocok |
| Harga jual < harga beli | 1 contoh | 1 (`Walpaper Dinding CSB-MGT-05-W`) | cocok |
| Header transaksi | 145 | 145 (ID unik 145) | cocok |
| Segmen detail | 238 | 238 | cocok |
| Subtotal / diskon / total bayar | 10.721.000 / 362.000 / 10.356.000 | 10.721.000 / 362.000 / 10.356.000 | cocok |
| Metode bayar | 93 tunai / 50 QRISH / 2 split | 93 / 50 / 2 | cocok |
| Kasir | 97 SHERIN-BRANCH MANAGER, 48 JOHN | 97 / 48 | cocok |
| Rentang tanggal | 16–31 Okt 2026 | 16-Oct-2026 s.d. 31-Oct-2026 | cocok |
| Mismatch subtotal−diskon vs total | 1 (Rp3.000) | 1: `TRX-20261030-144151` (48.000 − 0 ≠ 45.000) | cocok |

Kesimpulan: PRD akurat terhadap workbook. PRD dapat dijadikan baseline requirement tanpa rekonsiliasi angka ulang.

### 1.3 Temuan data yang mengikat desain

1. **Stok kosong bukan nol.** 245 SKU tidak memiliki saldo. `products.stock_on_hand` harus nullable dan checkout wajib menolak SKU tanpa saldo terverifikasi.
2. **Stok negatif dipertahankan.** 37 SKU negatif disimpan apa adanya dengan flag review, bukan dikoreksi otomatis.
3. **Harga jual kosong memblokir penjualan.** 28 SKU tidak boleh masuk transaksi sampai harga diisi.
4. **Harga beli tidak lengkap.** 119 SKU tanpa biaya; laporan margin tidak boleh mengasumsikan biaya = 0.
5. **Nama barang bukan kunci.** Detail nota historis tidak memuat SKU; 238 segmen harus dipetakan manual/bertingkat keyakinan. Tidak ada auto-match.
6. **Satuan tidak seragam.** `Pcs` vs `Pcs ` vs `LUSIN` vs `Lusin`; 8 satuan kanonik setelah normalisasi. Konversi Lusin→Pcs tidak boleh diasumsikan.
7. **Tanggal bisnis ≠ nomor nota.** Dua transaksi bertanggal 23 Okt pada ID tetapi 22 Okt pada `Time_Stamp`. `business_date` disimpan terpisah dari `created_at`.
8. **Satu nota tidak balance.** Total bayar Rp45.000 vs subtotal Rp48.000 tanpa diskon. Disimpan sebagai `legacy_mismatch`, tidak diperbaiki.

---

## 2. Audit Workspace

| Aspek | Kondisi |
| --- | --- |
| Repositori | Git, commit tunggal `ae8fe16` ("first commit") |
| Kode aplikasi | Tidak ada. Tidak ada `package.json`, lockfile, atau source |
| Dokumentasi | PRD di `docs/`, starter SQL di `supabase/` |
| Aturan proyek | `AGENTS.md` (kehati-hatian, perubahan minimal, verifikasi) |
| Runtime | Node v26.13.0, npm 11.20.0 |
| Database lokal | **Tidak tersedia**: `docker`, `psql`, dan `supabase` CLI tidak terpasang |
| Kesimpulan | Greenfield. Fondasi harus dibuat dari nol |

**Konsekuensi tooling.** Tanpa Docker/Postgres lokal, migrasi Phase 2 tidak dapat dieksekusi atau diuji di mesin ini. Pada Phase 2 migrasi akhirnya diuji dengan PGlite (PostgreSQL 18.6); apply ke project Supabase (branch/preview) dan uji Auth tetap menjadi blocker sign-off Phase 2.

---

## 3. Audit Database (ringkas)

Starter schema berisi 17 tabel, 17 RLS enabled, 1 helper function, **0 RPC**, **0 trigger**, dan **0 migration file**. Struktur relasionalnya sehat dan selaras PRD, tetapi belum dapat dijalankan sebagai produksi.

Temuan yang memblokir (detail dan perbaikan di `docs/02-database-review.md`):

| ID | Tingkat | Temuan |
| --- | --- | --- |
| DB-01 | P0 | `products` tidak punya grant INSERT/UPDATE dan tidak ada RPC katalog — owner tidak dapat mengelola produk lewat API |
| DB-02 | P0 | Tidak ada provisioning `profiles` saat user Auth dibuat — user baru tidak punya role sehingga semua policy menolak |
| DB-03 | P0 | Belum ada RPC `complete_sale`, `post_stock_opname`, void, dan adjustment; seluruh mutasi uang/stok belum dapat dilakukan |
| DB-04 | P1 | Tidak ada trigger `updated_at`; kolom `updated_at` akan basi |
| DB-05 | P1 | Tidak ada constraint/trigger yang menjamin Σ`payments.amount_applied` = `transactions.grand_total` |
| DB-06 | P1 | `stock_movements` tidak menjaga konsistensi `quantity_before + delta = quantity_after` dan tidak membatasi movement tanpa referensi |
| DB-07 | P1 | `products.sku` unik case-sensitive; `ELE-K001` dan `ele-k001` bisa hidup bersama |
| DB-08 | P1 | `import_review_status` tunggal tidak dapat mewakili SKU dengan beberapa masalah sekaligus (stok kosong + harga kosong + negatif) |
| DB-09 | P1 | Tidak ada tabel staging untuk impor 145 header / 238 baris legacy dan rekonsiliasinya |
| DB-10 | P1 | Tidak ada mekanisme penomoran nota yang aman terhadap konkurensi |
| DB-11 | P1 | Opname tidak punya status per item, riwayat hitung ulang, atau proteksi immutable setelah `posted` |
| DB-12 | P1 | `reason_code` opname dan discrepancy tidak dibatasi CHECK sesuai daftar PRD |
| DB-13 | P1 | Default privileges Supabase dapat memberi akses tabel baru ke `anon`/`authenticated`; setiap migrasi wajib revoke eksplisit |
| DB-14 | P2 | Tidak ada indeks audit (`entity_name, entity_id`, `created_at`) |
| DB-15 | P2 | `stock_movements.actor_id` nullable; mutasi bisa tanpa pelaku |
| DB-16 | P2 | Tidak ada trigger Broadcast realtime untuk perubahan stok |
| DB-17 | P2 | `auth.users` delete akan gagal karena FK `on delete restrict`; offboarding harus melalui `is_active=false` |

**Keputusan.** Starter SQL **tidak** dijalankan apa adanya. Phase 2 menulis migrasi baru yang memperbaiki DB-01…DB-17, lalu menguji allow/deny RLS dan RPC pada project Supabase.

---

## 4. Pemetaan Requirement

| Modul PRD | Requirement | Implementasi target | Fase | Kriteria penerimaan |
| --- | --- | --- | --- | --- |
| Auth & user | Login/logout, profil, role, proteksi route | `app/pages/login.vue`, `app/stores/auth.ts`, `app/middleware/auth.global.ts`, RLS | 1–2 | Login valid masuk; user nonaktif ditolak RLS; route terlarang 403 |
| Katalog | CAT-01…06 | `app/pages/products/**`, RPC katalog | 3 | Tanpa gambar; SKU unik case-insensitive; harga null tidak dapat dijual |
| Kasir | POS-01…12 | `app/pages/cashier/**`, RPC `complete_sale` | 4 | Checkout atomik; idempotent; payment = total; stok tidak negatif |
| Inventaris | INV-01, INV-10 | `app/pages/inventory/**`, ledger | 5 | Setiap perubahan punya movement + actor |
| Opname | INV-02…09 | `app/pages/stock-opname/**`, RPC `post_stock_opname` | 5 | Selisih wajib alasan; `stock_version` basi ditolak; posting atomik |
| Laporan | RPT-01…06 | `app/pages/reports/**`, query SQL | 6 | Angka berasal dari transaksi tersimpan; export CSV |
| Plugin | Printer, scanner, gateway | `app/adapters/**`, feature flag | 7 | POS tetap berfungsi saat semua plugin OFF |
| Keamanan | NFR-03, NFR-06 | RLS, RPC, audit_logs | 2 & 8 | pgTAP allow/deny; tidak ada secret di bundle |

---

## 5. Arsitektur

```
Browser (Nuxt 4 SPA, TypeScript, Tailwind, Pinia)
  ├─ halaman & komponen        → hanya UI, tanpa keputusan otorisasi final
  ├─ stores (auth, cart, ...)  → state sementara
  └─ @supabase/supabase-js
        ├─ Auth  ──────────────► Supabase Auth (email/password)
        ├─ Data API ───────────► PostgreSQL + RLS
        ├─ RPC ────────────────► private.complete_sale / post_stock_opname / ...
        └─ Realtime ───────────► Broadcast topic store:stock
Nitro server (opsional, hanya QRIS gateway)
  └─ memegang secret gateway; tidak dipakai untuk operasi inti
```

- **Frontend:** Nuxt 4 mode SPA (`ssr: false`). Alasan: seluruh otorisasi sudah di database; SSR akan menambah jalur auth kedua tanpa menambah enforcement. Detail di `docs/01-architecture.md` (ADR-001).
- **Backend:** tidak ada server aplikasi untuk operasi inti. Supabase PostgreSQL + RPC adalah backend. Nitro hanya untuk gateway pembayaran opsional.
- **Database:** `products.stock_on_hand` sebagai saldo cepat, `stock_movements` sebagai ledger append-only, `stock_version` untuk concurrency opname.
- **Realtime:** Broadcast hanya memuat `product_id`, `sku`, `stock_on_hand`, `stock_version`. Tidak ada data pelanggan/pembayaran. Realtime tidak menggantikan validasi checkout.

---

## 6. Struktur Proyek

```
app/
  assets/css/main.css          token desain + kelas tabel/form padat
  components/layout/AppNav.vue navigasi sadar-peran
  composables/useSupabase.ts   klien browser tunggal
  layouts/{default,auth}.vue   shell aplikasi & halaman masuk
  middleware/auth.global.ts    guard sesi + capability
  pages/login.vue              Supabase Auth
  pages/dashboard/index.vue    sesi nyata + status modul
  pages/index.vue              redirect
  stores/auth.ts               sesi, profil, role, error
  types/{database,nuxt.d}.ts   tipe domain & Supabase
  utils/{permissions,modules,format}.ts
  error.vue                    403/404/500
docs/                          audit, arsitektur, review DB, log progres
supabase/                      starter schema (referensi) + migrations/ (fase 2)
tests/                         unit test matriks peran & formatter
```

Struktur mengikuti konvensi Nuxt 4 (`app/` sebagai srcDir). Folder `server/api` baru dibuat di Phase 7 bila gateway QRIS diaktifkan.

---

## 7. Roadmap dan Kriteria Keluar

| Fase | Deliverable | Kriteria keluar | Status |
| --- | --- | --- | --- |
| 0 | Audit, keputusan arsitektur, risk register | Dokumen audit disetujui; data source terverifikasi | **Selesai** |
| 1 | Nuxt + TS + Tailwind + Pinia + Supabase; layout, nav, auth store, error handling | Build & typecheck lulus; login route terlindungi; tanpa secret di bundle | **Selesai** (verifikasi build di `docs/PROGRESS.md`) |
| 2 | Migrasi SQL, RLS, RPC inti, provisioning profil | Migrasi apply bersih; allow/deny per peran lulus; `complete_sale` atomik | **Sebagian** — 11 migrasi apply bersih dan 20/20 uji lokal (PGlite); `complete_sale` masih kontrak; apply hosted & uji Auth belum |
| 3 | Katalog & produk | CRUD + impor tervalidasi; tanpa gambar; SKU case-insensitive unik | Belum |
| 4 | Kasir | Checkout konkuren aman; payment = total; idempotency terbukti | Belum |
| 5 | Inventaris & opname | `stock_version` basi ditolak; alasan wajib; posting atomik | Belum |
| 6 | Laporan | Total laporan = total transaksi/ledger pada dataset uji; CSV | Belum |
| 7 | Adapter opsional | POS lulus dengan semua plugin OFF dan saat adapter gagal | Belum |
| 8 | Keamanan & UAT | pgTAP, uji konkurensi, audit bundle, UAT owner | Belum |

---

## 8. Risk Register

| ID | Risiko | Dampak | Kemungkinan | Mitigasi |
| --- | --- | --- | --- | --- |
| R-01 | Stok sumber tidak bertanggal; formula menunjuk sheet `STOCK MASTER` yang tidak ada | Saldo awal salah | Tinggi | Owner memvalidasi; opname awal sebelum go-live; `stock_unknown` memblokir penjualan |
| R-02 | 37 stok negatif | Stok fisik dan sistem tidak pernah cocok | Tinggi | Simpan nilai sumber + flag; opname ulang; koreksi hanya lewat adjustment beralasan |
| R-03 | 245 stok NULL diperlakukan 0 | Penjualan fiktif / oversell | Sedang | `NULL` tetap `NULL`; checkout menolak; hitungan pertama = opening balance |
| R-04 | 238 baris legacy dipetakan salah | Laporan produk historis salah | Tinggi | Staging + confidence + approval manual; laporan historis ditandai belum tervalidasi |
| R-05 | Nota legacy mismatch Rp3.000 | Laporan pendapatan tidak balance | Rendah | `legacy_mismatch`, exception report, tidak diubah |
| R-06 | Checkout ganda karena retry jaringan | Stok dan pendapatan ganda | Sedang | `idempotency_key` unik + RPC mengembalikan nota yang sama |
| R-07 | Opname menimpa penjualan yang terjadi setelah snapshot | Stok salah | Sedang | `stock_version_snapshot` + penolakan posting + recount |
| R-08 | Deadlock checkout multi-SKU | Checkout gagal | Sedang | Lock baris produk dalam urutan `product_id` konsisten |
| R-09 | Eskalasi peran dari klien | Akses harga beli / void | Rendah | Otorisasi hanya di RLS/RPC; capability klien tidak dipercaya |
| R-10 | `service_role` bocor ke bundle | Kompromi total database | Rendah | Hanya publishable key di runtimeConfig; audit bundle di Phase 8 |
| R-11 | Default privileges Supabase pada tabel baru | Tabel baru terbuka | Sedang | Revoke eksplisit + test policy di setiap migrasi |
| R-12 | Koneksi toko putus saat checkout | Transaksi gagal / ragu | Sedang | Indikator koneksi, tombol checkout nonaktif, tidak ada klaim tersimpan |
| R-13 | Tidak ada Postgres lokal | Migrasi tidak teruji sebelum apply | Tinggi | Uji pada Supabase branch/preview; pgTAP; dry-run di project staging |
| R-14 | Gateway QRIS butuh secret server | Kebocoran kredensial | Sedang | Gateway OFF secara default; hanya Nitro server-only; jika hosting statis, tetap manual |

---

## 9. Keputusan yang Masih Menunggu Owner

1. Apakah kolom `Stock` adalah saldo sistem, hasil opname, atau snapshot bertanggal?
2. Untuk 37 SKU negatif: dipertahankan, opname ulang, atau dikoreksi? Dengan alasan apa?
3. Batas diskon kasir dan siapa yang boleh override?
4. Konversi satuan Lusin → Pcs per SKU (jika ada).
5. Pemetaan dua nama kasir lama ke akun staf.
6. Jam tutup hari bisnis (transaksi lewat tengah malam).
7. Apakah hosting mendukung Nitro Node server (menentukan gateway QRIS dinamis).

Selama belum dijawab, sistem memakai default aman: stok NULL memblokir penjualan, diskon 0 untuk kasir, tanpa konversi satuan, QRIS manual, gateway OFF.
