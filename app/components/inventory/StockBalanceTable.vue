<script setup lang="ts">
import type { StockBalanceRow } from '~/types/inventory'
import { formatQuantity } from '~/utils/format'
import { stockState, stockStateLabel } from '~/utils/catalog'

defineProps<{
  rows: StockBalanceRow[]
  loading: boolean
  error: string | null
  canAdjust: boolean
}>()

const emit = defineEmits<{
  open: [row: StockBalanceRow]
  adjust: [row: StockBalanceRow]
}>()

function stateOf(row: StockBalanceRow) {
  return stockState(row.stockOnHand, row.lowStockThreshold)
}

function tagClass(row: StockBalanceRow): string {
  const state = stateOf(row)
  if (state === 'negative') return 'tag tag-danger'
  if (state === 'low') return 'tag tag-warn'
  if (state === 'unknown') return 'tag'
  return 'tag tag-accent'
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[820px]" :aria-busy="loading">
      <caption class="sr-only">Saldo stok per produk</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Nama barang</th>
          <th scope="col">Kategori</th>
          <th scope="col" class="text-right">Stok</th>
          <th scope="col">Satuan</th>
          <th scope="col" class="text-right">Batas rendah</th>
          <th scope="col">Status</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="py-8 text-center" role="status">Memuat saldo stok…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="8" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="8" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada produk yang cocok. Ubah pencarian atau filter saldo.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono text-[12px] font-medium">{{ row.sku }}</td>
            <td class="min-w-[200px] font-medium">
              {{ row.name }}
              <span v-if="!row.isActive" class="tag ml-1">Nonaktif</span>
            </td>
            <td>{{ row.categoryName ?? '—' }}</td>
            <td class="num whitespace-nowrap text-right font-semibold">
              <span :class="stateOf(row) === 'negative' ? 'text-[var(--color-danger)]' : ''">
                {{ formatQuantity(row.stockOnHand) }}
              </span>
            </td>
            <td class="whitespace-nowrap">{{ row.unitLabel }}</td>
            <td class="num whitespace-nowrap text-right">
              {{ formatQuantity(row.lowStockThreshold) }}
            </td>
            <td>
              <span :class="tagClass(row)">{{ stockStateLabel(stateOf(row)) }}</span>
            </td>
            <td class="whitespace-nowrap text-right">
              <button
                class="btn px-1.5 py-0.5 text-[11px]"
                type="button"
                @click="emit('open', row)"
              >
                Histori
              </button>
              <button
                v-if="canAdjust"
                class="btn ml-1 px-1.5 py-0.5 text-[11px]"
                type="button"
                @click="emit('adjust', row)"
              >
                Koreksi
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
