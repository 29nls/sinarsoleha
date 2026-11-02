# Kontrak RPC Mutasi — Fase 4/5

Fungsi berikut **belum diimplementasikan** pada Fase 2. Dokumen ini mengikat signature, validasi, dan urutan operasi agar Fase 4 (kasir) dan Fase 5 (inventaris) tidak menemukan kontrak baru. Semua fungsi berada di schema `private`, dibungkus wrapper `public` dengan grant hanya ke `authenticated`, dan memakai `search_path = ''`.

## Aturan umum

- Panggil `private.require_active_role(...)` sebelum menyentuh data.
- Validasi seluruh input; jangan mempercayai harga, total, atau role dari browser.
- Kunci baris produk dalam urutan `product_id` yang konsisten untuk menghindari deadlock.
- Tulis `stock_movements` dan `audit_logs` dalam transaksi yang sama.
- Gagal = rollback penuh; tidak ada sebagian transaksi yang tersimpan.
- Idempotency key unik; retry harus mengembalikan hasil yang sama, bukan membuat nota baru.

## 1. `public.complete_sale(p_payload jsonb) returns jsonb`

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
9. Kembalikan `{ transaction_id, receipt_no, grand_total }`; audit `sale.complete`.

## 2. `public.void_sale(p_transaction_id uuid, p_reason text) returns jsonb`

- Hanya `owner`; alasan wajib.
- Kunci transaksi; hanya status `completed`; jika sudah `voided`, kembalikan hasil lama (idempoten).
- Untuk setiap item, buat movement `void_reversal` (delta = +quantity, referensi transaksi) dan naikkan saldo/versi.
- Set `status = 'voided'`, `voided_at/by/reason`; jangan menghapus header, item, payment, atau movement.
- Audit `sale.void`; kembalikan nota yang diperbarui.

## 3. `public.post_stock_opname(p_opname_id uuid) returns jsonb`

- Hanya `owner`; opname harus `approved`.
- Kunci opname dan seluruh item; semua item wajib `physical_qty` terisi.
- Kunci produk urut; bandingkan `stock_version_snapshot` dengan versi saat ini. Jika berbeda: set item `needs_recount`, jangan posting sebagian, dan raise error yang menyebut item bermasalah.
- Untuk setiap item:
  - snapshot `NULL` → movement `opening_balance` (`quantity_before = NULL`, `quantity_after = physical`).
  - snapshot diketahui → movement `opname_adjustment` dengan delta = physical − snapshot; jika delta = 0 tidak ada movement.
  - selisih ≠ 0 → insert `stock_discrepancy_logs` dengan `revision` berikutnya, alasan wajib.
- Update saldo/versi/`updated_by`; set item `posted`; set opname `posted_by/at`, status `posted`.
- Audit `opname.post`; kembalikan ringkasan jumlah item dan total selisih.

## 4. `public.adjust_stock(p_product_id uuid, p_delta numeric, p_reason_code text, p_reason_note text) returns jsonb`

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

## 5. `public.upsert_category(p_payload jsonb) returns jsonb` (Phase 3A, sudah tersedia)

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
