<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useTransactionDetail } from '~/composables/useTransactionDetail'
import { useTransactionVoid } from '~/composables/useTransactionVoid'
import { statusLabel, paymentMethodLabel } from '~/types/transactions'
import { formatDate, formatDateTime, formatQuantity, formatRupiah } from '~/utils/format'
import ReceiptView from '~/components/cashier/ReceiptView.vue'
import VoidTransactionDialog from '~/components/transactions/VoidTransactionDialog.vue'

definePageMeta({ capability: 'sale.read.own' })

const route = useRoute()
const auth = useAuthStore()
const client = useSupabaseClient()

const transactionId = computed(() => route.params.id as string)
const isOwner = computed(() => auth.role === 'owner')

const { detail, loading, error, load, refresh } = useTransactionDetail({
  client,
  currentUserId: () => auth.profile?.id ?? '',
  currentUserName: () => auth.profile?.full_name ?? 'Kasir',
})

const voidAction = useTransactionVoid({ client })

const showReceipt = ref(false)
const showVoidDialog = ref(false)
const voidSuccess = ref<string | null>(null)

onMounted(() => {
  void load(transactionId.value)
})

function openReceipt() {
  showReceipt.value = true
}

function openVoidDialog() {
  voidAction.reset()
  voidSuccess.value = null
  showVoidDialog.value = true
}

async function handleVoidSubmit(reason: string) {
  const ok = await voidAction.submit(transactionId.value, reason)
  if (ok) {
    showVoidDialog.value = false
    voidSuccess.value = 'Transaksi berhasil dibatalkan.'
    await refresh(transactionId.value)
  }
}

function statusClass(status: string): string {
  if (status === 'voided') return 'tag tag-danger'
  return 'tag tag-accent'
}
</script>

<template>
  <div class="mx-auto max-w-[900px] space-y-3 p-4">
    <div class="flex items-baseline justify-between gap-4">
      <h1 class="text-[18px] font-bold">Detail Transaksi</h1>
      <NuxtLink to="/cashier/transactions" class="btn text-[12px]">Kembali</NuxtLink>
    </div>

    <div v-if="loading" class="panel p-8 text-center" role="status">Memuat detail…</div>
    <div v-else-if="error" class="panel p-8 text-center text-[var(--color-danger)]" role="alert">{{ error }}</div>

    <template v-else-if="detail">
      <div v-if="voidSuccess" class="notice" style="border-left-color: var(--color-accent);">
        {{ voidSuccess }}
      </div>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Nota {{ detail.receiptNo }}</h2>
          <span :class="statusClass(detail.status)">{{ statusLabel(detail.status) }}</span>
        </div>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-1 px-3 py-3 text-[12px] sm:grid-cols-4">
          <div>
            <dt class="text-[var(--color-muted)]">ID Transaksi</dt>
            <dd class="font-mono text-[11px]">{{ detail.transactionId }}</dd>
          </div>
          <div>
            <dt class="text-[var(--color-muted)]">Tanggal</dt>
            <dd>{{ formatDate(`${detail.businessDate}T00:00:00+07:00`) }}</dd>
          </div>
          <div>
            <dt class="text-[var(--color-muted)]">Kasir</dt>
            <dd>{{ detail.cashierName || 'Kasir' }}</dd>
          </div>
          <div>
            <dt class="text-[var(--color-muted)]">Waktu</dt>
            <dd>{{ detail.createdAt ? formatDateTime(detail.createdAt) : 'Tidak tersedia' }}</dd>
          </div>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Item</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="table-dense min-w-[600px]">
            <thead>
              <tr>
                <th scope="col">SKU</th>
                <th scope="col">Nama</th>
                <th scope="col">Satuan</th>
                <th scope="col" class="text-right">Qty</th>
                <th scope="col" class="text-right">Harga</th>
                <th scope="col" class="text-right">Diskon</th>
                <th scope="col" class="text-right">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="detail.items.length === 0">
                <td colspan="7" class="py-4 text-center text-[var(--color-muted)]">
                  Detail item tidak tersedia.
                </td>
              </tr>
              <tr v-for="(item, i) in detail.items" :key="`${item.sku}-${i}`">
                <td class="font-mono text-[12px]">{{ item.sku }}</td>
                <td class="font-medium">{{ item.name }}</td>
                <td>{{ item.unit }}</td>
                <td class="num text-right">{{ formatQuantity(item.quantity) }}</td>
                <td class="num text-right whitespace-nowrap">{{ formatRupiah(item.unitPrice) }}</td>
                <td class="num text-right whitespace-nowrap">{{ formatRupiah(item.lineDiscount) }}</td>
                <td class="num text-right whitespace-nowrap font-medium">{{ formatRupiah(item.lineTotal) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Ringkasan</h2>
        </div>
        <dl class="px-3 py-3 text-[13px]">
          <div class="flex justify-between py-0.5">
            <dt>Subtotal</dt>
            <dd class="num">{{ formatRupiah(detail.subtotal) }}</dd>
          </div>
          <div class="flex justify-between py-0.5">
            <dt>Diskon</dt>
            <dd class="num">{{ formatRupiah(detail.discountAmount) }}</dd>
          </div>
          <div class="flex justify-between border-t border-[var(--color-line)] pt-1 text-[15px] font-bold">
            <dt>Total</dt>
            <dd class="num">{{ formatRupiah(detail.grandTotal) }}</dd>
          </div>
        </dl>
      </section>

      <section class="panel">
        <div class="panel-head">
          <h2 class="panel-title">Pembayaran</h2>
        </div>
        <dl class="px-3 py-3 text-[13px]">
          <div v-for="(payment, i) in detail.payments" :key="`${payment.method}-${i}`" class="flex justify-between py-0.5">
            <dt>{{ paymentMethodLabel(payment.method) }}</dt>
            <dd class="num">
              {{ formatRupiah(payment.amountApplied) }}
              <span v-if="payment.cashReceived !== null" class="block text-[11px] text-[var(--color-muted)]">
                diterima {{ formatRupiah(payment.cashReceived) }} · kembali {{ formatRupiah(payment.cashChange) }}
              </span>
            </dd>
          </div>
          <div v-if="detail.payments.length === 0" class="text-[var(--color-muted)]">
            Detail pembayaran tidak tersedia.
          </div>
        </dl>
      </section>

      <div class="flex flex-wrap gap-2">
        <button class="btn" type="button" @click="openReceipt">Cetak Ulang Struk</button>
        <button
          v-if="isOwner && detail.status === 'completed'"
          class="btn"
          type="button"
          style="border-color: var(--color-danger); color: var(--color-danger);"
          @click="openVoidDialog"
        >
          Batalkan Transaksi
        </button>
      </div>

      <ReceiptView v-if="showReceipt" :receipt="detail" @close="showReceipt = false" />

      <VoidTransactionDialog
        :open="showVoidDialog"
        :receipt-no="detail.receiptNo"
        :grand-total="detail.grandTotal"
        :submitting="voidAction.submitting.value"
        :error="voidAction.error.value"
        @close="showVoidDialog = false"
        @submit="handleVoidSubmit"
      />
    </template>
  </div>
</template>
