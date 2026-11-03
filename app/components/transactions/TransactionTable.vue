<script setup lang="ts">
import type { TransactionListRow } from '~/types/transactions'
import { statusLabel, paymentMethodLabel } from '~/types/transactions'
import { formatDate, formatRupiah } from '~/utils/format'

const props = defineProps<{
  rows: TransactionListRow[]
  loading: boolean
  error: string | null
  page: number
  pageSize: number
  total: number
  isOwner: boolean
}>()

const emit = defineEmits<{
  view: [row: TransactionListRow]
}>()

function statusClass(status: string): string {
  if (status === 'voided') return 'tag tag-danger'
  return 'tag tag-accent'
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[760px]" :aria-busy="loading">
      <caption class="sr-only">Riwayat transaksi</caption>
      <thead>
        <tr>
          <th scope="col">Nota</th>
          <th scope="col">Tanggal</th>
          <th scope="col">Kasir</th>
          <th scope="col" class="text-right">Item</th>
          <th scope="col" class="text-right">Subtotal</th>
          <th scope="col" class="text-right">Diskon</th>
          <th scope="col" class="text-right">Total</th>
          <th scope="col">Bayar</th>
          <th scope="col">Status</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="10" class="py-8 text-center" role="status">
            Memuat transaksi…
          </td>
        </tr>
        <tr v-else-if="error">
          <td colspan="10" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="10" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada transaksi yang cocok.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono text-[12px] font-medium">{{ row.receiptNo }}</td>
            <td class="whitespace-nowrap">{{ formatDate(`${row.businessDate}T00:00:00+07:00`) }}</td>
            <td>{{ row.cashierName }}</td>
            <td class="num text-right">{{ row.itemCount }}</td>
            <td class="num text-right whitespace-nowrap">{{ formatRupiah(row.subtotal) }}</td>
            <td class="num text-right whitespace-nowrap">{{ formatRupiah(row.discountAmount) }}</td>
            <td class="num text-right whitespace-nowrap font-medium">{{ formatRupiah(row.grandTotal) }}</td>
            <td>{{ paymentMethodLabel(row.paymentMethod) }}</td>
            <td><span :class="statusClass(row.status)">{{ statusLabel(row.status) }}</span></td>
            <td class="whitespace-nowrap text-right">
              <button
                class="btn px-1.5 py-0.5 text-[11px]"
                type="button"
                @click="emit('view', row)"
              >
                Detail
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="!loading && !error && total > 0" class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
      Halaman {{ page }} · {{ rows.length }} baris dari {{ total }} transaksi
    </p>
  </div>
</template>
