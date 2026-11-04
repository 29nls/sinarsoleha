# 15 — Plugin opsional & pengaturan (Phase 7)

Phase 7 menambahkan tiga integrasi opsional dari PRD §10 — printer thermal,
barcode scanner, dan gateway QRIS — di belakang satu kontrak adapter. Semua
default **nonaktif**; POS inti tetap bekerja saat adapter dimatikan, tidak
tersedia, atau gagal. Tidak ada migrasi baru: tabel `feature_flags` dan RPC
owner-only `set_feature_flag` sudah dibuat pada Phase 2.

## Rute

| Rute | Isi |
| --- | --- |
| `/settings` | Tiga kartu plugin: status, toggle, dan editor `public_config` non-rahasia. |

`definePageMeta({ capability: 'settings.manage' })` — hanya owner. Kasir dan
`inventory_staff` tidak melihat entri sidebar. Membaca flag diizinkan untuk
semua staff (dibutuhkan kasir untuk tahu adapter mana yang aktif), tetapi
menulis hanya lewat RPC yang memvalidasi peran owner di server dan menulis
`audit_logs` (`feature_flag.update`).

## Kontrak adapter

`app/adapters/contracts.ts` mendefinisikan siklus hidup yang sama untuk semua
plugin:

| Anggota | Arti |
| --- | --- |
| `enabled` | Nilai flag dari database; dikendalikan owner. |
| `available` | Adapter bisa berjalan di lingkungan ini (mis. gateway butuh server). |
| `status` | `off` / `ready` / `unavailable` / `error`. |
| `initialize()` | Menyiapkan adapter; tidak pernah melempar ke pemanggil. |
| `healthCheck()` | Pesan siap-operator tanpa kredensial. |
| `describe()` | Label pendek untuk header kasir/pengaturan. |

`statusFor()` memaksa `off` bila flag mati, sehingga plugin yang tidak tersedia
di lingkungan ini tidak pernah tampil "siap" hanya karena flag dinyalakan.
Method spesifik ditambahkan di atas kontrak: `print(receipt)` untuk printer,
`buffer.push(key)` untuk scanner, `charge()`/`checkStatus()` untuk QRIS.

`app/adapters/registry.ts` membuat ketiga adapter dari daftar flag. Halaman
kasir dan pengaturan hanya memakai registry, tidak mengimpor adapter konkret.

## Adapter

### Printer (`hardware.thermal_printer`)

- Transport yang benar-benar ada di perangkat ini adalah dialog cetak browser
  (`window.print()`), yang tetap memakai stylesheet nota yang sudah ada.
- Opsi `adapter: bridge` (mis. QZ Tray) dikenali tetapi dilaporkan
  `unavailable` sampai bridge benar-benar dipasang; tidak ada panggilan jaringan
  atau WebSocket palsu.
- `print()` mengembalikan `{ ok, message, fallbackUsed }`. Bila dialog gagal
  dibuka, nota tetap tampil di layar dan kasir mendapat pesan; checkout tidak
  pernah dibatalkan karena printer.
- `paper_width` (58/80 mm) dan `printer_name` hanya memengaruhi label/operator,
  bukan isi transaksi.

### Scanner (`hardware.barcode_scanner`)

- Keyboard-wedge: perangkat mengetik SKU lalu Enter/Tab.
- `createScanBuffer()` hanya menerima karakter tunggal, mereset buffer bila jeda
  antar-ketukan > 60 ms, dan mengabaikan kode lebih pendek dari `min_length`.
  Tombol modifier/navigasi diabaikan.
- `ProductSearch` memasang listener `keydown` di window hanya saat adapter
  `ready`; listener tidak aktif ketika fokus berada di input/textarea/select,
  tombol, atau elemen interaktif lain, agar pengetikan dan aktivasi tombol tetap
  normal. Spasi tidak pernah di-`preventDefault`.
- Kode yang selesai hanya ditambahkan bila ada **SKU persis**
  (`searchCashierProducts`). Hasil mirip tidak pernah dimasukkan otomatis, agar
  produk di keranjang tidak berbeda dari yang dipindai. Bila tidak ada, kasir
  mendapat pesan dan pencarian manual tetap bisa dipakai.
- Di dalam kolom pencarian, alur Enter yang sudah ada tetap dipakai — tidak ada
  dua jalur yang berebut. Bila daftar hasil belum sempat terisi (scan cepat),
  Enter hanya menambahkan SKU persis; nama yang diketik tidak pernah dicocokkan
  ke produk lain.

### QRIS (`payment.qris_gateway`)

- Charge dinamis memerlukan server tepercaya untuk menyimpan secret provider dan
  menerima webhook. Aplikasi ini SPA (`ssr: false`, tanpa Nitro runtime di
  hosting statis), jadi `available` selalu `false` dan `charge()` mengembalikan
  `unavailable` tanpa panggilan jaringan.
- `public_config` hanya boleh berisi label non-rahasia (`provider_label`,
  `merchant_name`). Tidak ada API key, signature key, atau webhook secret di
  browser.
- Alur QRIS manual di kasir tetap satu-satunya jalur: kasir memverifikasi
  pembayaran di aplikasi merchant lalu mencentang konfirmasi. Bila owner
  menyalakan flag, kasir melihat catatan bahwa gateway dinamis belum tersedia —
  bukan tombol yang diam-diam gagal.

## Konfigurasi publik

`sanitizePublicConfig()` adalah satu-satunya pintu masuk untuk
`public_config`, baik saat membaca baris database maupun sebelum menulis lewat
RPC:

- Hanya field yang dideklarasikan di `PLUGIN_DEFINITIONS` yang disimpan.
- Key yang tampak seperti rahasia (`secret`, `token`, `key`, `password`,
  `credential`, `signature`, `webhook`) selalu dibuang, bahkan bila field itu
  kelak ditambahkan ke definisi.
- Nilai harus primitif; objek/array dibuang. Select divalidasi terhadap daftar
  opsinya, teks dipotong sesuai `maxLength`, angka harus hingga 1.000.000.
- Baris dengan `feature_key` yang tidak dikenal diabaikan, sehingga flag masa
  depan tidak bocor ke UI ini.

## Perubahan UI

- `app/pages/settings/index.vue` + `app/components/settings/PluginCard.vue`
  memakai `.panel`, `.panel-head`, `.field`, `.field-label`, `.tag`, `.notice`,
  dan `.btn` yang sudah ada; tidak ada gaya baru.
- `app/pages/cashier/index.vue`: memuat flag saat mount, menampilkan catatan
  gateway QRIS bila flag menyala tetapi adapter tidak siap, meneruskan
  `scanBuffer`/`scannerEnabled` ke `ProductSearch`, dan meneruskan adapter
  printer ke `ReceiptView`.
- `app/pages/cashier/transactions/[id].vue`: cetak ulang memakai adapter printer
  yang sama.
- `ReceiptView` menampilkan pesan hasil cetak dan menonaktifkan tombol selama
  proses; saat plugin mati, jalur `window.print()` lama tetap dipakai.
- `app/utils/modules.ts`: entri `settings` menjadi `available: true`.

## Tes

| Berkas | Cakupan |
| --- | --- |
| `tests/plugins.test.ts` (24) | Status adapter, buffer scanner (suffix, jeda, panjang minimum, modifier), printer fallback/error/bridge, QRIS SPA, registry, sanitasi `public_config`, parsing baris flag. |
| `tests/settings-service.test.ts` (10) | Terjemahan error, pengisian flag yang hilang sebagai OFF, pengabaian key tak dikenal, pemanggilan RPC dengan konfigurasi tersanitasi, penolakan respons tak dikenal. |

## Verifikasi

| Perintah | Hasil |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **221/221 lulus** (16 file; 34 tes baru) |
| `npm run build` | exit 0 (14,6 dtk; 1,92 MB / 474 kB gzip) |

## Batasan

- Belum diuji dengan perangkat keras nyata; printer bridge dan gateway QRIS
  dinamis sengaja belum diimplementasikan.
- Perubahan flag memerlukan koneksi ke Supabase; saat gagal, UI menampilkan
  pesan dan semua adapter tetap OFF (tidak ada fallback "anggap aktif").
- Migrasi Phase 5A sudah diterapkan ke preview `ptbllrugrjepdhhdkzxn`
  (4 November 2026); produksi tidak disentuh.
