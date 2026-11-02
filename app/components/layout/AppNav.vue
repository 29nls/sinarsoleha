<script setup lang="ts">
import type { AppModule } from '~/utils/modules'

defineProps<{ modules: AppModule[] }>()
</script>

<template>
  <nav aria-label="Navigasi utama" class="px-2 py-2 lg:py-3">
    <ul class="flex gap-1 overflow-x-auto lg:flex-col">
      <li v-for="item in modules" :key="item.key" class="shrink-0">
        <NuxtLink
          :to="item.path"
          class="block border-l-2 border-transparent px-2.5 py-1.5 text-[13px] font-medium text-[var(--color-muted)] hover:bg-[#f7f8f9] hover:text-[var(--color-ink)]"
          active-class="border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[#0b5a4f]"
        >
          {{ item.label }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
