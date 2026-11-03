<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useOpnameList } from '~/composables/useOpnameList'
import { createOpname } from '~/services/opname'
import { listCategories, listProducts } from '~/services/catalog'
import type { CatalogProduct, CategoryOption } from '~/types/catalog'
import type { OpnameListRow, OpnameStatus } from '~/types/opname'
import {
  OPNAME_STATUS_LABELS,
  describeOpnameError,
  validateScopeNote,
} from '~/types/opname'
import { createDebouncer } from '~/utils/catalog'
import OpnameTable from '~/components/opname/OpnameTable.vue'
import OpnameCreateDialog from '~/components/opname/OpnameCreateDialog.vue'

definePageMeta({ capability: 'opname.count' })
useHead({ title: 'Stok Opname · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()
const canCreate = computed(() => auth.allows('opname.create'))

const list = useOpnameList({ client })
const {
  rows,
  total,
  page,
  pageSize,
  status,
  searchInput,
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
} = list

const statusOptions: Array<{ value: OpnameStatus | ''; label: string }> = [
  { value: '', label: 'Semua status' },
  ...(Object.entries(OPNAME_STATUS_LABELS) as Array<[OpnameStatus, string]>).map(
    ([value, label]) => ({ value, label }),
  ),
]

// --- create dialog ---------------------------------------------------------

const createOpen = ref(false)
const createSaving = ref(false)
const createError = ref<string | null>(null)
const categories = ref<CategoryOption[]>([])
const productSearch = ref('')
const productResults = ref<CatalogProduct[]>([])
const productSearchLoading = ref(false)

const productDebouncer = createDebouncer<string>(250, (value) => {
  void searchProducts(value)
})

watch(productSearch, (value) => {
  productDebouncer.schedule(value)
})

async function searchProducts(term: string): Promise<void> {
  productSearchLoading.value = true
  try {
    const result = await listProducts(client, {
      search: term.trim(),
      categoryId: null,
      unitId: null,
      active: 'all',
      missingPrice: false,
      unknownStock: false,
      negativeStock: false,
      reviewStatus: '',
      page: 1,
      pageSize: 25,
    })
    productResults.value = result.products
  } catch (cause) {
    createError.value = cause instanceof Error ? cause.message : 'Gagal mencari produk.'
    productResults.value = []
  } finally {
    productSearchLoading.value = false
  }
}

async function openCreate(): Promise<void> {
  createError.value = null
  createOpen.value = true
  productSearch.value = ''
  productResults.value = []

  try {
    categories.value = await listCategories(client)
  } catch (cause) {
    createError.value = cause instanceof Error ? cause.message : 'Gagal memuat kategori.'
  }

  await searchProducts('')
}

async function submitCreate(payload: {
  scopeNote: string
  categoryId: number | null
  productIds: string[]
}): Promise<void> {
  const noteError = validateScopeNote(payload.scopeNote)
  if (noteError) {
    createError.value = noteError
    return
  }

  createSaving.value = true
  createError.value = null
  try {
    const result = await createOpname(client, {
      idempotencyKey: crypto.randomUUID(),
      scopeNote: payload.scopeNote,
      productIds: payload.productIds,
      categoryId: payload.categoryId,
      excludeProductIds: [],
    })
    createOpen.value = false
    await navigateTo(`/stock-opname/${result.opnameId}`)
  } catch (cause) {
    createError.value = describeOpnameError(cause)
  } finally {
    createSaving.value = false
  }
}

function openSession(row: OpnameListRow): void {
  void navigateTo(`/stock-opname/${row.id}`)
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Stok Opname</h1>
        <p class="text-[12px] text-[var(--color-muted)]">
          Hitung fisik, catat selisih, lalu ajukan persetujuan. Stok baru berubah setelah owner memposting.
        </p>
      </div>
      <button
        v-if="canCreate"
        class="btn btn-primary"
        type="button"
        @click="openCreate"
      >
        Sesi baru
      </button>
    </div>

    <div v-if="!canCreate" class="notice">
      Anda dapat menghitung dan melihat sesi, tetapi hanya owner yang dapat membuat sesi baru.
    </div>

    <section class="panel" aria-labelledby="opname-filter-title">
      <div class="panel-head">
        <h2 id="opname-filter-title" class="panel-title">Filter sesi</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ total.toLocaleString('id-ID') }} sesi
        </span>
      </div>

      <div class="grid gap-2 px-3 py-3 sm:grid-cols-2 xl:grid-cols-3">
        <div>
          <label class="field-label" for="opname-search">Cari nomor opname</label>
          <input
            id="opname-search"
            v-model="searchInput"
            class="field"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="Contoh: OPN-20261104"
          >
        </div>

        <div>
          <label class="field-label" for="opname-status">Status</label>
          <select id="opname-status" v-model="status" class="field">
            <option v-for="option in statusOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="flex items-end gap-2">
          <div class="flex-1">
            <label class="field-label" for="opname-page-size">Baris</label>
            <select
              id="opname-page-size"
              class="field"
              :value="pageSize"
              @change="setPageSize(Number(($event.target as HTMLSelectElement).value))"
            >
              <option :value="20">20</option>
              <option :value="50">50</option>
              <option :value="100">100</option>
            </select>
          </div>
          <button class="btn" type="button" :disabled="loading" @click="resetFilters">Reset</button>
        </div>
      </div>
    </section>

    <section class="panel" aria-labelledby="opname-list-title">
      <div class="panel-head">
        <h2 id="opname-list-title" class="panel-title">Daftar sesi</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
      </div>

      <OpnameTable :rows="rows" :loading="loading" :error="error" @open="openSession" />

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

    <OpnameCreateDialog
      :open="createOpen"
      :saving="createSaving"
      :error="createError"
      :categories="categories"
      :search-results="productResults"
      :search-loading="productSearchLoading"
      :search="productSearch"
      @close="createOpen = false"
      @update:search="productSearch = $event"
      @submit="submitCreate"
    />
  </div>
</template>
