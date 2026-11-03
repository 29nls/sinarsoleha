import { shallowRef } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type { VoidSaleResult } from '~/types/transactions'
import { validateVoidReason } from '~/types/transactions'
import { voidSale } from '~/services/transactions'

export interface UseTransactionVoidOptions {
  client: SupabaseClient<Database>
}

export function useTransactionVoid(options: UseTransactionVoidOptions) {
  const submitting = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const result = shallowRef<VoidSaleResult | null>(null)

  async function submit(transactionId: string, reason: string): Promise<boolean> {
    const reasonError = validateVoidReason(reason)
    if (reasonError) {
      error.value = reasonError
      return false
    }

    if (submitting.value) return false
    submitting.value = true
    error.value = null
    result.value = null

    try {
      const response = await voidSale(options.client, transactionId, reason)
      result.value = response
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Pembatalan gagal.'
      return false
    } finally {
      submitting.value = false
    }
  }

  function reset(): void {
    submitting.value = false
    error.value = null
    result.value = null
  }

  return { submitting, error, result, submit, reset }
}
