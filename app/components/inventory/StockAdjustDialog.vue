<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { StockBalanceRow } from '~/types/inventory'
import { ADJUSTMENT_REASONS, validateAdjustment } from '~/types/inventory'
import { opnameReasonLabel } from '~/types/opname'
import { formatQuantity } from '~/utils/format'

const props = defineProps<{
  open: boolean
  row: StockBalanceRow | null
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: { delta: number; reasonCode: string; reasonNote: string }]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const direction = ref<'in' | 'out'>('out')
const amount = ref('')
const reasonCode = ref('')
const reasonNote = ref('')
const formError = ref<string | null>(null)

const signedDelta = computed(() => {
  const raw = amount.value.trim().replace(',', '.')
  if (raw === '') return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return 0
  return direction.value === 'out' ? -Math.abs(parsed) : Math.abs(parsed)
})

const preview = computed(() => {
  if (!props.row || props.row.stockOnHand === null) return null
  return props.row.stockOnHand + signedDelta.value
})

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (!element) return

    if (open) {
      direction.value = 'out'
      amount.value = ''
      reasonCode.value = ''
      reasonNote.value = ''
      formError.value = null
      if (!element.open) element.showModal()
    } else if (element.open) {
      element.close()
    }
  },
)

function submit() {
  const row = props.row
  if (!row) return

  const delta = signedDelta.value
  const message = validateAdjustment({
    stockOnHand: row.stockOnHand,
    delta: String(delta),
    reasonCode: reasonCode.value,
    reasonNote: reasonNote.value,
    decimalScale: row.decimalScale,
  })

  if (message) {
    formError.value = message
    return
  }

  formError.value = null
  emit('submit', {
    delta,
    reasonCode: reasonCode.value,
    reasonNote: reasonNote.value.trim(),
  })
}

function close() {
  if (props.saving) return
  emit('close')
}
</script>

<template>
  <dialog ref="dialog" class="dialog-panel" @cancel.prevent="close" @close="emit('close')">
    <form class="space-y-3 p-4" @submit.prevent="submit">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold">Koreksi stok</h2>
          <p v-if="row" class="truncate text-[12px] text-[var(--color-muted)]">
            {{ row.sku }} · {{ row.name }}
          </p>
        </div>
        <button class="btn" type="button" :disabled="saving" @click="close">Tutup</button>
      </div>

      <dl v-if="row" class="grid grid-cols-3 gap-x-4 gap-y-1 border-y border-[var(--color-line)] py-2 text-[12px]">
        <div>
          <dt class="text-[var(--color-muted)]">Stok saat ini</dt>
          <dd class="num font-medium">{{ formatQuantity(row.stockOnHand) }} {{ row.unitLabel }}</dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Koreksi</dt>
          <dd class="num font-medium">
            {{ signedDelta > 0 ? '+' : '' }}{{ formatQuantity(signedDelta) }} {{ row.unitLabel }}
          </dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Menjadi</dt>
          <dd class="num font-semibold" :class="preview !== null && preview < 0 ? 'text-[var(--color-danger)]' : ''">
            {{ formatQuantity(preview) }} {{ row.unitLabel }}
          </dd>
        </div>
      </dl>

      <p v-if="row && row.stockOnHand === null" class="notice notice-warn">
        Saldo produk ini belum diketahui. Koreksi manual tidak dapat dipakai; catat lewat
        <strong>Stok Opname</strong> sebagai saldo awal.
      </p>

      <template v-if="row && row.stockOnHand !== null">
        <div>
          <span class="field-label">Arah koreksi</span>
          <div class="flex gap-2">
            <label class="flex items-center gap-1.5 text-[12px]">
              <input v-model="direction" type="radio" value="out" :disabled="saving">
              Mengurangi
            </label>
            <label class="flex items-center gap-1.5 text-[12px]">
              <input v-model="direction" type="radio" value="in" :disabled="saving">
              Menambah
            </label>
          </div>
        </div>

        <div>
          <label class="field-label" for="adjust-amount">Jumlah</label>
          <input
            id="adjust-amount"
            v-model="amount"
            class="field num"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            :disabled="saving"
          >
          <p class="mt-1 text-[11px] text-[var(--color-muted)]">
            <template v-if="row.decimalScale > 0">Boleh {{ row.decimalScale }} angka desimal.</template>
            <template v-else>Satuan ini hanya menerima angka bulat.</template>
          </p>
        </div>

        <div>
          <label class="field-label" for="adjust-reason">Alasan</label>
          <select id="adjust-reason" v-model="reasonCode" class="field" :disabled="saving">
            <option value="">Pilih alasan…</option>
            <option v-for="reason in ADJUSTMENT_REASONS" :key="reason" :value="reason">
              {{ opnameReasonLabel(reason) }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="adjust-note">Catatan (wajib)</label>
          <textarea
            id="adjust-note"
            v-model="reasonNote"
            class="field"
            rows="2"
            :disabled="saving"
          />
        </div>
      </template>

      <div v-if="formError" class="notice notice-error" role="alert">{{ formError }}</div>
      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button
          class="btn btn-primary"
          type="submit"
          :disabled="saving || !row || row.stockOnHand === null"
        >
          {{ saving ? 'Menyimpan…' : 'Simpan koreksi' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
