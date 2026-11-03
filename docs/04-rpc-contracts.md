# Kontrak RPC Mutasi — Fase 4/5

`complete_sale` dan `void_sale` **sudah diimplementasikan** pada Phase 4A (`20261103110000_transaction_engine.sql`). Seluruh RPC opname (`create_stock_opname`, `record_stock_opname_count`, `submit_stock_opname`, `approve_stock_opname`, `post_stock_opname`, `cancel_stock_opname`) **sudah diimplementasikan** pada Phase 5A (`20261104100000_stock_opname_engine.sql`, lihat `docs/11-inventory-engine.md`). `adjust_stock` masih kontrak. Dokumen ini mengikat signature, validasi, dan urutan operasi. Semua fungsi berada di schema `private`, dibungkus wrapper `public` dengan grant hanya ke `authenticated`, dan memakai `search_path = ''`.

## Aturan umum

- Panggil `private.require_active_role(...)` sebelum menyentuh data.
- Validasi seluruh input; jangan mempercayai harga, total, atau role dari browser.
- Kunci baris produk dalam urutan `product_id` yang konsisten untuk menghindari deadlock.
- Tulis `stock_movements` dan `audit_logs` dalam transaksi yang sama.
- Gagal = rollback penuh; tidak ada sebagian transaksi yang tersimpan.
- Idempotency key unik; retry harus mengembalikan hasil yang sama, bukan membuat nota baru.

## 1. `public.complete_sale(p_payload jsonb) returns jsonb`

**Status: diimplementasikan Phase 4A.** Detail dan batasan di `docs/07-transaction-engine.md`.

Payload:

```json
{
  "idempotency_key": "uuid",
  "business_date": "YYYY-MM-DD",
  "customer_id": "uuid|null",
  "discount_amount": 0,
  "items": [{ "product_id": "uuid", "quantity": 2 }],
  "payments": [
    { "method": "cash", "amount_applied": 50000, "cash_received": 50000, "cash_change": 0 }
  ]
}
```

Urutan:

1. `require_active_role(['owner','cashier'])`; `business_date` wajib dan masuk akal (jam tutup belum diputuskan owner).
2. Jika `idempotency_key` sudah ada, kembalikan nota lama tanpa menulis apa pun.
3. Kunci produk urut `product_id`; tolak produk tidak ada/nonaktif, `sale_price IS NULL`, `stock_on_hand IS NULL`, dan qty > stok. Negatif stok tidak boleh terjadi dari penjualan.
4. Ambil harga dari database (bukan payload); hitung `line_subtotal`, `line_total`, `subtotal`, `grand_total`. Diskon ≤ subtotal dan ≤ batas peran (default kasir 0 sampai owner menetapkan).
5. Ambil `receipt_no` lewat `private.next_document_number('receipt', business_date)`.
6. Insert header, item snapshot (SKU/nama/satuan/harga), payments `confirmed`, movements `sale_out` dengan `actor_id`, `quantity_before`, `quantity_after`, `idempotency_key` movement.
7. Update `products.stock_on_hand`, `stock_version + 1`, `updated_by`.
8. Deferred trigger memeriksa Σ pembayaran = `grand_total` saat COMMIT.
9. Kembalikan `{ transaction_id, receipt_no, business_date, subtotal, discount_amount, grand_total, status, already_processed }`; audit `sale.complete`.

Catatan implementasi 4A:

- Fingerprint permintaan disimpan di `transactions.request_fingerprint`; kunci sama dengan keranjang berbeda ditolak.
- `business_date` tidak boleh lebih dari satu hari setelah tanggal server (toleransi WIB).
- Produk duplikat dalam satu keranjang ditolak; klien wajib menggabungkan quantity.
- Diskon selalu 0 karena belum ada kebijakan owner; nilai > 0 ditolak `DISCOUNT_NOT_CONFIGURED`.
- Retry dengan kunci dan payload sama mengembalikan nota lama dengan `already_processed = true`.

## 2. `public.void_sale(p_transaction_id uuid, p_reason text) returns jsonb`

**Status: diimplementasikan Phase 4A.**

- Hanya `owner`; alasan wajib 1–500 karakter.
- Kunci transaksi; hanya status `completed`; jika sudah `voided`, kembalikan hasil lama (idempoten).
- Untuk setiap item, buat movement `void_reversal` (delta = +quantity, referensi transaksi) dan naikkan saldo/versi.
- Set `status = 'voided'`, `voided_at/by/reason`; jangan menghapus header, item, payment, atau movement.
- Audit `sale.void`; kembalikan nota yang diperbarui.

Catatan implementasi 4A:

- Item tanpa `product_id` menolak void (`VOID_ITEM_WITHOUT_PRODUCT`) agar stok tidak dipulihkan salah.
- Pembayaran tidak diubah dan tidak diklaim direfund; refund adalah keputusan bisnis terpisah.
- Void ganda mengembalikan `already_processed = true` tanpa menulis movement baru.
- Movement `void_reversal` memakai idempotency key turunan dari transaksi dan produk.

## 3. RPC opname Phase 5A

Status: **diimplementasikan** di `20261104100000_stock_opname_engine.sql`. Detail
lengkap ada di `docs/11-inventory-engine.md`; ringkasnya:

| RPC | Peran | Inti |
| --- | --- | --- |
| `create_stock_opname(p_payload jsonb)` | owner, inventory_staff | Snapshot server-side (`INSERT ... SELECT`), `creation_key` idempoten, termasuk produk nonaktif, exclusion UUID eksplisit |
| `record_stock_opname_count(item uuid, qty numeric, reason text, note text)` | owner, inventory_staff | Hanya sesi `counting`; presisi mengikuti `decimal_scale`; aturan alasan opening/known stock; tidak menyentuh stok |
| `submit_stock_opname(opname uuid)` | owner, inventory_staff | Semua item lengkap; `DETAIL` berisi daftar item bermasalah; set `submitted_at` |
| `approve_stock_opname(opname uuid)` | **owner** | Validasi ulang kelengkapan, set `approved_by/at`, audit; stok tidak berubah |
| `post_stock_opname(opname uuid)` | **owner** | Kunci opname → produk urut `product_id`; cek `stock_version`; movement + log + update stok + audit; idempoten |
| `cancel_stock_opname(opname uuid, reason text)` | **owner** | Alasan wajib; hanya sesi belum selesai; `posted` tidak bisa; stok tidak berubah |

Konflik versi **tidak** melempar exception: fungsi mengembalikan
`{ result: 'version_conflict', conflicts: [...] }`, menandai item `needs_recount`,
dan mengembalikan sesi ke `counting` agar penanda tersebut ikut ter-commit.

### Catatan revisi kontrak posting

Kontrak awal menyebut konflik versi diakhiri dengan `raise error`. Itu **tidak
benar** untuk PostgreSQL: exception akan me-rollback penanda `needs_recount` dan
perubahan status sesi. Implementasi Phase 5A mengembalikan JSON non-success
(`result = 'version_conflict'`) sehingga penanda konflik tersimpan permanen.
Selain itu delta 0 pada `opening_balance` kini diizinkan lewat constraint yang
dipersempit (lihat `docs/11-inventory-engine.md` bagian 6).

## 4. `public.upsert_category(p_payload jsonb) returns jsonb` (Phase 3A, sudah tersedia)

Payload create:

```json
{ "name": "Furnitur", "is_active": true }
```

Payload rename/deactivate:

```json
{ "category_id": 12, "name": "Furnitur Kayu", "is_active": false }
```

- Hanya owner aktif; `private.require_active_role(['owner'])`.
- Nama di-trim, wajib 1..120 karakter; nama dinormalisasi oleh generated column dan duplikat mengabaikan huruf besar/kecil ditolak `23505`.
- `is_active` default `true`; kategori tidak pernah di-hard-delete.
- Menulis `category.create` atau `category.update` ke `audit_logs`.
- Mengembalikan baris kategori sebagai JSON.
- Wrapper `public` hanya memberi `EXECUTE` ke `authenticated`; pemeriksaan owner tetap di fungsi `private`.

## 5. `public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason_code text, p_reason_note text) returns jsonb` (belum diimplementasikan)

Kontrak ini **belum** punya implementasi; belum ada fungsi `public.adjust_stock` di
database. Jangan panggil dari UI sebelum migrasi berikutnya.

- `owner` atau `inventory_staff`; `p_delta <> 0`; `reason_code` dari 8 nilai yang diizinkan; `other` wajib catatan.
- Kunci produk; `stock_on_hand` harus diketahui (NULL → gunakan opname opening balance, bukan adjustment).
- Hitung `quantity_after = before + delta`; tolak hasil negatif kecuali owner dengan alasan `input_error` (keputusan owner masih terbuka).
- Insert movement `manual_adjustment`, update saldo/versi, audit `stock.adjust`.
- Kembalikan saldo sebelum/sesudah dan id movement.

## Yang sudah tersedia untuk fase berikutnya

- Nomor dokumen: `private.next_document_number(scope, business_date)`.
- Pemeriksaan pembayaran: constraint trigger deferred pada `payments`/`transactions`.
- Ledger immutable dan aturan referensi movement.
- Audit writer: `private.write_audit(...)`.
- Staging legacy dan `product_data_issues` untuk katalog.
- `private.opname_blockers(uuid)` sebagai gerbang kelengkapan opname yang dapat dipakai ulang.
