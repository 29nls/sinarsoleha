# 16 — Keamanan & UAT (Phase 8)

Phase 8 menutup proyek dengan dua hal yang bisa dikerjakan tanpa menyentuh
database hosted: **audit keamanan yang dapat diulang** dan **checklist UAT**
untuk owner, kasir, dan staf gudang. Tidak ada migrasi baru pada fase ini —
migrasi Phase 5A dan Broadcast Realtime sudah diterapkan ke preview
`ptbllrugrjepdhdhhdkzxn` (4 November 2026), dan produksi tidak disentuh sama
sekali.

## 1. Cara menjalankan ulang audit

| Perintah | Yang diperiksa |
| --- | --- |
| `npm run test:db` | 83 tes PostgreSQL lokal, termasuk grup H (Broadcast stok) dan grup I (hak akses, RLS, RPC, default privilege). |
| `npm run build` lalu `npm run audit:bundle` | Output build tidak memuat service-role key, secret key Supabase, atau JWT `service_role`. |
| `npm test` | 251 unit test klien (adapter, sanitasi konfigurasi, laporan, izin, Realtime stok). |
| `npm run test:hosted` | Auth/RLS/RPC nyata di preview (butuh `.env` dan akun uji). |
| `npm run test:hosted:transactions` | Konkurensi, idempotensi, void, dan rekonsiliasi pembayaran di preview. |

`audit:bundle` sengaja dibuat sempit agar tidak menghasilkan alarm palsu:
literal `sb_secret_`/`sb_publishable_` di dalam `@supabase/supabase-js` adalah
pendeteksi prefix milik library, bukan kredensial, sehingga hanya key lengkap
(20+ karakter setelah prefix) yang dilaporkan. Skrip keluar dengan kode 1 bila
menemukan temuan, dan sudah diuji dengan file bocor buatan.

## 2. Hasil audit

### 2.1 Bundle klien

- `npm run audit:bundle`: **0 temuan** pada 151 berkas (2,5 MB teks) di
  `.output/public` dan `.output/server`.
- Tidak ada source map publik, tidak ada `service_role`, tidak ada
  `SUPABASE_SERVICE_ROLE_KEY`, tidak ada JWT dengan claim `service_role`.
- Variabel publik yang masuk bundle hanya `SUPABASE_URL` dan
  `SUPABASE_PUBLISHABLE_KEY` (`nuxt.config.ts` → `runtimeConfig.public`).
- `.env` lokal hanya berisi dua nilai publishable di atas; tidak ada secret.
  `.env` dan `.tmp/phase2b-accounts.json` sudah gitignored.

### 2.2 Kode klien

Pencarian di `app/` tidak menemukan:

- `user_metadata` — otorisasi hanya memakai `profiles.role` + `is_active`.
- `service_role`, `localStorage`, `innerHTML`, `v-html`, `eval(`.
- `.insert()`, `.update()`, `.upsert()`, `.delete()` langsung ke tabel. Semua
  penulisan melewati 18 RPC `public.*`; satu-satunya `.update(` adalah
  `search.update(value)` pada input pencarian kasir.
- Redirect login memakai `safeRedirect()` yang hanya menerima path internal
  (`/…`, bukan `//…`), sehingga tidak bisa dipakai open redirect.

### 2.3 Hak akses database (PGlite, 24 tabel publik)

| Objek | anon | authenticated |
| --- | --- | --- |
| Tabel publik | 0 grant | SELECT semua tabel; tulis **hanya** `categories` + `units_of_measure` (dibatasi policy owner) |
| RLS | aktif di 24/24 tabel | idem |
| `document_counters` | tanpa policy (RPC-only) | tanpa policy (RPC-only) |
| Fungsi `public.*` (17) | tidak ada EXECUTE | EXECUTE semua; semuanya `SECURITY DEFINER` + `search_path=""` |
| `private.require_active_role`, `bootstrap_owner`, `write_audit`, `next_document_number`, wrapper RPC | tidak ada EXECUTE | tidak ada EXECUTE |
| Schema `private` | tanpa USAGE | USAGE (dibutuhkan helper internal) |
| `auth.users` | tidak bisa SELECT | tidak bisa SELECT |
| Default privilege | tidak ada grant baru | tidak ada grant baru |

Grup I pada `npm run test:db` mengunci semua baris di atas, sehingga regresi
grant/RLS akan gagal di CI lokal, bukan baru ketahuan di produksi.

### 2.4 Temuan residual (tidak menaikkan risiko)

1. **EXECUTE default pada fungsi trigger.** `set_updated_at`,
   `block_audit_log_mutation`, `block_stock_ledger_mutation`,
   `guard_opname_immutable`, `guard_opname_status_transition`,
   `check_payment_balance`, `check_transaction_balance`,
   `assert_transaction_balanced`, `guard_opname_item_write`, dan
   `handle_new_auth_user` masih membawa grant `PUBLIC` bawaan PostgreSQL.
   Dampaknya nihil: `anon` tidak punya USAGE pada schema `private`, dan
   pemanggilan langsung fungsi trigger ditolak PostgreSQL (`0A000`). Tes I5/I7
   membuktikan keduanya. Perbaikan `revoke all … from public` sebaiknya
   digabung ke migrasi berikutnya yang sudah menunggu approval, bukan migrasi
   tambahan di luar persetujuan.
2. **Akun nonaktif tetap bisa login.** Ini disengaja: user nonaktif dapat
   membaca profilnya sendiri agar UI menampilkan pesan, tetapi seluruh RLS/RPC
   menolak operasi. Diuji di hosted (`inactive account can authenticate but
   cannot act`).
3. **Tidak ada rate limit aplikasi.** Perlindungan brute force login
   sepenuhnya bergantung pada Supabase Auth. Jangan menambahkan percobaan
   login otomatis di skrip produksi.

## 3. Model ancaman ringkas

| Aset | Ancaman | Kontrol |
| --- | --- | --- |
| Kredensial server | Bocor ke bundle | Hanya publishable key di klien; `audit:bundle`; `.env` gitignored |
| Uang & stok | Manipulasi harga/total dari klien | Total dihitung ulang di RPC; snapshot harga; `numeric(14,2)`; trigger balance saat COMMIT |
| Stok | Penulisan langsung | Tidak ada grant tulis `products`; ledger append-only; RPC dengan row lock |
| Peran | Eskalasi lewat metadata/UI | `profiles.role` dari server; `private.has_role`; `admin_upsert_profile` owner-only; last-owner guard |
| Audit | Penghapusan jejak | `audit_logs` append-only via trigger; hanya SELECT untuk staff |
| Sesi | XSS/pencurian token | Tidak ada `v-html`/`innerHTML`; Supabase menyimpan sesi di storage internal library; CSP belum diaktifkan (lihat batasan) |

## 4. Matriks peran yang diuji

| Kapabilitas | owner | cashier | inventory_staff |
| --- | --- | --- | --- |
| `dashboard.view` | ✅ | ✅ | ✅ |
| `catalog.read` | ✅ | ✅ | ✅ |
| `catalog.manage`, `cost.read` | ✅ | — | — |
| `sale.create`, `sale.read.own` | ✅ | ✅ | — |
| `sale.read.all`, `sale.void` | ✅ | — | — |
| `inventory.read`, `opname.create`, `opname.count`, `report.stock` | ✅ | — | ✅ |
| `opname.approve`, `report.sales`, `settings.manage`, `users.manage` | ✅ | — | — |

Matriks ini hanya mengatur tampilan. Otorisasi final tetap RLS + RPC; kasir
yang memanggil RPC owner langsung dari konsol tetap ditolak (diuji hosted).

## 5. Checklist UAT

Jalankan berurutan pada project preview; migrasi 5A + Realtime sudah diterapkan,
jadi halaman opname dan badge stok Realtime bisa diuji. Setiap langkah dicatat:
tanggal, akun, hasil, dan tangkapan layar bila gagal.

### 5.1 Persiapan

- [ ] `npm run build` dan `npm run audit:bundle` bersih.
- [ ] `npm run test:db` 88/88 dan `npm test` 257/257.
- [x] Migrasi 5A + Broadcast diterapkan ke preview setelah persetujuan owner
      (setara `APPROVE PHASE 5A MIGRATION TO PREVIEW`), 4 November 2026.
- [ ] Tiga akun uji aktif: owner, kasir, staf gudang; satu akun nonaktif.
- [ ] Katalog 1.360 produk terlihat; produk stok `NULL` tampil “—”.

### 5.2 Owner

- [ ] Login, dashboard menampilkan ringkasan tanpa angka margin/laba kotor.
- [ ] Buat kategori baru, ubah nama, nonaktifkan; duplikat nama ditolak.
- [ ] Buat produk baru; isi `stock_on_hand` di payload diabaikan (stok tetap
      `NULL`), `stock_version` tetap 0.
- [ ] Isi harga beli; hanya owner yang bisa membacanya.
- [ ] Nonaktifkan akun kasir lalu coba login: profil terbaca, operasi ditolak.
- [ ] Coba nonaktifkan owner terakhir: ditolak.
- [ ] `/settings`: nyalakan printer, simpan; matikan lagi. Isi `public_config`
      dengan key mirip rahasia (`api_key`) — harus dibuang setelah simpan.
- [ ] `/reports`: pilih rentang tanggal, ekspor CSV, buka di Excel; nilai
      kosong tetap kosong (bukan 0), BOM UTF-8 terbaca.
- [ ] `/reports/exceptions`: daftar exception katalog/legacy tampil dan
      penanda “terpotong” muncul bila > 5000 baris.

### 5.3 Kasir

- [ ] Login kasir: sidebar hanya Dasbor, Produk, Kasir, Riwayat Transaksi.
- [ ] Buka `/settings` langsung lewat URL → 403, bukan halaman kosong.
- [ ] Cari produk dengan SKU persis; scanner keyboard-wedge menambahkan SKU
      yang sama, bukan hasil mirip.
- [ ] Checkout tunai: uang diterima < total ditolak; kembalian benar.
- [ ] Checkout QRIS manual: status pembayaran tercatat, tidak ada panggilan
      gateway.
- [ ] Checkout split tunai + QRIS: total pembayaran harus sama dengan total.
- [ ] Klik “Bayar” dua kali / refresh saat submit: hanya satu transaksi
      (idempotency key), stok berkurang sekali.
- [ ] Produk stok `NULL` tidak bisa dijual dan menampilkan alasan.
- [ ] Cetak nota: dialog browser terbuka; bila diblokir, transaksi tetap
      tersimpan dan pesan muncul.
- [ ] Riwayat: filter tanggal/nota/status; detail memakai snapshot, bukan harga
      produk terkini.
- [ ] Kasir tidak melihat tombol void dan tidak bisa memanggil `void_sale`.

### 5.4 Staf gudang

- [ ] Login: menu Inventaris dan Stok Opname terlihat; Kasir dan Laporan
      Penjualan tidak.
- [ ] `/inventory`: filter saldo belum diketahui/negatif/kosong bekerja; saldo
      `NULL` tampil “—”.
- [ ] `/inventory/movements`: filter jenis dan rentang tanggal.
- [ ] `/stock-opname`: buat sesi seluruh katalog; hitung beberapa item;
      submit; owner menyetujui; posting.
- [ ] Setelah posting: saldo berubah, `stock_movements` bertambah, laporan
      selisih menampilkan alasan.
- [ ] Ubah hitungan pada sesi yang sudah posted → ditolak.
- [ ] Batalkan sesi berstatus `counting` dengan alasan → final, stok tidak
      berubah.
- [ ] Coba buka `/reports` dan `/settings` lewat URL → 403.

### 5.5 Skenario konkurensi & idempotensi (hosted)

- [ ] Dua kasir menjual produk stok 1 bersamaan → tepat satu berhasil, satu
      menerima pesan stok tidak cukup.
- [ ] Retry dengan idempotency key sama → nota sama, stok berkurang sekali.
- [ ] Idempotency key sama dengan keranjang berbeda → ditolak.
- [ ] Dua request `post_stock_opname` bersamaan → satu posting, satu replay
      `already_processed`.
- [ ] Void oleh owner mengembalikan stok tepat sekali; void ulang ditolak.
- [ ] Rekonsiliasi: `sum(payments) = grand_total`, `sum(ledger) = stok akhir`,
      audit lengkap untuk setiap transaksi uji.

## 6. Batasan yang harus disampaikan ke owner

- **Migrasi 5A sudah di preview, produksi belum.** Halaman opname/inventaris
  dan Broadcast stok bisa diuji hosted; produksi belum menerima migrasi apa pun
  dan masih menunggu prasyarat di bagian 6 serta persetujuan owner.
- **Perangkat keras nyata belum diuji.** Printer diuji sebagai dialog browser;
  bridge thermal dan scanner fisik belum tersedia di lingkungan ini.
- **QRIS dinamis tidak tersedia.** Build ini SPA tanpa server route; gateway
  sungguhan butuh Nitro/server dan penyimpanan secret di server. QRIS manual
  tetap berfungsi.
- **Margin/laba kotor tidak disajikan.** 119 produk tidak punya harga beli dan
  tidak ada histori biaya per tanggal (PRD §5.5).
- **CSP belum diaktifkan.** Tidak ada `innerHTML`/`v-html`, tetapi header
  keamanan (CSP, HSTS) harus dipasang di lapisan hosting sebelum produksi.
- **Tanpa mode offline.** Koneksi terputus berarti operasi gagal dengan pesan,
  bukan antrean lokal.
- **Rate limit login** bergantung pada Supabase Auth; aktifkan pengaturan
  bawaan sebelum go-live.

## 7. Definition of done Phase 8

Phase 8 dinyatakan selesai bila: audit bundle bersih, grup I lulus, seluruh
checklist di atas dieksekusi pada preview (migrasi 5A + Realtime sudah
diterapkan), temuan diklasifikasikan (blocker / minor / catatan), dan owner
menandatangani daftar batasan di bagian 6. Sampai checklist dijalankan, status
yang jujur adalah **“siap UAT di preview”**.
