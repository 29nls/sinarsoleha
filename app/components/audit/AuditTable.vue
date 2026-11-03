<script setup lang="ts">
import { ref } from 'vue'
import type { AuditRow } from '~/types/audit'
import { auditActionLabel, summarizeAuditData } from '~/types/audit'
import { formatDateTime } from '~/utils/format'

defineProps<{
  rows: AuditRow[]
  loading: boolean
  error: string | null
}>()

const expanded = ref<Set<number>>(new Set())

function toggle(id: number): void {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '—'
  }
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[980px]" :aria-busy="loading">
      <caption class="sr-only">Audit log perubahan data</caption>
      <thead>
        <tr>
          <th scope="col">Waktu</th>
          <th scope="col">Pelaku</th>
          <th scope="col">Aksi</th>
          <th scope="col">Entitas</th>
          <th scope="col">ID entitas</th>
          <th scope="col">Alasan</th>
          <th scope="col">Perubahan</th>
          <th scope="col" class="text-right">Detail</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="py-8 text-center" role="status">Memuat audit log…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="8" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="rows.length === 0">
          <td colspan="8" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada catatan audit pada filter ini.
          </td>
        </tr>
        <template v-else>
          <template v-for="row in rows" :key="row.id">
            <tr>
              <td class="whitespace-nowrap text-[11px]">{{ formatDateTime(row.createdAt) }}</td>
              <td class="whitespace-nowrap">{{ row.actorLabel }}</td>
              <td class="whitespace-nowrap">
                <span class="font-medium">{{ auditActionLabel(row.actionKey) }}</span>
                <span class="block font-mono text-[11px] text-[var(--color-muted)]">
                  {{ row.actionKey }}
                </span>
              </td>
              <td class="whitespace-nowrap font-mono text-[12px]">{{ row.entityName }}</td>
              <td class="max-w-[180px] truncate font-mono text-[11px]">
                {{ row.entityId ?? '—' }}
              </td>
              <td class="min-w-[140px]">{{ row.reason ?? '—' }}</td>
              <td class="max-w-[260px] text-[11px] text-[var(--color-muted)]">
                {{ summarizeAuditData(row.afterData) }}
              </td>
              <td class="whitespace-nowrap text-right">
                <button
                  class="btn px-1.5 py-0.5 text-[11px]"
                  type="button"
                  :aria-expanded="expanded.has(row.id)"
                  @click="toggle(row.id)"
                >
                  {{ expanded.has(row.id) ? 'Tutup' : 'Lihat' }}
                </button>
              </td>
            </tr>
            <tr v-if="expanded.has(row.id)">
              <td colspan="8" class="bg-[#fafbfc]">
                <div class="grid gap-3 py-1 lg:grid-cols-2">
                  <div>
                    <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Sebelum
                    </p>
                    <pre class="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed">{{ pretty(row.beforeData) }}</pre>
                  </div>
                  <div>
                    <p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                      Sesudah
                    </p>
                    <pre class="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed">{{ pretty(row.afterData) }}</pre>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </template>
      </tbody>
    </table>
  </div>
</template>
