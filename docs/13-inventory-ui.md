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
- **Filter "stok rendah" tidak di server.** PostgREST tidak bisa membandingkan
  dua kolom (`stock_on_hand <= low_stock_threshold`). Baris rendah tetap
  ditandai `tag-warn` di tabel, dan filter server hanya menyediakan
  unknown/negatif/kosong. Filter rendah menyusul di laporan Phase 6.
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
| `tests/inventory-queries.test.ts` | 10 tes bentuk query dan pemetaan baris. |

## Perilaku penting

- Tautan "Histori" pada tabel saldo membuka
  `/inventory/movements?product=<SKU>`; halaman pergerakan mengisi kolom cari
  sekali dari query tersebut.
- Delta ditampilkan bertanda (`+`/`−`) dengan warna berbeda untuk masuk dan
  keluar; `quantity_before` yang `NULL` (saldo awal) tetap `—`.
- Baris selisih tanpa `approved_by` diberi tag "Belum disetujui".
- Semua tabel memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, dan
  `.notice` dari `app/assets/css/main.css`; tidak ada gaya baru.

## Batasan

- Ledger bersifat immutable (trigger menolak UPDATE/DELETE). Halaman ini murni
  baca; koreksi dilakukan dengan movement baru lewat opname, bukan edit.
- Belum ada ekspor CSV/Excel dan belum ada grafik tren.
- Belum ada Realtime; pengguna lain perlu "Muat ulang" untuk melihat movement
  terbaru.
- Migrasi Phase 5A **masih menunggu approval** untuk diterapkan ke preview
  `ptbllrugrjepdhhdkzxn`. Tanpa migrasi itu tabel ledger belum ada di hosted,
  sehingga ketiga halaman hanya bisa diuji lokal. Produksi tidak disentuh.
