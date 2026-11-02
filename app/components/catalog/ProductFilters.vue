<script setup lang="ts">
import type { CategoryOption, UnitOption } from '~/types/catalog'

defineProps<{
  categories: CategoryOption[]
  units: UnitOption[]
  total: number
  loading: boolean
}>()

const emit = defineEmits<{ reset: [] }>()

const search = defineModel<string>('search', { required: true })
const categoryId = defineModel<number | null>('categoryId', { required: true })
const unitId = defineModel<number | null>('unitId', { required: true })
const active = defineModel<'all' | 'active' | 'inactive'>('active', { required: true })
const missingPrice = defineModel<boolean>('missingPrice', { required: true })
const unknownStock = defineModel<boolean>('unknownStock', { required: true })
const negativeStock = defineModel<boolean>('negativeStock', { required: true })
const reviewStatus = defineModel<string>('reviewStatus', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
</script>

<template>
  <section class="panel" aria-labelledby="catalog-filter-title">
    <div class="panel-head">
      <h2 id="catalog-filter-title" class="panel-title">Filter katalog</h2>
      <span class="num text-[11px] text-[var(--color-muted)]">
        {{ total.toLocaleString('id-ID') }} produk
      </span>
    </div>

    <div class="space-y-3 px-3 py-3">
      <div>
        <label class="field-label" for="catalog-search">Cari produk</label>
        <input
          id="catalog-search"
          v-model="search"
          class="field"
          type="search"
          autocomplete="off"
          spellcheck="false"
          placeholder="SKU persis, awalan SKU, atau potongan nama"
        />
        <p class="mt-1 text-[11px] text-[var(--color-muted)]">
          Pencarian SKU diprioritaskan; nama dicari tanpa membedakan huruf besar/kecil.
        </p>
      </div>

      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <label class="field-label" for="catalog-category">Kategori</label>
          <select id="catalog-category" v-model="categoryId" class="field">
            <option :value="null">Semua kategori</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}{{ category.isActive ? '' : ' (nonaktif)' }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="catalog-unit">Satuan</label>
          <select id="catalog-unit" v-model="unitId" class="field">
            <option :value="null">Semua satuan</option>
            <option v-for="unit in units" :key="unit.id" :value="unit.id">
              {{ unit.label }} ({{ unit.code }}){{ unit.isActive ? '' : ' (nonaktif)' }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="catalog-active">Status produk</label>
          <select id="catalog-active" v-model="active" class="field">
            <option value="all">Semua status</option>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
          </select>
        </div>

        <div>
          <label class="field-label" for="catalog-review">Status review</label>
          <select id="catalog-review" v-model="reviewStatus" class="field">
            <option value="">Semua review</option>
            <option value="review">Perlu pemeriksaan</option>
            <option value="verified">Terverifikasi</option>
            <option value="stock_unknown">Stok belum diketahui</option>
            <option value="negative_opening_stock">Stok awal negatif</option>
            <option value="price_missing">Harga jual belum tersedia</option>
            <option value="review_required">Review wajib</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--color-line)] pt-2 text-[12px]">
        <label class="inline-flex cursor-pointer items-center gap-1.5">
          <input v-model="missingPrice" type="checkbox" />
          Harga jual kosong
        </label>
        <label class="inline-flex cursor-pointer items-center gap-1.5">
          <input v-model="unknownStock" type="checkbox" />
          Stok belum diketahui
        </label>
        <label class="inline-flex cursor-pointer items-center gap-1.5">
          <input v-model="negativeStock" type="checkbox" />
          Stok negatif
        </label>

        <div class="ml-auto flex items-end gap-2">
          <div>
            <label class="field-label" for="catalog-page-size">Baris</label>
            <select id="catalog-page-size" v-model="pageSize" class="field w-20">
              <option :value="25">25</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
          <button class="btn" type="button" :disabled="loading" @click="emit('reset')">
            Reset filter
          </button>
        </div>
      </div>
    </div>
  </section>
</template>
