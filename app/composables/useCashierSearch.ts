import { onScopeDispose, shallowRef } from 'vue'
import type { CashierProduct } from '~/types/cashier'
import { describeCashierError } from '~/utils/cashier'

const DEBOUNCE_MS = 150

export function useCashierSearch(loader: (term: string) => Promise<CashierProduct[]>) {
  const term = shallowRef('')
  const results = shallowRef<CashierProduct[]>([])
  const loading = shallowRef(false)
  const error = shallowRef<string | null>(null)
  const highlighted = shallowRef(0)

  let timer: ReturnType<typeof setTimeout> | null = null
  let requestId = 0

  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function clear() {
    cancel()
    requestId += 1
    term.value = ''
    results.value = []
    loading.value = false
    error.value = null
    highlighted.value = 0
  }

  function update(value: string) {
    term.value = value
    cancel()
    requestId += 1
    const current = requestId

    if (!value.trim()) {
      results.value = []
      loading.value = false
      error.value = null
      return
    }

    loading.value = true
    error.value = null
    timer = setTimeout(async () => {
      timer = null
      try {
        const rows = await loader(value)
        if (current !== requestId) return
        results.value = rows
        highlighted.value = rows.findIndex((row) => row.isActive) >= 0
          ? Math.max(0, rows.findIndex((row) => row.isActive))
          : 0
      } catch (cause) {
        if (current !== requestId) return
        results.value = []
        error.value = describeCashierError(cause instanceof Error ? cause.message : 'Pencarian gagal.')
      } finally {
        if (current === requestId) loading.value = false
      }
    }, DEBOUNCE_MS)
  }

  function move(delta: number) {
    if (results.value.length === 0) return
    highlighted.value =
      (highlighted.value + delta + results.value.length) % results.value.length
  }

  onScopeDispose(cancel)

  return { term, results, loading, error, highlighted, update, clear, move }
}
