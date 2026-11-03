<script setup lang="ts">
import { useTemplateRef } from 'vue'

const model = defineModel<string>({ required: true })
const emit = defineEmits<{
  navigate: [delta: number]
  choose: []
  escape: []
}>()

const inputRef = useTemplateRef<HTMLInputElement>('input')

function focus() {
  inputRef.value?.focus()
  inputRef.value?.select()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    emit('navigate', 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    emit('navigate', -1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    emit('choose')
  } else if (event.key === 'Escape') {
    event.preventDefault()
    emit('escape')
  }
}

defineExpose({ focus })
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <label class="sr-only" for="cashier-search">Cari SKU atau nama produk</label>
    <input
      id="cashier-search"
      ref="input"
      v-model="model"
      class="field w-full sm:max-w-md"
      type="search"
      autocomplete="off"
      placeholder="Scan / ketik SKU atau nama produk…"
      @keydown="onKeydown"
    />
    <span class="tag">F2</span>
  </div>
</template>
