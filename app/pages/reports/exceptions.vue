<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useReports } from '~/composables/useReports'
import { toCsv } from '~/types/reports'
import type { ExceptionCategory } from '~/types/reports'
import { EXCEPTION_CATEGORY_LABELS } from '~/types/reports'
import { downloadCsv } from '~/utils/download'
import ReportsTabs from '~/components/reports/ReportsTabs.vue'
import ExceptionTable from '~/components/reports/ExceptionTable.vue'

definePageMeta({ capability: 'report.sales' })
useHead({ title: 'Exception data · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()

const { exceptions, exceptionsLoading, exceptionsError, refresh } = useReports({
  client,
  autoLoad: ['exceptions'],
})

const categories = Object.keys(EXCEPTION_CATEGORY_LABELS) as ExceptionCategory[]

function exportExceptions(): void {
  const rows = exceptions.value?.rows ?? []
  const csv = toCsv(
    ['Kategori', 'SKU / Nota', 'Produk / Keterangan', 'Detail', 'Tanggal'],
    rows.map((row) => [
      EXCEPTION_CATEGORY_LABELS[row.category],
      row.sku,
      row.label,
      row.detail,
      row.createdAt,
    ]),
  )
  downloadCsv('exception-data.csv', csv)
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Laporan</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Exception data katalog dan transaksi legacy yang perlu dibereskan sebelum go-live.
        Laporan ini tidak mengubah data apa pun.
      </p>
    </div>

    <ReportsTabs />

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="category in categories" :key="category" class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {{ EXCEPTION_CATEGORY_LABELS[category] }}
        </p>
        <p class="num text-lg font-semibold">
          {{ (exceptions?.counts[category] ?? 0).toLocaleString('id-ID') }}
        </p>
      </div>
    </div>

    <section class="panel" aria-labelledby="exception-title">
      <div class="panel-head">
        <h2 id="exception-title" class="panel-title">Rincian exception</h2>
        <div class="flex items-center gap-2">
          <span class="num text-[11px] text-[var(--color-muted)]">
            {{ (exceptions?.rows.length ?? 0).toLocaleString('id-ID') }} baris
          </span>
          <button
            class="btn text-[11px]"
            type="button"
            :disabled="exceptionsLoading"
            @click="refresh"
          >
            Muat ulang
          </button>
          <button
            class="btn text-[11px]"
            type="button"
            :disabled="exceptionsLoading || !exceptions"
            @click="exportExceptions"
          >
            Ekspor CSV
          </button>
        </div>
      </div>
      <ExceptionTable
        :rows="exceptions?.rows ?? []"
        :loading="exceptionsLoading"
        :error="exceptionsError"
      />
    </section>

    <p v-if="exceptions?.truncated" class="notice notice-warn" role="status">
      Sebagian data tidak termuat karena melebihi batas baca. Bereskan kategori teratas lalu muat
      ulang.
    </p>

    <p class="text-[11px] text-[var(--color-muted)]">
      Akses: {{ auth.role === 'owner' ? 'owner' : 'akun Anda' }}. Harga beli hanya terbaca oleh
      owner; exception harga beli kosong tidak ditampilkan untuk peran lain.
    </p>
  </div>
</template>
