# 19 — Validasi Inventaris Hosted (Phase 5D)

Phase 5D memvalidasi mesin opname Phase 5A dan UI 5B/5C terhadap project preview
`ptbllrugrjepdhhdkzxn` dengan sesi terautentikasi nyata. Fase ini **tidak**
menambah fitur: yang ditambahkan hanya satu perbaikan mesin (migrasi 0020) yang
ditemukan saat audit, plus suite uji hosted dan E2E browser.

- Suite hosted: `scripts/inventory-hosted-smoke.mjs` → `npm run test:hosted:inventory`
- Suite browser: `e2e/stock-opname.spec.mjs` → `npm run test:e2e:inventory`
- Migrasi: `supabase/migrations/20261106130000_opname_recount_rebase.sql` (0020)
- Produksi: **tidak disentuh**. Tidak ada migrasi, fixture, atau sesi di produksi.

## 1. Ringkasan hasil

| Lapisan | Perintah | Hasil |
| --- | --- | --- |
| Database lokal (PGlite) | `npm run test:db` | **94/94 lulus** (sebelumnya 93) |
| Unit klien | `npm test` | **257/257 lulus** |
| Tipe | `npm run typecheck` | exit 0 |
| Build | `npm run build` | exit 0 (18,3 detik) |
| Bundle | `npm run audit:bundle` | 0 temuan pada 151 berkas / 2.573 kB |
| Hosted API | `npm run test:hosted:inventory` | **24/24 lulus** |
| Browser E2E | `npm run test:e2e:inventory` | **17/17 lulus** |
| Riwayat migrasi | `migration list --linked` | **20/20 sinkron** |

## 2. Audit read-only sebelum eksekusi

Probe read-only (tanpa menulis baris apa pun) memverifikasi:

| Pemeriksaan | Hasil |
| --- | --- |
| Target | `ptbllrugrjepdhhdkzxn` — cocok dengan `supabase/.temp/project-ref` dan `projects list` |
| Akun owner | `owner` / active |
| Akun staf gudang | `inventory_staff` / active |
| Akun kasir + kasir B | `cashier` / active |
| Akun nonaktif | `cashier` / **inactive** |
| Enam RPC opname + `adjust_stock`, `complete_sale`, `void_sale` | semuanya ada (OPTIONS 204) |
| RLS baca | gudang melihat 5 sesi + 55 movement; kasir dan nonaktif 0 |
| Katalog awal | 1.373 produk, 1.369 stok `NULL`, 4 berstok, 7 `TEST-*`, 5 `HOST-*` |
| Jejak opname awal | 5 sesi (1 posted, 3 cancelled, 1 fixture); `opname_adjustment` **0**, `stock_discrepancy_logs` **0**, `post_conflict` **0** |

Angka terakhir itu penting: sebelum 5D, jalur penyesuaian stok-known, log
selisih, dan konflik versi **belum pernah berjalan di hosted**. Yang terbukti
hanya saldo awal.

Catatan tanggal: beberapa migrasi bertanggal 5–6 November 2026 sementara sistem
4 November 2026. Status "sudah diterapkan" tidak diasumsikan — dibuktikan lewat
`migration list --linked`, keberadaan RPC, dan efek yang bisa diamati (13
movement `manual_adjustment`, empat produk `TEST-REALTIME-*`, satu run impor
selesai).

## 3. Cacat yang ditemukan dan diperbaiki (0020)

`post_stock_opname` membandingkan `products.stock_version` dengan
`stock_opname_items.stock_version_snapshot`. Saat terjadi konflik, item ditandai
`needs_recount` dan sesi kembali ke `counting` — tetapi **tidak ada yang
me-refresh snapshot**. Akibatnya posting berikutnya melihat versi lama yang sama
dan mengembalikan `version_conflict` lagi, selamanya. Tes lokal F2 berhenti tepat
di `approved`, jadi cacat ini tidak pernah tertangkap.

Migrasi 0020 mengubah `private.record_stock_opname_count`: bila item berstatus
`needs_recount`, snapshot `system_qty_snapshot` dan `stock_version_snapshot`
dibaca ulang dari `products` sebelum aturan alasan dievaluasi. Ini semantik yang
benar untuk recount — operator menghitung terhadap stok yang dipegang sistem
sekarang, bukan angka pra-penjualan.

Konsekuensi yang ikut diperbaiki: tanpa rebase, `quantity_before` pada movement
akan memakai snapshot lama sehingga ledger drift. Tes F3 mengunci keduanya:
setelah penjualan 30 → 25, recount 24 menghasilkan movement `-1` dengan
`quantity_before = 25`, jumlah ledger = 24, dan tepat satu log selisih dengan
`system_qty = 25`.

## 4. Cakupan hosted (24 tes)

| Kelompok | Yang dikunci |
| --- | --- |
| Create | satu baris per produk terpilih, `NULL` dipertahankan, stok tidak berubah, retry `idempotency_key` mengembalikan sesi sama |
| Count | stok tidak berubah sebelum posting; staf boleh menghitung; kasir, nonaktif, anon ditolak `42501` |
| Approve | owner-only; stok tidak berubah; tanpa movement |
| Post (opening) | `quantity_before NULL`, delta = setelah, alasan `opening_balance`, aktor benar, versi +1, tanpa log selisih |
| Post (known) | no-change tanpa movement/log; +3 dan −2 dengan `opname_adjustment`; log selisih dengan `approved_by` owner; aritmetika `before + delta = after` |
| Guard | qty negatif, presisi PCS, alasan wajib, `other` wajib catatan, `opening_balance` pada stok known, reason tak dikenal, catatan saldo awal wajib |
| Submit | sesi tidak lengkap ditolak `OPNAME_INCOMPLETE` dengan daftar blocker di `detail` |
| Konflik | penjualan setelah snapshot → `version_conflict`, item `needs_recount`, sesi `counting`, approval dibersihkan, tidak ada movement/log stale, audit `opname.post_conflict` |
| Recount | snapshot ter-rebase (9/versi 2), selisih 0, submit → approve → post berhasil, tanpa movement dan tanpa kenaikan versi |
| Posting paralel | dua klien owner terpisah, `overlap=true`, hasil `posted` + `already_posted`, tepat satu movement, tepat satu audit `opname.post`, stok tidak dobel |
| Cancel | owner-only, alasan wajib, idempoten, stok tidak berubah, sesi posted menolak pembatalan (`OPNAME_POSTED`) |
| Otorisasi | staf: create/count/submit ya, approve/post/cancel tidak; kasir/nonaktif/anon: semua mutasi ditolak |
| Realtime | satu event privat `stock_changed` dengan `product_id`, `sku`, `stock_on_hand`, `stock_version`; tidak ada harga beli/pelanggan |
| Skala | snapshot 1.361 item dalam **113–114 ms**, sesi dibatalkan tanpa posting |
| Rekonsiliasi | saldo setiap fixture = jumlah delta ledger; satu movement pembuka per produk; setiap movement punya aktor; tidak ada kunci idempoten ganda |

### Angka konkurensi

| Percobaan | Overlap | Hasil | Latensi |
| --- | --- | --- | --- |
| Run 1 | ya | `posted` / `already_posted` | 88 ms / 112 ms |
| Run 2 | ya | `posted` / `already_posted` | 74 ms / 90 ms |

Kedua permintaan benar-benar tumpang tindih (interval kirim–terima beririsan),
bukan retry berurutan.

## 5. Cakupan browser E2E (17 skenario)

Tiga konteks browser terpisah (owner, staf gudang, kasir); tidak ada storage
state bersama.

| Skenario | Hasil |
| --- | --- |
| Kasir membuka `/stock-opname` | ditolak ("Anda tidak memiliki izin") |
| Staf membuat sesi untuk 3 fixture | 3 item, halaman detail terbuka |
| Hitung stok `NULL` tanpa catatan | validasi "Catatan wajib diisi untuk saldo awal." |
| Hitung stok `NULL` = 25 | tersimpan sebagai saldo awal |
| Hitung fisik 0 | diterima |
| Seed stok known = 10 | tersimpan sebagai saldo awal |
| Staf submit | status menunggu persetujuan |
| Owner menyetujui | status disetujui |
| Owner posting | panel "Posting selesai" |
| Saldo baru di `/inventory` | 25 |
| Histori pergerakan | baris "Saldo awal" |
| Saldo awal bukan selisih | tidak ada baris di laporan selisih |
| Selisih 10 → 13 tanpa alasan | validasi "Selisih stok wajib memiliki alasan." lalu +3 terposting |
| Laporan selisih | "Masuk tanpa catatan", +3 |
| Jumlah sama dengan sistem | field alasan tidak muncul |
| Sesi terposting | tidak ada tombol Hitung/Ubah/Setujui/Batalkan |
| Sesi dibatalkan | stok tetap 25 |
| Konflik versi | panel "Stok berubah saat menghitung", tag perlu hitung ulang, lalu recount → post → saldo 12 |

## 6. Rekonsiliasi katalog

| Pemeriksaan | Hasil |
| --- | --- |
| Produk impor (SKU non `TEST-`/`HOST-`) | **1.361** |
| Produk impor berstok `NULL` | **1.361** (tidak satu pun tersentuh) |
| Movement pada produk impor | **0** |
| Total produk preview setelah uji | 1.409 (48 di antaranya fixture `TEST-*`/`HOST-*`, 40 nonaktif) |
| Total movement preview | 104 |

Fixture Phase 5D dinonaktifkan (`is_active = false`) di akhir setiap run. Tidak
ada movement, log selisih, atau audit yang dihapus — ledger tetap append-only.

## 7. Temuan yang belum diperbaiki

> **Status per Phase 5E (4 November 2026):** butir 1, 2, dan 5 sudah ditangani
> di kode dan diuji lokal. Tiga migrasi baru (0021–0023) **belum diterapkan ke
> preview**, jadi perilaku hosted di bawah ini masih yang berlaku sampai migrasi
> dijalankan. Butir 3 dan 4 tetap terbuka.

1. ~~**Pembacaan detail terpotong 1.000 baris.**~~ **Diperbaiki di 5E.** Detail
   tidak lagi memuat item; header dan counter berasal dari
   `get_stock_opname_summary`, tabel memakai `list_stock_opname_items` dengan
   `limit`/`offset` dan urutan `sku ASC, id ASC`. Lihat `docs/12` §5.
2. ~~**Snapshot basi di dialog recount.**~~ **Diperbaiki di 5E.** Dialog memuat
   `get_stock_opname_item_context` dan menampilkan snapshot, stok sistem saat
   ini, dan hitungan baru sebagai tiga angka terpisah; rebase tetap di
   `record_stock_opname_count`.
3. **Pemeriksaan kelengkapan di `approve` tidak terjangkau lewat API.** `submit`
   sudah menjamin nol blocker, dan item tidak dapat diubah saat `submitted`.
   Pemeriksaan itu murni defensif; tidak dapat diuji tanpa memanipulasi tabel.
4. **Akun `INVENTORY_STAFF_B` belum ada.** Spesifikasi 5D meminta dua akun staf.
   Skenario yang dijalankan hanya butuh satu; independensi sesi dibuktikan
   dengan dua klien owner untuk posting paralel. Instruksi pembuatan ada di
   `docs/17-users-audit.md`.
5. ~~**Fixture uji menumpuk di preview.**~~ **Diinventarisasi di 5E.** Audit
   read-only atas 48 produk: A=0, B=13, C=3, D=32; tidak ada kandidat hapus
   fisik. Rencana pengarsipan dan dry-run ada di
   `docs/20-preview-fixture-inventory.md`, menunggu approval owner.

## 8. Batasan yang jujur

- Konkurensi diuji dengan dua sesi HTTP nyata ke PostgREST; bukan simulasi
  berurutan.
- Realtime diverifikasi lewat klien SDK, bukan dua browser yang saling
  memperhatikan; latensi dua browser sudah diukur terpisah pada NFR-04 (899 ms).
- UAT manual (printer thermal, scanner, QRIS dinamis, CSP/HSTS) tetap terbuka.
- Seluruh pekerjaan hanya pada preview. Produksi belum menerima migrasi apa pun.
