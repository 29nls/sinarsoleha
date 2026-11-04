# 24 — Runbook Cutover Produksi

Status per 4 November 2026: **draf, belum dijalankan.** Tidak ada project
produksi, tidak ada migrasi ke produksi, dan tidak ada kredensial produksi di
mesin ini. Dokumen ini disiapkan supaya hari-H tidak berisi keputusan yang
belum diambil. Empat keputusan owner sudah masuk (lihat `docs/23` §6.1): backup
paket berbayar, latihan opname kecil di preview dulu, kata sandi lewat
dashboard, isi nota tidak berubah.

Prasyarat Tahap A sudah lunas: latihan opname kecil di preview selesai 4 November
2026, termasuk konflik versi yang dipicu sengaja (`docs/22` §11). Yang belum ada
hanya project produksi dan keputusan D1a.

Pendamping: `docs/23` §5 (tahap D), `docs/22` (opname), `docs/16` §5 (UAT),
`docs/17` (akun), `docs/03` §3 (bootstrap owner).

## 0. Aturan yang berlaku sepanjang dokumen ini

- **Produksi bukan salinan preview.** Database produksi lahir kosong, menerima
  23 migrasi, lalu diisi dari impor master + hitungan fisik. Tidak ada
  `pg_dump`/`restore` dari preview ke produksi, dan tidak ada penyalinan saldo.
- **Tidak ada `DELETE`/`CASCADE`.** Offboarding staf = `is_active = false`.
  `audit_logs` bersifat append-only lewat trigger; `stock_movements` juga.
- **Tidak ada `service_role` di klien, di `.env` Vercel, atau di repo.** Hanya
  `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (prefix `sb_publishable_`).
- **`stock_on_hand` tidak pernah ditulis lewat SQL.** Satu-satunya jalur adalah
  RPC opname. Ini tetap berlaku di produksi, termasuk saat mengisi saldo awal.
- **Jangan `supabase config push` penuh.** `supabase/config.toml` memuat
  `site_url = "http://127.0.0.1:3000"`; push penuh akan menimpa `site_url`
  produksi ke localhost dan mematikan login. Ubah hanya properti yang
  dimaksud, lewat dashboard atau config minimal (lihat §4).
- Setiap langkah di bawah punya **kriteria lulus** yang harus dibuktikan
  dengan keluaran perintah, bukan dengan ingatan.

## 1. Urutan D1–D6

Kolom "Pemilik" memisahkan apa yang hanya bisa dilakukan owner (biaya, akun,
tanda tangan) dari apa yang bisa divalidasi agen.

| # | Langkah | Pemilik | Perintah / tempat | Kriteria lulus |
| --- | --- | --- | --- | --- |
| D1 | Buat project Supabase produksi terpisah | **Owner** | dashboard Supabase → New project, region **Southeast Asia (Singapore)** sama dengan preview | project ref baru (20 huruf kecil), org sama, region sama |
| D1a | Backup produksi: **paket berbayar (dipilih 4 Nov 2026)** | **Owner** | lihat §5 | pilihan tertulis sudah ada; satu restore ke project uji masih harus dibuktikan |
| D1b | Konfigurasi Vercel produksi | Teknis | lihat §4 | login produksi mendarat di domain produksi, bukan `127.0.0.1`/preview |
| D2 | Terapkan 23 migrasi | Teknis | `npx supabase link --project-ref <ref-prod>` lalu `npx supabase db push` | `npx supabase migration list --linked` → 23/23 di kolom remote |
| D3 | Buat akun owner produksi + tutup signup | **Owner** | dashboard → Authentication → Users → Add user; lihat §3 | 1 owner aktif, `activated_at` terisi, `POST /auth/v1/signup` → `422 signup_disabled` |
| D3a | Pastikan produksi mulai dari database kosong | Teknis | query §6.2 | 0 akun `phase*`, 0 `TEST-*`/`HOST-*`, `audit_logs` hanya aksi produksi |
| D4 | Impor master 1.361 produk | Teknis + Owner | `node scripts/product-import.mjs --dry-run` lalu `--apply` (lihat §6.3) | 1.360 `imported` + 1 `review` + 0 `rejected`; review diselesaikan owner → 1.361 produk, semua `stock_on_hand NULL` |
| D5 | Hitung fisik + isi saldo awal | Staf gudang + Owner | `docs/22` §5, diulang di produksi | 0 produk aktif berstok `NULL`; movement `opening_balance` = jumlah produk terisi |
| D6 | UAT produksi + latih kasir | **Owner** | `docs/16` §5 | checklist ditandatangani; batasan `docs/16` §6 disetujui |

Urutan ini **tidak boleh** ditukar. D4 sebelum D5 karena saldo awal butuh
`product_id` yang sudah ada. D3 sebelum D4 karena impor menulis `audit_logs`
dan butuh pelaku owner. D2 sebelum D3 karena trigger
`private.handle_new_auth_user` baru ada setelah migrasi.

### 1.1 Perkiraan waktu

| Blok | Perkiraan | Catatan |
| --- | --- | --- |
| D1, D1a, D1b | 1–2 jam | menunggu provisioning project + keputusan biaya |
| D2 | 15 menit | 23 migrasi, satu perintah |
| D3, D3a, D4 | 1 jam | impor 1.361 baris + verifikasi |
| D5 | **3–5 hari kerja** | 2 orang, 150–250 SKU/jam/orang |
| D6 | 2–3 jam | UAT + latihan kasir |

D5 adalah satu-satunya blok yang tidak bisa dipercepat perangkat lunak.

## 2. D1 — Membuat project produksi

Dikerjakan owner di dashboard. Agen tidak membuat project dan tidak menyentuh
kredensial.

1. Dashboard Supabase → **New project**. Pilih organisasi yang sama dengan
   preview (`veqlhnjvckdsflpoefsu`) supaya penagihan dan akses tetap satu tempat.
2. Region **Southeast Asia (Singapore)** — sama dengan preview, supaya latensi
   kasir tidak berubah dan `pg_dump`/restore antar project tidak melintasi
   region.
3. Simpan **database password** di pengelola kata sandi. Jangan pernah
   menempelkannya ke chat, dokumen ini, atau file repo.
4. Catat **project ref** (20 huruf kecil) dan **URL** (`https://<ref>.supabase.co`).
5. Ambil **publishable key** dari Project Settings → API Keys. Yang dipakai
   hanya kunci berprefix `sb_publishable_` (atau `anon` legacy). Kunci
   `service_role`/`secret` **tidak** diambil, tidak disimpan, dan tidak dipakai
   di mana pun.

Catatan biaya: paket ditentukan di **tingkat organisasi**, bukan per project —
organisasi yang sudah berbayar otomatis memberi backup harian dan bebas jeda
pada semua project di dalamnya. Karena Pilihan A di §5.2 sudah dipilih, biayanya
menambah project kedua (~$10/bulan di luar kredit compute), bukan menggandakan
paket Pro.

Kriteria lulus: `npx supabase projects list` menampilkan dua project — preview
dan produksi — dengan region yang sama.

## 3. D3 — Akun owner pertama (jalur yang benar)

Ini bagian yang paling mudah salah. Trigger
`private.handle_new_auth_user` **selalu** membuat profil dengan
`role = 'cashier'` dan `is_active = false`. Tidak ada jalan membuat owner dari
dashboard saja, dan `admin_upsert_profile` tidak bisa dipakai karena RPC itu
mensyaratkan pemanggil sudah owner aktif.

### 3.1 Buat user di dashboard

1. Authentication → **Users** → **Add user**.
2. Isi email owner dan kata sandi awal yang kuat. Centang **Auto Confirm User**
   — project ini tidak punya server email, jadi akun yang belum terkonfirmasi
   akan ditolak saat login.
3. Simpan. Salin **UID** user tersebut (bukan emailnya).
4. Verifikasi trigger berjalan: baris `profiles` untuk UID itu ada, dengan
   `role = 'cashier'` dan `is_active = false`.

### 3.2 Angkat owner pertama lewat SQL sekali

Jalankan di **SQL Editor** dashboard produksi, sebagai pemilik project (bukan
dari aplikasi):

```sql
select private.bootstrap_owner('<UID-owner>');
```

Fungsi ini menolak bila sudah ada owner aktif (`OWNER_EXISTS`), mengisi
`role='owner'`, `is_active=true`, `activated_at=now()`, dan menulis audit
`profile.bootstrap_owner`. Fungsi ini **tidak** memberi EXECUTE ke `anon`
maupun `authenticated`, jadi tidak bisa dipanggil dari aplikasi.

Kriteria lulus:

```sql
select role, is_active, activated_at is not null as activated
  from public.profiles where id = '<UID-owner>';
-- owner | true | true
```

### 3.3 Staf berikutnya lewat aplikasi

Setelah owner pertama ada, semua akun lain dibuat dengan alur normal
(`docs/17` §Menambah staf):

1. Dashboard → Authentication → Users → **Add user** (Auto Confirm User).
2. Trigger membuat profil `cashier` / `is_active = false` secara otomatis.
3. Owner login ke aplikasi produksi → `/users` → pilih staf → set peran →
   aktifkan.

Langkah 3 memanggil `admin_upsert_profile`, yang mengisi `activated_at` dan
`activated_by` sesuai constraint `profiles_activated_at_consistency`. Staf
**tidak perlu** login dulu sebelum diaktifkan — akun nonaktif memang bisa login
(disengaja) tetapi seluruh RLS/RPC menolak operasinya.

Jangan mengubah `is_active` lewat SQL langsung: constraint akan menolak, atau
lebih buruk, `activated_at` tertinggal dan profil aktif tanpa jejak aktivasi.

### 3.4 Tutup pendaftaran publik

Di dashboard produksi: Authentication → **Providers → Email** → matikan
**Enable sign-ups**. Ini berbeda dari mematikan provider email — mematikan
provider akan membuat owner tidak bisa login (insiden 4 November, lihat
`docs/PROGRESS.md`).

Bukti yang harus disimpan:

```bash
curl -s -H "apikey: $SUPABASE_PUBLISHABLE_KEY" "$SUPABASE_URL/auth/v1/settings"
# harapan: "disable_signup":true, "external":{"email":true, ...}

curl -s -o /dev/null -w '%{http_code}\n' -X POST "$SUPABASE_URL/auth/v1/signup" \
  -H "apikey: $SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' \
  -d '{"email":"probe@example.invalid","password":"not-a-real-password"}'
# harapan: 422 (signup_disabled)
```

Dua pemeriksaan ini wajib keduanya: `disable_signup` membuktikan pendaftaran
tertutup, `external.email: true` membuktikan login email masih hidup.

> **Jebakan yang sudah terbukti di preview.** `supabase config diff` melaporkan
> `auth.email.enable_signup` remote masih `true` meski `disable_signup` sudah
> `true` — keduanya toggle berbeda. Jangan menyimpulkan "pendaftaran terbuka"
> dari `config diff`, dan jangan "memperbaiki"-nya dengan `config push` penuh:
> push itu juga menimpa `site_url` ke `http://127.0.0.1:3000`.

## 4. D1b — Vercel produksi

Aplikasi ini SPA (`ssr: false`), jadi seluruh konfigurasi Supabase masuk lewat
`runtimeConfig.public` yang dibaca dari environment saat build. Artinya **env
harus dipasang sebelum build**, bukan sesudah.

### 4.1 Environment variables

Di Vercel → Project → Settings → Environment Variables, untuk environment
**Production** (bukan Preview):

| Nama | Nilai | Catatan |
| --- | --- | --- |
| `SUPABASE_URL` | `https://<ref-produksi>.supabase.co` | **bukan** ref preview |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` milik project produksi | aman di bundle; bukan `service_role` |

Jangan menambahkan `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, atau
`NUXT_PUBLIC_*` apa pun. `scripts/audit-bundle.mjs` akan menangkap kebocoran
kunci, tetapi lebih baik tidak pernah ada.

Kriteria lulus: `npm run build` di mesin dengan env produksi, lalu
`npm run audit:bundle` → 0 temuan; dan bundle memuat host produksi, bukan host
preview.

### 4.2 URL Auth

Di dashboard Supabase produksi: Authentication → **URL Configuration**.

- **Site URL**: `https://<domain-produksi>` (harus `https`, tanpa trailing
  `/**`).
- **Redirect URLs**: `https://<domain-produksi>/**` dan, bila ada, domain
  `www` yang diarahkan ke domain utama.

Kriteria lulus: login di domain produksi kembali ke domain produksi. Kalau
`site_url` masih `http://127.0.0.1:3000` atau menunjuk preview, tautan reset
kata sandi akan mengarah ke localhost/preview dan login bisa gagal.

### 4.3 HSTS `includeSubDomains`

`nuxt.config.ts` sengaja memasang HSTS **tanpa** `includeSubDomains` karena host
preview berada di domain bersama `vercel.app`. Setelah domain produksi milik
toko sendiri terpasang dan seluruh subdomainnya memang HTTPS, opsi itu boleh
dinyalakan:

```ts
'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
```

Jangan dinyalakan selama masih di `*.vercel.app`: memaku subdomain di domain
milik orang lain bukan wewenang kita, dan `includeSubDomains` pada domain
bersama bisa merusak host lain.

Kriteria lulus: `tests/security-headers.test.ts` diperbarui dan lulus, header
yang keluar dari domain produksi memuat `includeSubDomains`, dan tidak ada
subdomain toko yang masih HTTP.

### 4.4 Jangan pakai `config push` penuh

`supabase/config.toml` berisi nilai lokal (`site_url = http://127.0.0.1:3000`,
`additional_redirect_urls` lokal, `db.pooler` default, `storage.vector`).
`supabase config push` menulis **semua** properti yang dideklarasikan, sehingga
satu perintah bisa mematikan login produksi. Ubah hanya properti yang
dimaksud lewat dashboard, atau pakai config minimal yang hanya memuat blok
`[auth]` dengan nilai produksi.

## 5. D1a — Keputusan backup (wajib sebelum D5)

**Keputusan owner, 4 November 2026: Pilihan A — paket berbayar dengan backup
harian otomatis.** Tidak ada dump logis terjadwal sebagai jalur utama. Pilihan
ini mengikat: D1 harus dibuat di organisasi yang sudah berbayar, dan D5 tidak
boleh dimulai sebelum satu restore ke project uji terbukti (§5.4).

Ini keputusan **biaya**, jadi milik owner. Agen hanya menyajikan pilihan dan
cara membuktikannya.

### 5.1 Fakta yang sudah diukur di mesin ini

| Fakta | Bukti |
| --- | --- |
| Preview tidak punya backup terkelola | `npx supabase backups list` → `WALG: true`, `PITR: false`, `EARLIEST: 0`, `LATEST: 0` |
| Backup harian hanya untuk paket berbayar | dokumentasi Supabase: backup harian untuk Pro/Team/Enterprise; paket gratis disarankan `db dump` sendiri |
| `supabase db dump` butuh Docker | tanpa Docker: `docker: command not found`, file output **0 byte**, **exit code 0** |
| Tidak ada `pg_dump`/`psql` di mesin ini | sehingga dump logis manual pun belum pernah berhasil di sini |
| Skema bisa dibangun ulang dari repo | `npm run db:replay` → 23/23 migrasi, 9/9 invarian, dijalankan CI |

**Kegagalan diam-diam adalah bahaya utamanya.** `db dump` tanpa Docker
menghasilkan file kosong dengan exit 0 — skrip cadangan yang "selalu sukses"
tetapi tidak pernah bisa direstore. Karena itu aturan berikut tidak bisa
ditawar:

> Setiap backup — otomatis maupun dump — wajib dibuktikan dengan satu restore
> ke project uji sebelum D5. Backup yang belum pernah direstore bukan backup;
> itu hanya file (atau baris di dashboard).

### 5.2 Pilihan A — paket berbayar (backup harian otomatis) — **DIPILIH**

- Backup harian otomatis, retensi 7 hari pada Pro (14 hari Team, 30 hari
  Enterprise). PITR adalah add-on terpisah dan butuh compute minimal Small;
  bila PITR dinyalakan, backup harian berhenti dan digantikan PITR.
- **Project tidak dijeda karena tidak aktif.** Dokumentasi Supabase: project
  pada paket berbayar tidak bisa dijeda dan tidak terkena jeda otomatis;
  paket gratis dijeda bila aktivitas database terlalu rendah selama 7 hari.
- Restore dilakukan dari dashboard (Database → Backups). **Project tidak bisa
  diakses selama restore**, jadi lakukan di luar jam buka toko.
- Backup harian **tidak** memuat objek Storage (hanya metadatanya). Untuk
  aplikasi ini tidak masalah karena tidak ada foto produk di Storage.

Cocok bila toko buta terhadap operasi database dan ingin satu tombol pulih.
Itu kondisi toko ini, jadi inilah yang dipilih owner.

### 5.3 Pilihan B — dump logis terjadwal (tanpa biaya paket) — tidak dipakai

Disimpan sebagai rujukan bila keputusan backup ditinjau ulang. Butuh mesin yang
punya Docker **atau** `pg_dump` versi yang cocok, plus penyimpanan di luar
project.

```bash
# Contoh: jalankan di mesin ber-Docker, JANGAN di mesin tanpa Docker.
npx supabase db dump --linked -f backup-$(date +%F).sql
[ -s "backup-$(date +%F).sql" ] || { echo "DUMP KOSONG - GAGAL"; exit 1; }
grep -c '^COPY ' "backup-$(date +%F).sql"   # harus > 0
```

Wajib: jadwalkan harian, simpan di luar project Supabase, rotasi, dan **uji
restore sebulan sekali** ke project uji. Tanpa uji restore, pilihan ini hanya
memberi rasa aman palsu.

### 5.4 Yang sudah diputuskan owner

1. **Pilihan A** — paket berbayar (Pro), backup harian otomatis 7 hari, project
   tidak dijeda karena sepi. Pilihan B (dump logis terjadwal) **tidak** dipakai.
2. Mesin dump tidak perlu disiapkan; tidak ada jadwal dump yang harus dijaga.
3. Biaya bulanan disetujui owner (paket per-organisasi; project kedua menambah
   biaya project, bukan menggandakan paket).

Yang **belum** selesai dan tetap wajib: satu restore ke project uji. Kriteria
lulus D1a: pilihan tertulis di `docs/PROGRESS.md` (sudah), **dan** satu restore
ke project uji berhasil dengan jumlah baris yang cocok. Tanpa itu, D5 belum
boleh dimulai — mengisi saldo hasil hitungan fisik ke database tanpa backup
terbukti berarti mengulang 3–5 hari kerja bila terjadi kegagalan.

### 5.5 Jebakan paket gratis

Selain tanpa backup, paket gratis **menjeda project yang aktivitas database-nya
terlalu rendah selama 7 hari**. Untuk toko yang tutup seminggu (libur Lebaran,
renovasi), project bisa dijeda dan aplikasi berhenti melayani sampai owner
membangunkan manual dari dashboard (masih bisa diresume sampai 1 tahun). Ini
bukan bug aplikasi; ini kebijakan hosting yang harus diketahui sebelum memilih
paket. Catatan: toko yang buka setiap hari biasanya menghasilkan cukup query
untuk tidak dijeda — risikonya terutama pada masa tutup panjang.

## 6. D2–D4 — Migrasi, verifikasi kosong, impor

### 6.1 D2 — Terapkan 23 migrasi

```bash
npx supabase link --project-ref <ref-produksi>
npx supabase db push --dry-run      # tinjau dulu: 23 migrasi, tanpa perubahan lain
npx supabase db push
npx supabase migration list --linked
```

Kriteria lulus: kolom remote menunjukkan 23 baris, dan kolom local = remote
untuk semuanya. Tidak boleh ada migrasi "local only" yang tertinggal.

Verifikasi tambahan (SQL Editor produksi):

```sql
select count(*) as tabel from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE';   -- 24
select count(*) as rls_off from pg_tables
 where schemaname = 'public' and not rowsecurity;               -- 0
select count(*) as produk from public.products;                  -- 0
select count(*) as profil from public.profiles;                  -- 0 (D3 belum dijalankan)
```

Urutan D2 lalu D3 penting: tabel `profiles` dan trigger baru ada setelah
migrasi, jadi user yang dibuat sebelum D2 tidak akan punya profil.

### 6.2 D3a — Bukti produksi mulai kosong

Dijalankan **setelah D3, sebelum D4**. Semua angka harus persis seperti ini;
selisih berarti database produksi bukan database baru.

```sql
-- 0: tidak ada artefak uji di master
select count(*) as artefak from public.products
 where sku ilike 'TEST-%' or sku ilike 'HOST-%';            -- 0

-- audit hanya berisi aksi produksi (bootstrap owner)
select action, count(*) from public.audit_logs group by action order by 1;
-- harapan: profile.bootstrap_owner = 1, tidak ada yang lain

-- tidak ada sesi/movement warisan preview
select count(*) as movements  from public.stock_movements;   -- 0
select count(*) as opnames    from public.stock_opnames;     -- 0
select count(*) as transaksi  from public.transactions;      -- 0
select count(*) as produk     from public.products;          -- 0
select count(*) as profil     from public.profiles;          -- 1 (hanya owner)
```

Catatan penting: `profiles` **tidak menyimpan email** (kolomnya hanya `id`,
`full_name`, `role`, `is_active`, `activated_at`, `activated_by`, timestamp).
Jadi pemeriksaan akun `phase*` tidak bisa lewat SQL; buka Authentication →
**Users** di dashboard produksi dan pastikan hanya ada akun yang dibuat pada
D3.

Kriteria lulus: seluruh angka di atas cocok, dan daftar user di dashboard hanya
berisi akun yang dibuat pada D3.

### 6.3 D4 — Impor 1.361 produk

Impor memakai skrip yang sama dengan preview, tetapi **menunjuk project
produksi**. Ada dua jebakan yang harus ditutup sebelum menjalankannya.

**Jebakan 1 — skrip membaca `.env` di root repo, bukan environment shell.**
`runApply()` memanggil `readFile('.env')`. Jadi `.env` harus sementara diarahkan
ke produksi, dan **wajib dikembalikan** sesudahnya:

```bash
cp .env .env.preview.bak          # simpan; jangan di-commit (sudah gitignored)
# sunting .env: SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY produksi
node scripts/product-import.mjs --dry-run      # tanpa Supabase call
node scripts/product-import.mjs --apply
cp .env.preview.bak .env && rm .env.preview.bak
```

**Jebakan 2 — akun owner.** `parseAccounts()` memakai
`PRODUCT_IMPORT_EMAIL`/`PRODUCT_IMPORT_PASSWORD` bila ada; kalau tidak, ia
membaca `.tmp/phase2b-accounts.json` yang berisi **akun preview**. Login akan
gagal (email tidak ada di produksi), tetapi lebih aman diset eksplisit:

```bash
export PRODUCT_IMPORT_EMAIL='owner@toko.example'
export PRODUCT_IMPORT_PASSWORD='…'   # jangan ditempel ke chat/log
```

Skrip juga menolak URL yang bukan `https://<ref>.supabase.co`, dan menolak bila
akun yang login bukan owner aktif — jadi salah project akan gagal keras, bukan
diam-diam menulis ke tempat lain.

Workbook default `.tmp/product-master.xlsx` (367.616 byte). Bila memakai file
lain, tambahkan `--workbook <path>`; dry-run mencetak sha256 sehingga bisa
dibuktikan workbook produksi = workbook preview.

Kriteria lulus tahap pertama (impor otomatis):

| Pemeriksaan | Harapan |
| --- | --- |
| Baris sumber | 1.361 |
| `imported` | **1.360** |
| `review` | **1** |
| `rejected` | 0 |
| `stock_on_hand` semua produk | `NULL` (impor tidak menyentuh stok) |
| `stock_movements` | tetap 0 |
| `audit_logs` aksi `product.import` | ada, dengan aktor owner produksi |

**Satu baris review itu normal, bukan kegagalan.** Di preview, `WAL-W1303`
(baris 1305, *Walpaper Dinding CSB-MGT-05-W*) tertahan karena harga jual 9.500
di bawah harga beli 20.000. Impor sengaja tidak memutuskan harga; owner yang
memutuskan.

### 6.4 Menyelesaikan baris review

Owner memutuskan harga, lalu baris itu diselesaikan lewat RPC owner-only
`public.resolve_product_import_review` (migrasi `20261106120000`). Di preview
harga jual dikoreksi menjadi 20.000 dan baris di-approve, sehingga totalnya
menjadi 1.361.

**RPC ini tidak bisa dipanggil dari SQL Editor.** Fungsinya memakai
`private.require_active_role` → `auth.uid()`, dan di SQL Editor `auth.uid()`
bernilai `NULL`, sehingga hasilnya `AUTH_REQUIRED`, bukan keberhasilan. Yang
benar adalah login sebagai owner lewat publishable key — sudah dibungkus di
`scripts/import-review-resolve.mjs` (`npm run import:review`):

```bash
# 1) lihat dulu baris review yang tersisa (read-only, tanpa argumen)
npm run import:review

# 2) setelah owner menyepakati harga, selesaikan barisnya.
#    Skrip ini juga mengimpor baris tersebut dan menutup run.
npm run import:review -- --run <uuid run impor produksi> --row 1305 \
  --action approve --sale-price 20000 --purchase-cost 9500 \
  --reason "Harga jual dikoreksi owner saat cutover produksi"
```

**Jangan menutup baris review dengan `product-import.mjs --apply`.** Skrip
impor selalu men-staging ulang seluruh workbook, dan
`stage_product_import_rows` menimpa baris yang `product_id`-nya masih `NULL`
(`where product_import_rows.product_id is null`). Akibatnya koreksi harga owner
kembali berubah menjadi `review` dan run tidak pernah selesai. Karena itu
`import-review-resolve.mjs` memanggil `import_product_import_row` untuk baris
itu sendiri, lalu `finish_product_import` bila tidak ada sisa baris `ready`.

Skrip memakai `.env` yang sama dengan impor, menolak URL selain
`https://<ref>.supabase.co`, dan menolak akun yang bukan owner aktif. Untuk
`reject`, `--reason` wajib. RPC menolak `approve` bila harga jual masih di
bawah harga beli (`SALE_BELOW_COST`), menolak baris yang bukan `review`, dan
menolak baris yang sudah punya `product_id`. Alternatifnya
`--action reject` dengan `--reason` wajib — tetapi itu berarti produk tidak
masuk master, jadi hanya untuk SKU yang memang dihentikan.

Kriteria lulus akhir D4:

```sql
select count(*) as produk_total from public.products;                  -- 1361
select count(*) as produk_aktif from public.products where is_active;  -- 1361
select count(*) as review_sisa from public.product_import_rows
 where validation_status = 'review';                                    -- 0
select count(*) as berstok from public.products where stock_on_hand is not null;  -- 0
```

Jangan menjalankan impor dua kali "untuk memastikan". Skrip ini melanjutkan run
yang sama dan melewati baris yang sudah punya `product_id`, tetapi setiap run
menulis audit baru, dan `--apply` berikutnya **men-staging ulang** seluruh
workbook sehingga baris yang belum punya `product_id` (termasuk baris yang baru
saja di-approve) kembali ke status asalnya. Setelah §6.4 selesai, jangan
menyentuh `product-import.mjs --apply` lagi.

Catatan angka: `docs/05` dan `docs/06` menyebut "1.361 produk" karena baris
review sudah diselesaikan; itu **hasil akhir**, bukan keluaran satu kali
`--apply`. Jangan memakai 1.361 sebagai target `imported` pada run pertama.

## 7. D5 — Saldo awal dari hitungan fisik

Ini satu-satunya langkah yang menghasilkan angka stok, dan aturannya mutlak:
**angka berasal dari hitungan fisik di toko, bukan dari preview.** Menyalin
saldo preview berarti mengimpor kesalahan preview (di preview, 1.343 dari 1.361
produk aktif masih berstok `NULL`, 18 sisanya hanya berisi angka latihan A2, dan
ada 13 baris `stock_discrepancy_logs`), dan membuat selisih opname pertama tidak
berarti apa-apa.

### 7.1 Bentuk pekerjaan

Saldo awal **tidak** diisi lewat SQL dan tidak lewat `stock_on_hand`. Jalur satu-
satunya adalah sesi opname biasa (`docs/22` §5): buat sesi, hitung, isi, posting.
Konsekuensinya:

- setiap produk terisi punya jejak `stock_movements` bertipe `opening_balance`;
- `stock_opnames` menyimpan siapa menghitung dan kapan;
- tidak ada baris yang bisa berubah tanpa jejak.

### 7.2 Urutan yang disarankan

1. Satu sesi **kecil** di preview (satu kategori, ~20 produk) untuk memastikan
   staf paham alur. Ini bagian dari Tahap 3, bukan produksi — **sudah selesai 4
   November 2026** (`OP-20261104-0058` dan `-0059`, lihat `docs/22` §11). Di
   produksi, latihan ini tidak diulang; D5 langsung memakai alur yang sama.
2. Di produksi, bagi rak menjadi beberapa sesi (mis. per kategori/rak), bukan
   satu sesi 1.361 baris. Sesi besar lebih mudah konflik versi dan lebih sulit
   diulang bila ada kesalahan hitung.
3. Posting per sesi, lalu rekonsiliasi selisih sebelum sesi berikutnya.

### 7.3 Kriteria lulus

```sql
-- 0 produk aktif yang stoknya masih NULL
select count(*) as aktif_tanpa_stok from public.products
 where is_active and stock_on_hand is null;

-- movement opening_balance = jumlah produk yang terisi
select count(*) as opening from public.stock_movements
 where movement_type = 'opening_balance';

select count(*) as produk_terisi from public.products
 where is_active and stock_on_hand is not null;
-- kedua angka harus sama

-- tidak ada stok negatif tanpa penjelasan
select count(*) as negatif from public.products where stock_on_hand < 0;
```

Angka `negatif` boleh > 0 hanya bila memang ada produk yang stok fisiknya
minus karena penjualan belum tercatat; setiap barisnya harus bisa dijelaskan
owner, bukan dibiarkan.

Catatan teknis: `opening_balance` hanya sah untuk produk yang `stock_on_hand`
masih `NULL` — RPC menolak (`REASON_INVALID`) bila dipakai pada produk yang
sudah punya stok. Jadi saldo awal harus selesai sebelum penjualan pertama; bila
toko sudah sempat berjualan, gunakan `opname_adjustment` dengan alasan, bukan
`opening_balance`.

D5 selesai hanya bila backup D1a sudah terbukti bisa direstore. Mengisi 1.361
baris hasil hitungan tanpa backup adalah risiko yang tidak perlu diambil.

## 8. Ganti dan lupa kata sandi

Aplikasi ini **tidak punya** halaman ganti kata sandi, dan owner memutuskan
(4 November 2026) untuk **tetap begitu**. Itu keputusan sadar, bukan kelalaian:
menambah alur reset di aplikasi berarti menambah permukaan serangan (token
reset, tautan email, halaman publik) pada aplikasi yang dipakai di belakang
meja kasir. Prosedur di bawah adalah satu-satunya jalur.

### 8.1 Owner mengganti kata sandi staf

1. Dashboard Supabase produksi → Authentication → **Users**.
2. Cari email staf → menu **⋯** → **Reset password** (atau buka detail user).
3. Isi kata sandi baru, atau kirim tautan reset bila email staf aktif.
4. Sampaikan kata sandi baru **langsung** ke staf; jangan lewat grup chat.

Tidak perlu menyentuh `profiles`: kata sandi hidup di `auth.users`, dan
`profiles` hanya menyimpan peran/status. Mengganti kata sandi **tidak**
mengaktifkan akun nonaktif — aktivasi tetap lewat `/users`.

### 8.2 Staf lupa kata sandi

Staf **tidak** bisa memakai tautan "lupa kata sandi" dari aplikasi: aplikasi
ini tidak punya halaman itu. Project juga belum punya SMTP sendiri — yang ada
hanya layanan email bawaan Supabase, dibatasi **2 email per jam** dan
best-effort, jadi tidak layak diandalkan untuk operasi toko. Prosedurnya: staf
menghubungi owner, owner menjalankan §8.1 (setel kata sandi langsung, tanpa
email).

### 8.3 Bila email owner sendiri hilang

Ini satu-satunya skenario yang butuh jalur darurat. Karena `bootstrap_owner`
menolak bila sudah ada owner aktif, jangan mencoba "membuat owner kedua" lewat
fungsi itu. Yang benar: buat user baru di dashboard, aktifkan lewat
`admin_upsert_profile` dari akun owner lama (bila masih bisa login), atau — bila
semua akses owner hilang — eskalasi ke dukungan Supabase untuk pemulihan akses
project. Jangan menyimpan kata sandi owner di repo, di `.env`, atau di dokumen
ini.

### 8.4 Kriteria lulus

- Satu akun staf dicoba login dengan kata sandi baru → berhasil.
- Akun nonaktif tetap tidak bisa dipakai bekerja setelah kata sandi diganti
  (status `is_active` tidak berubah karena reset).
- Tidak ada kata sandi yang tertulis di `docs/`, `README`, atau commit.

## 9. D6 — UAT produksi dan latihan kasir

Dijalankan setelah D5, memakai data nyata. Checklist `docs/16` §5 dijalankan
di domain produksi, bukan preview.

| Yang diuji | Bukti yang disimpan |
| --- | --- |
| Login owner + staf | screenshot / catatan waktu login |
| Transaksi tunai + cetak struk | nomor transaksi produksi pertama |
| Transaksi non-tunai (QRIS/transfer) | nomor transaksi + metode |
| Opname kecil pasca-saldo-awal | sesi opname + selisih 0 |
| Laporan harian | angka cocok dengan transaksi uji |
| Pembatalan/retur | jejak audit + movement balik |
| Staf nonaktif tidak bisa bekerja | percobaan login + pesan yang muncul |

Kriteria lulus: seluruh baris di atas terbukti, dan owner menandatangani
batasan `docs/16` §6 (apa yang aplikasi **tidak** jamin). Tanpa tanda tangan
itu, proyek belum boleh disebut "siap pakai" meskipun semua tes hijau.

Latihan kasir minimal satu sesi penuh dengan produk asli, bukan produk uji.
Sisakan waktu untuk menghapus transaksi uji — atau lebih baik, lakukan latihan
sebelum jam buka toko dan tandai transaksinya agar bisa dikenali.

## 10. Checklist ringkas (cetak dan centang)

- [x] Tahap A (A1–A3) selesai di preview, 4 November 2026 — `docs/22` §11
- [ ] D1 project produksi dibuat, region Singapore, ref dicatat
- [x] D1a pilihan backup tertulis (paket berbayar, 4 November 2026)
- [ ] D1a satu restore ke project uji terbukti
- [ ] D1b env Vercel produksi terpasang **sebelum** build
- [ ] D1b Site URL + Redirect URLs menunjuk domain produksi
- [ ] D1b HSTS `includeSubDomains` hanya setelah domain sendiri ada
- [ ] D2 `migration list --linked` = 23/23
- [ ] D3 owner pertama dibuat via dashboard + `bootstrap_owner`
- [ ] D3 `disable_signup` true **dan** `external.email` true **dan** signup → 422
- [ ] D3a angka baseline kosong cocok (0 produk, 0 movement, 1 profil)
- [ ] D4 impor 1.360 + 1 review → review diselesaikan owner → 1.361 produk, 0 rejected, stok semua `NULL`
- [ ] D5 0 produk aktif berstok `NULL`, opening_balance = jumlah produk terisi
- [ ] D6 checklist `docs/16` §5 ditandatangani + batasan §6 disetujui
- [ ] `docs/PROGRESS.md` mencatat tanggal dan hasil tiap langkah

## 11. Yang tidak dibahas dokumen ini

- Migrasi data penjualan lama dari aplikasi/Excel lain. Belum ada keputusan
  bentuk datanya; `legacy_transactions_raw` disiapkan untuk itu tetapi belum
  dipakai di produksi.
- Konfigurasi SMTP untuk email transaksional. Layanan bawaan Supabase (2
  email/jam, best-effort) tidak cukup untuk reset kata sandi mandiri; selama
  belum ada SMTP, semua komunikasi akun lewat owner (lihat §8).
- Domain kustom dan sertifikat. Dibahas di §4.3 saat domain sudah ada.
- Pelatihan lanjutan dan SOP toko. Itu di luar repo ini.
