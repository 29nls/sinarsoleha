<script setup lang="ts">
import type { StockStateFilter } from '~/types/inventory'
import { STOCK_STATE_FILTER_LABELS } from '~/types/inventory'

defineProps<{
  total: number
  loading: boolean
}>()

const emit = defineEmits<{ reset: [] }>()

const search = defineModel<string>('search', { required: true })
const state = defineModel<StockStateFilter>('state', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
</script>

<template>
  <section class="panel" aria-labelledby="balance-filter-title">
    <div class="panel-head">
      <h2 id="balance-filter-title" class="panel-title">Filter saldo</h2>
      <span class="num text-[11px] text-[var(--color-muted)]">
        {{ total.toLocaleString('id-ID') }} produk
      </span>
    </div>

    <div class="grid gap-2 px-3 py-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="sm:col-span-2">
        <label class="field-label" for="balance-search">Cari SKU atau nama</label>
        <input
          id="balance-search"
          v-model="search"
          class="field"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="Contoh: BERAS atau 899…"
        />
      </div>

      <div>
        <label class="field-label" for="balance-state">Saldo</label>
        <select id="balance-state" v-model="state" class="field">
          <option
            v-for="(label, value) in STOCK_STATE_FILTER_LABELS"
            :key="value"
            :value="value"
          >
            {{ label }}
          </option>
        </select>
      </div>

      <div class="flex items-end gap-2">
        <div class="w-20">
          <label class="field-label" for="balance-page-size">Baris</label>
          <select id="balance-page-size" v-model.number="pageSize" class="field">
            <option :value="25">25</option>
            <option :value="50">50</option>
            <option :value="100">100</option>
          </select>
        </div>
        <button class="btn" type="button" :disabled="loading" @click="emit('reset')">
          Reset
        </button>
      </div>
    </div>
  </section>
</template>
