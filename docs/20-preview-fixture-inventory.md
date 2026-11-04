# Phase 5E — Inventaris Fixture Preview

Laporan baca-saja atas seluruh produk uji (`TEST-*`, `HOST-*`) di project
preview `ptbllrugrjepdhhdkzxn`. Dokumen ini adalah dasar keputusan pembersihan
sebelum produksi; **tidak ada satu pun baris yang diubah, dinonaktifkan, atau
dihapus** saat audit dijalankan.

- Skrip: `scripts/fixture-audit.mjs` (`--json` untuk keluaran mesin)
- Dijalankan: 4 November 2026, 08:26 UTC
- Target: preview saja (skrip menolak ref selain `ptbllrugrjepdhhdkzxn`)
- Sumber data: `products`, `transaction_items`, `payments`, `stock_movements`,
  `stock_opname_items` + `stock_opnames`, `stock_discrepancy_logs`,
  `product_costs`, `product_aliases`, `audit_logs`

## 1. Mengapa audit ini ada

Phase 5D menjalankan suite hosted dan E2E berulang kali. Setiap run membuat
produk baru dengan SKU berstempel waktu, lalu sebagian dinonaktifkan. Riwayat
yang menyertainya — movement, baris opname terposting, log selisih, baris
transaksi, pembayaran, audit — bersifat **immutable** dan tidak boleh dihapus
hanya karena produknya bernama "TEST".

Karena itu klasifikasi di bawah **tidak** memakai prefix SKU sebagai bukti.
Prefix hanya dipakai untuk memilih kandidat; status setiap produk ditentukan
oleh referensi foreign key yang benar-benar ada.

## 2. Aturan klasifikasi

| Klas. | Arti | Kriteria operasional | Rekomendasi |
| --- | --- | --- | --- |
| **A** | Tidak direferensikan | Nol referensi FK ke tabel mana pun (audit log tidak dihitung karena `entity_id` bertipe teks tanpa FK) | Kandidat hapus fisik **setelah** approval eksplisit. Default tetap: nonaktifkan |
| **B** | Direferensikan, tanpa ledger | Hanya `product_costs`, `product_aliases`, atau baris opname yang belum terposting | Nonaktifkan; jangan hapus |
| **C** | Punya riwayat ledger, masih aktif | Ada movement / baris opname terposting / log selisih / baris transaksi, dan `is_active = true` | Arsipkan (nonaktifkan); jangan hapus |
| **D** | Punya riwayat ledger, sudah nonaktif | Sama dengan C tetapi `is_active = false` | Biarkan terarsip; jangan hapus |

`audit_logs` sengaja dipisah: tabel itu menyimpan `entity_id` sebagai teks tanpa
foreign key, jadi satu baris audit tidak membuktikan produk masih dirujuk. Nilai
audit tetap dilaporkan di kolom tersendiri agar tidak hilang dari pandangan.

## 3. Ringkasan

| Metrik | Nilai |
| --- | --- |
| Produk uji ditemukan | **48** |
| Aktif | 8 |
| Nonaktif | 40 |
| Klasifikasi A (tak direferensikan) | **0** |
| Klasifikasi B | 13 |
| Klasifikasi C | 3 |
| Klasifikasi D | 32 |
| Baris `transaction_items` | 39 |
| Baris `payments` (transaksi yang memuat produk uji) | 39 |
| Baris `stock_movements` | 104 |
| Baris `stock_opname_items` | 80 (53 di antaranya pada sesi `posted`) |
| Baris `stock_discrepancy_logs` | 13 |
| Baris `audit_logs` (`entity_name = 'products'`) | 92 |
| Baris `product_costs` | 5 |
| Baris `product_aliases` | 0 |
| Rentang pembuatan produk uji | 2 Nov 2026 01:31 UTC – 4 Nov 2026 07:34 UTC |
| Movement terakhir | 4 Nov 2026 07:35 UTC |

**Tidak ada kandidat klasifikasi A.** Karena itu laporan ini tidak mengusulkan
satu pun penghapusan fisik, dan tidak ada `DELETE` yang menunggu approval.
Pembersihan yang diusulkan seluruhnya berbentuk pengarsipan (nonaktifkan).

Audit ulang Phase 5E.1 pada 4 November 2026 09:48 UTC mengembalikan angka yang
sama, 8 UUID aktif yang sama, dan tidak ada fixture baru. Rencana eksekusi
memakai RPC owner, bukan `UPDATE` langsung — lihat §7.

## 4. Kelompok fixture

| Grup | Jumlah | Aktif | Klas. | Movement | Tx item | Opname item | Log | Audit | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `HOST-*` | 5 | 5 | B×5 | 0 | 0 | 0 | 0 | 10 | 5 |
| `TEST-OPN-*` | 12 | 0 | B×2, D×10 | 20 | 2 | 32 | 8 | 24 | 0 |
| `TEST-OPN-E2E-*` | 24 | 0 | B×3, D×21 | 29 | 3 | 41 | 5 | 48 | 0 |
| `TEST-REALTIME-*` | 4 | 0 | B×3, D×1 | 1 | 0 | 4 | 0 | 4 | 0 |
| `TEST-TXN-*` | 3 | 3 | C×3 | 54 | 34 | 3 | 0 | 6 | 0 |

Catatan per grup:

- **`HOST-*`** — dibuat oleh `scripts/inventory-hosted-smoke.mjs`. Semuanya
  masih aktif, berstok `NULL`, tanpa movement dan tanpa baris opname. Satu-
  satunya referensi adalah `product_costs` (1 per produk) dan 2 baris audit.
  Ini kelompok paling aman untuk dinonaktifkan, tetapi tetap bukan kandidat
  hapus karena `product_costs` punya FK.
- **`TEST-OPN-*`** — fixture suite DB/hosted Phase 5A–5D. Sebagian besar sudah
  nonaktif dan memiliki movement `opening_balance` / `opname_adjustment`.
  Dua produk (`TEST-OPN-A-*`) masih menyimpan 30 unit dan menjadi bahan uji
  saldo awal.
- **`TEST-OPN-E2E-*`** — dibuat `e2e/stock-opname.spec.mjs`. Tiga di antaranya
  (`...-MW1SCO8W`) hanya punya baris opname yang belum terposting, sehingga
  masuk B; sisanya sudah pernah diposting.
- **`TEST-REALTIME-*`** — empat produk uji Broadcast Phase 10. Tiga tanpa
  movement (B), satu dengan `opening_balance` 7 unit (D).
- **`TEST-TXN-*`** — tiga produk aktif dengan riwayat transaksi nyata
  (34 baris item, 54 movement, termasuk `void_reversal`). Ini kelompok yang
  **paling berbahaya** untuk dihapus dan paling perlu diarsipkan dengan hati-
  hati: `TEST-TXN-RACE-001` bahkan punya 6 baris audit.

## 5. Produk yang masih aktif

Delapan produk aktif adalah yang paling relevan untuk kesiapan produksi:

| SKU | Klas. | Stok | Tx item | Movement | Kenapa masih aktif |
| --- | --- | --- | --- | --- | --- |
| `HOST-MVYL2SIG` | B | NULL | 0 | 0 | Sisa smoke hosted, belum diarsipkan |
| `HOST-MVYLDP3O` | B | NULL | 0 | 0 | idem |
| `HOST-MVYM9JCA` | B | NULL | 0 | 0 | idem |
| `HOST-MVYMF06P` | B | NULL | 0 | 0 | idem |
| `HOST-MVYMVR42` | B | NULL | 0 | 0 | idem |
| `TEST-TXN-IDEMPOTENCY-001` | C | 1 | 13 | 20 | Fixture uji idempotensi checkout |
| `TEST-TXN-PAY-001` | C | 1 | 18 | 22 | Fixture uji pembayaran |
| `TEST-TXN-RACE-001` | C | 0 | 3 | 12 | Fixture uji konkurensi |

Kelima `HOST-*` tidak punya riwayat ledger sama sekali, jadi menonaktifkannya
tidak mengubah satu pun angka stok. Tiga `TEST-TXN-*` punya riwayat penuh;
menonaktifkannya hanya menyembunyikannya dari katalog/checkout, tidak menyentuh
ledger.

## 6. Inventaris lengkap

Kolom `Tx` = baris `transaction_items`, `Mov` = `stock_movements`, `Opname` =
baris `stock_opname_items`, `Log` = `stock_discrepancy_logs`, `Audit` =
`audit_logs` dengan `entity_name = 'products'`, `Cost` = `product_costs`,
`Alias` = `product_aliases`. Stok `—` berarti `NULL` (belum diketahui), bukan
nol.

| # | Klas. | SKU | Nama | Aktif | Stok | v | Tx | Mov | Opname | Log | Audit | Cost | Alias | UUID |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | B | `HOST-MVYL2SIG` | Hosted Smoke mvyl2sig Updated | ya | — | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | `164b53c4-3ed5-4aa4-8c3c-8c499a5b9a4a` |
| 2 | B | `HOST-MVYLDP3O` | Hosted Smoke mvyldp3o Updated | ya | — | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | `fb51c404-94bc-41c5-b493-1fcf671dc510` |
| 3 | B | `HOST-MVYM9JCA` | Hosted Smoke mvym9jca Updated | ya | — | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | `62e354e3-751f-44c1-adb6-1cd5d5edeaa5` |
| 4 | B | `HOST-MVYMF06P` | Hosted Smoke mvymf06p Updated | ya | — | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | `15c19a2e-64dd-41c7-b2b7-1f004eb73dbb` |
| 5 | B | `HOST-MVYMVR42` | Hosted Smoke mvymvr42 Updated | ya | — | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 0 | `eb74882c-13c8-45ef-ab62-57635182cf38` |
| 6 | D | `TEST-OPN-A-MW1S7E38` | TEST Opname A MW1S7E38 | tidak | 30 | 2 | 0 | 2 | 2 | 1 | 2 | 0 | 0 | `fa039acc-caa6-4615-b742-93febb28b6ad` |
| 7 | D | `TEST-OPN-A-MW1S9JTI` | TEST Opname A MW1S9JTI | tidak | 30 | 2 | 0 | 2 | 2 | 1 | 2 | 0 | 0 | `18b1415e-dc14-4e0f-9b65-c73cab166bd5` |
| 8 | D | `TEST-OPN-B-MW1S7E38` | TEST Opname B MW1S7E38 | tidak | 0 | 1 | 0 | 1 | 3 | 0 | 2 | 0 | 0 | `6d014275-9b95-47b0-af4d-e8208b553c68` |
| 9 | D | `TEST-OPN-B-MW1S9JTI` | TEST Opname B MW1S9JTI | tidak | 0 | 1 | 0 | 1 | 3 | 0 | 2 | 0 | 0 | `d62f306b-2a82-4d8d-9b6d-f30a3678cdb1` |
| 10 | D | `TEST-OPN-C-MW1S7E38` | TEST Opname C MW1S7E38 | tidak | 14 | 4 | 0 | 4 | 7 | 3 | 2 | 0 | 0 | `18352f29-f1b4-498f-9ef8-974307f3c003` |
| 11 | D | `TEST-OPN-C-MW1S9JTI` | TEST Opname C MW1S9JTI | tidak | 14 | 4 | 0 | 4 | 7 | 3 | 2 | 0 | 0 | `955d5935-6e6a-4f8f-a197-3ce89436e7cb` |
| 12 | D | `TEST-OPN-D-MW1S7E38` | TEST Opname D MW1S7E38 | tidak | 9 | 2 | 1 | 2 | 2 | 0 | 2 | 0 | 0 | `1e375b4e-19c6-457b-ab57-02d4c9ed1909` |
| 13 | D | `TEST-OPN-D-MW1S9JTI` | TEST Opname D MW1S9JTI | tidak | 9 | 2 | 1 | 2 | 2 | 0 | 2 | 0 | 0 | `43d22a9b-151e-4e18-88ef-5593b98480e6` |
| 14 | D | `TEST-OPN-E-MW1S7E38` | TEST Opname E MW1S7E38 | tidak | 2.5 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `ee8d461b-964f-4809-9b8d-389456d80e56` |
| 15 | D | `TEST-OPN-E-MW1S9JTI` | TEST Opname E MW1S9JTI | tidak | 2.5 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `e7f20123-5862-4010-b568-2df55ce3776e` |
| 16 | B | `TEST-OPN-E2E-KNOWN-MW1SCO8W` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SCO8W | tidak | — | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | `924bc605-eefe-4edc-9a88-cf98f142a6b9` |
| 17 | D | `TEST-OPN-E2E-KNOWN-MW1SDVAQ` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SDVAQ | tidak | 10 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `de12af1f-aa70-4c4e-b97f-ea4d595a62f3` |
| 18 | D | `TEST-OPN-E2E-KNOWN-MW1SFBJ4` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SFBJ4 | tidak | 10 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `f2336137-36be-47ad-bddb-08fb7a509192` |
| 19 | D | `TEST-OPN-E2E-KNOWN-MW1SGLOY` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SGLOY | tidak | 13 | 2 | 0 | 2 | 3 | 1 | 2 | 0 | 0 | `44c37e3e-5096-4a96-aeb4-0ba6b3c1c807` |
| 20 | D | `TEST-OPN-E2E-KNOWN-MW1SHSFH` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SHSFH | tidak | 13 | 2 | 0 | 2 | 3 | 1 | 2 | 0 | 0 | `8bb358fc-d530-4c51-a0e2-4a52f1d3d17e` |
| 21 | D | `TEST-OPN-E2E-KNOWN-MW1SMLYO` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SMLYO | tidak | 12 | 3 | 1 | 3 | 4 | 1 | 2 | 0 | 0 | `676dc6f6-6890-4159-9d09-308a5dd5eb9b` |
| 22 | D | `TEST-OPN-E2E-KNOWN-MW1SSGYD` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SSGYD | tidak | 12 | 3 | 1 | 3 | 4 | 1 | 2 | 0 | 0 | `b69e2fca-88ef-4f8b-b36c-09c40cc89ab3` |
| 23 | D | `TEST-OPN-E2E-KNOWN-MW1SXCHC` | TEST Opname E2E TEST-OPN-E2E-KNOWN-MW1SXCHC | tidak | 12 | 3 | 1 | 3 | 4 | 1 | 2 | 0 | 0 | `d4443536-7663-4c0b-9767-0ea517ca92b2` |
| 24 | B | `TEST-OPN-E2E-NULL-MW1SCO8W` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SCO8W | tidak | — | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | `125eda4c-22e5-4cec-9dea-9fd247018bc2` |
| 25 | D | `TEST-OPN-E2E-NULL-MW1SDVAQ` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SDVAQ | tidak | 25 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `9b779f07-a3f5-451a-8cbf-c6c2f119a0a6` |
| 26 | D | `TEST-OPN-E2E-NULL-MW1SFBJ4` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SFBJ4 | tidak | 25 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `f067537e-899f-4a2e-8390-0b8511c4b256` |
| 27 | D | `TEST-OPN-E2E-NULL-MW1SGLOY` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SGLOY | tidak | 25 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `0dc709d7-746d-4647-9d90-fd1f309800c2` |
| 28 | D | `TEST-OPN-E2E-NULL-MW1SHSFH` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SHSFH | tidak | 25 | 1 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | `06566828-35a9-4a19-b959-a30006224cfa` |
| 29 | D | `TEST-OPN-E2E-NULL-MW1SMLYO` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SMLYO | tidak | 25 | 1 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | `b3292f6a-5ccc-43dd-b4f2-420a268dc242` |
| 30 | D | `TEST-OPN-E2E-NULL-MW1SSGYD` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SSGYD | tidak | 25 | 1 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | `29717d7b-3af3-4691-8196-c22e290dc3e9` |
| 31 | D | `TEST-OPN-E2E-NULL-MW1SXCHC` | TEST Opname E2E TEST-OPN-E2E-NULL-MW1SXCHC | tidak | 25 | 1 | 0 | 1 | 2 | 0 | 2 | 0 | 0 | `ef0dd182-4bf0-49a2-82fb-698f8cbcbfa2` |
| 32 | B | `TEST-OPN-E2E-ZERO-MW1SCO8W` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SCO8W | tidak | — | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | `96a62f76-ed5f-4331-8d94-0d4133ea4da3` |
| 33 | D | `TEST-OPN-E2E-ZERO-MW1SDVAQ` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SDVAQ | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `35fda763-ca2e-41e0-9f54-94e81d6ef54e` |
| 34 | D | `TEST-OPN-E2E-ZERO-MW1SFBJ4` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SFBJ4 | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `0e2fabf6-8a71-46f8-8b82-5e044bbee7e7` |
| 35 | D | `TEST-OPN-E2E-ZERO-MW1SGLOY` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SGLOY | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `a9c13477-6a5c-40b3-9ea7-610b67cb3e26` |
| 36 | D | `TEST-OPN-E2E-ZERO-MW1SHSFH` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SHSFH | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `92a02ece-3b0e-4086-8384-ecb0904d7fa0` |
| 37 | D | `TEST-OPN-E2E-ZERO-MW1SMLYO` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SMLYO | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `94ecd41f-51ab-4854-a16d-b88b47d7d104` |
| 38 | D | `TEST-OPN-E2E-ZERO-MW1SSGYD` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SSGYD | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `82f8f7bb-5a25-4275-8f14-6e26ebed6db4` |
| 39 | D | `TEST-OPN-E2E-ZERO-MW1SXCHC` | TEST Opname E2E TEST-OPN-E2E-ZERO-MW1SXCHC | tidak | 0 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 0 | `8921cf44-ec18-431c-a933-73ffbf571c52` |
| 40 | B | `TEST-OPN-F-MW1S7E38` | TEST Opname F MW1S7E38 | tidak | — | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | `42c1616c-7cac-4fe9-b88d-f3def00fd966` |
| 41 | B | `TEST-OPN-F-MW1S9JTI` | TEST Opname F MW1S9JTI | tidak | — | 0 | 0 | 0 | 1 | 0 | 2 | 0 | 0 | `ee43e487-9fec-4ce9-9002-2c33deab2189` |
| 42 | B | `TEST-REALTIME-1793761125391` | Produk uji realtime | tidak | — | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | `757edbd3-bcf7-42bd-a6d7-d3096e9acc4d` |
| 43 | B | `TEST-REALTIME-1793761146900` | Produk uji realtime | tidak | — | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | `ff8404e1-ef07-443f-850e-b1bbf2eadea4` |
| 44 | B | `TEST-REALTIME-1793761156357` | Produk uji realtime | tidak | — | 0 | 0 | 0 | 1 | 0 | 1 | 0 | 0 | `6d0edf69-0ec0-410f-9cdc-dbb299a87c1d` |
| 45 | D | `TEST-REALTIME-1793761160973` | Produk uji realtime | tidak | 7 | 1 | 0 | 1 | 1 | 0 | 1 | 0 | 0 | `9704c5c5-b833-4019-8fc8-68f75cc57a92` |
| 46 | C | `TEST-TXN-IDEMPOTENCY-001` | TEST Idempotency Produk | ya | 1 | 8 | 13 | 20 | 1 | 0 | 0 | 0 | 0 | `a1000000-0000-4000-8000-000000000002` |
| 47 | C | `TEST-TXN-PAY-001` | TEST Payment Produk | ya | 1 | 11 | 18 | 22 | 1 | 0 | 0 | 0 | 0 | `a1000000-0000-4000-8000-000000000003` |
| 48 | C | `TEST-TXN-RACE-001` | TEST Race Produk | ya | 0 | 7 | 3 | 12 | 1 | 0 | 6 | 0 | 0 | `a1000000-0000-4000-8000-000000000001` |

## 7. Rencana pengarsipan (dry-run, belum dieksekusi)

Audit ulang Phase 5E.1 pada 4 November 2026 09:48 UTC mengembalikan 48 produk
yang sama, 8 aktif, dan klasifikasi yang sama (A=0, B=13, C=3, D=32). Tidak ada
penghapusan. Rencana hanya menonaktifkan 8 produk aktif dan membiarkan seluruh
riwayat apa adanya. Migrasi 0021–0023 sudah diterapkan; itu tidak mengubah satu
pun fixture, dan pengarsipan tetap menunggu gate terpisah.

### 7.1 Metode: RPC owner, bukan UPDATE langsung

`public.upsert_product` adalah jalur tulis produk yang owner-only. RPC itu
meng-update kolom master + `is_active` dan **tidak** menyentuh
`stock_on_hand`/`stock_version`. Payload memakai nilai master saat ini, jadi
satu-satunya perubahan adalah `is_active=false`; RPC juga menulis audit
`product.update`.

Delapan payload lengkap ada di
`docs/21-phase-5e-hosted-readiness.md` §7. Bentuk pemanggilannya:

```js
await client.rpc('upsert_product', {
  p_payload: { ...masterFields, product_id: id, is_active: false },
})
```

Verifikasi read-only sebelum eksekusi (bukan bagian dari eksekusi):

```sql
select id, sku, is_active, stock_on_hand, stock_version
  from public.products
 where id in (
   '164b53c4-3ed5-4aa4-8c3c-8c499a5b9a4a', -- HOST-MVYL2SIG
   'fb51c404-94bc-41c5-b493-1fcf671dc510', -- HOST-MVYLDP3O
   '62e354e3-751f-44c1-adb6-1cd5d5edeaa5', -- HOST-MVYM9JCA
   '15c19a2e-64dd-41c7-b2b7-1f004eb73dbb', -- HOST-MVYMF06P
   'eb74882c-13c8-45ef-ab62-57635182cf38', -- HOST-MVYMVR42
   'a1000000-0000-4000-8000-000000000002', -- TEST-TXN-IDEMPOTENCY-001
   'a1000000-0000-4000-8000-000000000003', -- TEST-TXN-PAY-001
   'a1000000-0000-4000-8000-000000000001'  -- TEST-TXN-RACE-001
 );
```

Dampak yang diperkirakan:

| Objek | Sebelum | Sesudah | Catatan |
| --- | --- | --- | --- |
| Produk aktif | 8 | 0 | Katalog operasional bersih dari fixture |
| `stock_on_hand` / `stock_version` | 8 nilai | **tidak berubah** | RPC tidak menulis kolom stok |
| `stock_movements` | 104 | 104 | Tidak disentuh |
| `transaction_items` | 39 | 39 | Tidak disentuh |
| `payments` | 39 | 39 | Tidak disentuh |
| `stock_opname_items` | 80 | 80 | Tidak disentuh |
| `stock_discrepancy_logs` | 13 | 13 | Tidak disentuh |
| `audit_logs` | 92 | 92 + 8 | `product.update` baru dari RPC |
| `product_costs` | 5 | 5 | Tidak disentuh |
| Stok `NULL` produk impor | 1.361 | 1.361 | Tidak disentuh |

Catatan penting: menonaktifkan `TEST-TXN-*` **tidak** membatalkan transaksi
lama. Riwayat transaksi tetap dapat dibuka di `/cashier/transactions`, dan
laporan tetap menghitungnya. Yang berubah hanya visibilitas produk di katalog
dan pencarian kasir.

### 7.2 Gate approval (terpisah)

Eksekusi hanya boleh berjalan setelah owner menulis tepat:

```
APPROVE ARCHIVE 8 ACTIVE PREVIEW FIXTURES
```

Gate ini **bukan** bagian dari `APPROVE PHASE 5E MIGRATIONS TO PREVIEW`.
Menyetujui migrasi tidak menyetujui pengarsipan, dan sebaliknya.

### 7.3 Yang tidak akan dilakukan

- Tidak menghapus produk, movement, baris opname, log selisih, transaksi,
  pembayaran, atau audit — meskipun produknya nonaktif.
- Tidak memakai `ON DELETE CASCADE` atau `delete from ... cascade`.
- Tidak menyentuh 1.361 produk impor (stok `NULL`) atau produk katalog lain.
- Tidak mengubah `stock_on_hand` / `stock_version` produk mana pun.
- Tidak menghapus sesi opname `posted`; sesi itu bukti historis.

### 7.4 Kalau kelak ada kandidat A

Klasifikasi A saat ini nol. Bila nanti muncul, urutannya wajib: buktikan nol
referensi FK → jalankan `node scripts/fixture-audit.mjs --json` ulang →
sajikan dry-run → tunggu approval terpisah → baru eksekusi. Approval tidak
pernah disimpulkan dari diskusi.

## 8. Cara mengulang audit

```bash
node scripts/fixture-audit.mjs           # tabel ringkas per produk
node scripts/fixture-audit.mjs --json    # JSON untuk dokumen ini
```

Skrip hanya membaca, menolak berjalan bila `SUPABASE_URL` bukan preview, dan
tidak pernah memilih produk di luar `TEST-%` / `HOST-%`.
