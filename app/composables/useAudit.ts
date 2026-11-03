import { computed, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { AuditFilters, AuditRow } from '~/types/audit'
import { emptyAuditFilters } from '~/types/audit'
import { listAuditLogs } from '~/services/audit'
import { clampPage, pageCount } from '~/utils/catalog'

const DEFAULT_PAGE_SIZE = 50

export function useAuditLogs(client: SupabaseClient<Database>) {
  const rows = shallowRef<AuditRow[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const filters = reactive<AuditFilters>(emptyAuditFilters())
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

  const filterKey = computed(() => JSON.stringify(filters))

  watch([filterKey, page, pageSize], () => {
    void load()
  })

  async function load(): Promise<void> {
    const current = ++requestId
    loading.value = true
    error.value = null
    try {
      const result = await listAuditLogs(client, {
        ...filters,
        page: page.value,
        pageSize: pageSize.value,
      })
      if (current !== requestId) return
      rows.value = result.rows
      total.value = result.total
      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) page.value = lastPage
    } catch (cause) {
      if (current !== requestId) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat audit log.'
      rows.value = []
      total.value = 0
    } finally {
      if (current === requestId) loading.value = false
    }
  }

  function setPage(next: number): void {
    page.value = clampPage(next, total.value, pageSize.value)
  }

  function setPageSize(next: number): void {
    if (next === pageSize.value) return
    pageSize.value = next
    page.value = 1
  }

  function resetFilters(): void {
    Object.assign(filters, emptyAuditFilters())
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
    requestId += 1
  })

  return {
    rows,
    total,
    page,
    pageSize,
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
