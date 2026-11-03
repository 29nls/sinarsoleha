import { shallowRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { ReceiptDetail } from '~/types/cashier'
import { getTransactionDetail } from '~/services/transactions'

export interface UseTransactionDetailOptions {
  client: SupabaseClient<Database>
  currentUserId: () => string
  currentUserName: () => string
}

export function useTransactionDetail(options: UseTransactionDetailOptions) {
  const detail = shallowRef<ReceiptDetail | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)

  let requestId = 0

  async function load(transactionId: string): Promise<void> {
    const currentRequest = ++requestId
    loading.value = true
    error.value = null
    detail.value = null

    try {
      const result = await getTransactionDetail(
        options.client,
        transactionId,
        options.currentUserName(),
        options.currentUserId(),
      )
      if (currentRequest !== requestId) return
      detail.value = result
    } catch (cause) {
      if (currentRequest !== requestId) return
      error.value = cause instanceof Error ? cause.message : 'Gagal memuat detail transaksi.'
    } finally {
      if (currentRequest === requestId) loading.value = false
    }
  }

  async function refresh(transactionId: string): Promise<void> {
    await load(transactionId)
  }

  return { detail, loading, error, load, refresh }
}
