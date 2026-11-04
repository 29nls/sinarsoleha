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
- Status: **selesai & diuji; migrasi 5A + perbaikan recount 0020 sudah di preview; E2E browser 17/17 lulus (Phase 5D)**

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
| Request-id guard di daftar | Respons lama tidak menimpa hasil pencarian yang lebih baru |
| Tanpa token/design system baru | Memakai `.panel`, `.table-dense`, `.field`, `.btn`, `.tag`, `.notice` yang sudah ada |

## 4. Peta berkas

| Berkas | Isi |
| --- | --- |
| `app/types/opname.ts` | Status, label, `validateCount`, `reasonRequirement`, `allowedReasons`, `describeOpnameError`, `blockerCount` |
| `app/services/opname.ts` | Enam wrapper RPC + `listOpnames` + `getOpnameDetail`; mapping snake_case → camelCase |
| `app/composables/useOpnameList.ts` | Filter status, debounce pencarian 200 ms, pagination, request-id guard |
| `app/composables/useOpnameDetail.ts` | Detail, hitungan turunan (pending/recount/selisih/saldo awal), aksi, `conflicts`, `postResult` |
| `OpnameTable.vue` | Daftar sesi + progress `dihitung/total` |
| `OpnameCreateDialog.vue` | Cakupan sesi, pencarian produk (debounce), catatan cakupan |
| `OpnameItemTable.vue` | Tabel item, highlight konflik, tombol hitung |
| `OpnameCountDialog.vue` | Form hitung dengan validasi klien |
| `OpnameActionPanel.vue` | Status, ringkasan, submit/approve/post/cancel + dialog pembatalan |
| `OpnameConflictPanel.vue` | Panel konflik versi dan ringkasan hasil posting |

## 5. Batasan yang jujur

- **Migrasi Phase 5A sudah diterapkan ke preview** (`ptbllrugrjepdhhdkzxn`)
  pada 4 November 2026, jadi halaman bisa memuat data nyata. Produksi tidak
  disentuh.
- **E2E browser hosted sudah ada** (`e2e/stock-opname.spec.mjs`, `npm run test:e2e:inventory`): 17 skenario dengan tiga konteks terpisah — kasir ditolak, staf membuat/menghitung/mensubmit, owner menyetujui/memposting, saldo dan histori di `/inventory`, laporan selisih, sesi terposting tidak dapat diedit, sesi dibatalkan tidak mengubah stok, dan konflik versi muncul sebagai panel recount. Rincian di `docs/19-inventory-hosted-validation.md`.
- **Snapshot di dialog recount bisa basi.** Setelah konflik, halaman masih menampilkan `system_qty_snapshot` lama (mis. 13 padahal sistem sudah 12), sehingga dialog meminta alasan untuk selisih yang akan dibuang server saat rebase. Aman secara data, tetapi membingungkan operator.
- **Sesi seluruh katalog terpotong di UI.** `getOpnameDetail` mengambil semua item tanpa paginasi; PostgREST membatasi 1.000 baris, jadi sesi 1.361 item hanya menampilkan 1.000 baris dan hitungan `pending`/`selisih` ikut salah. Snapshot di database tetap lengkap.
- **Posting bersifat final** dan belum ada pembalik (reversal); koreksi
  dilakukan lewat sesi opname baru.
- **Tanpa Realtime**: dua operator yang membuka sesi sama tidak saling melihat
  hitungan sampai halaman dimuat ulang. Konflik tetap aman karena posting
  membandingkan `stock_version`.
- **Snapshot seluruh katalog** bisa berat untuk katalog besar; UI memperingatkan
  di dialog, tetapi belum ada estimasi jumlah baris sebelum membuat sesi.
- **Belum ada ekspor** hasil opname (CSV/PDF) dan belum ada riwayat hitung per
  item selain nilai terakhir.
