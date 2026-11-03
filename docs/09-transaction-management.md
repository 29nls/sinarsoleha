# 09 - Manajemen Transaksi (Phase 4C)

Antarmuka riwayat transaksi, detail, cetak ulang struk, dan pembatalan transaksi.

## Rute

| Rute | Deskripsi |
|------|-----------|
| `/cashier/transactions` | Daftar riwayat transaksi dengan filter dan pagination |
| `/cashier/transactions/[id]` | Detail transaksi, cetak ulang, dan void |

## Fitur

### Riwayat Transaksi

- Pagination server-side (`range` query)
- Filter tanggal, nomor nota, status, metode pembayaran
- Filter kasir hanya untuk owner
- Sorting stabil: `business_date desc, created_at desc, id desc`
- State: loading, kosong, error

### Detail Transaksi

- Menampilkan snapshot tersimpan dari `transactions`, `transaction_items`, `payments`
- Tidak pernah mengambil data produk terkini untuk rekonstruksi
- Nama kasir diisi dari profil auth jika `cashier_id` cocok, fallback "Kasir"
- Tidak join tabel `profiles` (RLS hanya izinkan baca profil sendiri)

### Cetak Ulang Struk

- Menggunakan `ReceiptView.vue` yang sudah ada
- Cetak melalui `window.print()` dan print stylesheet
- Tidak membuat transaksi baru
- Tidak mengubah data tersimpan

### Pembatalan Transaksi (Void)

- Hanya owner melalui `public.void_sale(p_transaction_id, p_reason)`
- Kasir tidak dapat membatalkan transaksi
- Alasan wajib diisi (1-500 karakter)
- Dialog konfirmasi dengan peringatan
- Idempoten (aman jika dipanggil ulang)
- Stok dipulihkan oleh fungsi database
- Pesan sukses: "Transaksi berhasil dibatalkan."
- Bukan refund; tidak mengembalikan uang

## Arsitektur

### Types

- `app/types/transactions.ts`: filter, list row, void result, label helpers, validasi

### Service

- `app/services/transactions.ts`: `listTransactions`, `getTransactionDetail`, `voidSale`

### Composables

- `app/composables/useTransactionHistory.ts`: pagination, filter, debounce, request-ID
- `app/composables/useTransactionDetail.ts`: load snapshot detail
- `app/composables/useTransactionVoid.ts`: validasi, submit, duplicate-safe

### Komponen

- `app/components/transactions/TransactionFilters.vue`: panel filter
- `app/components/transactions/TransactionTable.vue`: tabel riwayat
- `app/components/transactions/VoidTransactionDialog.vue`: dialog void

### Navigasi

- Modul "Riwayat Transaksi" di `app/utils/modules.ts`
- Capability: `sale.read.own` (kasir melihat milik sendiri, owner semua)

## Keamanan

- RLS mengatur akses baca: kasir hanya melihat transaksi sendiri
- `void_sale` adalah `SECURITY DEFINER`; hanya owner
- Tidak ada mutasi langsung ke tabel `transactions`, `transaction_items`, `payments`, `stock_movements`, atau `products.stock_on_hand`
- Tidak ada `service_role` di browser
