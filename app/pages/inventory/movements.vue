<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useStockMovements } from '~/composables/useInventory'
import { MOVEMENT_TYPES, MOVEMENT_TYPE_LABELS } from '~/types/inventory'
import MovementTable from '~/components/inventory/MovementTable.vue'
import InventoryTabs from '~/components/inventory/InventoryTabs.vue'

definePageMeta({ capability: 'inventory.read' })
useHead({ title: 'Pergerakan stok · Toko Sinar Soleha POS' })

const route = useRoute()
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
} = useStockMovements({
  client,
  currentUserId: () => auth.profile?.id ?? '',
})

const typeOptions = computed(() =>
  MOVEMENT_TYPES.map((value) => ({ value, label: MOVEMENT_TYPE_LABELS[value] ?? value })),
)

// The saldo table links here with ?product=SKU; seed the search once so the
// user lands on that product's history without an extra click.
const seeded = ref(false)
watch(
  () => route.query.product,
  (value) => {
    if (seeded.value || typeof value !== 'string' || !value.trim()) return
    seeded.value = true
    searchInput.value = value.trim()
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pergerakan stok</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Setiap perubahan saldo tercatat permanen: penjualan, pembatalan, penyesuaian opname, dan koreksi manual.
      </p>
    </div>

    <InventoryTabs />

    <section class="panel" aria-labelledby="movement-filter-title">
      <div class="panel-head">
        <h2 id="movement-filter-title" class="panel-title">Filter pergerakan</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ total.toLocaleString('id-ID') }} baris
        </span>
      </div>

      <div class="grid gap-2 px-3 py-3 sm:grid-cols-2 xl:grid-cols-5">
        <div class="xl:col-span-2">
          <label class="field-label" for="movement-search">Cari SKU atau nama</label>
          <input
            id="movement-search"
            v-model="searchInput"
            class="field"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="SKU atau nama produk"
          />
        </div>

        <div>
          <label class="field-label" for="movement-type">Jenis</label>
          <select id="movement-type" v-model="filters.movementType" class="field">
            <option value="">Semua jenis</option>
            <option v-for="option in typeOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="movement-from">Dari tanggal</label>
          <input id="movement-from" v-model="filters.dateFrom" class="field" type="date" />
        </div>

        <div>
          <label class="field-label" for="movement-to">Sampai tanggal</label>
          <input id="movement-to" v-model="filters.dateTo" class="field" type="date" />
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] px-3 py-2">
        <div class="w-20">
          <label class="field-label" for="movement-page-size">Baris</label>
          <select
            id="movement-page-size"
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

    <section class="panel" aria-labelledby="movement-list-title">
      <div class="panel-head">
        <h2 id="movement-list-title" class="panel-title">Histori pergerakan</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
      </div>

      <MovementTable :rows="rows" :loading="loading" :error="error" />

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
