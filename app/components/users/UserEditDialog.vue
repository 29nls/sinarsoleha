<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { UserDraft, UserRow } from '~/types/users'
import {
  USER_ROLES,
  USER_ROLE_LABELS,
  shortUserId,
  validateFullName,
} from '~/types/users'

const props = defineProps<{
  open: boolean
  user: UserRow | null
  saving: boolean
  error: string | null
  /** Computed by the page from the whole list, not from the row alone. */
  lastOwner: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: UserDraft]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const fullName = ref('')
const role = ref<UserDraft['role']>('cashier')
const isActive = ref(false)
const localError = ref<string | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    fullName.value = props.user?.fullName ?? ''
    role.value = props.user?.role ?? 'cashier'
    isActive.value = props.user?.isActive ?? false
    localError.value = null
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  },
  { immediate: true },
)

function close() {
  if (dialog.value?.open) dialog.value.close()
  else emit('close')
}

function submit() {
  localError.value = validateFullName(fullName.value)
  if (localError.value) return
  emit('submit', { fullName: fullName.value.trim(), role: role.value, isActive: isActive.value })
}
</script>

<template>
  <dialog
    ref="dialog"
    class="dialog-panel max-w-lg"
    @close="emit('close')"
    @cancel.prevent="emit('close')"
  >
    <form class="space-y-3 p-4" novalidate @submit.prevent="submit">
      <div class="border-b border-[var(--color-line)] pb-3">
        <h2 class="text-[15px] font-semibold">Ubah pengguna</h2>
        <p class="text-[12px] text-[var(--color-muted)]">
          {{ user?.fullName }} · id {{ user ? shortUserId(user.id) : '—' }}
        </p>
      </div>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div>
        <label class="field-label" for="user-full-name">Nama lengkap</label>
        <input
          id="user-full-name"
          v-model="fullName"
          class="field"
          type="text"
          maxlength="120"
          autocomplete="off"
          :aria-invalid="Boolean(localError)"
          aria-describedby="user-full-name-help"
        />
        <p id="user-full-name-help" class="mt-1 text-[11px] text-[var(--color-muted)]">
          Nama ini yang tampil di riwayat transaksi dan audit log.
        </p>
        <p v-if="localError" class="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">
          {{ localError }}
        </p>
      </div>

      <div>
        <label class="field-label" for="user-role">Peran</label>
        <select id="user-role" v-model="role" class="field">
          <option v-for="value in USER_ROLES" :key="value" :value="value">
            {{ USER_ROLE_LABELS[value] }}
          </option>
        </select>
        <p class="mt-1 text-[11px] text-[var(--color-muted)]">
          Peran menentukan menu dan akses data. Otorisasi tetap diperiksa database setiap permintaan.
        </p>
      </div>

      <label class="flex items-start gap-2 text-[12px]">
        <input v-model="isActive" type="checkbox" class="mt-0.5" />
        <span>
          <span class="font-semibold">Akun aktif</span>
          <span class="block text-[11px] text-[var(--color-muted)]">
            Akun nonaktif tidak bisa masuk dan ditolak RLS. Aktivasi pertama mengisi waktu dan
            pelaku aktivasi.
          </span>
        </span>
      </label>

      <p v-if="props.lastOwner" class="notice notice-warn" role="status">
        Ini satu-satunya owner aktif. Menurunkan peran atau menonaktifkannya akan ditolak server
        (<span class="font-mono text-[11px]">LAST_OWNER</span>) sampai ada owner aktif lain.
      </p>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? 'Menyimpan…' : 'Simpan perubahan' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
