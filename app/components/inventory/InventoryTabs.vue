<script setup lang="ts">
import { computed } from 'vue'

const route = useRoute()

const tabs = [
  { path: '/inventory', label: 'Saldo stok' },
  { path: '/inventory/movements', label: 'Pergerakan' },
  { path: '/inventory/discrepancies', label: 'Selisih opname' },
] as const

const activePath = computed(() => route.path.replace(/\/$/, ''))
</script>

<template>
  <nav class="flex flex-wrap gap-1 border-b border-[var(--color-line)]" aria-label="Bagian inventaris">
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
