# 21 — Kesiapan Hosted Phase 5E.1

Status per 4 November 2026: **audit read-only dan dry-run selesai; belum ada
migrasi yang diterapkan dan belum ada fixture yang diarsipkan.**

Dua gate approval masih terbuka dan tidak saling menggantikan:

1. `APPROVE PHASE 5E MIGRATIONS TO PREVIEW`
2. `APPROVE ARCHIVE 8 ACTIVE PREVIEW FIXTURES`

Dokumen ini adalah bukti yang diminta sebelum gate pertama. Setelah deployment,
bagian 6 dan 7 diperbarui dengan hasil sebenarnya.

## 1. Guardrail

- Produksi tidak disentuh. Target hanya project preview `ptbllrugrjepdhhdkzxn`.
- Tidak ada `post_stock_opname`, `record_stock_opname_count`, atau
  `adjust_stock` yang dijalankan pada fase ini.
- Tidak ada saldo awal dibuat, tidak ada `stock_on_hand` / `stock_version`
  diubah, dan tidak ada produk impor yang disentuh.
- Tidak ada `DELETE`, `CASCADE`, atau pembersihan riwayat.
- `service_role` tidak dipakai di klien dan tidak pernah dicetak.

## 2. Status repository dan remote

| Item | Nilai |
| --- | --- |
| Branch / commit | `main` / `5ddcf78` (Phase 5E) |
| Working tree | bersih sebelum audit; hanya file `.tmp/` yang gitignored |
| Supabase CLI | `npx supabase` **2.122.0** (global tidak ada di PATH) |
| Project linked | `ptbllrugrjepdhhdkzxn` — *Toko Sinar Soleha*, org `veqlhnjvckdsflpoefsu`, Singapore |
| Migrasi remote | **20/20** sampai `20261106130000` |
| Migrasi lokal | **23** (0021–0023 belum diterapkan) |
| Dry-run | tepat tiga migrasi 5E |
| Probe RPC 5E | ketiganya `PGRST202` — belum ada di schema cache |

Migrasi yang tertunda:

- `20261106140000_opname_detail_summary.sql` (0021)
- `20261106140100_opname_item_pagination.sql` (0022)
- `20261106140200_opname_item_context.sql` (0023)

## 3. Review migrasi

| Aspek | 0021 summary | 0022 pagination | 0023 context |
| --- | --- | --- | --- |
| Signature | `get_stock_opname_summary(uuid)` | `list_stock_opname_items(uuid,int,int,text,text)` | `get_stock_opname_item_context(uuid)` |
| Security | `SECURITY INVOKER` | `SECURITY INVOKER` | `SECURITY INVOKER` |
| `search_path` | `''` | `''` | `''` |
| Otorisasi | `private.has_role(['owner','inventory_staff'])` | idem | idem |
| Grant | `REVOKE` dari `public, anon, authenticated`; `GRANT EXECUTE` hanya `authenticated` | idem | idem |
| RLS | tetap berlaku pada `stock_opnames` / `stock_opname_items` | idem + `products` | idem |
| Mutasi | tidak ada | tidak ada | tidak ada |
| Perubahan tabel | tidak ada | tidak ada | tidak ada |

Catatan review:

- **0021** menghitung seluruh sesi dengan `count(*) filter (...)`, bukan dari
  halaman. Predikat `blocker_count` identik dengan
  `private.opname_blockers` (dibandingkan baris per baris), sehingga
  `ready_for_submit` tidak bisa berbeda dari keputusan `submit_stock_opname`.
- **0022** mengurutkan `p.sku ASC, i.id ASC`; `id` adalah tie-breaker unik.
  `limit` di-clamp 1–250, `offset` ≥ 0, filter divalidasi, pencarian berlaku
  untuk seluruh sesi, dan `total` dihitung terpisah dari halaman.
- **0023** mengembalikan snapshot + versinya **dan** stok/versi produk saat ini.
  Read-only; angka ini hanya hint, rebase tetap di `record_stock_opname_count`.
- Residual kecil (bukan blocker): pencarian 0022 memakai `ILIKE '%'||v_search||'%'`
  tanpa escape `%`/`_`. Untuk 1.409 produk dampaknya kosmetik; kandidat
  hardening berikutnya.
- `npm run gen:types` (PGlite, seluruh 23 migrasi) menghasilkan file yang
  **identik** dengan `types/database.generated.ts` yang sudah di-commit —
  signature RPC dan tipe JSON cocok.

## 4. Bukti read-only preview

Diambil 4 November 2026 09:48 UTC dengan sesi owner nyata (bukan
`service_role`):

| Pemeriksaan | Hasil |
| --- | --- |
| Katalog | 1.409 produk; 1.374 stok `NULL`; 1.369 aktif |
| Produk impor | **1.361 tetap `NULL`** (1.374 `NULL` − 13 fixture `NULL`) |
| Profil | 5: owner 1, inventory_staff 1, cashier 3 (1 nonaktif) |
| Fixture `TEST-*`/`HOST-*` | 48: **A=0, B=13, C=3, D=32**; 8 aktif, 40 nonaktif |
| Sesi opname | 58 |
| Sesi katalog penuh | `OP-20261104-0018` dan `OP-20261104-0032`, keduanya `cancelled`, **1.361 item**, semuanya `pending` |
| Item `needs_recount` | 2: `OP-20261104-0047` dan `OP-20261104-0052` |
| RPC 5E | `PGRST202` untuk ketiganya |

Dua sesi `cancelled` berisi 1.361 item adalah aset penting: paginasi, filter,
pencarian, dan ringkasan bisa diuji **tanpa membuat sesi baru dan tanpa
posting**. Dua item `needs_recount` memungkinkan verifikasi konteks recount
secara read-only.

Delapan fixture aktif (identitas sama persis dengan `docs/20`):

| SKU | UUID | Stok | v | Tx item | Movement | Opname item | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `HOST-MVYL2SIG` | `164b53c4-…` | NULL | 0 | 0 | 0 | 0 | 1 |
| `HOST-MVYLDP3O` | `fb51c404-…` | NULL | 0 | 0 | 0 | 0 | 1 |
| `HOST-MVYM9JCA` | `62e354e3-…` | NULL | 0 | 0 | 0 | 0 | 1 |
| `HOST-MVYMF06P` | `15c19a2e-…` | NULL | 0 | 0 | 0 | 0 | 1 |
| `HOST-MVYMVR42` | `eb74882c-…` | NULL | 0 | 0 | 0 | 0 | 1 |
| `TEST-TXN-IDEMPOTENCY-001` | `a1000000-…-0002` | 1 | 8 | 13 | 20 | 1 | 0 |
| `TEST-TXN-PAY-001` | `a1000000-…-0003` | 1 | 11 | 18 | 22 | 1 | 0 |
| `TEST-TXN-RACE-001` | `a1000000-…-0001` | 0 | 7 | 3 | 12 | 1 | 0 |

## 5. Rencana deployment (setelah approval)

```bash
npx supabase migration list --linked          # harus 20 remote
npx supabase db push --dry-run                # harus tepat 0021–0023
npx supabase db push --linked                 # hanya setelah approval
npx supabase migration list --linked          # target 23/23
npx supabase gen types typescript --linked --schema public > types/database.generated.ts
npm run typecheck
```

Perubahan schema: **tiga fungsi baru**, tanpa tabel/kolom/constraint/policy.
Tidak ada backfill dan tidak ada lock tabel jangka panjang.

Risiko: rendah. `CREATE OR REPLACE FUNCTION` hanya mengganti fungsi yang belum
ada (dibuktikan probe `PGRST202`). Grant hanya pada tiga fungsi tersebut.

Rollback:

- Fungsi bersifat aditif; aplikasi lama tidak memanggilnya.
- Bila perlu mundur, buat migrasi maju baru yang `DROP FUNCTION` ketiganya.
- Jangan memakai `migration repair` otomatis; riwayat remote adalah bukti.
- Tidak ada data yang perlu dipulihkan karena migrasi tidak menulis baris.

## 6. Rencana validasi hosted (read-only)

Setelah migrasi diterapkan, sebelum menyentuh fixture:

1. Paginasi `OP-20261104-0018` pada ukuran 50/100/250: halaman pertama, tengah,
   terakhir; jalan penuh 1.361 item tanpa gap/duplikat; urutan `sku` naik.
2. Filter `pending`/`recount`/`difference` dan pencarian SKU di seluruh sesi;
   `total` tidak berubah karena ukuran halaman.
3. Ringkasan: `item_count`, `pending_count`, `counted_count`,
   `needs_recount_count`, `opening_balance_count`, `matching_count`,
   `discrepancy_count`, `blocker_count`, `ready_for_submit`.
4. Konteks: item `needs_recount` di `OP-20261104-0047`/`0052` — snapshot 13/v2,
   stok terkini, status, dan `count_status`.
5. Otorisasi dengan JWT nyata: owner dan inventory_staff boleh; kasir, akun
   nonaktif, dan anon ditolak `42501`.

Tidak ada create/count/submit/post/cancel pada fase ini. Suite mutasi 5D
(`npm run test:hosted:inventory`) dan E2E menulis fixture serta memposting saldo
awal pada produk `TEST-OPN-*`; keduanya **ditunda** sampai owner memberi
otorisasi tertulis terpisah, karena bertentangan dengan larangan posting pada
§13 spesifikasi 5E.1. Produk impor tetap tidak disentuh oleh suite itu.

## 7. Audit ulang fixture dan dry-run pengarsipan

Audit ulang read-only (4 November 2026 09:48 UTC) mengembalikan angka yang sama:
**A=0, B=13, C=3, D=32**, 8 aktif, 40 nonaktif. Tidak ada produk baru, tidak ada
perubahan stok, dan tidak ada referensi baru.

Metode: RPC owner `public.upsert_product`, bukan `UPDATE` langsung. RPC ini
owner-only, menulis audit `product.update`, dan **tidak menyentuh**
`stock_on_hand` maupun `stock_version` (kolom yang di-update hanya master
produk + `is_active`). Payload memakai nilai master yang sekarang, jadi tidak
ada field yang berubah selain `is_active`.

Payload dry-run (8 baris, belum dieksekusi):

```json
{"product_id":"164b53c4-3ed5-4aa4-8c3c-8c499a5b9a4a","sku":"HOST-MVYL2SIG","name":"Hosted Smoke mvyl2sig Updated","unit_id":1,"category_id":1,"sale_price":13000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"fb51c404-94bc-41c5-b493-1fcf671dc510","sku":"HOST-MVYLDP3O","name":"Hosted Smoke mvyldp3o Updated","unit_id":1,"category_id":2,"sale_price":13000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"62e354e3-751f-44c1-adb6-1cd5d5edeaa5","sku":"HOST-MVYM9JCA","name":"Hosted Smoke mvym9jca Updated","unit_id":1,"category_id":3,"sale_price":13000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"15c19a2e-64dd-41c7-b2b7-1f004eb73dbb","sku":"HOST-MVYMF06P","name":"Hosted Smoke mvymf06p Updated","unit_id":1,"category_id":5,"sale_price":13000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"eb74882c-13c8-45ef-ab62-57635182cf38","sku":"HOST-MVYMVR42","name":"Hosted Smoke mvymvr42 Updated","unit_id":1,"category_id":7,"sale_price":13000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"a1000000-0000-4000-8000-000000000002","sku":"TEST-TXN-IDEMPOTENCY-001","name":"TEST Idempotency Produk","unit_id":1,"category_id":null,"sale_price":15000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"a1000000-0000-4000-8000-000000000003","sku":"TEST-TXN-PAY-001","name":"TEST Payment Produk","unit_id":1,"category_id":null,"sale_price":10000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
{"product_id":"a1000000-0000-4000-8000-000000000001","sku":"TEST-TXN-RACE-001","name":"TEST Race Produk","unit_id":1,"category_id":null,"sale_price":10000,"low_stock_threshold":null,"import_review_status":"verified","is_active":false}
```

Dampak yang diperkirakan:

| Objek | Sebelum | Sesudah | Catatan |
| --- | --- | --- | --- |
| Produk aktif | 8 | 0 | Katalog operasional bersih |
| `stock_on_hand` / `stock_version` | 8 nilai | **tidak berubah** | RPC tidak menulis kolom stok |
| `stock_movements` | 104 | 104 | Tidak disentuh |
| `transaction_items` | 39 | 39 | Tidak disentuh |
| `payments` | 39 | 39 | Tidak disentuh |
| `stock_opname_items` | 80 | 80 | Tidak disentuh |
| `stock_discrepancy_logs` | 13 | 13 | Tidak disentuh |
| `audit_logs` | 92 | 92 + 8 | `product.update` dari RPC |
| `product_costs` | 5 | 5 | Tidak disentuh |
| Produk impor `NULL` | 1.361 | 1.361 | Tidak disentuh |

Yang tidak dilakukan: `DELETE`, `CASCADE`, mengubah stok, menghapus movement,
transaksi, pembayaran, opname posted, log selisih, atau audit.

## 8. Staf inventaris kedua

Belum ada. Dari 5 profil, hanya `a3333333-3333-4333-8333-333333333333` yang
berperan `inventory_staff`. Instruksi owner ada di `docs/17-users-audit.md` §
“Menambah staf inventaris kedua”; ringkasnya: buat Auth user di dashboard,
biarkan trigger membuat profil `cashier` aktif, login sekali, lalu owner
mengubah peran ke `inventory_staff` di `/users`. Tidak ada kredensial karangan,
tidak ada sign-up publik, dan peran tidak pernah dibaca dari `user_metadata`.

Kesiapan dua orang **belum** boleh diklaim sampai akun itu ada dan terverifikasi.

## 9. Integritas stok

- 1.361 produk impor tetap `stock_on_hand = NULL` dan `stock_version = 0`.
- 13 fixture berstok `NULL` adalah bagian dari 48 fixture, bukan produk impor.
- Tidak ada `opening_balance` movement baru dan tidak ada `post_stock_opname`.
- Pengarsipan hanya mengubah `is_active`; angka stok tetap.

## 10. Status dan blocker

| Item | Status |
| --- | --- |
| Review tiga migrasi | selesai |
| Preview target terverifikasi | selesai (`ptbllrugrjepdhhdkzxn`) |
| Dry-run tepat tiga migrasi | selesai |
| Deployment 23/23 | **menunggu gate 1** |
| Validasi RPC hosted | menunggu deployment |
| Audit ulang fixture | selesai — 8 identitas sama |
| Pengarsipan 8 fixture | **menunggu gate 2** |
| Staf B | menunggu owner membuat akun |
| Suite mutasi 5D / E2E | menunggu otorisasi tertulis terpisah |
| Produksi | tidak disentuh |

## 11. Tugas berikutnya

1. Terapkan 0021–0023 setelah gate 1, verifikasi 23/23, regenerasi tipe dari
   remote, dan jalankan validasi read-only §6.
2. Setelah gate 2, jalankan 8 payload arsip, verifikasi `is_active=false` dan
   stok tidak berubah, lalu audit ulang.
3. Owner membuat `INVENTORY_STAFF_B` dan memverifikasi aksesnya.
4. Baru setelah itu Phase 5F — stok opname fisik nyata.
