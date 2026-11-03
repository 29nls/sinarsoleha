<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CatalogProduct, CategoryOption } from '~/types/catalog'
import { SCOPE_NOTE_MAX, validateScopeNote } from '~/types/opname'

type ScopeMode = 'all' | 'category' | 'products'

const props = defineProps<{
  open: boolean
  saving: boolean
  error: string | null
  categories: CategoryOption[]
  searchResults: CatalogProduct[]
  searchLoading: boolean
  search: string
}>()

const emit = defineEmits<{
  close: []
  'update:search': [value: string]
  submit: [payload: { scopeNote: string; categoryId: number | null; productIds: string[] }]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const mode = ref<ScopeMode>('all')
const categoryId = ref<number | null>(null)
const scopeNote = ref('')
const selectedIds = ref<string[]>([])
const formError = ref<string | null>(null)

const noteLength = computed(() => scopeNote.value.trim().length)

const canSubmit = computed(() => {
  if (mode.value === 'category' && categoryId.value === null) return false
  if (mode.value === 'products' && selectedIds.value.length === 0) return false
  return true
})

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (!element) return

    if (open) {
      mode.value = 'all'
      categoryId.value = null
      scopeNote.value = ''
      selectedIds.value = []
      formError.value = null
      if (!element.open) element.showModal()
    } else if (element.open) {
      element.close()
    }
  },
)

function clearSelection(): void {
  selectedIds.value = []
}

function toggleProduct(product: CatalogProduct) {
  const index = selectedIds.value.indexOf(product.id)
  if (index >= 0) {
    selectedIds.value.splice(index, 1)
    return
  }
  selectedIds.value.push(product.id)
}

function isSelected(productId: string): boolean {
  return selectedIds.value.includes(productId)
}

function submit() {
  const noteError = validateScopeNote(scopeNote.value)
  if (noteError) {
    formError.value = noteError
    return
  }

  if (mode.value === 'category' && categoryId.value === null) {
    formError.value = 'Pilih kategori yang akan dihitung.'
    return
  }
  if (mode.value === 'products' && selectedIds.value.length === 0) {
    formError.value = 'Pilih minimal satu produk.'
    return
  }

  formError.value = null
  emit('submit', {
    scopeNote: scopeNote.value.trim(),
    categoryId: mode.value === 'category' ? categoryId.value : null,
    productIds: mode.value === 'products' ? [...selectedIds.value] : [],
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
        <div>
          <h2 class="text-[15px] font-semibold">Sesi opname baru</h2>
          <p class="text-[12px] text-[var(--color-muted)]">
            Stok sistem diambil sebagai snapshot saat sesi dibuat.
          </p>
        </div>
        <button class="btn" type="button" :disabled="saving" @click="close">Tutup</button>
      </div>

      <fieldset class="space-y-1.5">
        <legend class="field-label">Cakupan</legend>

        <label class="flex items-start gap-2 text-[13px]">
          <input v-model="mode" type="radio" value="all" :disabled="saving">
          <span>
            <span class="font-medium">Seluruh katalog</span>
            <span class="block text-[11px] text-[var(--color-muted)]">
              Semua produk, termasuk yang nonaktif. Bisa berat untuk katalog besar.
            </span>
          </span>
        </label>

        <label class="flex items-start gap-2 text-[13px]">
          <input v-model="mode" type="radio" value="category" :disabled="saving">
          <span>
            <span class="font-medium">Satu kategori</span>
            <span class="block text-[11px] text-[var(--color-muted)]">
              Cocok untuk hitung bertahap per rak atau jenis barang.
            </span>
          </span>
        </label>

        <label class="flex items-start gap-2 text-[13px]">
          <input v-model="mode" type="radio" value="products" :disabled="saving">
          <span>
            <span class="font-medium">Produk terpilih</span>
            <span class="block text-[11px] text-[var(--color-muted)]">
              Pilih manual produk yang akan dihitung.
            </span>
          </span>
        </label>
      </fieldset>

      <div v-if="mode === 'category'">
        <label class="field-label" for="scope-category">Kategori</label>
        <select id="scope-category" v-model="categoryId" class="field" :disabled="saving">
          <option :value="null">Pilih kategori…</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}{{ category.isActive ? '' : ' (nonaktif)' }}
          </option>
        </select>
      </div>

      <div v-if="mode === 'products'" class="space-y-2">
        <div>
          <label class="field-label" for="scope-product-search">Cari produk</label>
          <input
            id="scope-product-search"
            :value="search"
            class="field"
            type="search"
            autocomplete="off"
            placeholder="SKU atau nama produk"
            :disabled="saving"
            @input="emit('update:search', ($event.target as HTMLInputElement).value)"
          >
        </div>

        <div class="max-h-56 overflow-y-auto border border-[var(--color-line)]">
          <p v-if="searchLoading" class="p-3 text-[12px] text-[var(--color-muted)]" role="status">
            Mencari produk…
          </p>
          <p v-else-if="searchResults.length === 0" class="p-3 text-[12px] text-[var(--color-muted)]">
            Tidak ada produk yang cocok.
          </p>
          <ul v-else class="divide-y divide-[var(--color-line)]">
            <li v-for="product in searchResults" :key="product.id">
              <label class="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-[#f9fafb]">
                <input
                  type="checkbox"
                  :checked="isSelected(product.id)"
                  :disabled="saving"
                  @change="toggleProduct(product)"
                >
                <span class="font-mono text-[11px]">{{ product.sku }}</span>
                <span class="min-w-0 flex-1 truncate">{{ product.name }}</span>
                <span class="text-[11px] text-[var(--color-muted)]">{{ product.unitLabel }}</span>
              </label>
            </li>
          </ul>
        </div>

        <p class="text-[11px] text-[var(--color-muted)]">
          {{ selectedIds.length }} produk dipilih.
          <button
            v-if="selectedIds.length > 0"
            class="underline"
            type="button"
            :disabled="saving"
            @click="clearSelection"
          >
            Kosongkan
          </button>
        </p>
      </div>

      <div>
        <label class="field-label" for="scope-note">Catatan cakupan (opsional)</label>
        <textarea
          id="scope-note"
          v-model="scopeNote"
          class="field"
          rows="2"
          :maxlength="SCOPE_NOTE_MAX"
          :disabled="saving"
          placeholder="Contoh: Rak depan, shift pagi"
        />
        <p class="mt-1 text-right text-[11px] text-[var(--color-muted)]">
          {{ noteLength }}/{{ SCOPE_NOTE_MAX }}
        </p>
      </div>

      <div v-if="formError" class="notice notice-error" role="alert">{{ formError }}</div>
      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <div class="flex justify-end gap-2 border-t border-[var(--color-line)] pt-3">
        <button class="btn" type="button" :disabled="saving" @click="close">Batal</button>
        <button class="btn btn-primary" type="submit" :disabled="saving || !canSubmit">
          {{ saving ? 'Membuat…' : 'Buat sesi' }}
        </button>
      </div>
    </form>
  </dialog>
</template>
