<script setup lang="ts">
import type { ReceiptDetail } from '~/types/cashier'
import { formatDate, formatDateTime, formatQuantity, formatRupiah } from '~/utils/format'

const props = defineProps<{ receipt: ReceiptDetail }>()
const emit = defineEmits<{ close: [] }>()

const methodLabel: Record<string, string> = {
  cash: 'Tunai',
  qris: 'QRIS',
  other: 'Lainnya',
}

function printReceipt() {
  window.print()
}
</script>

<template>
  <div class="receipt-overlay" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
    <div class="receipt-sheet">
      <div class="receipt-head">
        <div>
          <p class="receipt-store">TOKO SINAR SOLEHA</p>
          <h2 id="receipt-title" class="receipt-title">Nota {{ props.receipt.receiptNo }}</h2>
        </div>
        <div class="receipt-meta">
          <p>{{ formatDate(`${props.receipt.businessDate}T00:00:00+07:00`) }}</p>
          <p>{{ props.receipt.cashierName || 'Kasir' }}</p>
          <p class="font-mono text-[10px]">{{ props.receipt.transactionId }}</p>
        </div>
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col" class="text-right">Qty</th>
            <th scope="col" class="text-right">Harga</th>
            <th scope="col" class="text-right">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in props.receipt.items" :key="`${item.sku}-${index}`">
            <td>
              <span class="font-medium">{{ item.name }}</span>
              <span class="block font-mono text-[10px] text-[var(--color-muted)]">
                {{ item.sku }} · {{ item.unit }}
              </span>
            </td>
            <td class="num text-right">{{ formatQuantity(item.quantity) }}</td>
            <td class="num text-right">{{ formatRupiah(item.unitPrice) }}</td>
            <td class="num text-right">{{ formatRupiah(item.lineTotal) }}</td>
          </tr>
          <tr v-if="props.receipt.items.length === 0">
            <td colspan="4" class="text-[var(--color-muted)]">
              Detail item tidak tersedia; nota tersimpan di database.
            </td>
          </tr>
        </tbody>
      </table>

      <dl class="receipt-totals">
        <div>
          <dt>Subtotal</dt>
          <dd>{{ formatRupiah(props.receipt.subtotal) }}</dd>
        </div>
        <div>
          <dt>Diskon</dt>
          <dd>{{ formatRupiah(props.receipt.discountAmount) }}</dd>
        </div>
        <div class="receipt-grand">
          <dt>Total</dt>
          <dd>{{ formatRupiah(props.receipt.grandTotal) }}</dd>
        </div>
      </dl>

      <dl class="receipt-payments">
        <div v-for="(payment, index) in props.receipt.payments" :key="`${payment.method}-${index}`">
          <dt>{{ methodLabel[payment.method] ?? payment.method }}</dt>
          <dd>
            {{ formatRupiah(payment.amountApplied) }}
            <span v-if="payment.cashReceived !== null" class="block text-[10px] text-[var(--color-muted)]">
              diterima {{ formatRupiah(payment.cashReceived) }} · kembali {{ formatRupiah(payment.cashChange) }}
            </span>
          </dd>
        </div>
      </dl>

      <p class="receipt-foot">
        {{ props.receipt.createdAt ? formatDateTime(props.receipt.createdAt) : 'Waktu transaksi tidak tersedia' }} · {{ props.receipt.status }}
      </p>

      <div class="receipt-actions">
        <button class="btn" type="button" @click="printReceipt">Cetak</button>
        <button class="btn btn-primary" type="button" @click="emit('close')">Tutup</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.receipt-overlay {
  position: fixed;
  inset: 0;
  z-index: 40;
  overflow-y: auto;
  background: rgb(17 24 39 / 0.35);
  padding: 1rem;
}

.receipt-sheet {
  margin: 2rem auto;
  max-width: 640px;
  border: 1px solid var(--color-line);
  background: #fff;
  padding: 1.25rem;
}

.receipt-head {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px dashed var(--color-line);
  padding-bottom: 0.75rem;
}

.receipt-store {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.receipt-title {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
}

.receipt-meta {
  text-align: right;
  font-size: 11px;
  color: var(--color-muted);
}

.receipt-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0.75rem;
  font-size: 12px;
}

.receipt-table th {
  border-bottom: 1px solid var(--color-line);
  padding: 0.375rem 0.25rem;
  text-align: left;
  font-size: 11px;
  color: var(--color-muted);
}

.receipt-table td {
  border-bottom: 1px solid var(--color-line);
  padding: 0.375rem 0.25rem;
  vertical-align: top;
}

.receipt-totals,
.receipt-payments {
  margin-top: 0.75rem;
  font-size: 12px;
}

.receipt-totals div,
.receipt-payments div {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.125rem 0;
}

.receipt-grand {
  border-top: 1px solid var(--color-line);
  margin-top: 0.25rem;
  padding-top: 0.375rem;
  font-size: 14px;
  font-weight: 700;
}

.receipt-foot {
  margin-top: 0.75rem;
  border-top: 1px dashed var(--color-line);
  padding-top: 0.5rem;
  font-size: 10px;
  color: var(--color-muted);
}

.receipt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}

@media print {
  :global(body *) {
    visibility: hidden;
  }

  .receipt-sheet,
  .receipt-sheet * {
    visibility: visible;
  }

  .receipt-overlay {
    position: static;
    padding: 0;
    background: #fff;
  }

  .receipt-sheet {
    margin: 0 auto;
    border: 0;
    max-width: none;
    padding: 0;
  }

  .receipt-actions {
    display: none;
  }
}
</style>
