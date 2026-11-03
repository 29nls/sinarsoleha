<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { OpnameItemRow } from '~/types/opname'
import {
  allowedReasons,
  opnameReasonLabel,
  reasonRequirement,
  validateCount,
} from '~/types/opname'
import { formatQuantity } from '~/utils/format'

const props = defineProps<{
  open: boolean
  item: OpnameItemRow | null
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: { physicalQty: number; reasonCode: string | null; reasonNote: string | null }]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const physicalQty = ref('')
const reasonCode = ref('')
const reasonNote = ref('')
const formError = ref<string | null>(null)

const requirement = computed(() =>
  reasonRequirement(props.item?.systemQtySnapshot ?? null, parseQty(physicalQty.value)),
)

const reasonOptions = computed(() => allowedReasons(props.item?.systemQtySnapshot ?? null))

const noteRequired = computed(
  () => requirement.value === 'opening_balance' || reasonCode.value === 'other',
)

/** Opening balance is the only reason for unknown stock, so preselect it. */
const showReasonField = computed(
  () => requirement.value === 'opening_balance' || requirement.value === 'difference',
)

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (!element) return

    if (open) {
      physicalQty.value = props.item?.physicalQty !== null && props.item?.physicalQty !== undefined
        ? String(props.item.physicalQty)
        : ''
      // Unknown stock has exactly one valid reason, so preselect it instead of
      // making the operator discover that by failing validation.
      reasonCode.value = props.item?.reasonCode
        ?? (props.item?.systemQtySnapshot === null ? 'opening_balance' : '')
      reasonNote.value = props.item?.reasonNote ?? ''
      formError.value = null
      if (!element.open) element.showModal()
    } else if (element.open) {
      element.close()
    }
  },
)

watch(
  () => props.item?.systemQtySnapshot,
  (systemQty) => {
    if (systemQty === null) {
      reasonCode.value = 'opening_balance'
    } else if (reasonCode.value === 'opening_balance') {
      reasonCode.value = ''
    }
  },
)

function parseQty(value: string): number | null {
  const raw = value.trim().replace(',', '.')
  if (raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function submit() {
  const item = props.item
  if (!item) return

  const message = validateCount({
    systemQty: item.systemQtySnapshot,
    physicalQty: physicalQty.value,
    reasonCode: reasonCode.value,
    reasonNote: reasonNote.value,
    decimalScale: item.decimalScale,
  })

  if (message) {
    formError.value = message
    return
  }

  const qty = parseQty(physicalQty.value)
  if (qty === null) {
    formError.value = 'Jumlah fisik harus berupa angka.'
    return
  }

  const needReason = requirement.value !== 'none'
  formError.value = null
  emit('submit', {
    physicalQty: qty,
    reasonCode: needReason ? reasonCode.value : null,
    reasonNote: needReason && reasonNote.value.trim() ? reasonNote.value.trim() : null,
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
          <h2 class="text-[15px] font-semibold">Hitung fisik</h2>
          <p v-if="item" class="truncate text-[12px] text-[var(--color-muted)]">
            {{ item.sku }} · {{ item.productName }}
          </p>
        </div>
        <button class="btn" type="button" :disabled="saving" @click="close">Tutup</button>
      </div>

      <dl v-if="item" class="grid grid-cols-2 gap-x-4 gap-y-1 border-y border-[var(--color-line)] py-2 text-[12px]">
        <div>
          <dt class="text-[var(--color-muted)]">Stok sistem</dt>
          <dd class="num font-medium">
            <template v-if="item.systemQtySnapshot === null">
              <span class="tag tag-warn">Belum diketahui</span>
            </template>
            <template v-else>
              {{ formatQuantity(item.systemQtySnapshot) }} {{ item.unitLabel }}
            </template>
          </dd>
        </div>
        <div>
          <dt class="text-[var(--color-muted)]">Satuan</dt>
          <dd>{{ item.unitLabel || '—' }}</dd>
        </div>
      </dl>

      <p v-if="item && item.systemQtySnapshot === null" class="notice notice-warn">
        Stok sistem produk ini belum pernah diketahui. Jumlah yang Anda masukkan akan dicatat
        sebagai <strong>saldo awal</strong>, bukan selisih.
      </p>

      <div>
        <label class="field-label" for="physical-qty">Jumlah fisik</label>
        <input
          id="physical-qty"
          v-model="physicalQty"
          class="field num"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          :disabled="saving"
          :aria-describedby="item?.decimalScale ? 'physical-qty-hint' : undefined"
        >
        <p v-if="item && item.decimalScale > 0" id="physical-qty-hint" class="mt-1 text-[11px] text-[var(--color-muted)]">
          Boleh {{ item.decimalScale }} angka desimal.
        </p>
      </div>

      <div v-if="showReasonField">
        <label class="field-label" for="reason-code">Alasan</label>
        <select id="reason-code" v-model="reasonCode" class="field" :disabled="saving">
          <option value="">
            {{ requirement === 'opening_balance' ? 'Pilih alasan…' : 'Tanpa alasan (stok sama)' }}
          </option>
          <option v-for="reason in reasonOptions" :key="reason" :value="reason">
            {{ opnameReasonLabel(reason) }}
          </option>
        </select>
      </div>

      <div v-if="showReasonField">
        <label class="field-label" for="reason-note">
          Catatan{{ noteRequired ? ' (wajib)' : ' (opsional)' }}
        </label>
        <textarea
          id="reason-note"
          v-model="reasonNote"
          class="field"
          rows="2"
          :disabled="saving"
        />
      </div>

      <div v-if="formError" class="notice notice-error" role="alert">{{ formError }}</div>
      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? 'Menyimpan…' : 'Simpan hitungan' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
