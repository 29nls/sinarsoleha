# 22 — Runbook Phase 5F: Stok Opname Fisik Nyata

Status per 4 November 2026: **BELUM DIMULAI.** Runbook ini disiapkan agar
Phase 5F bisa dijalankan tanpa keputusan yang belum diambil saat hari-H.

Prasyarat yang masih terbuka: akun `INVENTORY_STAFF_B` belum ada. Dari lima
profil di preview, hanya satu yang berperan `inventory_staff`. Phase 5F tidak
boleh dimulai sebelum akun itu dibuat, login sekali, dan diverifikasi.

## 1. Definisi selesai

Phase 5F selesai bila seluruh butir berikut benar, bukan hanya bila satu sesi
berhasil diposting:

1. Dua `inventory_staff` aktif (`a3333333-…` dan staf B) masing-masing bisa
   membuka `/stok-opname`; keduanya **tidak** bisa membuka `/users`, menyetujui,
   memposting, atau membatalkan sesi.
2. Satu sesi opname nyata dibuat atas katalog sebenarnya, dihitung oleh dua
   orang pada rentang SKU yang tidak tumpang tindih, lalu `submit`.
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
- Satu sesi nyata saja. Sesi tambahan hanya bila owner memintanya.

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

1. Saat satu item masih `pending`, catat stok/versinya.
2. Dari browser kasir, buat transaksi yang mengubah stok item itu, lalu
   selesaikan pembayarannya.
3. Kembali ke sesi opname dan simpan hitungan untuk item tersebut.
4. Panel recount harus muncul dengan **tiga angka** berbeda: snapshot opname,
   stok sistem saat ini, dan hitungan baru.
5. Hitung ulang secara fisik, jangan menyalin angka snapshot. Simpan.
6. Item kembali `pending` sampai dihitung ulang; approval sebelumnya direset.

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
| Migrasi 23/23 | selesai — diverifikasi ulang 4 November 2026 |
| Fixture aktif | 0 — diverifikasi ulang |
| Baseline §4.5 | selesai — lihat tabel di atas |
| Regresi read-only | 11/11 lulus |
| Verifikasi staf B | **8/8 lulus** — `npm run test:hosted:opname:staff-b`, exit 0 |
| Staf B | **ada & aktif** — `phase5f.staffb@sinarsoleha.com`, `4ba5012e-7e53-4f85-892d-27524eb8071a` |
| Gate Phase 5F | belum diminta — **satu-satunya blocker tersisa** |
| Sesi opname nyata | belum dibuat |
| Posting | belum dilakukan |
| Produksi | tidak disentuh |
