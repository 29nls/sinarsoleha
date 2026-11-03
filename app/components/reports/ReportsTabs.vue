<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()

const tabs = [
  { path: '/reports', label: 'Ringkasan penjualan' },
  { path: '/reports/products', label: 'Per produk' },
  { path: '/reports/exceptions', label: 'Exception data' },
] as const

const activePath = computed(() => route.path.replace(/\/$/, ''))
</script>

<template>
  <nav class="flex flex-wrap gap-1 border-b border-[var(--color-line)]" aria-label="Bagian laporan">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.path"
      :to="tab.path"
      class="-mb-px border-b-2 px-3 py-1.5 text-[12px] font-semibold"
      :class="activePath === tab.path
        ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
        : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-ink)]'"
      :aria-current="activePath === tab.path ? 'page' : undefined"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
