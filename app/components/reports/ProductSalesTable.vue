<script setup lang="ts">
import type { ProductSalesRow } from '~/types/reports'
import { formatQuantity, formatRupiah } from '~/utils/format'

defineProps<{
  rows: ProductSalesRow[]
  loading: boolean
  error: string | null
  truncated: boolean
}>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[820px]" :aria-busy="loading">
      <caption class="sr-only">Penjualan per produk</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Produk</th>
          <th scope="col" class="text-right">Kuantitas</th>
          <th scope="col" class="text-right">Nilai kotor</th>
          <th scope="col" class="text-right">Diskon baris</th>
          <th scope="col" class="text-right">Nilai bersih</th>
          <th scope="col" class="text-right">Nota</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="py-8 text-center" role="status">Memuat penjualan per produk…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="7" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="7" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada penjualan produk pada periode ini.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.key">
            <td class="whitespace-nowrap font-mono text-[12px]">{{ row.sku }}</td>
            <td class="min-w-[220px]">{{ row.productName }}</td>
            <td class="num whitespace-nowrap text-right">
              {{ formatQuantity(row.quantitySold) }}
              <span class="ml-1 text-[11px] text-[var(--color-muted)]">{{ row.unitLabel }}</span>
            </td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(row.grossSales) }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(row.lineDiscount) }}</td>
            <td class="num whitespace-nowrap text-right font-semibold">{{ formatRupiah(row.netSales) }}</td>
            <td class="num whitespace-nowrap text-right">{{ row.transactionCount }}</td>
          </tr>
        </template>
      </tbody>
    </table>

    <p v-if="truncated" class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-warn)]">
      Baris item melebihi batas muat. Persempit periode agar seluruh penjualan terhitung.
    </p>
  </div>
</template>
