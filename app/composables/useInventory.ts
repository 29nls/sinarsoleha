import { computed, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  DiscrepancyFilters,
  DiscrepancyParams,
  DiscrepancyRow,
  InventoryListResult,
  MovementFilters,
  MovementParams,
  MovementRow,
  StockBalanceFilters,
  StockBalanceParams,
  StockBalanceRow,
} from '~/types/inventory'
import {
  emptyDiscrepancyFilters,
  emptyMovementFilters,
  emptyStockBalanceFilters,
} from '~/types/inventory'
import {
  listStockBalances,
  listStockDiscrepancies,
  listStockMovements,
} from '~/services/inventory'
import { clampPage, createDebouncer, pageCount } from '~/utils/catalog'

const SEARCH_DEBOUNCE_MS = 200
const DEFAULT_PAGE_SIZE = 25

interface PagedOptions<TFilters, TRow> {
  filters: () => TFilters
  load: (
    params: { page: number; pageSize: number; search: string } & TFilters,
  ) => Promise<InventoryListResult<TRow>>
}

/**
 * Shared paging/search/filter machinery for the three inventory lists.
 *
 * A monotonically increasing request id drops stale responses, which matters
 * because every keystroke can start a query while an older one is in flight.
 */
function usePagedList<TFilters extends object, TRow>(
  options: PagedOptions<TFilters, TRow>,
) {
  const rows = shallowRef<TRow[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const searchInput = shallowRef('')
  const appliedSearch = shallowRef('')
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)

  let requestId = 0

  const totalPages = computed(() => pageCount(total.value, pageSize.value))
  const canGoPrevious = computed(() => page.value > 1)
  const canGoNext = computed(() => page.value < totalPages.value)
  const rangeStart = computed(() =>
    total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1,
  )
  const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))

  const debouncer = createDebouncer<string>(SEARCH_DEBOUNCE_MS, (value) => {
    appliedSearch.value = value
    page.value = 1
  })

  watch(searchInput, (value) => {
    debouncer.schedule(value)
  })

  // Serialising the filter object keeps the watcher stable: a plain object
  // getter would be a new reference on every evaluation and fire too often.
  const filterKey = computed(() => JSON.stringify(options.filters()))

  watch(
    [appliedSearch, filterKey, page, pageSize],
    () => {
      void load()
    },
    { flush: 'post' },
  )

  async function load(): Promise<void> {
    const currentRequest = ++requestId
    loading.value = true
    error.value = null

    try {
      const result = await options.load({
        ...options.filters(),
        search: appliedSearch.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (currentRequest !== requestId) return

      rows.value = result.rows
      total.value = result.total

      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) page.value = lastPage
    } catch (cause) {
      if (currentRequest !== requestId) return
      error.value =
        cause instanceof Error ? cause.message : 'Gagal memuat data inventaris.'
      rows.value = []
      total.value = 0
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
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
    page.value = 1
    // The caller owns the filter object and resets it before calling us; a
    // reload keeps the table in sync even when no watcher fires.
    void load()
  }

  function refresh(): void {
    void load()
  }

  onMounted(() => {
    void load()
  })

  onScopeDispose(() => {
    debouncer.cancel()
  })

  return {
    rows,
    total,
    page,
    pageSize,
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
  }
}

export interface UseInventoryOptions {
  client: SupabaseClient<Database>
  currentUserId?: () => string
}

export function useStockBalances(options: UseInventoryOptions) {
  const filters = reactive<StockBalanceFilters>(emptyStockBalanceFilters())

  const list = usePagedList<StockBalanceFilters, StockBalanceRow>({
    filters: () => filters,
    load: (params) =>
      listStockBalances(options.client, {
        search: params.search,
        state: params.state,
        page: params.page,
        pageSize: params.pageSize,
      } satisfies StockBalanceParams),
  })

  function resetFilters(): void {
    Object.assign(filters, emptyStockBalanceFilters())
    list.resetFilters()
  }

  return { ...list, filters, resetFilters }
}

export function useStockMovements(options: UseInventoryOptions) {
  const filters = reactive<MovementFilters>(emptyMovementFilters())

  const list = usePagedList<MovementFilters, MovementRow>({
    filters: () => filters,
    load: (params) =>
      listStockMovements(
        options.client,
        {
          productSearch: params.search,
          movementType: params.movementType,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          page: params.page,
          pageSize: params.pageSize,
        } satisfies MovementParams,
        options.currentUserId?.() ?? '',
      ),
  })

  function resetFilters(): void {
    Object.assign(filters, emptyMovementFilters())
    list.resetFilters()
  }

  return { ...list, filters, resetFilters }
}

export function useStockDiscrepancies(options: UseInventoryOptions) {
  const filters = reactive<DiscrepancyFilters>(emptyDiscrepancyFilters())

  const list = usePagedList<DiscrepancyFilters, DiscrepancyRow>({
    filters: () => filters,
    load: (params) =>
      listStockDiscrepancies(
        options.client,
        {
          productSearch: params.search,
          reasonCode: params.reasonCode,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          page: params.page,
          pageSize: params.pageSize,
        } satisfies DiscrepancyParams,
        options.currentUserId?.() ?? '',
      ),
  })

  function resetFilters(): void {
    Object.assign(filters, emptyDiscrepancyFilters())
    list.resetFilters()
  }

  return { ...list, filters, resetFilters }
}
