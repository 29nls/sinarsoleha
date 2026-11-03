import { computed, onMounted, shallowRef, watch } from 'vue'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '~/types/database'
import type {
  ExceptionReportResult,
  ProductSalesReportResult,
  ReportRange,
  ReportRangePreset,
  SalesReportResult,
} from '~/types/reports'
import { normalizeRange, rangeForPreset } from '~/types/reports'
import {
  loadExceptionReport,
  loadProductSalesReport,
  loadSalesReport,
} from '~/services/reports'

export type ReportScope = 'sales' | 'products' | 'exceptions'

export interface UseReportsOptions {
  client: SupabaseClient<Database>
  /** Laporan yang benar-benar dirender halaman ini; sisanya tidak dimuat. */
  autoLoad?: ReportScope[]
}

/**
 * Sales reports share one date range so switching tabs does not silently
 * reset the period the owner was reading. The range lives in Nuxt state, not
 * in this composable instance, because each report route mounts its own page.
 *
 * Each loader keeps its own request id: a slow request for the previous range
 * must never overwrite the rows of the current one.
 */
export function useReports(options: UseReportsOptions) {
  const range = useState<ReportRange>('reports:range', () => rangeForPreset('today'))
  const preset = useState<ReportRangePreset>('reports:preset', () => 'today')
  const scopes = new Set<ReportScope>(options.autoLoad ?? ['sales', 'products', 'exceptions'])

  const sales = shallowRef<SalesReportResult | null>(null)
  const salesLoading = shallowRef(false)
  const salesError = shallowRef<string | null>(null)

  const products = shallowRef<ProductSalesReportResult | null>(null)
  const productsLoading = shallowRef(false)
  const productsError = shallowRef<string | null>(null)

  const exceptions = shallowRef<ExceptionReportResult | null>(null)
  const exceptionsLoading = shallowRef(false)
  const exceptionsError = shallowRef<string | null>(null)

  let salesRequest = 0
  let productsRequest = 0
  let exceptionsRequest = 0

  const rangeKey = computed(() => `${range.value.from}|${range.value.to}`)

  async function loadSales(): Promise<void> {
    const request = ++salesRequest
    salesLoading.value = true
    salesError.value = null
    try {
      const result = await loadSalesReport(options.client, normalizeRange(range.value))
      if (request !== salesRequest) return
      sales.value = result
    } catch (cause) {
      if (request !== salesRequest) return
      salesError.value = cause instanceof Error ? cause.message : 'Gagal memuat laporan penjualan.'
      sales.value = null
    } finally {
      if (request === salesRequest) salesLoading.value = false
    }
  }

  async function loadProducts(): Promise<void> {
    const request = ++productsRequest
    productsLoading.value = true
    productsError.value = null
    try {
      const result = await loadProductSalesReport(options.client, normalizeRange(range.value))
      if (request !== productsRequest) return
      products.value = result
    } catch (cause) {
      if (request !== productsRequest) return
      productsError.value = cause instanceof Error ? cause.message : 'Gagal memuat laporan produk.'
      products.value = null
    } finally {
      if (request === productsRequest) productsLoading.value = false
    }
  }

  async function loadExceptions(): Promise<void> {
    const request = ++exceptionsRequest
    exceptionsLoading.value = true
    exceptionsError.value = null
    try {
      const result = await loadExceptionReport(options.client)
      if (request !== exceptionsRequest) return
      exceptions.value = result
    } catch (cause) {
      if (request !== exceptionsRequest) return
      exceptionsError.value = cause instanceof Error ? cause.message : 'Gagal memuat exception data.'
      exceptions.value = null
    } finally {
      if (request === exceptionsRequest) exceptionsLoading.value = false
    }
  }

  function applyPreset(next: ReportRangePreset): void {
    preset.value = next
    if (next === 'custom') return
    range.value = rangeForPreset(next)
  }

  function setRange(next: ReportRange): void {
    preset.value = 'custom'
    range.value = next
  }

  /** Memuat ulang hanya laporan yang dipakai halaman ini. */
  function refresh(): void {
    if (scopes.has('sales')) void loadSales()
    if (scopes.has('products')) void loadProducts()
    if (scopes.has('exceptions')) void loadExceptions()
  }

  watch(rangeKey, () => {
    if (scopes.has('sales')) void loadSales()
    if (scopes.has('products')) void loadProducts()
  })

  onMounted(refresh)

  return {
    range,
    preset,
    applyPreset,
    setRange,
    sales,
    salesLoading,
    salesError,
    products,
    productsLoading,
    productsError,
    exceptions,
    exceptionsLoading,
    exceptionsError,
    loadSales,
    loadProducts,
    loadExceptions,
    refresh,
  }
}
