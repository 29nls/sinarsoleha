# 23 — Roadmap Go-Live

Status per 4 November 2026. Dokumen ini menjawab satu pertanyaan: **berapa
langkah lagi sampai toko bisa dipakai berjualan?** Isinya hanya sisa pekerjaan —
fase yang sudah selesai tidak diulang di sini.

Ringkasan: **9 langkah dalam 4 tahap.** Tiga langkah pertama sekitar satu jam
kerja teknis. Langkah keempat adalah bottleneck sebenarnya dan bukan pekerjaan
perangkat lunak.

## 1. Fakta yang menentukan jadwal

| Metrik | Nilai | Arti |
| --- | --- | --- |
| Produk aktif | 1.361 | katalog siap |
| Stok terisi | **0** | belum ada saldo |
| Stok `NULL` | **1.361** | kasir menolak menjual |
| Project Supabase | **1** (preview) | produksi belum ada |
| Migrasi tersinkron | 23/23 | skema siap |

Kesimpulan: **hari ini toko belum bisa menjual satu barang pun.** Kasir menolak
produk berstok `NULL`, dan seluruh katalog masih `NULL`. Ini bukan cacat —
saldo memang harus berasal dari hitungan fisik, bukan dari angka yang dikarang.

## 2. Tahap A — Gerbang teknis (≈1 jam)

Membuktikan mesin opname benar pada data nyata. Setelah tahap ini, tidak ada lagi
keraguan apakah posting menghasilkan saldo dan ledger yang konsisten.

| # | Langkah | Pemilik | Kriteria lulus |
| --- | --- | --- | --- |
| A1 | Ketik frasa gate `APPROVE PHASE 5F REAL STOCK OPNAME ON PREVIEW` | Owner | frasa diterima persis |
| A2 | Jalankan satu sesi opname kecil (satu kategori atau ±20 produk) mengikuti `docs/22` §5 | Owner + staf A/B | sesi berstatus `posted`, tanpa item `needs_recount` |
| A3 | Verifikasi pasca-posting `docs/22` §6.1–6.8 | Teknis | 8/8 butir benar, regresi read-only tetap 11/11 |

Catatan A2: sengaja **kecil**, bukan seluruh katalog. Tujuannya membuktikan
mekanisme, bukan menyelesaikan pekerjaan gudang. Konflik versi (§5.3) tetap
wajib dipicu sekali di sini.

## 3. Tahap B — Saldo awal (3–5 hari kerja)

**Ini 97% dari sisa waktu, dan tidak bisa dipercepat oleh perangkat lunak.**

| # | Langkah | Pemilik | Kriteria lulus |
| --- | --- | --- | --- |
| B1 | Hitung fisik 1.361 produk aktif, dibagi rentang SKU antar staf tanpa tumpang tindih | Staf gudang | setiap produk punya angka fisik tertulis |
| B2 | Input lewat opname beralasan `opening_balance` + catatan | Staf A/B | 0 produk aktif berstok `NULL` |
| B3 | Owner approve + posting | Owner | movement `opening_balance` = jumlah produk yang diisi |

Perkiraan: 2 orang, 150–250 SKU/jam/orang → 3–5 hari. Bisa dipecah per kategori
dan diposting bertahap; tidak harus sekali jalan. Setiap tahap harus lolos
verifikasi §6 sebelum lanjut, supaya kesalahan hitung tidak menumpuk.

Jangan mengisi saldo tanpa menghitung barangnya. Angka yang dikarang akan
langsung terlihat sebagai selisih saat opname berikutnya, dan saat itu sudah
tidak ada cara membedakan salah hitung dari salah input.

## 4. Tahap C — Hardening (≈5 jam, paralel dengan Tahap B)

Tidak menunggu Tahap B. Semua butir di sini sudah tercatat terbuka di
`docs/16` §6.

| # | Langkah | Pemilik | Kriteria lulus |
| --- | --- | --- | --- |
| C1 | Nyalakan `disable_signup` di hosted | Teknis | `GET /auth/v1/settings` → `disable_signup: true` |
| C1a | Pastikan provider login email tetap hidup | Teknis | `external.email: true` dan owner bisa login |
| C2 | Bersihkan akun & data uji preview | Teknis | 0 fixture `TEST-*`/`HOST-*` aktif; akun uji **diarsipkan, bukan dihapus** (lihat di bawah) |
| C3 | Pasang CSP + HSTS di lapisan hosting | Teknis | header ada di response produksi; aplikasi tetap berfungsi ✅ |
| C4 | Aktifkan rate limit login bawaan Supabase Auth | Teknis | percobaan login berulang dibatasi ✅ |
| C5 | Uji backup & restore | Teknis | restore ke project uji menghasilkan 23/23 migrasi + data utuh |

C1 **selesai** di preview: `disable_signup: true`, dan probe `POST
/auth/v1/signup` mengembalikan `422 signup_disabled`. Aplikasi tidak butuh
pendaftaran publik — akun dibuat owner lewat `/users`.

C4 **selesai** tanpa perlu mengubah setelan apa pun. Rate limit login Supabase
Auth sudah aktif sebagai default dan **tidak bisa dibaca lewat CLI**:
`supabase config pull` menarik 10 properti remote dan `[auth.rate_limit]` tidak
ada di dalamnya. Nilainya hanya terbaca lewat Management API
(`GET /v1/projects/{ref}/config/auth`), yang butuh personal access token — tidak
tersedia di mesin ini dan sengaja tidak dikejar.

Karena itu pembuktian dilakukan dari perilaku, bukan dari setelan:

| Uji | Hasil |
| --- | --- |
| 60 login gagal beruntun ke akun tidak ada | `400` ×30, lalu **`429`** pada percobaan ke-31 |
| Login staf B yang sah saat bucket habis | **`200`, token terbit** |
| Login sah 20 detik kemudian | `200`, pulih tanpa intervensi |

Angka 31 cocok dengan dokumentasi: bucket kapasitas 30, terisi ulang 30 per 5
menit. Yang penting secara operasional: **pengguna sah tidak ikut terkunci** —
bucket habis hanya menolak percobaan berikutnya, bukan memblokir kredensial yang
benar. Di toko dengan satu komputer kasir, ini yang menentukan apakah toko bisa
buka atau tidak.

`app/stores/auth.ts` sudah menerjemahkan `429` menjadi "Terlalu banyak percobaan
masuk" dan **tidak** menyalahkan kata sandi. `tests/auth-errors.test.ts` (6
pemeriksaan) mengunci perilaku itu; tes dibuktikan bisa gagal dengan mematikan
cabang rate limit (2 tes jatuh), lalu hijau lagi setelah dikembalikan.

Catatan untuk produksi: batas ini per **IP**, bukan per akun. Kalau toko memakai
satu IP publik bersama, tebakan password tersebar ke seluruh staf hanya
menghasilkan ~30 percobaan per 5 menit — masih jauh di atas laju yang dibutuhkan
untuk menebak password 8+ karakter. Batas ini pelengkap, bukan pengganti
kebijakan password.

C1a ditambahkan sebagai langkah tersendiri setelah insiden 4 November: mematikan
`[auth.email] enable_signup` bukan menutup pendaftaran, melainkan mematikan
**provider login email** sampai owner tidak bisa masuk. Lihat `docs/PROGRESS.md`.

C3 **selesai**. Header dipasang lewat `routeRules` di `nuxt.config.ts`, bukan
`vercel.json`, supaya berlaku di host mana pun dan bisa diuji terhadap server
Nitro lokal. Terverifikasi: enam header muncul di response, dan aplikasi tetap
berfungsi penuh — login staf B, dasbor, serta halaman Stok Opname (58 sesi)
berjalan tanpa satu pun pelanggaran CSP.

CSP-nya ketat karena aplikasi tidak memakai CDN, font eksternal, analytics,
maupun gambar dari Storage: `default-src 'self'`, tanpa origin pihak ketiga.
`'unsafe-inline'` tetap diperlukan untuk skrip karena shell SPA memuat tiga
skrip inline (importmap, runtime config, payload Nuxt).

HSTS sengaja **tanpa** `includeSubDomains`: host preview berada di domain
bersama `vercel.app`, dan memaku subdomain di domain milik orang lain bukan
wewenang kita. Nyalakan opsi itu setelah domain produksi sendiri tersedia.

Dijaga oleh `tests/security-headers.test.ts` (7 pemeriksaan). Tes ini sudah
diuji balik: menghapus header HSTS membuatnya gagal, lalu hijau lagi setelah
dikembalikan.

C2 **tidak dikerjakan dengan cara yang tertulis semula.** Audit read-only
(`scripts/fixture-audit.mjs`, tanpa menulis apa pun) menemukan dua hal yang
membatalkan rencana "hapus akun `phase*`":

1. **Preview tidak punya akun nyata sama sekali.** Keenam akun yang ada adalah
   artefak uji, termasuk satu-satunya `owner`. Menghapus semua akun `phase*`
   berarti mencabut seluruh akses login — termasuk akun yang dipakai semua
   skrip verifikasi.
2. **Akun uji adalah pelaku 4.539 baris `audit_logs`.** Kolom `actor_id`
   didefinisikan `references public.profiles(id) on delete set null`, jadi
   menghapus profil akan mengosongkan pelaku di seluruh riwayat. Trigger
   `audit_logs_immutable` melarang `update`/`delete`, sehingga kerusakan itu
   **tidak bisa diperbaiki**. Ini persis larangan "jangan hapus riwayat".

Yang sudah memenuhi kriteria tanpa tindakan apa pun: **0 dari 48 fixture
`TEST-*`/`HOST-*` aktif**. Skrip smoke memang menonaktifkan fixture di akhir
(`is_active: false`) dan memverifikasi riwayatnya tetap ada — bukan dihapus.

Status C2: **sebagian selesai**. Fixture beres. Penghapusan akun ditunda dan
dipindahkan ke Tahap D sebagai `D3a`, karena yang benar-benar dibutuhkan bukan
membersihkan preview, melainkan **memastikan produksi tidak pernah menerima
akun dan riwayat uji ini**.

## 5. Tahap D — Produksi (1–2 hari)

| # | Langkah | Pemilik | Kriteria lulus |
| --- | --- | --- | --- |
| D1 | Buat project Supabase produksi terpisah | Owner | project ref baru, region sama |
| D2 | `db push` 23 migrasi ke produksi | Teknis | `migration list --linked` 23/23 |
| D3 | Buat akun owner produksi + `disable_signup` | Owner | 1 owner aktif, signup tertutup |
| D3a | Pastikan produksi mulai dari **database kosong**, bukan salinan preview | Teknis | 0 akun `phase*`, 0 `TEST-*`, 0 `HOST-*`, `audit_logs` hanya berisi aksi produksi |
| D4 | Impor master 1.361 produk | Teknis | 1.361/1.361 imported, 0 review |
| D5 | Isi saldo awal (ulangi Tahap B di produksi) | Staf gudang | 0 produk aktif `NULL` |
| D6 | UAT produksi + latih kasir | Owner | checklist `docs/16` §5 ditandatangani |

D5 **tidak bisa dilewati** dengan menyalin data dari preview. Saldo awal harus
berasal dari hitungan fisik di lokasi produksi, karena stok bisa berbeda antara
saat dihitung di preview dan saat toko mulai beroperasi.

## 6. Urutan paralel

```
A1 → A2 → A3 ─────────────┐
                          ├─→ D1 → D2 → D3 → D4 → D5 → D6
B1 → B2 → B3 ─────────────┤
                          │
C1 → C2 → C3 → C4 → C5 ───┘
```

A harus selesai sebelum B (mekanisme belum terbukti). B dan C berjalan
bersamaan. D menunggu B dan C selesai.

## 7. Yang tidak termasuk

Sengaja tidak dimasukkan karena bukan syarat go-live:

- Perangkat keras fisik (printer thermal, scanner) — keduanya punya fallback.
- QRIS dinamis — butuh server route; QRIS manual tetap berfungsi.
- Mode offline — kegagalan koneksi ditampilkan sebagai pesan, bukan antrean.
- Margin/laba kotor — 119 produk tanpa harga beli dan tidak ada histori biaya.

## 8. Definisi "siap pakai"

Proyek dinyatakan siap pakai bila seluruh butir ini benar:

- [ ] A1–A3 selesai; satu sesi opname nyata berstatus `posted` dan terverifikasi
- [ ] B2 selesai; 0 produk aktif berstok `NULL`
- [ ] C1–C5 selesai; `disable_signup: true`, header keamanan terpasang
- [ ] D1–D6 selesai; produksi menerima 23/23 migrasi dan UAT ditandatangani
- [ ] Owner menandatangani daftar batasan `docs/16` §6

Butir pertama bisa dicapai hari ini. Butir kedua menentukan sisanya.
