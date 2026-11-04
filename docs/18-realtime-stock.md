# 18 — Realtime Stok (POS-03, NFR-04, DB-16, ADR-009)

Sinkronisasi saldo stok antar-kasir lewat Supabase Realtime Broadcast. Ini
menutup satu-satunya requirement PRD yang sebelumnya belum punya kode sama
sekali: POS-03 ("stok terbarui tanpa muat ulang") dan NFR-04.

Realtime di sini **hanya untuk tampilan**. Checkout tetap memanggil RPC
`complete_sale` yang mengunci baris produk dan memvalidasi stok di database,
jadi pesan yang hilang, terlambat, atau dipalsukan tidak pernah menjadi
otorisasi.

## Alur

```
update public.products (stock_on_hand / stock_version)
        │
        ▼  trigger after update of stock_on_hand, stock_version
private.broadcast_product_stock()
        │  realtime.send(payload, 'stock_changed', 'store:stock', true)
        ▼
Realtime Broadcast (private)
        │
        ▼  policy realtime.messages: authenticated + topic store:stock
useStockRealtime() → parseStockBroadcast() → store.applyStockChange()
                                           → search.applyStock()
```

## Migrasi `20261105100000_stock_broadcast.sql`

- `private.broadcast_product_stock()` — `security definer`, `search_path = ''`,
  `revoke all ... from public`. Tidak bisa dipanggil klien; hanya trigger.
- Trigger `products_broadcast_stock` — `after update of stock_on_hand,
  stock_version on public.products for each row`.
- Payload minimal: `{product_id, sku, stock_on_hand, stock_version}`. Tidak ada
  harga beli, pelanggan, atau pembayaran.
- Broadcast dikirim sebagai **private** (`true`), jadi anon tidak bisa
  berlangganan meski tahu nama topic.
- Policy `"stock topic readable by authenticated"` pada `realtime.messages`
  membatasi `select` ke `extension = 'broadcast' and realtime.topic() =
  'store:stock'`.
- Guard `to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null`
  membuat migrasi tetap bisa dijalankan di PGlite/Postgres lokal yang tidak
  punya schema `realtime`; di hosted Supabase fungsi itu selalu ada. Guard
  `to_regclass('realtime.messages')` melewati pembuatan policy bila tabel
  Realtime belum ada.

### Kapan trigger diam

- `stock_on_hand` **dan** `stock_version` sama-sama tidak berubah (mis. update
  nama, harga, kategori) — tidak membanjiri channel.
- `stock_on_hand` masih `NULL` (1.360 produk impor yang belum diopname) — tidak
  ada saldo untuk disiarkan; UI tetap menampilkan “—”.

## Klien

| Berkas | Isi |
| --- | --- |
| `app/utils/stock.ts` | `STOCK_TOPIC`, `STOCK_EVENT`, `parseStockBroadcast`, `applyStockBroadcast`. Murni, tanpa websocket, sehingga bisa diuji unit. |
| `app/composables/useStockRealtime.ts` | `useStockRealtime(client, {onStock, onResync})` → `{status, start, stop, reconnect}`. Channel private, `onScopeDispose`. |
| `app/stores/cashier.ts` | `applyStockChange(event)` + peta `stockVersions`, `resetStockVersions()`. |
| `app/composables/useCashierSearch.ts` | `applyStock(event)` memakai `applyStockBroadcast` dengan pembanding versi baris. |
| `app/pages/cashier/index.vue` | Mulai channel saat mount, berhenti saat unmount, `reconnect()` pada event `online`. |
| `app/components/cashier/CashierHeader.vue` | Badge “Stok live” / “Stok manual” dari status channel. |

### Aturan parsing

Pesan yang bentuknya tidak lengkap **diabaikan**, bukan dipaksakan: `product_id`
dan `sku` harus string tidak kosong, `stock_on_hand` dan `stock_version` harus
angka berhingga ≥ 0 (string numerik diterima karena PostgREST bisa
menyerialisasi `numeric` sebagai string). Payload dengan kunci tambahan
(`purchase_cost`, `customer_id`, …) tidak pernah masuk ke state — hanya empat
kunci yang dibaca.

### Urutan pesan

`products.stock_version` naik setiap kali saldo berubah. Klien menyimpan versi
terakhir per produk dan **menolak versi yang lebih lama atau sama**, sehingga
pesan yang tiba terlambat tidak mengembalikan angka ke saldo lama. Versi diisi
dari dua sumber:

1. `stock_version` ikut dibaca pada `PRODUCT_SELECT` kasir, lalu disemai saat
   produk masuk keranjang;
2. `resetStockVersions()` dipanggil setiap refetch (`refreshCartStock` dan
   resync setelah reconnect), karena hasil baca database selalu lebih baru
   daripada pesan yang diingat.

### Reconnect

Supabase Realtime menyambung ulang sendiri, tetapi pesan yang lewat saat
terputus **tidak diputar ulang**. Karena itu `onResync` memanggil
`refreshCartStock()` setiap kali channel mencapai `SUBSCRIBED` untuk kedua kali
dan saat browser kembali `online`. Refetch pertama tidak memicu resync
(`everSubscribed`) supaya tidak ada dua permintaan saat halaman dibuka.

## Uji

`npm run test:db` grup H (PGlite, dengan shim schema `realtime`):

| Tes | Yang dikunci |
| --- | --- |
| H1 | Satu update stok menghasilkan tepat satu pesan, topic `store:stock`, event `stock_changed`, `private = true`, dan payload hanya empat kunci. |
| H2 | Update nama dan update stok `NULL` tidak menghasilkan pesan. |
| H3 | Policy `realtime.messages` ada dan hanya untuk role `authenticated`. |

Tes unit: `tests/stock.test.ts` (8 tes parsing/penerapan versi) dan satu tes
store di `tests/cashier.test.mjs` (pesan lama ditolak, replay tidak
mengembalikan angka, `resetStockVersions` membuka guard).

## Batasan

- **Migrasi belum diterapkan ke preview.** Sama seperti Phase 5A, migrasi ini
  menunggu persetujuan eksplisit; tanpa itu channel tidak ada di hosted dan
  badge tetap “Stok manual”.
- Hanya saldo yang disinkronkan. Nama, harga, kategori, dan status aktif baru
  terlihat setelah pencarian ulang — perubahan itu jarang dan tidak boleh
  mengubah harga di keranjang yang sedang berjalan.
- Halaman inventaris (`/inventory`, movement, selisih) tetap baca manual;
  Realtime hanya dipasang di layar kasir karena di situlah keputusan jual
  dibuat.
- Uji end-to-end dua browser belum dijalankan (butuh dua sesi hosted); yang
  terverifikasi adalah SQL trigger, policy, dan logika klien.
