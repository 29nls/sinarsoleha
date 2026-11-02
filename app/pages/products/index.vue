<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useProductCatalog } from '~/composables/useProductCatalog'
import {
  setProductCost,
  upsertCategory,
  upsertProduct,
} from '~/services/catalog'
import {
  buildProductRpcPayload,
  describeCatalogError,
  productPayloadFromCatalog,
} from '~/utils/catalog'
import type { CatalogProduct, CategoryFormValues, ProductFormValues } from '~/types/catalog'
import ProductFilters from '~/components/catalog/ProductFilters.vue'
import ProductTable from '~/components/catalog/ProductTable.vue'
import ProductFormDialog from '~/components/catalog/ProductFormDialog.vue'
import ProductCostDialog from '~/components/catalog/ProductCostDialog.vue'
import CategoryManagerDialog from '~/components/catalog/CategoryManagerDialog.vue'

definePageMeta({ capability: 'catalog.read' })
useHead({ title: 'Produk · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const client = useSupabaseClient()
const isOwner = computed(() => auth.role === 'owner')

const catalog = useProductCatalog({
  client,
  isOwner: () => isOwner.value,
})

const {
  products,
  categories,
  units,
  total,
  page,
  pageSize,
  searchInput,
  filters,
  loading,
  referenceLoading,
  error,
  referenceError,
  totalPages,
  rangeStart,
  rangeEnd,
  canGoPrevious,
  canGoNext,
  refresh,
  setPage,
  setPageSize,
  resetFilters,
} = catalog

const actionError = ref<string | null>(null)

const formOpen = ref(false)
const editingProduct = ref<CatalogProduct | null>(null)
const formSaving = ref(false)
const formError = ref<string | null>(null)

const costOpen = ref(false)
const costingProduct = ref<CatalogProduct | null>(null)
const costSaving = ref(false)
const costError = ref<string | null>(null)

const categoryOpen = ref(false)
const categorySaving = ref(false)
const categoryError = ref<string | null>(null)

function openCreate() {
  editingProduct.value = null
  formError.value = null
  formOpen.value = true
}

function openEdit(product: CatalogProduct) {
  editingProduct.value = product
  formError.value = null
  formOpen.value = true
}

function openCost(product: CatalogProduct) {
  costingProduct.value = product
  costError.value = null
  costOpen.value = true
}

async function saveProduct(values: ProductFormValues) {
  formSaving.value = true
  formError.value = null
  try {
    await upsertProduct(client, buildProductRpcPayload(values))
    formOpen.value = false
    await refresh()
  } catch (cause) {
    formError.value = describeCatalogError(cause)
  } finally {
    formSaving.value = false
  }
}

async function deactivateProduct(product: CatalogProduct) {
  if (!product.isActive) return
  if (!window.confirm(`Nonaktifkan ${product.sku} · ${product.name}? Produk tidak dihapus dan stok tidak berubah.`)) {
    return
  }
  actionError.value = null
  try {
    await upsertProduct(client, productPayloadFromCatalog(product, { isActive: false }))
    await refresh()
  } catch (cause) {
    actionError.value = describeCatalogError(cause)
  }
}

async function saveCost(payload: { productId: string; purchaseCost: number | null }) {
  costSaving.value = true
  costError.value = null
  try {
    await setProductCost(client, payload.productId, payload.purchaseCost)
    costOpen.value = false
    await refresh()
  } catch (cause) {
    costError.value = describeCatalogError(cause)
  } finally {
    costSaving.value = false
  }
}

async function saveCategory(values: CategoryFormValues) {
  categorySaving.value = true
  categoryError.value = null
  try {
    await upsertCategory(client, {
      category_id: values.categoryId,
      name: values.name,
      is_active: values.isActive,
    })
    await refresh()
  } catch (cause) {
    categoryError.value = describeCatalogError(cause)
  } finally {
    categorySaving.value = false
  }
}

function openCategories() {
  categoryError.value = null
  categoryOpen.value = true
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h1 class="text-lg font-semibold tracking-tight">Produk</h1>
        <p class="text-[12px] text-[var(--color-muted)]">
          Katalog berbasis teks. Tanpa foto, tanpa perubahan stok dari halaman ini.
        </p>
      </div>
      <div v-if="isOwner" class="flex flex-wrap gap-2">
        <button class="btn" type="button" @click="openCategories">Kategori</button>
        <button class="btn btn-primary" type="button" @click="openCreate">Tambah produk</button>
      </div>
    </div>

    <div v-if="!isOwner" class="notice">
      Anda dapat mencari dan melihat katalog. Harga beli, masalah data, dan pengelolaan produk hanya untuk owner.
    </div>

    <div v-if="actionError" class="notice notice-error" role="alert">{{ actionError }}</div>
    <div v-if="referenceError" class="notice notice-error" role="alert">
      Gagal memuat kategori atau satuan: {{ referenceError }}
    </div>

    <ProductFilters
      v-model:search="searchInput"
      v-model:category-id="filters.categoryId"
      v-model:unit-id="filters.unitId"
      v-model:active="filters.active"
      v-model:missing-price="filters.missingPrice"
      v-model:unknown-stock="filters.unknownStock"
      v-model:negative-stock="filters.negativeStock"
      v-model:review-status="filters.reviewStatus"
      :page-size="pageSize"
      :categories="categories"
      :units="units"
      :total="total"
      :loading="loading || referenceLoading"
      @update:page-size="setPageSize"
      @reset="resetFilters"
    />

    <section class="panel" aria-labelledby="product-list-title">
      <div class="panel-head">
        <h2 id="product-list-title" class="panel-title">Daftar produk</h2>
        <span class="num text-[11px] text-[var(--color-muted)]">
          {{ rangeStart }}–{{ rangeEnd }} dari {{ total }}
        </span>
      </div>

      <ProductTable
        :products="products"
        :loading="loading"
        :error="error"
        :is-owner="isOwner"
        :page="page"
        :page-size="pageSize"
        :total="total"
        @edit="openEdit"
        @deactivate="deactivateProduct"
        @cost="openCost"
      />

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
        </div>
      </div>
    </section>

    <ProductFormDialog
      :open="formOpen"
      :product="editingProduct"
      :categories="categories"
      :units="units"
      :saving="formSaving"
      :error="formError"
      @close="formOpen = false"
      @submit="saveProduct"
    />

    <ProductCostDialog
      :open="costOpen"
      :product="costingProduct"
      :saving="costSaving"
      :error="costError"
      @close="costOpen = false"
      @submit="saveCost"
    />

    <CategoryManagerDialog
      :open="categoryOpen"
      :categories="categories"
      :saving="categorySaving"
      :error="categoryError"
      @close="categoryOpen = false"
      @submit="saveCategory"
    />
  </div>
</template>
