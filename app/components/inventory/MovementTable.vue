<script setup lang="ts">
import type { MovementRow } from '~/types/inventory'
import { movementTypeLabel } from '~/types/inventory'
import { opnameReasonLabel } from '~/types/opname'
import { formatDateTime, formatQuantity } from '~/utils/format'

defineProps<{
  rows: MovementRow[]
  loading: boolean
  error: string | null
}>()

function signed(value: number): string {
  const text = formatQuantity(Math.abs(value))
  return value > 0 ? `+${text}` : `−${text}`
}

function deltaClass(value: number): string {
  return value > 0 ? 'text-[#0b5a4f]' : 'text-[var(--color-danger)]'
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[900px]" :aria-busy="loading">
      <caption class="sr-only">Histori pergerakan stok</caption>
      <thead>
        <tr>
          <th scope="col">Waktu</th>
          <th scope="col">SKU</th>
          <th scope="col">Produk</th>
          <th scope="col">Jenis</th>
          <th scope="col" class="text-right">Perubahan</th>
          <th scope="col" class="text-right">Sebelum</th>
          <th scope="col" class="text-right">Sesudah</th>
          <th scope="col">Alasan</th>
          <th scope="col">Aktor</th>
          <th scope="col">Referensi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="10" class="py-8 text-center" role="status">Memuat pergerakan stok…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="10" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="10" class="py-8 text-center text-[var(--color-muted)]">
            Belum ada pergerakan stok pada filter ini.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap text-[11px]">{{ formatDateTime(row.createdAt) }}</td>
            <td class="font-mono text-[12px] font-medium">{{ row.sku }}</td>
            <td class="min-w-[180px]">{{ row.productName }}</td>
            <td class="whitespace-nowrap">
              <span class="tag" :class="row.quantityDelta > 0 ? 'tag-accent' : 'tag-warn'">
                {{ movementTypeLabel(row.movementType) }}
              </span>
            </td>
            <td class="num whitespace-nowrap text-right font-semibold">
              <span :class="deltaClass(row.quantityDelta)">
                {{ signed(row.quantityDelta) }}
              </span>
              <span class="ml-1 text-[11px] text-[var(--color-muted)]">{{ row.unitLabel }}</span>
            </td>
            <td class="num whitespace-nowrap text-right">{{ formatQuantity(row.quantityBefore) }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatQuantity(row.quantityAfter) }}</td>
            <td class="min-w-[160px]">
              <template v-if="row.reasonCode">
                {{ opnameReasonLabel(row.reasonCode) }}
                <span v-if="row.reasonNote" class="block text-[11px] text-[var(--color-muted)]">
                  {{ row.reasonNote }}
                </span>
              </template>
              <span v-else class="text-[var(--color-muted)]">—</span>
            </td>
            <td class="whitespace-nowrap">{{ row.actorLabel }}</td>
            <td class="whitespace-nowrap text-[11px]">
              <NuxtLink
                v-if="row.stockOpnameId"
                class="underline decoration-dotted"
                :to="`/stock-opname/${row.stockOpnameId}`"
              >
                Opname
              </NuxtLink>
              <span v-else-if="row.transactionId" class="text-[var(--color-muted)]">Nota</span>
              <span v-else class="text-[var(--color-muted)]">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
