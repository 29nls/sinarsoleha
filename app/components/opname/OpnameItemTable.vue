<script setup lang="ts">
import type { OpnameItemRow } from '~/types/opname'
import { countStatusLabel, opnameReasonLabel } from '~/types/opname'
import { formatQuantity } from '~/utils/format'

const props = defineProps<{
  items: OpnameItemRow[]
  loading: boolean
  error: string | null
  editable: boolean
  highlightedIds: string[]
}>()

const emit = defineEmits<{
  count: [item: OpnameItemRow]
}>()

function isHighlighted(item: OpnameItemRow): boolean {
  return props.highlightedIds.includes(item.id)
}

function statusClass(status: string): string {
  if (status === 'posted') return 'tag tag-accent'
  if (status === 'needs_recount') return 'tag tag-danger'
  if (status === 'counted') return 'tag'
  return 'tag tag-warn'
}

function differenceClass(item: OpnameItemRow): string {
  const difference = item.differenceQty
  if (difference === null || difference === 0) return 'num text-right'
  return difference > 0
    ? 'num text-right font-medium text-[#0b5a4f]'
    : 'num text-right font-medium text-[var(--color-danger)]'
}

function differenceLabel(item: OpnameItemRow): string {
  const difference = item.differenceQty
  if (difference === null) return '—'
  if (difference === 0) return '0'
  return difference > 0 ? `+${formatQuantity(difference)}` : formatQuantity(difference)
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[860px]" :aria-busy="loading">
      <caption class="sr-only">Item opname dan jumlah fisik</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Produk</th>
          <th scope="col" class="text-right">Stok sistem</th>
          <th scope="col" class="text-right">Fisik</th>
          <th scope="col" class="text-right">Selisih</th>
          <th scope="col">Alasan</th>
          <th scope="col">Status</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="py-8 text-center" role="status">Memuat item…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="8" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="items.length === 0">
          <td colspan="8" class="py-8 text-center text-[var(--color-muted)]">
            Sesi ini tidak memiliki item.
          </td>
        </tr>
        <template v-else>
          <tr
            v-for="item in items"
            :key="item.id"
            :class="isHighlighted(item) ? 'bg-[#fdf3f2]' : ''"
          >
            <td class="font-mono text-[12px] whitespace-nowrap">{{ item.sku }}</td>
            <td class="max-w-[260px]">
              <span class="block truncate" :title="item.productName">{{ item.productName }}</span>
              <span v-if="!item.isActive" class="tag mt-0.5">Nonaktif</span>
            </td>
            <td class="num text-right whitespace-nowrap">
              <span v-if="item.systemQtySnapshot === null" class="tag tag-warn">NULL</span>
              <template v-else>{{ formatQuantity(item.systemQtySnapshot) }}</template>
            </td>
            <td class="num text-right whitespace-nowrap">
              <template v-if="item.physicalQty === null">
                <span class="text-[var(--color-muted)]">—</span>
              </template>
              <template v-else>{{ formatQuantity(item.physicalQty) }}</template>
            </td>
            <td :class="differenceClass(item)">{{ differenceLabel(item) }}</td>
            <td class="max-w-[180px] text-[12px]">
              <span class="block truncate" :title="item.reasonNote ?? ''">
                {{ opnameReasonLabel(item.reasonCode) }}
              </span>
            </td>
            <td>
              <span :class="statusClass(item.countStatus)">{{ countStatusLabel(item.countStatus) }}</span>
            </td>
            <td class="whitespace-nowrap text-right">
              <button
                v-if="editable && item.countStatus !== 'posted'"
                class="btn px-1.5 py-0.5 text-[11px]"
                type="button"
                @click="emit('count', item)"
              >
                {{ item.physicalQty === null ? 'Hitung' : 'Ubah' }}
              </button>
              <span v-else class="text-[11px] text-[var(--color-muted)]">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
