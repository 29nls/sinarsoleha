<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { CatalogProduct } from '~/types/catalog'
import { formatRupiah } from '~/utils/format'

const props = defineProps<{
  open: boolean
  product: CatalogProduct | null
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [payload: { productId: string; purchaseCost: number | null }]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const cost = ref('')
const localError = ref<string | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    cost.value = props.product?.purchaseCost === null || props.product?.purchaseCost === undefined
      ? ''
      : String(props.product.purchaseCost)
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
  localError.value = null
  const trimmed = cost.value.trim()
  const parsed = trimmed === '' ? null : Number(trimmed)
  if (trimmed !== '' && (!Number.isFinite(parsed) || (parsed !== null && parsed < 0))) {
    localError.value = 'Harga beli harus berupa angka dan tidak boleh negatif.'
    return
  }
  if (!props.product) return
  emit('submit', { productId: props.product.id, purchaseCost: parsed })
}
</script>

<template>
  <dialog ref="dialog" class="dialog-panel max-w-md" @close="emit('close')" @cancel.prevent="emit('close')">
    <form class="space-y-3 p-4" novalidate @submit.prevent="submit">
      <div class="border-b border-[var(--color-line)] pb-3">
        <h2 class="text-[15px] font-semibold">Harga beli</h2>
        <p class="text-[12px] text-[var(--color-muted)]">
          {{ product?.sku }} · {{ product?.name }}
        </p>
      </div>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div>
        <label class="field-label" for="product-cost">Harga beli</label>
        <input
          id="product-cost"
          v-model="cost"
          class="field num"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          :aria-invalid="Boolean(localError)"
          aria-describedby="product-cost-help"
        />
        <p id="product-cost-help" class="mt-1 text-[11px] text-[var(--color-muted)]">
          Kosongkan bila belum diketahui. Nilai ini hanya terlihat oleh owner dan tidak pernah dikirim ke kasir.
        </p>
        <p v-if="localError" class="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">{{ localError }}</p>
      </div>

      <p class="text-[11px] text-[var(--color-muted)]">
        Nilai saat ini: <span class="num">{{ formatRupiah(product?.purchaseCost ?? null) }}</span>
      </p>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? 'Menyimpan…' : 'Simpan harga beli' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
