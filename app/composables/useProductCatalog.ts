import { computed, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  CatalogProduct,
  CategoryOption,
  ProductListFilters,
  UnitOption,
} from '~/types/catalog'
import {
  applyOwnerDetails,
  listCategories,
  listProductCosts,
  listProductIssues,
  listProducts,
  listUnits,
} from '~/services/catalog'
import {
  clampPage,
  createDebouncer,
  describeCatalogError,
  pageCount,
} from '~/utils/catalog'

export interface UseProductCatalogOptions {
  client: SupabaseClient<Database>
  isOwner: () => boolean
}

const SEARCH_DEBOUNCE_MS = 150
const DEFAULT_PAGE_SIZE = 50

function emptyFilters(): ProductListFilters {
  return {
    categoryId: null,
    unitId: null,
    active: 'all',
    missingPrice: false,
    unknownStock: false,
    negativeStock: false,
    reviewStatus: '',
  }
}

export function useProductCatalog(options: UseProductCatalogOptions) {
  const isOwner = computed(() => options.isOwner())
  const products = shallowRef<CatalogProduct[]>([])
  const categories = shallowRef<CategoryOption[]>([])
  const units = shallowRef<UnitOption[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const searchInput = shallowRef('')
  const appliedSearch = shallowRef('')
  const filters = reactive<ProductListFilters>(emptyFilters())
  const loading = shallowRef(false)
  const referenceLoading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const referenceError = shallowRef<string | null>(null)

  let requestId = 0

  const totalPages = computed(() => pageCount(total.value, pageSize.value))
  const rangeStart = computed(() =>
    total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1,
  )
  const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))
  const canGoPrevious = computed(() => page.value > 1)
  const canGoNext = computed(() => page.value < totalPages.value)

  const debouncer = createDebouncer<string>(SEARCH_DEBOUNCE_MS, (value) => {
    appliedSearch.value = value
    page.value = 1
  })

  watch(searchInput, (value) => {
    debouncer.schedule(value)
  })

  watch(
    [
      appliedSearch,
      () => filters.categoryId,
      () => filters.unitId,
      () => filters.active,
      () => filters.missingPrice,
      () => filters.unknownStock,
      () => filters.negativeStock,
      () => filters.reviewStatus,
      page,
      pageSize,
    ],
    () => {
      void loadProducts()
    },
    { flush: 'post' },
  )

  async function loadProducts(): Promise<void> {
    const currentRequest = ++requestId
    loading.value = true
    error.value = null

    try {
      const result = await listProducts(options.client, {
        ...filters,
        search: appliedSearch.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (currentRequest !== requestId) return

      let rows = result.products
      if (isOwner.value && rows.length > 0) {
        const ids = rows.map((product) => product.id)
        const [costs, issues] = await Promise.all([
          listProductCosts(options.client, ids),
          listProductIssues(options.client, ids),
        ])
        if (currentRequest !== requestId) return
        rows = applyOwnerDetails(rows, costs, issues)
      }

      products.value = rows
      total.value = result.total

      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) {
        page.value = lastPage
        return
      }
    } catch (cause) {
      if (currentRequest !== requestId) return
      error.value = describeCatalogError(cause)
      products.value = []
      total.value = 0
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
  }

  async function loadReferences(): Promise<void> {
    referenceLoading.value = true
    referenceError.value = null
    try {
      const [nextCategories, nextUnits] = await Promise.all([
        listCategories(options.client),
        listUnits(options.client),
      ])
      categories.value = nextCategories
      units.value = nextUnits
    } catch (cause) {
      referenceError.value = describeCatalogError(cause)
    } finally {
      referenceLoading.value = false
    }
  }

  async function initialize(): Promise<void> {
    await Promise.all([loadReferences(), loadProducts()])
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadReferences(), loadProducts()])
  }

  function setPage(nextPage: number): void {
    page.value = clampPage(nextPage, total.value, pageSize.value)
  }

  function setPageSize(nextSize: number): void {
    if (nextSize === pageSize.value) return
    pageSize.value = nextSize
    page.value = 1
  }

  function resetFilters(): void {
    debouncer.cancel()
    searchInput.value = ''
    appliedSearch.value = ''
    Object.assign(filters, emptyFilters())
    page.value = 1
    void loadProducts()
  }

  onMounted(() => {
    void initialize()
  })

  onScopeDispose(() => {
    debouncer.cancel()
  })

  return {
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
    isOwner,
    refresh,
    setPage,
    setPageSize,
    resetFilters,
  }
}
