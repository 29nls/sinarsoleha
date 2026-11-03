<script setup lang="ts">
import type { CashierProduct } from '~/types/cashier'
import { formatQuantity, formatRupiah } from '~/utils/format'
import { isSellable, sellability, sellabilityLabel } from '~/utils/cashier'

defineProps<{
  products: CashierProduct[]
  loading: boolean
  error: string | null
  highlightedIndex: number
}>()

const emit = defineEmits<{ choose: [product: CashierProduct] }>()

function statusClass(product: CashierProduct): string {
  const state = sellability(product)
  if (state === 'available') return 'tag-accent'
  if (state === 'price_missing' || state === 'stock_unknown') return 'tag-warn'
  return 'tag-danger'
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[680px]" :aria-busy="loading">
      <caption class="sr-only">Hasil pencarian produk kasir</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Nama</th>
          <th scope="col">Kategori</th>
          <th scope="col">Satuan</th>
          <th scope="col" class="text-right">Harga</th>
          <th scope="col" class="text-right">Stok</th>
          <th scope="col">Status</th>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="py-6 text-center" role="status">Mencari produk…</td>
        </tr>
        <tr v-else-if="error">
          <td colspan="8" class="py-6 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="products.length === 0">
          <td colspan="8" class="py-6 text-center text-[var(--color-muted)]">
            Ketik minimal satu karakter. Stok yang belum diopname tetap tampil tetapi tidak bisa dijual.
          </td>
        </tr>
        <template v-else>
          <tr
            v-for="(product, index) in products"
            :key="product.id"
            :class="index === highlightedIndex ? 'bg-[var(--color-accent-soft)]' : ''"
            @click="isSellable(product) ? emit('choose', product) : undefined"
          >
            <td class="font-mono text-[12px] font-medium">{{ product.sku }}</td>
            <td class="min-w-[180px] font-medium">{{ product.name }}</td>
            <td>{{ product.categoryName ?? '—' }}</td>
            <td class="whitespace-nowrap">{{ product.unitLabel }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(product.salePrice) }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatQuantity(product.stockOnHand) }}</td>
            <td>
              <span :class="['tag', statusClass(product)]">{{ sellabilityLabel(sellability(product)) }}</span>
            </td>
            <td class="whitespace-nowrap text-right">
              <button
                class="btn px-2 py-0.5 text-[11px]"
                type="button"
                :disabled="!isSellable(product)"
                @click.stop="emit('choose', product)"
              >
                Tambah
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
