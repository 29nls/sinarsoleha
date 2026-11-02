<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const title = computed(() => {
  if (props.error.statusCode === 403) return 'Akses ditolak'
  if (props.error.statusCode === 404) return 'Halaman tidak ditemukan'
  return 'Terjadi kesalahan'
})

function backToApp() {
  clearError({ redirect: '/' })
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-[var(--color-canvas)] px-4">
    <div class="panel w-full max-w-md">
      <div class="border-b border-[var(--color-line)] px-5 py-4">
        <p class="text-[11px] font-semibold tracking-[0.08em] text-[var(--color-muted)]">
          TOKO SINAR SOLEHA POS
        </p>
        <h1 class="mt-1 text-base font-semibold">{{ title }}</h1>
      </div>
      <div class="space-y-3 px-5 py-4">
        <p class="text-[13px]">
          {{ props.error.statusMessage || 'Permintaan tidak dapat diproses.' }}
        </p>
        <p class="num text-[11px] text-[var(--color-muted)]">Kode: {{ props.error.statusCode }}</p>
        <button class="btn btn-primary" type="button" @click="backToApp">Kembali ke aplikasi</button>
      </div>
    </div>
  </div>
</template>
