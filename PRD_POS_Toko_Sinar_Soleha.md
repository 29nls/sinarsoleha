**PRODUCT REQUIREMENTS  
DOCUMENT**

**Aplikasi Point of Sale Berbasis Web**

**TOKO SINAR SOLEHA**

| **Atribut Dokumen** | **Nilai**                                                             |
| ------------------- | --------------------------------------------------------------------- |
| Versi               | 1.0                                                                   |
| Tanggal             | 2 November 2026                                                       |
| Status              | Draft teknis untuk validasi stakeholder                               |
| Basis analisis      | 2 workbook yang diunggah: master stok dan transaksi penjualan         |
| Target platform     | Nuxt / Vue.js + Supabase PostgreSQL, Auth, Realtime                   |
| Batasan eksplisit   | Full-online; tanpa Supabase Storage dan tanpa Supabase Edge Functions |

_Disusun sebagai baseline kebutuhan produk, desain sistem, dan panduan implementasi._

# Daftar Isi

1\. Ikhtisar Dokumen dan Keputusan Desain

2\. Ringkasan Eksekutif dan Tujuan Produk

3\. Analisis Dua Spreadsheet dan Implikasi Data

4\. Pengguna, Peran, dan Autentikasi

5\. Kebutuhan Fungsional dan Kriteria Penerimaan

6\. Alur Pengguna (User Flow)

7\. Arsitektur Sistem dan Frontend Nuxt

8\. Desain Database Supabase/PostgreSQL

9\. Keamanan, RLS, dan Supabase Realtime

10\. Arsitektur Fitur Opsional / Plugin

11\. Kebutuhan Nonfungsional

12\. Migrasi Data dan Cutover

13\. Roadmap Implementasi dan Release Gate

14\. Risiko, Asumsi, dan Keputusan yang Harus Divalidasi

15\. Referensi Teknis

Catatan: dokumen ini adalah PRD dan rancangan arsitektur. File SQL pendamping adalah starter schema untuk ditinjau dan dimasukkan sebagai migration; bukan migration produksi yang boleh dijalankan tanpa pengujian RLS, RPC, dan rekonsiliasi data.

# 1. Ikhtisar Dokumen dan Keputusan Desain

Dokumen ini menetapkan ruang lingkup, perilaku bisnis, aturan otorisasi, model data, arsitektur aplikasi, dan kriteria penerimaan untuk POS web Toko Sinar Soleha. Keputusan teknis dibuat berdasarkan struktur workbook yang benar-benar diperiksa dan batasan yang diberikan pemilik produk.

| **Area**         | **Keputusan baseline**                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tampilan kasir   | UI teks/tabel padat; tidak ada gambar/foto produk pada halaman mana pun dalam katalog dan transaksi.                                                    |
| Transaksi        | Penjualan selesai di toko (carry-out). Tidak ada pengiriman, kurir, atau surat jalan.                                                                   |
| Harga            | Satu harga jual default per produk. Diskon manual tercatat di transaksi. Harga grosir belum diaktifkan karena tidak ada kolom tier harga pada workbook. |
| Stok             | Saldo cepat di products.stock_on_hand dan ledger append-only stock_movements. Semua mutasi stok harus atomik.                                           |
| Opname           | Snapshot stok sistem, input fisik, selisih wajib memiliki alasan, dan posting terkontrol.                                                               |
| Backend          | Supabase PostgreSQL + SQL RPC untuk operasi atomik. Tidak memakai Edge Functions.                                                                       |
| Auth/RLS         | Supabase Auth untuk identitas; tabel profiles untuk role aplikasi; RLS pada seluruh tabel yang terpapar API.                                            |
| Realtime         | Supabase Realtime pada perubahan stok di tabel products; payload yang disiarkan dibatasi ke identitas produk dan jumlah stok.                           |
| Penyimpanan file | Tidak menggunakan Supabase Storage. Ekspor laporan dibuat dari browser sebagai CSV/print.                                                               |
| Koneksi          | Full-online. Tidak ada offline-first, service-worker sync, atau antrean transaksi offline.                                                              |

**Prinsip integritas** Transaksi penjualan, pembayaran, pengurangan stok, dan pencatatan stock movement harus berhasil bersama-sama atau gagal bersama-sama. Tidak boleh ada nota selesai dengan stok yang belum terpotong.

# 2. Ringkasan Eksekutif dan Tujuan Produk

## 2.1 Konteks

Toko Sinar Soleha adalah usaha ritel perabotan rumah tangga dengan katalog lebih dari seribu SKU, kategori yang beragam, satuan non-seragam, serta transaksi yang dapat memuat beberapa barang sekaligus. Proses saat ini menggunakan spreadsheet untuk master barang dan pencatatan penjualan. Pendekatan ini cukup untuk pencatatan dasar, tetapi memiliki risiko pada ketepatan stok, pemetaan barang di nota, kontrol diskon, dan konsistensi laporan.

## 2.2 Visi Produk

Membangun POS web yang memungkinkan kasir mencari barang berdasarkan kode atau nama, memasukkan beberapa item dengan keyboard, menyelesaikan pembayaran tanpa langkah yang tidak relevan, dan melihat stok yang selalu diperbarui. Staf inventaris dapat melakukan stok opname terkontrol dan menelusuri alasan setiap selisih.

## 2.3 Tujuan Produk

- Mempercepat transaksi dengan pencarian SKU/nama, navigasi keyboard, dan keranjang yang ringkas.
- Menghasilkan satu sumber kebenaran untuk katalog, harga jual, transaksi, pembayaran, dan saldo stok.
- Mencegah stok berubah tanpa rekam jejak alasan dan pengguna yang bertanggung jawab.
- Menyediakan laporan pendapatan penjualan dan laporan selisih stok yang dapat diaudit.
- Menjaga integrasi printer, scanner, dan payment gateway sebagai modul opsional, bukan ketergantungan alur kasir.

## 2.4 Indikator Keberhasilan (target awal untuk diuji)

| **Indikator**         | **Target penerimaan awal**                                                    | **Cara ukur**                                          |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------ |
| Pencarian barang      | P95 < 300 ms pada jaringan toko untuk 1.361+ SKU                              | Instrumentasi waktu query dari UI sampai hasil tampil. |
| Checkout              | P95 < 1,5 detik untuk transaksi normal, di luar waktu provider pembayaran     | Waktu RPC complete_sale sampai respons sukses.         |
| Konsistensi transaksi | 0 transaksi completed tanpa payment allocation dan stock movement yang sesuai | Rekonsiliasi database otomatis dan test concurrency.   |
| Realtime stok         | Update UI < 2 detik pada jaringan normal                                      | Uji dua browser yang login berbeda.                    |
| Audit selisih         | 100% opname dengan selisih memiliki reason_code                               | Constraint database dan laporan exception.             |
| Akurasi migrasi       | 100% baris yang diimpor memiliki status valid/needs_review/rejected           | Laporan hasil import dan sampling manual.              |

Target angka di atas adalah SLO awal yang harus divalidasi pada perangkat, hosting, paket Supabase, dan kualitas jaringan toko. Angka ini bukan klaim performa yang sudah terukur.

## 2.5 Dalam Ruang Lingkup (MVP)

- Login, manajemen role, katalog produk, kategori, satuan, pencarian barang.
- Keranjang, diskon transaksi, pembayaran tunai/QRIS manual/split, nomor nota dan riwayat transaksi.
- Pengurangan stok atomik saat transaksi selesai, stock movement, dan peringatan stok rendah/negatif.
- Sesi stok opname, input stok fisik, alasan selisih, approval, posting penyesuaian, dan histori.
- Laporan pendapatan penjualan dan laporan selisih/pergerakan stok.
- Pengaturan feature flag untuk printer thermal, barcode scanner, dan QRIS gateway.

## 2.6 Di Luar Ruang Lingkup MVP

- Pengiriman barang, surat jalan, kurir, dan pelacakan paket.
- Purchase order, penerimaan barang dari pemasok, retur pemasok, akuntansi penuh, pajak kompleks, dan payroll.
- Aplikasi mobile native, offline POS, sinkronisasi transaksi offline, dan PWA offline cache.
- CRM/loyalty yang kompleks; identitas pelanggan tetap opsional karena seluruh ID_Pelanggan pada data lama bernilai "-".
- Foto produk, galeri, video, thumbnail, atau unggahan media produk.

# 3. Analisis Dua Spreadsheet dan Implikasi Data

Analisis dilakukan terhadap sheet yang tersedia di kedua workbook. Baris kosong hasil formatting dan formula yang diperluas tidak dihitung sebagai record produk/transaksi.

## 3.1 Workbook Stok Opname / PART MASTER

| **Elemen**        | **Hasil inspeksi**                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workbook/sheet    | Copy of Stok Opname Toko Sinar Soleha - PART MASTER.xlsx; hanya 1 sheet: PART MASTER.                                                                                                                 |
| Baris data aktual | Header pada baris 2; 1.361 record produk pada baris 3–1.363. Baris lanjutan adalah area kosong/rumus. Tidak ada tanggal opname, petugas penghitung, qty fisik, selisih, alasan, atau status approval. |
| A — Kode Barang   | Teks; unik pada 1.361 produk. Format umum berupa prefix kategori/kelompok + nomor, misalnya ELE-K001.                                                                                                 |
| B — Nama Barang   | Teks; 1.361 terisi. Nama menjadi identifier pencarian, bukan primary key.                                                                                                                             |
| C — Kategori      | Teks; 204 label raw, menjadi 203 setelah trim spasi. Perlu kamus kategori dan normalisasi.                                                                                                            |
| D — Unit          | Teks; 10 representasi: Pcs, Lusin, Meter, Roll, Set, Pax, Pack, Karung, dan variasi kapital/spasi.                                                                                                    |
| E — Stock         | Numeric saat tersedia; 1.116 terisi, 245 kosong, 37 negatif, 1.079 positif. Tidak ada nilai nol pada data terisi.                                                                                     |
| F — Harga Jual    | Numeric IDR; 1.333 terisi, 28 kosong. Produk tanpa harga jual harus tidak dapat dijual sebelum diperbaiki.                                                                                            |
| G — Harga Beli    | Numeric IDR; 1.242 terisi, 119 kosong. Data biaya tidak lengkap; margin tidak dapat selalu dihitung.                                                                                                  |
| H — Margin        | Formula rasio (F-G)/F. Tidak boleh dijadikan input otoritatif karena biaya kosong dapat menghasilkan margin 100%.                                                                                     |

**Anomali sumber utama** Formula kolom E merujuk ke sheet "STOCK MASTER", tetapi workbook yang diterima hanya memiliki sheet "PART MASTER". Nilai stok yang terlihat adalah cached values; asal dan tanggal snapshot stok belum dapat diverifikasi dari file ini.

Contoh isu data: terdapat produk stok negatif seperti Sapu Lidi Gagang (-35) dan Kabel Eterna 2x0,75 NYYHY Ecer (-16). Ada 37 produk dengan stok negatif secara keseluruhan. Satu contoh anomali harga adalah Walpaper Dinding CSB-MGT-05-W dengan harga jual Rp9.500 dan harga beli Rp20.000. Nilai seperti ini harus ditandai, bukan otomatis dikoreksi.

Normalisasi yang direkomendasikan: trim spasi pada kategori/satuan, standarkan kode satuan menjadi canonical unit, simpan nama asli sebagai display name, dan simpan status review untuk saldo/harga yang belum tervalidasi. Jangan menganggap stok kosong sama dengan nol.

## 3.2 Workbook Transaksi Penjualan

| **Kolom**     | **Tipe / pola yang diamati**                                                         | **Pemetaan sistem**                                                     |
| ------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| ID_Transaksi  | String unik, pola TRX-YYYYMMDD-HHMMSS. 145 record; tidak ada duplikat.               | legacy_transaction_id; generate receipt_no baru pada transaksi live.    |
| Time_Stamp    | Tanggal teks dd-MMM-yyyy; tidak menyimpan jam secara eksplisit.                      | business_date (date); timestamp teknis dibuat saat transaksi tersimpan. |
| Detail_Barang | Satu string berisi item dipisahkan " + "; tiap bagian umumnya berakhir "(qty unit)". | transaction_items; perlu alias/SKU mapping yang tervalidasi.            |
| Subtotal      | Numeric IDR.                                                                         | transactions.subtotal.                                                  |
| Diskon        | Numeric IDR; nilai tidak nol pada 37 transaksi.                                      | transactions.discount_amount; otorisasi diskon berdasarkan role/limit.  |
| Total_Bayar   | Numeric IDR.                                                                         | transactions.grand_total.                                               |
| Metode_Bayar  | Tunai, QRISH, Split.                                                                 | payments; normalisasi QRISH menjadi QRIS.                               |
| Uang_Tunai    | Numeric IDR; kontribusi pembayaran tunai.                                            | payments.method=cash; simpan cash_received dan cash_change.             |
| QRISH         | Numeric IDR; kontribusi pembayaran QRIS.                                             | payments.method=qris; simpan amount_applied/provider_reference.         |
| Kembalian     | Numeric IDR; seluruh sampel bernilai 0.                                              | payments.cash_change atau nilai agregat transaksi.                      |
| Kasir         | Nama tampilan (2 nilai ditemukan).                                                   | cashier_id FK ke profiles; nama lama disimpan di staging/legacy note.   |
| ID_Pelanggan  | Seluruh 145 baris bernilai "-".                                                      | customer_id nullable; tidak wajib untuk checkout.                       |

## 3.3 Hasil Profiling Penjualan

| **Ukuran**                      | **Nilai terhitung**                 | **Catatan**                                                                                           |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Transaksi aktual                | 145                                 | 16–31 Oktober 2026; sheet memiliki banyak baris kosong di luar record ini.                            |
| Rincian barang                  | 238 segmen                          | Ditemukan pada kolom Detail_Barang; seluruh segmen sampel cocok dengan pola akhiran kuantitas/satuan. |
| Jumlah transaksi menurut metode | 93 Tunai / 50 QRISH / 2 Split       | Nilai QRISH dinormalisasi menjadi QRIS pada sistem baru.                                              |
| Total Subtotal                  | Rp10.721.000                        | Nilai agregat berdasarkan kolom sumber.                                                               |
| Total Diskon                    | Rp362.000                           | 37 transaksi memiliki diskon positif.                                                                 |
| Total Bayar                     | Rp10.356.000                        | Selisih Rp3.000 terhadap subtotal dikurangi diskon.                                                   |
| Pembayaran Tunai / QRIS         | Rp5.768.000 / Rp4.588.000           | Jumlah sesuai total pembayaran pada setiap transaksi sampel.                                          |
| Kasir                           | SHERIN-BRANCH MANAGER: 97; JOHN: 48 | Perlu pemetaan ke akun auth; jangan memakai teks kasir sebagai FK.                                    |
| Pelanggan                       | 145 placeholder "-"                 | Pelanggan tidak boleh diwajibkan.                                                                     |

**Exception rekonsiliasi** ID TRX-20261030-144151, Pel Berlian Jumbo MP-153 (1 Pcs): Subtotal Rp48.000, Diskon Rp0, tetapi Total_Bayar Rp45.000. Data historis perlu ditandai legacy_mismatch; jangan mengubah total sumber tanpa bukti.

Dua transaksi memiliki tanggal pada ID (23 Oktober 2026) berbeda dari kolom Time_Stamp (22 Oktober 2026): TRX-20261023-003000 dan TRX-20261023-014700. Hal ini konsisten dengan kemungkinan transaksi lewat tengah malam atau penggunaan business date yang berbeda. Karena itu, sistem memisahkan business_date dari created_at/completed_at dan tidak menurunkan tanggal bisnis hanya dari nomor nota.

## 3.4 Implikasi terhadap Desain

- SKU adalah kunci produk yang stabil; nama barang tidak cukup sebagai foreign key.
- Detail_Barang harus diurai ke staging line item, kemudian dipetakan ke products melalui SKU/alias yang disetujui. Baris yang ambigu masuk antrian review; jangan membuat SKU otomatis berdasarkan tebakan nama.
- Simpan data transaksi historis dengan nilai agregat persis seperti sumber. Exception diberi reconciliation_status dan tidak dibetulkan otomatis.
- Satuan harus distandarkan secara eksplisit. Konversi Lusin ke Pcs tidak boleh dilakukan tanpa aturan konversi yang disetujui per produk.
- Workbook stok belum membuktikan nilai stok fisik pada tanggal opname. Minta pemilik memvalidasi apakah kolom Stock merupakan saldo sistem, hasil opname, atau snapshot dari sumber lain.
- Harga grosir tidak terdeteksi sebagai kolom khusus. MVP memakai satu harga jual; mekanisme tier dapat tersedia sebagai fitur yang belum aktif.

# 4. Pengguna, Peran, dan Autentikasi

## 4.1 Role Aplikasi

| **Peran**                 | **Hak utama**                                                                                                                                         | **Batasan**                                                                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Owner / Admin             | Akses seluruh laporan, katalog, harga beli, pengaturan, manajemen role, approval selisih stok, void transaksi, override diskon/stok sesuai kebijakan. | Aksi sensitif wajib mencatat alasan dan audit trail. Tidak boleh menghapus ledger.                                            |
| Kasir                     | Login, cari produk, lihat harga/stok jual, buat transaksi, input diskon sesuai limit, catat tunai/QRIS/split, lihat transaksi miliknya.               | Tidak dapat melihat harga beli/margin, mengubah saldo stok, approve opname, atau mengubah role.                               |
| Staf Gudang / Stok Opname | Lihat katalog dan stok, membuat sesi opname, input hitungan fisik, memberi alasan selisih, melihat histori pergerakan stok.                           | Tidak dapat mengubah harga beli, menyelesaikan/void transaksi kasir, atau mem-post adjustment tanpa approval yang ditentukan. |

## 4.2 Supabase Auth

- Gunakan Supabase Auth email/password untuk akun staf. Akun tidak dibuat melalui public sign-up; pembuatan/invite akun dikendalikan owner melalui proses admin yang aman.
- Tabel public.profiles mengikat auth.users.id ke full_name, role, dan is_active.
- Session harus diperiksa saat route protected dibuka dan saat token berubah. Akun nonaktif ditolak pada helper role dan RLS.
- Role tidak boleh dipercaya dari state Pinia atau payload browser. Semua otorisasi final diperiksa ulang di PostgreSQL melalui auth.uid() dan profiles.
- MVP dapat mengelola akun/role melalui Supabase Dashboard atau server-only admin adapter. Jangan memasukkan service_role/secret key ke bundle Nuxt.

## 4.3 Matriks Akses Ringkas

| **Fitur**             | **Kasir**                    | **Staf inventaris**  | **Owner**              |
| --------------------- | ---------------------------- | -------------------- | ---------------------- |
| Katalog / cari produk | Lihat                        | Lihat                | Kelola                 |
| Harga beli / margin   | Tidak                        | Tidak (default)      | Lihat                  |
| Penjualan / checkout  | Buat dan lihat milik sendiri | Tidak                | Lihat semua / void     |
| Diskon manual         | Sesuai limit                 | Tidak                | Atur / override        |
| Stok opname           | Tidak                        | Buat, hitung, submit | Approve / post / lihat |
| Stock movement        | Tidak / ringkasan stok saja  | Lihat                | Lihat                  |
| Feature flags         | Tidak                        | Tidak                | Kelola                 |
| Role & akun           | Tidak                        | Tidak                | Kelola terkontrol      |

# 5. Kebutuhan Fungsional dan Kriteria Penerimaan

## 5.1 Modul Katalog Produk

| **ID / Prioritas** | **Kebutuhan**                                             | **Kriteria penerimaan**                                                                                             |
| ------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| CAT-01 / Must      | Daftar produk berbasis teks/tabel tanpa foto.             | Tidak ada elemen image/photo produk pada halaman katalog, POS, detail produk, atau pencarian.                       |
| CAT-02 / Must      | Pencarian berdasarkan SKU exact/prefix dan nama contains. | Kasir dapat mencari "ELE-K001" atau potongan nama; hasil menampilkan SKU, nama, kategori, satuan, harga jual, stok. |
| CAT-03 / Must      | Kategori dan unit terstandardisasi.                       | Produk harus memiliki unit valid; kategori yang belum dikenal masuk review sebelum import.                          |
| CAT-04 / Must      | SKU unik dan immutable pada transaksi historis.           | Database menolak SKU duplikat; perubahan SKU tidak mengubah snapshot SKU pada nota lama.                            |
| CAT-05 / Must      | Harga jual harus valid untuk dijual.                      | Produk sale_price null/nonaktif tidak dapat ditambahkan ke transaksi final.                                         |
| CAT-06 / Should    | Ambang stok rendah per produk.                            | Threshold dapat diatur owner; nilai kosong berarti belum dikonfigurasi, bukan otomatis nol.                         |

## 5.2 Modul Kasir / Transaksi

| **ID / Prioritas** | **Kebutuhan**                                                                | **Kriteria penerimaan**                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POS-01 / Must      | Buat nota carry-out tanpa alur pengiriman.                                   | Checkout hanya mencatat penjualan dan pembayaran; tidak ada field alamat, kurir, surat jalan, atau status kirim.           |
| POS-02 / Must      | Tambah item melalui pencarian SKU/nama atau input barcode bila plugin aktif. | Item ditambah ke cart; kuantitas dapat diedit; total baris dan subtotal dihitung konsisten.                                |
| POS-03 / Must      | Tampilkan stok terkini di daftar dan keranjang.                              | Jika ada perubahan stok Realtime, UI menampilkan angka baru dan memberi peringatan bila qty keranjang melebihi stok.       |
| POS-04 / Must      | Diskon manual pada level transaksi.                                          | Diskon tersimpan sebagai amount; batas maksimal dan role approval dikonfigurasi owner; diskon tidak mengubah harga master. |
| POS-05 / Must      | Satu harga jual default.                                                     | Harga pada item disalin sebagai unit_price snapshot. Harga produk yang berubah nanti tidak mengubah nota lama.             |
| POS-06 / Could     | Harga ecer/grosir bertingkat.                                                | Belum aktif pada MVP. Aktif hanya setelah owner mengisi tier, qty minimum, dan aturan pemilihan harga.                     |
| POS-07 / Must      | Metode bayar tunai, QRIS manual, atau Split.                                 | Jumlah payment allocation harus sama dengan grand_total; cash_received dan cash_change direkam untuk komponen tunai.       |
| POS-08 / Must      | Nomor nota dan idempotensi checkout.                                         | Retry jaringan dengan idempotency_key yang sama tidak boleh membuat nota atau stock movement ganda.                        |
| POS-09 / Must      | Kurangi stok saat checkout berhasil.                                         | Header, detail, pembayaran, stock update, dan ledger tersimpan dalam satu transaksi database.                              |
| POS-10 / Must      | Cegah stok negatif pada penjualan baru.                                      | RPC menolak checkout jika qty melebihi available stock; override hanya role yang diizinkan dengan alasan tercatat.         |
| POS-11 / Must      | Riwayat nota dan void terkontrol.                                            | Nota completed tidak dihapus; void mencatat actor, waktu, alasan, dan stock reversal secara atomik.                        |
| POS-12 / Should    | Cetak / preview struk ringkas.                                               | Jika printer tidak aktif, kasir tetap dapat menyelesaikan transaksi dan melihat tampilan receipt/print browser.            |

Perhitungan standar transaksi live: subtotal = jumlah(quantity × unit_price) setelah diskon per baris (jika disediakan); grand_total = subtotal − discount_amount transaksi. Payment allocation harus tepat sama dengan grand_total. Perhitungan ini diberlakukan pada transaksi baru; data historis dengan mismatch disimpan dengan status review.

## 5.3 Modul Inventaris dan Stok Opname

| **ID / Prioritas** | **Kebutuhan**                                  | **Kriteria penerimaan**                                                                                                                                                      |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INV-01 / Must      | Lihat saldo stok dan histori mutasi.           | Setiap produk memiliki saldo, stock_version, dan histori movement dengan qty before/after.                                                                                   |
| INV-02 / Must      | Buat sesi opname dengan snapshot saldo sistem. | Saat item masuk sesi, sistem menyimpan system_qty_snapshot dan stock_version_snapshot.                                                                                       |
| INV-03 / Must      | Input stok fisik per SKU.                      | Qty fisik divalidasi menurut presisi unit; bila saldo sistem unknown, hitungan pertama menjadi opening balance, bukan selisih terhadap nol.                                  |
| INV-04 / Must      | Hitung selisih otomatis.                       | Jika snapshot diketahui: difference_qty = physical_qty − system_qty_snapshot. Jika snapshot NULL, tandai initial count/opening balance.                                      |
| INV-05 / Must      | Alasan wajib untuk selisih.                    | Jika selisih ≠ 0, reason_code wajib. Jika snapshot NULL, reason_code=opening_balance dan reason_note wajib. Kode "other" juga mewajibkan note.                               |
| INV-06 / Must      | Approval dan posting adjustment.               | Sesi tidak dapat diposting sebelum semua hitungan lengkap dan seluruh selisih memiliki alasan; approval owner sesuai kebijakan.                                              |
| INV-07 / Must      | Deteksi perubahan stok selama opname.          | Jika stock_version berubah sejak snapshot, posting ditolak untuk item tersebut; staf harus refresh/recount agar hasil tidak menimpa penjualan yang terjadi setelah snapshot. |
| INV-08 / Must      | Catat stock discrepancy dan movement.          | Posting menghasilkan stock_discrepancy_logs dan stock_movements serta memperbarui products dalam satu transaksi.                                                             |
| INV-09 / Must      | Laporan selisih stok.                          | Filter tanggal, sesi, SKU, kategori, reason, staf, status; tampilkan sistem, fisik, delta, alasan, dan approval.                                                             |
| INV-10 / Should    | Import saldo awal / koreksi hasil migrasi.     | Saldo awal masuk sebagai movement opening_balance dengan referensi file dan status validasi.                                                                                 |

## 5.4 Alasan Selisih yang Disediakan

| **Kode**        | **Label**                    | **Aturan pencatatan**                                                         |
| --------------- | ---------------------------- | ----------------------------------------------------------------------------- |
| broken_damaged  | Barang rusak / pecah         | Catat kuantitas dan catatan/keterangan barang bila perlu.                     |
| missing         | Barang hilang                | Catatan lokasi/temuan wajib direkomendasikan.                                 |
| input_error     | Salah input sebelumnya       | Catat nomor transaksi atau riwayat yang diduga salah.                         |
| unrecorded_out  | Barang keluar belum tercatat | Wajib catatan; ditinjau owner.                                                |
| unrecorded_in   | Barang masuk belum tercatat  | Wajib catatan sumber penerimaan.                                              |
| unit_conversion | Kesalahan satuan/konversi    | Wajib catatan konversi; tidak boleh mengubah faktor konversi tanpa otorisasi. |
| opening_balance | Saldo awal dari hitung fisik | Dipakai hanya jika saldo sistem sebelumnya unknown; reason note wajib.        |
| other           | Lainnya                      | Reason note wajib diisi.                                                      |

## 5.5 Modul Laporan

| **ID** | **Laporan**             | **Isi minimum**                                                                                              |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| RPT-01 | Pendapatan penjualan    | Tanggal bisnis, nomor nota, kasir, subtotal, diskon, grand total, payment methods, status.                   |
| RPT-02 | Ringkasan harian        | Jumlah transaksi, penjualan bersih, diskon, komposisi tunai/QRIS, rata-rata nilai transaksi.                 |
| RPT-03 | Penjualan per produk    | SKU, nama snapshot, kuantitas terjual, nilai penjualan; hanya akurat setelah legacy line mapping divalidasi. |
| RPT-04 | Selisih stok            | Saldo sistem, fisik, selisih, reason, user penghitung, approver, waktu, dan referensi opname.                |
| RPT-05 | Histori pergerakan stok | Jenis movement, qty delta, qty before/after, referensi transaksi/opname, actor, waktu.                       |
| RPT-06 | Exception data          | SKU stok unknown/negatif, harga kosong, cost kosong, mapping histori belum tervalidasi.                      |

Laporan margin/laba kotor hanya boleh dihitung untuk produk dengan purchase_cost valid pada tanggal transaksi. Karena workbook memiliki 119 harga beli kosong dan tidak menyediakan histori biaya per tanggal, margin historis tidak boleh dipresentasikan sebagai angka akurat sebelum biaya direkonstruksi.

# 6. Alur Pengguna (User Flow)

## 6.1 Alur Transaksi Kasir

1\. Kasir login dengan Supabase Auth; aplikasi memuat profile, role, dan feature flags.

2\. Halaman POS fokus pada input: cursor otomatis di kolom pencarian SKU/nama; tabel hasil menampilkan kode, nama, kategori, satuan, stok, dan harga.

3\. Kasir memilih hasil atau memindai barcode (jika plugin aktif). Item masuk cart; quantity dan harga snapshot ditampilkan.

4\. Kasir menambahkan barang lain, menyesuaikan qty, dan menerapkan diskon sesuai izin. UI menghitung subtotal dan grand total.

5\. Kasir memilih Tunai, QRIS manual, atau Split. Untuk tunai, masukkan uang diterima; sistem hitung kembalian. Untuk split, alokasi seluruh metode harus pas dengan total.

6\. UI mengirim checkout melalui RPC dengan idempotency_key. Database mengunci baris produk yang diperlukan, memvalidasi stok/harga/otorisasi, lalu menyimpan transaksi, item, payment, movement, dan saldo.

7\. Jika berhasil, nota berstatus completed, cart dikosongkan, receipt ditampilkan, opsi cetak muncul bila plugin aktif.

8\. Realtime memberi tahu kasir lain tentang saldo baru. Jika checkout gagal karena stok tidak cukup atau jaringan terputus, transaksi tidak dibuat dan cart tetap tersedia di UI selama halaman aktif.

## 6.2 Alur Stok Opname

1\. Staf inventaris membuat sesi opname dengan scope (kategori, rentang rak, atau SKU tertentu).

2\. Sistem menyimpan snapshot qty dan stock_version tiap SKU yang dihitung.

3\. Staf menghitung barang fisik dan menginput quantity ke form tabel; sistem menghitung selisih otomatis.

4\. Jika selisih nol, item dapat diselesaikan tanpa reason. Jika selisih bukan nol, staf wajib memilih reason_code; untuk "other", reason_note wajib.

5\. Staf submit sesi. Owner meninjau daftar selisih, alasan, dampak, dan item exception.

6\. Saat posting, RPC memeriksa stock_version. Jika versi berubah setelah snapshot, item ditahan untuk recount; jika cocok, saldo diperbarui dan movement + discrepancy log dibuat atomik.

7\. Sesi menjadi posted dan immutable. Laporan selisih dapat dibuka atau diekspor untuk audit.

# 7. Arsitektur Sistem dan Frontend Nuxt

## 7.1 Komponen Logis

| **Lapisan**             | **Komponen**                                 | **Tanggung jawab**                                                                                |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Presentation            | Nuxt 3 / Vue 3                               | Halaman Login, POS, Produk, Opname, Laporan, Pengaturan; UI text/table only.                      |
| State                   | Pinia                                        | Auth/profile, cart, product cache, stock events, settings/plugin status.                          |
| Client SDK              | @supabase/supabase-js                        | Auth session, Data API queries, RPC, Realtime channel.                                            |
| Database                | Supabase PostgreSQL                          | Relasi, constraint, transaction, RLS, SQL RPC, stock ledger.                                      |
| Realtime                | Supabase Realtime                            | Notifikasi perubahan saldo dari products; UI sinkron lintas browser.                              |
| Optional server adapter | Nuxt/Nitro Node server atau provider backend | Hanya diperlukan untuk secret payment gateway/webhook; tidak menggunakan Supabase Edge Functions. |

## 7.2 Rekomendasi Struktur Frontend

- pages/auth/login.vue — login dan pemulihan akses.
- pages/pos/index.vue — layar kasir satu layar, panel pencarian, tabel hasil, cart, pembayaran.
- pages/products/index.vue — katalog dan pengelolaan produk.
- pages/inventory/opname/index.vue — daftar sesi, form hitung, approval, dan detail selisih.
- pages/reports/sales.vue serta pages/reports/stock.vue — laporan.
- pages/settings/index.vue — role/setting aplikasi dan feature flags sesuai hak owner.
- composables/useSupabase.ts, useStockRealtime.ts, usePermissions.ts.
- stores/auth.ts, posCart.ts, products.ts, inventory.ts, settings.ts.
- services/checkout.ts, productSearch.ts, stockOpname.ts, reportQueries.ts.

## 7.3 State Management (Pinia)

| **Store**      | **State utama**                                         | **Aturan**                                                                        |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| authStore      | session, user, profile, role, isActive                  | Clear state saat sign-out/expiry; route guard bukan pengganti RLS.                |
| productStore   | productById, sku index, filteredResults, lastSyncAt     | Cache sementara untuk UI; server adalah source of truth.                          |
| posCartStore   | cartLines, discountAmount, paymentDraft, idempotencyKey | Cart tidak dianggap transaksi committed; jangan kirim stok mutation dari browser. |
| inventoryStore | activeOpname, countedLines, discrepancyFilters          | Draft hitungan UI; final snapshot, diff, dan approval dihitung ulang di DB.       |
| settingsStore  | enabledFeatures, non-secret public_config               | Feature flag mengaktifkan adapter UI; bukan mekanisme security.                   |

## 7.4 Desain UI Kasir

- Layout utama: input pencarian paling dominan, tabel hasil di area kiri, cart dan ringkasan pembayaran di area kanan/bawah.
- Kolom tabel: SKU, Nama Barang, Kategori, Satuan, Stok, Harga Jual. Tidak ada kolom foto.
- Gunakan font/tabular numerals untuk jumlah dan rupiah; warna hanya untuk status stok rendah/negatif dan validasi.
- Search SKU exact/prefix mendapat prioritas; pencarian nama menggunakan debounce 120–200 ms dan indeks database.
- Jangan memuat semua SKU dan seluruh histori sekaligus; gunakan pagination/limit dan query berbasis indeks.

## 7.5 Keyboard Shortcuts

| **Shortcut usulan** | **Aksi**                          | **Catatan implementasi**                           |
| ------------------- | --------------------------------- | -------------------------------------------------- |
| F2                  | Fokus ke pencarian barang         | Fokus otomatis saat halaman POS dibuka.            |
| Enter               | Tambah hasil terpilih ke cart     | Hanya ketika fokus berada pada area hasil.         |
| F4                  | Fokus/edit quantity baris aktif   | Validasi quantity sesuai satuan.                   |
| F6                  | Fokus diskon transaksi            | Hak kasir mengikuti limit role.                    |
| F8                  | Buka panel pembayaran             | Tidak langsung menyelesaikan transaksi.            |
| Ctrl + Enter        | Konfirmasi checkout               | Tampilkan konfirmasi total dan metode sebelum RPC. |
| Esc                 | Tutup dialog / kembali dari input | Tidak boleh menghapus cart secara diam-diam.       |

Shortcut harus dapat dikonfigurasi dan tidak memotong input teks normal. Barcode scanner tipe keyboard wedge dapat mengirim SKU ke input aktif; aplikasi mendeteksi akhiran Enter dan mencari SKU exact.

## 7.6 Strategi Koneksi

Aplikasi full-online. Saat koneksi putus, indikator status harus berubah, tombol checkout dinonaktifkan, dan tidak ada klaim bahwa transaksi tersimpan. Cart draft dapat tetap berada di memori halaman selama tab belum ditutup, tetapi tidak ada offline queue, PWA cache, ataupun proses sinkronisasi transaksi setelah reconnect. Ketika koneksi kembali, query stok dan channel Realtime harus diinisialisasi ulang.

# 8. Desain Database Supabase/PostgreSQL

Desain berikut memisahkan katalog, transaksi, pembayaran, stok, opname, dan pengaturan. File supabase_schema_pos_toko_sinar_soleha.sql memuat starter DDL, indeks, enable RLS, dan contoh policy awal.

## 8.1 Tabel Inti dan Relasi

| **Tabel**              | **Primary Key**            | **Foreign Key / relasi**                                      | **Fungsi**                                                |
| ---------------------- | -------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| profiles               | id uuid                    | auth.users(id)                                                | Profil dan role aplikasi.                                 |
| categories             | id bigint identity         | —                                                             | Master kategori yang dinormalisasi.                       |
| units_of_measure       | id smallint identity       | —                                                             | Master satuan dan presisi kuantitas.                      |
| products               | id uuid; sku unique        | categories.id; units.id                                       | Katalog dan saldo stok cepat; stok punya stock_version.   |
| product_costs          | product_id                 | products.id                                                   | Harga beli yang dibatasi ke owner.                        |
| product_aliases        | id bigint identity         | products.id                                                   | Alias nama untuk pemetaan data historis/barcode.          |
| product_price_tiers    | id bigint identity         | products.id                                                   | Opsional harga retail/wholesale berdasarkan min quantity. |
| customers              | id uuid                    | —                                                             | Identitas pelanggan opsional.                             |
| transactions           | id uuid; receipt_no unique | profiles.id; customers.id                                     | Header nota, business_date, diskon, total, status.        |
| transaction_items      | id uuid                    | transactions.id; products.id nullable                         | Baris barang dan snapshot nama/SKU/harga/satuan.          |
| payments               | id uuid                    | transactions.id                                               | Satu atau lebih alokasi pembayaran per transaksi.         |
| stock_opnames          | id uuid; opname_no unique  | profiles.id (creator/approver/poster)                         | Sesi opname dan status lifecycle.                         |
| stock_opname_items     | id uuid                    | stock_opnames.id; products.id; profiles.id                    | Snapshot, versi, qty fisik, selisih, alasan.              |
| stock_movements        | id bigint identity         | products.id; transactions.id?; stock_opnames.id?; profiles.id | Ledger mutasi stok immutable.                             |
| stock_discrepancy_logs | id bigint identity         | stock_opname_items.id; products.id; profiles.id               | Audit khusus selisih stok.                                |
| feature_flags          | feature_key text           | profiles.id (updated_by)                                      | Toggle perangkat keras dan payment adapter.               |
| audit_logs             | id bigint identity         | profiles.id                                                   | Jejak aksi sensitif.                                      |

## 8.2 Tipe Data dan Aturan Domain

- ID relasional: UUID untuk entitas bisnis; identity bigint untuk ledger/log yang tumbuh cepat. auth.users.id menjadi sumber identitas.
- Uang: numeric(14,2), bukan floating point. Simpan nilai dalam Rupiah tanpa pembulatan binary.
- Qty: numeric(14,3) untuk mendukung Meter/fractional unit. UI dan validasi decimal_scale harus mengikuti unit produk. stock_on_hand boleh NULL saat saldo belum diketahui; NULL tidak sama dengan nol dan memblokir checkout.
- Tanggal: business_date date terpisah dari created_at/completed_at timestamptz. Simpan zona waktu operasional Asia/Jakarta pada aplikasi.
- Snapshot item: sku_snapshot, product_name_snapshot, unit_label_snapshot, unit_price menjaga nota historis tetap terbaca walau master berubah.
- Cost: tabel terpisah agar kasir tidak menerima harga beli pada payload/query produk.
- Stock version: naik setiap mutasi; digunakan untuk mencegah opname menimpa pergerakan yang terjadi setelah snapshot.

## 8.3 Alur Integritas Transaksi (RPC)

1\. Nuxt memanggil RPC complete_sale dengan daftar item, diskon, pembayaran, business_date, dan idempotency_key.

2\. RPC memastikan auth.uid() aktif, role cashier/owner, SKU aktif, harga valid, diskon dalam limit, dan payment allocations = grand_total.

3\. RPC mengunci baris produk yang terlibat (SELECT ... FOR UPDATE) dalam urutan ID yang konsisten untuk mengurangi deadlock.

4\. RPC memeriksa stok, membuat transaction header + items + payments, mengurangi products.stock_on_hand, menaikkan stock_version, dan insert stock_movements.

5\. Seluruh langkah berada pada satu database transaction. Kesalahan satu langkah me-rollback semuanya.

6\. RPC mengembalikan receipt_no dan transaction_id; browser tidak melakukan update saldo secara langsung.

## 8.4 Aturan Opname Atomik

Pada awal hitung, setiap stock_opname_item menyimpan system_qty_snapshot (boleh NULL jika stok belum diketahui) dan stock_version_snapshot. Untuk snapshot yang diketahui, sistem menghitung physical_qty − system_qty_snapshot dan reason wajib bila hasilnya bukan nol. Untuk snapshot NULL, sistem memperlakukan hitungan sebagai opening balance, meminta reason_code=opening_balance serta note, dan tidak membuat selisih semu terhadap angka nol. Ketika sesi diposting, RPC mengambil lock pada produk dan membandingkan stock_version saat ini dengan versi snapshot. Bila versi berbeda, item tidak dapat diposting sampai dilakukan refresh/recount. Bila sama, sistem menetapkan stock_on_hand ke physical_qty, menaikkan stock_version, membuat stock_movements dan (untuk discrepancy nonzero) stock_discrepancy_logs, kemudian mengubah status sesi menjadi posted. Untuk opening balance, quantity_before pada movement bernilai NULL untuk menandai saldo sebelumnya tidak diketahui.

## 8.5 Normalisasi Harga Grosir

Workbook hanya menyediakan Harga Jual dan Harga Beli. MVP menggunakan products.sale_price sebagai harga default serta product_price_tiers sebagai struktur opsional. Jika harga grosir dikonfirmasi, owner mengisi tier_key=wholesale, min_quantity, dan unit_price untuk SKU terkait; kalkulasi pemilihan tier harus dilakukan ulang di database saat checkout. Kata "ecer" pada nama produk diperlakukan sebagai bagian nama, bukan otomatis sebagai tier harga.

# 9. Keamanan, RLS, dan Supabase Realtime

## 9.1 RLS Baseline

| **Kelompok tabel**                | **Kasir**                                     | **Staf inventaris**             | **Owner**                                      |
| --------------------------------- | --------------------------------------------- | ------------------------------- | ---------------------------------------------- |
| products / categories / units     | SELECT katalog aktif                          | SELECT katalog aktif            | SELECT + kelola master via RPC/aksi terkontrol |
| product_costs                     | Tidak ada akses                               | Tidak ada akses default         | SELECT/UPDATE                                  |
| transactions / items / payments   | SELECT transaksi milik sendiri; write via RPC | Tidak ada akses transaksi       | SELECT semua; void via RPC                     |
| stock_opnames / items / movements | Tidak ada akses detail opname                 | SELECT/operasi hitung via RPC   | SELECT, approve, post via RPC                  |
| stock_discrepancy_logs            | Tidak ada akses default                       | SELECT                          | SELECT                                         |
| feature_flags                     | SELECT nilai toggle non-rahasia               | SELECT nilai toggle non-rahasia | UPDATE                                         |
| audit_logs / profiles             | Profil sendiri                                | Profil sendiri                  | SELECT/kelola sesuai kebijakan                 |

Semua tabel di schema public yang diakses melalui Data API harus mengaktifkan RLS dan hanya memberi grant yang diperlukan. Policy harus menggunakan TO authenticated, auth.uid(), role check dari profiles, indeks untuk kolom policy filter, dan pengujian allow/deny untuk setiap role. Hindari policy yang saling membaca tabel satu sama lain hingga menyebabkan recursion. SECURITY DEFINER harus ditempatkan di schema private yang tidak diekspos dan memakai search_path kosong serta nama schema fully-qualified. \[1\]

## 9.2 Supabase Realtime pada products

Produk yang sama dapat dicari oleh beberapa kasir secara bersamaan. Setiap checkout atau posting opname memperbarui products.stock_on_hand dan stock_version. Perubahan itu harus mengirim event melalui Supabase Realtime sehingga layar kasir lain memperbarui kolom stok tanpa reload.

- MVP satu toko dapat memakai channel Realtime yang terautentikasi. Untuk pola yang lebih aman dan skalabel, pasang trigger setelah update products yang hanya mem-broadcast product_id, sku, stock_on_hand, dan stock_version.
- Channel topic disarankan: store:stock. Pesan tidak perlu memuat purchase_cost, margin, atau data transaksi pelanggan.
- Pinia productStore menerima event lalu memperbarui saldo SKU terkait; bila item sedang berada di cart, bandingkan qty cart dengan stok terbaru dan tampilkan peringatan.
- Checkout tetap memvalidasi stok di PostgreSQL. Realtime hanya sinkronisasi tampilan, bukan lock dan bukan otorisasi.
- Saat koneksi reconnect, lakukan refetch stok untuk produk yang terlihat dan resubscribe. Jangan mengandalkan pesan realtime yang mungkin terlewat saat offline.

**Pilihan implementasi** Supabase mendokumentasikan Postgres Changes sebagai opsi yang lebih sederhana, sedangkan Broadcast direkomendasikan untuk skalabilitas dan keamanan. Karena kebutuhan POS ini hanya mengirim sinyal saldo terbatas, gunakan Broadcast dari perubahan tabel products untuk implementasi production; Postgres Changes dapat dipakai sebagai prototipe awal.

Jika memilih Postgres Changes langsung pada products, pastikan SELECT RLS hanya membuka kolom yang memang boleh dibaca oleh kasir. Pemisahan product_costs dari products tetap menjadi kontrol utama agar harga beli tidak bocor.

## 9.3 Secrets dan Keamanan Client

- Browser hanya menggunakan Supabase publishable/anon key yang memang dirancang untuk client bersama session user. Tidak ada service_role atau secret key di Nuxt public runtime config.
- RPC memvalidasi role, payload, harga, stok, diskon, payment split, serta idempotency key di database.
- Log tidak menyimpan password, access token, atau credential gateway.
- Gunakan TLS/HTTPS, proteksi brute-force sesuai kemampuan Auth, session expiry, dan proses offboarding akun nonaktif.
- Lakukan pgTAP atau test integrasi untuk skenario role yang diizinkan dan ditolak sebelum go-live.

# 10. Arsitektur Fitur Opsional / Plugin

Setiap integrasi memiliki adapter dengan kontrak yang sama sehingga POS inti tetap bekerja saat adapter tidak terpasang atau dinonaktifkan. Feature flag hanya mengontrol tampilan dan adapter; tidak mengubah perhitungan transaksi utama.

| **Plugin**           | **Default** | **Implementasi**                                                                                                                                           | **Fallback saat off/gagal**                                               |
| -------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Thermal Printer      | OFF         | Adapter print: browser print/receipt template; pilihan ESC/POS melalui bridge lokal seperti QZ Tray atau adapter hardware yang didukung browser/perangkat. | Checkout tetap sukses; receipt dapat ditampilkan dan dicetak via browser. |
| Barcode Scanner      | OFF         | Scanner keyboard-wedge mengirim string SKU ke search input; adapter khusus hanya bila perangkat memerlukan API.                                            | Kasir tetap ketik/paste SKU atau nama barang.                             |
| QRIS Payment Gateway | OFF         | Payment adapter terpisah; server-only Node/Nitro route atau backend provider untuk membuat charge, memegang secret, dan menerima webhook.                  | QRIS manual tetap tersedia; tunai tetap tersedia.                         |

## 10.1 Kontrak Plugin dan Pengaturan

- feature_flags.feature_key: hardware.thermal_printer, hardware.barcode_scanner, payment.qris_gateway.
- feature_flags.enabled: boolean; public_config hanya memuat konfigurasi non-rahasia seperti nama printer, ukuran kertas, atau label adapter.
- Credential gateway, API secret, signing key, dan webhook secret tidak boleh disimpan di tabel yang dibaca browser. Gunakan environment secret pada backend server-only.
- Setiap adapter menyediakan status enabled/available, initialize(), healthCheck(), dan method yang spesifik (printReceipt/scan/charge/status).
- Jika adapter gagal, UI menampilkan error non-blocking dan mempertahankan jalur manual.

## 10.2 Batasan QRIS Tanpa Edge Functions

**Batasan arsitektur** Integrasi gateway QRIS dinamis umumnya membutuhkan secret API dan verifikasi webhook yang harus berjalan di server tepercaya. Karena Supabase Edge Functions dilarang, jangan memanggil API gateway langsung dari browser. Gunakan Nuxt/Nitro Node server endpoint atau backend eksternal; jika aplikasi hanya di-host sebagai static site tanpa server runtime, nonaktifkan gateway dinamis dan gunakan QRIS manual.

MVP sebaiknya mendukung QRIS manual sebagai metode pembayaran yang dicatat kasir setelah verifikasi di aplikasi merchant/bank. Integrasi gateway baru diaktifkan setelah provider, webhook, callback, status final, pembatalan, dan rekonsiliasi settlement disepakati.

# 11. Kebutuhan Nonfungsional

| **ID** | **Aspek**       | **Ketentuan**                                                                                                                |
| ------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| NFR-01 | Performa        | Pencarian katalog P95 < 300 ms pada beban awal dan jaringan toko; query menggunakan indeks SKU dan trigram nama.             |
| NFR-02 | Konsistensi     | Checkout dan opname posting atomik; stock ledger append-only; idempotency untuk retry.                                       |
| NFR-03 | Keamanan        | RLS pada semua tabel API; role server-side; cost table owner-only; tidak ada secret key di browser.                          |
| NFR-04 | Realtime        | Perubahan stok terlihat lintas kasir dalam target < 2 detik pada jaringan normal; checkout tetap validasi database.          |
| NFR-05 | Ketersediaan    | Aplikasi mensyaratkan internet aktif. Saat backend/network gagal, sistem memblokir commit dan menampilkan status yang jelas. |
| NFR-06 | Audit           | Aksi sensitif memiliki actor, timestamp, entity, reason, dan before/after bila relevan.                                      |
| NFR-07 | Usability       | Navigasi keyboard; tabel padat; pesan validasi jelas; tanpa foto produk.                                                     |
| NFR-08 | Maintainability | SQL migrations versioned; feature adapters terpisah; environment dev/staging/prod.                                           |
| NFR-09 | Backup          | Aktifkan backup sesuai paket Supabase dan lakukan uji restore berkala; ekspor laporan bukan pengganti backup database.       |
| NFR-10 | Observability   | Catat kegagalan RPC, latency query, disconnect Realtime, stok negatif, dan exception rekonsiliasi.                           |

# 12. Migrasi Data dan Cutover

## 12.1 Tahap Staging dan Validasi

1\. Import master kategori dan unit ke staging, normalisasi spasi/kapital, lalu review kategori yang hampir sama.

2\. Import 1.361 produk dengan SKU existing sebagai external key. Tolak duplicate SKU; pada file yang dianalisis tidak ditemukan duplikasi SKU.

3\. Untuk 245 produk dengan stok kosong, simpan stock_on_hand sebagai NULL dan tandai stock_unknown; produk tidak dapat dijual sampai saldo diverifikasi. Hitungan fisik pertama dicatat sebagai opening_balance, bukan variance terhadap nol.

4\. Untuk 37 stok negatif, simpan nilai sumber dan flag negative_opening_stock. Owner menentukan apakah angka itu dipertahankan, diopname ulang, atau dikoreksi melalui opening adjustment dengan alasan.

5\. 28 harga jual kosong menandai produk tidak dapat dijual. 119 harga beli kosong ditandai cost_unknown dan tidak dipakai menghitung margin.

6\. Import 145 header transaksi ke legacy_transactions staging. Urai 238 detail item; mapping nama ke SKU harus memiliki tingkat confidence dan approval manual.

7\. Pertahankan seluruh subtotal/diskon/total/payment source. Baris mismatch Rp3.000 diberi legacy_mismatch dan masuk laporan exception.

8\. Map 2 nama kasir lama ke profile yang benar jika akun tersedia; jika tidak, simpan legacy_cashier_name di data migrasi/audit.

9\. Pisahkan business_date dan timestamp nominal. Dua transaksi dengan konflik tanggal harus menggunakan tanggal bisnis yang dikonfirmasi pemilik.

## 12.2 Aturan Import yang Tidak Boleh Dilakukan

- Jangan menjadikan nama barang sebagai primary key atau langsung menggabungkan item transaksi tanpa verifikasi SKU.
- Jangan menyamakan stok kosong dengan nol.
- Jangan menghapus nilai stok negatif tanpa opname atau persetujuan owner.
- Jangan menghitung ulang dan menimpa Total_Bayar historis yang berbeda dari sumber.
- Jangan menyimpulkan harga grosir dari substring "ecer" pada nama produk.
- Jangan menghitung laba historis menggunakan biaya hari ini seolah-olah itu biaya saat transaksi terjadi.

## 12.3 Cutover Produksi

1\. Bekukan pengeditan spreadsheet saat final snapshot diambil; catat waktu cutover dan pemilik data.

2\. Jalankan import dry-run, hasilkan exception report, dan minta owner menyetujui mapping serta saldo awal.

3\. Lakukan uji kasir, split payment, stok tidak cukup, opname dengan selisih, opname yang konflik dengan transaksi, dan Realtime dua browser.

4\. Pada go-live, lakukan backup/snapshot awal dan rekonsiliasi saldo produk prioritas secara fisik.

5\. Spreadsheet lama menjadi arsip read-only; hindari dua sumber stok aktif secara bersamaan.

# 13. Roadmap Implementasi dan Release Gate

| **Fase**                     | **Deliverable**                                                                        | **Exit criteria**                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 0\. Discovery & data cleanse | Kamus SKU/kategori/unit, mapping historis, daftar exception, keputusan bisnis terbuka. | Owner mengesahkan saldo awal, unit, harga kosong, dan transaksi mismatch. |
| 1\. Foundation               | Nuxt scaffold, Supabase project, migrations, Auth, profiles, RLS, environment setup.   | Role test allow/deny lulus; tidak ada secret di bundle.                   |
| 2\. Catalog & POS core       | Product search, Pinia cart, transaction RPC, cash/QRIS manual/split, receipt.          | Concurrent checkout aman; stock movement dan payment selalu balance.      |
| 3\. Inventory & opname       | Opname session, count, reason validation, approval/post, discrepancy report.           | Stale stock_version ditolak; posting atomik; alasan wajib.                |
| 4\. Reports & audit          | Sales report, stock report, exception report, CSV export, audit logs.                  | Angka laporan cocok dengan transaksi/ledger dalam test set.               |
| 5\. Optional adapters        | Printer, scanner, gateway adapter dan settings toggle.                                 | POS tetap berfungsi dengan seluruh plugin OFF dan saat adapter gagal.     |
| 6\. UAT & go-live            | Training kasir/gudang/owner, backup/restore test, cutover.                             | UAT ditandatangani owner; semua Must requirement lulus.                   |

# 14. Risiko, Asumsi, dan Keputusan yang Harus Divalidasi

| **Topik**         | **Asumsi rancangan**                                                           | **Konfirmasi dari owner**                                                                  |
| ----------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Makna kolom Stock | Saldo referensi dari sumber STOCK MASTER, bukan otomatis hasil fisik terakhir. | Apakah nilai yang tersedia adalah saldo sistem, hasil opname, atau snapshot bertanggal?    |
| 245 stok kosong   | Unknown; tidak dijual dengan stok 0 otomatis.                                  | SKU mana yang memang kosong dan mana yang belum pernah dihitung?                           |
| 37 stok negatif   | Anomali legacy yang perlu review.                                              | Apakah tetap dipertahankan, dilakukan opname ulang, atau koreksi?                          |
| Satuan Lusin/Pcs  | Satuan berbeda sampai aturan konversi ditetapkan.                              | Produk mana yang punya konversi 1 lusin = 12 pcs dan apakah penjualan campuran diperlukan? |
| Diskon            | Diskon level transaksi sebagai baseline.                                       | Batas diskon kasir, kebutuhan diskon baris, dan siapa yang dapat override?                 |
| Harga grosir      | Tidak ada tier pada workbook; OFF.                                             | Apakah ada harga grosir, minimum kuantitas, dan daftar SKU yang terpengaruh?               |
| QRIS              | QRIS manual aktif; gateway dinamis OFF.                                        | Provider gateway yang dipakai dan apakah hosting dapat menjalankan Nitro Node server?      |
| Opname            | Perubahan stok selama opname menyebabkan recount untuk SKU terkait.            | Apakah toko dapat membatasi penjualan SKU yang sedang dihitung?                            |
| Kasir dan profil  | Dua label historis harus di-map ke user accounts yang valid.                   | Siapa pemilik akun masing-masing kasir dan apakah ada pergantian staf?                     |
| Jam operasional   | business_date dapat berbeda dari kalender timestamp.                           | Jam tutup hari bisnis dan aturan transaksi lewat tengah malam?                             |
| Stok masuk        | MVP belum mencakup pembelian/penerimaan supplier.                              | Apakah saldo awal akan diperbarui melalui opname saja sampai modul penerimaan dibuat?      |

## 14.1 Risiko Utama dan Mitigasi

- Data historis tidak memiliki SKU dalam nota → gunakan staging + alias mapping; review manual semua item yang ambigu.
- Stock source tidak lengkap/bertanggal tidak diketahui → verifikasi owner dan lakukan opname awal untuk kategori/SKU penting.
- Saldo stale saat opname → stock_version check dan recount pada produk yang berubah.
- Realtime disconnect → reconnect + refetch; checkout tetap memeriksa database.
- QRIS gateway secret bocor → adapter server-only; gateway feature off pada static-only deployment.
- Pengguna mencoba direct DB write → RLS, grant minimal, RPC saja untuk mutasi, dan test pgTAP.

# 15. Referensi Teknis

Dokumentasi resmi berikut menjadi dasar verifikasi pola Supabase yang relevan. API/paket yang berubah harus diverifikasi kembali pada saat implementasi dan dikunci versinya pada project.

- \[1\] Supabase. Row Level Security — enable RLS, least-privilege grants, policies per operation, indexing, dan pola SECURITY DEFINER dengan search_path yang dipatok. <https://supabase.com/docs/guides/database/postgres/row-level-security>
- \[2\] Supabase. Subscribing to Database Changes — opsi Broadcast dan Postgres Changes; Broadcast direkomendasikan untuk skalabilitas/keamanan, sedangkan Postgres Changes lebih sederhana. <https://supabase.com/docs/guides/realtime/subscribing-to-database-changes>
- \[3\] Supabase. Server-Side Rendering — Auth kompatibel dengan SSR dan session menggunakan cookies; @supabase/ssr tercatat beta pada dokumentasi yang diperiksa. <https://supabase.com/docs/guides/auth/server-side>

**Status dokumen** PRD ini cukup rinci sebagai baseline engineering. Sebelum development dimulai, owner perlu memvalidasi khususnya sumber saldo stok, penanganan data kosong/negatif, aturan satuan, batas diskon, serta opsi QRIS gateway.