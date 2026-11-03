<script setup lang="ts">
import type { TransactionListFilters } from '~/types/transactions'

defineProps<{
  total: number
  loading: boolean
  isOwner: boolean
}>()

const emit = defineEmits<{ reset: [] }>()

const search = defineModel<string>('search', { required: true })
const dateFrom = defineModel<string>('dateFrom', { required: true })
const dateTo = defineModel<string>('dateTo', { required: true })
const status = defineModel<TransactionListFilters['status']>('status', { required: true })
const paymentMethod = defineModel<TransactionListFilters['paymentMethod']>('paymentMethod', { required: true })
const cashierId = defineModel<string>('cashierId', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
</script>

<template>
  <section class="panel" aria-labelledby="txn-filter-title">
    <div class="panel-head">
      <h2 id="txn-filter-title" class="panel-title">Filter transaksi</h2>
      <span class="num text-[11px] text-[var(--color-muted)]">
        {{ total.toLocaleString('id-ID') }} transaksi
      </span>
    </div>

    <div class="space-y-3 px-3 py-3">
      <div>
        <label class="field-label" for="txn-search">Cari nota</label>
        <input
          id="txn-search"
          v-model="search"
          class="field"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Nomor nota"
        />
      </div>

      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="field-label" for="txn-date-from">Dari tanggal</label>
          <input id="txn-date-from" v-model="dateFrom" class="field" type="date" />
        </div>

        <div>
          <label class="field-label" for="txn-date-to">Sampai tanggal</label>
          <input id="txn-date-to" v-model="dateTo" class="field" type="date" />
        </div>

        <div>
          <label class="field-label" for="txn-status">Status</label>
          <select id="txn-status" v-model="status" class="field">
            <option value="">Semua status</option>
            <option value="completed">Selesai</option>
            <option value="voided">Dibatalkan</option>
          </select>
        </div>

        <div>
          <label class="field-label" for="txn-payment">Pembayaran</label>
          <select id="txn-payment" v-model="paymentMethod" class="field">
            <option value="">Semua metode</option>
            <option value="cash">Tunai</option>
            <option value="qris">QRIS</option>
            <option value="other">Lainnya</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-end gap-2 border-t border-[var(--color-line)] pt-2">
        <div>
          <label class="field-label" for="txn-page-size">Baris</label>
          <select id="txn-page-size" v-model="pageSize" class="field w-20">
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
        <button class="btn ml-auto" type="button" :disabled="loading" @click="emit('reset')">
          Reset filter
        </button>
      </div>
    </div>
  </section>
</template>
