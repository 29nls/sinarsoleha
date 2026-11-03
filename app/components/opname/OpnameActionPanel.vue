<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OpnameDetail } from '~/types/opname'
import {
  isOpnameCancellable,
  isOpnameEditable,
  opnameStatusLabel,
} from '~/types/opname'
import { formatDateTime } from '~/utils/format'

const props = defineProps<{
  detail: OpnameDetail
  canApprove: boolean
  busy: 'count' | 'submit' | 'approve' | 'post' | 'cancel' | null
  pendingCount: number
  recountCount: number
  discrepancyCount: number
  openingBalanceCount: number
  error: string | null
  notice: string | null
}>()

const emit = defineEmits<{
  submit: []
  approve: []
  post: []
  cancel: [reason: string]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const reason = ref('')
const reasonError = ref<string | null>(null)
const confirmingPost = ref(false)

const status = computed(() => props.detail.status)
const editable = computed(() => isOpnameEditable(status.value))
const cancellable = computed(() => isOpnameCancellable(status.value))

const canSubmit = computed(
  () => editable.value && props.pendingCount === 0 && props.recountCount === 0,
)

const submitHint = computed(() => {
  if (!editable.value) return null
  if (props.pendingCount > 0) {
    return `${props.pendingCount} item belum dihitung.`
  }
  if (props.recountCount > 0) {
    return `${props.recountCount} item perlu dihitung ulang.`
  }
  return null
})

watch(
  () => props.error,
  (value) => {
    if (value) confirmingPost.value = false
  },
)

// The parent reloads the session after a successful cancel; close the modal
// once the server-confirmed status arrives instead of reaching into the DOM.
watch(status, (value) => {
  if (value === 'cancelled' && dialog.value?.open) {
    dialog.value.close()
  }
})

function openCancel() {
  reason.value = ''
  reasonError.value = null
  dialog.value?.showModal()
}

function closeCancel() {
  if (props.busy === 'cancel') return
  dialog.value?.close()
}

function confirmCancel() {
  const trimmed = reason.value.trim()
  if (trimmed === '') {
    reasonError.value = 'Alasan pembatalan wajib diisi.'
    return
  }
  reasonError.value = null
  emit('cancel', trimmed)
}

function requestPost() {
  confirmingPost.value = true
}

function confirmPost() {
  confirmingPost.value = false
  emit('post')
}

function statusClass(value: string): string {
  if (value === 'posted') return 'tag tag-accent'
  if (value === 'cancelled') return 'tag'
  if (value === 'counting') return 'tag tag-warn'
  return 'tag tag-accent'
}
</script>

<template>
  <section class="panel" aria-labelledby="opname-action-title">
    <div class="panel-head">
      <h2 id="opname-action-title" class="panel-title">Status &amp; tindakan</h2>
      <span :class="statusClass(status)">{{ opnameStatusLabel(status) }}</span>
    </div>

    <div class="space-y-3 px-3 py-3">
      <dl class="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        <div>
          <dt class="text-[var(--color-muted)]">Dibuat</dt>
          <dd>{{ formatDateTime(detail.createdAt) }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Disubmit</dt>
          <dd>{{ formatDateTime(detail.submittedAt) }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Disetujui</dt>
          <dd>{{ formatDateTime(detail.approvedAt) }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Terposting</dt>
          <dd>{{ formatDateTime(detail.postedAt) }}</dd>
        </div>
      </dl>

      <div v-if="detail.cancelledAt" class="notice">
        Dibatalkan {{ formatDateTime(detail.cancelledAt) }}.
        <span v-if="detail.cancelledReason" class="block">{{ detail.cancelledReason }}</span>
      </div>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[var(--color-line)] pt-2 text-[12px] sm:grid-cols-4">
        <div>
          <dt class="text-[var(--color-muted)]">Belum dihitung</dt>
          <dd class="num font-medium">{{ pendingCount }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Perlu ulang</dt>
          <dd class="num font-medium" :class="recountCount > 0 ? 'text-[var(--color-danger)]' : ''">
            {{ recountCount }}
          </dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Selisih</dt>
          <dd class="num font-medium">{{ discrepancyCount }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Saldo awal</dt>
          <dd class="num font-medium">{{ openingBalanceCount }}</dd>
        </div>
      </dl>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>
      <div v-if="notice" class="notice" role="status">{{ notice }}</div>

      <div v-if="submitHint" class="notice notice-warn">{{ submitHint }}</div>

      <div class="flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-3">
        <button
          v-if="editable"
          class="btn btn-primary"
          type="button"
          :disabled="busy !== null || !canSubmit"
          @click="emit('submit')"
        >
          {{ busy === 'submit' ? 'Mengirim…' : 'Submit untuk persetujuan' }}
        </button>

        <template v-if="status === 'submitted'">
          <button
            v-if="canApprove"
            class="btn btn-primary"
            type="button"
            :disabled="busy !== null"
            @click="emit('approve')"
          >
            {{ busy === 'approve' ? 'Menyetujui…' : 'Setujui sesi' }}
          </button>
          <p v-else class="self-center text-[12px] text-[var(--color-muted)]">
            Menunggu persetujuan owner. Anda tidak dapat menyetujui sesi ini.
          </p>
        </template>

        <template v-if="status === 'approved'">
          <template v-if="canApprove">
            <button
              v-if="!confirmingPost"
              class="btn btn-primary"
              type="button"
              :disabled="busy !== null"
              @click="requestPost"
            >
              Posting penyesuaian stok
            </button>
            <div v-else class="w-full space-y-2 border border-[var(--color-line)] bg-[#fdf8ec] p-2.5">
              <p class="text-[12px]">
                Posting akan mengubah stok <strong>{{ detail.items.length }} produk</strong>
                secara permanen dan tidak dapat dibatalkan. Lanjutkan?
              </p>
              <div class="flex gap-2">
                <button class="btn" type="button" :disabled="busy !== null" @click="confirmingPost = false">
                  Periksa lagi
                </button>
                <button class="btn btn-primary" type="button" :disabled="busy !== null" @click="confirmPost">
                  {{ busy === 'post' ? 'Memposting…' : 'Ya, posting sekarang' }}
                </button>
              </div>
            </div>
          </template>
          <p v-else class="self-center text-[12px] text-[var(--color-muted)]">
            Sesi sudah disetujui dan menunggu posting oleh owner.
          </p>
        </template>

        <button
          v-if="cancellable && canApprove"
          class="btn ml-auto"
          type="button"
          :disabled="busy !== null"
          @click="openCancel"
        >
          Batalkan sesi
        </button>
      </div>
    </div>

    <dialog ref="dialog" class="dialog-panel" @cancel.prevent="closeCancel" @close="reason = ''">
      <form class="space-y-3 p-4" @submit.prevent="confirmCancel">
        <h2 class="text-[15px] font-semibold">Batalkan sesi opname</h2>
        <p class="text-[12px] text-[var(--color-muted)]">
          Pembatalan tidak mengubah stok. Sesi yang sudah terposting tidak dapat dibatalkan.
        </p>
        <div>
          <label class="field-label" for="cancel-reason">Alasan pembatalan</label>
          <textarea
            id="cancel-reason"
            v-model="reason"
            class="field"
            rows="2"
            maxlength="500"
            :disabled="busy === 'cancel'"
          />
        </div>
        <div v-if="reasonError" class="notice notice-error" role="alert">{{ reasonError }}</div>
        <div v-else-if="error" class="notice notice-error" role="alert">{{ error }}</div>
        <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
          <button class="btn" type="button" :disabled="busy === 'cancel'" @click="closeCancel">
            Kembali
          </button>
          <button class="btn" type="submit" :disabled="busy === 'cancel'">
            {{ busy === 'cancel' ? 'Membatalkan…' : 'Batalkan sesi' }}
          </button>
        </div>
      </form>
    </dialog>
  </section>
</template>
