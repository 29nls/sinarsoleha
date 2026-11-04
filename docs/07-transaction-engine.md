# Mesin Transaksi — Phase 4A

**Status: backend diimplementasikan dan diuji lokal; migrasi aktif di preview; uji transaksi hosted tertunda.**
`complete_sale` dan `void_sale` ada di migrasi `20261103110000_transaction_engine.sql` dan lulus 42/42 tes database lokal (10 tes baru). Matriks otorisasi hosted terverifikasi di preview; fixture `TEST-TXN-*` sudah ada, dan sejak Phase 4D uji konkurensi, idempotensi, void, dan pembayaran hosted **lulus 10/10** serta browser E2E kasir **lulus 10/10** — lihat `docs/10-transaction-release-validation.md`.

UI kasir Phase 4B sudah memanggil kontrak ini secara lokal (lihat `docs/08-cashier-interface.md`), tetapi belum ada checkout hosted yang berhasil diverifikasi. Operasi opname dan Realtime tetap Phase 5.

## 1. Prinsip

- Harga, diskon, total, stok, nomor nota, dan identitas kasir ditentukan PostgreSQL.
- Payload browser hanya berisi `product_id`, `quantity`, pembayaran, `business_date`, dan `idempotency_key`.
- Semua tulisan berada dalam satu transaksi database; error apa pun me-rollback header, item, pembayaran, movement, stok, dan audit.
- Tidak ada `INSERT`/`UPDATE` langsung dari browser ke `transactions`, `transaction_items`, `payments`, `stock_movements`, atau `products.stock_on_hand`.

## 2. Signature

```sql
public.complete_sale(p_payload jsonb) returns jsonb
public.void_sale(p_transaction_id uuid, p_reason text) returns jsonb
```

Wrapper `public` adalah `SECURITY DEFINER` dengan `search_path = ''`, hanya memberi `EXECUTE` ke `authenticated`, dan memanggil implementasi di schema `private`. `anon` tidak punya grant.

### Payload checkout

```json
{
  "idempotency_key": "uuid",
  "business_date": "2026-11-03",
  "customer_id": null,
  "discount_amount": 0,
  "items": [{ "product_id": "uuid", "quantity": 2 }],
  "payments": [
    { "method": "cash", "amount_applied": 10000, "cash_received": 20000, "cash_change": 10000 }
  ]
}
```

### Respons

```json
{
  "transaction_id": "uuid",
  "receipt_no": "SS-20261103-0001",
  "business_date": "2026-11-03",
  "subtotal": 10000,
  "discount_amount": 0,
  "grand_total": 10000,
  "status": "completed",
  "already_processed": false
}
```

Retry dengan kunci dan keranjang yang sama mengembalikan objek yang sama dengan `already_processed: true`.

## 3. Otorisasi

| Peran | Checkout | Void |
| --- | --- | --- |
| Owner aktif | Ya | Ya |
| Kasir aktif | Ya | Tidak |
| Staf gudang | Tidak (`42501`) | Tidak (`42501`) |
| Akun nonaktif | Tidak (`42501`) | Tidak (`42501`) |
| Anon | Tidak (`42501`) | Tidak (`42501`) |

`cashier_id` selalu `auth.uid()` lewat `private.require_active_role(...)`; payload tidak pernah dipercaya untuk identitas atau peran.

## 4. Validasi input

- `idempotency_key` wajib UUID.
- `business_date` wajib tanggal valid dan tidak lebih dari satu hari setelah tanggal server (toleransi zona waktu WIB); jam tutup belum ditetapkan.
- `customer_id` opsional; harus ada di `customers`.
- `items` array 1–200 baris; objek dengan `product_id` UUID dan `quantity` 1–3 desimal > 0.
- Produk duplikat dalam satu keranjang ditolak (`DUPLICATE_PRODUCT`); gabungkan quantity di klien.
- `payments` array 1–10 baris; `amount_applied` > 0 dengan maksimal 2 desimal.
- `discount_amount` wajib 0 (lihat §7).
- Tipe data salah ditolak `22023`; produk hilang `P0002`.

## 5. Idempotensi

- `transactions.idempotency_key` sudah unik sejak Phase 2.
- Migrasi menambah `transactions.request_fingerprint` (md5 32 hex) berisi bentuk kanonik: tanggal bisnis, pelanggan, diskon, item terurut `product_id`, pembayaran terurut metode/nilai.
- Kunci sama + fingerprint sama → kembalikan nota lama, tanpa menulis apa pun.
- Kunci sama + fingerprint berbeda → `22023 IDEMPOTENCY_KEY_REUSED`.
- Pemeriksaan dilakukan sebelum dan sesudah penguncian produk, sehingga retry yang menunggu lock tidak berubah menjadi error stok.
- Bentrokan unik saat insert ditangkap; bila fingerprint cocok, nota lama dikembalikan.

## 6. Produk, stok, dan penguncian

- Semua produk dikunci `FOR UPDATE` satu per satu dalam urutan `product_id` menaik, sebelum tulisan pertama.
- Validasi: produk ada, `is_active`, `sale_price` tidak `NULL`, `stock_on_hand` tidak `NULL`, quantity ≤ stok, dan quantity tidak pecahan untuk satuan `decimal_scale = 0`.
- Produk impor Phase 3B memiliki stok `NULL` sehingga **tidak bisa dijual** sampai opname Phase 5. Tidak ada konversi `NULL` menjadi 0.
- `stock_on_hand` dikurangi tepat sekali dan `stock_version` naik 1 per produk.
- `stock_movements` menulis `sale_out` dengan `quantity_before`, delta negatif, `quantity_after`, `transaction_id`, `actor_id`, dan idempotency key turunan `md5(transaction_id:sale_out:product_id)`.
- Tidak ada jalur yang mengizinkan stok negatif.

## 7. Uang dan diskon

- `unit_price` diambil dari `products.sale_price`.
- `line_subtotal = round(unit_price × quantity, 2)`.
- `subtotal = Σ line_subtotal`; `grand_total = subtotal − discount_amount`.
- Diskon level nota belum diaktifkan: tidak ada tabel `app_settings`, batas per peran, atau persetujuan owner. Semua diskon > 0 ditolak `DISCOUNT_NOT_CONFIGURED`; diskon negatif ditolak `INVALID_DISCOUNT`. Keputusan ini harus diganti lewat ADR bila owner menetapkan kebijakan.
- Karena diskon selalu 0, `line_discount_amount = 0`, `line_total = line_subtotal`, dan tidak ada alokasi sisa pembulatan.
- Semua nilai memakai `numeric(14,2)`; tidak ada float.
- Snapshot item menyimpan SKU, nama, label satuan, quantity, dan harga saat transaksi, sehingga perubahan katalog tidak mengubah histori.

## 8. Pembayaran

| Metode | Aturan |
| --- | --- |
| `cash` | `cash_received` dan `cash_change` wajib; `cash_received ≥ amount_applied`; `cash_change = cash_received − amount_applied` |
| `qris` | `amount_applied` wajib; `cash_received` harus `NULL`; `cash_change = 0`; tanpa gateway |
| `other` | Mengikuti constraint yang ada; `cash_received` tidak boleh diisi; `cash_change = 0` |

- `Σ amount_applied = grand_total`; pelanggaran ditolak `23514` sebelum/oleh trigger deferred.
- Split payment didukung selama total tepat.
- Semua baris disimpan `payment_status = 'confirmed'`.
- Tidak ada kredensial gateway dan tidak ada integrasi QRIS otomatis.

## 9. Nomor nota

- `private.next_document_number('receipt', business_date)` memakai row lock pada `document_counters`; format `SS-YYYYMMDD-NNNN`.
- Unik lewat constraint `transactions_receipt_no_key`.
- Tidak pernah dibuat di JavaScript.

## 10. Void

- Hanya owner aktif; alasan wajib 1–500 karakter.
- Baris transaksi dikunci `FOR UPDATE`; status `voided` mengembalikan hasil lama (`already_processed: true`) tanpa menulis.
- Item diagregasi per produk, produk dikunci urut `product_id`, lalu `void_reversal` menambah stok dan `stock_version`.
- Header diubah `status = 'voided'`, `voided_at/by/reason`. Header, item, pembayaran, movement, dan audit **tidak dihapus**.
- Pembayaran tidak diubah dan tidak diklaim direfund; proses refund belum ditetapkan.
- Nota void harus dikecualikan dari laporan penjualan bersih (laporan belum ada di fase ini).
- Item tanpa `product_id` (warisan legacy) menolak void dengan `VOID_ITEM_WITHOUT_PRODUCT` agar stok tidak dipulihkan secara salah.

## 11. Keamanan database

- `SECURITY DEFINER`, `search_path = ''`, nama objek fully qualified.
- `private.complete_sale` dan `private.void_sale` hanya dieksekusi oleh wrapper; `PUBLIC` di-revoke.
- RLS tidak dilonggarkan; tidak ada grant tulis baru untuk kasir.
- Audit `sale.complete` dan `sale.void` ditulis dalam transaksi yang sama.
- `request_fingerprint` hanya menyimpan hash, bukan payload pelanggan.

## 12. Migrasi dan indeks

Migrasi `20261103110000_transaction_engine.sql`:

- Menambah `transactions.request_fingerprint text` + check format.
- Menambah `private.sale_response`, `private.complete_sale`, `private.void_sale`, dan dua wrapper `public`.
- Tidak menambah indeks baru: `transactions_receipt_no_key`, `transactions_idempotency_key_key`, `transaction_items_transaction_idx`, `stock_movements_transaction_idx`, dan `transactions_cashier_date_idx` sudah mencakup lookup utama.

## 13. Kegagalan dan rollback

- Validasi gagal sebelum tulisan → tidak ada perubahan.
- Gagal setelah header (mis. pembayaran tidak seimbang) → seluruh RPC rollback; transaksi, item, pembayaran, movement, dan stok kembali seperti semula.
- Kunci dilepas saat commit/rollback; tidak ada transaksi menggantung.
- Retry aman karena idempotency key; keranjang di klien dipertahankan oleh UI Phase 4B (lihat §18).

## 14. Tes lokal

`npm run test:db` — **42/42 lulus** (10 tes baru):

| Tes | Cakupan |
| --- | --- |
| Checkout kasir | Harga dari DB, stok −2, `stock_version` +1, snapshot item, payment, movement, audit |
| Idempotensi | Kunci sama → nota sama, stok tidak berkurang dua kali |
| Kunci dipakai ulang | Keranjang berbeda → `22023`, tidak ada nota baru |
| Validasi | Keranjang kosong, qty 0/4 desimal, produk duplikat, tanpa pembayaran, metode asing, diskon, tanggal hilang, produk hilang |
| Tidak bisa dijual | Stok `NULL`, harga `NULL`, nonaktif, stok kurang |
| Pembayaran | Tidak seimbang (`23514`), cash change salah, QRIS dengan cash, QRIS valid, split cash+QRIS |
| Otorisasi | Gudang, nonaktif, anon ditolak; owner boleh |
| Void | Kasir ditolak, alasan wajib, stok pulih, reversal satu kali, void ganda idempoten, histori utuh |
| Oversell sekuensial | Stok 1: penjualan kedua ditolak, stok 0, satu movement |
| Nomor nota | Unik dan berurutan per tanggal bisnis |

`npm test` 66/66 (termasuk 23 tes kasir UI), `npm run typecheck` exit 0, `npm run build` exit 0, `npm run gen:types` 43.464 byte.

## 15. Keterbatasan dan verifikasi yang belum dilakukan

- **Migrasi sudah aktif di preview.** Objek terverifikasi lewat probe read-only; riwayat migrasi CLI tidak dapat dibaca karena tidak ada access token dan project belum di-link.
- **Fixture stok belum ada.** Semua produk preview memiliki `stock_on_hand NULL`; SQL seed disediakan di `supabase/tests/phase4a_preview_fixtures.sql` dan harus dijalankan owner lewat SQL Editor preview.
- **Akun kasir kedua belum ada.** Preview hanya memiliki owner, satu kasir, staf gudang, dan akun nonaktif.
- **Uji konkurensi, idempotensi, void, dan pembayaran hosted pada Phase 4A/4B belum dijalankan.** PGlite memakai satu koneksi, sehingga row lock tidak dapat diuji paralel secara lokal; jaminan saat ini berasal dari `FOR UPDATE` berurutan dan tes oversell sekuensial.
- **Sejak Phase 4D seluruh rentetan di atas lulus** (suite hosted 10/10, browser E2E 10/10, rekonsiliasi seimbang) — lihat `docs/10-transaction-release-validation.md`; catatan "belum dijalankan" di bagian ini hanya berlaku untuk masa Phase 4A/4B.
- **Matriks otorisasi hosted sudah terverifikasi:** anon/gudang/nonaktif `42501`, kasir mencapai fungsi (`P0002` untuk produk uji), kasir void `42501`, owner void mencapai fungsi (`P0002`).
- `customer_id` belum dipakai untuk harga khusus atau loyalitas.
- Laporan penjualan belum ada; pengecualian nota void harus diterapkan saat laporan dibuat.

### Rencana verifikasi konkurensi (setelah fixture dan akun tersedia)

1. Jalankan `supabase/tests/phase4a_preview_fixtures.sql` di SQL Editor preview; produk impor tidak disentuh.
2. Buat dan aktifkan kasir kedua, lalu simpan sebagai role `cashier_b` di `.tmp/phase2b-accounts.json` atau set `TEST_CASHIER_B_EMAIL`/`TEST_CASHIER_B_PASSWORD`.
3. Jalankan `npm run test:hosted:transactions`; skrip membuka dua klien kasir independen (bukan dua panggilan berurutan).
4. Kirim `complete_sale` quantity 1 dengan idempotency key berbeda secara bersamaan.
5. Harapkan tepat satu `completed`, satu `INSUFFICIENT_STOCK`, stok akhir 0, dan satu movement `sale_out`.
6. Ulangi dengan kunci yang sama untuk membuktikan retry paralel tidak membuat nota ganda.

## 16. Keputusan bisnis yang masih terbuka

1. **Diskon**: batas nominal per peran, siapa yang boleh memberi, dan apakah diskon dialokasikan ke item.
2. **Refund**: apakah void berarti uang dikembalikan tunai, dicatat sebagai kewajiban, atau hanya pembatalan administratif.
3. **Jendela void**: apakah owner boleh void kapan saja atau ada batas hari.
4. **Tanggal bisnis**: jam tutup toko dan zona waktu resmi; saat ini hanya guard satu hari ke depan.
5. **QRIS manual**: bukti verifikasi (referensi provider) dan siapa yang boleh mengonfirmasi.
6. **Pembulatan**: aturan alokasi diskon nota dan sisa pembulatan bila diskon diaktifkan.

## 17. Fase berikutnya

Phase 4B sudah membuat UI kasir yang memanggil RPC ini, mempertahankan keranjang saat gagal, dan menampilkan nota. Setelah fixture stok dan kasir kedua tersedia, jalankan uji konkurensi dua sesi dan suite hosted sebelum menganggap Phase 4 selesai. Phase 5 (opname dan Realtime) sudah berjalan: opname nyata dibuktikan di preview 4 November 2026 (`docs/22` §11).

## 18. Integrasi UI kasir Phase 4B

- `/cashier` hanya untuk `sale.create` (owner/kasir aktif); middleware menolak peran lain.
- Keranjang menggabungkan produk duplikat agar payload tidak memuat `product_id` ganda.
- Payload dibangun di `app/utils/cashier.ts`; hanya field kontrak yang dikirim. Diskon selalu 0.
- Tunai mengirim `cash_received` dan `cash_change`; QRIS/other tidak membawa field tunai. Split didukung dengan total tepat dan konfirmasi manual QRIS.
- Satu idempotency key per niat checkout. Timeout/network error mempertahankan key, payload, dan keranjang; retry mengirim payload yang sama. Keranjang hanya dikosongkan setelah sukses.
- Nota memakai respons RPC dan snapshot `transactions`/`transaction_items`/`payments`; tidak membuat nilai sendiri.
- Stok yang berubah setelah penolakan backend disegarkan tanpa menghapus baris dan tanpa mengganti harga yang dilihat kasir; checkout dinonaktifkan sampai quantity disesuaikan.
- Status verifikasi: unit test lokal lulus; sejak Phase 4D checkout hosted dan browser E2E **lulus** — lihat `docs/10-transaction-release-validation.md`.

## 19. Manajemen transaksi Phase 4C

- Riwayat transaksi `/cashier/transactions` membaca snapshot dari tabel `transactions`, `transaction_items`, `payments`.
- Detail tidak join `profiles` dan tidak fetch produk terkini; nama kasir diisi dari profil auth jika cocok.
- Cetak ulang struk memakai `ReceiptView.vue` via `window.print()`; tidak membuat transaksi baru.
- Void melalui `public.void_sale` (owner-only, alasan 1-500 karakter, idempoten). Bukan refund.
- Lihat `docs/09-transaction-management.md` untuk detail arsitektur.
