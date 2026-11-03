<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useStockDiscrepancies } from '~/composables/useInventory'
import { OPNAME_REASONS, OPNAME_REASON_LABELS } from '~/types/opname'
import DiscrepancyTable from '~/components/inventory/DiscrepancyTable.vue'
import InventoryTabs from '~/components/inventory/InventoryTabs.vue'

definePageMeta({ capability: 'inventory.read' })
useHead({ title: 'Selisih stok · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()

const {
  rows,
  total,
  page,
  pageSize,
  searchInput,
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
} = useStockDiscrepancies({
  client,
  currentUserId: () => auth.profile?.id ?? '',
})

const reasonOptions = computed(() =>
  OPNAME_REASONS.map((value) => ({ value, label: OPNAME_REASON_LABELS[value] ?? value })),
)
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Selisih stok</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Catatan selisih hasil opname beserta alasan dan persetujuannya. Baris di sini tidak dapat diubah.
      </p>
    </div>

    <InventoryTabs />

    <section class="panel" aria-labelledby="discrepancy-filter-title">
      <div class="panel-head">
        <h2 id="discrepancy-filter-title" class="panel-title">Filter selisih</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ total.toLocaleString('id-ID') }} baris
        </span>
      </div>

      <div class="grid gap-2 px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="field-label" for="discrepancy-search">Cari SKU atau nama</label>
          <input
            id="discrepancy-search"
            v-model="searchInput"
            class="field"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="SKU atau nama produk"
          />
        </div>

        <div>
          <label class="field-label" for="discrepancy-reason">Alasan</label>
          <select id="discrepancy-reason" v-model="filters.reasonCode" class="field">
            <option value="">Semua alasan</option>
            <option v-for="option in reasonOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="discrepancy-from">Dari tanggal</label>
          <input id="discrepancy-from" v-model="filters.dateFrom" class="field" type="date" />
        </div>

        <div>
          <label class="field-label" for="discrepancy-to">Sampai tanggal</label>
          <input id="discrepancy-to" v-model="filters.dateTo" class="field" type="date" />
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] px-3 py-2">
        <div class="w-20">
          <label class="field-label" for="discrepancy-page-size">Baris</label>
          <select
            id="discrepancy-page-size"
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

    <section class="panel" aria-labelledby="discrepancy-list-title">
      <div class="panel-head">
        <h2 id="discrepancy-list-title" class="panel-title">Laporan selisih</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
      </div>

      <DiscrepancyTable :rows="rows" :loading="loading" :error="error" />

      <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2">
        <p class="text-[11px] text-[var(--color-muted)]">
          Halaman {{ page }} dari {{ totalPages }} · {{ pageSize }} baris per halaman
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
  </div>
</template>
