<script setup lang="ts">
import type { DiscrepancyRow } from '~/types/inventory'
import { opnameReasonLabel } from '~/types/opname'
import { formatDateTime, formatQuantity } from '~/utils/format'

defineProps<{
  rows: DiscrepancyRow[]
  loading: boolean
  error: string | null
}>()

function signed(value: number): string {
  const text = formatQuantity(Math.abs(value))
  return value > 0 ? `+${text}` : `−${text}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[960px]" :aria-busy="loading">
      <caption class="sr-only">Laporan selisih stok hasil opname</caption>
      <thead>
        <tr>
          <th scope="col">Waktu</th>
          <th scope="col">SKU</th>
          <th scope="col">Produk</th>
          <th scope="col" class="text-right">Sistem</th>
          <th scope="col" class="text-right">Fisik</th>
          <th scope="col" class="text-right">Selisih</th>
          <th scope="col">Alasan</th>
          <th scope="col">Dihitung oleh</th>
          <th scope="col">Disetujui oleh</th>
          <th scope="col" class="text-right">Revisi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="10" class="py-8 text-center" role="status">Memuat selisih stok…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="10" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="10" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada selisih tercatat pada filter ini.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="whitespace-nowrap text-[11px]">{{ formatDateTime(row.createdAt) }}</td>
            <td class="font-mono text-[12px] font-medium">{{ row.sku }}</td>
            <td class="min-w-[180px]">{{ row.productName }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatQuantity(row.systemQty) }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatQuantity(row.physicalQty) }}</td>
            <td class="num whitespace-nowrap text-right font-semibold">
              <span :class="row.differenceQty > 0 ? 'text-[#0b5a4f]' : 'text-[var(--color-danger)]'">
                {{ signed(row.differenceQty) }}
              </span>
              <span class="ml-1 text-[11px] text-[var(--color-muted)]">{{ row.unitLabel }}</span>
            </td>
            <td class="min-w-[160px]">
              {{ opnameReasonLabel(row.reasonCode) }}
              <span v-if="row.reasonNote" class="block text-[11px] text-[var(--color-muted)]">
                {{ row.reasonNote }}
              </span>
            </td>
            <td class="whitespace-nowrap">{{ row.createdByLabel }}</td>
            <td class="whitespace-nowrap">
              <span v-if="row.approvedByLabel">{{ row.approvedByLabel }}</span>
              <span v-else class="tag tag-warn">Belum disetujui</span>
            </td>
            <td class="num whitespace-nowrap text-right">{{ row.revision }}</td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
