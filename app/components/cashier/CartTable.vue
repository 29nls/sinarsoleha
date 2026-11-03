<script setup lang="ts">
import type { CartLine } from '~/types/cashier'
import { formatQuantity, formatRupiah } from '~/utils/format'
import { centsToAmount, lineTotalCents, quantityStep, validateQuantity } from '~/utils/cashier'

const props = defineProps<{
  lines: CartLine[]
  selectedProductId: string | null
  locked: boolean
}>()

const emit = defineEmits<{
  select: [productId: string]
  increment: [productId: string]
  decrement: [productId: string]
  setQuantity: [productId: string, value: string]
  remove: [productId: string]
}>()

function onQuantityChange(event: Event, productId: string) {
  const input = event.target as HTMLInputElement
  emit('setQuantity', productId, input.value)
  // The store rejects invalid quantities; reset the input so it always shows the real cart value.
  const line = props.lines.find((item) => item.product.id === productId)
  if (line && validateQuantity(input.value, line.product).error) {
    input.value = String(line.quantity)
  }
}

function lineTotal(line: CartLine): string {
  return formatRupiah(centsToAmount(lineTotalCents(line.product, line.quantity)))
}

function step(line: CartLine): number {
  return quantityStep(line.product.decimalScale)
}

function isSelected(line: CartLine): boolean {
  return props.selectedProductId === line.product.id
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[620px]">
      <caption class="sr-only">Keranjang penjualan</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Produk</th>
          <th scope="col" class="text-right">Harga</th>
          <th scope="col" class="text-center">Qty</th>
          <th scope="col" class="text-right">Subtotal</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="lines.length === 0">
          <td colspan="6" class="py-6 text-center text-[var(--color-muted)]">
            Keranjang kosong. Cari produk dengan F2 lalu tekan Enter.
          </td>
        </tr>
        <tr
          v-for="line in lines"
          v-else
          :key="line.product.id"
          :class="isSelected(line) ? 'bg-[var(--color-accent-soft)]' : ''"
          @click="emit('select', line.product.id)"
        >
          <td class="font-mono text-[12px] font-medium">{{ line.product.sku }}</td>
          <td class="min-w-[160px] font-medium">
            {{ line.product.name }}
            <span class="block text-[11px] font-normal text-[var(--color-muted)]">
              {{ line.product.unitLabel }} · stok {{ formatQuantity(line.product.stockOnHand) }}
            </span>
          </td>
          <td class="num whitespace-nowrap text-right">{{ formatRupiah(line.product.salePrice) }}</td>
          <td class="whitespace-nowrap text-center">
            <button
              class="btn px-1.5 py-0.5 text-[11px]"
              type="button"
              :disabled="locked"
              :aria-label="`Kurangi ${line.product.sku}`"
              @click.stop="emit('decrement', line.product.id)"
            >
              −
            </button>
            <input
              class="field num mx-1 w-16 px-1 py-0.5 text-center"
              type="text"
              inputmode="decimal"
              :value="line.quantity"
              :step="step(line)"
              :disabled="locked"
              :aria-label="`Jumlah ${line.product.sku}`"
              @click.stop
              @change="onQuantityChange($event, line.product.id)"
            />
            <button
              class="btn px-1.5 py-0.5 text-[11px]"
              type="button"
              :disabled="locked"
              :aria-label="`Tambah ${line.product.sku}`"
              @click.stop="emit('increment', line.product.id)"
            >
              +
            </button>
          </td>
          <td class="num whitespace-nowrap text-right font-medium">{{ lineTotal(line) }}</td>
          <td class="whitespace-nowrap text-right">
            <button
              class="btn px-1.5 py-0.5 text-[11px]"
              type="button"
              :disabled="locked"
              @click.stop="emit('remove', line.product.id)"
            >
              Hapus
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
