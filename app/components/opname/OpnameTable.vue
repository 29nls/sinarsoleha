<script setup lang="ts">
import type { OpnameListRow } from '~/types/opname'
import { opnameStatusLabel } from '~/types/opname'
import { formatDateTime } from '~/utils/format'

defineProps<{
  rows: OpnameListRow[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  open: [row: OpnameListRow]
}>()

function statusClass(status: string): string {
  if (status === 'posted') return 'tag tag-accent'
  if (status === 'cancelled') return 'tag'
  if (status === 'counting') return 'tag tag-warn'
  if (status === 'approved') return 'tag tag-accent'
  return 'tag'
}

function progressLabel(row: OpnameListRow): string {
  if (row.itemCount === 0) return '—'
  return `${row.countedCount}/${row.itemCount}`
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[720px]" :aria-busy="loading">
      <caption class="sr-only">Daftar sesi stok opname</caption>
      <thead>
        <tr>
          <th scope="col">Nomor</th>
          <th scope="col">Status</th>
          <th scope="col">Cakupan</th>
          <th scope="col" class="text-right">Dihitung</th>
          <th scope="col" class="text-right">Perlu ulang</th>
          <th scope="col">Dibuat</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="py-8 text-center" role="status">Memuat sesi opname…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="7" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="7" class="py-8 text-center text-[var(--color-muted)]">
            Belum ada sesi opname.
          </td>
        </tr>
        <template v-else>
          <tr v-for="row in rows" :key="row.id">
            <td class="font-mono text-[12px] font-medium whitespace-nowrap">{{ row.opnameNo }}</td>
            <td>
              <span :class="statusClass(row.status)">{{ opnameStatusLabel(row.status) }}</span>
            </td>
            <td class="max-w-[280px] truncate" :title="row.scopeNote ?? ''">
              {{ row.scopeNote ?? 'Seluruh katalog' }}
            </td>
            <td class="num text-right whitespace-nowrap">{{ progressLabel(row) }}</td>
            <td class="num text-right">
              <span v-if="row.recountCount > 0" class="tag tag-danger">
                {{ row.recountCount }}
              </span>
              <span v-else class="text-[var(--color-muted)]">—</span>
            </td>
            <td class="whitespace-nowrap text-[12px]">{{ formatDateTime(row.createdAt) }}</td>
            <td class="whitespace-nowrap text-right">
              <button class="btn px-1.5 py-0.5 text-[11px]" type="button" @click="emit('open', row)">
                Buka
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
