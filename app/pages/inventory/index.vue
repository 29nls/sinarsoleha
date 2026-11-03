<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useStockBalances } from '~/composables/useInventory'
import type { StockBalanceRow } from '~/types/inventory'
import StockBalanceFilters from '~/components/inventory/StockBalanceFilters.vue'
import StockBalanceTable from '~/components/inventory/StockBalanceTable.vue'
import InventoryTabs from '~/components/inventory/InventoryTabs.vue'

definePageMeta({ capability: 'inventory.read' })
useHead({ title: 'Inventaris · Toko Sinar Soleha POS' })

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
} = useStockBalances({
  client,
  currentUserId: () => auth.profile?.id ?? '',
})

function openHistory(row: StockBalanceRow): void {
  void navigateTo({ path: '/inventory/movements', query: { product: row.sku } })
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Inventaris</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Saldo stok per produk, histori pergerakan, dan selisih hasil opname. Data hanya dapat dibaca;
        stok berubah lewat penjualan dan posting opname.
      </p>
    </div>

    <InventoryTabs />

    <StockBalanceFilters
      v-model:search="searchInput"
      v-model:state="filters.state"
      :page-size="pageSize"
      :total="total"
      @update:page-size="setPageSize"
      :loading="loading"
      @reset="resetFilters"
    />

    <section class="panel" aria-labelledby="balance-list-title">
      <div class="panel-head">
        <h2 id="balance-list-title" class="panel-title">Saldo stok</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
      </div>

      <StockBalanceTable :rows="rows" :loading="loading" :error="error" @open="openHistory" />

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

    <p class="text-[11px] text-[var(--color-muted)]">
      Stok bertanda “—” berarti saldo belum pernah diketahui, bukan nol. Catat lewat Stok Opname
      agar menjadi saldo awal.
    </p>
  </div>
</template>
