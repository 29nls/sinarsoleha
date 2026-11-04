import { computed, onMounted, onScopeDispose, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  OpnameConflict,
  OpnameDetail,
  OpnameItemContext,
  OpnameItemFilter,
  OpnameItemRow,
  PostOpnameResult,
} from '~/types/opname'
import {
  approveOpname,
  cancelOpname,
  getOpnameDetail,
  getOpnameItemContext,
  getOpnameItemsPage,
  postOpname,
  recordOpnameCount,
  submitOpname,
} from '~/services/opname'
import { describeOpnameError } from '~/types/opname'
import { clampPage, createDebouncer, pageCount } from '~/utils/catalog'

export interface UseOpnameDetailOptions {
  client: SupabaseClient<Database>
  /** Reactive so a reused page component reloads when the route param changes. */
  opnameId: MaybeRefOrGetter<string>
}

const SEARCH_DEBOUNCE_MS = 200
const DEFAULT_PAGE_SIZE = 50

/**
 * Session detail state.
 *
 * Two independent sources feed the page, on purpose:
 *  * `detail` — header + global counters, aggregated in the database over every
 *    item. A page of rows can never answer "how many are still pending".
 *  * `items` — exactly one page, fetched with limit/offset and a deterministic
 *    SKU order. This is what fixed the PostgREST 1,000-row truncation.
 *
 * Filtering and searching are server-side for the same reason: filtering the
 * loaded page would hide matches on the other 1,300 items.
 */
export function useOpnameDetail(options: UseOpnameDetailOptions) {
  const detail = shallowRef<OpnameDetail | null>(null)
  const items = shallowRef<OpnameItemRow[]>([])
  const total = shallowRef(0)
  const page = shallowRef(1)
  const pageSize = shallowRef(DEFAULT_PAGE_SIZE)
  const filter = shallowRef<OpnameItemFilter>('all')
  const searchInput = shallowRef('')
  const appliedSearch = shallowRef('')

  const loading = ref(false)
  const itemsLoading = ref(false)
  const error = ref<string | null>(null)
  const itemsError = ref<string | null>(null)
  const actionError = ref<string | null>(null)
  const actionNotice = ref<string | null>(null)
  const busyAction = ref<'count' | 'submit' | 'approve' | 'post' | 'cancel' | null>(null)

  /** Populated only when `post_stock_opname` reports a version conflict. */
  const conflicts = shallowRef<OpnameConflict[]>([])
  /** Summary from the last successful post, for the result banner. */
  const postResult = shallowRef<PostOpnameResult | null>(null)

  let detailRequest = 0
  let itemsRequest = 0

  const totalPages = computed(() => pageCount(total.value, pageSize.value))
  const canGoPrevious = computed(() => page.value > 1)
  const canGoNext = computed(() => page.value < totalPages.value)
  const rangeStart = computed(() =>
    total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1,
  )
  const rangeEnd = computed(() => Math.min(page.value * pageSize.value, total.value))
  const hasFilters = computed(
    () => filter.value !== 'all' || appliedSearch.value.trim() !== '',
  )

  // Global counters. These come from the summary RPC, never from `items`.
  const pendingCount = computed(() => detail.value?.pendingCount ?? 0)
  const recountCount = computed(() => detail.value?.needsRecountCount ?? 0)
  const discrepancyCount = computed(() => detail.value?.discrepancyCount ?? 0)
  const openingBalanceCount = computed(() => detail.value?.openingBalanceCount ?? 0)
  const matchingCount = computed(() => detail.value?.matchingCount ?? 0)
  const isComplete = computed(
    () => (detail.value?.itemCount ?? 0) > 0 && pendingCount.value === 0,
  )

  const debouncer = createDebouncer<string>(SEARCH_DEBOUNCE_MS, (value) => {
    appliedSearch.value = value
    page.value = 1
  })

  watch(searchInput, (value) => {
    debouncer.schedule(value)
  })

  // Filter/search/page changes only re-fetch the page, not the summary.
  watch(
    [appliedSearch, filter, page, pageSize],
    () => {
      void loadItems()
    },
    { flush: 'post' },
  )

  async function loadDetail(): Promise<void> {
    const currentRequest = ++detailRequest
    loading.value = true
    error.value = null
    try {
      const result = await getOpnameDetail(options.client, toValue(options.opnameId))
      if (currentRequest !== detailRequest) return
      detail.value = result
    } catch (cause) {
      if (currentRequest !== detailRequest) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat sesi opname.'
      detail.value = null
    } finally {
      if (currentRequest === detailRequest) loading.value = false
    }
  }

  async function loadItems(): Promise<void> {
    if (!detail.value) return
    const currentRequest = ++itemsRequest
    itemsLoading.value = true
    itemsError.value = null

    try {
      const result = await getOpnameItemsPage(options.client, toValue(options.opnameId), {
        page: page.value,
        pageSize: pageSize.value,
        filter: filter.value,
        search: appliedSearch.value,
      })
      if (currentRequest !== itemsRequest) return

      items.value = result.items
      total.value = result.total

      // A delete or a filter change can leave us past the last page.
      const lastPage = pageCount(result.total, pageSize.value)
      if (page.value > lastPage) page.value = lastPage
    } catch (cause) {
      if (currentRequest !== itemsRequest) return
      itemsError.value =
        cause instanceof Error ? cause.message : 'Gagal memuat item opname.'
      items.value = []
      total.value = 0
    } finally {
      if (currentRequest === itemsRequest) itemsLoading.value = false
    }
  }

  /** Header + counters + the page the operator is looking at. */
  async function load(): Promise<void> {
    await loadDetail()
    if (detail.value) await loadItems()
  }

  function setPage(nextPage: number): void {
    page.value = clampPage(nextPage, total.value, pageSize.value)
  }

  function setPageSize(nextSize: number): void {
    if (nextSize === pageSize.value) return
    pageSize.value = nextSize
    page.value = 1
  }

  function setFilter(nextFilter: OpnameItemFilter): void {
    if (nextFilter === filter.value) return
    filter.value = nextFilter
    page.value = 1
  }

  function resetFilters(): void {
    debouncer.cancel()
    searchInput.value = ''
    appliedSearch.value = ''
    filter.value = 'all'
    page.value = 1
  }

  function clearFeedback(): void {
    actionError.value = null
    actionNotice.value = null
  }

  /**
   * Authoritative item state for the count dialog: snapshot, live stock and
   * live version in one read. The dialog must never present the snapshot as
   * current stock after a version conflict.
   */
  async function fetchItemContext(itemId: string): Promise<OpnameItemContext | null> {
    try {
      return await getOpnameItemContext(options.client, itemId)
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return null
    }
  }

  /**
   * Save a physical count. The RPC response is authoritative — after a recount
   * it carries the rebased snapshot the database actually used — so the row in
   * the page is patched from it instead of from the form.
   */
  async function count(
    item: OpnameItemRow,
    physicalQty: number,
    reasonCode: string | null,
    reasonNote: string | null,
  ): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'count'
    try {
      const result = await recordOpnameCount(
        options.client,
        item.id,
        physicalQty,
        reasonCode,
        reasonNote,
      )

      items.value = items.value.map((row) =>
        row.id === result.itemId
          ? {
              ...row,
              systemQtySnapshot: result.systemQtySnapshot,
              physicalQty: result.physicalQty,
              differenceQty: result.differenceQty,
              reasonCode: result.reasonCode,
              countStatus: result.countStatus,
              countedAt: result.countedAt,
            }
          : row,
      )

      // Counters describe the whole session, so they must be re-aggregated.
      await loadDetail()

      const rebased = result.systemQtySnapshot !== item.systemQtySnapshot
      actionNotice.value = rebased
        ? `Hitungan ${item.sku} tersimpan. Stok sistem disesuaikan ke ${result.systemQtySnapshot ?? 'NULL'} sesuai kondisi terbaru.`
        : `Jumlah fisik ${item.sku} tersimpan.`
      return true
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return false
    } finally {
      busyAction.value = null
    }
  }

  async function submit(): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'submit'
    try {
      const result = await submitOpname(options.client, toValue(options.opnameId))
      await load()
      actionNotice.value = result.alreadyProcessed
        ? 'Sesi ini sudah disubmit sebelumnya.'
        : `Sesi ${result.opnameNo} disubmit untuk persetujuan owner.`
      return true
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return false
    } finally {
      busyAction.value = null
    }
  }

  async function approve(): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'approve'
    try {
      const result = await approveOpname(options.client, toValue(options.opnameId))
      await load()
      actionNotice.value = result.alreadyProcessed
        ? 'Sesi ini sudah disetujui sebelumnya.'
        : 'Sesi disetujui. Stok belum berubah sampai diposting.'
      return true
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return false
    } finally {
      busyAction.value = null
    }
  }

  async function post(): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'post'
    conflicts.value = []
    try {
      const result = await postOpname(options.client, toValue(options.opnameId))
      await load()

      if (result.result === 'version_conflict') {
        // Not an error: the database deliberately returns a payload so the
        // recount markers commit instead of being rolled back by an exception.
        conflicts.value = result.conflicts
        actionError.value = result.conflicts.length === 1
          ? '1 produk berubah setelah dihitung. Hitung ulang item yang ditandai, lalu submit dan setujui kembali.'
          : `${result.conflicts.length} produk berubah setelah dihitung. Hitung ulang item yang ditandai, lalu submit dan setujui kembali.`
        return false
      }

      postResult.value = result
      actionNotice.value = `Sesi ${result.opnameNo} terposting. ${result.discrepancyCount} penyesuaian, ${result.openingBalanceCount} saldo awal.`
      return true
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return false
    } finally {
      busyAction.value = null
    }
  }

  async function cancel(reason: string): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'cancel'
    try {
      const result = await cancelOpname(options.client, toValue(options.opnameId), reason)
      await load()
      actionNotice.value = result.alreadyProcessed
        ? 'Sesi ini sudah dibatalkan sebelumnya.'
        : 'Sesi dibatalkan. Stok tidak berubah.'
      return true
    } catch (cause) {
      actionError.value = describeOpnameError(cause)
      return false
    } finally {
      busyAction.value = null
    }
  }

  // Reloading on a new id must also drop feedback from the previous session.
  watch(
    () => toValue(options.opnameId),
    () => {
      clearFeedback()
      conflicts.value = []
      postResult.value = null
      page.value = 1
      items.value = []
      total.value = 0
      void load()
    },
  )

  onMounted(() => {
    void load()
  })

  onScopeDispose(() => {
    debouncer.cancel()
  })

  return {
    detail,
    items,
    total,
    page,
    pageSize,
    filter,
    searchInput,
    loading,
    itemsLoading,
    error,
    itemsError,
    actionError,
    actionNotice,
    busyAction,
    conflicts,
    postResult,
    totalPages,
    canGoPrevious,
    canGoNext,
    rangeStart,
    rangeEnd,
    hasFilters,
    pendingCount,
    recountCount,
    discrepancyCount,
    openingBalanceCount,
    matchingCount,
    isComplete,
    load,
    setPage,
    setPageSize,
    setFilter,
    resetFilters,
    fetchItemContext,
    count,
    submit,
    approve,
    post,
    cancel,
    clearFeedback,
  }
}
