<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useReports } from '~/composables/useReports'
import { csvFileName, toCsv } from '~/types/reports'
import { downloadCsv } from '~/utils/download'
import ReportsTabs from '~/components/reports/ReportsTabs.vue'
import ReportRangePicker from '~/components/reports/ReportRangePicker.vue'
import SalesSummaryTable from '~/components/reports/SalesSummaryTable.vue'
import SalesDetailTable from '~/components/reports/SalesDetailTable.vue'

definePageMeta({ capability: 'report.sales' })
useHead({ title: 'Laporan penjualan · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()

const {
  range,
  preset,
  applyPreset,
  setRange,
  sales,
  salesLoading,
  salesError,
  refresh,
} = useReports({ client, autoLoad: ['sales'] })

const totals = computed(() => sales.value?.totals ?? {
  transactionCount: 0,
  grossSales: 0,
  discountTotal: 0,
  netSales: 0,
  cashTotal: 0,
  qrisTotal: 0,
  otherTotal: 0,
  averageSale: 0,
})

function updateFrom(value: string): void {
  setRange({ from: value, to: range.value.to })
}

function updateTo(value: string): void {
  setRange({ from: range.value.from, to: value })
}

function exportSummary(): void {
  const rows = sales.value?.summary ?? []
  const csv = toCsv(
    ['Tanggal', 'Transaksi', 'Penjualan kotor', 'Diskon', 'Penjualan bersih', 'Tunai', 'QRIS', 'Lainnya', 'Rata-rata'],
    rows.map((row) => [
      row.businessDate,
      row.transactionCount,
      row.grossSales,
      row.discountTotal,
      row.netSales,
      row.cashTotal,
      row.qrisTotal,
      row.otherTotal,
      row.averageSale,
    ]),
  )
  downloadCsv(csvFileName('ringkasan-penjualan', range.value), csv)
}

function exportDetail(): void {
  const rows = sales.value?.rows ?? []
  const csv = toCsv(
    ['Tanggal bisnis', 'Nota', 'Subtotal', 'Diskon', 'Grand total', 'Pembayaran', 'Status'],
    rows.map((row) => [
      row.businessDate,
      row.receiptNo,
      row.subtotal,
      row.discountAmount,
      row.grandTotal,
      row.paymentMethod,
      row.status,
    ]),
  )
  downloadCsv(csvFileName('pendapatan-penjualan', range.value), csv)
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Laporan</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Ringkasan pendapatan dari transaksi selesai. Angka dihitung dari baris transaksi, bukan
        salinan agregat, dan margin/laba kotor tidak disajikan karena harga beli historis belum
        lengkap.
      </p>
    </div>

    <ReportsTabs />

    <ReportRangePicker
      :from="range.from"
      :to="range.to"
      :preset="preset"
      :loading="salesLoading"
      @update:from="updateFrom"
      @update:to="updateTo"
      @preset="applyPreset"
      @refresh="refresh"
    />

    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Transaksi</p>
        <p class="num text-lg font-semibold">{{ totals.transactionCount.toLocaleString('id-ID') }}</p>
      </div>
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Penjualan bersih</p>
        <p class="num text-lg font-semibold">{{ formatRupiah(totals.netSales) }}</p>
      </div>
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Diskon</p>
        <p class="num text-lg font-semibold">{{ formatRupiah(totals.discountTotal) }}</p>
      </div>
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Rata-rata / nota</p>
        <p class="num text-lg font-semibold">{{ formatRupiah(totals.averageSale) }}</p>
      </div>
    </div>

    <p v-if="sales?.truncated" class="notice notice-warn" role="status">
      Periode ini memiliki {{ sales.total.toLocaleString('id-ID') }} transaksi, lebih dari batas muat
      {{ sales.rows.length.toLocaleString('id-ID') }}. Ringkasan hanya mencakup baris yang termuat;
      persempit periode untuk angka lengkap.
    </p>

    <section class="panel" aria-labelledby="daily-summary-title">
      <div class="panel-head">
        <h2 id="daily-summary-title" class="panel-title">Ringkasan harian</h2>
        <button class="btn text-[11px]" type="button" :disabled="salesLoading || !sales" @click="exportSummary">
          Ekspor CSV
        </button>
      </div>
      <SalesSummaryTable
        :summary="sales?.summary ?? []"
        :totals="totals"
        :loading="salesLoading"
        :error="salesError"
      />
    </section>

    <section class="panel" aria-labelledby="sales-detail-title">
      <div class="panel-head">
        <h2 id="sales-detail-title" class="panel-title">Rincian pendapatan</h2>
        <div class="flex items-center gap-2">
          <span class="num text-[11px] text-[var(--color-muted)]">
            {{ (sales?.rows.length ?? 0).toLocaleString('id-ID') }} baris
          </span>
          <button class="btn text-[11px]" type="button" :disabled="salesLoading || !sales" @click="exportDetail">
            Ekspor CSV
          </button>
        </div>
      </div>
      <SalesDetailTable
        :rows="sales?.rows ?? []"
        :loading="salesLoading"
        :error="salesError"
        :total="sales?.total ?? 0"
        :truncated="sales?.truncated ?? false"
      />
    </section>

    <p class="text-[11px] text-[var(--color-muted)]">
      Hanya transaksi berstatus selesai yang dihitung. Transaksi batal tetap dapat dilihat di
      Riwayat Transaksi. Laporan ini memakai kewenangan {{ auth.role === 'owner' ? 'owner' : 'akun Anda' }};
      kasir hanya melihat transaksi miliknya sendiri.
    </p>
  </div>
</template>
