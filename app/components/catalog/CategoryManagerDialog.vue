<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { CategoryOption, CategoryFormValues } from '~/types/catalog'

const props = defineProps<{
  open: boolean
  categories: CategoryOption[]
  saving: boolean
  error: string | null
}>()

const emit = defineEmits<{
  close: []
  submit: [values: CategoryFormValues]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const editingId = ref<number | null>(null)
const name = ref('')
const isActive = ref(true)
const localError = ref<string | null>(null)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      if (dialog.value?.open) dialog.value.close()
      return
    }
    resetForm()
    await nextTick()
    if (dialog.value && !dialog.value.open) dialog.value.showModal()
  },
  { immediate: true },
)

function resetForm() {
  editingId.value = null
  name.value = ''
  isActive.value = true
  localError.value = null
}

function edit(category: CategoryOption) {
  editingId.value = category.id
  name.value = category.name
  isActive.value = category.isActive
  localError.value = null
}

function close() {
  if (dialog.value?.open) dialog.value.close()
  else emit('close')
}

function submit() {
  localError.value = null
  const trimmed = name.value.trim()
  if (!trimmed) {
    localError.value = 'Nama kategori wajib diisi.'
    return
  }
  if (trimmed.length > 120) {
    localError.value = 'Nama kategori maksimal 120 karakter.'
    return
  }
  emit('submit', { categoryId: editingId.value, name: trimmed, isActive: isActive.value })
}

function toggleActive(category: CategoryOption) {
  emit('submit', {
    categoryId: category.id,
    name: category.name,
    isActive: !category.isActive,
  })
}
</script>

<template>
  <dialog ref="dialog" class="dialog-panel max-w-2xl" @close="emit('close')" @cancel.prevent="emit('close')">
    <div class="space-y-3 p-4">
      <div class="flex items-start justify-between gap-3 border-b border-[var(--color-line)] pb-3">
        <div>
          <h2 class="text-[15px] font-semibold">Kategori</h2>
          <p class="text-[12px] text-[var(--color-muted)]">
            Kategori yang masih dipakai produk tidak dapat dihapus. Nonaktifkan agar tidak dipakai untuk produk baru.
          </p>
        </div>
        <button class="btn" type="button" :disabled="saving" @click="close">Tutup</button>
      </div>

      <div v-if="error" class="notice notice-error" role="alert">{{ error }}</div>

      <form class="space-y-2 border-b border-[var(--color-line)] pb-3" novalidate @submit.prevent="submit">
        <div class="flex flex-wrap items-end gap-2">
          <div class="min-w-[220px] flex-1">
            <label class="field-label" for="category-name">
              {{ editingId === null ? 'Kategori baru' : 'Ubah nama kategori' }}
            </label>
            <input
              id="category-name"
              v-model="name"
              class="field"
              type="text"
              maxlength="120"
              autocomplete="off"
              placeholder="Nama kategori"
            />
          </div>
          <label class="inline-flex cursor-pointer items-center gap-2 pb-2 text-[12px]">
            <input v-model="isActive" type="checkbox" />
            Aktif
          </label>
          <button class="btn btn-primary" type="submit" :disabled="saving">
            {{ saving ? 'Menyimpan…' : editingId === null ? 'Tambah' : 'Simpan' }}
          </button>
          <button v-if="editingId !== null" class="btn" type="button" :disabled="saving" @click="resetForm">
            Batal edit
          </button>
        </div>
        <p v-if="localError" class="text-[11px] text-[var(--color-danger)]" role="alert">{{ localError }}</p>
      </form>

      <div class="max-h-[50vh] overflow-auto">
        <table class="table-dense">
          <thead>
            <tr>
              <th scope="col">Nama</th>
              <th scope="col">Status</th>
              <th scope="col" class="text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="categories.length === 0">
              <td colspan="3" class="py-6 text-center text-[var(--color-muted)]">Belum ada kategori.</td>
            </tr>
            <tr v-for="category in categories" :key="category.id">
              <td class="font-medium">{{ category.name }}</td>
              <td>
                <span :class="['tag', category.isActive ? 'tag-accent' : '']">
                  {{ category.isActive ? 'Aktif' : 'Nonaktif' }}
                </span>
              </td>
              <td class="whitespace-nowrap text-right">
                <button class="btn px-1.5 py-0.5 text-[11px]" type="button" :disabled="saving" @click="edit(category)">
                  Ubah
                </button>
                <button
                  class="btn ml-1 px-1.5 py-0.5 text-[11px]"
                  type="button"
                  :disabled="saving"
                  @click="toggleActive(category)"
                >
                  {{ category.isActive ? 'Nonaktifkan' : 'Aktifkan' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </dialog>
</template>
