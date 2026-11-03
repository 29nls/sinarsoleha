# Antarmuka Kasir — Phase 4B

**Status: checkout hosted aktif; acceptance Phase 4D lulus — lihat `docs/10-transaction-release-validation.md`.**
Halaman `/cashier` sudah terhubung ke `public.complete_sale` dan mengirim transaksi nyata. Tidak ada perubahan stok langsung atau seed stok ke produk operasional.

## Acceptance Phase 4B yang masih tertunda

- Checkout hosted melalui `complete_sale`, termasuk transaksi sukses dan otoritas RLS dua sesi kasir.
- Retry idempotensi, pembayaran, dan hasil `already_processed` diverifikasi pada Supabase preview dengan fixture produk berstok.
- Pencarian dan batas akses data kasir diverifikasi hosted.
- Browser E2E untuk alur kasir: **lulus 10/10 pada Phase 4D** — lihat `docs/10-transaction-release-validation.md`.
- (Historis) Prasyarat Phase 4B awal: preview 0 produk berstok dan satu akun kasir; keduanya sudah tersedia sejak Phase 2B/4D.

Seluruh acceptance di atas sudah lulus pada Phase 4D; catatan historis di bawah dipertahankan apa adanya.

## 1. Hasil audit Phase 4A.1

Audit dilakukan ulang sebelum UI dibuat:

| Yang diperiksa | Temuan |
| --- | --- |
| Migrasi 4A | `transactions.request_fingerprint` dan wrapper `complete_sale`/`void_sale` ada di preview; riwayat migrasi CLI tidak terbaca (tanpa access token/link) |
| Otorisasi hosted | anon/gudang/nonaktif `42501`; kasir mencapai fungsi (`P0002`); kasir void `42501`; owner void mencapai fungsi |
| Fixture stok | 0 produk preview dengan `stock_on_hand` tidak `NULL`; 0 transaksi |
| Sesi kasir | hanya satu akun kasir; syarat dua sesi independen belum terpenuhi |
| Uji konkurensi/idempotensi/void/pembayaran hosted | **belum dijalankan**; `npm run test:hosted:transactions` berhenti dengan `BLOCKED: akun kasir kedua belum ada` |

Tidak ada hasil hosted yang difabrikasi. UI dibangun terhadap kontrak RPC di
`docs/07-transaction-engine.md`; produk impor tetap `stock_on_hand NULL` dan tidak dapat dijual.

## 2. Rute dan otorisasi

- Rute: `/cashier`.
- `definePageMeta({ capability: 'sale.create' })`.
- Middleware global mengecek sesi, sesi kedaluwarsa, dan `can(role, capability)`.
- Owner dan kasir aktif memiliki `sale.create`; staf gudang tidak. Akun nonaktif tidak lolos
  pemeriksaan sesi/profil.
- Tidak ada perubahan model otorisasi database. RLS dan RPC tetap penentu akhir.

## 3. Tampilan

- Header operasional: identitas kasir/peran, tanggal bisnis WIB, status online/offline, hint
  shortcut. Logout tetap berada di header layout global.
- Pencarian di panel atas, tabel hasil padat, keranjang di bawahnya, panel pembayaran di kanan
  pada layar lebar.
- **Tidak ada foto, thumbnail, kartu ilustrasi, atau galeri produk.**
- Kolom hasil: SKU, nama, kategori, satuan, harga jual, stok, status ketersediaan, aksi.
- Tipografi kecil, angka tabular (`.num`), tanpa animasi dekoratif.

## 4. Pencarian server-side

`app/services/cashier.ts` hanya memilih:

```text
id, sku, name, unit_id, sale_price, stock_on_hand, is_active,
categories(name), units_of_measure(label, code, decimal_scale)
```

Tidak ada `purchase_cost`/`product_costs` dalam query maupun tipe UI. Pencarian memakai
`buildProductSearchFilter` yang sudah dipakai katalog: exact SKU, prefix SKU, dan nama
contains, dengan quoting/escaping PostgREST. Batas 12 hasil, debounce 150 ms, dan permintaan
lama diabaikan lewat request id. Tidak ada fetch seluruh 1.360 produk.

Status ketersediaan:

| Kondisi | Label | Bisa masuk keranjang |
| --- | --- | --- |
| `is_active = false` | Produk tidak aktif | Tidak |
| `sale_price IS NULL` | Harga belum tersedia | Tidak |
| `stock_on_hand IS NULL` | Stok belum diopname | Tidak |
| `stock_on_hand <= 0` | Stok habis | Tidak |
| Selebihnya | Tersedia | Ya |

`NULL` tidak pernah diubah menjadi 0. Produk dengan stok tidak diketahui tetap terlihat di
hasil pencarian, tetapi tombol tambah dan barisnya dinonaktifkan.

## 5. Keranjang

- Pinia `stores/cashier.ts`; perhitungan murni di `utils/cashier.ts`.
- Produk yang sama selalu digabung menjadi satu baris; quantity ditambah. Ini memenuhi aturan
  backend yang menolak `product_id` duplikat dalam satu payload.
- Tambah, kurangi, ubah quantity manual, hapus baris, dan kosongkan keranjang.
- Quantity mengikuti `units_of_measure.decimal_scale`; unit integer menolak pecahan, unit
  desimal maksimal tiga angka. Stok yang terlihat menjadi batas awal.
- Uang dihitung dalam integer sen di UI (`salePrice × 100 × quantity`) agar penjumlahan tidak
  memakai floating-point sebagai otoritas. Database tetap menghitung ulang total, diskon, dan
  pembayaran.
- `stockError` muncul bila refresh stok membuat quantity keranjang melebihi stok; checkout
  dinonaktifkan sampai kasir mengurangi quantity. Baris tidak dihapus diam-diam.

## 6. Pembayaran

### Tunai

`amount_applied` = total nota; kasir mengisi uang diterima. Kembalian dihitung
`cash_received − amount_applied`; checkout ditolak bila uang diterima kurang. Nilai yang
dikirim dikonversi dari sen ke rupiah.

### QRIS manual

Tidak ada gateway. Kasir harus mencentang:

> Pembayaran QRIS telah diterima dan diverifikasi.

Checkbox ini wajib sebelum `beginCheckout`. Aplikasi tidak mengklaim verifikasi provider.

### Split

Didukung selama total tepat. Contoh: tunai Rp20.000 + QRIS Rp15.000 untuk total Rp35.000.
Setiap baris tunai membutuhkan `cash_received`; baris non-tunai tidak boleh membawa field
tunai. Tombol "Isi sisa" membantu mengisi nominal yang belum dibayar. QRIS pada split tetap
memerlukan konfirmasi manual.

### Diskon

Tidak ada input diskon. Payload selalu `discount_amount: 0`; backend menolak diskon bukan nol
dengan `DISCOUNT_NOT_CONFIGURED`.

## 7. Checkout, idempotensi, dan kegagalan jaringan

Payload hanya berisi kontrak:

```json
{
  "idempotency_key": "uuid",
  "business_date": "YYYY-MM-DD",
  "customer_id": null,
  "discount_amount": 0,
  "items": [{ "product_id": "uuid", "quantity": 2 }],
  "payments": [
    { "method": "cash", "amount_applied": 10000, "cash_received": 20000, "cash_change": 10000 }
  ]
}
```

Tidak ada `cashier_id`, `unit_price`, `stock_on_hand`, `subtotal`, `grand_total`, atau
`receipt_no`.

- Satu UUID dibuat per niat checkout; setiap perubahan keranjang/pembayaran sebelum submit
  membuat niat baru.
- `beginCheckout` menyimpan `lastAttempt` (key + payload persis) sebelum RPC.
- Saat submitting/unknown, `locked` mencegah edit dan klik checkout berulang.
- Timeout/network error (Supabase error tanpa kode) → status `unknown`, keranjang, pembayaran,
  payload, dan key dipertahankan. Setelah gate hosted dibuka, tombol retry mengirim payload yang sama.
- Error validasi backend dengan kode → status `error`; keranjang tetap ada. Halaman menyegarkan
  stok, mempertahankan harga yang dilihat kasir, dan menampilkan pesan operasional.
- Keranjang hanya dikosongkan setelah RPC sukses (termasuk `already_processed: true`).
- `already_processed` tetap menampilkan nota dari transaksi asli; detail diambil dari
  `transactions` + snapshot item/pembayaran.

## 8. Nota

`ReceiptView.vue` menampilkan nomor nota, tanggal bisnis, kasir, transaction ID, item dan
snapshot, quantity, harga satuan, line total, subtotal, diskon, grand total, metode pembayaran,
uang diterima, dan kembalian. Sumber utama adalah respons RPC + query read-only tabel
`transactions` beserta profil kasir tertaut yang diizinkan RLS; bila detail gagal dimuat,
fallback hanya menampilkan nilai RPC yang tersedia dan baris kosong dengan keterangan bahwa
snapshot item tidak tersedia. Nama kasir, pembayaran, dan waktu transaksi tidak direka.
Tidak ada nomor nota atau total yang dibuat di JavaScript.

`window.print()` dan CSS `@media print` menyediakan nota ramah cetak. Integrasi printer termal
dan hardware tetap Phase 7.

## 9. Shortcut

| Tombol | Aksi |
| --- | --- |
| `F2` | Fokus pencarian |
| `↑` / `↓` | Pindah hasil saat fokus di pencarian |
| `Enter` | Pilih hasil; event yang sudah ditangani input tidak diproses dua kali |
| `Delete` | Hapus baris keranjang terpilih (bukan saat mengetik) |
| `Escape` | Tutup nota atau hasil pencarian |
| `F9` | Fokus panel pembayaran |
| `Ctrl+Enter` | Submit checkout setelah validasi |

Shortcut tidak aktif saat fokus berada di input/textarea/select/contenteditable yang relevan,
kecuali navigasi pencarian yang memang berada di input pencarian.

## 10. File

| Kelompok | File |
| --- | --- |
| Halaman | `app/pages/cashier/index.vue` |
| Komponen | `app/components/cashier/CashierHeader.vue`, `ProductSearch.vue`, `ProductResultsTable.vue`, `CartTable.vue`, `PaymentPanel.vue`, `ReceiptView.vue` |
| State | `app/stores/cashier.ts` |
| Composable | `app/composables/useCashierSearch.ts` |
| Service | `app/services/cashier.ts` |
| Utils/tipe | `app/utils/cashier.ts`, `app/utils/receipt.ts`, `app/types/cashier.ts` |
| Tes | `tests/cashier.test.mjs` |
| Modul/dasbor | `app/utils/modules.ts`, `app/pages/dashboard/index.vue` |

## 11. Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | **66/66 lulus** (6 file); termasuk kalkulasi, agregasi, decimal, pembayaran, payload, retry key, otorisasi klien, mapping nota |
| `npm run typecheck` | exit 0 |
| `npm run build` | lihat catatan verifikasi terbaru di `docs/PROGRESS.md` |
| Checkout hosted end-to-end | **lulus** (aktif sejak Phase 4D) |
| Browser E2E kasir | **lulus 10/10** — lihat `docs/10-transaction-release-validation.md` |

Tes unit tidak membuktikan integrasi RPC nyata, konkurensi, atau tampilan browser. Produk impor
tetap tidak dapat dijual selama `stock_on_hand` `NULL`; fixture stok hanya boleh memakai produk
`TEST-` di preview, bukan data operasional.

## 12. Batasan dan pekerjaan berikutnya

1. Owner harus menjalankan fixture preview dan membuat kasir kedua.
2. Jalankan `npm run test:hosted:transactions` untuk race stok, idempotensi, pembayaran, void,
   dan rekonsiliasi.
3. Setelah gate hosted lulus dan checkout diaktifkan, uji browser dua sesi kasir: login,
   pencarian, keranjang, tunai, QRIS manual, split, retry timeout, nota, logout, gudang ditolak.
4. Putuskan kebijakan diskon/refund/QRIS dan window void sebelum produksi.
5. Phase 5 (opname) dan seterusnya tetap di luar lingkup Phase 4B.

## 1. Hasil audit Phase 4A.1

Audit dilakukan ulang sebelum UI dibuat:

| Yang diperiksa | Temuan |
| --- | --- |
| Migrasi 4A | `transactions.request_fingerprint` dan wrapper `complete_sale`/`void_sale` ada di preview; riwayat migrasi CLI tidak terbaca (tanpa access token/link) |
| Otorisasi hosted | anon/gudang/nonaktif `42501`; kasir mencapai fungsi (`P0002`); kasir void `42501`; owner void mencapai fungsi |
| Fixture stok | 0 produk preview dengan `stock_on_hand` tidak `NULL`; 0 transaksi |
| Sesi kasir | hanya satu akun kasir; syarat dua sesi independen belum terpenuhi |
| Uji konkurensi/idempotensi/void/pembayaran hosted | **belum dijalankan**; `npm run test:hosted:transactions` berhenti dengan `BLOCKED: akun kasir kedua belum ada` |

Tidak ada hasil hosted yang difabrikasi. UI dibangun terhadap kontrak RPC di
`docs/07-transaction-engine.md`; produk impor tetap `stock_on_hand NULL` dan tidak dapat dijual.

## 2. Rute dan otorisasi

- Rute: `/cashier`.
- `definePageMeta({ capability: 'sale.create' })`.
- Middleware global mengecek sesi, sesi kedaluwarsa, dan `can(role, capability)`.
- Owner dan kasir aktif memiliki `sale.create`; staf gudang tidak. Akun nonaktif tidak lolos
  pemeriksaan sesi/profil.
- Tidak ada perubahan model otorisasi database. RLS dan RPC tetap penentu akhir.

## 3. Tampilan

- Header operasional: identitas kasir/peran, tanggal bisnis WIB, status online/offline, hint
  shortcut. Logout tetap berada di header layout global.
- Pencarian di panel atas, tabel hasil padat, keranjang di bawahnya, panel pembayaran di kanan
  pada layar lebar.
- **Tidak ada foto, thumbnail, kartu ilustrasi, atau galeri produk.**
- Kolom hasil: SKU, nama, kategori, satuan, harga jual, stok, status ketersediaan, aksi.
- Tipografi kecil, angka tabular (`.num`), tanpa animasi dekoratif.

## 4. Pencarian server-side

`app/services/cashier.ts` hanya memilih:

```text
id, sku, name, unit_id, sale_price, stock_on_hand, is_active,
categories(name), units_of_measure(label, code, decimal_scale)
```

Tidak ada `purchase_cost`/`product_costs` dalam query maupun tipe UI. Pencarian memakai
`buildProductSearchFilter` yang sudah dipakai katalog: exact SKU, prefix SKU, dan nama
contains, dengan quoting/escaping PostgREST. Batas 12 hasil, debounce 150 ms, dan permintaan
lama diabaikan lewat request id. Tidak ada fetch seluruh 1.360 produk.

Status ketersediaan:

| Kondisi | Label | Bisa masuk keranjang |
| --- | --- | --- |
| `is_active = false` | Produk tidak aktif | Tidak |
| `sale_price IS NULL` | Harga belum tersedia | Tidak |
| `stock_on_hand IS NULL` | Stok belum diopname | Tidak |
| `stock_on_hand <= 0` | Stok habis | Tidak |
| Selebihnya | Tersedia | Ya |

`NULL` tidak pernah diubah menjadi 0. Produk dengan stok tidak diketahui tetap terlihat di
hasil pencarian, tetapi tombol tambah dan barisnya dinonaktifkan.

## 5. Keranjang

- Pinia `stores/cashier.ts`; perhitungan murni di `utils/cashier.ts`.
- Produk yang sama selalu digabung menjadi satu baris; quantity ditambah. Ini memenuhi aturan
  backend yang menolak `product_id` duplikat dalam satu payload.
- Tambah, kurangi, ubah quantity manual, hapus baris, dan kosongkan keranjang.
- Quantity mengikuti `units_of_measure.decimal_scale`; unit integer menolak pecahan, unit
  desimal maksimal tiga angka. Stok yang terlihat menjadi batas awal.
- Uang dihitung dalam integer sen di UI (`salePrice × 100 × quantity`) agar penjumlahan tidak
  memakai floating-point sebagai otoritas. Database tetap menghitung ulang total, diskon, dan
  pembayaran.
- `stockError` muncul bila refresh stok membuat quantity keranjang melebihi stok; checkout
  dinonaktifkan sampai kasir mengurangi quantity. Baris tidak dihapus diam-diam.

## 6. Pembayaran

### Tunai

`amount_applied` = total nota; kasir mengisi uang diterima. Kembalian dihitung
`cash_received − amount_applied`; checkout ditolak bila uang diterima kurang. Nilai yang
dikirim dikonversi dari sen ke rupiah.

### QRIS manual

Tidak ada gateway. Kasir harus mencentang:

> Pembayaran QRIS telah diterima dan diverifikasi.

Checkbox ini wajib sebelum `beginCheckout`. Aplikasi tidak mengklaim verifikasi provider.

### Split

Didukung selama total tepat. Contoh: tunai Rp20.000 + QRIS Rp15.000 untuk total Rp35.000.
Setiap baris tunai membutuhkan `cash_received`; baris non-tunai tidak boleh membawa field
tunai. Tombol "Isi sisa" membantu mengisi nominal yang belum dibayar. QRIS pada split tetap
memerlukan konfirmasi manual.

### Diskon

Tidak ada input diskon. Payload selalu `discount_amount: 0`; backend menolak diskon bukan nol
dengan `DISCOUNT_NOT_CONFIGURED`.

## 7. Checkout, idempotensi, dan kegagalan jaringan

Payload hanya berisi kontrak:

```json
{
  "idempotency_key": "uuid",
  "business_date": "YYYY-MM-DD",
  "customer_id": null,
  "discount_amount": 0,
  "items": [{ "product_id": "uuid", "quantity": 2 }],
  "payments": [
    { "method": "cash", "amount_applied": 10000, "cash_received": 20000, "cash_change": 10000 }
  ]
}
```

Tidak ada `cashier_id`, `unit_price`, `stock_on_hand`, `subtotal`, `grand_total`, atau
`receipt_no`.

- Satu UUID dibuat per niat checkout; setiap perubahan keranjang/pembayaran sebelum submit
  membuat niat baru.
- `beginCheckout` menyimpan `lastAttempt` (key + payload persis) sebelum RPC.
- Saat submitting/unknown, `locked` mencegah edit dan klik checkout berulang.
- Timeout/network error (Supabase error tanpa kode) → status `unknown`, keranjang, pembayaran,
  payload, dan key dipertahankan. Setelah gate hosted dibuka, tombol retry mengirim payload yang sama.
- Error validasi backend dengan kode → status `error`; keranjang tetap ada. Halaman menyegarkan
  stok, mempertahankan harga yang dilihat kasir, dan menampilkan pesan operasional.
- Keranjang hanya dikosongkan setelah RPC sukses (termasuk `already_processed: true`).
- `already_processed` tetap menampilkan nota dari transaksi asli; detail diambil dari
  `transactions` + snapshot item/pembayaran.

## 8. Nota

`ReceiptView.vue` menampilkan nomor nota, tanggal bisnis, kasir, transaction ID, item dan
snapshot, quantity, harga satuan, line total, subtotal, diskon, grand total, metode pembayaran,
uang diterima, dan kembalian. Sumber utama adalah respons RPC + query read-only tabel
`transactions` beserta profil kasir tertaut yang diizinkan RLS; bila detail gagal dimuat,
fallback hanya menampilkan nilai RPC yang tersedia dan baris kosong dengan keterangan bahwa
snapshot item tidak tersedia. Nama kasir, pembayaran, dan waktu transaksi tidak direka.
Tidak ada nomor nota atau total yang dibuat di JavaScript.

`window.print()` dan CSS `@media print` menyediakan nota ramah cetak. Integrasi printer termal
dan hardware tetap Phase 7.

## 9. Shortcut

| Tombol | Aksi |
| --- | --- |
| `F2` | Fokus pencarian |
| `↑` / `↓` | Pindah hasil saat fokus di pencarian |
| `Enter` | Pilih hasil; event yang sudah ditangani input tidak diproses dua kali |
| `Delete` | Hapus baris keranjang terpilih (bukan saat mengetik) |
| `Escape` | Tutup nota atau hasil pencarian |
| `F9` | Fokus panel pembayaran |
| `Ctrl+Enter` | Submit checkout setelah validasi |

Shortcut tidak aktif saat fokus berada di input/textarea/select/contenteditable yang relevan,
kecuali navigasi pencarian yang memang berada di input pencarian.

## 10. File

| Kelompok | File |
| --- | --- |
| Halaman | `app/pages/cashier/index.vue` |
| Komponen | `app/components/cashier/CashierHeader.vue`, `ProductSearch.vue`, `ProductResultsTable.vue`, `CartTable.vue`, `PaymentPanel.vue`, `ReceiptView.vue` |
| State | `app/stores/cashier.ts` |
| Composable | `app/composables/useCashierSearch.ts` |
| Service | `app/services/cashier.ts` |
| Utils/tipe | `app/utils/cashier.ts`, `app/utils/receipt.ts`, `app/types/cashier.ts` |
| Tes | `tests/cashier.test.mjs` |
| Modul/dasbor | `app/utils/modules.ts`, `app/pages/dashboard/index.vue` |

## 11. Verifikasi

| Pemeriksaan | Hasil |
| --- | --- |
| `npm test` | **66/66 lulus** (6 file); termasuk kalkulasi, agregasi, decimal, pembayaran, payload, retry key, otorisasi klien, mapping nota |
| `npm run typecheck` | exit 0 |
| `npm run build` | lihat catatan verifikasi terbaru di `docs/PROGRESS.md` |
| Checkout hosted end-to-end | **lulus** (aktif sejak Phase 4D) |
| Browser E2E kasir | **lulus 10/10** — lihat `docs/10-transaction-release-validation.md` |

Tes unit tidak membuktikan integrasi RPC nyata, konkurensi, atau tampilan browser. Produk impor
tetap tidak dapat dijual selama `stock_on_hand` `NULL`; fixture stok hanya boleh memakai produk
`TEST-` di preview, bukan data operasional.

## 12. Batasan dan pekerjaan berikutnya

1. Owner harus menjalankan fixture preview dan membuat kasir kedua.
2. Jalankan `npm run test:hosted:transactions` untuk race stok, idempotensi, pembayaran, void,
   dan rekonsiliasi.
3. Setelah gate hosted lulus dan checkout diaktifkan, uji browser dua sesi kasir: login,
   pencarian, keranjang, tunai, QRIS manual, split, retry timeout, nota, logout, gudang ditolak.
4. Putuskan kebijakan diskon/refund/QRIS dan window void sebelum produksi.
5. Phase 5 (opname) dan seterusnya tetap di luar lingkup Phase 4B.

## Phase 4C: Manajemen Transaksi

Phase 4C menambahkan riwayat transaksi, detail, cetak ulang struk, dan pembatalan transaksi.

### Rute baru

| Rute | Deskripsi |
|------|-----------|
| `/cashier/transactions` | Daftar riwayat dengan filter dan pagination server-side |
| `/cashier/transactions/[id]` | Detail snapshot, cetak ulang, dan void owner-only |

### Keputusan arsitektur

- Detail menggunakan snapshot tersimpan, tidak fetch produk terkini.
- Tidak join `profiles`; nama kasir dari profil auth jika `cashier_id` cocok.
- Void hanya melalui `public.void_sale`; bukan refund.
- Cetak ulang memakai `ReceiptView.vue` yang sudah ada.
- Navigasi menggunakan capability `sale.read.own`.

Lihat `docs/09-transaction-management.md` untuk detail lengkap.
