<script setup lang="ts">
import type { DailySummaryRow, SalesReportResult } from '~/types/reports'
import { formatDate, formatRupiah } from '~/utils/format'

defineProps<{
  summary: DailySummaryRow[]
  totals: SalesReportResult['totals']
  loading: boolean
  error: string | null
}>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[860px]" :aria-busy="loading">
      <caption class="sr-only">Ringkasan penjualan harian</caption>
      <thead>
        <tr>
          <th scope="col">Tanggal bisnis</th>
          <th scope="col" class="text-right">Transaksi</th>
          <th scope="col" class="text-right">Penjualan kotor</th>
          <th scope="col" class="text-right">Diskon</th>
          <th scope="col" class="text-right">Penjualan bersih</th>
          <th scope="col" class="text-right">Tunai</th>
          <th scope="col" class="text-right">QRIS</th>
          <th scope="col" class="text-right">Lainnya</th>
          <th scope="col" class="text-right">Rata-rata</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="9" class="py-8 text-center" role="status">Memuat ringkasan harian…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="9" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="summary.length === 0">
          <td colspan="9" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada transaksi selesai pada periode ini.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in summary" :key="row.businessDate">
            <td class="whitespace-nowrap font-medium">{{ formatDate(row.businessDate) }}</td>
            <td class="num text-right">{{ row.transactionCount }}</td>
            <td class="num text-right">{{ formatRupiah(row.grossSales) }}</td>
            <td class="num text-right">{{ formatRupiah(row.discountTotal) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(row.netSales) }}</td>
            <td class="num text-right">{{ formatRupiah(row.cashTotal) }}</td>
            <td class="num text-right">{{ formatRupiah(row.qrisTotal) }}</td>
            <td class="num text-right">{{ formatRupiah(row.otherTotal) }}</td>
            <td class="num text-right">{{ formatRupiah(row.averageSale) }}</td>
          </tr>
          <tr class="bg-[#fafbfc]">
            <th scope="row" class="font-semibold">Total periode</th>
            <td class="num text-right font-semibold">{{ totals.transactionCount }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.grossSales) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.discountTotal) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.netSales) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.cashTotal) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.qrisTotal) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.otherTotal) }}</td>
            <td class="num text-right font-semibold">{{ formatRupiah(totals.averageSale) }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
