# Validasi Transaksi Hosted & Acceptance Release — Phase 4D

Terkait: `docs/07-transaction-engine.md`, `docs/08-cashier-interface.md`, `docs/09-transaction-management.md`.

## 1. Lingkup

Phase 4D menutup acceptance yang tertunda sejak Phase 4A.1/4B:

1. Suite transaksi hosted pada Supabase project **preview** `ptbllrugrjepdhhdkzxn` (produksi tidak disentuh).
2. Browser E2E kasir end-to-end via Playwright terhadap dev server lokal (`http://127.0.0.1:3000`).
3. Rekonsiliasi database setelah seluruh uji.
4. Checkout hosted diaktifkan di UI (`hostedCheckoutEnabled = true` di `app/pages/cashier/index.vue`).

Dua sesi kasir independen (owner, cashier_a, cashier_b) memakai kredensial di `.tmp/phase2b-accounts.json` (gitignored). Tidak ada deployment/CI; sasaran uji adalah kode lokal + preview.

## 2. Fixture

| SKU | Harga (snapshot) | Stok awal digunakan | Tujuan |
| --- | --- | --- | --- |
| `TEST-TXN-RACE-001` | 10.000 | 1 | race oversell dua sesi |
| `TEST-TXN-IDEMPOTENCY-001` | 15.000 | 1–3 | retry idempotensi & QRIS |
| `TEST-TXN-PAY-001` | 10.000 | 5–10 | cash, QRIS, split, void |

- Semua 1.360 produk impor tetap `stock_on_hand NULL` dan tidak pernah disentuh.
- Re-seed fixture memakai enum unit + `manual_adjustment` (reason_code `input_error`, actor owner, `idempotency_key` fresh per movement) yang meng-update `stock_on_hand` dan `stock_version` bersamaan.

## 3. Bug yang ditemukan dan diperbaiki saat validasi

| Temuan | Perbaikan |
| --- | --- |
| `private.complete_sale` menolak qty valid dengan `22003` saat qty dikirim sebagai `number` (numeric_value_out_of_range) | Wrapper `complete_sale` membungkus cast dengan kondisi; perbaikan sama ada di `supabase/migrations/20261103110000_transaction_engine.sql` |
| Setelah penolakan stok backend, input quantity tetap menampilkan nilai ditolak ("99") padahal keranjang kembali ke qty sah | `CartTable.vue` me-reset input ke `line.quantity` jika `validateQuantity` menolak nilai; error tetap tampil lewat notice halaman (`role=status`) |
| Sel `stock_movements` kolom prefiks memerlukan path schema | Konsisten memakai `public.*` pada SQL kontrol |

## 4. Hasil uji

| Pemeriksaan | Hasil |
| --- | --- |
| `npm run test:db` (PGlite) | **42/42 lulus** (setelah quickie wrapper race pakai versi baru migration) |
| Suite hosted `scripts/transaction-hosted-smoke.mjs` | **10/10 lulus** — race oversell (tepat 1 `completed`, 1 `INSUFFICIENT_STOCK`, stok akhir 0, satu movement `sale_out`), retry idempotensi same key tidak membuat nota kedua, QRIS tanpa konfirmasi ditolak di sisi server, split total tepat, void owner ok & kasir ditolak, `already_processed` |
| Browser E2E `npx playwright test` (dev server lokal) | **10/10 lulus** (workers=1, baseURL `E2E_BASE_URL` atau `127.0.0.1:3000`) |
| `npm test` | **83/83 lulus** (vitest; `e2e/` di-exclude dari vitest) |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0 |

Skenario browser E2E (`e2e/cashier.spec.mjs`):

1. `/cashier` tanpa sesi → redirect `/login`.
2. Password salah ditolak.
3. Pencarian, baris `NULL` stok ("Stok belum diopname"), guard quantity oversales (nilai ditolak direset, notice tampil).
4. Checkout tunai + kembalian + dialog nota + ID transaksi UUID.
5. QRIS tanpa centang ditolak; setelah centang sukses.
6. Abort jaringan → retry dengan idempotency key sama → `already_processed`, keranjang tidak duplikat.
7. Riwayat transaksi, detail snapshot, cetak ulang nota; kasir tidak memiliki tombol void.
8. Owner: void tanpa alasan ditolak, void dengan alasan sukses, stock_version + movement `void_return` tertulis.
9. Akun gudang ditolak 403 di `/cashier`.
10. Logout kembali ke `/login`.

## 5. Rekonsiliasi (probe RLS `set_config('request.jwt.claims', …)` pada preview)

Agregat kumulatif seluruh eksperimen fixture selama 3 Nov 2026:

| SKU | Transaksi `completed` | Transaksi `voided` | Total completed | Stok akhir | Σ delta `stock_movements` |
| --- | --- | --- | --- | --- | --- |
| `TEST-TXN-RACE-001` | 3 | 0 | 30.000 | 0 (versi 1) | 0 |
| `TEST-TXN-IDEMPOTENCY-001` | 10 | 3 | 150.000 | 1 (versi 8) | 1 |
| `TEST-TXN-PAY-001` | 16 | 1 | 160.000 | 2 (versi 10) | 2 |

- Stok akhir = Σ delta semua movement (`manual_adjustment` reseed + semua `sale_out`/`void_return`) — nilainya identik di semua fixture, tidak ada drift ledger.
- Void mengembalikan stok tepat satu kali (versi bertambah 1, max satu movement `void_return` per void).
- Nomor nota `SS-20261103-0001 … 0033` unik dan berurutan; pembayaran split (`cash`+`qris`) sama dengan `grand_total`.
- Tidak ada reseed yang menulis langsung ke stok tanpa movement.

## 6. Cara mengulang

```bash
npm run test:db
npx playwright test --reporter=list        # perlu dev server di 127.0.0.1:3000
npm run test:hosted:transactions           # suite hosted (fixture di preview)
```

Setiap run E2E mengonsumsi stok fixture (pay: 2, idem: 1) dan membuat nota baru urut; reseed via `manual_adjustment` sebelum run jika stok moduleu kehabisan. Fixture produksi harus memakai produk `TEST-` di preview, bukan data operasional.

## 7. Batasan

- **Produksi belum diterapkan**: semna migrasi hanya di preview `ptbllrugrjepdhhdkzxn`. Produksi butuh approval owner + backup.
- Checkout diaktifkan; aktif ↔ dinonaktifkan via `hostedCheckoutEnabled` di `app/pages/cashier/index.vue`.
- Race tes browser tidak menguji konkurensi paralel (Playwright workers=1); jaminan parallel tetap dari suite hosted dan `FOR UPDATE`.
- Keputusan bisnis terbuka (diskon, refund, jendela void, bukti QRIS) tetap dicatat di `docs/07-transaction-engine.md` bagian 16.
- Phase 5 opname sudah dijalankan di preview 4 November 2026 (`docs/22` §11); realtime laporan masih seperti yang dicatat di `docs/18`.
