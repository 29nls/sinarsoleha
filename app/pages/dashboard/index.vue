<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { APP_MODULES } from '~/utils/modules'
import { ROLE_LABELS } from '~/types/database'
import { formatDateTime, formatRupiah, formatQuantity } from '~/utils/format'

definePageMeta({ capability: 'dashboard.view' })
useHead({ title: 'Dasbor · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const { url } = useSupabaseConfig()

const roleLabel = computed(() => (auth.role ? ROLE_LABELS[auth.role] : '—'))

const projectHost = computed(() => {
  if (!url) return '—'
  try {
    return new URL(url).host
  } catch {
    return '—'
  }
})

const sessionExpiry = computed(() => {
  if (!auth.expiresAt) return '—'
  return formatDateTime(new Date(auth.expiresAt * 1000))
})

const modules = APP_MODULES
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Dasbor</h1>
        <p class="text-[12px] text-[var(--color-muted)]">Katalog produk aktif (Fase 3A). Modul transaksi belum aktif.</p>
      </div>
      <span class="tag tag-accent">Fase 3A aktif</span>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Sesi aktif</h2>
        </div>
        <table class="table-dense">
          <tbody>
            <tr>
              <th scope="row" class="w-40">Nama profil</th>
              <td>{{ auth.profile?.full_name ?? '—' }}</td>
            </tr>
            <tr>
              <th scope="row">Email akun</th>
              <td class="font-mono text-[12px]">{{ auth.email ?? '—' }}</td>
            </tr>
            <tr>
              <th scope="row">Peran</th>
              <td>{{ roleLabel }}</td>
            </tr>
            <tr>
              <th scope="row">Proyek Supabase</th>
              <td class="font-mono text-[12px]">{{ projectHost }}</td>
            </tr>
            <tr>
              <th scope="row">Sesi kedaluwarsa</th>
              <td class="num">{{ sessionExpiry }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Aturan yang sudah mengikat</h2>
        </div>
        <ul class="space-y-2 px-4 py-3 text-[12px] leading-relaxed">
          <li>
            <span class="font-semibold">Otorisasi di database.</span> Peran pada state aplikasi hanya mengatur
            tampilan; RLS dan RPC PostgreSQL memutuskan setiap operasi.
          </li>
          <li>
            <span class="font-semibold">Nilai kosong tetap kosong.</span> Stok atau harga yang tidak diketahui
            ditampilkan sebagai &ldquo;—&rdquo; dan tidak boleh diperlakukan sebagai nol.
          </li>
          <li>
            <span class="font-semibold">Uang memakai numeric.</span> Perhitungan memakai presisi desimal, bukan
            floating point; total final dihitung ulang di database.
          </li>
          <li>
            <span class="font-semibold">Ledger tidak dapat diubah.</span> Setiap mutasi stok dicatat sebagai baris
            <code class="font-mono">stock_movements</code> baru.
          </li>
        </ul>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Status modul</h2>
        <span class="text-[11px] text-[var(--color-muted)]">Tautan hanya muncul untuk modul yang sudah dibuat</span>
      </div>
      <div class="overflow-x-auto">
        <table class="table-dense">
          <thead>
            <tr>
              <th>Modul</th>
              <th>Fase</th>
              <th>Status</th>
              <th>Lingkup</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in modules" :key="item.key">
              <td class="font-medium">{{ item.label }}</td>
              <td class="num">{{ item.phase }}</td>
              <td>
                <span :class="['tag', item.available ? 'tag-accent' : '']">
                  {{ item.available ? 'Aktif' : 'Belum dibuat' }}
                </span>
              </td>
              <td class="text-[var(--color-muted)]">{{ item.description }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2 class="panel-title">Contoh format angka</h2>
        <span class="text-[11px] text-[var(--color-muted)]">Formatter bersama, dipakai seluruh modul</span>
      </div>
      <table class="table-dense">
        <tbody>
          <tr>
            <th scope="row" class="w-40">Rupiah</th>
            <td class="num">{{ formatRupiah(175000) }}</td>
          </tr>
          <tr>
            <th scope="row">Nilai tidak diketahui</th>
            <td class="num">{{ formatRupiah(null) }}</td>
          </tr>
          <tr>
            <th scope="row">Kuantitas</th>
            <td class="num">{{ formatQuantity(2.5) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
