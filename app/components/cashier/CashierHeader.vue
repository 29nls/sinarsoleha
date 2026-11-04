<script setup lang="ts">
defineProps<{
  cashierName: string
  roleLabel: string
  businessDateLabel: string
  online: boolean
  stockLive: boolean
}>()
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[var(--color-line)] pb-2">
    <div class="min-w-0">
      <h1 class="text-lg font-semibold tracking-tight">Kasir</h1>
      <p class="text-[11px] text-[var(--color-muted)]">
        {{ cashierName }} · {{ roleLabel }} · Tanggal bisnis {{ businessDateLabel }}
      </p>
    </div>
    <div class="flex items-center gap-2 text-[11px]">
      <span :class="['tag', online ? 'tag-accent' : 'tag-danger']">
        {{ online ? 'Online' : 'Offline' }}
      </span>
      <span :class="['tag', stockLive ? 'tag-accent' : 'tag-warn']">
        {{ stockLive ? 'Stok live' : 'Stok manual' }}
      </span>
      <span class="tag">F2 cari · F9 bayar · Ctrl+Enter simpan</span>
    </div>
  </div>
</template>
