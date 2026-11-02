<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuthStore } from '~/stores/auth'
import { useSupabaseConfig } from '~/composables/useSupabase'

definePageMeta({ layout: 'auth' })
useHead({ title: 'Masuk · Toko Sinar Soleha POS' })

const auth = useAuthStore()
const route = useRoute()
const { configured } = useSupabaseConfig()

const email = ref('')
const password = ref('')
const submitting = ref(false)

onMounted(async () => {
  await auth.initialize()
  if (auth.isAuthenticated) await navigateTo('/dashboard', { replace: true })
})

function safeRedirect(): string {
  const target = route.query.redirect
  if (typeof target === 'string' && target.startsWith('/') && !target.startsWith('//')) return target
  return '/dashboard'
}

async function submit() {
  if (submitting.value) return
  submitting.value = true
  try {
    const ok = await auth.signIn(email.value, password.value)
    if (ok) await navigateTo(safeRedirect(), { replace: true })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="panel">
    <div class="border-b border-[var(--color-line)] px-5 py-4">
      <p class="text-[13px] font-semibold tracking-tight">TOKO SINAR SOLEHA POS</p>
      <p class="mt-0.5 text-[12px] text-[var(--color-muted)]">Masuk dengan akun staf yang diberikan owner.</p>
    </div>

    <form class="space-y-3 px-5 py-4" @submit.prevent="submit">
      <div class="notice notice-warn" v-if="!configured">
        <p class="font-semibold">Supabase belum dikonfigurasi</p>
        <p class="mt-1">
          Isi <code class="font-mono">SUPABASE_URL</code> dan
          <code class="font-mono">SUPABASE_PUBLISHABLE_KEY</code> pada berkas <code class="font-mono">.env</code>,
          lalu jalankan ulang aplikasi. Formulir tidak dapat digunakan sebelum itu.
        </p>
      </div>

      <div class="notice notice-error" v-if="auth.errorMessage" role="alert">
        {{ auth.errorMessage }}
      </div>

      <div>
        <label class="field-label" for="email">Email</label>
        <input
          id="email"
          v-model="email"
          class="field"
          type="email"
          name="email"
          autocomplete="username"
          required
          :disabled="!configured || submitting"
        />
      </div>

      <div>
        <label class="field-label" for="password">Kata sandi</label>
        <input
          id="password"
          v-model="password"
          class="field"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          :disabled="!configured || submitting"
        />
      </div>

      <button class="btn btn-primary w-full" type="submit" :disabled="!configured || submitting">
        {{ submitting ? 'Memeriksa…' : 'Masuk' }}
      </button>

      <p class="text-[11px] leading-relaxed text-[var(--color-muted)]">
        Akun tidak dibuat melalui halaman ini. Owner membuat akun dan menetapkan peran pada tabel
        <code class="font-mono">profiles</code>. Semua izin data tetap diperiksa oleh PostgreSQL.
      </p>
    </form>
  </div>
</template>
