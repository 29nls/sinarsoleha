# 13 — UI Inventaris (Phase 5C)

Halaman baca-saja untuk INV-01 (saldo stok + histori mutasi) dan INV-09
(laporan selisih stok). Tidak ada RPC baru dan **tidak ada migrasi baru**: semua
data sudah ada di `products`, `stock_movements`, dan `stock_discrepancy_logs`.

## Rute

| Rute | Isi |
| --- | --- |
| `/inventory` | Saldo stok per produk: SKU, nama, kategori, stok, satuan, batas rendah, status. |
| `/inventory/movements` | Histori pergerakan: waktu, produk, jenis, delta, qty sebelum/sesudah, alasan, aktor, referensi. |
| `/inventory/discrepancies` | Selisih opname: sistem, fisik, delta, alasan, penghitung, penyetuju, revisi. |

Ketiganya memakai `definePageMeta({ capability: 'inventory.read' })`, sehingga
hanya owner dan `inventory_staff` yang bisa membuka; kasir dan anon ditolak
oleh middleware yang sudah ada. Entri sidebar `inventory` kini
`available: true`.

## Keputusan desain

- **Tiga rute, satu tab bar.** Tabel saldo bisa sangat panjang, sedangkan
  histori dan selisih punya filter berbeda. Memisahkan rute menjaga URL bisa
  dibagikan dan menghindari satu halaman dengan tiga query berat sekaligus.
- **Tanpa join `profiles` untuk nama.** Policy `profiles_select_self_or_owner`
  hanya mengizinkan owner membaca semua profil. Service tetap mencoba embed
  `profiles(full_name)`; untuk staf hasilnya `null` dan UI menampilkan
  `Anda` (jika id sama) atau `Staf <8 karakter id>`. Tidak ada nama palsu.
- **Saldo `NULL` tetap `NULL`.** `stock_on_hand` bisa belum diketahui untuk
  1.360 produk impor. UI menampilkan `—` dan tag "Belum diketahui"; tidak
  pernah dirender sebagai `0`.
- **Filter "stok rendah" dihitung di klien, bukan diabaikan.** PostgREST tidak
  bisa membandingkan dua kolom (`stock_on_hand <= low_stock_threshold`), jadi
  service memindai katalog bertahap 1.000 baris (batas
  `LOW_STOCK_SCAN_LIMIT = 5000`), memfilter `stok > 0 && stok <= batas`, lalu
  memotong halaman yang diminta. Total dan paginasi tetap benar karena
  pemotongan dilakukan setelah filter, bukan per halaman. Stok `NULL` dan `0`
  tidak dihitung rendah — keduanya punya filter sendiri (belum diketahui /
  habis). Bila katalog melewati 5.000 baris, filter hanya memindai 5.000 baris
  pertama dan angka tidak boleh dianggap sensus penuh.
- **Ekspor CSV hanya untuk halaman yang tampil.** Tombol berbunyi "Ekspor
  halaman (CSV)" dan berkasnya memuat baris pada halaman aktif dengan filter
  aktif, bukan seluruh hasil. Ekspor seluruh katalog bukan tujuan tabel ini;
  angka penuh tetap milik laporan.
- **Tanggal dalam zona Jakarta.** `date` dari `<input type="date">` diperluas
  menjadi `T00:00:00+07:00` dan `T23:59:59.999+07:00` agar rentang satu hari
  tetap inklusif, sama seperti `business_date` transaksi.
- **Pencarian produk lewat relasi.** Movement dan discrepancy mencari dengan
  `or(..., { referencedTable: 'products' })` pada `sku_normalized` dan
  `normalized_name`, memakai `products!inner` supaya baris tanpa produk tidak
  muncul. Nilai di-escape dan di-quote agar karakter `%`, `_`, koma, atau
  tanda kurung tidak menyuntik filter lain.
- **Request-id guard.** Setiap ketikan memulai query; respons lama dibuang
  bila ada request lebih baru, sehingga tabel tidak berkedip menampilkan
  hasil usang.

## Peta berkas

| Berkas | Peran |
| --- | --- |
| `app/types/inventory.ts` | Tipe baris, label jenis movement, filter kosong, error mapping, batas hari Jakarta. |
| `app/services/inventory.ts` | `listStockBalances`, `listStockMovements`, `listStockDiscrepancies`. |
| `app/composables/useInventory.ts` | `usePagedList` internal + `useStockBalances`, `useStockMovements`, `useStockDiscrepancies`. |
| `app/components/inventory/InventoryTabs.vue` | Navigasi antar tiga rute. |
| `app/components/inventory/StockBalanceFilters.vue` | Pencarian, filter saldo, ukuran halaman. |
| `app/components/inventory/StockBalanceTable.vue` | Tabel saldo + tautan "Histori". |
| `app/components/inventory/MovementTable.vue` | Tabel ledger dengan delta berwarna. |
| `app/components/inventory/DiscrepancyTable.vue` | Tabel selisih + status persetujuan. |
| `app/pages/inventory/index.vue` | Halaman saldo. |
| `app/pages/inventory/movements.vue` | Halaman pergerakan; menerima `?product=SKU`. |
| `app/pages/inventory/discrepancies.vue` | Halaman selisih. |
| `tests/inventory.test.ts` | 12 tes helper tipe dan error. |
| `tests/inventory-queries.test.ts` | 12 tes bentuk query, pemetaan baris, dan filter stok rendah. |

## Perilaku penting

- Tautan "Histori" pada tabel saldo membuka
  `/inventory/movements?product=<SKU>`; halaman pergerakan mengisi kolom cari
  sekali dari query tersebut.
- Delta ditampilkan bertanda (`+`/`−`) dengan warna berbeda untuk masuk dan
  keluar; `quantity_before` yang `NULL` (saldo awal) tetap `—`.
- Baris selisih tanpa `approved_by` diberi tag "Belum disetujui".
- Semua tabel memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, dan
  `.notice` dari `app/assets/css/main.css`; tidak ada gaya baru.
- Tombol "Ekspor halaman (CSV)" tersedia di tabel saldo dan laporan selisih.
  CSV dibuat di browser dengan `toCsv` + `downloadCsv` (BOM UTF-8), memakai
  label yang terbaca (mis. status saldo dan alasan selisih), dan nilai `null`
  menjadi sel kosong — bukan `0`.
- Catatan di bawah tabel saldo menyebut filter aktif dan menjelaskan bahwa
  angka dihitung di browser, sehingga pengguna tidak menyangka filter server.

## Batasan

- Ledger bersifat immutable (trigger menolak UPDATE/DELETE). Halaman ini murni
  baca; koreksi dilakukan dengan movement baru lewat opname, bukan edit.
- Ekspor CSV hanya mencakup satu halaman, bukan seluruh hasil filter; belum
  ada ekspor Excel dan belum ada grafik tren.
- Filter stok rendah memindai maksimal 5.000 produk. Katalog saat ini 1.360,
  jadi batas belum tercapai, tetapi katalog yang jauh lebih besar akan membuat
  filter ini tidak lengkap dan perlu dipindahkan ke view/RPC.
- Halaman ini tetap baca manual: Realtime `store:stock` hanya dipasang di
  layar kasir (`docs/18-realtime-stock.md`), jadi pengguna lain masih perlu
  "Muat ulang" untuk melihat movement terbaru di sini.
- Migrasi Phase 5A **sudah diterapkan ke preview** `ptbllrugrjepdhhdkzxn`
  (4 November 2026), sehingga ketiga halaman bisa memuat ledger hosted.
  Produksi tidak disentuh.
