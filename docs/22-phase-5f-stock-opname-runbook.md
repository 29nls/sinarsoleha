# 22 — Runbook Phase 5F: Stok Opname Fisik Nyata

Status per 4 November 2026: **SELESAI DI PREVIEW.** Gate A1 diterima, latihan A2
dijalankan dalam dua sesi pada kategori `PERABOTAN MANGKUK`, dan verifikasi A3
(§6.1–6.8) lulus. Bukti lengkap ada di §11. Produksi belum disentuh; hitungan
fisik penuh tetap menjadi D5 di `docs/24`.

Prasyarat akun terpenuhi: `INVENTORY_STAFF_B`
(`phase5f.staffb@sinarsoleha.com`) ada dan terverifikasi 8/8.

## 1. Definisi selesai

Phase 5F selesai bila seluruh butir berikut benar, bukan hanya bila satu sesi
berhasil diposting:

1. Dua `inventory_staff` aktif (`a3333333-…` dan staf B) masing-masing bisa
   membuka `/stok-opname`; keduanya **tidak** bisa membuka `/users`, menyetujui,
   memposting, atau membatalkan sesi.
2. Satu sesi opname nyata dibuat, dihitung oleh dua orang pada rentang SKU yang
   tidak tumpang tindih, lalu `submit`. Untuk preview, sesi itu adalah latihan
   kategori `PERABOTAN MANGKUK` (§5.0); hitungan seluruh katalog dikerjakan di
   produksi sebagai D5.
3. `blocker_count = 0`, `pending = 0`, dan `needs_recount = 0` sebelum submit.
4. Owner menyetujui lalu memposting satu kali dengan konfirmasi eksplisit.
5. Setiap perubahan saldo punya movement `opname_adjustment` atau
   `opening_balance` dengan pelaku yang benar; tidak ada movement tanpa pasangan.
6. Setiap selisih punya alasan; `other` punya catatan.
7. Konflik versi dibuktikan sekali secara sengaja (bukan hanya secara teori) dan
   terselesaikan lewat recount, bukan dengan mengedit tabel.
8. Tidak ada `DELETE`, `CASCADE`, edit `stock_on_hand` langsung, atau pembersihan
   riwayat.

## 2. Gate

Phase 5F mengubah saldo nyata dan menulis ledger permanen, jadi butuh gate
tersendiri. Frasa yang harus diketik pengguna, persis:

```
APPROVE PHASE 5F REAL STOCK OPNAME ON PREVIEW
```

Gate ini **tidak** diwarisi dari gate migrasi 5E atau gate arsip fixture. Tanpa
frasa itu, pekerjaan berhenti pada langkah persiapan read-only.

## 3. Batas aman

- Target hanya preview `ptbllrugrjepdhhdkzxn`. Produksi tidak disentuh.
- Tidak ada `DELETE` atau `CASCADE`, termasuk untuk "merapikan" sesi uji.
- `stock_on_hand` tidak pernah diedit lewat SQL atau Table Editor; satu-satunya
  jalur adalah RPC opname.
- Tidak ada `service_role` di klien dan tidak ada kredensial yang dicetak.
- Sesi yang sudah `posted` bersifat final. Koreksi berikutnya lewat sesi baru.
- A2 memakai **dua** sesi latihan pada kategori yang sama: L1 untuk menetapkan
  saldo awal, L2 untuk membuktikan konflik versi (§5.3). Tidak ada sesi lain di
  luar itu tanpa permintaan owner.

## 4. Persiapan (read-only, boleh dilakukan sekarang)

| # | Langkah | Bukti |
| --- | --- | --- |
| 4.1 | Konfirmasi 23/23 migrasi | `npx supabase migration list --linked` |
| 4.2 | Konfirmasi 0 fixture `TEST-*`/`HOST-*` aktif | query `products` |
| 4.3 | Konfirmasi 2 `inventory_staff` aktif | `npm run test:hosted:opname:staff-b` |
| 4.4 | Regresi read-only | `npm run test:hosted:opname` → 11/11 |
| 4.5 | Catat baseline saldo | `stock_on_hand`, `stock_version`, jumlah movement |
| 4.6 | Sepakati daftar alasan selisih | rusak, hilang, salah input, keluar/masuk tanpa catatan, konversi satuan, lainnya |
| 4.7 | Bagi rentang SKU | tulis pembagian per staf; tidak boleh tumpang tindih |
| 4.8 | Siapkan satu browser kasir terbuka | untuk memicu konflik versi secara sengaja |

Baseline 4.5 wajib dicatat sebelum sesi dibuat. Tanpa baseline, klaim "hanya
item yang selisih berubah" tidak bisa dibuktikan.

### Baseline 4 November 2026 (read-only)

Diambil dari preview sebelum sesi nyata dibuat; tidak ada baris yang ditulis.

| Metrik | Nilai |
| --- | --- |
| Produk total / aktif | 1.409 / 1.361 |
| Stok `NULL` | 1.374 |
| Jumlah `stock_on_hand` | 377 |
| Jumlah `stock_version` | 76 |
| Fixture total / aktif | 48 / **0** |
| `stock_movements` | 104 |
| `stock_opnames` | 58 |
| `stock_opname_items` | 2.802 |
| `stock_discrepancy_logs` | 13 |

Catatan: tabel log selisih bernama **`stock_discrepancy_logs`**. Query ke
`stock_discrepancies` akan gagal atau mengembalikan nol dan membuat baseline
tampak bersih padahal tidak.

Angka ini adalah pembanding, bukan target. Setelah posting, selisih yang sah
hanya boleh muncul pada item yang memang dihitung berbeda.

**Diverifikasi ulang 4 November 2026 17:21 UTC** (read-only, sesi pra-gate):
1.409 / 1.361 produk, 1.374 stok `NULL`, 35 baris berstok dengan jumlah
`stock_on_hand` 377 dan jumlah `stock_version` 76, 104 movement, 58 opname,
2.802 item, 13 log selisih, 0 fixture `TEST-*`/`HOST-*` aktif. Semua angka
sama dengan tabel di atas — baseline masih sah, tidak ada yang bergeser sejak
impor 1.361 produk.

### Verifikasi staf B

`npm run test:hosted:opname:staff-b` membaca kredensial staf B dari
`.tmp/phase5f-staff-b.json` (gitignored, tidak pernah dikomit):

```json
{ "email": "…", "password": "…" }
```

Skrip ini read-only dan memeriksa delapan hal: kredensial bisa login, profil
`inventory_staff` aktif, ada dua staf aktif yang berbeda, staf B bisa membaca
permukaan opname, staf B hanya melihat profilnya sendiri, staf B ditolak
`approve`/`post`/`cancel`, sesi staf A dan B berbeda, dan tidak ada baris yang
berubah. Exit code 1 selama staf B belum ada.

Probe penolakan memakai UUID nol. Setiap RPC owner-only memanggil
`private.require_active_role(array['owner'])` sebagai statement pertama, sebelum
mencari baris, sehingga staf ditolak tanpa lookup dan tanpa tulis.

Selama staf B belum ada, hasilnya **1 passed, 7 failed** — hanya tes "tidak
menulis" yang lulus. Itu perilaku yang benar, bukan kegagalan skrip.

## 5. Urutan eksekusi

### 5.0 Cakupan latihan (A2)

Sesuai keputusan owner 4 November 2026 (butir a), A2 adalah **latihan kecil**,
bukan hitungan penuh. Cakupan yang dipilih: kategori **`PERABOTAN MANGKUK`
(id 131)** — 18 produk, semuanya aktif, semuanya berstok `NULL`.

Alasan pemilihan: cukup kecil untuk diselesaikan dua orang dalam satu duduk,
semua item memakai jalur `opening_balance` (sehingga saldo awal dan selisih
teruji sekaligus), dan tidak ada produk berstok yang bisa merusak baseline §4.5
selain 18 baris ini.

Kedelapan belas item dihitung dan diposting di sesi L1. Konflik versi tidak bisa
dipicu di sesi ini karena semua produk masih berstok `NULL`; buktinya diambil di
sesi L2 sesuai §5.3.

### 5.1 Membuat sesi

1. Owner atau staf A membuat sesi dari `/stok-opname` → **Sesi baru**.
2. Pilih cakupan: seluruh katalog untuk opname menyeluruh, kategori untuk
   bertahap, produk terpilih untuk koreksi terarah.
3. Catat `opname_no` dan `id` sesi.
4. Pastikan tidak ada transaksi kasir berjalan, atau terima bahwa item yang
   terjual akan menjadi `needs_recount`.

### 5.2 Menghitung

1. Staf A dan staf B menghitung rentangnya masing-masing, bergantian pada
   perangkat masing-masing.
2. Isi jumlah fisik sesuai `decimal_scale` produk.
3. Produk berstok `NULL` memakai alasan `opening_balance` **dan** catatan; itu
   saldo awal, bukan selisih.
4. Setiap selisih memakai alasan; `other` wajib catatan.
5. Tunggu notice sukses sebelum menutup atau berpindah halaman.

### 5.3 Membuktikan konflik versi

Konflik versi **tidak bisa** dipicu pada sesi yang masih mengisi saldo awal.
`complete_sale` dan `adjust_stock` sama-sama menolak produk berstok `NULL`
(`STOCK_UNKNOWN`), jadi satu-satunya cara mengubah `stock_version` sebelum
posting adalah posting opname itu sendiri. Karena itu bukti konflik diambil
pada **sesi kedua** atas kategori yang sama, setelah sesi pertama menetapkan
saldo.

Urutan:

1. Sesi L2 dibuat atas kategori `PERABOTAN MANGKUK`, sekarang produknya sudah
   berstok. Catat `stock_on_hand` dan `stock_version` satu produk yang punya
   `sale_price` (misalnya `PER-M1128`).
2. Hitung semua item **kecuali** produk itu; biarkan satu item `pending`.
3. Dari browser kasir, jual 1 unit produk tersebut dan selesaikan pembayaran.
   Verifikasi `stock_version` naik 1.
4. Kembali ke sesi opname, simpan hitungan untuk item itu dengan angka fisik
   yang benar (bukan menyalin snapshot).
5. Submit lalu approve, kemudian posting. Posting harus mengembalikan
   `result = version_conflict`, sesi kembali `counting`, approval direset, dan
   panel **Stok berubah saat menghitung** muncul dengan snapshot, stok sekarang,
   dan `versi lama → versi baru`.
6. Hitung ulang item itu; dialog harus menampilkan stok live, bukan snapshot.
   Simpan, submit, approve, posting lagi — kali ini `result = posted`.

Bila panel tidak muncul, jangan lanjut. Itu regresi, bukan keberhasilan.

### 5.4 Submit

1. Panel tindakan harus menunjukkan `pending = 0` dan `needs_recount = 0`.
2. `blocker_count = 0` dan tombol submit aktif.
3. Owner meninjau filter `difference` sebelum submit.
4. Submit. Status menjadi `submitted` dan item tidak dapat diubah lagi.

### 5.5 Setujui dan posting

1. Owner menyetujui → status `approved`.
2. Owner memposting dengan konfirmasi eksplisit → status `posted`.
3. Posting hanya sekali. Jangan mengulang bila respons ambigu; periksa status
   sesi dan movement terlebih dahulu.

## 6. Verifikasi setelah posting

| # | Yang diperiksa | Kriteria lulus |
| --- | --- | --- |
| 6.1 | `/inventory` | hanya item yang selisih berubah saldonya |
| 6.2 | `/inventory/movements` | setiap perubahan punya `opname_adjustment`/`opening_balance` dengan pelaku benar |
| 6.3 | `/inventory/discrepancies` | setiap selisih punya alasan; `other` bercatatan |
| 6.4 | Movement vs item | jumlah movement sesuai jumlah item yang berubah; tidak ada yatim |
| 6.5 | `stock_version` | naik tepat sekali per item yang berubah |
| 6.6 | Audit | ada entri posting dengan aktor owner |
| 6.7 | Sesi `posted` | tidak dapat diubah, dibatalkan, atau diposting ulang |
| 6.8 | Regresi read-only | `npm run test:hosted:opname` tetap 11/11 |

## 7. Rollback dan kegagalan

- **Sesi belum `posted`:** owner membatalkan sesi dengan alasan wajib. Tidak ada
  saldo yang berubah; tidak ada yang perlu dihapus.
- **Submit ditolak:** baca `blocker_count` dan daftar item; selesaikan hitungan,
  jangan memaksa lewat SQL.
- **Konflik versi berulang:** hentikan transaksi kasir pada item itu, hitung
  ulang, lalu submit lagi.
- **Posting ambigu (timeout/500):** jangan posting ulang. Periksa status sesi
  dan movement lebih dulu; posting ganda harus dianggap insiden.
- **Salah hitung setelah `posted`:** buat sesi koreksi baru. Jangan mengedit
  saldo, movement, atau log selisih.

## 8. Bukti yang harus disimpan

- `opname_no`, `id` sesi, dan rentang SKU per staf.
- Tangkapan panel status sebelum submit (`pending`, `needs_recount`,
  `blocker_count`).
- Tangkapan panel recount saat konflik versi.
- Angka baseline dan angka setelah posting untuk item yang berubah.
- Keluaran `npm run test:hosted:opname` setelah posting.
- Daftar movement yang dibuat, dengan `id`, `product_id`, `type`, dan aktor.

## 9. Yang tidak boleh dilakukan

- Memakai akun bersama atau menaikkan peran lewat `user_metadata`.
- Menyalakan sign-up publik sebagai jalan pintas staf B.
- Mengedit `products.stock_on_hand` langsung dari SQL atau Table Editor.
- Menghapus sesi, movement, atau log selisih untuk "merapikan".
- Memposting saldo awal sebelum hitungan fisik benar-benar selesai.
- Menjalankan `npm run test:hosted:inventory` atau `npm run test:e2e:inventory`
  tanpa otorisasi tertulis terpisah; keduanya menulis fixture dan posting.

## 10. Status

| Item | Status |
| --- | --- |
| Runbook | selesai — dokumen ini |
| Migrasi 23/23 | selesai — `migration list --linked`, 23 baris local+remote, 4 November 2026 |
| Fixture aktif | 0 — diverifikasi ulang 4 November 2026 |
| Baseline §4.5 | selesai — lihat tabel di atas, dicocokkan ulang 17:21 UTC |
| Regresi read-only | 11/11 lulus — `npm run test:hosted:opname`, exit 0 |
| Verifikasi staf B | **8/8 lulus** — `npm run test:hosted:opname:staff-b`, exit 0 |
| Staf B | **ada & aktif** — `phase5f.staffb@sinarsoleha.com`, `4ba5012e-7e53-4f85-892d-27524eb8071a` |
| Gate Phase 5F | **diterima** — owner mengetik frasa A1 persis, 4 November 2026 |
| Cakupan A2 | kategori `PERABOTAN MANGKUK` (id 131), 18 produk aktif — lihat §5.0 |
| Sesi opname nyata | **2 sesi, keduanya `posted`** — `OP-20261104-0058` (L1) dan `OP-20261104-0059` (L2) |
| Posting | **selesai** — 18 movement `opening_balance`, 0 penyesuaian, 0 log selisih baru |
| Konflik versi | **terbukti** — `version_conflict` pada L2, recount me-rebase snapshot 3→2, posting kedua `posted` |
| Verifikasi §6 | **8/8 lulus** — rincian di §11.3 |
| Regresi setelah drill | 11/11 lulus ulang — `npm run test:hosted:opname` |
| Produksi | tidak disentuh |

## 11. Bukti pelaksanaan A2 (preview, 4 November 2026)

Dijalankan setelah gate A1 diterima. Semua tulisan melewati RPC opname; tidak
ada `DELETE`, tidak ada `UPDATE products.stock_on_hand`, tidak ada
`service_role` di klien.

### 11.1 Dua sesi

| | L1 — saldo awal | L2 — konflik versi |
| --- | --- | --- |
| `opname_no` | `OP-20261104-0058` | `OP-20261104-0059` |
| `id` | `c857ade8-a131-4eec-85ce-4582c4b1a9a3` | `a1155c71-d66b-4d26-a013-63ad8f18d451` |
| Item | 18 | 18 |
| Snapshot versi | 0 untuk 18 item (semua `NULL`) | 1 untuk 17 item, 2 untuk `PER-M1128` setelah recount |
| Pembagian hitung | 9 staf B + 9 owner | 10 staf B + 8 owner |
| Hasil post | `opening_balance_count = 18`, `delta_total = 54`, `discrepancy_count = 0` | `unchanged_count = 18`, `discrepancy_count = 0` |
| Status akhir | `posted` 17:42:57Z | `posted` 17:45:01Z |

Angka hitung latihan = **3 per produk**, bukan saldo fisik nyata. Setiap
`reason_note` menyebut "Latihan A2 (preview): angka latihan, bukan saldo fisik
nyata" supaya angka ini tidak pernah dikira hasil hitung gudang.

### 11.2 Konflik versi yang terbukti

1. `PER-M1128` (produk `0b14127f-0dd2-4e66-9719-81ec173146dc`, `sale_price`
   6000) sengaja dibiarkan `pending` saat 17 item lain dihitung.
2. Kasir menjual 1 unit lewat nota `SS-20261104-0007`
   (transaksi `e19ff76c-9234-4a81-9993-65f5974f2c30`): movement id 125,
   `sale_out`, `3 → 2`, versi `1 → 2`, aktor kasir.
3. Item itu dihitung 2 lalu submit + approve + post. Post
   mengembalikan `result = version_conflict`, sesi kembali `counting`,
   `approved_at` dikosongkan, item menjadi `needs_recount`,
   `snapshot_version 1 → current_version 2`, `snapshot_qty 3 → current_qty 2`,
   dan **tidak ada** tulisan stok. Audit `opname.post_conflict` tercatat.
4. Recount menyimpan 2; RPC me-rebase snapshot ke stok live (2, versi 2) sehingga
   `difference_qty = 0`. Submit + approve + post kedua → `posted`.

### 11.3 Verifikasi §6

| # | Bukti | Hasil |
| --- | --- | --- |
| 6.1 | `/inventory`, filter `PER-M` | 18 produk latihan berstok; 17 baris `3`, satu baris `2` (`PER-M1128`). 35 baris berstok lain semuanya fixture `TEST-*` nonaktif, dan 1.356 produk lain berstok `NULL` — tidak ada yang berubah |
| 6.2 | `/inventory/movements` | 18 movement `opening_balance` (id 107–124, `NULL → 3`, aktor owner) + 1 `sale_out` (id 125, aktor kasir). Filter `opening_balance` kini 53 baris, filter `sale_out` memuat nota latihan |
| 6.3 | `/inventory/discrepancies` | tetap **13 baris** — latihan ini nol selisih, jadi tidak ada log baru |
| 6.4 | Movement vs item | 18 movement untuk 18 item yang berubah; tidak ada movement yatim atau ganda |
| 6.5 | `stock_version` | 17 item `+1` (0→1), `PER-M1128` `+2` (0→1 opening, 1→2 penjualan) |
| 6.6 | Audit | `opname.create/submit/approve/post` untuk L1; `create/submit/approve/post_conflict/submit/approve/post` untuk L2; seluruhnya aktor owner |
| 6.7 | Sesi `posted` | cancel ditolak `OPNAME_POSTED`, recount ditolak `OPNAME_NOT_COUNTING`, post ulang `already_posted`; UI tidak menawarkan tombol hitung, submit, atau batal |
| 6.8 | Regresi read-only | `npm run test:hosted:opname` → 11/11 PASS, sesi `OP-20261104-0018` berakhir `cancelled` |

### 11.4 Perbandingan baseline

| Metrik | Sebelum | Sesudah | Selisih |
| --- | --- | --- | --- |
| Produk total / aktif | 1.409 / 1.361 | 1.409 / 1.361 | 0 |
| Baris berstok | 35 | 53 | +18 |
| Jumlah `stock_on_hand` | 377 | 430 | +54 − 1 |
| Jumlah `stock_version` | 76 | 95 | +18 + 1 |
| `stock_movements` | 104 | 123 | +18 + 1 |
| `stock_opnames` | 58 | 60 | +2 |
| `stock_opname_items` | 2.802 | 2.838 | +36 |
| `stock_discrepancy_logs` | 13 | 13 | 0 |
| Fixture `TEST-*`/`HOST-*` aktif | 0 | 0 | 0 |

Seluruh selisih cocok dengan perhitungan tertulis sebelum drill. Tidak ada baris
produk yang ditambah atau dihapus.

### 11.5 Catatan UI

Verifikasi manual di browser (`npm run dev`, port 49298) menunjukkan kedua sesi
`TERPOSTING` di `/stock-opname`, detail L1 menampilkan `NULL` + alasan `Saldo
awal`, detail L2 menampilkan `2/2` untuk `PER-M1128`, dan tidak ada error konsol.

Satu cacat ditemukan dan diperbaiki: panel tindakan menampilkan "Semua item
lengkap dan siap disubmit" pada sesi yang sudah `posted`. Kalimat itu sekarang
dihitung hanya saat sesi masih dapat diedit (`OpnameActionPanel.vue`), dan
sesi `counting` tetap menampilkan petunjuk yang benar.
