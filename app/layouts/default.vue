<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { availableModules } from '~/utils/modules'
import { ROLE_LABELS } from '~/types/database'

const auth = useAuthStore()
const signingOut = ref(false)

const navModules = computed(() => availableModules((capability) => auth.allows(capability)))
const roleLabel = computed(() => (auth.role ? ROLE_LABELS[auth.role] : '—'))
const userName = computed(() => auth.profile?.full_name ?? auth.email ?? 'Pengguna')

async function handleSignOut() {
  signingOut.value = true
  try {
    await auth.signOut()
    await navigateTo('/login', { replace: true })
  } finally {
    signingOut.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-[var(--color-canvas)] text-[var(--color-ink)]">
    <header class="border-b border-[var(--color-line)] bg-white">
      <div class="mx-auto flex max-w-[1600px] items-center justify-between gap-4 px-4 py-2.5">
        <div class="min-w-0">
          <p class="truncate text-[13px] font-semibold tracking-tight">TOKO SINAR SOLEHA POS</p>
          <p class="text-[11px] text-[var(--color-muted)]">Sistem penjualan dan inventaris</p>
        </div>
        <div class="flex items-center gap-3 text-[12px]">
          <div class="hidden text-right sm:block">
            <p class="font-semibold">{{ userName }}</p>
            <p class="text-[11px] text-[var(--color-muted)]">{{ roleLabel }}</p>
          </div>
          <button class="btn" type="button" :disabled="signingOut" @click="handleSignOut">
            {{ signingOut ? 'Keluar…' : 'Keluar' }}
          </button>
        </div>
      </div>
    </header>

    <div class="mx-auto flex max-w-[1600px] flex-col lg:flex-row">
      <aside
        class="border-b border-[var(--color-line)] bg-white lg:min-h-[calc(100vh-53px)] lg:w-56 lg:shrink-0 lg:border-b-0 lg:border-r"
      >
        <LayoutAppNav :modules="navModules" />
      </aside>

      <main class="min-w-0 flex-1 p-4 lg:p-6">
        <slot />
      </main>
    </div>
  </div>
</template>
