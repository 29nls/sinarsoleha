<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useCashierStore } from '~/stores/cashier'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useCashierSearch } from '~/composables/useCashierSearch'
import { usePlugins } from '~/composables/usePlugins'
import { useStockRealtime } from '~/composables/useStockRealtime'
import { completeSale, getCashierProducts, getReceipt, searchCashierProducts } from '~/services/cashier'
import { businessDateJakarta, centsToAmount, describeCashierError, lineTotalCents } from '~/utils/cashier'
import { formatDate, formatQuantity, formatRupiah } from '~/utils/format'
import type { CashierProduct, ReceiptDetail } from '~/types/cashier'
import { ROLE_LABELS } from '~/types/database'
import CashierHeader from '~/components/cashier/CashierHeader.vue'
import ProductSearch from '~/components/cashier/ProductSearch.vue'
import ProductResultsTable from '~/components/cashier/ProductResultsTable.vue'
import CartTable from '~/components/cashier/CartTable.vue'
import PaymentPanel from '~/components/cashier/PaymentPanel.vue'
import ReceiptView from '~/components/cashier/ReceiptView.vue'

definePageMeta({ capability: 'sale.create' })
useHead({ title: 'Kasir · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const store = useCashierStore()
const client = useSupabaseClient()
const plugins = usePlugins()

const search = useCashierSearch((term) => searchCashierProducts(client, term))
const searchModel = computed({
  get: () => search.term.value,
  set: (value: string) => search.update(value),
})

const searchBox = useTemplateRef<{ focus: () => void }>('searchBox')
const notice = shallowRef<string | null>(null)
const receiptOpen = shallowRef(false)
// Keep live checkout disabled until Phase 4A.1 hosted acceptance gate passes.
const hostedCheckoutEnabled = true
const online = shallowRef(true)

/**
 * Realtime only refreshes what is already on screen: the cart rows and the
 * current search results. Checkout still validates stock in PostgreSQL.
 */
const stockChannel = useStockRealtime(client, {
  onStock(event) {
    const changed = store.applyStockChange(event)
    search.applyStock(event)
    if (changed && store.stockError) notice.value = store.stockError
  },
  onResync() {
    void refreshCartStock()
  },
})
const stockLive = computed(() => stockChannel.status.value === 'subscribed')

const businessDate = businessDateJakarta()
const businessDateLabel = formatDate(new Date(`${businessDate}T00:00:00+07:00`))
const roleLabel = computed(() => (auth.role ? ROLE_LABELS[auth.role] : '—'))
const cashierName = computed(() => auth.profile?.full_name ?? auth.email ?? 'Kasir')

function chooseProduct(product: CashierProduct) {
  const error = store.addProduct(product)
  if (error) {
    notice.value = error
    return
  }
  notice.value = null
  search.clear()
  searchBox.value?.focus()
}

function setLineQuantity(productId: string, value: string) {
  const error = store.setQuantity(productId, value)
  if (error) {
    notice.value = error
    return
  }
  notice.value = null
}

/**
 * Enter is also how a keyboard-wedge scanner submits a code typed into the
 * search field. The debounced search may not have answered yet, so a ready
 * scanner falls back to an *exact* SKU lookup. A near match is never added,
 * because a cashier pressing Enter on a typed name must not get a different
 * product than the one on screen.
 */
async function chooseHighlighted() {
  const product = search.results.value[search.highlighted.value]
  if (product) {
    chooseProduct(product)
    return
  }
  if (!plugins.isEnabled('hardware.barcode_scanner')) return
  const term = search.term.value.trim()
  if (!term) return
  try {
    const rows = await searchCashierProducts(client, term)
    const exact = rows.find((row) => row.sku.toLowerCase() === term.toLowerCase())
    if (exact) chooseProduct(exact)
  } catch {
    notice.value = 'Pencarian gagal. Coba lagi atau pilih produk dari daftar.'
  }
}

/**
 * A scanner sends a complete SKU, so it is resolved directly instead of going
 * through the debounced search. Only an exact SKU match is added: a partial
 * match could put a different product into the cart than the one scanned.
 * A failed scan leaves the manual search path untouched.
 */
async function handleScan(code: string) {
  try {
    const rows = await searchCashierProducts(client, code)
    const exact = rows.find((row) => row.sku.toLowerCase() === code.toLowerCase())
    if (!exact) {
      notice.value = `Kode ${code} tidak ditemukan. Ketik SKU atau nama secara manual.`
      return
    }
    chooseProduct(exact)
  } catch {
    notice.value = `Gagal mencari kode ${code}. Gunakan pencarian manual.`
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  )
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (event.key === 'F2') {
    event.preventDefault()
    searchBox.value?.focus()
    return
  }
  if (event.key === 'F9') {
    event.preventDefault()
    document.getElementById('payment-panel')?.focus()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void submitCheckout()
    return
  }
  if (event.key === 'Escape') {
    if (receiptOpen.value) receiptOpen.value = false
    else search.clear()
    return
  }
  if (event.key === 'Delete' && !isTypingTarget(event.target) && store.selectedProductId) {
    event.preventDefault()
    store.removeLine(store.selectedProductId)
    return
  }

  const searchFocused = document.activeElement?.id === 'cashier-search'
  if (!searchFocused) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    search.move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    search.move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    chooseHighlighted()
  }
}

function updateOnline() {
  online.value = navigator.onLine
}

function receiptFallback(result: {
  transaction_id: string
  receipt_no: string
  business_date: string
  subtotal: number
  discount_amount: number
  grand_total: number
  status: string
}): ReceiptDetail {
  return {
    transactionId: result.transaction_id,
    receiptNo: result.receipt_no,
    businessDate: result.business_date,
    cashierName: '',
    status: result.status,
    subtotal: result.subtotal,
    discountAmount: result.discount_amount,
    grandTotal: result.grand_total,
    createdAt: null,
    items: [],
    payments: [],
  }
}

async function refreshCartStock() {
  if (store.lines.length === 0) return
  try {
    const rows = await getCashierProducts(
      client,
      store.lines.map((line) => line.product.id),
    )
    // The fresh read supersedes any remembered broadcast version.
    store.resetStockVersions()
    store.replaceProductStock(new Map(rows.map((row) => [row.id, row])))
  } catch {
    // The original backend error is more useful than a refresh failure.
  }
}

async function submitCheckout() {
  if (!hostedCheckoutEnabled) {
    notice.value = 'Checkout dinonaktifkan sampai validasi transaksi hosted Phase 4A.1 lulus.'
    return
  }
  const payload = store.status === 'unknown' ? store.retryCheckout() : store.beginCheckout()
  if (!payload) return

  try {
    const result = await completeSale(client, payload)
    let detail: ReceiptDetail
    try {
      detail = await getReceipt(client, result.transaction_id)
    } catch {
      detail = receiptFallback(result)
    }
    store.complete(result, detail)
    search.clear()
    receiptOpen.value = true
    await nextTick()
  } catch (cause) {
    const error = cause as { message?: string; code?: string }
    const unknownRequest = !error.code
    store.fail(describeCashierError(error.message ?? 'Checkout gagal. Coba lagi.'), unknownRequest)
    if (!unknownRequest) await refreshCartStock()
  }
}

function handleOnline() {
  updateOnline()
  if (navigator.onLine) stockChannel.reconnect()
}

onMounted(() => {
  updateOnline()
  void plugins.load()
  stockChannel.start()
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', updateOnline)
})

onBeforeUnmount(() => {
  stockChannel.stop()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', updateOnline)
})
</script>

<template>
  <div class="space-y-3">
    <CashierHeader
      :cashier-name="cashierName"
      :role-label="roleLabel"
      :business-date-label="businessDateLabel"
      :online="online"
      :stock-live="stockLive"
    />

    <div v-if="notice" class="notice notice-warn" role="status">{{ notice }}</div>

    <div
      v-if="plugins.isEnabled('payment.qris_gateway') && plugins.registry.value.qris.status !== 'ready'"
      class="notice text-[12px]"
      role="status"
    >
      Gateway QRIS dinamis tidak dapat berjalan di aplikasi SPA ini. Pembayaran QRIS tetap dicatat
      manual setelah diverifikasi di aplikasi merchant.
    </div>

    <div class="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div class="min-w-0 space-y-3">
        <section class="panel" aria-labelledby="search-title">
          <div class="panel-head">
            <h2 id="search-title" class="panel-title">Cari produk</h2>
            <span class="text-[11px] text-[var(--color-muted)]">
              {{ search.results.value.length }} hasil · tanpa foto
            </span>
          </div>
          <div class="border-b border-[var(--color-line)] px-3 py-2">
            <ProductSearch
              ref="searchBox"
              v-model="searchModel"
              :scan-buffer="plugins.registry.value.scanner.buffer"
              :scanner-enabled="plugins.registry.value.scanner.status === 'ready'"
              @navigate="search.move"
              @choose="chooseHighlighted"
              @escape="search.clear"
              @scan="handleScan"
            />
          </div>
          <ProductResultsTable
            :products="search.results.value"
            :loading="search.loading.value"
            :error="search.error.value"
            :highlighted-index="search.highlighted.value"
            @choose="chooseProduct"
          />
        </section>

        <section class="panel" aria-labelledby="cart-title">
          <div class="panel-head">
            <h2 id="cart-title" class="panel-title">Keranjang</h2>
            <div class="flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
              <span class="num">{{ store.lineCount }} baris · {{ formatQuantity(store.itemCount) }} unit</span>
              <button
                class="btn px-1.5 py-0.5 text-[11px]"
                type="button"
                :disabled="store.locked || store.lines.length === 0"
                @click="store.clearCart()"
              >
                Kosongkan
              </button>
            </div>
          </div>
          <CartTable
            :lines="store.lines"
            :selected-product-id="store.selectedProductId"
            :locked="store.locked"
            @select="store.selectLine"
            @increment="store.incrementLine"
            @decrement="store.decrementLine"
            @set-quantity="setLineQuantity"
            @remove="store.removeLine"
          />
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] px-3 py-2 text-[12px]">
            <p class="text-[var(--color-muted)]">
              Harga dan stok berasal dari database. Perubahan stok terakhir dicek saat checkout.
            </p>
            <p class="num font-semibold">Subtotal {{ formatRupiah(centsToAmount(store.subtotalCents)) }}</p>
          </div>
        </section>
      </div>

      <PaymentPanel
        :online="online"
        :checkout-enabled="hostedCheckoutEnabled"
        @submit="submitCheckout"
      />
    </div>

    <ReceiptView
      v-if="receiptOpen && store.receipt"
      :receipt="store.receipt"
      :printer="plugins.registry.value.printer"
      @close="receiptOpen = false"
    />
  </div>
</template>
