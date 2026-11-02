<script setup lang="ts">
import { computed } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import { reviewStatusLabel, stockState, stockStateLabel } from '~/utils/catalog'

const props = defineProps<{ product: CatalogProduct }>()
const state = computed(() => stockState(props.product.stockOnHand, props.product.lowStockThreshold))
</script>

<template>
  <div class="flex flex-wrap gap-1">
    <span :class="['tag', product.isActive ? 'tag-accent' : '']">
      {{ product.isActive ? 'Aktif' : 'Nonaktif' }}
    </span>
    <span v-if="product.salePrice === null" class="tag tag-warn">Harga jual belum tersedia</span>
    <span v-if="state === 'unknown'" class="tag tag-warn">{{ stockStateLabel(state) }}</span>
    <span v-else-if="state === 'negative'" class="tag tag-danger">Stok negatif</span>
    <span v-else-if="state === 'empty'" class="tag">Stok habis</span>
    <span v-else-if="state === 'low'" class="tag tag-warn">Stok rendah</span>
    <span v-if="product.reviewStatus !== 'verified'" class="tag tag-warn">
      {{ reviewStatusLabel(product.reviewStatus) }}
    </span>
  </div>
</template>
