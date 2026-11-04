# Katalog Produk — Phase 3A

**Status: selesai untuk preview.** Halaman katalog memakai data Supabase nyata. Impor massal 1.361 produk, modul kasir, checkout, dan koreksi stok belum termasuk Phase 3A. Phase 3B sudah diimpor ke preview (1.360 produk pada 3 November 2026, ditambah `WAL-W1303` pada 4 November 2026 setelah koreksi harga), seluruhnya dengan stok `NULL`; detail di `docs/06-product-master-import.md`.

## Route dan halaman

| Route | Akses | Isi |
| --- | --- | --- |
| `/products` | `catalog.read` (owner, kasir, staf gudang) | Daftar produk, pencarian, filter, pagination |
| `/products` (aksi) | `catalog.manage` (owner) | Tambah/edit/nonaktifkan produk, harga beli, kategori |

Kasir dan staf gudang mendapat tampilan baca-saja. Kolom harga beli dan masalah data tidak dirender, dan service tidak meminta data itu untuk peran non-owner. RLS tetap menjadi penentu akhir.

## Struktur frontend

| Lapisan | File | Tanggung jawab |
| --- | --- | --- |
| Halaman | `app/pages/products/index.vue` | Menyusun filter, tabel, dialog, dan aksi owner |
| Composable | `app/composables/useProductCatalog.ts` | State filter, debounce 150 ms, request terbaru, pagination, refresh |
| Service | `app/services/catalog.ts` | Query PostgREST, join kategori/satuan, biaya, issue, RPC |
| Tipe | `app/types/catalog.ts` | View model katalog dan form |
| Util | `app/utils/catalog.ts` | Validasi, payload tanpa stok, label, status stok, filter pencarian |
| Tabel | `app/components/catalog/ProductTable.vue` | Tabel padat, status, aksi, empty/loading/error |
| Filter | `app/components/catalog/ProductFilters.vue` | Pencarian, kategori, satuan, status, kualitas data, page size |
| Form | `app/components/catalog/ProductFormDialog.vue` | Create/edit dengan validasi |
| Biaya | `app/components/catalog/ProductCostDialog.vue` | Harga beli owner-only |
| Kategori | `app/components/catalog/CategoryManagerDialog.vue` | Tambah, ubah nama, aktif/nonaktif |

Komponen tidak memanggil Supabase langsung. Semua akses data melewati service; komponen menerima props dan mengirim event.

## Pencarian, filter, dan pagination

- Pencarian memakai `sku_normalized` exact, awalan SKU, dan `normalized_name` contains.
- Input di-debounce 150 ms. Request lama diabaikan memakai nomor urut request.
- Filter: kategori, satuan, status aktif, harga jual kosong, stok tidak diketahui, stok negatif, status review.
- Pagination server-side memakai `range()` dan `count: 'exact'`; pilihan 25, 50, atau 100 baris, default 50.
- Urutan stabil: `sku_normalized`, lalu `name`.
- Query hanya mengambil satu halaman. Tidak ada pemuatan seluruh katalog.

Target P95 < 300 ms belum diukur pada jaringan toko. Angka itu tetap target, bukan klaim.

## Aturan tampilan

- `stock_on_hand NULL` tampil sebagai `—` dengan label "Belum diketahui"; tidak pernah menjadi `0`.
- Stok `0` = "Stok habis"; stok negatif diberi label dan warna bahaya.
- `sale_price NULL` tetap kosong dan ditandai "Harga jual belum tersedia".
- `purchase_cost NULL` tampil `—`; tidak dihitung sebagai nol.
- `import_review_status` dan `product_data_issues` ditampilkan sebagai label status.
- Tidak ada gambar, thumbnail, galeri, atau ilustrasi produk.
- Dialog memakai elemen native `dialog`, dapat ditutup dengan Escape, dan setiap field punya label.

## RPC dan izin

| Operasi | Jalur | Izin |
| --- | --- | --- |
| Baca produk/kategori/satuan | PostgREST SELECT | RLS staff aktif; produk nonaktif hanya owner/gudang |
| Baca harga beli | `product_costs` SELECT | Owner saja |
| Baca masalah data | `product_data_issues` SELECT | Owner saja |
| Create/update/nonaktifkan produk | `public.upsert_product(jsonb)` | Owner aktif; stok tidak disentuh |
| Harga beli | `public.set_product_cost(uuid, numeric)` | Owner aktif |
| Kategori | `public.upsert_category(jsonb)` | Owner aktif; audit; tanpa hard delete |

Payload produk tidak pernah memuat `stock_on_hand`, `stock_version`, `quantity_before`, atau `quantity_after`. Perubahan stok tetap menjadi tanggung jawab Phase 5.

## Pengujian

- `npm test`: 4 file, 28 tes, termasuk render tabel (loading, kosong, null, stok negatif, kolom owner), validasi form, payload tanpa stok, debounce, pagination, dan pesan error.
- `npm run test:db`: 22/22, termasuk RPC kategori, duplikat nama, audit, dan penolakan kasir.
- `npm run test:hosted`: 22 lulus, 0 gagal, 1 skip (expired token), termasuk query halaman dengan join kategori/satuan, pencarian SKU exact, RPC kategori, dan RLS biaya.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- Browser owner (preview): `/products` memuat data Supabase nyata (5 produk uji), pencarian SKU exact menyaring ke 1 hasil, validasi form kosong muncul, dialog kategori/biaya/edit terbuka dengan nilai yang benar, dan logout kembali ke login. Tidak ada error console.

## Batasan Phase 3A

- Impor master 1.361 produk (Phase 3B) sudah dijalankan ke preview pada 3 November 2026 dengan stok `NULL`.
- Belum ada seed kategori legacy; kategori dibuat lewat UI/RPC.
- Harga beli tidak ditampilkan ke kasir/gudang.
- Belum ada koreksi stok, opening balance, atau opname di halaman katalog.
- Expired token belum diuji. Alur browser owner sudah diuji; tampilan baca-saja kasir/gudang belum diuji browser (diverifikasi lewat SSR dan hosted RLS).
- Filter dan pencarian belum diukur P95 pada dataset penuh.

## Phase 3B — impor master

- Pipeline `scripts/product-import.mjs` membaca workbook `PART MASTER`, memvalidasi 1.361 baris, dan menulis lima laporan ke `.tmp/`; dry-run tidak memanggil Supabase.
- Hasil: 1.360 baris siap, 1 baris review (`WAL-W1303`, harga jual di bawah biaya), 0 rejected, 203 kategori, 8 kode satuan. Baris review tersebut diselesaikan 4 November 2026 lewat `resolve_product_import_review` (migrasi `20261106120000`), sehingga total impor menjadi 1.361.
- Migrasi `20261103090000_product_import.sql` menambah staging owner-only dan RPC impor; sudah diterapkan ke preview.
- Impor 3 November 2026 (run `530bafe6…`) menghasilkan 1.360 produk; semuanya `stock_on_hand NULL` dengan `stock_version = 0`, tanpa movement atau opname.
- 1.507 isu harga/stok tercatat: 28 produk tanpa harga jual, 119 tanpa biaya, 37 stok sumber negatif, 1.323 stok tidak diketahui.
- Detail dan rekonsiliasi ada di `docs/06-product-master-import.md`.
