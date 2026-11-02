<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type {
  CatalogProduct,
  CategoryOption,
  ProductFormErrors,
  ProductFormValues,
  UnitOption,
} from '~/types/catalog'
import { productToForm, validateProductForm } from '~/utils/catalog'

const props = defineProps<{
  open: boolean
  product: CatalogProduct | null
  categories: CategoryOption[]
  units: UnitOption[]
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [values: ProductFormValues]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const form = reactive<ProductFormValues>(productToForm(null))
const errors = ref<ProductFormErrors>({})

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    Object.assign(form, productToForm(props.product))
    errors.value = {}
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
  errors.value = validateProductForm(form)
  if (Object.keys(errors.value).length > 0) return
  emit('submit', { ...form, sku: form.sku.trim(), name: form.name.trim() })
}
</script>

<template>
  <dialog ref="dialog" class="dialog-panel" @close="emit('close')" @cancel.prevent="emit('close')">
    <form class="space-y-3 p-4" novalidate @submit.prevent="submit">
      <div class="flex items-start justify-between gap-3 border-b border-[var(--color-line)] pb-3">
        <div>
          <h2 class="text-[15px] font-semibold">{{ product ? 'Edit produk' : 'Tambah produk' }}</h2>
          <p class="text-[12px] text-[var(--color-muted)]">
            Perubahan katalog tidak mengubah stok. Stok hanya berubah lewat modul inventaris.
          </p>
        </div>
        <button class="btn" type="button" :disabled="saving" @click="close">Tutup</button>
      </div>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label class="field-label" for="product-sku">SKU <span aria-hidden="true">*</span></label>
          <input
            id="product-sku"
            v-model="form.sku"
            class="field font-mono"
            type="text"
            maxlength="64"
            autocomplete="off"
            :aria-invalid="Boolean(errors.sku)"
            :aria-describedby="errors.sku ? 'product-sku-error' : undefined"
          />
          <p v-if="errors.sku" id="product-sku-error" class="mt-1 text-[11px] text-[var(--color-danger)]">
            {{ errors.sku }}
          </p>
        </div>

        <div>
          <label class="field-label" for="product-name">Nama barang <span aria-hidden="true">*</span></label>
          <input
            id="product-name"
            v-model="form.name"
            class="field"
            type="text"
            maxlength="200"
            autocomplete="off"
            :aria-invalid="Boolean(errors.name)"
            :aria-describedby="errors.name ? 'product-name-error' : undefined"
          />
          <p v-if="errors.name" id="product-name-error" class="mt-1 text-[11px] text-[var(--color-danger)]">
            {{ errors.name }}
          </p>
        </div>

        <div>
          <label class="field-label" for="product-category">Kategori</label>
          <select id="product-category" v-model="form.categoryId" class="field">
            <option :value="null">Tanpa kategori</option>
            <option v-for="category in categories" :key="category.id" :value="category.id">
              {{ category.name }}{{ category.isActive ? '' : ' (nonaktif)' }}
            </option>
          </select>
        </div>

        <div>
          <label class="field-label" for="product-unit">Satuan <span aria-hidden="true">*</span></label>
          <select
            id="product-unit"
            v-model="form.unitId"
            class="field"
            :aria-invalid="Boolean(errors.unitId)"
            :aria-describedby="errors.unitId ? 'product-unit-error' : undefined"
          >
            <option :value="0">Pilih satuan</option>
            <option v-for="unit in units" :key="unit.id" :value="unit.id">
              {{ unit.label }} ({{ unit.code }}){{ unit.isActive ? '' : ' (nonaktif)' }}
            </option>
          </select>
          <p v-if="errors.unitId" id="product-unit-error" class="mt-1 text-[11px] text-[var(--color-danger)]">
            {{ errors.unitId }}
          </p>
        </div>

        <div>
          <label class="field-label" for="product-sale-price">Harga jual</label>
          <input
            id="product-sale-price"
            v-model="form.salePrice"
            class="field num"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            :aria-invalid="Boolean(errors.salePrice)"
            :aria-describedby="errors.salePrice ? 'product-sale-price-error' : 'product-sale-price-help'"
          />
          <p v-if="errors.salePrice" id="product-sale-price-error" class="mt-1 text-[11px] text-[var(--color-danger)]">
            {{ errors.salePrice }}
          </p>
          <p v-else id="product-sale-price-help" class="mt-1 text-[11px] text-[var(--color-muted)]">
            Kosongkan bila belum diketahui. Produk tanpa harga tidak dapat dijual.
          </p>
        </div>

        <div>
          <label class="field-label" for="product-low-stock">Batas stok rendah</label>
          <input
            id="product-low-stock"
            v-model="form.lowStockThreshold"
            class="field num"
            type="number"
            min="0"
            step="0.001"
            inputmode="decimal"
            :aria-invalid="Boolean(errors.lowStockThreshold)"
            :aria-describedby="errors.lowStockThreshold ? 'product-low-stock-error' : undefined"
          />
          <p
            v-if="errors.lowStockThreshold"
            id="product-low-stock-error"
            class="mt-1 text-[11px] text-[var(--color-danger)]"
          >
            {{ errors.lowStockThreshold }}
          </p>
        </div>
      </div>

      <label class="inline-flex cursor-pointer items-center gap-2 text-[12px]">
        <input v-model="form.isActive" type="checkbox" />
        Produk aktif dan dapat muncul di katalog
      </label>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button class="btn btn-primary" type="submit" :disabled="saving">
          {{ saving ? 'Menyimpan…' : 'Simpan produk' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
