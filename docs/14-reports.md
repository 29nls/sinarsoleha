# 14 — Laporan (Phase 6)

Laporan baca-saja untuk RPT-01 (pendapatan penjualan), RPT-02 (ringkasan
harian), RPT-03 (penjualan per produk), dan RPT-06 (exception data). Tidak ada
tabel agregat, RPC, atau migrasi baru: semua angka dihitung dari baris yang
sudah ada. RPT-04 dan RPT-05 sudah tersedia lebih dulu sebagai halaman
inventaris (`/inventory/discrepancies`, `/inventory/movements`).

## Rute

| Rute | Isi |
| --- | --- |
| `/reports` | Ringkasan harian + rincian pendapatan per nota, dengan ekspor CSV masing-masing. |
| `/reports/products` | Penjualan per produk: kuantitas, nilai kotor, diskon baris, nilai bersih, jumlah nota. |
| `/reports/exceptions` | Exception katalog dan transaksi legacy, dikelompokkan per kategori dengan hitungan. |

Ketiganya memakai `definePageMeta({ capability: 'report.sales' })`. Pada matriks
peran saat ini hanya owner yang memiliki capability tersebut; kasir dan
`inventory_staff` tidak melihat entri sidebar maupun halaman. Ini konsisten
dengan RLS: `product_costs` hanya terbaca owner dan policy transaksi kasir
membatasi baris ke miliknya sendiri, sehingga laporan penjualan penuh memang
tidak boleh disajikan ke kasir.

## Keputusan desain

- **Agregasi di klien, bukan view baru.** PostgREST tidak mendukung
  `GROUP BY`. Membuat view teragregasi berarti migrasi baru dan satu lagi
  definisi "penjualan bersih" yang bisa menyimpang dari `transactions`.
  Layanan mengambil baris mentah lalu `summarizeSales`/`salesTotals`
  meringkasnya, sehingga angka selalu bisa ditelusuri ke nota asalnya.
- **Batas 5000 baris yang jujur.** Setiap loader memakai
  `REPORT_ROW_LIMIT = 5000` dan meminta `count: 'exact'`. Bila `count` lebih
  besar dari baris yang termuat, hasil ditandai `truncated` dan UI menampilkan
  peringatan agar periode dipersempit — bukan diam-diam menampilkan total
  parsial seolah lengkap.
- **Hanya transaksi selesai.** Laporan penjualan default `status = completed`.
  Service menerima `status: 'all' | 'voided'` untuk kebutuhan audit, tetapi UI
  tidak mencampur nota batal ke pendapatan.
- **Pembayaran campuran ditandai `split`.** Satu nota bisa punya beberapa baris
  `payments`. `reportPaymentMethod` mengembalikan metode tunggal bila semua
  baris sama, dan `split` bila benar-benar berbeda; tidak mengambil baris
  pertama secara sembarang. Komposisi tunai/QRIS/lainnya pada ringkasan
  memakai `grand_total` per nota, sehingga total ketiga kolom sama dengan
  penjualan bersih.
- **Per produk memakai snapshot.** Pengelompokan memakai `product_id`; baris
  legacy tanpa mapping dikelompokkan sebagai `sku:<sku_snapshot>` supaya tidak
  hilang. Nama, satuan, dan harga diambil dari snapshot baris transaksi, bukan
  dari katalog saat ini, agar laporan historis tidak berubah ketika produk
  diedit.
- **Exception menggabungkan dua sumber.** Katalog: stok `NULL`, stok negatif,
  harga jual kosong, harga beli kosong/tanpa baris `product_costs`, dan
  `import_review_status != 'verified'`. Transaksi:
  `reconciliation_status != 'matched'`. Tidak ada baris exception yang
  diciptakan untuk data yang sehat.
- **Tanpa margin/laba kotor.** PRD §5.5 menyatakan margin historis tidak boleh
  disajikan sebagai angka akurat selama 119 harga beli kosong dan belum ada
  histori biaya per tanggal. Karena itu tidak ada kolom margin, total laba,
  atau grafik laba di halaman mana pun; halaman per produk menampilkan notice
  yang menjelaskan alasannya.
- **CSV dibuat di browser.** `toCsv` meng-quote nilai yang mengandung koma,
  kutip, titik koma, atau baris baru; `null` menjadi sel kosong supaya angka
  tidak diketahui tidak terbaca sebagai nol. `downloadCsv` menambahkan BOM
  UTF-8 agar Excel membaca aksara Indonesia dengan benar. Tidak ada unggahan ke
  Supabase Storage.
- **Rentang tanggal zona Jakarta.** Preset (hari ini, 7 hari, 30 hari, bulan
  ini) dihitung dari `jakartaToday()`, bukan jam server. `business_date` adalah
  `date`, jadi filter cukup `gte/lte` tanpa konversi zona; helper batas hari
  Jakarta tetap dipakai halaman inventaris dan tidak diduplikasi di modul
  laporan.
- **State rentang dibagi antar-tab.** Rentang disimpan di `useState`
  (`reports:range`, `reports:preset`) karena setiap rute laporan memasang
  instance halaman baru. Berpindah tab mempertahankan periode yang sedang
  dibaca, dan `normalizeRange` membalik rentang terbalik alih-alih menolaknya.
- **Muat sesuai halaman.** `useReports({ autoLoad })` hanya menjalankan query
  yang dipakai halaman itu; halaman exception tidak ikut menarik ribuan baris
  transaksi. Setiap loader tetap punya request-id sendiri sehingga respons
  lama tidak menimpa hasil rentang terbaru.

## Peta berkas

| Berkas | Peran |
| --- | --- |
| `app/types/reports.ts` | Tipe baris/result, label kategori exception, preset & normalisasi rentang, `summarizeSales`, `salesTotals`, pembulatan, pemetaan error, `toCsv`, `csvFileName`. |
| `app/services/reports.ts` | `reportPaymentMethod`, `loadSalesReport`, `loadProductSalesReport`, `loadExceptionReport`. |
| `app/composables/useReports.ts` | Rentang bersama, preset, request-id guard, `refresh` sesuai scope halaman. |
| `app/utils/download.ts` | `downloadCsv` (Blob + BOM UTF-8). |
| `app/components/reports/ReportsTabs.vue` | Navigasi tiga rute laporan. |
| `app/components/reports/ReportRangePicker.vue` | Preset, input dari/sampai, tombol muat ulang. |
| `app/components/reports/SalesSummaryTable.vue` | Ringkasan harian + baris total periode. |
| `app/components/reports/SalesDetailTable.vue` | Rincian per nota dengan tautan ke detail transaksi. |
| `app/components/reports/ProductSalesTable.vue` | Tabel penjualan per produk. |
| `app/components/reports/ExceptionTable.vue` | Tabel exception dengan tag kategori. |
| `app/pages/reports/index.vue` | Halaman ringkasan + rincian. |
| `app/pages/reports/products.vue` | Halaman penjualan per produk. |
| `app/pages/reports/exceptions.vue` | Halaman exception data. |
| `tests/reports.test.ts` | 13 tes helper: rentang, agregasi, pembulatan, CSV, error. |
| `tests/reports-queries.test.ts` | 13 tes bentuk query dan pemetaan baris. |

## Perilaku penting

- Tautan nomor nota di rincian membuka `/cashier/transactions/<id>`; tidak ada
  data transaksi yang diduplikasi ke halaman laporan.
- Nota tanpa baris `payments` menampilkan `—`, bukan "Tunai".
- Baris exception transaksi legacy menaut ke detail transaksinya; baris
  katalog menampilkan SKU tanpa tautan karena halaman katalog belum punya rute
  detail per produk.
- Semua tabel memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, dan
  `.notice` dari `app/assets/css/main.css`; tidak ada gaya baru.
- Ekspor dinonaktifkan selama data belum termuat, sehingga tidak ada berkas
  kosong yang bisa disalahartikan sebagai "tidak ada penjualan".

## Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0, tanpa peringatan duplikasi auto-import |
| `npm test` | **187/187 lulus** (14 file; 26 tes laporan baru) |
| `npm run build` | exit 0 (15,5 dtk; 1,92 MB / 474 kB gzip) |

## Batasan

- **Belum diuji ke data hosted.** Halaman dapat dibuka di lokal dengan akun
  owner, tetapi verifikasi angka terhadap data preview belum dilakukan.
- **Tanpa pagination.** Satu periode dibatasi 5000 baris; periode yang lebih
  padat harus dipersempit. Ini disengaja agar laporan tidak menggantung, tetapi
  belum ada tombol "muat berikutnya".
- **Tanpa filter kasir/status di UI.** Service mendukung `status`, UI selalu
  memakai `completed`. Filter per kasir belum ada karena laporan ditujukan ke
  owner yang melihat seluruh toko.
- **Tanpa grafik tren.** Ringkasan disajikan sebagai tabel; belum ada chart.
- **Exception katalog dibaca maksimal 5000 produk.** Saat ini katalog 1.360
  produk sehingga aman, tetapi bila katalog tumbuh melewati batas, sebagian
  exception tidak termuat dan UI menampilkan peringatan.
- **RPT-04/RPT-05 tidak diduplikasi di sini.** Keduanya sudah ada di halaman
  inventaris; tab laporan sengaja tidak menautkannya lagi agar tidak ada dua
  tempat dengan definisi berbeda.
