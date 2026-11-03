<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { validateVoidReason } from '~/types/transactions'

const props = defineProps<{
  open: boolean
  receiptNo: string
  grandTotal: number
  submitting: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [reason: string]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const reason = ref('')
const localError = ref<string | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    reason.value = ''
    localError.value = null
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  },
  { immediate: true },
)

function submit() {
  localError.value = null
  const err = validateVoidReason(reason.value)
  if (err) {
    localError.value = err
    return
  }
  emit('submit', reason.value.trim())
}
</script>

<template>
  <dialog ref="dialog" class="dialog-panel max-w-md" @close="emit('close')" @cancel.prevent="emit('close')">
    <form class="space-y-3 p-4" novalidate @submit.prevent="submit">
      <div class="border-b border-[var(--color-line)] pb-3">
        <h2 class="text-[15px] font-semibold">Batalkan Transaksi</h2>
        <p class="text-[12px] text-[var(--color-muted)]">
          Nota {{ receiptNo }}
        </p>
      </div>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div class="notice notice-warn">
        Pembatalan akan memulihkan stok. Transaksi tidak dapat dikembalikan setelah dibatalkan.
      </div>

      <div>
        <label class="field-label" for="void-reason">Alasan pembatalan</label>
        <textarea
          id="void-reason"
          v-model="reason"
          class="field"
          rows="3"
          maxlength="500"
          required
          :aria-invalid="Boolean(localError)"
          placeholder="Tuliskan alasan pembatalan"
        />
        <p class="mt-1 text-[11px] text-[var(--color-muted)]">
          {{ reason.trim().length }}/500 karakter
        </p>
        <p v-if="localError" class="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{{ localError }}</p>
      </div>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="submitting" @click="emit('close')">Batal</button>
        <button class="btn" type="submit" :disabled="submitting" style="border-color: var(--color-danger); color: var(--color-danger);">
          {{ submitting ? 'Membatalkan…' : 'Batalkan Transaksi' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
