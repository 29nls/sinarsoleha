<script setup lang="ts">
import type { SalesReportRow } from '~/types/reports'
import { statusLabel } from '~/types/transactions'
import { formatDate } from '~/utils/format'
import { formatRupiah } from '~/utils/format'

defineProps<{
  rows: SalesReportRow[]
  loading: boolean
  error: string | null
  total: number
  truncated: boolean
}>()

const methodLabels: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  other: 'Lainnya',
  split: 'Campuran',
}

function methodLabel(method: string): string {
  if (!method) return '—'
  return methodLabels[method] ?? method
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[880px]" :aria-busy="loading">
      <caption class="sr-only">Rincian pendapatan penjualan</caption>
      <thead>
        <tr>
          <th scope="col">Tanggal</th>
          <th scope="col">Nota</th>
          <th scope="col" class="text-right">Subtotal</th>
          <th scope="col" class="text-right">Diskon</th>
          <th scope="col" class="text-right">Grand total</th>
          <th scope="col">Pembayaran</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="py-8 text-center" role="status">Memuat rincian transaksi…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="7" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="7" class="py-8 text-center text-[var(--color-muted)]">
            Belum ada transaksi pada periode ini.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap">{{ formatDate(row.businessDate) }}</td>
            <td class="whitespace-nowrap font-mono text-[12px]">
              <NuxtLink class="underline decoration-dotted" :to="`/cashier/transactions/${row.id}`">
                {{ row.receiptNo }}
              </NuxtLink>
            </td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(row.subtotal) }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(row.discountAmount) }}</td>
            <td class="num whitespace-nowrap text-right font-semibold">
              {{ formatRupiah(row.grandTotal) }}
            </td>
            <td class="whitespace-nowrap">{{ methodLabel(row.paymentMethod) }}</td>
            <td class="whitespace-nowrap">
              <span class="tag" :class="row.status === 'voided' ? 'tag-danger' : 'tag-accent'">
                {{ statusLabel(row.status) }}
              </span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <p v-if="truncated" class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-warn)]">
      Menampilkan {{ rows.length.toLocaleString('id-ID') }} dari
      {{ total.toLocaleString('id-ID') }} transaksi. Persempit periode agar angka ringkasan
      mencakup seluruh transaksi.
    </p>
  </div>
</template>
