# 21 — Kesiapan Hosted Phase 5E.1

Status per 4 November 2026: **tiga migrasi Phase 5E sudah diterapkan ke preview
(23/23) dan regresi read-only 11/11 lulus. Pengarsipan delapan fixture masih
menunggu gate terpisah; staf B belum ada.**

Gate yang masih terbuka:

1. `APPROVE ARCHIVE 8 ACTIVE PREVIEW FIXTURES`

Gate migrasi sudah dijalankan dengan frasa persis
`APPROVE PHASE 5E MIGRATIONS TO PREVIEW`. Persetujuan itu tidak mencakup
pengarsipan fixture.

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
| Branch / commit | `main` / `94be3bd` (induk 5E.1); perubahan 5E.1 di-commit setelah audit |
| Working tree | bersih sebelum audit; hanya file `.tmp/` yang gitignored |
| Supabase CLI | `npx supabase` **2.122.0** (global tidak ada di PATH) |
| Project linked | `ptbllrugrjepdhhdkzxn` — *Toko Sinar Soleha*, org `veqlhnjvckdsflpoefsu`, Singapore |
| Migrasi remote | **23/23** (termasuk 0021–0023) |
| Migrasi lokal | **23** |
| Dry-run sebelum push | tepat tiga migrasi 5E |
| Probe RPC 5E | ringkasan + paginasi berhasil; konteks menolak input kosong dengan `22023` |

Tidak ada migrasi tertunda. Bukti penerapan ada di §5.

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
- Tipe yang di-commit digenerate dari remote dengan
  `npx supabase gen types typescript --linked`; `npm run gen:types` (PGlite,
  seluruh 23 migrasi) memvalidasi schema yang sama, meski format keluarannya
  berbeda. Signature RPC dan tipe JSON cocok.

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
| RPC 5E | tersedia; ringkasan/paginasi berhasil, konteks menolak input kosong dengan `22023` |

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

## 5. Deployment (sudah dijalankan)

Approval diterima dengan frasa persis, lalu urutan ini dijalankan:

```bash
npx supabase migration list --linked          # 20 remote, 3 tertunda
npx supabase db push --dry-run --linked       # tepat 0021–0023
npx supabase db push --linked --yes           # exit 0
npx supabase migration list --linked          # 23/23
npx supabase gen types typescript --linked --schema public > types/database.generated.ts
npm run typecheck
```

Hasil 4 November 2026:

| Langkah | Hasil |
| --- | --- |
| `db push --linked` | tiga migrasi applied, exit 0 |
| `migration list --linked` | **23/23** |
| Tipe remote | 49.112 byte; typecheck, 275 unit, build 14,0 detik lulus |
| Probe RPC | summary/list OK; context `22023` untuk item null |

Perubahan schema: **tiga fungsi baru**, tanpa tabel/kolom/constraint/policy.
Tidak ada backfill dan tidak ada lock tabel jangka panjang.

Risiko: rendah. `CREATE OR REPLACE FUNCTION` hanya mengganti fungsi yang belum
ada (dibuktikan probe `PGRST202` sebelum penerapan). Grant hanya pada tiga fungsi tersebut.

Rollback:

- Fungsi bersifat aditif; aplikasi lama tidak memanggilnya.
- Bila perlu mundur, buat migrasi maju baru yang `DROP FUNCTION` ketiganya.
- Jangan memakai `migration repair` otomatis; riwayat remote adalah bukti.
- Tidak ada data yang perlu dipulihkan karena migrasi tidak menulis baris.

## 6. Validasi hosted (read-only)

Suite baru `npm run test:hosted:opname` (`scripts/opname-hosted-readonly.mjs`)
memakai sesi `cancelled` yang sudah ada dan tidak menulis satu baris pun.
Hasil 4 November 2026: **11/11 lulus** pada `OP-20261104-0018` (1.361 item,
6 halaman @250).

| Pemeriksaan | Hasil |
| --- | --- |
| Ringkasan | 1.361 item, 1.361 pending, 1.361 opening balance, 1.361 blocker, `ready_for_submit=false` |
| Paginasi 50/100/250 | halaman pertama/tengah/terakhir lengkap, total tetap 1.361 |
| Jalan penuh | 1.361 item unik, urutan SKU naik, 6 halaman |
| Pencarian | berlaku seluruh sesi; semua baris cocok |
| Filter | pending/recount/difference sama dengan counter ringkasan |
| Konteks | snapshot + stok/versi terkini; item `needs_recount` juga benar |
| Otorisasi | owner + inventory_staff boleh; kasir, nonaktif, anon `42501` |
| Tanpa tulis | jumlah sesi/item/movement tidak berubah |

Tidak ada create/count/submit/post/cancel pada fase ini. Suite mutasi 5D
(`npm run test:hosted:inventory`) dan E2E menulis fixture serta memposting saldo
awal pada produk `TEST-OPN-*`; keduanya **ditunda** sampai owner memberi
otorisasi tertulis terpisah, karena bertentangan dengan larangan posting pada
§13 spesifikasi 5E.1. Produk impor tetap tidak disentuh oleh suite itu.

## 7. Audit ulang fixture dan dry-run pengarsipan

Audit ulang read-only (4 November 2026 09:48 UTC) mengembalikan angka yang sama:
**A=0, B=13, C=3, D=32**, 8 aktif, 40 nonaktif. Tidak ada produk baru, tidak ada
perubahan stok, dan tidak ada referensi baru. Migrasi 0021–0023 sudah diterapkan;
audit ini dan pengarsipan tidak berubah karenanya.

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
| Deployment 23/23 | **selesai** — 4 November 2026 |
| Validasi RPC hosted | **selesai** — 11/11 read-only |
| Tipe remote | diregenerasi dari `--linked`; typecheck/test/build lulus |
| Audit ulang fixture | selesai — 8 identitas sama |
| Pengarsipan 8 fixture | **menunggu gate 2** |
| Staf B | menunggu owner membuat akun |
| Suite mutasi 5D / E2E | menunggu otorisasi tertulis terpisah |
| Produksi | tidak disentuh |

## 11. Tugas berikutnya

1. Migrasi sudah diterapkan dan tervalidasi; pertahankan 23/23 dan ulangi
   regresi read-only setelah setiap perubahan schema.
2. Setelah gate 2, jalankan 8 payload arsip, verifikasi `is_active=false` dan
   stok tidak berubah, lalu audit ulang.
3. Owner membuat `INVENTORY_STAFF_B` dan memverifikasi aksesnya.
4. Baru setelah itu Phase 5F — stok opname fisik nyata.
