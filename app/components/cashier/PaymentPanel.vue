<script setup lang="ts">
import { computed } from 'vue'
import { useCashierStore } from '~/stores/cashier'
import { formatRupiah } from '~/utils/format'
import { centsToAmount, toCents } from '~/utils/cashier'
import type { PaymentMethod } from '~/types/cashier'

const props = defineProps<{ online: boolean; checkoutEnabled: boolean }>()
const emit = defineEmits<{ submit: [] }>()
const store = useCashierStore()

const cashPayment = computed(() => store.payments.find((payment) => payment.method === 'cash'))
const cashReceivedValue = computed(() =>
  cashPayment.value?.cashReceivedCents === null || cashPayment.value?.cashReceivedCents === undefined
    ? ''
    : String(cashPayment.value.cashReceivedCents / 100),
)

const submitLabel = computed(() => {
  if (store.status === 'submitting') return 'Memproses…'
  if (store.status === 'unknown') return 'Coba lagi checkout'
  return 'Bayar & simpan'
})

const canSubmit = computed(() => {
  if (!props.online || !props.checkoutEnabled) return false
  if (store.status === 'unknown') return true
  return store.canCheckout
})

function money(cents: number): string {
  return formatRupiah(centsToAmount(cents))
}

function onCashReceived(event: Event) {
  const cents = toCents((event.target as HTMLInputElement).value)
  if (cashPayment.value && cents !== null) {
    store.setCashPayment(cashPayment.value.id, { cashReceivedCents: cents })
  }
}

function onAmount(event: Event, id: string) {
  const cents = toCents((event.target as HTMLInputElement).value)
  if (cents !== null) store.setCashPayment(id, { amountCents: cents })
}

function onSplitCashReceived(event: Event, id: string) {
  const cents = toCents((event.target as HTMLInputElement).value)
  if (cents !== null) store.setCashPayment(id, { cashReceivedCents: cents })
}

function addSplit(method: PaymentMethod) {
  store.addSplitPayment(method)
}

function checkout() {
  emit('submit')
}
</script>

<template>
  <section
    id="payment-panel"
    class="panel flex h-full flex-col"
    tabindex="-1"
    aria-labelledby="payment-title"
  >
    <div class="panel-head">
      <h2 id="payment-title" class="panel-title">Pembayaran</h2>
      <span class="tag">F9</span>
    </div>

    <div class="space-y-3 px-4 py-3">
      <dl class="space-y-1 text-[13px]">
        <div class="flex justify-between">
          <dt class="text-[var(--color-muted)]">Subtotal</dt>
          <dd class="num">{{ money(store.subtotalCents) }}</dd>
        </div>
        <div class="flex justify-between border-t border-[var(--color-line)] pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd class="num">{{ money(store.subtotalCents) }}</dd>
        </div>
        <div class="flex justify-between">
          <dt class="text-[var(--color-muted)]">Dibayar</dt>
          <dd class="num">{{ money(store.paidCents) }}</dd>
        </div>
        <div v-if="store.remainingCents > 0" class="flex justify-between text-[var(--color-warn)]">
          <dt>Kurang</dt>
          <dd class="num">{{ money(store.remainingCents) }}</dd>
        </div>
        <div v-if="store.changeCents > 0" class="flex justify-between">
          <dt class="text-[var(--color-muted)]">Kembalian</dt>
          <dd class="num font-semibold">{{ money(store.changeCents) }}</dd>
        </div>
      </dl>

      <div class="flex gap-1" role="tablist" aria-label="Metode pembayaran">
        <button
          v-for="mode in (['cash', 'qris', 'split'] as const)"
          :key="mode"
          class="btn flex-1 px-2 py-1 text-[12px]"
          :class="store.paymentMode === mode ? 'btn-primary' : ''"
          type="button"
          role="tab"
          :aria-selected="store.paymentMode === mode"
          :disabled="store.locked"
          @click="store.setPaymentMode(mode)"
        >
          {{ mode === 'cash' ? 'Tunai' : mode === 'qris' ? 'QRIS' : 'Split' }}
        </button>
      </div>

      <div v-if="store.paymentMode === 'cash'" class="space-y-1">
        <label class="field-label" for="cash-received">Uang diterima (Rp)</label>
        <input
          id="cash-received"
          class="field num text-right"
          type="text"
          inputmode="decimal"
          :value="cashReceivedValue"
          :disabled="store.locked"
          @input="onCashReceived"
        />
        <p class="text-[11px] text-[var(--color-muted)]">
          Kembalian dihitung database: uang diterima − total nota.
        </p>
      </div>

      <div v-else-if="store.paymentMode === 'qris'" class="space-y-2">
        <p class="text-[12px] leading-relaxed">
          QRIS manual. Tidak ada gateway otomatis; kasir memverifikasi pembayaran di aplikasi bank/QRIS.
        </p>
        <label class="flex items-start gap-2 text-[12px]">
          <input
            type="checkbox"
            class="mt-0.5"
            :checked="store.qrisConfirmed"
            :disabled="store.locked"
            @change="store.setQrisConfirmed(($event.target as HTMLInputElement).checked)"
          />
          <span>Pembayaran QRIS telah diterima dan diverifikasi.</span>
        </label>
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="payment in store.payments"
          :key="payment.id"
          class="space-y-1 border border-[var(--color-line)] p-2"
        >
          <div class="flex items-center justify-between text-[12px]">
            <span class="font-semibold uppercase">{{ payment.method }}</span>
            <button
              class="btn px-1.5 py-0.5 text-[11px]"
              type="button"
              :disabled="store.locked"
              @click="store.removePayment(payment.id)"
            >
              Hapus
            </button>
          </div>
          <label class="field-label">Nominal (Rp)</label>
          <input
            class="field num text-right"
            type="text"
            inputmode="decimal"
            :value="payment.amountCents / 100"
            :disabled="store.locked"
            @input="onAmount($event, payment.id)"
          />
          <template v-if="payment.method === 'cash'">
            <label class="field-label">Uang diterima (Rp)</label>
            <input
              class="field num text-right"
              type="text"
              inputmode="decimal"
              :value="payment.cashReceivedCents === null ? '' : payment.cashReceivedCents / 100"
              :disabled="store.locked"
              @input="onSplitCashReceived($event, payment.id)"
            />
          </template>
        </div>

        <div class="flex flex-wrap gap-1">
          <button class="btn px-2 py-1 text-[11px]" type="button" :disabled="store.locked" @click="addSplit('cash')">
            + Tunai
          </button>
          <button class="btn px-2 py-1 text-[11px]" type="button" :disabled="store.locked" @click="addSplit('qris')">
            + QRIS
          </button>
          <button class="btn px-2 py-1 text-[11px]" type="button" :disabled="store.locked" @click="addSplit('other')">
            + Lainnya
          </button>
          <button
            class="btn px-2 py-1 text-[11px]"
            type="button"
            :disabled="store.locked || store.remainingCents <= 0"
            @click="addSplit('cash')"
          >
            Isi sisa {{ money(store.remainingCents) }}
          </button>
        </div>

        <label v-if="store.payments.some((payment) => payment.method === 'qris')" class="flex items-start gap-2 text-[12px]">
          <input
            type="checkbox"
            class="mt-0.5"
            :checked="store.qrisConfirmed"
            :disabled="store.locked"
            @change="store.setQrisConfirmed(($event.target as HTMLInputElement).checked)"
          />
          <span>Pembayaran QRIS telah diterima dan diverifikasi.</span>
        </label>
      </div>

      <p v-if="store.stockError" class="text-[11px] text-[var(--color-danger)]">
        {{ store.stockError }}
      </p>
      <p v-else-if="store.paymentError" class="text-[11px] text-[var(--color-muted)]">
        {{ store.paymentError }}
      </p>
      <div v-if="store.error" class="notice notice-error" role="alert">{{ store.error }}</div>
      <div v-if="!online" class="notice notice-warn">Koneksi terputus. Checkout dinonaktifkan.</div>
      <div v-if="!checkoutEnabled" class="notice notice-warn">
        Checkout hosted menunggu kelulusan validasi Phase 4A.1.
      </div>
    </div>

    <div class="mt-auto space-y-2 border-t border-[var(--color-line)] px-4 py-3">
      <button
        class="btn btn-primary w-full py-2"
        type="button"
        :disabled="!canSubmit"
        @click="checkout"
      >
        {{ submitLabel }}
      </button>
      <p class="text-[11px] text-[var(--color-muted)]">
        Ctrl+Enter · diskon 0 · total dihitung ulang di database
      </p>
    </div>
  </section>
</template>
