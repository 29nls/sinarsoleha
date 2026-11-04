# Phase 5A — Inventory Engine (Stock Opname & Saldo Awal)

Dokumen ini menjelaskan backend inventaris yang ditambahkan pada Phase 5A:
siklus opname, saldo awal, log selisih, penanganan konflik versi, dan batas
keamanannya. Semua perubahan stok terjadi di PostgreSQL; klien tidak pernah
menulis `products.stock_on_hand`.

- Migrasi: `supabase/migrations/20261104100000_stock_opname_engine.sql`
- Tes: `scripts/db-test.mjs` (grup A–H), `npm run test:db`
- Status: **lokal lulus 94/94; terpasang di preview (20/20 migrasi); divalidasi hosted + E2E browser pada Phase 5D**

## 1. Prinsip arsitektur

| Prinsip | Implementasi |
| --- | --- |
| Tidak ada tabel baru | Memakai `stock_opnames`, `stock_opname_items`, `stock_movements`, `stock_discrepancy_logs` yang sudah ada |
| Wrapper publik tipis | Enam `public.*` `SECURITY DEFINER` hanya memanggil `private.*` |
| Logika di `private` | `SECURITY DEFINER`, `SET search_path = ''`, seluruh nama tabel terkuantifikasi |
| Otorisasi di database | `private.require_active_role(...)` membaca `auth.uid()` + `profiles.is_active`; `user_metadata` tidak dipercaya |
| Ledger append-only | Trigger lama tetap menolak `UPDATE`/`DELETE` pada movement dan log selisih |
| Stok hanya berubah saat posting | Create/count/submit/approve/cancel tidak menyentuh stok maupun ledger |
| Atomik | Satu transaksi per RPC; gagal = rollback penuh |
| Idempoten | Create memakai `creation_key`; post mengembalikan hasil lama bila sudah `posted` |

Alur status sesi:

```
counting ──submit──▶ submitted ──approve──▶ approved ──post──▶ posted
   │                    │                     │
   │                    └──cancel──┐          └──cancel──┐
   └──cancel──────────────────────┴──────────────────────▶ cancelled
                                    approved ──konflik──▶ counting
```

Transisi `approved → counting` dipakai khusus untuk konflik versi dan sudah
diizinkan trigger `guard_opname_status_transition` yang lama.

## 2. Matriks izin

| Operasi | Owner | Inventory staff | Kasir | Nonaktif / anon |
| --- | --- | --- | --- | --- |
| `create_stock_opname` | ya | ya | tidak | tidak |
| `record_stock_opname_count` | ya | ya | tidak | tidak |
| `submit_stock_opname` | ya | ya | tidak | tidak |
| `approve_stock_opname` | ya | **tidak** | tidak | tidak |
| `post_stock_opname` | ya | **tidak** | tidak | tidak |
| `cancel_stock_opname` | ya | tidak | tidak | tidak |
| Baca sesi & item (RLS) | ya | ya | tidak | tidak |
| Baca movement & log selisih | ya | ya | tidak | tidak |

`GRANT EXECUTE` hanya untuk role `authenticated`; `PUBLIC` dan `anon` dicabut.
Penolakan terjadi di dalam fungsi (`42501`), jadi klien tanpa sesi tetap gagal
meski memanggil RPC secara langsung.

## 3. Create — `public.create_stock_opname(p_payload jsonb)`

Payload:

```json
{
  "idempotency_key": "uuid (opsional)",
  "scope_note": "Opname akhir bulan (opsional, ≤500 karakter)",
  "product_ids": ["uuid", "..."],
  "category_id": 12,
  "exclude_product_ids": ["uuid", "..."]
}
```

- Tanpa `product_ids`/`category_id` → seluruh katalog, **termasuk produk
  nonaktif** (bisa masih menyimpan stok fisik).
- `exclude_product_ids` adalah satu-satunya cara mengeluarkan produk, dipakai
  untuk fixture `TEST-TXN-*`. Tidak ada heuristik prefiks SKU.
- Snapshot dibuat dengan satu `INSERT ... SELECT` di server:
  `system_qty_snapshot = products.stock_on_hand` (NULL dipertahankan),
  `stock_version_snapshot = products.stock_version`.
- Nomor sesi dari `private.next_document_number('opname', current_date)` →
  `OP-YYYYMMDD-NNNN`.
- Status awal `counting`; `stock_on_hand` tidak berubah.
- `creation_key` unik: retry dengan kunci sama mengembalikan sesi lama dengan
  `already_processed = true`, bukan sesi kedua.
- Cakupan kosong ditolak (`OPNAME_EMPTY`).

Karena produk dikirim sebagai daftar id (bukan snapshot), browser tidak pernah
mengirim 1.360 baris.

## 4. Count — `public.record_stock_opname_count(...)`

```
(p_stock_opname_item_id uuid, p_physical_qty numeric, p_reason_code text, p_reason_note text)
```

Validasi:

| Kondisi | Aturan |
| --- | --- |
| Sesi | harus `counting`; item `posted` ditolak |
| Kuantitas | wajib, tidak negatif |
| Presisi | `round(qty, units_of_measure.decimal_scale)` harus sama dengan input; PCS = 0 desimal, METER = 3 |
| Stok sistem NULL | `reason_code` **wajib** `opening_balance`, `reason_note` **wajib**; qty 0 sah |
| Stok sistem diketahui & qty sama | tanpa alasan; alasan yang dikirim dibersihkan |
| Stok sistem diketahui & qty beda | `reason_code` wajib, `opening_balance` ditolak, `other` wajib catatan |
| Aktor | `counted_by = auth.uid()`, `counted_at = now()` |

Recount diperbolehkan selama sesi `counting` (termasuk setelah konflik versi).
Counting tidak menulis movement, log selisih, atau perubahan stok — diuji di C3.

## 5. Submit & approve

`submit_stock_opname` (owner/staff) menolak sesi yang belum lengkap:
`pending`, `needs_recount`, `physical_qty` kosong, alasan/catatan yang masih
kurang. Daftar masalah dikembalikan di `DETAIL` sebagai JSON
(`item_id`, `product_id`, `sku`, `count_status`). Sukses → `submitted_at`,
status `submitted`, audit `opname.submit`.

`approve_stock_opname` (owner saja) mengulang pemeriksaan kelengkapan yang sama,
lalu menulis `approved_by/at` dan audit `opname.approve`. Approval **tidak**
mengubah stok dan tidak membuat movement — diuji di D3.

## 6. Post — `public.post_stock_opname(p_opname_id uuid)`

Urutan operasi dalam satu transaksi:

1. `require_active_role(['owner'])`; sesi harus `approved`.
2. Kunci baris `stock_opnames` (`FOR UPDATE`).
3. Kunci semua produk terdampak **urut `product_id`** — hanya di dalam transaksi
   posting, tidak pernah selama masa penghitungan.
4. Bandingkan `products.stock_version` dengan `stock_version_snapshot`.
5. Bila semua cocok: validasi kelengkapan, lalu untuk setiap item urut
   `product_id` tulis movement, log selisih, update stok/versi, tandai item
   `posted`; terakhir status sesi `posted` + audit `opname.post`.
6. Kembalikan ringkasan: `item_count`, `unchanged_count`,
   `opening_balance_count`, `discrepancy_count`, `delta_total`.

Tidak ada posting sebagian: setiap kegagalan melempar exception dan seluruh
transaksi dibatalkan. Retry pada sesi `posted` mengembalikan
`already_processed = true` tanpa menulis apa pun (E6: satu movement, satu audit).

### Saldo awal (`system_qty_snapshot IS NULL`)

| Kolom | Nilai |
| --- | --- |
| `movement_type` | `opening_balance` |
| `quantity_before` | `NULL` (stok sebelumnya memang tidak diketahui) |
| `quantity_delta` | `physical_qty` |
| `quantity_after` | `physical_qty` |
| `reason_code` | `opening_balance` |
| `stock_discrepancy_logs` | **tidak dibuat** (`system_qty` NOT NULL) |

`products.stock_on_hand` diisi `physical_qty` dan `stock_version + 1`.

### Saldo awal nol

Constraint lama `stock_movements_delta_nonzero` menolak `quantity_delta = 0`.
Migrasi ini menggantinya dengan aturan yang longgar **hanya** untuk:

```
movement_type = 'opening_balance'
and quantity_before is null
and quantity_after = 0
and quantity_delta = 0
and reason_code = 'opening_balance'
```

Semua movement lain tetap menolak delta 0 (diuji di E5, termasuk percobaan
menyamar sebagai `manual_adjustment` dengan `quantity_before NULL`).

### Stok diketahui

```
difference = physical_qty - system_qty_snapshot
```

- `difference = 0` → tidak ada movement, tidak ada log; item tetap `posted`.
- `difference ≠ 0` → movement `opname_adjustment` (`quantity_before` = snapshot,
  `quantity_after` = physical) + satu baris `stock_discrepancy_logs` dengan
  `revision` berikutnya, `system_qty`, `physical_qty`, `difference_qty`,
  `reason_code`, `reason_note`, `created_by` (= penghitung), `approved_by`
  (= owner yang memposting), `created_at` = waktu posting.

Karena `physical_qty ≥ 0`, adjustment tidak pernah menghasilkan stok negatif.

## 7. Konflik versi

Skenario: kasir menjual produk setelah snapshot dibuat.

- Produk dengan `stock_version` berbeda dikumpulkan menjadi array `conflicts`:
  `item_id`, `product_id`, `sku`, `snapshot_version`, `current_version`,
  `snapshot_qty`, `current_qty`.
- Item tersebut ditandai `needs_recount`; sesi kembali ke `counting`;
  `approved_by`/`approved_at` dibersihkan; audit `opname.post_conflict`.
- Fungsi **mengembalikan** `{ "result": "version_conflict", "conflicts": [...] }`
  alih-alih melempar exception. Ini penting: exception akan me-rollback penanda
  `needs_recount`, sehingga status konflik tidak akan pernah tersimpan.
- Tidak ada stok yang ditimpa, tidak ada movement/log stale, dan item lain yang
  tidak berkonflik **tidak** ikut diposting (F1 memverifikasi keduanya).
- Setelah recount, sesi dapat di-submit dan di-approve ulang (F2).

**Perbaikan 0020 — rebase snapshot saat recount.** Sebelum
`20261106130000_opname_recount_rebase.sql`, `stock_version_snapshot` tidak pernah
di-refresh: posting ulang selalu melihat versi lama dan mengembalikan
`version_conflict` lagi tanpa akhir. Sekarang `record_stock_opname_count` membaca
ulang `products.stock_on_hand` dan `stock_version` ketika item berstatus
`needs_recount`, lalu menulis kedua snapshot itu bersama hasil hitung. Selisih
dihitung terhadap stok sistem terbaru, sehingga `quantity_before` pada movement
tidak pernah memakai angka pra-penjualan (tidak ada drift ledger). Tes F3
mengunci kasus 30 → jual 5 → 25 → recount 24: movement `-1`, `before = 25`,
ledger berakhir di 24, satu log selisih dengan `system_qty = 25`.

## 8. Cancel — `public.cancel_stock_opname(p_opname_id, p_reason)`

Owner saja, alasan wajib (≤500 karakter). Sesi `posted` tidak dapat dibatalkan;
`cancelled` bersifat final dan tidak dapat dibuka kembali. Menulis
`cancelled_by/at/reason` + audit `opname.cancel`; stok tidak berubah. Retry pada
sesi yang sudah `cancelled` mengembalikan `already_processed = true`.

Catatan migrasi: constraint lama `stock_opnames_submitted_consistency` hanya
mengecualikan `draft`/`counting`, sehingga sesi `counting` yang dibatalkan
melanggar constraint. Migrasi melonggarkannya untuk `cancelled`; status lain
tetap wajib punya `submitted_at`.

## 9. Integritas ledger & riwayat

- `stock_movements` dan `stock_discrepancy_logs` tetap immutable (trigger
  `block_stock_ledger_mutation`); diuji di G1 untuk `UPDATE` dan `DELETE`.
- Sesi `posted`/`cancelled` tidak dapat diubah; item opname pada sesi tersebut
  juga tidak dapat diubah (trigger lama, diuji G1/G2).
- Log selisih memakai `revision` berurutan per item; histori tidak pernah
  ditimpa. Recount sebelum posting hanya mengubah `physical_qty` item, dan log
  dibuat sekali saat posting dengan nilai final.
- Idempotency movement diturunkan deterministik dari `opname_id` + tipe +
  `product_id` (`md5(...)::uuid`), sehingga retry tidak dapat menggandakan baris.

## 10. Hasil tes lokal

`npm run test:db` — **94/94 lulus** (42 tes Phase 1–4 + 52 tes Phase 5A/5D):

| Grup | Tes |
| --- | --- |
| A — otorisasi | anon, nonaktif, kasir, tanpa profil ditolak; staff boleh create/count; staff tidak boleh approve/post/cancel |
| B — sesi | snapshot penuh, scope terpilih, kategori, exclusion, NULL/versi, produk nonaktif, retry-safe, transisi ilegal |
| C — count | qty negatif, presisi, alasan wajib, `other` wajib catatan, opening balance wajib alasan+catatan, qty 0, aktor tercatat, recount |
| D — approval | submit tidak lengkap, `needs_recount`, approval tanpa mengubah stok |
| E — posting | kenaikan, penurunan, no-change, opening positif, opening nol, delta 0 ditolak untuk tipe lain, idempotensi + satu audit |
| F — konflik | dua sesi (opname + penjualan), penanda konflik tersimpan, tidak ada posting sebagian, dan recount yang me-rebase snapshot lalu berhasil diposting tanpa drift |
| G — immutability | sesi posted/cancelled final, movement & log tidak dapat diubah/dihapus, update stok langsung ditolak |
| H — skala & replay | snapshot 1.406 produk dalam satu statement (168 ms), replay submit/approve idempoten tanpa duplikasi audit |

Perintah lain: `npm test` 257/257, `npm run typecheck` exit 0, `npm run build` exit 0.

Validasi hosted Phase 5D (preview): 24/24 tes API dan 17/17 skenario browser —
lihat `docs/19-inventory-hosted-validation.md`. Catatan yang muncul dari fase itu:
pembacaan detail opname masih dibatasi 1.000 baris oleh PostgREST, sehingga sesi
seluruh katalog hanya menampilkan sebagian item di UI meski snapshot database
lengkap.

Tes memakai produk sintetis `OPN-*` dan fixture `TEST-TXN-*`; **tidak ada**
stok 1.360 produk impor yang diubah dan tidak ada saldo awal nyata yang
diposting.

## 11. Kesiapan hosted & risiko tersisa

Siap secara SQL: migrasi additive, tidak ada `DROP TABLE`, hanya tiga
`ALTER TABLE ... DROP CONSTRAINT` yang langsung diganti constraint lebih longgar
plus satu kolom baru `creation_key` (nullable, unique).

Sebelum apply ke preview:

1. `npx supabase projects list` / `supabase status` untuk memastikan link ke
   `ptbllrugrjepdhhdkzxn` (bukan produksi).
2. `npx supabase migration list` untuk membandingkan riwayat remote.
3. `npx supabase db push --dry-run` lalu review SQL.
4. Terapkan hanya setelah approval eksplisit.

Risiko/pekerjaan terbuka:

- `adjust_stock` selesai di Phase 11 (migrasi `20261106100000_stock_adjustment.sql`):
  hanya `owner`/`inventory_staff`, alasan wajib, catatan wajib, presisi mengikuti
  satuan, hasil negatif ditolak, ledger + audit + idempotensi. Belum diterapkan
  ke preview saat catatan ini ditulis.
- Koreksi manual **tidak** dapat dipakai untuk produk berstok NULL; jalurnya tetap
  opname saldo awal.
- Keputusan bisnis: siapa boleh membatalkan draf milik staff, apakah staff boleh
  melihat seluruh sesi atau hanya miliknya, dan kebijakan recount berulang.
- Konkurensi multi-sesi nyata sudah diuji di hosted (Phase 5D): dua klien owner
  memposting sesi yang sama secara bersamaan menghasilkan tepat satu posting dan
  satu audit, dengan permintaan yang benar-benar tumpang tindih. Jaminan tetap
  berasal dari `FOR UPDATE` + perbandingan versi.
