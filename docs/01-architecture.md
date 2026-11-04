# Arsitektur & Keputusan Teknis

Dokumen ini mencatat keputusan yang mengikat implementasi. Setiap keputusan punya konsekuensi yang harus dipertahankan sampai ada ADR pengganti.

## 1. ADR-001 — Nuxt SPA, bukan SSR

**Keputusan.** `ssr: false`. Aplikasi dirender di browser; semua data diambil lewat Supabase JS.

**Alasan.**
- Otorisasi final ada di PostgreSQL (RLS + RPC), bukan di server Nuxt.
- SSR akan memerlukan jalur session kedua (cookie + refresh) tanpa menambah enforcement.
- Aplikasi internal, full-online, dan tidak butuh SEO.

**Konsekuensi.**
- Halaman pertama butuh JS; dapat diterima untuk POS di jaringan toko.
- Rahasia apa pun tidak boleh masuk `runtimeConfig.public`.
- Bila kelak butuh SSR untuk laporan, tambahkan sebagai keputusan terpisah, bukan default.

## 2. ADR-002 — Otorisasi berlapis, database sebagai hakim

**Keputusan.** `app/utils/permissions.ts` hanya mengatur tampilan (menu, tombol, route). Setiap operasi diperiksa lagi oleh RLS dan RPC `SECURITY DEFINER` di schema `private`.

**Aturan.**
- Tidak ada penulisan langsung dari browser ke `transactions`, `transaction_items`, `payments`, `stock_*`, `audit_logs`, atau `products.stock_on_hand`.
- RPC wajib: `auth.uid()` aktif, peran sesuai, payload tervalidasi, `search_path = ''`, nama tabel fully qualified.
- Grant `EXECUTE` hanya untuk entry point yang dipakai.

## 3. ADR-003 — Saldo cepat + ledger append-only

**Keputusan.** `products.stock_on_hand` menyimpan saldo terkini; `stock_movements` menyimpan setiap delta secara immutable dengan `quantity_before`, `quantity_after`, `movement_type`, `actor_id`, referensi transaksi/opname.

**Konsekuensi.**
- Saldo dapat direkonsiliasi: `sum(delta)` harus sama dengan saldo sejak opening balance.
- Koreksi dilakukan dengan movement baru, tidak pernah UPDATE/DELETE ledger.
- `stock_version` naik setiap mutasi dan dipakai sebagai optimistic lock opname.

## 4. ADR-004 — Uang dan kuantitas memakai numeric

| Data | Tipe | Aturan |
| --- | --- | --- |
| Uang | `numeric(14,2)` | Rupiah tanpa desimal di UI; tidak pernah `float` |
| Kuantitas | `numeric(14,3)` | Mendukung Meter/Roll pecahan; presisi mengikuti `units_of_measure.decimal_scale` |
| Diskon | `numeric(14,2)` amount | Bukan persen; tidak mengubah harga master |

Total final dihitung ulang di database. Angka dari browser adalah usulan, bukan kebenaran.

## 5. ADR-005 — Opname memakai snapshot + versi

Setiap item opname menyimpan `system_qty_snapshot` dan `stock_version_snapshot`.

- Snapshot `NULL` → hitungan pertama adalah `opening_balance`, bukan selisih terhadap nol.
- Snapshot diketahui dan fisik berbeda → `reason_code` wajib; `other` wajib catatan.
- Saat posting, `stock_version` saat ini harus sama dengan snapshot. Jika berbeda, item ditahan untuk recount.
- Posting menulis saldo, movement, dan discrepancy log dalam satu transaksi; sesi menjadi `posted` dan tidak dapat diubah.

## 6. ADR-006 — Nilai tidak diketahui tetap tidak diketahui

`stock_on_hand NULL`, `sale_price NULL`, `purchase_cost NULL` tidak pernah dikonversi menjadi 0.

- SKU tanpa saldo tidak dapat dijual.
- SKU tanpa harga jual tidak dapat dijual.
- SKU tanpa harga beli tidak dihitung marginnya; laporan menandainya, bukan mengasumsikan 100%.

UI menampilkan `—` melalui `formatRupiah`/`formatQuantity`, bukan `Rp 0`.

## 7. ADR-007 — Adapter untuk fitur opsional

Kontrak minimal: `isEnabled()`, `isAvailable()`, `healthCheck()`, plus metode spesifik (`printReceipt`, `scan`, `charge`).

| Adapter | Default | Saat OFF/gagal |
| --- | --- | --- |
| Thermal printer | OFF | Nota ditampilkan & dapat dicetak lewat browser |
| Barcode scanner | OFF | Input SKU/nama manual tetap bekerja |
| QRIS gateway | OFF | QRIS manual (diverifikasi kasir) tetap tersedia |

Operasi inti (cari barang, keranjang, checkout tunai/QRIS manual) tidak boleh memanggil adapter.

## 8. ADR-008 — Nomor nota dari database

Penomoran tidak boleh dibuat di browser. RPC mengambil nomor dari tabel counter/sequence dengan lock, sehingga dua kasir tidak pernah mendapat nomor sama. Format: `SS-YYYYMMDD-NNNN` (toko, tanggal bisnis, urutan harian).

## 9. ADR-009 — Realtime hanya sinkronisasi tampilan

Broadcast pada topic `store:stock`, payload `{ product_id, sku, stock_on_hand, stock_version }`.

- Channel **private**; hanya sesi `authenticated` yang lolos policy `realtime.messages`.
- Tidak memuat harga beli, pelanggan, atau pembayaran.
- Pinia memperbarui saldo dan memperingatkan bila qty keranjang melebihi stok baru.
- Reconnect → refetch saldo yang terlihat + resubscribe.
- Pesan dengan `stock_version` lebih lama/sama diabaikan agar tampilan tidak mundur.
- Checkout tetap memvalidasi stok di database; event realtime bukan otorisasi.

Implementasi: `docs/18-realtime-stock.md`.

## 10. ADR-010 — Impor legacy lewat staging, tanpa auto-match

- Header dan baris legacy masuk tabel staging dengan nilai sumber apa adanya.
- Pencocokan nama → SKU memakai kandidat + confidence; keputusan akhir manual.
- Baris ambigu tetap `needs_review`; tidak ada SKU yang dibuat dari tebakan.
- Nilai mismatch disimpan dan dilaporkan, tidak dinormalisasi diam-diam.

## 11. Batas Modul

| Lapisan | Boleh tahu | Tidak boleh tahu |
| --- | --- | --- |
| Halaman (`pages/`) | komponen, store, service | detail SQL/RPC internal |
| Komponen | props/emits, formatter | akses Supabase langsung |
| Store | state UI, service | aturan harga/stok final |
| Service (`app/services/`) | kontrak RPC, query | markup/komponen |
| Database | kebenaran data & otorisasi | UI |

Aturan praktis: komponen tidak memanggil `useSupabaseClient()`; store/service yang memanggil.

## 12. Alur Checkout (target Phase 4)

1. Kasir menambah item; keranjang menyimpan `product_id`, qty, harga snapshot.
2. UI menghitung pratinjau; total ini hanya tampilan.
3. `complete_sale` dipanggil dengan item, diskon, pembayaran, `business_date`, `idempotency_key`.
4. RPC: cek sesi & peran → kunci produk urut `product_id` → validasi aktif/harga/stok/diskonto → hitung subtotal & total → insert header, item, payment, movement → update saldo & versi → commit.
5. Respons memuat `transaction_id` dan `receipt_no`; UI menampilkan nota.
6. Kegagalan apa pun me-rollback seluruh operasi; keranjang dipertahankan.

## 13. Alur Posting Opname (target Phase 5)

1. Sesi `draft` → item dimuat dengan snapshot qty + versi.
2. Penghitungan disimpan per item beserta `counted_by`/`counted_at`.
3. Submit → validasi kelengkapan & alasan.
4. Owner approve → status `approved`.
5. Posting → lock produk, bandingkan versi, tolak yang basi, tulis saldo/movement/discrepancy, set `posted`.

## 14. Error Handling

| Kondisi | Perilaku |
| --- | --- |
| Supabase belum dikonfigurasi | Login menampilkan instruksi env; tidak ada form aktif |
| Sesi habis / profil nonaktif | Store menghapus profil, middleware mengarahkan ke login, pesan jelas |
| RPC menolak (stok, harga, peran) | Pesan dari database ditampilkan apa adanya; keranjang tidak dikosongkan |
| Jaringan putus | Indikator offline, tombol commit nonaktif, tidak ada klaim tersimpan |
| Route tanpa izin | `error.vue` 403, bukan redirect diam-diam |
| Error tak terduga | `error.vue` dengan kode; tidak ada data sensitif di pesan |

## 15. Performa

- Pencarian: SKU exact/prefix prioritas, nama memakai `pg_trgm` + debounce 150 ms, limit 20 baris.
- Tidak memuat seluruh katalog sekaligus; pagination server-side.
- Indeks: `products(sku)`, `products(is_active, sku)`, GIN nama, `transactions(business_date)`, `stock_movements(product_id, created_at)`.
- Realtime payload kecil; tidak ada refetch seluruh katalog saat satu stok berubah.
- Target SLO PRD (pencarian P95 < 300 ms, checkout P95 < 1,5 s) diukur pada Phase 8, bukan diklaim sekarang.

## 16. Keamanan

- Browser hanya memakai publishable/anon key.
- `service_role` hanya di lingkungan server/CI, tidak pernah di repo.
- RLS aktif pada semua tabel `public`; `private` tidak diekspos PostgREST.
- Setiap migrasi me-revoke akses default untuk tabel baru.
- Log tidak memuat kata sandi, token, atau kredensial gateway.
- Offboarding = `profiles.is_active = false`, bukan delete `auth.users` (FK restrict).
