<script setup lang="ts">
import type { CatalogProduct } from '~/types/catalog'
import { formatQuantity, formatRupiah } from '~/utils/format'
import { stockState } from '~/utils/catalog'
import ProductIssueList from '~/components/catalog/ProductIssueList.vue'
import ProductStatus from '~/components/catalog/ProductStatus.vue'

const props = defineProps<{
  products: CatalogProduct[]
  loading: boolean
  error: string | null
  isOwner: boolean
  page: number
  pageSize: number
  total: number
}>()

const emit = defineEmits<{
  edit: [product: CatalogProduct]
  deactivate: [product: CatalogProduct]
  cost: [product: CatalogProduct]
}>()

function stockClass(product: CatalogProduct): string {
  const state = stockState(product.stockOnHand, product.lowStockThreshold)
  if (state === 'negative') return 'font-semibold text-[var(--color-danger)]'
  if (state === 'unknown' || state === 'empty') return 'text-[var(--color-muted)]'
  return ''
}

function stockText(product: CatalogProduct): string {
  if (product.stockOnHand === null) return '—'
  return formatQuantity(product.stockOnHand)
}

function columnCount(): number {
  return props.isOwner ? 10 : 8
}
</script>

<template>
  <div class="overflow-x-auto">
    <table class="table-dense min-w-[760px]" :aria-busy="loading">
      <caption class="sr-only">Daftar produk katalog</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Nama barang</th>
          <th scope="col">Kategori</th>
          <th scope="col">Satuan</th>
          <th scope="col" class="text-right">Harga jual</th>
          <th scope="col" class="text-right">Stok</th>
          <th scope="col">Status</th>
          <template v-if="isOwner">
            <th scope="col" class="text-right">Harga beli</th>
            <th scope="col">Masalah data</th>
          </template>
          <th scope="col" class="text-right">Aksi</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td :colspan="columnCount()" class="py-8 text-center" role="status">
            Memuat produk…
          </td>
        </tr>
        <tr v-else-if="error">
          <td :colspan="columnCount()" class="py-8 text-center text-[var(--color-danger)]" role="alert">
            {{ error }}
          </td>
        </tr>
        <tr v-else-if="products.length === 0">
          <td :colspan="columnCount()" class="py-8 text-center text-[var(--color-muted)]">
            Tidak ada produk yang cocok. Ubah pencarian atau filter.
          </td>
        </tr>
        <template v-else>
          <tr v-for="product in products" :key="product.id">
            <td class="font-mono text-[12px] font-medium">{{ product.sku }}</td>
            <td class="min-w-[200px] font-medium">{{ product.name }}</td>
            <td>{{ product.categoryName ?? '—' }}</td>
            <td class="whitespace-nowrap">{{ product.unitLabel }}</td>
            <td class="num whitespace-nowrap text-right">{{ formatRupiah(product.salePrice) }}</td>
            <td class="num whitespace-nowrap text-right">
              <span :class="stockClass(product)">{{ stockText(product) }}</span>
              <span v-if="product.stockOnHand === null" class="ml-1 text-[11px] text-[var(--color-muted)]">
                Belum diketahui
              </span>
            </td>
            <td><ProductStatus :product="product" /></td>
            <template v-if="isOwner">
              <td class="num whitespace-nowrap text-right">{{ formatRupiah(product.purchaseCost) }}</td>
              <td><ProductIssueList :issues="product.issues" /></td>
            </template>
            <td class="whitespace-nowrap text-right">
              <template v-if="isOwner">
                <button class="btn px-1.5 py-0.5 text-[11px]" type="button" @click="emit('edit', product)">
                  Edit
                </button>
                <button
                  v-if="product.isActive"
                  class="btn ml-1 px-1.5 py-0.5 text-[11px]"
                  type="button"
                  @click="emit('deactivate', product)"
                >
                  Nonaktifkan
                </button>
                <button class="btn ml-1 px-1.5 py-0.5 text-[11px]" type="button" @click="emit('cost', product)">
                  Biaya
                </button>
              </template>
              <span v-else class="text-[var(--color-muted)]">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="!loading && !error && total > 0" class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
      Halaman {{ page }} · {{ products.length }} baris dari {{ total }} produk
    </p>
  </div>
</template>
