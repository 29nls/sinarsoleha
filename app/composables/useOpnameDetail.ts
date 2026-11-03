import { computed, onMounted, ref, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  OpnameConflict,
  OpnameDetail,
  OpnameItemRow,
  PostOpnameResult,
} from '~/types/opname'
import {
  approveOpname,
  cancelOpname,
  getOpnameDetail,
  postOpname,
  recordOpnameCount,
  submitOpname,
} from '~/services/opname'
import { describeOpnameError } from '~/types/opname'

export interface UseOpnameDetailOptions {
  client: SupabaseClient<Database>
  /** Reactive so a reused page component reloads when the route param changes. */
  opnameId: MaybeRefOrGetter<string>
}

export function useOpnameDetail(options: UseOpnameDetailOptions) {
  const detail = shallowRef<OpnameDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const actionError = ref<string | null>(null)
  const actionNotice = ref<string | null>(null)
  const busyAction = ref<'count' | 'submit' | 'approve' | 'post' | 'cancel' | null>(null)

  /** Populated only when `post_stock_opname` reports a version conflict. */
  const conflicts = shallowRef<OpnameConflict[]>([])
  /** Summary from the last successful post, for the result banner. */
  const postResult = shallowRef<PostOpnameResult | null>(null)

  const items = computed(() => detail.value?.items ?? [])
  const pendingItems = computed(() =>
    items.value.filter((item) => item.countStatus === 'pending'),
  )
  const recountItems = computed(() =>
    items.value.filter((item) => item.countStatus === 'needs_recount'),
  )
  const countedItems = computed(() =>
    items.value.filter((item) => item.countStatus !== 'pending'),
  )
  const discrepancyItems = computed(() =>
    items.value.filter((item) => (item.differenceQty ?? 0) !== 0),
  )
  const openingBalanceItems = computed(() =>
    items.value.filter((item) => item.systemQtySnapshot === null),
  )
  const isComplete = computed(
    () => items.value.length > 0 && pendingItems.value.length === 0,
  )

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      detail.value = await getOpnameDetail(options.client, toValue(options.opnameId))
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat sesi opname.'
      detail.value = null
    } finally {
      loading.value = false
    }
  }

  function clearFeedback(): void {
    actionError.value = null
    actionNotice.value = null
  }

  async function count(
    item: OpnameItemRow,
    physicalQty: number,
    reasonCode: string | null,
    reasonNote: string | null,
  ): Promise<boolean> {
    clearFeedback()
    busyAction.value = 'count'
    try {
      await recordOpnameCount(options.client, item.id, physicalQty, reasonCode, reasonNote)
      await load()
      actionNotice.value = `Jumlah fisik ${item.sku} tersimpan.`
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
      void load()
    },
  )

  onMounted(() => {
    void load()
  })

  return {
    detail,
    items,
    pendingItems,
    recountItems,
    countedItems,
    discrepancyItems,
    openingBalanceItems,
    isComplete,
    loading,
    error,
    actionError,
    actionNotice,
    busyAction,
    conflicts,
    postResult,
    load,
    count,
    submit,
    approve,
    post,
    cancel,
    clearFeedback,
  }
}
