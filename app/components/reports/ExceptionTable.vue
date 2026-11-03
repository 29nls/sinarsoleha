<script setup lang="ts">
import type { ExceptionRow } from '~/types/reports'
import { EXCEPTION_CATEGORY_LABELS } from '~/types/reports'
import { formatDate } from '~/utils/format'

defineProps<{
  rows: ExceptionRow[]
  loading: boolean
  error: string | null
}>()

function categoryClass(category: ExceptionRow['category']): string {
  if (category === 'negative_stock' || category === 'legacy_mismatch') return 'tag-danger'
  if (category === 'stock_unknown' || category === 'purchase_cost_missing') return 'tag-warn'
  return 'tag'
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[760px]" :aria-busy="loading">
      <caption class="sr-only">Exception data katalog dan transaksi</caption>
      <thead>
        <tr>
          <th scope="col">Kategori</th>
          <th scope="col">SKU / Nota</th>
          <th scope="col">Produk / Keterangan</th>
          <th scope="col">Detail</th>
          <th scope="col">Tanggal</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="5" class="py-8 text-center" role="status">Memuat exception data…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="5" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="5" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada exception data. Katalog dan transaksi legacy bersih.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap">
              <span class="tag" :class="categoryClass(row.category)">
                {{ EXCEPTION_CATEGORY_LABELS[row.category] }}
              </span>
            </td>
            <td class="whitespace-nowrap font-mono text-[12px]">
              <NuxtLink
                v-if="row.referencePath"
                class="underline decoration-dotted"
                :to="row.referencePath"
              >
                {{ row.sku }}
              </NuxtLink>
              <template v-else>{{ row.sku }}</template>
            </td>
            <td class="min-w-[220px]">{{ row.label }}</td>
            <td class="min-w-[200px] text-[12px] text-[var(--color-muted)]">
              {{ row.detail ?? '—' }}
            </td>
            <td class="whitespace-nowrap text-[11px]">{{ formatDate(row.createdAt) }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
