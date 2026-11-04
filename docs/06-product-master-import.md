# Impor Master Produk — Phase 3B

**Status: diterapkan dan diimpor ke preview pada 3 November 2026.**
Run `530bafe6-b037-43c6-bd7b-d885e141f32c` selesai 07:46–07:48 UTC (14:46–14:48 WIB): 1.360 produk diimpor, 1 baris review, 0 ditolak. Semua produk impor memiliki `stock_on_hand NULL`, `stock_version = 0`, dan tidak ada stock movement atau opname. Phase 3A (katalog) selesai untuk preview.

## 1. Sumber

| Item | Nilai |
| --- | --- |
| Workbook | `product-master.xlsx` (salinan `Stok Opname Toko Sinar Soleha - PART MASTER.xlsx`, blob `832298f`) |
| Lokasi kerja | `.tmp/product-master.xlsx` (gitignored) |
| SHA-256 | `48f8b5938ccc0fbe9b10ce78b2e09978791dbfecffe02c3b6d585a46f0643396` |
| Ukuran | 367.616 byte |
| Worksheet | `PART MASTER` |
| Header | baris 2 (`Kode Barang`, `Nama Barang`, `Kategori`, `Unit`, `Stock`, `Harga Jual`, `Harga Beli`, `Margin`) |
| Data | baris 3–1363, 1.361 record |

Kolom I kosong. Formula SKU di `A3:A9397` dan margin di `H3:H3036` berlanjut melewati data. Formula stok adalah array formula `E2:E9397` yang merujuk worksheet `STOCK MASTER`; worksheet itu tidak ada di workbook, sehingga cached value tidak dipercaya dan tidak diimpor ke stok operasional.

## 2. Audit pekerjaan 3B sebelumnya

Tidak ada implementasi 3B di working tree maupun riwayat Git: tidak ada `product_import_runs`, `product_import_rows`, script impor, RPC impor, tes, laporan, atau dokumen 3B. Satu-satunya staging yang ada adalah `legacy_import_runs` / `legacy_transactions_raw` / `legacy_transaction_items_raw` untuk transaksi lama; tabel itu **tidak** dipakai ulang.

Working tree bersih di branch `main`, commit terakhir `5636e8a`. Tidak ada pekerjaan pengguna yang ditimpa.

## 3. Laporan dry-run

Dihasilkan oleh `node scripts/product-import.mjs --dry-run` ke `.tmp/` (gitignored):

| File | Isi |
| --- | --- |
| `product-import-preview.json` | 1.361 baris ternormalisasi + totals + peta kategori/satuan |
| `product-import-summary.md` | 14 angka wajib, rekonsiliasi audit, baris review |
| `product-import-errors.csv` | error dan warning per baris (`severity,source_row,sku,name,field,code,message`) |
| `product-category-map.csv` | label mentah → nama kanonik, jumlah baris, aksi |
| `product-unit-map.csv` | ejaan mentah → kode kanonik, jumlah baris |

Dry-run tidak memanggil Supabase. Tidak ada operasi tulis.

### Hasil

| Metrik | Nilai |
| --- | --- |
| Total baris | 1.361 |
| Ready | 1.360 |
| Review | 1 |
| Rejected | 0 |
| SKU duplikat | 0 |
| Kandidat nama duplikat | 0 |
| Kategori tidak terpetakan | 0 |
| Satuan tidak terpetakan | 0 |
| Harga jual kosong | 28 |
| Harga beli kosong | 119 |
| Stok sumber kosong | 245 |
| Stok sumber negatif | 37 |
| Error formula | 1 (referensi `STOCK MASTER`) |
| Siap diimpor | 1.360 |
| Perlu review manual | 1 |

Rekonsiliasi dengan `docs/00-phase-0-audit.md` cocok pada seluruh metrik: 1.361 record, 204 → 203 kategori, 1.116 stok terisi / 245 kosong / 37 negatif / 0 nol, 28 harga jual kosong, 119 harga beli kosong, 10 ejaan satuan → 8 kode, 1 harga jual di bawah biaya.

### Klasifikasi baris

- **READY (1.360):** SKU dan nama terisi, satuan terpetakan, harga tidak negatif. Termasuk 28 baris tanpa harga jual dan 119 tanpa harga beli; keduanya tetap `NULL`.
- **REVIEW (1):** baris 1305, `WAL-W1303`, `Walpaper Dinding CSB-MGT-05-W` — harga jual 9.500 di bawah harga beli 20.000. Tidak diimpor otomatis; perlu keputusan owner.
- **REJECTED (0):** tidak ada pelanggaran wajib.

### Normalisasi

- SKU: trim dan perbandingan case-insensitive; ejaan asli dipertahankan saat menulis produk.
- Nama: trim dan spasi ganda dirapatkan; tidak ada penggabungan otomatis.
- Kategori: trim spasi, ejaan dan kapitalisasi dipertahankan. Dua label (`PERABOTAN SARINGAN` dan `PERABOTAN SARINGAN `) menyatu menjadi satu nama kanonik; peta kategori menandainya untuk review owner.
- Satuan: `Pcs`/`Pcs ` → `PCS`, `Lusin`/`LUSIN` → `LUSIN`, `Meter`, `Roll`, `Set`, `Pax`, `Pack`, `Karung`. Tidak ada konversi kuantitas.
- Harga: `numeric(14,2)`, kosong tetap `NULL`, negatif dan lebih dari 2 desimal ditolak.
- Stok: `numeric(14,3)` hanya di staging.

## 4. Staging database

Migrasi `supabase/migrations/20261103090000_product_import.sql` (additive, **sudah diterapkan ke preview** 3 November 2026):

| Tabel | Isi |
| --- | --- |
| `product_import_runs` | identitas sumber (nama file, worksheet, SHA-256), status, counter, pelaku, waktu |
| `product_import_rows` | baris mentah + nilai normalisasi, status validasi, issue, `product_id`, waktu impor |

Kolom baris mencakup `raw_payload`, `sku_raw`, `name_raw`, `category_raw`, `unit_raw`, `sale_price_raw`, `purchase_cost_raw`, `stock_raw`, `stock_formula`, `normalized_sku`, `normalized_name`, `normalized_category`, `unit_code`, `unit_id`, `category_id`, `sale_price`, `purchase_cost`, `stock_source`, `validation_status`, `review_status`, `issue_codes`, `error_messages`.

Batasan penting:

- `unique (run_id, source_row_number)` — identitas baris sumber.
- Satu run per `(source_sha256, source_worksheet)` untuk status `running`, `completed`, atau `failed`.
- `sale_price`/`purchase_cost` non-negatif; `imported` konsisten dengan `product_id` + `imported_at`.
- RLS aktif; `anon` tanpa grant; `authenticated` hanya `SELECT`; policy owner-only. Semua tulisan lewat RPC.
- Index: `(run_id, validation_status)`, baris pending `(run_id, source_row_number) where product_id is null`, `product_id`, `normalized_sku`.

Verifikasi hosted read-only setelah migrasi: owner dapat `SELECT` kedua tabel, `anon` ditolak `42501` untuk tabel dan RPC, `finish_product_import` mengembalikan `RUN_NOT_FOUND` untuk UUID acak, dan `stage_product_import_rows` menolak batch kosong dengan `BATCH_SIZE`.

## 5. RPC impor

| RPC | Perilaku |
| --- | --- |
| `public.begin_product_import(jsonb)` | Owner-only. Membuat run baru; mengembalikan run `running`/`failed` yang sama untuk checksum yang sama (resume); menolak run `completed` dengan `IMPORT_ALREADY_COMPLETED`. |
| `public.stage_product_import_rows(uuid, jsonb)` | Owner-only. Batch 1–200 baris, satu statement upsert `ON CONFLICT (run_id, source_row_number)`, tidak menimpa baris yang sudah `imported`. Satuan diresolusi dari `units_of_measure.code`. |
| `public.resolve_product_import_review(uuid, integer, text, numeric, numeric, text)` | Owner-only. Memindahkan baris `review` ke `ready` (dengan koreksi harga) atau `rejected` (dengan alasan), mengisi `reviewed_by`/`reviewed_at`, dan membuka kembali run yang sudah `completed`. Lihat §13. |
| `public.import_product_import_row(uuid, integer)` | Owner-only. Hanya baris `ready`/`failed`. Memanggil `private.upsert_product` (validasi katalog yang sudah ada), lalu `private.set_product_cost` bila ada biaya, menulis `product_data_issues`, menandai baris `imported`, dan audit `product.import`. Idempoten: baris yang sudah punya `product_id` mengembalikan `already_imported`. |
| `public.finish_product_import(uuid, text)` | Owner-only. Menghitung ulang counter; menolak `completed` bila masih ada baris ready yang belum diimpor (`IMPORT_INCOMPLETE`). |

Semua fungsi `SECURITY DEFINER` dengan `search_path = ''`, memakai `private.require_active_role(array['owner'])`, dan wrapper `public` hanya memberi `EXECUTE` ke `authenticated`.

## 6. Keamanan stok (mutlak)

- Payload `upsert_product` tidak pernah memuat `stock_on_hand`, `stock_version`, `quantity_before`, atau `quantity_after`.
- Stok sumber hanya disimpan di `product_import_rows.stock_source` dan `stock_raw`.
- Tidak ada `stock_movements`, `stock_opnames`, `opening_balance`, `opname_adjustment`, atau `manual_adjustment` dari proses impor.
- `post_stock_opname`, `adjust_stock`, dan RPC stok lain tidak dipanggil.
- Produk hasil impor selalu `stock_on_hand IS NULL` dan `stock_version = 0`.
- Isu `stock_unknown` dibuat untuk setiap produk; `negative_stock` untuk baris dengan stok sumber negatif.

## 7. Eksekusi dan idempotensi

```bash
node scripts/product-import.mjs --dry-run            # laporan, tanpa tulis
node scripts/product-import.mjs --apply --batch 50   # setelah approval
node scripts/product-import.mjs --apply --limit 25   # uji batch terbatas
```

Alur `--apply`:

1. Baca `.env`, login owner aktif, verifikasi role dari `profiles`.
2. Hitung SHA-256 workbook, buka/resume run lewat `begin_product_import`.
3. Buat kategori yang belum ada lewat `upsert_category`; kategori yang ada dipakai ulang berdasarkan nama ternormalisasi.
4. Stage baris per batch 50 secara berurutan (tanpa `Promise.all`).
5. Impor baris `ready` satu per satu lewat RPC; setiap baris atomik.
6. Selesaikan run hanya bila tidak ada baris ready tersisa.

Eksekusi 3 November 2026: run `530bafe6…` selesai dalam 103 detik; 1.361 baris staging, 1.360 diimpor, 1 review, 0 ditolak, 0 gagal. Catatan run `Dry-run ready=1360` cocok dengan laporan dry-run, dan 1.360 audit `product.import` tertulis.

Idempotensi:

- Re-stage baris yang sama memperbarui baris yang belum diimpor dan tidak menduplikasi.
- Impor ulang baris yang sama mengembalikan `already_imported` tanpa produk baru.
- SKU yang sudah ada di katalog ditolak dan baris ditandai `rejected`; produk lama tidak ditimpa.
- Run yang gagal dapat dilanjutkan (`begin_product_import` membuka kembali run `failed`), batch yang sudah selesai dipertahankan.
- Kegagalan satu baris membatalkan produk baris itu saja (subtransaksi), baris ditandai `failed`, dan bisa di-stage ulang.

## 8. Rencana dan hasil impor

Rencana di bawah dieksekusi 3 November 2026 dan hasilnya cocok dengan angka dry-run.

| Item | Nilai |
| --- | --- |
| Target | Project preview Supabase yang sama dengan Phase 2B (`ptbllrugrjepdhhdkzxn`), **bukan produksi** |
| Produk layak | 1.360 |
| Dikecualikan | 1 (baris 1305, harga jual di bawah biaya) |
| Manual review | 1 |
| Kategori | 203 nama kanonik (204 label mentah); buat yang belum ada, pakai ulang yang cocok |
| Satuan | 8 kode kanonik dari 10 ejaan; tanpa konversi |
| Harga jual | 1.332 terisi, 28 `NULL` |
| Harga beli | 1.241 baris biaya, 119 `NULL` |
| Stok operasional | seluruh 1.360 produk `NULL`, `stock_version = 0` |
| Status review | 1.296 `stock_unknown`, 36 `negative_opening_stock`, 28 `price_missing` |
| Idempotensi | resume per checksum + `already_imported` per baris |
| Rekonsiliasi | hitung ulang per kategori/satuan, `NULL` harga/biaya, stok `NULL`, tidak ada movement, audit `product.import` |

## 9. Rekonsiliasi pasca-impor

Setelah approval, verifikasi minimal:

```sql
select count(*) from public.products;                                  -- 1.360 baru (di luar data uji lama)
select count(*) from public.products where stock_on_hand is not null;  -- tidak berubah dari sebelum impor
select count(*) from public.products where stock_version <> 0;         -- 0 untuk produk impor
select count(*) from public.stock_movements;                          -- tidak bertambah
select u.code, count(*) from public.products p join public.units_of_measure u on u.id = p.unit_id group by 1;
select c.name, count(*) from public.products p left join public.categories c on c.id = p.category_id group by 1;
select count(*) from public.product_costs where purchase_cost is null;
select count(*) from public.product_data_issues where resolved_at is null;
select * from public.product_import_runs where status = 'completed';
```

Hasil 3 November 2026:

| Pemeriksaan | Hasil |
| --- | --- |
| Produk total | 1.365 (1.360 impor + 5 produk uji `HOST-*` dari 2 November) |
| `stock_on_hand` NULL | 1.365 / 1.365 |
| `stock_version` ≠ 0 | 0 |
| Stock movement / opname | 0 / 0 |
| Harga jual NULL | 28 |
| Biaya | 1.246 (1.241 impor + 5 uji) |
| Isu aktif | 1.507 — 1.323 `stock_unknown`, 119 `purchase_cost_missing`, 37 `negative_stock`, 28 `sale_price_missing` |
| Audit `product.import` | 1.360 |
| SKU duplikat | 0 |
| Kategori | 208 (203 impor + 5 kategori uji Phase 2B) |
| Satuan impor | PCS 1.305, LUSIN 20, METER 14, ROLL 13, SET 4, PAX 2, PACK 1, KARUNG 1 |
| Baris 1305 | `review`, `product_id` NULL — **diselesaikan 4 November 2026**, lihat §13 |

Kegagalan stok (ada `stock_on_hand` tidak `NULL` atau ada movement baru) adalah kegagalan kritis; impor tidak boleh dilaporkan sukses.

## 10. Verifikasi yang dijalankan

| Perintah | Hasil |
| --- | --- |
| `node scripts/product-import.mjs --dry-run` | 1.361 baris, 1.360 ready, 1 review, 0 rejected; 5 laporan dibuat |
| `npm run test:db` | 12 migrasi apply bersih; **32/32 lulus** (termasuk 9 tes impor) |
| `npx vitest run tests/product-import.test.mjs` | **15/15 lulus** |
| `npm test` | 5 file, **43/43 lulus** |
| `npm run gen:types` | `types/database.generated.ts` 43.143 byte |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 (19,1 dtk) |
| Verifikasi hosted read-only | 1 run `completed`; angka di §9 cocok; stok tidak tersentuh |

Cakupan tes impor: otorisasi owner-only (kasir dan anon ditolak), satu run per checksum, staging idempoten, resolusi satuan `Pcs ` → `PCS`, produk baru dengan stok `NULL`, biaya tersimpan, isu stok, impor ulang idempoten, baris review/rejected tidak bisa diimpor, SKU lama tidak ditimpa, rollback baris gagal + retry, run parsial tidak bisa `completed`, resume run `failed`, dan verifikasi tidak ada movement.

## 11. Persetujuan dan eksekusi

Gate ini berlaku untuk agen: impor tidak dijalankan tanpa frasa persis dari owner.

```
APPROVE PHASE 3B IMPORT TO PREVIEW
```

Pada 3 November 2026 owner menerapkan migrasi dan menjalankan impor sendiri lewat CLI (catatan run `Dry-run ready=1360`); agen tidak menjalankan impor tambahan. Frasa di atas tetap berlaku untuk impor operasional berikutnya, misalnya setelah baris 1305 diputuskan.

## 12. Batasan

- Baris 1305 (`WAL-W1303`) sudah diimpor setelah koreksi harga (lihat §13). Tidak ada baris review tersisa.
- 5 produk uji `HOST-*` dan 5 kategori `Phase 2B …` dari smoke test 2 November masih ada; bukan bagian impor dan perlu dibersihkan sebelum produksi.
- Saldo awal stok tetap `NULL` untuk semua produk; opname fisik Phase 5 belum dijalankan.
- Migrasi diuji di PGlite (PostgreSQL 18.6) dan sudah diterapkan ke preview hosted (PostgreSQL 17.11); verifikasi hosted bersifat read-only, bukan suite penuh.
- `npm run test:hosted` tidak dijalankan ulang setelah impor karena skripnya menulis data uji baru.

## 13. Penyelesaian baris review 1305 (`WAL-W1303`)

### Temuan

Baris 1305 adalah satu-satunya baris `review` dari 1.361 baris. Statusnya `review_required` dengan `issue_codes = {stock_unknown, sale_below_cost}`: harga jual 9.500 di bawah harga beli 20.000 (margin −52,5%).

Bukti bahwa ini salah input, bukan keputusan harga:

| Bukti | Nilai |
| --- | --- |
| Baris 1306 tepat setelahnya (`PER-G1304`) | jual 20.000 / beli 9.500 — **persis tertukar** |
| Rasio jual/beli baris 1305 | tepat 0,475 (kebalikan margin +110,5%) |
| Produk lain dengan pasangan harga 9.500/20.000 | 4 produk, semuanya jual 20.000 / beli 9.500 |
| Produk dengan jual < beli di seluruh katalog | 0 dari 1.242 produk berharga lengkap |
| Kategori `WALPAPER` | 0 produk lain; SKU `WAL-` hanya 1 di workbook, tidak ada pembanding internal |

Keputusan owner (4 November 2026): **harga jual 20.000, harga beli 9.500**.

### Kendala yang ditemukan

Sebelum migrasi 0019 tidak ada jalur penyelesaian sama sekali:

- `product_import_rows.reviewed_by`/`reviewed_at` ada, tetapi **tidak ada fungsi yang menulisnya**.
- `products` hanya punya policy `SELECT` untuk staf; tidak ada `INSERT`/`UPDATE` klien.
- `import_product_import_row` menolak baris `review` dengan `ROW_NOT_IMPORTABLE`.
- Run sudah `completed`, dan `begin_product_import` menolak checksum yang sama dengan `IMPORT_ALREADY_COMPLETED`.

### Migrasi 0019

`20261106120000_import_review_resolution.sql` menambah `public.resolve_product_import_review` (owner-only):

| Aksi | Efek |
| --- | --- |
| `approve` | Harga boleh dikoreksi; baris menjadi `ready`, `reviewed_by`/`reviewed_at` terisi, isu harga dihitung ulang. Ditolak bila harga jual masih di bawah biaya (`SALE_BELOW_COST`). |
| `reject` | Baris menjadi `rejected` dengan alasan wajib (maks. 500 karakter). |

Kedua aksi membuka kembali run `completed` menjadi `running` agar baris bisa diimpor dan run ditutup lagi lewat `finish_product_import` (yang menghitung ulang counter). Stok tidak pernah disentuh.

### Hasil di preview

| Pemeriksaan | Hasil |
| --- | --- |
| Migrasi | 19/19 sinkron; `db push` menerapkan tepat satu migrasi |
| `resolve_product_import_review` | `ready`, run → `running` |
| `import_product_import_row` | `imported`, `product_id` `bad05f1d…` |
| `finish_product_import` | `completed`: total 1.361, ready 1.361, review 0, rejected 0, imported 1.361 |
| Produk `WAL-W1303` | jual 20.000, beli 9.500, `stock_on_hand` NULL, `stock_version` 0 |
| Isu produk | hanya `stock_unknown`; **tidak ada** `sale_below_cost` |
| Stock movement | 0 |
| `reviewed_by`/`reviewed_at` | terisi |
| Audit `product_import.review` | 1 baris |
| Katalog | 1.373 produk, **0** dengan jual < beli |
| `stock_on_hand` NOT NULL | 4, semuanya SKU uji `TEST-*` (bukan produk impor) |

Tes: `npm run test:db` **93/93**, `npm test` **257/257**, `npm run typecheck` exit 0. Lima tes baru mencakup otorisasi owner-only, penolakan harga di bawah biaya, pembukaan ulang run, impor dengan harga terkoreksi, dan penolakan dengan alasan wajib.
