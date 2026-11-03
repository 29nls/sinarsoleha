import { computed, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { OpnameListRow, OpnameStatus } from '~/types/opname'
import { listOpnames } from '~/services/opname'
import { clampPage, createDebouncer, pageCount } from '~/utils/catalog'

export interface UseOpnameListOptions {
  client: SupabaseClient<Database>
}

const SEARCH_DEBOUNCE_MS = 200
const DEFAULT_PAGE_SIZE = 20

export function useOpnameList(options: UseOpnameListOptions) {
  const rows = shallowRef<OpnameListRow[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const status = shallowRef<OpnameStatus | ''>('')
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

  watch([appliedSearch, status, page, pageSize], () => {
    void load()
  }, { flush: 'post' })

  async function load(): Promise<void> {
    const currentRequest = ++requestId
    loading.value = true
    error.value = null

    try {
      const result = await listOpnames(options.client, {
        page: page.value,
        pageSize: pageSize.value,
        status: status.value,
        search: appliedSearch.value,
      })
      if (currentRequest !== requestId) return

      rows.value = result.rows
      total.value = result.total

      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) page.value = lastPage
    } catch (cause) {
      if (currentRequest !== requestId) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat daftar opname.'
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
    const unchanged =
      appliedSearch.value === '' && status.value === '' && page.value === 1 && searchInput.value === ''
    searchInput.value = ''
    appliedSearch.value = ''
    status.value = ''
    page.value = 1
    // The filter watcher reloads whenever a value actually changed; only an
    // already-clean filter set needs an explicit refresh.
    if (unchanged) void load()
  }

  function refresh(): Promise<void> {
    return load()
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
  }
}
