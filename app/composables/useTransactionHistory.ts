import { computed, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  TransactionListFilters,
  TransactionListRow,
} from '~/types/transactions'
import { emptyFilters } from '~/types/transactions'
import { listTransactions } from '~/services/transactions'
import { clampPage, createDebouncer, pageCount } from '~/utils/catalog'

export interface UseTransactionHistoryOptions {
  client: SupabaseClient<Database>
  isOwner: () => boolean
  currentUserId: () => string
  currentUserName: () => string
}

const SEARCH_DEBOUNCE_MS = 200
const DEFAULT_PAGE_SIZE = 25

export function useTransactionHistory(options: UseTransactionHistoryOptions) {
  const rows = shallowRef<TransactionListRow[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const filters = reactive<TransactionListFilters>(emptyFilters())
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

  watch(
    [
      appliedSearch,
      () => filters.dateFrom,
      () => filters.dateTo,
      () => filters.status,
      () => filters.paymentMethod,
      () => filters.cashierId,
      page,
      pageSize,
    ],
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
      const result = await listTransactions(options.client, {
        ...filters,
        receiptSearch: appliedSearch.value,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (currentRequest !== requestId) return

      // Fill cashier name from auth profile when IDs match
      const userId = options.currentUserId()
      const userName = options.currentUserName()
      rows.value = result.rows.map((row) => ({
        ...row,
        cashierName: row.cashierId === userId ? userName : 'Kasir',
      }))
      total.value = result.total

      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) {
        page.value = lastPage
      }
    } catch (cause) {
      if (currentRequest !== requestId) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat riwayat transaksi.'
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
    Object.assign(filters, emptyFilters())
    page.value = 1
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
  }
}
