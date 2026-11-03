<script setup lang="ts">
import type { TransactionListRow } from '~/types/transactions'
import { useAuthStore } from '~/stores/auth'
import { useTransactionHistory } from '~/composables/useTransactionHistory'
import TransactionFilters from '~/components/transactions/TransactionFilters.vue'
import TransactionTable from '~/components/transactions/TransactionTable.vue'

definePageMeta({ capability: 'sale.read.own' })

const auth = useAuthStore()
const client = useSupabaseClient()
const router = useRouter()

const isOwner = () => auth.role === 'owner'
const currentUserId = () => auth.profile?.id ?? ''
const currentUserName = () => auth.profile?.full_name ?? 'Kasir'

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
} = useTransactionHistory({ client, isOwner, currentUserId, currentUserName })

function viewDetail(row: TransactionListRow) {
  router.push(`/cashier/transactions/${row.id}`)
}
</script>

<template>
  <div class="mx-auto max-w-[1100px] space-y-3 p-4">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-[18px] font-bold">Riwayat Transaksi</h1>
      <NuxtLink to="/cashier" class="btn text-[12px]">Kembali ke Kasir</NuxtLink>
    </div>

    <TransactionFilters
      v-model:search="searchInput"
      v-model:date-from="filters.dateFrom"
      v-model:date-to="filters.dateTo"
      v-model:status="filters.status"
      v-model:payment-method="filters.paymentMethod"
      v-model:cashier-id="filters.cashierId"
      v-model:page-size="pageSize"
      :total="total"
      :loading="loading"
      :is-owner="isOwner()"
      @reset="resetFilters"
    />

    <section class="panel">
      <TransactionTable
        :rows="rows"
        :loading="loading"
        :error="error"
        :page="page"
        :page-size="pageSize"
        :total="total"
        :is-owner="isOwner()"
        @view="viewDetail"
      />

      <div
        v-if="!loading && !error && total > 0"
        class="flex items-center justify-between border-t border-[var(--color-line)] px-3 py-2"
      >
        <span class="text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
        <div class="flex gap-1">
          <button
            class="btn px-2 py-0.5 text-[11px]"
            type="button"
            :disabled="!canGoPrevious"
            @click="setPage(page - 1)"
          >
            Sebelumnya
          </button>
          <button
            class="btn px-2 py-0.5 text-[11px]"
            type="button"
            :disabled="!canGoNext"
            @click="setPage(page + 1)"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </section>
  </div>
</template>
