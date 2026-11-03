<script setup lang="ts">
import { computed } from 'vue'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useAuditLogs } from '~/composables/useAudit'
import { AUDIT_ACTION_LABELS, auditActionLabel, auditCsv } from '~/types/audit'
import { AUDIT_ENTITIES } from '~/services/audit'
import { downloadCsv } from '~/utils/download'
import AuditTable from '~/components/audit/AuditTable.vue'

definePageMeta({ capability: 'users.manage' })
useHead({ title: 'Audit log · Toko Sinar Soleha POS' })

const client = useSupabaseClient()
const {
  rows,
  total,
  page,
  pageSize,
  filters,
  loading,
  error,
  totalPages,
  canGoPrevious,
  canGoNext,
  rangeStart,
  rangeEnd,
  setPage,
  setPageSize,
  resetFilters,
  refresh,
} = useAuditLogs(client)

const actionOptions = computed(() =>
  Object.keys(AUDIT_ACTION_LABELS).map((value) => ({
    value,
    label: auditActionLabel(value),
  })),
)

function exportPage(): void {
  downloadCsv(`audit-log-halaman-${page.value}.csv`, auditCsv(rows.value))
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Audit log</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Catatan perubahan yang ditulis server: profil, harga beli, katalog, impor, opname, dan
        transaksi. Tabel ini append-only — tidak ada tombol ubah atau hapus.
      </p>
    </div>

    <section class="panel" aria-labelledby="audit-filter-title">
      <div class="panel-head">
        <h2 id="audit-filter-title" class="panel-title">Filter audit</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ total.toLocaleString('id-ID') }} baris
        </span>
      </div>

      <div class="grid gap-2 px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="field-label" for="audit-action">Aksi</label>
          <select id="audit-action" v-model="filters.actionKey" class="field">
            <option value="">Semua aksi</option>
            <option v-for="option in actionOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="audit-entity">Entitas</label>
          <select id="audit-entity" v-model="filters.entityName" class="field">
            <option value="">Semua entitas</option>
            <option v-for="entity in AUDIT_ENTITIES" :key="entity" :value="entity">
              {{ entity }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="audit-from">Dari tanggal</label>
          <input id="audit-from" v-model="filters.dateFrom" class="field" type="date" />
        </div>

        <div>
          <label class="field-label" for="audit-to">Sampai tanggal</label>
          <input id="audit-to" v-model="filters.dateTo" class="field" type="date" />
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] px-3 py-2">
        <div class="w-20">
          <label class="field-label" for="audit-page-size">Baris</label>
          <select
            id="audit-page-size"
            class="field"
            :value="pageSize"
            @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"
          >
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
        <button class="btn ml-auto" type="button" :disabled="loading" @click="resetFilters">
          Reset filter
        </button>
      </div>
    </section>

    <section class="panel" aria-labelledby="audit-list-title">
      <div class="panel-head">
        <h2 id="audit-list-title" class="panel-title">Catatan audit</h2>
        <div class="flex items-center gap-2">
          <span class="num text-[11px] text-[var(--color-muted)]">
            {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
          </span>
          <button
            class="btn text-[11px]"
            type="button"
            :disabled="loading || rows.length === 0"
            @click="exportPage"
          >
            Ekspor halaman (CSV)
          </button>
        </div>
      </div>

      <AuditTable :rows="rows" :loading="loading" :error="error" />

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2">
        <p class="text-[11px] text-[var(--color-muted)]">
          Halaman {{ page }} dari {{ totalPages }} · {{ pageSize }} baris per halaman. Ekspor CSV
          memuat baris halaman ini saja, bukan seluruh hasil filter.
        </p>
        <div class="flex gap-2">
          <button class="btn" type="button" :disabled="!canGoPrevious || loading" @click="setPage(page - 1)">
            Sebelumnya
          </button>
          <button class="btn" type="button" :disabled="!canGoNext || loading" @click="setPage(page + 1)">
            Berikutnya
          </button>
          <button class="btn" type="button" :disabled="loading" @click="refresh">Muat ulang</button>
        </div>
      </div>
    </section>

    <p class="text-[11px] text-[var(--color-muted)]">
      Pelaku ditampilkan dari nama profil saat ini. Bila profil dihapus, kolom pelaku menjadi id
      pendek atau “Sistem”. Data sebelum/sesudah adalah snapshot JSON yang ditulis RPC.
    </p>
  </div>
</template>
