<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useSupabaseClient } from '~/composables/useSupabase'
import { useUsers } from '~/composables/useUsers'
import type { UserDraft, UserRow } from '~/types/users'
import UserTable from '~/components/users/UserTable.vue'
import UserEditDialog from '~/components/users/UserEditDialog.vue'

definePageMeta({ capability: 'users.manage' })
useHead({ title: 'Pengguna · Toko Sinar Soleha POS' })

const client = useSupabaseClient()
const { rows, loading, saving, error, activeCount, ownerCount, load, save, lastOwner } =
  useUsers(client)

const selected = ref<UserRow | null>(null)
const dialogOpen = ref(false)
const dialogError = ref<string | null>(null)
const notice = ref<string | null>(null)

function openEdit(row: UserRow): void {
  selected.value = row
  dialogError.value = null
  dialogOpen.value = true
}

function closeDialog(): void {
  dialogOpen.value = false
  selected.value = null
  dialogError.value = null
}

async function handleSubmit(draft: UserDraft): Promise<void> {
  if (!selected.value) return
  notice.value = null
  dialogError.value = null
  const message = await save(selected.value, draft)
  if (message) {
    dialogError.value = message
    return
  }
  notice.value = `Perubahan untuk ${draft.fullName} disimpan dan dicatat di audit log.`
  closeDialog()
}

onMounted(() => {
  void load(true)
})
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-lg font-semibold tracking-tight">Pengguna</h1>
      <p class="text-[12px] text-[var(--color-muted)]">
        Kelola nama, peran, dan status aktif profil staf. Hanya owner yang dapat membuka halaman ini;
        setiap perubahan ditulis ke audit log oleh RPC, bukan oleh browser.
      </p>
    </div>

    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <div v-if="error && !dialogOpen" class="notice notice-error" role="alert">{{ error }}</div>

    <div class="grid gap-3 sm:grid-cols-3">
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Total profil
        </p>
        <p class="num text-lg font-semibold">{{ rows.length }}</p>
      </div>
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Aktif
        </p>
        <p class="num text-lg font-semibold">{{ activeCount }}</p>
      </div>
      <div class="panel px-3 py-2">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Owner aktif
        </p>
        <p class="num text-lg font-semibold">{{ ownerCount }}</p>
      </div>
    </div>

    <section class="panel" aria-labelledby="users-list-title">
      <div class="panel-head">
        <h2 id="users-list-title" class="panel-title">Daftar pengguna</h2>
        <button class="btn text-[11px]" type="button" :disabled="loading" @click="load(true)">
          Muat ulang
        </button>
      </div>

      <UserTable :rows="rows" :loading="loading" :error="error" @edit="openEdit" />

      <div class="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-[var(--color-muted)]">
        Email dan kata sandi dikelola Supabase Auth dan tidak dapat dibaca dari aplikasi. Profil baru
        muncul setelah akun dibuat lewat dashboard Supabase; halaman ini tidak membuat akun.
      </div>
    </section>

    <UserEditDialog
      :open="dialogOpen"
      :user="selected"
      :saving="saving === selected?.id"
      :error="dialogError"
      :last-owner="selected ? lastOwner(selected) : false"
      @close="closeDialog"
      @submit="handleSubmit"
    />
  </div>
</template>
