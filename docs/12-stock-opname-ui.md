# Phase 5B — UI Stok Opname

UI operasional untuk mesin opname Phase 5A: daftar sesi, pembuatan sesi,
penghitungan fisik, submit, persetujuan, posting, dan pembatalan. Seluruh
perubahan stok tetap terjadi di database; UI hanya memanggil RPC.

- Halaman: `app/pages/stock-opname/index.vue`, `app/pages/stock-opname/[id].vue`
- Tipe & validasi: `app/types/opname.ts`
- Layanan: `app/services/opname.ts`
- Composable: `app/composables/useOpnameList.ts`, `app/composables/useOpnameDetail.ts`
- Komponen: `app/components/opname/*.vue`
- Tes: `tests/opname.test.ts`, `tests/opname-service.test.ts`, `tests/opname-queries.test.ts`
- Status: **selesai & diuji; migrasi 5A + perbaikan recount 0020 sudah di preview; E2E browser 17/17 lulus (Phase 5D). Phase 5E menambahkan paginasi item, ringkasan agregat, dan konteks recount — tiga migrasi 0021–0023 belum diterapkan ke preview**

## 1. Alur pengguna

```
/stok-opname            daftar sesi (filter status, cari nomor, pagination)
   └─ Sesi baru         dialog cakupan: seluruh katalog | kategori | produk terpilih
/stok-opname/:id        detail: tabel item + panel status & tindakan
   ├─ Hitung / Ubah     dialog jumlah fisik + alasan + catatan
   ├─ Submit            hanya bila tidak ada item pending/needs_recount
   ├─ Setujui           owner-only, status submitted
   ├─ Posting           owner-only, konfirmasi eksplisit, status approved
   └─ Batalkan sesi     owner-only, alasan wajib, status belum posted
```

Navigasi muncul untuk owner dan inventory_staff (`opname.count`). Kasir tidak
melihat menu; middleware `definePageMeta({ capability: 'opname.count' })`
menolak akses langsung, dan RLS tetap menolak query-nya.

## 2. Matriks tindakan di UI

| Tindakan | Owner | Inventory staff | Sumber otorisasi |
| --- | --- | --- | --- |
| Lihat daftar & detail | ya | ya | RLS `*_select_staff` |
| Buat sesi | ya | ya | RPC `require_active_role(['owner','inventory_staff'])` |
| Hitung item | ya | ya | RPC yang sama |
| Submit | ya | ya | RPC yang sama |
| Setujui | ya | tidak (tombol tersembunyi + teks penjelas) | RPC `['owner']` |
| Posting | ya | tidak | RPC `['owner']` |
| Batalkan | ya | tidak | RPC `['owner']` |

UI memakai kapabilitas tampilan `opname.create`, `opname.count`, dan
`opname.approve`. Tombol posting dan pembatalan memakai `opname.approve` karena
ketiganya owner-only di database; ini hanya affordance, bukan kontrol keamanan.

## 3. Keputusan desain

| Keputusan | Alasan |
| --- | --- |
| Validasi klien mencerminkan guard RPC (`validateCount`) | Kesalahan presisi/alasan tertangkap sebelum round-trip; pesan RPC tetap ditampilkan bila lolos |
| `version_conflict` bukan toast error | Database sengaja mengembalikan JSON agar `needs_recount` dan reset approval ikut ter-commit; UI menampilkan panel recount dengan item yang ditandai |
| Item konflik di-highlight di tabel | Operator langsung tahu baris mana yang harus dihitung ulang |
| `opening_balance` dipaksa untuk stok `NULL` | Satu-satunya alasan yang sah; catatan wajib, dan UI menjelaskan bahwa itu saldo awal, bukan selisih |
| Alasan disembunyikan bila hitungan sama | Mengurangi noise; RPC juga mengabaikan alasan saat tidak ada selisih |
| `opnameId` reaktif di composable | Komponen halaman dapat dipakai ulang saat berpindah sesi; feedback sesi lama dibersihkan |
| Request-id guard di daftar dan detail | Respons lama tidak menimpa hasil pencarian atau halaman yang lebih baru |
| Paginasi lewat RPC, bukan `.range()` | Urutan yang dibaca operator adalah `sku`, dan kolom itu ada di `products`; join di database memberi urutan deterministik `sku ASC, id ASC` sekaligus filter/pencarian server-side |
| Ringkasan global lewat agregasi database | Satu halaman tidak pernah bisa menjawab "berapa yang masih pending"; `get_stock_opname_summary` menghitung seluruh sesi dan mengembalikan satu objek kecil |
| Konteks recount dibaca ulang saat dialog dibuka | Setelah konflik versi, snapshot di baris tabel memang basi; dialog memuat `current_qty`/`current_version` agar tiga angka (snapshot, stok sekarang, hitungan baru) tidak tertukar |
| Rebase tetap di `record_stock_opname_count` | Frontend tidak pernah menghitung selisih final; respons RPC yang dipakai untuk memperbarui baris |
| Tanpa token/design system baru | Memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, `.notice` yang sudah ada |

## 4. Peta berkas

| Berkas | Isi |
| --- | --- |
| `app/types/opname.ts` | Status, label, `validateCount`, `reasonRequirement`, `allowedReasons`, `describeOpnameError`, `blockerCount`, filter & ukuran halaman, `effectiveSystemQty` |
| `app/services/opname.ts` | Enam wrapper RPC mutasi + `listOpnames` + `getOpnameDetail` (summary) + `getOpnameItemsPage` + `getOpnameItemContext`; mapping snake_case → camelCase |
| `app/composables/useOpnameList.ts` | Filter status, debounce pencarian 200 ms, pagination, request-id guard |
| `app/composables/useOpnameDetail.ts` | Header + counter global dari summary, satu halaman item, filter/pencarian server-side, `fetchItemContext`, aksi, `conflicts`, `postResult` |
| `OpnameTable.vue` | Daftar sesi + progress `dihitung/total` |
| `OpnameCreateDialog.vue` | Cakupan sesi, pencarian produk (debounce), catatan cakupan |
| `OpnameItemTable.vue` | Tabel item, highlight konflik, tombol hitung, `emptyMessage`, overlay loading |
| `OpnameCountDialog.vue` | Tiga angka terpisah (snapshot / stok sekarang / hitungan baru), notice recount, validasi klien |
| `OpnameActionPanel.vue` | Status, delapan metrik global, submit/approve/post/cancel + dialog pembatalan |
| `OpnameConflictPanel.vue` | Panel konflik versi dan ringkasan hasil posting |

## 5. Paginasi, ringkasan global, dan recount (Phase 5E)

Tiga RPC baca baru, semuanya `SECURITY INVOKER`, `search_path = ''`, dan hanya
diberi `EXECUTE` ke `authenticated`:

| RPC | Masukan | Keluaran | Dipakai untuk |
| --- | --- | --- | --- |
| `get_stock_opname_summary(uuid)` | id sesi | header + 8 counter global + `blocker_count` + `ready_for_submit` | Panel tindakan dan label filter |
| `list_stock_opname_items(uuid, int, int, text, text)` | id sesi, limit 1–250, offset, filter, pencarian | `total` + satu halaman item terurut `sku ASC, id ASC` | Tabel item, navigasi halaman |
| `get_stock_opname_item_context(uuid)` | id item | snapshot + `current_qty`/`current_version` + satuan | Dialog hitung/hitung ulang |

### 5.1 Mengapa bukan `.range()` di klien

`getOpnameDetail` lama mengambil seluruh item dalam satu request. PostgREST
memotong respons di 1.000 baris, sehingga sesi seluruh katalog (1.361 item)
kehilangan 361 baris dan setiap hitungan turunan ikut salah. `.range()` di tabel
`stock_opname_items` juga tidak bisa mengurutkan berdasarkan `sku` karena kolom
itu milik `products`. Join di dalam database menyelesaikan keduanya: urutan
deterministik, filter dan pencarian berlaku untuk seluruh sesi, dan tie-breaker
`i.id` menjamin tidak ada baris yang muncul dua kali atau terlewat saat dua
produk berbagi SKU.

### 5.2 Ringkasan tidak pernah dihitung dari halaman

Delapan angka di panel — total, pending, sudah dihitung, perlu hitung ulang,
saldo awal, cocok dengan sistem, selisih, siap submit — berasal dari
`get_stock_opname_summary`. Label pada tombol filter memakai angka yang sama,
sehingga filter `pending` menampilkan jumlah global, bukan jumlah di halaman.
`ready_for_submit` dihitung dengan predikat blocker yang sama seperti
`submit_stock_opname`.

### 5.3 Alur hitung ulang

1. `post_stock_opname` mengembalikan `version_conflict`; item ditandai
   `needs_recount` dan sesi kembali ke `counting`.
2. Operator membuka dialog. Halaman memanggil `get_stock_opname_item_context`
   dan menampilkan **tiga angka terpisah**: snapshot opname, stok sistem saat
   ini, dan isian hitungan baru. Snapshot tidak pernah dilabeli "stok sekarang".
3. Validasi klien memakai `effectiveSystemQty()` — angka pembanding yang benar
   untuk baris tersebut — bukan snapshot lama.
4. `record_stock_opname_count` tetap me-rebase di dalam transaksinya sendiri dan
   mengembalikan snapshot yang benar-benar dipakai. Baris tabel diperbarui dari
   respons itu, lalu ringkasan diambil ulang.
5. Bila produk terjual lagi setelah dialog dibuka, database tetap otoritatif:
   hitungan disimpan terhadap snapshot baru dan UI menampilkan notice bahwa
   stok sistem disesuaikan.

## 6. Batasan yang jujur

- **Migrasi Phase 5A sudah diterapkan ke preview** (`ptbllrugrjepdhhdkzxn`)
  pada 4 November 2026, jadi halaman bisa memuat data nyata. Produksi tidak
  disentuh.
- **E2E browser hosted sudah ada** (`e2e/stock-opname.spec.mjs`, `npm run test:e2e:inventory`): 17 skenario dengan tiga konteks terpisah — kasir ditolak, staf membuat/menghitung/mensubmit, owner menyetujui/memposting, saldo dan histori di `/inventory`, laporan selisih, sesi terposting tidak dapat diedit, sesi dibatalkan tidak mengubah stok, dan konflik versi muncul sebagai panel recount. Rincian di `docs/19-inventory-hosted-validation.md`.
- **Posting bersifat final** dan belum ada pembalik (reversal); koreksi
  dilakukan lewat sesi opname baru.
- **Tanpa Realtime**: dua operator yang membuka sesi sama tidak saling melihat
  hitungan sampai halaman dimuat ulang. Konflik tetap aman karena posting
  membandingkan `stock_version`.
- **Snapshot seluruh katalog** bisa berat untuk katalog besar; UI memperingatkan
  di dialog, tetapi belum ada estimasi jumlah baris sebelum membuat sesi.
  Pembuatan sesi tetap satu statement database, bukan loop dari klien.
- **Pencarian item memakai `ILIKE`**, bukan indeks full-text. Cukup untuk 1.400
  baris per sesi; bila katalog tumbuh jauh, pertimbangkan `pg_trgm`.
- **Halaman item tidak di-cache.** Berpindah halaman memuat ulang dari database
  (satu request kecil). Ini disengaja: angka opname harus segar, dan cache
  halaman akan menampilkan `count_status` yang sudah usang setelah operator lain
  menghitung.
- **Belum ada ekspor** hasil opname (CSV/PDF) dan belum ada riwayat hitung per
  item selain nilai terakhir.

## 7. Checklist kesiapan stok opname fisik (untuk owner)

Checklist ini disiapkan agar opname fisik pertama bisa dijalankan tanpa
menyentuh data uji. Semua langkah di bawah **belum** dijalankan.

### Sebelum hari-H

- [ ] Tiga migrasi Phase 5E (0021–0023) diterapkan ke preview dan
      `migration list --linked` menunjukkan 23/23.
- [ ] `npm run test:db` tetap 101/101 setelah migrasi diterapkan.
- [ ] Cleanup fixture disetujui dan dijalankan (lihat
      `docs/20-preview-fixture-inventory.md`); katalog tidak lagi memuat produk
      `TEST-*`/`HOST-*` yang aktif.
- [ ] Akun `INVENTORY_STAFF_B` dibuat owner lewat Supabase Auth Dashboard,
      profilnya berperan `inventory_staff` dan aktif.
- [ ] Dua staf gudang sudah login sekali dan bisa membuka `/stock-opname`.
- [ ] Owner dan staf menyepakati daftar alasan selisih yang akan dipakai
      (rusak, hilang, salah input, keluar/masuk tanpa catatan, konversi satuan,
      lainnya).
- [ ] Perangkat sudah dicoba: satu browser kasir tetap terbuka untuk menguji
      konflik versi secara sengaja.

### Saat membuat sesi

- [ ] Pilih cakupan yang benar: seluruh katalog untuk opname menyeluruh,
      kategori untuk opname bertahap, produk terpilih untuk koreksi terarah.
- [ ] Catat `opname_no` dan rentang SKU yang menjadi tanggung jawab tiap staf;
      dua staf tidak menghitung rak yang sama.
- [ ] Pastikan tidak ada transaksi kasir yang sedang berjalan saat sesi
      dihitung, atau terima bahwa item yang terjual akan menjadi
      `needs_recount`.

### Saat menghitung

- [ ] Isi jumlah fisik sesuai satuan yang tertera (perhatikan `decimal_scale`).
- [ ] Untuk produk berstok `NULL`, gunakan alasan `opening_balance` dan tulis
      catatan; ini saldo awal, bukan selisih.
- [ ] Untuk setiap selisih, pilih alasan dan tulis catatan bila alasan
      `other`.
- [ ] Jangan menutup browser di tengah penyimpanan; tunggu notice sukses.
- [ ] Bila muncul panel recount, buka dialog dan baca **tiga angka**: snapshot
      opname, stok sistem saat ini, dan hitungan baru. Hitung ulang secara fisik,
      jangan menyalin angka snapshot.

### Sebelum submit

- [ ] Panel tindakan menunjukkan `pending = 0` dan `needs_recount = 0`.
- [ ] `blocker_count = 0` dan tombol submit aktif.
- [ ] Owner sudah meninjau daftar selisih pada filter `difference`.

### Setelah posting

- [ ] Owner menyetujui, lalu memposting dengan konfirmasi eksplisit.
- [ ] Periksa `/inventory`: saldo berubah hanya untuk item yang selisih.
- [ ] Periksa `/inventory/movements`: setiap perubahan punya movement
      `opname_adjustment` atau `opening_balance` dengan pelaku yang benar.
- [ ] Periksa `/inventory/discrepancies`: setiap selisih punya alasan.
- [ ] Posting bersifat final; koreksi berikutnya harus lewat sesi baru.

### Yang tidak boleh dilakukan

- Jangan mengedit `products.stock_on_hand` langsung dari SQL atau Table Editor.
- Jangan menghapus sesi `posted`, movement, atau log selisih untuk "merapikan".
- Jangan memposting saldo awal sebelum hitungan fisik benar-benar selesai.
